const coordinatorSchema = {
  name: 'coordinatorSchema',
  required: [
    'agent',
    'task_type',
    'selected_agents',
    'reason',
    'requires_human_confirmation'
  ]
};

module.exports = {
  coordinatorSchema
};