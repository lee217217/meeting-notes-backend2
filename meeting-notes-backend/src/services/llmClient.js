async function callLlm(messages, options) {
  const apiKey = process.env.PERPLEXITY_API_KEY;

  if (!apiKey) {
    throw new Error('Missing PERPLEXITY_API_KEY');
  }

  const opts = options || {};
  const payload = {
    model: opts.model || 'sonar',
    messages: messages,
    temperature:
      typeof opts.temperature === 'number' ? opts.temperature : 0.2
  };

  if (opts.response_format) {
    payload.response_format = opts.response_format;
  } else if (opts.jsonMode !== false) {
    // 預設啟用 JSON mode（agent 可傳 jsonMode: false 關掉）
    payload.response_format = { type: 'json_object' };
  }

  const timeoutMs =
    typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 45000;
  const maxRetries =
    typeof opts.maxRetries === 'number' ? opts.maxRetries : 2;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(function () {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(
        'https://api.perplexity.ai/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + apiKey
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        }
      );

      const data = await response.json();

      if (!response.ok) {
        const errMessage =
          (data && data.error && data.error.message) ||
          (data && data.error) ||
          'Perplexity API request failed';
        throw new Error(errMessage);
      }

      const content =
        data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content;

      if (!content || typeof content !== 'string' || !content.trim()) {
        throw new Error('Empty response content from Perplexity API');
      }

      return { raw: data, text: content };
    } catch (error) {
      if (error && error.name === 'AbortError') {
        lastError = new Error('Perplexity API request timed out');
      } else {
        lastError = error;
      }

      if (attempt < maxRetries) {
        // 退避等待，再試
        await new Promise(function (resolve) {
          setTimeout(resolve, 500 * (attempt + 1));
        });
        continue;
      }

      throw lastError;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error('Unknown LLM error');
}

module.exports = {
  callLlm
};