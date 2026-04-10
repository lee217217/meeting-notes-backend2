function parseModelJson(text) {
  if (!text || typeof text !== 'string') {
    return {
      ok: false,
      data: null,
      error: 'Model response is empty or not a string'
    };
  }

  const trimmed = text.trim();

  try {
    return {
      ok: true,
      data: JSON.parse(trimmed)
    };
  } catch (error) {
    try {
      const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);

      if (!match) {
        return {
          ok: false,
          data: null,
          error: 'Unable to locate JSON in model response'
        };
      }

      return {
        ok: true,
        data: JSON.parse(match[0])
      };
    } catch (innerError) {
      return {
        ok: false,
        data: null,
        error: innerError.message || 'JSON parse failed'
      };
    }
  }
}