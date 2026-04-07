function parseModelJson(text) {
  if (typeof text !== 'string') {
    return {
      ok: false,
      error: 'Model output is not a string.'
    };
  }

  try {
    return {
      ok: true,
      data: JSON.parse(text)
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
}

module.exports = {
  parseModelJson
};