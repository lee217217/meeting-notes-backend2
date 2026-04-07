const { qaReviewSystemPrompt } = require('../prompts/qaReviewPrompt');

async function runQaReviewAgent(payload, artifacts) {
  const issues = [];

  if (!artifacts.summary) {
    issues.push('Missing summary.');
  }

  if (!Array.isArray(artifacts.action_items)) {
    issues.push('Action items format is invalid.');
  }

  if (!artifacts.follow_up_email) {
    issues.push('Missing follow-up email.');
  }

  return {
    agent: 'qa_review_agent',
    system_prompt_name: qaReviewSystemPrompt.name,
    review_status: issues.length ? 'fail' : 'pass',
    issues: issues,
    fixed_output: {
      summary: artifacts.summary || '',
      action_items: Array.isArray(artifacts.action_items) ? artifacts.action_items : [],
      follow_up_email: artifacts.follow_up_email || ''
    }
  };
}

module.exports = {
  runQaReviewAgent
};