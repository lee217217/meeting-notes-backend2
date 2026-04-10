async function callLlm(messages, options) {
  const apiKey = process.env.PERPLEXITY_API_KEY;

  if (!apiKey) {
    throw new Error('Missing PERPLEXITY_API_KEY');
  }

  const payload = {
    model: (options && options.model) || 'sonar',
    messages: messages,
    temperature:
      typeof options?.temperature === 'number' ? options.temperature : 0.2
  };

  if (options && options.response_format) {
    payload.response_format = options.response_format;
  }

  const controller = new AbortController();
  const timeoutMs =
    typeof options?.timeoutMs === 'number' ? options.timeoutMs : 45000;

  const timeoutId = setTimeout(function () {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error?.message || data.error || 'Perplexity API request failed'
      );
    }

    const content =
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;

    if (!content) {
      throw new Error('Empty response content from Perplexity API');
    }

    return {
      raw: data,
      text: content
    };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error('Perplexity API request timed out');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  callLlm
};