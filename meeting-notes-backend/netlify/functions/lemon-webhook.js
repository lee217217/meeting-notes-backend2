// ============================================================
// lemon-webhook.js  |  v4 (2026-05-05)
// ------------------------------------------------------------
// Handles Lemon Squeezy webhooks:
//  1. order_created / subscription_created  →  Issue license → license-keys store
//     (plan detected from variant_id: Pro 1593246 / Max 1613669)
//  2. subscription_updated  →  Plan change (Pro ↔ Max) + quota reset
//  3. subscription_cancelled / expired / refunded / key_disabled
//     →  Blacklist license → license-blacklist store
//  4. subscription_resumed  →  Un-blacklist
//
//  v4 CHANGE: record now includes `activations: {}` bucket for device binding.
// ============================================================

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const PRO_VARIANT_ID = process.env.LEMON_PRO_VARIANT_ID || '1593246';
const MAX_VARIANT_ID = process.env.LEMON_MAX_VARIANT_ID || '1613669';

function blobsStore(name) {
  return getStore({
    name,
    consistency: 'strong',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN
  });
}

function timingSafeEqual(a, b) {
  try {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch { return false; }
}

function detectPlan(variantId) {
  const v = String(variantId || '');
  if (v === MAX_VARIANT_ID) return 'max';
  if (v === PRO_VARIANT_ID) return 'pro';
  return 'pro';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const secret = process.env.LEMON_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook] LEMON_WEBHOOK_SECRET not configured');
    return { statusCode: 500, body: 'Server not configured' };
  }

  const signature = event.headers['x-signature'] || event.headers['X-Signature'];
  const raw = event.body || '';
  const computed = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (!timingSafeEqual(signature || '', computed)) {
    console.warn('[webhook] signature mismatch');
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let payload;
  try { payload = JSON.parse(raw); }
  catch { return { statusCode: 400, body: 'Bad JSON' }; }

  const eventName = payload?.meta?.event_name;
  const data = payload?.data;
  const attrs = data?.attributes || {};

  const licenseKey =
    attrs?.license_key ||
    attrs?.key ||
    attrs?.first_order_item?.license_key ||
    attrs?.meta?.license_key ||
    payload?.meta?.custom_data?.license_key ||
    null;

  const variantId =
    attrs?.variant_id ||
    attrs?.first_order_item?.variant_id ||
    attrs?.product?.variant_id ||
    null;

  const customerEmail =
    attrs?.user_email ||
    attrs?.customer_email ||
    attrs?.email ||
    null;

  const orderId = attrs?.order_id || data?.id || null;
  const status  = attrs?.status || null;

  console.log('[webhook] event=', eventName, 'variant=', variantId, 'plan=', detectPlan(variantId),
              'lk=', licenseKey ? '***' + String(licenseKey).slice(-4) : '-');

  // ============================================================
  // CASE 1: ISSUE LICENSE
  // ============================================================
  const ISSUE_EVENTS = new Set([
    'order_created',
    'subscription_created',
    'license_key_created'
  ]);

  if (ISSUE_EVENTS.has(eventName) && licenseKey) {
    try {
      const store = blobsStore('license-keys');
      const plan = detectPlan(variantId);

      let validUntil = attrs?.expires_at || attrs?.renews_at || null;
      if (!validUntil) {
        const d = new Date();
        d.setDate(d.getDate() + 35);
        validUntil = d.toISOString();
      }

      const record = {
        licenseKey,
        plan,
        variantId: String(variantId || ''),
        customerEmail,
        orderId,
        status: status || 'active',
        issuedAt: new Date().toISOString(),
        validUntil,
        source: eventName,
        activations: {}   // ← device tracking bucket (v4)
      };

      await store.setJSON(licenseKey, record);
      console.log('[webhook] ✅ issued license plan=', plan, 'email=', customerEmail);
    } catch (e) {
      console.error('[webhook] issue license failed:', e);
      return { statusCode: 500, body: 'License store error' };
    }
  }

  // ============================================================
  // CASE 1B: PLAN CHANGED (Pro ↔ Max)
  // ============================================================
  if (eventName === 'subscription_updated' && licenseKey) {
    try {
      const store = blobsStore('license-keys');
      const existing = await store.get(licenseKey, { type: 'json' }) || {};
      const newPlan = detectPlan(variantId);
      const oldPlan = existing.plan || 'pro';

      const updated = {
        ...existing,                       // preserves activations {}
        licenseKey,
        plan: newPlan,
        variantId: String(variantId || ''),
        customerEmail: customerEmail || existing.customerEmail,
        status: status || 'active',
        validUntil: attrs?.renews_at || attrs?.expires_at || existing.validUntil,
        activations: existing.activations || {},  // explicit safety
        lastPlanChange: {
          from: oldPlan,
          to: newPlan,
          at: new Date().toISOString()
        },
        source: eventName
      };

      await store.setJSON(licenseKey, updated);

      // Reset quota counters on plan change
      try {
        const quotaStore = blobsStore('quota-counters');
        const keysToDel = [];
        const { blobs } = await quotaStore.list({ prefix: `weekly:lk:${licenseKey}:` });
        for (const b of blobs) keysToDel.push(b.key);
        const m = await quotaStore.list({ prefix: `monthly:lk:${licenseKey}:` });
        for (const b of m.blobs) keysToDel.push(b.key);
        await Promise.all(keysToDel.map(k => quotaStore.delete(k)));
        console.log('[webhook] cleared', keysToDel.length, 'quota keys for plan change');
      } catch (e) {
        console.warn('[webhook] quota reset failed (non-fatal):', e.message);
      }

      console.log('[webhook] 🔄 plan changed', oldPlan, '→', newPlan, 'lk=', licenseKey.slice(-4));
    } catch (e) {
      console.error('[webhook] subscription_updated error:', e);
      return { statusCode: 500, body: 'Update failed' };
    }
  }

  // ============================================================
  // CASE 2: BLACKLIST
  // ============================================================
  const BLACKLIST_EVENTS = new Set([
    'subscription_cancelled',
    'subscription_expired',
    'subscription_payment_failed',
    'order_refunded'
  ]);

  const shouldBlacklist =
    BLACKLIST_EVENTS.has(eventName) ||
    (eventName === 'license_key_updated' &&
      ['disabled', 'expired'].includes(String(status || '').toLowerCase()));

  if (shouldBlacklist && licenseKey) {
    try {
      const store = blobsStore('license-blacklist');
      await store.setJSON(licenseKey, {
        reason: eventName,
        status: status || null,
        at: new Date().toISOString()
      });
      console.log('[webhook] ⛔ blacklisted', licenseKey.slice(-4), 'reason=', eventName);
    } catch (e) {
      console.error('[webhook] blacklist error:', e);
      return { statusCode: 500, body: 'Blob store error' };
    }
  }

  // ============================================================
  // CASE 3: UN-BLACKLIST
  // ============================================================
  if (licenseKey && eventName === 'subscription_resumed') {
    try {
      const store = blobsStore('license-blacklist');
      await store.delete(licenseKey);
      console.log('[webhook] ♻️  un-blacklisted', licenseKey.slice(-4));
    } catch (e) {
      console.error('[webhook] un-blacklist error:', e);
    }
  }

  return { statusCode: 200, body: 'ok' };
};
