#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const { evaluateExtensionCompatibility } = require("../desktop/services/extensions-host/extensionCompatibility")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv = []) {
  const readArg = (prefix) => argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  return {
    noWrite: argv.includes("--no-write"),
    noNetwork: argv.includes("--no-network"),
    reportDir: readArg("--report-dir=") || defaultReportDir(),
    top: Math.max(1, Number(readArg("--top=") || 100)),
    sampleFile: readArg("--sample-file=") || "",
    queries: (readArg("--queries=") || "python,eslint,prettier,java,rust,clangd,docker,markdown")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  }
}

function readSampleFile(sampleFile) {
  if (!sampleFile) return []
  const resolved = path.resolve(root, sampleFile)
  if (!fs.existsSync(resolved)) return []
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"))
  return Array.isArray(parsed) ? parsed : Array.isArray(parsed.extensions) ? parsed.extensions : []
}

function extensionId(extension = {}) {
  return String(extension.id || (extension.publisher && extension.name ? `${extension.publisher}.${extension.name}` : extension.name || "")).trim()
}

function dedupeExtensions(extensions = []) {
  const seen = new Set()
  const out = []
  for (const extension of extensions) {
    const id = extensionId(extension)
    if (!id || seen.has(id.toLowerCase())) continue
    seen.add(id.toLowerCase())
    out.push({ ...extension, id })
  }
  return out
}

async function collectMarketplaceCandidates(options, extMgr) {
  if (options.noNetwork) return []
  const candidates = []
  for (const query of options.queries || []) {
    const results = await extMgr.searchMarketplace(query, Math.min(Number(options.top || 100), 30))
    candidates.push(...results)
    if (dedupeExtensions(candidates).length >= Number(options.top || 100)) break
  }
  return candidates
}

async function enrichCandidate(extension, extMgr, installedIds = new Set()) {
  const id = extensionId(extension)
  if (!id.includes(".")) return extension
  if (installedIds.has(id.toLowerCase())) return extension
  const dot = id.indexOf(".")
  try {
    const details = await extMgr.getExtensionDetails(id.slice(0, dot), id.slice(dot + 1))
    return details ? { ...extension, ...details, id } : extension
  } catch {
    return extension
  }
}

async function buildCompatibilityMatrixReport(options = {}, extMgr = require("../desktop/services/extensions-host/extensionManager")) {
  const installed = extMgr.getInstalledExtensions()
  const installedIds = new Set(installed.map((extension) => extensionId(extension).toLowerCase()).filter(Boolean))
  const fileSamples = readSampleFile(options.sampleFile)
  const marketplace = await collectMarketplaceCandidates(options, extMgr)
  const candidates = dedupeExtensions([...fileSamples, ...marketplace, ...installed]).slice(0, Number(options.top || 100))
  const enriched = []
  for (const candidate of candidates) {
    enriched.push(await enrichCandidate(candidate, extMgr, installedIds))
  }
  const activationReport = extMgr.readActivationReport()
  const extensions = enriched.map((extension, index) => ({
    rank: index + 1,
    source: installed.some((item) => extensionId(item).toLowerCase() === extensionId(extension).toLowerCase()) ? "installed" : "marketplace",
    ...evaluateExtensionCompatibility(extension, { activationReport }),
  }))
  const summary = {
    top: Number(options.top || 100),
    sampled: extensions.length,
    native: extensions.filter((item) => item.status === "native").length,
    compatible: extensions.filter((item) => item.status === "compatible").length,
    degraded: extensions.filter((item) => item.status === "degraded").length,
    blocked: extensions.filter((item) => item.status === "blocked").length,
    unsupportedContributionPoints: extensions.reduce((total, item) => total + item.unsupportedContributionPoints.length, 0),
    partialContributionPoints: extensions.reduce((total, item) => total + item.partialContributionPoints.length, 0),
  }
  const ready = summary.sampled > 0 && summary.blocked === 0
  return {
    reportKind: "extension-compatibility-matrix",
    createdAt: Date.now(),
    ready,
    status: !summary.sampled ? "missing" : summary.blocked > 0 ? "blocked" : summary.degraded > 0 ? "degraded" : "ready",
    summary,
    supportPolicy: require("../desktop/services/extensions-host/extensionCompatibility").CONTRIBUTION_SUPPORT,
    extensions,
  }
}

function compatibilityMatrixPaths(reportDir = defaultReportDir()) {
  return {
    reportDir,
    latestJsonPath: path.join(reportDir, "extension-compatibility-matrix-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-compatibility-matrix-latest.md"),
  }
}

function toMarkdown(report) {
  const rows = (report.extensions || []).map((extension) =>
    `| ${extension.rank} | ${extension.id} | ${extension.status} | ${extension.source || "-"} | ${extension.unsupportedContributionPoints.join(", ") || "-"} | ${extension.blockers.map((item) => item.message).join(", ") || "-"} |`,
  )
  return [
    "# Extension Compatibility Matrix",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Status: ${report.status}`,
    `- Sampled: ${report.summary?.sampled || 0}/${report.summary?.top || 0}`,
    `- Blocked: ${report.summary?.blocked || 0}`,
    `- Degraded: ${report.summary?.degraded || 0}`,
    "",
    "| Rank | Extension | Status | Source | Unsupported | Blockers |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

function saveCompatibilityMatrixReport(report, options = {}) {
  const paths = compatibilityMatrixPaths(options.reportDir || defaultReportDir())
  fs.mkdirSync(paths.reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${toMarkdown(withPaths)}\n`, "utf8")
  return { ...paths, report: withPaths }
}

function readLatestCompatibilityMatrix(options = {}) {
  const paths = compatibilityMatrixPaths(options.reportDir || defaultReportDir())
  if (!fs.existsSync(paths.latestJsonPath)) return { report: null, ...paths }
  return { report: JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8")), ...paths }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await buildCompatibilityMatrixReport(options)
  if (!options.noWrite) saveCompatibilityMatrixReport(report, { reportDir: options.reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    jsonPath: options.noWrite ? "" : compatibilityMatrixPaths(options.reportDir).latestJsonPath,
    markdownPath: options.noWrite ? "" : compatibilityMatrixPaths(options.reportDir).latestMarkdownPath,
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
  buildCompatibilityMatrixReport,
  compatibilityMatrixPaths,
  defaultReportDir,
  parseArgs,
  readLatestCompatibilityMatrix,
  saveCompatibilityMatrixReport,
  toMarkdown,
}
