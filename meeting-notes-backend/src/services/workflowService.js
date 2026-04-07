const { nowIso, createTaskId, createTraceEntry } = require('../utils/time');
const { logStepStart, logStepSuccess, logStepFailure } = require('./traceLogger');
const { validateWithSchema } = require('./schemaValidator');

const { runCoordinatorAgent } = require('../agents/coordinatorAgent');
const { runSummarizerAgent } = require('../agents/summarizerAgent');
const { runActionItemAgent } = require('../agents/actionItemAgent');
const { runFollowupEmailAgent } = require('../agents/followupEmailAgent');
const { runQaReviewAgent } = require('../agents/qaReviewAgent');

function assertValidation(result, schemaName, stepName) {
  const validation = validateWithSchema(result, schemaName);

  if (!validation.valid) {
    throw new Error(
      stepName + ' validation failed: ' + validation.errors.join('; ')
    );
  }
}

async function runMultiAgentWorkflow(payload) {
  const taskId = createTaskId();
  const startedAt = nowIso();

  const result = {
    task_id: taskId,
    status: 'pending',
    started_at: startedAt,
    completed_at: null,
    input: {
      meetingTitle: payload.meetingTitle || '',
      meetingType: payload.meetingType || 'General',
      language: payload.language || 'English',
      mode: payload.mode || 'auto_workflow',
      userQuery: payload.userQuery || ''
    },
    workflow: {
      current_step: 'coordinator',
      selected_agents: [],
      history: []
    },
    artifacts: {
      summary: '',
      key_points: [],
      decisions: [],
      risks_or_open_questions: [],
      action_items: [],
      follow_up_email: '',
      email_subject: ''
    },
    review: {
      status: 'pending',
      issues: []
    },
    trace: [],
    error: null
  };

  try {
    result.status = 'running';

    logStepStart(result, 'coordinator');
    const coordinatorResult = await runCoordinatorAgent(payload, {
      hasNotes: Boolean(payload.notes),
      notesLength: payload.notes ? payload.notes.length : 0
    });
    assertValidation(coordinatorResult, 'coordinator', 'Coordinator');

    result.workflow.selected_agents = coordinatorResult.selected_agents || [];
    result.workflow.current_step = 'meeting_summarizer';
    result.workflow.history.push({
      step: 'coordinator',
      status: 'done',
      completed_at: nowIso()
    });
    result.trace.push(createTraceEntry('coordinator', 'done', coordinatorResult));
    logStepSuccess(result, 'coordinator', coordinatorResult);

    logStepStart(result, 'meeting_summarizer');
    const summarizerResult = await runSummarizerAgent(payload);
    assertValidation(summarizerResult, 'summarizer', 'Summarizer');

    result.artifacts.summary = summarizerResult.summary || '';
    result.artifacts.key_points = summarizerResult.key_points || [];
    result.artifacts.decisions = summarizerResult.decisions || [];
    result.artifacts.risks_or_open_questions = summarizerResult.risks_or_open_questions || [];
    result.workflow.current_step = 'action_item_agent';
    result.workflow.history.push({
      step: 'meeting_summarizer',
      status: 'done',
      completed_at: nowIso()
    });
    result.trace.push(createTraceEntry('meeting_summarizer', 'done', summarizerResult));
    logStepSuccess(result, 'meeting_summarizer', summarizerResult);

    logStepStart(result, 'action_item_agent');
    const actionItemResult = await runActionItemAgent(payload, summarizerResult);
    assertValidation(actionItemResult, 'actionItem', 'Action item agent');

    result.artifacts.action_items = actionItemResult.action_items || [];
    result.workflow.current_step = 'followup_email_agent';
    result.workflow.history.push({
      step: 'action_item_agent',
      status: 'done',
      completed_at: nowIso()
    });
    result.trace.push(createTraceEntry('action_item_agent', 'done', actionItemResult));
    logStepSuccess(result, 'action_item_agent', actionItemResult);

    logStepStart(result, 'followup_email_agent');
    const followupEmailResult = await runFollowupEmailAgent(payload, summarizerResult, actionItemResult);
    assertValidation(followupEmailResult, 'followupEmail', 'Follow-up email agent');

    result.artifacts.follow_up_email = followupEmailResult.email_body || '';
    result.artifacts.email_subject = followupEmailResult.email_subject || '';
    result.workflow.current_step = 'qa_review_agent';
    result.workflow.history.push({
      step: 'followup_email_agent',
      status: 'done',
      completed_at: nowIso()
    });
    result.trace.push(createTraceEntry('followup_email_agent', 'done', followupEmailResult));
    logStepSuccess(result, 'followup_email_agent', followupEmailResult);

    logStepStart(result, 'qa_review_agent');
    const qaReviewResult = await runQaReviewAgent(payload, result.artifacts);
    assertValidation(qaReviewResult, 'qaReview', 'QA review agent');

    result.review.status = qaReviewResult.review_status || 'pending';
    result.review.issues = qaReviewResult.issues || [];
    result.workflow.current_step = 'done';
    result.workflow.history.push({
      step: 'qa_review_agent',
      status: 'done',
      completed_at: nowIso()
    });
    result.trace.push(createTraceEntry('qa_review_agent', 'done', qaReviewResult));
    logStepSuccess(result, 'qa_review_agent', qaReviewResult);

    assertValidation(result, 'workflowResult', 'Workflow result');

    result.status = qaReviewResult.review_status === 'fail' ? 'failed' : 'done';
    result.completed_at = nowIso();

    return result;
  } catch (error) {
    result.status = 'failed';
    result.completed_at = nowIso();
    result.error = {
      message: error.message || 'Unknown workflow error',
      step: result.workflow.current_step || 'unknown'
    };

    result.workflow.history.push({
      step: result.workflow.current_step || 'unknown',
      status: 'failed',
      completed_at: nowIso()
    });

    result.trace.push(createTraceEntry(
      result.workflow.current_step || 'unknown',
      'failed',
      { error: error.message || 'Unknown workflow error' }
    ));

    logStepFailure(result, result.workflow.current_step || 'unknown', error);

    return result;
  }
}

module.exports = {
  runMultiAgentWorkflow
};