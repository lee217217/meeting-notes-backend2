// ============================================================
// lemon-webhook.js  |  v5 (2026-05-08)
// ------------------------------------------------------------
// Handles Lemon Squeezy webhooks:
//  1. order_created / subscription_created / license_key_created
//     → Issue license → license-keys store
//     → Send welcome email via Resend 🆕
//  2. subscription_updated  →  Plan change (Pro ↔ Max) + quota reset
//  3. subscription_cancelled / expired / refunded / key_disabled
//     →  Blacklist license → license-blacklist store
//  4. subscription_resumed  →  Un-blacklist
//
// v5 CHANGES (2026-05-08):
//   + Resend welcome email on license issuance
//   + Cleaned up duplicate writes / logs
//   + Imports & helpers consolidated at top
// ============================================================

const crypto = require('crypto');
const { Resend } = require('resend');
const { getStore } = require('@netlify/blobs');

const resend = new Resend(process.env.RESEND_API_KEY);

const PRO_VARIANT_ID = process.env.LEMON_PRO_VARIANT_ID || '1015806';
const MAX_VARIANT_ID = process.env.LEMON_MAX_VARIANT_ID || '1034942';

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
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

async function sendWelcomeEmail({ to, licenseKey, plan }) {
  const planName = plan === 'max' ? 'Max' : 'Pro';
  const deviceLimit = plan === 'max' ? 5 : 2;
  const quota = plan === 'max' ? '60 runs per month' : '10 runs per week';
  const html = buildWelcomeHtml({ licenseKey, planName, deviceLimit, quota });

  return resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'Meeting Workspace <hello@meetingworkspaces.com>',
    to,
    replyTo: process.env.RESEND_REPLY_TO || 'support@meetingworkspaces.com',
    subject: `🎉 Welcome to Meeting Workspace ${planName}! Your license is ready`,
    html,
  });
}

// ============================================================
// Handler
// ============================================================
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
  // CASE 1: ISSUE LICENSE + SEND WELCOME EMAIL
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
        activations: {}
      };

      await store.setJSON(licenseKey, record);
      console.log('[webhook] ✅ issued license plan=', plan, 'email=', customerEmail);

      // Send welcome email (non-fatal if fails)
      if (customerEmail) {
        try {
          await sendWelcomeEmail({ to: customerEmail, licenseKey, plan });
          console.log('[webhook] 📧 welcome email sent to', customerEmail);
        } catch (e) {
          console.error('[webhook] welcome email failed:', e.message);
        }
      }
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
        ...existing,
        licenseKey,
        plan: newPlan,
        variantId: String(variantId || ''),
        customerEmail: customerEmail || existing.customerEmail,
        status: status || 'active',
        validUntil: attrs?.renews_at || attrs?.expires_at || existing.validUntil,
        activations: existing.activations || {},
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

// ============================================================
// Welcome Email HTML Template
// ============================================================
function buildWelcomeHtml({ licenseKey, planName, deviceLimit, quota }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #0a0a0b; background: #f7f8fa; margin: 0; padding: 20px; }
    .container { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,.08); }
    .header { background: linear-gradient(135deg,#5b5bf5,#8b5bf5); color: #fff; padding: 40px 32px; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; font-weight: 800; }
    .header .plan { display: inline-block; background: rgba(255,255,255,.2); padding: 4px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; margin-top: 8px; }
    .body { padding: 32px; }
    .body h2 { font-size: 18px; margin: 0 0 12px; }
    .body p { color: #4a4a55; font-size: 15px; margin: 0 0 16px; }
    .license-box { background: #f7f8fa; border: 2px dashed #5b5bf5; border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
    .license-label { font-size: 11px; color: #8a8a95; text-transform: uppercase; letter-spacing: .12em; font-weight: 700; margin-bottom: 8px; }
    .license-key { font-family: ui-monospace, Menlo, monospace; font-size: 16px; font-weight: 700; color: #5b5bf5; word-break: break-all; }
    .steps { background: #f7f8fa; border-radius: 12px; padding: 20px 24px; margin: 20px 0; }
    .step { display: flex; gap: 12px; padding: 10px 0; }
    .step-num { width: 28px; height: 28px; background: #5b5bf5; color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; flex-shrink: 0; }
    .step-text { font-size: 14px; color: #4a4a55; padding-top: 3px; }
    .cta { display: block; background: linear-gradient(135deg,#5b5bf5,#8b5bf5); color: #fff; text-decoration: none; text-align: center; padding: 14px 24px; border-radius: 10px; font-weight: 700; margin: 24px 0; }
    .feature-grid { display: table; width: 100%; margin: 20px 0; }
    .feature { display: table-cell; padding: 12px; text-align: center; font-size: 13px; color: #4a4a55; }
    .feature strong { display: block; font-size: 18px; color: #0a0a0b; }
    .footer { padding: 24px 32px; background: #f7f8fa; font-size: 12px; color: #8a8a95; text-align: center; }
    .footer a { color: #5b5bf5; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Welcome to Meeting Workspace</h1>
      <div class="plan">${planName} Plan</div>
    </div>
    <div class="body">
      <h2>Your license is ready!</h2>
      <p>Thanks for upgrading to <strong>${planName}</strong>. You're all set to turn every meeting transcript into summaries, action items, and follow-up emails in 15 seconds.</p>

      <div class="license-box">
        <div class="license-label">🔑 Your License Key</div>
        <div class="license-key">${licenseKey}</div>
      </div>

      <div class="feature-grid">
        <div class="feature"><strong>${quota.split(' ')[0]}</strong>${quota.split(' ').slice(1).join(' ')}</div>
        <div class="feature"><strong>${deviceLimit}</strong>devices</div>
        <div class="feature"><strong>⚡</strong>Priority AI</div>
      </div>

      <h2>Get started in 3 steps</h2>
      <div class="steps">
        <div class="step"><div class="step-num">1</div><div class="step-text">Open <a href="https://meetingworkspaces.com/app/">meetingworkspaces.com/app</a></div></div>
        <div class="step"><div class="step-num">2</div><div class="step-text">Click the ⚙️ icon, paste your license key above</div></div>
        <div class="step"><div class="step-num">3</div><div class="step-text">Paste any meeting transcript — your recap is ready in seconds!</div></div>
      </div>

      <a href="https://meetingworkspaces.com/app/" class="cta">Launch Meeting Workspace →</a>

      <p style="font-size:13px;color:#8a8a95;margin-top:24px;">
        Need help? Just reply to this email — real human here, Hong Kong time zone.<br>
        You can manage your devices anytime from the ⚙️ menu.
      </p>
    </div>
    <div class="footer">
      Meeting Workspace · <a href="https://meetingworkspaces.com">meetingworkspaces.com</a><br>
      <a href="https://meetingworkspaces.com/privacy.html">Privacy</a> · <a href="https://meetingworkspaces.com/terms.html">Terms</a>
    </div>
  </div>
</body>
</html>`;
}