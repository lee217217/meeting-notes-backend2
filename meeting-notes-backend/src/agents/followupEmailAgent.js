const { followupEmailSystemPrompt } = require('../prompts/followupEmailPrompt');
const { callLlm } = require('../services/llmClient');
const { parseModelJson } = require('../utils/parseModelJson');

async function runFollowupEmailAgent(payload, summarizerResult, actionItemResult) {
  const language = payload.language || 'English';

  const messages = [
    {
      role: 'system',
      content: [
        followupEmailSystemPrompt.content,
        'Respond entirely in ' + language + '.',
        'Return only valid JSON.',
        'Do not wrap JSON in markdown code fences.',
        'Write a concise, professional meeting follow-up email.',
        'Output format:',
        '{',
        '  "email_subject": "string",',
        '  "email_body": "string",',
        '  "tone": "professional"',
        '}'
      ].join(' ')
    },
    {
      role: 'user',
      content: [
        'Meeting title: ' + (payload.meetingTitle || ''),
        'Meeting type: ' + (payload.meetingType || ''),
        'Language: ' + language,
        '',
        'Summary:',
        summarizerResult.summary || '',
        '',
        'Action items JSON:',
        JSON.stringify(actionItemResult.action_items || [], null, 2)
      ].join('\n')
    }
  ];

  const response = await callLlm(messages, {
    model: 'sonar',
    temperature: 0.3
  });

  const parsed = parseModelJson(response.text);

  return {
    agent: 'followup_email_agent',
    system_prompt_name: followupEmailSystemPrompt.name,
    email_subject: typeof parsed.email_subject === 'string' ? parsed.email_subject : '',
    email_body: typeof parsed.email_body === 'string' ? parsed.email_body : '',
    tone: typeof parsed.tone === 'string' ? parsed.tone : 'professional'
  };
}

module.exports = {
  runFollowupEmailAgent
};