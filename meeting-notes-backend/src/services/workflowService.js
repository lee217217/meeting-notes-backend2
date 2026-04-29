const { runCoordinatorAgent } = require('../agents/coordinatorAgent');
const { runSummarizerAgent } = require('../agents/summarizerAgent');
const { runActionItemAgent } = require('../agents/actionItemAgent');
const { runFollowupEmailAgent } = require('../agents/followupEmailAgent');
const { runQaReviewAgent } = require('../agents/qaReviewAgent');

function nowIso() {
  return new Date().toISOString();
}

function createTaskId() {
  return 'wf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function isUsefulString(value, minLength) {
  return (
    typeof value === 'string' &&
    value.trim().length >= (typeof minLength === 'number' ? minLength : 1)
  );
}

function pickBetter(candidate, fallback, minLength) {
  return isUsefulString(candidate, minLength) ? candidate : fallback;
}

function emptyArtifacts() {
  return {
    summary: '',
    key_points: [],
    decisions: [],
    risks_or_open_questions: [],
    action_items: [],
    follow_up_email: '',
    follow_up_email_subject: '',
    follow_up_email_tone: 'professional'
  };
}

async function runWorkflow(payload) {
  const taskId = createTaskId();
  const startedAt = nowIso();
  const trace = [];

  function pushTrace(step, status, extra) {
    trace.push({
      step: step,
      status: status,
      timestamp: nowIso(),
      details: extra || null
    });
  }

  const normalizedInput = {
    meetingTitle: payload.meetingTitle || '',
    meetingType: payload.meetingType || 'General',
    language: payload.language || 'English',
    notes: payload.notes || '',
    outputMode: payload.outputMode || 'full_meeting_pack',
    userQuery: payload.userQuery || ''
  };

  try {
    pushTrace('workflow', 'started', {
      meetingTitle: normalizedInput.meetingTitle,
      meetingType: normalizedInput.meetingType,
      language: normalizedInput.language
    });

    const coordinatorResult = await runCoordinatorAgent(normalizedInput, {
      source: 'multi-agent-run',
      started_at: startedAt
    });

    pushTrace('coordinator', 'completed', {
      selected_agents: coordinatorResult.selected_agents || [],
      task_type: coordinatorResult.task_type || ''
    });

    const summarizerResult = await runSummarizerAgent(normalizedInput);

    pushTrace(
      'summarizer',
      summarizerResult &&
        summarizerResult._meta &&
        summarizerResult._meta.parse_ok === false
        ? 'parse_failed'
        : 'completed',
      {
        has_summary: Boolean(summarizerResult.summary),
        key_points_count: Array.isArray(summarizerResult.key_points)
          ? summarizerResult.key_points.length
          : 0,
        decisions_count: Array.isArray(summarizerResult.decisions)
          ? summarizerResult.decisions.length
          : 0,
        parse_error:
          summarizerResult &&
          summarizerResult._meta &&
          summarizerResult._meta.parse_error
            ? summarizerResult._meta.parse_error
            : null
      }
    );

    const actionItemResult = await runActionItemAgent(
      normalizedInput,
      summarizerResult
    );

    pushTrace(
      'action_item_agent',
      actionItemResult &&
        actionItemResult._meta &&
        actionItemResult._meta.parse_ok === false
        ? 'parse_failed'
        : 'completed',
      {
        action_items_count: Array.isArray(actionItemResult.action_items)
          ? actionItemResult.action_items.length
          : 0,
        parse_error:
          actionItemResult &&
          actionItemResult._meta &&
          actionItemResult._meta.parse_error
            ? actionItemResult._meta.parse_error
            : null
      }
    );

    const followupEmailResult = await runFollowupEmailAgent(
      normalizedInput,
      summarizerResult,
      actionItemResult
    );

    pushTrace(
      'followup_email_agent',
      followupEmailResult &&
        followupEmailResult._meta &&
        followupEmailResult._meta.parse_ok === false
        ? 'parse_failed'
        : 'completed',
      {
        has_email_subject: Boolean(followupEmailResult.email_subject),
        has_email_body: Boolean(followupEmailResult.email_body),
        parse_error:
          followupEmailResult &&
          followupEmailResult._meta &&
          followupEmailResult._meta.parse_error
            ? followupEmailResult._meta.parse_error
            : null
      }
    );

    const artifacts = {
      summary: summarizerResult.summary || '',
      key_points: Array.isArray(summarizerResult.key_points)
        ? summarizerResult.key_points
        : [],
      decisions: Array.isArray(summarizerResult.decisions)
        ? summarizerResult.decisions
        : [],
      risks_or_open_questions: Array.isArray(
        summarizerResult.risks_or_open_questions
      )
        ? summarizerResult.risks_or_open_questions
        : [],
      action_items: Array.isArray(actionItemResult.action_items)
        ? actionItemResult.action_items
        : [],
      follow_up_email: followupEmailResult.email_body || '',
      follow_up_email_subject: followupEmailResult.email_subject || '',
      follow_up_email_tone: followupEmailResult.tone || 'professional'
    };

    const qaReviewResult = await runQaReviewAgent(normalizedInput, artifacts);

    pushTrace('qa_review_agent', 'completed', {
      review_status: qaReviewResult.review_status || 'pass',
      issues_count: Array.isArray(qaReviewResult.issues)
        ? qaReviewResult.issues.length
        : 0
    });

    // QA 保底邏輯：只有當 fixed_output 明顯更好（更長/非空）時才覆蓋
    const fixed =
      qaReviewResult.fixed_output &&
      typeof qaReviewResult.fixed_output === 'object'
        ? qaReviewResult.fixed_output
        : {};

    const shouldApplyFix =
      qaReviewResult.review_status === 'fail' &&
      (isUsefulString(fixed.summary, 10) ||
        (Array.isArray(fixed.action_items) && fixed.action_items.length > 0) ||
        isUsefulString(fixed.follow_up_email, 20));

    const finalArtifacts = shouldApplyFix
      ? {
          summary: pickBetter(fixed.summary, artifacts.summary, 10),
          key_points: artifacts.key_points,
          decisions: artifacts.decisions,
          risks_or_open_questions: artifacts.risks_or_open_questions,
          action_items:
            Array.isArray(fixed.action_items) && fixed.action_items.length > 0
              ? fixed.action_items
              : artifacts.action_items,
          follow_up_email: pickBetter(
            fixed.follow_up_email,
            artifacts.follow_up_email,
            20
          ),
          follow_up_email_subject: artifacts.follow_up_email_subject,
          follow_up_email_tone: artifacts.follow_up_email_tone
        }
      : artifacts;

    pushTrace('workflow', 'completed', {
      final_review_status: qaReviewResult.review_status || 'pass',
      applied_qa_fix: shouldApplyFix
    });

    return {
      success: true,
      task_id: taskId,
      status: 'completed',
      started_at: startedAt,
      completed_at: nowIso(),
      input: normalizedInput,
      workflow: {
        current_step: 'completed',
        selected_agents: coordinatorResult.selected_agents || [],
        task_type:
          coordinatorResult.task_type || 'full_meeting_pack'
      },
      artifacts: finalArtifacts,
      review: qaReviewResult,
      trace: trace,
      error: null
    };
  } catch (error) {
    pushTrace('workflow', 'failed', {
      message: error && error.message ? error.message : 'Unknown error'
    });

    return {
      success: false,
      task_id: taskId,
      status: 'failed',
      started_at: startedAt,
      completed_at: nowIso(),
      input: normalizedInput,
      workflow: {
        current_step: 'failed',
        selected_agents: [],
        task_type: normalizedInput.outputMode || 'full_meeting_pack'
      },
      artifacts: emptyArtifacts(),
      review: {
        agent: 'qa_review_agent',
        system_prompt_name: '',
        review_status: 'fail',
        issues: [error && error.message ? error.message : 'Unknown error'],
        fixed_output: {
          summary: '',
          action_items: [],
          follow_up_email: ''
        }
      },
      trace: trace,
      error: error && error.message ? error.message : 'Unknown error'
    };
  }
}

module.exports = {
  runWorkflow
};