const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const frontendModuleCache = new Map()

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
  if (frontendModuleCache.has(normalizedFilePath)) return frontendModuleCache.get(normalizedFilePath).exports
  const ts = require(path.join(root, "frontend", "vite-project", "node_modules", "typescript"))
  const source = fs.readFileSync(normalizedFilePath, "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} }
  frontendModuleCache.set(normalizedFilePath, module)
  const localRequire = (request) => {
    if (request === "vue") {
      return {
        reactive: (value) => value,
        shallowRef: (value) => ({ value }),
        computed: (factory) => ({ get value() { return factory() } }),
      }
    }
    if (request.startsWith(".")) {
      const target = path.resolve(path.dirname(normalizedFilePath), request)
      const withTs = target.endsWith(".ts") ? target : `${target}.ts`
      const withJs = target.endsWith(".js") ? target : `${target}.js`
      if (fs.existsSync(withTs)) return loadFrontendTs(withTs)
      if (fs.existsSync(withJs)) return require(withJs)
    }
    return require(request)
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

function runSmoke() {
  const commandRegistry = loadFrontendTs(path.join(root, "frontend", "vite-project", "src", "workbench", "commandRegistry.ts"))
  const fileActions = loadFrontendTs(path.join(root, "frontend", "vite-project", "src", "workbench", "fileActions.ts"))
  const scmDecorations = loadFrontendTs(path.join(root, "frontend", "vite-project", "src", "scm", "scmDecorations.ts"))
  const productIcons = loadFrontendTs(path.join(root, "frontend", "vite-project", "src", "workbench", "productIcons.ts"))
  const bottomPanelState = loadFrontendTs(path.join(root, "frontend", "vite-project", "src", "workbench", "bottomPanelState.ts"))

  commandRegistry.clearCommands()
  const calls = []
  const context = {
    workspace: { activeFile: "src/main.ts", projectRoot: "D:/Workspace", files: {} },
    workspaceManager: {
      openFile: async (pathValue) => { calls.push(["open", pathValue]); return true },
      saveFile: async () => true,
      addFile: () => {},
      createFile: async () => true,
      createDir: async () => true,
      deleteFile: async (pathValue) => { calls.push(["delete", pathValue]); return true },
      renameEntry: async (oldPath, newPath) => { calls.push(["rename", oldPath, newPath]); return true },
      copyEntry: (pathValue) => { calls.push(["copy", pathValue]); return true },
      cutEntry: (pathValue) => { calls.push(["cut", pathValue]); return true },
      pasteEntry: async (targetDir) => { calls.push(["paste", targetDir]); return "src/main copy.ts" },
      revealPath: async (pathValue) => { calls.push(["reveal", pathValue]); return true },
      showItemInFolder: async (pathValue) => { calls.push(["show", pathValue]); return true },
      refreshFileTree: async () => { calls.push(["refresh"]) },
      updateFile: () => {},
      markClean: () => {},
      readProjectFile: async () => "",
      getRelativePath: (pathValue) => pathValue,
    },
    getEditor: () => null,
    getOpenFiles: () => [],
    isDirty: () => false,
    isRealFS: () => true,
    isFormatOnSave: () => false,
    isLintOnSave: () => false,
    setSuppressEditorSync: () => {},
    syncEditorFromWorkspace: () => {},
    refreshActiveAnalysis: async () => undefined,
    loadFormatManager: async () => ({ formatFile: async () => ({ success: false }) }),
    loadLintManager: async () => ({ lintFile: async () => [] }),
    problemState: { addLintDiagnostics: () => {} },
    setSelectedDir: () => {},
    setSelectedTree: () => {},
    confirmDelete: () => true,
    promptRename: () => "app.ts",
    copyText: () => {},
    openTerminalAtPath: () => {},
    notifyLspFileOpened: () => {},
    joinRelativePath: (parent, name) => parent ? `${parent}/${name}` : name,
  }
  fileActions.registerExplorerCommands(context)

  const commands = commandRegistry.getCommands({ explorerVisible: true, explorerResource: true })
  const requiredCommands = [
    "explorer.open",
    "explorer.rename",
    "explorer.delete",
    "explorer.copy",
    "explorer.cut",
    "explorer.paste",
    "explorer.copyPath",
    "explorer.copyRelativePath",
    "explorer.showInFolder",
    "explorer.openTerminal",
    "explorer.refresh",
  ]
  const commandIds = commands.map((command) => command.id)
  const decorationMap = scmDecorations.buildScmDecorationMap([{
    id: "git:D:/Workspace",
    providerId: "git",
    label: "Codek",
    rootUri: "D:/Workspace",
    branch: "main",
    ahead: 0,
    behind: 0,
    count: 1,
    groups: [{ id: "changes", label: "changes", resources: [{ path: "src/main.ts", status: "M", staged: false }] }],
  }])
  const fileTreeSource = fs.readFileSync(path.join(root, "frontend", "vite-project", "src", "components", "FileTree.vue"), "utf8")
  const explorerTreeHostSource = fs.readFileSync(path.join(root, "frontend", "vite-project", "src", "explorer", "tree", "ExplorerTreeHost.ts"), "utf8")
  const explorerRendererSource = fs.readFileSync(path.join(root, "frontend", "vite-project", "src", "explorer", "tree", "ExplorerRenderer.ts"), "utf8")
  const appSource = fs.readFileSync(path.join(root, "frontend", "vite-project", "src", "App.vue"), "utf8")
  const outputPanelSource = fs.readFileSync(path.join(root, "frontend", "vite-project", "src", "components", "OutputPanel.vue"), "utf8")
  const terminalPanelSource = fs.readFileSync(path.join(root, "frontend", "vite-project", "src", "components", "TerminalPanel.vue"), "utf8")
  const processPanelSource = fs.readFileSync(path.join(root, "frontend", "vite-project", "src", "components", "ProcessExplorerPanel.vue"), "utf8")
  const panelState = bottomPanelState.createBottomPanelState()
  bottomPanelState.openBottomPanel(panelState, "output")
  bottomPanelState.openBottomPanel(panelState, "terminal")

  const checks = [
    makeCheck("explorer_commands", "Explorer commands are registered", requiredCommands.every((id) => commandIds.includes(id)), commandIds.join(", "), "Check fileActions.registerExplorerCommands"),
    makeCheck("explorer_context_menu", "Explorer context menu markers exist", fileTreeSource.includes("data-codek-smoke=\"explorer-context-menu\"") && fileTreeSource.includes("explorer-context-item"), "context menu present", "Check FileTree.vue context menu"),
    makeCheck(
      "explorer_drag_keyboard",
      "Explorer keyboard and drag entrypoints exist",
      explorerTreeHostSource.includes("handleKeydown")
        && explorerTreeHostSource.includes("handleDragStart")
        && explorerTreeHostSource.includes("handleDrop")
        && explorerTreeHostSource.includes("onMoveEntry")
        && explorerRendererSource.includes("row.draggable = true"),
      "native host keyboard and drag handlers present",
      "Check ExplorerTreeHost.ts event delegation",
    ),
    makeCheck("scm_directory_decoration", "SCM directory aggregate decoration is available", decorationMap.src?.aggregate === true && decorationMap["src/main.ts"]?.label === "M", JSON.stringify(decorationMap.src), "Check scmDecorations"),
    makeCheck("product_icons", "Product Icon / Codicon mapping is available", productIcons.getProductIconClass("files") === "codicon-files" && productIcons.getProductIconClass("terminal") === "codicon-terminal", "codicon mapping ok", "Check productIcons"),
    makeCheck("bottom_panel_state", "Bottom panel state switches active panel", bottomPanelState.isBottomPanelActive(panelState, "terminal") && !bottomPanelState.isBottomPanelActive(panelState, "output"), JSON.stringify(panelState), "Check bottomPanelState"),
    makeCheck("bottom_panel_smoke_markers", "Bottom panel UI smoke markers exist",
      appSource.includes('data-codek-smoke="bottom-panel"')
        && appSource.includes("openOutputPanel")
        && outputPanelSource.includes('data-codek-smoke="output-panel"')
        && terminalPanelSource.includes('data-codek-smoke="terminal-panel"')
        && processPanelSource.includes('data-codek-smoke="process-explorer-panel"')
        && processPanelSource.includes('data-codek-smoke="process-copy-diagnostics"')
        && processPanelSource.includes('data-codek-smoke="process-export-diagnostics"'),
      "bottom panel markers present",
      "Check App.vue / OutputPanel.vue / TerminalPanel.vue / ProcessExplorerPanel.vue"),
  ]
  const summary = {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    failed: checks.filter((check) => check.status === "failed").length,
  }
  return {
    reportKind: "workbench-explorer-smoke",
    createdAt: Date.now(),
    ready: summary.failed === 0,
    status: summary.failed === 0 ? "ready" : "blocked",
    summary,
    checks,
  }
}

function writeReport(report, reportDir) {
  fs.mkdirSync(reportDir, { recursive: true })
  const stamp = new Date(report.createdAt).toISOString().replace(/[:.]/g, "-")
  const filePath = path.join(reportDir, `workbench-explorer-smoke-${stamp}.json`)
  const latestPath = path.join(reportDir, "workbench-explorer-smoke-latest.json")
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  return filePath
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const report = runSmoke()
  const reportPath = writeReport(report, args.reportDir)
  console.log(JSON.stringify({ ...report.summary, ready: report.ready, reportPath }, null, 2))
  if (!report.ready) process.exitCode = 1
}

if (require.main === module) {
  main()
}

module.exports = { runSmoke }
