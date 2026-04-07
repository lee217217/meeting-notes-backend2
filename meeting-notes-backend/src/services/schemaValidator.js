function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function validateRequiredFields(data, schema) {
  const errors = [];
  const required = schema && Array.isArray(schema.required) ? schema.required : [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      valid: false,
      errors: ['Data must be an object.']
    };
  }

  required.forEach(function (field) {
    if (!hasOwn(data, field)) {
      errors.push('Missing required field: ' + field);
    }
  });

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

function validateCoordinatorResult(data) {
  const errors = [];

  if (!Array.isArray(data.selected_agents)) {
    errors.push('selected_agents must be an array.');
  }

  if (typeof data.reason !== 'string') {
    errors.push('reason must be a string.');
  }

  if (typeof data.requires_human_confirmation !== 'boolean') {
    errors.push('requires_human_confirmation must be a boolean.');
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

function validateSummarizerResult(data) {
  const errors = [];

  if (typeof data.summary !== 'string') {
    errors.push('summary must be a string.');
  }

  if (!Array.isArray(data.key_points)) {
    errors.push('key_points must be an array.');
  }

  if (!Array.isArray(data.decisions)) {
    errors.push('decisions must be an array.');
  }

  if (!Array.isArray(data.risks_or_open_questions)) {
    errors.push('risks_or_open_questions must be an array.');
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

function validateActionItemResult(data) {
  const errors = [];

  if (!Array.isArray(data.action_items)) {
    errors.push('action_items must be an array.');
    return {
      valid: false,
      errors: errors
    };
  }

  data.action_items.forEach(function (item, index) {
    if (!item || typeof item !== 'object') {
      errors.push('action_items[' + index + '] must be an object.');
      return;
    }

    if (typeof item.task !== 'string') {
      errors.push('action_items[' + index + '].task must be a string.');
    }

    if (typeof item.owner !== 'string') {
      errors.push('action_items[' + index + '].owner must be a string.');
    }

    if (typeof item.due_date !== 'string') {
      errors.push('action_items[' + index + '].due_date must be a string.');
    }

    if (typeof item.priority !== 'string') {
      errors.push('action_items[' + index + '].priority must be a string.');
    }
  });

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

function validateFollowupEmailResult(data) {
  const errors = [];

  if (typeof data.email_subject !== 'string') {
    errors.push('email_subject must be a string.');
  }

  if (typeof data.email_body !== 'string') {
    errors.push('email_body must be a string.');
  }

  if (typeof data.tone !== 'string') {
    errors.push('tone must be a string.');
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

function validateQaReviewResult(data) {
  const errors = [];

  if (typeof data.review_status !== 'string') {
    errors.push('review_status must be a string.');
  }

  if (!Array.isArray(data.issues)) {
    errors.push('issues must be an array.');
  }

  if (!data.fixed_output || typeof data.fixed_output !== 'object' || Array.isArray(data.fixed_output)) {
    errors.push('fixed_output must be an object.');
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

function validateWorkflowResult(data) {
  const errors = [];

  if (typeof data.task_id !== 'string') {
    errors.push('task_id must be a string.');
  }

  if (typeof data.status !== 'string') {
    errors.push('status must be a string.');
  }

  if (!data.input || typeof data.input !== 'object') {
    errors.push('input must be an object.');
  }

  if (!data.workflow || typeof data.workflow !== 'object') {
    errors.push('workflow must be an object.');
  }

  if (!data.artifacts || typeof data.artifacts !== 'object') {
    errors.push('artifacts must be an object.');
  }

  if (!data.review || typeof data.review !== 'object') {
    errors.push('review must be an object.');
  }

  if (!Array.isArray(data.trace)) {
    errors.push('trace must be an array.');
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

function validateWithSchema(data, schemaName) {
  if (schemaName === 'coordinator') {
    return validateCoordinatorResult(data);
  }

  if (schemaName === 'summarizer') {
    return validateSummarizerResult(data);
  }

  if (schemaName === 'actionItem') {
    return validateActionItemResult(data);
  }

  if (schemaName === 'followupEmail') {
    return validateFollowupEmailResult(data);
  }

  if (schemaName === 'qaReview') {
    return validateQaReviewResult(data);
  }

  if (schemaName === 'workflowResult') {
    return validateWorkflowResult(data);
  }

  return {
    valid: false,
    errors: ['Unknown schema name: ' + schemaName]
  };
}

module.exports = {
  validateRequiredFields,
  validateCoordinatorResult,
  validateSummarizerResult,
  validateActionItemResult,
  validateFollowupEmailResult,
  validateQaReviewResult,
  validateWorkflowResult,
  validateWithSchema
};