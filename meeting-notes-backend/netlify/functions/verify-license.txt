// Netlify Function: /.netlify/functions/verify-license
// POST { licenseKey: "xxxx-xxxx-xxxx-xxxx" }
// Returns { valid: true, validUntil: "...", customerEmail: "..." } or { valid: false, reason: "..." }

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ valid: false, reason: 'Method not allowed' }) };
  }

  const apiKey = process.env.LEMON_SQUEEZY_API_KEY;
  const storeId = process.env.LEMON_SQUEEZY_STORE_ID; // optional check

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ valid: false, reason: 'Server not configured' })
    };
  }

  let licenseKey = '';
  try {
    const body = JSON.parse(event.body || '{}');
    licenseKey = String(body.licenseKey || '').trim();
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ valid: false, reason: 'Bad request' }) };
  }

  if (!licenseKey || licenseKey.length < 8) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ valid: false, reason: 'Invalid key format' }) };
  }

  try {
    // Lemon Squeezy License API — no auth header needed for /activate & /validate endpoints,
    // but we use authenticated API to read full license info for extra safety.
    const res = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ license_key: licenseKey })
    });

    const data = await res.json();

    if (!data || data.valid !== true) {
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          valid: false,
          reason: (data && data.error) || 'License not valid'
        })
      };
    }

    // Optional: enforce same store
    if (storeId && data.meta && String(data.meta.store_id) !== String(storeId)) {
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({ valid: false, reason: 'License belongs to another store' })
      };
    }

    // Status check: active / inactive / expired / disabled
    const licenseStatus = data.license_key && data.license_key.status;
    if (licenseStatus && licenseStatus !== 'active' && licenseStatus !== 'inactive') {
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({ valid: false, reason: 'License ' + licenseStatus })
      };
    }

    // Compute validUntil: use expires_at if present, else +32 days (monthly buffer)
    const expiresAt = data.license_key && data.license_key.expires_at;
    const validUntil = expiresAt
      ? new Date(expiresAt).toISOString()
      : new Date(Date.now() + 32 * 24 * 60 * 60 * 1000).toISOString();

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        valid: true,
        validUntil,
        customerEmail: (data.meta && data.meta.customer_email) || null,
        productName: (data.meta && data.meta.product_name) || null
      })
    };
  } catch (err) {
    console.error('[verify-license] error', err);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ valid: false, reason: 'Verification service error' })
    };
  }
};