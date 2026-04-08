const { followupEmailSystemPrompt } = require('../prompts/followupEmailPrompt');

function getLanguagePack(language) {
  if (language === 'Traditional Chinese') {
    return {
      noActionItems: '- 暫未識別到明確行動項目。',
      ownerLabel: '負責人',
      dueLabel: '截止時間',
      subjectPrefix: '會議跟進：',
      defaultSubject: '會議跟進',
      greeting: '各位好：',
      intro: '以下是本次會議的重點整理。',
      summaryLabel: '摘要：',
      noSummary: '暫無摘要。',
      actionItemsLabel: '行動項目：',
      closing: '謝謝。'
    };
  }

  if (language === 'Simplified Chinese') {
    return {
      noActionItems: '- 暂未识别到明确行动事项。',
      ownerLabel: '负责人',
      dueLabel: '截止时间',
      subjectPrefix: '会议跟进：',
      defaultSubject: '会议跟进',
      greeting: '各位好：',
      intro: '以下是本次会议的重点整理。',
      summaryLabel: '摘要：',
      noSummary: '暂无摘要。',
      actionItemsLabel: '行动事项：',
      closing: '谢谢。'
    };
  }

  return {
    noActionItems: '- No explicit action items identified.',
    ownerLabel: 'Owner',
    dueLabel: 'Due',
    subjectPrefix: 'Follow-up: ',
    defaultSubject: 'Meeting Follow-up',
    greeting: 'Hello team,',
    intro: 'Here is a quick follow-up from the meeting.',
    summaryLabel: 'Summary:',
    noSummary: 'No summary available.',
    actionItemsLabel: 'Action Items:',
    closing: 'Best regards'
  };
}

function formatActionItemsForEmail(items, languagePack) {
  if (!Array.isArray(items) || !items.length) {
    return languagePack.noActionItems;
  }

  return items.map(function (item, index) {
    const task = item.task || 'TBD';
    const owner = item.owner || 'TBD';
    const dueDate = item.due_date || 'TBD';

    return (
      (index + 1) +
      '. ' +
      task +
      ' | ' +
      languagePack.ownerLabel +
      ': ' +
      owner +
      ' | ' +
      languagePack.dueLabel +
      ': ' +
      dueDate
    );
  }).join('\n');
}

async function runFollowupEmailAgent(payload, summarizerResult, actionItemResult) {
  const language = payload.language || 'English';
  const lang = getLanguagePack(language);

  const subject = payload.meetingTitle
    ? lang.subjectPrefix + payload.meetingTitle
    : lang.defaultSubject;

  const emailBody = [
    lang.greeting,
    '',
    lang.intro,
    '',
    lang.summaryLabel,
    summarizerResult.summary || lang.noSummary,
    '',
    lang.actionItemsLabel,
    formatActionItemsForEmail(actionItemResult.action_items, lang),
    '',
    lang.closing
  ].join('\n');

  return {
    agent: 'followup_email_agent',
    system_prompt_name: followupEmailSystemPrompt.name,
    email_subject: subject,
    email_body: emailBody,
    tone: 'professional'
  };
}

module.exports = {
  runFollowupEmailAgent
};