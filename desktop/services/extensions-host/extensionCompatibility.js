const fs = require("node:fs")
const path = require("node:path")
const { defaultReadinessReportDir } = require("../agentLoop/readiness")
const { getExtensionId } = require("./extensionScanner")

const CONTRIBUTION_SUPPORT = {
  commands: "supported",
  configuration: "supported",
  configurationDefaults: "supported",
  debuggers: "partial",
  grammars: "partial",
  iconThemes: "supported",
  keybindings: "supported",
  languages: "supported",
  menus: "partial",
  snippets: "partial",
  taskDefinitions: "partial",
  themes: "unsupported",
  views: "supported",
  viewsContainers: "supported",
  webviews: "unsupported",
}

function listContributionPoints(contributes = {}) {
  if (!contributes || typeof contributes !== "object" || Array.isArray(contributes)) return []
  return Object.entries(contributes)
    .filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0
      if (value && typeof value === "object") return Object.keys(value).length > 0
      return Boolean(value)
    })
    .map(([point]) => point)
    .sort()
}

function runtimeErrorsFor(extensionId, activationReport = {}) {
  const runtimeErrors = Array.isArray(activationReport.runtimeErrors) ? activationReport.runtimeErrors : []
  const lower = String(extensionId || "").toLowerCase()
  return runtimeErrors.filter((error) => String(error.extensionId || error.id || "").toLowerCase() === lower)
}

function evaluateExtensionCompatibility(extension = {}, options = {}) {
  const id = getExtensionId(extension) || extension.id || ""
  const contributionPoints = listContributionPoints(extension.contributes)
  const unsupportedContributionPoints = contributionPoints.filter((point) => (CONTRIBUTION_SUPPORT[point] || "unsupported") === "unsupported")
  const partialContributionPoints = contributionPoints.filter((point) => CONTRIBUTION_SUPPORT[point] === "partial")
  const supportedContributionPoints = contributionPoints.filter((point) => CONTRIBUTION_SUPPORT[point] === "supported")
  const runtimeErrors = runtimeErrorsFor(id, options.activationReport)
  const blockers = []
  const warnings = []

  for (const error of runtimeErrors) {
    blockers.push({ id: "runtime_error", message: error.message || String(error.error || "runtime error") })
  }
  if (unsupportedContributionPoints.length > 0) {
    warnings.push({
      id: "unsupported_contribution_points",
      message: "Extension uses contribution points that Codek does not fully support yet.",
      values: unsupportedContributionPoints,
    })
  }
  if (partialContributionPoints.length > 0) {
    warnings.push({
      id: "partial_contribution_points",
      message: "Extension uses contribution points that are implemented with partial VS Code compatibility.",
      values: partialContributionPoints,
    })
  }
  if (Array.isArray(extension.enabledApiProposals) && extension.enabledApiProposals.length > 0) {
    warnings.push({
      id: "enabled_api_proposals",
      message: "Extension requests proposed VS Code APIs.",
      values: extension.enabledApiProposals,
    })
  }

  const status = blockers.length > 0
    ? "blocked"
      : unsupportedContributionPoints.length > 0 || partialContributionPoints.length > 0 || warnings.length > 0
        ? "degraded"
      : extension.isBuiltin === true || extension.builtin === true
        ? "native"
        : "compatible"

  return {
    id,
    displayName: extension.displayName || extension.name || id,
    status,
    contributionPoints,
    supportedContributionPoints,
    partialContributionPoints,
    unsupportedContributionPoints,
    blockers,
    warnings,
    extensionKind: Array.isArray(extension.extensionKind) ? extension.extensionKind : [],
    engines: extension.engines || {},
  }
}

function buildExtensionsCompatibilityReport(input = {}) {
  const extensions = Array.isArray(input.extensions) ? input.extensions : []
  const results = extensions.map((extension) => evaluateExtensionCompatibility(extension, {
    activationReport: input.activationReport,
  }))
  const summary = {
    total: results.length,
    native: results.filter((item) => item.status === "native").length,
    compatible: results.filter((item) => item.status === "compatible").length,
    degraded: results.filter((item) => item.status === "degraded").length,
    blocked: results.filter((item) => item.status === "blocked").length,
  }
  return {
    reportKind: "extension-compatibility-report",
    createdAt: Number(input.createdAt || Date.now()),
    ready: summary.blocked === 0,
    status: summary.blocked > 0 ? "blocked" : summary.degraded > 0 ? "degraded" : "ready",
    summary,
    supportPolicy: CONTRIBUTION_SUPPORT,
    extensions: results,
  }
}

function compatibilityReportPaths(reportDir = defaultReadinessReportDir()) {
  const resolved = reportDir || defaultReadinessReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "extension-compatibility-latest.json"),
    latestMarkdownPath: path.join(resolved, "extension-compatibility-latest.md"),
  }
}

function toExtensionCompatibilityMarkdown(report) {
  const rows = (report.extensions || []).map((extension) =>
    `| ${extension.id} | ${extension.status} | ${extension.unsupportedContributionPoints.join(", ") || "-"} | ${extension.blockers.map((item) => item.message).join(", ") || "-"} |`,
  )
  return [
    "# Extension Compatibility Report",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Status: ${report.status}`,
    `- Total: ${report.summary?.total || 0}`,
    `- Blocked: ${report.summary?.blocked || 0}`,
    `- Degraded: ${report.summary?.degraded || 0}`,
    "",
    "| Extension | Status | Unsupported Contributions | Blockers |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

function saveExtensionCompatibilityReport(report, options = {}) {
  const paths = compatibilityReportPaths(options.reportDir)
  fs.mkdirSync(paths.reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${toExtensionCompatibilityMarkdown(withPaths)}\n`, "utf8")
  return { ...paths, report: withPaths }
}

function readLatestExtensionCompatibilityReport(options = {}) {
  const paths = compatibilityReportPaths(options.reportDir)
  if (!fs.existsSync(paths.latestJsonPath)) return { report: null, ...paths }
  return { report: JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8")), ...paths }
}

module.exports = {
  CONTRIBUTION_SUPPORT,
  buildExtensionsCompatibilityReport,
  compatibilityReportPaths,
  evaluateExtensionCompatibility,
  listContributionPoints,
  readLatestExtensionCompatibilityReport,
  saveExtensionCompatibilityReport,
  toExtensionCompatibilityMarkdown,
}
