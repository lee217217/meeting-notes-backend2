const { runMultiAgentWorkflow } = require('../../src/services/workflowService');

const RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify(payload)
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: RESPONSE_HEADERS,
      body: ''
    };
  }

  if (event.httpMethod === 'GET') {
    return jsonResponse(200, {
      success: true,
      message: 'multi-agent-run endpoint is alive',
      route: '/.netlify/functions/multi-agent-run',
      version: 'phase1-bootstrap'
    });
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, {
      success: false,
      error: 'Method not allowed. Use POST.'
    });
  }

  try {
    let body = {};

    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (parseError) {
      return jsonResponse(400, {
        success: false,
        error: 'Invalid JSON body.',
        details: parseError.message
      });
    }

    const payload = {
      mee);
    }

    const payload = {
      meetingTitle: typeof body.meetingTitle === 'string' ? body.mee typeof body.meetingType === 'string' ? body.meetingType.trim() : 'General',
      language: typeof body.language === 'string' ? body.language.trim() : 'English',
      notes: typeof body.notes === 'string' ? body.notes.trim() : '',
      mode: typeof body.mode === 'string' ? body.mode.trim() : 'auto_workflow',
      userQuery: typeof body.userQuery === 'string' ? body.userQuery.trim() : ''
    };

    if (!payload.notes) {
      return jsonResponse(400, {
        success: false,
        error: 'Missing required field: notes'
      });
    }

    const workflowResult = await runMultiAgentWorkflow(payload);

    return jsonResponse(200, {
      success: true,
      data: workflowResult
    });
  } catch (error) {
    console.error('multi-agent-run error:', error);

    return jsonResponse(500, {
      success: false,
      error: 'Internal server error.',
      details: error.message || 'Unknown error'
    });
  }
};