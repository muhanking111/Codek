#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")
const reportDir = path.join(root, ".codek", "reports")
const frontendSourceDir = path.join(root, "frontend", "vite-project", "src")
const rendererDistIndex = path.join(root, "frontend", "vite-project", "dist", "index.html")
const electronDistIndex = path.join(root, "desktop", "frontend-dist", "index.html")

function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm"
}

function latestMtimeMs(dir) {
  if (!fs.existsSync(dir)) return 0
  let latest = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestMtimeMs(fullPath))
      continue
    }
    if (!entry.isFile()) continue
    latest = Math.max(latest, fs.statSync(fullPath).mtimeMs)
  }
  return latest
}

function distMtimeMs(filePath) {
  return fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : 0
}

function shouldBuildFrontend() {
  if (process.env.CODEK_VISUAL_BASELINE_SKIP_BUILD === "1") return false
  if (process.env.CODEK_VISUAL_BASELINE_FORCE_BUILD === "1") return true
  if (!fs.existsSync(rendererDistIndex) || !fs.existsSync(electronDistIndex)) return true
  const latestSource = latestMtimeMs(frontendSourceDir)
  return latestSource > distMtimeMs(rendererDistIndex) || latestSource > distMtimeMs(electronDistIndex)
}

function ensureFrontendBuild() {
  const startedAt = Date.now()
  if (!shouldBuildFrontend()) {
    return {
      id: "frontend_build",
      title: "前端构建产物已是最新",
      passed: true,
      skipped: true,
      durationMs: 0,
      rendererDistIndex,
      electronDistIndex,
    }
  }
  const result = spawnSync(npmCommand(), ["run", "build:frontend"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  const passed = !result.error
    && result.status === 0
    && fs.existsSync(rendererDistIndex)
    && fs.existsSync(electronDistIndex)
  return {
    id: "frontend_build",
    title: "同步前端构建产物",
    passed,
    skipped: false,
    status: typeof result.status === "number" ? result.status : null,
    error: result.error ? result.error.message : null,
    stderrTail: String(result.stderr || "").slice(-1000),
    durationMs: Date.now() - startedAt,
    rendererDistIndex,
    electronDistIndex,
  }
}

function runStep(id, title, args) {
  const startedAt = Date.now()
  const preflight = ensureFrontendBuild()
  if (!preflight.passed) {
    return {
      id,
      title,
      passed: false,
      status: null,
      error: "前端构建产物不可用，已停止本步骤。",
      preflight,
      durationMs: Date.now() - startedAt,
    }
  }
  const childEnv = {
    ...process.env,
    CODEK_ELECTRON_SMOKE_TIMEOUT_MS: process.env.CODEK_ELECTRON_SMOKE_TIMEOUT_MS || "120000",
    CODEK_VISUAL_BASELINE_SKIP_BUILD: "1",
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "C.UTF-8",
    PYTHONUTF8: process.env.PYTHONUTF8 || "1",
  }
  delete childEnv.CODEK_ELECTRON_SMOKE_RESULT_FILE
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "electron-ui-smoke.js"), ...args], {
    cwd: root,
    env: childEnv,
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  sleep(1500)
  return {
    id,
    title,
    startedAt,
    startedAtIso: new Date(startedAt).toISOString(),
    passed: !result.error && result.status === 0,
    status: typeof result.status === "number" ? result.status : null,
    error: result.error ? result.error.message : null,
    stderrTail: String(result.stderr || "").slice(-1000),
    stdoutTail: String(result.stdout || "").slice(-1000),
    preflight,
    durationMs: Date.now() - startedAt,
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function fileMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

function parseReportTimeMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function stepStartedAtMs(steps, id) {
  const step = Array.isArray(steps) ? steps.find((candidate) => candidate.id === id) : null
  return Number.isFinite(step?.startedAt) ? step.startedAt : 0
}

function isFileFreshForStep(filePath, startedAtMs) {
  if (!startedAtMs) return true
  return fileMtimeMs(filePath) >= startedAtMs
}

function isReportFreshForStep(report, startedAtMs) {
  if (!startedAtMs) return true
  const createdAtMs = parseReportTimeMs(report?.createdAt)
  return createdAtMs >= startedAtMs
}

function freshnessThresholdForStep(steps, id, options = {}) {
  return Math.max(
    stepStartedAtMs(steps, id),
    Number(options.reuseSinceMs || 0),
  )
}

function smokeReportHasChecks(report) {
  return Array.isArray(report?.checks)
    && report.checks.length > 0
    && report.checks.every((check) => check?.passed !== false)
}

function collectEvidence(steps = [], options = {}) {
  const activeReportDir = options.reportDir || reportDir
  const tabReportPath = path.join(activeReportDir, "electron-smoke-tab-overflow-latest-result.json")
  const iconReportPath = path.join(activeReportDir, "electron-smoke-icon-visual-state-latest-result.json")
  const realUiReportPath = path.join(activeReportDir, "workbench-real-project-ui-latest.json")
  const screenshotPath = path.join(activeReportDir, "workbench-real-project-ui-latest.png")
  const tabReport = readJson(tabReportPath)
  const iconReport = readJson(iconReportPath)
  const realUiReport = readJson(realUiReportPath)
  const acceptance = realUiReport?.acceptance || {}
  const metrics = realUiReport?.metrics || {}
  const tabStartedAt = freshnessThresholdForStep(steps, "tab_overflow", options)
  const iconStartedAt = freshnessThresholdForStep(steps, "icon_visual_state", options)
  const realUiStartedAt = freshnessThresholdForStep(steps, "real_project_ui", options)
  const tabReportFresh = isFileFreshForStep(tabReportPath, tabStartedAt)
  const iconReportFresh = isFileFreshForStep(iconReportPath, iconStartedAt)
  const realUiReportFresh = isReportFreshForStep(realUiReport, realUiStartedAt)
  const screenshotFresh = isFileFreshForStep(screenshotPath, realUiStartedAt)
  return {
    tabReportPath,
    iconReportPath,
    realUiReportPath,
    screenshotPath,
    screenshotExists: fs.existsSync(screenshotPath),
    reuseSinceMs: Number(options.reuseSinceMs || 0),
    reuseSinceIso: options.reuseSinceMs ? new Date(Number(options.reuseSinceMs)).toISOString() : null,
    tabReportFresh,
    iconReportFresh,
    realUiReportFresh,
    screenshotFresh,
    realUiReportCreatedAt: realUiReport?.createdAt || null,
    realUiStepStartedAt: realUiStartedAt ? new Date(realUiStartedAt).toISOString() : null,
    tabOverflowReady: Boolean(tabReport?.ok && tabReportFresh && smokeReportHasChecks(tabReport)),
    iconVisualReady: Boolean(iconReport?.ok && iconReportFresh && smokeReportHasChecks(iconReport)),
    realProjectUiReady: Boolean(realUiReport?.ready && realUiReportFresh),
    tabReadable: Boolean(tabReportFresh && smokeReportHasChecks(tabReport)),
    iconStateReady: Boolean(iconReportFresh && smokeReportHasChecks(iconReport)),
    screenshotChecks: {
      noBlankTabs: Boolean(acceptance.opensConfiguredRoot && acceptance.nativeExplorerMounted && acceptance.explorerRowsVirtualizedAndNonBlank),
      editorTitleVisible: Boolean(metrics.normalEditorContentVisible || metrics.rootPackageEditorValueVisible),
      fileIconsVisible: Boolean(acceptance.nativeExplorerMounted && acceptance.largeFileRealContentVisible !== false),
      noLargeFileWarningBadge: Boolean(acceptance.largeFileAvoidsBlockingNotice && metrics.largeFileWarningBadgeHidden),
      searchNonBlank: Boolean(acceptance.searchResultOpensNonBlankEditor),
      workbenchLayoutVisible: Boolean(
        acceptance.workbenchActivityBarRegistryDriven
        && acceptance.workbenchSidebarRegistrySwitches
        && acceptance.workbenchEditorPartSnapshotVisible
        && acceptance.workbenchPanelSnapshotVisible
      ),
    },
  }
}

function evidenceReady(evidence) {
  return Boolean(
    evidence?.tabOverflowReady
    && evidence?.iconVisualReady
    && evidence?.realProjectUiReady
    && evidence?.screenshotExists
    && evidence?.screenshotFresh
    && Object.values(evidence?.screenshotChecks || {}).every(Boolean),
  )
}

function computeVisualBaselineReady(build, steps, evidence) {
  return Boolean(build?.passed && steps.every((step) => step.passed) && evidenceReady(evidence))
}

function latestEvidenceStep(id, title, passed, error) {
  return {
    id,
    title,
    startedAt: 0,
    startedAtIso: null,
    passed: Boolean(passed),
    status: passed ? 0 : null,
    error: passed ? null : error,
    reusedLatestEvidence: true,
    durationMs: 0,
  }
}

function evidenceStepsFromLatest(evidence = collectEvidence([])) {
  const realUiPassed = Boolean(evidence.realProjectUiReady && evidence.screenshotExists && evidence.screenshotFresh)
  return [
    latestEvidenceStep("tab_overflow", "多 Tab 标题可读", evidence.tabOverflowReady, "缺少可复用的 Tab 溢出 smoke 证据。"),
    latestEvidenceStep("icon_visual_state", "文件图标视觉状态", evidence.iconVisualReady, "缺少可复用的图标视觉 smoke 证据。"),
    latestEvidenceStep("real_project_ui", "真实项目视觉截图", realUiPassed, "缺少可复用的真实项目 UI 截图证据。"),
  ]
}

function runMissingEvidenceSteps(initialEvidence) {
  const latestSteps = evidenceStepsFromLatest(initialEvidence)
  return [
    initialEvidence.tabOverflowReady
      ? latestSteps[0]
      : runStep("tab_overflow", "多 Tab 标题可读", ["--tab-overflow"]),
    initialEvidence.iconVisualReady
      ? latestSteps[1]
      : runStep("icon_visual_state", "文件图标视觉状态", ["--icon-visual-state"]),
    initialEvidence.realProjectUiReady && initialEvidence.screenshotExists && initialEvidence.screenshotFresh
      ? latestSteps[2]
      : runStep("real_project_ui", "真实项目视觉截图", ["--real-project-ui"]),
  ]
}

function toMarkdown(report) {
  const checks = [
    ["Tab 溢出标题可读", report.evidence.tabOverflowReady],
    ["Explorer/Tab/Editor 图标状态可见", report.evidence.iconVisualReady],
    ["真实项目 UI smoke 通过", report.evidence.realProjectUiReady],
    ["截图文件存在", report.evidence.screenshotExists],
    ["截图验收项通过", Object.values(report.evidence.screenshotChecks).every(Boolean)],
  ]
  return [
    "# Workbench 视觉基线 Smoke",
    "",
    `- 状态：${report.ready ? "通过" : "失败"}`,
    `- 生成时间：${report.createdAt}`,
    `- 截图：${report.evidence.screenshotPath}`,
    "",
    "| 检查 | 状态 |",
    "| --- | --- |",
    ...checks.map(([title, passed]) => `| ${title} | ${passed ? "pass" : "fail"} |`),
    "",
  ].join("\n")
}

function saveReport(report) {
  fs.mkdirSync(reportDir, { recursive: true })
  const stamp = report.createdAt.replace(/[:.]/g, "-")
  const jsonPath = path.join(reportDir, `workbench-visual-baseline-${stamp}.json`)
  const mdPath = path.join(reportDir, `workbench-visual-baseline-${stamp}.md`)
  const latestJsonPath = path.join(reportDir, "workbench-visual-baseline-latest.json")
  const latestMarkdownPath = path.join(reportDir, "workbench-visual-baseline-latest.md")
  const normalized = { ...report, jsonPath, markdownPath: mdPath, latestJsonPath, latestMarkdownPath }
  fs.writeFileSync(jsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  fs.writeFileSync(mdPath, `${toMarkdown(normalized)}\n`, "utf8")
  fs.writeFileSync(latestMarkdownPath, `${toMarkdown(normalized)}\n`, "utf8")
  writeElectronSmokeResult(normalized)
  return normalized
}

function writeElectronSmokeResult(report) {
  const target = process.env.CODEK_ELECTRON_SMOKE_RESULT_FILE
  if (!target) return
  const checks = [
    { name: "visual baseline report ready", passed: report.ready === true, detail: report.status },
    { name: "visual baseline tab overflow ready", passed: report.evidence?.tabOverflowReady === true, detail: report.evidence?.tabReportPath },
    { name: "visual baseline icon visual ready", passed: report.evidence?.iconVisualReady === true, detail: report.evidence?.iconReportPath },
    { name: "visual baseline real project UI ready", passed: report.evidence?.realProjectUiReady === true, detail: report.evidence?.realUiReportPath },
    { name: "visual baseline screenshot exists", passed: report.evidence?.screenshotExists === true, detail: report.evidence?.screenshotPath },
    {
      name: "visual baseline screenshot checks pass",
      passed: Object.values(report.evidence?.screenshotChecks || {}).every(Boolean),
      detail: JSON.stringify(report.evidence?.screenshotChecks || {}),
    },
  ]
  const wrapper = {
    ok: report.ready === true,
    reportKind: "workbench-visual-baseline-smoke-result",
    visualBaselineReportPath: report.latestJsonPath,
    checks,
    error: report.ready ? null : "visual baseline blocked",
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify(wrapper, null, 2)}\n`, "utf8")
}

function main() {
  const build = ensureFrontendBuild()
  process.env.CODEK_VISUAL_BASELINE_SKIP_BUILD = "1"
  const reuseSinceMs = Math.max(
    distMtimeMs(rendererDistIndex),
    distMtimeMs(electronDistIndex),
    Number(build?.durationMs || 0) > 0 ? Date.now() : 0,
  )
  const initialEvidence = collectEvidence([], { reuseSinceMs })
  const steps = evidenceReady(initialEvidence)
    ? evidenceStepsFromLatest(initialEvidence)
    : runMissingEvidenceSteps(initialEvidence)
  const evidence = collectEvidence(steps, { reuseSinceMs })
  const ready = computeVisualBaselineReady(build, steps, evidence)
  const report = saveReport({
    reportKind: "workbench-visual-baseline-smoke",
    createdAt: new Date().toISOString(),
    ready,
    status: ready ? "ready" : "blocked",
    build,
    steps,
    evidence,
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(ready ? 0 : 1)
}

if (require.main === module) {
  main()
}

module.exports = {
  collectEvidence,
  computeVisualBaselineReady,
  evidenceReady,
  evidenceStepsFromLatest,
  isReportFreshForStep,
  parseReportTimeMs,
  runMissingEvidenceSteps,
  saveReport,
  smokeReportHasChecks,
  stepStartedAtMs,
  toMarkdown,
  writeElectronSmokeResult,
}
