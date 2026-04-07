const qaReviewSchema = {
  name: 'qaReviewSchema',
  required: [
    'agent',
    'review_status',
    'issues',
    'fixed_output'
  ]
};

module.exports = {
  qaReviewSchema
};