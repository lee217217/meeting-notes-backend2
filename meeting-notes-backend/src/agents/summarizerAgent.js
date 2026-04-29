const { summarizerSystemPrompt } = require('../prompts/summarizerPrompt');
const { callLlm } = require('../services/llmClient');
const parseModelJsonModule = require('../utils/parseModelJson');

const parseModelJson = parseModelJsonModule.parseModelJson;

const MAX_ATTEMPTS = 3;

function buildMessages(payload) {
  const language = payload.language || 'English';

  return [
    {
      role: 'system',
      content: [
        summarizerSystemPrompt.content,
        '',
        'Respond entirely in ' + language + '.',
        'Return ONLY valid JSON. Do not wrap in markdown code fences.'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        'Meeting title: ' + (payload.meetingTitle || ''),
        'Meeting type: ' + (payload.meetingType || ''),
        'Language: ' + language,
        '',
        'Meeting notes:',
        payload.notes || ''
      ].join('\n')
    }
  ];
}

function buildRetryMessages(payload, previousError, previousRaw) {
  const base = buildMessages(payload);
  base.push({
    role: 'user',
    content: [
      'Your previous response could not be parsed as valid JSON.',
      'Parse error: ' + (previousError || 'unknown'),
      '',
      'Previous output preview (first 300 chars):',
      (previousRaw || '').slice(0, 300),
      '',
      'Please try again.',
      'Return ONLY a valid JSON object with the four required fields.',
      'Do not use markdown code fences. Do not include any text before or after the JSON.',
      'Keep "summary" under 400 characters. Escape or avoid any double quotes inside string values.'
    ].join('\n')
  });
  return base;
}

function isUsefulSummary(data) {
  return (
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    typeof data.summary === 'string' &&
    data.summary.trim().length > 0
  );
}

function normalizeResult(data) {
  return {
    summary: typeof data.summary === 'string' ? data.summary.trim() : '',
    key_points: Array.isArray(data.key_points) ? data.key_points : [],
    decisions: Array.isArray(data.decisions) ? data.decisions : [],
    risks_or_open_questions: Array.isArray(data.risks_or_open_questions)
      ? data.risks_or_open_questions
      : []
  };
}

async function runSummarizerAgent(payload) {
  let lastRaw = '';
  let lastError = '';
  let attempts = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    attempts = attempt + 1;

    const messages =
      attempt === 0
        ? buildMessages(payload)
        : buildRetryMessages(payload, lastError, lastRaw);

    // 第一次 0.2，後續降溫以追求穩定 JSON
    const temperature = attempt === 0 ? 0.2 : 0.1;

    let response;
    try {
      response = await callLlm(messages, {
        model: 'sonar',
        temperature: temperature
      });
    } catch (err) {
      lastError = err && err.message ? err.message : 'LLM call failed';
      continue;
    }

    lastRaw = response && response.text ? response.text : '';
    const parsed = parseModelJson(lastRaw);

    if (parsed.ok && isUsefulSummary(parsed.data)) {
      const normalized = normalizeResult(parsed.data);
      return {
        agent: 'meeting_summarizer',
        system_prompt_name: summarizerSystemPrompt.name,
        summary: normalized.summary,
        key_points: normalized.key_points,
        decisions: normalized.decisions,
        risks_or_open_questions: normalized.risks_or_open_questions,
        _meta: {
          parse_ok: true,
          attempts: attempts,
          raw_preview: lastRaw.slice(0, 200)
        }
      };
    }

    // 即使 parse 成功但 summary 是空，也當作失敗，進下一輪
    lastError = parsed.ok
      ? 'empty or invalid summary field'
      : parsed.error || 'parse failed';
  }

  // 三次都失敗：做最後防線，仍嘗試回傳局部資料（至少 decisions / key_points 有就顯示）
  const finalParsed = parseModelJson(lastRaw);
  const fallback =
    finalParsed.ok && finalParsed.data && typeof finalParsed.data === 'object'
      ? normalizeResult(finalParsed.data)
      : { summary: '', key_points: [], decisions: [], risks_or_open_questions: [] };

  return {
    agent: 'meeting_summarizer',
    system_prompt_name: summarizerSystemPrompt.name,
    summary: fallback.summary,
    key_points: fallback.key_points,
    decisions: fallback.decisions,
    risks_or_open_questions: fallback.risks_or_open_questions,
    _meta: {
      parse_ok: false,
      attempts: attempts,
      parse_error: lastError,
      raw_preview: (lastRaw || '').slice(0, 200)
    }
  };
}

module.exports = {
  runSummarizerAgent
};