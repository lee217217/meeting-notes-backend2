// netlify/functions/email-register.js
// A+A+A flow: 即填即解鎖 Starter tier，儲 Netlify Blobs
// No external email service yet (phase 2 add Resend)

import { getStore } from '@netlify/blobs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLOCKED_DOMAINS = [
  'tempmail.com','10minutemail.com','guerrillamail.com','mailinator.com',
  'throwaway.email','yopmail.com','trashmail.com','getnada.com'
];

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405, headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const email = String(body.email || '').trim().toLowerCase();
  const fp    = String(body.fp || '').slice(0, 64);
  const ua    = req.headers.get('user-agent') || '';
  const ip    = context.ip || req.headers.get('x-nf-client-connection-ip') || '';

  // Validate email
  if (!EMAIL_RE.test(email))             return json({ error: 'Invalid email' }, 400);
  if (email.length > 120)                 return json({ error: 'Email too long' }, 400);
  const domain = email.split('@')[1];
  if (BLOCKED_DOMAINS.includes(domain))   return json({ error: 'Disposable email not allowed' }, 400);

  const store = getStore({ name: 'email-list', consistency: 'strong' });

  // Simple IP rate limit: max 5 registrations per IP per day
  if (ip) {
    const ipKey = `ip:${ip}:${todayStr()}`;
    const ipCount = Number((await store.get(ipKey)) || 0);
    if (ipCount >= 5) return json({ error: 'Too many registrations from this IP today' }, 429);
    await store.set(ipKey, String(ipCount + 1));
  }

  // Upsert email record
  const key = `email:${email}`;
  const existing = await store.get(key, { type: 'json' });
  const now = new Date().toISOString();

  const record = existing || {
    email,
    plan: 'starter',
    createdAt: now,
    fingerprint: fp,
    ua, ip,
    verified: false,     // phase 2: magic link will flip this
    source: 'landing'
  };
  record.lastSeenAt = now;
  record.seenCount  = (record.seenCount || 0) + 1;

  await store.setJSON(key, record);

  // Append to aggregated list for easy export (append-only log)
  const logKey = `log:${todayStr()}`;
  const log = (await store.get(logKey, { type: 'json' })) || [];
  log.push({ at: now, email, ip, fp });
  await store.setJSON(logKey, log);

  return json({
    success: true,
    plan: 'starter',
    message: existing ? 'Welcome back' : 'Starter unlocked'
  });
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' }
  });
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
