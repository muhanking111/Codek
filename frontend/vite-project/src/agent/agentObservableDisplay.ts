import type {
  AgentArtifact,
  CommandAuthorizationSummary,
  OrchestratorEvent,
  OrchestratorRun,
  ProposedPatch,
  RecoveryAction,
} from "./orchestratorClient"

export type AgentObservableSeverity = "info" | "success" | "warning" | "danger"

export interface AgentObservableSummary {
  title: string
  statusLabel: string
  detail: string
  nextAction: string
  severity: AgentObservableSeverity
}

export interface AgentObservableRow {
  id: string
  kind: string
  label: string
  statusLabel: string
  detail: string
  nextAction?: string
  severity: AgentObservableSeverity
}

export interface AgentObservableDisplay {
  summary: AgentObservableSummary
  statusBadges: AgentObservableRow[]
  stageRows: AgentObservableRow[]
  activityRows: AgentObservableRow[]
  actionRows: AgentObservableRow[]
}

export interface BuildAgentObservableDisplayInput {
  run: OrchestratorRun | null
  events?: OrchestratorEvent[]
  commandAuthorization?: CommandAuthorizationSummary | null
  recoveryActions?: RecoveryAction[]
  artifacts?: AgentArtifact[]
  diff?: ProposedPatch | null
}

export function buildAgentObservableDisplay(input: BuildAgentObservableDisplayInput): AgentObservableDisplay {
  const run = input.run
  if (!run) {
    return {
      summary: {
        title: "未选择智能体任务",
        statusLabel: "未开始",
        detail: "选择一个任务后，这里会显示当前阶段、命令、文件操作、质量门和恢复状态。",
        nextAction: "从任务列表选择一条运行记录，或从智能助手发起智能体/自动任务。",
        severity: "info",
      },
      statusBadges: [],
      stageRows: [],
      activityRows: [],
      actionRows: [],
    }
  }

  const allEvents = mergeEvents(run.events || [], input.events || [])
  const qualityGate = run.integrationDecision?.qualityGate || null
  const recoveryActions = input.recoveryActions || []
  const commandAuthorization = input.commandAuthorization || null
  const diff = input.diff || run.integrationDecision?.proposedPatch || null
  const artifacts = input.artifacts || []
  const memoryHits = run.memoryHits || []
  const runStatus = String(run.runtimeStatus || run.status || "unknown")
  const summary = buildSummary(run, {
    hasWaitingPermission: run.permissionRequest?.status === "waiting_user",
    hasQualityGateFailure: qualityGate?.status === "failed" || qualityGate?.commandResults?.some((item) => Number(item.exitCode) !== 0),
    hasPendingRecovery: recoveryActions.some((action) => !isTerminalRecovery(action.status)),
  })

  const statusBadges: AgentObservableRow[] = [
    row("status", "状态", "运行状态", formatStatusLabel(runStatus), localizeAgentDisplayText(run.runtimeReason || run.blockingReason || run.summary || "任务状态已同步。"), "", severityForStatus(runStatus)),
    row("strategy", "路由", "执行策略", run.executionStrategy === "multi-agent" ? "多智能体" : "单智能体", localizeAgentDisplayText(run.strategyReason || "路由原因未记录。"), "", "info"),
    row("mode", "模式", "用户模式", formatVisibleMode(run.visibleMode), "决定本次任务是只读、计划、执行还是自动处理。", "", "info"),
  ]

  const stageRows = buildStageRows(run)
  const activityRows = [
    ...buildMemoryRows(memoryHits),
    ...buildPermissionRows(run),
    ...buildCommandRows(commandAuthorization),
    ...buildQualityGateRows(qualityGate),
    ...buildEventRows(allEvents),
    ...buildDiffRows(diff),
    ...buildArtifactRows(artifacts),
  ].slice(0, 16)
  const actionRows = buildActionRows(run, recoveryActions, qualityGate)

  return {
    summary,
    statusBadges,
    stageRows,
    activityRows,
    actionRows,
  }
}

function buildSummary(
  run: OrchestratorRun,
  flags: { hasWaitingPermission: boolean; hasQualityGateFailure: boolean; hasPendingRecovery: boolean },
): AgentObservableSummary {
  const status = String(run.runtimeStatus || run.status || "unknown")
  if (flags.hasWaitingPermission) {
    return {
      title: "智能体等待权限确认",
      statusLabel: "等待确认",
      detail: localizeAgentDisplayText(run.permissionRequest?.reason || "当前任务需要用户确认权限后才能继续。"),
      nextAction: "检查读写路径、命令和网络/安装权限，然后选择允许或拒绝。",
      severity: "warning",
    }
  }
  if (flags.hasQualityGateFailure) {
    return {
      title: "智能体质量门未通过",
      statusLabel: "需处理",
      detail: localizeAgentDisplayText(run.integrationDecision?.qualityGate?.summary || "质量门命令失败，任务不能直接交付。"),
      nextAction: "查看失败命令输出，修复后重试质量门或执行恢复动作。",
      severity: "danger",
    }
  }
  if (flags.hasPendingRecovery) {
    return {
      title: "智能体等待恢复动作",
      statusLabel: "恢复中",
      detail: localizeAgentDisplayText(run.recoveryRecommendation?.reason || run.blockingReason || "当前任务已生成恢复动作。"),
      nextAction: "选择重试、拆分、澄清或终止，恢复动作会写入任务记录。",
      severity: "warning",
    }
  }
  if (["completed", "applied"].includes(status)) {
    return {
      title: "智能体任务已完成",
      statusLabel: "已完成",
      detail: localizeAgentDisplayText(run.summary || run.integrationDecision?.reason || "任务已经完成，证据可在下方查看。"),
      nextAction: "复核变更、质量门、产物和任务报告，确认是否接受交付。",
      severity: "success",
    }
  }
  if (["failed", "blocked", "interrupted"].includes(status)) {
    return {
      title: "智能体任务已阻断",
      statusLabel: formatStatusLabel(status),
      detail: localizeAgentDisplayText(run.blockingReason || run.runtimeReason || "任务未能继续执行。"),
      nextAction: "查看失败原因和恢复动作，必要时回退到检查点。",
      severity: "danger",
    }
  }
  return {
    title: "智能体正在处理任务",
    statusLabel: formatStatusLabel(status),
    detail: localizeAgentDisplayText(run.runtimeReason || run.strategyReason || "任务正在运行，关键活动会实时显示在这里。"),
    nextAction: "观察当前阶段、文件操作、命令和质量门；需要时可暂停或刷新。",
    severity: "info",
  }
}

function buildStageRows(run: OrchestratorRun): AgentObservableRow[] {
  const assignments = run.assignments || []
  const runningAssignments = assignments.filter((assignment) => isActiveStatus(assignment.status))
  const rows: AgentObservableRow[] = [
    row(
      "current-stage",
      "stage",
      "当前阶段",
      formatStatusLabel(run.runtimeStatus || run.status),
      localizeAgentDisplayText(run.runtimeReason || run.blockingReason || "等待智能体运行时刷新阶段原因。"),
      "阶段变化会同步到时间线和任务报告。",
      severityForStatus(run.runtimeStatus || run.status),
    ),
    row(
      "running-agents",
      "agent",
      "运行中的智能体",
      `${runningAssignments.length}/${assignments.length}`,
      assignments.length
        ? assignments.map((assignment) => `${formatAgentRole(assignment.role)}:${formatStatusLabel(assignment.status)}`).join("，")
        : "当前任务没有分配智能体。",
      "多智能体任务会显示每个子智能体的角色、阶段和沙箱。",
      runningAssignments.length > 0 ? "info" : "success",
    ),
  ]

  for (const assignment of assignments.slice(0, 8)) {
    const writePaths = formatList(assignment.writePaths)
    const consensus = assignment.requiresConsensus
      ? ` · 需要共识 ${formatList(assignment.consensusWith)}`
      : assignment.consensusForStepId
        ? ` · 验证阶段 ${assignment.consensusForStepId}`
        : ""
    rows.push(row(
      `assignment-${assignment.id}`,
      "assignment",
      `${formatAgentRole(assignment.role)} / ${formatPhaseLabel(assignment.phaseId)}`,
      formatStatusLabel(assignment.status),
      `沙箱 ${assignment.sandboxMode || "默认"} · 写入 ${writePaths}${consensus}`,
      assignment.lockedFiles?.length ? `锁定文件：${formatList(assignment.lockedFiles)}` : "可在下方查看该智能体产生的变更和产物。",
      severityForStatus(assignment.status),
    ))
  }
  return rows
}

function buildMemoryRows(memoryHits: NonNullable<OrchestratorRun["memoryHits"]>): AgentObservableRow[] {
  if (!memoryHits.length) return []
  const rows = [
    row(
      "memory-summary",
      "memory",
      "记忆命中",
      `${memoryHits.length} 条`,
      memoryHits.slice(0, 3).map((hit) => `${hit.type}${hit.agentRole ? `/${hit.agentRole}` : ""}`).join("，"),
      "命中记忆会作为智能体上下文，但不会替代本次真实验证。",
      "info",
    ),
  ]
  for (const hit of memoryHits.slice(0, 4)) {
    rows.push(row(
      `memory-${hit.id}`,
      "memory",
      "记忆",
      hit.type,
      trimText(hit.content, 140),
      hit.source ? `来源：${hit.source}${hit.agentRole ? ` · ${hit.agentRole}` : ""}` : "本次上下文命中。",
      "info",
    ))
  }
  return rows
}

function buildPermissionRows(run: OrchestratorRun): AgentObservableRow[] {
  const permission = run.permissionRequest
  if (!permission) return []
  return [row(
    `permission-${permission.id}`,
    "approval",
    "权限请求",
    formatPermissionStatus(permission.status),
    `风险 ${permission.risk || "未记录"} · 写入 ${formatList(permission.writePaths)} · 命令 ${formatList(permission.commandAllowlist)}`,
    permission.status === "waiting_user" ? "等待用户确认后，智能体才能继续执行。" : permission.decisionReason || "权限请求已记录到审计链。",
    permission.status === "waiting_user" ? "warning" : permission.status === "rejected" ? "danger" : "success",
  )]
}

function buildCommandRows(summary: CommandAuthorizationSummary | null): AgentObservableRow[] {
  if (!summary) return []
  const rows = [
    row(
      "command-auth-summary",
      "terminal",
      "命令授权",
      summary.ok ? "已通过" : "需处理",
      `${summary.allowed} 个允许，${summary.blocked} 个阻断，${summary.needsPermission} 个需授权`,
      summary.ok ? "命令可进入质量门或运行阶段。" : "处理被阻断或需要授权的命令后再继续。",
      summary.ok ? "success" : "warning",
    ),
  ]
  for (const item of summary.commands.slice(0, 6)) {
    rows.push(row(
      `command-${item.command}`,
      "terminal",
      "终端命令",
      formatCommandStatus(item.status),
      item.command,
      item.reasons?.length ? item.reasons.join("；") : formatCommandCapabilities(item.capabilities),
      item.status === "blocked" ? "danger" : item.status === "needs_permission" ? "warning" : "success",
    ))
  }
  return rows
}

function buildQualityGateRows(qualityGate: OrchestratorRun["integrationDecision"] extends infer T
  ? T extends { qualityGate?: infer Q } ? Q : never
  : never): AgentObservableRow[] {
  if (!qualityGate) return []
  const gate = qualityGate as NonNullable<NonNullable<OrchestratorRun["integrationDecision"]>["qualityGate"]>
  const failed = gate.status === "failed" || gate.commandResults?.some((item) => Number(item.exitCode) !== 0)
  const rows = [
    row(
      "quality-gate",
      "quality",
      "质量门",
      failed ? "未通过" : formatStatusLabel(gate.status),
      gate.summary || "质量门状态已记录。",
      failed ? "修复失败命令后重跑质量门，不能直接标记交付。" : "质量门通过后可以进入交付复核。",
      failed ? "danger" : gate.status === "passed" ? "success" : "info",
    ),
  ]
  for (const result of (gate.commandResults || []).slice(0, 5)) {
    const failedCommand = Number(result.exitCode) !== 0
    rows.push(row(
      `quality-command-${result.command}`,
      "quality",
      "质量门命令",
      failedCommand ? `失败 ${result.exitCode}` : "通过",
      result.command,
      failedCommand ? trimText(result.stderr || result.stdout || "查看命令输出定位失败原因。") : `耗时 ${result.durationMs || 0}ms`,
      failedCommand ? "danger" : "success",
    ))
  }
  return rows
}

function buildEventRows(events: OrchestratorEvent[]): AgentObservableRow[] {
  return events.slice(-8).reverse().map((event, index) => {
    const type = String(event.type || "event")
    if (type === "command-executed") {
      return row(`event-${event.id || index}`, "terminal", "终端命令", formatStatusLabel(event.status), getString(event, "command") || "命令未记录", event.error || "命令事件已记录。", severityForStatus(event.status))
    }
    if (type === "file-changed" || type === "workspace-file-operation") {
      return row(`event-${event.id || index}`, "file", "文件操作", formatStatusLabel(event.status), getString(event, "path") || getString(event, "file") || "路径未记录", getString(event, "operation") || "文件变更已同步。", severityForStatus(event.status))
    }
    if (type === "diff-available") {
      return row(`event-${event.id || index}`, "diff", "变更可查看", formatStatusLabel(event.status || "ready"), getString(event, "summary") || "智能体已生成变更预览。", "打开变更面板复核补丁。", "info")
    }
    return row(`event-${event.id || index}`, "event", formatEventType(type), formatStatusLabel(event.status), event.error || getString(event, "message") || "事件已记录。", "查看时间线获取完整上下文。", severityForStatus(event.status))
  })
}

function buildDiffRows(diff: ProposedPatch | null): AgentObservableRow[] {
  if (!diff) return []
  return [row(
    "diff-summary",
    "diff",
    "变更预览",
    `${diff.filesChanged?.length || 0} 个文件`,
    diff.summary || formatList(diff.filesChanged),
    "复核每个文件的 patch、风险和权限后再接受。",
    "info",
  )]
}

function buildArtifactRows(artifacts: AgentArtifact[]): AgentObservableRow[] {
  if (!artifacts.length) return []
  return [row(
    "artifact-summary",
    "artifact",
    "交付证据",
    `${artifacts.length} 个产物`,
    artifacts.slice(0, 4).map((artifact) => artifact.path || artifact.type).join("，"),
    "打开产物面板查看补丁、报告或运行证据。",
    "success",
  )]
}

function buildActionRows(
  run: OrchestratorRun,
  recoveryActions: RecoveryAction[],
  qualityGate: NonNullable<OrchestratorRun["integrationDecision"]>["qualityGate"] | null,
): AgentObservableRow[] {
  const rows: AgentObservableRow[] = []
  if (run.permissionRequest?.status === "waiting_user") {
    rows.push(row("action-permission", "approval", "下一步", "等待权限", "需要先处理权限请求。", "确认允许或拒绝后，智能体运行时会继续或停止。", "warning"))
  }
  if (qualityGate?.status === "failed") {
    rows.push(row("action-quality", "quality", "修复质量门", "需处理", "质量门失败阻止交付。", "查看失败命令输出，修复后重跑或选择恢复动作。", "danger"))
  }
  for (const action of recoveryActions.slice(0, 6)) {
    rows.push(row(
      `recovery-${action.id}`,
      "recovery",
      formatRecoveryAction(action.action),
      formatStatusLabel(action.status),
      localizeAgentDisplayText(action.reason || "恢复动作已生成。"),
      formatRecoveryNextAction(action),
      isTerminalRecovery(action.status) ? "success" : action.action === "abort" ? "danger" : "warning",
    ))
  }
  if (!rows.length) {
    rows.push(row("action-observe", "next", "下一步", "继续观察", "当前没有阻断动作。", "继续观察文件操作、命令、质量门和 diff 证据。", "info"))
  }
  return rows
}

function row(
  id: string,
  kind: string,
  label: string,
  statusLabel: string,
  detail: string,
  nextAction: string,
  severity: AgentObservableSeverity,
): AgentObservableRow {
  return {
    id,
    kind,
    label,
    statusLabel,
    detail: localizeAgentDisplayText(detail),
    nextAction: localizeAgentDisplayText(nextAction),
    severity,
  }
}

function localizeAgentDisplayText(value: unknown): string {
  return String(value || "")
    .replace(/\bmulti Agent\b/gi, "多智能体")
    .replace(/\bsingle Agent\b/gi, "单智能体")
    .replace(/多\s*Agent/g, "多智能体")
    .replace(/单\s*Agent/g, "单智能体")
    .replace(/Agent\s*runtime/gi, "智能体运行时")
    .replace(/\bAgent\b/g, "智能体")
    .replace(/\bAuto\b/g, "自动")
    .replace(/\bPlan\b/g, "计划")
}

function mergeEvents(left: OrchestratorEvent[], right: OrchestratorEvent[]): OrchestratorEvent[] {
  const seen = new Set<string>()
  const merged: OrchestratorEvent[] = []
  for (const event of [...left, ...right]) {
    const key = event.id || `${event.type}:${event.createdAt}:${getString(event, "path")}:${getString(event, "command")}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(event)
  }
  return merged.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
}

function isActiveStatus(status?: string): boolean {
  return ["running", "queued", "pending", "verifying", "recovering"].includes(String(status || "").toLowerCase())
}

function isTerminalRecovery(status?: string): boolean {
  return ["completed", "cancelled", "failed"].includes(String(status || "").toLowerCase())
}

function formatVisibleMode(mode?: string): string {
  if (mode === "ask") return "问答"
  if (mode === "plan") return "计划"
  if (mode === "agent") return "智能体"
  if (mode === "auto") return "自动"
  return mode || "未记录"
}

function formatStatusLabel(status?: string): string {
  const value = String(status || "").toLowerCase()
  if (value === "queued") return "排队中"
  if (value === "pending") return "等待中"
  if (value === "running") return "运行中"
  if (value === "planning") return "规划中"
  if (value === "applying") return "写入中"
  if (value === "verifying") return "验证中"
  if (value === "waiting_user") return "等待确认"
  if (value === "waiting_permission") return "等待权限"
  if (value === "waiting_decision") return "等待审批"
  if (value === "recovering") return "恢复中"
  if (value === "blocked") return "已阻断"
  if (value === "interrupted") return "已中断"
  if (value === "failed") return "失败"
  if (value === "completed") return "已完成"
  if (value === "passed") return "已通过"
  if (value === "ready") return "就绪"
  if (value === "approved") return "已允许"
  if (value === "rejected") return "已拒绝"
  if (value === "allowed") return "已允许"
  if (value === "needs_permission") return "需授权"
  return status || "未记录"
}

function formatPermissionStatus(status?: string): string {
  if (status === "waiting_user") return "等待用户确认"
  return formatStatusLabel(status)
}

function formatCommandStatus(status?: string): string {
  if (status === "allowed") return "已允许"
  if (status === "blocked") return "已阻断"
  if (status === "needs_permission") return "需授权"
  return formatStatusLabel(status)
}

function formatCommandCapabilities(capabilities?: { network?: boolean; install?: boolean; externalTool?: boolean }): string {
  const labels = []
  if (capabilities?.network) labels.push("网络")
  if (capabilities?.install) labels.push("安装")
  if (capabilities?.externalTool) labels.push("外部工具")
  return labels.length ? `能力：${labels.join("、")}` : "本地安全命令"
}

function formatRecoveryAction(action: RecoveryAction["action"]): string {
  if (action === "retry") return "重试当前阶段"
  if (action === "rewind") return "回退到上一步"
  if (action === "split") return "拆分任务"
  if (action === "ask_user") return "向用户澄清"
  if (action === "abort") return "终止任务"
  return action
}

function formatRecoveryNextAction(action: RecoveryAction): string {
  if (action.status === "running") return "恢复动作正在执行，等待状态刷新。"
  if (action.status === "completed") return "恢复结果已写入任务记录。"
  if (action.action === "ask_user") return "执行后会向用户提出澄清问题。"
  if (action.action === "split") return "执行后会把任务拆成更小阶段。"
  if (action.action === "abort") return "执行后会停止任务并保留证据。"
  return "执行后会刷新任务状态、时间线和产物。"
}

function formatEventType(type: string): string {
  const normalized = type.replace(/[:_\s]+/g, "-").toLowerCase()
  const map: Record<string, string> = {
    "orchestrator-recovered": "编排器已恢复",
    "orchestrator-recovered-interrupted": "编排器恢复中断",
    "orchestrator-strategy-selected": "已选择执行策略",
    "checkpoint-saved": "检查点已保存",
    "checkpoint-resumed": "已从检查点恢复",
    "permission-requested": "权限请求",
    "permission-resolved": "权限已处理",
    "quality-gate-started": "质量门开始",
    "quality-gate-completed": "质量门完成",
    "recovery-action-started": "恢复动作开始",
    "recovery-action-completed": "恢复动作完成",
  }
  return map[normalized] || "任务事件"
}

function formatAgentRole(role?: string): string {
  const value = String(role || "").toLowerCase()
  if (!value) return "智能体"
  const map: Record<string, string> = {
    implementer: "实现智能体",
    coder: "编码智能体",
    tester: "测试智能体",
    reviewer: "审查智能体",
    planner: "规划智能体",
    integrator: "集成智能体",
  }
  return map[value] || role || "智能体"
}

function formatPhaseLabel(phaseId?: string): string {
  const value = String(phaseId || "").trim()
  if (!value) return "阶段"
  return value
    .replace(/^phase[-_:]?/i, "阶段 ")
    .replace(/[-_]+/g, " ")
}

function severityForStatus(status?: string): AgentObservableSeverity {
  const value = String(status || "").toLowerCase()
  if (["failed", "blocked", "rejected", "interrupted"].includes(value)) return "danger"
  if (["waiting_user", "waiting_permission", "waiting_decision", "needs_permission", "recovering"].includes(value)) return "warning"
  if (["completed", "passed", "approved", "allowed", "ready"].includes(value)) return "success"
  return "info"
}

function formatList(values?: string[]): string {
  if (!values?.length) return "未记录"
  if (values.length <= 3) return values.join("，")
  return `${values.slice(0, 3).join("，")} 等 ${values.length} 项`
}

function getString(event: OrchestratorEvent, key: string): string {
  const value = event[key]
  return typeof value === "string" ? value : ""
}

function trimText(value: string, limit = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized
}
