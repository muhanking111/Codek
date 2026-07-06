function asArray(value) {
  return Array.isArray(value) ? value : []
}

function passed(checks, id) {
  return asArray(checks).some((check) => check?.id === id && check.passed === true)
}

function failedChecks(checks) {
  return asArray(checks).filter((check) => check && check.passed !== true)
}

function buildDeliveryTrustSummary(input = {}) {
  const checks = asArray(input.checks)
  const run = input.run || {}
  const router = input.routerDecision || {}
  const task = input.task || {}
  const qualityGate = input.qualityGate || input.decision?.qualityGate || null
  const risks = []
  const evidence = []
  let score = 0

  const strategyOk = router.executionStrategy
    ? router.executionStrategy === (task.expectedStrategy || run.executionStrategy || router.executionStrategy)
    : Boolean(run.executionStrategy)
  if (strategyOk) {
    score += 15
    evidence.push("Router 已给出执行策略并符合任务预期")
  } else {
    risks.push("Router 策略与任务预期不一致，需要人工复核")
  }

  if (Number(run.phaseCount || 0) > 0 && Number(run.assignmentCount || 0) > 0) {
    score += 15
    evidence.push(`已生成 ${run.phaseCount || 0} 个阶段和 ${run.assignmentCount || 0} 个 Agent assignment`)
  } else {
    risks.push("缺少 PlanTree 或 Agent assignment 证据")
  }

  if (passed(checks, "long_task_workspace_isolated") || input.workspaceIsolated === true) {
    score += 15
    evidence.push("Agent 在隔离 workspace 中执行")
  } else {
    risks.push("未确认 workspace 隔离")
  }

  const filesChanged = asArray(run.filesChanged)
  if (filesChanged.length > 0) {
    score += 15
    evidence.push(`产生 ${filesChanged.length} 个文件变更`)
  } else {
    risks.push("没有可审查的文件变更")
  }

  if (passed(checks, "long_task_waits_for_user") || input.waitedForUser === true) {
    score += 15
    evidence.push("写入主工作区前存在用户确认点")
  } else {
    risks.push("缺少写入主工作区前的确认点证据")
  }

  if (passed(checks, "long_task_quality_gate_passed") || qualityGate?.status === "passed") {
    score += 15
    evidence.push("质量门已通过")
  } else if (qualityGate?.status === "failed") {
    risks.push("质量门失败，不能直接接受")
  } else {
    risks.push("缺少质量门通过证据")
  }

  if (passed(checks, "long_task_main_project_updated") || input.acceptVerified === true) {
    score += 10
    evidence.push("Accept 后主项目变更符合预期")
  } else {
    risks.push("缺少 Accept 后变更验证")
  }

  const failed = failedChecks(checks)
  if (failed.length > 0) {
    score = Math.min(score, 69)
    risks.push(`仍有 ${failed.length} 个检查未通过`)
  }

  const status = score >= 90 && risks.length === 0
    ? "trusted"
    : score >= 70
      ? "review"
      : "blocked"
  const statusLabel = status === "trusted"
    ? "可信，可进入 Accept"
    : status === "review"
      ? "需要复核后再 Accept"
      : "阻断，先处理风险"
  const nextAction = status === "trusted"
    ? "可以接受变更，保留回滚能力并归档报告"
    : status === "review"
      ? "先复核风险项、diff 和质量门，再决定 Accept 或 Rework"
      : "不要 Accept，先按风险项修复或要求 Agent 返工"

  return {
    score,
    status,
    statusLabel,
    nextAction,
    evidence,
    risks,
    failedChecks: failed.map((check) => ({
      id: check.id,
      label: check.label || "",
    })),
    summary: `${statusLabel}。${nextAction}`,
  }
}

module.exports = {
  buildDeliveryTrustSummary,
}
