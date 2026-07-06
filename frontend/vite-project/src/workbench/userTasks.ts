import { ref } from "vue"
import type { RunConfig } from "../components/debugState"
import {
  discoverRunConfigsFromFiles,
  parseVsCodeProfileTasksResource,
  type DiscoveredTaskConfig,
} from "./taskDiscovery"
import type { TaskProblemMatcher, WatchingPattern } from "../vscode-adapter/workbench/contrib/tasks/common/problemMatcher"

export type UserTaskSource = "workspace" | "profile" | "extensionProvider"
export type UserTaskActionKind = "run" | "reveal" | "configure"
export const TASK_CONFIG_STATE_SOURCE = "taskConfigurationModel/userTasksService/problemMatcherRegistry" as const

export interface ExtensionProviderTaskDto {
  _id?: unknown
  id?: unknown
  name?: unknown
  label?: unknown
  source?: unknown
  type?: unknown
  definition?: Record<string, unknown>
  execution?: {
    process?: unknown
    command?: unknown
    shellCommand?: unknown
    args?: unknown
  }
  command?: unknown
  args?: unknown
  isBackground?: unknown
  workspaceFolder?: {
    uri?: {
      fsPath?: unknown
      path?: unknown
    }
  }
  problemMatchers?: TaskProblemMatcher[]
}

export interface TaskConfig extends Omit<RunConfig, "source"> {
  source: UserTaskSource
  providerType?: string
  runOptions?: {
    instanceLimit?: number
    instancePolicy?: "prompt" | "silent" | "warn" | "terminateNewest" | "terminateOldest"
  }
}

export interface TaskDefinitionProjection {
  type: string
  id: string
  label: string
  _key: string
}

export interface TaskExecutionProjection {
  id: string
  taskId: string
  taskName: string
  runType: "singleRun" | "background"
  command: string
  workingDir: string
}

export interface TaskConfigurationPropertiesProjection {
  identifier: string
  name: string
  group?: string
  dependsOn: string[]
  dependsOrder?: "sequence" | "parallel"
  isBackground: boolean
  problemMatcherIds: string[]
  options: {
    cwd: string
    env?: Record<string, string>
  }
  inputs?: Record<string, string>
}

export interface TaskProblemMatcherRegistryProjection {
  source: "ProblemMatcherRegistry"
  matcherIds: string[]
  matcherCount: number
  singleSource: true
  vscodeOwner: "ProblemMatcherRegistry"
  currentOwner: "resolveProblemMatchers -> vscode-adapter/problemMatcher"
  registrySourcePath: "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts"
  vscodeSourcePath: "src/vs/workbench/contrib/tasks/common/problemMatcher.ts"
}

export interface TaskConfigurationSourceAudit {
  source: UserTaskSource
  currentOwner:
    | "UserTasksService.loadWorkspaceTasks"
    | "UserTasksService.loadProfileTasks"
    | "UserTasksService.replaceExtensionProviderTasks"
  vscodeOwner:
    | "TaskConfiguration(workspace .vscode/tasks.json)"
    | "IUserDataProfileService.currentProfile.tasksResource"
    | "MainThreadTask/ExtHostTask provider projection"
  currentSourcePath: "frontend/vite-project/src/workbench/userTasks.ts"
  vscodeSourcePath:
    | "src/vs/workbench/contrib/tasks/common/taskConfiguration.ts"
    | "src/vs/workbench/services/userDataProfile/browser/tasksResource.ts"
    | "src/vs/workbench/api/browser/mainThreadTask.ts"
  inputKind: ".vscode/tasks.json" | "profile.tasksResource" | "extension-provider-task"
  runtimeInput: true
}

export interface TaskMigrationAuditProjection {
  stateSource: typeof TASK_CONFIG_STATE_SOURCE
  runtimeTaskSources: readonly ["workspace", "profile", "extensionProvider"]
  taskConfigurationSources: readonly [
    TaskConfigurationSourceAudit,
    TaskConfigurationSourceAudit,
    TaskConfigurationSourceAudit,
  ]
  debugRunConfigsUsage: "debug-only"
  debugRunConfigsInput: false
  taskRunConfigFallback: false
  configurationResolverOwner: "configurationResolverService/inputAndVariableResolution"
  userTasksOwner: "UserTasksService"
  problemMatcherOwner: "ProblemMatcherRegistry"
  problemMatcherRegistrySourcePath: "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts"
  profileTasksOwner: "IUserDataProfileService.currentProfile.tasksResource"
  currentSourcePaths: readonly [
    "frontend/vite-project/src/workbench/userTasks.ts",
    "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
    "frontend/vite-project/src/workbench/taskRunner.ts",
    "frontend/vite-project/src/workbench/taskDiscovery.ts",
    "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts",
  ]
  vscodeSourcePaths: readonly [
    "src/vs/workbench/contrib/tasks/browser/abstractTaskService.ts",
    "src/vs/workbench/contrib/tasks/common/taskConfiguration.ts",
    "src/vs/workbench/contrib/tasks/common/problemMatcher.ts",
    "src/vs/workbench/contrib/tasks/common/taskService.ts",
    "src/vs/workbench/services/configurationResolver/common/configurationResolver.ts",
    "src/vs/workbench/services/userDataProfile/browser/tasksResource.ts",
  ]
  blockers: readonly []
}

export interface UserTaskDefinitionProjection {
  id: string
  label: string
  source: UserTaskSource
  definition: TaskDefinitionProjection
  execution: TaskExecutionProjection
  configurationProperties: TaskConfigurationPropertiesProjection
  problemMatcherRegistry: TaskProblemMatcherRegistryProjection
}

export interface UserTaskActionEvidence {
  id: string
  taskId: string
  taskName: string
  action: UserTaskActionKind
  command: string
  source: "userTasksService"
  evidenceSafe: true
  readonlyEvidence: true
  gitIndexMutation: false
  shellExecution: false
  timestamp: number
}

export interface UserTasksContractSnapshot {
  source: "userTasksService"
  serviceId: "userTasksService"
  vscodeServiceIds: ["ITaskService", "TaskConfiguration", "TaskDefinitionRegistry", "ProblemMatcherRegistry", "IUserDataProfileService"]
  stateSource: typeof TASK_CONFIG_STATE_SOURCE
  activeTaskId: string
  counts: {
    workspace: number
    profile: number
    extensionProvider: number
    total: number
  }
  taskDefinitions: UserTaskDefinitionProjection[]
  problemMatcherRegistry: TaskProblemMatcherRegistryProjection
  migrationAudit: TaskMigrationAuditProjection
  providerBridge: {
    status: "blocked" | "partial"
    providerTaskCount: number
    stateSource: "userTasksService/extensionProviderProjection"
    rendererIpcConsumerConnected: boolean
    terminalTaskSystemExecution: false
    currentSourcePath: "frontend/vite-project/src/workbench/userTasks.ts"
    vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTask.ts"
  }
  actions: UserTaskActionEvidence[]
  constraints: {
    noSecondTaskState: true
    evidenceSafeActions: true
    preservesAgentEvidenceSafety: true
    noRunConfigShapeLeak: true
    problemMatcherRegistrySingleSource: true
  }
}

export class UserTasksService {
  private readonly tasks = new Map<UserTaskSource, TaskConfig[]>()
  private readonly actions: UserTaskActionEvidence[] = []
  private readonly revision = ref(0)
  private rendererIpcConsumerConnected = false
  private activeTaskId = ""

  constructor() {
    this.tasks.set("workspace", [])
    this.tasks.set("profile", [])
    this.tasks.set("extensionProvider", [])
  }

  async loadWorkspaceTasks(readFile: (path: string) => Promise<string | null | undefined>): Promise<number> {
    const configs = await discoverRunConfigsFromFiles((path) => path === ".vscode/tasks.json" ? readFile(path) : Promise.resolve(null))
    return this.replaceTasks("workspace", configs)
  }

  loadProfileTasks(tasksResource: string | undefined | null): number {
    return this.replaceTasks("profile", parseVsCodeProfileTasksResource(tasksResource))
  }

  replaceExtensionProviderTasks(tasks: ExtensionProviderTaskDto[]): number {
    return this.replaceTasks("extensionProvider", tasks.map(normalizeExtensionProviderTask))
  }

  upsertExtensionProviderTask(task: ExtensionProviderTaskDto): TaskConfig {
    const normalized = this.normalizeTask("extensionProvider", normalizeExtensionProviderTask(task))
    const tasks = this.tasks.get("extensionProvider") || []
    const index = tasks.findIndex((candidate) => candidate.id === normalized.id)
    const nextTasks = index >= 0
      ? tasks.map((candidate, candidateIndex) => candidateIndex === index ? normalized : candidate)
      : [...tasks, normalized]
    this.tasks.set("extensionProvider", nextTasks.map((candidate) => this.cloneTask(candidate)))
    this.activeTaskId = normalized.id
    this.touch()
    return this.cloneTask(normalized)
  }

  markExtensionProviderRendererIpcConsumerConnected(connected = true): void {
    if (this.rendererIpcConsumerConnected === connected) return
    this.rendererIpcConsumerConnected = connected
    this.touch()
  }

  replaceTasks(source: UserTaskSource, configs: Array<DiscoveredTaskConfig | RunConfig | ExtensionProviderRunConfig | TaskConfig>): number {
    const normalized = configs.map((config) => this.normalizeTask(source, config))
    this.tasks.set(source, normalized)
    if (this.activeTaskId && !this.getTasks().some((task) => task.id === this.activeTaskId)) {
      this.activeTaskId = ""
    }
    if (!this.activeTaskId) {
      this.activeTaskId = this.getTasks()[0]?.id || ""
    }
    this.touch()
    return normalized.length
  }

  getTasks(source?: UserTaskSource): TaskConfig[] {
    const tasks = source
      ? this.tasks.get(source) || []
      : [
        ...(this.tasks.get("workspace") || []),
        ...(this.tasks.get("profile") || []),
        ...(this.tasks.get("extensionProvider") || []),
      ]
    return tasks.map((task) => this.cloneTask(task))
  }

  getTaskDefinitions(source?: UserTaskSource): UserTaskDefinitionProjection[] {
    return this.getTasks(source).map((task) => this.toTaskDefinitionProjection(task))
  }

  findTask(idOrName: string): TaskConfig | undefined {
    const normalized = String(idOrName || "").trim()
    if (!normalized) return this.getActiveTask() || this.getTasks()[0]
    return this.getTasks().find((task) =>
      task.id === normalized || task.name === normalized || task.name.replace(/^Task:\s*/i, "").trim() === normalized
    )
  }

  getActiveTask(): TaskConfig | undefined {
    return this.getTasks().find((task) => task.id === this.activeTaskId)
  }

  setActiveTask(id: string): boolean {
    if (id && !this.getTasks().some((task) => task.id === id)) return false
    this.activeTaskId = id
    this.touch()
    return true
  }

  getRevision(): number {
    return this.revision.value
  }

  reset(): void {
    this.tasks.set("workspace", [])
    this.tasks.set("profile", [])
    this.tasks.set("extensionProvider", [])
    this.actions.splice(0, this.actions.length)
    this.rendererIpcConsumerConnected = false
    this.activeTaskId = ""
    this.touch()
  }

  createTaskAction(taskId: string, action: UserTaskActionKind): UserTaskActionEvidence | null {
    const task = this.findTask(taskId)
    if (!task) return null
    const evidence: UserTaskActionEvidence = {
      id: `user-task-action-${task.id}-${action}`,
      taskId: task.id,
      taskName: task.name,
      action,
      command: task.command,
      source: "userTasksService",
      evidenceSafe: true,
      readonlyEvidence: true,
      gitIndexMutation: false,
      shellExecution: false,
      timestamp: Date.now(),
    }
    this.actions.push(evidence)
    this.touch()
    return evidence
  }

  getContractSnapshot(): UserTasksContractSnapshot {
    const workspace = this.tasks.get("workspace")?.length || 0
    const profile = this.tasks.get("profile")?.length || 0
    const extensionProvider = this.tasks.get("extensionProvider")?.length || 0
    const taskDefinitions = this.getTaskDefinitions()
    const problemMatcherRegistry = this.buildProblemMatcherRegistry(this.getTasks())
    return {
      source: "userTasksService",
      serviceId: "userTasksService",
      vscodeServiceIds: ["ITaskService", "TaskConfiguration", "TaskDefinitionRegistry", "ProblemMatcherRegistry", "IUserDataProfileService"],
      stateSource: TASK_CONFIG_STATE_SOURCE,
      activeTaskId: this.activeTaskId,
      counts: {
        workspace,
        profile,
        extensionProvider,
        total: workspace + profile + extensionProvider,
      },
      taskDefinitions,
      problemMatcherRegistry,
      migrationAudit: {
        stateSource: TASK_CONFIG_STATE_SOURCE,
        runtimeTaskSources: ["workspace", "profile", "extensionProvider"],
        taskConfigurationSources: [
          {
            source: "workspace",
            currentOwner: "UserTasksService.loadWorkspaceTasks",
            vscodeOwner: "TaskConfiguration(workspace .vscode/tasks.json)",
            currentSourcePath: "frontend/vite-project/src/workbench/userTasks.ts",
            vscodeSourcePath: "src/vs/workbench/contrib/tasks/common/taskConfiguration.ts",
            inputKind: ".vscode/tasks.json",
            runtimeInput: true,
          },
          {
            source: "profile",
            currentOwner: "UserTasksService.loadProfileTasks",
            vscodeOwner: "IUserDataProfileService.currentProfile.tasksResource",
            currentSourcePath: "frontend/vite-project/src/workbench/userTasks.ts",
            vscodeSourcePath: "src/vs/workbench/services/userDataProfile/browser/tasksResource.ts",
            inputKind: "profile.tasksResource",
            runtimeInput: true,
          },
          {
            source: "extensionProvider",
            currentOwner: "UserTasksService.replaceExtensionProviderTasks",
            vscodeOwner: "MainThreadTask/ExtHostTask provider projection",
            currentSourcePath: "frontend/vite-project/src/workbench/userTasks.ts",
            vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTask.ts",
            inputKind: "extension-provider-task",
            runtimeInput: true,
          },
        ],
        debugRunConfigsUsage: "debug-only",
        debugRunConfigsInput: false,
        taskRunConfigFallback: false,
        configurationResolverOwner: "configurationResolverService/inputAndVariableResolution",
        userTasksOwner: "UserTasksService",
        problemMatcherOwner: "ProblemMatcherRegistry",
        problemMatcherRegistrySourcePath: "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts",
        profileTasksOwner: "IUserDataProfileService.currentProfile.tasksResource",
        currentSourcePaths: [
          "frontend/vite-project/src/workbench/userTasks.ts",
          "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
          "frontend/vite-project/src/workbench/taskRunner.ts",
          "frontend/vite-project/src/workbench/taskDiscovery.ts",
          "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts",
        ],
        vscodeSourcePaths: [
          "src/vs/workbench/contrib/tasks/browser/abstractTaskService.ts",
          "src/vs/workbench/contrib/tasks/common/taskConfiguration.ts",
          "src/vs/workbench/contrib/tasks/common/problemMatcher.ts",
          "src/vs/workbench/contrib/tasks/common/taskService.ts",
          "src/vs/workbench/services/configurationResolver/common/configurationResolver.ts",
          "src/vs/workbench/services/userDataProfile/browser/tasksResource.ts",
        ],
        blockers: [],
      },
      providerBridge: {
        status: extensionProvider > 0 ? "partial" : "blocked",
        providerTaskCount: extensionProvider,
        stateSource: "userTasksService/extensionProviderProjection",
        rendererIpcConsumerConnected: this.rendererIpcConsumerConnected,
        terminalTaskSystemExecution: false,
        currentSourcePath: "frontend/vite-project/src/workbench/userTasks.ts",
        vscodeSourcePath: "src/vs/workbench/api/browser/mainThreadTask.ts",
      },
      actions: this.actions.map((action) => ({ ...action })),
      constraints: {
        noSecondTaskState: true,
        evidenceSafeActions: true,
        preservesAgentEvidenceSafety: true,
        noRunConfigShapeLeak: true,
        problemMatcherRegistrySingleSource: true,
      },
    }
  }

  private normalizeTask(source: UserTaskSource, config: DiscoveredTaskConfig | RunConfig | ExtensionProviderRunConfig | TaskConfig): TaskConfig {
    const id = source === "profile" && !config.id.startsWith("profile-")
      ? `profile-${config.id}`
      : source === "extensionProvider" && !config.id.startsWith("extension-provider-task-")
        ? `extension-provider-task-${config.id}`
        : config.id
    return this.cloneTask({
      ...config,
      id,
      source,
    })
  }

  private touch(): void {
    this.revision.value += 1
  }

  private cloneTask(task: TaskConfig): TaskConfig {
    return {
      ...task,
      dependsOn: task.dependsOn ? [...task.dependsOn] : undefined,
      problemMatchers: task.problemMatchers ? task.problemMatchers.map((matcher) => cloneProblemMatcher(matcher)) : undefined,
      runOptions: task.runOptions ? { ...task.runOptions } : undefined,
      env: task.env ? { ...task.env } : undefined,
      inputs: task.inputs ? { ...task.inputs } : undefined,
    }
  }

  private toTaskDefinitionProjection(task: TaskConfig): UserTaskDefinitionProjection {
    const problemMatcherRegistry = this.buildProblemMatcherRegistry([task])
    return {
      id: task.id,
      label: task.name,
      source: task.source,
      definition: {
        type: task.providerType || task.type,
        id: task.id,
        label: task.name,
        _key: `${task.providerType || task.type}:${task.id}`,
      },
      execution: {
        id: task.id,
        taskId: task.id,
        taskName: task.name,
        runType: task.isBackground ? "background" : "singleRun",
        command: task.command,
        workingDir: task.workingDir,
      },
      configurationProperties: {
        identifier: task.id,
        name: task.name,
        group: task.group,
        dependsOn: task.dependsOn ? [...task.dependsOn] : [],
        dependsOrder: task.dependsOrder,
        isBackground: task.isBackground === true,
        problemMatcherIds: problemMatcherRegistry.matcherIds,
        options: {
          cwd: task.workingDir,
          env: task.env ? { ...task.env } : undefined,
        },
        inputs: task.inputs ? { ...task.inputs } : undefined,
      },
      problemMatcherRegistry,
    }
  }

  private buildProblemMatcherRegistry(tasks: TaskConfig[]): TaskProblemMatcherRegistryProjection {
    const matcherIds = new Set<string>()
    for (const task of tasks) {
      for (const matcher of task.problemMatchers || []) {
        if (matcher.id) matcherIds.add(matcher.id)
      }
    }
    return {
      source: "ProblemMatcherRegistry",
      matcherIds: [...matcherIds].sort(),
      matcherCount: matcherIds.size,
      singleSource: true,
      vscodeOwner: "ProblemMatcherRegistry",
      currentOwner: "resolveProblemMatchers -> vscode-adapter/problemMatcher",
      registrySourcePath: "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts",
      vscodeSourcePath: "src/vs/workbench/contrib/tasks/common/problemMatcher.ts",
    }
  }
}

interface ExtensionProviderRunConfig extends RunConfig {
  providerType?: string
}

export const userTasksService = new UserTasksService()

function cloneProblemMatcher(matcher: TaskProblemMatcher): TaskProblemMatcher {
  return {
    ...matcher,
    pattern: Array.isArray(matcher.pattern)
      ? matcher.pattern.map((pattern) => ({ ...pattern }))
      : { ...matcher.pattern },
    background: matcher.background
      ? {
        ...matcher.background,
        beginsPattern: cloneWatchingPattern(matcher.background.beginsPattern),
        endsPattern: cloneWatchingPattern(matcher.background.endsPattern),
      }
      : undefined,
  }
}

function cloneWatchingPattern(pattern: WatchingPattern | RegExp | undefined): WatchingPattern | RegExp | undefined {
  if (!pattern || pattern instanceof RegExp) return pattern
  return { ...pattern }
}

function normalizeExtensionProviderTask(task: ExtensionProviderTaskDto): ExtensionProviderRunConfig {
  const definition = task?.definition || {}
  const type = normalizeString(definition.type || task?.type || task?.source) || "custom"
  const label = normalizeString(task?.name || task?.label || definition.label || definition.script || type) || "extension task"
  const command = normalizeExtensionProviderCommand(task)
  return {
    id: normalizeExtensionProviderTaskId(task, type, label),
    name: label,
    type: "custom",
    providerType: type,
    command,
    workingDir: normalizeWorkspaceFolder(task?.workspaceFolder) || "${workspaceFolder}",
    source: "workspace",
    isBackground: task?.isBackground === true || hasBackgroundProblemMatcher(task?.problemMatchers),
    problemMatchers: Array.isArray(task?.problemMatchers) ? task.problemMatchers.map((matcher) => cloneProblemMatcher(matcher)) : undefined,
  }
}

function hasBackgroundProblemMatcher(matchers: ExtensionProviderTaskDto["problemMatchers"]): boolean {
  return Array.isArray(matchers) && matchers.some((matcher) => Boolean(matcher?.background))
}

function normalizeExtensionProviderTaskId(task: ExtensionProviderTaskDto, type: string, label: string): string {
  const rawId = normalizeString(task?._id || task?.id || `${type}:${label}`)
  return slug(rawId || `${type}:${label}`)
}

function normalizeExtensionProviderCommand(task: ExtensionProviderTaskDto): string {
  const execution = task?.execution || {}
  const process = normalizeString(execution.process || execution.command || execution.shellCommand)
  const command = process || normalizeString(task?.command)
  const args = normalizeArgs(execution.args || task?.args)
  return [command, ...args].filter(Boolean).join(" ") || normalizeString(task?.name || task?.label) || "extension-task"
}

function normalizeWorkspaceFolder(workspaceFolder: ExtensionProviderTaskDto["workspaceFolder"]): string {
  return normalizeString(workspaceFolder?.uri?.fsPath || workspaceFolder?.uri?.path)
}

function normalizeArgs(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => normalizeString(item)).filter(Boolean) : []
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "task"
}
