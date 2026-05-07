// ============================================================
// list-devices.js  |  v1 (2026-05-07)
// ------------------------------------------------------------
// Returns the list of devices currently activated on a license.
//
// Request  (POST):  { licenseKey }
// Response (JSON):
//   success: {
//     ok: true, plan, limit, active, devices: [
//       { deviceId, firstSeen, lastSeen, label }
//     ]
//   }
//   failure: { ok: false, reason }
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

function parseUA(ua) {
  if (!ua) return 'Unknown device';
  const uaS = String(ua);
  let os = 'Unknown OS';
  if (/Windows NT/i.test(uaS)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(uaS)) os = 'macOS';
  else if (/iPhone|iPad|iOS/i.test(uaS)) os = 'iOS';
  else if (/Android/i.test(uaS)) os = 'Android';
  else if (/Linux/i.test(uaS)) os = 'Linux';

  let browser = 'Browser';
  if (/Edg\//i.test(uaS)) browser = 'Edge';
  else if (/Chrome\//i.test(uaS) && !/Edg\//i.test(uaS)) browser = 'Chrome';
  else if (/Firefox\//i.test(uaS)) browser = 'Firefox';
  else if (/Safari\//i.test(uaS) && !/Chrome\//i.test(uaS)) browser = 'Safari';

  return `${browser} on ${os}`;
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

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch {
    return {
      statusCode: 400, headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, reason: 'bad_json' })
    };
  }

  const licenseKey = (body.licenseKey || '').trim();
  if (!licenseKey || licenseKey.length < 8) {
    return {
      statusCode: 400, headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, reason: 'missing_license' })
    };
  }

  try {
    const blk = blobsStore('license-blacklist');
    if (await blk.get(licenseKey, { type: 'json' })) {
      return {
        statusCode: 200, headers: CORS_HEADERS,
        body: JSON.stringify({ ok: false, reason: 'blacklisted' })
      };
    }

    const keys = blobsStore('license-keys');
    const rec = await keys.get(licenseKey, { type: 'json' });
    if (!rec) {
      return {
        statusCode: 404, headers: CORS_HEADERS,
        body: JSON.stringify({ ok: false, reason: 'not_found' })
      };
    }

    const plan  = rec.plan || 'pro';
    const limit = ACTIVATION_LIMITS[plan] || 2;
    const acts  = rec.activations || {};

    const devices = Object.entries(acts).map(([deviceId, info]) => ({
      deviceId,
      firstSeen: info.firstSeen || null,
      lastSeen:  info.lastSeen  || null,
      label:     parseUA(info.userAgent)
    })).sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));

    return {
      statusCode: 200, headers: CORS_HEADERS,
      body: JSON.stringify({
        ok: true,
        plan,
        limit,
        active: devices.length,
        devices,
        customerEmail: rec.customerEmail || null,
        validUntil: rec.validUntil || null
      })
    };
  } catch (e) {
    console.error('[list-devices] error:', e);
    return {
      statusCode: 500, headers: CORS_HEADERS,
      body: JSON.stringify({ ok: false, reason: 'server_error' })
    };
  }
};
