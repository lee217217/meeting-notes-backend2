function tryParse(text) {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function parseModelJson(text) {
  if (typeof text !== 'string') {
    return { ok: false, error: 'Model output is not a string.' };
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: 'Model output is empty.' };
  }

  // 1. 直接 parse
  const direct = tryParse(trimmed);
  if (direct.ok) {
    return direct;
  }

  // 2. 剝掉 ```json ... ``` 或 ``` ... ```
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    const inner = tryParse(fenced[1].trim());
    if (inner.ok) {
      return inner;
    }
  }

  // 3. 抓第一個 { 到最後一個 } 嘗試 parse
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const sliced = tryParse(trimmed.slice(firstBrace, lastBrace + 1));
    if (sliced.ok) {
      return sliced;
    }
  }

  // 4. 抓第一個 [ 到最後一個 ] （適合 action_items 陣列情況）
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const arraySliced = tryParse(trimmed.slice(firstBracket, lastBracket + 1));
    if (arraySliced.ok) {
      return arraySliced;
    }
  }

  return {
    ok: false,
    error: 'No valid JSON found in model output.'
  };
}

module.exports = {
  parseModelJson
};