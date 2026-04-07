const { safeStringify } = require('../utils/safeStringify');

function previewOutput(output) {
  try {
    const text = safeStringify(output);
    if (text.length > 300) {
      return text.slice(0, 300) + '...';
    }
    return text;
  } catch (error) {
    return '[unserializable output]';
  }
}

function logStepStart(result, step) {
  console.log(JSON.stringify({
    level: 'info',
    event: 'step_start',
    task_id: result.task_id,
    step: step,
    timestamp: new Date().toISOString()
  }));
}

function logStepSuccess(result, step, output) {
  console.log(JSON.stringify({
    level: 'info',
    event: 'step_success',
    task_id: result.task_id,
    step: step,
    timestamp: new Date().toISOString(),
    output_preview: previewOutput(output)
  }));
}

function logStepFailure(result, step, error) {
  console.error(JSON.stringify({
    level: 'error',
    event: 'step_failure',
    task_id: result.task_id,
    step: step,
    timestamp: new Date().toISOString(),
    error: error && error.message ? error.message : 'Unknown error'
  }));
}

module.exports = {
  logStepStart,
  logStepSuccess,
  logStepFailure
};