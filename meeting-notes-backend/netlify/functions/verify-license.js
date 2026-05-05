// netlify/functions/verify-license.js  (v2, CJS, returns plan)
const { buildCorsHeaders, getOrigin, jsonResponse } = require('./_shared/cors');
const { validateLicense } = require('./_shared/plan');

exports.handler = async (event) => {
  const CORS = buildCorsHeaders(getOrigin(event));
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return jsonResponse(405, { valid: false, reason: 'Method not allowed' }, CORS);

  let licenseKey = '';
  try {
    const body = JSON.parse(event.body || '{}');
    licenseKey = String(body.licenseKey || '').trim();
  } catch {
    return jsonResponse(400, { valid: false, reason: 'Bad request' }, CORS);
  }
  if (!licenseKey || licenseKey.length < 8) {
    return jsonResponse(400, { valid: false, reason: 'Invalid key format' }, CORS);
  }

  const lic = await validateLicense(licenseKey);
  if (!lic.valid) return jsonResponse(200, { valid: false, reason: lic.reason }, CORS);
  if (!lic.plan)  return jsonResponse(200, { valid: false, reason: 'Unknown product: ' + lic.productName }, CORS);

  const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
  // store check is done inside validateLicense in future; skipping for now
  return jsonResponse(200, {
    valid: true,
    plan: lic.plan,               // 'pro' or 'max'
    validUntil: lic.validUntil,
    customerEmail: lic.customerEmail,
    productName: lic.productName
  }, CORS);
};
