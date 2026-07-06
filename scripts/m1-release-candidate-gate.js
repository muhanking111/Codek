#!/usr/bin/env node

const crypto = require("node:crypto")
const childProcess = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
const { handleReadOnlyCliFlags } = require("./evidence-cli-utils")

const HELP_CONFIG = {
  scriptName: "m1-release-candidate-gate.js",
  description: "Evaluate the M1 release candidate gate from existing evidence.",
  options: [
    "  --root=<path>  Repository root to inspect.",
    "  --report-dir=<path>  Read existing evidence from this reports directory.",
    "  --max-evidence-age-ms=<ms>  Maximum accepted evidence age.",
    "  --no-write  Print the gate report without writing latest or history artifacts.",
  ],
}

const CLI_SPEC = {
  flags: ["--no-write"],
  valueOptions: ["--root=", "--report-dir=", "--max-evidence-age-ms="],
}

const readOnlyExitCode = require.main === module
  ? handleReadOnlyCliFlags(process.argv.slice(2), HELP_CONFIG, CLI_SPEC)
  : null
if (readOnlyExitCode !== null) process.exit(readOnlyExitCode)

const { buildVscodeSourceBoundaryReport } = require("./vscode-source-boundary-check")

const root = path.resolve(__dirname, "..")
const DEFAULT_MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function resolvePath(rootDir, value) {
  if (!value) return ""
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value)
}

function parseArgs(argv = process.argv.slice(2)) {
  const rootArg = argv.find((arg) => arg.startsWith("--root="))
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const maxAgeArg = argv.find((arg) => arg.startsWith("--max-evidence-age-ms="))
  const parsedRoot = rootArg ? path.resolve(rootArg.slice("--root=".length)) : root
  return {
    root: parsedRoot,
    reportDir: reportDirArg
      ? resolvePath(parsedRoot, reportDirArg.slice("--report-dir=".length))
      : path.join(parsedRoot, ".codek", "reports"),
    maxEvidenceAgeMs: maxAgeArg ? Number(maxAgeArg.slice("--max-evidence-age-ms=".length)) : DEFAULT_MAX_EVIDENCE_AGE_MS,
    noWrite: argv.includes("--no-write"),
  }
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { exists: false, data: null, error: "" }
  }
  try {
    return {
      exists: true,
      data: JSON.parse(fs.readFileSync(filePath, "utf8")),
      error: "",
      mtimeMs: fs.statSync(filePath).mtimeMs,
    }
  } catch (error) {
    return {
      exists: true,
      data: null,
      error: String(error?.message || error),
      mtimeMs: fs.statSync(filePath).mtimeMs,
    }
  }
}

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return []
  const files = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile()) {
        files.push(fullPath)
      }
    }
  }
  return files.sort()
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
}

function buildFileManifest(dir, rootDir) {
  return listFilesRecursive(dir).map((filePath) => ({
    relativePath: path.relative(rootDir, filePath).replace(/\\/g, "/"),
    hash: hashFile(filePath),
  }))
}

function compareDistDirs(frontendDist, desktopDist) {
  if (!fs.existsSync(frontendDist) || !fs.existsSync(desktopDist)) {
    return {
      synced: false,
      frontendFiles: fs.existsSync(frontendDist) ? listFilesRecursive(frontendDist).length : 0,
      desktopFiles: fs.existsSync(desktopDist) ? listFilesRecursive(desktopDist).length : 0,
      missingInDesktop: [],
      extraInDesktop: [],
      changedFiles: [],
    }
  }
  const frontendManifest = buildFileManifest(frontendDist, frontendDist)
  const desktopManifest = buildFileManifest(desktopDist, desktopDist)
  const frontend = new Map(frontendManifest.map((item) => [item.relativePath, item.hash]))
  const desktop = new Map(desktopManifest.map((item) => [item.relativePath, item.hash]))
  const missingInDesktop = [...frontend.keys()].filter((key) => !desktop.has(key)).sort()
  const extraInDesktop = [...desktop.keys()].filter((key) => !frontend.has(key)).sort()
  const changedFiles = [...frontend.keys()].filter((key) => desktop.has(key) && desktop.get(key) !== frontend.get(key)).sort()
  return {
    synced: missingInDesktop.length === 0 && extraInDesktop.length === 0 && changedFiles.length === 0,
    frontendFiles: frontendManifest.length,
    desktopFiles: desktopManifest.length,
    missingInDesktop,
    extraInDesktop,
    changedFiles,
  }
}

function makeCheck(id, group, label, passed, detail = "", evidencePath = "", severity = "required") {
  return {
    id,
    group,
    label,
    severity,
    passed: Boolean(passed),
    status: passed ? "pass" : severity === "manual" ? "manual-required" : "fail",
    detail,
    evidencePath,
  }
}

function reportFresh(readResult, now, maxAgeMs) {
  if (!readResult.exists || !readResult.data) return { fresh: false, ageMs: 0 }
  const createdAt = Number(readResult.data.createdAt || 0)
  const basis = createdAt > 0 ? createdAt : Number(readResult.mtimeMs || 0)
  const ageMs = basis > 0 ? Math.max(0, now - basis) : 0
  return { fresh: basis > 0 && ageMs <= maxAgeMs, ageMs }
}

function commandGates() {
  return [
    {
      id: "dirty_worktree",
      label: "发布前工作区必须 clean",
      command: "git status --short --branch",
      group: "repository",
    },
    {
      id: "typecheck",
      label: "TypeScript 类型检查",
      command: "npm run typecheck",
      group: "build",
    },
    {
      id: "frontend_build",
      label: "前端 dist 构建并同步 desktop/frontend-dist",
      command: "npm run build:frontend",
      group: "build",
    },
    {
      id: "full_build",
      label: "完整 build pipeline",
      command: "npm run build",
      group: "build_package",
    },
    {
      id: "source_boundary",
      label: "VS Code 外部源码边界",
      command: "npm run check:vscode-source-boundary",
      group: "source_boundary",
    },
    {
      id: "diff_check",
      label: "Git whitespace diff check",
      command: "git diff --check",
      group: "repository",
    },
    {
      id: "desktop_syntax",
      label: "Desktop / smoke 脚本语法检查",
      command: "node --check desktop/main.js && node --check desktop/preload.js && node --check scripts/electron-ui-smoke.js",
      group: "desktop_runtime",
    },
    {
      id: "real_project_ui_smoke",
      label: "真实项目 Workbench UI smoke",
      command: "npm run smoke:workbench:real-project-ui",
      group: "electron_smoke",
    },
    {
      id: "focused_tests",
      label: "M1 RC 关键 focused tests",
      command: "node --test scripts/m1-release-candidate-gate.test.js desktop/services/smoke/realProjectUiGateAttribution.test.js scripts/manual-real-ui-evidence.test.js scripts/workbench-large-file-256mb-smoke.test.js && cd frontend/vite-project && npx vitest run src/workbench/sourceMirrorMigrationPlan.test.ts src/app.test.ts src/workbench/extensionTrustRemoteAuthWorkbench.test.ts src/workbench/terminalDebugTaskWorkbench.test.ts src/workbench/agentEvidenceWorkbench.test.ts src/workbench/mcpCommands.test.ts src/extensions/extensionsWorkbenchService.test.ts src/vscode-adapter/platform/markers/common/markers.test.ts src/components/problemState.test.ts src/workbench/editorDiagnosticsLifecycle.test.ts",
      group: "focused_tests",
    },
    {
      id: "manual_evidence_contract",
      label: "人工验收 contract 导入",
      command: "node scripts/manual-real-ui-evidence.js --evidence-file <manual evidence json>",
      group: "manual",
      manual: true,
    },
  ]
}

function parseGitStatusPorcelain(stdout = "") {
  const entries = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => !line.startsWith("## "))
    .map((line) => ({
      status: line.slice(0, 2).trim() || line.slice(0, 2),
      path: line.slice(3).trim(),
    }))
    .filter((entry) => entry.path)
  const summary = {
    modified: 0,
    untracked: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    other: 0,
    total: entries.length,
  }
  for (const entry of entries) {
    const status = entry.status
    if (status === "??") {
      summary.untracked += 1
    } else if (status.includes("D")) {
      summary.deleted += 1
    } else if (status.includes("R")) {
      summary.renamed += 1
    } else if (status.includes("C")) {
      summary.copied += 1
    } else if (status.includes("M") || status.includes("A") || status.includes("T") || status.includes("U")) {
      summary.modified += 1
    } else {
      summary.other += 1
    }
  }
  return {
    ok: true,
    dirty: entries.length > 0,
    entries,
    summary,
  }
}

function readGitStatus(repoRoot) {
  try {
    const stdout = childProcess.execFileSync("git", [
      "-C",
      repoRoot,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    return parseGitStatusPorcelain(stdout)
  } catch (error) {
    return {
      ok: false,
      dirty: true,
      entries: [],
      summary: { modified: 0, untracked: 0, deleted: 0, renamed: 0, copied: 0, other: 0, total: 0 },
      error: String(error?.message || error),
    }
  }
}

function dirtyWorktreeCheck(gitStatus) {
  const status = gitStatus || {}
  const summary = status.summary || {}
  const detail = status.ok === false
    ? `无法读取 git status：${status.error || "unknown error"}`
    : status.dirty
      ? `dirty-worktree: total=${Number(summary.total || 0)}, modified=${Number(summary.modified || 0)}, untracked=${Number(summary.untracked || 0)}, deleted=${Number(summary.deleted || 0)}, renamed=${Number(summary.renamed || 0)}, copied=${Number(summary.copied || 0)}, other=${Number(summary.other || 0)}`
      : "工作区 clean，可执行最终 RC gate"
  return {
    ...makeCheck(
      "dirty_worktree",
      "repository",
      "final gate 前工作区必须 clean",
      status.ok !== false && status.dirty === false,
      detail,
      "git status --short --branch",
    ),
    classification: status.ok === false ? "git-status-unavailable" : status.dirty ? "dirty-worktree" : "clean-worktree",
    data: {
      summary: {
        modified: Number(summary.modified || 0),
        untracked: Number(summary.untracked || 0),
        deleted: Number(summary.deleted || 0),
        renamed: Number(summary.renamed || 0),
        copied: Number(summary.copied || 0),
        other: Number(summary.other || 0),
        total: Number(summary.total || 0),
      },
      samplePaths: Array.isArray(status.entries) ? status.entries.slice(0, 20).map((entry) => entry.path).filter(Boolean) : [],
    },
  }
}

function buildM1ReleaseCandidateGateReport(options = {}, deps = {}) {
  const repoRoot = path.resolve(options.root || root)
  const reportDir = resolvePath(repoRoot, options.reportDir || path.join(repoRoot, ".codek", "reports"))
  const now = Number(options.now || Date.now())
  const maxEvidenceAgeMs = Number(options.maxEvidenceAgeMs || DEFAULT_MAX_EVIDENCE_AGE_MS)
  const buildSourceBoundaryReport = deps.buildSourceBoundaryReport || buildVscodeSourceBoundaryReport
  const sourceBoundary = buildSourceBoundaryReport({ root: repoRoot })
  const getGitStatus = deps.readGitStatus || readGitStatus
  const gitStatus = getGitStatus(repoRoot)

  const frontendDist = path.join(repoRoot, "frontend", "vite-project", "dist")
  const desktopDist = path.join(repoRoot, "desktop", "frontend-dist")
  const distSync = compareDistDirs(frontendDist, desktopDist)
  const desktopIndexPath = path.join(desktopDist, "index.html")
  const desktopIndex = fs.existsSync(desktopIndexPath) ? fs.readFileSync(desktopIndexPath, "utf8") : ""
  const hasDesktopCsp = desktopIndex.includes("font-src 'self' data: codek-extension-resource:")
    && desktopIndex.includes("img-src 'self' data: blob: file: codek-extension-resource:")

  const paths = {
    realProjectUi: path.join(reportDir, "workbench-real-project-ui-latest.json"),
    realProjectUiMarkdown: path.join(reportDir, "workbench-real-project-ui-latest.md"),
    realProjectUiScreenshot: path.join(reportDir, "workbench-real-project-ui-latest.png"),
    electronRealProjectUi: path.join(reportDir, "electron-smoke-real-project-ui-latest-result.json"),
    manualRealUi: path.join(reportDir, "manual-real-ui-evidence-latest.json"),
    manualRealUiMarkdown: path.join(reportDir, "manual-real-ui-evidence-latest.md"),
    releaseEvidence: path.join(reportDir, "release-evidence-latest.json"),
  }

  const realProjectUi = readJson(paths.realProjectUi)
  const electronRealProjectUi = readJson(paths.electronRealProjectUi)
  const manualRealUi = readJson(paths.manualRealUi)
  const releaseEvidence = readJson(paths.releaseEvidence)
  const realFresh = reportFresh(realProjectUi, now, maxEvidenceAgeMs)
  const manualFresh = reportFresh(manualRealUi, now, maxEvidenceAgeMs)
  const releaseFresh = reportFresh(releaseEvidence, now, maxEvidenceAgeMs)

  const electronChecks = Array.isArray(electronRealProjectUi.data?.checks) ? electronRealProjectUi.data.checks : []
  const electronFailedChecks = electronChecks.filter((check) => check?.passed === false)
  const gateAttributionRows = Array.isArray(realProjectUi.data?.gateAttribution?.rows)
    ? realProjectUi.data.gateAttribution.rows
    : []
  const gateAttributionFailedRows = Array.isArray(realProjectUi.data?.gateAttribution?.failedRows)
    ? realProjectUi.data.gateAttribution.failedRows
    : []
  const manualContract = realProjectUi.data?.manualAcceptanceContract || {}
  const manualContractRows = Array.isArray(manualContract.rows) ? manualContract.rows : []

  const checks = [
    dirtyWorktreeCheck(gitStatus),
    makeCheck("package_scripts_present", "build_package", "package.json exposes build/package/smoke/source-boundary scripts", hasPackageScripts(repoRoot), "build:frontend/build/pack/check/smoke scripts", "package.json"),
    makeCheck("frontend_dist_exists", "frontend_dist", "frontend/vite-project/dist exists", fs.existsSync(path.join(frontendDist, "index.html")), "frontend/vite-project/dist/index.html", path.join(frontendDist, "index.html")),
    makeCheck("desktop_frontend_dist_exists", "desktop_runtime", "desktop/frontend-dist exists", fs.existsSync(desktopIndexPath), "desktop/frontend-dist/index.html", desktopIndexPath),
    makeCheck("frontend_desktop_dist_synced", "desktop_runtime", "frontend dist and Electron runtime dist are byte-for-byte synced", distSync.synced, `frontendFiles=${distSync.frontendFiles}, desktopFiles=${distSync.desktopFiles}, changed=${distSync.changedFiles.slice(0, 5).join(",")}`, desktopDist),
    makeCheck("desktop_dist_csp", "desktop_runtime", "desktop frontend dist CSP allows extension resources", hasDesktopCsp, "font/img CSP includes codek-extension-resource", desktopIndexPath),
    makeCheck("source_boundary", "source_boundary", "runtime/build/package sources do not depend on the external VS Code checkout", sourceBoundary.ready === true, `${sourceBoundary.summary?.scannedFiles || 0} files scanned, findings=${sourceBoundary.summary?.findings || 0}`, "scripts/vscode-source-boundary-check.js"),
    makeCheck("real_project_ui_latest_ready", "electron_smoke", "latest real-project-ui report is ready", realProjectUi.data?.ready === true && realProjectUi.data?.status === "ready", `status=${realProjectUi.data?.status || "missing"}`, paths.realProjectUi),
    makeCheck("real_project_ui_latest_fresh", "electron_smoke", "latest real-project-ui report is fresh", realFresh.fresh, `ageMs=${Math.round(realFresh.ageMs)}, maxAgeMs=${maxEvidenceAgeMs}`, paths.realProjectUi),
    makeCheck("real_project_ui_gate_attribution", "electron_smoke", "real-project-ui report has stage attribution without failed rows", gateAttributionRows.length >= 11 && gateAttributionFailedRows.length === 0, `rows=${gateAttributionRows.length}, failedRows=${gateAttributionFailedRows.length}`, paths.realProjectUiMarkdown),
    makeCheck("real_project_ui_manual_contract", "manual_contract", "real-project-ui report exposes manual replay contract", manualContractRows.length >= 11 && manualContractRows.every((row) => Array.isArray(row?.manualReplaySteps) && row.manualReplaySteps.length > 0), `manualRows=${manualContractRows.length}`, paths.realProjectUiMarkdown),
    makeCheck("electron_smoke_real_project_ui_ok", "electron_smoke", "Electron smoke result has non-empty passing checks", electronRealProjectUi.data?.ok === true && electronChecks.length > 0 && electronFailedChecks.length === 0, `checks=${electronChecks.length}, failed=${electronFailedChecks.length}`, paths.electronRealProjectUi),
    makeCheck("manual_real_ui_latest_ready", "manual", "manual real UI evidence is imported and ready", manualRealUi.data?.ready === true, `status=${manualRealUi.data?.status || "missing"}, passed=${manualRealUi.data?.summary?.passedChecks || 0}/${manualRealUi.data?.summary?.requiredChecks || 0}`, paths.manualRealUi, "manual"),
    makeCheck("manual_real_ui_latest_fresh", "manual", "manual real UI evidence is fresh", manualFresh.fresh, `ageMs=${Math.round(manualFresh.ageMs)}, maxAgeMs=${maxEvidenceAgeMs}`, paths.manualRealUi, "manual"),
    makeCheck("release_evidence_enterprise_complete", "release_evidence", "release evidence marks enterpriseComplete", releaseEvidence.data?.summary?.enterpriseComplete === true, `status=${releaseEvidence.data?.status || "missing"}, enterpriseComplete=${releaseEvidence.data?.summary?.enterpriseComplete === true}`, paths.releaseEvidence, "manual"),
    makeCheck("release_evidence_fresh", "release_evidence", "release evidence is fresh", releaseFresh.fresh, `ageMs=${Math.round(releaseFresh.ageMs)}, maxAgeMs=${maxEvidenceAgeMs}`, paths.releaseEvidence, "manual"),
  ]

  const automatedChecks = checks.filter((check) => check.severity !== "manual")
  const automatedReady = automatedChecks.every((check) => check.passed)
  const manualReady = manualRealUi.data?.ready === true && releaseEvidence.data?.summary?.enterpriseComplete === true
  const ready = automatedReady && manualReady
  const status = ready ? "ready" : automatedReady ? "manual-required" : "blocked"

  return {
    reportKind: "m1-release-candidate-gate",
    createdAt: now,
    status,
    ready,
    automatedReady,
    manualReady,
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.passed).length,
      failed: checks.filter((check) => !check.passed && check.severity !== "manual").length,
      manualRequired: checks.filter((check) => !check.passed && check.severity === "manual").length,
      commandGates: commandGates().length,
    },
    checks,
    commandGates: commandGates(),
    paths,
    distSync,
    sourceBoundary: {
      ready: sourceBoundary.ready,
      summary: sourceBoundary.summary,
      findings: sourceBoundary.findings || [],
    },
    manualConfirmationItems: [
      "Cursor 级主观流畅度人工确认",
      "同目录 Cursor / Windows Explorer 文件树和 Search 对照",
      "真实大文件快速滚动、搜索跳转、关闭重开手感",
      "SCM / Testing / Timeline / Notification / Progress 人工体验",
      "Workspace Trust / Remote Authority / Authentication 状态归属与 token redaction",
      "重新导出 release-evidence-latest.json，直到 summary.enterpriseComplete=true",
    ],
  }
}

function hasPackageScripts(repoRoot) {
  const pkgPath = path.join(repoRoot, "package.json")
  const parsed = readJson(pkgPath)
  const scripts = parsed.data?.scripts || {}
  return [
    "build:frontend",
    "build",
    "pack:win",
    "check:vscode-source-boundary",
    "smoke:workbench:real-project-ui",
  ].every((name) => typeof scripts[name] === "string" && scripts[name].length > 0)
}

function formatStatus(check) {
  if (check.passed) return "通过"
  if (check.severity === "manual") return "需人工"
  return "失败"
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function markdownReport(report) {
  const lines = [
    "# M1 Release Candidate Gate",
    "",
    `- 状态: ${report.status}`,
    `- 自动门禁: ${report.automatedReady ? "通过" : "失败"}`,
    `- 人工/发布证据: ${report.manualReady ? "通过" : "需人工确认"}`,
    `- 生成时间: ${new Date(report.createdAt).toISOString()}`,
    "",
    "## Gate 总表",
    "",
    "| 分组 | 检查 | 状态 | 说明 | 证据 |",
    "| --- | --- | --- | --- | --- |",
    ...report.checks.map((check) => `| ${escapeCell(check.group)} | ${escapeCell(check.label)} | ${formatStatus(check)} | ${escapeCell(check.detail)} | ${escapeCell(check.evidencePath)} |`),
    "",
    "## 必跑命令",
    "",
    "| 分组 | 命令 | 说明 |",
    "| --- | --- | --- |",
    ...report.commandGates.map((gate) => `| ${escapeCell(gate.group)} | \`${String(gate.command).replace(/`/g, "'")}\` | ${escapeCell(gate.label)} |`),
    "",
    "## 仍需人工确认",
    "",
    ...report.manualConfirmationItems.map((item) => `- ${item}`),
    "",
  ]
  return `${lines.join("\n")}\n`
}

function saveReport(report, reportDir) {
  fs.mkdirSync(reportDir, { recursive: true })
  fs.mkdirSync(path.join(reportDir, "history"), { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const latestJsonPath = path.join(reportDir, "m1-release-candidate-gate-latest.json")
  const latestMarkdownPath = path.join(reportDir, "m1-release-candidate-gate-latest.md")
  const historyJsonPath = path.join(reportDir, "history", `m1-release-candidate-gate-${stamp}.json`)
  const historyMarkdownPath = path.join(reportDir, "history", `m1-release-candidate-gate-${stamp}.md`)
  const normalized = {
    ...report,
    latestJsonPath,
    latestMarkdownPath,
    historyJsonPath,
    historyMarkdownPath,
  }
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyJsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestMarkdownPath, markdownReport(normalized), "utf8")
  fs.writeFileSync(historyMarkdownPath, markdownReport(normalized), "utf8")
  return { latestJsonPath, latestMarkdownPath, historyJsonPath, historyMarkdownPath }
}

function readLatestM1ReleaseCandidateGate(options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const latestJsonPath = path.join(reportDir, "m1-release-candidate-gate-latest.json")
  if (!fs.existsSync(latestJsonPath)) return { report: null, latestJsonPath }
  return {
    report: JSON.parse(fs.readFileSync(latestJsonPath, "utf8")),
    latestJsonPath,
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = buildM1ReleaseCandidateGateReport(options)
  const saved = options.noWrite ? {} : saveReport(report, options.reportDir)
  process.stdout.write(`${JSON.stringify({ ...report, ...saved }, null, 2)}\n`)
  process.exit(report.ready ? 0 : report.automatedReady ? 2 : 1)
}

if (require.main === module) {
  main()
}

module.exports = {
  DEFAULT_MAX_EVIDENCE_AGE_MS,
  buildM1ReleaseCandidateGateReport,
  commandGates,
  compareDistDirs,
  defaultReportDir,
  markdownReport,
  parseArgs,
  readLatestM1ReleaseCandidateGate,
  saveReport,
}
