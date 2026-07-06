#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

const {
  createDirectoryEntryLimitSentinel,
  mapDirentsToFileServiceEntries,
} = require("../desktop/services/workspace/fileServiceEntryAdapter")
const { resolveListDirEntryBudget } = require("../desktop/services/workspace/listDirBudget")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv) {
  const dirs = []
  let projectPath = root
  let reportDir = defaultReportDir()
  let source = "explorer"
  for (const arg of argv) {
    if (arg.startsWith("--project=")) projectPath = arg.slice("--project=".length)
    if (arg.startsWith("--path=")) dirs.push(arg.slice("--path=".length))
    if (arg.startsWith("--dir=")) dirs.push(arg.slice("--dir=".length))
    if (arg.startsWith("--report-dir=")) reportDir = arg.slice("--report-dir=".length)
    if (arg.startsWith("--source=")) source = arg.slice("--source=".length)
  }
  return {
    noWrite: argv.includes("--no-write"),
    includeStats: argv.includes("--include-stats"),
    projectPath,
    reportDir,
    dirs: dirs.length ? dirs : ["."],
    source,
  }
}

async function buildExplorerFsParityReport(options = {}) {
  const projectPath = path.resolve(options.projectPath || root)
  const dirs = Array.isArray(options.dirs) && options.dirs.length ? options.dirs : ["."]
  const fsPromises = options.fsPromises || fs.promises
  const checks = []
  for (const dir of dirs) {
    checks.push(await buildDirectoryParityCheck({
      fsPromises,
      projectPath,
      dir,
      source: options.source || "explorer",
      includeStats: options.includeStats === true,
      profileEntryBudget: options.profileEntryBudget,
    }))
  }
  const ready = checks.length > 0 && checks.every((check) => check.status === "passed")
  return {
    reportKind: "explorer-fs-parity",
    createdAt: Number(options.createdAt || Date.now()),
    ready,
    status: ready ? "ready" : "blocked",
    projectPath,
    checkCount: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    checks,
  }
}

async function buildDirectoryParityCheck({
  fsPromises,
  projectPath,
  dir,
  source,
  includeStats,
  profileEntryBudget,
}) {
  const targetPath = resolveTargetPath(projectPath, dir)
  try {
    const fsDirents = await fsPromises.readdir(targetPath, { withFileTypes: true })
    const budget = resolveListDirEntryBudget({
      totalEntries: fsDirents.length,
      options: {},
      meta: { source },
      profileEntryBudget,
    })
    const mappedEntries = await mapDirentsToFileServiceEntries({
      fsPromises,
      parentPath: targetPath,
      dirents: fsDirents.slice(0, budget.maxEntries),
      includeStats,
    })
    const codekEntries = mappedEntries.concat(budget.appendLimitSentinel ? [
      createDirectoryEntryLimitSentinel({
        parentPath: targetPath,
        totalEntries: fsDirents.length,
        readDurationMs: 0,
      }),
    ] : [])
    const comparison = compareDirentsToCodekEntries(fsDirents, codekEntries)
    const passed = !budget.truncated
      && comparison.missing.length === 0
      && comparison.extra.length === 0
      && comparison.typeMismatches.length === 0
    return {
      id: normalizeCheckId(dir),
      path: targetPath,
      source,
      status: passed ? "passed" : "failed",
      fsCount: fsDirents.length,
      codekCount: comparison.codekComparableCount,
      truncated: budget.truncated,
      sentinelCount: comparison.sentinelCount,
      missing: comparison.missing,
      extra: comparison.extra,
      typeMismatches: comparison.typeMismatches,
      nextAction: passed ? "" : "检查 fs:listDir source、budget、FileType 映射和 ExplorerDataSource 是否继续丢弃真实 FS 条目。",
    }
  } catch (error) {
    return {
      id: normalizeCheckId(dir),
      path: targetPath,
      source,
      status: "failed",
      fsCount: 0,
      codekCount: 0,
      truncated: false,
      sentinelCount: 0,
      missing: [],
      extra: [],
      typeMismatches: [],
      error: String(error?.message || error),
      nextAction: "确认传入目录存在且可由当前 Windows 用户读取。",
    }
  }
}

function compareDirentsToCodekEntries(fsDirents, codekEntries) {
  const fsByName = new Map()
  const codekByName = new Map()
  let sentinelCount = 0
  for (const dirent of fsDirents) {
    fsByName.set(String(dirent.name), {
      name: String(dirent.name),
      isDirectory: Boolean(dirent.isDirectory?.()),
      isFile: Boolean(dirent.isFile?.()),
      isSymbolicLink: Boolean(dirent.isSymbolicLink?.()),
    })
  }
  for (const entry of codekEntries) {
    if (entry?.truncated || entry?.limitReason === "children") {
      sentinelCount += 1
      continue
    }
    codekByName.set(String(entry?.name || ""), {
      name: String(entry?.name || ""),
      isDirectory: Boolean(entry?.isDirectory || entry?.isDir),
      isFile: Boolean(entry?.isFile),
      isSymbolicLink: Boolean(entry?.isSymbolicLink || entry?.isSymlink),
    })
  }
  const missing = []
  const extra = []
  const typeMismatches = []
  for (const [name, expected] of fsByName) {
    const actual = codekByName.get(name)
    if (!actual) {
      missing.push(name)
      continue
    }
    if (
      expected.isDirectory !== actual.isDirectory
      || expected.isFile !== actual.isFile
      || expected.isSymbolicLink !== actual.isSymbolicLink
    ) {
      typeMismatches.push({ name, expected, actual })
    }
  }
  for (const name of codekByName.keys()) {
    if (!fsByName.has(name)) extra.push(name)
  }
  return {
    missing,
    extra,
    typeMismatches,
    sentinelCount,
    codekComparableCount: codekByName.size,
  }
}

function saveExplorerFsParityReport(report, options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  fs.mkdirSync(reportDir, { recursive: true })
  const timestamp = new Date(Number(report.createdAt || Date.now())).toISOString().replace(/[:.]/g, "-")
  const jsonPath = path.join(reportDir, `explorer-fs-parity-${timestamp}.json`)
  const markdownPath = path.join(reportDir, `explorer-fs-parity-${timestamp}.md`)
  const latestJsonPath = path.join(reportDir, "explorer-fs-parity-latest.json")
  const latestMarkdownPath = path.join(reportDir, "explorer-fs-parity-latest.md")
  const withPaths = { ...report, jsonPath, markdownPath, latestJsonPath, latestMarkdownPath }
  fs.writeFileSync(jsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  const markdown = renderMarkdown(withPaths)
  fs.writeFileSync(markdownPath, markdown, "utf8")
  fs.writeFileSync(latestMarkdownPath, markdown, "utf8")
  return withPaths
}

function renderMarkdown(report) {
  const lines = [
    "# Explorer FS Parity",
    "",
    `- status: ${report.status}`,
    `- ready: ${report.ready}`,
    `- projectPath: ${report.projectPath}`,
    `- checks: ${report.passed}/${report.checkCount}`,
    "",
  ]
  for (const check of report.checks || []) {
    lines.push(`## ${check.path}`)
    lines.push("")
    lines.push(`- status: ${check.status}`)
    lines.push(`- fsCount: ${check.fsCount}`)
    lines.push(`- codekCount: ${check.codekCount}`)
    lines.push(`- truncated: ${check.truncated}`)
    lines.push(`- sentinelCount: ${check.sentinelCount}`)
    if (check.error) lines.push(`- error: ${check.error}`)
    if (check.missing?.length) lines.push(`- missing: ${check.missing.join(", ")}`)
    if (check.extra?.length) lines.push(`- extra: ${check.extra.join(", ")}`)
    if (check.typeMismatches?.length) lines.push(`- typeMismatches: ${check.typeMismatches.map((item) => item.name).join(", ")}`)
    if (check.nextAction) lines.push(`- nextAction: ${check.nextAction}`)
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

function readLatestExplorerFsParity(reportDir = defaultReportDir()) {
  return readJsonSafe(path.join(reportDir, "explorer-fs-parity-latest.json"))
}

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function resolveTargetPath(projectPath, dir) {
  const raw = String(dir || ".")
  return path.resolve(path.isAbsolute(raw) ? raw : path.join(projectPath, raw))
}

function normalizeCheckId(value) {
  return String(value || ".").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "root"
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await buildExplorerFsParityReport(options)
  const output = options.noWrite ? report : saveExplorerFsParityReport(report, options)
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  process.exit(output.ready ? 0 : 1)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error)}\n`)
    process.exit(1)
  })
}

module.exports = {
  buildExplorerFsParityReport,
  compareDirentsToCodekEntries,
  parseArgs,
  readLatestExplorerFsParity,
  saveExplorerFsParityReport,
}
