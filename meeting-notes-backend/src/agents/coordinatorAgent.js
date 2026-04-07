const { coordinatorSystemPrompt } = require('../prompts/coordinatorPrompt');

async function runCoordin);
    }

    const payload = {
      meetingTitle: typeof body.meetingTitle === 'string' ? body.mee   agent: 'coordinator',
    system_prompt_name: coordinatorSystemPrompt.name,
    task_type: requestedMode,
    selected_agents: [
      'meeting_summarizer',
      'action_item_agent',
      'followup_email_agent',
      'qa_review_agent'
    ],
    reason: 'Phase 1 default workflow: run summarizer, action extraction, email draft, then QA review.',
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