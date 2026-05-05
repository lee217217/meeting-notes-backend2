// netlify/functions/_shared/cors.js
const ALLOWED = (process.env.ALLOWED_ORIGINS || '*')
  .split(',').map(s => s.trim()).filter(Boolean);

function buildCorsHeaders(origin) {
  const allow = ALLOWED.includes('*') || ALLOWED.includes(origin)
    ? (origin || '*') : (ALLOWED[0] || '*');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  };
}

function getOrigin(event) {
  return event.headers?.origin || event.headers?.Origin || '';
}

function getClientIp(event) {
  const h = event.headers || {};
  const xff = h['x-forwarded-for'] || h['X-Forwarded-For'] || '';
  if (xff) return xff.split(',')[0].trim();
  return h['client-ip'] || h['x-nf-client-connection-ip'] || 'unknown';
}

function jsonResponse(statusCode, data, headers = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data)
  };
}

module.exports = { buildCorsHeaders, getOrigin, getClientIp, jsonResponse };
