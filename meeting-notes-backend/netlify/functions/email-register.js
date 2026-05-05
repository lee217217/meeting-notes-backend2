// netlify/functions/email-register.js  (v2, CJS)
const { getStore } = require('@netlify/blobs');
const { buildCorsHeaders, getOrigin, getClientIp, jsonResponse } = require('./_shared/cors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLOCKED_DOMAINS = [
  'tempmail.com','10minutemail.com','guerrillamail.com','mailinator.com',
  'throwaway.email','yopmail.com','trashmail.com','getnada.com'
];

function todayStr() { return new Date().toISOString().slice(0, 10); }

exports.handler = async (event) => {
  const CORS = buildCorsHeaders(getOrigin(event));
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return jsonResponse(405, { error: 'POST only' }, CORS);

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResponse(400, { error: 'Invalid JSON' }, CORS); }

  const email = String(body.email || '').trim().toLowerCase();
  const fp    = String(body.fp || '').slice(0, 64);
  const ua    = event.headers['user-agent'] || event.headers['User-Agent'] || '';
  const ip    = getClientIp(event);

  if (!EMAIL_RE.test(email))           return jsonResponse(400, { error: 'Invalid email' }, CORS);
  if (email.length > 120)               return jsonResponse(400, { error: 'Email too long' }, CORS);
  const domain = email.split('@')[1];
  if (BLOCKED_DOMAINS.includes(domain)) return jsonResponse(400, { error: 'Disposable email not allowed' }, CORS);

  const store = getStore({ name: 'email-list', consistency: 'strong' });

  // IP limit: 2/day (tightened from 5)
  if (ip && ip !== 'unknown') {
    const ipKey = `ip:${ip}:${todayStr()}`;
    const ipCount = Number((await store.get(ipKey)) || 0);
    if (ipCount >= 2) return jsonResponse(429, { error: 'Too many registrations from this IP today' }, CORS);
    await store.set(ipKey, String(ipCount + 1));
  }

  // Fingerprint binding: one fp -> only 1 email (prevents clearing localStorage to rebind)
  if (fp) {
    const fpKey = `fp:${fp}`;
    const boundEmail = await store.get(fpKey);
    if (boundEmail && boundEmail !== email) {
      return jsonResponse(429, { error: 'This device is already registered with another email' }, CORS);
    }
    if (!boundEmail) await store.set(fpKey, email);
  }

  const key = `email:${email}`;
  const existing = await store.get(key, { type: 'json' });
  const now = new Date().toISOString();
  const record = existing || {
    email, plan: 'starter', createdAt: now,
    fingerprint: fp, ua, ip, verified: false, source: 'landing'
  };
  record.lastSeenAt = now;
  record.seenCount = (record.seenCount || 0) + 1;
  await store.setJSON(key, record);

  // Daily log
  const logKey = `log:${todayStr()}`;
  const log = (await store.get(logKey, { type: 'json' })) || [];
  log.push({ at: now, email, ip, fp });
  await store.setJSON(logKey, log);

  return jsonResponse(200, {
    success: true, plan: 'starter',
    message: existing ? 'Welcome back' : 'Starter unlocked'
  }, CORS);
};
