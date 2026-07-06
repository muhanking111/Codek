#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")
const fixtureRoot = path.join(root, ".codek", "large-file-256mb-fixture")
const reportsDir = path.join(root, ".codek", "reports")
const persistentLargeFileRelativePath = "large-260mb.log"
const largeFilePath = path.join(fixtureRoot, persistentLargeFileRelativePath)
const bytes = Number(process.env.CODEK_LARGE_FILE_SMOKE_BYTES || 260 * 1024 * 1024)
const minimumWindowLineCount = 100_000
const largeFileMarker = "codek smoke large log line keeps renderer rows bounded-v2"

if (!Number.isFinite(bytes) || bytes < 256 * 1024 * 1024) {
  throw new Error("CODEK_LARGE_FILE_SMOKE_BYTES must be at least 256 MiB")
}

function ensureFixtureWorkspace() {
  fs.mkdirSync(path.join(fixtureRoot, "frontend", "vite-project", "src"), { recursive: true })
  fs.writeFileSync(path.join(fixtureRoot, "package.json"), JSON.stringify({
    name: "codek-large-file-smoke-fixture",
    private: true,
  }, null, 2), "utf8")
  fs.writeFileSync(
    path.join(fixtureRoot, "frontend", "vite-project", "src", "App.vue"),
    [
      "<template>",
      "  <main>Codek 260MiB large file smoke fixture</main>",
      "</template>",
      "",
      "<script setup>",
      "const codekLargeFileSmoke = true",
      "</script>",
      "",
    ].join("\n"),
    "utf8",
  )
}

function countNewLines(buffer) {
  let count = 0
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 10) count += 1
  }
  return count
}

function shouldRebuildLargeFileFixture() {
  if (!fs.existsSync(largeFilePath)) return true
  const stat = fs.statSync(largeFilePath)
  if (stat.size !== bytes) return true
  const fd = fs.openSync(largeFilePath, "r")
  try {
    const sampleLength = Math.min(32 * 1024 * 1024, stat.size)
    const sample = Buffer.alloc(sampleLength)
    fs.readSync(fd, sample, 0, sampleLength, 0)
    if (!sample.includes(Buffer.from(largeFileMarker))) return true
    return countNewLines(sample) < minimumWindowLineCount
  } finally {
    fs.closeSync(fd)
  }
}

function writeLargeFileFixture() {
  const linePrefix = `line 000000 ${largeFileMarker} `
  const line = `${linePrefix}${"x".repeat(Math.max(0, 255 - linePrefix.length))}\n`
  const chunk = Buffer.from(line.repeat(4096), "utf8")
  const fd = fs.openSync(largeFilePath, "w")
  try {
    let written = 0
    while (written < bytes) {
      const next = Math.min(chunk.length, bytes - written)
      fs.writeSync(fd, chunk, 0, next)
      written += next
    }
  } finally {
    fs.closeSync(fd)
  }
}

const reportPath = path.join(reportsDir, "workbench-large-file-256mb-real-project-ui-latest.json")

function readLatestReport() {
  try {
    return JSON.parse(fs.readFileSync(reportPath, "utf8"))
  } catch {
    return null
  }
}

function isExpectedFixtureReport(report, expectedFixtureRoot = fixtureRoot) {
  const actual = String(report?.projectRoot || "").replace(/\\/g, "/").replace(/\/+$/, "")
  const expected = String(expectedFixtureRoot || "").replace(/\\/g, "/").replace(/\/+$/, "")
  return actual === expected
}

function collectReportFailures(report, options = {}) {
  const expectedFixtureRoot = options.expectedFixtureRoot || fixtureRoot
  const expectedBytes = Number(options.bytes || bytes)
  const runStartedAtMs = Number(options.runStartedAtMs || 0)
  const failures = []
  if (!report) return ["real project UI evidence report was not written"]
  if (!isExpectedFixtureReport(report, expectedFixtureRoot)) {
    failures.push(`report projectRoot mismatch: ${report?.projectRoot || "<missing>"}`)
  }
  const createdAt = Date.parse(String(report?.createdAt || ""))
  if (!Number.isFinite(createdAt) || createdAt + 5000 < runStartedAtMs) {
    failures.push(`report is stale or missing createdAt: ${report?.createdAt || "<missing>"}`)
  }
  if (report.ready !== true) failures.push("report.ready is not true")
  const acceptance = report?.acceptance || {}
  const failedAcceptance = Object.entries(acceptance)
    .filter(([, passed]) => passed !== true)
    .map(([key]) => key)
  if (Object.keys(acceptance).length === 0) {
    failures.push("acceptance is missing")
  } else if (failedAcceptance.length > 0) {
    failures.push(`acceptance failed: ${failedAcceptance.join(", ")}`)
  }
  const metrics = report?.metrics || {}
  const requireTrue = [
    "largeFileRealContentVisible",
    "largeFileViewportTextVisible",
    "largeFileDeepViewportTextVisible",
    "largeFileNextWindowViewportTextVisible",
    "largeFileUserPageDownViewportTextVisible",
    "largeFileUserScrollBottomLoaded",
    "largeFileUserScrollBottomOffsetAdvanced",
    "largeFileUserScrollBottomViewportTextVisible",
    "largeFileUserScrollbarDragDispatched",
    "largeFileUserScrollbarDragScrollAdvanced",
    "largeFileUserScrollbarDragLoaded",
    "largeFileUserScrollbarDragOffsetAdvanced",
    "largeFileUserScrollbarDragViewportTextVisible",
    "largeFileUserEndViewportTextVisible",
    "largeFileFinalWindowViewportTextVisible",
    "largeFileReopenViewportTextVisible",
    "largeFileReopenRealContentVisible",
    "largeFileContinuousWindowVisible",
    "largeFileRangeStateVisible",
    "largeFileNextWindowLoaded",
    "largeFileNextWindowVisible",
    "largeFileFinalWindowLoaded",
    "largeFileFinalWindowVisible",
    "extremeFileAutoWindowNavigation",
  ]
  for (const key of requireTrue) {
    if (metrics[key] !== true) failures.push(`${key} is not true`)
  }
  if (Number(metrics.largeFileEditorLineCount || 0) < minimumWindowLineCount) {
    failures.push(`largeFileEditorLineCount ${metrics.largeFileEditorLineCount || 0} < ${minimumWindowLineCount}`)
  }
  const minWindowBytes = Math.min(expectedBytes, 32 * 1024 * 1024)
  if (Number(metrics.largeFileEditorValueLength || 0) < minWindowBytes) {
    failures.push(`largeFileEditorValueLength ${metrics.largeFileEditorValueLength || 0} < ${minWindowBytes}`)
  }
  const heapOperationGuardBytes = 256 * 1024 * 1024
  const editorValueLength = Number(metrics.largeFileEditorValueLength || 0)
  const activeFileContentLength = Number(metrics.largeFileActiveFileContentLength || 0)
  if (editorValueLength >= heapOperationGuardBytes) {
    failures.push(`largeFileEditorValueLength ${editorValueLength} >= VS Code heap-operation guard ${heapOperationGuardBytes}`)
  }
  if (activeFileContentLength >= heapOperationGuardBytes) {
    failures.push(`largeFileActiveFileContentLength ${activeFileContentLength} >= VS Code heap-operation guard ${heapOperationGuardBytes}`)
  }
  if (Number(metrics.largeFileActiveFileContentLength || 0) < minWindowBytes) {
    failures.push(`largeFileActiveFileContentLength ${metrics.largeFileActiveFileContentLength || 0} < ${minWindowBytes}`)
  }
  if (Number(metrics.largeFileRangeStateBytesRead || 0) < minWindowBytes) {
    failures.push(`largeFileRangeStateBytesRead ${metrics.largeFileRangeStateBytesRead || 0} < ${minWindowBytes}`)
  }
  if (Number(metrics.largeFileRangeStateWindowBytes || 0) < minWindowBytes) {
    failures.push(`largeFileRangeStateWindowBytes ${metrics.largeFileRangeStateWindowBytes || 0} < ${minWindowBytes}`)
  }
  if (metrics.largeFileWindowNavigationRequired !== true) {
    failures.push("largeFileWindowNavigationRequired is not true for the 260MiB byte-window fixture")
  }
  if (metrics.largeFileRangeStateReadOnly === true) {
    failures.push("largeFileRangeStateReadOnly is true")
  }
  if (Number(metrics.largeFileDeepViewportLine || 0) < 2000) {
    failures.push(`largeFileDeepViewportLine ${metrics.largeFileDeepViewportLine || 0} < 2000`)
  }
  const deepRequestedLine = Number(metrics.largeFileDeepViewportLine || 0)
  const deepEditorViewport = metrics.largeFileDeepViewportProbe?.editorViewport || {}
  const deepVisibleRanges = Array.isArray(deepEditorViewport.visibleRanges) ? deepEditorViewport.visibleRanges : []
  const deepVisibleStartLine = Number(deepVisibleRanges[0]?.startLineNumber || 0)
  const deepVisibleEndLine = Number(deepVisibleRanges[0]?.endLineNumber || 0)
  const deepPositionLine = Number(deepEditorViewport.position?.lineNumber || 0)
  const deepVisibleNonEmptyLineCount = Number(metrics.largeFileDeepViewportProbe?.visibleNonEmptyViewLineCount || 0)
  if (deepRequestedLine >= 2000) {
    const expectedMinimumLine = Math.max(1, deepRequestedLine - 120)
    const expectedPositionLine = Math.max(1, deepRequestedLine - 20)
    if (!Number.isFinite(deepPositionLine) || deepPositionLine < expectedPositionLine) {
      failures.push(`largeFileDeepViewportProbe.editorViewport.position.lineNumber ${deepPositionLine || 0} < ${expectedPositionLine}`)
    }
    if (!Number.isFinite(deepVisibleEndLine) || deepVisibleEndLine < expectedMinimumLine) {
      failures.push(`largeFileDeepViewportProbe.editorViewport.visibleRanges[0].endLineNumber ${deepVisibleEndLine || 0} < ${expectedMinimumLine}`)
    }
    if (!Number.isFinite(deepVisibleStartLine) || deepVisibleStartLine <= 1) {
      failures.push(`largeFileDeepViewportProbe.editorViewport.visibleRanges[0].startLineNumber ${deepVisibleStartLine || 0} did not move past the top`)
    }
    if (!Number.isFinite(deepVisibleNonEmptyLineCount) || deepVisibleNonEmptyLineCount <= 0) {
      failures.push(`largeFileDeepViewportProbe.visibleNonEmptyViewLineCount ${deepVisibleNonEmptyLineCount || 0} <= 0`)
    }
  }
  if (!String(metrics.largeFileDeepViewportTextSample || "").includes(largeFileMarker)) {
    failures.push("largeFileDeepViewportTextSample does not include the large-file marker")
  }
  if (!String(metrics.largeFileNextWindowViewportTextSample || "").includes(largeFileMarker)) {
    failures.push("largeFileNextWindowViewportTextSample does not include the large-file marker")
  }
  if (!String(metrics.largeFileUserPageDownViewportTextSample || "").includes(largeFileMarker)) {
    failures.push("largeFileUserPageDownViewportTextSample does not include the large-file marker")
  }
  if (!String(metrics.largeFileUserScrollBottomViewportTextSample || "").includes(largeFileMarker)) {
    failures.push("largeFileUserScrollBottomViewportTextSample does not include the large-file marker")
  }
  if (!String(metrics.largeFileUserScrollbarDragViewportTextSample || "").includes(largeFileMarker)) {
    failures.push("largeFileUserScrollbarDragViewportTextSample does not include the large-file marker")
  }
  if (!String(metrics.largeFileUserEndViewportTextSample || "").includes(largeFileMarker)) {
    failures.push("largeFileUserEndViewportTextSample does not include the large-file marker")
  }
  if (!String(metrics.largeFileFinalWindowViewportTextSample || "").includes(largeFileMarker)) {
    failures.push("largeFileFinalWindowViewportTextSample does not include the large-file marker")
  }
  if (!String(metrics.largeFileReopenViewportTextSample || "").includes(largeFileMarker)) {
    failures.push("largeFileReopenViewportTextSample does not include the large-file marker")
  }
  if (metrics.largeFileFinalWindowHasNext !== false) {
    failures.push("largeFileFinalWindowHasNext is not false")
  }
  const finalWindowOffset = Number(metrics.largeFileFinalWindowOffset || 0)
  const finalWindowBytes = Number(metrics.largeFileFinalWindowWindowBytes || metrics.largeFileFinalWindowBytesRead || 0)
  const finalWindowSize = Number(metrics.largeFileFinalWindowSize || metrics.largeFileRangeStateSize || expectedBytes)
  if (finalWindowSize > 0 && finalWindowBytes > 0 && finalWindowOffset + finalWindowBytes < finalWindowSize) {
    failures.push(`largeFileFinalWindowOffset ${finalWindowOffset} + bytes ${finalWindowBytes} < size ${finalWindowSize}`)
  }
  if (!Array.isArray(metrics.largeFileFinalWindowVisitedOffsets) || metrics.largeFileFinalWindowVisitedOffsets.length < 2) {
    failures.push("largeFileFinalWindowVisitedOffsets did not prove multi-window traversal")
  }
  const userScrollTargetOffset = Number(metrics.largeFileUserScrollTargetOffset || 0)
  const userScrollBottomOffset = Number(metrics.largeFileUserScrollBottomOffset || 0)
  if (userScrollTargetOffset > 0 && userScrollBottomOffset < userScrollTargetOffset) {
    failures.push(`largeFileUserScrollBottomOffset ${userScrollBottomOffset} < target ${userScrollTargetOffset}`)
  }
  const userDragTargetOffset = Number(metrics.largeFileUserScrollbarDragTargetOffset || 0)
  const userDragOffset = Number(metrics.largeFileUserScrollbarDragOffset || 0)
  const userDragScrollBefore = Number(metrics.largeFileUserScrollbarDragScrollBefore || 0)
  const userDragScrollAfter = Number(metrics.largeFileUserScrollbarDragScrollAfter || 0)
  if (metrics.largeFileUserScrollbarDragDirectLoadRequired !== false && metrics.largeFileUserScrollbarDragDirectLoaded !== true) {
    failures.push("largeFileUserScrollbarDragDirectLoaded is not true while direct load is required")
  }
  if (metrics.largeFileUserScrollbarDragScrollAdvanced === true && userDragScrollAfter <= userDragScrollBefore) {
    failures.push(`largeFileUserScrollbarDragScrollAfter ${userDragScrollAfter} <= before ${userDragScrollBefore}`)
  }
  if (userDragTargetOffset > 0 && userDragOffset < userDragTargetOffset) {
    failures.push(`largeFileUserScrollbarDragOffset ${userDragOffset} < target ${userDragTargetOffset}`)
  }
  return failures
}

function replaySmokeOutput(outputPath) {
  try {
    process.stdout.write(fs.readFileSync(outputPath, "utf8"))
  } catch {
    // Diagnostic output only; keep the original smoke status.
  }
}

function runElectronSmoke() {
  ensureFixtureWorkspace()
  if (shouldRebuildLargeFileFixture()) {
    writeLargeFileFixture()
  }

  const env = {
    ...process.env,
    CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT: fixtureRoot,
    CODEK_ELECTRON_SMOKE_REAL_PROJECT_LARGE_FILE_BYTES: String(bytes),
    CODEK_ELECTRON_SMOKE_REAL_PROJECT_LARGE_FILE_RELATIVE: persistentLargeFileRelativePath,
    CODEK_ELECTRON_SMOKE_REAL_PROJECT_FOCUSED_LARGE_FILE: "1",
    CODEK_ELECTRON_SMOKE_REAL_PROJECT_SKIP_CREATE_TARGET: "1",
    CODEK_ELECTRON_SMOKE_TIMEOUT_MS: process.env.CODEK_ELECTRON_SMOKE_TIMEOUT_MS || "180000",
  }

  fs.mkdirSync(reportsDir, { recursive: true })
  const runStartedAtMs = Date.now()
  const outputPath = path.join(reportsDir, "workbench-large-file-256mb-smoke-output.log")
  const outputFd = fs.openSync(outputPath, "w")
  let result
  try {
    result = spawnSync(process.execPath, [
      path.join(root, "scripts", "electron-ui-smoke.js"),
      "--real-project-ui",
    ], {
      cwd: root,
      env,
      stdio: ["ignore", outputFd, outputFd],
    })
  } finally {
    fs.closeSync(outputFd)
  }

  return { outputPath, result, runStartedAtMs }
}

function main() {
  const { outputPath, result, runStartedAtMs } = runElectronSmoke()
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }

  const status = typeof result.status === "number" ? result.status : 1
  replaySmokeOutput(outputPath)
  if (status !== 0) {
    process.exit(status)
  }

  const report = readLatestReport()
  const failures = collectReportFailures(report, { runStartedAtMs })
  if (failures.length > 0) {
    console.error("[large-file-256mb-smoke] hard gate failed:")
    for (const failure of failures) console.error(`- ${failure}`)
    process.exit(1)
  }

  const metrics = report.metrics || {}
  console.log("[large-file-256mb-smoke] hard gate passed")
  console.log(JSON.stringify({
    report: reportPath,
    output: outputPath,
    largeFileEditorLineCount: metrics.largeFileEditorLineCount,
    largeFileEditorValueLength: metrics.largeFileEditorValueLength,
    largeFileActiveFileContentLength: metrics.largeFileActiveFileContentLength,
    largeFileRendererHeapGuardBytes: 256 * 1024 * 1024,
    largeFileRendererHeapGuardPassed: Number(metrics.largeFileEditorValueLength || 0) < 256 * 1024 * 1024
      && Number(metrics.largeFileActiveFileContentLength || 0) < 256 * 1024 * 1024,
    largeFileOptimizedStateVisible: metrics.largeFileOptimizedStateVisible === true,
    largeFileOptimizedStateBytesRead: metrics.largeFileOptimizedStateBytesRead,
    largeFileRangeStateVisible: metrics.largeFileRangeStateVisible === true,
    largeFileRangeStateBytesRead: metrics.largeFileRangeStateBytesRead,
    largeFileRangeStateWindowBytes: metrics.largeFileRangeStateWindowBytes,
    largeFileViewportTextVisible: metrics.largeFileViewportTextVisible === true,
    largeFileDeepViewportTextVisible: metrics.largeFileDeepViewportTextVisible === true,
    largeFileDeepViewportLine: metrics.largeFileDeepViewportLine,
    largeFileDeepViewportFirstVisibleLineNumber: metrics.largeFileDeepViewportFirstVisibleLineNumber,
    largeFileDeepViewportLastVisibleLineNumber: metrics.largeFileDeepViewportLastVisibleLineNumber,
    largeFileNextWindowViewportTextVisible: metrics.largeFileNextWindowViewportTextVisible === true,
    largeFileUserPageDownViewportTextVisible: metrics.largeFileUserPageDownViewportTextVisible === true,
    largeFileUserScrollBottomLoaded: metrics.largeFileUserScrollBottomLoaded === true,
    largeFileUserScrollBottomOffsetAdvanced: metrics.largeFileUserScrollBottomOffsetAdvanced === true,
    largeFileUserScrollBottomViewportTextVisible: metrics.largeFileUserScrollBottomViewportTextVisible === true,
    largeFileUserScrollbarDragDispatched: metrics.largeFileUserScrollbarDragDispatched === true,
    largeFileUserScrollbarDragScrollBefore: metrics.largeFileUserScrollbarDragScrollBefore,
    largeFileUserScrollbarDragScrollAfter: metrics.largeFileUserScrollbarDragScrollAfter,
    largeFileUserScrollbarDragScrollAdvanced: metrics.largeFileUserScrollbarDragScrollAdvanced === true,
    largeFileUserScrollbarDragDirectLoadRequired: metrics.largeFileUserScrollbarDragDirectLoadRequired,
    largeFileUserScrollbarDragDirectLoaded: metrics.largeFileUserScrollbarDragDirectLoaded === true,
    largeFileUserScrollbarDragLoaded: metrics.largeFileUserScrollbarDragLoaded === true,
    largeFileUserScrollbarDragOffsetAdvanced: metrics.largeFileUserScrollbarDragOffsetAdvanced === true,
    largeFileUserScrollbarDragViewportTextVisible: metrics.largeFileUserScrollbarDragViewportTextVisible === true,
    largeFileUserEndViewportTextVisible: metrics.largeFileUserEndViewportTextVisible === true,
    largeFileUserScrollBeforeOffset: metrics.largeFileUserScrollBeforeOffset,
    largeFileUserScrollTargetOffset: metrics.largeFileUserScrollTargetOffset,
    largeFileUserScrollBottomOffset: metrics.largeFileUserScrollBottomOffset,
    largeFileUserScrollbarDragTargetOffset: metrics.largeFileUserScrollbarDragTargetOffset,
    largeFileUserScrollbarDragOffset: metrics.largeFileUserScrollbarDragOffset,
    largeFileUserScrollEndOffset: metrics.largeFileUserScrollEndOffset,
    largeFileFinalWindowViewportTextVisible: metrics.largeFileFinalWindowViewportTextVisible === true,
    largeFileFinalWindowOffset: metrics.largeFileFinalWindowOffset,
    largeFileFinalWindowWindowBytes: metrics.largeFileFinalWindowWindowBytes,
    largeFileFinalWindowSize: metrics.largeFileFinalWindowSize,
    largeFileFinalWindowHasNext: metrics.largeFileFinalWindowHasNext,
    largeFileFinalWindowHasNextGatePassed: metrics.largeFileFinalWindowHasNext === false,
    largeFileFinalWindowVisitedOffsets: metrics.largeFileFinalWindowVisitedOffsets,
    largeFileReopenViewportTextVisible: metrics.largeFileReopenViewportTextVisible === true,
    largeFileNextWindowVisible: metrics.largeFileNextWindowVisible === true,
    largeFileWindowNavigationRequired: metrics.largeFileWindowNavigationRequired === true,
    extremeFileAutoWindowNavigation: metrics.extremeFileAutoWindowNavigation === true,
  }, null, 2))
}

if (require.main === module) {
  main()
}

module.exports = {
  collectReportFailures,
  ensureFixtureWorkspace,
  isExpectedFixtureReport,
  largeFileMarker,
  minimumWindowLineCount,
}
