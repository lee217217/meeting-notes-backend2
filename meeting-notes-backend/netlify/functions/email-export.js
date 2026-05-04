// netlify/functions/email-export.js
// GET /.netlify/functions/email-export?key=YOUR_SECRET
// Returns CSV of all registered emails

import { getStore } from '@netlify/blobs';

const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-to-a-long-random-string';

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get('key') !== ADMIN_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const store = getStore({ name: 'email-list' });
  const { blobs } = await store.list({ prefix: 'email:' });

  const rows = [['email','plan','createdAt','lastSeenAt','seenCount','verified','source']];
  for (const b of blobs) {
    const r = await store.get(b.key, { type: 'json' });
    if (!r) continue;
    rows.push([r.email, r.plan, r.createdAt, r.lastSeenAt, r.seenCount, r.verified, r.source]);
  }

  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="emails-${new Date().toISOString().slice(0,10)}.csv"`
    }
  });
};
