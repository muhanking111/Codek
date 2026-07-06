const crypto = require("node:crypto")

function buildTrialFeedbackSummary(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const entries = (Array.isArray(input.feedbackEntries) ? input.feedbackEntries : [])
    .map(normalizeTrialFeedback)
    .filter((entry) => entry.participantId)
  const participantIds = new Set(entries.map((entry) => entry.participantId))
  const passedTasks = entries.filter((entry) => entry.taskStatus === "passed").length
  const failedTasks = entries.filter((entry) => entry.taskStatus === "failed").length
  const blockedTasks = entries.filter((entry) => entry.taskStatus === "blocked").length
  const blockingIssues = entries.flatMap((entry) =>
    entry.failurePoints.filter((point) => point.severity === "P0").map((point) => ({ ...point, participantId: entry.participantId, taskId: entry.taskId })),
  )
  const p1Issues = entries.flatMap((entry) =>
    entry.failurePoints.filter((point) => point.severity === "P1").map((point) => ({ ...point, participantId: entry.participantId, taskId: entry.taskId })),
  )
  const qualityGateRegressions = entries.flatMap((entry) =>
    entry.qualityGate.regressions.map((regression) => ({ ...regression, participantId: entry.participantId, taskId: entry.taskId })),
  )
  const lowRoleProfileUsefulness = entries.filter((entry) =>
    typeof entry.roleProfile.usefulnessScore === "number" && entry.roleProfile.usefulnessScore < 3,
  )
  const highCostConcerns = entries.filter((entry) => entry.cost.perceived === "too-high")
  const mustFixBeforeRelease = entries.flatMap((entry) =>
    entry.mustFixBeforeRelease.map((title) => ({
      category: "must-fix",
      severity: "P1",
      title,
      participantId: entry.participantId,
      taskId: entry.taskId,
      action: "进入下一轮修复并绑定回归证据。",
      evidenceRefs: entry.evidenceRefs,
    })),
  )
  const fixQueue = buildFixQueue({
    blockingIssues,
    p1Issues,
    qualityGateRegressions,
    lowRoleProfileUsefulness,
    highCostConcerns,
    mustFixBeforeRelease,
  })
  const stopGo = {
    conditions: {
      enoughParticipants: participantIds.size >= 3,
      everyParticipantHasTaskResult: participantIds.size >= 3 && entries.every((entry) => Boolean(entry.taskId && entry.taskStatus)),
      noBlockingIssues: blockingIssues.length === 0,
      noQualityGateRegressions: qualityGateRegressions.length === 0,
      roleProfilesUseful: lowRoleProfileUsefulness.length === 0,
      costTimeAcceptable: highCostConcerns.length === 0,
      evidenceRefsPresent: entries.every((entry) => entry.evidenceRefs.length > 0),
    },
  }
  const ready = Object.values(stopGo.conditions).every(Boolean) && failedTasks === 0 && blockedTasks === 0
  const releaseDecision = {
    status: ready ? "go" : "stop",
    recommendation: ready
      ? "可以进入下一轮小规模试用或主线程合入评审。"
      : "先止损修复阻断项，再安排下一轮三人试用回归。",
    reasons: buildDecisionReasons(stopGo.conditions, { blockingIssues, qualityGateRegressions, failedTasks, blockedTasks, lowRoleProfileUsefulness, highCostConcerns }),
  }
  const summary = {
    participants: participantIds.size,
    feedbackEntries: entries.length,
    passedTasks,
    failedTasks,
    blockedTasks,
    totalDurationMinutes: sum(entries.map((entry) => entry.durationMinutes)),
    manualInterventions: sum(entries.map((entry) => entry.manualInterventionCount)),
    blockingIssues: blockingIssues.length,
    qualityGateRegressions: qualityGateRegressions.length,
    lowRoleProfileUsefulness: lowRoleProfileUsefulness.length,
    highCostConcerns: highCostConcerns.length,
    averageRoleProfileUsefulness: average(entries.map((entry) => entry.roleProfile.usefulnessScore).filter((score) => typeof score === "number")),
    totalTokens: sum(entries.map((entry) => entry.cost.totalTokens)),
    estimatedUsd: roundMoney(sum(entries.map((entry) => entry.cost.estimatedUsd))),
  }
  const gaps = buildGaps(stopGo.conditions)
  const evidenceRefs = unique(entries.flatMap((entry) => entry.evidenceRefs))
  const report = {
    reportKind: "agent-workbench-trial-feedback-summary",
    createdAt,
    ready,
    status: ready ? "ready" : "blocked",
    statusLabel: ready ? "Day 13-14 三人试用反馈闭环已就绪" : "Day 13-14 三人试用反馈仍需止损修复",
    summary,
    releaseDecision,
    stopGo,
    gaps,
    participants: entries,
    painPoints: buildPainPoints(entries),
    fixQueue,
    nextRoundRepairQueue: fixQueue,
    evidenceRefs,
    privacyPolicy: {
      allow: ["participant id", "role", "task id", "status", "duration", "manual intervention count", "severity", "role profile score", "cost metadata", "evidence refs", "hash and length metadata"],
      deny: ["raw note body", "raw reproduction body", "prompt body", "source code body", "diff body", "command output", "secret values", "raw screenshot path"],
    },
  }
  report.markdown = buildMarkdown(report)
  return report
}

function normalizeTrialFeedback(raw = {}) {
  const roleProfile = raw.roleProfile || raw.roleProfileUsefulness || {}
  const cost = raw.cost || raw.costTime || {}
  const qualityGate = raw.qualityGate || raw.qualityGateEvidence || {}
  const notes = String(raw.notes || raw.note || "")
  const reproductionSteps = String(raw.reproductionSteps || raw.steps || "")
  return {
    participantId: String(raw.participantId || raw.userId || raw.reviewerId || ""),
    participantRole: String(raw.participantRole || raw.role || ""),
    taskId: String(raw.taskId || ""),
    taskTitle: String(raw.taskTitle || raw.title || ""),
    taskStatus: normalizeStatus(raw.taskStatus || raw.status || raw.result),
    durationMinutes: positiveNumber(raw.durationMinutes ?? raw.durationMs / 60000),
    manualInterventionCount: normalizeArray(raw.manualInterventions || raw.humanInterventions || raw.interventions).length,
    manualInterventions: normalizeArray(raw.manualInterventions || raw.humanInterventions || raw.interventions).map(safeShortText),
    failurePoints: normalizeFailurePoints(raw.failurePoints || raw.failures || raw.defects),
    roleProfile: {
      profileId: String(roleProfile.profileId || roleProfile.id || ""),
      usefulnessScore: scoreOrNull(roleProfile.usefulnessScore ?? roleProfile.score),
      noteHash: hashText(roleProfile.note || roleProfile.reason || ""),
      noteLength: String(roleProfile.note || roleProfile.reason || "").length,
    },
    cost: {
      perceived: normalizeCostPerception(cost.perceived || cost.perception || raw.costPerception),
      totalTokens: positiveNumber(cost.totalTokens ?? cost.tokens),
      estimatedUsd: roundMoney(positiveNumber(cost.estimatedUsd ?? cost.usd)),
      noteHash: hashText(cost.note || ""),
      noteLength: String(cost.note || "").length,
    },
    qualityGate: {
      status: normalizeQualityStatus(qualityGate.status),
      regressions: normalizeRegressions(qualityGate.regressions || qualityGate.failures),
    },
    evidenceRefs: unique(normalizeArray(raw.evidenceRefs || raw.evidence || raw.reportRefs).map(String).filter(Boolean)),
    mustFixBeforeRelease: normalizeArray(raw.mustFixBeforeRelease || raw.mustFix || raw.releaseBlockers).map(safeShortText),
    noteHash: hashText(notes),
    noteLength: notes.length,
    reproductionStepsHash: hashText(reproductionSteps),
    reproductionStepsLength: reproductionSteps.length,
  }
}

function normalizeFailurePoints(input) {
  return normalizeArray(input).map((item) => {
    const value = typeof item === "object" && item !== null ? item : { title: item }
    return {
      severity: normalizeSeverity(value.severity),
      title: safeShortText(value.title || value.summary || "未命名失败点"),
      action: safeShortText(value.action || value.nextAction || ""),
      evidenceRefs: unique(normalizeArray(value.evidenceRefs || value.evidence).map(String).filter(Boolean)),
    }
  })
}

function normalizeRegressions(input) {
  return normalizeArray(input).map((item) => {
    const value = typeof item === "object" && item !== null ? item : { title: item }
    const command = String(value.command || "")
    return {
      severity: normalizeSeverity(value.severity || "P1"),
      title: safeShortText(value.title || value.summary || "质量门回归"),
      commandHash: hashText(command),
      commandLength: command.length,
    }
  })
}

function buildFixQueue({ blockingIssues, p1Issues, qualityGateRegressions, lowRoleProfileUsefulness, highCostConcerns, mustFixBeforeRelease }) {
  const queue = []
  for (const issue of blockingIssues) {
    queue.push({
      category: "blocking-issue",
      severity: "P0",
      title: issue.title,
      participantId: issue.participantId,
      taskId: issue.taskId,
      action: issue.action || "先修复 P0 阻断并补回归证据。",
      evidenceRefs: issue.evidenceRefs || [],
    })
  }
  for (const issue of p1Issues) {
    queue.push({
      category: "pain-point",
      severity: "P1",
      title: issue.title,
      participantId: issue.participantId,
      taskId: issue.taskId,
      action: issue.action || "进入下一轮修复队列。",
      evidenceRefs: issue.evidenceRefs || [],
    })
  }
  for (const regression of qualityGateRegressions) {
    queue.push({
      category: "quality-gate-regression",
      severity: regression.severity,
      title: regression.title,
      participantId: regression.participantId,
      taskId: regression.taskId,
      action: "修复质量门回归并重跑对应 node --test。",
      evidenceRefs: [],
    })
  }
  for (const entry of lowRoleProfileUsefulness) {
    queue.push({
      category: "role-profile",
      severity: "P1",
      title: `${entry.roleProfile.profileId || "role-profile"} 试用评分低于 3`,
      participantId: entry.participantId,
      taskId: entry.taskId,
      action: "调整角色分工提示或降级为人工确认。",
      evidenceRefs: entry.evidenceRefs,
    })
  }
  for (const entry of highCostConcerns) {
    queue.push({
      category: "cost-time",
      severity: "P1",
      title: "试用者感知成本或耗时过高",
      participantId: entry.participantId,
      taskId: entry.taskId,
      action: "压缩上下文、明确止损阈值，回归成本统计。",
      evidenceRefs: entry.evidenceRefs,
    })
  }
  queue.push(...mustFixBeforeRelease)
  return queue.sort((a, b) => severityWeight(a.severity) - severityWeight(b.severity))
}

function buildDecisionReasons(conditions, counts) {
  const reasons = []
  if (!conditions.enoughParticipants) reasons.push("不足 3 位真实试用者。")
  if (counts.failedTasks || counts.blockedTasks) reasons.push(`仍有失败/阻断任务：failed=${counts.failedTasks} blocked=${counts.blockedTasks}。`)
  if (counts.blockingIssues.length) reasons.push(`存在 ${counts.blockingIssues.length} 个 P0 阻断。`)
  if (counts.qualityGateRegressions.length) reasons.push(`存在 ${counts.qualityGateRegressions.length} 个质量门回归。`)
  if (counts.lowRoleProfileUsefulness.length) reasons.push("角色 profile 试用价值评分低。")
  if (counts.highCostConcerns.length) reasons.push("成本或耗时被试用者标记过高。")
  if (!conditions.evidenceRefsPresent) reasons.push("部分反馈缺少 evidenceRefs。")
  return reasons.length ? reasons : ["三人试用均通过，未发现阻断回归。"]
}

function buildGaps(conditions) {
  const gaps = []
  if (!conditions.enoughParticipants) gaps.push(gap("trial_feedback_participants", "三人试用反馈不足", "至少补齐 3 位不同试用者的反馈。", "high"))
  if (!conditions.everyParticipantHasTaskResult) gaps.push(gap("trial_feedback_task_result", "试用任务结果不完整", "每位试用者都需要 taskId 和 taskStatus。", "high"))
  if (!conditions.noBlockingIssues) gaps.push(gap("trial_feedback_p0", "存在 P0 阻断反馈", "先修复 P0，再回归三人试用。", "high"))
  if (!conditions.noQualityGateRegressions) gaps.push(gap("trial_feedback_quality_gate", "存在质量门回归", "修复并重跑对应质量门测试。", "high"))
  if (!conditions.roleProfilesUseful) gaps.push(gap("trial_feedback_role_profile", "角色 profile 评价偏低", "调整角色分工或增加人工确认。", "medium"))
  if (!conditions.costTimeAcceptable) gaps.push(gap("trial_feedback_cost_time", "成本或耗时不可接受", "压缩上下文并设定止损阈值。", "medium"))
  if (!conditions.evidenceRefsPresent) gaps.push(gap("trial_feedback_evidence_refs", "反馈缺少证据引用", "补充 run/report/quality/cost evidenceRefs。", "high"))
  return gaps
}

function buildPainPoints(entries) {
  return entries.flatMap((entry) =>
    entry.failurePoints.map((point) => ({
      participantId: entry.participantId,
      taskId: entry.taskId,
      severity: point.severity,
      title: point.title,
      action: point.action,
      evidenceRefs: point.evidenceRefs,
    })),
  )
}

function buildMarkdown(report) {
  return [
    "# Agent 工作台 Day 13-14 三人试用反馈闭环",
    "",
    `- 状态：${report.statusLabel}`,
    `- Release decision：${report.releaseDecision.status}`,
    `- 试用者：${report.summary.participants}，反馈 ${report.summary.feedbackEntries} 条`,
    `- 任务：passed ${report.summary.passedTasks} / failed ${report.summary.failedTasks} / blocked ${report.summary.blockedTasks}`,
    `- 人工介入：${report.summary.manualInterventions} 次，耗时 ${report.summary.totalDurationMinutes} 分钟`,
    `- Role profile 平均评分：${report.summary.averageRoleProfileUsefulness == null ? "-" : report.summary.averageRoleProfileUsefulness}`,
    `- 成本：tokens ${report.summary.totalTokens}，estimatedUsd ${report.summary.estimatedUsd}`,
    "",
    "## Stop / Go",
    "",
    ...Object.entries(report.stopGo.conditions).map(([key, value]) => `- ${key}: ${value ? "YES" : "NO"}`),
    "",
    "## 下一轮修复队列",
    "",
    ...(report.fixQueue.length
      ? report.fixQueue.map((item) => `- ${item.severity} ${item.category} ${item.title}：${item.action}`)
      : ["- 暂无必须修复项。"]),
  ].join("\n")
}

function gap(id, title, action, severity = "medium") {
  return { id, title, severity, action }
}

function normalizeStatus(status) {
  const value = String(status || "").toLowerCase()
  if (value === "passed" || value === "failed" || value === "blocked") return value
  return "blocked"
}

function normalizeQualityStatus(status) {
  const value = String(status || "").toLowerCase()
  if (value === "passed" || value === "failed" || value === "skipped") return value
  return "skipped"
}

function normalizeSeverity(severity) {
  const value = String(severity || "").toUpperCase()
  if (value === "P0" || value === "P1" || value === "P2") return value
  return "P2"
}

function normalizeCostPerception(value) {
  const text = String(value || "").toLowerCase()
  if (text === "acceptable" || text === "high-but-acceptable" || text === "too-high") return text
  return "unknown"
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item != null)
  if (value == null || value === "") return []
  return [value]
}

function safeShortText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 160)
}

function positiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function scoreOrNull(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.max(1, Math.min(5, number))
}

function hashText(value) {
  const text = String(value || "")
  if (!text) return ""
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0)
}

function average(values) {
  if (!values.length) return null
  return Number((sum(values) / values.length).toFixed(2))
}

function roundMoney(value) {
  return Number((Number(value || 0)).toFixed(2))
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)))
}

function severityWeight(severity) {
  if (severity === "P0") return 0
  if (severity === "P1") return 1
  return 2
}

module.exports = {
  buildTrialFeedbackSummary,
  normalizeTrialFeedback,
}
