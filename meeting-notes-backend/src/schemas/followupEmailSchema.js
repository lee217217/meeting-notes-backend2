const followupEmailSchema = {
  name: 'followupEmailSchema',
  required: [
    'agent',
    'email_subject',
    'email_body',
    'tone'
  ]
};

module.exports = {
  followupEmailSchema
};