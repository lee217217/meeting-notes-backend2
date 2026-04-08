const { summarizerSystemPrompt } = require('../prompts/summarizerPrompt');

function getLanguagePack(language) {
  if (language === 'Traditional Chinese') {
    return {
      noNotes: '未提供足夠的會議記錄。',
      keyPoints: [
        'Phase 1 模擬重點：整理本次會議的主要討論內容。',
        'Phase 1 模擬重點：保持輸出結構清晰，方便後續代理處理。'
      ],
      decisions: [
        'Phase 1 採用 coordinator 加 specialists 的工作流程。'
      ],
      risks: [
        '目前 bootstrap 版本仍使用佔位式摘要邏輯。'
      ]
    };
  }

  if (language === 'Simplified Chinese') {
    return {
      noNotes: '未提供足够的会议记录。',
      keyPoints: [
        'Phase 1 模拟重点：整理本次会议的主要讨论内容。',
        'Phase 1 模拟重点：保持输出结构清晰，方便后续代理处理。'
      ],
      decisions: [
        'Phase 1 采用 coordinator 加 specialists 的工作流程。'
      ],
      risks: [
        '当前 bootstrap 版本仍使用占位式摘要逻辑。'
      ]
    };
  }

  return {
    noNotes: 'No sufficient meeting notes were provided.',
    keyPoints: [
      'Phase 1 mock key point: summarize the main meeting discussion.',
      'Phase 1 mock key point: keep output structured for downstream agents.'
    ],
    decisions: [
      'Phase 1 uses a coordinator-plus-specialists workflow.'
    ],
    risks: [
      'This bootstrap version still uses placeholder summarization logic.'
    ]
  };
}

async function runSummarizerAgent(payload) {
  const language = payload.language || 'English';
  const lang = getLanguagePack(language);

  const notes = payload.notes || '';
  const lines = notes
    .split('\n')
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean);

  const summaryText =
    lines.slice(0, 2).join(' ') || lang.noNotes;

  return {
    agent: 'meeting_summarizer',
    system_prompt_name: summarizerSystemPrompt.name,
    summary: summaryText,
    key_points: lang.keyPoints,
    decisions: lang.decisions,
    risks_or_open_questions: lang.risks
  };
}

module.exports = {
  runSummarizerAgent
};