const { runWorkflow } = require('../../src/services/workflowService');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function parseRequestBody(body) {
  if (!body) {
    return {};
  }

  if (typeof body === 'string') {
    return JSON.parse(body);
  }

  return body;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ ok: true })
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed. Use POST.'
      })
    };
  }

  try {
    const body = parseRequestBody(event.body);

    const payload = {
      meetingTitle:
        typeof body.meetingTitle === 'string' ? body.meetingTitle.trim() : '',
      meetingType:
        typeof body.meetingType === 'string' ? body.meetingType.trim() : 'General',
      language:
        typeof body.language === 'string' ? body.language.trim() : 'English',
      notes:
        typeof body.notes === 'string' ? body.notes.trim() : '',
      outputMode:
        typeof body.outputMode === 'string'
          ? body.outputMode.trim()
          : typeof body.mode === 'string'
            ? body.mode.trim()
            : 'full_meeting_pack',
      userQuery:
        typeof body.userQuery === 'string' ? body.userQuery.trim() : ''
    };

    if (!payload.notes) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: 'Missing required field: notes'
        })
      };
    }

    const result = await runWorkflow(payload);

return {
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json'
  },
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