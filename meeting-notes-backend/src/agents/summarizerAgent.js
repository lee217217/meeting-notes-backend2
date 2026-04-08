const { summarizerSystemPrompt } = require('../prompts/summarizerPrompt');
const { callLlm } = require('../services/llmClient');
const { parseModelJson } = require('../utils/parseModelJson');

async function runSummarizerAgent(payload) {
  const language = payload.language || 'English';

  const messages = [
    {
      role: 'system',
      content: [
        summarizerSystemPrompt.content,
        'Respond entirely in ' + language + '.',
        'Return only valid JSON.',
        'Do not wrap JSON in markdown code fences.',
        'Output format:',
        '{',
        '  "summary": "string",',
        '  "key_points": ["string"],',
        '  "decisions": ["string"],',
        '  "risks_or_open_questions": ["string"]',
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
        'Meeting notes:',
        payload.notes || ''
      ].join('\n')
    }
  ];

  const response = await callLlm(messages, {
    model: 'sonar',
    temperature: 0.2
  });

  const parsed = parseModelJson(response.text);

  return {
    agent: 'meeting_summarizer',
    system_prompt_name: summarizerSystemPrompt.name,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    key_points: Array.isArray(parsed.key_points) ? parsed.key_points : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
    risks_or_open_questions: Array.isArray(parsed.risks_or_open_questions)
      ? parsed.risks_or_open_questions
      : []
  };
}

module.exports = {
  runSummarizerAgent
};