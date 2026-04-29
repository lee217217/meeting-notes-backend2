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

  // 只有 caller 明確傳入合法 response_format 才帶上。
  // Perplexity 只支援 { type: 'text' } / { type: 'json_schema', json_schema: {...} } / { type: 'regex', regex: '...' }
  // 所以這裡做嚴格白名單檢查，避免像 { type: 'json_object' } 這種被 API 拒絕 400。
  if (opts.response_format && typeof opts.response_format === 'object') {
    const rf = opts.response_format;
    if (rf.type === 'text') {
      payload.response_format = { type: 'text' };
    } else if (
      rf.type === 'json_schema' &&
      rf.json_schema &&
      typeof rf.json_schema === 'object'
    ) {
      payload.response_format = {
        type: 'json_schema',
        json_schema: rf.json_schema
      };
    } else if (rf.type === 'regex' && typeof rf.regex === 'string') {
      payload.response_format = {
        type: 'regex',
        regex: rf.regex
      };
    }
    // 其他不合法 type 一律忽略，改為純 prompt-based JSON。
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

      let data = null;
      try {
        data = await response.json();
      } catch (_) {
        data = null;
      }

      if (!response.ok) {
        let errMessage = 'Perplexity API request failed';
        if (data && data.error) {
          if (typeof data.error === 'string') {
            errMessage = data.error;
          } else if (data.error.message) {
            errMessage =
              typeof data.error.message === 'string'
                ? data.error.message
                : JSON.stringify(data.error.message);
          } else {
            errMessage = JSON.stringify(data.error);
          }
        }

        const httpError = new Error(errMessage);
        httpError.status = response.status;

        // 4xx（除了 429）通常是請求本身壞掉，重試無意義，直接丟
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429
        ) {
          throw httpError;
        }

        lastError = httpError;
        throw httpError;
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

      // 4xx 請求級別錯誤不重試
      if (
        error &&
        typeof error.status === 'number' &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429
      ) {
        throw lastError;
      }

      if (attempt < maxRetries) {
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