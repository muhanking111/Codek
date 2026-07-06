const assert = require("node:assert/strict")
const { test } = require("node:test")

const {
  buildTrialFeedbackSummary,
  normalizeTrialFeedback,
} = require("./trialFeedbackSummary")

function feedback(overrides = {}) {
  return {
    participantId: overrides.participantId || "pilot-1",
    participantRole: overrides.participantRole || "frontend engineer",
    taskId: overrides.taskId || "DAY13-T01",
    taskTitle: overrides.taskTitle || "修复设置页文案并走质量门",
    taskStatus: overrides.taskStatus || "passed",
    durationMinutes: overrides.durationMinutes ?? 18,
    manualInterventions: overrides.manualInterventions || ["确认 rollback 不覆盖主工作区"],
    failurePoints: overrides.failurePoints || [],
    roleProfile: overrides.roleProfile || {
      profileId: "frontend-polish",
      usefulnessScore: 4,
      note: "能解释为什么选单 Agent",
    },
    cost: overrides.cost || {
      perceived: "acceptable",
      totalTokens: 4200,
      estimatedUsd: 0.18,
      note: "等待时间可接受",
    },
    qualityGate: overrides.qualityGate || {
      status: "passed",
      regressions: [],
    },
    evidenceRefs: overrides.evidenceRefs || ["run:pilot-1", "report:trial-1"],
    mustFixBeforeRelease: overrides.mustFixBeforeRelease || [],
    notes: overrides.notes || "DO_NOT_LEAK_RAW_NOTE",
    reproductionSteps: overrides.reproductionSteps || "",
  }
}

test("normalizeTrialFeedback keeps safe metadata and strips raw note bodies", () => {
  const entry = normalizeTrialFeedback(feedback({
    notes: "raw private user wording should not be copied",
    reproductionSteps: "raw reproduction body should not be copied",
  }))

  assert.equal(entry.participantId, "pilot-1")
  assert.equal(entry.taskStatus, "passed")
  assert.equal(entry.durationMinutes, 18)
  assert.equal(entry.manualInterventionCount, 1)
  assert.equal(entry.roleProfile.usefulnessScore, 4)
  assert.equal(entry.cost.perceived, "acceptable")
  assert.equal(entry.noteLength > 0, true)
  assert.equal(entry.reproductionStepsLength > 0, true)
  assert.doesNotMatch(JSON.stringify(entry), /raw private user wording/)
  assert.doesNotMatch(JSON.stringify(entry), /raw reproduction body/)
})

test("trial feedback summary requires at least three distinct human participants", () => {
  const summary = buildTrialFeedbackSummary({
    createdAt: 1,
    feedbackEntries: [
      feedback({ participantId: "pilot-1" }),
      feedback({ participantId: "pilot-2" }),
    ],
  })

  assert.equal(summary.reportKind, "agent-workbench-trial-feedback-summary")
  assert.equal(summary.ready, false)
  assert.equal(summary.releaseDecision.status, "stop")
  assert.equal(summary.stopGo.conditions.enoughParticipants, false)
  assert.equal(summary.gaps.some((gap) => gap.id === "trial_feedback_participants"), true)
})

test("trial feedback summary aggregates three pilot runs into release decision evidence", () => {
  const summary = buildTrialFeedbackSummary({
    createdAt: 1,
    feedbackEntries: [
      feedback({
        participantId: "pilot-1",
        participantRole: "frontend engineer",
        taskStatus: "passed",
        durationMinutes: 16,
        manualInterventions: ["确认应用补丁前先看 diff"],
        roleProfile: { profileId: "frontend-polish", usefulnessScore: 5 },
        cost: { perceived: "acceptable", totalTokens: 3000, estimatedUsd: 0.12 },
        evidenceRefs: ["run:front-1", "quality:front-1"],
      }),
      feedback({
        participantId: "pilot-2",
        participantRole: "backend engineer",
        taskStatus: "passed",
        durationMinutes: 21,
        manualInterventions: ["要求重跑 node --test"],
        roleProfile: { profileId: "backend-safety", usefulnessScore: 4 },
        cost: { perceived: "high-but-acceptable", totalTokens: 5200, estimatedUsd: 0.31 },
        evidenceRefs: ["run:back-1", "report:back-1"],
      }),
      feedback({
        participantId: "pilot-3",
        participantRole: "product reviewer",
        taskStatus: "passed",
        durationMinutes: 13,
        manualInterventions: [],
        roleProfile: { profileId: "product-review", usefulnessScore: 4 },
        cost: { perceived: "acceptable", totalTokens: 2800, estimatedUsd: 0.09 },
        evidenceRefs: ["run:pm-1"],
      }),
    ],
  })

  assert.equal(summary.ready, true)
  assert.equal(summary.releaseDecision.status, "go")
  assert.equal(summary.summary.participants, 3)
  assert.equal(summary.summary.passedTasks, 3)
  assert.equal(summary.summary.totalDurationMinutes, 50)
  assert.equal(summary.summary.manualInterventions, 2)
  assert.equal(summary.summary.averageRoleProfileUsefulness, 4.33)
  assert.equal(summary.summary.totalTokens, 11000)
  assert.equal(summary.summary.estimatedUsd, 0.52)
  assert.equal(summary.stopGo.conditions.noBlockingIssues, true)
  assert.deepEqual(summary.fixQueue, [])
  assert.deepEqual(summary.evidenceRefs, ["run:front-1", "quality:front-1", "run:back-1", "report:back-1", "run:pm-1"])
  assert.match(summary.markdown, /三人试用反馈闭环/)
})

test("blocking issues, quality regressions, poor role profiles, and high cost drive no-go fix queue", () => {
  const summary = buildTrialFeedbackSummary({
    createdAt: 1,
    feedbackEntries: [
      feedback({ participantId: "pilot-1", taskStatus: "passed" }),
      feedback({
        participantId: "pilot-2",
        taskStatus: "failed",
        failurePoints: [{ severity: "P0", title: "Accept 后误写主工作区", action: "修复写入 guard", evidenceRefs: ["run:bad-accept"] }],
        qualityGate: { status: "failed", regressions: [{ severity: "P1", title: "node --test 回归失败", command: "node --test x.test.js" }] },
        roleProfile: { profileId: "backend-safety", usefulnessScore: 2, note: "分工提示误导了任务归属" },
        cost: { perceived: "too-high", totalTokens: 12000, estimatedUsd: 1.7, note: "等待时间过长" },
        mustFixBeforeRelease: ["禁止 Accept 直接写主工作区"],
      }),
      feedback({
        participantId: "pilot-3",
        taskStatus: "blocked",
        failurePoints: [{ severity: "P1", title: "Rollback 说明无法复现", action: "补充 evidence ref" }],
        roleProfile: { profileId: "product-review", usefulnessScore: 3 },
        cost: { perceived: "acceptable", totalTokens: 3500, estimatedUsd: 0.14 },
      }),
    ],
  })

  assert.equal(summary.ready, false)
  assert.equal(summary.releaseDecision.status, "stop")
  assert.equal(summary.summary.blockingIssues, 1)
  assert.equal(summary.summary.qualityGateRegressions, 1)
  assert.equal(summary.summary.lowRoleProfileUsefulness, 1)
  assert.equal(summary.summary.highCostConcerns, 1)
  assert.equal(summary.stopGo.conditions.noBlockingIssues, false)
  assert.equal(summary.stopGo.conditions.noQualityGateRegressions, false)
  assert.equal(summary.fixQueue[0].severity, "P0")
  assert.equal(summary.fixQueue.some((item) => item.category === "quality-gate-regression"), true)
  assert.equal(summary.fixQueue.some((item) => item.category === "role-profile"), true)
  assert.equal(summary.fixQueue.some((item) => item.category === "cost-time"), true)
  assert.equal(summary.releaseDecision.reasons.some((reason) => reason.includes("P0")), true)
})
