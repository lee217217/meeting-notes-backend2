const { actionItemSystemPrompt } = require('../prompts/actionItemPrompt');

function getLanguagePack(language) {
  if (language === 'Traditional Chinese') {
    return {
      defaultTask: '檢查會議摘要並確認下一步實施安排',
      fallbackOwner: '待定',
      fallbackDueDate: '待定'
    };
  }

  if (language === 'Simplified Chinese') {
    return {
      defaultTask: '检查会议摘要并确认下一步实施安排',
      fallbackOwner: '待定',
      fallbackDueDate: '待定'
    };
  }

  return {
    defaultTask: 'Review meeting summary and confirm next implementation step',
    fallbackOwner: 'TBD',
    fallbackDueDate: 'TBD'
  };
}

async function runActionItemAgent(payload, summarizerResult) {
  const language = payload.language || 'English';
  const lang = getLanguagePack(language);

  return {
    agent: 'action_item_agent',
    system_prompt_name: actionItemSystemPrompt.name,
    action_items: [
      {
        task: lang.defaultTask,
        owner: lang.fallbackOwner,
        due_date: lang.fallbackDueDate,
        priority: 'High',
        source_evidence:
          summarizerResult.summary || (payload.notes || '').slice(0, 120)
      }
    ]
  };
}

module.exports = {
  runActionItemAgent
};