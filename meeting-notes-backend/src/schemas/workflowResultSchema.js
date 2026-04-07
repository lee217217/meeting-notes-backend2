const workflowResultSchema = {
  name: 'workflowResultSchema',
  required: [
    'task_id',
    'status',
    'started_at',
    'input',
    'workflow',
    'artifacts',
    'review',
    'trace',
    'error'
  ]
};

module.exports = {
  workflowResultSchema
};