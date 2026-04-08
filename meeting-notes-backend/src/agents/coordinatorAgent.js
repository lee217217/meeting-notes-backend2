const { coordinatorSystemPrompt } = require('../prompts/coordinatorPrompt');

function getLanguageReason(language) {
  if (language === 'Traditional Chinese') {
    return 'Phase 1 預設流程：先執行摘要、再抽取行動項目、產生跟進郵件，最後進行 QA 檢查。';
  }

  if (language === 'Simplified Chinese') {
    return 'Phase 1 默认流程：先执行摘要、再提取行动事项、生成跟进邮件，最后进行 QA 检查。';
  }

  return 'Phase 1 default workflow: run summarizer, action extraction, email draft, then QA review.';
}

async function runCoordinatorAgent(payload, context) {
  const requestedMode =
    payload.outputMode && typeof payload.outputMode === 'string'
      ? payload.outputMode
      : 'full_meeting_pack';

  const language = payload.language || 'English';

  return {
    agent: 'coordinator',
    system_prompt_name: coordinatorSystemPrompt.name,
    task_type: requestedMode,
    selected_agents: [
      'meeting_summarizer',
      'action_item_agent',
      'followup_email_agent',
      'qa_review_agent'
    ],
    reason: getLanguageReason(language),
    requires_human_confirmation: false,
    input_snapshot: {
      meetingTitle: payload.meetingTitle,
      meetingType: payload.meetingType,
      language: payload.language
    },
    context_snapshot: context
  };
}

module.exports = {
  runCoordinatorAgent
};