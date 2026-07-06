const { summarizeCommandAuthorization } = require("./commandAuthorization")
const { validatePatchPermissions } = require("./permissionPolicy")
const fs = require("node:fs")
const path = require("node:path")
const { defaultReadinessReportDir } = require("./readiness")

function defaultSandboxSecurityEvidenceReportDir() {
  return defaultReadinessReportDir()
}

function sandboxSecurityEvidencePaths(reportDir = defaultSandboxSecurityEvidenceReportDir()) {
  const resolved = reportDir || defaultSandboxSecurityEvidenceReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "sandbox-security-evidence-latest.json"),
    latestMarkdownPath: path.join(resolved, "sandbox-security-evidence-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function readJsonSafe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeStatus(value, fallback = "unknown") {
  return String(value || fallback).trim().toLowerCase()
}

function hasSandboxEvidence(run) {
  if (!run || typeof run !== "object") return false
  if (Array.isArray(run.assignments) && run.assignments.some((item) => item?.workspace)) return true
  if (run.permissionRequest && typeof run.permissionRequest === "object") return true
  if (Array.isArray(run.qualityGateCommands) && run.qualityGateCommands.length > 0) return true
  if (run.integrationDecision?.qualityGate) return true
  if (run.integrationDecision?.applySnapshot || run.integrationDecision?.rollbackResult) return true
  return false
}

function latestRunWithSandboxEvidence(input) {
  const runs = Array.isArray(input) ? input : input && typeof input === "object" ? [input] : []
  return runs
    .filter(hasSandboxEvidence)
    .sort((a, b) => toFiniteNumber(b.updatedAt || b.createdAt) - toFiniteNumber(a.updatedAt || a.createdAt))[0] || null
}

function countBy(values) {
  return values.reduce((counts, value) => {
    const key = String(value || "unknown")
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
}

function summarizeQualityGate(run) {
  const gate = run?.integrationDecision?.qualityGate || null
  const commandResults = Array.isArray(gate?.commandResults) ? gate.commandResults : []
  const failedResults = commandResults.filter((item) => {
    if (!item || typeof item !== "object") return false
    if (item.timedOut === true) return true
    if (Number.isFinite(Number(item.exitCode))) return Number(item.exitCode) !== 0
    return normalizeStatus(item.status, "passed") === "failed"
  })
  return {
    status: gate ? normalizeStatus(gate.status, "unknown") : "not_run",
    commands: commandResults.length || (Array.isArray(run?.qualityGateCommands) ? run.qualityGateCommands.length : 0),
    failures: failedResults.length || (normalizeStatus(gate?.status) === "failed" ? 1 : 0),
  }
}

function rollbackAvailable(run) {
  const decision = run?.integrationDecision || {}
  if (decision.rollbackResult?.ok === true || Array.isArray(decision.rollbackResult?.filesChanged)) return true
  if (decision.applySnapshot) return true
  if (run?.realWorkspaceTrial?.rollbackAvailable === true) return true
  return false
}

function sanitizeCommandResult(result = {}) {
  return {
    command: String(result.command || ""),
    exitCode: Number.isFinite(Number(result.exitCode)) ? Number(result.exitCode) : null,
    status: result.status ? String(result.status) : undefined,
    timedOut: result.timedOut === true,
    durationMs: Number.isFinite(Number(result.durationMs)) ? Number(result.durationMs) : undefined,
  }
}

function sanitizeSandboxSecuritySourceRun(run = {}) {
  const decision = run.integrationDecision || {}
  const permission = run.permissionRequest || null
  const qualityGate = decision.qualityGate || null
  return {
    id: String(run.id || ""),
    status: String(run.status || ""),
    createdAt: Number.isFinite(Number(run.createdAt)) ? Number(run.createdAt) : null,
    updatedAt: Number.isFinite(Number(run.updatedAt)) ? Number(run.updatedAt) : null,
    visibleMode: String(run.visibleMode || ""),
    executionStrategy: String(run.executionStrategy || ""),
    strategyReason: String(run.strategyReason || ""),
    strategySignals: run.strategySignals && typeof run.strategySignals === "object"
      ? {
        risk: run.strategySignals.risk || "",
        complexity: run.strategySignals.complexity || "",
        scope: run.strategySignals.scope || "",
      }
      : {},
    assignments: Array.isArray(run.assignments)
      ? run.assignments.map((assignment) => ({
        id: String(assignment?.id || ""),
        phaseId: String(assignment?.phaseId || ""),
        role: String(assignment?.role || ""),
        status: String(assignment?.status || ""),
        lockedFiles: Array.isArray(assignment?.lockedFiles) ? assignment.lockedFiles.map(String) : [],
        workspace: assignment?.workspace && typeof assignment.workspace === "object"
          ? {
            isolation: String(assignment.workspace.isolation || ""),
            status: String(assignment.workspace.status || ""),
          }
          : undefined,
      }))
      : [],
    permissionRequest: permission ? {
      id: String(permission.id || ""),
      status: String(permission.status || ""),
      risk: String(permission.risk || ""),
      writePaths: Array.isArray(permission.writePaths) ? permission.writePaths.map(String) : [],
      commandAllowlist: Array.isArray(permission.commandAllowlist) ? permission.commandAllowlist.map(String) : [],
      network: permission.network === true,
      install: permission.install === true,
      externalTool: permission.externalTool === true,
      destructive: permission.destructive === true,
    } : null,
    qualityGateCommands: Array.isArray(run.qualityGateCommands) ? run.qualityGateCommands.map(String) : [],
    integrationDecision: {
      id: String(decision.id || ""),
      status: String(decision.status || ""),
      userDecision: String(decision.userDecision || ""),
      proposedPatch: {
        filesChanged: Array.isArray(decision.proposedPatch?.filesChanged)
          ? decision.proposedPatch.filesChanged.map(String)
          : [],
      },
      applySnapshot: decision.applySnapshot ? { id: String(decision.applySnapshot.id || "snapshot") } : null,
      applyResult: decision.applyResult ? {
        status: String(decision.applyResult.status || ""),
        filesChanged: Array.isArray(decision.applyResult.filesChanged) ? decision.applyResult.filesChanged.map(String) : [],
        appliedAt: Number.isFinite(Number(decision.applyResult.appliedAt)) ? Number(decision.applyResult.appliedAt) : null,
      } : null,
      rollbackResult: decision.rollbackResult ? {
        ok: decision.rollbackResult.ok === true,
        status: String(decision.rollbackResult.status || ""),
        filesChanged: Array.isArray(decision.rollbackResult.filesChanged) ? decision.rollbackResult.filesChanged.map(String) : [],
      } : null,
      qualityGate: qualityGate ? {
        status: String(qualityGate.status || ""),
        commandResults: Array.isArray(qualityGate.commandResults)
          ? qualityGate.commandResults.map(sanitizeCommandResult)
          : [],
      } : null,
    },
    realWorkspaceTrial: run.realWorkspaceTrial && typeof run.realWorkspaceTrial === "object"
      ? {
        allowedPaths: Array.isArray(run.realWorkspaceTrial.allowedPaths) ? run.realWorkspaceTrial.allowedPaths.map(String) : [],
        qualityGateCommands: Array.isArray(run.realWorkspaceTrial.qualityGateCommands) ? run.realWorkspaceTrial.qualityGateCommands.map(String) : [],
        mainWorkspaceUntouchedBeforeAccept: run.realWorkspaceTrial.mainWorkspaceUntouchedBeforeAccept === true,
        rollbackAvailable: run.realWorkspaceTrial.rollbackAvailable === true,
        filesChanged: Array.isArray(run.realWorkspaceTrial.filesChanged) ? run.realWorkspaceTrial.filesChanged.map(String) : [],
      }
      : undefined,
  }
}

function summarizeSandboxSecurityEvidence(input) {
  const run = latestRunWithSandboxEvidence(input)
  if (!run) {
    return {
      available: false,
      ready: false,
      status: "missing",
      statusLabel: "暂无沙箱安全证据",
      runId: "",
      updatedAt: null,
      assignmentCount: 0,
      isolatedAssignments: 0,
      mainWorkspaceAssignments: 0,
      workspaceIsolationTypes: {},
      permissionStatus: "missing",
      permissionRisk: "",
      permissionApproved: false,
      permissionRejected: false,
      writePathCount: 0,
      commandAllowlistCount: 0,
      networkAllowed: false,
      installAllowed: false,
      externalToolAllowed: false,
      destructiveAllowed: false,
      qualityGateStatus: "not_run",
      qualityGateCommands: 0,
      qualityGateFailures: 0,
      commandAuthorizationBlocked: 0,
      commandAuthorizationNeedsPermission: 0,
      patchPermissionViolations: 0,
      rollbackAvailable: false,
      violations: [{ id: "sandbox_security_missing", severity: "high" }],
    }
  }

  const assignments = Array.isArray(run.assignments) ? run.assignments : []
  const isolationTypes = assignments.map((assignment) => assignment?.workspace?.isolation || "")
    .filter(Boolean)
  const workspaceIsolationTypes = countBy(isolationTypes)
  const mainWorkspaceAssignments = isolationTypes.filter((type) => type === "main").length
  const isolatedAssignments = isolationTypes.filter((type) => type && type !== "main").length
  const permission = run.permissionRequest || null
  const permissionStatus = normalizeStatus(permission?.status, permission ? "unknown" : "missing")
  const qualityGate = summarizeQualityGate(run)
  const commandAuthorization = summarizeCommandAuthorization(run, run.qualityGateCommands || [])
  const patchValidation = validatePatchPermissions(run, run.integrationDecision?.proposedPatch?.filesChanged || [])
  const violations = []

  if (mainWorkspaceAssignments > 0) violations.push({ id: "main_workspace_assignment", severity: "high" })
  if (permissionStatus === "rejected") violations.push({ id: "permission_rejected", severity: "high" })
  if (permissionStatus === "approved" && !patchValidation.ok) violations.push({ id: "patch_permission_violation", severity: "high" })
  if (qualityGate.status === "failed" || qualityGate.failures > 0) violations.push({ id: "quality_gate_failed", severity: "high" })
  if (commandAuthorization.blocked > 0) violations.push({ id: "command_authorization_blocked", severity: "high" })

  const available = true
  const ready = violations.length === 0 &&
    isolatedAssignments > 0 &&
    permissionStatus !== "rejected" &&
    qualityGate.status !== "failed"

  return {
    available,
    ready,
    status: ready ? "ready" : "blocked",
    statusLabel: ready ? "沙箱安全证据已就绪" : "沙箱安全证据需处理",
    runId: String(run.id || ""),
    updatedAt: toFiniteNumber(run.updatedAt || run.createdAt, null),
    assignmentCount: assignments.length,
    isolatedAssignments,
    mainWorkspaceAssignments,
    workspaceIsolationTypes,
    permissionStatus,
    permissionRisk: String(permission?.risk || ""),
    permissionApproved: permissionStatus === "approved",
    permissionRejected: permissionStatus === "rejected",
    writePathCount: Array.isArray(permission?.writePaths) ? permission.writePaths.length : 0,
    commandAllowlistCount: Array.isArray(permission?.commandAllowlist) ? permission.commandAllowlist.length : 0,
    networkAllowed: permission?.network === true,
    installAllowed: permission?.install === true,
    externalToolAllowed: permission?.externalTool === true,
    destructiveAllowed: permission?.destructive === true,
    qualityGateStatus: qualityGate.status,
    qualityGateCommands: qualityGate.commands,
    qualityGateFailures: qualityGate.failures,
    commandAuthorizationBlocked: commandAuthorization.blocked,
    commandAuthorizationNeedsPermission: commandAuthorization.needsPermission,
    patchPermissionViolations: patchValidation.ok ? 0 : patchValidation.violations.length,
    rollbackAvailable: rollbackAvailable(run),
    violations,
  }
}

function toMarkdown(report) {
  const checks = [
    ["隔离 workspace", `${report.isolatedAssignments}/${report.assignmentCount}`, report.isolatedAssignments > 0 && report.mainWorkspaceAssignments === 0],
    ["权限审批", report.permissionStatus, report.permissionStatus === "approved"],
    ["质量门", `${report.qualityGateStatus} (${report.qualityGateFailures} failed)`, report.qualityGateStatus !== "failed" && report.qualityGateFailures === 0],
    ["命令授权", `${report.commandAuthorizationBlocked} blocked`, report.commandAuthorizationBlocked === 0],
    ["路径越界", `${report.patchPermissionViolations} violations`, report.patchPermissionViolations === 0],
    ["回滚能力", report.rollbackAvailable ? "available" : "missing", report.rollbackAvailable],
  ]
  const rows = checks.map(([name, detail, passed]) =>
    `| ${name} | ${passed ? "passed" : "failed"} | ${detail} |`,
  )
  const violationRows = (report.violations || []).map((item) =>
    `| ${item.id} | ${item.severity || "high"} |`,
  )
  return [
    "# 沙箱安全证据",
    "",
    `- 状态: ${report.statusLabel || report.status}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Run: ${report.runId || "-"}`,
    `- Created At: ${new Date(report.createdAt || report.updatedAt || Date.now()).toISOString()}`,
    "",
    "| 检查 | 状态 | 摘要 |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## 违规项",
    "",
    "| ID | 严重度 |",
    "| --- | --- |",
    ...(violationRows.length ? violationRows : ["| - | - |"]),
    "",
    "## 边界",
    "",
    "- 只保存沙箱、权限、质量门、命令授权和回滚元数据。",
    "- 不保存用户 prompt、补丁正文、命令 stdout/stderr 或文件内容。",
  ].join("\n")
}

function saveSandboxSecurityEvidence(reportOrRun, options = {}) {
  const report = reportOrRun?.reportKind === "sandbox-security-evidence"
    ? reportOrRun
    : {
      reportKind: "sandbox-security-evidence",
      createdAt: Date.now(),
      ...summarizeSandboxSecurityEvidence(Array.isArray(reportOrRun) ? reportOrRun : [reportOrRun]),
    }
  const paths = sandboxSecurityEvidencePaths(options.reportDir)
  fs.mkdirSync(paths.reportDir, { recursive: true })
  fs.mkdirSync(paths.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJsonPath = path.join(paths.historyDir, `sandbox-security-evidence-${stamp}.json`)
  const historyMarkdownPath = path.join(paths.historyDir, `sandbox-security-evidence-${stamp}.md`)
  const latestPayload = {
    ...report,
    jsonPath: paths.latestJsonPath,
    markdownPath: paths.latestMarkdownPath,
    historyJsonPath,
    historyMarkdownPath,
  }
  const historyPayload = {
    ...latestPayload,
    jsonPath: historyJsonPath,
    markdownPath: historyMarkdownPath,
  }
  const markdown = report.markdown || toMarkdown(latestPayload)
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(latestPayload, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${markdown}\n`, "utf8")
  fs.writeFileSync(historyJsonPath, `${JSON.stringify(historyPayload, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMarkdownPath, `${markdown}\n`, "utf8")
  return {
    report: latestPayload,
    markdown,
    jsonPath: paths.latestJsonPath,
    markdownPath: paths.latestMarkdownPath,
    historyJsonPath,
    historyMarkdownPath,
  }
}

function readLatestSandboxSecurityEvidence(options = {}) {
  const paths = sandboxSecurityEvidencePaths(options.reportDir)
  const report = readJsonSafe(paths.latestJsonPath)
  const markdown = fs.existsSync(paths.latestMarkdownPath) ? fs.readFileSync(paths.latestMarkdownPath, "utf8") : ""
  return {
    report,
    markdown,
    jsonPath: report ? paths.latestJsonPath : "",
    markdownPath: markdown ? paths.latestMarkdownPath : "",
  }
}

module.exports = {
  defaultSandboxSecurityEvidenceReportDir,
  latestRunWithSandboxEvidence,
  readLatestSandboxSecurityEvidence,
  sanitizeSandboxSecuritySourceRun,
  sandboxSecurityEvidencePaths,
  saveSandboxSecurityEvidence,
  summarizeSandboxSecurityEvidence,
  toMarkdown,
}
