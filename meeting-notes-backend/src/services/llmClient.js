async function callLlm(options) {
  return {
    ok: true,
    provider: 'mock',
    model: options && options.model ? options.model : 'mock-model',
    content: options && options.mockContent ? options.mockContent : '{}'
  };
}

module.exports = {
  callLlm
};