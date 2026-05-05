// netlify/functions/multi-agent-run.js  (v3, CJS, server-side quota)
const { runWorkflow } = require('../../src/services/workflowService');
const { buildCorsHeaders, getOrigin, getClientIp, jsonResponse } = require('./_shared/cors');
const { resolvePlan, PLAN_LIMITS } = require('./_shared/plan');
const { checkQuota, incrementQuota } = require('./_shared/quota');
const { getStore } = require('@netlify/blobs');

const MAX_NOTES = 20000;
const MIN_NOTES = 30;

// Burst rate limit (per minute) — stops hammering; in-memory
const RATE_WINDOW = 60 * 1000;
const RATE_MAX = 5;
const rateStore = new Map();
function burstOk(ip) {
  const now = Date.now();
  const arr = (rateStore.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  if (arr.length >= RATE_MAX) return { ok: false, retry: Math.ceil((RATE_WINDOW - (now - arr[0])) / 1000) };
  arr.push(now); rateStore.set(ip, arr);
  return { ok: true };
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') return JSON.parse(body);
  return body;
}

exports.handler = async function (event) {
  const origin = getOrigin(event);
  const CORS = buildCorsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '{}' };
  if (event.httpMethod !== 'POST')    return jsonResponse(405, { success: false, error: 'POST only' }, CORS);

  const ip = getClientIp(event);

  // Burst limit
  const b = burstOk(ip);
  if (!b.ok) {
    return jsonResponse(429, {
      success: false, error: `Too many requests. Retry in ${b.retry}s.`
    }, { ...CORS, 'Retry-After': String(b.retry) });
  }

  try {
    const body = parseBody(event.body);

    // --- Original payload ---
    const payload = {
      meetingTitle: String(body.meetingTitle || '').trim(),
      meetingType:  String(body.meetingType  || 'General').trim(),
      language:     String(body.language     || 'English').trim(),
      notes:        String(body.notes        || '').trim(),
      outputMode:   String(body.outputMode   || body.mode || 'full_meeting_pack').trim(),
      userQuery:    String(body.userQuery    || '').trim(),
    };

    if (!payload.notes)                  return jsonResponse(400, { success: false, error: 'Missing notes' }, CORS);
    if (payload.notes.length < MIN_NOTES) return jsonResponse(400, { success: false, error: `Notes too short (min ${MIN_NOTES})` }, CORS);
    if (payload.notes.length > MAX_NOTES) return jsonResponse(413, { success: false, error: `Notes too long (max ${MAX_NOTES})` }, CORS);

    // --- NEW: Identity fields ---
    const fp         = String(body.fp         || '').slice(0, 64);
    const email      = String(body.email      || '').toLowerCase().slice(0, 120);
    const licenseKey = String(body.licenseKey || '').trim();

    // --- NEW: Resolve plan (pro/max/email/anon) ---
    const { plan, license } = await resolvePlan({ licenseKey, email, getStoreFn: getStore });
    console.log('[quota] plan=', plan, 'fp=', fp.slice(0, 8), 'ip=', ip, 'email=', email ? '***' : '-');

    // --- NEW: Pre-check quota ---
    const gate = await checkQuota({ plan, fp, ip, email, licenseKey });
    if (!gate.ok) {
      console.log('[quota] DENY plan=', plan, 'used=', gate.used, '/', gate.limit, 'period=', gate.period);
      return jsonResponse(429, {
        success: false,
        error: 'quota_exceeded',
        quota: {
          plan, period: gate.period,
          used: gate.used, limit: gate.limit,
          resetAt: gate.resetAt, reason: gate.reason
        }
      }, CORS);
    }

    // --- Run workflow (existing) ---
    const result = await runWorkflow(payload);

    // --- NEW: Post-increment ---
    try {
      await incrementQuota({ plan, fp, ip, email, licenseKey });
    } catch (e) {
      console.warn('[quota] increment failed (non-fatal)', e.message);
    }

    const conf = PLAN_LIMITS[plan];
    return jsonResponse(200, {
      ok: true,
      status: result.status,
      artifacts: result.artifacts,
      review: result.review,
      trace: result.trace,
      quota: {
        plan,
        period: conf.period,
        used: gate.used + 1,
        limit: conf.limit,
        resetAt: gate.resetAt
      }
    }, CORS);
  } catch (err) {
    console.error('[multi-agent-run] error', err);
    return jsonResponse(500, { success: false, error: err.message || 'Internal error' }, CORS);
  }
};
