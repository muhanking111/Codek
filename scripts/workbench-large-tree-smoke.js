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
  return {
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
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
    return require(require.resolve(request, { paths: [frontendRoot, root] }))
  }
  new Function("require", "module", "exports", compiled)(localRequire, module, module.exports)
  return module.exports
}

function setupDom() {
  const previousGlobals = {
    window: global.window,
    document: global.document,
    HTMLElement: global.HTMLElement,
    MouseEvent: global.MouseEvent,
    KeyboardEvent: global.KeyboardEvent,
    DragEvent: global.DragEvent,
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
  global.DragEvent = dom.window.DragEvent
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

function buildLargeEntries(count = 100_000) {
  return Array.from({ length: count }, (_, index) => ({
    name: `file-${String(index).padStart(6, "0")}.ts`,
    path: `D:/repo/src/file-${String(index).padStart(6, "0")}.ts`,
    isFile: true,
    size: 128,
  }))
}

async function runNativeLargeTreeScenario() {
  const domContext = setupDom()
  try {
    const { ExplorerTreeHost } = loadFrontendTs(path.join(frontendRoot, "src", "explorer", "tree", "ExplorerTreeHost.ts"))
    const hostElement = document.getElementById("host")
    Object.defineProperty(hostElement, "clientHeight", { value: 480, configurable: true })

    const entriesByUri = {
      "D:/repo": [{ name: "src", path: "D:/repo/src", isDirectory: true }],
      "D:/repo/src": buildLargeEntries(),
    }
    const readDirCalls = []
    const readDir = async (uri) => {
      readDirCalls.push(uri)
      return entriesByUri[uri] || []
    }
    const host = new ExplorerTreeHost({
      container: hostElement,
      rowHeight: 24,
      readDir,
    })

    const startHeap = process.memoryUsage().heapUsed
    const start = Date.now()
    await host.update({ projectRoot: "D:/repo", workspaceRoots: ["D:/repo"] })
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

    const revealTimes = []
    for (let index = 0; index < 180; index += 1) {
      const target = `D:/repo/src/file-${String(Math.min(99_999, index * 557)).padStart(6, "0")}.ts`
      const frameStart = Date.now()
      await host.revealPath(target)
      revealTimes.push(Date.now() - frameStart)
    }

    const readDirCallsBeforeRefresh = readDirCalls.length
    await host.refresh()
    const refreshReadDirCalls = readDirCalls.slice(readDirCallsBeforeRefresh)
    const domRows = hostElement.querySelectorAll("[data-codek-explorer-row]").length
    const flatItems = host.getFlatItems()
    const renderedAfterScroll = host.getRenderedRowCount()
    const endHeap = process.memoryUsage().heapUsed

    host.dispose()

    return {
      firstDisplayMs,
      domRows,
      renderedAfterScroll,
      totalFlatItems: flatItems.length,
      maxRevealMs: Math.max(...revealTimes),
      p95RevealMs: percentile(revealTimes, 0.95),
      longTasks: revealTimes.filter((value) => value > 50).length,
      readDirCalls,
      refreshReadDirCalls,
      heapDeltaBytes: endHeap - startHeap,
      selectionUpdateMs,
      selectionReusedItem,
    }
  } finally {
    teardownDom(domContext)
  }
}

function runStaticAudit() {
  const fileTreePath = path.join(frontendRoot, "src", "components", "FileTree.vue")
  const hostPath = path.join(frontendRoot, "src", "explorer", "tree", "ExplorerTreeHost.ts")
  const managerPath = path.join(frontendRoot, "src", "workspace", "manager.js")
  const fileTreeSource = fs.readFileSync(fileTreePath, "utf8")
  const hostSource = fs.readFileSync(hostPath, "utf8")
  const managerSource = fs.readFileSync(managerPath, "utf8")
  const realFsBlock = fileTreeSource.split('<div v-if="!isRealFS" class="memory-files">')[0] || fileTreeSource
  return {
    fileTreeNoRealFsTreeNode: !realFsBlock.includes("<TreeNode") && !realFsBlock.includes("v-for=\"item in visibleWindow.items\""),
    fileTreeNoVisibleTreeImport: !fileTreeSource.includes("visibleTree") && !fileTreeSource.includes("getVisibleTreeWindowFromTree"),
    nativeHostMarker: fileTreeSource.includes('data-codek-smoke="native-explorer-host"'),
    hostNoLegacyTreeInput: !hostSource.includes("LegacyTreeEntry") && !hostSource.includes("fromLegacyEntry") && !hostSource.includes("readLegacyChildren"),
    managerNoRecursiveTreeWalk: !managerSource.includes("walkDir(") && !managerSource.includes("makeLimitNode") && !managerSource.includes("setDirOpen"),
  }
}

async function runSmoke() {
  const scenario = await runNativeLargeTreeScenario()
  const staticAudit = runStaticAudit()
  const checks = [
    makeCheck(
      "native_large_tree_first_display",
      "Native Explorer renders a 100k-file directory without full DOM inflation",
      scenario.firstDisplayMs < 1500 && scenario.domRows <= 120,
      `${scenario.firstDisplayMs}ms, ${scenario.domRows} DOM rows`,
      "Check ExplorerTreeHost + CodekListView virtualization",
    ),
    makeCheck(
      "native_large_tree_selection_update",
      "Selection-only update reuses the existing tree model",
      scenario.selectionUpdateMs < 100 && scenario.selectionReusedItem,
      `${scenario.selectionUpdateMs}ms, reused=${scenario.selectionReusedItem}`,
      "Check ExplorerTreeHost.update root-key diffing",
    ),
    makeCheck(
      "native_large_tree_reveal_latency",
      "Reveal operations avoid long synchronous stalls",
      scenario.p95RevealMs <= 16 && scenario.longTasks === 0,
      `p95=${scenario.p95RevealMs}ms, max=${scenario.maxRevealMs}ms, longTasks=${scenario.longTasks}`,
      "Check revealPath and virtual list scrolling",
    ),
    makeCheck(
      "native_large_tree_refresh",
      "Refresh re-reads native root and expanded child directories",
      scenario.refreshReadDirCalls.includes("D:/repo") && scenario.refreshReadDirCalls.includes("D:/repo/src"),
      scenario.refreshReadDirCalls.join(", "),
      "Check ExplorerTreeHost.refresh expanded subtree refresh",
    ),
    makeCheck(
      "static_no_vue_treenode",
      "Real FS FileTree branch no longer uses Vue TreeNode rows",
      staticAudit.fileTreeNoRealFsTreeNode && staticAudit.nativeHostMarker,
      JSON.stringify(staticAudit),
      "Check FileTree.vue real FS branch",
    ),
    makeCheck(
      "static_no_old_tree_logic",
      "Old recursive tree logic is absent from manager and host sources",
      staticAudit.hostNoLegacyTreeInput && staticAudit.managerNoRecursiveTreeWalk && staticAudit.fileTreeNoVisibleTreeImport,
      JSON.stringify(staticAudit),
      "Remove old tree compatibility code",
    ),
  ]

  const summary = {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    failed: checks.filter((check) => check.status === "failed").length,
  }
  return {
    reportKind: "workbench-large-tree-smoke",
    createdAt: Date.now(),
    ready: summary.failed === 0,
    status: summary.failed === 0 ? "ready" : "blocked",
    summary,
    checks,
    evidence: scenario,
  }
}

function writeReport(report, reportDir) {
  fs.mkdirSync(reportDir, { recursive: true })
  const filePath = path.join(reportDir, `workbench-large-tree-smoke-${new Date(report.createdAt).toISOString().replace(/[:.]/g, "-")}.json`)
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  return filePath
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const report = await runSmoke()
  const reportPath = writeReport(report, args.reportDir)
  console.log(JSON.stringify({ ...report.summary, ready: report.ready, reportPath }, null, 2))
  if (!report.ready) process.exitCode = 1
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { runSmoke }
