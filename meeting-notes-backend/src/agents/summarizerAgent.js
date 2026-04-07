const { summarizerSystemPrompt } = require('../prompts/summarizerPrompt');

async function runSummarizerAgent(payload) {
  const notes = payload.notes || '';
  const lines = notes
    .split('\n')
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean);

  const summaryText =
    lines.slice(0, 2).join(' ') || 'No sufficient meeting notes were provided.';

  return {
    agent: 'meeting_summarizer',
    system_prompt_name: summarizerSystemPrompt.name,
    summary: summaryText,
    key_points: [
      'Phase 1 mock key point: summarize the main meeting discussion.',
      'Phase 1 mock key point: keep output structured for downstream agents.'
    ],
    decisions: [
      'Phase 1 uses a coordinator-plus-specialists workflow.'
    ],
    risks_or_open_questions: [
      'This bootstrap version still uses placeholder summarization logic.'
    ]
  };
}

module.exports = {
  runSummarizerAgent
};