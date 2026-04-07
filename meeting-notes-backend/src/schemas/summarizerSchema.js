const summarizerSchema = {
  name: 'summarizerSchema',
  required: [
    'agent',
    'summary',
    'key_points',
    'decisions',
    'risks_or_open_questions'
  ]
};

module.exports = {
  summarizerSchema
};