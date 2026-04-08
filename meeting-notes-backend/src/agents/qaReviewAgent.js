const { qaReviewSystemPrompt } = require('../prompts/qaReviewPrompt');

function getLanguagePack(language) {
  if (language === 'Traditional Chinese') {
    return {
      missingSummary: '缺少摘要。',
      invalidActionItems: '行動項目格式無效。',
      missingEmail: '缺少跟進郵件。'
    };
  }

  if (language === 'Simplified Chinese') {
    return {
      missingSummary: '缺少摘要。',
      invalidActionItems: '行动事项格式无效。',
      missingEmail: '缺少跟进邮件。'
    };
  }

  return {
    missingSummary: 'Missing summary.',
    invalidActionItems: 'Action items format is invalid.',
    missingEmail: 'Missing follow-up email.'
  };
}

async function runQaReviewAgent(payload, artifacts) {
  const language = payload.language || 'English';
  const lang = getLanguagePack(language);

  const issues = [];

  if (!artifacts.summary) {
    issues.push(lang.missingSummary);
  }

  if (!Array.isArray(artifacts.action_items)) {
    issues.push(lang.invalidActionItems);
  }

  if (!artifacts.follow_up_email) {
    issues.push(lang.missingEmail);
  }

  return {
    agent: 'qa_review_agent',
    system_prompt_name: qaReviewSystemPrompt.name,
    review_status: issues.length ? 'fail' : 'pass',
    issues: issues,
    fixed_output: {
      summary: artifacts.summary || '',
      action_items: Array.isArray(artifacts.action_items)
        ? artifacts.action_items
        : [],
      follow_up_email: artifacts.follow_up_email || ''
    }
  };
}

module.exports = {
  runQaReviewAgent
};