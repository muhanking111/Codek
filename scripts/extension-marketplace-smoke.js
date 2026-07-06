#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv = []) {
  const readArg = (prefix) => argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  const queries = (readArg("--queries=") || "python,eslint,prettier")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  const extensions = (readArg("--extensions=") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  return {
    noWrite: argv.includes("--no-write"),
    reportDir: readArg("--report-dir=") || defaultReportDir(),
    pageSize: Number(readArg("--page-size=") || 5),
    queries,
    extensions,
  }
}

function splitExtensionId(id) {
  const value = String(id || "").trim()
  const dot = value.indexOf(".")
  return dot > 0 ? { namespace: value.slice(0, dot), name: value.slice(dot + 1) } : { namespace: "", name: value }
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

async function inspectExtension(extensionId, extMgr) {
  const { namespace, name } = splitExtensionId(extensionId)
  if (!namespace || !name) {
    return {
      id: extensionId,
      ok: false,
      detailsReady: false,
      readmeReady: false,
      versionsReady: false,
      installPlanReady: false,
      error: "invalid extension id",
    }
  }
  const details = await extMgr.getExtensionDetails(namespace, name)
  const readme = await extMgr.getExtensionReadme(namespace, name)
  const versions = await extMgr.getExtensionVersions(namespace, name)
  const installPlan = await extMgr.buildMarketplaceInstallPlan({ extensionId, metadata: details || { id: extensionId, namespace, name } })
  const detailsReady = Boolean(details?.id || details?.name)
  const readmeReady = Boolean(readme?.available || readme?.readme)
  const versionsReady = Array.isArray(versions?.versions) && versions.versions.length > 0
  const installPlanReady = Boolean(installPlan?.readyToInstall)
  return {
    id: extensionId,
    displayName: details?.displayName || name,
    version: details?.version || "",
    source: details?.source || "",
    downloadUrl: details?.downloadUrl || "",
    detailsReady,
    readmeReady,
    versionsReady,
    installPlanReady,
    dependencies: installPlan?.dependencies || [],
    extensionPack: installPlan?.extensionPack || [],
    warnings: installPlan?.warnings || [],
    ok: detailsReady && versionsReady && installPlanReady,
  }
}

async function buildMarketplaceSmokeReport(options = {}, extMgr = require("../desktop/services/extensions-host/extensionManager")) {
  const startedAt = Date.now()
  const searchSamples = []
  const selectedIds = new Set(options.extensions || [])

  for (const query of options.queries || []) {
    const results = await extMgr.searchMarketplace(query, Number(options.pageSize || 5))
    const top = results.slice(0, Number(options.pageSize || 5)).map((extension) => ({
      id: extension.id,
      displayName: extension.displayName,
      version: extension.version || "",
      downloadCount: Number(extension.downloadCount || extension.installCount || 0),
    }))
    if (top[0]?.id) selectedIds.add(top[0].id)
    searchSamples.push({ query, count: results.length, top })
  }

  const inspected = []
  for (const id of [...selectedIds].slice(0, Math.max(1, Number(options.pageSize || 5)))) {
    try {
      inspected.push(await inspectExtension(id, extMgr))
    } catch (error) {
      inspected.push({ id, ok: false, error: error.message })
    }
  }

  const checks = [
    makeCheck(
      "marketplace_search",
      "Marketplace search",
      searchSamples.some((sample) => sample.count > 0) ? "passed" : "failed",
      `${searchSamples.reduce((total, sample) => total + Number(sample.count || 0), 0)} results across ${searchSamples.length} queries.`,
      "Check Open VSX or enterprise registry connectivity.",
    ),
    makeCheck(
      "marketplace_details",
      "Marketplace details",
      inspected.some((item) => item.detailsReady) ? "passed" : "failed",
      `${inspected.filter((item) => item.detailsReady).length}/${inspected.length} inspected extensions returned details.`,
      "Details endpoint must return normalized manifest metadata.",
    ),
    makeCheck(
      "marketplace_readme",
      "Marketplace README",
      inspected.some((item) => item.readmeReady) ? "passed" : "warning",
      `${inspected.filter((item) => item.readmeReady).length}/${inspected.length} inspected extensions returned README content.`,
      "README may be missing for some registries; keep graceful fallback in UI.",
    ),
    makeCheck(
      "marketplace_versions",
      "Marketplace versions",
      inspected.some((item) => item.versionsReady) ? "passed" : "failed",
      `${inspected.filter((item) => item.versionsReady).length}/${inspected.length} inspected extensions returned versions.`,
      "Versions are needed for update and rollback planning.",
    ),
    makeCheck(
      "marketplace_install_plan",
      "Marketplace install plan",
      inspected.every((item) => item.installPlanReady) && inspected.length > 0 ? "passed" : "failed",
      `${inspected.filter((item) => item.installPlanReady).length}/${inspected.length} inspected extensions produced install plans.`,
      "Install plan must expose dependencies, packs, versions, and warnings before install.",
    ),
  ]
  const summary = summarizeChecks(checks)
  const status = summary.failed > 0 ? "blocked" : summary.warning > 0 ? "degraded" : "ready"
  return {
    reportKind: "extension-marketplace-smoke",
    createdAt: Date.now(),
    durationMs: Date.now() - startedAt,
    ready: summary.failed === 0,
    status,
    summary,
    checks,
    searchSamples,
    inspected,
  }
}

function marketplaceSmokePaths(reportDir = defaultReportDir()) {
  return {
    reportDir,
    latestJsonPath: path.join(reportDir, "extension-marketplace-smoke-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-marketplace-smoke-latest.md"),
  }
}

function toMarkdown(report) {
  const checkRows = (report.checks || []).map((check) =>
    `| ${check.id} | ${check.status} | ${String(check.detail || "").replace(/\|/g, "\\|")} | ${String(check.nextAction || "").replace(/\|/g, "\\|")} |`,
  )
  const inspectedRows = (report.inspected || []).map((item) =>
    `| ${item.id} | ${item.ok ? "passed" : "failed"} | ${item.detailsReady ? "yes" : "no"} | ${item.readmeReady ? "yes" : "no"} | ${item.versionsReady ? "yes" : "no"} | ${item.installPlanReady ? "yes" : "no"} |`,
  )
  return [
    "# Extension Marketplace Smoke",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Status: ${report.status}`,
    `- Duration: ${report.durationMs || 0}ms`,
    "",
    "| Check | Status | Detail | Next Action |",
    "| --- | --- | --- | --- |",
    ...checkRows,
    "",
    "## Inspected Extensions",
    "",
    "| Extension | Status | Details | README | Versions | Install Plan |",
    "| --- | --- | --- | --- | --- | --- |",
    ...inspectedRows,
  ].join("\n")
}

function saveMarketplaceSmokeReport(report, options = {}) {
  const paths = marketplaceSmokePaths(options.reportDir || defaultReportDir())
  fs.mkdirSync(paths.reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${toMarkdown(withPaths)}\n`, "utf8")
  return { ...paths, report: withPaths }
}

function readLatestMarketplaceSmoke(options = {}) {
  const paths = marketplaceSmokePaths(options.reportDir || defaultReportDir())
  if (!fs.existsSync(paths.latestJsonPath)) return { report: null, ...paths }
  return { report: JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8")), ...paths }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await buildMarketplaceSmokeReport(options)
  if (!options.noWrite) saveMarketplaceSmokeReport(report, { reportDir: options.reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    jsonPath: options.noWrite ? "" : marketplaceSmokePaths(options.reportDir).latestJsonPath,
    markdownPath: options.noWrite ? "" : marketplaceSmokePaths(options.reportDir).latestMarkdownPath,
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
  buildMarketplaceSmokeReport,
  defaultReportDir,
  marketplaceSmokePaths,
  parseArgs,
  readLatestMarketplaceSmoke,
  saveMarketplaceSmokeReport,
  toMarkdown,
}
