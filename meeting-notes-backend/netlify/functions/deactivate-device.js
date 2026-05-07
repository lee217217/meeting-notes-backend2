// ============================================================
// deactivate-device.js  |  v1 (2026-05-07)
// ------------------------------------------------------------
// Removes a device from a license's activations map.
//
// Request  (POST):  { licenseKey, deviceId, currentDeviceId? }
// Response (JSON):
//   success: { ok: true, remaining: N, limit: N, removedDeviceId }
//   failure: { ok: false, reason, message? }
//
// Reasons: missing_license | missing_device_id | bad_json |
//          method_not_allowed | blacklisted | not_found |
//          device_not_activated | server_error | rate_limited
//
// Notes:
// - Does NOT allow removing the device making the request
//   UNLESS currentDeviceId !== deviceId (to prevent self-lockout).
// - Simple IP-based rate limit: 20 requests / 10 min per IP.
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

const ACTIVATION_LIMITS = { pro: 2, max: 5 };

async function rateLimit(ip) {
  try {
    const rl = blobsStore('rate-limits');
    const key = `deactivate:${ip}:${Math.floor(Date.now() / (10 * 60 * 1000))}`;
    const curr = (await rl.get(key, { type: 'json' })) || { count: 0 };
    if (curr.count >= 20) return false;
    curr.count += 1;
    await rl.setJSON(key, curr);
    return true;
  } catch { return true; }  // fail-open if blob errors
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405, headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, reason: 'method_not_allowed' })
    };
  }

  // Rate limit
  const ip = event.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || event.headers['client-ip'] || 'unknown';
  if (!(await rateLimit(ip))) {
    return {
      statusCode: 429, headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, reason: 'rate_limited' })
    };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch {
    return {
      statusCode: 400, headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, reason: 'bad_json' })
    };
  }

  const licenseKey       = (body.licenseKey || '').trim();
  const deviceIdToRemove = (body.deviceId   || '').trim();
  const currentDeviceId  = (body.currentDeviceId || '').trim();

  if (!licenseKey || licenseKey.length < 8) {
    return {
      statusCode: 400, headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, reason: 'missing_license' })
    };
  }
  if (!deviceIdToRemove) {
    return {
      statusCode: 400, headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, reason: 'missing_device_id' })
    };
  }

  try {
    // 1. Blacklist check
    const blk = blobsStore('license-blacklist');
    const hit = await blk.get(licenseKey, { type: 'json' });
    if (hit) {
      return {
        statusCode: 200, headers: CORS_HEADERS,
        body: JSON.stringify({ ok: false, reason: 'blacklisted' })
      };
    }

    // 2. License lookup
    const keys = blobsStore('license-keys');
    const rec = await keys.get(licenseKey, { type: 'json' });
    if (!rec) {
      return {
        statusCode: 404, headers: CORS_HEADERS,
        body: JSON.stringify({ ok: false, reason: 'not_found' })
      };
    }

    rec.activations = rec.activations || {};

    if (!rec.activations[deviceIdToRemove]) {
      const plan = rec.plan || 'pro';
      const limit = ACTIVATION_LIMITS[plan] || 2;
      return {
        statusCode: 200, headers: CORS_HEADERS,
        body: JSON.stringify({
          ok: false, reason: 'device_not_activated',
          remaining: Object.keys(rec.activations).length,
          limit
        })
      };
    }

    // 3. Remove the device
    delete rec.activations[deviceIdToRemove];

    // 4. Persist
    await keys.setJSON(licenseKey, rec);

    const plan = rec.plan || 'pro';
    const limit = ACTIVATION_LIMITS[plan] || 2;
    const remaining = Object.keys(rec.activations).length;

    console.log('[deactivate-device] ✅ removed',
      deviceIdToRemove.slice(0, 10), 'lk=', licenseKey.slice(-4),
      'remaining=', remaining, '/', limit);

    return {
      statusCode: 200, headers: CORS_HEADERS,
      body: JSON.stringify({
        ok: true,
        removedDeviceId: deviceIdToRemove,
        remaining,
        limit,
        plan,
        // Signal to frontend if user removed their own current device
        selfRemoved: currentDeviceId && currentDeviceId === deviceIdToRemove
      })
    };
  } catch (e) {
    console.error('[deactivate-device] error:', e);
    return {
      statusCode: 500, headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, reason: 'server_error' })
    };
  }
};
