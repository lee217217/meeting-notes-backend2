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

    pushTrace('summarizer', 'completed', {
      has_summary: Boolean(summarizerResult.summary),
      key_points_count: Array.isArray(summarizerResult.key_points)
        ? summarizerResult.key_points.length
        : 0
    });

    const actionItemResult = await runActionItemAgent(
      normalizedInput,
      summarizerResult
    );

    pushTrace('action_item_agent', 'completed', {
      action_items_count: Array.isArray(actionItemResult.action_items)
        ? actionItemResult.action_items.length
        : 0
    });

    const followupEmailResult = await runFollowupEmailAgent(
      normalizedInput,
      summarizerResult,
      actionItemResult
    );

    pushTrace('followup_email_agent', 'completed', {
      has_email_subject: Boolean(followupEmailResult.email_subject),
      has_email_body: Boolean(followupEmailResult.email_body)
    });

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

    const finalArtifacts =
      qaReviewResult.review_status === 'fail' &&
      qaReviewResult.fixed_output &&
      typeof qaReviewResult.fixed_output === 'object'
        ? {
            summary:
              qaReviewResult.fixed_output.summary || artifacts.summary || '',
            key_points: artifacts.key_points,
            decisions: artifacts.decisions,
            risks_or_open_questions: artifacts.risks_or_open_questions,
            action_items: Array.isArray(qaReviewResult.fixed_output.action_items)
              ? qaReviewResult.fixed_output.action_items
              : artifacts.action_items,
            follow_up_email:
              qaReviewResult.fixed_output.follow_up_email ||
              artifacts.follow_up_email ||
              '',
            follow_up_email_subject: artifacts.follow_up_email_subject,
            follow_up_email_tone: artifacts.follow_up_email_tone
          }
        : artifacts;

    pushTrace('workflow', 'completed', {
      final_review_status: qaReviewResult.review_status || 'pass'
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
        task_type: coordinatorResult.task_type || 'full_meeting_pack'
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
      artifacts: {
        summary: '',
        key_points: [],
        decisions: [],
        risks_or_open_questions: [],
        action_items: [],
        follow_up_email: '',
        follow_up_email_subject: '',
        follow_up_email_tone: 'professional'
      },
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