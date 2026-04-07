function nowIso() {
  return new Date().toISOString();
}

function createTaskId() {
  return 'tsk_' + Date.now();
}

function createTraceEntry(step, status, data) {
  return {
    step: step,
    status: status,
    timestamp: nowIso(),
    data: data || {}
  };
}

module.exports = {
  nowIso,
  createTaskId,
  createTraceEntry
};