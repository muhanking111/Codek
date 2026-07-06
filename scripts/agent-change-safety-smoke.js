const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const frontendRoot = path.join(root, "frontend", "vite-project")
const frontendModuleCache = new Map()

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  return {
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
  }
}

function loadFrontendSource(relativeFilePath) {
  const ts = require(path.join(root, "frontend", "vite-project", "node_modules", "typescript"))

  function loadFile(filePath) {
    const normalized = path.normalize(filePath)
    if (frontendModuleCache.has(normalized)) return frontendModuleCache.get(normalized).exports
    const source = fs.readFileSync(normalized, "utf8")
    const module = { exports: {} }
    frontendModuleCache.set(normalized, module)
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        allowJs: true,
      },
    }).outputText
    const localRequire = (request) => {
      if (request.startsWith(".")) {
        const candidate = path.resolve(path.dirname(normalized), request)
        const candidates = [
          candidate,
          `${candidate}.ts`,
          `${candidate}.js`,
          path.join(candidate, "index.ts"),
          path.join(candidate, "index.js"),
        ]
        const hit = candidates.find((item) => fs.existsSync(item))
        if (hit) return loadFile(hit)
      }
      try {
        return require(require.resolve(request, { paths: [path.join(frontendRoot, "node_modules"), frontendRoot, root] }))
      } catch {
        return require(request)
      }
    }
    const fn = new Function("require", "module", "exports", compiled)
    fn(localRequire, module, module.exports)
    return module.exports
  }

  return loadFile(path.join(frontendRoot, "src", relativeFilePath))
}

function makeCheck(id, title, passed, detail, nextAction = "") {
  return {
    id,
    title,
    status: passed ? "passed" : "failed",
    detail,
    nextAction: passed ? "" : nextAction,
  }
}

function resetState(modules) {
  modules.changeQueue.clearPendingBatches()
  modules.changeHistory.clearChanges()
  modules.fileOperations.clearFileOperations()
  modules.manager.workspace.files = {}
  modules.manager.workspace.openFiles = []
  modules.manager.workspace.activeFile = null
  modules.manager.workspace.projectRoot = null
  modules.manager.resetTextFileStates()
}

async function runPendingBatchStaleGuard(modules) {
  resetState(modules)
  modules.manager.workspace.files = { "src/app.ts": "manual user edit" }
  const batch = modules.changeQueue.queuePendingBatch({
    source: "agent",
    action: "patch",
    changes: [{
      path: "src/app.ts",
      beforeContent: "original",
      afterContent: "agent patch",
    }],
  })
  const applied = await modules.changeQueue.applyPendingBatch(batch.id)
  const remaining = modules.changeQueue.pendingChangeState.batches[0]
  const displayModel = remaining && modules.changeReviewDisplay
    ? modules.changeReviewDisplay.createChangeReviewBatchModel(remaining)
    : null
  return {
    applied,
    currentContent: modules.manager.workspace.files["src/app.ts"],
    pendingBatches: modules.changeQueue.pendingChangeState.batches.length,
    applyStatus: remaining?.applyStatus || "",
    blockReason: remaining?.blockReason || "",
    blockedPath: remaining?.blockedPath || "",
    historyEntries: modules.changeHistory.changeHistory.entries.length,
    reviewDisplay: displayModel ? {
      status: displayModel.status,
      messageTitle: displayModel.message?.title || "",
      messagePath: displayModel.message?.path || "",
      firstFileCanApply: displayModel.files?.[0]?.canApply === true,
      firstFileCanReject: displayModel.files?.[0]?.canReject === true,
      firstFileHunks: Number(displayModel.files?.[0]?.hunkCount || 0),
    } : null,
  }
}

async function runPendingHunkStaleGuard(modules) {
  resetState(modules)
  modules.manager.workspace.files = { "src/app.ts": "manual user edit" }
  const beforeContent = "const a = 1\nconst b = 2"
  const afterContent = "const a = 10\nconst b = 2"
  const batch = modules.changeQueue.queuePendingBatch({
    source: "agent",
    action: "patch",
    changes: [{ path: "src/app.ts", beforeContent, afterContent }],
  })
  const [hunk] = modules.lineDiff.computeHunks(beforeContent, afterContent)
  const applied = await modules.changeQueue.applyPendingHunk(batch.id, "src/app.ts", hunk.id)
  const remaining = modules.changeQueue.pendingChangeState.batches[0]
  return {
    applied,
    currentContent: modules.manager.workspace.files["src/app.ts"],
    pendingBatches: modules.changeQueue.pendingChangeState.batches.length,
    applyStatus: remaining?.applyStatus || "",
    blockReason: remaining?.blockReason || "",
    blockedPath: remaining?.blockedPath || "",
    historyEntries: modules.changeHistory.changeHistory.entries.length,
  }
}

async function runRollbackManualGuard(modules) {
  resetState(modules)
  modules.manager.workspace.files = { "src/app.ts": "manual user edit" }
  const entry = modules.changeHistory.recordChange({
    path: "src/app.ts",
    beforeContent: "before",
    afterContent: "agent result",
    source: "agent",
    action: "write",
  })
  const reverted = await modules.changeHistory.revertChange(entry.id)
  const operation = modules.fileOperations.fileOperationState.operations[0]
  const [operationLog] = modules.changeReviewDisplay.createOperationLogModels([operation])
  const [scmAgentChangeSet] = modules.changeReviewDisplay.createScmAgentChangeSetModels([operation, {
    id: "user-operation",
    type: "create_file",
    source: "user",
    pathAfter: "src/manual.ts",
    beforeContent: null,
    afterContent: "manual",
    riskLevel: "safe",
    applyStatus: "applied",
  }])
  return {
    reverted,
    currentContent: modules.manager.workspace.files["src/app.ts"],
    historyEntries: modules.changeHistory.changeHistory.entries.length,
    operationStatus: operation?.applyStatus || "",
    rollbackError: operation?.rollbackError || "",
    operationLog: operationLog ? {
      title: operationLog.title,
      badge: operationLog.badge,
      sourceLabel: operationLog.sourceLabel,
      primaryPath: operationLog.primaryPath,
      statusLabel: operationLog.statusLabel,
      rollbackBlocked: operationLog.rollbackBlocked,
      blockedReasonLabel: operationLog.blockedReasonLabel,
      canRevert: operationLog.canRevert,
      isGitDiff: operationLog.isGitDiff,
    } : null,
    scmAgentChangeSet: scmAgentChangeSet ? {
      title: scmAgentChangeSet.title,
      badge: scmAgentChangeSet.badge,
      sourceLabel: scmAgentChangeSet.sourceLabel,
      primaryPath: scmAgentChangeSet.primaryPath,
      statusLabel: scmAgentChangeSet.statusLabel,
      rollbackBlocked: scmAgentChangeSet.rollbackBlocked,
      blockedReasonLabel: scmAgentChangeSet.blockedReasonLabel,
      isGitDiff: scmAgentChangeSet.isGitDiff,
    } : null,
  }
}

async function buildAgentChangeSafetySmoke(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const modules = input.modules || {
    changeQueue: loadFrontendSource(path.join("workspace", "changeQueue.js")),
    changeHistory: loadFrontendSource(path.join("workspace", "changeHistory.js")),
    fileOperations: loadFrontendSource(path.join("workspace", "fileOperations.js")),
    manager: loadFrontendSource(path.join("workspace", "manager.js")),
    lineDiff: loadFrontendSource(path.join("editor", "lineDiff.ts")),
    changeReviewDisplay: loadFrontendSource(path.join("workbench", "changeReviewDisplay.ts")),
  }

  const pendingBatch = await runPendingBatchStaleGuard(modules)
  const pendingHunk = await runPendingHunkStaleGuard(modules)
  const rollback = await runRollbackManualGuard(modules)
  const checks = [
    makeCheck(
      "pending_batch_stale_guard",
      "Pending batch does not overwrite user edits",
      pendingBatch.applied === false
        && pendingBatch.currentContent === "manual user edit"
        && pendingBatch.applyStatus === "blocked"
        && pendingBatch.blockReason === "manual-change-detected"
        && pendingBatch.historyEntries === 0,
      `${pendingBatch.applyStatus || "unknown"} / ${pendingBatch.blockReason || "-"} / ${pendingBatch.blockedPath || "-"} / UI ${pendingBatch.reviewDisplay?.status || "missing"}`,
      "Keep pending patch blocked until user refreshes or requeues the agent change.",
    ),
    makeCheck(
      "change_review_blocked_display",
      "Change Review UI model exposes blocked reason and safe actions",
      pendingBatch.reviewDisplay?.status === "blocked"
        && pendingBatch.reviewDisplay?.messageTitle === "检测到用户手动修改，已暂停应用"
        && pendingBatch.reviewDisplay?.messagePath === "src/app.ts"
        && pendingBatch.reviewDisplay?.firstFileCanApply === false
        && pendingBatch.reviewDisplay?.firstFileCanReject === true
        && pendingBatch.reviewDisplay?.firstFileHunks > 0,
      `${pendingBatch.reviewDisplay?.messageTitle || "missing"} / ${pendingBatch.reviewDisplay?.messagePath || "-"} / canApply=${pendingBatch.reviewDisplay?.firstFileCanApply}`,
      "Expose blocked pending agent patches in Change Review instead of failing silently.",
    ),
    makeCheck(
      "pending_hunk_stale_guard",
      "Pending hunk does not merge over user edits",
      pendingHunk.applied === false
        && pendingHunk.currentContent === "manual user edit"
        && pendingHunk.applyStatus === "blocked"
        && pendingHunk.blockReason === "manual-change-detected"
        && pendingHunk.historyEntries === 0,
      `${pendingHunk.applyStatus || "unknown"} / ${pendingHunk.blockReason || "-"} / ${pendingHunk.blockedPath || "-"}`,
      "Keep inline hunk blocked when queued beforeContent no longer matches current content.",
    ),
    makeCheck(
      "rollback_manual_change_guard",
      "Rollback does not overwrite user edits after agent apply",
      rollback.reverted === false
        && rollback.currentContent === "manual user edit"
        && rollback.historyEntries === 1
        && rollback.operationStatus === "rollback_blocked"
        && rollback.rollbackError === "manual-change-detected",
      `${rollback.operationStatus || "unknown"} / ${rollback.rollbackError || "-"}`,
      "Show rollback blocked because the user changed the file after the agent operation.",
    ),
    makeCheck(
      "operation_log_agent_change_set_display",
      "Operation log labels agent changes separately from git diff",
      rollback.operationLog?.title === "Agent Change Set"
        && rollback.operationLog?.badge === "Agent Operation Log"
        && rollback.operationLog?.sourceLabel === "Agent"
        && rollback.operationLog?.primaryPath === "src/app.ts"
        && rollback.operationLog?.statusLabel === "Rollback blocked"
        && rollback.operationLog?.rollbackBlocked === true
        && rollback.operationLog?.blockedReasonLabel === "Manual change detected"
        && rollback.operationLog?.canRevert === false
        && rollback.operationLog?.isGitDiff === false,
      `${rollback.operationLog?.title || "missing"} / ${rollback.operationLog?.statusLabel || "-"} / ${rollback.operationLog?.primaryPath || "-"}`,
      "Render applied Agent changes through Operation Log UI models instead of mixing them with Git diff rows.",
    ),
    makeCheck(
      "scm_agent_change_set_display",
      "SCM panel model exposes agent change sets separately from git diff",
      rollback.scmAgentChangeSet?.title === "Agent Change Set"
        && rollback.scmAgentChangeSet?.badge === "Agent Operation Log"
        && rollback.scmAgentChangeSet?.sourceLabel === "Agent"
        && rollback.scmAgentChangeSet?.primaryPath === "src/app.ts"
        && rollback.scmAgentChangeSet?.statusLabel === "Rollback blocked"
        && rollback.scmAgentChangeSet?.rollbackBlocked === true
        && rollback.scmAgentChangeSet?.blockedReasonLabel === "Manual change detected"
        && rollback.scmAgentChangeSet?.isGitDiff === false,
      `${rollback.scmAgentChangeSet?.title || "missing"} / ${rollback.scmAgentChangeSet?.statusLabel || "-"} / ${rollback.scmAgentChangeSet?.primaryPath || "-"}`,
      "Show Agent Change Sets inside Source Control without mixing them into regular Git file rows.",
    ),
  ]
  const summary = {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    warning: 0,
    failed: checks.filter((check) => check.status === "failed").length,
  }
  return {
    reportKind: "agent-change-safety-smoke",
    createdAt,
    ready: summary.failed === 0,
    status: summary.failed === 0 ? "ready" : "blocked",
    statusLabel: summary.failed === 0 ? "Agent change safety smoke ready" : "Agent change safety smoke blocked",
    summary,
    checks,
    evidence: {
      pendingBatch,
      pendingHunk,
      rollback,
    },
  }
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((check) =>
    `| ${escapeCell(check.title)} | ${check.status} | ${escapeCell(check.detail)} | ${escapeCell(check.nextAction || "-")} |`,
  )
  return [
    "# Agent Change Safety Smoke",
    "",
    `- Status: ${report.statusLabel || report.status}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Created At: ${new Date(report.createdAt || Date.now()).toISOString()}`,
    `- Summary: ${report.summary?.passed || 0}/${report.summary?.total || 0} passed`,
    `- Latest JSON: ${report.latestJsonPath || report.jsonPath || "-"}`,
    `- Latest Markdown: ${report.latestMarkdownPath || report.markdownPath || "-"}`,
    "",
    "| Check | Status | Detail | Next Action |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## Evidence",
    "",
    `- Pending batch: ${report.evidence?.pendingBatch?.applyStatus || "-"} / ${report.evidence?.pendingBatch?.blockReason || "-"}`,
    `- Change Review display: ${report.evidence?.pendingBatch?.reviewDisplay?.status || "-"} / ${report.evidence?.pendingBatch?.reviewDisplay?.messageTitle || "-"}`,
    `- Pending hunk: ${report.evidence?.pendingHunk?.applyStatus || "-"} / ${report.evidence?.pendingHunk?.blockReason || "-"}`,
    `- Rollback: ${report.evidence?.rollback?.operationStatus || "-"} / ${report.evidence?.rollback?.rollbackError || "-"}`,
    `- Operation log: ${report.evidence?.rollback?.operationLog?.title || "-"} / ${report.evidence?.rollback?.operationLog?.statusLabel || "-"}`,
  ].join("\n")
}

function saveAgentChangeSafetySmoke(report, options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  fs.mkdirSync(reportDir, { recursive: true })
  const historyDir = path.join(reportDir, "history")
  fs.mkdirSync(historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const jsonPath = path.join(reportDir, "agent-change-safety-smoke-latest.json")
  const markdownPath = path.join(reportDir, "agent-change-safety-smoke-latest.md")
  const historyJsonPath = path.join(historyDir, `agent-change-safety-smoke-${stamp}.json`)
  const historyMarkdownPath = path.join(historyDir, `agent-change-safety-smoke-${stamp}.md`)
  const latestReport = {
    ...report,
    jsonPath,
    markdownPath,
    latestJsonPath: jsonPath,
    latestMarkdownPath: markdownPath,
    historyJsonPath,
    historyMarkdownPath,
  }
  const historyReport = {
    ...latestReport,
    jsonPath: historyJsonPath,
    markdownPath: historyMarkdownPath,
  }
  const markdown = toMarkdown(latestReport)
  fs.writeFileSync(jsonPath, `${JSON.stringify(latestReport, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, `${markdown}\n`, "utf8")
  fs.writeFileSync(historyJsonPath, `${JSON.stringify(historyReport, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMarkdownPath, `${markdown}\n`, "utf8")
  return { report: latestReport, jsonPath, markdownPath, historyJsonPath, historyMarkdownPath, markdown }
}

function readLatestAgentChangeSafetySmoke(options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const jsonPath = path.join(reportDir, "agent-change-safety-smoke-latest.json")
  const markdownPath = path.join(reportDir, "agent-change-safety-smoke-latest.md")
  if (!fs.existsSync(jsonPath)) return { report: null, jsonPath, markdownPath, markdown: "" }
  const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"))
  return {
    report,
    jsonPath,
    markdownPath,
    markdown: fs.existsSync(markdownPath) ? fs.readFileSync(markdownPath, "utf8") : "",
  }
}

function escapeCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await buildAgentChangeSafetySmoke()
  const output = options.noWrite ? { report, markdown: toMarkdown(report) } : saveAgentChangeSafetySmoke(report, options)
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    jsonPath: output.jsonPath || "",
    markdownPath: output.markdownPath || "",
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
  buildAgentChangeSafetySmoke,
  defaultReportDir,
  parseArgs,
  readLatestAgentChangeSafetySmoke,
  saveAgentChangeSafetySmoke,
  toMarkdown,
}
