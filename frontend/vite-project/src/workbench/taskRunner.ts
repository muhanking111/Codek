import type { RunConfig } from "../components/debugState"
import { resolveRunConfigVariables, type RunConfigVariableContext } from "./runConfigVariables"
import { createBackgroundProblemState, updateBackgroundProblemState, type ProblemMatcherBackgroundState } from "./problemMatcher"

export type TaskRunStatus = "pending" | "running" | "passed" | "failed" | "skipped" | "cancelled"
type TaskRunMode = "sequence" | "parallel"

export interface TaskRunStep {
  config: RunConfig
  status: TaskRunStatus
  exitCode: number | null
  stdout: string
  stderr: string
  error?: string
  timedOut?: boolean
  cancelled?: boolean
  failureReason?: string
  startedAt?: number
  finishedAt?: number
  dependencyDepth: number
  runMode: TaskRunMode
  background?: ProblemMatcherBackgroundState
}

export interface TaskRunPlan {
  root: RunConfig
  steps: TaskRunStep[]
  blocked: string[]
}

export interface TaskRunEvidenceStep {
  id: string
  name: string
  command: string
  workingDir: string
  status: TaskRunStatus
  exitCode: number | null
  durationMs: number | null
  runMode: TaskRunMode
  dependencyDepth: number
  timedOut: boolean
  cancelled: boolean
  failureReason: string
  backgroundStatus: "inactive" | "active" | "ended"
  backgroundBeginsMatched: boolean
  backgroundEndsMatched: boolean
  outputPreview: string
  errorPreview: string
}

export interface TaskRunEvidence {
  id: string
  name: string
  status: "passed" | "failed" | "blocked" | "running" | "skipped" | "cancelled"
  blocked: string[]
  startedAt: number | null
  finishedAt: number | null
  durationMs: number | null
  steps: TaskRunEvidenceStep[]
  summary: string
}

export type TaskRunLifecycleEventType =
  | "start"
  | "processStarted"
  | "processEnded"
  | "active"
  | "inactive"
  | "end"
  | "terminated"
  | "problemMatcherUpdated"

export interface TaskRunLifecycleEvent {
  taskId: string
  taskName: string
  stepId: string
  stepName: string
  type: TaskRunLifecycleEventType
  status: TaskRunStatus
  exitCode: number | null
  runId: string
  executionId: string
  runType: "singleRun" | "background"
  terminalId: number | null
  processId: number | null
  durationMs?: number
  timestamp: number
  source: "taskRunner"
}

export interface TaskCommandResult {
  stdout?: string
  stderr?: string
  error?: string
  exitCode?: number
  timedOut?: boolean
  cancelled?: boolean
  terminalInstanceId?: number | null
  terminalId?: number | null
  processId?: number | null
}

export interface TaskTerminalReuseLaunchHint {
  terminalInstanceId: number
  taskId: string
  taskName: string
  commandLine: string
  cwd: string
  group: string
  reuseKind: "sameTask" | "idleTask"
  source: "TerminalTaskSystem.reuseTerminal(launchConfigs)"
  stateSource: "terminalManager/taskTerminalReuseOwner"
  vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts"
  currentSourcePath: "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts"
  runtimeReference: false
}

export interface TaskRunnerOptions extends RunConfigVariableContext {
  runCommand: (config: RunConfig & { taskTerminalReuse?: TaskTerminalReuseLaunchHint }) => Promise<TaskCommandResult | null | undefined>
  onDidStateChange?: (event: TaskRunLifecycleEvent) => void
  signal?: AbortSignal
  runId?: string
  taskTerminalReuse?: TaskTerminalReuseLaunchHint | null
}

interface TaskRunLifecycleContext {
  runId: string
  terminalId: number | null
  processId: number | null
}

export function createTaskRunPlan(configs: RunConfig[], root: RunConfig): TaskRunPlan {
  const byIdOrLabel = new Map<string, RunConfig>()
  for (const config of configs) {
    byIdOrLabel.set(config.id, config)
    byIdOrLabel.set(config.name, config)
    byIdOrLabel.set(stripTaskPrefix(config.name), config)
  }

  const steps: RunConfig[] = []
  const blocked: string[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function visit(config: RunConfig): void {
    if (visited.has(config.id)) return
    if (visiting.has(config.id)) {
      blocked.push(`任务依赖存在循环: ${config.name}`)
      return
    }
    visiting.add(config.id)
    for (const dependency of config.dependsOn || []) {
      const dependencyConfig = byIdOrLabel.get(dependency)
      if (!dependencyConfig) {
        blocked.push(`找不到依赖任务: ${dependency}`)
        continue
      }
      visit(dependencyConfig)
    }
    visiting.delete(config.id)
    visited.add(config.id)
    steps.push(config)
  }

  visit(root)
  const depths = computeDependencyDepths(steps)

  return {
    root,
    steps: steps.map((config) => ({
      config,
      status: "pending",
      exitCode: null,
      stdout: "",
      stderr: "",
      dependencyDepth: depths.get(config.id) || 0,
      runMode: root.dependsOrder === "parallel" && config.id !== root.id ? "parallel" : "sequence",
      background: config.isBackground ? createBackgroundProblemState(config.problemMatchers || []) : undefined,
    })),
    blocked: [...new Set(blocked)],
  }
}

export async function runTaskPlan(
  plan: TaskRunPlan,
  options: TaskRunnerOptions,
): Promise<TaskRunPlan> {
  const context: TaskRunLifecycleContext = {
    runId: options.runId || createTaskRunId(),
    terminalId: null,
    processId: null,
  }
  if (plan.blocked.length > 0) {
    for (const step of plan.steps) step.status = "skipped"
    return plan
  }

  if (plan.root.dependsOrder === "parallel") {
    return runParallelDependencyPlan(plan, options, context)
  }

  for (const step of plan.steps) {
    if (isTaskRunCancelled(options)) {
      markCancelled(step)
      emitTaskLifecycleEvent(step, options, "terminated", step.finishedAt, context)
      markRemainingCancelled(plan, step)
      break
    }
    await runSingleStep(step, options, context)
    if (step.status === "failed") {
      markRemainingSkipped(plan, step)
      break
    }
    if (step.status === "cancelled") {
      markRemainingCancelled(plan, step)
      break
    }
  }

  return plan
}

export function buildTaskRunEvidence(plan: TaskRunPlan): TaskRunEvidence {
  const startedAt = minDefined(plan.steps.map((step) => step.startedAt))
  const finishedAt = maxDefined(plan.steps.map((step) => step.finishedAt))
  const status = summarizeStatus(plan)
  const failedStep = plan.steps.find((step) => step.status === "failed")
  const cancelledStep = plan.steps.find((step) => step.status === "cancelled")
  return {
    id: plan.root.id,
    name: plan.root.name,
    status,
    blocked: [...plan.blocked],
    startedAt,
    finishedAt,
    durationMs: startedAt !== null && finishedAt !== null ? Math.max(0, finishedAt - startedAt) : null,
    steps: plan.steps.map((step) => ({
      id: step.config.id,
      name: step.config.name,
      command: step.config.command,
      workingDir: step.config.workingDir,
      status: step.status,
      exitCode: step.exitCode,
      durationMs: step.startedAt !== undefined && step.finishedAt !== undefined
        ? Math.max(0, step.finishedAt - step.startedAt)
        : null,
      runMode: step.runMode,
      dependencyDepth: step.dependencyDepth,
      timedOut: step.timedOut === true,
      cancelled: step.cancelled === true,
      failureReason: step.failureReason || "",
      backgroundStatus: backgroundStatus(step),
      backgroundBeginsMatched: step.background?.beginsMatched === true,
      backgroundEndsMatched: step.background?.endsMatched === true,
      outputPreview: preview(step.stdout),
      errorPreview: preview(step.error || step.stderr),
    })),
    summary: buildEvidenceSummary(plan, status, failedStep, cancelledStep),
  }
}

async function runParallelDependencyPlan(
  plan: TaskRunPlan,
  options: TaskRunnerOptions,
  context?: TaskRunLifecycleContext,
): Promise<TaskRunPlan> {
  const lifecycleContext = context || {
    runId: options.runId || createTaskRunId(),
    terminalId: null,
    processId: null,
  }
  const rootStep = plan.steps.find((step) => step.config.id === plan.root.id)
  const dependencySteps = plan.steps.filter((step) => step !== rootStep)
  const groups = groupByDepth(dependencySteps)
  for (const group of groups) {
    if (isTaskRunCancelled(options)) {
      markPendingCancelled(plan)
      return plan
    }
    await Promise.all(group.map((step) => runSingleStep(step, options, lifecycleContext)))
    if (group.some((step) => step.status === "failed")) {
      markPendingSkipped(plan)
      return plan
    }
    if (group.some((step) => step.status === "cancelled") || isTaskRunCancelled(options)) {
      markPendingCancelled(plan)
      return plan
    }
  }

  if (rootStep) {
    if (isTaskRunCancelled(options)) {
      markCancelled(rootStep)
      emitTaskLifecycleEvent(rootStep, options, "terminated", rootStep.finishedAt, lifecycleContext)
    }
    else await runSingleStep(rootStep, options, lifecycleContext)
  }
  return plan
}

async function runSingleStep(step: TaskRunStep, options: TaskRunnerOptions, context: TaskRunLifecycleContext): Promise<void> {
  if (isTaskRunCancelled(options)) {
    markCancelled(step)
    emitTaskLifecycleEvent(step, options, "terminated", step.finishedAt, context)
    return
  }
  const resolved = resolveRunConfigVariables(step.config, {
    workspaceFolder: options.workspaceFolder,
    activeFile: options.activeFile,
    inputs: step.config.inputs,
  })
  step.config = resolved
  step.status = "running"
  step.startedAt = Date.now()
  emitTaskLifecycleEvent(step, options, "start", step.startedAt, context)
  emitTaskLifecycleEvent(step, options, "processStarted", step.startedAt, context)
  if (step.config.isBackground) emitTaskLifecycleEvent(step, options, "active", step.startedAt, context)
  try {
    const taskTerminalReuse = options.taskTerminalReuse?.taskId === resolved.id
      ? options.taskTerminalReuse
      : undefined
    const result = await options.runCommand({
      ...resolved,
      ...(taskTerminalReuse ? { taskTerminalReuse } : {}),
    })
    updateLifecycleContextFromCommandResult(context, result)
    if (hasCommandOwnerEvidence(result)) emitTaskLifecycleEvent(step, options, "processStarted", step.startedAt, context)
    step.stdout = result?.stdout || ""
    step.stderr = result?.stderr || result?.error || ""
    step.timedOut = result?.timedOut === true
    if (result?.cancelled === true) {
      step.cancelled = true
      step.failureReason = "任务已取消"
    }
    if (step.timedOut) step.failureReason = "执行超时"
    updateStepBackground(step)
    if (step.config.problemMatchers?.length) emitTaskLifecycleEvent(step, options, "problemMatcherUpdated", undefined, context)
    step.exitCode = typeof result?.exitCode === "number" ? result.exitCode : -1
    if (step.cancelled) {
      markCancelled(step)
    } else {
      step.status = !step.timedOut && (step.exitCode === 0 || step.background?.active) ? "passed" : "failed"
    }
  } catch (err) {
    if (isAbortError(err) || isTaskRunCancelled(options)) {
      markCancelled(step)
    } else {
      step.status = "failed"
      step.exitCode = -1
      step.error = err instanceof Error ? err.message : String(err)
      step.stderr = step.error
      step.failureReason = step.error
    }
    updateStepBackground(step)
    if (step.config.problemMatchers?.length) emitTaskLifecycleEvent(step, options, "problemMatcherUpdated", undefined, context)
  } finally {
    step.finishedAt = Date.now()
    emitTaskLifecycleEvent(step, options, "processEnded", step.finishedAt, context)
    if (step.config.isBackground && !step.background?.active) emitTaskLifecycleEvent(step, options, "inactive", step.finishedAt, context)
    emitTaskLifecycleEvent(step, options, step.cancelled === true ? "terminated" : "end", step.finishedAt, context)
  }
}

function updateLifecycleContextFromCommandResult(
  context: TaskRunLifecycleContext,
  result: TaskCommandResult | null | undefined,
): void {
  if (!result) return
  const terminalInstanceId = result.terminalInstanceId ?? result.terminalId
  if (typeof terminalInstanceId === "number") context.terminalId = terminalInstanceId
  if (terminalInstanceId === null) context.terminalId = null
  if (typeof result.processId === "number") context.processId = result.processId
  if (result.processId === null) context.processId = null
}

function hasCommandOwnerEvidence(result: TaskCommandResult | null | undefined): boolean {
  return typeof result?.terminalInstanceId === "number" || typeof result?.terminalId === "number" || typeof result?.processId === "number"
}

function emitTaskLifecycleEvent(
  step: TaskRunStep,
  options: TaskRunnerOptions,
  type: TaskRunLifecycleEventType,
  timestamp = Date.now(),
  context: TaskRunLifecycleContext,
): void {
  options.onDidStateChange?.({
    taskId: step.config.id,
    taskName: step.config.name,
    stepId: step.config.id,
    stepName: step.config.name,
    type,
    status: step.status,
    exitCode: step.exitCode,
    runId: context.runId,
    executionId: `${step.config.id}:${context.runId}`,
    runType: step.config.isBackground ? "background" : "singleRun",
    terminalId: context.terminalId,
    processId: context.processId,
    durationMs: step.startedAt !== undefined && step.finishedAt !== undefined ? Math.max(0, step.finishedAt - step.startedAt) : undefined,
    timestamp,
    source: "taskRunner",
  })
}

function updateStepBackground(step: TaskRunStep): void {
  if (!step.config.isBackground || !step.background) return
  step.background = updateBackgroundProblemState(`${step.stdout}\n${step.stderr}`, step.config.problemMatchers || [], step.background)
}

function backgroundStatus(step: TaskRunStep): "inactive" | "active" | "ended" {
  if (!step.config.isBackground || !step.background) return "inactive"
  if (step.background.active) return "active"
  return step.background.endsMatched ? "ended" : "inactive"
}

function markRemainingSkipped(plan: TaskRunPlan, failedStep: TaskRunStep): void {
  let afterFailed = false
  for (const step of plan.steps) {
    if (step === failedStep) {
      afterFailed = true
      continue
    }
    if (afterFailed && step.status === "pending") step.status = "skipped"
  }
}

function markRemainingCancelled(plan: TaskRunPlan, cancelledStep: TaskRunStep): void {
  let afterCancelled = false
  for (const step of plan.steps) {
    if (step === cancelledStep) {
      afterCancelled = true
      continue
    }
    if (afterCancelled && step.status === "pending") markCancelled(step)
  }
}

function markPendingSkipped(plan: TaskRunPlan): void {
  for (const step of plan.steps) {
    if (step.status === "pending") step.status = "skipped"
  }
}

function markPendingCancelled(plan: TaskRunPlan): void {
  for (const step of plan.steps) {
    if (step.status === "pending") markCancelled(step)
  }
}

function markCancelled(step: TaskRunStep): void {
  step.status = "cancelled"
  step.cancelled = true
  step.failureReason = "任务已取消"
  step.exitCode = step.exitCode ?? null
  step.startedAt = step.startedAt ?? Date.now()
  step.finishedAt = step.finishedAt ?? Date.now()
}

function computeDependencyDepths(steps: RunConfig[]): Map<string, number> {
  const configs = new Map(steps.map((config) => [config.id, config]))
  const cache = new Map<string, number>()
  function depth(config: RunConfig): number {
    if (cache.has(config.id)) return cache.get(config.id) || 0
    const dependencies = (config.dependsOn || [])
      .map((id) => configs.get(id))
      .filter((item): item is RunConfig => Boolean(item))
    const next = dependencies.length === 0 ? 0 : Math.max(...dependencies.map(depth)) + 1
    cache.set(config.id, next)
    return next
  }
  for (const step of steps) depth(step)
  return cache
}

function groupByDepth(steps: TaskRunStep[]): TaskRunStep[][] {
  const groups = new Map<number, TaskRunStep[]>()
  for (const step of steps) {
    const depth = step.dependencyDepth || 0
    groups.set(depth, [...(groups.get(depth) || []), step])
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => group)
}

function summarizeStatus(plan: TaskRunPlan): TaskRunEvidence["status"] {
  if (plan.blocked.length > 0) return "blocked"
  if (plan.steps.some((step) => step.status === "cancelled")) return "cancelled"
  if (plan.steps.some((step) => step.status === "failed")) return "failed"
  if (plan.steps.some((step) => step.status === "running")) return "running"
  if (plan.steps.length > 0 && plan.steps.every((step) => step.status === "passed")) return "passed"
  if (plan.steps.some((step) => step.status === "skipped")) return "skipped"
  return "running"
}

function buildEvidenceSummary(
  plan: TaskRunPlan,
  status: TaskRunEvidence["status"],
  failedStep: TaskRunStep | undefined,
  cancelledStep: TaskRunStep | undefined,
): string {
  if (status === "blocked") return `任务未运行：${plan.blocked.join("；")}`
  if (cancelledStep) return `任务已取消：${cancelledStep.config.name}`
  if (failedStep) {
    if (failedStep.failureReason) return `任务失败：${failedStep.config.name} ${failedStep.failureReason}`
    return `任务失败：${failedStep.config.name} 退出码 ${failedStep.exitCode ?? "未知"}`
  }
  if (status === "passed") return `任务完成：${plan.steps.length} 个步骤全部通过`
  if (status === "skipped") return "任务已跳过：前置步骤失败或任务被阻断"
  return "任务仍在运行"
}

function isTaskRunCancelled(options: TaskRunnerOptions): boolean {
  return options.signal?.aborted === true
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const candidate = err as { name?: unknown; message?: unknown }
  return candidate.name === "AbortError" || /aborted|cancelled|canceled/i.test(String(candidate.message || ""))
}

function minDefined(values: Array<number | undefined>): number | null {
  const filtered = values.filter((value): value is number => typeof value === "number")
  return filtered.length > 0 ? Math.min(...filtered) : null
}

function maxDefined(values: Array<number | undefined>): number | null {
  const filtered = values.filter((value): value is number => typeof value === "number")
  return filtered.length > 0 ? Math.max(...filtered) : null
}

function preview(value: string): string {
  return String(value || "").replace(/\s+$/g, "").slice(0, 2000)
}

function createTaskRunId(): string {
  return `task-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function stripTaskPrefix(name: string): string {
  return String(name || "").replace(/^Task:\s*/i, "").trim()
}
