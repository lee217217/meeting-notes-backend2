const { runWorkflow } = require('../../src/services/workflowService');

// 在 Netlify 環境變數設 ALLOWED_ORIGINS="https://your-site.netlify.app,https://yourdomain.com"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const MAX_NOTES_LENGTH = 20000;
const MIN_NOTES_LENGTH = 30;

// In-memory rate limit（Netlify cold start 會重置，夠擋正常濫用；要強就接 Upstash Redis）
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 5;
const rateStore = new Map();

function getClientIp(event) {
  const xff = event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'] || '';
  if (xff) return xff.split(',')[0].trim();
  return event.headers['client-ip'] || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const arr = (rateStore.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) {
    return { ok: false, retryAfter: Math.ceil((RATE_WINDOW_MS - (now - arr[0])) / 1000) };
  }
  arr.push(now);
  rateStore.set(ip, arr);
  return { ok: true };
}

function buildCorsHeaders(origin) {
  const allow =
    ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)
      ? origin || '*'
      : ALLOWED_ORIGINS[0] || '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  };
}

function parseRequestBody(body) {
  if (!body) return {};
  if (typeof body === 'string') return JSON.parse(body);
  return body;
}

exports.handler = async function (event) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const CORS_HEADERS = buildCorsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ ok: true }) };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Method not allowed. Use POST.' })
    };
  }

  const ip = getClientIp(event);
  const rate = checkRateLimit(ip);
  if (!rate.ok) {
    return {
      statusCode: 429,
      headers: { ...CORS_HEADERS, 'Retry-After': String(rate.retryAfter) },
      body: JSON.stringify({
        success: false,
        error: `Too many requests. Please wait ${rate.retryAfter}s and try again.`
      })
    };
  }

  try {
    const body = parseRequestBody(event.body);

    const payload = {
      meetingTitle: typeof body.meetingTitle === 'string' ? body.meetingTitle.trim() : '',
      meetingType: typeof body.meetingType === 'string' ? body.meetingType.trim() : 'General',
      language: typeof body.language === 'string' ? body.language.trim() : 'English',
      notes: typeof body.notes === 'string' ? body.notes.trim() : '',
      outputMode:
        typeof body.outputMode === 'string'
          ? body.outputMode.trim()
          : typeof body.mode === 'string'
            ? body.mode.trim()
            : 'full_meeting_pack',
      userQuery: typeof body.userQuery === 'string' ? body.userQuery.trim() : ''
    };

    if (!payload.notes) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: false, error: 'Missing required field: notes' })
      };
    }

    if (payload.notes.length < MIN_NOTES_LENGTH) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: `Notes too short (min ${MIN_NOTES_LENGTH} characters).`
        })
      };
    }

    if (payload.notes.length > MAX_NOTES_LENGTH) {
      return {
        statusCode: 413,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: `Notes too long (max ${MAX_NOTES_LENGTH} characters).`
        })
      };
    }

    const result = await runWorkflow(payload);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        ok: true,
        status: result.status,
        artifacts: result.artifacts,
        review: result.review,
        trace: result.trace
      })
    };
  } catch (error) {
    console.error('multi-agent-run error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Internal server error'
      })
    };
  }
};