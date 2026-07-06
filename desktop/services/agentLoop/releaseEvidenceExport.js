const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { defaultReadinessReportDir } = require("./readiness")
const {
  readLatestSandboxSecurityEvidence,
  summarizeSandboxSecurityEvidence,
} = require("./sandboxSecurityEvidence")
const {
  AGENT_RUN_STATES,
  AGENT_RUN_STATE_TRANSITIONS,
  normalizeRunState,
} = require("./runtimeStatus")

function defaultReleaseEvidenceReportDir() {
  return defaultReadinessReportDir()
}

function releaseEvidencePaths(reportDir = defaultReleaseEvidenceReportDir()) {
  const resolved = reportDir || defaultReleaseEvidenceReportDir()
  return {
    reportDir: resolved,
    latestMarkdownPath: path.join(resolved, "release-evidence-latest.md"),
    latestJsonPath: path.join(resolved, "release-evidence-latest.json"),
    historyDir: path.join(resolved, "history"),
  }
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function latestRunWithContextEvidence(input) {
  const runs = Array.isArray(input) ? input : input && typeof input === "object" ? [input] : []
  return runs
    .filter((run) => run && typeof run === "object" && run.contextEvidence && typeof run.contextEvidence === "object")
    .sort((a, b) => compareContextEvidenceRuns(a, b))[0] || null
}

function compareContextEvidenceRuns(a, b) {
  const aSummary = summarizeContextEvidenceReadiness(a)
  const bSummary = summarizeContextEvidenceReadiness(b)
  if (aSummary.ready !== bSummary.ready) return bSummary.ready ? 1 : -1
  if (aSummary.score !== bSummary.score) return bSummary.score - aSummary.score
  return toFiniteNumber(b.updatedAt || b.createdAt) - toFiniteNumber(a.updatedAt || a.createdAt)
}

function summarizeContextEvidenceReadiness(run = {}) {
  const evidence = run?.contextEvidence || {}
  const mentions = Array.isArray(evidence.mentions) ? evidence.mentions : []
  const attachments = Array.isArray(evidence.attachments) ? evidence.attachments : []
  const rules = Array.isArray(evidence.rules) ? evidence.rules : []
  const workspaceSources = Array.isArray(evidence.workspaceSources) ? evidence.workspaceSources : []
  const warnings = Array.isArray(evidence.warnings) ? evidence.warnings : []
  const budget = evidence.budget || {}
  const policy = budget.policy || {}
  const index = evidence.indexStatus || {}
  const truncatedSources = toFiniteNumber(budget.truncatedSources)
  const overflowChars = toFiniteNumber(policy.overflowChars)
  const indexReady = index.enabled !== false && ["ready", "indexed", "fresh", "idle"].includes(String(index.state || "").toLowerCase())
  const freshEnough = !index.freshness || ["fresh", "current", "ready", "unknown"].includes(String(index.freshness || "").toLowerCase())
  const sourceCount = toFiniteNumber(budget.totalSources, mentions.length + attachments.length + rules.length + workspaceSources.length)
  const ready = sourceCount > 0 && indexReady && freshEnough && truncatedSources === 0 && overflowChars === 0 && warnings.length === 0
  return {
    ready,
    score: sourceCount + mentions.length + attachments.length + rules.length + workspaceSources.length,
  }
}

function archivedRunReportToRun(report) {
  if (!report || typeof report !== "object") return null
  const qualityGate = report.qualityGate || {}
  const commandAuthorization = report.commandAuthorization || {}
  const commandAllowlist = Array.isArray(commandAuthorization.commands)
    ? commandAuthorization.commands
      .filter((item) => item?.status === "allowed")
      .map((item) => item.command)
      .filter(Boolean)
    : []
  const trial = report.realWorkspaceTrial || {}
  const applyResult = report.changeSummary?.applyResult || null
  const rollbackResult = report.changeSummary?.rollbackResult || null
  const applySnapshot = trial.rollbackAvailable || rollbackResult ? { id: "archived-run-report-snapshot" } : null

  return {
    id: report.runId,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt || report.createdAt,
    visibleMode: report.router?.visibleMode || trial.visibleMode || "",
    executionStrategy: report.router?.executionStrategy || trial.executionStrategy || "",
    strategyReason: report.router?.reason || trial.routerReason || "",
    strategySignals: report.router?.signals || trial.routerSignals || {},
    projectRoot: report.projectRoot || trial.workspaceRoot || "",
    contextEvidence: report.contextEvidence || null,
    assignments: Array.isArray(report.assignments)
      ? report.assignments.map((item) => ({
        id: item.id,
        phaseId: item.phaseId,
        role: item.role,
        status: item.status,
        lockedFiles: Array.isArray(item.files) ? item.files : [],
        workspace: item.workspaceIsolation ? { isolation: item.workspaceIsolation } : undefined,
      }))
      : [],
    permissionRequest: {
      status: "approved",
      risk: "medium",
      writePaths: Array.isArray(trial.allowedPaths) ? trial.allowedPaths : [],
      commandAllowlist,
      network: false,
      install: false,
      externalTool: false,
      destructive: false,
    },
    qualityGateCommands: Array.isArray(trial.qualityGateCommands) ? trial.qualityGateCommands : [],
    integrationDecision: {
      proposedPatch: {
        filesChanged: Array.isArray(report.fileScope)
          ? report.fileScope
          : Array.isArray(trial.filesChanged) ? trial.filesChanged : [],
      },
      applySnapshot,
      applyResult,
      rollbackResult,
      qualityGate: {
        status: qualityGate.status || "not_run",
        commandResults: Array.isArray(qualityGate.commandResults)
          ? qualityGate.commandResults.map((item) => ({
            command: item.command,
            exitCode: item.exitCode,
            timedOut: item.timedOut === true,
          }))
          : [],
      },
    },
    realWorkspaceTrial: {
      ...trial,
      demoTaskReport: trial.demoTaskReport || report.demoTaskReport || null,
    },
  }
}

function collectEvidenceRuns(input = {}) {
  const runs = Array.isArray(input.runs) ? input.runs.slice() : []
  const latestSandbox = input.sandboxSecurityReport || (input.reportDir
    ? readLatestSandboxSecurityEvidence({ reportDir: input.reportDir }).report
    : null)
  if (latestSandbox?.sourceRun) runs.push(latestSandbox.sourceRun)
  const archived = archivedRunReportToRun(input.realTrialReport)
  if (archived) runs.push(archived)
  return runs
}

function summarizeCodebaseContextEvidence(input) {
  const run = latestRunWithContextEvidence(input)
  const evidence = run?.contextEvidence || null
  if (!evidence) {
    return {
      available: false,
      ready: false,
      status: "missing",
      statusLabel: "暂无 Codebase Context 证据",
      runId: "",
      sources: 0,
      mentions: 0,
      attachments: 0,
      rules: 0,
      workspaceSources: 0,
      warnings: 0,
      truncatedSources: 0,
      overflowChars: 0,
      estimatedChars: 0,
      contextBlockChars: 0,
      workspaceContextChars: 0,
      taskType: "",
      riskLevel: "",
      mentionTypes: {},
      workspaceSourceTypes: {},
      indexStatus: {
        enabled: false,
        state: "missing",
        indexedFiles: 0,
        indexableFiles: 0,
        excludedFiles: 0,
        workspaceRoots: 0,
        freshness: "missing",
        updatedAt: null,
      },
    }
  }
  const mentions = Array.isArray(evidence.mentions) ? evidence.mentions : []
  const attachments = Array.isArray(evidence.attachments) ? evidence.attachments : []
  const rules = Array.isArray(evidence.rules) ? evidence.rules : []
  const workspaceSources = Array.isArray(evidence.workspaceSources) ? evidence.workspaceSources : []
  const warnings = Array.isArray(evidence.warnings) ? evidence.warnings : []
  const budget = evidence.budget || {}
  const policy = budget.policy || {}
  const index = evidence.indexStatus || {}
  const truncatedSources = toFiniteNumber(budget.truncatedSources)
  const overflowChars = toFiniteNumber(policy.overflowChars)
  const indexReady = index.enabled !== false && ["ready", "indexed", "fresh", "idle"].includes(String(index.state || "").toLowerCase())
  const freshEnough = !index.freshness || ["fresh", "current", "ready", "unknown"].includes(String(index.freshness || "").toLowerCase())
  const sourceCount = toFiniteNumber(budget.totalSources, mentions.length + attachments.length + rules.length + workspaceSources.length)
  const ready = sourceCount > 0 && indexReady && freshEnough && truncatedSources === 0 && overflowChars === 0 && warnings.length === 0
  return {
    available: true,
    ready,
    status: ready ? "ready" : "degraded",
    statusLabel: ready ? "Codebase Context 已就绪" : "Codebase Context 需复核",
    runId: String(run.id || ""),
    updatedAt: toFiniteNumber(run.updatedAt || run.createdAt),
    sources: sourceCount,
    mentions: mentions.length,
    attachments: attachments.length,
    rules: rules.length,
    workspaceSources: workspaceSources.length,
    warnings: warnings.length,
    truncatedSources,
    overflowChars,
    estimatedChars: toFiniteNumber(budget.estimatedChars),
    contextBlockChars: toFiniteNumber(budget.contextBlockChars),
    workspaceContextChars: toFiniteNumber(budget.workspaceContextChars),
    taskType: String(policy.taskType || ""),
    riskLevel: String(policy.riskLevel || ""),
    mentionTypes: countByType(mentions),
    workspaceSourceTypes: countByType(workspaceSources),
    indexStatus: {
      enabled: index.enabled !== false,
      state: String(index.state || "unknown"),
      indexedFiles: toFiniteNumber(index.indexedFiles),
      indexableFiles: toFiniteNumber(index.indexableFiles),
      excludedFiles: toFiniteNumber(index.excludedFiles),
      workspaceRoots: toFiniteNumber(index.workspaceRoots),
      freshness: String(index.freshness || "unknown"),
      updatedAt: Number.isFinite(Number(index.updatedAt)) ? Number(index.updatedAt) : null,
    },
  }
}

function countByType(items) {
  return items.reduce((counts, item) => {
    const type = String(item?.type || item?.kind || "unknown")
    counts[type] = (counts[type] || 0) + 1
    return counts
  }, {})
}

function collectTaskRunEvidence(input = {}, evidenceRuns = []) {
  const collected = []
  const seen = new Set()
  const addMany = (items) => {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (!item || typeof item !== "object") continue
      const key = [
        item.id || "",
        item.name || "",
        item.startedAt || "",
        item.finishedAt || "",
        Array.isArray(item.steps) ? item.steps.length : 0,
      ].join("|")
      if (seen.has(key)) continue
      seen.add(key)
      collected.push(item)
    }
  }
  addMany(input.taskRunEvidence)
  addMany(input.taskRuns)
  addMany(input.workbenchDeep?.taskRunEvidence)
  addMany(input.workbenchDeep?.taskRuns)
  for (const run of evidenceRuns) {
    addMany(run?.taskRunEvidence)
    addMany(run?.taskRuns)
    addMany(run?.taskEvidence)
  }
  return collected
}

function summarizeTaskRunEvidence(input = []) {
  const runs = Array.isArray(input) ? input.filter((item) => item && typeof item === "object") : []
  const statusCounts = runs.reduce((counts, run) => {
    const status = normalizeTaskRunStatus(run.status)
    counts[status] = (counts[status] || 0) + 1
    return counts
  }, {})
  const failed = statusCounts.failed || 0
  const blocked = (statusCounts.blocked || 0) + runs.filter((run) => Array.isArray(run.blocked) && run.blocked.length > 0).length
  const running = statusCounts.running || 0
  const skipped = statusCounts.skipped || 0
  const passed = statusCounts.passed || 0
  const ready = runs.length > 0 && failed === 0 && blocked === 0 && running === 0 && skipped === 0
  const latest = runs
    .slice()
    .sort((a, b) => toFiniteNumber(b.finishedAt || b.startedAt || b.updatedAt || b.createdAt) - toFiniteNumber(a.finishedAt || a.startedAt || a.updatedAt || a.createdAt))[0] || null

  return {
    available: runs.length > 0,
    ready,
    status: runs.length === 0 ? "missing" : ready ? "ready" : "degraded",
    statusLabel: runs.length === 0
      ? "暂无任务运行证据"
      : ready ? `${passed}/${runs.length} 任务通过` : `${passed}/${runs.length} 任务通过，${failed + blocked + running + skipped} 项需处理`,
    total: runs.length,
    passed,
    failed,
    blocked,
    running,
    skipped,
    latest: latest ? {
      id: String(latest.id || ""),
      name: String(latest.name || ""),
      status: normalizeTaskRunStatus(latest.status),
      startedAt: Number.isFinite(Number(latest.startedAt)) ? Number(latest.startedAt) : null,
      finishedAt: Number.isFinite(Number(latest.finishedAt)) ? Number(latest.finishedAt) : null,
      durationMs: Number.isFinite(Number(latest.durationMs)) ? Number(latest.durationMs) : null,
    } : null,
    runs: runs.slice(0, 10).map(summarizeTaskRun),
  }
}

function collectTaskTerminalReuseRegistryEvidence(input = {}, evidenceRuns = []) {
  const candidates = []
  const add = (item) => {
    if (item && typeof item === "object") candidates.push(item)
  }
  add(input.taskTerminalReuseRegistry)
  add(input.workbenchDeep?.taskTerminalReuseRegistry)
  add(input.workbenchRealProjectUi?.metrics?.terminalDebugTaskWorkbench?.terminal?.taskTerminalReuseRegistry)
  add(input.workbenchRealProjectUi?.metrics?.terminalDebugTaskWorkbench?.tasks?.capabilities?.taskTerminalReuseRegistry)
  add(input.workbenchRealProjectUi?.metrics?.terminalDebugTaskWorkbench?.taskTerminalReuseRegistry)
  const taskRunSources = collectTaskRunEvidence(input, evidenceRuns)
  for (const run of taskRunSources) add(run.taskTerminalReuseRegistry)
  for (const run of evidenceRuns) {
    add(run?.taskTerminalReuseRegistry)
    add(run?.contextEvidence?.taskTerminalReuseRegistry)
  }
  return candidates.find((item) => item.source === "TaskTerminalReuseRegistry")
    || candidates.find((item) => item.stateSource === "terminalManager/taskTerminalReuseRegistry")
    || null
}

function summarizeTaskTerminalReuseRegistry(input = {}, evidenceRuns = []) {
  const registry = collectTaskTerminalReuseRegistryEvidence(input, evidenceRuns)
  const sameTaskTerminals = Array.isArray(registry?.sameTaskTerminals) ? registry.sameTaskTerminals : []
  const idleTaskTerminals = Array.isArray(registry?.idleTaskTerminals) ? registry.idleTaskTerminals : []
  const sameTaskOwnerCount = toFiniteNumber(registry?.sameTaskCount ?? registry?.sameTaskOwnerCount, sameTaskTerminals.length)
  const idleOwnerCount = toFiniteNumber(registry?.idleTaskCount ?? registry?.idleOwnerCount, idleTaskTerminals.length)
  const available = Boolean(registry)
  return {
    available,
    ready: false,
    status: available ? "partial" : "missing",
    statusLabel: available
      ? "Terminal reuse registry evidence 可观测，physical reuse 未迁移"
      : "暂无 Terminal reuse registry evidence",
    source: String(registry?.source || ""),
    stateSource: String(registry?.stateSource || ""),
    connected: false,
    supportsPhysicalReuse: false,
    sameTaskOwnerCount,
    idleOwnerCount,
    sameTaskTerminals: sameTaskTerminals.slice(0, 10).map((owner) => ({
      taskId: String(owner?.taskId || ""),
      terminalInstanceId: Number.isFinite(Number(owner?.terminalInstanceId)) ? Number(owner.terminalInstanceId) : null,
      status: String(owner?.status || ""),
      executionId: String(owner?.executionId || ""),
    })),
    idleTaskTerminals: idleTaskTerminals.slice(0, 10).map((owner) => ({
      taskId: String(owner?.taskId || ""),
      terminalInstanceId: Number.isFinite(Number(owner?.terminalInstanceId)) ? Number(owner.terminalInstanceId) : null,
      status: String(owner?.status || ""),
      executionId: String(owner?.executionId || ""),
    })),
    remainingGap: String(registry?.missingPhysicalReuseOwner || registry?.remainingGap || "terminal shell owner with reuseTerminal(launchConfigs)"),
    currentSourcePath: String(registry?.currentSourcePath || "frontend/vite-project/src/terminal/terminalManager.ts"),
    vscodeSourcePath: String(registry?.vscodeSourcePath || "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts"),
  }
}

function summarizeWorkbenchRealProjectUi(input = {}) {
  const report = input.workbenchRealProjectUi || null
  const metrics = report?.metrics || {}
  const acceptance = report?.acceptance || {}
  const acceptanceValues = Object.values(acceptance)
  const acceptanceTotal = acceptanceValues.length
  const acceptancePassed = acceptanceValues.filter(Boolean).length
  const markdownPath = input.workbenchRealProjectUiMarkdownPath || report?.latestMarkdownPath || ""
  const screenshotPath = input.workbenchRealProjectUiScreenshotPath || report?.latestScreenshotPath || ""
  const ready = Boolean(report?.ready)
    && acceptanceTotal > 0
    && acceptancePassed === acceptanceTotal
    && Boolean(markdownPath)
    && Boolean(screenshotPath)
  return {
    available: Boolean(report),
    ready,
    status: report?.status || (report ? ready ? "ready" : "degraded" : "missing"),
    statusLabel: report ? (ready ? "真实项目 UI smoke 已就绪" : "真实项目 UI smoke 需复核") : "暂无真实项目 UI smoke 证据",
    projectRoot: report?.projectRoot || metrics.projectRoot || "",
    domRows: Number(metrics.domRows || 0),
    totalRows: Number(metrics.totalRows || 0),
    p95ScrollMs: Number(metrics.p95ScrollMs || 0),
    maxScrollMs: Number(metrics.maxScrollMs || 0),
    longTasks: Number(metrics.longTasks || 0),
    idleLightbulbCount: Number(metrics.idleLightbulbCount || 0),
    searchQuery: metrics.searchQuery || "",
    searchMatchPath: metrics.searchMatchPath || "",
    createTargetDir: metrics.createTargetDir || "",
    acceptancePassed,
    acceptanceTotal,
    markdownPath,
    jsonPath: input.workbenchRealProjectUiJsonPath || report?.latestJsonPath || "",
    screenshotPath,
  }
}

function summarizeExplorerFsParity(input = {}) {
  const report = input.explorerFsParity || null
  const checks = Array.isArray(report?.checks) ? report.checks : []
  const failed = checks.filter((check) => check?.status !== "passed").length
  const truncated = checks.filter((check) => check?.truncated === true).length
  const missing = checks.reduce((total, check) => total + (Array.isArray(check?.missing) ? check.missing.length : 0), 0)
  const extra = checks.reduce((total, check) => total + (Array.isArray(check?.extra) ? check.extra.length : 0), 0)
  const typeMismatches = checks.reduce((total, check) => total + (Array.isArray(check?.typeMismatches) ? check.typeMismatches.length : 0), 0)
  const sentinelCount = checks.reduce((total, check) => total + toFiniteNumber(check?.sentinelCount), 0)
  const ready = Boolean(report?.ready)
    && checks.length > 0
    && failed === 0
    && truncated === 0
    && missing === 0
    && extra === 0
    && typeMismatches === 0
  return {
    available: Boolean(report),
    ready,
    status: report?.status || (report ? ready ? "ready" : "blocked" : "missing"),
    statusLabel: report ? (ready ? "Explorer FS 条目差异证据已就绪" : "Explorer FS 条目差异证据需复核") : "暂无 Explorer FS 条目差异证据",
    projectPath: report?.projectPath || "",
    passed: Number(report?.passed || checks.filter((check) => check?.status === "passed").length),
    total: Number(report?.checkCount || checks.length),
    failed,
    truncated,
    missing,
    extra,
    typeMismatches,
    sentinelCount,
    checks: checks.slice(0, 20).map((check) => ({
      id: String(check?.id || ""),
      path: String(check?.path || ""),
      source: String(check?.source || ""),
      status: String(check?.status || ""),
      fsCount: toFiniteNumber(check?.fsCount),
      codekCount: toFiniteNumber(check?.codekCount),
      truncated: check?.truncated === true,
      missing: Array.isArray(check?.missing) ? check.missing.length : 0,
      extra: Array.isArray(check?.extra) ? check.extra.length : 0,
      typeMismatches: Array.isArray(check?.typeMismatches) ? check.typeMismatches.length : 0,
    })),
    jsonPath: input.explorerFsParityJsonPath || report?.latestJsonPath || report?.jsonPath || "",
    markdownPath: input.explorerFsParityMarkdownPath || report?.latestMarkdownPath || report?.markdownPath || "",
  }
}

function summarizeShellIntegration(input = {}) {
  const report = input.shellIntegration || null
  const summary = report?.summary || {}
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready) && Number(summary.failed || 0) === 0 && Number(summary.total || 0) > 0,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report ? (report.ready ? "终端 Shell 集成 smoke 已就绪" : "终端 Shell 集成 smoke 需复核") : "暂无终端 Shell 集成 smoke 证据",
    passed: Number(summary.passed || 0),
    skipped: Number(summary.skipped || 0),
    failed: Number(summary.failed || 0),
    total: Number(summary.total || 0),
    shells: Array.isArray(report?.checks) ? report.checks.map((check) => ({
      shellType: String(check?.shellType || ""),
      ok: check?.ok === true,
      skipped: check?.skipped === true,
      durationMs: Number(check?.durationMs || 0),
    })) : [],
    jsonPath: input.shellIntegrationJsonPath || report?.latestJsonPath || "",
    markdownPath: input.shellIntegrationMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeDebugAdapterSmoke(input = {}) {
  const report = input.debugAdapterSmoke || null
  const summary = report?.summary || {}
  const fixture = Array.isArray(report?.checks)
    ? report.checks.find((check) => check?.id === "fixture")
    : null
  const evidence = fixture?.evidence || {}
  const commandKeys = ["setBreakpoints", "configurationDone", "stackTrace", "scopes", "variables", "continue", "next", "terminate"]
  const coveredCommands = commandKeys.filter((command) => evidence.requestCommands?.[command] === true)
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready) && Number(summary.failed || 0) === 0 && Number(summary.total || 0) > 0,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report ? (report.ready ? "调试适配器 smoke 已就绪" : "调试适配器 smoke 需复核") : "暂无调试适配器 smoke 证据",
    passed: Number(summary.passed || 0),
    skipped: Number(summary.skipped || 0),
    failed: Number(summary.failed || 0),
    total: Number(summary.total || 0),
    fixturePassed: fixture?.status === "passed",
    dapMetadataOnly: evidence.metadataOnly === true,
    dapCommandCoverage: {
      covered: coveredCommands.length,
      total: commandKeys.length,
      commands: coveredCommands,
    },
    stackFrames: Number(evidence.stackTrace?.frameCount || 0),
    scopes: Number(evidence.scopes?.scopeCount || 0),
    variables: Number(evidence.variables?.variableCount || 0),
    breakpointsVerified: Number(evidence.breakpoints?.verified || 0),
    bridgeEvidence: {
      available: Boolean(evidence.bridgeEvidence),
      source: String(evidence.bridgeEvidence?.source || ""),
      serviceId: String(evidence.bridgeEvidence?.serviceId || ""),
      stateSource: String(evidence.bridgeEvidence?.stateSource || ""),
      latestRequestCount: Number(evidence.bridgeEvidence?.latestRequestCount || 0),
      latestEventCount: Number(evidence.bridgeEvidence?.latestEventCount || 0),
      noSecondDapState: evidence.bridgeEvidence?.noSecondDapState === true,
      evidenceSafeActions: evidence.bridgeEvidence?.evidenceSafeActions === true,
      redactsCommandArguments: evidence.bridgeEvidence?.redactsCommandArguments === true,
    },
    redaction: {
      expressionValuesRedacted: evidence.redaction?.expressionValuesRedacted === true,
      sourcePathsRedacted: evidence.redaction?.sourcePathsRedacted === true,
      adapterArgumentsRedacted: evidence.redaction?.adapterArgumentsRedacted === true,
    },
    adapters: Array.isArray(report?.checks) ? report.checks.map((check) => ({
      id: String(check?.id || ""),
      status: String(check?.status || ""),
      adapterAvailable: check?.adapterAvailable === true,
      mode: String(check?.mode || ""),
      source: String(check?.source || ""),
    })) : [],
    jsonPath: input.debugAdapterSmokeJsonPath || report?.latestJsonPath || "",
    markdownPath: input.debugAdapterSmokeMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeEnterpriseDocAudit(input = {}) {
  const report = input.enterpriseDocAudit || null
  const summary = report?.summary || {}
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready) && Number(summary.missing || 0) === 0,
    enterpriseComplete: report?.enterpriseComplete === true,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? report.enterpriseComplete === true
        ? "企业级文档已完成"
        : "企业级文档自动审计通过，仍需真实 UI 手感证据"
      : "暂无企业级文档审计证据",
    automatedPassed: Number(summary.automatedPassed || 0),
    manualRequired: Number(summary.manualRequired || 0),
    missing: Number(summary.missing || 0),
    total: Number(summary.total || 0),
    jsonPath: input.enterpriseDocAuditJsonPath || report?.latestJsonPath || "",
    markdownPath: input.enterpriseDocAuditMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeExtensionPlanAudit(input = {}) {
  const report = input.extensionPlanAudit || null
  const summary = report?.summary || {}
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready) && Number(summary.missing || 0) === 0,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (report.ready ? "扩展计划完成审计已就绪" : "扩展计划完成审计需复核")
      : "暂无扩展计划完成审计证据",
    enterpriseComplete: report?.enterpriseComplete === true,
    passed: Number(summary.passed || summary.automatedPassed || 0),
    manualRequired: Number(summary.manualRequired || 0),
    missing: Number(summary.missing || 0),
    total: Number(summary.total || 0),
    jsonPath: input.extensionPlanAuditJsonPath || report?.latestJsonPath || "",
    markdownPath: input.extensionPlanAuditMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeManualRealUiEvidence(input = {}) {
  const report = input.manualRealUiEvidence || null
  const summary = report?.summary || {}
  const ready = Boolean(report?.ready)
    && report?.manualRunConfirmed === true
    && report?.cursorLevelSmoothnessConfirmed === true
    && report?.windowsExplorerCrossCheckConfirmed === true
  return {
    available: Boolean(report),
    ready,
    status: report?.status || (report ? ready ? "ready" : "blocked" : "missing"),
    statusLabel: report ? (ready ? "真实 Workbench 手感已人工确认" : "真实 Workbench 手感验收需补齐") : "暂无真实 Workbench 手感验收",
    method: String(report?.method || ""),
    projectRoot: String(report?.projectRoot || ""),
    manualRunConfirmed: report?.manualRunConfirmed === true,
    cursorLevelSmoothnessConfirmed: report?.cursorLevelSmoothnessConfirmed === true,
    windowsExplorerCrossCheckConfirmed: report?.windowsExplorerCrossCheckConfirmed === true,
    passedScenarios: Number(summary.passedScenarios || 0),
    totalScenarios: Number(summary.totalScenarios || 0),
    passedChecks: Number(summary.passedChecks || 0),
    requiredChecks: Number(summary.requiredChecks || 0),
    screenshotCount: Number(summary.screenshotCount || 0),
    highGaps: Number(summary.highGaps || 0),
    gaps: Number(summary.gaps || 0),
    jsonPath: input.manualRealUiEvidenceJsonPath || report?.latestJsonPath || "",
    markdownPath: input.manualRealUiEvidenceMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function formatManualRealUiNotReadyReason(evidence = {}) {
  const missing = []
  if (evidence.manualRunConfirmed !== true) missing.push("真实 UI 执行确认")
  if (evidence.cursorLevelSmoothnessConfirmed !== true) missing.push("Cursor 级主观流畅度确认")
  if (evidence.windowsExplorerCrossCheckConfirmed !== true) missing.push("Windows 资源管理器创建落点交叉检查")
  if (!missing.length) return "人工 UI 手感 evidence 仍未 ready，请复核 manual-real-ui-evidence-latest.json 的 gaps。"
  return `人工或 Computer Use 还没有完成：${missing.join("、")}。`
}

function summarizeAgentChangeSafety(input = {}) {
  const report = input.agentChangeSafety || null
  const summary = report?.summary || {}
  const evidence = report?.evidence || {}
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready) && Number(summary.failed || 0) === 0 && Number(summary.total || 0) > 0,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report ? (report.ready ? "Agent 变更安全 smoke 已就绪" : "Agent 变更安全 smoke 需复核") : "暂无 Agent 变更安全 smoke 证据",
    passed: Number(summary.passed || 0),
    failed: Number(summary.failed || 0),
    total: Number(summary.total || 0),
    pendingBatchBlocked: evidence.pendingBatch?.blockReason === "manual-change-detected",
    pendingHunkBlocked: evidence.pendingHunk?.blockReason === "manual-change-detected",
    rollbackBlocked: evidence.rollback?.rollbackError === "manual-change-detected",
    reviewDisplayBlocked: evidence.pendingBatch?.reviewDisplay?.status === "blocked"
      && evidence.pendingBatch?.reviewDisplay?.firstFileCanApply === false
      && evidence.pendingBatch?.reviewDisplay?.firstFileCanReject === true,
    operationLogVisible: evidence.rollback?.operationLog?.title === "Agent Change Set"
      && evidence.rollback?.operationLog?.statusLabel === "Rollback blocked"
      && evidence.rollback?.operationLog?.rollbackBlocked === true
      && evidence.rollback?.operationLog?.canRevert === false
      && evidence.rollback?.operationLog?.isGitDiff === false,
    jsonPath: input.agentChangeSafetyJsonPath || report?.latestJsonPath || "",
    markdownPath: input.agentChangeSafetyMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeRouterCalibrationSmoke(input = {}) {
  const report = input.routerCalibration || null
  const summary = report?.summary || {}
  const total = toFiniteNumber(summary.total)
  const minSamples = toFiniteNumber(report?.minSamples, 100)
  const misaligned = toFiniteNumber(summary.misaligned)
  const failureReports = toFiniteNumber(summary.failureReports)
  const sampleCountOk = total >= minSamples && summary.sampleCountOk !== false
  const failureReportOk = failureReports >= misaligned && summary.failureReportOk !== false
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready) && sampleCountOk && failureReportOk,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (report.ready ? `路由校准已就绪（${total} 个样本）` : "路由校准需复核")
      : "暂无路由校准 smoke 证据",
    total,
    minSamples,
    passed: toFiniteNumber(summary.passed),
    failed: toFiniteNumber(summary.failed),
    routerAligned: toFiniteNumber(summary.routerAligned),
    recommendationAligned: toFiniteNumber(summary.recommendationAligned),
    misaligned,
    failureReports,
    sampleCountOk,
    failureReportOk,
    shadowRecommendation: String(report?.shadow?.recommendation || ""),
    jsonPath: input.routerCalibrationJsonPath || report?.latestJsonPath || "",
    markdownPath: input.routerCalibrationMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeExtensionMarketplaceSmoke(input = {}) {
  const report = input.extensionMarketplaceSmoke || null
  const summary = report?.summary || {}
  const searchSamples = Array.isArray(report?.searchSamples) ? report.searchSamples : []
  const inspected = Array.isArray(report?.inspected) ? report.inspected : []
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready) && Number(summary.failed || 0) === 0 && Number(summary.total || 0) > 0,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (report.ready ? "扩展市场 smoke 已就绪" : "扩展市场 smoke 需复核")
      : "暂无扩展市场 smoke 证据",
    passed: Number(summary.passed || 0),
    warning: Number(summary.warning || 0),
    failed: Number(summary.failed || 0),
    total: Number(summary.total || 0),
    queryCount: searchSamples.length,
    inspected: inspected.length,
    detailsReady: inspected.filter((item) => item?.detailsReady).length,
    readmeReady: inspected.filter((item) => item?.readmeReady).length,
    versionsReady: inspected.filter((item) => item?.versionsReady).length,
    installPlanReady: inspected.filter((item) => item?.installPlanReady).length,
    jsonPath: input.extensionMarketplaceSmokeJsonPath || report?.latestJsonPath || "",
    markdownPath: input.extensionMarketplaceSmokeMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeExtensionInstallSmoke(input = {}) {
  const report = input.extensionInstallSmoke || null
  const summary = report?.summary || {}
  const checks = Array.isArray(report?.checks) ? report.checks : []
  const artifacts = Array.isArray(report?.artifacts) ? report.artifacts : []
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready) && Number(summary.failed || 0) === 0 && Number(summary.total || 0) > 0,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (report.ready ? "扩展安装生命周期 smoke 已就绪" : "扩展安装生命周期 smoke 需复核")
      : "暂无扩展安装生命周期 smoke 证据",
    passed: Number(summary.passed || 0),
    warning: Number(summary.warning || 0),
    failed: Number(summary.failed || 0),
    total: Number(summary.total || 0),
    fixtureInstallPassed: checks.some((check) => check?.id === "fixture_install" && check?.status === "passed"),
    fixtureUpdatePassed: checks.some((check) => check?.id === "fixture_update" && check?.status === "passed"),
    fixtureRollbackPassed: checks.some((check) => check?.id === "fixture_rollback" && check?.status === "passed"),
    fixtureUninstallPassed: checks.some((check) => check?.id === "fixture_uninstall" && check?.status === "passed"),
    marketplaceInstallAuthorized: checks.some((check) => check?.id === "marketplace_install" && check?.status === "passed"),
    artifacts: artifacts.length,
    jsonPath: input.extensionInstallSmokeJsonPath || report?.latestJsonPath || "",
    markdownPath: input.extensionInstallSmokeMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeExtensionMarketplaceInstallMatrix(input = {}) {
  const report = input.extensionMarketplaceInstallMatrix || null
  const summary = report?.summary || {}
  const thresholds = report?.thresholds || {}
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready)
      && Number(summary.metadataUsable || 0) >= Number(thresholds.minMetadata || 95)
      && Number(summary.installChainComplete || 0) >= Number(thresholds.minInstallChain || 90)
      && Number(summary.activationPreflightReady || 0) >= Number(thresholds.minActivationPreflight || 40)
      && report?.installation?.isolated === true,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (report.ready ? "扩展 marketplace 安装矩阵已就绪" : "扩展 marketplace 安装矩阵需复核")
      : "暂无扩展 marketplace 安装矩阵证据",
    top: Number(summary.top || 0),
    sampled: Number(summary.sampled || 0),
    metadataUsable: Number(summary.metadataUsable || 0),
    downloaded: Number(summary.downloaded || 0),
    extracted: Number(summary.extracted || 0),
    manifestScanned: Number(summary.manifestScanned || 0),
    installChainComplete: Number(summary.installChainComplete || 0),
    activationPreflightReady: Number(summary.activationPreflightReady || 0),
    failed: Number(summary.failed || 0),
    minMetadata: Number(thresholds.minMetadata || 95),
    minInstallChain: Number(thresholds.minInstallChain || 90),
    minActivationPreflight: Number(thresholds.minActivationPreflight || 40),
    isolated: report?.installation?.isolated === true,
    jsonPath: input.extensionMarketplaceInstallMatrixJsonPath || report?.latestJsonPath || "",
    markdownPath: input.extensionMarketplaceInstallMatrixMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeExtensionMigrationSmoke(input = {}) {
  const report = input.extensionMigrationSmoke || null
  const summary = report?.summary || {}
  const queue = report?.evidence?.queue || {}
  const preview = report?.evidence?.preview || {}
  const checks = Array.isArray(report?.checks) ? report.checks : []
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready) && Number(summary.failed || 0) === 0 && Number(summary.total || 0) > 0,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (report.ready ? "VS Code/Cursor 扩展迁移 smoke 已就绪" : "VS Code/Cursor 扩展迁移 smoke 需复核")
      : "暂无 VS Code/Cursor 扩展迁移 smoke 证据",
    passed: Number(summary.passed || 0),
    warning: Number(summary.warning || 0),
    failed: Number(summary.failed || 0),
    total: Number(summary.total || 0),
    source: String(report?.source || ""),
    dryRun: report?.dryRun === true,
    previewExtensions: Number(preview.extensionsCount || 0),
    queueTotal: Number(queue.total || 0),
    queuePending: Number(queue.pending || 0),
    queueInstalled: Number(queue.installed || 0),
    installPolicy: String(queue.installPolicy || ""),
    dryRunNoAutoInstall: checks.some((check) => check?.id === "dry_run_no_auto_install" && check?.status === "passed"),
    jsonPath: input.extensionMigrationSmokeJsonPath || report?.latestJsonPath || "",
    markdownPath: input.extensionMigrationSmokeMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeExtensionSecuritySmoke(input = {}) {
  const report = input.extensionSecuritySmoke || null
  const summary = report?.summary || {}
  const checks = Array.isArray(report?.checks) ? report.checks : []
  const hasPassed = (id) => checks.some((check) => check?.id === id && check?.status === "passed")
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready) && Number(summary.failed || 0) === 0 && Number(summary.total || 0) > 0,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (report.ready ? "扩展安全和治理 smoke 已就绪" : "扩展安全和治理 smoke 需复核")
      : "暂无扩展安全和治理 smoke 证据",
    passed: Number(summary.passed || 0),
    warning: Number(summary.warning || 0),
    failed: Number(summary.failed || 0),
    total: Number(summary.total || 0),
    restrictedWorkspaceBlocked: hasPassed("restricted_workspace_blocks_install"),
    unknownWorkspaceRequiresConfirmation: hasPassed("unknown_workspace_requires_confirmation"),
    publisherDenyPolicy: hasPassed("publisher_deny_policy"),
    auditRedactsSecrets: hasPassed("audit_log_redacts_secrets"),
    jsonPath: input.extensionSecuritySmokeJsonPath || report?.latestJsonPath || "",
    markdownPath: input.extensionSecuritySmokeMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeExtensionHostRestartSmoke(input = {}) {
  const report = input.extensionHostRestartSmoke || null
  const evidence = report?.evidence || {}
  const smoke = report?.smokeConsolidation || {}
  const after = report?.after || {}
  const manifest = report?.manifestState || {}
  const ready = Boolean(report?.ok ?? smoke.ok)
    && evidence.restartRequested === true
    && evidence.restartObserved === true
    && evidence.restarted === true
    && evidence.reloadRequested === false
    && evidence.reloaded === false
    && evidence.hostKind === "LocalProcess"
    && evidence.hostSource === "ExtensionHostServer"
    && evidence.lifecyclePhase === "restarted"
    && evidence.activationReplay === "preserveRequestedActivationEvents"
    && evidence.blockedReason === ""
    && after.processReplaced === true
    && manifest.registeredAfterRestart === true
  return {
    available: Boolean(report),
    ready,
    status: report?.status || smoke.status || (report ? ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (ready ? "EH restart smoke 已就绪" : "EH restart smoke 需复核")
      : "暂无 EH restart smoke 证据",
    mode: String(report?.mode || smoke.mode || ""),
    route: String(report?.route || ""),
    restartRequested: evidence.restartRequested === true,
    restartObserved: evidence.restartObserved === true,
    restarted: evidence.restarted === true,
    processReplaced: after.processReplaced === true,
    hostKind: String(evidence.hostKind || report?.hostKind || ""),
    hostSource: String(evidence.hostSource || report?.hostSource || ""),
    lifecyclePhase: String(evidence.lifecyclePhase || report?.lifecyclePhase || ""),
    activationReplay: String(evidence.activationReplay || report?.activationReplay || ""),
    blockedBy: String(evidence.blockedBy || report?.blockedBy || ""),
    blockedReason: String(evidence.blockedReason || report?.blockedReason || ""),
    reloadRequested: evidence.reloadRequested === true,
    reloaded: evidence.reloaded === true,
    manifestRegistered: manifest.registeredAfterRestart === true,
    failedChecks: Number(smoke.failedCount || 0),
    jsonPath: input.extensionHostRestartSmokeJsonPath || smoke.resultFile || report?.latestJsonPath || "",
    markdownPath: input.extensionHostRestartSmokeMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeEhMarketplaceE2e(input = {}) {
  const report = input.ehMarketplaceE2e || null
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready) && report?.phase === "done",
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (report.ready ? "EH marketplace E2E 已就绪" : "EH marketplace E2E 需复核")
      : "暂无 EH marketplace E2E 证据",
    phase: String(report?.phase || ""),
    extensionId: String(report?.extensionId || ""),
    searchCount: Number(report?.searchCount || 0),
    error: String(report?.error || ""),
    jsonPath: input.ehMarketplaceE2eJsonPath || report?.latestJsonPath || "",
    markdownPath: input.ehMarketplaceE2eMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeEhMementoStorageE2e(input = {}) {
  const report = input.ehMementoStorageE2e || null
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready)
      && report?.globalStateStored === true
      && report?.workspaceStateStored === true
      && report?.syncKeysStored === true
      && report?.thirdPartyExtensionScanned === true
      && report?.thirdPartyExtensionBuiltinFalse === true
      && report?.thirdPartyInstalledMarkerPresent === true
      && report?.thirdPartyGlobalStateStored === true
      && report?.thirdPartyWorkspaceStateStored === true
      && report?.thirdPartySyncKeysStored === true
      && report?.legacyStorageWritten === false,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (report.ready ? "EH memento storage E2E 已就绪" : "EH memento storage E2E 需复核")
      : "暂无 EH memento storage E2E 证据",
    extensionId: String(report?.extensionId || ""),
    thirdPartyExtensionId: String(report?.thirdPartyExtensionId || ""),
    profileId: String(report?.profileId || ""),
    globalStateStored: report?.globalStateStored === true,
    workspaceStateStored: report?.workspaceStateStored === true,
    syncKeysStored: report?.syncKeysStored === true,
    thirdPartyExtensionScanned: report?.thirdPartyExtensionScanned === true,
    thirdPartyExtensionBuiltinFalse: report?.thirdPartyExtensionBuiltinFalse === true,
    thirdPartyInstalledMarkerPresent: report?.thirdPartyInstalledMarkerPresent === true,
    thirdPartyGlobalStateStored: report?.thirdPartyGlobalStateStored === true,
    thirdPartyWorkspaceStateStored: report?.thirdPartyWorkspaceStateStored === true,
    thirdPartySyncKeysStored: report?.thirdPartySyncKeysStored === true,
    legacyStorageWritten: report?.legacyStorageWritten === true,
    cleanupError: String(report?.cleanupError || ""),
    error: String(report?.error || ""),
    jsonPath: input.ehMementoStorageE2eJsonPath || report?.latestJsonPath || "",
    markdownPath: input.ehMementoStorageE2eMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeEhExtensionContextE2e(input = {}) {
  const report = input.ehExtensionContextE2e || null
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready)
      && report?.thirdPartyExtensionScanned === true
      && report?.thirdPartyExtensionBuiltinFalse === true
      && report?.thirdPartyInstalledMarkerPresent === true
      && report?.packageJsonPreserved === true
      && report?.extensionUriFile === true
      && report?.extensionPathMatches === true
      && report?.asAbsolutePathWorks === true
      && report?.storageUriFile === true
      && report?.globalStorageUriFile === true
      && report?.logUriFile === true,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (report.ready ? "EH ExtensionContext E2E 已就绪" : "EH ExtensionContext E2E 需复核")
      : "暂无 EH ExtensionContext E2E 证据",
    extensionId: String(report?.extensionId || ""),
    thirdPartyExtensionScanned: report?.thirdPartyExtensionScanned === true,
    thirdPartyExtensionBuiltinFalse: report?.thirdPartyExtensionBuiltinFalse === true,
    thirdPartyInstalledMarkerPresent: report?.thirdPartyInstalledMarkerPresent === true,
    packageJsonPreserved: report?.packageJsonPreserved === true,
    extensionUriFile: report?.extensionUriFile === true,
    extensionPathMatches: report?.extensionPathMatches === true,
    asAbsolutePathWorks: report?.asAbsolutePathWorks === true,
    storageUriFile: report?.storageUriFile === true,
    globalStorageUriFile: report?.globalStorageUriFile === true,
    logUriFile: report?.logUriFile === true,
    passedChecks: Number(report?.passedChecks || 0),
    checkCount: Number(report?.checkCount || 0),
    error: String(report?.error || ""),
    jsonPath: input.ehExtensionContextE2eJsonPath || report?.latestJsonPath || "",
    markdownPath: input.ehExtensionContextE2eMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeEhImplicitActivationE2e(input = {}) {
  const report = input.ehImplicitActivationE2e || null
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready)
      && report?.thirdPartyExtensionScanned === true
      && report?.thirdPartyExtensionBuiltinFalse === true
      && report?.thirdPartyInstalledMarkerPresent === true
      && report?.manifestHasExplicitActivationEvents === false
      && report?.implicitOnCommandGenerated === true
      && report?.activationEventsByEventHasExtension === true
      && report?.activatedByImplicitEvent === true
      && report?.commandContributionPreserved === true,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (report.ready ? "EH implicit activation E2E 已就绪" : "EH implicit activation E2E 需复核")
      : "暂无 EH implicit activation E2E 证据",
    extensionId: String(report?.extensionId || ""),
    activationEvent: String(report?.activationEvent || ""),
    thirdPartyExtensionScanned: report?.thirdPartyExtensionScanned === true,
    thirdPartyExtensionBuiltinFalse: report?.thirdPartyExtensionBuiltinFalse === true,
    thirdPartyInstalledMarkerPresent: report?.thirdPartyInstalledMarkerPresent === true,
    manifestHasExplicitActivationEvents: report?.manifestHasExplicitActivationEvents === true,
    implicitOnCommandGenerated: report?.implicitOnCommandGenerated === true,
    activationEventsByEventHasExtension: report?.activationEventsByEventHasExtension === true,
    activatedByImplicitEvent: report?.activatedByImplicitEvent === true,
    commandContributionPreserved: report?.commandContributionPreserved === true,
    error: String(report?.error || ""),
    jsonPath: input.ehImplicitActivationE2eJsonPath || report?.latestJsonPath || "",
    markdownPath: input.ehImplicitActivationE2eMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeEhDependencyLoopE2e(input = {}) {
  const report = input.ehDependencyLoopE2e || null
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready)
      && Array.isArray(report?.removedDueToLooping)
      && report.removedDueToLooping.includes("codek.loop-a")
      && report.removedDueToLooping.includes("codek.loop-b")
      && report?.loopExtensionsAbsentFromAllExtensions === true
      && report?.loopExtensionsAbsentFromById === true
      && report?.loopActivationEventsAbsent === true
      && report?.loopActivationEventsByEventAbsent === true
      && report?.initDataLoopExtensionsAbsent === true
      && report?.initDataMyExtensionsLoopAbsent === true
      && report?.healthyExtensionScanned === true
      && report?.healthyActivationEventIndexed === true
      && report?.healthyExtensionInInitData === true
      && report?.healthyActivated === true,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (report.ready ? "EH dependency loop E2E 已就绪" : "EH dependency loop E2E 需复核")
      : "暂无 EH dependency loop E2E 证据",
    loopExtensionIds: Array.isArray(report?.loopExtensionIds) ? report.loopExtensionIds.slice(0) : [],
    healthyExtensionId: String(report?.healthyExtensionId || ""),
    removedDueToLooping: Array.isArray(report?.removedDueToLooping) ? report.removedDueToLooping.slice(0) : [],
    loopExtensionsAbsentFromAllExtensions: report?.loopExtensionsAbsentFromAllExtensions === true,
    loopExtensionsAbsentFromById: report?.loopExtensionsAbsentFromById === true,
    loopActivationEventsAbsent: report?.loopActivationEventsAbsent === true,
    loopActivationEventsByEventAbsent: report?.loopActivationEventsByEventAbsent === true,
    initDataLoopExtensionsAbsent: report?.initDataLoopExtensionsAbsent === true,
    initDataMyExtensionsLoopAbsent: report?.initDataMyExtensionsLoopAbsent === true,
    healthyExtensionScanned: report?.healthyExtensionScanned === true,
    healthyActivationEventIndexed: report?.healthyActivationEventIndexed === true,
    healthyExtensionInInitData: report?.healthyExtensionInInitData === true,
    healthyActivated: report?.healthyActivated === true,
    error: String(report?.error || ""),
    jsonPath: input.ehDependencyLoopE2eJsonPath || report?.latestJsonPath || "",
    markdownPath: input.ehDependencyLoopE2eMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeEhSearchProviderE2e(input = {}) {
  const report = input.ehSearchProviderE2e || null
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready)
      && report?.thirdPartyExtensionScanned === true
      && report?.thirdPartyExtensionBuiltinFalse === true
      && report?.thirdPartyInstalledMarkerPresent === true
      && report?.activationEventsByEventHasExtension === true
      && report?.enabledApiProposalsPresent === true
      && report?.textProviderRegistered === true
      && report?.fileProviderRegistered === true
      && report?.activatedByOnSearchFile === true
      && report?.textProviderCalled === true
      && report?.fileProviderCalled === true
      && report?.textSearchEngine === "extension-search"
      && report?.textSearchProvider === "extension-host"
      && report?.fileSearchEngine === "extension-search"
      && report?.fallbackBypassed === true
      && Array.isArray(report?.providerErrors)
      && report.providerErrors.length === 0,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (report.ready ? "EH SearchProvider E2E 已就绪" : "EH SearchProvider E2E 需复核")
      : "暂无 EH SearchProvider E2E 证据",
    extensionId: String(report?.extensionId || ""),
    activationEvent: String(report?.activationEvent || ""),
    thirdPartyExtensionScanned: report?.thirdPartyExtensionScanned === true,
    thirdPartyExtensionBuiltinFalse: report?.thirdPartyExtensionBuiltinFalse === true,
    thirdPartyInstalledMarkerPresent: report?.thirdPartyInstalledMarkerPresent === true,
    activationEventsByEventHasExtension: report?.activationEventsByEventHasExtension === true,
    enabledApiProposalsPresent: report?.enabledApiProposalsPresent === true,
    textProviderRegistered: report?.textProviderRegistered === true,
    fileProviderRegistered: report?.fileProviderRegistered === true,
    activatedByOnSearchFile: report?.activatedByOnSearchFile === true,
    textProviderCalled: report?.textProviderCalled === true,
    fileProviderCalled: report?.fileProviderCalled === true,
    textSearchEngine: String(report?.textSearchEngine || ""),
    textSearchProvider: String(report?.textSearchProvider || ""),
    fileSearchEngine: String(report?.fileSearchEngine || ""),
    fallbackBypassed: report?.fallbackBypassed === true,
    providerErrors: Array.isArray(report?.providerErrors) ? report.providerErrors.length : 0,
    error: String(report?.error || ""),
    jsonPath: input.ehSearchProviderE2eJsonPath || report?.latestJsonPath || "",
    markdownPath: input.ehSearchProviderE2eMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeEhProfileContentHandlerE2e(input = {}) {
  const report = input.ehProfileContentHandlerE2e || null
  const providerErrors = Array.isArray(report?.providerErrors) ? report.providerErrors.length : 0
  const ready = Boolean(report?.ready)
    && report?.thirdPartyExtensionScanned === true
    && report?.thirdPartyExtensionBuiltinFalse === true
      && report?.thirdPartyInstalledMarkerPresent === true
      && report?.activationEventsByEventHasExtension === true
      && report?.enabledApiProposalsPresent === true
      && report?.activatedByOnProfileHandler === true
      && report?.handlerRegistered === true
    && report?.handlerMetadataMatched === true
    && report?.readProfileCalled === true
    && report?.readProfileReturnedTemplate === true
    && report?.saveProfileCalled === true
    && report?.saveProfileReturnedResult === true
    && report?.cleanupAfterStop === true
    && providerErrors === 0
  return {
    available: Boolean(report),
    ready,
    status: report?.status || (report ? ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (ready ? "EH ProfileContentHandler E2E 已就绪" : "EH ProfileContentHandler E2E 需复核")
      : "暂无 EH ProfileContentHandler E2E 证据",
    extensionId: String(report?.extensionId || ""),
    activationEvent: String(report?.activationEvent || ""),
    activatedByOnProfileHandler: report?.activatedByOnProfileHandler === true,
    handlerId: String(report?.handlerId || ""),
    thirdPartyExtensionScanned: report?.thirdPartyExtensionScanned === true,
    thirdPartyExtensionBuiltinFalse: report?.thirdPartyExtensionBuiltinFalse === true,
    thirdPartyInstalledMarkerPresent: report?.thirdPartyInstalledMarkerPresent === true,
    activationEventsByEventHasExtension: report?.activationEventsByEventHasExtension === true,
    enabledApiProposalsPresent: report?.enabledApiProposalsPresent === true,
    handlerRegistered: report?.handlerRegistered === true,
    handlerMetadataMatched: report?.handlerMetadataMatched === true,
    readProfileCalled: report?.readProfileCalled === true,
    readProfileReturnedTemplate: report?.readProfileReturnedTemplate === true,
    saveProfileCalled: report?.saveProfileCalled === true,
    saveProfileReturnedResult: report?.saveProfileReturnedResult === true,
    cleanupAfterStop: report?.cleanupAfterStop === true,
    handlerCount: Number(report?.handlerCount || 0),
    readContentLength: Number(report?.readContentLength || 0),
    providerErrors,
    error: String(report?.error || ""),
    jsonPath: input.ehProfileContentHandlerE2eJsonPath || report?.latestJsonPath || "",
    markdownPath: input.ehProfileContentHandlerE2eMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeEhMcpProviderBridge(input = {}) {
  const report = input.ehMcpProviderBridge || null
  const providerErrors = Array.isArray(report?.providerErrors) ? report.providerErrors.length : 0
  const ready = Boolean(report?.ready)
    && report?.mainThreadMcpRegistered === true
    && report?.definitionsPublishedToExtHost === true
    && report?.delegateTransportStarted === true
    && report?.secretRedactionVerified === true
    && report?.deletePublishesEmptyDefinitions === true
    && providerErrors === 0
  return {
    available: Boolean(report),
    ready,
    status: report?.status || (report ? ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (ready ? "EH MCP provider bridge 已就绪" : "EH MCP provider bridge 需复核")
      : "暂无 EH MCP provider bridge 证据",
    extensionId: String(report?.extensionId || ""),
    collectionId: String(report?.collectionId || ""),
    mainThreadMcpRegistered: report?.mainThreadMcpRegistered === true,
    definitionsPublishedToExtHost: report?.definitionsPublishedToExtHost === true,
    delegateTransportStarted: report?.delegateTransportStarted === true,
    secretRedactionVerified: report?.secretRedactionVerified === true,
    deletePublishesEmptyDefinitions: report?.deletePublishesEmptyDefinitions === true,
    providerErrors,
    error: String(report?.error || ""),
    jsonPath: input.ehMcpProviderBridgeJsonPath || report?.latestJsonPath || "",
    markdownPath: input.ehMcpProviderBridgeMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeInstalledMcpDiscovery(input = {}) {
  const report = input.installedMcpDiscovery || null
  const providerErrors = Array.isArray(report?.providerErrors) ? report.providerErrors.length : 0
  const ready = Boolean(report?.ready)
    && report?.installedMcpPersisted === true
    && report?.installedDiscoveryRead === true
    && report?.installedRegistryApplied === true
    && report?.workspaceDiscoveryFilteredInRegistryMode === true
    && report?.secretRedactionVerified === true
    && providerErrors === 0
  return {
    available: Boolean(report),
    ready,
    status: report?.status || (report ? ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (ready ? "Installed MCP discovery 已就绪" : "Installed MCP discovery 需复核")
      : "暂无 Installed MCP discovery 证据",
    extensionId: String(report?.extensionId || ""),
    installedMcpPersisted: report?.installedMcpPersisted === true,
    installedDiscoveryRead: report?.installedDiscoveryRead === true,
    installedRegistryApplied: report?.installedRegistryApplied === true,
    workspaceDiscoveryFilteredInRegistryMode: report?.workspaceDiscoveryFilteredInRegistryMode === true,
    secretRedactionVerified: report?.secretRedactionVerified === true,
    providerErrors,
    error: String(report?.error || ""),
    jsonPath: input.installedMcpDiscoveryJsonPath || report?.latestJsonPath || "",
    markdownPath: input.installedMcpDiscoveryMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeMcpGalleryManagement(input = {}) {
  const report = input.mcpGalleryManagement || null
  const providerErrors = Array.isArray(report?.providerErrors) ? report.providerErrors.length : 0
  const ready = Boolean(report?.ready)
    && report?.galleryInstallReady === true
    && report?.workspaceResourceWritten === true
    && report?.workspaceRegistryConsumed === true
    && report?.workbenchRegistryRouteReady === true
    && report?.galleryUninstallReady === true
    && report?.lifecycleEventsEmitted === true
    && providerErrors === 0
  return {
    available: Boolean(report),
    ready,
    status: report?.status || (report ? ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (ready ? "MCP Gallery management 已就绪" : "MCP Gallery management 需复核")
      : "暂无 MCP Gallery management 证据",
    galleryInstallReady: report?.galleryInstallReady === true,
    workspaceResourceWritten: report?.workspaceResourceWritten === true,
    workspaceRegistryConsumed: report?.workspaceRegistryConsumed === true,
    workbenchRegistryRouteReady: report?.workbenchRegistryRouteReady === true,
    registryRouteSnapshot: {
      collections: Number(report?.registryRouteSnapshot?.collections || 0),
      servers: Number(report?.registryRouteSnapshot?.servers || 0),
      delegates: Number(report?.registryRouteSnapshot?.delegates || 0),
    },
    galleryUninstallReady: report?.galleryUninstallReady === true,
    lifecycleEventsEmitted: report?.lifecycleEventsEmitted === true,
    providerErrors,
    error: String(report?.error || ""),
    jsonPath: input.mcpGalleryManagementJsonPath || report?.latestJsonPath || "",
    markdownPath: input.mcpGalleryManagementMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeExtensionCompatibilityMatrix(input = {}) {
  const report = input.extensionCompatibilityMatrix || null
  const summary = report?.summary || {}
  const extensions = Array.isArray(report?.extensions) ? report.extensions : []
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready) && Number(summary.blocked || 0) === 0 && Number(summary.sampled || 0) > 0,
    status: report?.status || (report ? report.ready ? "ready" : "blocked" : "missing"),
    statusLabel: report
      ? (report.ready ? "扩展 Top N 兼容矩阵已就绪" : "扩展 Top N 兼容矩阵需复核")
      : "暂无扩展 Top N 兼容矩阵证据",
    top: Number(summary.top || 0),
    sampled: Number(summary.sampled || 0),
    native: Number(summary.native || 0),
    compatible: Number(summary.compatible || 0),
    degraded: Number(summary.degraded || 0),
    blocked: Number(summary.blocked || 0),
    unsupportedContributionPoints: Number(summary.unsupportedContributionPoints || 0),
    partialContributionPoints: Number(summary.partialContributionPoints || 0),
    marketplace: extensions.filter((item) => item?.source === "marketplace").length,
    installed: extensions.filter((item) => item?.source === "installed").length,
    jsonPath: input.extensionCompatibilityMatrixJsonPath || report?.latestJsonPath || "",
    markdownPath: input.extensionCompatibilityMatrixMarkdownPath || report?.latestMarkdownPath || "",
  }
}

function summarizeBdUserTrial(input = {}) {
  const report = input.bdUserTrialReport || null
  const tasks = Array.isArray(report?.tasks) ? report.tasks : []
  const requiredTasks = tasks.filter((task) => task?.required !== false)
  const checks = Array.isArray(report?.checks) ? report.checks : []
  const failedChecks = checks.filter((check) => check?.status === "failed" || check?.passed === false)
  const privacy = report?.privacyPolicy || {}
  const deny = Array.isArray(privacy.deny) ? privacy.deny : []
  const hasPrivacyBoundary = ["prompt text", "attachment body", "source code body", "full command output"]
    .every((item) => deny.includes(item))
  const requiredCoverage = {
    singleAgent: tasks.some((task) => String(task.expectedStrategy || "").includes("single-agent")),
    multiAgent: tasks.some((task) => String(task.expectedStrategy || "").includes("multi-agent")),
    attachment: tasks.some((task) => /附件|attachment/i.test(`${task.title || ""} ${task.prompt || ""}`)),
    rollback: tasks.some((task) => /回滚|rollback/i.test(`${task.title || ""} ${task.requiredResult || ""}`)),
    qualityGateFailure: tasks.some((task) => /质量门|quality gate/i.test(`${task.title || ""} ${task.requiredResult || ""}`)),
    clarification: tasks.some((task) => /澄清|clarify|ask_user/i.test(`${task.title || ""} ${task.expectedStrategy || ""} ${task.evidence || ""}`)),
  }
  const coverageReady = Object.values(requiredCoverage).every(Boolean)
  const ready = Boolean(report?.ready) && tasks.length >= 10 && requiredTasks.length >= 10 && failedChecks.length === 0 && hasPrivacyBoundary && coverageReady
  return {
    available: Boolean(report),
    ready,
    status: report?.status || "",
    statusLabel: report ? (ready ? "BD 真实用户试运行计划已就绪" : "BD 真实用户试运行计划需补齐") : "暂无报告",
    reportKind: report?.reportKind || "",
    taskCount: tasks.length,
    requiredTasks: requiredTasks.length,
    checkPassed: checks.filter((check) => check?.status === "passed" || check?.passed === true).length,
    checkTotal: checks.length,
    startupChecks: Number(report?.summary?.startupChecks || 0),
    screenshotItems: Number(report?.summary?.screenshotItems || 0),
    hasPrivacyBoundary,
    coverage: requiredCoverage,
    markdownPath: input.bdUserTrialMarkdownPath || "",
    historyCount: Array.isArray(input.bdUserTrialHistory) ? input.bdUserTrialHistory.length : 0,
  }
}

function summarizeBetaTrialRun(input = {}) {
  const report = input.betaTrialRunReport || null
  const summary = report?.summary || {}
  const coverage = report?.coverage || {}
  const defects = Array.isArray(report?.defects) ? report.defects : []
  return {
    available: Boolean(report),
    ready: Boolean(report?.ready),
    status: report?.status || "",
    statusLabel: report ? (report.statusLabel || (report.ready ? "真实 Beta 执行已就绪" : "真实 Beta 执行需收敛")) : "暂无执行结果",
    reportKind: report?.reportKind || "",
    total: Number(summary.total || 0),
    passed: Number(summary.passed || 0),
    failed: Number(summary.failed || 0),
    blocked: Number(summary.blocked || 0),
    p0: Number(summary.p0 || 0),
    p1: Number(summary.p1 || 0),
    p2: Number(summary.p2 || 0),
    coverage: {
      singleAgent: coverage.singleAgent === true,
      multiAgent: coverage.multiAgent === true,
      attachment: coverage.attachment === true,
      rollback: coverage.rollback === true,
      qualityGateFailure: coverage.qualityGateFailure === true,
      clarification: coverage.clarification === true,
      releaseEvidence: coverage.releaseEvidence === true,
    },
    markdownPath: input.betaTrialRunMarkdownPath || "",
    historyCount: Array.isArray(input.betaTrialRunHistory) ? input.betaTrialRunHistory.length : 0,
    latestDefects: defects.slice(0, 5).map((defect) => ({
      severity: String(defect?.severity || ""),
      title: String(defect?.title || ""),
      taskId: String(defect?.taskId || ""),
      runId: String(defect?.runId || ""),
    })),
  }
}

function summarizeBetaFeedback(input = {}) {
  const feedback = input.betaFeedbackReport || input.betaTrialRunReport?.betaFeedback || null
  const entries = Array.isArray(feedback?.entries) ? feedback.entries : []
  return {
    available: Boolean(feedback?.available),
    ready: feedback?.available ? Boolean(feedback?.ready) : true,
    status: feedback?.status || (feedback?.available ? "ready" : "missing"),
    statusLabel: feedback?.statusLabel || (feedback?.available ? "人工 Beta 反馈已记录" : "暂无人工 Beta 反馈"),
    total: Number(feedback?.total || 0),
    imported: Number(feedback?.imported || 0),
    rejected: Number(feedback?.rejected || 0),
    privacyViolations: Number(feedback?.privacyViolations || 0),
    passed: Number(feedback?.passed || 0),
    failed: Number(feedback?.failed || 0),
    blocked: Number(feedback?.blocked || 0),
    p0: Number(feedback?.p0 || 0),
    p1: Number(feedback?.p1 || 0),
    p2: Number(feedback?.p2 || 0),
    screenshotCount: Number(feedback?.screenshotCount || 0),
    pendingRegression: Number(feedback?.pendingRegression || 0),
    averageScore: typeof feedback?.averageScore === "number" ? feedback.averageScore : null,
    latestFeedback: entries.slice(0, 5).map((entry) => ({
      feedbackId: String(entry?.feedbackId || ""),
      taskId: String(entry?.taskId || ""),
      status: String(entry?.status || ""),
      severity: String(entry?.severity || ""),
      defectStatus: String(entry?.defectStatus || ""),
      hasRegressionEvidence: entry?.hasRegressionEvidence === true,
    })),
  }
}

function summarizeDemoTaskReport(input = {}) {
  const realTrial = input.realTrialReport?.realWorkspaceTrial || {}
  const report = input.demoTaskReport || realTrial.demoTaskReport || null
  const tasks = Array.isArray(report?.tasks) ? report.tasks : []
  const roleProfiles = Array.isArray(report?.roleProfiles) ? report.roleProfiles : []
  const roleTrials = Array.isArray(report?.roleTrials) ? report.roleTrials : Array.isArray(report?.agentRoleTrials) ? report.agentRoleTrials : []
  const requiredTasks = Array.isArray(report?.requiredTasks) && report.requiredTasks.length
    ? report.requiredTasks
    : ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08"]
  const coveredTasks = Array.isArray(report?.coveredTasks) && report.coveredTasks.length
    ? report.coveredTasks
    : [...new Set(tasks.map((item) => String(item?.id || item?.taskId || "").toUpperCase()).filter((id) => /^T0[1-8]$/.test(id)))]
  const missingTasks = Array.isArray(report?.missingTasks)
    ? report.missingTasks
    : requiredTasks.filter((id) => !coveredTasks.includes(id))
  const qualityGate = report?.qualityGate || {}
  const costReview = report?.costReview || {}
  const ready = Boolean(report?.ready) ||
    (Boolean(report) &&
      missingTasks.length === 0 &&
      (roleProfiles.length > 0 || roleTrials.length > 0) &&
      Boolean(qualityGate.status || qualityGate.summary) &&
      Boolean(costReview.available || costReview.estimatedCostUsd !== undefined))
  return {
    available: Boolean(report),
    ready,
    status: report?.status || (report ? ready ? "ready" : "needs_review" : "missing"),
    statusLabel: report ? (ready ? "Day 11-12 演示报告已就绪" : "Day 11-12 演示报告需复核") : "暂无 Day 11-12 演示报告",
    requiredTasks,
    coveredTasks,
    missingTasks,
    taskCount: tasks.length,
    roleProfileCount: roleProfiles.length,
    roleTrialCount: roleTrials.length,
    roleProfiles: roleProfiles.slice(0, 8).map((item) => ({
      id: String(item?.id || item?.profileId || item?.label || ""),
      label: String(item?.label || item?.name || item?.id || ""),
      benefit: String(item?.benefit || ""),
      noise: String(item?.noise || ""),
      recommendation: String(item?.recommendation || ""),
    })),
    roleTrials: roleTrials.slice(0, 8).map((item) => ({
      id: String(item?.id || item?.trialId || ""),
      profileId: String(item?.profileId || item?.roleProfile || ""),
      status: String(item?.status || ""),
      baselineMinutes: Number.isFinite(Number(item?.baselineMinutes)) ? Number(item.baselineMinutes) : null,
      trialMinutes: Number.isFinite(Number(item?.trialMinutes)) ? Number(item.trialMinutes) : null,
      benefit: String(item?.benefit || ""),
      noise: String(item?.noise || ""),
    })),
    roleBenefitSummary: String(report?.roleBenefitSummary || ""),
    roleNoiseSummary: String(report?.roleNoiseSummary || ""),
    qualityGate: {
      status: String(qualityGate.status || ""),
      summary: String(qualityGate.summary || ""),
    },
    costReview: {
      estimatedCostUsd: Number(costReview.estimatedCostUsd || 0),
      currency: String(costReview.currency || "USD"),
      manualReviewMinutes: Number(costReview.manualReviewMinutes || 0),
      unpricedRequests: Number(costReview.unpricedRequests || 0),
    },
    failureReview: {
      summary: String(report?.failureReview?.summary || ""),
      recommendation: String(report?.failureReview?.recommendation || ""),
    },
    rollbackRecommendation: {
      action: String(report?.rollbackRecommendation?.action || ""),
      reason: String(report?.rollbackRecommendation?.reason || ""),
    },
    nextHumanAcceptance: Array.isArray(report?.nextHumanAcceptance) ? report.nextHumanAcceptance.map((item) => String(item || "")).filter(Boolean) : [],
    markdownPath: input.realTrialMarkdownPath || "",
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : []
}

function compactStrings(values) {
  return toArray(values).map((value) => String(value || "").trim()).filter(Boolean)
}

function normalizeRoleTrialPermissionScope(source = {}, fallback = {}) {
  const scope = source.permissionScope || source.permissions || {}
  return {
    readPaths: compactStrings(scope.readPaths || source.readPaths || fallback.readPaths),
    writePaths: compactStrings(scope.writePaths || source.writePaths || source.lockedFiles || fallback.writePaths),
    allowedTools: compactStrings(scope.allowedTools || source.allowedTools),
    commandAllowlist: compactStrings(scope.commandAllowlist || source.commandAllowlist || fallback.commandAllowlist),
    network: scope.network === true || source.network === true || fallback.network === true,
    install: scope.install === true || source.install === true || fallback.install === true,
    externalTool: scope.externalTool === true || source.externalTool === true || fallback.externalTool === true,
    destructive: scope.destructive === true || source.destructive === true || fallback.destructive === true,
  }
}

function normalizeAgentRoleTrial(raw = {}, fallback = {}) {
  const role = String(raw.role || raw.agentRole || fallback.role || "").trim()
  const profileId = String(raw.profileId || raw.profile || raw.profileName || fallback.profileId || role || "").trim()
  return {
    id: String(raw.id || fallback.id || `${fallback.runId || "run"}:${fallback.assignmentId || role || profileId}`).trim(),
    taskId: String(raw.taskId || raw.subtaskId || raw.phaseId || fallback.taskId || "").trim(),
    runId: String(raw.runId || fallback.runId || "").trim(),
    assignmentId: String(raw.assignmentId || fallback.assignmentId || "").trim(),
    role,
    profileId,
    profileSource: String(raw.profileSource || raw.source || "external-agent-template").trim(),
    selectionReason: String(raw.selectionReason || raw.reason || raw.profileSelectionReason || "").trim(),
    permissionScope: normalizeRoleTrialPermissionScope(raw, fallback.permissionScope || fallback),
    validationAdvice: compactStrings(raw.validationAdvice || raw.validationSuggestions || raw.verificationAdvice),
    benefit: String(raw.benefit || raw.trialBenefit || raw.expectedBenefit || "").trim(),
    noise: String(raw.noise || raw.trialNoise || raw.observedNoise || "").trim(),
    runtimeFit: String(raw.runtimeFit || raw.runtimeRecommendation || raw.runtimeIntegration || "").trim(),
    worthRuntimeIntegration: raw.worthRuntimeIntegration === true || raw.runtimeIntegrationRecommended === true,
    evidenceRefs: compactStrings(raw.evidenceRefs || raw.artifactIds || fallback.evidenceRefs),
  }
}

function collectAgentRoleTrials(input = {}, evidenceRuns = []) {
  const candidates = []
  const pushRunTrials = (run = {}) => {
    const permissionFallback = run.permissionRequest || {}
    for (const trial of toArray(run.agentRoleTrials || run.roleProfileTrials)) {
      candidates.push({ trial, fallback: { runId: run.id, permissionScope: permissionFallback } })
    }
    for (const assignment of toArray(run.assignments)) {
      const assignmentTrial = assignment.agentRoleTrial || assignment.roleProfileTrial || assignment.profileTrial
      if (!assignmentTrial && !assignment.profileId && !assignment.profileSource && !assignment.profileSelectionReason) continue
      candidates.push({
        trial: assignmentTrial || assignment,
        fallback: {
          id: assignment.id,
          runId: run.id,
          assignmentId: assignment.id,
          taskId: assignment.phaseId,
          role: assignment.role,
          profileId: assignment.profileId,
          permissionScope: {
            ...permissionFallback,
            readPaths: assignment.readPaths || permissionFallback.readPaths,
            writePaths: assignment.writePaths || assignment.lockedFiles || permissionFallback.writePaths,
            allowedTools: assignment.allowedTools,
            commandAllowlist: permissionFallback.commandAllowlist,
          },
        },
      })
    }
    for (const artifact of toArray(run.artifacts)) {
      const artifactTrials = [
        artifact.metadata?.agentRoleTrial,
        ...toArray(artifact.metadata?.agentRoleTrials),
      ].filter(Boolean)
      for (const trial of artifactTrials) {
        candidates.push({
          trial,
          fallback: {
            runId: run.id,
            assignmentId: artifact.assignmentId || "",
            evidenceRefs: [artifact.id],
            permissionScope: permissionFallback,
          },
        })
      }
    }
  }

  pushRunTrials(input.agentRoleTrialReport || {})
  for (const run of evidenceRuns) pushRunTrials(run)
  for (const trial of toArray(input.agentRoleTrials || input.roleProfileTrials)) {
    candidates.push({ trial, fallback: {} })
  }

  const seen = new Set()
  return candidates
    .map(({ trial, fallback }) => normalizeAgentRoleTrial(trial, fallback))
    .filter((trial) => {
      const key = `${trial.taskId}|${trial.assignmentId}|${trial.role}|${trial.profileId}`
      if (!trial.role && !trial.profileId) return false
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function summarizeAgentRoleTrials(input = {}, evidenceRuns = []) {
  const trials = collectAgentRoleTrials(input, evidenceRuns)
  const decision = input.agentRoleTrialDecision || input.agentRoleTrialReport?.agentRoleTrialDecision || input.runtimeProfileDecision || {}
  const requiredTrialCount = Number(decision.requiredTrialCount || 2)
  const completeTrials = trials.filter((trial) =>
    trial.role && trial.profileId && trial.selectionReason && trial.validationAdvice.length > 0,
  ).length
  const runtimeIntegrationRecommended = typeof decision.runtimeIntegrationRecommended === "boolean"
    ? decision.runtimeIntegrationRecommended
    : trials.some((trial) => trial.worthRuntimeIntegration || /recommend|yes|worth|接入|值得/i.test(trial.runtimeFit))
  const ready = trials.length >= requiredTrialCount && completeTrials >= requiredTrialCount
  return {
    available: trials.length > 0,
    ready,
    status: trials.length === 0 ? "missing" : ready ? "ready" : "degraded",
    statusLabel: trials.length === 0
      ? "暂无角色 profile 试用证据"
      : ready ? `${completeTrials}/${requiredTrialCount} 角色 profile 试用证据已就绪` : `${completeTrials}/${requiredTrialCount} 角色 profile 试用证据需补齐`,
    requiredTrialCount,
    trialCount: trials.length,
    completeTrials,
    runtimeIntegrationRecommended,
    recommendation: String(decision.recommendation || (runtimeIntegrationRecommended ? "recommend-runtime-integration" : "keep-as-template-only")),
    decisionReason: String(decision.reason || ""),
    runtimeContract: {
      attachToExistingOrchestratorRun: true,
      attachToAssignment: true,
      attachToEventArtifactEvidence: true,
      noSecondStateSource: true,
    },
    trials,
  }
}

function summarizeTaskRun(run = {}) {
  const steps = Array.isArray(run.steps) ? run.steps : []
  const status = normalizeTaskRunStatus(run.status)
  const sanitizedSteps = steps.slice(0, 20).map((step) => summarizeTaskRunStep(step))
  const problemDiagnostics = steps.reduce((total, step) => total + toFiniteNumber(step.problemDiagnostics), 0)
  return {
    id: String(run.id || ""),
    name: String(run.name || ""),
    status,
    blockedCount: Array.isArray(run.blocked) ? run.blocked.length : 0,
    startedAt: Number.isFinite(Number(run.startedAt)) ? Number(run.startedAt) : null,
    finishedAt: Number.isFinite(Number(run.finishedAt)) ? Number(run.finishedAt) : null,
    durationMs: Number.isFinite(Number(run.durationMs)) ? Number(run.durationMs) : null,
    stepCount: steps.length,
    passedSteps: sanitizedSteps.filter((step) => step.status === "passed").length,
    failedSteps: sanitizedSteps.filter((step) => step.status === "failed").length,
    skippedSteps: sanitizedSteps.filter((step) => step.status === "skipped").length,
    runningSteps: sanitizedSteps.filter((step) => step.status === "running").length,
    maxDependencyDepth: sanitizedSteps.reduce((max, step) => Math.max(max, step.dependencyDepth), 0),
    hasParallelSteps: sanitizedSteps.some((step) => step.runMode === "parallel"),
    problemDiagnostics,
    hasProblemDiagnostics: problemDiagnostics > 0,
    steps: sanitizedSteps,
  }
}

function summarizeTaskRunStep(step = {}) {
  const outputPreview = String(step.outputPreview || "")
  const errorPreview = String(step.errorPreview || "")
  const command = String(step.command || "")
  const workingDir = String(step.workingDir || "")
  return {
    id: String(step.id || ""),
    name: String(step.name || ""),
    status: normalizeTaskRunStatus(step.status),
    exitCode: typeof step.exitCode === "number" ? step.exitCode : null,
    durationMs: Number.isFinite(Number(step.durationMs)) ? Number(step.durationMs) : null,
    runMode: step.runMode === "parallel" ? "parallel" : "sequence",
    dependencyDepth: toFiniteNumber(step.dependencyDepth),
    commandHash: hashText(command),
    commandLength: command.length,
    workingDirHash: hashText(workingDir),
    outputHash: hashText(outputPreview),
    outputLength: outputPreview.length,
    errorHash: hashText(errorPreview),
    errorLength: errorPreview.length,
  }
}

const QUALITY_GATE_BUCKETS = [
  "focusedTests",
  "typecheck",
  "sourceBoundary",
  "gitDiffCheck",
  "frontendDistConsistency",
  "build",
  "lint",
  "other",
]

function buildQualityGateSummary(input = {}, evidenceRuns = [], taskRuns = {}) {
  const commands = collectQualityGateCommands(input, evidenceRuns, taskRuns)
  const buckets = QUALITY_GATE_BUCKETS.reduce((acc, id) => {
    acc[id] = {
      id,
      label: qualityGateBucketLabel(id),
      status: "not_run",
      passed: 0,
      failed: 0,
      blocked: 0,
      running: 0,
      skipped: 0,
      total: 0,
      commands: [],
    }
    return acc
  }, {})

  for (const command of commands) {
    const bucket = buckets[command.bucket] || buckets.other
    bucket.total += 1
    bucket[command.status] = toFiniteNumber(bucket[command.status]) + 1
    bucket.commands.push(command)
  }

  for (const bucket of Object.values(buckets)) {
    bucket.status = summarizeQualityGateBucketStatus(bucket)
    bucket.commands = bucket.commands.slice(0, 12)
  }

  const requiredIds = ["focusedTests", "typecheck", "sourceBoundary", "gitDiffCheck"]
  const required = requiredIds.map((id) => buckets[id])
  const failed = Object.values(buckets).reduce((total, bucket) => total + bucket.failed, 0)
  const blocked = Object.values(buckets).reduce((total, bucket) => total + bucket.blocked, 0)
  const running = Object.values(buckets).reduce((total, bucket) => total + bucket.running, 0)
  const total = Object.values(buckets).reduce((sum, bucket) => sum + bucket.total, 0)
  const requiredPassed = required.filter((bucket) => bucket.status === "passed").length
  const ready = total > 0 && failed === 0 && blocked === 0 && running === 0 && requiredPassed === required.length

  return {
    available: total > 0,
    ready,
    status: total === 0 ? "missing" : ready ? "ready" : failed > 0 || blocked > 0 ? "failed" : "degraded",
    statusLabel: total === 0
      ? "暂无质量门命令证据"
      : ready ? "质量门证据已就绪" : `${requiredPassed}/${required.length} 核心质量门通过，失败 ${failed}，阻断 ${blocked}`,
    total,
    passed: Object.values(buckets).reduce((sum, bucket) => sum + bucket.passed, 0),
    failed,
    blocked,
    running,
    skipped: Object.values(buckets).reduce((sum, bucket) => sum + bucket.skipped, 0),
    required: requiredIds,
    requiredPassed,
    buckets,
    commands: commands.slice(0, 30),
  }
}

function collectQualityGateCommands(input = {}, evidenceRuns = [], taskRuns = {}) {
  const commands = []
  const seen = new Set()
  const add = (item = {}) => {
    const command = String(item.command || item.name || item.id || "").trim()
    if (!command) return
    const status = normalizeQualityGateStatus(item.status, item.exitCode, item.timedOut)
    const key = `${command}|${item.source || ""}|${status}|${item.exitCode ?? ""}`
    if (seen.has(key)) return
    seen.add(key)
    commands.push({
      command,
      source: String(item.source || "qualityGate"),
      status,
      bucket: classifyQualityGateCommand(command, item),
      exitCode: Number.isFinite(Number(item.exitCode)) ? Number(item.exitCode) : null,
      timedOut: item.timedOut === true,
      durationMs: Number.isFinite(Number(item.durationMs)) ? Number(item.durationMs) : null,
      commandHash: hashText(command),
    })
  }

  for (const run of evidenceRuns) {
    const gateResults = Array.isArray(run?.integrationDecision?.qualityGate?.commandResults)
      ? run.integrationDecision.qualityGate.commandResults
      : []
    for (const result of gateResults) add({ ...result, source: "qualityGate" })
    if (gateResults.length === 0 && Array.isArray(run?.qualityGateCommands)) {
      for (const command of run.qualityGateCommands) {
        add({ command, source: "qualityGate", status: run?.integrationDecision?.qualityGate?.status || "unknown" })
      }
    }
  }

  for (const run of Array.isArray(taskRuns.runs) ? taskRuns.runs : []) {
    for (const step of Array.isArray(run.steps) ? run.steps : []) {
      add({
        command: step.command || step.name || step.id,
        source: "taskRuns",
        status: step.status,
        exitCode: step.exitCode,
        durationMs: step.durationMs,
        timedOut: step.timedOut,
      })
    }
  }

  for (const command of Array.isArray(input.qualityGateCommands) ? input.qualityGateCommands : []) {
    if (typeof command === "string") add({ command, source: "qualityGate", status: "unknown" })
    else add({ ...command, source: command?.source || "qualityGate" })
  }

  return commands
}

function normalizeQualityGateStatus(status, exitCode, timedOut) {
  if (timedOut === true) return "failed"
  if (Number.isFinite(Number(exitCode))) return Number(exitCode) === 0 ? "passed" : "failed"
  const value = String(status || "").toLowerCase()
  if (["passed", "ready", "success", "ok"].includes(value)) return "passed"
  if (["failed", "error", "not_ready"].includes(value)) return "failed"
  if (["blocked", "denied"].includes(value)) return "blocked"
  if (["running", "pending"].includes(value)) return "running"
  if (["skipped", "not_run", "missing"].includes(value)) return "skipped"
  return "skipped"
}

function classifyQualityGateCommand(command, item = {}) {
  const text = `${command} ${item.id || ""} ${item.name || ""}`.toLowerCase()
  if (/check:vscode-source-boundary|vscode-source-boundary|source[-_ ]boundary/.test(text)) return "sourceBoundary"
  if (/git\s+diff\s+--check|diff-check|whitespace/.test(text)) return "gitDiffCheck"
  if (/frontend-dist-consistency|inject-frontend-csp|dist consistency/.test(text)) return "frontendDistConsistency"
  if (/typecheck|vue-tsc|tsc\s+(-b\s+)?--noemit|tsc\s+--noemit/.test(text)) return "typecheck"
  if (/(node\s+--test|vitest|jest|playwright|npm\s+(run\s+)?test|focused test|\.test\.(js|ts|tsx)|test:)/.test(text)) return "focusedTests"
  if (/(npm\s+run\s+build|vite build|electron-builder|pack:|build:)/.test(text)) return "build"
  if (/(npm\s+run\s+lint|eslint|lint)/.test(text)) return "lint"
  return "other"
}

function summarizeQualityGateBucketStatus(bucket = {}) {
  if (toFiniteNumber(bucket.failed) > 0) return "failed"
  if (toFiniteNumber(bucket.blocked) > 0) return "blocked"
  if (toFiniteNumber(bucket.running) > 0) return "running"
  if (toFiniteNumber(bucket.total) === 0) return "not_run"
  if (toFiniteNumber(bucket.passed) === toFiniteNumber(bucket.total)) return "passed"
  return "degraded"
}

function qualityGateBucketLabel(id) {
  if (id === "focusedTests") return "Focused tests"
  if (id === "typecheck") return "Typecheck"
  if (id === "sourceBoundary") return "VS Code source boundary"
  if (id === "gitDiffCheck") return "git diff --check"
  if (id === "frontendDistConsistency") return "Frontend dist consistency"
  if (id === "build") return "Build"
  if (id === "lint") return "Lint"
  return "Other"
}

function buildCostReviewSummary(usageSummary = null, input = {}) {
  const history = Array.isArray(usageSummary?.history) ? usageSummary.history : []
  const models = Array.from(new Map(history.map((item) => {
    const provider = String(item?.provider || "unknown")
    const model = String(item?.model || "unknown")
    return [`${provider}:${model}`, { provider, model }]
  })).values()).slice(0, 10)
  const totalRequests = toFiniteNumber(usageSummary?.totalRequests)
  const totalTokens = toFiniteNumber(usageSummary?.totalTokens)
  const cost = usageSummary?.cost || {}
  const pricedRequests = toFiniteNumber(cost.pricedRequests)
  const unpricedRequests = toFiniteNumber(cost.unpricedRequests)
  const unavailableReasons = []
  if (!usageSummary) unavailableReasons.push("usage_audit_missing")
  if (totalRequests === 0) unavailableReasons.push("no_model_requests_recorded")
  if (totalTokens === 0) unavailableReasons.push("token_usage_unavailable")
  if (totalRequests > 0 && pricedRequests === 0) unavailableReasons.push("cost_price_table_unavailable")
  if (unpricedRequests > 0) unavailableReasons.push("some_model_prices_unavailable")

  return {
    available: totalRequests > 0,
    ready: totalRequests > 0 && totalTokens > 0,
    status: totalRequests === 0 ? "missing" : totalTokens > 0 ? "ready" : "degraded",
    statusLabel: totalRequests === 0 ? "成本摘要暂无模型用量" : `${totalRequests} 次模型请求，${totalTokens} tokens`,
    models,
    totalRequests,
    inputTokens: toFiniteNumber(usageSummary?.inputTokens),
    outputTokens: toFiniteNumber(usageSummary?.outputTokens),
    totalTokens,
    estimatedCostUsd: toFiniteNumber(cost.estimatedCostUsd),
    costCurrency: cost.currency || "USD",
    pricedRequests,
    unpricedRequests,
    tokenUnavailableReason: totalTokens === 0 ? unavailableReasons[0] || "token_usage_unavailable" : "",
    costUnavailableReason: pricedRequests === 0 ? unavailableReasons.find((reason) => /cost|price|missing|recorded/.test(reason)) || "" : "",
    unavailableReasons,
    durationMs: Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : null,
    manualReviewMinutes: Number.isFinite(Number(input.manualReviewMinutes)) ? Number(input.manualReviewMinutes) : null,
    manualReviewPlaceholder: "manual_review_minutes_pending",
  }
}

function buildFailureClassification(evidence = {}, gaps = []) {
  const qualityGate = evidence.qualityGateSummary || {}
  const buckets = qualityGate.buckets || {}
  const classifications = []
  const add = (id, label, matched, detail, severity = "high") => {
    if (!matched || classifications.some((item) => item.id === id)) return
    classifications.push({ id, label, severity, detail, userVisible: true })
  }
  add("test_failure", "测试失败", toFiniteNumber(buckets.focusedTests?.failed) > 0 || toFiniteNumber(evidence.taskRuns?.failed) > 0, "focused tests 或任务运行存在失败。")
  add("type_failure", "类型失败", toFiniteNumber(buckets.typecheck?.failed) > 0, "typecheck / vue-tsc / tsc 质量门失败。")
  add("source_boundary_failure", "source-boundary", toFiniteNumber(buckets.sourceBoundary?.failed) > 0, "VS Code source-boundary 检查失败。")
  add("frontend_dist_failure", "frontend dist consistency", toFiniteNumber(buckets.frontendDistConsistency?.failed) > 0, "frontend dist 同步或引用一致性检查失败。", "medium")
  add("diff_check_failure", "git diff --check", toFiniteNumber(buckets.gitDiffCheck?.failed) > 0, "git diff --check 发现空白或冲突标记问题。", "medium")
  add("environment_blocker", "环境 blocker", gaps.some((gap) => /packaging|preflight|ar_health|shell|debug|environment|环境/i.test(`${gap.id} ${gap.title} ${gap.reason}`)), "环境、打包、Shell、调试或运行预检证据缺失/未就绪。", "medium")
  add("user_decision_blocker", "用户决策 blocker", gaps.some((gap) => /manual|approval|permission|authorization|用户|人工|授权|审批/i.test(`${gap.id} ${gap.title} ${gap.reason}`)), "需要用户授权、人工验收或审批决策。", "medium")
  add("quality_gate_failure", "质量门失败", toFiniteNumber(qualityGate.failed) > 0 || toFiniteNumber(qualityGate.blocked) > 0, `${qualityGate.failed || 0} 个失败，${qualityGate.blocked || 0} 个阻断。`)
  return {
    available: classifications.length > 0 || qualityGate.available === true || gaps.length > 0,
    ready: classifications.length === 0,
    status: classifications.length === 0 ? "ready" : "classified",
    statusLabel: classifications.length === 0 ? "未发现失败分类" : classifications.map((item) => item.label).join("；"),
    classifications,
  }
}

const AGENT_EVIDENCE_WORKBENCH_STAGE_IDS = [
  "plan",
  "role-profile-trial",
  "execution",
  "tests",
  "failure-diagnostics",
  "real-ui",
  "workspace-diff",
  "approval",
  "rollback",
]

const AGENT_EVIDENCE_WORKBENCH_STATUSES = ["ready", "degraded", "blocked", "missing"]

function buildAgentEvidenceWorkbench(evidence = {}, options = {}) {
  const gaps = Array.isArray(options.gaps) ? options.gaps : []
  const blockingGaps = Array.isArray(options.blockingGaps) ? options.blockingGaps : []
  const timestamp = toFiniteNumber(options.createdAt, Date.now())
  const taskRuns = evidence.taskRuns || {}
  const qualityGateSummary = evidence.qualityGateSummary || {}
  const taskRunRows = Array.isArray(taskRuns.runs) ? taskRuns.runs : []
  const problemDiagnostics = taskRunRows.reduce((total, run) => total + toFiniteNumber(run.problemDiagnostics), 0)
  const agentRoleTrials = evidence.agentRoleTrials || {}
  const realTrial = evidence.realWorkspaceTrial || {}
  const sandboxSecurity = evidence.sandboxSecurity || {}
  const agentChangeSafety = evidence.agentChangeSafety || {}
  const workbenchRealProjectUi = evidence.workbenchRealProjectUi || {}
  const manualRealUiEvidence = evidence.manualRealUiEvidence || {}
  const files = Array.isArray(realTrial.filesChanged) ? realTrial.filesChanged.map((item) => String(item || "")).filter(Boolean).slice(0, 20) : []
  const taskRunIssueCount = toFiniteNumber(taskRuns.failed)
    + toFiniteNumber(taskRuns.blocked)
    + toFiniteNumber(taskRuns.running)
    + toFiniteNumber(taskRuns.skipped)
  const commandAuthorizationBlocked = toFiniteNumber(sandboxSecurity.commandAuthorizationBlocked)
  const commandAuthorizationNeedsPermission = toFiniteNumber(sandboxSecurity.commandAuthorizationNeedsPermission)
  const qualityGateFailures = toFiniteNumber(sandboxSecurity.qualityGateFailures)
    + toFiniteNumber(qualityGateSummary.failed)
    + toFiniteNumber(qualityGateSummary.blocked)
  const manualUiAvailable = manualRealUiEvidence.available === true
  const automatedUiAvailable = workbenchRealProjectUi.available === true
  const automatedUiReady = workbenchRealProjectUi.ready === true
  const manualUiReady = manualRealUiEvidence.ready === true
  const approval = {
    permissionStatus: String(sandboxSecurity.permissionStatus || ""),
    permissionRisk: String(sandboxSecurity.permissionRisk || ""),
    permissionApproved: sandboxSecurity.permissionApproved === true,
    writePathCount: toFiniteNumber(sandboxSecurity.writePathCount),
    commandAllowlistCount: toFiniteNumber(sandboxSecurity.commandAllowlistCount),
    commandAuthorizationBlocked,
    commandAuthorizationNeedsPermission,
    agentReviewBlocked: agentChangeSafety.reviewDisplayBlocked === true
      || agentChangeSafety.pendingBatchBlocked === true
      || agentChangeSafety.pendingHunkBlocked === true,
    operationLogVisible: agentChangeSafety.operationLogVisible === true,
  }
  const scm = {
    fileCount: files.length,
    files,
    mainWorkspaceProtected: realTrial.mainWorkspaceUntouchedBeforeAccept === true,
    rollbackAvailable: realTrial.rollbackAvailable === true || sandboxSecurity.rollbackAvailable === true,
    pendingBatchBlocked: agentChangeSafety.pendingBatchBlocked === true,
    pendingHunkBlocked: agentChangeSafety.pendingHunkBlocked === true,
    reviewDisplayBlocked: agentChangeSafety.reviewDisplayBlocked === true,
  }
  const rollback = {
    rollbackAvailable: scm.rollbackAvailable,
    mainWorkspaceProtected: scm.mainWorkspaceProtected,
    agentRollbackDriftBlocked: agentChangeSafety.rollbackBlocked === true,
    operationLogVisible: agentChangeSafety.operationLogVisible === true,
  }
  const testing = {
    taskRuns: toFiniteNumber(taskRuns.total),
    passed: toFiniteNumber(taskRuns.passed),
    failed: toFiniteNumber(taskRuns.failed),
    blocked: toFiniteNumber(taskRuns.blocked),
    running: toFiniteNumber(taskRuns.running),
    skipped: toFiniteNumber(taskRuns.skipped),
    problemDiagnostics,
    qualityGateStatus: String(sandboxSecurity.qualityGateStatus || ""),
    qualityGateCommands: Math.max(toFiniteNumber(sandboxSecurity.qualityGateCommands), toFiniteNumber(qualityGateSummary.total)),
    qualityGateFailures,
    qualityGateSummaryStatus: String(qualityGateSummary.status || ""),
    qualityGateRequiredPassed: toFiniteNumber(qualityGateSummary.requiredPassed),
    qualityGateRequiredTotal: Array.isArray(qualityGateSummary.required) ? qualityGateSummary.required.length : 0,
    latestTask: taskRuns.latest ? String(taskRuns.latest.name || taskRuns.latest.id || "") : "",
  }
  const failure = {
    blockingGaps: blockingGaps.length,
    highGaps: gaps.filter((gap) => gap?.severity === "high").length,
    mediumGaps: gaps.filter((gap) => gap?.severity === "medium").length,
    taskRunIssues: taskRunIssueCount,
    qualityGateFailures,
    problemDiagnostics,
    latestBlockingGap: blockingGaps[0] ? {
      id: String(blockingGaps[0].id || ""),
      title: String(blockingGaps[0].title || ""),
      status: String(blockingGaps[0].status || ""),
      severity: String(blockingGaps[0].severity || ""),
    } : null,
  }

  const timeline = [
    buildAgentEvidenceWorkbenchStage({
      stage: "plan",
      title: "计划与上下文",
      available: evidence.readiness?.available === true || evidence.codebaseContext?.available === true,
      ready: evidence.readiness?.ready === true && evidence.codebaseContext?.ready === true,
      blocking: evidence.readiness?.status === "blocked" || evidence.codebaseContext?.status === "blocked",
      summary: `上下文 ${toFiniteNumber(evidence.codebaseContext?.sources)} 个来源 · 预检 ${evidence.readiness?.statusLabel || "-"}`,
      evidenceRefs: ["readiness", "codebaseContext"],
      nextAction: "补齐需求、上下文索引和发布预检证据。",
    }),
    buildAgentEvidenceWorkbenchStage({
      stage: "role-profile-trial",
      title: "角色 profile 试用",
      available: agentRoleTrials.available === true,
      ready: agentRoleTrials.ready === true,
      blocking: agentRoleTrials.status === "blocked",
      summary: `${toFiniteNumber(agentRoleTrials.completeTrials)}/${toFiniteNumber(agentRoleTrials.requiredTrialCount)} 完整试用 · ${agentRoleTrials.runtimeIntegrationRecommended ? "建议接入运行时" : "仅保留模板"}`,
      evidenceRefs: ["agentRoleTrials", "assignments", "decisionLog", "artifacts"],
      nextAction: "至少两个子任务记录角色选择理由、权限范围、验证建议、收益/噪音和运行时接入结论。",
    }),
    buildAgentEvidenceWorkbenchStage({
      stage: "execution",
      title: "受控执行",
      available: evidence.sandboxSecurity?.available === true || evidence.runActionAudit?.available === true,
      ready: evidence.sandboxSecurity?.ready === true && (!evidence.runActionAudit?.available || evidence.runActionAudit?.ready === true),
      blocking: evidence.sandboxSecurity?.status === "blocked",
      summary: `${toFiniteNumber(evidence.sandboxSecurity?.isolatedAssignments)}/${toFiniteNumber(evidence.sandboxSecurity?.assignmentCount)} 隔离 assignment · 动作 ${evidence.runActionAudit?.statusLabel || "-"}`,
      evidenceRefs: ["sandboxSecurity", "runActionAudit"],
      nextAction: "确保 Agent 在隔离工作区执行并留下控制台动作审计。",
    }),
    buildAgentEvidenceWorkbenchStage({
      stage: "tests",
      title: "测试与质量门",
      available: taskRuns.available === true,
      ready: taskRuns.available === true && taskRuns.ready === true,
      blocking: taskRunIssueCount > 0 || qualityGateFailures > 0,
      summary: `${testing.passed}/${testing.taskRuns} 任务运行 · 诊断 ${problemDiagnostics} · 质量门 ${formatTaskRunStatus(testing.qualityGateStatus)}`,
      evidenceRefs: ["taskRuns", "sandboxSecurity"],
      nextAction: "运行 focused tests/typecheck/build，并保留失败退出码和诊断元数据。",
    }),
    buildAgentEvidenceWorkbenchStage({
      stage: "failure-diagnostics",
      title: "失败定位",
      available: gaps.length > 0 || taskRuns.available === true || evidence.sandboxSecurity?.available === true,
      ready: blockingGaps.length === 0 && taskRunIssueCount === 0 && qualityGateFailures === 0,
      blocking: blockingGaps.length > 0 || taskRunIssueCount > 0 || qualityGateFailures > 0,
      summary: `${blockingGaps.length} 阻断缺口 · ${taskRunIssueCount} 任务问题 · ${qualityGateFailures} 质量门失败`,
      evidenceRefs: ["gaps", "taskRuns", "sandboxSecurity"],
      nextAction: "优先处理高/中严重度缺口和失败任务，再刷新 release evidence。",
    }),
    buildAgentEvidenceWorkbenchStage({
      stage: "real-ui",
      title: "真实 UI 验收",
      available: automatedUiAvailable || manualUiAvailable,
      ready: automatedUiReady && manualUiReady,
      blocking: workbenchRealProjectUi.status === "blocked" || manualRealUiEvidence.status === "blocked",
      summary: `automated ${workbenchRealProjectUi.statusLabel || "-"} · manual ${manualRealUiEvidence.statusLabel || "-"}`,
      evidenceRefs: ["workbenchRealProjectUi", "manualRealUiEvidence"],
      nextAction: "补齐真实项目 UI smoke 和人工手感确认。",
    }),
    buildAgentEvidenceWorkbenchStage({
      stage: "workspace-diff",
      title: "工作区 diff",
      available: realTrial.available === true || files.length > 0,
      ready: files.length > 0 && realTrial.mainWorkspaceUntouchedBeforeAccept === true,
      blocking: realTrial.available === true && realTrial.mainWorkspaceUntouchedBeforeAccept !== true,
      summary: `${files.length} 文件 · 主工作区保护 ${realTrial.mainWorkspaceUntouchedBeforeAccept === true ? "是" : "否"}`,
      evidenceRefs: ["realWorkspaceTrial", "agentChangeSafety"],
      nextAction: "确认 proposal-only 试运行、文件范围和主工作区保护证据。",
    }),
    buildAgentEvidenceWorkbenchStage({
      stage: "approval",
      title: "审批与漂移阻断",
      available: evidence.sandboxSecurity?.available === true || agentChangeSafety.available === true,
      ready: approval.permissionApproved && agentChangeSafety.ready === true && commandAuthorizationBlocked === 0 && commandAuthorizationNeedsPermission === 0,
      blocking: commandAuthorizationBlocked > 0 || commandAuthorizationNeedsPermission > 0 || agentChangeSafety.status === "blocked",
      summary: `权限 ${approval.permissionStatus || "-"} · 评审阻断 ${approval.agentReviewBlocked ? "是" : "否"} · 命令阻断 ${commandAuthorizationBlocked}`,
      evidenceRefs: ["sandboxSecurity", "agentChangeSafety"],
      nextAction: "确认权限审批、命令授权、pending patch 和 hunk 级漂移阻断。",
    }),
    buildAgentEvidenceWorkbenchStage({
      stage: "rollback",
      title: "回滚风险说明",
      available: realTrial.available === true || agentChangeSafety.available === true || evidence.sandboxSecurity?.available === true,
      ready: rollback.rollbackAvailable && rollback.agentRollbackDriftBlocked,
      blocking: agentChangeSafety.status === "blocked" || (realTrial.available === true && realTrial.rollbackAvailable !== true),
      summary: `回滚可用 ${rollback.rollbackAvailable ? "是" : "否"} · 漂移阻断 ${rollback.agentRollbackDriftBlocked ? "是" : "否"}`,
      evidenceRefs: ["realWorkspaceTrial", "agentChangeSafety", "sandboxSecurity"],
      nextAction: "补齐可回滚快照、rollback operation log 和手工改动漂移阻断证据。",
    }),
  ]

  const surface = buildAgentEvidenceWorkbenchSurfaceSummary({
    timeline,
    testing,
    failure,
    scm,
    approval,
    rollback,
    agentRoleTrials,
  })
  const report = buildAgentEvidenceWorkbenchReport({
    evidence,
    timeline,
    testing,
    failure,
    scm,
    approval,
    rollback,
    agentRoleTrials,
    gaps,
    timestamp,
    evidenceRuns: options.evidenceRuns,
  })
  const readyStages = timeline.filter((item) => item.status === "ready").length
  const availableStages = timeline.filter((item) => item.available).length
  return {
    schemaVersion: 1,
    available: availableStages > 0,
    ready: timeline.length > 0 && readyStages === timeline.length,
    status: readyStages === timeline.length ? "ready" : availableStages > 0 ? "degraded" : "missing",
    statusLabel: readyStages === timeline.length
      ? "Agent evidence workbench 已就绪"
      : availableStages > 0 ? `${readyStages}/${timeline.length} evidence workbench 阶段就绪` : "暂无 Agent evidence workbench 证据",
    stageStatusSchema: {
      stageIds: AGENT_EVIDENCE_WORKBENCH_STAGE_IDS.slice(),
      statuses: AGENT_EVIDENCE_WORKBENCH_STATUSES.slice(),
    },
    stageCount: timeline.length,
    readyStages,
    availableStages,
    timeline,
    testing,
    failure,
    scm,
    approval,
    rollback,
    agentRoleTrials,
    report,
    surface,
    sourceEvidence: [
      "readiness",
      "codebaseContext",
      "sandboxSecurity",
      "taskRuns",
      "workbenchRealProjectUi",
      "manualRealUiEvidence",
      "realWorkspaceTrial",
      "agentChangeSafety",
      "agentRoleTrials",
    ],
  }
}

function buildAgentEvidenceWorkbenchReport(input = {}) {
  const evidence = input.evidence || {}
  const timeline = Array.isArray(input.timeline) ? input.timeline : []
  const testing = input.testing || {}
  const failure = input.failure || {}
  const scm = input.scm || {}
  const approval = input.approval || {}
  const rollback = input.rollback || {}
  const agentRoleTrials = input.agentRoleTrials || evidence.agentRoleTrials || {}
  const gaps = Array.isArray(input.gaps) ? input.gaps : []
  const evidenceRuns = Array.isArray(input.evidenceRuns) ? input.evidenceRuns : []
  const timestamp = toFiniteNumber(input.timestamp, Date.now())
  const correlationBase = evidence.realWorkspaceTrial?.runId
    || evidence.sandboxSecurity?.runId
    || evidence.runActionAudit?.latestRunId
    || timestamp
  const correlationId = `agent-evidence:${String(correlationBase || timestamp)}`
  const workspace = {
    root: String(evidence.workbenchRealProjectUi?.projectRoot
      || evidence.manualRealUiEvidence?.projectRoot
      || evidenceRuns.find((run) => run?.projectRoot)?.projectRoot
      || ""),
    protected: scm.mainWorkspaceProtected === true,
    isolation: findEvidenceWorkspaceIsolation(evidenceRuns, evidence.sandboxSecurity),
  }
  const artifacts = collectAgentEvidenceArtifacts(evidence)
  const commands = collectAgentEvidenceCommands({
    evidenceRuns,
    testing,
    sandboxSecurity: evidence.sandboxSecurity,
    artifacts,
  })
  const runEvidence = collectAgentRunEvidence({
    evidence,
    evidenceRuns,
    timeline,
    testing,
    failure,
    scm,
    approval,
    rollback,
    commands,
  })
  const failureCauses = collectAgentEvidenceFailureCauses({
    gaps,
    failure,
    testing,
    scm,
    approval,
    rollback,
  })
  const failureClassification = evidence.failureClassification || buildFailureClassification(evidence, gaps)
  const nextActions = collectAgentEvidenceNextActions({
    gaps,
    timeline,
    failureCauses,
  })
  const progress = collectAgentEvidenceProgress({
    timeline,
    correlationId,
  })
  const notifications = collectAgentEvidenceNotifications({
    failureCauses,
    nextActions,
    correlationId,
    timestamp,
  })
  return {
    schemaVersion: 1,
    source: "releaseEvidence",
    timestamp,
    workspace,
    correlationId,
    commands,
    artifacts,
    runStateSchema: {
      states: AGENT_RUN_STATES.slice(),
      transitions: Object.fromEntries(Object.entries(AGENT_RUN_STATE_TRANSITIONS).map(([state, next]) => [state, next.slice()])),
    },
    runs: runEvidence,
    qualityGateSummary: evidence.qualityGateSummary || null,
    costReview: evidence.costReview || null,
    failureClassification,
    failureCauses,
    nextActions,
    roleProfiles: agentRoleTrials,
    progress,
    notifications,
  }
}

function collectAgentRunEvidence(input = {}) {
  const evidence = input.evidence || {}
  const evidenceRuns = Array.isArray(input.evidenceRuns) ? input.evidenceRuns : []
  const timeline = Array.isArray(input.timeline) ? input.timeline : []
  const testing = input.testing || {}
  const failure = input.failure || {}
  const scm = input.scm || {}
  const approval = input.approval || {}
  const rollback = input.rollback || {}
  const commands = Array.isArray(input.commands) ? input.commands : []
  const runs = evidenceRuns.length ? evidenceRuns : [archivedEvidenceToRun(evidence)]
  return runs
    .map((run, index) => buildAgentRunEvidence({
      run,
      index,
      evidence,
      timeline,
      testing,
      failure,
      scm,
      approval,
      rollback,
      commands,
    }))
    .filter(Boolean)
    .slice(0, 10)
}

function archivedEvidenceToRun(evidence = {}) {
  return {
    id: evidence.realWorkspaceTrial?.runId || evidence.sandboxSecurity?.runId || evidence.runActionAudit?.latestRunId || "release-evidence-run",
    status: evidence.realWorkspaceTrial?.ready ? "completed" : evidence.sandboxSecurity?.status === "blocked" ? "waiting_user" : "planning",
    createdAt: evidence.realWorkspaceTrial?.updatedAt || null,
    updatedAt: evidence.realWorkspaceTrial?.updatedAt || null,
    projectRoot: evidence.workbenchRealProjectUi?.projectRoot || evidence.manualRealUiEvidence?.projectRoot || "",
    qualityGateCommands: [],
    integrationDecision: {
      proposedPatch: { filesChanged: evidence.realWorkspaceTrial?.filesChanged || [] },
      qualityGate: { status: evidence.taskRuns?.ready ? "passed" : evidence.taskRuns?.status || "" },
    },
    permissionRequest: { status: evidence.sandboxSecurity?.permissionStatus || "" },
  }
}

function buildAgentRunEvidence(input = {}) {
  const run = input.run || {}
  const evidence = input.evidence || {}
  const timeline = Array.isArray(input.timeline) ? input.timeline : []
  const commands = Array.isArray(input.commands) ? input.commands : []
  const files = collectRunChangedFiles(run, input.scm)
  const validationCommands = collectRunValidationCommands(run, commands)
  const failureReasons = collectRunFailureReasons(run, input.failure, input.approval, input.rollback)
  const state = normalizeRunState(run)
  return {
    id: String(run.id || run.runId || `agent-run-${input.index + 1}`),
    state,
    stateLabel: labelForAgentRunState(state),
    plannedAt: finiteOrNull(run.plannedAt || run.createdAt),
    assignedAt: finiteOrNull(run.assignedAt || firstAssignmentTimestamp(run)),
    startedAt: finiteOrNull(run.startedAt),
    updatedAt: finiteOrNull(run.updatedAt || run.finishedAt || run.createdAt),
    completedAt: finiteOrNull(run.finishedAt || run.completedAt),
    plan: {
      summary: String(run.summary || evidence.readiness?.statusLabel || "Agent run plan evidence"),
      goal: String(run.goal || run.promptSummary || ""),
      steps: collectRunPlanSteps(run, timeline),
      contextRefs: uniqueStrings([
        ...(Array.isArray(run.contextEvidence?.mentions) ? run.contextEvidence.mentions.map((item) => item?.id || item?.label) : []),
        ...(Array.isArray(run.contextEvidence?.rules) ? run.contextEvidence.rules.map((item) => item?.path || item?.title) : []),
      ]),
    },
    phases: timeline.map((stage) => ({
      id: String(stage.stage || ""),
      title: String(stage.title || stage.stage || ""),
      status: String(stage.status || ""),
      ready: stage.ready === true,
      evidenceRefs: Array.isArray(stage.evidenceRefs) ? stage.evidenceRefs.map(String).filter(Boolean) : [],
      nextAction: String(stage.nextAction || ""),
    })),
    changedFiles: files,
    diffSummary: {
      filesChanged: files.length,
      files,
      summary: files.length ? `${files.length} 文件变更待审阅` : "暂无文件级 diff evidence",
      source: files.length ? "integrationDecision.proposedPatch" : "releaseEvidence",
    },
    validationCommands,
    failureReasons,
    rollbackRecommendation: buildRollbackRecommendation(run, input.rollback),
    costSummary: buildRunCostSummary(evidence.llmUsage),
  }
}

function collectRunChangedFiles(run = {}, scm = {}) {
  return uniqueStrings([
    ...(Array.isArray(run.integrationDecision?.proposedPatch?.filesChanged) ? run.integrationDecision.proposedPatch.filesChanged : []),
    ...(Array.isArray(run.realWorkspaceTrial?.filesChanged) ? run.realWorkspaceTrial.filesChanged : []),
    ...(Array.isArray(scm?.files) ? scm.files : []),
  ]).slice(0, 20)
}

function collectRunValidationCommands(run = {}, commands = []) {
  const fromCommands = commands.map((item) => ({
    command: String(item.command || ""),
    status: String(item.status || "unknown"),
    exitCode: Number.isFinite(Number(item.exitCode)) ? Number(item.exitCode) : null,
    source: String(item.source || "qualityGate"),
    timedOut: item.timedOut === true,
  }))
  const gateResults = Array.isArray(run.integrationDecision?.qualityGate?.commandResults)
    ? run.integrationDecision.qualityGate.commandResults.map((item) => ({
      command: String(item?.command || ""),
      status: normalizeAgentEvidenceCommandStatus(item?.status, item?.exitCode, item?.timedOut),
      exitCode: Number.isFinite(Number(item?.exitCode)) ? Number(item.exitCode) : null,
      source: "qualityGate",
      timedOut: item?.timedOut === true,
    }))
    : []
  const fromList = Array.isArray(run.qualityGateCommands)
    ? run.qualityGateCommands.map((command) => ({
      command: String(command || ""),
      status: normalizeAgentEvidenceCommandStatus(run.integrationDecision?.qualityGate?.status || "", null, false),
      exitCode: null,
      source: "qualityGate",
      timedOut: false,
    }))
    : []
  return uniqueByCommand([...gateResults, ...fromCommands, ...fromList]).filter((item) => item.command).slice(0, 20)
}

function collectRunFailureReasons(run = {}, failure = {}, approval = {}, rollback = {}) {
  const reasons = []
  const add = (id, stage, severity, detail) => {
    if (!detail || reasons.some((item) => item.id === id)) return
    reasons.push({ id, stage, severity, detail: String(detail) })
  }
  add("blocking-gap", "failure-diagnostics", "error", failure.latestBlockingGap?.title || failure.latestBlockingGap?.status)
  add("task-run-issues", "tests", "error", failure.taskRunIssues > 0 ? `${failure.taskRunIssues} 个任务运行问题` : "")
  add("quality-gate-failures", "tests", "error", failure.qualityGateFailures > 0 ? `${failure.qualityGateFailures} 个质量门失败` : "")
  add("approval-pending", "approval", "warning", approval.commandAuthorizationBlocked > 0 || approval.commandAuthorizationNeedsPermission > 0 ? `blocked ${approval.commandAuthorizationBlocked || 0}, needs ${approval.commandAuthorizationNeedsPermission || 0}` : "")
  add("rollback-risk", "rollback", "warning", rollback.rollbackAvailable !== true ? "回滚证据缺失或不可用" : "")
  add("run-blocking-reason", "failure-diagnostics", "warning", run.blockingReason || run.error || "")
  return reasons.slice(0, 20)
}

function buildRollbackRecommendation(run = {}, rollback = {}) {
  const rollbackResult = run.integrationDecision?.rollbackResult || run.rollbackResult || null
  const available = rollback.rollbackAvailable === true || Boolean(run.integrationDecision?.applySnapshot) || Boolean(rollbackResult)
  const driftBlocked = rollback.agentRollbackDriftBlocked === true
  return {
    available,
    action: rollbackResult?.status === "success" ? "already-rolled-back" : available ? "review-and-rollback-if-rejected" : "capture-rollback-snapshot-before-accept",
    detail: available
      ? "可基于 applySnapshot / rollback operation log 复核回滚路径。"
      : "接受前需要补齐可回滚快照和 drift 阻断证据。",
    driftBlocked,
  }
}

function buildRunCostSummary(llmUsage = {}) {
  return {
    available: llmUsage?.available === true,
    totalRequests: toFiniteNumber(llmUsage?.totalRequests),
    inputTokens: toFiniteNumber(llmUsage?.inputTokens),
    outputTokens: toFiniteNumber(llmUsage?.outputTokens),
    totalTokens: toFiniteNumber(llmUsage?.totalTokens),
    estimatedCostUsd: Number(llmUsage?.estimatedCostUsd || 0),
    currency: llmUsage?.costCurrency || "USD",
    estimated: llmUsage?.costEstimated !== false,
    placeholder: llmUsage?.available !== true,
  }
}

function collectRunPlanSteps(run = {}, timeline = []) {
  const planned = Array.isArray(run.plan?.steps) ? run.plan.steps : []
  const fromPlan = planned.map((step, index) => ({
    id: String(step?.id || `step-${index + 1}`),
    title: String(step?.title || step?.description || step?.instruction || ""),
    status: String(step?.status || "planned"),
  }))
  if (fromPlan.length > 0) return fromPlan.slice(0, 20)
  return timeline.map((stage) => ({
    id: String(stage.stage || ""),
    title: String(stage.title || stage.stage || ""),
    status: stage.ready === true ? "verified" : stage.available === true ? "running" : "planned",
  })).slice(0, 20)
}

function firstAssignmentTimestamp(run = {}) {
  const assignments = Array.isArray(run.assignments) ? run.assignments : []
  const assignment = assignments.find((item) => Number.isFinite(Number(item?.createdAt || item?.startedAt || item?.updatedAt)))
  return assignment?.createdAt || assignment?.startedAt || assignment?.updatedAt || null
}

function finiteOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null
}

function labelForAgentRunState(state) {
  if (state === "planned") return "已计划"
  if (state === "assigned") return "已分配"
  if (state === "running") return "运行中"
  if (state === "review-ready") return "待审阅"
  if (state === "verified") return "已验证"
  if (state === "blocked") return "已阻断"
  if (state === "accepted") return "已接受"
  if (state === "rolled-back") return "已回滚"
  return state || "未知"
}

function uniqueByCommand(items = []) {
  const seen = new Set()
  const unique = []
  for (const item of items) {
    const command = String(item?.command || "")
    const key = `${command}|${item?.source || ""}`
    if (!command || seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }
  return unique
}

function uniqueStrings(values = []) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)))
}

function findEvidenceWorkspaceIsolation(evidenceRuns = [], sandboxSecurity = {}) {
  for (const run of evidenceRuns) {
    const assignments = Array.isArray(run?.assignments) ? run.assignments : []
    const isolated = assignments.find((assignment) => assignment?.workspace?.isolation)
    if (isolated?.workspace?.isolation) return String(isolated.workspace.isolation)
  }
  const isolationTypes = sandboxSecurity?.workspaceIsolationTypes || {}
  const first = Object.keys(isolationTypes).find((key) => key && key !== "main" && toFiniteNumber(isolationTypes[key]) > 0)
  if (first) return first
  if (toFiniteNumber(sandboxSecurity?.isolatedAssignments) > 0) return "isolated"
  return ""
}

function collectAgentEvidenceCommands(input = {}) {
  const evidenceRuns = Array.isArray(input.evidenceRuns) ? input.evidenceRuns : []
  const testing = input.testing || {}
  const sandboxSecurity = input.sandboxSecurity || {}
  const commands = []
  const seen = new Set()
  const addCommand = (item = {}) => {
    const command = String(item.command || "").trim()
    if (!command) return
    const key = `${command}|${item.source || ""}|${item.status || ""}|${item.exitCode ?? ""}`
    if (seen.has(key)) return
    seen.add(key)
    commands.push({
      command,
      source: String(item.source || "qualityGate"),
      status: normalizeAgentEvidenceCommandStatus(item.status, item.exitCode, item.timedOut),
      exitCode: Number.isFinite(Number(item.exitCode)) ? Number(item.exitCode) : null,
      timedOut: item.timedOut === true,
      artifactIds: Array.isArray(item.artifactIds) ? item.artifactIds.map(String).filter(Boolean) : [],
      rerunCommandId: item.source === "qualityGate" || item.source === "taskRuns" ? "agent.evidence.reviewTests" : "",
    })
  }
  for (const run of evidenceRuns) {
    const gateResults = Array.isArray(run?.integrationDecision?.qualityGate?.commandResults)
      ? run.integrationDecision.qualityGate.commandResults
      : []
    for (const result of gateResults) {
      addCommand({
        command: result?.command,
        source: "qualityGate",
        status: result?.status,
        exitCode: result?.exitCode,
        timedOut: result?.timedOut,
      })
    }
    if (gateResults.length === 0 && Array.isArray(run?.qualityGateCommands)) {
      for (const command of run.qualityGateCommands) {
        addCommand({
          command,
          source: "qualityGate",
          status: sandboxSecurity.qualityGateFailures > 0 ? "failed" : sandboxSecurity.qualityGateStatus || "passed",
        })
      }
    }
  }
  if (commands.length === 0 && testing.latestTask) {
    addCommand({
      command: testing.latestTask,
      source: "taskRuns",
      status: testing.failed > 0 || testing.qualityGateFailures > 0 ? "failed" : "passed",
      rerunCommandId: "agent.evidence.reviewTests",
    })
  }
  return commands.slice(0, 20)
}

function normalizeAgentEvidenceCommandStatus(status, exitCode, timedOut) {
  if (timedOut === true) return "failed"
  if (Number.isFinite(Number(exitCode))) return Number(exitCode) === 0 ? "passed" : "failed"
  const normalized = String(status || "").toLowerCase()
  if (["passed", "failed", "blocked", "running", "skipped"].includes(normalized)) return normalized
  if (normalized === "ready") return "passed"
  return normalized || "unknown"
}

function collectAgentEvidenceArtifacts(evidence = {}) {
  const artifacts = []
  const addArtifact = (source, kind, pathValue, label) => {
    const artifactPath = String(pathValue || "").trim()
    if (!artifactPath) return
    const id = `artifact:${source}:${kind}:${artifacts.length + 1}`
    artifacts.push({
      id,
      kind,
      label,
      path: artifactPath,
      source,
    })
  }
  for (const [source, section] of Object.entries(evidence)) {
    if (!section || typeof section !== "object" || source === "agentEvidenceWorkbench") continue
    addArtifact(source, "json", section.jsonPath, `${source} JSON`)
    addArtifact(source, "markdown", section.markdownPath, `${source} Markdown`)
    addArtifact(source, "screenshot", section.screenshotPath, `${source} screenshot`)
  }
  return artifacts.slice(0, 40)
}

function collectAgentEvidenceFailureCauses(input = {}) {
  const gaps = Array.isArray(input.gaps) ? input.gaps : []
  const failure = input.failure || {}
  const testing = input.testing || {}
  const scm = input.scm || {}
  const approval = input.approval || {}
  const rollback = input.rollback || {}
  const causes = []
  const addCause = (item = {}) => {
    const id = String(item.id || "").trim()
    if (!id || causes.some((cause) => cause.id === id)) return
    causes.push({
      id,
      severity: normalizeAgentEvidenceSeverity(item.severity),
      title: String(item.title || id),
      detail: String(item.detail || item.reason || ""),
      source: String(item.source || sourceForAgentEvidenceId(id)),
      stage: String(item.stage || stageForAgentEvidenceId(id)),
    })
  }
  for (const gap of gaps) {
    addCause({
      id: gap?.id,
      severity: gap?.severity,
      title: gap?.title,
      detail: gap?.reason || gap?.action,
      source: sourceForAgentEvidenceId(gap?.id),
      stage: stageForAgentEvidenceId(gap?.id),
    })
  }
  if (failure.taskRunIssues > 0) {
    addCause({
      id: "task_run_issues",
      severity: "high",
      title: "任务运行存在失败、阻断或跳过",
      detail: `${failure.taskRunIssues} 个任务运行问题`,
      source: "taskRuns",
      stage: "tests",
    })
  }
  if (testing.qualityGateFailures > 0 || failure.qualityGateFailures > 0) {
    addCause({
      id: "quality_gate_failures",
      severity: "high",
      title: "质量门失败",
      detail: `${testing.qualityGateFailures || failure.qualityGateFailures} 个质量门失败`,
      source: "sandboxSecurity",
      stage: "tests",
    })
  }
  if (rollback.rollbackAvailable !== true || scm.rollbackAvailable !== true) {
    addCause({
      id: "rollback_unavailable",
      severity: "medium",
      title: "回滚证据缺失或不可用",
      detail: "缺少可回滚快照、rollback operation log 或主工作区保护证据",
      source: "realWorkspaceTrial",
      stage: "rollback",
    })
  }
  if (approval.commandAuthorizationBlocked > 0 || approval.commandAuthorizationNeedsPermission > 0 || approval.permissionApproved !== true) {
    addCause({
      id: "approval_pending",
      severity: "medium",
      title: "审批或命令授权待处理",
      detail: `blocked ${approval.commandAuthorizationBlocked || 0}, needs ${approval.commandAuthorizationNeedsPermission || 0}`,
      source: "sandboxSecurity",
      stage: "approval",
    })
  }
  return causes.slice(0, 20)
}

function collectAgentEvidenceNextActions(input = {}) {
  const gaps = Array.isArray(input.gaps) ? input.gaps : []
  const timeline = Array.isArray(input.timeline) ? input.timeline : []
  const failureCauses = Array.isArray(input.failureCauses) ? input.failureCauses : []
  const actions = []
  const addAction = (item = {}) => {
    const id = String(item.id || "").trim()
    if (!id || actions.some((action) => action.id === id)) return
    const stage = String(item.stage || stageForAgentEvidenceId(id))
    const surface = String(item.surface || surfaceForAgentEvidenceStage(stage))
    actions.push({
      id,
      label: String(item.label || item.title || id),
      surface,
      stage,
      priority: normalizeAgentEvidencePriority(item.priority || item.severity),
      commandId: commandForAgentEvidenceStage(stage),
      focusTarget: surface,
    })
  }
  for (const gap of gaps) {
    addAction({
      id: gap?.id,
      label: gap?.action || gap?.title,
      severity: gap?.severity,
      stage: stageForAgentEvidenceId(gap?.id),
    })
  }
  for (const cause of failureCauses) {
    addAction({
      id: cause.id,
      label: cause.detail || cause.title,
      severity: cause.severity,
      stage: cause.stage,
    })
  }
  for (const stage of timeline) {
    if (stage?.available === true && stage?.ready !== true) {
      addAction({
        id: `stage:${stage.stage}`,
        label: stage.nextAction || stage.summary || stage.title,
        stage: stage.stage,
        severity: stage.status === "blocked" ? "high" : "medium",
      })
    }
  }
  return actions.slice(0, 20)
}

function collectAgentEvidenceProgress(input = {}) {
  const timeline = Array.isArray(input.timeline) ? input.timeline : []
  const correlationId = String(input.correlationId || "")
  return timeline
    .filter((stage) => stage?.available === true && stage?.ready !== true)
    .slice(0, 12)
    .map((stage) => ({
      id: `agentEvidence.progress.${stage.stage}`,
      title: String(stage.title || stage.stage || ""),
      message: String(stage.nextAction || stage.summary || ""),
      stage: String(stage.stage || ""),
      status: String(stage.status || ""),
      correlationId,
      total: 1,
      worked: stage.status === "degraded" ? 0.5 : 0,
      location: stage.status === "blocked" ? "notification" : "window",
      cancellable: false,
      aggregateStatus: String(stage.status || ""),
      ariaLabel: `${String(stage.title || stage.stage || "")}: ${String(stage.nextAction || stage.summary || "")}`,
      cancelCommandId: "agent.evidence.cancelProgress",
    }))
}

function collectAgentEvidenceNotifications(input = {}) {
  const failureCauses = Array.isArray(input.failureCauses) ? input.failureCauses : []
  const nextActions = Array.isArray(input.nextActions) ? input.nextActions : []
  const correlationId = String(input.correlationId || "")
  const timestamp = toFiniteNumber(input.timestamp, Date.now())
  return failureCauses.slice(0, 8).map((cause) => ({
    id: `agentEvidence.${cause.id}`,
    severity: cause.severity,
    message: cause.detail ? `${cause.title}: ${cause.detail}` : cause.title,
    source: "Agent Evidence",
    correlationId,
    lifecycle: {
      state: "active",
      sticky: cause.severity !== "info",
      updatedAt: timestamp,
      dismissible: true,
    },
    dedupeKey: `agentEvidence.notification.${String(cause.id || "").replace(/[^A-Za-z0-9_.-]+/g, "-") || "message"}`,
    dismissCommandId: "agent.evidence.dismissNotification",
    focusTarget: "notifications",
    ariaLabel: `${cause.severity}: ${cause.detail ? `${cause.title}: ${cause.detail}` : cause.title}`,
    actions: nextActions
      .filter((action) => action.stage === cause.stage || action.id === cause.id)
      .slice(0, 2)
      .map((action) => ({ id: action.commandId, label: action.label, surface: action.surface })),
  }))
}

function normalizeAgentEvidenceSeverity(value) {
  const severity = String(value || "").toLowerCase()
  if (severity === "high" || severity === "error") return "error"
  if (severity === "medium" || severity === "low" || severity === "warning") return "warning"
  return "info"
}

function normalizeAgentEvidencePriority(value) {
  const priority = String(value || "").toLowerCase()
  if (priority === "high" || priority === "error") return "high"
  if (priority === "medium" || priority === "warning") return "medium"
  return "normal"
}

function sourceForAgentEvidenceId(id) {
  const value = String(id || "")
  if (value.includes("manual_real_ui")) return "manualRealUiEvidence"
  if (value.includes("workbench_real_project_ui")) return "workbenchRealProjectUi"
  if (value.includes("task") || value.includes("quality_gate")) return "taskRuns"
  if (value.includes("sandbox") || value.includes("approval") || value.includes("permission") || value.includes("authorization")) return "sandboxSecurity"
  if (value.includes("rollback") || value.includes("real_workspace")) return "realWorkspaceTrial"
  if (value.includes("agent_change")) return "agentChangeSafety"
  if (value.includes("context")) return "codebaseContext"
  return "releaseEvidence"
}

function stageForAgentEvidenceId(id) {
  const value = String(id || "")
  if (value.includes("manual_real_ui") || value.includes("workbench_real_project_ui")) return "real-ui"
  if (value.includes("task") || value.includes("quality_gate")) return "tests"
  if (value.includes("sandbox") || value.includes("approval") || value.includes("permission") || value.includes("authorization")) return "approval"
  if (value.includes("rollback")) return "rollback"
  if (value.includes("real_workspace")) return "workspace-diff"
  if (value.includes("context") || value.includes("readiness")) return "plan"
  return "failure-diagnostics"
}

function surfaceForAgentEvidenceStage(stage) {
  const value = String(stage || "")
  if (value === "tests") return "testing"
  if (value === "workspace-diff" || value === "rollback") return "scm"
  if (value === "approval" || value === "failure-diagnostics") return "notifications"
  return "progress"
}

function commandForAgentEvidenceStage(stage) {
  const surface = surfaceForAgentEvidenceStage(stage)
  if (surface === "testing") return "agent.evidence.reviewTests"
  if (surface === "scm" && stage === "rollback") return "agent.evidence.reviewRollback"
  if (surface === "scm") return "agent.evidence.openScm"
  if (surface === "notifications") return "agent.evidence.openNotifications"
  return "agent.evidence.openTimeline"
}

function buildAgentEvidenceWorkbenchListSummaryItems({ timeline = [], files = [], testing = {}, testState = "unknown", progressStages = [], notificationMessages = [] } = {}) {
  const stageItems = timeline.map((item, index) => ({
    id: `timeline:${String(item.stage || "")}:${index}`,
    surface: "timeline",
    stage: String(item.stage || ""),
    label: String(item.title || item.stage || ""),
    status: String(item.status || "unknown"),
    severity: severityForAgentEvidenceStatus(item.status),
    commandId: commandForAgentEvidenceStage(item.stage),
  }))
  const scmItems = files.map((file) => ({
    id: `scm:${file}`,
    surface: "scm",
    stage: "workspace-diff",
    label: String(file || ""),
    status: "modified",
    severity: "warning",
    commandId: "agent.evidence.openResource",
  }))
  const testingItems = toFiniteNumber(testing.taskRuns) > 0 || String(testing.latestTask || "")
    ? [{
      id: "testing:agentEvidence.latestTask",
      surface: "testing",
      stage: "tests",
      label: String(testing.latestTask || "Agent evidence quality gates"),
      status: testState,
      severity: severityForAgentEvidenceStatus(testState),
      commandId: "agent.evidence.reviewTests",
    }]
    : []
  const progressItems = progressStages.map((item) => ({
    id: `progress:agentEvidence.progress.${String(item.stage || "")}`,
    surface: "progress",
    stage: String(item.stage || ""),
    label: String(item.title || item.stage || ""),
    status: String(item.status || "unknown"),
    severity: severityForAgentEvidenceStatus(item.status),
    commandId: "agent.evidence.cancelProgress",
  }))
  const notificationItems = notificationMessages.map((message, index) => ({
    id: `notifications:agentEvidence.notification.${index + 1}`,
    surface: "notifications",
    stage: "failure-diagnostics",
    label: String(message || ""),
    status: "active",
    severity: /failed|失败|阻断|错误/i.test(String(message || "")) ? "error" : "warning",
    commandId: "agent.evidence.dismissNotification",
  }))
  return [...stageItems, ...scmItems, ...testingItems, ...progressItems, ...notificationItems]
}

function severityForAgentEvidenceStatus(status) {
  const value = String(status || "").toLowerCase()
  if (value === "failed" || value === "blocked" || value === "error") return "error"
  if (value === "degraded" || value === "missing" || value === "warning" || value === "cancelled" || value === "canceled") return "warning"
  return "info"
}

function buildAgentEvidenceWorkbenchSurfaceSummary(input = {}) {
  const timeline = Array.isArray(input.timeline) ? input.timeline : []
  const scm = input.scm || {}
  const testing = input.testing || {}
  const failure = input.failure || {}
  const approval = input.approval || {}
  const rollback = input.rollback || {}
  const files = Array.from(new Set((Array.isArray(scm.files) ? scm.files : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)))
  const blocked = timeline.filter((item) => item.status === "blocked")
  const degraded = timeline.filter((item) => item.status === "degraded")
  const missing = timeline.filter((item) => item.status === "missing")
  const progressStages = timeline.filter((item) => item.available === true && item.ready !== true)
  const testState = testing.running > 0 ? "running"
    : testing.failed > 0 || testing.qualityGateFailures > 0 ? "failed"
      : testing.blocked > 0 ? "blocked"
        : testing.skipped > 0 && testing.passed === 0 ? "skipped"
          : testing.taskRuns > 0 && testing.passed === testing.taskRuns ? "passed"
            : "unknown"
  const notificationMessages = []
  if (failure.blockingGaps > 0 || failure.highGaps > 0) {
    const gap = failure.latestBlockingGap
    notificationMessages.push(gap?.title ? `${gap.title}: ${gap.status || "blocked"}` : `${failure.blockingGaps || 0} 个阻断缺口`)
  }
  if (testing.failed > 0 || testing.qualityGateFailures > 0) {
    notificationMessages.push(`${testing.latestTask || "测试与质量门"} 需要处理: failed ${testing.failed || 0}, quality gate ${testing.qualityGateFailures || 0}`)
  }
  if (rollback.rollbackAvailable !== true || scm.rollbackAvailable !== true) {
    notificationMessages.push("回滚证据缺失或不可用")
  }
  if (progressStages.some((item) => item.stage === "real-ui")) {
    notificationMessages.push("真实 UI evidence 未就绪")
  }
  if (approval.commandAuthorizationBlocked > 0 || approval.commandAuthorizationNeedsPermission > 0) {
    notificationMessages.push(`审批/命令授权待处理: blocked ${approval.commandAuthorizationBlocked || 0}, needs ${approval.commandAuthorizationNeedsPermission || 0}`)
  }
  const warningMessages = notificationMessages.filter((message) => /回滚|审批|manual|UI|缺失|待处理/.test(message))
  const listItems = buildAgentEvidenceWorkbenchListSummaryItems({ timeline, files, testing, testState, progressStages, notificationMessages })
  const detailItem = listItems.find((item) => item.surface === "notifications" && item.severity === "error")
    || listItems.find((item) => item.severity === "error")
    || listItems.find((item) => item.surface === "notifications" && item.severity === "warning")
    || listItems.find((item) => item.surface === "testing" && item.severity === "warning")
    || listItems.find((item) => item.severity === "warning")
    || listItems[0]
    || null
  const exportDescriptor = {
    jsonCommandId: "agent.evidence.exportJson",
    markdownCommandId: "agent.evidence.exportMarkdown",
    artifactPath: ".codek/reports/agent-evidence-workbench-latest.json",
    markdownPath: ".codek/reports/agent-evidence-workbench-latest.md",
    evidenceCount: listItems.length,
  }
  return {
    schemaVersion: 1,
    scm: {
      providerLabel: "Codek Agent Evidence",
      fileCount: files.length,
      resourceGroupCount: files.length > 0 ? 1 : 0,
      rollbackAvailable: scm.rollbackAvailable === true,
      rollbackRisk: scm.rollbackAvailable === true && rollback.agentRollbackDriftBlocked === true ? "covered" : "needs-review",
      files,
      commandIds: ["agent.evidence.openResource", "agent.evidence.diffResource", "agent.evidence.stageResource", "agent.evidence.attachResource"],
      resourceCommandCount: files.length > 0 ? files.length * 4 : 0,
      stageCommandId: "agent.evidence.stageResource",
      readonlyEvidence: true,
      gitIndexMutation: false,
    },
    testing: {
      state: testState,
      total: toFiniteNumber(testing.taskRuns),
      passed: toFiniteNumber(testing.passed),
      failed: toFiniteNumber(testing.failed),
      blocked: toFiniteNumber(testing.blocked),
      skipped: toFiniteNumber(testing.skipped),
      diagnostics: toFiniteNumber(testing.problemDiagnostics),
      qualityGateFailures: toFiniteNumber(testing.qualityGateFailures),
      latestTask: String(testing.latestTask || ""),
      rerunCommandId: "agent.evidence.reviewTests",
      failureDetails: testState === "failed" ? notificationMessages.filter((message) => /测试|质量门|failed|gate/i.test(message)).slice(0, 3) : [],
      resourceLinks: [],
    },
    timeline: {
      source: "agentEvidence",
      itemCount: timeline.length,
      blocked: blocked.length,
      degraded: degraded.length,
      missing: missing.length,
      commandIds: Array.from(new Set(timeline.map((item) => commandForAgentEvidenceStage(item.stage)))).filter(Boolean),
      linkedResourceCount: files.length,
    },
    progress: {
      active: progressStages.length,
      blocked: blocked.length,
      degraded: degraded.length,
      missing: missing.length,
      nextActions: progressStages.map((item) => String(item.nextAction || item.summary || "")).filter(Boolean).slice(0, 5),
      aggregateStatuses: Array.from(new Set(progressStages.map((item) => String(item.status || "")))).filter(Boolean),
      cancelCommandId: "agent.evidence.cancelProgress",
      ariaLabels: progressStages.map((item) => `${String(item.title || item.stage || "")}: ${String(item.nextAction || item.summary || "")}`).filter(Boolean).slice(0, 5),
    },
    notifications: {
      total: notificationMessages.length,
      errors: notificationMessages.length - warningMessages.length,
      warnings: warningMessages.length,
      messages: notificationMessages.slice(0, 5),
      dedupeKeys: notificationMessages.slice(0, 5).map((message, index) => `agentEvidence.notification.surface.${index + 1}.${String(message || "").replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 32)}`),
      dismissCommandId: "agent.evidence.dismissNotification",
      focusTargets: notificationMessages.length > 0 ? ["notifications"] : [],
    },
    list: {
      total: listItems.length,
      surfaces: Array.from(new Set(listItems.map((item) => item.surface))),
      statuses: Array.from(new Set(listItems.map((item) => item.status))).filter(Boolean),
      severities: Array.from(new Set(listItems.map((item) => item.severity))).filter(Boolean),
      items: listItems.slice(0, 12),
      errors: listItems.filter((item) => item.severity === "error").length,
      warnings: listItems.filter((item) => item.severity === "warning").length,
    },
    detail: detailItem ? {
      selectedId: detailItem.id,
      surface: detailItem.surface,
      title: detailItem.label,
      editorId: `agentEvidence.detail.${detailItem.surface}.${String(detailItem.id || "").replace(new RegExp(`^${detailItem.surface}:`), "").replace(/[^A-Za-z0-9_.-]+/g, "-")}`,
      resourceUri: `agent-evidence://${detailItem.surface}/${encodeURIComponent(String(detailItem.id || "").replace(new RegExp(`^${detailItem.surface}:`), ""))}`,
      readonly: true,
    } : null,
    export: exportDescriptor,
    actions: [
      { id: "agent.evidence.openTimeline", label: "打开证据时间线", surface: "timeline", enabled: timeline.length > 0 },
      { id: "agent.evidence.openScm", label: "查看变更和回滚风险", surface: "scm", enabled: files.length > 0 || rollback.operationLogVisible === true },
      { id: "agent.evidence.stageResource", label: "记录暂存意图", surface: "scm", enabled: false },
      { id: "agent.evidence.reviewTests", label: "复核测试与质量门", surface: "testing", enabled: toFiniteNumber(testing.taskRuns) > 0 || toFiniteNumber(testing.qualityGateFailures) > 0 },
      { id: "agent.evidence.importManualUiEvidence", label: "导入真实 UI evidence", surface: "progress", enabled: progressStages.some((item) => item.stage === "real-ui") },
      { id: "agent.evidence.reviewRollback", label: "复核回滚风险", surface: "scm", enabled: rollback.rollbackAvailable !== true || scm.rollbackAvailable !== true },
    ],
  }
}

function buildAgentEvidenceWorkbenchStage(input = {}) {
  const status = normalizeAgentEvidenceWorkbenchStatus(input)
  return {
    stage: String(input.stage || ""),
    title: String(input.title || input.stage || ""),
    status,
    ready: status === "ready",
    available: input.available === true,
    summary: String(input.summary || ""),
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.map((item) => String(item || "")).filter(Boolean) : [],
    nextAction: String(input.nextAction || ""),
  }
}

function normalizeAgentEvidenceWorkbenchStatus(input = {}) {
  if (input.ready === true) return "ready"
  if (input.available !== true) return "missing"
  if (input.blocking === true) return "blocked"
  return "degraded"
}

function normalizeTaskRunStatus(status) {
  const value = String(status || "").toLowerCase()
  if (value === "passed" || value === "failed" || value === "blocked" || value === "running" || value === "skipped") return value
  return "blocked"
}

function formatRollbackRisk(value) {
  const risk = String(value || "").toLowerCase()
  if (risk === "covered") return "已覆盖"
  if (risk === "needs-review") return "需复核"
  return value ? String(value) : "-"
}

function hashText(value) {
  const text = String(value || "")
  if (!text) return ""
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)
}

function buildReleaseEvidenceSummary(input = {}) {
  const releaseGate = input.releaseGateReport || null
  const acceptance = input.acceptanceReport || null
  const readiness = input.readinessReport || null
  const realTrial = input.realTrialReport || null
  const runActionAudits = Array.isArray(input.runActionAudits) ? input.runActionAudits : []
  const usageSummary = input.usageSummary || null
  const arHealth = input.arHealth || {}
  const packagingPreflight = input.packagingPreflight || null
  const workbenchDeep = input.workbenchDeep || null
  const productGradeGate = input.productGradeGate || null
  const axEnterpriseGate = input.axEnterpriseGate || null
  const extensionEnterpriseGate = input.extensionEnterpriseGate || null
  const atPreflight = input.atPreflight || null
  const bdUserTrial = summarizeBdUserTrial(input)
  const betaTrialRun = summarizeBetaTrialRun(input)
  const betaFeedback = summarizeBetaFeedback(input)
  const demoTaskReport = summarizeDemoTaskReport(input)
  const workbenchRealProjectUi = summarizeWorkbenchRealProjectUi(input)
  const explorerFsParity = summarizeExplorerFsParity(input)
  const shellIntegration = summarizeShellIntegration(input)
  const debugAdapterSmoke = summarizeDebugAdapterSmoke(input)
  const enterpriseDocAudit = summarizeEnterpriseDocAudit(input)
  const extensionPlanAudit = summarizeExtensionPlanAudit(input)
  const manualRealUiEvidence = summarizeManualRealUiEvidence(input)
  const agentChangeSafety = summarizeAgentChangeSafety(input)
  const routerCalibration = summarizeRouterCalibrationSmoke(input)
  const extensionMarketplaceSmoke = summarizeExtensionMarketplaceSmoke(input)
  const extensionInstallSmoke = summarizeExtensionInstallSmoke(input)
  const extensionMarketplaceInstallMatrix = summarizeExtensionMarketplaceInstallMatrix(input)
  const extensionMigrationSmoke = summarizeExtensionMigrationSmoke(input)
  const extensionSecuritySmoke = summarizeExtensionSecuritySmoke(input)
  const extensionHostRestartSmoke = summarizeExtensionHostRestartSmoke(input)
  const ehMarketplaceE2e = summarizeEhMarketplaceE2e(input)
  const ehMementoStorageE2e = summarizeEhMementoStorageE2e(input)
  const ehExtensionContextE2e = summarizeEhExtensionContextE2e(input)
  const ehImplicitActivationE2e = summarizeEhImplicitActivationE2e(input)
  const ehDependencyLoopE2e = summarizeEhDependencyLoopE2e(input)
  const ehSearchProviderE2e = summarizeEhSearchProviderE2e(input)
  const ehProfileContentHandlerE2e = summarizeEhProfileContentHandlerE2e(input)
  const installedMcpDiscovery = summarizeInstalledMcpDiscovery(input)
  const mcpGalleryManagement = summarizeMcpGalleryManagement(input)
  const ehMcpProviderBridge = summarizeEhMcpProviderBridge(input)
  const extensionCompatibilityMatrix = summarizeExtensionCompatibilityMatrix(input)
  const releaseMode = String(input.currentReleaseGateMode || input.releaseMode || releaseGate?.mode || "")
  const sandboxSecurityReport = input.sandboxSecurityReport || (input.reportDir
    ? readLatestSandboxSecurityEvidence({ reportDir: input.reportDir }).report
    : null)
  const evidenceRuns = collectEvidenceRuns(input)
  const codebaseContext = summarizeCodebaseContextEvidence(evidenceRuns.length ? evidenceRuns : input.latestRunWithContextEvidence)
  const sandboxSecurity = sandboxSecurityReport?.ready === true
    ? {
      ...sandboxSecurityReport,
      available: true,
      ready: true,
      status: sandboxSecurityReport.status || "ready",
      statusLabel: sandboxSecurityReport.statusLabel || "沙箱安全证据已就绪",
    }
    : summarizeSandboxSecurityEvidence(evidenceRuns.length ? evidenceRuns : input.latestRunWithSandboxEvidence)
  const agentRoleTrials = summarizeAgentRoleTrials(input, evidenceRuns)
  const taskRuns = summarizeTaskRunEvidence(collectTaskRunEvidence(input, evidenceRuns))
  const qualityGateSummary = buildQualityGateSummary(input, evidenceRuns, taskRuns)
  const costReview = buildCostReviewSummary(usageSummary, {
    durationMs: input.durationMs,
    manualReviewMinutes: input.manualReviewMinutes,
  })
  const taskTerminalReuseRegistry = summarizeTaskTerminalReuseRegistry(input, evidenceRuns)
  const arWarningReview = collectArWarningReview(arHealth)
  const realTrialDetail = realTrial?.realWorkspaceTrial || null
  const releaseGatePassed = Array.isArray(releaseGate?.steps)
    ? releaseGate.steps.filter((step) => step?.passed).length
    : 0
  const releaseGateTotal = Array.isArray(releaseGate?.plannedSteps) && releaseGate.plannedSteps.length
    ? releaseGate.plannedSteps.length
    : Array.isArray(releaseGate?.steps) ? releaseGate.steps.length : 0
  const latestRunAction = runActionAudits[0] || null
  const realTrialReady = Boolean(realTrialDetail?.mainWorkspaceUntouchedBeforeAccept && realTrialDetail?.rollbackAvailable)
  const evidence = {
    releaseGate: {
      available: Boolean(releaseGate),
      ready: Boolean(releaseGate?.ready),
      statusLabel: releaseGate ? (releaseGate.ready ? "就绪" : "需处理") : "暂无报告",
      mode: releaseGate?.mode || "",
      passed: releaseGatePassed,
      total: releaseGateTotal,
      durationMs: Number(releaseGate?.durationMs || 0),
      jsonPath: input.releaseGateJsonPath || releaseGate?.jsonPath || "",
      warnings: Array.isArray(releaseGate?.warnings) ? releaseGate.warnings.length : 0,
    },
    acceptance: {
      available: Boolean(acceptance),
      ready: Boolean(acceptance?.ready),
      statusLabel: acceptance ? `${acceptance.passed || 0}/${acceptance.total || 0}` : "暂无报告",
      taskSet: acceptance?.taskSet || "",
      passed: Number(acceptance?.passed || 0),
      total: Number(acceptance?.total || 0),
      matrixPassed: Number(acceptance?.matrix?.passed || 0),
      matrixTotal: Number(acceptance?.matrix?.total || 0),
      markdownPath: input.acceptanceMarkdownPath || "",
      historyCount: Array.isArray(input.acceptanceHistory) ? input.acceptanceHistory.length : 0,
    },
    readiness: {
      available: Boolean(readiness),
      ready: Boolean(readiness?.ready),
      status: readiness?.status || "",
      statusLabel: readiness?.statusLabel || "暂无报告",
      passed: Number(readiness?.summary?.passed || 0),
      total: Number(readiness?.summary?.total || 0),
      warning: Number(readiness?.summary?.warning || 0),
      failed: Number(readiness?.summary?.failed || 0),
      nextAction: readiness?.nextAction || "",
      markdownPath: input.readinessMarkdownPath || "",
      historyCount: Array.isArray(input.readinessHistory) ? input.readinessHistory.length : 0,
    },
    realWorkspaceTrial: {
      available: Boolean(realTrial),
      ready: realTrialReady,
      statusLabel: realTrial ? (realTrial.finalStatusLabel || realTrial.finalStatus || realTrialDetail?.status || "已记录") : "暂无报告",
      runId: realTrial?.runId || "",
      executionStrategy: realTrial?.router?.executionStrategy || realTrialDetail?.executionStrategy || "",
      filesChanged: Array.isArray(realTrialDetail?.filesChanged) ? realTrialDetail.filesChanged : [],
      mainWorkspaceUntouchedBeforeAccept: realTrialDetail?.mainWorkspaceUntouchedBeforeAccept === true,
      rollbackAvailable: realTrialDetail?.rollbackAvailable === true,
      markdownPath: input.realTrialMarkdownPath || "",
      historyCount: Array.isArray(input.realTrialHistory) ? input.realTrialHistory.length : 0,
    },
    demoTaskReport,
    runActionAudit: {
      available: runActionAudits.length > 0,
      ready: latestRunAction?.status === "success",
      statusLabel: latestRunAction ? formatRunActionStatus(latestRunAction.status) : "暂无记录",
      latestTitle: latestRunAction?.title || latestRunAction?.actionId || "",
      latestRunId: latestRunAction?.runId || "",
      latestSummary: latestRunAction?.error || latestRunAction?.summary || "",
      historyCount: runActionAudits.length,
    },
    llmUsage: {
      available: Boolean(usageSummary && Number(usageSummary.totalRequests || 0) > 0),
      ready: Boolean(usageSummary && Number(usageSummary.totalRequests || 0) > 0),
      statusLabel: usageSummary && Number(usageSummary.totalRequests || 0) > 0 ? "已记录" : "暂无记录",
      totalRequests: Number(usageSummary?.totalRequests || 0),
      inputTokens: Number(usageSummary?.inputTokens || 0),
      outputTokens: Number(usageSummary?.outputTokens || 0),
      totalTokens: Number(usageSummary?.totalTokens || 0),
      providerUsageRequests: Number(usageSummary?.providerUsageRequests || 0),
      estimatedUsageRequests: Number(usageSummary?.estimatedUsageRequests || 0),
      estimatedCostUsd: Number(usageSummary?.cost?.estimatedCostUsd || 0),
      costCurrency: usageSummary?.cost?.currency || "USD",
      costEstimated: usageSummary?.cost?.estimated !== false,
      pricedRequests: Number(usageSummary?.cost?.pricedRequests || 0),
      unpricedRequests: Number(usageSummary?.cost?.unpricedRequests || 0),
      unpricedModels: Array.isArray(usageSummary?.cost?.unpricedModels) ? usageSummary.cost.unpricedModels.slice(0, 5) : [],
      models: costReview.models,
      tokenUnavailableReason: costReview.tokenUnavailableReason,
      costUnavailableReason: costReview.costUnavailableReason,
      unavailableReasons: costReview.unavailableReasons,
      manualReviewMinutes: costReview.manualReviewMinutes,
      manualReviewPlaceholder: costReview.manualReviewPlaceholder,
    },
    costReview,
    codebaseContext,
    sandboxSecurity,
    agentRoleTrials,
    taskRuns,
    qualityGateSummary,
    taskTerminalReuseRegistry,
    bdUserTrial,
    betaTrialRun,
    betaFeedback,
    arHealth: {
      available: Boolean(arHealth.provider || arHealth.debug || arHealth.extensions || arHealth.compatibility || arHealth.goals || arHealth.performance),
      ready: isArHealthReleaseReady(arHealth),
      statusLabel: formatArHealthStatus(arHealth),
      provider: summarizeArReport(arHealth.provider),
      debug: summarizeArReport(arHealth.debug),
      extensions: summarizeArReport(arHealth.extensions),
      compatibility: summarizeArReport(arHealth.compatibility),
      goals: summarizeArReport(arHealth.goals),
      performance: summarizeArReport(arHealth.performance),
      warningCount: arWarningReview.length,
      warningReview: arWarningReview,
    },
    packagingPreflight: {
      available: Boolean(packagingPreflight),
      ready: Boolean(packagingPreflight && Number(packagingPreflight.summary?.failed || 0) === 0),
      status: packagingPreflight?.status || "",
      statusLabel: packagingPreflight?.statusLabel || "暂无报告",
      passed: Number(packagingPreflight?.summary?.passed || 0),
      warning: Number(packagingPreflight?.summary?.warning || 0),
      failed: Number(packagingPreflight?.summary?.failed || 0),
      total: Number(packagingPreflight?.summary?.total || 0),
      warningPolicy: Array.isArray(packagingPreflight?.warningPolicy) ? packagingPreflight.warningPolicy : [],
    },
    workbenchDeep: {
      available: Boolean(workbenchDeep),
      ready: Boolean(workbenchDeep && Number(workbenchDeep.summary?.failed || 0) === 0),
      status: workbenchDeep?.status || "",
      statusLabel: workbenchDeep?.statusLabel || "暂无报告",
      passed: Number(workbenchDeep?.summary?.passed || 0),
      warning: Number(workbenchDeep?.summary?.warning || 0),
      failed: Number(workbenchDeep?.summary?.failed || 0),
      total: Number(workbenchDeep?.summary?.total || 0),
      roots: Array.isArray(workbenchDeep?.workspace?.roots) ? workbenchDeep.workspace.roots.length : 0,
      taskConfigs: Number((workbenchDeep?.tasks?.app || []).length + (workbenchDeep?.tasks?.java || []).length + (workbenchDeep?.tasks?.python || []).length),
    },
    workbenchRealProjectUi,
    explorerFsParity,
    shellIntegration,
    debugAdapterSmoke,
    enterpriseDocAudit,
    extensionPlanAudit,
    manualRealUiEvidence,
    agentChangeSafety,
    routerCalibration,
    productGradeGate: {
      available: Boolean(productGradeGate),
      ready: Boolean(productGradeGate?.ready),
      status: productGradeGate?.status || "",
      statusLabel: productGradeGate?.statusLabel || "暂无报告",
      readyCount: Number(productGradeGate?.summary?.ready || 0),
      total: Number(productGradeGate?.summary?.total || 0),
      blocked: Number(productGradeGate?.summary?.blocked || 0),
      missing: Number(productGradeGate?.summary?.missing || 0),
    },
    axEnterpriseGate: {
      available: Boolean(axEnterpriseGate),
      ready: Boolean(axEnterpriseGate?.ready),
      status: axEnterpriseGate?.status || "",
      statusLabel: axEnterpriseGate?.statusLabel || "暂无报告",
      readyCount: Number(axEnterpriseGate?.summary?.ready || 0),
      total: Number(axEnterpriseGate?.summary?.total || 0),
      blocked: Number(axEnterpriseGate?.summary?.blocked || 0),
      missing: Number(axEnterpriseGate?.summary?.missing || 0),
    },
    extensionMarketplaceSmoke,
    extensionInstallSmoke,
    extensionMarketplaceInstallMatrix,
    extensionMigrationSmoke,
    extensionSecuritySmoke,
    extensionHostRestartSmoke,
    ehMarketplaceE2e,
    ehMementoStorageE2e,
    ehExtensionContextE2e,
    ehImplicitActivationE2e,
    ehDependencyLoopE2e,
    ehSearchProviderE2e,
    ehProfileContentHandlerE2e,
    installedMcpDiscovery,
    mcpGalleryManagement,
    ehMcpProviderBridge,
    extensionCompatibilityMatrix,
    extensionEnterpriseGate: {
      available: Boolean(extensionEnterpriseGate),
      ready: Boolean(extensionEnterpriseGate?.ready),
      status: extensionEnterpriseGate?.status || "",
      statusLabel: extensionEnterpriseGate
        ? (extensionEnterpriseGate.statusLabel || (extensionEnterpriseGate.ready ? "扩展生态企业级门禁已通过" : "扩展生态企业级门禁需复核"))
        : "暂无报告",
      passed: Number(extensionEnterpriseGate?.summary?.passed || 0),
      warning: Number(extensionEnterpriseGate?.summary?.warning || 0),
      failed: Number(extensionEnterpriseGate?.summary?.failed || 0),
      total: Number(extensionEnterpriseGate?.summary?.total || 0),
      gaps: Array.isArray(extensionEnterpriseGate?.gaps) ? extensionEnterpriseGate.gaps.length : 0,
      jsonPath: input.extensionEnterpriseGateJsonPath || extensionEnterpriseGate?.latestJsonPath || "",
      markdownPath: input.extensionEnterpriseGateMarkdownPath || extensionEnterpriseGate?.latestMarkdownPath || "",
    },
    atPreflight: {
      available: Boolean(atPreflight),
      ready: Boolean(atPreflight && Number(atPreflight.summary?.failed || 0) === 0),
      status: atPreflight?.status || "",
      statusLabel: atPreflight?.statusLabel || "暂无报告",
      passed: Number(atPreflight?.summary?.passed || 0),
      warning: Number(atPreflight?.summary?.warning || 0),
      failed: Number(atPreflight?.summary?.failed || 0),
      total: Number(atPreflight?.summary?.total || 0),
      artifacts: Array.isArray(atPreflight?.artifacts) ? atPreflight.artifacts.length : 0,
    },
  }
  const gaps = buildReleaseEvidenceGaps(evidence, { releaseMode })
  const blockingGaps = gaps.filter((gap) => gap.severity !== "low" && gap.severity !== "info")
  evidence.failureClassification = buildFailureClassification(evidence, gaps)
  const sections = Object.entries(evidence)
    .filter(([key]) => key !== "agentEvidenceWorkbench")
    .map(([, item]) => item)
  const available = sections.filter((item) => item.available).length
  const reportCreatedAt = Number(input.createdAt || Date.now())
  evidence.agentEvidenceWorkbench = buildAgentEvidenceWorkbench(evidence, {
    gaps,
    blockingGaps,
    createdAt: reportCreatedAt,
    evidenceRuns,
  })
  const manualRealUiConfirmed = evidence.manualRealUiEvidence.ready === true
  const enterpriseComplete = evidence.enterpriseDocAudit.enterpriseComplete === true
    && evidence.extensionPlanAudit.enterpriseComplete === true
    && manualRealUiConfirmed
  const baseReady = evidence.releaseGate.ready &&
    evidence.acceptance.ready &&
    evidence.readiness.ready &&
    evidence.realWorkspaceTrial.ready &&
    evidence.arHealth.ready &&
    evidence.packagingPreflight.ready &&
    evidence.workbenchDeep.ready &&
    evidence.workbenchRealProjectUi.ready &&
    evidence.explorerFsParity.ready &&
    evidence.shellIntegration.ready &&
    evidence.debugAdapterSmoke.ready &&
    evidence.enterpriseDocAudit.ready &&
    evidence.extensionPlanAudit.ready &&
    evidence.agentChangeSafety.ready &&
    evidence.routerCalibration.ready &&
    evidence.codebaseContext.ready &&
    evidence.sandboxSecurity.ready &&
    evidence.taskRuns.available &&
    evidence.taskRuns.ready &&
    evidence.bdUserTrial.ready &&
    evidence.extensionMarketplaceSmoke.ready &&
    evidence.extensionInstallSmoke.ready &&
    evidence.extensionMarketplaceInstallMatrix.ready &&
    evidence.extensionMigrationSmoke.ready &&
    evidence.extensionSecuritySmoke.ready &&
    evidence.ehMarketplaceE2e.ready &&
    evidence.ehMementoStorageE2e.ready &&
    evidence.ehExtensionContextE2e.ready &&
    evidence.ehImplicitActivationE2e.ready &&
    evidence.ehDependencyLoopE2e.ready &&
    evidence.ehSearchProviderE2e.ready &&
    evidence.ehProfileContentHandlerE2e.ready &&
    evidence.installedMcpDiscovery.ready &&
    evidence.mcpGalleryManagement.ready &&
    evidence.ehMcpProviderBridge.ready &&
    evidence.extensionCompatibilityMatrix.ready &&
    evidence.extensionEnterpriseGate.ready &&
    (!evidence.betaTrialRun.available || evidence.betaTrialRun.ready) &&
    (!evidence.betaFeedback.available || evidence.betaFeedback.ready) &&
    blockingGaps.length === 0
  const ready = baseReady
  const report = {
    reportKind: "release-evidence",
    createdAt: reportCreatedAt,
    ready,
    status: ready ? "ready" : available > 0 ? "degraded" : "missing",
    statusLabel: ready ? "发布证据完整" : available > 0 ? "证据需补齐" : "暂无证据",
    summary: {
      total: sections.length,
      available,
      ready: sections.filter((item) => item.ready).length,
      missing: sections.filter((item) => !item.available).length,
      baseReady,
      enterpriseComplete,
      manualRealUiConfirmed,
      blockingGaps: blockingGaps.length,
    },
    gaps,
    nextActions: buildReleaseEvidenceNextActions(gaps, ready),
    evidence,
    paths: {
      releaseGateJsonPath: evidence.releaseGate.jsonPath,
      acceptanceMarkdownPath: evidence.acceptance.markdownPath,
      readinessMarkdownPath: evidence.readiness.markdownPath,
      realTrialMarkdownPath: evidence.realWorkspaceTrial.markdownPath,
      workbenchRealProjectUiJsonPath: evidence.workbenchRealProjectUi.jsonPath,
      workbenchRealProjectUiMarkdownPath: evidence.workbenchRealProjectUi.markdownPath,
      workbenchRealProjectUiScreenshotPath: evidence.workbenchRealProjectUi.screenshotPath,
      explorerFsParityJsonPath: evidence.explorerFsParity.jsonPath,
      explorerFsParityMarkdownPath: evidence.explorerFsParity.markdownPath,
      shellIntegrationJsonPath: evidence.shellIntegration.jsonPath,
      shellIntegrationMarkdownPath: evidence.shellIntegration.markdownPath,
      debugAdapterSmokeJsonPath: evidence.debugAdapterSmoke.jsonPath,
      debugAdapterSmokeMarkdownPath: evidence.debugAdapterSmoke.markdownPath,
      enterpriseDocAuditJsonPath: evidence.enterpriseDocAudit.jsonPath,
      enterpriseDocAuditMarkdownPath: evidence.enterpriseDocAudit.markdownPath,
      extensionPlanAuditJsonPath: evidence.extensionPlanAudit.jsonPath,
      extensionPlanAuditMarkdownPath: evidence.extensionPlanAudit.markdownPath,
      manualRealUiEvidenceJsonPath: evidence.manualRealUiEvidence.jsonPath,
      manualRealUiEvidenceMarkdownPath: evidence.manualRealUiEvidence.markdownPath,
      agentChangeSafetyJsonPath: evidence.agentChangeSafety.jsonPath,
      agentChangeSafetyMarkdownPath: evidence.agentChangeSafety.markdownPath,
      routerCalibrationJsonPath: evidence.routerCalibration.jsonPath,
      routerCalibrationMarkdownPath: evidence.routerCalibration.markdownPath,
      bdUserTrialMarkdownPath: evidence.bdUserTrial.markdownPath,
      betaTrialRunMarkdownPath: evidence.betaTrialRun.markdownPath,
      extensionMarketplaceSmokeJsonPath: evidence.extensionMarketplaceSmoke.jsonPath,
      extensionMarketplaceSmokeMarkdownPath: evidence.extensionMarketplaceSmoke.markdownPath,
      extensionInstallSmokeJsonPath: evidence.extensionInstallSmoke.jsonPath,
      extensionInstallSmokeMarkdownPath: evidence.extensionInstallSmoke.markdownPath,
      extensionMarketplaceInstallMatrixJsonPath: evidence.extensionMarketplaceInstallMatrix.jsonPath,
      extensionMarketplaceInstallMatrixMarkdownPath: evidence.extensionMarketplaceInstallMatrix.markdownPath,
      extensionMigrationSmokeJsonPath: evidence.extensionMigrationSmoke.jsonPath,
      extensionMigrationSmokeMarkdownPath: evidence.extensionMigrationSmoke.markdownPath,
      extensionSecuritySmokeJsonPath: evidence.extensionSecuritySmoke.jsonPath,
      extensionSecuritySmokeMarkdownPath: evidence.extensionSecuritySmoke.markdownPath,
      extensionHostRestartSmokeJsonPath: evidence.extensionHostRestartSmoke.jsonPath,
      extensionHostRestartSmokeMarkdownPath: evidence.extensionHostRestartSmoke.markdownPath,
      ehMarketplaceE2eJsonPath: evidence.ehMarketplaceE2e.jsonPath,
      ehMarketplaceE2eMarkdownPath: evidence.ehMarketplaceE2e.markdownPath,
      ehMementoStorageE2eJsonPath: evidence.ehMementoStorageE2e.jsonPath,
      ehMementoStorageE2eMarkdownPath: evidence.ehMementoStorageE2e.markdownPath,
      ehExtensionContextE2eJsonPath: evidence.ehExtensionContextE2e.jsonPath,
      ehExtensionContextE2eMarkdownPath: evidence.ehExtensionContextE2e.markdownPath,
      ehImplicitActivationE2eJsonPath: evidence.ehImplicitActivationE2e.jsonPath,
      ehImplicitActivationE2eMarkdownPath: evidence.ehImplicitActivationE2e.markdownPath,
      ehDependencyLoopE2eJsonPath: evidence.ehDependencyLoopE2e.jsonPath,
      ehDependencyLoopE2eMarkdownPath: evidence.ehDependencyLoopE2e.markdownPath,
      ehSearchProviderE2eJsonPath: evidence.ehSearchProviderE2e.jsonPath,
      ehSearchProviderE2eMarkdownPath: evidence.ehSearchProviderE2e.markdownPath,
      ehProfileContentHandlerE2eJsonPath: evidence.ehProfileContentHandlerE2e.jsonPath,
      ehProfileContentHandlerE2eMarkdownPath: evidence.ehProfileContentHandlerE2e.markdownPath,
      installedMcpDiscoveryJsonPath: evidence.installedMcpDiscovery.jsonPath,
      installedMcpDiscoveryMarkdownPath: evidence.installedMcpDiscovery.markdownPath,
      mcpGalleryManagementJsonPath: evidence.mcpGalleryManagement.jsonPath,
      mcpGalleryManagementMarkdownPath: evidence.mcpGalleryManagement.markdownPath,
      ehMcpProviderBridgeJsonPath: evidence.ehMcpProviderBridge.jsonPath,
      ehMcpProviderBridgeMarkdownPath: evidence.ehMcpProviderBridge.markdownPath,
      extensionCompatibilityMatrixJsonPath: evidence.extensionCompatibilityMatrix.jsonPath,
      extensionCompatibilityMatrixMarkdownPath: evidence.extensionCompatibilityMatrix.markdownPath,
      extensionEnterpriseGateJsonPath: evidence.extensionEnterpriseGate.jsonPath,
      extensionEnterpriseGateMarkdownPath: evidence.extensionEnterpriseGate.markdownPath,
    },
    runActionAudits: runActionAudits.slice(0, 5).map((item) => ({
      id: item.id,
      actionId: item.actionId,
      title: item.title,
      status: item.status,
      runId: item.runId,
      durationMs: item.durationMs,
      summary: item.error || item.summary || "",
      createdAt: item.createdAt,
      finishedAt: item.finishedAt,
    })),
  }
  report.markdown = toReleaseEvidenceMarkdown(report)
  return report
}

function buildReleaseEvidenceGaps(evidence = {}, options = {}) {
  const gaps = []
  const releaseMode = String(options.releaseMode || "")
  const betaTrialRunSeverity = /public-candidate|release-candidate|installer|pack/i.test(releaseMode) ? "high" : "low"
  const betaFeedbackSeverity = /public-candidate|release-candidate|installer|pack/i.test(releaseMode) ? "high" : "low"
  addEvidenceGap(gaps, {
    id: "release_gate",
    title: "发布质量门",
    evidence: evidence.releaseGate,
    severity: "high",
    missingReason: "缺少 release gate latest 报告。",
    notReadyReason: "发布质量门未全部通过。",
    action: "在发布与验收页运行快速门或构建门，确认 typecheck、smoke 和真实试运行质量门通过。",
  })
  addEvidenceGap(gaps, {
    id: "acceptance",
    title: "发布验收矩阵",
    evidence: evidence.acceptance,
    severity: "high",
    missingReason: "缺少发布验收矩阵 latest 报告。",
    notReadyReason: "发布验收矩阵仍有失败场景。",
    action: "运行发布验收任务集，优先修复失败场景和 Failure Recommendations。",
  })
  addEvidenceGap(gaps, {
    id: "readiness",
    title: "企业级运行预检",
    evidence: evidence.readiness,
    severity: "high",
    missingReason: "缺少企业级运行预检 latest 报告。",
    notReadyReason: evidence.readiness?.nextAction || "企业级运行预检未达到 ready。",
    action: "刷新企业级运行预检，并按预检修复建议处理阻塞项。",
  })
  addEvidenceGap(gaps, {
    id: "real_workspace_trial",
    title: "真实工作区试运行",
    evidence: evidence.realWorkspaceTrial,
    severity: "medium",
    missingReason: "缺少真实工作区 proposal-only 试运行报告。",
    notReadyReason: "真实工作区试运行缺少主工作区保护或回滚证据。",
    action: "发起 proposal-only 真实工作区试运行，确认主工作区未污染且回滚可用。",
  })
  addEvidenceGap(gaps, {
    id: "demo_task_report",
    title: "Day 11-12 非玩具演示任务报告",
    evidence: evidence.demoTaskReport,
    severity: "low",
    missingReason: "缺少 Day 11-12 演示任务、角色试用、成本和失败复盘报告。",
    notReadyReason: "演示报告未覆盖 T01-T08、role profile 试用、质量门、成本/复核或回滚建议。",
    action: "基于现有 run report / release evidence 生成可复现演示报告，覆盖 T01-T08、role profile 收益噪音、质量门、成本、失败复盘和人工验收下一步。",
  })
  if (evidence.runActionAudit && !evidence.runActionAudit.available) {
    gaps.push({
      id: "run_action_audit",
      title: "控制台动作审计",
      severity: "low",
      status: "missing",
      reason: "缺少企业运行控制台主操作审计记录。",
      action: "在 Orchestrator 企业运行控制台执行一次主操作，留下本地审计记录。",
    })
  }
  if (evidence.llmUsage && !evidence.llmUsage.available) {
    gaps.push({
      id: "llm_usage",
      title: "LLM 用量",
      severity: "low",
      status: "missing",
      reason: "缺少最近模型用量本地审计记录。",
      action: "完成一次模型调用后重新导出证据链，确认 provider 用量或本地估算已记录。",
    })
  }
  addEvidenceGap(gaps, {
    id: "codebase_context",
    title: "Codebase Context 证据链",
    evidence: evidence.codebaseContext,
    severity: "high",
    missingReason: "缺少最近 Orchestrator run 的 Codebase Context 元数据证据。",
    notReadyReason: "Codebase Context 存在索引未就绪、预算溢出、截断来源或警告。",
    action: "从 ChatAI 发起一次真实 Agent 任务，确认 @mentions、Rules、workspace sources、index status 和预算策略都进入 run 证据链。",
  })
  addEvidenceGap(gaps, {
    id: "sandbox_security",
    title: "沙箱安全证据",
    evidence: evidence.sandboxSecurity,
    severity: "high",
    missingReason: "缺少最近 Orchestrator run 的沙箱、权限、质量门和工作区隔离元数据。",
    notReadyReason: "沙箱安全证据存在主工作区直接执行、权限拒绝、路径越界、质量门失败或命令授权阻断。",
    action: "发起一次受控 Agent / Auto 任务，确保 assignment 使用隔离 workspace lease，权限请求已批准，质量门通过，且报告只保存元数据。",
  })
  addEvidenceGap(gaps, {
    id: "task_runs",
    title: "任务运行证据",
    evidence: evidence.taskRuns,
    severity: evidence.taskRuns?.available ? "high" : "low",
    missingReason: "缺少任务运行结果证据，发布报告还不能证明 tasks.json / 自动任务真实执行过。",
    notReadyReason: "任务运行证据中存在失败、阻断、跳过或仍在运行的任务。",
    action: "运行一次 VS Code 风格任务或 workbench deep smoke，确认任务运行证据已落入发布证据链；失败任务需带退出码和可复核元数据。",
  })
  addEvidenceGap(gaps, {
    id: "bd_user_trial",
    title: "BD 真实用户试运行计划",
    evidence: evidence.bdUserTrial,
    severity: "high",
    missingReason: "缺少 BD 真实用户试运行计划 latest 报告。",
    notReadyReason: "BD 试运行任务集、覆盖项或隐私边界未达到 ready。",
    action: "运行 npm run ba:beta-trial，确认至少 10 个 BD 任务、附件、回滚、质量门失败、需求澄清和隐私边界都已覆盖。",
  })
  addEvidenceGap(gaps, {
    id: "be_beta_trial_run",
    title: "BE 真实 Beta 执行结果",
    evidence: evidence.betaTrialRun,
    severity: evidence.betaTrialRun?.p0 > 0 ? "high" : betaTrialRunSeverity,
    missingReason: betaTrialRunSeverity === "high"
      ? "缺少真实 Beta 执行 latest 报告；发布候选必须证明 10 个 BD 标准任务跑过真实项目路径。"
      : "缺少真实 Beta 执行 latest 报告；product-grade 阶段作为后续收敛提示。",
    notReadyReason: evidence.betaTrialRun?.p0 > 0
      ? "真实 Beta 执行存在 P0 阻断，不能进入发布候选。"
      : "真实 Beta 执行完成率、覆盖项或 P1/P2 缺陷仍需收敛。",
    action: "运行 node scripts/beta-trial-run.js --report-dir=D:\\Workspace\\.codek\\reports，确认至少 8/10 个真实任务闭环、P0 清零并记录 P1/P2。",
  })
  addEvidenceGap(gaps, {
    id: "bf_beta_feedback",
    title: "BF 人工 Beta 反馈",
    evidence: evidence.betaFeedback,
    severity: evidence.betaFeedback?.p0 > 0 || evidence.betaFeedback?.pendingRegression > 0 || evidence.betaFeedback?.privacyViolations > 0
      ? "high"
      : betaFeedbackSeverity,
    missingReason: betaFeedbackSeverity === "high"
      ? "缺少外部/人工 Beta 反馈；发布候选必须证明真实用户反馈、截图和缺陷回归已经进入证据链。"
      : "缺少外部/人工 Beta 反馈；product-grade 阶段作为后续收敛提示。",
    notReadyReason: evidence.betaFeedback?.p0 > 0
      ? "人工 Beta 反馈存在 P0 阻断。"
      : evidence.betaFeedback?.privacyViolations > 0
        ? "人工 Beta 反馈包含敏感原文字段，必须重新脱敏导入。"
        : evidence.betaFeedback?.pendingRegression > 0
          ? "人工 Beta 已修缺陷缺少回归证据。"
          : "人工 Beta 反馈仍需收敛。",
    action: "运行 node scripts/beta-trial-run.js --feedback-dir=<反馈目录> --report-dir=D:\\Workspace\\.codek\\reports，确认 P0 清零、fixed/verified 缺陷都有回归证据。",
  })
  if (evidence.arHealth && !evidence.arHealth.available) {
    gaps.push({
      id: "ar_health",
      title: "AR 真实世界健康报告",
      severity: "medium",
      status: "missing",
      reason: "缺少真实模型、调试器、扩展、长时间运行或性能基线报告。",
      action: "运行 full release gate 或 AR 健康检查，生成真实世界稳定性证据。",
    })
  } else if (evidence.arHealth && !evidence.arHealth.ready) {
    gaps.push({
      id: "ar_health",
      title: "AR 真实世界健康报告",
      severity: "medium",
      status: "not_ready",
      reason: "AR 健康报告缺失或存在失败阻断项。",
      action: "优先处理扩展生态、调试器 adapter、模型链路、长时间运行或性能预算中的失败项；警告保留为发布复核证据。",
    })
  }
  addEvidenceGap(gaps, {
    id: "workbench_deep",
    title: "AU Workbench 深水区 smoke",
    evidence: evidence.workbenchDeep,
    severity: "high",
    missingReason: "缺少 AU Workbench deep smoke latest 报告。",
    notReadyReason: "Workbench 深水区 smoke 仍有失败项。",
    action: "运行 npm run smoke:workbench:deep，确认 .code-workspace、多根 root、任务、搜索、诊断、终端和调试契约全部通过。",
  })
  addEvidenceGap(gaps, {
    id: "workbench_real_project_ui",
    title: "Workbench 真实项目 UI 证据",
    evidence: evidence.workbenchRealProjectUi,
    severity: "high",
    missingReason: "缺少 workbench-real-project-ui-latest.json / .md / .png 真实 UI 证据。",
    notReadyReason: "真实项目 UI smoke 的验收项、Markdown 或截图证据未全部就绪。",
    action: "运行 npm run smoke:workbench:real-project-ui，确认真实 D:\\Workspace UI、搜索跳转、创建落点、滚动预算和截图证据全部通过。",
  })
  addEvidenceGap(gaps, {
    id: "explorer_fs_parity",
    title: "Explorer 真实目录条目数差异证据",
    evidence: evidence.explorerFsParity,
    severity: "high",
    missingReason: "缺少 explorer-fs-parity-latest.json / .md 证据。",
    notReadyReason: "Explorer FS parity 发现目录被截断、条目缺失、额外条目或类型映射不一致。",
    action: "运行 node scripts/explorer-fs-parity.js --project=D:\\Workspace --dir=. --dir=frontend --dir=frontend\\vite-project --dir=scripts --report-dir=.codek\\reports，修复 fs:listDir budget、FileType 映射或 ExplorerDataSource 丢弃逻辑。",
  })
  addEvidenceGap(gaps, {
    id: "shell_integration_smoke",
    title: "终端 Shell 集成 smoke",
    evidence: evidence.shellIntegration,
    severity: "high",
    missingReason: "缺少 shell-integration-smoke-latest.json / .md 证据。",
    notReadyReason: "终端 Shell 集成 smoke 存在失败 shell，或没有真实执行 shell 检查。",
    action: "运行 npm run smoke:shell-integration，确认 OSC 633 的 command、execution、finish、cwd 事件都被捕获。",
  })
  addEvidenceGap(gaps, {
    id: "debug_adapter_smoke",
    title: "调试适配器 smoke",
    evidence: evidence.debugAdapterSmoke,
    severity: "high",
    missingReason: "缺少 debug-adapter-smoke-latest.json / .md 证据。",
    notReadyReason: "调试适配器 smoke 存在失败检查，或真实 DAP fixture 未通过。",
    action: "运行 npm run smoke:debug-adapter，确认 initialize、launch、breakpoints、stack、variables、evaluate、continue 全部通过。",
  })
  addEvidenceGap(gaps, {
    id: "enterprise_doc_completion_audit",
    title: "企业级文档完成审计",
    evidence: evidence.enterpriseDocAudit,
    severity: "high",
    missingReason: "缺少 enterprise-doc-completion-audit-latest.json / .md 证据。",
    notReadyReason: "企业级文档审计发现 BD / BE / capability audit 要求缺少当前证据。",
    action: "运行 npm run audit:enterprise-docs，复核自动化证据和必须人工补齐的证据。",
  })
  addEvidenceGap(gaps, {
    id: "extension_plan_completion_audit",
    title: "扩展计划完成审计",
    evidence: evidence.extensionPlanAudit,
    severity: "high",
    missingReason: "缺少 extension-plan-completion-audit-latest.json / .md 证据。",
    notReadyReason: "bdocs 扩展计划第 13/16 节仍有代码、smoke、E2E、发布证据或文档要求缺失。",
    action: "运行 node scripts/extension-plan-completion-audit.js --report-dir=.codek/reports，并按缺失项补齐真实代码和 latest 报告。",
  })
  addAdvisoryGateGap(gaps, {
    id: "manual_real_ui_evidence",
    title: "真实 UI 手感人工证据",
    evidence: evidence.manualRealUiEvidence,
    missingReason: "缺少 manual-real-ui-evidence-latest.json / .md 证据。",
    notReadyReason: formatManualRealUiNotReadyReason(evidence.manualRealUiEvidence),
    action: "运行 npm run manual:real-ui -- --init，完成真实 D:\\Workspace UI 检查清单，再运行 npm run manual:real-ui -- --evidence-file=<已填写 json>。",
  })
  addEvidenceGap(gaps, {
    id: "agent_change_safety_smoke",
    title: "Agent 变更安全 smoke",
    evidence: evidence.agentChangeSafety,
    severity: "high",
    missingReason: "缺少 agent-change-safety-smoke-latest.json / .md 证据。",
    notReadyReason: "Agent 变更安全 smoke 未证明 pending patch 和 rollback 能阻断用户手工改动漂移。",
    action: "运行 npm run smoke:agent-change-safety，确认 pending batch、pending hunk、rollback 都会阻断 manual-change 漂移。",
  })
  addEvidenceGap(gaps, {
    id: "router_calibration_smoke",
    title: "任务路由校准 smoke",
    evidence: evidence.routerCalibration,
    severity: "high",
    missingReason: "缺少 router-calibration-smoke-latest.json / .md 证据。",
    notReadyReason: "路由校准缺少 100+ 样本，或未对不一致样本生成失败报告。",
    action: "运行 npm run smoke:router-calibration，确认至少 100 个样本，并覆盖不一致样本的失败报告。",
  })
  addAdvisoryGateGap(gaps, {
    id: "product_grade_gate",
    title: "AU 产品级门禁",
    evidence: evidence.productGradeGate,
    severity: "high",
    missingReason: "缺少 AU 产品级门禁 latest 报告。",
    notReadyReason: "AU 产品级门禁仍有阻断项。",
    action: "运行 npm run au:product-grade，按 AU1-AU10 缺口优先级补齐证据。",
  })
  addAdvisoryGateGap(gaps, {
    id: "ax_enterprise_gate",
    title: "AX 企业级门禁",
    evidence: evidence.axEnterpriseGate,
    severity: "high",
    missingReason: "缺少 AX1-AX16 enterprise gap gate latest 报告。",
    notReadyReason: "AX1-AX16 统一门禁仍有阻断或缺失证据。",
    action: "运行 npm run ax:enterprise-gap，按 AX gap 列表补齐对应能力和证据。",
  })
  addEvidenceGap(gaps, {
    id: "extension_marketplace_smoke",
    title: "扩展市场 smoke",
    evidence: evidence.extensionMarketplaceSmoke,
    severity: "high",
    missingReason: "缺少 extension-marketplace-smoke-latest.json / .md 证据。",
    notReadyReason: "扩展市场搜索、详情、README、版本或安装计划 smoke 仍有阻断项。",
    action: "运行 node scripts/extension-marketplace-smoke.js --report-dir=.codek/reports，确认搜索、详情、README、版本和安装计划通过。",
  })
  addEvidenceGap(gaps, {
    id: "extension_install_smoke",
    title: "扩展安装生命周期 smoke",
    evidence: evidence.extensionInstallSmoke,
    severity: "high",
    missingReason: "缺少 extension-install-smoke-latest.json / .md 证据。",
    notReadyReason: "扩展 VSIX 安装、更新、回滚、卸载、状态或审计 smoke 仍有阻断项。",
    action: "运行 node scripts/extension-install-smoke.js --report-dir=.codek/reports；真实 marketplace 安装只在用户明确授权后加 --confirm-marketplace-install。",
  })
  addEvidenceGap(gaps, {
    id: "extension_marketplace_install_matrix",
    title: "Marketplace install matrix",
    evidence: evidence.extensionMarketplaceInstallMatrix,
    severity: "high",
    missingReason: "Missing extension-marketplace-install-matrix-latest.json / .md evidence.",
    notReadyReason: "Marketplace Top 100 install matrix did not meet metadata, install-chain, activation preflight, or isolation thresholds.",
    action: "Run node scripts/extension-marketplace-install-matrix.js --top=100 --report-dir=.codek/reports and fix failed download/extract/install/scan stages.",
  })
  addEvidenceGap(gaps, {
    id: "extension_migration_smoke",
    title: "VS Code/Cursor 扩展迁移 smoke",
    evidence: evidence.extensionMigrationSmoke,
    severity: "high",
    missingReason: "缺少 extension-migration-smoke-latest.json / .md 证据。",
    notReadyReason: "VS Code/Cursor 扩展迁移 dry-run、用户确认队列或失败重试状态仍有阻断项。",
    action: "运行 node scripts/extension-migration-smoke.js --source=cursor --dry-run --report-dir=.codek/reports，确认迁移不会自动安装扩展。",
  })
  addEvidenceGap(gaps, {
    id: "extension_security_smoke",
    title: "扩展安全和治理 smoke",
    evidence: evidence.extensionSecuritySmoke,
    severity: "high",
    missingReason: "缺少 extension-security-smoke-latest.json / .md 证据。",
    notReadyReason: "扩展 workspace trust、publisher 策略或审计脱敏仍有阻断项。",
    action: "运行 node scripts/extension-security-smoke.js --report-dir=.codek/reports，确认扩展安装安全边界和审计可用。",
  })
  addEvidenceGap(gaps, {
    id: "extension_host_restart_smoke",
    title: "EH restart smoke",
    evidence: evidence.extensionHostRestartSmoke,
    severity: "low",
    missingReason: "缺少 extension-host-restart-smoke-latest-result.json 证据。",
    notReadyReason: evidence.extensionHostRestartSmoke?.blockedReason
      || "Extension Host restart smoke 未证明 restart requested/observed、LocalProcess host source、activation replay、manifest registration 和 no reload 语义。",
    action: "运行 node scripts/extension-host-restart-smoke.js，若真实运行受环境限制，保留 structured blocked evidence 并修复阻断原因。",
  })
  addEvidenceGap(gaps, {
    id: "eh_marketplace_e2e",
    title: "Extension Host marketplace E2E",
    evidence: evidence.ehMarketplaceE2e,
    severity: "high",
    missingReason: "缺少 eh-e2e-marketplace-latest.json / .md 证据。",
    notReadyReason: "真实 Open VSX 搜索、安装、激活或卸载 E2E 仍有阻断项。",
    action: "运行 npm run eh:e2e:marketplace -- --report-dir=.codek/reports，确认真实扩展安装和卸载闭环通过。",
  })
  addEvidenceGap(gaps, {
    id: "eh_memento_storage_e2e",
    title: "Extension Host memento storage E2E",
    evidence: evidence.ehMementoStorageE2e,
    severity: "high",
    missingReason: "缺少 eh-e2e-memento-storage-latest.json / .md 证据。",
    notReadyReason: "真实扩展宿主没有证明内置形态与第三方安装形态 extension 的 globalState、workspaceState、sync keys 都落到 profile scoped storage，或仍写入旧 ext-host-storage.json。",
    action: "运行 node scripts/eh-e2e.js --memento-storage --report-dir=.codek/reports，确认 VS Code ExtensionContext memento API 通过 MainThreadStorage 写入 profile scoped storage，并确认第三方安装标记被扫描为 isBuiltin=false。",
  })
  addEvidenceGap(gaps, {
    id: "eh_extension_context_e2e",
    title: "Extension Host ExtensionContext E2E",
    evidence: evidence.ehExtensionContextE2e,
    severity: "high",
    missingReason: "缺少 eh-e2e-extension-context-latest.json / .md 证据。",
    notReadyReason: "真实扩展宿主没有证明第三方安装形态 extension 的 context.extension/packageJSON、extensionUri、extensionPath、asAbsolutePath、storageUri、globalStorageUri、logUri 与 VS Code 契约一致。",
    action: "运行 node scripts/eh-e2e.js --extension-context --report-dir=.codek/reports，确认 Codek scanner 保留完整 packageJSON，并由 VS Code 原生 ExtensionContext 暴露给第三方扩展。",
  })
  addEvidenceGap(gaps, {
    id: "eh_implicit_activation_e2e",
    title: "Extension Host implicit activation E2E",
    evidence: evidence.ehImplicitActivationE2e,
    severity: "high",
    missingReason: "缺少 eh-e2e-implicit-activation-latest.json / .md 证据。",
    notReadyReason: "真实扩展宿主没有证明无显式 activationEvents 的第三方扩展能从 contributes.commands 派生 onCommand 并被真实 EH 激活。",
    action: "运行 node scripts/eh-e2e.js --implicit-activation --report-dir=.codek/reports，确认 VS Code ImplicitActivationEvents 适配层已经接入 scanner 和 Extension Host。",
  })
  addEvidenceGap(gaps, {
    id: "eh_dependency_loop_e2e",
    title: "Extension Host dependency loop E2E",
    evidence: evidence.ehDependencyLoopE2e,
    severity: "high",
    missingReason: "缺少 eh-e2e-dependency-loop-latest.json / .md 证据。",
    notReadyReason: "真实扩展宿主没有证明 VS Code ExtensionDescriptionRegistry 依赖环检测会在 scanner 和 InitData 前剔除循环扩展，同时健康扩展仍能激活。",
    action: "运行 node scripts/eh-e2e.js --dependency-loop --report-dir=.codek/reports，确认循环依赖扩展不进入 allExtensions/byId/activationEvents/InitData，健康扩展仍可真实激活。",
  })
  addEvidenceGap(gaps, {
    id: "eh_search_provider_e2e",
    title: "Extension Host SearchProvider E2E",
    evidence: evidence.ehSearchProviderE2e,
    severity: "high",
    missingReason: "缺少 eh-e2e-search-provider-latest.json / .md 证据。",
    notReadyReason: "真实扩展宿主没有证明第三方 SearchProvider 能通过 VS Code URI marshalling 与 cancellation token RPC 协议完成 text/file search provider 调用，或仍然 fallback 到自研搜索。",
    action: "运行 node scripts/eh-e2e.js --search-provider --report-dir=.codek/reports，确认 provider 注册、onSearch:file 激活、text/file provider 均被调用、fallbackBypassed=true 且 providerErrors 为空。",
  })
  addEvidenceGap(gaps, {
    id: "eh_profile_content_handler_e2e",
    title: "Extension Host ProfileContentHandler E2E",
    evidence: evidence.ehProfileContentHandlerE2e,
    severity: "high",
    missingReason: "缺少 eh-e2e-profile-content-handler-latest.json / .md 证据。",
    notReadyReason: "真实扩展宿主没有证明第三方 ProfileContentHandler 能通过 VS Code onProfile:<handlerId> 激活和 proposed API 完成 registerProfileContentHandler、readProfile、saveProfile 和停止后的清理，或 providerErrors 仍不为空。",
    action: "运行 node scripts/eh-e2e.js --profile-content-handler --report-dir=.codek/reports，确认 onProfile:<handlerId> 激活、handler 注册、metadata、read/save 调用、save result、cleanupAfterStop=true 且 providerErrors 为空。",
  })
  addEvidenceGap(gaps, {
    id: "installed_mcp_discovery_smoke",
    title: "Installed MCP discovery smoke",
    evidence: evidence.installedMcpDiscovery,
    severity: "high",
    missingReason: "缺少 installed-mcp-discovery-latest.json / .md 证据。",
    notReadyReason: "安装扩展记录没有证明 VS Code manifest/contributes.mcp 被持久化为 install-state、Installed MCP discovery 能读取并进入 registry，或 registry 模式没有过滤 workspace source。",
    action: "运行 node scripts/installed-mcp-discovery-smoke.js --report-dir=.codek/reports，确认 install-state manifest MCP、installed discovery、registry apply、workspace filtering 和 secret redaction 全部通过。",
  })
  addEvidenceGap(gaps, {
    id: "mcp_gallery_management_smoke",
    title: "MCP Gallery management smoke",
    evidence: evidence.mcpGalleryManagement,
    severity: "high",
    missingReason: "缺少 mcp-gallery-management-latest.json / .md 证据。",
    notReadyReason: "MCP Gallery 安装没有证明 metadata/README 写入、.code-workspace settings.mcp 写入、registry 消费、卸载清理和 VS Code-style lifecycle event 全部走通。",
    action: "运行 node scripts/mcp-gallery-management-smoke.js --report-dir=.codek/reports，确认 Gallery install/readme/resource/lifecycle/uninstall 全链路通过。",
  })
  addEvidenceGap(gaps, {
    id: "eh_mcp_provider_bridge",
    title: "Extension Host MCP provider bridge",
    evidence: evidence.ehMcpProviderBridge,
    severity: "high",
    missingReason: "缺少 eh-e2e-mcp-provider-latest.json / .md 证据。",
    notReadyReason: "真实主线程 MCP bridge 没有证明 VS Code-style MCP collection/definition 同步、ExtHost delegate transport、工具调用和 secret redaction 都走通。",
    action: "运行 node scripts/mcp-provider-bridge-smoke.js --report-dir=.codek/reports，确认 $upsertMcpCollection、$onDidChangeMcpServerDefinitions、$startMcp/$sendMessage、$deleteMcpCollection 全链路通过。",
  })
  addEvidenceGap(gaps, {
    id: "extension_compatibility_matrix",
    title: "扩展 Top N 兼容矩阵",
    evidence: evidence.extensionCompatibilityMatrix,
    severity: "high",
    missingReason: "缺少 extension-compatibility-matrix-latest.json / .md 证据。",
    notReadyReason: "扩展 Top N 兼容矩阵缺失样本或仍有 blocked 扩展。",
    action: "运行 node scripts/extension-compatibility-matrix.js --top=100 --report-dir=.codek/reports，并处理 blocked 扩展。",
  })
  addEvidenceGap(gaps, {
    id: "extension_enterprise_gate",
    title: "扩展生态企业级门禁",
    evidence: evidence.extensionEnterpriseGate,
    severity: "high",
    missingReason: "缺少 extension-enterprise-gate-latest.json / .md 证据。",
    notReadyReason: "扩展 Marketplace、安装计划、兼容性或 Top N 证据仍有阻断项。",
    action: "运行 node scripts/extension-baseline.js、node scripts/ar-health.js 和 node scripts/extension-enterprise-gate.js，确认扩展生态 gate 通过。",
  })
  if (evidence.atPreflight && !evidence.atPreflight.available) {
    gaps.push({
      id: "at_preflight",
      title: "AT 发布候选预检",
      severity: "low",
      status: "missing",
      reason: "缺少 AT 发布候选预检 latest 报告。",
      action: "运行 npm run at:preflight，确认真实打包/安装闭环的前置条件。",
    })
  } else if (evidence.atPreflight && !evidence.atPreflight.ready) {
    gaps.push({
      id: "at_preflight",
      title: "AT 发布候选预检",
      severity: "medium",
      status: "not_ready",
      reason: "AT 发布候选预检存在失败项。",
      action: "先修复 electron-builder 配置、pack 脚本、前端 dist 或 smoke 契约，再进入真实打包。",
    })
  }
  if (evidence.packagingPreflight && !evidence.packagingPreflight.available) {
    gaps.push({
      id: "packaging_preflight",
      title: "Windows 打包预检",
      severity: "low",
      status: "missing",
      reason: "缺少 Windows 打包预检 latest 报告。",
      action: "运行 node scripts/packaging-preflight.js，生成打包脚本、dist、CSP 和 electron-rebuild 预检证据。",
    })
  } else if (evidence.packagingPreflight && !evidence.packagingPreflight.ready) {
    gaps.push({
      id: "packaging_preflight",
      title: "Windows 打包预检",
      severity: "medium",
      status: "not_ready",
      reason: "Windows 打包预检存在失败阻断项。",
      action: "先修复打包预检失败项，再进入授权环境运行真实 Windows 打包。",
    })
  }
  return gaps
}

function addEvidenceGap(gaps, options) {
  const item = options.evidence || {}
  if (!item.available) {
    gaps.push({
      id: options.id,
      title: options.title,
      severity: options.severity,
      status: "missing",
      reason: options.missingReason,
      action: options.action,
    })
    return
  }
  if (!item.ready) {
    gaps.push({
      id: options.id,
      title: options.title,
      severity: options.severity,
      status: "not_ready",
      reason: options.notReadyReason,
      action: options.action,
    })
  }
}

function addAdvisoryGateGap(gaps, options) {
  const item = options.evidence || {}
  if (!item.available) {
    gaps.push({
      id: options.id,
      title: options.title,
      severity: "low",
      status: "missing",
      reason: options.missingReason,
      action: options.action,
    })
    return
  }
  if (!item.ready) {
    gaps.push({
      id: options.id,
      title: options.title,
      severity: "low",
      status: "not_ready",
      reason: options.notReadyReason,
      action: options.action,
    })
  }
}

function buildReleaseEvidenceNextActions(gaps, ready) {
  const blockingGaps = Array.isArray(gaps) ? gaps.filter((gap) => gap.severity !== "low" && gap.severity !== "info") : []
  if (ready && blockingGaps.length === 0) {
    return [{
      id: "manual_review",
      title: "人工复核证据链",
      severity: "info",
      action: "打开最新 Markdown，确认 UI、报告路径和质量门输出符合本次发布预期。",
    }]
  }
  return blockingGaps.slice(0, 5).map((gap) => ({
    id: gap.id,
    title: gap.title,
    severity: gap.severity,
    action: gap.action,
  }))
}

function saveReleaseEvidenceSummary(report, options = {}) {
  if (!report) throw new Error("release evidence report required")
  const normalized = report.reportKind === "release-evidence" ? report : buildReleaseEvidenceSummary(report)
  const paths = releaseEvidencePaths(options.reportDir)
  fs.mkdirSync(paths.historyDir, { recursive: true })
  const stamp = new Date(normalized.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyMarkdownPath = path.join(paths.historyDir, `release-evidence-${stamp}.md`)
  const historyJsonPath = path.join(paths.historyDir, `release-evidence-${stamp}.json`)
  const latestPayload = {
    ...normalized,
    markdownPath: paths.latestMarkdownPath,
    jsonPath: paths.latestJsonPath,
    historyMarkdownPath,
    historyJsonPath,
  }
  const historyPayload = {
    ...latestPayload,
    markdownPath: historyMarkdownPath,
    jsonPath: historyJsonPath,
  }
  const markdown = toReleaseEvidenceMarkdown(latestPayload)
  latestPayload.markdown = markdown
  historyPayload.markdown = markdown
  fs.writeFileSync(paths.latestMarkdownPath, `${markdown}\n`, "utf8")
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(latestPayload, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMarkdownPath, `${markdown}\n`, "utf8")
  fs.writeFileSync(historyJsonPath, `${JSON.stringify(historyPayload, null, 2)}\n`, "utf8")
  return {
    report: latestPayload,
    markdown,
    reportDir: paths.reportDir,
    markdownPath: paths.latestMarkdownPath,
    jsonPath: paths.latestJsonPath,
    historyMarkdownPath,
    historyJsonPath,
  }
}

function appendTaskRunEvidenceMarkdown(lines, evidence = {}) {
  const taskRows = Array.isArray(evidence.taskRuns?.runs) ? evidence.taskRuns.runs.map((item) =>
    `| ${escapeCell(item.name || item.id || "-")} | ${escapeCell(formatTaskRunStatus(item.status))} | ${item.passedSteps}/${item.stepCount} | ${item.durationMs || 0}ms | ${formatRunMode(item.hasParallelSteps ? "parallel" : "sequence")} | ${item.maxDependencyDepth || 0} | ${item.problemDiagnostics || 0} |`,
  ) : []
  const taskStepRows = Array.isArray(evidence.taskRuns?.runs)
    ? evidence.taskRuns.runs.flatMap((run) => (Array.isArray(run.steps) ? run.steps : []).slice(0, 8).map((step) =>
      `| ${escapeCell(run.name || run.id || "-")} | ${escapeCell(step.name || step.id || "-")} | ${escapeCell(formatTaskRunStatus(step.status))} | ${step.exitCode === null ? "-" : step.exitCode} | ${step.durationMs || 0}ms | ${formatRunMode(step.runMode)} | ${step.dependencyDepth || 0} | ${step.commandLength || 0} / ${step.outputLength || 0} / ${step.errorLength || 0} |`,
    ))
    : []
  lines.push(
    "",
    "## 任务运行证据",
    "",
    "| 任务 | 状态 | 步骤 | 耗时 | 模式 | 最大依赖深度 | 问题诊断 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...(taskRows.length ? taskRows : ["| - | - | - | - | - | - | - |"]),
    "",
    "| 任务 | 步骤 | 状态 | 退出码 | 耗时 | 模式 | 深度 | command/output/error 长度 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...(taskStepRows.length ? taskStepRows : ["| - | - | - | - | - | - | - | - |"]),
  )
}

function readLatestReleaseEvidenceSummary(options = {}) {
  const paths = releaseEvidencePaths(options.reportDir)
  const report = readJsonFile(paths.latestJsonPath)
  const markdown = fs.existsSync(paths.latestMarkdownPath) ? fs.readFileSync(paths.latestMarkdownPath, "utf8") : ""
  return {
    report,
    markdown,
    jsonPath: report ? paths.latestJsonPath : "",
    markdownPath: markdown ? paths.latestMarkdownPath : "",
  }
}

function listReleaseEvidenceSummaries(options = {}) {
  const paths = releaseEvidencePaths(options.reportDir)
  if (!fs.existsSync(paths.historyDir)) return []
  return fs.readdirSync(paths.historyDir)
    .filter((name) => /^release-evidence-.*\.json$/.test(name))
    .map((name) => {
      const jsonPath = path.join(paths.historyDir, name)
      const report = readJsonFile(jsonPath)
      if (!report) return null
      return {
        createdAt: Number(report.createdAt || 0),
        status: report.status || "",
        statusLabel: report.statusLabel || "",
        ready: report.ready === true,
        summary: report.summary || { total: 0, available: 0, ready: 0, missing: 0 },
        jsonPath,
        markdownPath: jsonPath.replace(/\.json$/, ".md"),
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

function toReleaseEvidenceMarkdown(report) {
  const evidence = report.evidence || {}
  const rows = [
    evidence.releaseGate && ["发布质量门", evidence.releaseGate.statusLabel, `${evidence.releaseGate.passed}/${evidence.releaseGate.total}`, evidence.releaseGate.jsonPath],
    evidence.acceptance && ["发布验收矩阵", evidence.acceptance.statusLabel, `场景 ${evidence.acceptance.matrixPassed}/${evidence.acceptance.matrixTotal}`, evidence.acceptance.markdownPath],
    evidence.readiness && ["企业级运行预检", evidence.readiness.statusLabel, `${evidence.readiness.passed}/${evidence.readiness.total} 通过`, evidence.readiness.markdownPath],
    evidence.realWorkspaceTrial && ["真实工作区试运行", evidence.realWorkspaceTrial.statusLabel, `${evidence.realWorkspaceTrial.filesChanged.length} 文件`, evidence.realWorkspaceTrial.markdownPath],
    evidence.demoTaskReport && ["Day 11-12 演示任务", evidence.demoTaskReport.statusLabel, `覆盖 ${evidence.demoTaskReport.coveredTasks.length}/${evidence.demoTaskReport.requiredTasks.length} · role profiles ${evidence.demoTaskReport.roleProfileCount} · trials ${evidence.demoTaskReport.roleTrialCount}`, `成本 ${formatUsd(evidence.demoTaskReport.costReview.estimatedCostUsd)} · 人工复核 ${evidence.demoTaskReport.costReview.manualReviewMinutes} 分钟 · 缺失 ${evidence.demoTaskReport.missingTasks.join(", ") || "无"}`],
    evidence.runActionAudit && ["控制台动作审计", evidence.runActionAudit.statusLabel, `${evidence.runActionAudit.historyCount} 条`, evidence.runActionAudit.latestSummary],
    evidence.llmUsage && ["LLM 用量", evidence.llmUsage.statusLabel, `${evidence.llmUsage.totalRequests} 次 / ${evidence.llmUsage.totalTokens} tokens`, `估算成本 ${formatUsd(evidence.llmUsage.estimatedCostUsd)} · 未配置价格 ${evidence.llmUsage.unpricedRequests || 0} 次 · provider 计量 ${evidence.llmUsage.providerUsageRequests} 次 · 本地估算 ${evidence.llmUsage.estimatedUsageRequests} 次`],
    evidence.costReview && ["成本摘要", evidence.costReview.statusLabel, `${evidence.costReview.models.length} 个模型 · cost ${formatUsd(evidence.costReview.estimatedCostUsd)} · manual ${evidence.costReview.manualReviewMinutes ?? evidence.costReview.manualReviewPlaceholder}`, (evidence.costReview.unavailableReasons || []).join(", ") || "cost available"],
    evidence.qualityGateSummary && ["质量门汇总", evidence.qualityGateSummary.statusLabel, `${evidence.qualityGateSummary.passed}/${evidence.qualityGateSummary.total} 通过 · 失败 ${evidence.qualityGateSummary.failed} · 阻断 ${evidence.qualityGateSummary.blocked}`, `核心 ${evidence.qualityGateSummary.requiredPassed}/${(evidence.qualityGateSummary.required || []).length}`],
    evidence.failureClassification && ["失败分类", evidence.failureClassification.statusLabel, `${(evidence.failureClassification.classifications || []).length} 类`, (evidence.failureClassification.classifications || []).map((item) => item.label).join("；") || "无失败分类"],
    evidence.codebaseContext && ["Codebase Context 证据", evidence.codebaseContext.statusLabel, `${evidence.codebaseContext.sources} 个来源 / ${evidence.codebaseContext.workspaceSources} 个工作区来源 / ${evidence.codebaseContext.truncatedSources} 个截断来源`, `run ${evidence.codebaseContext.runId || "-"} / 索引 ${evidence.codebaseContext.indexStatus?.state || "-"}/${evidence.codebaseContext.indexStatus?.freshness || "-"}`],
    evidence.sandboxSecurity && ["沙箱安全证据", evidence.sandboxSecurity.statusLabel, `${evidence.sandboxSecurity.isolatedAssignments}/${evidence.sandboxSecurity.assignmentCount} 隔离 · 质量门 ${formatTaskRunStatus(evidence.sandboxSecurity.qualityGateStatus)} · 授权阻断 ${evidence.sandboxSecurity.commandAuthorizationBlocked}`, `run ${evidence.sandboxSecurity.runId || "-"} / 违规 ${evidence.sandboxSecurity.violations?.length || 0}`],
    evidence.agentRoleTrials && ["Agent 角色 profile 试用", evidence.agentRoleTrials.statusLabel, `${evidence.agentRoleTrials.completeTrials}/${evidence.agentRoleTrials.requiredTrialCount} 完整 · ${evidence.agentRoleTrials.runtimeIntegrationRecommended ? "建议接入运行时" : "仅保留模板"}`, evidence.agentRoleTrials.runtimeContract?.noSecondStateSource ? "existing orchestrator assignment/event/artifact/evidence" : "-"],
    evidence.bdUserTrial && ["BD 真实用户试运行", evidence.bdUserTrial.statusLabel, `${evidence.bdUserTrial.requiredTasks}/${evidence.bdUserTrial.taskCount} 必需任务 · 检查 ${evidence.bdUserTrial.checkPassed}/${evidence.bdUserTrial.checkTotal}`, evidence.bdUserTrial.markdownPath || "beta-trial-plan-latest.md"],
    evidence.betaTrialRun && ["BE 真实 Beta 执行", evidence.betaTrialRun.statusLabel, `${evidence.betaTrialRun.passed}/${evidence.betaTrialRun.total} 任务 · P0 ${evidence.betaTrialRun.p0} / P1 ${evidence.betaTrialRun.p1} / P2 ${evidence.betaTrialRun.p2}`, evidence.betaTrialRun.markdownPath || "beta-trial-run-latest.md"],
    evidence.betaFeedback && ["BF 人工 Beta 反馈", evidence.betaFeedback.statusLabel, `${evidence.betaFeedback.imported}/${evidence.betaFeedback.total} 条 · 截图 ${evidence.betaFeedback.screenshotCount} · 待回归 ${evidence.betaFeedback.pendingRegression} · P0 ${evidence.betaFeedback.p0}`, "beta-trial-run-latest.md"],
    evidence.arHealth && ["AR 真实世界健康", evidence.arHealth.statusLabel, formatArHealthSummary(evidence.arHealth), "模型提供方 / 调试 / 扩展 / 兼容性 / Goal / 性能"],
    evidence.workbenchDeep && ["AU Workbench 深水区", evidence.workbenchDeep.statusLabel, `${evidence.workbenchDeep.passed}/${evidence.workbenchDeep.total} 通过 · ${evidence.workbenchDeep.roots} 个 root · ${evidence.workbenchDeep.taskConfigs} 个任务配置`, "workbench-deep-smoke-latest.md"],
    evidence.taskTerminalReuseRegistry && ["Terminal reuse registry", evidence.taskTerminalReuseRegistry.statusLabel, `same ${evidence.taskTerminalReuseRegistry.sameTaskOwnerCount} · idle ${evidence.taskTerminalReuseRegistry.idleOwnerCount} · connected ${formatBooleanEvidence(evidence.taskTerminalReuseRegistry.connected, "是", "否")}`, evidence.taskTerminalReuseRegistry.remainingGap],
    evidence.workbenchRealProjectUi && ["Workbench 真实项目 UI", evidence.workbenchRealProjectUi.statusLabel, `${evidence.workbenchRealProjectUi.acceptancePassed}/${evidence.workbenchRealProjectUi.acceptanceTotal} 验收 · p95 ${evidence.workbenchRealProjectUi.p95ScrollMs}ms · max ${evidence.workbenchRealProjectUi.maxScrollMs}ms`, evidence.workbenchRealProjectUi.screenshotPath || evidence.workbenchRealProjectUi.markdownPath],
    evidence.explorerFsParity && ["Explorer FS parity", evidence.explorerFsParity.statusLabel, `${evidence.explorerFsParity.passed}/${evidence.explorerFsParity.total} 目录 · 缺失 ${evidence.explorerFsParity.missing} · 类型错配 ${evidence.explorerFsParity.typeMismatches} · 截断 ${evidence.explorerFsParity.truncated}`, evidence.explorerFsParity.markdownPath || "explorer-fs-parity-latest.md"],
    evidence.shellIntegration && ["终端 Shell 集成", evidence.shellIntegration.statusLabel, `${evidence.shellIntegration.passed}/${evidence.shellIntegration.total} 通过 · 跳过 ${evidence.shellIntegration.skipped} · 失败 ${evidence.shellIntegration.failed}`, evidence.shellIntegration.markdownPath || "shell-integration-smoke-latest.md"],
    evidence.debugAdapterSmoke && ["调试适配器 smoke", evidence.debugAdapterSmoke.statusLabel, `${evidence.debugAdapterSmoke.passed}/${evidence.debugAdapterSmoke.total} 通过 · 跳过 ${evidence.debugAdapterSmoke.skipped} · fixture ${evidence.debugAdapterSmoke.fixturePassed ? "通过" : "缺失"} · DAP metadata ${evidence.debugAdapterSmoke.dapCommandCoverage?.covered || 0}/${evidence.debugAdapterSmoke.dapCommandCoverage?.total || 0} · stack/scopes/vars ${evidence.debugAdapterSmoke.stackFrames}/${evidence.debugAdapterSmoke.scopes}/${evidence.debugAdapterSmoke.variables} · bridge ${evidence.debugAdapterSmoke.bridgeEvidence?.stateSource || "-"}`, evidence.debugAdapterSmoke.markdownPath || "debug-adapter-smoke-latest.md"],
    evidence.manualRealUiEvidence && ["真实 UI 手感人工证据", evidence.manualRealUiEvidence.statusLabel, `${evidence.manualRealUiEvidence.passedScenarios}/${evidence.manualRealUiEvidence.totalScenarios} 场景 · 检查 ${evidence.manualRealUiEvidence.passedChecks}/${evidence.manualRealUiEvidence.requiredChecks} · 截图 ${evidence.manualRealUiEvidence.screenshotCount}`, evidence.manualRealUiEvidence.markdownPath || "manual-real-ui-evidence-latest.md"],
    evidence.extensionPlanAudit && ["bdocs 扩展计划完成审计", evidence.extensionPlanAudit.statusLabel, `${evidence.extensionPlanAudit.passed}/${evidence.extensionPlanAudit.total} 通过 · 缺失 ${evidence.extensionPlanAudit.missing} · 人工 ${evidence.extensionPlanAudit.manualRequired}`, evidence.extensionPlanAudit.markdownPath || "extension-plan-completion-audit-latest.md"],
    evidence.agentChangeSafety && ["Agent 变更安全", evidence.agentChangeSafety.statusLabel, `${evidence.agentChangeSafety.passed}/${evidence.agentChangeSafety.total} 通过 · 批量待处理 ${formatBooleanEvidence(evidence.agentChangeSafety.pendingBatchBlocked, "已阻断", "缺失")} · 评审面板 ${formatBooleanEvidence(evidence.agentChangeSafety.reviewDisplayBlocked, "可见", "缺失")} · 操作日志 ${formatBooleanEvidence(evidence.agentChangeSafety.operationLogVisible, "可见", "缺失")} · hunk ${formatBooleanEvidence(evidence.agentChangeSafety.pendingHunkBlocked, "已阻断", "缺失")} · rollback ${formatBooleanEvidence(evidence.agentChangeSafety.rollbackBlocked, "已阻断", "缺失")}`, evidence.agentChangeSafety.markdownPath || "agent-change-safety-smoke-latest.md"],
    evidence.agentEvidenceWorkbench && ["Agent Evidence Workbench", evidence.agentEvidenceWorkbench.statusLabel, `${evidence.agentEvidenceWorkbench.readyStages}/${evidence.agentEvidenceWorkbench.stageCount} 阶段 · 可观察 ${evidence.agentEvidenceWorkbench.availableStages}`, "timeline / scm / testing / approval / rollback"],
    evidence.routerCalibration && ["任务路由校准", evidence.routerCalibration.statusLabel, `${evidence.routerCalibration.total}/${evidence.routerCalibration.minSamples} 样本 · 路由对齐 ${evidence.routerCalibration.routerAligned} · 不一致 ${evidence.routerCalibration.misaligned} · 失败报告 ${evidence.routerCalibration.failureReports}`, evidence.routerCalibration.markdownPath || "router-calibration-smoke-latest.md"],
    evidence.productGradeGate && ["AU 产品级门禁", evidence.productGradeGate.statusLabel, `${evidence.productGradeGate.readyCount}/${evidence.productGradeGate.total} 就绪 · ${evidence.productGradeGate.blocked} 阻断`, "au-product-grade-gate-latest.md"],
    evidence.axEnterpriseGate && ["AX 企业级门禁", evidence.axEnterpriseGate.statusLabel, `${evidence.axEnterpriseGate.readyCount}/${evidence.axEnterpriseGate.total} 就绪 · ${evidence.axEnterpriseGate.blocked} 阻断`, "ax-enterprise-gap-gate-latest.md"],
    evidence.extensionMarketplaceSmoke && ["扩展市场 smoke", evidence.extensionMarketplaceSmoke.statusLabel, `${evidence.extensionMarketplaceSmoke.passed}/${evidence.extensionMarketplaceSmoke.total} 通过 · 详情 ${evidence.extensionMarketplaceSmoke.detailsReady}/${evidence.extensionMarketplaceSmoke.inspected} · README ${evidence.extensionMarketplaceSmoke.readmeReady}/${evidence.extensionMarketplaceSmoke.inspected}`, evidence.extensionMarketplaceSmoke.markdownPath || "extension-marketplace-smoke-latest.md"],
    evidence.extensionInstallSmoke && ["扩展安装生命周期 smoke", evidence.extensionInstallSmoke.statusLabel, `${evidence.extensionInstallSmoke.passed}/${evidence.extensionInstallSmoke.total} 通过 · 安装 ${formatBooleanEvidence(evidence.extensionInstallSmoke.fixtureInstallPassed, "通过", "缺失")} · 回滚 ${formatBooleanEvidence(evidence.extensionInstallSmoke.fixtureRollbackPassed, "通过", "缺失")} · 市场安装 ${formatBooleanEvidence(evidence.extensionInstallSmoke.marketplaceInstallAuthorized, "已授权", "未授权")}`, evidence.extensionInstallSmoke.markdownPath || "extension-install-smoke-latest.md"],
    evidence.extensionMarketplaceInstallMatrix && ["Marketplace install matrix", evidence.extensionMarketplaceInstallMatrix.statusLabel, `${evidence.extensionMarketplaceInstallMatrix.installChainComplete}/${evidence.extensionMarketplaceInstallMatrix.minInstallChain} install-chain · metadata ${evidence.extensionMarketplaceInstallMatrix.metadataUsable}/${evidence.extensionMarketplaceInstallMatrix.minMetadata} · activation ${evidence.extensionMarketplaceInstallMatrix.activationPreflightReady}/${evidence.extensionMarketplaceInstallMatrix.minActivationPreflight}`, evidence.extensionMarketplaceInstallMatrix.markdownPath || "extension-marketplace-install-matrix-latest.md"],
    evidence.extensionMigrationSmoke && ["扩展迁移 smoke", evidence.extensionMigrationSmoke.statusLabel, `${evidence.extensionMigrationSmoke.passed}/${evidence.extensionMigrationSmoke.total} 通过 · 队列 ${evidence.extensionMigrationSmoke.queueTotal} · 自动安装 ${formatBooleanEvidence(evidence.extensionMigrationSmoke.queueInstalled === 0, "未发生", "发生")}`, evidence.extensionMigrationSmoke.markdownPath || "extension-migration-smoke-latest.md"],
    evidence.extensionSecuritySmoke && ["扩展安全 smoke", evidence.extensionSecuritySmoke.statusLabel, `${evidence.extensionSecuritySmoke.passed}/${evidence.extensionSecuritySmoke.total} 通过 · trust ${formatBooleanEvidence(evidence.extensionSecuritySmoke.restrictedWorkspaceBlocked, "通过", "缺失")} · 审计脱敏 ${formatBooleanEvidence(evidence.extensionSecuritySmoke.auditRedactsSecrets, "通过", "缺失")}`, evidence.extensionSecuritySmoke.markdownPath || "extension-security-smoke-latest.md"],
    evidence.extensionHostRestartSmoke && ["EH restart smoke", evidence.extensionHostRestartSmoke.statusLabel, `requested ${formatBooleanEvidence(evidence.extensionHostRestartSmoke.restartRequested, "是", "否")} · observed ${formatBooleanEvidence(evidence.extensionHostRestartSmoke.restartObserved, "是", "否")} · host ${evidence.extensionHostRestartSmoke.hostKind || "-"} / ${evidence.extensionHostRestartSmoke.hostSource || "-"} · phase ${evidence.extensionHostRestartSmoke.lifecyclePhase || "-"} · blocked ${evidence.extensionHostRestartSmoke.blockedReason || "none"}`, evidence.extensionHostRestartSmoke.jsonPath || "extension-host-restart-smoke-latest-result.json"],
    evidence.ehMarketplaceE2e && ["EH marketplace E2E", evidence.ehMarketplaceE2e.statusLabel, `阶段 ${evidence.ehMarketplaceE2e.phase || "missing"} · 扩展 ${evidence.ehMarketplaceE2e.extensionId || "missing"} · 搜索 ${evidence.ehMarketplaceE2e.searchCount}`, evidence.ehMarketplaceE2e.markdownPath || "eh-e2e-marketplace-latest.md"],
    evidence.ehMementoStorageE2e && ["EH memento storage E2E", evidence.ehMementoStorageE2e.statusLabel, `global ${formatBooleanEvidence(evidence.ehMementoStorageE2e.globalStateStored, "通过", "缺失")} · workspace ${formatBooleanEvidence(evidence.ehMementoStorageE2e.workspaceStateStored, "通过", "缺失")} · sync ${formatBooleanEvidence(evidence.ehMementoStorageE2e.syncKeysStored, "通过", "缺失")} · third-party ${formatBooleanEvidence(evidence.ehMementoStorageE2e.thirdPartyExtensionBuiltinFalse && evidence.ehMementoStorageE2e.thirdPartyGlobalStateStored && evidence.ehMementoStorageE2e.thirdPartyWorkspaceStateStored && evidence.ehMementoStorageE2e.thirdPartySyncKeysStored, "通过", "缺失")} · legacy ${formatBooleanEvidence(!evidence.ehMementoStorageE2e.legacyStorageWritten, "未写入", "仍写入")}`, evidence.ehMementoStorageE2e.markdownPath || "eh-e2e-memento-storage-latest.md"],
    evidence.ehExtensionContextE2e && ["EH ExtensionContext E2E", evidence.ehExtensionContextE2e.statusLabel, `packageJSON ${formatBooleanEvidence(evidence.ehExtensionContextE2e.packageJsonPreserved, "通过", "缺失")} · uri ${formatBooleanEvidence(evidence.ehExtensionContextE2e.extensionUriFile, "通过", "缺失")} · path ${formatBooleanEvidence(evidence.ehExtensionContextE2e.extensionPathMatches && evidence.ehExtensionContextE2e.asAbsolutePathWorks, "通过", "缺失")} · storage/log ${formatBooleanEvidence(evidence.ehExtensionContextE2e.storageUriFile && evidence.ehExtensionContextE2e.globalStorageUriFile && evidence.ehExtensionContextE2e.logUriFile, "通过", "缺失")} · third-party ${formatBooleanEvidence(evidence.ehExtensionContextE2e.thirdPartyExtensionBuiltinFalse, "通过", "缺失")}`, evidence.ehExtensionContextE2e.markdownPath || "eh-e2e-extension-context-latest.md"],
    evidence.ehImplicitActivationE2e && ["EH implicit activation E2E", evidence.ehImplicitActivationE2e.statusLabel, `event ${evidence.ehImplicitActivationE2e.activationEvent || "missing"} · generated ${formatBooleanEvidence(evidence.ehImplicitActivationE2e.implicitOnCommandGenerated, "通过", "缺失")} · indexed ${formatBooleanEvidence(evidence.ehImplicitActivationE2e.activationEventsByEventHasExtension, "通过", "缺失")} · activated ${formatBooleanEvidence(evidence.ehImplicitActivationE2e.activatedByImplicitEvent, "通过", "缺失")}`, evidence.ehImplicitActivationE2e.markdownPath || "eh-e2e-implicit-activation-latest.md"],
    evidence.ehDependencyLoopE2e && ["EH dependency loop E2E", evidence.ehDependencyLoopE2e.statusLabel, `removed ${evidence.ehDependencyLoopE2e.removedDueToLooping.join(", ") || "none"} · scan ${formatBooleanEvidence(evidence.ehDependencyLoopE2e.loopExtensionsAbsentFromAllExtensions && evidence.ehDependencyLoopE2e.loopExtensionsAbsentFromById, "通过", "缺失")} · InitData ${formatBooleanEvidence(evidence.ehDependencyLoopE2e.initDataLoopExtensionsAbsent && evidence.ehDependencyLoopE2e.initDataMyExtensionsLoopAbsent, "通过", "缺失")} · healthy ${formatBooleanEvidence(evidence.ehDependencyLoopE2e.healthyActivated, "已激活", "未激活")}`, evidence.ehDependencyLoopE2e.markdownPath || "eh-e2e-dependency-loop-latest.md"],
    evidence.ehSearchProviderE2e && ["EH SearchProvider E2E", evidence.ehSearchProviderE2e.statusLabel, `text ${evidence.ehSearchProviderE2e.textSearchEngine || "missing"}/${evidence.ehSearchProviderE2e.textSearchProvider || "missing"} ${formatBooleanEvidence(evidence.ehSearchProviderE2e.textProviderCalled, "已调用", "未调用")} · file ${evidence.ehSearchProviderE2e.fileSearchEngine || "missing"} ${formatBooleanEvidence(evidence.ehSearchProviderE2e.fileProviderCalled, "已调用", "未调用")} · fallback ${formatBooleanEvidence(evidence.ehSearchProviderE2e.fallbackBypassed, "已旁路", "仍使用")} · provider errors ${evidence.ehSearchProviderE2e.providerErrors}`, evidence.ehSearchProviderE2e.markdownPath || "eh-e2e-search-provider-latest.md"],
    evidence.ehProfileContentHandlerE2e && ["EH ProfileContentHandler E2E", evidence.ehProfileContentHandlerE2e.statusLabel, `event ${evidence.ehProfileContentHandlerE2e.activationEvent || "missing"} ${formatBooleanEvidence(evidence.ehProfileContentHandlerE2e.activatedByOnProfileHandler, "已激活", "缺失")} · handler ${evidence.ehProfileContentHandlerE2e.handlerId || "missing"} ${formatBooleanEvidence(evidence.ehProfileContentHandlerE2e.handlerRegistered && evidence.ehProfileContentHandlerE2e.handlerMetadataMatched, "已注册", "缺失")} · read ${formatBooleanEvidence(evidence.ehProfileContentHandlerE2e.readProfileCalled && evidence.ehProfileContentHandlerE2e.readProfileReturnedTemplate, "通过", "缺失")} · save ${formatBooleanEvidence(evidence.ehProfileContentHandlerE2e.saveProfileCalled && evidence.ehProfileContentHandlerE2e.saveProfileReturnedResult, "通过", "缺失")} · cleanup ${formatBooleanEvidence(evidence.ehProfileContentHandlerE2e.cleanupAfterStop, "通过", "缺失")} · provider errors ${evidence.ehProfileContentHandlerE2e.providerErrors}`, evidence.ehProfileContentHandlerE2e.markdownPath || "eh-e2e-profile-content-handler-latest.md"],
    evidence.installedMcpDiscovery && ["Installed MCP discovery", evidence.installedMcpDiscovery.statusLabel, `persist ${formatBooleanEvidence(evidence.installedMcpDiscovery.installedMcpPersisted, "已持久化", "缺失")} · discovery ${formatBooleanEvidence(evidence.installedMcpDiscovery.installedDiscoveryRead, "已读取", "缺失")} · registry ${formatBooleanEvidence(evidence.installedMcpDiscovery.installedRegistryApplied, "已接入", "缺失")} · workspace filter ${formatBooleanEvidence(evidence.installedMcpDiscovery.workspaceDiscoveryFilteredInRegistryMode, "通过", "缺失")} · provider errors ${evidence.installedMcpDiscovery.providerErrors}`, evidence.installedMcpDiscovery.markdownPath || "installed-mcp-discovery-latest.md"],
    evidence.mcpGalleryManagement && ["MCP Gallery management", evidence.mcpGalleryManagement.statusLabel, `install ${formatBooleanEvidence(evidence.mcpGalleryManagement.galleryInstallReady, "通过", "缺失")} · workspace ${formatBooleanEvidence(evidence.mcpGalleryManagement.workspaceResourceWritten && evidence.mcpGalleryManagement.workspaceRegistryConsumed, "通过", "缺失")} · uninstall ${formatBooleanEvidence(evidence.mcpGalleryManagement.galleryUninstallReady, "通过", "缺失")} · lifecycle ${formatBooleanEvidence(evidence.mcpGalleryManagement.lifecycleEventsEmitted, "通过", "缺失")} · provider errors ${evidence.mcpGalleryManagement.providerErrors}`, evidence.mcpGalleryManagement.markdownPath || "mcp-gallery-management-latest.md"],
    evidence.ehMcpProviderBridge && ["EH MCP provider bridge", evidence.ehMcpProviderBridge.statusLabel, `collection ${formatBooleanEvidence(evidence.ehMcpProviderBridge.mainThreadMcpRegistered, "已注册", "缺失")} · definitions ${formatBooleanEvidence(evidence.ehMcpProviderBridge.definitionsPublishedToExtHost, "已同步", "缺失")} · delegate ${formatBooleanEvidence(evidence.ehMcpProviderBridge.delegateTransportStarted, "已启动", "缺失")} · redaction ${formatBooleanEvidence(evidence.ehMcpProviderBridge.secretRedactionVerified, "通过", "缺失")} · provider errors ${evidence.ehMcpProviderBridge.providerErrors}`, evidence.ehMcpProviderBridge.markdownPath || "eh-e2e-mcp-provider-latest.md"],
    evidence.extensionCompatibilityMatrix && ["扩展 Top N 兼容矩阵", evidence.extensionCompatibilityMatrix.statusLabel, `${evidence.extensionCompatibilityMatrix.sampled}/${evidence.extensionCompatibilityMatrix.top} 样本 · 阻断 ${evidence.extensionCompatibilityMatrix.blocked} · 降级 ${evidence.extensionCompatibilityMatrix.degraded}`, evidence.extensionCompatibilityMatrix.markdownPath || "extension-compatibility-matrix-latest.md"],
    evidence.extensionEnterpriseGate && ["扩展生态企业级门禁", evidence.extensionEnterpriseGate.statusLabel, `${evidence.extensionEnterpriseGate.passed}/${evidence.extensionEnterpriseGate.total} 通过 · ${evidence.extensionEnterpriseGate.failed} 阻断`, evidence.extensionEnterpriseGate.markdownPath || "extension-enterprise-gate-latest.md"],
    evidence.atPreflight && ["AT 发布候选预检", evidence.atPreflight.statusLabel, `${evidence.atPreflight.passed}/${evidence.atPreflight.total} 通过 · ${evidence.atPreflight.warning} 个警告 · ${evidence.atPreflight.artifacts} 个产物`, "at-release-candidate-preflight-latest.md"],
    evidence.packagingPreflight && ["Windows 打包预检", evidence.packagingPreflight.statusLabel, `${evidence.packagingPreflight.passed}/${evidence.packagingPreflight.total} 通过 · ${evidence.packagingPreflight.warning} 个警告`, "packaging-preflight-latest.md"],
  ].filter(Boolean)
  if (evidence.taskRuns) {
    rows.splice(8, 0, [
      "任务运行证据",
      evidence.taskRuns.statusLabel,
      `${evidence.taskRuns.passed}/${evidence.taskRuns.total} 通过 / 失败 ${evidence.taskRuns.failed} / 阻断 ${evidence.taskRuns.blocked}`,
      evidence.taskRuns.latest ? `最新 ${evidence.taskRuns.latest.name || evidence.taskRuns.latest.id || "-"} / ${evidence.taskRuns.latest.durationMs || 0}ms` : "-",
    ])
  }
  const auditRows = Array.isArray(report.runActionAudits) ? report.runActionAudits.map((item) =>
    `| ${escapeCell(item.title || item.actionId)} | ${formatRunActionStatus(item.status)} | ${escapeCell(item.runId || "-")} | ${item.durationMs || 0}ms | ${escapeCell(item.summary || "-")} |`,
  ) : []
  const gapRows = Array.isArray(report.gaps) ? report.gaps.map((item) =>
    `| ${escapeCell(item.title)} | ${escapeCell(formatGapSeverity(item.severity))} | ${escapeCell(formatGapStatus(item.status))} | ${escapeCell(item.reason)} | ${escapeCell(item.action)} |`,
  ) : []
  const arWarningRows = Array.isArray(evidence.arHealth?.warningReview) ? evidence.arHealth.warningReview.map((item) =>
    `| ${escapeCell(item.area)} | ${escapeCell(item.title)} | ${escapeCell(item.category)} | ${escapeCell(item.blockingLabel)} | ${escapeCell(item.nextAction)} |`,
  ) : []
  const taskRows = Array.isArray(evidence.taskRuns?.runs) ? evidence.taskRuns.runs.map((item) =>
    `| ${escapeCell(item.name || item.id || "-")} | ${escapeCell(formatTaskRunStatus(item.status))} | ${item.passedSteps}/${item.stepCount} | ${item.durationMs || 0}ms | ${formatRunMode(item.hasParallelSteps ? "parallel" : "sequence")} | ${item.maxDependencyDepth || 0} | ${item.problemDiagnostics || 0} |`,
  ) : []
  const taskStepRows = Array.isArray(evidence.taskRuns?.runs)
    ? evidence.taskRuns.runs.flatMap((run) => (Array.isArray(run.steps) ? run.steps : []).slice(0, 8).map((step) =>
      `| ${escapeCell(run.name || run.id || "-")} | ${escapeCell(step.name || step.id || "-")} | ${escapeCell(formatTaskRunStatus(step.status))} | ${step.exitCode === null ? "-" : step.exitCode} | ${step.durationMs || 0}ms | ${formatRunMode(step.runMode)} | ${step.dependencyDepth || 0} | ${step.commandLength || 0} / ${step.outputLength || 0} / ${step.errorLength || 0} |`,
    ))
    : []
  const qualityGateRows = Object.values(evidence.qualityGateSummary?.buckets || {}).map((bucket) =>
    `| ${escapeCell(bucket.label || bucket.id)} | ${escapeCell(formatTaskRunStatus(bucket.status))} | ${bucket.passed}/${bucket.total} | ${bucket.failed} | ${bucket.blocked} | ${escapeCell((bucket.commands || []).slice(0, 3).map((item) => item.command).join("；") || "-")} |`,
  )
  const failureClassRows = Array.isArray(evidence.failureClassification?.classifications)
    ? evidence.failureClassification.classifications.map((item) =>
      `| ${escapeCell(item.label)} | ${escapeCell(item.id)} | ${escapeCell(item.severity)} | ${escapeCell(item.detail)} |`,
    )
    : []
  const demo = evidence.demoTaskReport || null
  const demoRoleRows = demo?.available ? [
    ...demo.roleProfiles.map((item) =>
      `| Profile | ${escapeCell(item.id || item.label || "-")} | ${escapeCell(item.benefit || "-")} | ${escapeCell(item.noise || "-")} | ${escapeCell(item.recommendation || "-")} |`,
    ),
    ...demo.roleTrials.map((item) =>
      `| Trial | ${escapeCell(item.profileId || item.id || "-")} | ${escapeCell(item.benefit || "-")} | ${escapeCell(item.noise || "-")} | ${item.baselineMinutes ?? "-"} -> ${item.trialMinutes ?? "-"} 分钟 |`,
    ),
  ] : []
  const demoAcceptanceRows = demo?.available ? [
    `| T01-T08 覆盖 | ${escapeCell(demo.coveredTasks.join(", ") || "-")} | 缺失 ${escapeCell(demo.missingTasks.join(", ") || "无")} | ${escapeCell(demo.taskCount)} 条任务证据 |`,
    `| 质量门 | ${escapeCell(demo.qualityGate.status || "-")} | ${escapeCell(demo.qualityGate.summary || "-")} | focused / release evidence 复核 |`,
    `| 成本与复核 | ${formatUsd(demo.costReview.estimatedCostUsd)} ${escapeCell(demo.costReview.currency || "USD")} | 人工复核 ${demo.costReview.manualReviewMinutes || 0} 分钟 | 未定价请求 ${demo.costReview.unpricedRequests || 0} |`,
    `| 失败与回滚 | ${escapeCell(demo.failureReview.summary || "-")} | ${escapeCell(demo.rollbackRecommendation.action || "-")} | ${escapeCell(demo.rollbackRecommendation.reason || "-")} |`,
    `| 人工验收下一步 | ${escapeCell((demo.nextHumanAcceptance || []).join("；") || "-")} | Day 13-14 输入 | 三人试用反馈闭环 |`,
  ] : []
  const agentWorkbenchRows = Array.isArray(evidence.agentEvidenceWorkbench?.timeline)
    ? evidence.agentEvidenceWorkbench.timeline.map((item) =>
      `| ${escapeCell(item.stage)} | ${escapeCell(item.title)} | ${escapeCell(formatTaskRunStatus(item.status))} | ${escapeCell(item.summary)} | ${escapeCell((item.evidenceRefs || []).join(", "))} | ${escapeCell(item.nextAction)} |`,
    )
    : []
  const agentWorkbenchSurface = evidence.agentEvidenceWorkbench?.surface || {}
  const agentWorkbenchSurfaceRows = evidence.agentEvidenceWorkbench?.surface ? [
    `| SCM | ${escapeCell(agentWorkbenchSurface.scm?.providerLabel || "-")} | ${agentWorkbenchSurface.scm?.fileCount || 0} 文件 · 回滚 ${escapeCell(formatRollbackRisk(agentWorkbenchSurface.scm?.rollbackRisk))} | ${escapeCell((agentWorkbenchSurface.scm?.files || []).slice(0, 4).join(", ") || "-")} · commands ${escapeCell((agentWorkbenchSurface.scm?.commandIds || []).join(", ") || "-")} |`,
    `| Testing | ${escapeCell(formatTaskRunStatus(agentWorkbenchSurface.testing?.state))} | ${agentWorkbenchSurface.testing?.passed || 0}/${agentWorkbenchSurface.testing?.total || 0} 通过 · 失败 ${agentWorkbenchSurface.testing?.failed || 0} · 质量门 ${agentWorkbenchSurface.testing?.qualityGateFailures || 0} | ${escapeCell(agentWorkbenchSurface.testing?.latestTask || "-")} · rerun ${escapeCell(agentWorkbenchSurface.testing?.rerunCommandId || "-")} |`,
    `| Timeline | ${escapeCell(agentWorkbenchSurface.timeline?.source || "-")} | ${agentWorkbenchSurface.timeline?.itemCount || 0} 项 · 已阻断 ${agentWorkbenchSurface.timeline?.blocked || 0} · 需复核 ${agentWorkbenchSurface.timeline?.degraded || 0} · 缺失 ${agentWorkbenchSurface.timeline?.missing || 0} | commands ${escapeCell((agentWorkbenchSurface.timeline?.commandIds || []).join(", ") || "-")} · linked resources ${agentWorkbenchSurface.timeline?.linkedResourceCount || 0} |`,
    `| Progress | 进行中 | ${agentWorkbenchSurface.progress?.active || 0} 个待推进 · 已阻断 ${agentWorkbenchSurface.progress?.blocked || 0} | ${escapeCell((agentWorkbenchSurface.progress?.nextActions || []).slice(0, 2).join("；") || "-")} · cancel ${escapeCell(agentWorkbenchSurface.progress?.cancelCommandId || "-")} |`,
    `| Notification | ${agentWorkbenchSurface.notifications?.errors || 0} 错误 / ${agentWorkbenchSurface.notifications?.warnings || 0} 警告 | ${agentWorkbenchSurface.notifications?.total || 0} 条 | ${escapeCell((agentWorkbenchSurface.notifications?.messages || []).slice(0, 2).join("；") || "-")} · dismiss ${escapeCell(agentWorkbenchSurface.notifications?.dismissCommandId || "-")} |`,
    `| Evidence List | ${agentWorkbenchSurface.list?.total || 0} 项 | surfaces ${escapeCell((agentWorkbenchSurface.list?.surfaces || []).join(", ") || "-")} · status ${escapeCell((agentWorkbenchSurface.list?.statuses || []).join(", ") || "-")} | errors ${agentWorkbenchSurface.list?.errors || 0} · warnings ${agentWorkbenchSurface.list?.warnings || 0} |`,
    `| Evidence Detail | ${escapeCell(agentWorkbenchSurface.detail?.surface || "-")} | ${escapeCell(agentWorkbenchSurface.detail?.selectedId || "-")} | editor ${escapeCell(agentWorkbenchSurface.detail?.editorId || "-")} · uri ${escapeCell(agentWorkbenchSurface.detail?.resourceUri || "-")} |`,
    `| Evidence Export | JSON/Markdown | ${escapeCell(agentWorkbenchSurface.export?.artifactPath || "-")} | ${escapeCell(agentWorkbenchSurface.export?.jsonCommandId || "-")} · ${escapeCell(agentWorkbenchSurface.export?.markdownCommandId || "-")} |`,
  ] : []
  const agentWorkbenchReport = evidence.agentEvidenceWorkbench?.report || {}
  const roleProfileRows = Array.isArray(agentWorkbenchReport.roleProfiles?.trials)
    ? agentWorkbenchReport.roleProfiles.trials.map((item) =>
      `| ${escapeCell(item.taskId || item.assignmentId || "-")} | ${escapeCell(item.role || "-")} | ${escapeCell(item.profileId || "-")} | ${escapeCell(item.selectionReason || "-")} | ${escapeCell((item.permissionScope?.writePaths || []).join(", ") || "-")} | ${escapeCell((item.validationAdvice || []).join("；") || "-")} | ${escapeCell(item.benefit || "-")} | ${escapeCell(item.noise || "-")} | ${item.worthRuntimeIntegration ? "是" : "否"} |`,
    )
    : []
  const firstAgentRun = Array.isArray(agentWorkbenchReport.runs) ? agentWorkbenchReport.runs[0] : null
  const agentWorkbenchContractRows = evidence.agentEvidenceWorkbench?.report ? [
    `| Source | ${escapeCell(agentWorkbenchReport.source || "-")} | timestamp ${agentWorkbenchReport.timestamp || "-"} | ${escapeCell(agentWorkbenchReport.correlationId || "-")} |`,
    `| Workspace | ${escapeCell(agentWorkbenchReport.workspace?.root || "-")} | protected ${formatBooleanEvidence(agentWorkbenchReport.workspace?.protected, "是", "否")} · isolation ${escapeCell(agentWorkbenchReport.workspace?.isolation || "-")} | release evidence workspace metadata |`,
    `| Commands | ${Array.isArray(agentWorkbenchReport.commands) ? agentWorkbenchReport.commands.length : 0} | ${escapeCell((agentWorkbenchReport.commands || []).slice(0, 3).map((item) => item.command).join("；") || "-")} | status / exit code only, no output |`,
    `| Run State Schema | ${Array.isArray(agentWorkbenchReport.runStateSchema?.states) ? agentWorkbenchReport.runStateSchema.states.length : 0} states | ${escapeCell((agentWorkbenchReport.runStateSchema?.states || []).join(", ") || "-")} | finite MVP lifecycle |`,
    `| Runs | ${Array.isArray(agentWorkbenchReport.runs) ? agentWorkbenchReport.runs.length : 0} | ${escapeCell(firstAgentRun ? `${firstAgentRun.id} / ${firstAgentRun.state} / files ${firstAgentRun.diffSummary?.filesChanged || 0} / validations ${(firstAgentRun.validationCommands || []).length}` : "-")} | rollback ${escapeCell(firstAgentRun?.rollbackRecommendation?.action || "-")} · cost ${escapeCell(firstAgentRun?.costSummary?.placeholder ? "placeholder" : "recorded")} |`,
    `| Artifacts | ${Array.isArray(agentWorkbenchReport.artifacts) ? agentWorkbenchReport.artifacts.length : 0} | ${escapeCell((agentWorkbenchReport.artifacts || []).slice(0, 3).map((item) => item.path).join("；") || "-")} | local evidence paths |`,
    `| Failure Causes | ${Array.isArray(agentWorkbenchReport.failureCauses) ? agentWorkbenchReport.failureCauses.length : 0} | ${escapeCell((agentWorkbenchReport.failureCauses || []).slice(0, 3).map((item) => item.id).join("；") || "-")} | source / stage / severity mapped |`,
    `| Next Actions | ${Array.isArray(agentWorkbenchReport.nextActions) ? agentWorkbenchReport.nextActions.length : 0} | ${escapeCell((agentWorkbenchReport.nextActions || []).slice(0, 3).map((item) => item.label).join("；") || "-")} | command/menu/view surface ids |`,
    `| Role Profiles | ${agentWorkbenchReport.roleProfiles?.trialCount || 0} | ${escapeCell(agentWorkbenchReport.roleProfiles?.recommendation || "-")} | existing assignment/evidence projection |`,
  ] : []
  return [
    "# 发布验收证据链摘要",
    "",
    `- 状态: ${report.statusLabel || report.status || "-"}`,
    `- 就绪: ${report.ready ? "是" : "否"}`,
    `- 生成时间: ${new Date(report.createdAt || Date.now()).toISOString()}`,
    `- 证据: ${report.summary?.ready || 0}/${report.summary?.total || 0} 就绪，${report.summary?.available || 0} 项可用，${report.summary?.missing || 0} 项缺失`,
    `- Latest JSON: ${report.jsonPath || report.latestJsonPath || "-"}`,
    `- Latest Markdown: ${report.markdownPath || report.latestMarkdownPath || "-"}`,
    `- History JSON: ${report.historyJsonPath || "-"}`,
    `- History Markdown: ${report.historyMarkdownPath || "-"}`,
    "",
    "## 证据总览",
    "",
    "| 证据 | 状态 | 摘要 | 路径 / 备注 |",
    "| --- | --- | --- | --- |",
    ...rows.map((row) => `| ${escapeCell(row[0])} | ${escapeCell(row[1])} | ${escapeCell(row[2])} | ${escapeCell(row[3] || "-")} |`),
    "",
    "## 证据缺口与建议",
    "",
    "| 证据 | 严重度 | 状态 | 原因 | 建议动作 |",
    "| --- | --- | --- | --- | --- |",
    ...(gapRows.length ? gapRows : ["| - | - | 已就绪 | 未发现阻塞缺口 | 打开最新 Markdown 做人工复核 |"]),
    "",
    "## AR 警告复核",
    "",
    "| 范围 | 检查 | 分类 | 阻断策略 | 下一步 |",
    "| --- | --- | --- | --- | --- |",
    ...(arWarningRows.length ? arWarningRows : ["| - | - | - | 无警告 | - |"]),
    "",
    "## 最近控制台动作",
    "",
    "| 动作 | 状态 | Run ID | 耗时 | 摘要 |",
    "| --- | --- | --- | --- | --- |",
    ...(auditRows.length ? auditRows : ["| - | - | - | - | - |"]),
    "",
    "## 任务运行证据",
    "",
    "| 任务 | 状态 | 步骤 | 耗时 | 模式 | 最大依赖深度 | 问题诊断 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...(taskRows.length ? taskRows : ["| - | - | - | - | - | - | - |"]),
    "",
    "| 任务 | 步骤 | 状态 | 退出码 | 耗时 | 模式 | 深度 | command/output/error 长度 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...(taskStepRows.length ? taskStepRows : ["| - | - | - | - | - | - | - | - |"]),
    "",
    "## 质量门与失败复盘",
    "",
    "| 质量门 | 状态 | 通过 / 总数 | 失败 | 阻断 | 示例命令 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(qualityGateRows.length ? qualityGateRows : ["| - | - | - | - | - | - |"]),
    "",
    "| 分类 | ID | 严重度 | 用户可读说明 |",
    "| --- | --- | --- | --- |",
    ...(failureClassRows.length ? failureClassRows : ["| - | - | - | 未发现失败分类 |"]),
    "",
    "## Day 11-12 非玩具演示任务",
    "",
    "| 项 | 值 | 摘要 | 备注 |",
    "| --- | --- | --- | --- |",
    ...(demoAcceptanceRows.length ? demoAcceptanceRows : ["| - | - | - | - |"]),
    "",
    "| 类型 | Profile / Trial | 收益 | 噪音 | 建议 / 时间 |",
    "| --- | --- | --- | --- | --- |",
    ...(demoRoleRows.length ? demoRoleRows : ["| - | - | - | - | - |"]),
    "",
    "## Agent Evidence Workbench",
    "",
    "| 阶段 | 标题 | 状态 | 摘要 | 来源证据 | 下一步 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...(agentWorkbenchRows.length ? agentWorkbenchRows : ["| - | - | - | - | - | - |"]),
    "",
    "| Surface | 状态 / 来源 | 摘要 | 备注 / Action |",
    "| --- | --- | --- | --- |",
    ...(agentWorkbenchSurfaceRows.length ? agentWorkbenchSurfaceRows : ["| - | - | - | - |"]),
    "",
    "### Report Contract",
    "",
    "| Field | 值 | 摘要 | 备注 |",
    "| --- | --- | --- | --- |",
    ...(agentWorkbenchContractRows.length ? agentWorkbenchContractRows : ["| - | - | - | - |"]),
    "",
    "### Role Profile Trial",
    "",
    "| 子任务 | Role | Profile | 选择理由 | 写权限范围 | 验证建议 | 收益 | 噪音 | 建议接入 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...(roleProfileRows.length ? roleProfileRows : ["| - | - | - | - | - | - | - | - | - |"]),
    "",
    "## 验收说明",
    "",
    "- 本报告只汇总本地 latest/history 证据，不触发 Agent 执行、不上传、不发布、不创建 PR。",
    "- 发布前仍建议人工打开上述 Markdown/JSON，确认真实项目交互、UI 无重叠和质量门输出符合预期。",
  ].join("\n")
}

function summarizeArReport(report) {
  if (!report) return { available: false, ready: false, statusLabel: "暂无报告", passed: 0, total: 0 }
  return {
    available: true,
    ready: Number(report.summary?.failed || 0) === 0,
    status: report.status || "",
    statusLabel: report.statusLabel || report.status || "",
    passed: Number(report.summary?.passed || 0),
    warning: Number(report.summary?.warning || 0),
    failed: Number(report.summary?.failed || 0),
    total: Number(report.summary?.total || 0),
  }
}

function collectArWarningReview(arHealth = {}) {
  const reports = [
    ["provider", arHealth.provider],
    ["debug", arHealth.debug],
    ["extensions", arHealth.extensions],
    ["compatibility", arHealth.compatibility],
    ["goals", arHealth.goals],
    ["performance", arHealth.performance],
  ]
  const items = []
  for (const [area, report] of reports) {
    if (!report) continue
    const policyById = new Map((Array.isArray(report.warningPolicy) ? report.warningPolicy : [])
      .map((policy) => [policy.id, policy]))
    for (const check of Array.isArray(report.checks) ? report.checks : []) {
      if (check?.status !== "warning" && check?.status !== "failed") continue
      const policy = policyById.get(check.id) || {}
      const blocking = policy.blocking || { quick: false, full: false, strict: check.status === "failed" }
      items.push({
        area,
        id: check.id || "",
        title: check.title || check.id || "",
        status: check.status || "",
        category: check.warningCategory || policy.category || inferWarningCategory(area, check),
        severity: policy.severity || (check.status === "failed" ? "high" : "warning"),
        blocking,
        blockingLabel: formatBlockingPolicy(blocking),
        detail: check.detail || "",
        nextAction: check.nextAction || policy.nextAction || "",
      })
    }
  }
  return items
}

function inferWarningCategory(area, check = {}) {
  if (area === "debug") return "environment"
  if (area === "performance" || /budget|chunk/i.test(check.id || "")) return "budget"
  if (area === "compatibility") return "compatibility"
  if (area === "extensions") return "product-risk"
  return "product-risk"
}

function formatBlockingPolicy(blocking = {}) {
  const blocked = ["quick", "full", "strict"].filter((key) => blocking[key] === true)
  return blocked.length ? `阻断 ${blocked.join("/")}` : "仅记录"
}

function formatArHealthStatus(arHealth = {}) {
  const reports = [arHealth.provider, arHealth.debug, arHealth.extensions, arHealth.compatibility, arHealth.goals, arHealth.performance].filter(Boolean)
  if (!reports.length) return "暂无报告"
  const nonBlocking = reports.filter((report) => Number(report.summary?.failed || 0) === 0).length
  const warnings = reports.reduce((total, report) => total + Number(report.summary?.warning || 0), 0)
  return warnings > 0 ? `${nonBlocking}/${reports.length} 无阻断，${warnings} 个警告` : `${nonBlocking}/${reports.length} 无阻断`
}

function isArHealthReleaseReady(arHealth = {}) {
  const reports = [arHealth.provider, arHealth.debug, arHealth.extensions, arHealth.compatibility, arHealth.goals, arHealth.performance]
  return reports.every((report) => report && Number(report.summary?.failed || 0) === 0)
}

function formatArHealthSummary(arHealth = {}) {
  const items = [arHealth.provider, arHealth.debug, arHealth.extensions, arHealth.compatibility, arHealth.goals, arHealth.performance]
    .filter((item) => item && item.available)
  if (!items.length) return "暂无报告"
  return items.map((item) => `${item.passed}/${item.total}`).join(" · ")
}

function formatRunActionStatus(status) {
  if (status === "started") return "已开始"
  if (status === "success") return "成功"
  if (status === "error") return "失败"
  return status || "未知"
}

function formatTaskRunStatus(status) {
  if (status === "passed") return "通过"
  if (status === "failed") return "失败"
  if (status === "blocked") return "已阻断"
  if (status === "running") return "运行中"
  if (status === "skipped") return "已跳过"
  if (status === "ready") return "就绪"
  if (status === "missing") return "缺失"
  if (status === "degraded") return "需复核"
  if (status === "warning") return "警告"
  if (status === "not_run") return "未运行"
  return status || "未知"
}

function formatRunMode(mode) {
  return mode === "parallel" ? "并行" : "串行"
}

function formatBooleanEvidence(value, trueLabel, falseLabel) {
  return value ? trueLabel : falseLabel
}

function formatGapSeverity(severity) {
  if (severity === "high") return "高"
  if (severity === "medium") return "中"
  if (severity === "low") return "低"
  if (severity === "info") return "信息"
  return severity || "未知"
}

function formatGapStatus(status) {
  if (status === "missing") return "缺失"
  if (status === "not_ready") return "未就绪"
  return status || "未知"
}

function formatUsd(value) {
  return `$${Number(value || 0).toFixed(6)}`
}

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function escapeCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

module.exports = {
  buildReleaseEvidenceSummary,
  buildQualityGateSummary,
  collectEvidenceRuns,
  defaultReleaseEvidenceReportDir,
  listReleaseEvidenceSummaries,
  readLatestReleaseEvidenceSummary,
  releaseEvidencePaths,
  saveReleaseEvidenceSummary,
  summarizeEnterpriseDocAudit,
  summarizeManualRealUiEvidence,
  toReleaseEvidenceMarkdown,
}
