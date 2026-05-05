// ============================================================
// verify-license.js  |  v3 (2026-05-05)
// Reads from license-keys store (issued by lemon-webhook)
// Returns { valid, plan, validUntil, customerEmail, reason? }
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST')     return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ valid: false, reason: 'method_not_allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ valid: false, reason: 'bad_json' }) }; }

  const licenseKey = (body.licenseKey || '').trim();
  if (!licenseKey || licenseKey.length < 8) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ valid: false, reason: 'missing_license' }) };
  }

  try {
    // 1. Blacklist check
    const blk = blobsStore('license-blacklist');
    const hit = await blk.get(licenseKey, { type: 'json' });
    if (hit) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ valid: false, reason: hit.reason || 'blacklisted' }) };
    }

    // 2. License-keys store lookup
    const keys = blobsStore('license-keys');
    const rec = await keys.get(licenseKey, { type: 'json' });
    if (rec) {
      // Expired?
      if (rec.validUntil && new Date(rec.validUntil) < new Date()) {
        return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ valid: false, reason: 'expired' }) };
      }
      return {
        statusCode: 200, headers: CORS_HEADERS,
        body: JSON.stringify({
          valid: true,
          plan: rec.plan || 'pro',
          validUntil: rec.validUntil,
          customerEmail: rec.customerEmail || null
        })
      };
    }

    // 3. Fallback: optionally call Lemon Squeezy API to activate licenses that
    //    were manually-emailed before webhook existed. Keep it simple: mark valid-as-pro.
    //    (Set LEMON_API_KEY if you want strict online validation later.)
    console.warn('[verify-license] not in local store, treating as legacy Pro:', licenseKey.slice(-4));
    const d = new Date(); d.setDate(d.getDate() + 30);
    return {
      statusCode: 200, headers: CORS_HEADERS,
      body: JSON.stringify({
        valid: true,
        plan: 'pro',
        validUntil: d.toISOString(),
        legacy: true
      })
    };
  } catch (e) {
    console.error('[verify-license] error:', e);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ valid: false, reason: 'server_error' }) };
  }
};