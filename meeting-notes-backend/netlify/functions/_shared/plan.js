// netlify/functions/_shared/plan.js
// Resolve user plan based on licenseKey / email

const PRO_PRODUCT  = 'Meeting Workspace Pro';
const MAX_PRODUCT  = 'Meeting Workspace Max';

const PLAN_LIMITS = {
  anon:    { period: 'daily',   limit: 1  },
  email:   { period: 'daily',   limit: 3  },
  pro:     { period: 'weekly',  limit: 10 },
  max:     { period: 'monthly', limit: 60 },
};

// Call LS validate endpoint directly (same as verify-license.js)
async function validateLicense(licenseKey) {
  try {
    const res = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ license_key: licenseKey })
    });
    const data = await res.json();
    if (!data || data.valid !== true) return { valid: false, reason: (data && data.error) || 'invalid' };

    const status = data.license_key && data.license_key.status;
    if (status && status !== 'active' && status !== 'inactive') {
      return { valid: false, reason: 'license_' + status };
    }

    const productName = (data.meta && data.meta.product_name) || '';
    let plan = null;
    if (productName === PRO_PRODUCT) plan = 'pro';
    else if (productName === MAX_PRODUCT) plan = 'max';

    const expiresAt = data.license_key && data.license_key.expires_at;
    const validUntil = expiresAt
      ? new Date(expiresAt).toISOString()
      : new Date(Date.now() + 32 * 24 * 60 * 60 * 1000).toISOString();

    return {
      valid: true,
      plan,
      productName,
      validUntil,
      customerEmail: (data.meta && data.meta.customer_email) || null
    };
  } catch (e) {
    console.error('[plan] license validate error', e);
    return { valid: false, reason: 'validate_error' };
  }
}

// Check email is registered in email-list blobs
async function isEmailRegistered(getStoreFn, email) {
  if (!email) return false;
  try {
    const store = getStoreFn({
  name: 'email-list',
  siteID: process.env.NETLIFY_SITE_ID,
  token: process.env.NETLIFY_BLOBS_TOKEN
});
    const rec = await store.get(`email:${email.toLowerCase()}`, { type: 'json' });
    return !!rec;
  } catch (e) {
    console.warn('[plan] email lookup failed', e.message);
    return false;
  }
}

/**
 * Resolve the user's effective plan.
 * Priority: licenseKey (pro/max) > email (starter) > fingerprint/ip (anon)
 */
async function resolvePlan({ licenseKey, email, getStoreFn }) {
  if (licenseKey) {
    const lic = await validateLicense(licenseKey);
    if (lic.valid && lic.plan) {
      return { plan: lic.plan, license: lic };
    }
    // license invalid — fall through to email/anon
    console.warn('[plan] licenseKey invalid, fallback. reason=', lic.reason);
  }
  if (email && await isEmailRegistered(getStoreFn, email)) {
    return { plan: 'email', license: null };
  }
  return { plan: 'anon', license: null };
}

module.exports = { resolvePlan, validateLicense, PLAN_LIMITS, PRO_PRODUCT, MAX_PRODUCT };
