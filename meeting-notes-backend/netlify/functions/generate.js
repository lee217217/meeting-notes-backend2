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

function buildMarkdown(payload, artifacts) {
  const meetingTitle = payload.meetingTitle || 'Meeting Notes';
  const summary = artifacts.summary || '';
  const keyPoints = Array.isArray(artifacts.key_points) ? artifacts.key_points : [];
  const decisions = Array.isArray(artifacts.decisions) ? artifacts.decisions : [];
  const risks = Array.isArray(artifacts.risks_or_open_questions)
    ? artifacts.risks_or_open_questions
    : [];
  const actionItems = Array.isArray(artifacts.action_items)
    ? artifacts.action_items
    : [];
  const followUpEmail = artifacts.follow_up_email || '';

  const actionLines = actionItems.length
    ? actionItems.map(function (item, index) {
        return [
          (index + 1) + '. ' + (item.task || ''),
          '   - Owner: ' + (item.owner || ''),
          '   - Due: ' + (item.due_date || ''),
          '   - Priority: ' + (item.priority || 'Medium')
        ].join('\n');
      }).join('\n')
    : '- None';

  return [
    '# ' + meetingTitle,
    '',
    '## Summary',
    summary || 'None',
    '',
    '## Key points',
    keyPoints.length ? keyPoints.map(function (item) { return '- ' + item; }).join('\n') : '- None',
    '',
    '## Decisions',
    decisions.length ? decisions.map(function (item) { return '- ' + item; }).join('\n') : '- None',
    '',
    '## Open questions / risks',
    risks.length ? risks.map(function (item) { return '- ' + item; }).join('\n') : '- None',
    '',
    '## Action items',
    actionLines,
    '',
    '## Follow-up email',
    followUpEmail || 'None'
  ].join('\n');
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
      outputMode: 'full_meeting_pack',
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

    const workflowResult = await runWorkflow(payload);
    const artifacts = workflowResult.artifacts || {};

    const markdown = buildMarkdown(payload, artifacts);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,

        summary: artifacts.summary || '',
        key_points: Array.isArray(artifacts.key_points) ? artifacts.key_points : [],
        decisions: Array.isArray(artifacts.decisions) ? artifacts.decisions : [],
        risks_or_open_questions: Array.isArray(artifacts.risks_or_open_questions)
          ? artifacts.risks_or_open_questions
          : [],
        action_items: Array.isArray(artifacts.action_items)
          ? artifacts.action_items
          : [],
        follow_up_email: artifacts.follow_up_email || '',
        follow_up_email_subject: artifacts.follow_up_email_subject || '',
        markdown: markdown,

        artifacts: {
          summary: artifacts.summary || '',
          key_points: Array.isArray(artifacts.key_points) ? artifacts.key_points : [],
          decisions: Array.isArray(artifacts.decisions) ? artifacts.decisions : [],
          risks_or_open_questions: Array.isArray(artifacts.risks_or_open_questions)
            ? artifacts.risks_or_open_questions
            : [],
          action_items: Array.isArray(artifacts.action_items)
            ? artifacts.action_items
            : [],
          follow_up_email: artifacts.follow_up_email || '',
          follow_up_email_subject: artifacts.follow_up_email_subject || '',
          follow_up_email_tone: artifacts.follow_up_email_tone || 'professional'
        },

        workflow: {
          task_id: workflowResult.task_id || '',
          status: workflowResult.status || 'completed',
          started_at: workflowResult.started_at || '',
          completed_at: workflowResult.completed_at || ''
        }
      })
    };
  } catch (error) {
    console.error('generate error:', error);

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