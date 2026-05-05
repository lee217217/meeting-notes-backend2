// netlify/functions/email-export.js  (v2, CJS)
const { getStore } = require('@netlify/blobs');
const { buildCorsHeaders, getOrigin } = require('./_shared/cors');

const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';

exports.handler = async (event) => {
  const CORS = buildCorsHeaders(getOrigin(event));
  const params = event.queryStringParameters || {};
  if (params.key !== ADMIN_KEY) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
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
  const filename = `emails-${new Date().toISOString().slice(0,10)}.csv`;
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    },
    body: csv
  };
};
