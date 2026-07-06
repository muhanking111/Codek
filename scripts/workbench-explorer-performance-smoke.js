const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const frontendRoot = path.join(root, "frontend", "vite-project")
const { JSDOM } = require(path.join(frontendRoot, "node_modules", "jsdom"))
const moduleCache = new Map()

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const scenarioArg = argv.find((arg) => arg.startsWith("--scenario="))
  return {
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
    scenario: scenarioArg ? scenarioArg.slice("--scenario=".length) : "all",
  }
}

function loadFrontendTs(filePath) {
  const normalizedFilePath = path.resolve(filePath)
  if (moduleCache.has(normalizedFilePath)) return moduleCache.get(normalizedFilePath).exports
  const ts = require(path.join(frontendRoot, "node_modules", "typescript"))
  const source = fs.readFileSync(normalizedFilePath, "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} }
  moduleCache.set(normalizedFilePath, module)
  const localRequire = (request) => {
    const rawRequest = typeof request === "string" && request.endsWith("?raw")
      ? request.slice(0, -"?raw".length)
      : ""
    if (request.startsWith(".")) {
      const target = path.resolve(path.dirname(normalizedFilePath), rawRequest || request)
      if (rawRequest) return fs.readFileSync(target, "utf8")
      const withTs = target.endsWith(".ts") ? target : `${target}.ts`
      const withJs = target.endsWith(".js") ? target : `${target}.js`
      if (fs.existsSync(withTs)) return loadFrontendTs(withTs)
      if (fs.existsSync(withJs)) return require(withJs)
    }
    return require(require.resolve(request, { paths: [frontendRoot] }))
  }
  new Function("require", "module", "exports", compiled)(localRequire, module, module.exports)
  return module.exports
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

function percentile(values, ratio) {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]
}

function setupDom() {
  const previousGlobals = {
    window: global.window,
    document: global.document,
    HTMLElement: global.HTMLElement,
    MouseEvent: global.MouseEvent,
    KeyboardEvent: global.KeyboardEvent,
    performance: global.performance,
    requestAnimationFrame: global.requestAnimationFrame,
    cancelAnimationFrame: global.cancelAnimationFrame,
  }
  const dom = new JSDOM("<!doctype html><html><body><div id=\"host\"></div></body></html>", {
    pretendToBeVisual: true,
  })
  global.window = dom.window
  global.document = dom.window.document
  global.HTMLElement = dom.window.HTMLElement
  global.MouseEvent = dom.window.MouseEvent
  global.KeyboardEvent = dom.window.KeyboardEvent
  global.performance = dom.window.performance
  global.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0)
  global.cancelAnimationFrame = (handle) => clearTimeout(handle)
  return { dom, previousGlobals }
}

function teardownDom(context) {
  const { dom, previousGlobals } = context
  dom.window.close()
  for (const [key, value] of Object.entries(previousGlobals)) {
    if (value === undefined) delete global[key]
    else global[key] = value
  }
}

function buildSyntheticEntries(count) {
  return Array.from({ length: count }, (_, index) => ({
    name: `file-${String(index).padStart(6, "0")}.ts`,
    path: `D:/repo/src/file-${String(index).padStart(6, "0")}.ts`,
    isFile: true,
    size: 128,
  }))
}

function buildWideDirectoryEntries(dirCount, filesPerDir) {
  const entriesByUri = {
    "D:/repo": [{ name: "workspace", path: "D:/repo/workspace", isDirectory: true }],
    "D:/repo/workspace": Array.from({ length: dirCount }, (_, dirIndex) => ({
      name: `dir-${dirIndex}`,
      path: `D:/repo/workspace/dir-${dirIndex}`,
      isDirectory: true,
    })),
  }
  for (let dirIndex = 0; dirIndex < dirCount; dirIndex += 1) {
    entriesByUri[`D:/repo/workspace/dir-${dirIndex}`] = Array.from({ length: filesPerDir }, (_, fileIndex) => ({
      name: `file-${fileIndex}.ts`,
      path: `D:/repo/workspace/dir-${dirIndex}/file-${fileIndex}.ts`,
      isFile: true,
    }))
  }
  return entriesByUri
}

async function runHostScenario() {
  const domContext = setupDom()
  try {
    const { ExplorerTreeHost } = loadFrontendTs(path.join(frontendRoot, "src", "explorer", "tree", "ExplorerTreeHost.ts"))
    const hostElement = document.getElementById("host")
    Object.defineProperty(hostElement, "clientHeight", { value: 480, configurable: true })
    const readDirCalls = []
    const entriesByUri = {
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": buildSyntheticEntries(100_000),
    }
    const host = new ExplorerTreeHost({
      container: hostElement,
      rowHeight: 24,
      readDir: async (uri) => {
        readDirCalls.push(uri)
        return entriesByUri[uri] || []
      },
    })

    const startHeap = process.memoryUsage().heapUsed
    const start = Date.now()
    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
    })
    await host.expandPath("D:/repo/src")
    const firstDisplayMs = Date.now() - start
    const stableItemBefore = host.model.getItem("D:/repo/src/file-099999.ts")
    const selectionUpdateStart = Date.now()
    await host.update({
      projectRoot: "D:/repo",
      workspaceRoots: ["D:/repo"],
      activeFile: "src/file-099999.ts",
    })
    const selectionUpdateMs = Date.now() - selectionUpdateStart
    const selectionReusedItem = host.model.getItem("D:/repo/src/file-099999.ts") === stableItemBefore

    const frameTimes = []
    for (let index = 0; index < 180; index += 1) {
      const frameStart = Date.now()
      await host.revealPath(`D:/repo/src/file-${String(Math.min(99_999, index * 557)).padStart(6, "0")}.ts`)
      frameTimes.push(Date.now() - frameStart)
    }
    const domRows = hostElement.querySelectorAll("[data-codek-explorer-row]").length
    const endHeap = process.memoryUsage().heapUsed
    const maxFrameMs = Math.max(...frameTimes)
    const p95FrameMs = percentile(frameTimes, 0.95)
    const longTasks = frameTimes.filter((value) => value > 50).length
    const renderedAfterScroll = host.getRenderedRowCount()

    host.dispose()

    return {
      firstDisplayMs,
      domRows,
      renderedAfterScroll,
      frameTimes,
      maxFrameMs,
      p95FrameMs,
      longTasks,
      readDirCalls,
      heapDeltaBytes: endHeap - startHeap,
      selectionUpdateMs,
      selectionReusedItem,
    }
  } finally {
    teardownDom(domContext)
  }
}

async function runExpandScenario() {
  const domContext = setupDom()
  try {
    const { ExplorerTreeHost } = loadFrontendTs(path.join(frontendRoot, "src", "explorer", "tree", "ExplorerTreeHost.ts"))
    const hostElement = document.getElementById("host")
    Object.defineProperty(hostElement, "clientHeight", { value: 480, configurable: true })
    const entriesByUri = buildWideDirectoryEntries(1, 1_000)
    const host = new ExplorerTreeHost({
      container: hostElement,
      rowHeight: 24,
      readDir: async (uri) => entriesByUri[uri] || [],
    })
    const start = Date.now()
    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
    await host.expandPath("D:/repo/workspace")
    await host.expandPath("D:/repo/workspace/dir-0")
    const expandLatencyMs = Date.now() - start
    const domRows = hostElement.querySelectorAll("[data-codek-explorer-row]").length
    host.dispose()
    return { expandLatencyMs, domRows }
  } finally {
    teardownDom(domContext)
  }
}

function runStaticAudit() {
  const fileTreePath = path.join(frontendRoot, "src", "components", "FileTree.vue")
  const rendererPath = path.join(frontendRoot, "src", "explorer", "tree", "ExplorerRenderer.ts")
  const hostPath = path.join(frontendRoot, "src", "explorer", "tree", "ExplorerTreeHost.ts")
  const managerPath = path.join(frontendRoot, "src", "workspace", "manager.js")
  const appPath = path.join(frontendRoot, "src", "App.vue")
  const desktopMainPath = path.join(root, "desktop", "main.js")
  const fileTreeSource = fs.readFileSync(fileTreePath, "utf8")
  const rendererSource = fs.readFileSync(rendererPath, "utf8")
  const hostSource = fs.readFileSync(hostPath, "utf8")
  const managerSource = fs.readFileSync(managerPath, "utf8")
  const appSource = fs.readFileSync(appPath, "utf8")
  const desktopMainSource = fs.readFileSync(desktopMainPath, "utf8")
  const listDirHandler = desktopMainSource.split('ipcMain.handle("fs:listDir"')[1]?.split('ipcMain.handle("fs:delete"')[0] || ""
  const realFsBlock = fileTreeSource.split('<div v-if="!isRealFS" class="memory-files">')[0] || fileTreeSource
  return {
    fileTreeNoRealFsTreeNode: !realFsBlock.includes("<TreeNode") && !realFsBlock.includes("v-for=\"item in visibleWindow.items\""),
    fileTreeNoVisibleTreeImport: !fileTreeSource.includes("visibleTree") && !fileTreeSource.includes("getVisibleTreeWindowFromTree"),
    fileTreeNoRecursiveFilter: !fileTreeSource.includes("function filterTree"),
    nativeHostMarker: fileTreeSource.includes('data-codek-smoke="native-explorer-host"'),
    refreshDoesNotReopenActiveFile: !/refreshFileTree[\s\S]*previousActive[\s\S]*openFile/.test(managerSource),
    hostNoLegacyTreeInput: !hostSource.includes("LegacyTreeEntry") && !hostSource.includes("fromLegacyEntry") && !hostSource.includes("readLegacyChildren"),
    managerNoRecursiveTreeWalk: !managerSource.includes("walkDir(") && !managerSource.includes("makeLimitNode") && !managerSource.includes("setDirOpen"),
    openFileDoesNotAutoReveal: !/handleOpenFile[\s\S]{0,500}revealPath/.test(appSource),
    rendererNoAsciiBadges: !rendererSource.includes("[+]") && !rendererSource.includes("[-]"),
    desktopOpenProjectSchedulesWatcher: desktopMainSource.includes("function scheduleFileWatcher")
      && desktopMainSource.includes("createPendingWorkspaceScaleProfile")
      && desktopMainSource.includes("WATCHER_START_IDLE_MS"),
    desktopListDirDefersExpandedWatch: listDirHandler.includes("scheduleExpandedDirectoryWatch")
      && !listDirHandler.includes("watchExpandedDirectory(g.resolved)"),
  }
}

async function runSmoke() {
  const hostMetrics = await runHostScenario()
  const expandMetrics = await runExpandScenario()
  const staticAudit = runStaticAudit()
  const checks = [
    makeCheck("dom_rows_100k", "100k synthetic nodes keep bounded DOM rows", hostMetrics.domRows <= 120, `${hostMetrics.domRows} rows`, "Check CodekListView row pooling"),
    makeCheck("first_display_100k", "100k synthetic nodes first display stays under 800ms", hostMetrics.firstDisplayMs <= 800, `${hostMetrics.firstDisplayMs}ms`, "Check ExplorerTreeHost update/expand path"),
    makeCheck("scroll_p95", "Fast scroll P95 frame stays under 24ms", hostMetrics.p95FrameMs <= 24, `${hostMetrics.p95FrameMs}ms`, "Check row patch and scroll path"),
    makeCheck("scroll_max", "Fast scroll max frame stays under 50ms", hostMetrics.maxFrameMs <= 50, `${hostMetrics.maxFrameMs}ms`, "Check row patch and scroll path"),
    makeCheck("long_tasks", "Fast scroll long tasks are bounded", hostMetrics.longTasks <= 3, `${hostMetrics.longTasks} frames > 50ms`, "Check synchronous render work"),
    makeCheck("selection_update_no_rebuild", "Selection-only update does not rebuild 100k explorer items", hostMetrics.selectionReusedItem && hostMetrics.selectionUpdateMs <= 24, `${hostMetrics.selectionUpdateMs}ms reused=${hostMetrics.selectionReusedItem}`, "Check ExplorerTreeHost.update tree identity guard"),
    makeCheck("expand_latency", "Expanding 1,000 children stays under 500ms", expandMetrics.expandLatencyMs <= 500, `${expandMetrics.expandLatencyMs}ms`, "Check local splice and list update"),
    makeCheck("static_no_realfs_treenode", "FileTree real FS path no longer renders TreeNode rows", staticAudit.fileTreeNoRealFsTreeNode, JSON.stringify(staticAudit), "Remove TreeNode from real FS branch"),
    makeCheck("static_no_visible_tree", "FileTree real FS path no longer imports visibleTree", staticAudit.fileTreeNoVisibleTreeImport, JSON.stringify(staticAudit), "Remove visibleTree scroll path"),
    makeCheck("static_no_recursive_filter", "FileTree filter no longer recursively clones real FS tree", staticAudit.fileTreeNoRecursiveFilter, JSON.stringify(staticAudit), "Replace recursive filterTree"),
    makeCheck("static_native_host", "Native Explorer host marker exists", staticAudit.nativeHostMarker, JSON.stringify(staticAudit), "Mount ExplorerTreeHost"),
    makeCheck("static_no_old_tree_logic", "Old recursive tree logic is absent from manager and host sources", staticAudit.hostNoLegacyTreeInput && staticAudit.managerNoRecursiveTreeWalk, JSON.stringify(staticAudit), "Remove old tree compatibility code"),
    makeCheck("open_large_file_decoupled", "openFile path does not auto reveal Explorer", staticAudit.openFileDoesNotAutoReveal, JSON.stringify(staticAudit), "Remove automatic reveal on file open"),
    makeCheck("refresh_decoupled", "refreshFileTree does not reopen active file", staticAudit.refreshDoesNotReopenActiveFile, JSON.stringify(staticAudit), "Remove previousActive reopen"),
    makeCheck("renderer_no_ascii_badges", "Explorer renderer does not show temporary [+] folder badges", staticAudit.rendererNoAsciiBadges, JSON.stringify(staticAudit), "Use native SVG folder/file icons"),
    makeCheck("desktop_watcher_deferred", "Desktop watcher startup and expanded directory watching are deferred off UI actions", staticAudit.desktopOpenProjectSchedulesWatcher && staticAudit.desktopListDirDefersExpandedWatch, JSON.stringify(staticAudit), "Check desktop/main.js watcher scheduling"),
  ]
  const summary = {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    failed: checks.filter((check) => check.status === "failed").length,
  }
  return {
    reportKind: "workbench-explorer-performance-smoke",
    createdAt: Date.now(),
    ready: summary.failed === 0,
    status: summary.failed === 0 ? "ready" : "blocked",
    summary,
    checks,
    scenario: "all",
    metrics: {
      firstDisplayMs: hostMetrics.firstDisplayMs,
      frame: {
        sampleCount: hostMetrics.frameTimes.length,
        p95Ms: hostMetrics.p95FrameMs,
        maxMs: hostMetrics.maxFrameMs,
        longTaskCount: hostMetrics.longTasks,
      },
      dom: {
        rows: hostMetrics.domRows,
        renderedAfterScroll: hostMetrics.renderedAfterScroll,
        limit: 120,
      },
      selectionUpdate: {
        ms: hostMetrics.selectionUpdateMs,
        reusedItem: hostMetrics.selectionReusedItem,
      },
      heap: {
        deltaBytes: hostMetrics.heapDeltaBytes,
      },
      readDir: {
        callCount: hostMetrics.readDirCalls.length,
        calls: hostMetrics.readDirCalls,
      },
      expand: expandMetrics,
      staticAudit,
      largeFileAndChatCoupling: {
        openFileAutoReveal: !staticAudit.openFileDoesNotAutoReveal,
        refreshReopensActiveFile: !staticAudit.refreshDoesNotReopenActiveFile,
        chatInputLatencyMs: null,
        note: "Module smoke verifies Explorer decoupling. Manual Beta is required for perceived Chat latency.",
      },
    },
  }
}

function writeReport(report, reportDir) {
  fs.mkdirSync(reportDir, { recursive: true })
  const stamp = new Date(report.createdAt).toISOString().replace(/[:.]/g, "-")
  const jsonPath = path.join(reportDir, `workbench-explorer-performance-${stamp}.json`)
  const latestJsonPath = path.join(reportDir, "workbench-explorer-performance-latest.json")
  const latestMarkdownPath = path.join(reportDir, "workbench-explorer-performance-latest.md")
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestMarkdownPath, renderMarkdown(report), "utf8")
  return { jsonPath, latestJsonPath, latestMarkdownPath }
}

function renderMarkdown(report) {
  const lines = [
    "# Workbench Explorer Performance Smoke",
    "",
    `Status: ${report.status}`,
    `Created: ${new Date(report.createdAt).toISOString()}`,
    "",
    "## Summary",
    "",
    `- Checks: ${report.summary.passed}/${report.summary.total} passed`,
    `- DOM rows: ${report.metrics.dom.rows} / ${report.metrics.dom.limit}`,
    `- First display: ${report.metrics.firstDisplayMs}ms`,
    `- Scroll P95 frame: ${report.metrics.frame.p95Ms}ms`,
    `- Scroll max frame: ${report.metrics.frame.maxMs}ms`,
    `- Long tasks: ${report.metrics.frame.longTaskCount}`,
    `- Heap delta: ${report.metrics.heap.deltaBytes} bytes`,
    `- readDir calls during scroll scenario: ${report.metrics.readDir.callCount}`,
    "",
    "## Checks",
    "",
    ...report.checks.map((check) => `- ${check.status.toUpperCase()} ${check.id}: ${check.detail}`),
    "",
    "## Manual Beta",
    "",
    "Manual human confirmation is not set by this smoke. Run `node scripts/manual-beta-feedback.js --scenario=explorer-performance` after real UI testing.",
    "",
  ]
  return `${lines.join("\n")}\n`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const report = await runSmoke(args.scenario)
  const paths = writeReport(report, args.reportDir)
  console.log(JSON.stringify({ ...report.summary, ready: report.ready, reportPath: paths.latestJsonPath }, null, 2))
  if (!report.ready) process.exitCode = 1
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { runSmoke, runStaticAudit }
