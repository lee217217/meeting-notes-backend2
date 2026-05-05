// netlify/functions/_shared/quota.js
const { getStore } = require('@netlify/blobs');
const { PLAN_LIMITS } = require('./plan');

function blobsStore(name) {
  return getStore({
    name,
    consistency: 'strong',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN
  });
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function weekStr() {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  const wk = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
  return d.getFullYear() + '-W' + String(wk).padStart(2, '0');
}
function monthStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function getPeriodValue(period) {
  if (period === 'daily')   return todayStr();
  if (period === 'weekly')  return weekStr();
  if (period === 'monthly') return monthStr();
  throw new Error('bad period: ' + period);
}
function resetAtFor(period) {
  const d = new Date();
  if (period === 'daily') {
    const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0);
    return n.toISOString();
  }
  if (period === 'weekly') {
    const diff = (8 - d.getDay()) % 7 || 7;
    const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff, 0, 0, 0);
    return n.toISOString();
  }
  if (period === 'monthly') {
    const n = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0);
    return n.toISOString();
  }
}
function makeKey(period, idType, id) {
  return `${period}:${idType}:${id}:${getPeriodValue(period)}`;
}
async function readCount(store, key) {
  const v = await store.get(key);
  return Number(v) || 0;
}
async function writeCount(store, key, val) {
  await store.set(key, String(val));
}

async function checkQuota({ plan, fp, ip, email, licenseKey }) {
  const conf = PLAN_LIMITS[plan];
  if (!conf) return { ok: false, reason: 'unknown_plan', used: 0, limit: 0, period: 'daily' };

  const store = blobsStore('quota-counters');
  const { period, limit } = conf;
  let used = 0, reason = null;

  if (plan === 'pro' || plan === 'max') {
    if (!licenseKey) return { ok: false, reason: 'no_license', used: 0, limit, period };
    used = await readCount(store, makeKey(period, 'lk', licenseKey));
  } else {
    const reads = [];
    if (fp)    reads.push(readCount(store, makeKey(period, 'fp', fp)));
    if (ip)    reads.push(readCount(store, makeKey(period, 'ip', ip)));
    if (email) reads.push(readCount(store, makeKey(period, 'em', email.toLowerCase())));
    const counts = await Promise.all(reads);
    used = Math.max(0, ...counts);
  }

  const resetAt = resetAtFor(period);
  if (used >= limit) {
    return { ok: false, reason: reason || period, used, limit, period, resetAt };
  }
  return { ok: true, used, limit, period, resetAt };
}

async function incrementQuota({ plan, fp, ip, email, licenseKey }) {
  const conf = PLAN_LIMITS[plan];
  if (!conf) return;

  const store = blobsStore('quota-counters');
  const { period } = conf;
  const tasks = [];

  async function bump(idType, id) {
    if (!id) return;
    const k = makeKey(period, idType, id);
    const cur = await readCount(store, k);
    await writeCount(store, k, cur + 1);
  }

  if (plan === 'pro' || plan === 'max') {
    tasks.push(bump('lk', licenseKey));
  } else {
    tasks.push(bump('fp', fp));
    tasks.push(bump('ip', ip));
    if (email) tasks.push(bump('em', email.toLowerCase()));
  }
  await Promise.all(tasks);
}

module.exports = { checkQuota, incrementQuota, blobsStore, todayStr, weekStr, monthStr };