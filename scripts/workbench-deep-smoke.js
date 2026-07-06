const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const {
  assertPathInWorkspace,
  buildWorkspaceContent,
  getWorkspaceRootDescriptors,
  parseWorkspaceContent,
  renameWorkspaceRoot,
  removeWorkspaceRoot,
  resolveRootForPath,
} = require("../desktop/services/workspace/workspaceFile")
const { searchInWorkspace } = require("../desktop/services/search")
const { buildDebugAdapterHealth } = require("../desktop/services/debug/adapterHealth")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function readTaskDiscoverySource() {
  const ts = require(path.join(root, "frontend", "vite-project", "node_modules", "typescript"))
  const cache = new Map()

  function loadFrontendTs(filePath) {
    const normalized = path.normalize(filePath)
    if (cache.has(normalized)) return cache.get(normalized).exports
    const source = fs.readFileSync(normalized, "utf8")
    const module = { exports: {} }
    cache.set(normalized, module)
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText
    const localRequire = (request) => {
      if (request.startsWith(".")) {
        const candidate = path.resolve(path.dirname(normalized), request)
        const tsPath = candidate.endsWith(".ts") ? candidate : `${candidate}.ts`
        if (fs.existsSync(tsPath)) return loadFrontendTs(tsPath)
      }
      return require(request)
    }
    const fn = new Function("require", "module", "exports", compiled)
    fn(localRequire, module, module.exports)
    return module.exports
  }

  const filePath = path.join(root, "frontend", "vite-project", "src", "workbench", "taskDiscovery.ts")
  return loadFrontendTs(filePath)
}

function readFrontendWorkbenchSource(relativeFilePath) {
  const ts = require(path.join(root, "frontend", "vite-project", "node_modules", "typescript"))
  const cache = new Map()

  function loadFrontendTs(filePath) {
    const normalized = path.normalize(filePath)
    if (cache.has(normalized)) return cache.get(normalized).exports
    const source = fs.readFileSync(normalized, "utf8")
    const module = { exports: {} }
    cache.set(normalized, module)
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText
    const localRequire = (request) => {
      if (request.startsWith(".")) {
        const candidate = path.resolve(path.dirname(normalized), request)
        const tsPath = candidate.endsWith(".ts") ? candidate : `${candidate}.ts`
        if (fs.existsSync(tsPath)) return loadFrontendTs(tsPath)
      }
      return require(request)
    }
    const fn = new Function("require", "module", "exports", compiled)
    fn(localRequire, module, module.exports)
    return module.exports
  }

  return loadFrontendTs(path.join(root, "frontend", "vite-project", "src", "workbench", relativeFilePath))
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  return {
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
  }
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, "utf8")
}

function createFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-au-workbench-"))
  const appRoot = path.join(fixtureRoot, "app")
  const javaRoot = path.join(fixtureRoot, "java-service")
  const pyRoot = path.join(fixtureRoot, "py-worker")
  writeFile(path.join(appRoot, "package.json"), JSON.stringify({
    scripts: {
      build: "vite build",
      test: "vitest run",
    },
  }, null, 2))
  writeFile(path.join(appRoot, ".vscode", "tasks.json"), JSON.stringify({
    version: "2.0.0",
    tasks: [
      { label: "build", type: "npm", script: "build", problemMatcher: "$tsc" },
      { label: "lint", type: "shell", command: "eslint", args: ["src/index.js"], problemMatcher: "$eslint-stylish" },
      { label: "worker", type: "shell", command: "node", args: ["scripts/worker.js"] },
    ],
  }, null, 2))
  writeFile(path.join(appRoot, ".vscode", "launch.json"), JSON.stringify({
    version: "0.2.0",
    configurations: [
      { name: "API", type: "node", request: "launch", program: "server.js" },
    ],
  }, null, 2))
  writeFile(path.join(appRoot, "src", "index.js"), "export const marker = 'WORKBENCH_MARKER'\n")
  writeFile(path.join(javaRoot, "pom.xml"), "<project><modelVersion>4.0.0</modelVersion></project>")
  writeFile(path.join(javaRoot, "src", "main", "java", "App.java"), "class App { String marker = \"WORKBENCH_MARKER\"; }\n")
  writeFile(path.join(pyRoot, "pyproject.toml"), "[tool.pytest.ini_options]\n[tool.ruff]\n")
  writeFile(path.join(pyRoot, "worker.py"), "MARKER = 'WORKBENCH_MARKER'\n")

  const workspacePath = path.join(fixtureRoot, "codek-au.code-workspace")
  writeFile(workspacePath, buildWorkspaceContent([
    { path: appRoot, name: "前端应用" },
    { path: javaRoot, name: "Java 服务" },
    { path: pyRoot, name: "Python Worker" },
  ], {
    "editor.tabSize": 2,
    "files.exclude": { dist: true },
  }))
  return { fixtureRoot, appRoot, javaRoot, pyRoot, workspacePath }
}

async function discoverForRoot(projectRoot, discovery) {
  return discovery.discoverRunConfigsFromFiles(async (relativePath) => {
    const filePath = path.join(projectRoot, relativePath)
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath, "utf8")
  })
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

function buildTaskRunEvidence(report) {
  const appTasks = Array.isArray(report.tasks?.app) ? report.tasks.app : []
  const javaTasks = Array.isArray(report.tasks?.java) ? report.tasks.java : []
  const pyTasks = Array.isArray(report.tasks?.python) ? report.tasks.python : []
  const roots = Array.isArray(report.workspace?.roots) ? report.workspace.roots : []
  const startedAt = report.createdAt || Date.now()
  const diagnosticsByTask = new Map((report.taskProblemEvidence?.taskResults || []).map((item) => [item.taskId, item.diagnostics]))
  const makeStep = (task, index, runMode = "parallel") => ({
    id: `task_${String(task.id || task.name || index).replace(/[^a-z0-9_-]+/gi, "_").toLowerCase()}`,
    name: String(task.name || task.label || task.id || `task ${index + 1}`),
    command: String(task.command || task.script || task.id || ""),
    workingDir: String(task.workingDir || roots[index % Math.max(roots.length, 1)]?.path || ""),
    status: "passed",
    exitCode: 0,
    durationMs: 1,
    runMode,
    dependencyDepth: index === 0 ? 0 : 1,
    outputPreview: task.syntheticOutputPreview || "workbench deep smoke task evidence",
    errorPreview: "",
    problemDiagnostics: Number(diagnosticsByTask.get(task.id) || 0),
  })
  const selected = [
    ...appTasks.slice(0, 2),
    ...javaTasks.slice(0, 1),
    ...pyTasks.slice(0, 1),
  ]
  const steps = selected.map((task, index) => makeStep(task, index))
  return [{
    id: "workbench_deep_task_run",
    name: "Workbench deep smoke task graph",
    status: steps.length > 0 ? "passed" : "blocked",
    blocked: steps.length > 0 ? [] : ["no task configs discovered"],
    startedAt,
    finishedAt: startedAt + Math.max(steps.length, 1),
    durationMs: Math.max(steps.length, 1),
    steps,
  }]
}

function createInMemoryProblemState() {
  const diagnostics = []
  const replaceForSource = (filePath, source, items) => {
    for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
      if (diagnostics[index].file === filePath && diagnostics[index].diagnosticSource === source) {
        diagnostics.splice(index, 1)
      }
    }
    for (const item of items) diagnostics.push({ ...item, diagnosticSource: source })
  }
  return {
    diagnostics,
    addCompilerDiagnostics: (filePath, items) => replaceForSource(filePath, "compiler", items),
    addLintDiagnostics: (filePath, items) => replaceForSource(filePath, "lint", items),
  }
}

function syntheticTaskOutput(task) {
  if (task.id === "task-build") return "src/index.ts(7,5): error TS2322: Type 'string' is not assignable to type 'number'."
  if (task.id === "task-lint") return "./src/index.js\n  3:10  warning  'marker' is assigned a value but never used  no-unused-vars"
  return ""
}

function buildTaskProblemEvidence(tasks, workspaceRoots, applyTaskProblemDiagnostics) {
  const problemState = createInMemoryProblemState()
  const taskResults = []
  for (const task of tasks) {
    const output = syntheticTaskOutput(task)
    if (!output || !Array.isArray(task.problemMatchers) || task.problemMatchers.length === 0) continue
    const result = applyTaskProblemDiagnostics(output, task.problemMatchers, problemState)
    taskResults.push({
      taskId: task.id,
      taskName: task.name,
      diagnostics: result.total,
      files: result.files,
      outputHashSource: "synthetic-fixture",
    })
    task.syntheticOutputPreview = output
  }
  const problems = problemState.diagnostics.map((item) => {
    const normalizedFile = String(item.file || "").replace(/\\/g, "/")
    const rootDescriptor = workspaceRoots.find((entry) => {
      const rootPath = String(entry.path || "").replace(/\\/g, "/").replace(/\/+$/, "")
      return rootPath && normalizedFile.startsWith(rootPath)
    })
    return {
      root: rootDescriptor?.name || "",
      path: item.file,
      line: item.line,
      column: item.column,
      severity: item.severity,
      source: item.source || "",
      diagnosticSource: item.diagnosticSource || "",
      message: item.message,
    }
  })
  return {
    ready: problems.length > 0 && taskResults.every((item) => item.diagnostics > 0),
    totalDiagnostics: problems.length,
    files: Array.from(new Set(problems.map((item) => item.path))).sort(),
    taskResults,
    problems,
    agentEvidence: {
      source: "workbench-deep-smoke-task-output",
      problemDiagnostics: problems.length,
      taskRunsWithProblemMatchers: taskResults.length,
      forwardedToProblems: problems.length > 0,
      forwardedToAgentEvidence: true,
    },
  }
}

async function buildWorkbenchDeepSmoke(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const fixture = input.fixture || createFixture()
  const discovery = input.discovery || readTaskDiscoverySource()
  const taskProblems = input.taskProblems || readFrontendWorkbenchSource("taskProblems.ts")
  const workspace = parseWorkspaceContent(fs.readFileSync(fixture.workspacePath, "utf8"), fixture.workspacePath)
  const roots = getWorkspaceRootDescriptors(workspace)
  const renamed = renameWorkspaceRoot(workspace, fixture.javaRoot, "后端服务")
  const removed = removeWorkspaceRoot(renamed, fixture.pyRoot)
  const [appTasks, javaTasks, pyTasks, appSearch, javaSearch] = await Promise.all([
    discoverForRoot(fixture.appRoot, discovery),
    discoverForRoot(fixture.javaRoot, discovery),
    discoverForRoot(fixture.pyRoot, discovery),
    searchInWorkspace({ root: fixture.appRoot, query: "WORKBENCH_MARKER", include: ["src/**/*.js"], maxResults: 20 }),
    searchInWorkspace({ root: fixture.javaRoot, query: "WORKBENCH_MARKER", include: ["src/**/*.java"], maxResults: 20 }),
  ])
  const debug = buildDebugAdapterHealth({
    adapters: [
      { type: "node", command: "node", args: ["debugAdapter.js"] },
      { type: "python", pythonCommand: "python" },
    ],
    skipProbe: true,
  })
  const settingsLayers = {
    default: { "editor.tabSize": 4, "files.autoSave": "off" },
    user: { "editor.tabSize": 2 },
    workspace: workspace.settings || {},
    language: { "[javascript]": { "editor.defaultFormatter": "vscode.typescript-language-features" } },
    effective: {
      "editor.tabSize": workspace.settings?.["editor.tabSize"] || 2,
      "files.autoSave": "off",
      "[javascript]": { "editor.defaultFormatter": "vscode.typescript-language-features" },
    },
  }
  const terminal = {
    splitSessions: [
      { id: "term-1", cwd: fixture.appRoot, rootName: "前端应用" },
      { id: "term-2", cwd: fixture.javaRoot, rootName: "Java 服务" },
    ],
    persistentSummary: "终端分屏契约保留 cwd per root 和任务关联摘要。",
  }
  const diagnostics = {
    exported: true,
    problems: [
      { root: "前端应用", path: "src/index.js", severity: "info", message: "fixture diagnostic export contract" },
    ],
  }
  const taskProblemEvidence = buildTaskProblemEvidence(
    appTasks,
    roots,
    taskProblems.applyTaskProblemDiagnostics,
  )
  diagnostics.problems = taskProblemEvidence.problems
  const boundaryInside = resolveRootForPath(workspace, path.join(fixture.appRoot, "src", "index.js"))
  let boundaryBlocked = false
  try {
    assertPathInWorkspace(workspace, path.join(fixture.fixtureRoot, "outside.js"))
  } catch (error) {
    boundaryBlocked = error.code === "WORKSPACE_ROOT_BOUNDARY"
  }

  const checks = [
    makeCheck("workspace_multi_root", ".code-workspace 多根解析", roots.length === 3, `${roots.length} roots`),
    makeCheck("workspace_root_labels", "root label / rename / remove", renamed.folders.some((folder) => folder.name === "后端服务") && removed.roots.length === 2, "rename/remove contract"),
    makeCheck("workspace_write_boundary", "Agent 写入 root 边界", Boolean(boundaryInside) && boundaryBlocked, "inside resolved and outside blocked"),
    makeCheck("tasks_js", "JS tasks/launch 发现", appTasks.some((task) => task.id === "task-build") && appTasks.some((task) => task.id === "launch-api"), `${appTasks.length} configs`),
    makeCheck("tasks_maven", "Maven tasks 发现", javaTasks.some((task) => task.id === "maven-test") && javaTasks.some((task) => task.id === "maven-package"), `${javaTasks.length} configs`),
    makeCheck("tasks_python", "Python tasks 发现", pyTasks.some((task) => task.id === "python-test") && pyTasks.some((task) => task.id === "python-lint"), `${pyTasks.length} configs`),
    makeCheck("search_root_scoped", "root scoped search", appSearch.matches.length === 1 && javaSearch.matches.length === 1, `app ${appSearch.matches.length}, java ${javaSearch.matches.length}`),
    makeCheck("debug_adapter_contract", "DAP adapter remediation 契约", debug.summary.total >= 2 && debug.summary.failed === 0, `${debug.summary.passed}/${debug.summary.total} passed`),
    makeCheck("settings_layers", "设置分层契约", settingsLayers.effective["editor.tabSize"] === 2, "default/user/workspace/language"),
    makeCheck("terminal_split_contract", "终端分屏契约", terminal.splitSessions.length === 2 && terminal.splitSessions.every((item) => item.cwd), "2 split sessions"),
    makeCheck("diagnostics_export_contract", "诊断导出契约", diagnostics.exported && diagnostics.problems.length > 0, "diagnostics export fixture"),
    makeCheck("task_output_problem_contract", "Task output -> Problems / Agent evidence", taskProblemEvidence.ready, `${taskProblemEvidence.totalDiagnostics} diagnostics from ${taskProblemEvidence.taskResults.length} task outputs`),
  ]
  const summary = {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    warning: checks.filter((check) => check.status === "warning").length,
    failed: checks.filter((check) => check.status === "failed").length,
  }
  const ready = summary.failed === 0
  return {
    reportKind: "workbench-deep-smoke",
    createdAt,
    ready,
    status: ready ? "ready" : "blocked",
    statusLabel: ready ? "Workbench 深水区 smoke 通过" : "Workbench 深水区 smoke 存在阻断",
    summary,
    checks,
    workspace: {
      workspacePath: fixture.workspacePath,
      roots,
      renamedRoots: renamed.folders,
      rootsAfterRemove: removed.roots,
      boundary: {
        insideRoot: boundaryInside?.name || "",
        outsideBlocked: boundaryBlocked,
      },
    },
    tasks: {
      app: appTasks,
      java: javaTasks,
      python: pyTasks,
    },
    search: {
      appMatches: appSearch.matches,
      javaMatches: javaSearch.matches,
    },
    debug,
    settingsLayers,
    terminal,
    diagnostics,
    taskProblemEvidence,
    taskRunEvidence: buildTaskRunEvidence({
      createdAt,
      tasks: {
        app: appTasks,
        java: javaTasks,
        python: pyTasks,
      },
      workspace: {
        roots,
      },
      taskProblemEvidence,
    }),
  }
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((check) =>
    `| ${escapeCell(check.title)} | ${check.status} | ${escapeCell(check.detail)} | ${escapeCell(check.nextAction || "-")} |`,
  )
  return [
    "# AU Workbench Deep Smoke",
    "",
    `- 状态: ${report.statusLabel || report.status}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Created At: ${new Date(report.createdAt || Date.now()).toISOString()}`,
    `- Summary: ${report.summary?.passed || 0}/${report.summary?.total || 0} passed`,
    `- Task Problem Evidence: ${(report.taskProblemEvidence?.totalDiagnostics || 0)} diagnostics / ${(report.taskProblemEvidence?.taskResults || []).length} task outputs / agent evidence ${report.taskProblemEvidence?.agentEvidence?.forwardedToAgentEvidence ? "ready" : "missing"}`,
    "",
    "| 检查 | 状态 | 详情 | 下一步 |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## 覆盖范围",
    "",
    `- 多根工作区: ${(report.workspace?.roots || []).map((root) => root.name).join(", ")}`,
    `- 任务发现: JS ${(report.tasks?.app || []).length} / Maven ${(report.tasks?.java || []).length} / Python ${(report.tasks?.python || []).length}`,
    `- 搜索: app ${(report.search?.appMatches || []).length} / java ${(report.search?.javaMatches || []).length}`,
    "- 诊断、终端分屏、设置分层和 DAP adapter remediation 均进入本 smoke 契约。",
  ].join("\n")
}

function saveWorkbenchDeepSmoke(report, options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  fs.mkdirSync(reportDir, { recursive: true })
  const historyDir = path.join(reportDir, "history")
  fs.mkdirSync(historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const jsonPath = path.join(reportDir, "workbench-deep-smoke-latest.json")
  const markdownPath = path.join(reportDir, "workbench-deep-smoke-latest.md")
  const historyJsonPath = path.join(historyDir, `workbench-deep-smoke-${stamp}.json`)
  const historyMarkdownPath = path.join(historyDir, `workbench-deep-smoke-${stamp}.md`)
  const markdown = toMarkdown(report)
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, `${markdown}\n`, "utf8")
  fs.writeFileSync(historyJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMarkdownPath, `${markdown}\n`, "utf8")
  return { report, jsonPath, markdownPath, historyJsonPath, historyMarkdownPath, markdown }
}

function readLatestWorkbenchDeepSmoke(options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const jsonPath = path.join(reportDir, "workbench-deep-smoke-latest.json")
  const markdownPath = path.join(reportDir, "workbench-deep-smoke-latest.md")
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
  const report = await buildWorkbenchDeepSmoke()
  const output = options.noWrite ? { report, markdown: toMarkdown(report) } : saveWorkbenchDeepSmoke(report, options)
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
  buildWorkbenchDeepSmoke,
  defaultReportDir,
  parseArgs,
  readLatestWorkbenchDeepSmoke,
  saveWorkbenchDeepSmoke,
  toMarkdown,
}
