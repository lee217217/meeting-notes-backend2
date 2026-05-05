// ============================================================
// verify-license.js  |  v3 (2026-05-05)
// Reads from license-keys store (issued by lemon-webhook)
// Returns { valid, plan, validUntil, customerEmail, reason? }
// ============================================================

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

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

// 每個 plan 容許嘅 device 數
const ACTIVATION_LIMITS = {
  pro: 2,   // Laptop + phone
  max: 5,   // Power user
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST')     return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ valid: false, reason: 'method_not_allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ valid: false, reason: 'bad_json' }) }; }

  const licenseKey = (body.licenseKey || '').trim();
  const deviceId   = (body.deviceId   || '').trim();  // ← NEW：frontend 傳上嚟

  if (!licenseKey || licenseKey.length < 8) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ valid: false, reason: 'missing_license' }) };
  }
  if (!deviceId) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ valid: false, reason: 'missing_device_id' }) };
  }

  try {
    // 1. Blacklist
    const blk = blobsStore('license-blacklist');
    const hit = await blk.get(licenseKey, { type: 'json' });
    if (hit) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ valid: false, reason: hit.reason || 'blacklisted' }) };
    }

    // 2. License lookup
    const keys = blobsStore('license-keys');
    let rec = await keys.get(licenseKey, { type: 'json' });

    // Legacy fallback
    if (!rec) {
      console.warn('[verify-license] legacy key:', licenseKey.slice(-4));
      const d = new Date(); d.setDate(d.getDate() + 30);
      rec = {
        plan: 'pro',
        validUntil: d.toISOString(),
        customerEmail: null,
        legacy: true,
        activations: {}
      };
    }

    // 3. Expired?
    if (rec.validUntil && new Date(rec.validUntil) < new Date()) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ valid: false, reason: 'expired' }) };
    }

    // 4. ★ Device activation check ★
    rec.activations = rec.activations || {};
    const limit = ACTIVATION_LIMITS[rec.plan] || 2;
    const now = new Date().toISOString();

    if (rec.activations[deviceId]) {
      // 已 activate 過 → update lastSeen
      rec.activations[deviceId].lastSeen = now;
    } else {
      // 新 device → check limit
      const activeCount = Object.keys(rec.activations).length;
      if (activeCount >= limit) {
        return {
          statusCode: 200, headers: CORS_HEADERS,
          body: JSON.stringify({
            valid: false,
            reason: 'activation_limit_exceeded',
            activeCount,
            limit,
            message: `This license is already active on ${activeCount} device(s). Max ${limit} allowed for ${rec.plan.toUpperCase()} plan.`
          })
        };
      }
      // Register new device
      rec.activations[deviceId] = {
        firstSeen: now,
        lastSeen: now,
        userAgent: (event.headers['user-agent'] || '').slice(0, 200)
      };
    }

    // 5. Persist updated rec
    await keys.setJSON(licenseKey, rec);

    return {
      statusCode: 200, headers: CORS_HEADERS,
      body: JSON.stringify({
        valid: true,
        plan: rec.plan || 'pro',
        validUntil: rec.validUntil,
        customerEmail: rec.customerEmail || null,
        deviceId,
        activeDevices: Object.keys(rec.activations).length,
        deviceLimit: limit
      })
    };
  } catch (e) {
    console.error('[verify-license] error:', e);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ valid: false, reason: 'server_error' }) };
  }
};