// Receives Lemon Squeezy webhooks and maintains a license blacklist.
// Events handled: subscription_cancelled, subscription_expired,
//                 order_refunded, license_key_updated (status=disabled|expired)
// Docs: https://docs.lemonsqueezy.com/help/webhooks

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

function timingSafeEqual(a, b) {
  try {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch { return false; }
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

  const signature = event.headers['x-signature'] || event.headers['X-Signature'] || '';
  const raw = event.body || '';
  const computed = crypto.createHmac('sha256', secret).update(raw).digest('hex');

  if (!timingSafeEqual(signature, computed)) {
    console.warn('[webhook] signature mismatch');
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let payload;
  try { payload = JSON.parse(raw); }
  catch { return { statusCode: 400, body: 'Bad JSON' }; }

  const eventName = payload?.meta?.event_name || '';
  const data = payload?.data || {};
  const attrs = data?.attributes || {};

  // Collect any license key we can find in this payload
  const licenseKey =
    attrs?.license_key ||
    attrs?.first_order_item?.license_key ||
    attrs?.meta?.license_key ||
    payload?.meta?.custom_data?.license_key ||
    null;

  const BLACKLIST_EVENTS = new Set([
    'subscription_cancelled',
    'subscription_expired',
    'subscription_payment_failed',
    'order_refunded',
    'license_key_updated'
  ]);

  const shouldBlacklist =
    BLACKLIST_EVENTS.has(eventName) &&
    (eventName !== 'license_key_updated' ||
      ['disabled', 'expired'].includes(String(attrs?.status || '').toLowerCase()));

  try {
    const store = getStore('license-blacklist');

    if (licenseKey && shouldBlacklist) {
      await store.setJSON(licenseKey, {
        reason: eventName,
        status: attrs?.status || null,
        at: new Date().toISOString()
      });
      console.log('[webhook] blacklisted', licenseKey, 'reason=', eventName);
    }

    // Optional: remove from blacklist on reactivation
    if (licenseKey && eventName === 'subscription_resumed') {
      await store.delete(licenseKey);
      console.log('[webhook] un-blacklisted', licenseKey);
    }
  } catch (e) {
    console.error('[webhook] blob error', e);
    return { statusCode: 500, body: 'Blob store error' };
  }

  return { statusCode: 200, body: 'ok' };
};