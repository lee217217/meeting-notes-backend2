const { coordinatorSystemPrompt } = require('../prompts/coordinatorPrompt');

async function runCoordinatorAgent(payload, context) {
  const requestedMode =
    payload.outputMode && typeof payload.outputMode === 'string'
      ? payload.outputMode
      : 'full_meeting_pack';

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
    reason:
      'Phase 1 default workflow: run summarizer, action extraction, email draft, then QA review.',
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