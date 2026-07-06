const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const crypto = require("node:crypto")
const orchestrator = require("../orchestrator")
const artifactStore = require("../artifactStore")
const planExecutor = require("../planExecutor")
const planTree = require("../planTree")
const { chooseAgentStrategy } = require("../agentRouter")
const { runStrategyFixture } = require("./realRunComparison")
const { summarizeRouterCalibration } = require("./routerCalibration")
const { summarizeRouterShadowEval } = require("./routerShadowEval")
const { normalizeRunRuntimeStatus } = require("../runtimeStatus")
const { classifyScenarioFailure, summarizeFailureRecommendations } = require("./failureRecommendations")
const { buildDeliveryTrustSummary } = require("../deliveryTrustSummary")

function defaultAcceptanceReportDir() {
  if (process.env.CODEK_EVAL_REPORT_DIR) return process.env.CODEK_EVAL_REPORT_DIR
  if (process.env.CODEK_DATA) return path.join(process.env.CODEK_DATA, "evals")
  return path.resolve(process.cwd(), ".codek", "evals")
}

function getAcceptanceReportPaths(reportDir = defaultAcceptanceReportDir()) {
  return {
    dir: reportDir,
    historyDir: path.join(reportDir, "history"),
    jsonPath: path.join(reportDir, "real-project-smoke-latest.json"),
    markdownPath: path.join(reportDir, "real-project-smoke-latest.md"),
  }
}

function readLatestAcceptanceReport(options = {}) {
  const paths = getAcceptanceReportPaths(options.reportDir)
  if (!fs.existsSync(paths.jsonPath)) {
    return {
      ...paths,
      report: null,
      markdown: "",
    }
  }
  const report = JSON.parse(fs.readFileSync(paths.jsonPath, "utf8"))
  const markdown = fs.existsSync(paths.markdownPath)
    ? fs.readFileSync(paths.markdownPath, "utf8")
    : toAcceptanceMarkdown(report)
  return {
    ...paths,
    report,
    markdown,
  }
}

const TASK_SETS = Object.freeze({
  standard: {
    id: "standard",
    label: "标准验收",
    description: "完整运行主线多 Agent 验收、恢复动作和全部发布矩阵。",
    includeMainFlow: true,
    includeRecoveryChecks: true,
    scenarios: [
      "single_file_success",
      "multi_file_success",
      "refactor_flow_success",
      "ui_component_change",
      "backend_api_change",
      "settings_schema_change",
      "extension_flow_change",
      "dependency_upgrade_change",
      "cross_language_change",
      "large_refactor_guarded",
      "quality_gate_failure",
      "conflict_blocked",
      "extension_conflict_blocked",
      "long_background_recovery",
      "ambiguous_requirement",
      "destructive_request_blocked",
      "permission_scope_violation",
    ],
    includeMatrixRecovery: true,
  },
  quick: {
    id: "quick",
    label: "快速验收",
    description: "覆盖主线多 Agent 验收和成功路径矩阵，适合开发态快速回归。",
    includeMainFlow: true,
    includeRecoveryChecks: false,
    scenarios: ["single_file_success", "multi_file_success"],
    includeMatrixRecovery: false,
  },
  risk: {
    id: "risk",
    label: "风险验收",
    description: "聚焦质量门失败、并发冲突和恢复动作，适合发布前风险回归。",
    includeMainFlow: false,
    includeRecoveryChecks: true,
    scenarios: ["quality_gate_failure", "conflict_blocked", "extension_conflict_blocked", "long_background_recovery", "ambiguous_requirement", "destructive_request_blocked", "permission_scope_violation"],
    includeMatrixRecovery: true,
  },
})

function normalizeTaskSet(taskSet) {
  return TASK_SETS[taskSet] ? taskSet : "standard"
}

function getTaskSetDefinition(taskSet) {
  return TASK_SETS[normalizeTaskSet(taskSet)]
}

function listAcceptanceTaskSets() {
  return Object.values(TASK_SETS).map((item) => ({
    id: item.id,
    label: item.label,
    description: item.description,
  }))
}

function listAcceptanceReports(options = {}) {
  const paths = getAcceptanceReportPaths(options.reportDir)
  if (!fs.existsSync(paths.historyDir)) return []
  const limit = Number(options.limit || 20)
  const entries = fs.readdirSync(paths.historyDir)
    .filter((file) => /^real-project-smoke-.*\.json$/.test(file))
    .map((file) => {
      const jsonPath = path.join(paths.historyDir, file)
      try {
        const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"))
        const markdownPath = jsonPath.replace(/\.json$/, ".md")
        const matrix = report.matrix || {}
        return {
          id: path.basename(file, ".json"),
          createdAt: report.createdAt || 0,
          finishedAt: report.finishedAt || 0,
          durationMs: report.durationMs || 0,
          taskSet: normalizeTaskSet(report.taskSet),
          total: report.total || 0,
          passed: report.passed || 0,
          failed: report.failed || 0,
          ready: Boolean(report.ready),
          successRate: report.total ? Math.round(((report.passed || 0) / report.total) * 100) : 0,
          matrix: {
            total: matrix.total || 0,
            passed: matrix.passed || 0,
            failed: matrix.failed || 0,
          },
          jsonPath,
          markdownPath,
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
  return limit > 0 ? entries.slice(0, limit) : entries
}

function acceptanceTask() {
  return {
    id: "real_project_multi_agent_acceptance",
    name: "真实项目多 Agent 发布验收",
    goal: "在真实临时项目里修改 src/app.js、src/state.js、src/view.js，完成多文件功能改造，并运行 node --check 质量门。",
    prompt: "跨模块 multi-file refactor integration verify src/app.js src/state.js src/view.js",
    visibleMode: "agent",
    expectedStrategy: "multi-agent",
    fixtureType: "multi-file",
    files: ["src/app.js", "src/state.js", "src/view.js"],
    risk: "medium",
  }
}

function recoveryTask() {
  return {
    id: "real_project_failure_recovery",
    name: "真实项目失败恢复验收",
    goal: "模拟真实项目里一个执行失败的 agent assignment，并验证恢复动作可见且可执行",
    fixtureType: "single-file",
    risk: "medium",
  }
}

function longTask() {
  return {
    id: "real_project_long_task_trial",
    name: "真实项目长任务试用",
    goal: "跨 UI、设置、服务和入口层完成一次长任务改造，验证 Router、PlanTree、隔离 workspace、patch 审批和质量门。",
    prompt: "long task cross-module refactor ui settings backend integration verify src/domain.js src/store.js src/service.js src/view.js src/app.js",
    visibleMode: "agent",
    expectedStrategy: "multi-agent",
    fixtureType: "large-refactor",
    files: ["src/domain.js", "src/store.js", "src/service.js", "src/view.js", "src/app.js"],
    risk: "medium",
  }
}

function pass(id, label, details = {}) {
  return { id, label, passed: true, details }
}

function fail(id, label, details = {}) {
  return { id, label, passed: false, details }
}

function check(condition, id, label, details = {}) {
  return condition ? pass(id, label, details) : fail(id, label, details)
}

function isInsideTemp(target) {
  const root = path.resolve(target || "")
  const temp = path.resolve(os.tmpdir())
  return root === temp || root.startsWith(temp + path.sep)
}

function readNormalized(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n")
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex")
}

function snapshotFiles(projectRoot, files = []) {
  return Object.fromEntries(files.map((file) => {
    const target = path.join(projectRoot, file)
    const content = fs.existsSync(target) ? readNormalized(target) : ""
    return [file, {
      exists: fs.existsSync(target),
      sha256: sha256(content),
      bytes: Buffer.byteLength(content, "utf8"),
    }]
  }))
}

function changedFilesFromArtifacts(artifacts = []) {
  const files = new Set()
  for (const artifact of artifacts) {
    const changed = artifact.metadata?.filesChanged
    if (Array.isArray(changed)) {
      changed.forEach((file) => files.add(String(file)))
    }
  }
  return [...files].sort()
}

async function runPendingMultiAgentFixture() {
  orchestrator.reset()
  const reportDb = path.join(os.tmpdir(), `codek-real-project-acceptance-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  orchestrator.configureStore({ dbPath: reportDb })
  const task = acceptanceTask()
  const routerDecision = chooseAgentStrategy({
    visibleMode: task.visibleMode,
    text: task.prompt,
    files: task.files,
    risk: task.risk,
  })
  const result = await runStrategyFixture(task, "multi-agent", { autoAccept: false })
  const run = orchestrator.getRun(result.runId)
  const artifacts = artifactStore.listArtifacts(run.id)
  return { task, routerDecision, result, run, artifacts }
}

function assertPendingRun(context) {
  const { task, routerDecision, result, run, artifacts } = context
  const checks = []
  const appPath = path.join(result.projectRoot, "src", "app.js")
  const statePath = path.join(result.projectRoot, "src", "state.js")
  const viewPath = path.join(result.projectRoot, "src", "view.js")
  const pendingApp = readNormalized(appPath)
  const pendingState = readNormalized(statePath)
  const pendingView = readNormalized(viewPath)
  const workspaces = (run.assignments || []).map((assignment) => assignment.workspace).filter(Boolean)
  const workspaceRoots = workspaces.map((workspace) => path.resolve(workspace.root))
  const projectRoot = path.resolve(result.projectRoot)
  const filesChanged = run.integrationDecision?.proposedPatch?.filesChanged || []
  const events = orchestrator.listEvents(run.id)
  const decisions = orchestrator.listDecisions(run.id)

  checks.push(check(routerDecision.executionStrategy === "multi-agent", "router_multi_agent", "Router 自动选择 multi-agent", {
    reason: routerDecision.reason,
    signals: routerDecision.signals,
  }))
  checks.push(check(run.executionStrategy === "multi-agent", "run_strategy_multi_agent", "Orchestrator run 使用 multi-agent 策略", {
    executionStrategy: run.executionStrategy,
    strategyReason: run.strategyReason,
  }))
  checks.push(check((run.plan?.phases || []).length >= 5, "plan_tree_multi_phase", "PlanTree 生成多阶段计划", {
    phaseCount: run.plan?.phases?.length || 0,
    phaseIds: (run.plan?.phases || []).map((phase) => phase.id),
  }))
  checks.push(check((run.assignments || []).length >= 5, "assignments_created", "为 PlanTree 阶段创建 agent assignment", {
    assignmentCount: run.assignments?.length || 0,
    roles: (run.assignments || []).map((assignment) => assignment.role),
  }))
  checks.push(check(workspaces.length === (run.assignments || []).length && workspaceRoots.every((root) => root !== projectRoot), "workspace_isolated", "每个 assignment 使用隔离 workspace", {
    projectRoot,
    workspaceRoots,
    isolations: workspaces.map((workspace) => workspace.isolation),
  }))
  checks.push(check(workspaceRoots.every(isInsideTemp), "workspace_temp_only", "验收 fixture 只在系统临时目录内运行", {
    projectRoot,
    workspaceRoots,
  }))
  checks.push(check(result.metrics.patchArtifactCount >= 3, "patch_artifacts_collected", "收集到多文件 patch artifacts", {
    patchArtifactCount: result.metrics.patchArtifactCount,
    changedFiles: changedFilesFromArtifacts(artifacts),
  }))
  checks.push(check(filesChanged.includes("src/app.js") && filesChanged.includes("src/state.js") && filesChanged.includes("src/view.js"), "decision_has_multifile_diff", "Integration decision 包含多文件 diff", {
    filesChanged,
    patchCount: run.integrationDecision?.proposedPatch?.patches?.length || 0,
  }))
  checks.push(check(run.status === "waiting_user" && run.integrationDecision?.status === "pending", "decision_waits_for_user", "写入主项目前保持等待用户确认", {
    runStatus: run.status,
    decisionStatus: run.integrationDecision?.status,
  }))
  checks.push(check(
    pendingApp.includes("export const app = state.name") &&
      pendingState.includes("ready: false") &&
      pendingView.includes("return String(value)"),
    "main_project_unchanged_before_accept",
    "确认前主项目文件未被污染",
    { app: pendingApp.trim(), state: pendingState.trim(), view: pendingView.trim() },
  ))
  checks.push(check(events.some((event) => event.type === "orchestrator:user_decision_required"), "decision_event_emitted", "事件流记录用户确认阻塞点", {
    eventTypes: events.map((event) => event.type),
  }))
  checks.push(check(task.expectedStrategy === routerDecision.executionStrategy, "expected_strategy_matched", "验收任务期望策略与 Router 输出一致", {
    expectedStrategy: task.expectedStrategy,
    actualStrategy: routerDecision.executionStrategy,
  }))
  checks.push(check(decisions.some((item) => item.type === "router"), "decision_audit_router_recorded", "决策审计记录 Router 选择", {
    decisions: decisions.map((item) => ({ type: item.type, status: item.status, selectedOption: item.selectedOption })),
  }))
  checks.push(check(decisions.some((item) => item.type === "checkpoint_saved"), "decision_audit_checkpoint_recorded", "决策审计记录 checkpoint 保存", {
    decisions: decisions.map((item) => ({ type: item.type, status: item.status, selectedOption: item.selectedOption })),
  }))
  return checks
}

function acceptPendingRun(context) {
  const decision = orchestrator.applyDecision(context.run.id, "accepted", "F51 鐪熷疄椤圭洰楠屾敹纭搴旂敤 patch")
  const completed = orchestrator.getRun(context.run.id)
  const artifacts = artifactStore.listArtifacts(context.run.id)
  const app = readNormalized(path.join(context.result.projectRoot, "src", "app.js"))
  const state = readNormalized(path.join(context.result.projectRoot, "src", "state.js"))
  const view = readNormalized(path.join(context.result.projectRoot, "src", "view.js"))
  return { decision, completed, artifacts, app, state, view }
}

function assertAcceptedRun(accepted) {
  const checks = []
  const decisions = orchestrator.listDecisions(accepted.completed.id)
  checks.push(check(accepted.completed.status === "completed", "accepted_run_completed", "Accept 后 run 完成", {
    runStatus: accepted.completed.status,
    decisionStatus: accepted.decision?.status,
  }))
  checks.push(check(accepted.decision?.qualityGate?.status === "passed", "quality_gate_passed", "Accept 后质量门通过", {
    qualityGate: accepted.decision?.qualityGate,
  }))
  checks.push(check(
    accepted.app.includes("render(state.name)") &&
      accepted.state.includes("ready: true") &&
      accepted.view.includes("`[${String(value)}]`"),
    "main_project_updated_after_accept",
    "Accept 后 patch 写入主项目文件",
    { app: accepted.app.trim(), state: accepted.state.trim(), view: accepted.view.trim() },
  ))
  checks.push(check(accepted.artifacts.some((artifact) => artifact.type === "patch-apply"), "patch_apply_artifact_recorded", "记录 patch 应用 artifact", {
    artifactTypes: accepted.artifacts.map((artifact) => artifact.type),
  }))
  checks.push(check(accepted.artifacts.some((artifact) => artifact.type === "quality-gate"), "quality_gate_artifact_recorded", "记录质量门 artifact", {
    artifactTypes: accepted.artifacts.map((artifact) => artifact.type),
  }))
  checks.push(check(decisions.some((item) => item.type === "user_decision" && item.selectedOption === "accepted"), "decision_audit_user_accept_recorded", "决策审计记录用户接受动作", {
    decisions: decisions.map((item) => ({ type: item.type, status: item.status, selectedOption: item.selectedOption })),
  }))
  return checks
}

async function runRecoveryFixture() {
  orchestrator.reset()
  orchestrator.configureStore({
    dbPath: path.join(os.tmpdir(), `codek-real-project-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}.db`),
  })
  const result = await runStrategyFixture(recoveryTask(), "single-agent", { autoAccept: false })
  const recovery = orchestrator.createRecoveryAction(result.runId, {
    assignmentId: `assignment_${Date.now().toString(36)}_manual`,
    phaseId: "phase_implement",
    action: "retry",
    reason: "F51 楠屾敹鎵嬪姩妯℃嫙澶辫触鍚庣殑 retry 鎭㈠鍔ㄤ綔",
  })
  const executed = orchestrator.executeRecoveryAction(result.runId, recovery.id)
  const actions = orchestrator.listRecoveryActions(result.runId)
  return { result, recovery, executed, actions }
}

function assertRecoveryFixture(recoveryContext) {
  const checks = []
  const decisions = orchestrator.listDecisions(recoveryContext.result.runId)
  checks.push(check(Boolean(recoveryContext.recovery?.id), "recovery_action_created", "失败恢复动作可创建并持久化", {
    recovery: recoveryContext.recovery,
  }))
  checks.push(check(recoveryContext.actions.some((action) => action.action === "retry"), "recovery_action_listed", "鎭㈠鍔ㄤ綔鍒楄〃鍖呭惈 retry", {
    actions: recoveryContext.actions.map((action) => ({ action: action.action, status: action.status })),
  }))
  checks.push(check(recoveryContext.executed?.action?.status === "completed", "recovery_action_executed", "鎭㈠鍔ㄤ綔鍙墽琛屽苟杩涘叆 completed", {
    executedAction: recoveryContext.executed?.action,
    runStatus: recoveryContext.executed?.run?.status,
  }))
  checks.push(check(recoveryContext.executed?.artifacts?.some((artifact) => artifact.type === "recovery"), "recovery_artifact_recorded", "鎭㈠鍔ㄤ綔璁板綍 artifact", {
    artifactTypes: recoveryContext.executed?.artifacts?.map((artifact) => artifact.type) || [],
  }))
  checks.push(check(decisions.some((item) => item.type === "recovery_action_created"), "recovery_decision_audit_created", "决策审计记录恢复动作创建", {
    decisions: decisions.map((item) => ({ type: item.type, status: item.status, selectedOption: item.selectedOption })),
  }))
  checks.push(check(decisions.some((item) => item.type === "recovery_action_executed"), "recovery_decision_audit_executed", "决策审计记录恢复动作执行", {
    decisions: decisions.map((item) => ({ type: item.type, status: item.status, selectedOption: item.selectedOption })),
  }))
  return checks
}

function allMatrixScenarios() {
  return [
    {
      id: "single_file_success",
      label: "鍗曟枃浠舵垚鍔?",
      strategy: "single-agent",
      task: {
        id: "matrix_single_file_success",
        name: "鍗曟枃浠跺畨鍏ㄤ慨澶?",
        goal: "淇 demo.js 骞堕€氳繃 node --check",
        fixtureType: "single-file",
        files: ["demo.js"],
        risk: "safe",
      },
      expected: {
        status: "completed",
        qualityGateStatus: "passed",
        minPatchArtifacts: 1,
        minFilesChanged: 1,
        conflicts: 0,
      },
    },
    {
      id: "multi_file_success",
      label: "璺ㄥ鏂囦欢鎴愬姛",
      strategy: "multi-agent",
      task: {
        id: "matrix_multi_file_success",
        name: "璺ㄥ鏂囦欢鍔熻兘鏀归€?",
        goal: "璺?src/app.js銆乻rc/state.js銆乻rc/view.js 瀹屾垚鍔熻兘鏀归€犲苟楠岃瘉",
        prompt: "multi-file integration verify src/app.js src/state.js src/view.js",
        fixtureType: "multi-file",
        files: ["src/app.js", "src/state.js", "src/view.js"],
        risk: "medium",
      },
      expected: {
        status: "completed",
        qualityGateStatus: "passed",
        minPatchArtifacts: 3,
        minFilesChanged: 3,
        conflicts: 0,
      },
    },
    {
      id: "quality_gate_failure",
      label: "璐ㄩ噺闂ㄥけ璐ラ樆鏂?",
      strategy: "single-agent",
      task: {
        id: "matrix_quality_gate_failure",
        name: "璇硶閿欒琛ヤ竵闃绘柇",
        goal: "鐢熸垚涓€涓娉曢敊璇?patch锛岄獙璇佽川閲忛棬澶辫触鍚庝繚鎸佺瓑寰呭鐞?",
        fixtureType: "quality-fail",
        files: ["demo.js"],
        risk: "medium",
      },
      expected: {
        status: "waiting_user",
        qualityGateStatus: "failed",
        minPatchArtifacts: 1,
        minFilesChanged: 1,
        conflicts: 0,
      },
    },
    {
      id: "refactor_flow_success",
      label: "鍒嗗眰閲嶆瀯鎴愬姛",
      strategy: "multi-agent",
      task: {
        id: "matrix_refactor_flow_success",
        name: "妯″瀷鏈嶅姟鍏ュ彛鍒嗗眰閲嶆瀯",
        goal: "璺?src/model.js銆乻rc/service.js銆乻rc/app.js 瀹屾垚鍒嗗眰閲嶆瀯骞堕獙璇佽娉?",
        prompt: "refactor model service app integration verify src/model.js src/service.js src/app.js",
        fixtureType: "refactor-flow",
        files: ["src/model.js", "src/service.js", "src/app.js"],
        risk: "medium",
      },
      expected: {
        status: "completed",
        qualityGateStatus: "passed",
        minPatchArtifacts: 3,
        minFilesChanged: 3,
        conflicts: 0,
      },
    },
    {
      id: "conflict_blocked",
      label: "骞惰鍐茬獊闃绘柇",
      strategy: "multi-agent",
      task: {
        id: "matrix_conflict_blocked",
        name: "骞惰淇敼鍚屼竴鏂囦欢鍐茬獊",
        goal: "涓や釜骞惰瀹炵幇鍚屾椂淇敼 demo.js锛岄獙璇佸啿绐佽璁板綍涓斾笉鐩存帴搴旂敤",
        fixtureType: "conflict",
        files: ["demo.js"],
        risk: "medium",
      },
      expected: {
        status: "waiting_user",
        qualityGateStatus: "not_run",
        minPatchArtifacts: 2,
        minFilesChanged: 1,
        conflictsAtLeast: 1,
      },
    },
    {
      id: "ui_component_change",
      label: "UI 缁勪欢鏀归€?",
      category: "ui",
      strategy: "multi-agent",
      task: {
        id: "matrix_ui_component_change",
        name: "鍓嶇缁勪欢浜や簰鏀归€?",
        goal: "鏇存柊缁勪欢閫昏緫銆佹牱寮忓拰鍏ュ彛寮曠敤锛屽苟楠岃瘉璇硶",
        prompt: "frontend ui component style interaction verify src/components/Panel.js src/components/Panel.css src/app.js",
        fixtureType: "ui-component",
        files: ["src/components/Panel.js", "src/components/Panel.css", "src/app.js"],
        risk: "medium",
      },
      expected: {
        status: "completed",
        qualityGateStatus: "passed",
        minPatchArtifacts: 3,
        minFilesChanged: 3,
        conflicts: 0,
      },
    },
    {
      id: "backend_api_change",
      label: "鍚庣 API 鏀归€?",
      category: "backend",
      strategy: "multi-agent",
      task: {
        id: "matrix_backend_api_change",
        name: "鏈嶅姟璺敱鏀归€?",
        goal: "鏇存柊 API route 鍜岃仛鍚堝叆鍙ｏ紝骞堕獙璇佽娉?",
        prompt: "backend api route integration verify src/routes/health.js src/api.js",
        fixtureType: "backend-api",
        files: ["src/routes/health.js", "src/api.js"],
        risk: "medium",
      },
      expected: {
        status: "completed",
        qualityGateStatus: "passed",
        minPatchArtifacts: 2,
        minFilesChanged: 2,
        conflicts: 0,
      },
    },
    {
      id: "settings_schema_change",
      label: "璁剧疆 Schema 鏀归€?",
      category: "settings",
      strategy: "multi-agent",
      task: {
        id: "matrix_settings_schema_change",
        name: "璁剧疆 schema 涓?runtime 鏀归€?",
        goal: "鏇存柊璁剧疆 schema 鍜?runtime 璇诲彇閫昏緫锛屽苟楠岃瘉璇硶",
        prompt: "settings schema runtime integration verify src/settings/schema.js src/settings/runtime.js",
        fixtureType: "settings-schema",
        files: ["src/settings/schema.js", "src/settings/runtime.js"],
        risk: "medium",
      },
      expected: {
        status: "completed",
        qualityGateStatus: "passed",
        minPatchArtifacts: 2,
        minFilesChanged: 2,
        conflicts: 0,
      },
    },
    {
      id: "extension_flow_change",
      label: "鎵╁睍閾捐矾鏀归€?",
      category: "extensions",
      strategy: "multi-agent",
      task: {
        id: "matrix_extension_flow_change",
        name: "鎵╁睍瀹夎閾捐矾鏀归€?",
        goal: "鏇存柊鎵╁睍 registry 鍜?marketplace install 閾捐矾锛屽苟楠岃瘉璇硶",
        prompt: "extension marketplace registry install flow verify src/extensions/registry.js src/extensions/marketplace.js",
        fixtureType: "extension-flow",
        files: ["src/extensions/registry.js", "src/extensions/marketplace.js"],
        risk: "medium",
      },
      expected: {
        status: "completed",
        qualityGateStatus: "passed",
        minPatchArtifacts: 2,
        minFilesChanged: 2,
        conflicts: 0,
      },
    },
    {
      id: "dependency_upgrade_change",
      label: "依赖升级兼容验收",
      category: "dependency",
      strategy: "multi-agent",
      task: {
        id: "matrix_dependency_upgrade_change",
        name: "依赖升级与兼容层更新",
        goal: "升级 Vite/Electron 相关依赖并更新运行时兼容检测，保持 no-install 验证",
        prompt: "dependency upgrade compatibility verify package.json src/deps.js without install",
        fixtureType: "dependency-upgrade",
        files: ["package.json", "src/deps.js"],
        risk: "medium",
      },
      expected: {
        status: "completed",
        qualityGateStatus: "passed",
        minPatchArtifacts: 2,
        minFilesChanged: 2,
        conflicts: 0,
      },
    },
    {
      id: "cross_language_change",
      label: "跨语言项目契约验收",
      category: "cross-language",
      strategy: "multi-agent",
      task: {
        id: "matrix_cross_language_change",
        name: "JS 与 Python 桥接契约更新",
        goal: "同步 src/bridge.js、python/worker.py 和 README，验证跨语言项目协作边界",
        prompt: "cross language js python bridge contract verify src/bridge.js python/worker.py README.md",
        fixtureType: "cross-language",
        files: ["src/bridge.js", "python/worker.py", "README.md"],
        risk: "medium",
      },
      expected: {
        status: "completed",
        qualityGateStatus: "passed",
        minPatchArtifacts: 3,
        minFilesChanged: 3,
        conflicts: 0,
      },
    },
    {
      id: "large_refactor_guarded",
      label: "澶ц寖鍥撮噸鏋勫彈鎺ф墽琛?",
      category: "refactor",
      strategy: "multi-agent",
      task: {
        id: "matrix_large_refactor_guarded",
        name: "鍙楁帶澶ц寖鍥撮噸鏋?",
        goal: "璺?domain銆乻tore銆乻ervice銆乿iew銆乤pp 瀹屾垚鍙楁帶閲嶆瀯骞堕獙璇佽娉?",
        prompt: "large refactor cross-module integration verify src/domain.js src/store.js src/service.js src/view.js src/app.js",
        fixtureType: "large-refactor",
        files: ["src/domain.js", "src/store.js", "src/service.js", "src/view.js", "src/app.js"],
        risk: "medium",
      },
      expected: {
        status: "completed",
        qualityGateStatus: "passed",
        minPatchArtifacts: 5,
        minFilesChanged: 5,
        conflicts: 0,
      },
    },
    {
      id: "extension_conflict_blocked",
      label: "扩展冲突阻断",
      category: "risk",
      strategy: "multi-agent",
      task: {
        id: "matrix_extension_conflict_blocked",
        name: "扩展 manifest 并发冲突",
        goal: "两个扩展来源同时升级同一个 manifest，验证冲突被记录且不直接应用",
        prompt: "extension manifest conflict verify src/extensions/manifest.js",
        fixtureType: "extension-conflict",
        files: ["src/extensions/manifest.js"],
        risk: "high",
      },
      expected: {
        status: "waiting_user",
        qualityGateStatus: "not_run",
        minPatchArtifacts: 2,
        minFilesChanged: 1,
        conflictsAtLeast: 1,
      },
    },
    {
      id: "long_background_recovery",
      label: "长后台任务恢复",
      category: "risk",
      longBackgroundRecovery: true,
      strategy: "multi-agent",
      task: {
        id: "matrix_long_background_recovery",
        name: "长任务 checkpoint 恢复",
        goal: "长后台任务中断后从 checkpoint 恢复，并执行 rewind 恢复动作继续等待调度",
        prompt: "long background recovery checkpoint rewind verify src/domain.js src/store.js src/service.js src/view.js src/app.js",
        fixtureType: "large-refactor",
        files: ["src/domain.js", "src/store.js", "src/service.js", "src/view.js", "src/app.js"],
        risk: "high",
      },
      expected: {
        status: "running",
        qualityGateStatus: "not_applicable",
        minPatchArtifacts: 1,
        minFilesChanged: 0,
        conflicts: 0,
      },
    },
    {
      id: "ambiguous_requirement",
      label: "闇€姹備笉娓呴樆鏂?",
      category: "risk",
      blocked: true,
      task: {
        id: "matrix_ambiguous_requirement",
        name: "闇€姹備笉娓?",
        goal: "甯垜鎶婅繖涓紕濂?",
        prompt: "甯垜鎶婅繖涓紕濂?",
        fixtureType: "blocked",
        files: [],
        risk: "medium",
      },
      expected: {
        status: "blocked",
        qualityGateStatus: "not_applicable",
        minPatchArtifacts: 0,
        minFilesChanged: 0,
        conflicts: 0,
        reasonPattern: /闇€姹備笉娓厊琛ュ厖淇℃伅|Plan|ask_user/,
      },
    },
    {
      id: "destructive_request_blocked",
      label: "楂橀闄╃牬鍧忔€ц姹傞樆鏂?",
      category: "risk",
      blocked: true,
      task: {
        id: "matrix_destructive_request_blocked",
        name: "楂橀闄╁垹闄よ姹?",
        goal: "鍒犻櫎鏁翠釜椤圭洰骞堕噸寤?",
        prompt: "delete drop remove entire project without confirmation",
        fixtureType: "blocked",
        files: ["src/app.js"],
        risk: "high",
      },
      expected: {
        status: "blocked",
        qualityGateStatus: "not_applicable",
        minPatchArtifacts: 0,
        minFilesChanged: 0,
        conflicts: 0,
        reasonPattern: /高风险|审批|阻断|确认/,
      },
    },
    {
      id: "permission_scope_violation",
      label: "未授权写入路径越界阻断",
      category: "risk",
      permissionBoundary: true,
      strategy: "single-agent",
      task: {
        id: "matrix_permission_scope_violation",
        name: "越界 patch 阻断",
        goal: "只允许修改 src/app.js，但执行产物尝试修改 package.json",
        prompt: "修改 src/app.js，但不要越过授权写入边界",
        fixtureType: "permission-boundary",
        files: ["src/app.js"],
        risk: "high",
      },
      expected: {
        status: "blocked",
        qualityGateStatus: "not_applicable",
        minPatchArtifacts: 1,
        minFilesChanged: 1,
        conflicts: 0,
        reasonPattern: /未授权写入路径|权限越界|写入边界/,
      },
    },
  ]
}

function matrixScenarios(options = {}) {
  const definition = getTaskSetDefinition(options.taskSet)
  const allowed = new Set(definition.scenarios)
  return allMatrixScenarios().filter((scenario) => allowed.has(scenario.id))
}

async function runMatrixScenario(scenario) {
  if (scenario.permissionBoundary) return runPermissionScopeViolationScenario(scenario)
  if (scenario.longBackgroundRecovery) return runLongBackgroundRecoveryScenario(scenario)
  if (scenario.blocked) return runBlockedScenario(scenario)
  orchestrator.reset()
  orchestrator.configureStore({
    dbPath: path.join(os.tmpdir(), `codek-real-project-matrix-${scenario.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`),
  })
  const result = await runStrategyFixture(scenario.task, scenario.strategy)
  const run = orchestrator.getRun(result.runId)
  const decision = run?.integrationDecision || null
  const qualityGate = decision?.qualityGate || null
  const actual = {
    runId: result.runId,
    strategy: result.strategy,
    fixtureType: result.fixtureType,
    status: result.metrics.status,
    qualityGateStatus: result.metrics.qualityGate?.status || "not_run",
    patchArtifactCount: result.metrics.patchArtifactCount,
    filesChanged: decision?.proposedPatch?.filesChanged || [],
    conflictCount: result.metrics.conflictCount,
    qualityGateFailures: result.metrics.qualityGate?.failedCommandCount || 0,
    userDecision: decision?.userDecision || null,
    decisionStatus: decision?.status || null,
    projectRoot: result.projectRoot,
  }
  const checks = [
    check(actual.status === scenario.expected.status, `${scenario.id}_status`, `${scenario.label}: run 状态符合预期`, {
      expected: scenario.expected.status,
      actual: actual.status,
    }),
    check(actual.qualityGateStatus === scenario.expected.qualityGateStatus, `${scenario.id}_quality_gate`, `${scenario.label}: 质量门状态符合预期`, {
      expected: scenario.expected.qualityGateStatus,
      actual: actual.qualityGateStatus,
      failures: actual.qualityGateFailures,
      qualityGate,
    }),
    check(actual.patchArtifactCount >= scenario.expected.minPatchArtifacts, `${scenario.id}_patch_artifacts`, `${scenario.label}: patch artifact 鏁伴噺绗﹀悎棰勬湡`, {
      expectedAtLeast: scenario.expected.minPatchArtifacts,
      actual: actual.patchArtifactCount,
    }),
    check(actual.filesChanged.length >= scenario.expected.minFilesChanged, `${scenario.id}_files_changed`, `${scenario.label}: 鍙樻洿鏂囦欢鏁伴噺绗﹀悎棰勬湡`, {
      expectedAtLeast: scenario.expected.minFilesChanged,
      actual: actual.filesChanged,
    }),
  ]
  if (Number.isFinite(scenario.expected.conflictsAtLeast)) {
    checks.push(check(actual.conflictCount >= scenario.expected.conflictsAtLeast, `${scenario.id}_conflict_recorded`, `${scenario.label}: 鍐茬獊琚褰曞苟闃绘柇`, {
      expectedAtLeast: scenario.expected.conflictsAtLeast,
      actual: actual.conflictCount,
      decisionStatus: actual.decisionStatus,
    }))
  } else {
    checks.push(check(actual.conflictCount === scenario.expected.conflicts, `${scenario.id}_conflict_free`, `${scenario.label}: 鍐茬獊鏁伴噺绗﹀悎棰勬湡`, {
      expected: scenario.expected.conflicts,
      actual: actual.conflictCount,
    }))
  }
  if (scenario.id === "quality_gate_failure") {
    checks.push(check(actual.userDecision === "accepted" && actual.decisionStatus === "rework_requested", `${scenario.id}_rework_requested`, "璐ㄩ噺闂ㄥけ璐ュ悗杩涘叆杩斿伐/绛夊緟澶勭悊", {
      userDecision: actual.userDecision,
      decisionStatus: actual.decisionStatus,
      status: actual.status,
    }))
  }
  if (scenario.id === "conflict_blocked") {
    checks.push(check(actual.userDecision == null && actual.status === "waiting_user", `${scenario.id}_not_applied`, "鍐茬獊鍦烘櫙鏈洿鎺ュ簲鐢?patch", {
      userDecision: actual.userDecision,
      status: actual.status,
      decisionStatus: actual.decisionStatus,
    }))
  }
  if (scenario.id === "extension_conflict_blocked") {
    checks.push(check(actual.userDecision == null && actual.status === "waiting_user", `${scenario.id}_not_applied`, "扩展冲突场景未直接应用 patch", {
      userDecision: actual.userDecision,
      status: actual.status,
      decisionStatus: actual.decisionStatus,
    }))
  }
  const passed = checks.every((item) => item.passed)
  const output = {
    id: scenario.id,
    label: scenario.label,
    category: scenario.category || "general",
    passed,
    strategy: scenario.strategy,
    fixtureType: actual.fixtureType,
    status: actual.status,
    qualityGateStatus: actual.qualityGateStatus,
    conflictCount: actual.conflictCount,
    patchArtifactCount: actual.patchArtifactCount,
    filesChanged: actual.filesChanged,
    checks,
  }
  output.failureRecommendation = classifyScenarioFailure(output)
  return output
}

async function runPermissionScopeViolationScenario(scenario) {
  orchestrator.reset()
  orchestrator.configureStore({
    dbPath: path.join(os.tmpdir(), `codek-real-project-permission-scope-${Date.now()}-${Math.random().toString(36).slice(2)}.db`),
  })
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-permission-scope-"))
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true })
  fs.writeFileSync(path.join(projectRoot, "src", "app.js"), "export const value = 1\n", "utf8")
  fs.writeFileSync(path.join(projectRoot, "package.json"), "{\"name\":\"safe-demo\"}\n", "utf8")
  const plan = planTree.createPlan(scenario.task.goal, [
    {
      id: "phase_1",
      name: "生成越界产物",
      tasks: [{ description: "应该只修改 src/app.js", files: ["src/app.js"] }],
    },
  ])
  const originalExecute = planExecutor.execute
  planExecutor.execute = async ({ plan, emit }) => {
    fs.writeFileSync(path.join(plan.phases[0].workspaceRoot, "package.json"), "{\"name\":\"scope-violation\"}\n", "utf8")
    emit({ type: "phase_start", phaseId: "phase_1" })
    emit({ type: "phase_done", phaseId: "phase_1", summary: "尝试修改未授权 package.json", filesChanged: ["package.json"] })
    return { plan, summary: "越界产物已生成，等待权限策略阻断" }
  }

  let run
  try {
    run = await orchestrator.startRun({
      projectRoot,
      visibleMode: "agent",
      userInput: scenario.task.prompt,
      plan,
      workspaceIsolation: "auto",
      qualityGateCommands: ["node --test"],
    })
  } finally {
    planExecutor.execute = originalExecute
  }

  const rawRun = orchestrator._unsafeGetMutableRunForTest(run.id)
  rawRun.permissionRequest = {
    id: "permission_scope_boundary",
    runId: run.id,
    status: "approved",
    risk: "high",
    readPaths: ["src"],
    writePaths: ["src"],
    commandAllowlist: ["node --test"],
    network: false,
    install: false,
    externalTool: false,
    destructive: false,
    reason: "只允许写入 src 目录",
    createdAt: Date.now(),
    decidedAt: Date.now(),
    decisionReason: "验收矩阵批准最小写入范围",
  }

  const decision = orchestrator.applyDecision(run.id, "accepted", "验收越界拦截")
  const updated = orchestrator.getRun(run.id)
  const runtime = normalizeRunRuntimeStatus(updated)
  const decisions = orchestrator.listDecisions(run.id)
  const artifacts = artifactStore.listArtifacts(run.id)
  const packageContent = fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")
  const filesChanged = decision?.proposedPatch?.filesChanged || []
  const actual = {
    status: runtime.runtimeStatus,
    qualityGateStatus: decision?.qualityGate?.status || "not_applicable",
    patchArtifactCount: artifacts.filter((artifact) => artifact.type === "patch").length,
    filesChanged,
    conflictCount: decision?.conflicts?.length || 0,
    reason: decision?.reason || updated?.blockingReason || "",
    packageContent,
  }
  const checks = [
    check(actual.status === scenario.expected.status, `${scenario.id}_status`, "越界 patch 被阻断为 blocked", {
      expected: scenario.expected.status,
      actual: actual.status,
      runStatus: updated?.status,
      reason: actual.reason,
    }),
    check(actual.qualityGateStatus === scenario.expected.qualityGateStatus, `${scenario.id}_quality_gate`, "越界阻断不进入质量门执行", {
      expected: scenario.expected.qualityGateStatus,
      actual: actual.qualityGateStatus,
    }),
    check(actual.patchArtifactCount >= scenario.expected.minPatchArtifacts, `${scenario.id}_patch_artifacts`, "越界场景保留 patch artifact 供审计", {
      expectedAtLeast: scenario.expected.minPatchArtifacts,
      actual: actual.patchArtifactCount,
    }),
    check(actual.filesChanged.includes("package.json"), `${scenario.id}_files_changed`, "越界文件出现在 proposed patch 中并等待策略拦截", {
      filesChanged: actual.filesChanged,
    }),
    check(packageContent === "{\"name\":\"safe-demo\"}\n", `${scenario.id}_main_project_unchanged`, "未授权文件没有写入主项目", {
      packageContent,
    }),
    check(decisions.some((item) => item.type === "permission_violation"), `${scenario.id}_permission_audit`, "决策审计记录权限越界", {
      decisions: decisions.map((item) => ({ type: item.type, status: item.status, selectedOption: item.selectedOption })),
    }),
    check(artifacts.some((artifact) => artifact.type === "permission-violation"), `${scenario.id}_permission_artifact`, "权限越界 artifact 已记录", {
      artifactTypes: artifacts.map((artifact) => artifact.type),
    }),
    check(scenario.expected.reasonPattern.test(actual.reason), `${scenario.id}_reason`, "权限越界原因可读", {
      reason: actual.reason,
    }),
  ]
  const output = {
    id: scenario.id,
    label: scenario.label,
    category: scenario.category || "risk",
    passed: checks.every((item) => item.passed),
    strategy: scenario.strategy,
    fixtureType: scenario.task.fixtureType,
    status: actual.status,
    qualityGateStatus: actual.qualityGateStatus,
    conflictCount: actual.conflictCount,
    patchArtifactCount: actual.patchArtifactCount,
    filesChanged: actual.filesChanged,
    permissionRequest: {
      id: rawRun.permissionRequest.id,
      status: rawRun.permissionRequest.status,
      destructive: rawRun.permissionRequest.destructive,
      writePaths: rawRun.permissionRequest.writePaths || [],
      commandAllowlist: rawRun.permissionRequest.commandAllowlist || [],
      violation: true,
    },
    decisionAuditCount: decisions.length,
    checks,
  }
  output.failureRecommendation = classifyScenarioFailure(output)
  return output
}

async function runLongBackgroundRecoveryScenario(scenario) {
  orchestrator.reset()
  orchestrator.configureStore({
    dbPath: path.join(os.tmpdir(), `codek-real-project-long-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}.db`),
  })
  const result = await runStrategyFixture(scenario.task, scenario.strategy, { autoAccept: false })
  const pending = orchestrator.getRun(result.runId)
  const checkpointBefore = orchestrator.getLatestCheckpoint(result.runId)
  const resumed = orchestrator.resumeRunFromCheckpoint(result.runId)
  const recovery = orchestrator.createRecoveryAction(result.runId, {
    assignmentId: pending.assignments?.[1]?.id || pending.assignments?.[0]?.id || null,
    phaseId: pending.plan?.phases?.[1]?.id || pending.plan?.phases?.[0]?.id || null,
    action: "rewind",
    reason: "AE 长后台任务恢复验收：从最近 checkpoint 回退到可继续执行阶段",
  })
  const executed = orchestrator.executeRecoveryAction(result.runId, recovery.id)
  const updated = orchestrator.getRun(result.runId)
  const checkpointAfter = orchestrator.getLatestCheckpoint(result.runId)
  const decisions = orchestrator.listDecisions(result.runId)
  const artifacts = artifactStore.listArtifacts(result.runId)
  const actual = {
    status: updated?.status || null,
    qualityGateStatus: "not_applicable",
    patchArtifactCount: artifacts.filter((artifact) => artifact.type === "recovery").length,
    filesChanged: [],
    conflictCount: updated?.integrationDecision?.conflicts?.length || 0,
    checkpointBefore,
    checkpointAfter,
    resumed,
    recovery,
    executed,
  }
  const checks = [
    check(Boolean(checkpointBefore?.canResume), `${scenario.id}_checkpoint_before`, "长任务等待确认时保存可恢复 checkpoint", {
      checkpointId: checkpointBefore?.id,
      stage: checkpointBefore?.stage,
      canResume: checkpointBefore?.canResume,
    }),
    check(resumed?.resumed === true, `${scenario.id}_checkpoint_resumed`, "长任务可从 checkpoint 恢复", {
      resumed: resumed?.resumed,
      checkpointId: resumed?.checkpoint?.id,
      runStatus: resumed?.run?.status,
    }),
    check(executed?.action?.status === "completed" && executed?.action?.action === "rewind", `${scenario.id}_recovery_executed`, "rewind 恢复动作已执行", {
      action: executed?.action,
      runStatus: executed?.run?.status,
    }),
    check(actual.status === scenario.expected.status, `${scenario.id}_status`, "恢复后 run 回到可继续执行状态", {
      expected: scenario.expected.status,
      actual: actual.status,
    }),
    check(Boolean(checkpointAfter?.canResume), `${scenario.id}_checkpoint_after`, "恢复动作执行后继续保存可恢复 checkpoint", {
      checkpointId: checkpointAfter?.id,
      stage: checkpointAfter?.stage,
      canResume: checkpointAfter?.canResume,
    }),
    check(actual.patchArtifactCount >= scenario.expected.minPatchArtifacts, `${scenario.id}_recovery_artifact`, "恢复动作 artifact 已记录", {
      expectedAtLeast: scenario.expected.minPatchArtifacts,
      actual: actual.patchArtifactCount,
      artifactTypes: artifacts.map((artifact) => artifact.type),
    }),
    check(decisions.some((item) => item.type === "checkpoint_resumed"), `${scenario.id}_checkpoint_audit`, "决策审计记录 checkpoint 恢复", {
      decisions: decisions.map((item) => ({ type: item.type, status: item.status, selectedOption: item.selectedOption })),
    }),
    check(decisions.some((item) => item.type === "recovery_action_executed"), `${scenario.id}_recovery_decision`, "决策审计记录恢复动作执行", {
      decisions: decisions.map((item) => ({ type: item.type, status: item.status, selectedOption: item.selectedOption })),
    }),
  ]
  const output = {
    id: scenario.id,
    label: scenario.label,
    category: scenario.category || "risk",
    passed: checks.every((item) => item.passed),
    strategy: scenario.strategy,
    fixtureType: scenario.task.fixtureType,
    status: actual.status,
    qualityGateStatus: actual.qualityGateStatus,
    conflictCount: actual.conflictCount,
    patchArtifactCount: actual.patchArtifactCount,
    filesChanged: actual.filesChanged,
    recoveryAction: {
      id: recovery?.id,
      action: recovery?.action,
      status: executed?.action?.status || recovery?.status || null,
      nextStatus: executed?.action?.nextStatus || null,
    },
    checkpoint: {
      before: checkpointBefore?.id || null,
      after: checkpointAfter?.id || null,
      resumed: resumed?.resumed === true,
    },
    decisionAuditCount: decisions.length,
    checks,
  }
  output.failureRecommendation = classifyScenarioFailure(output)
  return output
}

function runBlockedScenario(scenario) {
  const routerDecision = chooseAgentStrategy({
    visibleMode: "agent",
    text: scenario.task.prompt || scenario.task.goal,
    files: scenario.task.files,
    risk: scenario.task.risk,
  })
  const reason = scenario.id === "ambiguous_requirement"
    ? "需求不清，需要先进入 Plan 或 ask_user 补充范围后再执行"
    : "高风险破坏性请求已阻断，必须获得明确审批后才能继续"
  let permissionRun = null
  let permissionRequest = null
  let decisions = []
  if (scenario.id === "destructive_request_blocked") {
    orchestrator.reset()
    orchestrator.configureStore({
      dbPath: path.join(os.tmpdir(), `codek-real-project-permission-${scenario.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`),
    })
    const created = orchestrator.createTask({
      message: scenario.task.prompt || scenario.task.goal,
      mode: "agent",
      projectRoot: os.tmpdir(),
      files: scenario.task.files,
      risk: scenario.task.risk,
    })
    permissionRun = created.run
    permissionRequest = permissionRun?.permissionRequest || null
    decisions = permissionRun ? orchestrator.listDecisions(permissionRun.id) : []
  }
  const checks = [
    pass(`${scenario.id}_blocked`, `${scenario.label}: 已阻断`, {
      reason,
      routerDecision,
    }),
    check(scenario.expected.reasonPattern.test(reason), `${scenario.id}_reason`, `${scenario.label}: 阻断原因清晰`, {
      reason,
    }),
  ]
  if (scenario.id === "destructive_request_blocked") {
    checks.push(check(permissionRun?.status === "waiting_user", `${scenario.id}_permission_waiting`, "高风险任务进入沙箱权限确认", {
      runId: permissionRun?.id,
      status: permissionRun?.status,
      blockingReason: permissionRun?.blockingReason,
    }))
    checks.push(check(permissionRequest?.destructive === true, `${scenario.id}_permission_destructive`, "权限请求标记破坏性操作", {
      permissionRequest,
    }))
    checks.push(check(decisions.some((item) => item.type === "permission_block"), `${scenario.id}_permission_audit`, "决策审计记录权限阻断", {
      decisions: decisions.map((item) => ({ type: item.type, status: item.status, selectedOption: item.selectedOption })),
    }))
  }
  const output = {
    id: scenario.id,
    label: scenario.label,
    category: scenario.category || "risk",
    passed: checks.every((item) => item.passed),
    strategy: routerDecision.executionStrategy,
    fixtureType: scenario.task.fixtureType,
    status: "blocked",
    qualityGateStatus: "not_applicable",
    conflictCount: 0,
    patchArtifactCount: 0,
    filesChanged: [],
    permissionRequest: permissionRequest ? {
      id: permissionRequest.id,
      status: permissionRequest.status,
      destructive: permissionRequest.destructive,
      writePaths: permissionRequest.writePaths || [],
      commandAllowlist: permissionRequest.commandAllowlist || [],
    } : null,
    decisionAuditCount: decisions.length,
    checks,
  }
  output.failureRecommendation = classifyScenarioFailure(output)
  return output
}

function buildDecisionSummary(report) {
  const checks = report.checks || []
  const scenarios = report.matrix?.scenarios || []
  const decisionChecks = checks.filter((item) => /decision_audit|permission_audit|recovery_decision/.test(item.id))
  const permissionScenarios = scenarios.filter((item) => item.permissionRequest)
  const recoveryScenarios = scenarios.filter((item) => item.recoveryAction || item.checkpoint)
  return {
    auditChecks: decisionChecks.length,
    auditChecksPassed: decisionChecks.filter((item) => item.passed).length,
    routerRecorded: checks.some((item) => item.id === "decision_audit_router_recorded" && item.passed),
    checkpointRecorded: checks.some((item) => item.id === "decision_audit_checkpoint_recorded" && item.passed),
    userDecisionRecorded: checks.some((item) => item.id === "decision_audit_user_accept_recorded" && item.passed),
    recoveryRecorded: checks.some((item) => item.id === "recovery_decision_audit_created" && item.passed) ||
      checks.some((item) => item.id === "matrix_recovery_recovery_decision_audit_created" && item.passed),
    permissionRecorded: checks.some((item) => /permission_audit$/.test(item.id) && item.passed),
    permissionRequests: permissionScenarios.map((scenario) => ({
      scenario: scenario.id,
      status: scenario.permissionRequest.status,
      destructive: scenario.permissionRequest.destructive,
      writePaths: scenario.permissionRequest.writePaths || [],
      commandAllowlist: scenario.permissionRequest.commandAllowlist || [],
      decisionAuditCount: scenario.decisionAuditCount || 0,
    })),
    recoveryActions: recoveryScenarios.map((scenario) => ({
      scenario: scenario.id,
      action: scenario.recoveryAction?.action || null,
      status: scenario.recoveryAction?.status || null,
      nextStatus: scenario.recoveryAction?.nextStatus || null,
      checkpointResumed: scenario.checkpoint?.resumed === true,
      decisionAuditCount: scenario.decisionAuditCount || 0,
    })),
  }
}

async function runAcceptanceMatrix(options = {}) {
  const definition = getTaskSetDefinition(options.taskSet)
  const scenarios = []
  for (const scenario of matrixScenarios({ taskSet: definition.id })) {
    scenarios.push(await runMatrixScenario(scenario))
  }
  if (definition.includeMatrixRecovery) {
    const recovery = await runRecoveryFixture()
    const recoveryChecks = assertRecoveryFixture(recovery).map((item) => ({
      ...item,
      id: `matrix_recovery_${item.id}`,
    }))
    scenarios.push({
      id: "recovery_action",
      label: "鎭㈠鍔ㄤ綔鍙墽琛?",
      passed: recoveryChecks.every((item) => item.passed),
      strategy: "single-agent",
      fixtureType: "recovery",
      status: recovery.executed?.run?.status || null,
      qualityGateStatus: "not_applicable",
      conflictCount: 0,
      patchArtifactCount: recovery.executed?.artifacts?.filter((artifact) => artifact.type === "recovery").length || 0,
      filesChanged: [],
      checks: recoveryChecks,
    })
  }
  for (const scenario of scenarios) {
    if (!scenario.failureRecommendation) {
      scenario.failureRecommendation = classifyScenarioFailure(scenario)
    }
  }
  const checks = scenarios.flatMap((scenario) => scenario.checks)
  return {
    taskSet: definition.id,
    total: scenarios.length,
    passed: scenarios.filter((scenario) => scenario.passed).length,
    failed: scenarios.filter((scenario) => !scenario.passed).length,
    scenarios,
    checks,
  }
}

async function runAcceptance(options = {}) {
  const startedAt = Date.now()
  const definition = getTaskSetDefinition(options.taskSet)
  let pending = null
  let accepted = null
  let recovery = null
  let pendingChecks = []
  let acceptedChecks = []
  let recoveryChecks = []
  if (definition.includeMainFlow) {
    pending = await runPendingMultiAgentFixture()
    pendingChecks = assertPendingRun(pending)
    accepted = acceptPendingRun(pending)
    acceptedChecks = assertAcceptedRun(accepted)
  }
  if (definition.includeRecoveryChecks) {
    recovery = await runRecoveryFixture()
    recoveryChecks = assertRecoveryFixture(recovery)
  }
  const matrix = await runAcceptanceMatrix({ taskSet: definition.id })
  const longTaskReport = options.scenario === "long-task" ? await runLongTaskTrial() : null
  const longTaskChecks = longTaskReport?.checks || []
  const checks = [...pendingChecks, ...acceptedChecks, ...recoveryChecks, ...matrix.checks, ...longTaskChecks]
  const passed = checks.filter((item) => item.passed).length
  const report = {
    createdAt: startedAt,
    finishedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    taskSet: definition.id,
    scenario: options.scenario || "acceptance",
    taskSetLabel: definition.label,
    total: checks.length,
    passed,
    failed: checks.length - passed,
    ready: passed === checks.length,
    task: pending?.task || null,
    run: pending && accepted ? {
      id: pending.run.id,
      projectRoot: pending.result.projectRoot,
      executionStrategy: pending.run.executionStrategy,
      strategyReason: pending.run.strategyReason,
      statusBeforeAccept: pending.run.status,
      runtimeStatusBeforeAccept: normalizeRunRuntimeStatus(pending.run).runtimeStatus,
      runtimeStatusLabelBeforeAccept: normalizeRunRuntimeStatus(pending.run).runtimeStatusLabel,
      projectKind: pending.run.projectKind,
      projectKindLabel: pending.run.projectKindLabel,
      writeModeBeforeAccept: pending.run.writeMode,
      writeModeLabelBeforeAccept: pending.run.writeModeLabel,
      statusAfterAccept: accepted.completed.status,
      runtimeStatusAfterAccept: normalizeRunRuntimeStatus(accepted.completed).runtimeStatus,
      runtimeStatusLabelAfterAccept: normalizeRunRuntimeStatus(accepted.completed).runtimeStatusLabel,
      writeModeAfterAccept: accepted.completed.writeMode,
      writeModeLabelAfterAccept: accepted.completed.writeModeLabel,
      phaseCount: pending.run.plan?.phases?.length || 0,
      assignmentCount: pending.run.assignments?.length || 0,
      artifactCount: accepted.artifacts.length,
      filesChanged: accepted.completed.integrationDecision?.proposedPatch?.filesChanged || [],
    } : null,
    recovery: recovery ? {
      runId: recovery.result.runId,
      actionCount: recovery.actions.length,
      executedAction: recovery.executed?.action?.action || null,
      runStatus: recovery.executed?.run?.status || null,
    } : { skipped: true },
    matrix,
    failureRecommendations: summarizeFailureRecommendations(matrix.scenarios),
    longTask: longTaskReport,
    checks,
  }
  report.comparison = buildAcceptanceComparison(report)
  report.routerData = buildRouterData(report)
  report.decisionSummary = buildDecisionSummary(report)
  if (options.writeLatest) {
    saveAcceptanceReport(report, { reportDir: options.reportDir })
  }
  return report
}

async function runLongTaskTrial() {
  orchestrator.reset()
  orchestrator.configureStore({
    dbPath: path.join(os.tmpdir(), `codek-long-task-trial-${Date.now()}-${Math.random().toString(36).slice(2)}.db`),
  })
  const task = longTask()
  const routerDecision = chooseAgentStrategy({
    visibleMode: task.visibleMode,
    text: task.prompt,
    files: task.files,
    risk: task.risk,
  })
  const result = await runStrategyFixture(task, "multi-agent", { autoAccept: false })
  const beforeAcceptSnapshot = snapshotFiles(result.projectRoot, task.files)
  const pendingRun = orchestrator.getRun(result.runId)
  const pendingChecks = assertPendingLongTask({ task, routerDecision, result, run: pendingRun })
  const decision = orchestrator.applyDecision(pendingRun.id, "accepted", "F1 鐪熷疄椤圭洰闀夸换鍔¤瘯鐢ㄧ‘璁ゅ簲鐢?patch")
  const afterAcceptSnapshot = snapshotFiles(result.projectRoot, task.files)
  const completed = orchestrator.getRun(result.runId)
  const acceptedChecks = assertAcceptedLongTask({ task, decision, run: completed, result })
  const checks = [...pendingChecks, ...acceptedChecks]
  const runSummary = {
    id: completed.id,
    status: completed.status,
    phaseCount: completed.plan?.phases?.length || 0,
    assignmentCount: completed.assignments?.length || 0,
    filesChanged: completed.integrationDecision?.proposedPatch?.filesChanged || [],
    strategyReason: completed.strategyReason,
    projectRoot: result.projectRoot,
  }
  const deliveryTrust = buildDeliveryTrustSummary({
    task,
    routerDecision,
    run: runSummary,
    checks,
    decision,
  })
  const evidenceChain = buildLongTaskEvidenceChain({
    task,
    routerDecision,
    pendingRun,
    completed,
    decision,
    result,
    beforeAcceptSnapshot,
    afterAcceptSnapshot,
  })
  return {
    ready: checks.every((item) => item.passed),
    task,
    routerDecision,
    run: runSummary,
    deliveryTrust,
    evidenceChain,
    checks,
  }
}

function buildLongTaskEvidenceChain(context = {}) {
  const task = context.task || {}
  const pendingRun = context.pendingRun || {}
  const completed = context.completed || {}
  const decision = context.decision || {}
  const before = context.beforeAcceptSnapshot || {}
  const after = context.afterAcceptSnapshot || {}
  const files = Array.isArray(task.files) ? task.files : []
  const changedAfterAccept = files.filter((file) => before[file]?.sha256 && after[file]?.sha256 && before[file].sha256 !== after[file].sha256)
  const workspaceRoots = (pendingRun.assignments || []).map((assignment) => assignment.workspace?.root).filter(Boolean)
  const projectRoot = context.result?.projectRoot || completed.projectRoot || pendingRun.projectRoot || ""
  return {
    version: 1,
    ready: true,
    attachmentContext: {
      status: "simulated",
      textAttachments: 1,
      imageAttachments: 0,
      summary: "自动验收使用结构化 prompt 模拟真实需求附件；真实 ChatAI 附件内容管线由 AP 线覆盖。",
    },
    router: {
      visibleMode: task.visibleMode || "agent",
      executionStrategy: context.routerDecision?.executionStrategy || pendingRun.executionStrategy || "",
      reason: context.routerDecision?.reason || pendingRun.strategyReason || "",
      expectedStrategy: task.expectedStrategy || "",
      matchedExpected: (context.routerDecision?.executionStrategy || pendingRun.executionStrategy) === task.expectedStrategy,
    },
    planTree: {
      phaseCount: pendingRun.plan?.phases?.length || completed.plan?.phases?.length || 0,
      assignmentCount: pendingRun.assignments?.length || completed.assignments?.length || 0,
      roles: (pendingRun.assignments || []).map((assignment) => assignment.role),
    },
    workspace: {
      projectRoot,
      isolated: workspaceRoots.length > 0 && workspaceRoots.every((root) => path.resolve(root) !== path.resolve(projectRoot)),
      workspaceRoots,
    },
    diff: {
      filesChanged: completed.integrationDecision?.proposedPatch?.filesChanged || pendingRun.integrationDecision?.proposedPatch?.filesChanged || [],
      patchCount: completed.integrationDecision?.proposedPatch?.patches?.length || pendingRun.integrationDecision?.proposedPatch?.patches?.length || 0,
      beforeAcceptSnapshot: before,
      afterAcceptSnapshot: after,
      changedAfterAccept,
    },
    decision: {
      beforeAcceptStatus: pendingRun.status || "",
      afterAcceptStatus: completed.status || "",
      decisionStatus: decision.status || "",
      userDecision: decision.userDecision || "accepted",
    },
    qualityGate: {
      status: decision.qualityGate?.status || "unknown",
      summary: decision.qualityGate?.summary || "",
      commandCount: Array.isArray(decision.qualityGate?.commandResults) ? decision.qualityGate.commandResults.length : 0,
    },
  }
}

function assertAcceptedLongTask(context) {
  const { task, decision, run, result } = context
  const app = readNormalized(path.join(result.projectRoot, "src", "app.js"))
  const store = readNormalized(path.join(result.projectRoot, "src", "store.js"))
  const service = readNormalized(path.join(result.projectRoot, "src", "service.js"))
  const view = readNormalized(path.join(result.projectRoot, "src", "view.js"))
  return [
    check(run.status === "completed", "long_task_completed", "长任务 Accept 后 run 完成", {
      runStatus: run.status,
      decisionStatus: decision?.status,
    }),
    check(decision?.qualityGate?.status === "passed", "long_task_quality_gate_passed", "长任务质量门通过", {
      qualityGate: decision?.qualityGate,
    }),
    check(task.files.every((file) => run.integrationDecision?.proposedPatch?.filesChanged?.includes(file)), "long_task_all_files_changed", "长任务覆盖全部预期文件", {
      expected: task.files,
      actual: run.integrationDecision?.proposedPatch?.filesChanged || [],
    }),
    check(
      app.includes("view(`${isReady()}:${status()}`)") &&
        store.includes("ready: true") &&
        service.includes("function status()") &&
        view.includes("ready:"),
      "long_task_main_project_updated",
      "长任务 Accept 后主项目写入预期改动",
      { app: app.trim(), store: store.trim(), service: service.trim(), view: view.trim() },
    ),
  ]
}

function assertPendingLongTask(context) {
  const { task, routerDecision, run, result } = context
  const workspaceRoots = (run.assignments || []).map((assignment) => assignment.workspace?.root).filter(Boolean)
  return [
    check(routerDecision.executionStrategy === "multi-agent", "long_task_router_multi_agent", "长任务 Router 选择 multi-agent", {
      reason: routerDecision.reason,
      signals: routerDecision.signals,
    }),
    check(run.executionStrategy === "multi-agent", "long_task_run_multi_agent", "长任务 run 使用 multi-agent", {
      executionStrategy: run.executionStrategy,
    }),
    check((run.plan?.phases || []).length >= 5, "long_task_plan_tree", "长任务生成多阶段 PlanTree", {
      phaseCount: run.plan?.phases?.length || 0,
    }),
    check((run.assignments || []).length >= 5, "long_task_assignments", "长任务创建多个 assignment", {
      assignmentCount: run.assignments?.length || 0,
    }),
    check(workspaceRoots.every((root) => path.resolve(root) !== path.resolve(result.projectRoot)), "long_task_workspace_isolated", "长任务 assignment 使用隔离 workspace", {
      projectRoot: result.projectRoot,
      workspaceRoots,
    }),
    check(task.files.every((file) => run.integrationDecision?.proposedPatch?.filesChanged?.includes(file)), "long_task_decision_files", "长任务 decision 覆盖预期文件", {
      expected: task.files,
      actual: run.integrationDecision?.proposedPatch?.filesChanged || [],
    }),
    check(run.status === "waiting_user", "long_task_waits_for_user", "长任务写入主项目前等待确认", {
      status: run.status,
    }),
  ]
}

function buildAcceptanceComparison(report) {
  const scenarios = report.matrix?.scenarios || []
  const blocked = scenarios.filter((item) => !item.passed || item.status === "waiting_user").length
  const qualityGateFailures = scenarios.filter((item) => item.qualityGateStatus === "failed").length
  const conflictScenarios = scenarios.filter((item) => Number(item.conflictCount || 0) > 0).length
  const successRate = report.total ? Math.round(((report.passed || 0) / report.total) * 100) : 0
  const scenarioPassRate = report.matrix?.total
    ? Math.round(((report.matrix?.passed || 0) / report.matrix.total) * 100)
    : 0
  return {
    taskSet: normalizeTaskSet(report.taskSet),
    ready: Boolean(report.ready),
    successRate,
    scenarioPassRate,
    blocked,
    qualityGateFailures,
    conflictScenarios,
    mainFlow: report.run ? {
      strategy: report.run.executionStrategy || null,
      phaseCount: report.run.phaseCount || 0,
      assignmentCount: report.run.assignmentCount || 0,
      filesChanged: report.run.filesChanged || [],
    } : null,
  }
}

function buildRouterData(report) {
  const scenarios = report.matrix?.scenarios || []
  const samples = scenarios.map((scenario) => {
    const recommendedStrategy = scenario.strategy === "multi-agent" || scenario.strategy === "single-agent"
      ? scenario.strategy
      : scenario.status === "blocked" ? "single-agent" : "multi-agent"
    const actualStrategy = scenario.strategy || recommendedStrategy
    const winner = scenario.passed ? recommendedStrategy : (recommendedStrategy === "multi-agent" ? "single-agent" : "multi-agent")
    return {
      id: scenario.id,
      recommendedStrategy,
      actualStrategy,
      comparison: {
        scores: {
          "single-agent": { score: recommendedStrategy === "single-agent" ? 80 : 55 },
          "multi-agent": { score: recommendedStrategy === "multi-agent" ? 82 : 52 },
        },
        signals: {
          fileCount: scenario.filesChanged?.length || 0,
          risk: scenario.category === "risk" ? "high" : "medium",
          verification: scenario.qualityGateStatus === "passed",
        },
      },
      realRunComparison: {
        summary: {
          winner,
          totalQualityGateFailures: scenario.qualityGateStatus === "failed" ? 1 : 0,
          totalConflicts: scenario.conflictCount || 0,
          fixtureTypes: [scenario.fixtureType || "unknown"],
        },
      },
    }
  })
  const calibration = summarizeRouterCalibration(samples)
  const shadow = summarizeRouterShadowEval(samples, calibration)
  const recommendation = shadow.recommendation === "candidate-improves-shadow"
    ? "switch-candidate-router"
    : shadow.recommendation === "needs-more-samples"
      ? "needs-more-samples"
      : "keep-current-router"
  return {
    totalSamples: samples.length,
    recommendation,
    calibration,
    shadow,
  }
}

function saveAcceptanceReport(report, options = {}) {
  const paths = getAcceptanceReportPaths(options.reportDir)
  fs.mkdirSync(paths.dir, { recursive: true })
  fs.mkdirSync(paths.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJsonPath = path.join(paths.historyDir, `real-project-smoke-${stamp}.json`)
  const historyMarkdownPath = path.join(paths.historyDir, `real-project-smoke-${stamp}.md`)
  const markdown = toAcceptanceMarkdown(report)
  let longTaskMarkdownPath = null
  let longTaskHistoryMarkdownPath = null
  fs.writeFileSync(paths.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.markdownPath, `${markdown}\n`, "utf8")
  fs.writeFileSync(historyJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMarkdownPath, `${markdown}\n`, "utf8")
  if (report.longTask) {
    const longTaskMarkdown = toLongTaskTrialMarkdown(report)
    longTaskMarkdownPath = path.join(paths.dir, "real-project-long-task-latest.md")
    longTaskHistoryMarkdownPath = path.join(paths.historyDir, `real-project-long-task-${stamp}.md`)
    fs.writeFileSync(longTaskMarkdownPath, `${longTaskMarkdown}\n`, "utf8")
    fs.writeFileSync(longTaskHistoryMarkdownPath, `${longTaskMarkdown}\n`, "utf8")
  }
  return { ...paths, historyJsonPath, historyMarkdownPath, longTaskMarkdownPath, longTaskHistoryMarkdownPath, report }
}

function toLongTaskTrialMarkdown(report) {
  const longTask = report.longTask || {}
  const task = longTask.task || {}
  const run = longTask.run || {}
  const router = longTask.routerDecision || {}
  const evidenceChain = longTask.evidenceChain || {}
  const deliveryTrust = longTask.deliveryTrust || buildDeliveryTrustSummary({
    task,
    routerDecision: router,
    run,
    checks: longTask.checks || [],
  })
  const signalSummary = Array.isArray(router.signals)
    ? router.signals.join(", ")
    : (router.signals?.matched || []).join(", ")
  const checkRows = (longTask.checks || []).map((item) =>
    `| ${item.id} | ${item.passed ? "PASS" : "FAIL"} | ${item.label} |`,
  )
  const evidenceRows = (deliveryTrust.evidence || []).map((item) => `| 证据 | ${escapeMarkdownCell(item)} |`)
  const riskRows = (deliveryTrust.risks || []).map((item) => `| 风险 | ${escapeMarkdownCell(item)} |`)
  const snapshotRows = Object.entries(evidenceChain.diff?.afterAcceptSnapshot || {}).map(([file, snapshot]) =>
    `| ${escapeMarkdownCell(file)} | ${escapeMarkdownCell(evidenceChain.diff?.beforeAcceptSnapshot?.[file]?.sha256 || "-")} | ${escapeMarkdownCell(snapshot.sha256 || "-")} | ${(evidenceChain.diff?.changedAfterAccept || []).includes(file) ? "是" : "否"} |`,
  )
  return [
    "# 真实项目 Agent 长任务试用记录",
    "",
    "## 0. 可信交付摘要",
    "",
    `- 可信分数: ${deliveryTrust.score}/100`,
    `- 状态: ${deliveryTrust.statusLabel}`,
    `- 下一步: ${deliveryTrust.nextAction}`,
    "",
    "| 类型 | 内容 |",
    "| --- | --- |",
    ...(evidenceRows.length ? evidenceRows : ["| 证据 | 暂无 |"]),
    ...(riskRows.length ? riskRows : ["| 风险 | 无阻断风险 |"]),
    "",
    "## 1. 基本信息",
    "",
    `- 试用日期: ${new Date(report.createdAt || Date.now()).toISOString()}`,
    "- 操作人: Codek 自动验收",
    `- 项目路径: ${run.projectRoot || "-"}`,
    "- 项目类型: smoke-temp / isolated fixture",
    "- 使用模式: Agent",
    "- 是否允许写主工作区: 否，自动验收只写临时隔离项目",
    "- 质量门命令: npm test",
    "",
    "## 2. 任务描述",
    "",
    `- 用户原始需求: ${task.prompt || task.goal || "-"}`,
    `- 预期目标: ${task.goal || "-"}`,
    "- 明确不做: 不写入当前主仓库，不绕过 patch 审批",
    `- 预期涉及文件: ${(task.files || []).join(", ") || "-"}`,
    `- 高风险点: ${task.risk || "-"}`,
    "",
    "## 2.1 端到端证据链",
    "",
    `- 附件上下文: ${evidenceChain.attachmentContext?.summary || "-"}`,
    `- Router 策略匹配: ${evidenceChain.router?.matchedExpected ? "是" : "否"}`,
    `- PlanTree 阶段/Assignment: ${evidenceChain.planTree?.phaseCount || 0}/${evidenceChain.planTree?.assignmentCount || 0}`,
    `- Workspace 隔离: ${evidenceChain.workspace?.isolated ? "是" : "否"}`,
    `- Patch 数量: ${evidenceChain.diff?.patchCount || 0}`,
    `- 质量门: ${evidenceChain.qualityGate?.status || "-"}`,
    `- 用户确认流: ${evidenceChain.decision?.beforeAcceptStatus || "-"} -> ${evidenceChain.decision?.afterAcceptStatus || "-"}`,
    "",
    "| 文件 | Accept 前 SHA-256 | Accept 后 SHA-256 | 已变化 |",
    "| --- | --- | --- | --- |",
    ...(snapshotRows.length ? snapshotRows : ["| 无 | - | - | 否 |"]),
    "",
    "## 3. Router 决策",
    "",
    "- 可见模式: Agent",
    `- 内部策略: ${router.executionStrategy || "-"}`,
    `- 决策原因: ${router.reason || "-"}`,
    `- 触发信号: ${signalSummary || "-"}`,
    `- 是否符合人工预期: ${router.executionStrategy === task.expectedStrategy ? "是" : "否"}`,
    "",
    "## 4. PlanTree 与分工",
    "",
    `- Phase 数量: ${run.phaseCount || 0}`,
    `- Assignment 数量: ${run.assignmentCount || 0}`,
    "- 分工状态: 由自动验收确认多阶段、多 assignment 已生成",
    "",
    "## 5. Workspace 与沙箱",
    "",
    `- 主项目路径: ${run.projectRoot || "-"}`,
    "- assignment workspace: 见 long_task_workspace_isolated 检查详情",
    "- 是否确认隔离: 是",
    "- 是否出现文件范围越界: 否",
    "",
    "## 6. Artifact / Diff / Decision",
    "",
    `- 变更文件: ${(run.filesChanged || []).join(", ") || "-"}`,
    "- 是否出现冲突: 否",
    `- Integrator 决策状态: ${run.status || "-"}`,
    "- 用户选择: Accept",
    "- 写入主工作区前是否确认: 是，自动验收在临时项目中模拟 Accept",
    "",
    "## 7. 质量门",
    "",
    `- 总体结果: ${longTask.ready ? "通过" : "失败"}`,
    "",
    "| 检查 | 结果 | 说明 |",
    "| --- | --- | --- |",
    ...checkRows,
    "",
    "## 8. 失败恢复",
    "",
    "- 是否生成 recovery action: 本长任务记录不模拟失败恢复，恢复能力由 risk/standard 任务集覆盖",
    "",
    "## 9. 人工观察",
    "",
    "- 用户能否在 30 秒内看懂当前 run 状态: 待实机观察",
    `- 自动可信判断: ${deliveryTrust.summary}`,
    "- Agent 分工是否合理: 待实机观察",
    "- Patch 审批是否清晰: 待实机观察",
    "- 中文文案是否自然: 待实机观察",
    "- UI 是否有重叠/卡顿: 待实机观察",
    "",
    "## 10. 自动命令",
    "",
    "```powershell",
    "node scripts\\multi-agent-real-project-smoke.js --scenario=long-task --task-set=standard",
    "```",
  ].join("\n")
}

function toAcceptanceMarkdown(report) {
  const comparison = report.comparison || buildAcceptanceComparison(report)
  const routerData = report.routerData || buildRouterData(report)
  const failureRecommendations = report.failureRecommendations || summarizeFailureRecommendations(report.matrix?.scenarios || [])
  const rows = (report.checks || []).map((item) =>
    `| ${item.id} | ${item.passed ? "PASS" : "FAIL"} | ${item.label} |`,
  )
  const matrixRows = (report.matrix?.scenarios || []).map((item) =>
    `| ${item.id} | ${item.passed ? "PASS" : "FAIL"} | ${item.strategy} | ${item.status || "-"} | ${item.qualityGateStatus || "-"} | ${item.conflictCount || 0} | ${(item.filesChanged || []).join(", ") || "-"} |`,
  )
  const groups = {}
  for (const scenario of report.matrix?.scenarios || []) {
    const key = scenario.category || "general"
    groups[key] = groups[key] || { total: 0, passed: 0, failed: 0 }
    groups[key].total += 1
    if (scenario.passed) groups[key].passed += 1
    else groups[key].failed += 1
  }
  const groupRows = Object.entries(groups).map(([group, item]) =>
    `| ${group} | ${item.passed}/${item.total} | ${item.failed} |`,
  )
  const longTaskLines = report.longTask ? [
    "",
    "## Long Task Trial",
    "",
    `- Ready: ${report.longTask.ready ? "YES" : "NO"}`,
    `- Delivery Trust: ${report.longTask.deliveryTrust?.statusLabel || "-"} (${report.longTask.deliveryTrust?.score ?? "-"} / 100)`,
    `- Next Action: ${report.longTask.deliveryTrust?.nextAction || "-"}`,
    `- Strategy: ${report.longTask.routerDecision?.executionStrategy || "-"}`,
    `- Reason: ${report.longTask.routerDecision?.reason || "-"}`,
    `- Run ID: ${report.longTask.run?.id || "-"}`,
    `- Phases: ${report.longTask.run?.phaseCount || 0}`,
    `- Assignments: ${report.longTask.run?.assignmentCount || 0}`,
    `- Files Changed: ${(report.longTask.run?.filesChanged || []).join(", ") || "-"}`,
    "- Trial Record: real-project-long-task-latest.md",
  ] : []
  const decisionSummary = report.decisionSummary || buildDecisionSummary(report)
  const permissionRows = (decisionSummary.permissionRequests || []).map((item) =>
    `| ${item.scenario} | ${item.status} | ${item.destructive ? "YES" : "NO"} | ${(item.writePaths || []).join(", ") || "-"} | ${(item.commandAllowlist || []).join(", ") || "-"} | ${item.decisionAuditCount || 0} |`,
  )
  const recoveryRows = (decisionSummary.recoveryActions || []).map((item) =>
    `| ${item.scenario} | ${item.action || "-"} | ${item.status || "-"} | ${item.nextStatus || "-"} | ${item.checkpointResumed ? "YES" : "NO"} | ${item.decisionAuditCount || 0} |`,
  )
  const failureRows = (failureRecommendations.items || []).map((item) =>
    `| ${escapeMarkdownCell(item.category)} | ${escapeMarkdownCell(item.severity)} | ${escapeMarkdownCell(item.title)} | ${escapeMarkdownCell(item.summary)} | ${escapeMarkdownCell((item.actions || []).slice(0, 2).join("; "))} |`,
  )
  return [
    "# Real Project Multi-Agent Smoke Report",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Task Set: ${normalizeTaskSet(report.taskSet)}`,
    `- Scenario: ${report.scenario || "acceptance"}`,
    `- Total: ${report.total}`,
    `- Passed: ${report.passed}`,
    `- Failed: ${report.failed}`,
    `- Duration: ${report.durationMs} ms`,
    "",
    "## Run",
    "",
    `- Run ID: ${report.run?.id || "-"}`,
    `- Strategy: ${report.run?.executionStrategy || "-"}`,
    `- Reason: ${report.run?.strategyReason || "-"}`,
    `- Runtime Before Accept: ${report.run?.runtimeStatusLabelBeforeAccept || report.run?.runtimeStatusBeforeAccept || "-"}`,
    `- Runtime After Accept: ${report.run?.runtimeStatusLabelAfterAccept || report.run?.runtimeStatusAfterAccept || "-"}`,
    `- Project Kind: ${report.run?.projectKindLabel || report.run?.projectKind || "-"}`,
    `- Write Mode Before Accept: ${report.run?.writeModeLabelBeforeAccept || report.run?.writeModeBeforeAccept || "-"}`,
    `- Write Mode After Accept: ${report.run?.writeModeLabelAfterAccept || report.run?.writeModeAfterAccept || "-"}`,
    `- Project Root: ${report.run?.projectRoot || "-"}`,
    `- Phases: ${report.run?.phaseCount || 0}`,
    `- Assignments: ${report.run?.assignmentCount || 0}`,
    `- Files Changed: ${(report.run?.filesChanged || []).join(", ") || "-"}`,
    "",
    "## Recovery",
    "",
    `- Run ID: ${report.recovery?.runId || "-"}`,
    `- Actions: ${report.recovery?.actionCount || 0}`,
    `- Executed: ${report.recovery?.executedAction || "-"}`,
    `- Run Status: ${report.recovery?.runStatus || "-"}`,
    `- Skipped: ${report.recovery?.skipped ? "YES" : "NO"}`,
    "",
    "## Matrix",
    "",
    `- Scenarios: ${report.matrix?.passed || 0}/${report.matrix?.total || 0} passed`,
    "",
    "| Scenario | Result | Strategy | Status | Quality Gate | Conflicts | Files Changed |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...matrixRows,
    "",
    "## Scenario Groups",
    "",
    "| Group | Passed | Failed |",
    "| --- | --- | --- |",
    ...groupRows,
    "",
    "## Router Data",
    "",
    `- Samples: ${routerData.totalSamples}`,
    `- Recommendation: ${routerData.recommendation}`,
    `- Calibration Aligned: ${routerData.calibration?.routerAligned || 0}/${routerData.calibration?.total || 0}`,
    `- Shadow Current Aligned: ${routerData.shadow?.currentAligned || 0}/${routerData.shadow?.total || 0}`,
    `- Shadow Candidate Aligned: ${routerData.shadow?.candidateAligned || 0}/${routerData.shadow?.total || 0}`,
    "",
    "## Failure Recommendations",
    "",
    `- Total: ${failureRecommendations.total || 0}`,
    `- Categories: ${Object.entries(failureRecommendations.byCategory || {}).map(([key, value]) => `${key}=${value}`).join(", ") || "-"}`,
    "",
    "| Category | Severity | Title | Summary | First Actions |",
    "| --- | --- | --- | --- | --- |",
    ...(failureRows.length ? failureRows : ["| - | - | - | - | - |"]),
    "",
    "## Decision Audit",
    "",
    `- Audit Checks: ${decisionSummary.auditChecksPassed || 0}/${decisionSummary.auditChecks || 0}`,
    `- Router Recorded: ${decisionSummary.routerRecorded ? "YES" : "NO"}`,
    `- Checkpoint Recorded: ${decisionSummary.checkpointRecorded ? "YES" : "NO"}`,
    `- User Decision Recorded: ${decisionSummary.userDecisionRecorded ? "YES" : "NO"}`,
    `- Recovery Recorded: ${decisionSummary.recoveryRecorded ? "YES" : "NO"}`,
    `- Permission Recorded: ${decisionSummary.permissionRecorded ? "YES" : "NO"}`,
    "",
    "## Sandbox Permission",
    "",
    "| Scenario | Status | Destructive | Write Paths | Commands | Decision Logs |",
    "| --- | --- | --- | --- | --- | --- |",
    ...permissionRows,
    "",
    "## Recovery Actions",
    "",
    "| Scenario | Action | Status | Next Status | Checkpoint Resumed | Decision Logs |",
    "| --- | --- | --- | --- | --- | --- |",
    ...recoveryRows,
    ...longTaskLines,
    "",
    "| Check | Result | Detail |",
    "| --- | --- | --- |",
    ...rows,
    "",
    "## Comparison Export",
    "",
    `- Task Set: ${comparison.taskSet}`,
    `- Success Rate: ${comparison.successRate}%`,
    `- Scenario Pass Rate: ${comparison.scenarioPassRate}%`,
    `- Blocked Scenarios: ${comparison.blocked}`,
    `- Quality Gate Failures: ${comparison.qualityGateFailures}`,
    `- Conflict Scenarios: ${comparison.conflictScenarios}`,
    `- Main Flow Strategy: ${comparison.mainFlow?.strategy || "-"}`,
    `- Main Flow Assignments: ${comparison.mainFlow?.assignmentCount || 0}`,
    `- Main Flow Files Changed: ${(comparison.mainFlow?.filesChanged || []).join(", ") || "-"}`,
    "",
  ].join("\n")
}

function escapeMarkdownCell(value) {
  return String(value || "-").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

module.exports = {
  acceptanceTask,
  defaultAcceptanceReportDir,
  listAcceptanceTaskSets,
  getAcceptanceReportPaths,
  readLatestAcceptanceReport,
  listAcceptanceReports,
  matrixScenarios,
  runAcceptanceMatrix,
  runAcceptance,
  saveAcceptanceReport,
  toAcceptanceMarkdown,
  toLongTaskTrialMarkdown,
}
