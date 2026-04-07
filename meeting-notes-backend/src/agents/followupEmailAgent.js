const { followupEmailSystemPrompt } = require('../prompts/followupEmailPrompt');

function formatActionItemsForEmail(items) {
  if (!Array.isArray(items) || !items.length) {
    return '- No explicit action items identified.';
  }

  return items.map(function (item, index) {
    const task = item.task || 'TBD';
    const owner = item.owner || 'TBD';
    const dueDate = item.due_date || 'TBD';
    return (index + 1) + '. ' + task + ' | Owner: ' + owner + ' | Due: ' + dueDate;
  }).join('\n');
}

async function runFollowupEmailAgent(payload, summarizerResult, actionItemResult) {
  const subject = payload.meetingTitle
    ? 'Follow-up: ' + payload.meetingTitle
    : 'Meeting Follow-up';

  const emailBody = [
    'Hello team,',
    '',
    'Here is a quick follow-up from the meeting.',
    '',
    'Summary:',
    summarizerResult.summary || 'No summary available.',
    '',
    'Action Items:',
    formatActionItemsForEmail(actionItemResult.action_items),
    '',
    'Best regards'
  ].join('\n');

  return {
    agent: 'followup_email_agent',
    system_prompt_name: followupEmailSystemPrompt.name,
    email_subject: subject,
    email_body: emailBody,
    tone: 'professional'
  };
}

module.exports = {
  runFollowupEmailAgent
};