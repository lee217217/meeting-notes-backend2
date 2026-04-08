const { actionItemSystemPrompt } = require('../prompts/actionItemPrompt');
const { callLlm } = require('../services/llmClient');
const { parseModelJson } = require('../utils/parseModelJson');

async function runActionItemAgent(payload, summarizerResult) {
  const language = payload.language || 'English';

  const messages = [
    {
      role: 'system',
      content: [
        actionItemSystemPrompt.content,
        'Respond entirely in ' + language + '.',
        'Return only valid JSON.',
        'Do not wrap JSON in markdown code fences.',
        'Do not invent facts when information is missing.',
        'If owner or due date is unknown, use an empty string.',
        'Priority must be one of: High, Medium, Low.',
        'Output format:',
        '{',
        '  "action_items": [',
        '    {',
        '      "task": "string",',
        '      "owner": "string",',
        '      "due_date": "string",',
        '      "priority": "High|Medium|Low",',
        '      "source_evidence": "string"',
        '    }',
        '  ]',
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
        'Meeting summary:',
        summarizerResult.summary || '',
        '',
        'Meeting notes:',
        payload.notes || ''
      ].join('\n')
    }
  ];

  const response = await callLlm(messages, {
    model: 'sonar',
    temperature: 0.1
  });

  const parsed = parseModelJson(response.text);

  const actionItems = Array.isArray(parsed.action_items)
    ? parsed.action_items.map(function (item) {
        return {
          task: typeof item.task === 'string' ? item.task : '',
          owner: typeof item.owner === 'string' ? item.owner : '',
          due_date: typeof item.due_date === 'string' ? item.due_date : '',
          priority:
            item.priority === 'High' || item.priority === 'Low'
              ? item.priority
              : 'Medium',
          source_evidence:
            typeof item.source_evidence === 'string' ? item.source_evidence : ''
        };
      })
    : [];

  return {
    agent: 'action_item_agent',
    system_prompt_name: actionItemSystemPrompt.name,
    action_items: actionItems
  };
}

module.exports = {
  runActionItemAgent
};