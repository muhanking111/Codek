#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv = []) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const queriesArg = argv.find((arg) => arg.startsWith("--queries="))
  return {
    noWrite: argv.includes("--no-write"),
    noNetwork: argv.includes("--no-network"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
    queries: queriesArg
      ? queriesArg.slice("--queries=".length).split(",").map((item) => item.trim()).filter(Boolean)
      : ["python", "java", "eslint", "prettier", "rust-analyzer", "clangd"],
  }
}

function summarizeGitStatus(raw = "") {
  const lines = String(raw || "").split(/\r?\n/).filter(Boolean)
  const summary = {
    dirty: lines.length > 0,
    total: lines.length,
    modified: 0,
    deleted: 0,
    untracked: 0,
    renamed: 0,
  }
  for (const line of lines) {
    if (line.startsWith("??")) summary.untracked += 1
    else if (/R/.test(line.slice(0, 2))) summary.renamed += 1
    else if (/D/.test(line.slice(0, 2))) summary.deleted += 1
    else if (/M/.test(line.slice(0, 2))) summary.modified += 1
  }
  return summary
}

function readGitSnapshot() {
  const branch = spawnSync("git", ["branch", "--show-current"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  })
  const status = spawnSync("git", ["status", "--short"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  })
  return {
    branch: String(branch.stdout || "").trim() || "unknown",
    gitStatus: summarizeGitStatus(status.stdout || ""),
  }
}

function collectDependencySnapshot() {
  const managerDir = path.join(root, "desktop", "services", "extensions-host")
  const packages = ["extract-zip", "@vscode/vsce", "yauzl"]
  const snapshot = {}
  for (const name of packages) {
    try {
      snapshot[name] = {
        available: true,
        resolvedPath: require.resolve(name, { paths: [managerDir] }),
      }
    } catch {
      snapshot[name] = { available: false, resolvedPath: "" }
    }
  }
  return snapshot
}

function collectMainThreadProxySnapshot() {
  const dir = path.join(root, "desktop", "services", "extensions-host", "mainThread")
  const proxies = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => /^mainThread.*\.js$/i.test(name)).sort()
    : []
  return { count: proxies.length, proxies }
}

function collectCapabilities() {
  const extMgr = require("../desktop/services/extensions-host/extensionManager")
  return {
    marketplaceDetails: typeof extMgr.getExtensionDetails === "function",
    marketplaceDetailsPayload: typeof extMgr.getExtensionDetailsPayload === "function",
    marketplaceReadme: typeof extMgr.getMarketplaceReadme === "function" || typeof extMgr.getExtensionReadme === "function",
    marketplaceVersions: typeof extMgr.getMarketplaceVersions === "function" || typeof extMgr.getExtensionVersions === "function",
    installPlan: typeof extMgr.buildMarketplaceInstallPlan === "function",
    compatibilityReport: typeof extMgr.buildInstalledCompatibilityReport === "function",
    installState: typeof extMgr.listExtensionInstallStates === "function",
    auditLog: typeof extMgr.readExtensionAuditLog === "function",
    rollback: typeof extMgr.rollbackExtension === "function",
  }
}

function buildExtensionInventory(installed = []) {
  return {
    total: installed.length,
    builtin: installed.filter((extension) => extension.isBuiltin !== false && extension.builtin !== false).length,
    userInstalled: installed.filter((extension) => extension.isBuiltin === false || extension.builtin === false).length,
    enabled: installed.filter((extension) => extension.enabled !== false).length,
  }
}

function makeCheck(id, title, status, detail, nextAction = "") {
  return { id, title, status, detail, nextAction }
}

function summarizeChecks(checks) {
  return {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    warning: checks.filter((check) => check.status === "warning").length,
    failed: checks.filter((check) => check.status === "failed").length,
  }
}

function buildExtensionBaselineReport(input = {}) {
  const installed = Array.isArray(input.installed) ? input.installed : []
  const marketplaceSamples = Array.isArray(input.marketplaceSamples) ? input.marketplaceSamples : []
  const dependencySnapshot = input.dependencySnapshot || {}
  const mainThreadProxySnapshot = input.mainThreadProxySnapshot || { count: 0, proxies: [] }
  const capabilities = input.capabilities || {}
  const extensionInventory = buildExtensionInventory(installed)
  const marketplaceReady = marketplaceSamples.length > 0 && marketplaceSamples.some((sample) => Number(sample.count || 0) > 0)
  const requiredCapabilities = [
    "marketplaceDetails",
    "marketplaceDetailsPayload",
    "marketplaceReadme",
    "marketplaceVersions",
    "installPlan",
    "compatibilityReport",
    "installState",
    "auditLog",
    "rollback",
  ]
  const missingCapabilities = requiredCapabilities.filter((key) => capabilities[key] !== true)
  const checks = [
    makeCheck(
      "local_extension_scan",
      "Local extension scan",
      extensionInventory.total > 0 ? "passed" : "failed",
      `Scanned ${extensionInventory.total} extensions (${extensionInventory.builtin} built-in, ${extensionInventory.userInstalled} user installed).`,
      "Fix extensionScanner before claiming marketplace parity.",
    ),
    makeCheck(
      "marketplace_catalog",
      "Marketplace catalog",
      marketplaceReady ? "passed" : "failed",
      marketplaceReady
        ? `Resolved ${marketplaceSamples.length} sample queries against the configured registry.`
        : "No marketplace sample query returned usable extension metadata.",
      "Check Open VSX connectivity, enterprise registry config, and marketplaceRegistry fallback behavior.",
    ),
    makeCheck(
      "extract_zip_dependency",
      "VSIX extraction dependency",
      dependencySnapshot["extract-zip"]?.available ? "passed" : "failed",
      dependencySnapshot["extract-zip"]?.available
        ? "extract-zip is available for VSIX installation."
        : "extract-zip is missing; VSIX install cannot be production ready.",
      "Install or vendor the VSIX extraction dependency.",
    ),
    makeCheck(
      "vsce_optional",
      "VSCE optional tooling",
      dependencySnapshot["@vscode/vsce"]?.available ? "passed" : "warning",
      dependencySnapshot["@vscode/vsce"]?.available
        ? "@vscode/vsce is available."
        : "@vscode/vsce is not installed; direct VSIX extraction still works, but package validation/signature tooling is incomplete.",
      "Add VSCE or equivalent validation before enterprise offline package signing.",
    ),
    makeCheck(
      "main_thread_proxy_coverage",
      "MainThread proxy coverage",
      Number(mainThreadProxySnapshot.count || 0) >= 20 ? "passed" : "warning",
      `Detected ${Number(mainThreadProxySnapshot.count || 0)} MainThread proxy modules.`,
      "Prioritize missing VS Code APIs that block Top 100 extensions.",
    ),
    makeCheck(
      "enterprise_marketplace_capabilities",
      "Enterprise marketplace capabilities",
      missingCapabilities.length === 0 ? "passed" : "failed",
      missingCapabilities.length === 0
        ? "Details, README, versions, install plan, and compatibility report APIs are present."
        : `Missing capabilities: ${missingCapabilities.join(", ")}.`,
      "Wire missing backend capabilities before exposing Cursor-level marketplace UX.",
    ),
  ]
  const summary = summarizeChecks(checks)
  const status = summary.failed > 0 ? "blocked" : summary.warning > 0 ? "degraded" : "ready"
  return {
    reportKind: "extension-enterprise-baseline",
    createdAt: Number(input.createdAt || Date.now()),
    ready: summary.failed === 0,
    status,
    branch: input.branch || "unknown",
    gitStatus: input.gitStatus || { dirty: false, total: 0, modified: 0, deleted: 0, untracked: 0, renamed: 0 },
    extensionInventory,
    marketplaceSamples,
    dependencySnapshot,
    mainThreadProxySnapshot,
    capabilities,
    checks,
    summary,
  }
}

function baselinePaths(reportDir = defaultReportDir()) {
  return {
    reportDir,
    latestJsonPath: path.join(reportDir, "extension-baseline-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-baseline-latest.md"),
  }
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((check) =>
    `| ${check.id} | ${check.status} | ${String(check.detail || "").replace(/\|/g, "\\|")} |`,
  )
  const sampleRows = (report.marketplaceSamples || []).map((sample) =>
    `| ${sample.query || "-"} | ${sample.count || 0} | ${(sample.top || []).map((item) => item.id).join(", ") || "-"} |`,
  )
  return [
    "# Extension Enterprise Baseline",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Status: ${report.status}`,
    `- Branch: ${report.branch}`,
    `- Local extensions: ${report.extensionInventory?.total || 0}`,
    `- Git dirty files: ${report.gitStatus?.total || 0}`,
    "",
    "## Checks",
    "",
    "| Check | Status | Detail |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## Marketplace Samples",
    "",
    "| Query | Count | Top Results |",
    "| --- | ---: | --- |",
    ...sampleRows,
  ].join("\n")
}

function saveExtensionBaseline(report, options = {}) {
  const paths = baselinePaths(options.reportDir || defaultReportDir())
  fs.mkdirSync(paths.reportDir, { recursive: true })
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify({ ...report, ...paths }, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${toMarkdown(report)}\n`, "utf8")
  return { ...paths, report }
}

function readLatestExtensionBaseline(options = {}) {
  const paths = baselinePaths(options.reportDir || defaultReportDir())
  if (!fs.existsSync(paths.latestJsonPath)) return { report: null, ...paths }
  return { report: JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8")), ...paths }
}

async function collectMarketplaceSamples(queries, options = {}) {
  if (options.noNetwork) return []
  const extMgr = require("../desktop/services/extensions-host/extensionManager")
  const samples = []
  for (const query of queries) {
    const results = await extMgr.searchMarketplace(query, 5)
    samples.push({
      query,
      count: results.length,
      top: results.slice(0, 3).map((extension) => ({
        id: extension.id,
        displayName: extension.displayName,
        downloadCount: extension.downloadCount || extension.installCount || 0,
      })),
    })
  }
  return samples
}

async function runExtensionBaseline(options = {}) {
  const extMgr = require("../desktop/services/extensions-host/extensionManager")
  const git = readGitSnapshot()
  const report = buildExtensionBaselineReport({
    ...git,
    installed: extMgr.getInstalledExtensions(),
    marketplaceSamples: await collectMarketplaceSamples(options.queries || [], options),
    dependencySnapshot: collectDependencySnapshot(),
    mainThreadProxySnapshot: collectMainThreadProxySnapshot(),
    capabilities: collectCapabilities(),
  })
  if (!options.noWrite) saveExtensionBaseline(report, { reportDir: options.reportDir || defaultReportDir() })
  return report
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await runExtensionBaseline(options)
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    jsonPath: options.noWrite ? "" : baselinePaths(options.reportDir).latestJsonPath,
    markdownPath: options.noWrite ? "" : baselinePaths(options.reportDir).latestMarkdownPath,
  }, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`)
    process.exit(1)
  })
}

module.exports = {
  baselinePaths,
  buildExtensionBaselineReport,
  collectDependencySnapshot,
  collectMainThreadProxySnapshot,
  defaultReportDir,
  parseArgs,
  readLatestExtensionBaseline,
  runExtensionBaseline,
  saveExtensionBaseline,
  summarizeGitStatus,
  toMarkdown,
}
