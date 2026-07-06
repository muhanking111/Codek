const CATALOG = Object.freeze({
  quality_gate: {
    category: "quality_gate",
    title: "质量门失败",
    severity: "high",
    summary: "生成的 patch 未通过配置的质量门，需要先修复语法、类型或测试失败。",
    actions: [
      "打开质量门失败命令和错误摘要",
      "要求实现 Agent 先修复最小失败文件",
      "重新运行同一质量门后再允许 Accept",
    ],
  },
  integration_conflict: {
    category: "integration_conflict",
    title: "并发集成冲突",
    severity: "high",
    summary: "多个 assignment 修改同一文件或同一区域，Integrator 已阻断直接应用。",
    actions: [
      "查看冲突文件和 assignment 来源",
      "选择一个主方案或要求 Integrator 合并方案",
      "合并后重新生成 proposed patch 并再次验收",
    ],
  },
  extension_conflict: {
    category: "extension_conflict",
    title: "扩展版本冲突",
    severity: "high",
    summary: "多个扩展来源同时修改同一 manifest 或版本策略，需要人工确认最终来源。",
    actions: [
      "确认优先使用内置、用户安装还是 marketplace 版本",
      "保留一个 manifest 来源并记录冲突原因",
      "重新扫描 Extension Host 激活报告",
    ],
  },
  requirement_ambiguity: {
    category: "requirement_ambiguity",
    title: "需求不清",
    severity: "medium",
    summary: "任务范围不足以安全执行，应先进入 Ask/Plan 补齐目标、边界和验收标准。",
    actions: [
      "向用户追问目标、文件范围和验收方式",
      "先生成 PlanTree，不直接进入执行",
      "补齐约束后再让 Agent Router 选择策略",
    ],
  },
  destructive_permission: {
    category: "destructive_permission",
    title: "高风险权限请求",
    severity: "critical",
    summary: "任务包含删除、安装、联网、外部工具或破坏性操作，必须等待显式授权。",
    actions: [
      "展示沙箱权限请求和风险原因",
      "把破坏性步骤拆成可审查的小步骤",
      "未授权前保持 waiting_user，不执行命令",
    ],
  },
  permission_scope: {
    category: "permission_scope",
    title: "写入范围越界",
    severity: "critical",
    summary: "patch 尝试写入未授权路径，主工作区保护已阻断应用。",
    actions: [
      "对比 proposed patch 文件和授权 writePaths",
      "缩小 patch 到允许路径或重新申请权限",
      "确认主工作区未被越界写入后再继续",
    ],
  },
  recovery_flow: {
    category: "recovery_flow",
    title: "长任务恢复链路",
    severity: "medium",
    summary: "长任务需要 checkpoint/resume/recovery action 证据，避免后台运行中断后不可复盘。",
    actions: [
      "确认最近 checkpoint 可恢复",
      "优先执行 retry/rewind 等可审计恢复动作",
      "检查恢复 artifact 和 decision audit 是否生成",
    ],
  },
  router_misalignment: {
    category: "router_misalignment",
    title: "路由策略不匹配",
    severity: "medium",
    summary: "Router 推荐策略与真实胜出策略不一致，需要调整单 Agent / 多 Agent 权重。",
    actions: [
      "检查文件数量、风险和冲突信号",
      "根据真实胜出策略调整 Router Calibration",
      "保留 candidate router 影子评测后再切换默认策略",
    ],
  },
})

function recommendationForCategory(category, details = {}) {
  const base = CATALOG[category] || CATALOG.router_misalignment
  return {
    ...base,
    details: sanitizeDetails(details),
  }
}

function classifyScenarioFailure(scenario = {}) {
  if (scenario.failureRecommendation) return scenario.failureRecommendation
  const id = String(scenario.id || "")
  const fixtureType = String(scenario.fixtureType || scenario.task?.fixtureType || "")
  const status = String(scenario.status || "")
  const qualityGateStatus = String(scenario.qualityGateStatus || "")
  const conflictCount = Number(scenario.conflictCount || 0)
  if (id === "permission_scope_violation" || scenario.permissionRequest?.violation) {
    return recommendationForCategory("permission_scope", {
      scenario: id,
      filesChanged: scenario.filesChanged,
      writePaths: scenario.permissionRequest?.writePaths,
    })
  }
  if (id === "destructive_request_blocked" || scenario.permissionRequest?.destructive) {
    return recommendationForCategory("destructive_permission", {
      scenario: id,
      permissionStatus: scenario.permissionRequest?.status,
    })
  }
  if (id === "ambiguous_requirement") {
    return recommendationForCategory("requirement_ambiguity", { scenario: id })
  }
  if (fixtureType === "extension-conflict" || id === "extension_conflict_blocked") {
    return recommendationForCategory("extension_conflict", {
      scenario: id,
      conflictCount,
      filesChanged: scenario.filesChanged,
    })
  }
  if (conflictCount > 0 || id === "conflict_blocked") {
    return recommendationForCategory("integration_conflict", {
      scenario: id,
      conflictCount,
      filesChanged: scenario.filesChanged,
    })
  }
  if (qualityGateStatus === "failed" || Number(scenario.qualityGateFailures || 0) > 0) {
    return recommendationForCategory("quality_gate", {
      scenario: id,
      qualityGateStatus,
      qualityGateFailures: scenario.qualityGateFailures,
    })
  }
  if (scenario.recoveryAction || scenario.checkpoint || id === "long_background_recovery") {
    return recommendationForCategory("recovery_flow", {
      scenario: id,
      action: scenario.recoveryAction?.action,
      checkpointResumed: scenario.checkpoint?.resumed,
    })
  }
  if (status === "blocked" || status === "waiting_user") {
    return recommendationForCategory("router_misalignment", {
      scenario: id,
      status,
    })
  }
  return null
}

function classifyComparisonFailure(input = {}) {
  const summary = input.summary || input.realRunComparison?.summary || input
  const fixtureTypes = Array.isArray(summary.fixtureTypes) ? summary.fixtureTypes : []
  if (fixtureTypes.includes("extension-conflict") || Number(summary.totalConflicts || 0) > 0) {
    return recommendationForCategory(
      fixtureTypes.includes("extension-conflict") ? "extension_conflict" : "integration_conflict",
      { fixtureTypes, conflicts: summary.totalConflicts },
    )
  }
  if (Number(summary.totalQualityGateFailures || 0) > 0) {
    return recommendationForCategory("quality_gate", {
      fixtureTypes,
      qualityGateFailures: summary.totalQualityGateFailures,
    })
  }
  const recommended = input.recommendedStrategy
  const actual = input.actualStrategy
  const winner = summary.winner || input.realWinner
  if (winner && (winner !== recommended || winner !== actual)) {
    return recommendationForCategory("router_misalignment", { fixtureTypes, winner, recommended, actual })
  }
  return null
}

function summarizeFailureRecommendations(items = []) {
  const recommendations = items
    .map((item) => item?.failureRecommendation || classifyScenarioFailure(item) || classifyComparisonFailure(item))
    .filter(Boolean)
  const byCategory = {}
  const bySeverity = {}
  for (const item of recommendations) {
    byCategory[item.category] = (byCategory[item.category] || 0) + 1
    bySeverity[item.severity] = (bySeverity[item.severity] || 0) + 1
  }
  return {
    total: recommendations.length,
    byCategory,
    bySeverity,
    items: recommendations,
  }
}

function sanitizeDetails(details = {}) {
  const output = {}
  for (const [key, value] of Object.entries(details || {})) {
    if (value == null) continue
    if (Array.isArray(value)) output[key] = value.map((item) => String(item)).slice(0, 12)
    else if (typeof value === "object") output[key] = JSON.parse(JSON.stringify(value))
    else output[key] = value
  }
  return output
}

module.exports = {
  CATALOG,
  classifyComparisonFailure,
  classifyScenarioFailure,
  recommendationForCategory,
  summarizeFailureRecommendations,
}
