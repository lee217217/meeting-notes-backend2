const { actionItemSystemPrompt } = require('../prompts/actionItemPrompt');

async function runActionItemAgent(payload, summarizerResult) {
  return {
    agent: 'action_item_agent',
    system_prompt_name: actionItemSystemPrompt.name,
    action_items: [
      {
        task: 'Review meeting summary and confirm next implementation step',
        owner: 'TBD',
        due_date: 'TBD',
        priority: 'High',
        source_evidence: summarizerResult.summary || (payload.notes || '').slice(0, 120)
      }
    ]
  };
}

module.exports = {
  runActionItemAgent
};