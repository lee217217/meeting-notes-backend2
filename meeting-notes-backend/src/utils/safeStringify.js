function safeStringify(value, space) {
  const seen = new WeakSet();

  return JSON.stringify(value, function (key, val) {
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) {
        return '[Circular]';
      }
      seen.add(val);
    }
    return val;
  }, space || 0);
}

module.exports = {
  safeStringify
};