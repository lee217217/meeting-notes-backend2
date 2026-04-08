const { qaReviewSystemPrompt } = require('../prompts/qaReviewPrompt');
const { callLlm } = require('../services/llmClient');
const { parseModelJson } = require('../utils/parseModelJson');

async function runQaReviewAgent(payload, artifacts) {
  const language = payload.language || 'English';

  const messages = [
    {
      role: 'system',
      content: [
        qaReviewSystemPrompt.content,
        'Respond entirely in ' + language + '.',
        'Return only valid JSON.',
        'Do not wrap JSON in markdown code fences.',
        'Review for completeness, consistency, and format issues only.',
        'Do not invent new business facts.',
        'Output format:',
        '{',
        '  "review_status": "pass or fail",',
        '  "issues": ["string"],',
        '  "fixed_output": {',
        '    "summary": "string",',
        '    "action_items": [',
        '      {',
        '        "task": "string",',
        '        "owner": "string",',
        '        "due_date": "string",',
        '        "priority": "High|Medium|Low",',
        '        "source_evidence": "string"',
        '      }',
        '    ],',
        '    "follow_up_email": "string"',
        '  }',
        '}'
      ].join(' ')
    },
    {
      role: 'user',
      content: [
        'Language: ' + language,
        '',
        'Artifacts to review:',
        JSON.stringify(
          {
            summary: artifacts.summary || '',
            action_items: Array.isArray(artifacts.action_items)
              ? artifacts.action_items
              : [],
            follow_up_email: artifacts.follow_up_email || ''
          },
          null,
          2
        )
      ].join('\n')
    }
  ];

  const response = await callLlm(messages, {
    model: 'sonar',
    temperature: 0.1
  });

  const parsed = parseModelJson(response.text);

  return {
    agent: 'qa_review_agent',
    system_prompt_name: qaReviewSystemPrompt.name,
    review_status: parsed.review_status === 'fail' ? 'fail' : 'pass',
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    fixed_output: {
      summary:
        parsed.fixed_output && typeof parsed.fixed_output.summary === 'string'
          ? parsed.fixed_output.summary
          : artifacts.summary || '',
      action_items:
        parsed.fixed_output && Array.isArray(parsed.fixed_output.action_items)
          ? parsed.fixed_output.action_items
          : Array.isArray(artifacts.action_items)
            ? artifacts.action_items
            : [],
      follow_up_email:
        parsed.fixed_output &&
        typeof parsed.fixed_output.follow_up_email === 'string'
          ? parsed.fixed_output.follow_up_email
          : artifacts.follow_up_email || ''
    }
  };
}

module.exports = {
  runQaReviewAgent
};