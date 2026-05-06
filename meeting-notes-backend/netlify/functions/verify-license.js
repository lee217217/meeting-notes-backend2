// ============================================================
// verify-license.js  |  v4 (2026-05-05)
// ------------------------------------------------------------
// Reads from license-keys store (issued by lemon-webhook).
// v4 CHANGE: Device binding via `deviceId` + `activations` map.
//            Pro allows 2 devices, Max allows 5.
//
// Request  (POST):  { licenseKey, deviceId }
// Response (JSON):
//   success: { valid: true, plan, validUntil, customerEmail,
//              deviceId, activeDevices, deviceLimit }
//   failure: { valid: false, reason, message?, activeCount?, limit? }
//
// Reasons: missing_license | missing_device_id | bad_json |
//          method_not_allowed | blacklisted | expired |
//          activation_limit_exceeded | server_error
// ============================================================

const { getStore } = require('@netlify/blobs');

function blobsStore(name) {
  return getStore({
    name,
    consistency: 'strong',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN
  });
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// Activation limits per plan
const ACTIVATION_LIMITS = {
  pro: 2,   // Laptop + phone
  max: 5,   // Power user
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405, headers: CORS_HEADERS,
      body: JSON.stringify({ valid: false, reason: 'method_not_allowed' })
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch {
    return {
      statusCode: 400, headers: CORS_HEADERS,
      body: JSON.stringify({ valid: false, reason: 'bad_json' })
    };
  }

  const licenseKey = (body.licenseKey || '').trim();
  const deviceId   = (body.deviceId   || '').trim();

  if (!licenseKey || licenseKey.length < 8) {
    return {
      statusCode: 400, headers: CORS_HEADERS,
      body: JSON.stringify({ valid: false, reason: 'missing_license' })
    };
  }
  if (!deviceId) {
    return {
      statusCode: 400, headers: CORS_HEADERS,
      body: JSON.stringify({ valid: false, reason: 'missing_device_id' })
    };
  }

  try {
    // 1. Blacklist check
    const blk = blobsStore('license-blacklist');
    const hit = await blk.get(licenseKey, { type: 'json' });
    if (hit) {
      return {
        statusCode: 200, headers: CORS_HEADERS,
        body: JSON.stringify({ valid: false, reason: hit.reason || 'blacklisted' })
      };
    }

    // 2. License lookup
    const keys = blobsStore('license-keys');
    let rec = await keys.get(licenseKey, { type: 'json' });

    // Legacy fallback for keys issued before webhook existed
    if (!rec) {
      console.warn('[verify-license] legacy key:', licenseKey.slice(-4));
      const d = new Date(); d.setDate(d.getDate() + 30);
      rec = {
        licenseKey,
        plan: 'pro',
        validUntil: d.toISOString(),
        customerEmail: null,
        legacy: true,
        activations: {}
      };
    }

    // 3. Expired?
    if (rec.validUntil && new Date(rec.validUntil) < new Date()) {
      return {
        statusCode: 200, headers: CORS_HEADERS,
        body: JSON.stringify({ valid: false, reason: 'expired' })
      };
    }

    // 4. Device activation check
    rec.activations = rec.activations || {};
    const plan  = rec.plan || 'pro';
    const limit = ACTIVATION_LIMITS[plan] || 2;
    const now   = new Date().toISOString();

    if (rec.activations[deviceId]) {
      // Already activated on this device → refresh lastSeen
      rec.activations[deviceId].lastSeen = now;
    } else {
      const activeCount = Object.keys(rec.activations).length;
      if (activeCount >= limit) {
        return {
          statusCode: 200, headers: CORS_HEADERS,
          body: JSON.stringify({
            valid: false,
            reason: 'activation_limit_exceeded',
            activeCount,
            limit,
            message: `This license is already active on ${activeCount} device(s). Max ${limit} allowed for ${plan.toUpperCase()} plan.`
          })
        };
      }
      rec.activations[deviceId] = {
        firstSeen: now,
        lastSeen: now,
        userAgent: (event.headers['user-agent'] || '').slice(0, 200)
      };
    }

    // 5. Persist
    await keys.setJSON(licenseKey, rec);

    return {
      statusCode: 200, headers: CORS_HEADERS,
      body: JSON.stringify({
        valid: true,
        plan,
        validUntil: rec.validUntil,
        customerEmail: rec.customerEmail || null,
        deviceId,
        activeDevices: Object.keys(rec.activations).length,
        deviceLimit: limit
      })
    };
  } catch (e) {
    console.error('[verify-license] error:', e);
    return {
      statusCode: 500, headers: CORS_HEADERS,
      body: JSON.stringify({ valid: false, reason: 'server_error' })
    };
  }
};
