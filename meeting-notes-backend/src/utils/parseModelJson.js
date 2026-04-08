function parseModelJson(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Model response is empty or not a string');
  }

  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);

    if (!match) {
      throw new Error('Unable to locate JSON in model response');
    }

    return JSON.parse(match[0]);
  }
}

module.exports = {
  parseModelJson
};