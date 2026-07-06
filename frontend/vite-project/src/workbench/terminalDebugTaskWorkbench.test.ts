import { beforeEach, describe, expect, it } from "vitest"
import { vi } from "vitest"
import { debugState, type RunConfig } from "../components/debugState"
import { problemState } from "../components/problemState"
import { getOutputChannel } from "../utils/outputChannel"
import { URI } from "../vscode-adapter/base/common/uri"
import { MenuId, MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import { globalMarkerService } from "../vscode-adapter/platform/markers/common/markers"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import { closeTerminal, createTerminal, resetAll as resetAllTerminals } from "../terminal/terminalManager"
import { attachPty, markExited, updateShellIntegration } from "../terminal/terminalManager"
import { TASK_CONFIG_STATE_SOURCE, type TaskConfig, userTasksService } from "./userTasks"
import { clearCommands, executeCommand, getCommand } from "./commandRegistry"
import { acceptQuickPick, cancelQuickPick, clearQuickPicks, quickInputState, type QuickPickItem } from "./quickInput"
import { installEditorMarkerSync } from "./editorDiagnosticsLifecycle"
import { createProblemMarkersViewModel } from "../vscode-adapter/workbench/contrib/markers/browser/markersViewModel"
import { resolveProblemMatchers } from "./problemMatcher"
import {
  DEBUG_WORKBENCH_VIEW_IDS,
  ICodekOutputService,
  IDebugService,
  IOutputService,
  IPaneCompositePartService,
  IProblemsWorkbenchService,
  ITaskService,
  ITerminalDebugTaskWorkbenchService,
  ITerminalService,
  TASK_WORKBENCH_VIEW_IDS,
  TERMINAL_DEBUG_TASK_COMMAND_IDS,
  TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS,
  TerminalDebugTaskWorkbenchService,
  buildDebugSessionEvidence,
  buildProblemsWorkbenchSnapshot,
  buildTerminalWorkbenchEvidence,
  globalCodekOutputService,
  globalDebugService,
  globalPaneCompositePartService,
  globalProblemsWorkbenchService,
  globalTaskService,
  globalTerminalDebugTaskWorkbenchService,
  globalTerminalService,
  registerTerminalDebugTaskWorkbenchContributions,
} from "./terminalDebugTaskWorkbench"
import { clearViews, getViewContainers, getViews } from "./viewRegistry"

const debugManagerMock = vi.hoisted(() => ({
  startSession: vi.fn(),
  stopSession: vi.fn(),
}))

vi.mock("../debug/debugManager", () => ({
  getDebugManager: () => debugManagerMock,
}))

const sampleTask: RunConfig = {
  id: "task-build",
  name: "Task: build",
  type: "custom",
  command: "npm run build",
  workingDir: "${workspaceFolder}",
}

function resetDebugState(): void {
  debugState.breakpoints.value = []
  debugState.stackFrames.value = []
  debugState.variables.value = []
  debugState.watchEntries.value = []
  debugState.consoleOutput.value = []
  debugState.isRunning.value = false
  debugState.paused.value = false
  debugState.currentFrameId.value = null
  debugState.sessionId.value = null
  debugState.activeConfigId.value = ""
  debugState.runConfigs.splice(0, debugState.runConfigs.length)
}

function addTaskConfig(task: RunConfig | TaskConfig): void {
  userTasksService.replaceTasks("workspace", [task])
  userTasksService.setActiveTask(task.id)
}

async function flushMarkerService(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe("Terminal / Debug / Output / Task / Problems Workbench contribution", () => {
  beforeEach(() => {
    debugManagerMock.startSession.mockReset()
    debugManagerMock.stopSession.mockReset()
    clearCommands()
    clearViews()
    MenuRegistry.clear()
    resetAllTerminals()
    resetDebugState()
    userTasksService.reset()
    problemState.clear()
    globalTerminalDebugTaskWorkbenchService.clearEvidence()
    globalPaneCompositePartService.clear()
    clearQuickPicks()
    globalDebugService.setRuntime()
    getOutputChannel("Workbench").clear()
    getOutputChannel("Tasks").clear()
    delete (globalThis as { codek?: unknown }).codek
  })

  it("registers VS Code-style service identifiers and resolves them through ServiceCollection", () => {
    const collection = new ServiceCollection(
      [ITerminalService, globalTerminalService],
      [IOutputService, globalCodekOutputService],
      [ICodekOutputService, globalCodekOutputService],
      [IDebugService, globalDebugService],
      [ITaskService, globalTaskService],
      [IProblemsWorkbenchService, globalProblemsWorkbenchService],
      [IPaneCompositePartService, globalPaneCompositePartService],
      [ITerminalDebugTaskWorkbenchService, globalTerminalDebugTaskWorkbenchService],
    )

    expect(String(ITerminalService)).toBe("terminalService")
    expect(String(IOutputService)).toBe("outputService")
    expect(String(IDebugService)).toBe("debugService")
    expect(String(ITaskService)).toBe("taskService")
    expect(String(IPaneCompositePartService)).toBe("paneCompositePartService")
    expect(collection.get(ITerminalService)).toBe(globalTerminalService)
    expect(collection.get(IOutputService)).toBe(globalCodekOutputService)
    expect(collection.get(IDebugService)).toBe(globalDebugService)
    expect(collection.get(ITaskService)).toBe(globalTaskService)
    expect(collection.get(IProblemsWorkbenchService)).toBe(globalProblemsWorkbenchService)
    expect(collection.get(IPaneCompositePartService)).toBe(globalPaneCompositePartService)

    const singletons = getSingletonServiceDescriptors()
    expect(singletons).toEqual(expect.arrayContaining([
      [ITerminalService, globalTerminalService],
      [IOutputService, globalCodekOutputService],
      [IDebugService, globalDebugService],
      [ITaskService, globalTaskService],
      [IPaneCompositePartService, globalPaneCompositePartService],
      [ITerminalDebugTaskWorkbenchService, globalTerminalDebugTaskWorkbenchService],
    ]))
  })

  it("registers panel view containers, Action2 commands, command palette and view title menu entries", () => {
    registerTerminalDebugTaskWorkbenchContributions()

    expect(getViewContainers("panel").map((container) => container.id)).toEqual(expect.arrayContaining([
      TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal,
      TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output,
      TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer,
      TASK_WORKBENCH_VIEW_IDS.Container,
    ]))
    expect(getViewContainers("activityBar").map((container) => container.id)).toContain(DEBUG_WORKBENCH_VIEW_IDS.Container)
    expect(getViews(TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.ProblemsContainer).map((view) => view.id)).toContain(
      TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems,
    )
    expect(getViews(DEBUG_WORKBENCH_VIEW_IDS.Container).map((view) => view.id)).toEqual(expect.arrayContaining([
      DEBUG_WORKBENCH_VIEW_IDS.Variables,
      DEBUG_WORKBENCH_VIEW_IDS.Watch,
      DEBUG_WORKBENCH_VIEW_IDS.CallStack,
      DEBUG_WORKBENCH_VIEW_IDS.Breakpoints,
      DEBUG_WORKBENCH_VIEW_IDS.Console,
    ]))
    expect(getViews(TASK_WORKBENCH_VIEW_IDS.Container).map((view) => view.id)).toEqual(expect.arrayContaining([
      TASK_WORKBENCH_VIEW_IDS.Tasks,
      TASK_WORKBENCH_VIEW_IDS.ProblemMatchers,
    ]))

    expect(getCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalToggle)).toBeTruthy()
    expect(getCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputClear)).toBeTruthy()
    expect(getCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugStart)).toBeTruthy()
    expect(getCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRun)).toBeTruthy()
    expect(getCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerun)).toBeTruthy()
    expect(getCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal)).toBeTruthy()
    expect(getCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminate)).toBeTruthy()
    expect(getCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll)).toBeTruthy()
    expect(getCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.ProblemsToggle)).toBeTruthy()

    const paletteIds = MenuRegistry.getMenuEntries(MenuId.CommandPalette).map((entry) => entry.type === "item" ? entry.commandId : entry.id)
    expect(paletteIds).toEqual(expect.arrayContaining([
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalToggle,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalNew,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputShow,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugOpen,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksOpen,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerun,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminate,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.ProblemsToggle,
    ]))

    const outputTitleIds = MenuRegistry.getMenuEntries(MenuId.ViewTitle, {
      view: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output,
    }).map((entry) => entry.type === "item" ? entry.commandId : entry.id)
    expect(outputTitleIds).toContain(TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputClear)
  })

  it("exposes one contribution surface for services, commands, menus and state sources", () => {
    registerTerminalDebugTaskWorkbenchContributions()

    const snapshot = globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot()
    const surface = snapshot.contributionSurface
    const commandIds = surface.commands.map((command) => command.id)

    expect(surface.services.map((service) => service.id)).toEqual([
      "terminalService",
      "outputService",
      "debugService",
      "taskService",
      "problemsWorkbenchService",
      "paneCompositePartService",
      "terminalDebugTaskWorkbenchService",
    ])
    expect(commandIds).toEqual(Object.values(TERMINAL_DEBUG_TASK_COMMAND_IDS))
    expect(new Set(commandIds).size).toBe(commandIds.length)
    expect(surface.commandsByArea.terminal).toEqual([
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalToggle,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalNew,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalSplit,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalClear,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalRunActiveFile,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalRunSelectedText,
    ])
    expect(surface.commandsByArea.tasks).toEqual([
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksOpen,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRun,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerun,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminate,
      TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll,
    ])
    expect(surface.viewsByArea.debug).toEqual([
      DEBUG_WORKBENCH_VIEW_IDS.Container,
      DEBUG_WORKBENCH_VIEW_IDS.Variables,
      DEBUG_WORKBENCH_VIEW_IDS.Watch,
      DEBUG_WORKBENCH_VIEW_IDS.CallStack,
      DEBUG_WORKBENCH_VIEW_IDS.Breakpoints,
      DEBUG_WORKBENCH_VIEW_IDS.Console,
    ])
    expect(surface.stateSources).toEqual({
      terminal: "terminalManager",
      output: "outputLogTelemetryService",
      debug: "debugState/debugRuntime",
      tasks: TASK_CONFIG_STATE_SOURCE,
      problems: "problemsDiagnosticsService(globalMarkerService)",
      paneComposite: "workbenchLayoutService",
    })
    expect(surface.commands.find((command) => command.id === TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputClear)?.menus).toEqual([
      expect.objectContaining({ id: "ViewTitle", when: `view == ${TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output}` }),
    ])
  })

  it("opens and toggles panel surfaces through one injected pane composite bridge", async () => {
    const calls: Array<{ action: string; id: string }> = []
    registerTerminalDebugTaskWorkbenchContributions({
      openPanel: async (id) => { calls.push({ action: "openPanel", id }) },
      togglePanel: async (id) => { calls.push({ action: "togglePanel", id }) },
      openDebugView: async (id) => { calls.push({ action: "openDebugView", id }) },
      openProblems: async (id) => { calls.push({ action: "openProblems", id }) },
      openTasks: async (id) => { calls.push({ action: "openTasks", id }) },
    })

    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalToggle)
    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputShow)
    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugOpen)
    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksOpen)
    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.ProblemsToggle)

    expect(calls).toEqual([
      { action: "togglePanel", id: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal },
      { action: "openPanel", id: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output },
      { action: "openDebugView", id: DEBUG_WORKBENCH_VIEW_IDS.Container },
      { action: "openTasks", id: TASK_WORKBENCH_VIEW_IDS.Container },
      { action: "openProblems", id: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems },
    ])
    expect(globalPaneCompositePartService.getEvidence()).toEqual(expect.objectContaining({
      stateSource: "workbenchLayoutService",
      lastOpenedPanelId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output,
      lastToggledPanelId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Terminal,
      lastOpenedDebugViewId: DEBUG_WORKBENCH_VIEW_IDS.Container,
      lastOpenedTaskViewId: TASK_WORKBENCH_VIEW_IDS.Container,
      problemsOpened: true,
      openCount: 4,
      toggleCount: 1,
    }))
  })

  it("clears pane-composite evidence without detaching the app bridge", async () => {
    const calls: Array<{ action: string; id: string }> = []
    registerTerminalDebugTaskWorkbenchContributions({
      openPanel: async (id) => { calls.push({ action: "openPanel", id }) },
      openProblems: async (id) => { calls.push({ action: "openProblems", id }) },
    })

    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputShow)
    expect(globalPaneCompositePartService.getEvidence().lastOpenedPanelId).toBe(TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output)

    globalTerminalDebugTaskWorkbenchService.clearEvidence()
    expect(globalPaneCompositePartService.getEvidence()).toEqual(expect.objectContaining({
      lastOpenedPanelId: "",
      problemsOpened: false,
      openCount: 0,
    }))

    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.ProblemsToggle)
    expect(calls).toContainEqual({
      action: "openProblems",
      id: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems,
    })
    expect(globalPaneCompositePartService.getEvidence()).toEqual(expect.objectContaining({
      problemsOpened: true,
      openCount: 1,
    }))
  })

  it("uses output channels through the output facade without a second log store", async () => {
    registerTerminalDebugTaskWorkbenchContributions()

    globalCodekOutputService.appendLine("Workbench", "first line")
    globalCodekOutputService.append("Workbench", "tail")
    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputShow, ["Workbench"])
    let snapshot = globalCodekOutputService.getOutputSnapshot("Workbench")

    expect(snapshot.channelName).toBe("Workbench")
    expect(snapshot.entryCount).toBe(2)
    expect(snapshot.preview).toContain("first line")
    expect(globalCodekOutputService.getActiveChannelName()).toBe("Workbench")

    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputClear, ["Workbench"])
    snapshot = globalCodekOutputService.getOutputSnapshot("Workbench")
    expect(snapshot.entryCount).toBe(0)
    expect(getOutputChannel("Workbench").getEntries()).toHaveLength(0)
  })

  it("projects terminal profile and environment through the terminal service facade", () => {
    const terminal = globalTerminalService.createTerminal("gitbash", "D:/Workspace")
    const environment = globalTerminalService.createEnvironment({
      shellType: "gitbash",
      cwd: "D:/Workspace",
      baseEnv: { PATH: "base", DROP: "old" },
      env: { DROP: null, EXTRA: "1" },
    })

    expect(globalTerminalService.getProfiles().map((profile) => profile.id)).toEqual([
      "powershell",
      "cmd",
      "gitbash",
      "wsl",
      "bash",
      "zsh",
    ])
    expect(globalTerminalService.resolveProfile("gitbash")).toEqual(expect.objectContaining({
      profileName: "Git Bash",
      path: "C:/Program Files/Git/bin/bash.exe",
    }))
    expect(terminal.profile.profileName).toBe("Git Bash")
    expect(environment).toEqual(expect.objectContaining({
      cwd: "D:/Workspace",
      source: "terminalProfileResolverService/terminalEnvironment",
    }))
    expect(environment.env).toEqual(expect.objectContaining({
      PATH: "base",
      EXTRA: "1",
      CODEK_TERMINAL_PROFILE: "gitbash",
    }))
    expect(environment.env.DROP).toBeUndefined()
    expect(globalTerminalService.getEvidence()).toEqual(expect.objectContaining({
      profileCount: 6,
      activeProfileName: "Git Bash",
      environmentSource: "terminalProfileResolverService/terminalEnvironment",
    }))
  })

  it("exposes terminal pty/process lifecycle and evidence-safe command boundary without a second state source", () => {
    const terminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
    attachPty(terminal.id, "pty-workbench-1", 4321)
    updateShellIntegration(terminal.id, {
      available: true,
      recentCommands: [{
        id: "cmd-1",
        terminalId: terminal.id,
        commandLine: "npm run typecheck",
        cwd: "D:/Workspace",
        startedAt: 10,
        executedAt: 20,
        finishedAt: 30,
        durationMs: 20,
        exitCode: 0,
        output: "",
        status: "finished",
      }],
    })
    markExited(terminal.id, 0)

    const evidence = globalTerminalService.getEvidence()

    expect(evidence.stateSource).toBe("terminalManager")
    expect(evidence.ptyHostBridge).toEqual(expect.objectContaining({
      source: "ptyHostService/ptyHostBridge",
      stateSource: "terminalManager",
      attachedCount: 1,
      exitedCount: 1,
      activePtyId: "pty-workbench-1",
      activePid: 4321,
      lifecycleSource: "terminalProcessLifecycle",
    }))
    expect(evidence.commandBoundary).toEqual(expect.objectContaining({
      source: "terminalShellIntegration/evidenceSafeCommandBoundary",
      stateSource: "terminalManager",
      recentCommandCount: 1,
      lastCommandLine: "npm run typecheck",
      requiresWorkspaceTrust: true,
      writesGitIndex: false,
    }))
    expect(globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot().terminal).toEqual(expect.objectContaining({
      ptyHostBridge: expect.objectContaining({ activePtyId: "pty-workbench-1" }),
      commandBoundary: expect.objectContaining({ lastCommandLine: "npm run typecheck" }),
      taskTerminalReuseRegistry: expect.objectContaining({
        stateSource: "terminalManager/taskTerminalReuseRegistry",
        sameTaskCount: 0,
        idleTaskCount: 0,
        supportsPhysicalReuse: false,
      }),
    }))
    expect(globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot().constraints).toEqual(expect.objectContaining({
      noSecondTerminalState: true,
      evidenceSafeCommandBoundary: true,
    }))
  })

  it("exposes ITerminalService instances and create/dispose events from the terminalManager owner", () => {
    const created: number[] = []
    const disposed: number[] = []
    const createSubscription = globalTerminalService.onDidCreateInstance((instance) => {
      created.push(instance.instanceId)
    })
    const disposeSubscription = globalTerminalService.onDidDisposeInstance((instance) => {
      disposed.push(instance.instanceId)
    })

    const terminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
    closeTerminal(terminal.id)
    createSubscription.dispose()
    disposeSubscription.dispose()

    expect(created).toEqual([terminal.instanceId])
    expect(disposed).toEqual([terminal.instanceId])
    expect(globalTerminalService.instances.map((instance) => instance.instanceId)).not.toContain(terminal.instanceId)
  })

  it("exposes terminal-owned task reuse registry without creating a task state source", async () => {
    const task: TaskConfig = {
      id: "task-terminal-reuse",
      name: "Task: terminal reuse",
      type: "custom",
      source: "workspace",
      command: "npm run watch",
      workingDir: "D:/Workspace",
      isBackground: true,
    }
    addTaskConfig(task)
    const terminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
    attachPty(terminal.id, "pty-reuse-1", 4321)

    await globalTaskService.runTask(task.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({
        stdout: "watching",
        exitCode: 0,
        terminalId: terminal.instanceId,
        processId: 4321,
      }),
    })

    const registry = globalTerminalService.getTaskTerminalReuseRegistry()
    const snapshot = globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot()

    expect(registry).toEqual(expect.objectContaining({
      stateSource: "terminalManager/taskTerminalReuseRegistry",
      sameTaskCount: 1,
      idleTaskCount: 0,
      supportsPhysicalReuse: false,
      missingPhysicalReuseOwner: "terminal shell owner with reuseTerminal(launchConfigs)",
    }))
    expect(registry.sameTaskTerminals).toEqual([expect.objectContaining({
      taskId: task.id,
      taskName: task.name,
      terminalId: terminal.id,
      terminalInstanceId: terminal.instanceId,
      ptyId: "pty-reuse-1",
      pid: 4321,
      processId: 4321,
      panelKind: "dedicated",
      ownerSource: "terminalManager",
      stateSource: "terminalManager/taskTerminalReuseRegistry",
      shellLaunchConfig: expect.objectContaining({
        type: "Task",
        taskId: task.id,
        tabActions: true,
      }),
    })])
    expect(snapshot.terminal.taskTerminalReuseRegistry.sameTaskCount).toBe(1)
    expect(snapshot.tasks.lifecycle.stateSource).toBe("taskRunner/TaskSystemLifecycleProjection")
    expect(snapshot.tasks.capabilities.constraints.noSecondTaskState).toBe(true)
    expect(snapshot.tasks.capabilities.terminalServiceLifecycle.reuseRegistry).toEqual(expect.objectContaining({
      status: "partial",
      stateSource: "terminalManager/taskTerminalReuseRegistry",
      sameTaskTerminalInstanceIds: [terminal.instanceId],
      idleTaskTerminalInstanceIds: [],
      supportsPhysicalReuse: false,
      currentOwner: "terminalManager TaskTerminalReuseRegistry same/idle task terminal owner + TaskWorkbenchAdapterService lifecycle events",
      missingOwner: "terminal shell owner with reuseTerminal(launchConfigs)",
    }))
    expect(snapshot.constraints.noSecondTaskState).toBe(true)
  })

  it("records VS Code style task lifecycle events while running tasks through the service", async () => {
    addTaskConfig(sampleTask)

    const evidence = await globalTaskService.runTask(sampleTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({ stdout: "ok", exitCode: 0 }),
    })

    expect(evidence.status).toBe("passed")
    expect(globalTaskService.getLifecycleEvents().map((event) => event.type)).toEqual([
      "start",
      "processStarted",
      "processEnded",
      "end",
    ])
    expect(globalTaskService.getLifecycleEvents()[0]).toEqual(expect.objectContaining({
      taskId: sampleTask.id,
      taskName: sampleTask.name,
      executionId: expect.stringContaining(`${sampleTask.id}:`),
      runId: expect.stringMatching(/^task-run-/),
      source: "taskRunner",
      status: "running",
    }))
    expect(new Set(globalTaskService.getLifecycleEvents().map((event) => event.executionId)).size).toBe(1)
    expect(globalTaskService.getTaskSnapshot().lifecycle).toEqual(expect.objectContaining({
      runId: expect.stringMatching(/^task-run-/),
      executionId: expect.stringContaining(`${sampleTask.id}:`),
      activeTaskId: sampleTask.id,
      lastAction: "run",
      eventCount: 4,
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
    }))
  })

  it("does not fall back to debug runConfigs as the default Task run state source", async () => {
    debugState.runConfigs.push({
      ...sampleTask,
      id: "debug-only-config",
      name: "Debug-only config",
    })

    const evidence = await globalTaskService.runTask(undefined, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({ stdout: "should not run", exitCode: 0 }),
    })

    expect(evidence.status).toBe("blocked")
    expect(evidence.id).toBe("")
    expect(evidence.summary).toContain("找不到任务")
    expect(globalTaskService.getTaskSnapshot().stateSource).toBe(TASK_CONFIG_STATE_SOURCE)
    expect(globalTaskService.getTaskSnapshot().runConfigCount).toBe(0)
    expect(globalTaskService.getLifecycleEvents()).toEqual([])
  })

  it("keeps debug runConfigs fallback scoped to Debug while Task migration audit stays on userTasksService", async () => {
    debugState.runConfigs.push({
      ...sampleTask,
      id: "debug-fallback-only",
      name: "Debug fallback only",
    })

    const debugEvidence = await globalDebugService.start()
    const taskEvidence = await globalTaskService.runTask(undefined, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({ stdout: "task fallback should not run", exitCode: 0 }),
    })
    const surface = globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot()
    const taskContract = userTasksService.getContractSnapshot()

    expect(debugEvidence).toEqual(expect.objectContaining({
      serviceId: String(IDebugService),
      stateSource: "debugState",
      runtime: "debugState",
      activeConfigId: "debug-fallback-only",
      runConfigCount: 1,
    }))
    expect(debugManagerMock.startSession).toHaveBeenCalledWith(expect.objectContaining({
      id: "debug-fallback-only",
    }))
    expect(taskEvidence).toEqual(expect.objectContaining({
      id: "",
      status: "blocked",
    }))
    expect(taskEvidence.summary).toContain("找不到任务")
    expect(surface.debug.runConfigCount).toBe(1)
    expect(surface.tasks).toEqual(expect.objectContaining({
      stateSource: TASK_CONFIG_STATE_SOURCE,
      runConfigCount: 0,
      activeTaskId: "",
    }))
    expect(taskContract.migrationAudit).toEqual(expect.objectContaining({
      stateSource: TASK_CONFIG_STATE_SOURCE,
      debugRunConfigsUsage: "debug-only",
      debugRunConfigsInput: false,
      taskRunConfigFallback: false,
      configurationResolverOwner: "configurationResolverService/inputAndVariableResolution",
      userTasksOwner: "UserTasksService",
      problemMatcherOwner: "ProblemMatcherRegistry",
      profileTasksOwner: "IUserDataProfileService.currentProfile.tasksResource",
      blockers: [],
    }))
    expect(taskContract.constraints).toEqual(expect.objectContaining({
      noSecondTaskState: true,
      noRunConfigShapeLeak: true,
      problemMatcherRegistrySingleSource: true,
    }))
  })

  it("carries terminal/process owner ids from execution evidence and exposes finished single-run lastTask rerun", async () => {
    addTaskConfig(sampleTask)

    await globalTaskService.runTask(sampleTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({
        stdout: "ok",
        exitCode: 0,
        terminalId: 7,
        processId: 4321,
      }),
    })

    const snapshot = globalTaskService.getTaskSnapshot()

    expect(globalTaskService.getLifecycleEvents().at(-1)).toEqual(expect.objectContaining({
      type: "end",
      terminalId: 7,
      processId: 4321,
    }))
    expect(snapshot.lifecycle).toEqual(expect.objectContaining({
      terminalInstanceId: 7,
      processId: 4321,
      terminalLastTaskMap: [
        expect.objectContaining({
          terminalInstanceId: 7,
          taskId: sampleTask.id,
          status: "finished",
          stateSource: "taskRunner/terminalLastTaskMap",
        }),
      ],
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
    }))
    expect(snapshot.capabilities).toEqual(expect.objectContaining({
      terminalOwnership: "partial",
      terminalInstanceId: 7,
      processId: 4321,
      activeExecutionCount: 0,
      activeExecutionMap: [],
      activeTerminalTaskOwner: expect.objectContaining({
        status: "lastTaskOnly",
        taskId: sampleTask.id,
        terminalInstanceId: 7,
        terminalOwnerResolved: false,
        supportsTerminate: false,
        supportsRerun: true,
        stateSource: "taskRunner/terminalLastTaskMap",
        currentOwner: "TaskWorkbenchAdapterService terminalLastTaskMap fallback matching TerminalTaskSystem.getTaskForTerminal",
      }),
      supportsTerminateAll: false,
      supportsRestartActiveTerminal: true,
    }))
    expect(snapshot.capabilities.terminalTabActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal,
        available: true,
        terminalInstanceId: 7,
        stateSource: "taskRunner/terminalLastTaskMap",
        terminalTaskOwnerStatus: "lastTaskOnly",
        terminalOwnerResolved: false,
      }),
      expect.objectContaining({
        id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll,
        available: false,
        terminalInstanceId: 7,
        stateSource: "taskRunner/activeExecutionMap",
        terminalTaskOwnerStatus: "lastTaskOnly",
        terminalOwnerResolved: false,
      }),
    ]))
    expect(snapshot.capabilities.terminalServiceLifecycle).toEqual(expect.objectContaining({
      status: "partial",
      terminalInstanceId: 7,
      taskId: sampleTask.id,
      registry: expect.objectContaining({
        status: "blocked",
        instanceCount: 0,
        activeInstanceId: null,
        trackedTaskTerminalInstanceIds: [],
        onDidCreateInstance: false,
        onDidDisposeInstance: false,
        stateSource: "terminalManager",
        missingOwner: "ITerminalService.instances registry wired to task terminal creation",
      }),
      reuseRegistry: expect.objectContaining({
        status: "partial",
        reusableTerminalInstanceIds: [7],
        activeTerminalInstanceIds: [],
        finishedTerminalInstanceIds: [7],
        sameTaskTerminalInstanceIds: [],
        idleTaskTerminalInstanceIds: [],
        supportsPhysicalReuse: false,
        stateSource: "terminalManager/taskTerminalReuseRegistry",
        missingOwner: "TerminalTaskSystem._sameTaskTerminals/_idleTaskTerminals owner",
      }),
      create: expect.objectContaining({
        status: "partial",
        ownerConnected: false,
        vscodeOwner: "ITerminalService.createTerminal + TerminalTaskSystem._doCreateTerminal",
        missingOwner: "service-level ITerminalService.createTerminal instance registry wired to task execution",
      }),
      reuse: expect.objectContaining({
        status: "partial",
        ownerConnected: false,
        vscodeOwner: "TerminalTaskSystem._sameTaskTerminals/_idleTaskTerminals + reuseTerminal",
        currentOwner: "TaskWorkbenchAdapterService activeExecutionMap without reusable idle terminal registry",
        missingOwner: "TerminalTaskSystem idle/shared terminal reuse registry",
      }),
      dispose: expect.objectContaining({
        status: "blocked",
        ownerConnected: false,
        missingOwner: "terminalManager pty dispose owner for active task terminal instance",
      }),
      onExit: expect.objectContaining({
        status: "blocked",
        ownerConnected: false,
        missingOwner: "terminalManager pty onExit owner for active task terminal instance",
      }),
      tabActions: expect.objectContaining({
        status: "partial",
        ownerConnected: false,
        missingOwner: "terminal tab action command projection",
      }),
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
      vscodeOwner: "TerminalTaskSystem + ITerminalService + ITerminalInstance lifecycle",
      currentOwner: "TaskWorkbenchAdapterService + terminalManager",
      runtimeReference: false,
    }))
    expect(snapshot.capabilities.terminalServiceLifecycle.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "create",
        missingOwner: "service-level ITerminalService.createTerminal instance registry wired to task execution",
      }),
      expect.objectContaining({
        capability: "dispose",
        missingOwner: "terminalManager pty dispose owner for active task terminal instance",
      }),
      expect.objectContaining({
        capability: "onExit",
        missingOwner: "terminalManager pty onExit owner for active task terminal instance",
      }),
      expect.objectContaining({
        capability: "tabActions",
        missingOwner: "terminal tab action command projection",
      }),
    ]))
    expect(snapshot.capabilities.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "terminalOwnership",
        missingOwner: "active task terminal instance that resolves through terminalManager pty dispose/onExit",
      }),
    ]))
  })

  it("keeps a real-evidence active execution map blocked when background task terminate has no terminal pty owner", async () => {
    const watchTask: RunConfig = {
      ...sampleTask,
      id: "task-watch",
      name: "Task: watch",
      command: "npm run watch",
      isBackground: true,
      problemMatchers: [{
        id: "watch",
        owner: "typescript",
        source: "TypeScript",
        fileLocation: "relative",
        filePrefix: "D:/Workspace",
        pattern: {
          regexp: /^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/,
          file: 1,
          line: 2,
          column: 3,
          severity: 4,
          code: 5,
          message: 6,
        },
        background: {
          activeOnStart: true,
          beginsPattern: /Starting compilation/,
          endsPattern: /Watching for file changes/,
        },
      }],
    }
    addTaskConfig(watchTask)

    await globalTaskService.runTask(watchTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({
        stdout: "Starting compilation in watch mode...",
        exitCode: 0,
        terminalId: 8,
        processId: 9876,
      }),
    })

    const runningSnapshot = globalTaskService.getTaskSnapshot()

    expect(runningSnapshot.lifecycle).toEqual(expect.objectContaining({
      activeTaskId: watchTask.id,
      lastEventType: "end",
      terminalInstanceId: 8,
      processId: 9876,
      activeExecutionCount: 1,
      activeExecutionMap: [
        expect.objectContaining({
          taskId: watchTask.id,
          taskName: watchTask.name,
          terminalInstanceId: 8,
          processId: 9876,
          runType: "background",
          stateSource: "taskRunner/activeExecutionMap",
        }),
      ],
    }))
    expect(runningSnapshot.capabilities).toEqual(expect.objectContaining({
      activeExecutionCount: 1,
      activeExecutionMap: [
        expect.objectContaining({
          taskId: watchTask.id,
          terminalInstanceId: 8,
          processId: 9876,
        }),
      ],
      activeTerminalTaskOwner: expect.objectContaining({
        status: "activeUnresolved",
        taskId: watchTask.id,
        terminalInstanceId: 8,
        terminalOwnerResolved: false,
        supportsTerminate: false,
        supportsRerun: false,
        stateSource: "taskRunner/activeExecutionMap",
      }),
      supportsTerminateAll: false,
      supportsRestartActiveTerminal: false,
    }))
    expect(runningSnapshot.capabilities.terminalServiceLifecycle).toEqual(expect.objectContaining({
      status: "partial",
      terminalInstanceId: 8,
      taskId: watchTask.id,
      registry: expect.objectContaining({
        status: "blocked",
        instanceCount: 0,
        trackedTaskTerminalInstanceIds: [],
        missingOwner: "ITerminalService.instances registry wired to task terminal creation",
      }),
      reuseRegistry: expect.objectContaining({
        status: "blocked",
        reusableTerminalInstanceIds: [],
        activeTerminalInstanceIds: [8],
        finishedTerminalInstanceIds: [],
        sameTaskTerminalInstanceIds: [],
        idleTaskTerminalInstanceIds: [],
        supportsPhysicalReuse: false,
        stateSource: "terminalManager/taskTerminalReuseRegistry",
        missingOwner: "TerminalTaskSystem._sameTaskTerminals/_idleTaskTerminals owner",
      }),
      create: expect.objectContaining({
        status: "partial",
        ownerConnected: false,
        missingOwner: "service-level ITerminalService.createTerminal instance registry wired to task execution",
      }),
      reuse: expect.objectContaining({
        status: "blocked",
        ownerConnected: false,
        missingOwner: "TerminalTaskSystem idle/shared terminal reuse registry",
      }),
      dispose: expect.objectContaining({
        status: "blocked",
        ownerConnected: false,
        missingOwner: "terminalManager pty dispose owner for active task terminal instance",
      }),
      onExit: expect.objectContaining({
        status: "blocked",
        ownerConnected: false,
        missingOwner: "terminalManager pty onExit owner for active task terminal instance",
      }),
      tabActions: expect.objectContaining({
        status: "partial",
        ownerConnected: false,
        missingOwner: "terminal tab action command projection",
      }),
    }))
    expect(runningSnapshot.capabilities.terminalServiceLifecycle.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "create",
        missingOwner: "service-level ITerminalService.createTerminal instance registry wired to task execution",
      }),
      expect.objectContaining({
        capability: "reuse",
        missingOwner: "TerminalTaskSystem idle/shared terminal reuse registry",
      }),
      expect.objectContaining({
        capability: "dispose",
        missingOwner: "terminalManager pty dispose owner for active task terminal instance",
      }),
      expect.objectContaining({
        capability: "onExit",
        missingOwner: "terminalManager pty onExit owner for active task terminal instance",
      }),
      expect.objectContaining({
        capability: "tabActions",
        missingOwner: "terminal tab action command projection",
      }),
    ]))
    expect(runningSnapshot.capabilities.ownershipAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "terminateAll",
        status: "partial",
        currentOwner: "TaskWorkbenchAdapterService activeExecutionMap selection + terminate projection",
        missingOwner: "terminalManager pty dispose/onExit owner for every active execution",
      }),
      expect.objectContaining({
        capability: "restartActiveTerminal",
        status: "partial",
        missingOwner: "active terminal task execution that resolves through terminalManager pty dispose/onExit",
      }),
    ]))

    const terminate = await globalTaskService.terminateTask(watchTask.id)

    expect(terminate).toEqual(expect.objectContaining({
      success: false,
      taskId: watchTask.id,
      terminalInstanceId: 8,
      processId: 9876,
      activeExecutionCount: 1,
      terminalOwner: expect.objectContaining({
        success: false,
        reason: "terminal instance not found",
        stateSource: "terminalManager/terminalOwnerApi",
      }),
    }))
    expect(globalTaskService.getTaskSnapshot().lifecycle).toEqual(expect.objectContaining({
      activeTaskId: watchTask.id,
      terminalInstanceId: 8,
      processId: 9876,
      activeExecutionCount: 1,
      activeExecutionMap: [
        expect.objectContaining({
          taskId: watchTask.id,
          terminalInstanceId: 8,
          processId: 9876,
          runType: "background",
        }),
      ],
    }))
  })

  it("unlocks terminateAll only when active executions resolve to real terminal pty dispose/onExit owners", async () => {
    const watchTask: RunConfig = {
      ...sampleTask,
      id: "task-watch",
      name: "Task: watch",
      command: "npm run watch",
      isBackground: true,
      problemMatchers: [{
        id: "watch",
        owner: "typescript",
        source: "TypeScript",
        fileLocation: "relative",
        filePrefix: "D:/Workspace",
        pattern: {
          regexp: /^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/,
          file: 1,
          line: 2,
          column: 3,
          severity: 4,
          code: 5,
          message: 6,
        },
        background: {
          activeOnStart: true,
          beginsPattern: /Starting compilation/,
          endsPattern: /Watching for file changes/,
        },
      }],
    }
    addTaskConfig(watchTask)
    const terminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
    attachPty(terminal.id, "pty-task-1", 2468)
    const exits: Array<(payload: { id: string; exitCode: number | null }) => void> = []
    const disposed: string[] = []
    ;(globalThis as { codek?: unknown }).codek = {
      pty: {
        dispose: async (id: string) => {
          disposed.push(id)
          queueMicrotask(() => exits.forEach((listener) => listener({ id, exitCode: 143 })))
          return true
        },
        onExit: (callback: (payload: { id: string; exitCode: number | null }) => void) => {
          exits.push(callback)
          return () => {
            const index = exits.indexOf(callback)
            if (index >= 0) exits.splice(index, 1)
          }
        },
      },
    }

    await globalTaskService.runTask(watchTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({
        stdout: "Starting compilation in watch mode...",
        exitCode: 0,
        terminalId: terminal.instanceId,
        processId: 2468,
      }),
    })

    const runningSnapshot = globalTaskService.getTaskSnapshot()
    expect(runningSnapshot.capabilities).toEqual(expect.objectContaining({
      terminalOwnership: "available",
      supportsTerminateAll: true,
      supportsRestartActiveTerminal: true,
      activeExecutionCount: 1,
      terminalTabActions: expect.arrayContaining([
        expect.objectContaining({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal,
          label: "Rerun Task",
          available: true,
          activeExecutionCount: 1,
          terminalInstanceId: terminal.instanceId,
          stateSource: "taskRunner/activeExecutionMap",
          commandOwner: "TaskWorkbenchAdapterService",
          vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
        }),
        expect.objectContaining({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll,
          label: "Terminate All Tasks",
          available: true,
          activeExecutionCount: 1,
          terminalInstanceId: terminal.instanceId,
          stateSource: "taskRunner/activeExecutionMap",
          commandOwner: "TaskWorkbenchAdapterService",
          vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
        }),
      ]),
    }))
    expect(runningSnapshot.capabilities.terminalServiceLifecycle).toEqual(expect.objectContaining({
      status: "connected",
      terminalInstanceId: terminal.instanceId,
      taskId: watchTask.id,
      registry: expect.objectContaining({
        status: "connected",
        instanceCount: 1,
        activeInstanceId: terminal.instanceId,
        trackedTaskTerminalInstanceIds: [terminal.instanceId],
        onDidCreateInstance: true,
        onDidDisposeInstance: true,
        missingOwner: "",
      }),
      reuseRegistry: expect.objectContaining({
        status: "partial",
        reusableTerminalInstanceIds: [],
        activeTerminalInstanceIds: [terminal.instanceId],
        finishedTerminalInstanceIds: [],
        sameTaskTerminalInstanceIds: [terminal.instanceId],
        idleTaskTerminalInstanceIds: [],
        supportsPhysicalReuse: false,
        stateSource: "terminalManager/taskTerminalReuseRegistry",
        currentOwner: "terminalManager TaskTerminalReuseRegistry same/idle task terminal owner + TaskWorkbenchAdapterService lifecycle events",
        missingOwner: "terminal shell owner with reuseTerminal(launchConfigs)",
      }),
      create: expect.objectContaining({
        status: "connected",
        ownerConnected: true,
        currentOwner: "terminalManager.createTerminal/getTerminalByInstanceId instance registry projection",
        missingOwner: "",
      }),
      reuse: expect.objectContaining({
        status: "connected",
        ownerConnected: true,
        currentOwner: "TerminalWorkbenchAdapterService decorated instance reuseTerminal + TaskWorkbenchAdapterService terminalLastTaskMap",
        missingOwner: "",
      }),
      dispose: expect.objectContaining({
        status: "connected",
        ownerConnected: true,
        currentOwner: "terminalManager canTerminateTerminalByInstanceId -> codek.pty.dispose",
        missingOwner: "",
      }),
      onExit: expect.objectContaining({
        status: "connected",
        ownerConnected: true,
        currentOwner: "terminalManager terminateTerminalByInstanceId waits for codek.pty.onExit",
        missingOwner: "",
      }),
      tabActions: expect.objectContaining({
        status: "connected",
        ownerConnected: true,
        currentOwner: "TaskWorkbenchAdapterService shellLaunchConfig.tabActions on decorated terminal instances",
        missingOwner: "",
      }),
    }))
    expect(runningSnapshot.capabilities.terminalServiceLifecycle.blocked).toEqual([])
    expect(runningSnapshot.capabilities.ownershipAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "terminalProcessLifecycle",
        status: "available",
        missingOwner: "",
      }),
      expect.objectContaining({
        capability: "terminateAll",
        status: "available",
        missingOwner: "",
      }),
    ]))
    expect(runningSnapshot.capabilities.blocked).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "terminateAll" }),
    ]))

    const terminateAll = await globalTaskService.terminateAllTasks()

    expect(terminateAll).toEqual(expect.objectContaining({
      success: true,
      action: "terminateAll",
      terminatedCount: 1,
      activeExecutionCount: 0,
      results: [
        expect.objectContaining({
          success: true,
          taskId: watchTask.id,
          terminalInstanceId: terminal.instanceId,
          processId: 2468,
          terminalOwner: expect.objectContaining({
            success: true,
            ptyId: "pty-task-1",
            exitCode: 143,
            stateSource: "terminalManager/terminalOwnerApi",
          }),
        }),
      ],
    }))
    expect(disposed).toEqual(["pty-task-1"])
    expect(globalTaskService.getTaskSnapshot().lifecycle).toEqual(expect.objectContaining({
      activeTaskId: "",
      activeExecutionCount: 0,
      activeExecutionMap: [],
      supportsTerminateAll: false,
    }))
  })

  it("routes the terminate-all task command through TaskWorkbenchAdapterService and preserves configured task state", async () => {
    const watchTask: RunConfig = {
      ...sampleTask,
      id: "task-watch-command",
      name: "Task: watch command",
      command: "npm run watch -- --command",
      isBackground: true,
    }
    addTaskConfig(watchTask)
    debugState.runConfigs.push({
      ...sampleTask,
      id: "debug-only-command-config",
      name: "Debug-only command config",
    })
    const terminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
    attachPty(terminal.id, "pty-task-command", 9753)
    const exits: Array<(payload: { id: string; exitCode: number | null }) => void> = []
    const disposed: string[] = []
    ;(globalThis as { codek?: unknown }).codek = {
      pty: {
        dispose: async (id: string) => {
          disposed.push(id)
          queueMicrotask(() => exits.forEach((listener) => listener({ id, exitCode: 143 })))
          return true
        },
        onExit: (callback: (payload: { id: string; exitCode: number | null }) => void) => {
          exits.push(callback)
          return () => {
            const index = exits.indexOf(callback)
            if (index >= 0) exits.splice(index, 1)
          }
        },
      },
    }

    await globalTaskService.runTask(watchTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({
        stdout: "watching from command",
        exitCode: 0,
        terminalId: terminal.instanceId,
        processId: 9753,
      }),
    })
    registerTerminalDebugTaskWorkbenchContributions()

    const commandHandled = await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll)

    expect(commandHandled).toBe(true)
    expect(disposed).toEqual(["pty-task-command"])
    const snapshot = globalTaskService.getTaskSnapshot()
    expect(snapshot.stateSource).toBe(TASK_CONFIG_STATE_SOURCE)
    expect(snapshot.activeTaskId).toBe("")
    expect(snapshot.runConfigCount).toBe(1)
    expect(snapshot.lifecycle).toEqual(expect.objectContaining({
      lastAction: "terminate",
      activeTaskId: "",
      activeExecutionCount: 0,
      activeExecutionMap: [],
      supportsTerminateAll: false,
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
    }))
    expect(snapshot.capabilities.terminalTabActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll,
        available: false,
        stateSource: "taskRunner/activeExecutionMap",
        commandOwner: "TaskWorkbenchAdapterService",
      }),
    ]))
    expect(userTasksService.getContractSnapshot()).toEqual(expect.objectContaining({
      stateSource: TASK_CONFIG_STATE_SOURCE,
      counts: expect.objectContaining({
        workspace: 1,
        total: 1,
      }),
      constraints: expect.objectContaining({
        noSecondTaskState: true,
        noRunConfigShapeLeak: true,
      }),
    }))
  })

  it("blocks terminateAll when any active execution cannot resolve a pty dispose/onExit owner", async () => {
    const ownedTask: RunConfig = {
      ...sampleTask,
      id: "task-owned-watch",
      name: "Task: owned watch",
      command: "npm run watch -- --owned",
      isBackground: true,
    }
    const unresolvedTask: RunConfig = {
      ...sampleTask,
      id: "task-unresolved-watch",
      name: "Task: unresolved watch",
      command: "npm run watch -- --unresolved",
      isBackground: true,
    }
    userTasksService.replaceTasks("workspace", [ownedTask, unresolvedTask])
    const ownedTerminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
    attachPty(ownedTerminal.id, "pty-owned-task", 3101)
    const disposed: string[] = []
    const exits: Array<(payload: { id: string; exitCode: number | null }) => void> = []
    ;(globalThis as { codek?: unknown }).codek = {
      pty: {
        dispose: async (id: string) => {
          disposed.push(id)
          queueMicrotask(() => exits.forEach((listener) => listener({ id, exitCode: 143 })))
          return true
        },
        onExit: (callback: (payload: { id: string; exitCode: number | null }) => void) => {
          exits.push(callback)
          return () => {
            const index = exits.indexOf(callback)
            if (index >= 0) exits.splice(index, 1)
          }
        },
      },
    }

    await globalTaskService.runTask(ownedTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({
        stdout: "owned watch",
        exitCode: 0,
        terminalId: ownedTerminal.instanceId,
        processId: 3101,
      }),
    })
    await globalTaskService.runTask(unresolvedTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({
        stdout: "unresolved watch",
        exitCode: 0,
        terminalId: 404,
        processId: 4104,
      }),
    })

    const terminateAll = await globalTaskService.terminateAllTasks()

    expect(terminateAll).toEqual(expect.objectContaining({
      success: false,
      action: "terminateAll",
      terminatedCount: 0,
      activeExecutionCount: 2,
      results: [],
      blocked: [
        expect.objectContaining({
          capability: "terminateAll",
          blocked: true,
          vscodeOwner: "TerminalTaskSystem.terminateAll over _activeTasks with ITerminalInstance.dispose/onExit",
          currentOwner: "TaskWorkbenchAdapterService activeExecutionMap + terminalManager pty dispose/onExit owner gate",
          missingOwner: `${unresolvedTask.id}:terminalInstanceId=404`,
        }),
      ],
    }))
    expect(terminateAll.blocked[0].reason).toContain("缺少可解析的 terminalManager pty dispose/onExit owner")
    expect(disposed).toEqual([])
    expect(globalTaskService.getTaskSnapshot().lifecycle).toEqual(expect.objectContaining({
      activeExecutionCount: 2,
      activeExecutionMap: expect.arrayContaining([
        expect.objectContaining({
          taskId: ownedTask.id,
          terminalInstanceId: ownedTerminal.instanceId,
          processId: 3101,
        }),
        expect.objectContaining({
          taskId: unresolvedTask.id,
          terminalInstanceId: 404,
          processId: 4104,
        }),
      ]),
      supportsTerminateAll: false,
    }))
  })

  it("terminates a single background task through the terminal pty owner", async () => {
    const watchTask: RunConfig = {
      ...sampleTask,
      id: "task-watch",
      name: "Task: watch",
      command: "npm run watch",
      isBackground: true,
      problemMatchers: [{
        id: "watch",
        owner: "typescript",
        source: "TypeScript",
        fileLocation: "relative",
        filePrefix: "D:/Workspace",
        pattern: {
          regexp: /^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/,
          file: 1,
          line: 2,
          column: 3,
          severity: 4,
          code: 5,
          message: 6,
        },
        background: {
          activeOnStart: true,
          beginsPattern: /Starting compilation/,
          endsPattern: /Watching for file changes/,
        },
      }],
    }
    addTaskConfig(watchTask)
    const terminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
    attachPty(terminal.id, "pty-task-single", 3579)
    const exits: Array<(payload: { id: string; exitCode: number | null }) => void> = []
    const disposed: string[] = []
    ;(globalThis as { codek?: unknown }).codek = {
      pty: {
        dispose: async (id: string) => {
          disposed.push(id)
          queueMicrotask(() => exits.forEach((listener) => listener({ id, exitCode: 143 })))
          return true
        },
        onExit: (callback: (payload: { id: string; exitCode: number | null }) => void) => {
          exits.push(callback)
          return () => {
            const index = exits.indexOf(callback)
            if (index >= 0) exits.splice(index, 1)
          }
        },
      },
    }

    await globalTaskService.runTask(watchTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({
        stdout: "Starting compilation in watch mode...",
        exitCode: 0,
        terminalId: terminal.instanceId,
        processId: 3579,
      }),
    })

    const terminate = await globalTaskService.terminateTask(watchTask.id)

    expect(disposed).toEqual(["pty-task-single"])
    expect(terminate).toEqual(expect.objectContaining({
      success: true,
      taskId: watchTask.id,
      terminalInstanceId: terminal.instanceId,
      processId: 3579,
      activeExecutionCount: 0,
      terminalOwner: expect.objectContaining({
        success: true,
        ptyId: "pty-task-single",
        exitCode: 143,
        stateSource: "terminalManager/terminalOwnerApi",
      }),
    }))
    expect(globalTaskService.getTaskSnapshot().lifecycle).toEqual(expect.objectContaining({
      activeTaskId: "",
      activeExecutionCount: 0,
      activeExecutionMap: [],
    }))
  })

  it("blocks restartActiveTerminal when terminalInstanceId does not resolve to a pty owner", async () => {
    const watchTask: RunConfig = {
      ...sampleTask,
      id: "task-watch",
      name: "Task: watch",
      command: "npm run watch",
      isBackground: true,
    }
    addTaskConfig(watchTask)

    await globalTaskService.runTask(watchTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({
        stdout: "watching",
        exitCode: 0,
        terminalId: 77,
        processId: 7700,
      }),
    })

    const restart = await globalTaskService.restartActiveTerminal(77)

    expect(restart).toEqual(expect.objectContaining({
      success: false,
      action: "restartActiveTerminal",
      taskId: watchTask.id,
      terminalInstanceId: 77,
      processId: 7700,
      reason: "该 terminalInstanceId 未解析到可 dispose/onExit 的真实 pty owner",
      activeExecutionCount: 1,
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
    }))
    expect(globalTaskService.getTaskSnapshot().capabilities).toEqual(expect.objectContaining({
      supportsTerminateAll: false,
      supportsRestartActiveTerminal: false,
    }))
  })

  it("reruns a finished single-run task from terminal lastTask without restoring activeExecutionMap ownership", async () => {
    const singleRunTask: RunConfig = {
      ...sampleTask,
      id: "task-single-last-task",
      name: "Task: single lastTask",
      command: "npm run once",
      isBackground: false,
    }
    addTaskConfig(singleRunTask)
    const firstTerminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
    const runCommand = vi.fn()
      .mockResolvedValueOnce({
        stdout: "single run complete",
        exitCode: 0,
        terminalId: firstTerminal.instanceId,
        processId: 1357,
      })
      .mockImplementationOnce(async () => {
        const secondTerminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
        return {
          stdout: "single run rerun",
          exitCode: 0,
          terminalId: secondTerminal.instanceId,
          processId: 2468,
        }
      })

    await globalTaskService.runTask(singleRunTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand,
    })

    const finishedSnapshot = globalTaskService.getTaskSnapshot()
    expect(finishedSnapshot.lifecycle).toEqual(expect.objectContaining({
      terminalInstanceId: firstTerminal.instanceId,
      activeExecutionCount: 0,
      activeExecutionMap: [],
      supportsTerminateAll: false,
    }))
    expect(finishedSnapshot.lifecycle.terminalLastTaskMap).toEqual([
      expect.objectContaining({
        terminalInstanceId: firstTerminal.instanceId,
        taskId: singleRunTask.id,
        status: "finished",
        stateSource: "taskRunner/terminalLastTaskMap",
      }),
    ])
    expect(globalTerminalService.getTaskTerminalReuseRegistry()).toEqual(expect.objectContaining({
      stateSource: "terminalManager/taskTerminalReuseRegistry",
      sameTaskCount: 0,
      idleTaskCount: 1,
      idleTaskTerminals: [expect.objectContaining({
        taskId: singleRunTask.id,
        terminalId: firstTerminal.id,
        terminalInstanceId: firstTerminal.instanceId,
        processId: 1357,
        status: "idle",
        panelKind: "shared",
        ownerSource: "terminalManager",
      })],
    }))
    expect(finishedSnapshot.capabilities.terminalServiceLifecycle.reuseRegistry).toEqual(expect.objectContaining({
      status: "partial",
      stateSource: "terminalManager/taskTerminalReuseRegistry",
      sameTaskTerminalInstanceIds: [],
      idleTaskTerminalInstanceIds: [firstTerminal.instanceId],
      supportsPhysicalReuse: false,
      missingOwner: "terminal shell owner with reuseTerminal(launchConfigs)",
    }))
    expect(finishedSnapshot.capabilities.supportsRestartActiveTerminal).toBe(true)
    expect(finishedSnapshot.capabilities.terminalTabActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal,
        available: true,
        terminalInstanceId: firstTerminal.instanceId,
        stateSource: "taskRunner/terminalLastTaskMap",
      }),
      expect.objectContaining({
        id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll,
        available: false,
        stateSource: "taskRunner/activeExecutionMap",
      }),
    ]))
    expect(finishedSnapshot.capabilities.terminalServiceLifecycle).toEqual(expect.objectContaining({
      registry: expect.objectContaining({
        status: "connected",
        instanceCount: 1,
        activeInstanceId: firstTerminal.instanceId,
        trackedTaskTerminalInstanceIds: [firstTerminal.instanceId],
        onDidCreateInstance: true,
        onDidDisposeInstance: true,
        missingOwner: "",
      }),
      reuseRegistry: expect.objectContaining({
        status: "partial",
        reusableTerminalInstanceIds: [firstTerminal.instanceId],
        activeTerminalInstanceIds: [],
        finishedTerminalInstanceIds: [firstTerminal.instanceId],
        sameTaskTerminalInstanceIds: [],
        idleTaskTerminalInstanceIds: [firstTerminal.instanceId],
        supportsPhysicalReuse: false,
        stateSource: "terminalManager/taskTerminalReuseRegistry",
        currentOwner: "terminalManager TaskTerminalReuseRegistry same/idle task terminal owner + TaskWorkbenchAdapterService lifecycle events",
        missingOwner: "terminal shell owner with reuseTerminal(launchConfigs)",
      }),
      reuse: expect.objectContaining({
        status: "connected",
        ownerConnected: true,
        currentOwner: "TerminalWorkbenchAdapterService decorated instance reuseTerminal + TaskWorkbenchAdapterService terminalLastTaskMap",
        missingOwner: "",
      }),
      tabActions: expect.objectContaining({
        status: "connected",
        ownerConnected: true,
        currentOwner: "TaskWorkbenchAdapterService shellLaunchConfig.tabActions on decorated terminal instances",
        missingOwner: "",
      }),
    }))
    const reusableTerminal = globalTerminalService.instances.find((instance) => instance.instanceId === firstTerminal.instanceId)
    expect(reusableTerminal?.shellLaunchConfig).toEqual(expect.objectContaining({
      type: "Task",
      taskId: singleRunTask.id,
      taskName: singleRunTask.name,
      isFeatureTerminal: true,
      useShellEnvironment: true,
      reuseCount: 0,
      tabActions: expect.arrayContaining([
        expect.objectContaining({ id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal }),
        expect.objectContaining({ id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll }),
      ]),
      stateSource: "TaskWorkbenchAdapterService/shellLaunchConfig",
      runtimeReference: false,
    }))

    const terminateAll = await globalTaskService.terminateAllTasks()
    expect(terminateAll).toEqual(expect.objectContaining({
      success: false,
      terminatedCount: 0,
      activeExecutionCount: 0,
    }))

    const restart = await globalTaskService.restartActiveTerminal(firstTerminal.instanceId)

    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(reusableTerminal?.shellLaunchConfig).toEqual(expect.objectContaining({
      taskId: singleRunTask.id,
      reuseCount: 1,
      lastReuseTaskId: singleRunTask.id,
      tabActions: expect.arrayContaining([
        expect.objectContaining({ id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal }),
        expect.objectContaining({ id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll }),
      ]),
    }))
    expect(restart).toEqual(expect.objectContaining({
      success: true,
      action: "restartActiveTerminal",
      taskId: singleRunTask.id,
      taskName: singleRunTask.name,
      terminalInstanceId: expect.any(Number),
      processId: 2468,
      activeExecutionCount: 0,
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
      terminalLastTask: expect.objectContaining({
        terminalInstanceId: firstTerminal.instanceId,
        taskId: singleRunTask.id,
        status: "finished",
        stateSource: "taskRunner/terminalLastTaskMap",
      }),
      run: expect.objectContaining({
        id: singleRunTask.id,
        status: "passed",
      }),
    }))
    expect(globalTaskService.getTaskSnapshot().lifecycle.activeExecutionMap).toEqual([])

    registerTerminalDebugTaskWorkbenchContributions()
    const commandHandled = await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal, [
      firstTerminal.instanceId,
    ])

    expect(commandHandled).toBe(true)
    expect(runCommand).toHaveBeenCalledTimes(3)
    const commandRerunSnapshot = globalTaskService.getTaskSnapshot()
    expect(commandRerunSnapshot.lifecycle).toEqual(expect.objectContaining({
      lastAction: "rerun",
      activeTaskId: singleRunTask.id,
      activeExecutionMap: [],
      terminalLastTaskMap: expect.arrayContaining([
        expect.objectContaining({
          terminalInstanceId: firstTerminal.instanceId,
          taskId: singleRunTask.id,
          status: "finished",
          stateSource: "taskRunner/terminalLastTaskMap",
        }),
      ]),
    }))
    expect(commandRerunSnapshot.capabilities.terminalTabActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal,
        commandOwner: "TaskWorkbenchAdapterService",
        available: true,
        stateSource: "taskRunner/terminalLastTaskMap",
      }),
    ]))
  })

  it("reuses a finished same-task terminal through terminalManager instead of creating a second task state source", async () => {
    const singleRunTask: RunConfig = {
      ...sampleTask,
      id: "task-reuse-same",
      name: "Task: reuse same",
      command: "npm run reuse-same",
      isBackground: false,
    }
    addTaskConfig(singleRunTask)
    const terminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
    const runCommand = vi.fn()
      .mockResolvedValueOnce({
        stdout: "first run",
        exitCode: 0,
        terminalId: terminal.instanceId,
        processId: 1111,
      })
      .mockImplementationOnce(async (config: RunConfig & { taskTerminalReuse?: unknown }) => ({
        stdout: "reused run",
        exitCode: 0,
        terminalId: (config.taskTerminalReuse as { terminalInstanceId: number }).terminalInstanceId,
        processId: 2222,
      }))

    await globalTaskService.runTask(singleRunTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand,
    })
    const secondRun = await globalTaskService.runTask(singleRunTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand,
    })

    expect(secondRun.status).toBe("passed")
    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(runCommand.mock.calls[1][0]).toEqual(expect.objectContaining({
      id: singleRunTask.id,
      taskTerminalReuse: expect.objectContaining({
        terminalInstanceId: terminal.instanceId,
        taskId: singleRunTask.id,
        taskName: singleRunTask.name,
        commandLine: singleRunTask.command,
        cwd: "D:/Workspace",
        group: "",
        reuseKind: "sameTask",
        source: "TerminalTaskSystem.reuseTerminal(launchConfigs)",
        stateSource: "terminalManager/taskTerminalReuseOwner",
        runtimeReference: false,
      }),
    }))
    expect(globalTerminalService.getTerminals()).toHaveLength(1)
    expect(globalTaskService.getTaskSnapshot().capabilities).toEqual(expect.objectContaining({
      latestPhysicalReuse: expect.objectContaining({
        success: true,
        terminalInstanceId: terminal.instanceId,
        taskId: singleRunTask.id,
        reuseKind: "sameTask",
        terminalOwner: expect.objectContaining({
          stateSource: "terminalManager/taskTerminalReuseOwner",
          terminalInstanceId: terminal.instanceId,
        }),
        stateSource: "taskRunner/terminalLastTaskMap",
      }),
      activeExecutionCount: 0,
      activeExecutionMap: [],
    }))
  })

  it("reuses an idle task terminal from the same group for a different task", async () => {
    const firstTask: RunConfig = {
      ...sampleTask,
      id: "task-reuse-group-a",
      name: "Task: reuse group A",
      command: "npm run group-a",
      group: "build",
      isBackground: false,
    }
    const secondTask: RunConfig = {
      ...sampleTask,
      id: "task-reuse-group-b",
      name: "Task: reuse group B",
      command: "npm run group-b",
      group: "build",
      isBackground: false,
    }
    userTasksService.replaceTasks("workspace", [firstTask, secondTask])
    const terminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
    const runCommand = vi.fn()
      .mockResolvedValueOnce({
        stdout: "group a",
        exitCode: 0,
        terminalId: terminal.instanceId,
        processId: 3333,
      })
      .mockImplementationOnce(async (config: RunConfig & { taskTerminalReuse?: unknown }) => ({
        stdout: "group b",
        exitCode: 0,
        terminalId: (config.taskTerminalReuse as { terminalInstanceId: number }).terminalInstanceId,
        processId: 4444,
      }))

    await globalTaskService.runTask(firstTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand,
    })
    await globalTaskService.runTask(secondTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand,
    })

    expect(runCommand.mock.calls[1][0]).toEqual(expect.objectContaining({
      id: secondTask.id,
      taskTerminalReuse: expect.objectContaining({
        terminalInstanceId: terminal.instanceId,
        taskId: secondTask.id,
        group: "build",
        reuseKind: "idleTask",
        source: "TerminalTaskSystem.reuseTerminal(launchConfigs)",
        stateSource: "terminalManager/taskTerminalReuseOwner",
      }),
    }))
    expect(globalTerminalService.getTerminals()).toHaveLength(1)
    expect(globalTaskService.getTaskSnapshot().capabilities.latestPhysicalReuse).toEqual(expect.objectContaining({
      success: true,
      terminalInstanceId: terminal.instanceId,
      taskId: secondTask.id,
      reuseKind: "idleTask",
      terminalOwner: expect.objectContaining({
        success: true,
        stateSource: "terminalManager/taskTerminalReuseOwner",
      }),
    }))
  })

  it("restarts the active terminal by terminating its owner and rerunning the same task", async () => {
    const watchTask: RunConfig = {
      ...sampleTask,
      id: "task-watch",
      name: "Task: watch",
      command: "npm run watch",
      isBackground: true,
    }
    addTaskConfig(watchTask)
    const firstTerminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
    attachPty(firstTerminal.id, "pty-task-1", 2468)
    const exits: Array<(payload: { id: string; exitCode: number | null }) => void> = []
    const disposed: string[] = []
    const runCommand = vi.fn()
      .mockResolvedValueOnce({
        stdout: "watching",
        exitCode: 0,
        terminalId: firstTerminal.instanceId,
        processId: 2468,
      })
      .mockImplementationOnce(async () => {
        const secondTerminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
        attachPty(secondTerminal.id, "pty-task-2", 8642)
        return {
          stdout: "watching again",
          exitCode: 0,
          terminalId: secondTerminal.instanceId,
          processId: 8642,
        }
      })
    ;(globalThis as { codek?: unknown }).codek = {
      pty: {
        dispose: async (id: string) => {
          disposed.push(id)
          queueMicrotask(() => exits.forEach((listener) => listener({ id, exitCode: 143 })))
          return true
        },
        onExit: (callback: (payload: { id: string; exitCode: number | null }) => void) => {
          exits.push(callback)
          return () => {
            const index = exits.indexOf(callback)
            if (index >= 0) exits.splice(index, 1)
          }
        },
      },
    }

    await globalTaskService.runTask(watchTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand,
    })
    const beforeRestart = globalTaskService.getTaskSnapshot()
    expect(beforeRestart.capabilities).toEqual(expect.objectContaining({
      terminalOwnership: "available",
      supportsTerminateAll: true,
      supportsRestartActiveTerminal: true,
      activeExecutionCount: 1,
      terminalTabActions: expect.arrayContaining([
        expect.objectContaining({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal,
          label: "Rerun Task",
          available: true,
          activeExecutionCount: 1,
          terminalInstanceId: firstTerminal.instanceId,
          stateSource: "taskRunner/activeExecutionMap",
          commandOwner: "TaskWorkbenchAdapterService",
          vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
        }),
        expect.objectContaining({
          id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll,
          label: "Terminate All Tasks",
          available: true,
          activeExecutionCount: 1,
          terminalInstanceId: firstTerminal.instanceId,
          stateSource: "taskRunner/activeExecutionMap",
          commandOwner: "TaskWorkbenchAdapterService",
          vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
        }),
      ]),
    }))
    expect(beforeRestart.capabilities.ownershipAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "terminalProcessLifecycle",
        status: "available",
        missingOwner: "",
      }),
      expect.objectContaining({
        capability: "restartActiveTerminal",
        status: "available",
        missingOwner: "",
      }),
    ]))
    expect(beforeRestart.capabilities.blocked).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "restartActiveTerminal" }),
    ]))

    const restart = await globalTaskService.restartActiveTerminal(firstTerminal.instanceId)

    expect(restart).toEqual(expect.objectContaining({
      success: true,
      action: "restartActiveTerminal",
      taskId: watchTask.id,
      terminate: expect.objectContaining({
        success: true,
        taskId: watchTask.id,
        terminalInstanceId: firstTerminal.instanceId,
        processId: 2468,
        terminalOwner: expect.objectContaining({
          success: true,
          ptyId: "pty-task-1",
          exitCode: 143,
          stateSource: "terminalManager/terminalOwnerApi",
        }),
      }),
      run: expect.objectContaining({
        id: watchTask.id,
        status: "passed",
      }),
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
    }))
    expect(disposed).toEqual(["pty-task-1"])
    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(globalTaskService.getTaskSnapshot().lifecycle).toEqual(expect.objectContaining({
      activeTaskId: watchTask.id,
      lastAction: "rerun",
      terminalInstanceId: expect.any(Number),
      processId: 8642,
      activeExecutionCount: 1,
      activeExecutionMap: [
        expect.objectContaining({
          taskId: watchTask.id,
          processId: 8642,
          runType: "background",
        }),
      ],
      supportsRestartActiveTerminal: true,
    }))
  })

  it("opens QuickInput prompt and terminates the selected instance when prompt policy reaches the limit", async () => {
    const watchTask: TaskConfig = {
      ...sampleTask,
      id: "task-watch",
      name: "Task: watch",
      command: "npm run watch",
      isBackground: true,
      source: "workspace",
      runOptions: {
        instanceLimit: 1,
        instancePolicy: "prompt",
      },
    }
    addTaskConfig(watchTask)
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: "watching 1", exitCode: 0, terminalId: 77, processId: 7700 })
      .mockResolvedValueOnce({ stdout: "watching 2", exitCode: 0, terminalId: 78, processId: 7800 })

    const firstRun = await globalTaskService.runTask(watchTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand,
    })
    const secondRunPromise = globalTaskService.runTask(watchTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand,
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    const prompt = quickInputState.queue[0]
    expect(prompt.options).toEqual(expect.objectContaining({
      title: "Task instance limit reached",
      placeHolder: "Select an instance to terminate",
      matchOnDescription: true,
      matchOnDetail: true,
    }))
    expect(prompt.items).toEqual([
      expect.objectContaining({
        label: watchTask.name,
        description: "instance 1 - terminal 77 - pid 7700",
        value: expect.objectContaining({
          taskId: watchTask.id,
          terminalInstanceId: 77,
          processId: 7700,
        }),
      }),
    ])
    const selectedPromptItem = prompt.items.find((item) => item.type !== "separator") as QuickPickItem
    acceptQuickPick(prompt.id, selectedPromptItem)
    const secondRun = await secondRunPromise

    expect(firstRun.status).toBe("passed")
    expect(secondRun.status).toBe("passed")
    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(quickInputState.queue).toHaveLength(0)
    expect(globalTaskService.getLifecycleEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "terminated",
        taskId: watchTask.id,
        terminalId: 77,
        processId: 7700,
      }),
    ]))
    expect(globalTaskService.getTaskSnapshot().lifecycle).toEqual(expect.objectContaining({
      activeTaskId: watchTask.id,
      activeTaskName: watchTask.name,
      terminalInstanceId: 78,
      processId: 7800,
      activeExecutionCount: 1,
      activeExecutionMap: [
        expect.objectContaining({
          taskId: watchTask.id,
          terminalInstanceId: 78,
          processId: 7800,
          runType: "background",
        }),
      ],
      supportsMultipleExecutions: true,
      latestInstancePolicy: expect.objectContaining({
        taskId: watchTask.id,
        policy: "prompt",
        action: "prompt",
        status: "handled",
        instanceLimit: 1,
        sameTaskExecutionCount: 1,
        activeExecutionCount: 1,
        terminalInstanceId: 77,
        processId: 7700,
        quickPickOwner: "QuickInputService.pick",
        quickPickItemCount: 1,
        quickPickSelection: expect.stringContaining(`${watchTask.id}:`),
        stateSource: "taskRunner/instancePolicy",
        vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/abstractTaskService.ts",
        runtimeReference: false,
      }),
    }))
    expect(globalTaskService.getTaskSnapshot().capabilities).toEqual(expect.objectContaining({
      supportsMultipleExecutions: true,
      multipleExecutionsPolicy: "instanceLimit",
      activeExecutionCount: 1,
      latestInstancePolicy: expect.objectContaining({
        action: "prompt",
        status: "handled",
        quickPickOwner: "QuickInputService.pick",
      }),
    }))
    expect(globalTaskService.getTaskSnapshot().capabilities.ownershipAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "multipleExecutions",
        status: "available",
        currentOwner: "TaskWorkbenchAdapterService activeExecutionMap + runOptions.instanceLimit/instancePolicy prompt/terminateNewest/terminateOldest/allow evidence",
      }),
    ]))
    expect(globalTaskService.getTaskSnapshot().capabilities.blocked).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "multipleExecutions" }),
    ]))
  })

  it("keeps prompt policy blocked when the QuickInput prompt is cancelled", async () => {
    const watchTask: TaskConfig = {
      ...sampleTask,
      id: "task-watch",
      name: "Task: watch",
      command: "npm run watch",
      isBackground: true,
      source: "workspace",
      runOptions: {
        instanceLimit: 1,
        instancePolicy: "prompt",
      },
    }
    addTaskConfig(watchTask)
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "watching",
      exitCode: 0,
      terminalId: 77,
      processId: 7700,
    })

    const firstRun = await globalTaskService.runTask(watchTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand,
    })
    const secondRunPromise = globalTaskService.runTask(watchTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand,
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    cancelQuickPick(quickInputState.queue[0].id)
    const secondRun = await secondRunPromise

    expect(firstRun.status).toBe("passed")
    expect(secondRun).toEqual(expect.objectContaining({
      id: watchTask.id,
      name: watchTask.name,
      status: "blocked",
      blocked: [
        "任务实例数已达到限制，需要选择要终止的实例: Task: watch (instanceLimit=1, policy=prompt)",
      ],
      summary: "任务未运行：任务实例数已达到限制，需要选择要终止的实例: Task: watch (instanceLimit=1, policy=prompt)",
    }))
    expect(runCommand).toHaveBeenCalledTimes(1)
    expect(globalTaskService.getTaskSnapshot().capabilities).toEqual(expect.objectContaining({
      latestInstancePolicy: expect.objectContaining({
        action: "prompt",
        status: "pendingPrompt",
        quickPickOwner: "QuickInputService.pick",
        quickPickItemCount: 1,
        quickPickSelection: null,
      }),
    }))
    expect(globalTaskService.getTaskSnapshot().capabilities.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "multipleExecutions",
        reason: "已迁移 VS Code _handleInstancePolicy 的 prompt 策略并接入 QuickInputService.pick；当前没有选择要终止的实例，因此保持 pendingPrompt，不自动终止实例。",
        missingOwner: "user QuickPick selection",
      }),
    ]))
  })

  it("allows multiple same-task active executions when instanceLimit is greater than the active count", async () => {
    const watchTask: TaskConfig = {
      ...sampleTask,
      id: "task-watch",
      name: "Task: watch",
      command: "npm run watch",
      isBackground: true,
      source: "workspace",
      runOptions: {
        instanceLimit: 2,
        instancePolicy: "prompt",
      },
    }
    addTaskConfig(watchTask)
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: "watching 1", exitCode: 0, terminalId: 77, processId: 7700 })
      .mockResolvedValueOnce({ stdout: "watching 2", exitCode: 0, terminalId: 78, processId: 7800 })

    const firstRun = await globalTaskService.runTask(watchTask.id, { workspaceFolder: "D:/Workspace", runCommand })
    const secondRun = await globalTaskService.runTask(watchTask.id, { workspaceFolder: "D:/Workspace", runCommand })

    expect(firstRun.status).toBe("passed")
    expect(secondRun.status).toBe("passed")
    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(globalTaskService.getTaskSnapshot().lifecycle).toEqual(expect.objectContaining({
      activeExecutionCount: 2,
      activeExecutionMap: expect.arrayContaining([
        expect.objectContaining({ taskId: watchTask.id, terminalInstanceId: 77, processId: 7700 }),
        expect.objectContaining({ taskId: watchTask.id, terminalInstanceId: 78, processId: 7800 }),
      ]),
      latestInstancePolicy: expect.objectContaining({
        action: "allow",
        status: "allowed",
        instanceLimit: 2,
        sameTaskExecutionCount: 1,
      }),
    }))
  })

  it("handles terminateNewest instance policy by clearing the newest active execution before starting another", async () => {
    const watchTask: TaskConfig = {
      ...sampleTask,
      id: "task-watch",
      name: "Task: watch",
      command: "npm run watch",
      isBackground: true,
      source: "workspace",
      runOptions: {
        instanceLimit: 1,
        instancePolicy: "terminateNewest",
      },
    }
    addTaskConfig(watchTask)
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: "watching 1", exitCode: 0, terminalId: 77, processId: 7700 })
      .mockResolvedValueOnce({ stdout: "watching 2", exitCode: 0, terminalId: 78, processId: 7800 })

    await globalTaskService.runTask(watchTask.id, { workspaceFolder: "D:/Workspace", runCommand })
    const secondRun = await globalTaskService.runTask(watchTask.id, { workspaceFolder: "D:/Workspace", runCommand })

    expect(secondRun.status).toBe("passed")
    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(globalTaskService.getLifecycleEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "terminated",
        taskId: watchTask.id,
        terminalId: 77,
        processId: 7700,
      }),
    ]))
    expect(globalTaskService.getTaskSnapshot().lifecycle).toEqual(expect.objectContaining({
      activeExecutionCount: 1,
      activeExecutionMap: [
        expect.objectContaining({ taskId: watchTask.id, terminalInstanceId: 78, processId: 7800 }),
      ],
      latestInstancePolicy: expect.objectContaining({
        policy: "terminateNewest",
        action: "terminateNewest",
        status: "handled",
        selectedExecutionId: expect.stringContaining(`${watchTask.id}:`),
        terminalInstanceId: 77,
        processId: 7700,
      }),
    }))
  })

  it("handles terminateOldest instance policy by selecting the oldest active execution", async () => {
    const watchTask: TaskConfig = {
      ...sampleTask,
      id: "task-watch",
      name: "Task: watch",
      command: "npm run watch",
      isBackground: true,
      source: "workspace",
      runOptions: {
        instanceLimit: 2,
        instancePolicy: "terminateOldest",
      },
    }
    addTaskConfig(watchTask)
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: "watching 1", exitCode: 0, terminalId: 77, processId: 7700 })
      .mockResolvedValueOnce({ stdout: "watching 2", exitCode: 0, terminalId: 78, processId: 7800 })
      .mockResolvedValueOnce({ stdout: "watching 3", exitCode: 0, terminalId: 79, processId: 7900 })

    await globalTaskService.runTask(watchTask.id, { workspaceFolder: "D:/Workspace", runCommand })
    await globalTaskService.runTask(watchTask.id, { workspaceFolder: "D:/Workspace", runCommand })
    const thirdRun = await globalTaskService.runTask(watchTask.id, { workspaceFolder: "D:/Workspace", runCommand })

    expect(thirdRun.status).toBe("passed")
    expect(runCommand).toHaveBeenCalledTimes(3)
    expect(globalTaskService.getTaskSnapshot().lifecycle).toEqual(expect.objectContaining({
      activeExecutionCount: 2,
      activeExecutionMap: expect.arrayContaining([
        expect.objectContaining({ taskId: watchTask.id, terminalInstanceId: 78, processId: 7800 }),
        expect.objectContaining({ taskId: watchTask.id, terminalInstanceId: 79, processId: 7900 }),
      ]),
      latestInstancePolicy: expect.objectContaining({
        policy: "terminateOldest",
        action: "terminateOldest",
        status: "handled",
        terminalInstanceId: 77,
        processId: 7700,
      }),
    }))
    expect(globalTaskService.getTaskSnapshot().lifecycle.activeExecutionMap).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ terminalInstanceId: 77 }),
    ]))
  })

  it("projects rerun and terminate contracts without introducing a second task runner", async () => {
    addTaskConfig(sampleTask)

    const runCommand = vi.fn().mockResolvedValue({ stdout: "ok", exitCode: 0 })
    await globalTaskService.runTask(sampleTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand,
    })
    await globalTaskService.rerunTask({ runCommand })
    const terminate = await globalTaskService.terminateTask(sampleTask.id)

    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(terminate).toEqual(expect.objectContaining({
      success: true,
      taskId: sampleTask.id,
      action: "terminate",
      terminalInstanceId: null,
      processId: null,
      activeExecutionCount: 0,
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
    }))
    expect(globalTaskService.getLifecycleEvents().at(-1)).toEqual(expect.objectContaining({
      type: "terminated",
      taskId: sampleTask.id,
      source: "taskRunner",
    }))
    expect(globalTaskService.getTaskSnapshot().lifecycle).toEqual(expect.objectContaining({
      activeTaskId: "",
      lastAction: "terminate",
      supportsRerun: true,
      supportsTerminate: true,
      supportsMultipleExecutions: true,
    }))
  })

  it("projects TaskSystem capability and partial extension provider bridge evidence without terminal execution claims", async () => {
    addTaskConfig(sampleTask)
    userTasksService.replaceExtensionProviderTasks([{
      _id: "npm:test",
      name: "npm: test",
      source: "npm",
      definition: { type: "npm", script: "test" },
      execution: { process: "npm", args: ["test"] },
    }])

    const snapshot = globalTaskService.getTaskSnapshot()

    expect(snapshot.capabilities).toEqual(expect.objectContaining({
      source: "TaskSystemCapabilitySnapshot",
      stateSource: "taskRunner/TaskSystemLifecycleProjection",
      terminalOwnership: "blocked",
      terminalInstanceId: null,
      processId: null,
      supportsRerun: true,
      supportsTerminate: true,
      supportsTerminateAll: false,
      supportsRestartActiveTerminal: false,
      supportsMultipleExecutions: true,
      supportsExtensionTaskProviderBridge: "partial",
      extensionTaskProviderBridge: expect.objectContaining({
        status: "partial",
        providerTaskCount: 1,
        taskProjection: true,
        rendererIpcConsumerConnected: false,
        terminalTaskSystemExecution: false,
      }),
      multipleExecutionsPolicy: "instanceLimit",
    }))
    expect(snapshot.capabilities.ownershipAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "terminalProcessLifecycle",
        status: "partial",
        vscodeOwner: "TerminalTaskSystem._activeTasks/_terminals + ITerminalInstance.processReady/onExit",
        currentOwner: "taskRunner activeExecutionMap + terminalManager owner API, waiting for active task terminal instance evidence",
        missingOwner: "active task terminal instance that resolves through terminalManager pty dispose/onExit",
        nextAuthorizedFiles: [
          "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
          "frontend/vite-project/src/workbench/taskRunner.ts",
          "frontend/vite-project/src/terminal/terminalManager.ts",
        ],
      }),
      expect.objectContaining({
        capability: "problemMatcher",
        status: "partial",
        vscodeOwner: "TerminalTaskSystem WatchingProblemCollector/StartStopProblemCollector + ProblemMatcherRegistry",
        currentOwner: "taskRunner problemMatcher projection + userTasksService ProblemMatcherRegistry evidence",
        missingOwner: "taskRunner command-output collector evidence from a real task run with problemMatchers",
      }),
      expect.objectContaining({
        capability: "multipleExecutions",
        status: "available",
        vscodeOwner: "AbstractTaskService._handleInstancePolicy + TerminalTaskSystem instance maps",
        currentOwner: "TaskWorkbenchAdapterService activeExecutionMap + runOptions.instanceLimit/instancePolicy prompt/terminateNewest/terminateOldest/allow evidence",
      }),
    ]))
    expect(snapshot.capabilities.vscodeSourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
      "src/vs/workbench/contrib/tasks/browser/abstractTaskService.ts",
      "src/vs/workbench/contrib/tasks/common/tasks.ts",
      "src/vs/workbench/api/browser/mainThreadTask.ts",
      "src/vs/workbench/api/common/extHostTask.ts",
      "src/vs/workbench/contrib/tasks/common/taskDefinitionRegistry.ts",
    ]))
    expect(snapshot.capabilities.currentSourcePaths).toEqual(expect.arrayContaining([
      "frontend/vite-project/src/workbench/taskRunner.ts",
      "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.ts",
      "frontend/vite-project/src/terminal/terminalManager.ts",
    ]))
    expect(snapshot.capabilities.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "terminalOwnership",
        reason: "terminalManager 已提供真实 pty dispose/onExit owner API；当前没有可解析到该 owner 的 active task terminal instance，因此 terminateAll/restartActiveTerminal 仍保持 blocked。",
        vscodeOwner: "TerminalTaskSystem._activeTasks/_terminals + ITerminalInstance.processReady/onExit",
        currentOwner: "taskRunner activeExecutionMap + terminalManager owner API, waiting for active task terminal instance evidence",
        missingOwner: "active task terminal instance that resolves through terminalManager pty dispose/onExit",
      }),
      expect.objectContaining({
        capability: "extensionTaskProviderBridge",
        reason: "renderer userTasksService 已可投影 extension provider tasks；但尚未观察到 provider task 进入 taskRunner execution/lifecycle/activeExecutionMap，不能声明 provider task 可真实执行。",
        missingOwner: "TerminalTaskSystem execution owner for provider-backed tasks",
      }),
    ]))
    expect(snapshot.lifecycle).toEqual(expect.objectContaining({
      terminalInstanceId: null,
      processId: null,
      activeExecutionCount: 0,
      activeExecutionMap: [],
      supportsTerminateAll: false,
      supportsRestartActiveTerminal: false,
    }))
  })

  it("keeps provider single-run execution evidence blocked when no active terminal owner is returned", async () => {
    userTasksService.markExtensionProviderRendererIpcConsumerConnected(true)
    userTasksService.replaceExtensionProviderTasks([{
      _id: "npm:test-current",
      name: "npm: test current",
      source: "npm",
      definition: { type: "npm", script: "test" },
      execution: { process: "npm", args: ["test"] },
    }])
    const providerTask = userTasksService.getTasks("extensionProvider")[0]

    const evidence = await globalTaskService.runTask(providerTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async (task) => ({
        stdout: `current-smoke:${task.command}`,
        exitCode: 0,
      }),
    })
    const snapshot = globalTaskService.getTaskSnapshot()

    expect(evidence).toEqual(expect.objectContaining({
      id: providerTask.id,
      status: "passed",
      steps: [
        expect.objectContaining({
          id: providerTask.id,
          outputPreview: "current-smoke:npm test",
        }),
      ],
    }))
    expect(snapshot.lifecycle).toEqual(expect.objectContaining({
      activeTaskId: providerTask.id,
      terminalInstanceId: null,
      processId: null,
      activeExecutionCount: 0,
      activeExecutionMap: [],
      supportsTerminateAll: false,
      supportsRestartActiveTerminal: false,
    }))
    expect(snapshot.capabilities.extensionTaskProviderBridge).toEqual(expect.objectContaining({
      status: "partial",
      providerTaskCount: 1,
      taskProjection: true,
      rendererIpcConsumerConnected: true,
      terminalTaskSystemExecution: true,
      executionEvidence: expect.objectContaining({
        taskId: providerTask.id,
        providerType: "npm",
        runType: "singleRun",
        terminalInstanceId: null,
        processId: null,
        activeExecutionMapped: false,
        terminalOwnerResolved: false,
        blockedReason: "provider task 已进入 taskRunner execution，但 current/single-run 执行结束后没有保留 activeExecutionMap entry；没有 active terminal owner 可用于 terminateAll/restartActiveTerminal。",
        missingOwner: "terminalManager pty dispose/onExit owner returned by the provider task execution bridge",
        stateSource: "taskRunner/TaskSystemLifecycleProjection",
      }),
    }))
    expect(snapshot.capabilities.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "terminalOwnership",
        missingOwner: "active task terminal instance that resolves through terminalManager pty dispose/onExit",
      }),
      expect.objectContaining({
        capability: "terminateAll",
        missingOwner: "terminalManager pty dispose/onExit owner for every active execution",
      }),
      expect.objectContaining({
        capability: "restartActiveTerminal",
        missingOwner: "active terminal task execution that resolves through terminalManager pty dispose/onExit",
      }),
      expect.objectContaining({
        capability: "extensionTaskProviderBridge",
        reason: "provider task 已进入 taskRunner execution，但 current/single-run 执行结束后没有保留 activeExecutionMap entry；没有 active terminal owner 可用于 terminateAll/restartActiveTerminal。",
        currentOwner: "userTasksService extensionProvider projection + TaskWorkbenchAdapterService.runTask/taskRunner lifecycle",
        missingOwner: "terminalManager pty dispose/onExit owner returned by the provider task execution bridge",
      }),
    ]))
    expect(snapshot.capabilities.terminalTabActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal,
        available: false,
        terminalInstanceId: null,
      }),
      expect.objectContaining({
        id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll,
        available: false,
        terminalInstanceId: null,
      }),
    ]))
  })

  it("links provider-backed extension tasks into the same taskRunner lifecycle and activeExecutionMap", async () => {
    userTasksService.markExtensionProviderRendererIpcConsumerConnected(true)
    userTasksService.replaceExtensionProviderTasks([{
      _id: "npm:watch",
      name: "npm: watch",
      source: "npm",
      definition: { type: "npm", script: "watch" },
      execution: { process: "npm", args: ["run", "watch"] },
      isBackground: true,
      problemMatchers: [{
        id: "watch",
        owner: "typescript",
        source: "TypeScript",
        fileLocation: "relative",
        filePrefix: "D:/Workspace",
        pattern: {
          regexp: /^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/,
          file: 1,
          line: 2,
          column: 3,
          severity: 4,
          code: 5,
          message: 6,
        },
        background: {
          activeOnStart: true,
          beginsPattern: /Starting compilation/,
          endsPattern: /Watching for file changes/,
        },
      }],
    }])
    const providerTask = userTasksService.getTasks("extensionProvider")[0]

    const evidence = await globalTaskService.runTask(providerTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async (task) => ({
        stdout: `Starting compilation\nrunning ${task.command}`,
        exitCode: 0,
        terminalId: 71,
        processId: 7171,
      }),
    })
    const snapshot = globalTaskService.getTaskSnapshot()

    expect(evidence).toEqual(expect.objectContaining({
      id: providerTask.id,
      name: "npm: watch",
      status: "passed",
      steps: [
        expect.objectContaining({
          id: providerTask.id,
          outputPreview: "Starting compilation\nrunning npm run watch",
          backgroundStatus: "active",
          backgroundBeginsMatched: true,
        }),
      ],
    }))
    expect(globalTaskService.getLifecycleEvents().map((event) => event.taskId)).toEqual(
      expect.arrayContaining([providerTask.id]),
    )
    expect(snapshot.lifecycle).toEqual(expect.objectContaining({
      activeTaskId: providerTask.id,
      terminalInstanceId: 71,
      processId: 7171,
      activeExecutionCount: 1,
      activeExecutionMap: [
        expect.objectContaining({
          taskId: providerTask.id,
          taskName: "npm: watch",
          runType: "background",
          terminalInstanceId: 71,
          processId: 7171,
          stateSource: "taskRunner/activeExecutionMap",
        }),
      ],
    }))
    expect(snapshot.capabilities.extensionTaskProviderBridge).toEqual(expect.objectContaining({
      status: "partial",
      providerTaskCount: 1,
      taskProjection: true,
      rendererIpcConsumerConnected: true,
      terminalTaskSystemExecution: true,
      executionEvidence: expect.objectContaining({
        taskId: providerTask.id,
        providerType: "npm",
        terminalInstanceId: 71,
        processId: 7171,
        lastTerminalInstanceId: 71,
        lastProcessId: 7171,
        terminalOwnerCreated: true,
        activeExecutionMapped: true,
        stateSource: "taskRunner/TaskSystemLifecycleProjection",
      }),
    }))
    expect(globalCodekOutputService.getOutputSnapshot("Tasks")).toEqual(expect.objectContaining({
      stateSource: "outputLogTelemetryService",
      entryCount: 3,
      preview: expect.stringContaining("output: Starting compilation\nrunning npm run watch"),
    }))
    expect(globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot().output.channelDescriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "Tasks",
          entryCount: 3,
          stateSource: "outputLogTelemetryService",
        }),
      ]),
    )
    expect(snapshot.capabilities.blocked).toEqual(expect.not.arrayContaining([
      expect.objectContaining({
        capability: "extensionTaskProviderBridge",
      }),
    ]))
    expect(userTasksService.getContractSnapshot().providerBridge).toEqual(expect.objectContaining({
      stateSource: "userTasksService/extensionProviderProjection",
      terminalTaskSystemExecution: false,
    }))
  })

  it("resolves provider task terminal owner when runCommand returns a terminalManager instance id", async () => {
    userTasksService.markExtensionProviderRendererIpcConsumerConnected(true)
    userTasksService.replaceExtensionProviderTasks([{
      _id: "npm:watch-owner",
      name: "npm: watch owner",
      source: "npm",
      definition: { type: "npm", script: "watch-owner" },
      execution: { process: "npm", args: ["run", "watch-owner"] },
      isBackground: true,
      problemMatchers: [{
        id: "watch",
        owner: "typescript",
        source: "TypeScript",
        fileLocation: "relative",
        filePrefix: "D:/Workspace",
        pattern: {
          regexp: /^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/,
          file: 1,
          line: 2,
          column: 3,
          severity: 4,
          code: 5,
          message: 6,
        },
        background: {
          activeOnStart: true,
          beginsPattern: /Starting compilation/,
          endsPattern: /Watching for file changes/,
        },
      }],
    }])
    const providerTask = userTasksService.getTasks("extensionProvider")[0]
    const terminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
    attachPty(terminal.id, "pty-provider-owner", 3131)
    ;(globalThis as { codek?: unknown }).codek = {
      pty: {
        dispose: async () => true,
        onExit: () => () => {},
      },
    }

    await globalTaskService.runTask(providerTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async (task) => ({
        stdout: `Starting compilation\nrunning ${task.command}`,
        exitCode: 0,
        terminalInstanceId: terminal.instanceId,
        processId: 3131,
      }),
    })
    const snapshot = globalTaskService.getTaskSnapshot()

    expect(snapshot.capabilities).toEqual(expect.objectContaining({
      terminalOwnership: "available",
      supportsTerminateAll: true,
      supportsRestartActiveTerminal: true,
      terminalInstanceId: terminal.instanceId,
      processId: 3131,
      activeTerminalTaskOwner: expect.objectContaining({
        status: "activeResolved",
        taskId: providerTask.id,
        terminalInstanceId: terminal.instanceId,
        terminalOwnerResolved: true,
        supportsTerminate: true,
        supportsRerun: true,
        stateSource: "taskRunner/activeExecutionMap",
        currentOwner: "TaskWorkbenchAdapterService activeExecutionMap + terminalManager pty dispose/onExit owner",
      }),
    }))
    expect(snapshot.capabilities.extensionTaskProviderBridge).toEqual(expect.objectContaining({
      status: "connected",
      providerTaskCount: 1,
      rendererIpcConsumerConnected: true,
      terminalTaskSystemExecution: true,
      executionEvidence: expect.objectContaining({
        taskId: providerTask.id,
        providerType: "npm",
        terminalInstanceId: terminal.instanceId,
        processId: 3131,
        lastTerminalInstanceId: terminal.instanceId,
        lastProcessId: 3131,
        terminalOwnerCreated: true,
        activeExecutionMapped: true,
        terminalOwnerResolved: true,
        terminalTaskOwner: expect.objectContaining({
          status: "activeResolved",
          taskId: providerTask.id,
          terminalInstanceId: terminal.instanceId,
          terminalOwnerResolved: true,
          stateSource: "taskRunner/activeExecutionMap",
        }),
        blockedReason: "",
        missingOwner: "",
        stateSource: "taskRunner/TaskSystemLifecycleProjection",
      }),
    }))
    expect(snapshot.capabilities.blocked).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ capability: "extensionTaskProviderBridge" }),
      expect.objectContaining({ capability: "terminalOwnership" }),
    ]))
  })

  it("routes provider-backed terminal rerun and terminate-all actions through the shared task facade", async () => {
    userTasksService.markExtensionProviderRendererIpcConsumerConnected(true)
    userTasksService.replaceExtensionProviderTasks([{
      _id: "npm:watch-actions",
      name: "npm: watch actions",
      source: "npm",
      definition: { type: "npm", script: "watch-actions" },
      execution: { process: "npm", args: ["run", "watch-actions"] },
      isBackground: true,
      problemMatchers: [{
        id: "watch",
        owner: "typescript",
        source: "TypeScript",
        fileLocation: "relative",
        pattern: {
          regexp: /^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/,
          file: 1,
          line: 2,
          column: 3,
          severity: 4,
          code: 5,
          message: 6,
        },
        background: {
          activeOnStart: true,
          beginsPattern: /Starting compilation/,
          endsPattern: /Watching for file changes/,
        },
      }],
    }])
    const providerTask = userTasksService.getTasks("extensionProvider")[0]
    const firstTerminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
    attachPty(firstTerminal.id, "pty-provider-actions-1", 4141)
    const disposed: string[] = []
    let exitListener: ((event: { id: string; exitCode: number }) => void) | undefined
    ;(globalThis as { codek?: unknown }).codek = {
      pty: {
        dispose: async (ptyId: string) => {
          disposed.push(ptyId)
          exitListener?.({ id: ptyId, exitCode: 0 })
          return true
        },
        onExit: (listener: (event: { id: string; exitCode: number }) => void) => {
          exitListener = listener
          return () => {}
        },
      },
    }
    let runCount = 0

    registerTerminalDebugTaskWorkbenchContributions()
    await globalTaskService.runTask(providerTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async (task) => {
        runCount += 1
        if (runCount === 1) {
          return {
            stdout: `Starting compilation\nrunning ${task.command}`,
            exitCode: 0,
            terminalInstanceId: firstTerminal.instanceId,
            processId: 4141,
          }
        }
        const nextTerminal = globalTerminalService.createTerminal("powershell", "D:/Workspace")
        attachPty(nextTerminal.id, `pty-provider-actions-${runCount}`, 4140 + runCount)
        return {
          stdout: `Starting compilation\nrerun ${task.command}`,
          exitCode: 0,
          terminalInstanceId: nextTerminal.instanceId,
          processId: 4140 + runCount,
        }
      },
    })

    expect(globalTaskService.getTaskSnapshot().capabilities.extensionTaskProviderBridge.status).toBe("connected")
    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal, [firstTerminal.instanceId])

    let snapshot = globalTaskService.getTaskSnapshot()
    expect(runCount).toBe(2)
    expect(disposed).toEqual(["pty-provider-actions-1"])
    expect(snapshot.capabilities.extensionTaskProviderBridge).toEqual(expect.objectContaining({
      status: "connected",
      terminalTaskSystemExecution: true,
      executionEvidence: expect.objectContaining({
        taskId: providerTask.id,
        terminalOwnerResolved: true,
        activeExecutionMapped: true,
      }),
    }))
    expect(snapshot.capabilities.terminalTabActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRerunActiveTerminal,
        available: true,
      }),
      expect.objectContaining({
        id: TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll,
        available: true,
      }),
    ]))

    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksTerminateAll)
    snapshot = globalTaskService.getTaskSnapshot()
    expect(snapshot.lifecycle.activeExecutionCount).toBe(0)
    expect(snapshot.capabilities.supportsTerminateAll).toBe(false)
    expect(snapshot.capabilities.extensionTaskProviderBridge.status).toBe("connected")
  })

  it("tracks VS Code-style output channel descriptors from the same output channel store", () => {
    globalCodekOutputService.showChannel("Tasks")
    globalCodekOutputService.appendLine("Tasks", "task output")
    globalCodekOutputService.appendLine("Terminal", "terminal output")

    expect(globalCodekOutputService.getChannelDescriptor("Tasks")).toEqual(expect.objectContaining({
      id: "Tasks",
      label: "Tasks",
      viewId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Output,
      stateSource: "outputLogTelemetryService",
      entryCount: 1,
      user: false,
    }))
    expect(globalCodekOutputService.getChannelDescriptors().map((descriptor) => descriptor.id)).toEqual(expect.arrayContaining([
      "Tasks",
      "Terminal",
    ]))
    expect(globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot().output.channelDescriptors).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "Tasks", entryCount: 1 }),
      expect.objectContaining({ id: "Terminal", entryCount: 1 }),
    ]))
  })

  it("runs task problem matchers into the shared Problems marker projection", async () => {
    const taskWithMatcher: RunConfig = {
      ...sampleTask,
      id: "task-tsc",
      name: "Task: tsc",
      command: "npx tsc --noEmit",
      problemMatchers: resolveProblemMatchers("$tsc"),
    }
    addTaskConfig(taskWithMatcher)

    const evidence = await globalTaskService.runTask(taskWithMatcher.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({
        stdout: "src/main.ts(12,8): error TS2322: Type mismatch",
        exitCode: 0,
      }),
    })

    expect(evidence.status).toBe("passed")
    expect(evidence.steps).toEqual([
      expect.objectContaining({
        id: "task-tsc",
        name: "Task: tsc",
        command: "npx tsc --noEmit",
      }),
    ])
    expect(userTasksService.getContractSnapshot()).toEqual(expect.objectContaining({
      stateSource: TASK_CONFIG_STATE_SOURCE,
      taskDefinitions: [
        expect.objectContaining({
          id: "task-tsc",
          definition: expect.objectContaining({
            type: "custom",
            _key: "custom:task-tsc",
          }),
          execution: expect.objectContaining({
            id: "task-tsc",
            taskId: "task-tsc",
            command: "npx tsc --noEmit",
            workingDir: "${workspaceFolder}",
          }),
          configurationProperties: expect.objectContaining({
            identifier: "task-tsc",
            problemMatcherIds: ["$tsc"],
          }),
          problemMatcherRegistry: {
            source: "ProblemMatcherRegistry",
            matcherIds: ["$tsc"],
            matcherCount: 1,
            singleSource: true,
            vscodeOwner: "ProblemMatcherRegistry",
            currentOwner: "resolveProblemMatchers -> vscode-adapter/problemMatcher",
            registrySourcePath: "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts",
            vscodeSourcePath: "src/vs/workbench/contrib/tasks/common/problemMatcher.ts",
          },
        }),
      ],
      problemMatcherRegistry: {
        source: "ProblemMatcherRegistry",
        matcherIds: ["$tsc"],
        matcherCount: 1,
        singleSource: true,
        vscodeOwner: "ProblemMatcherRegistry",
        currentOwner: "resolveProblemMatchers -> vscode-adapter/problemMatcher",
        registrySourcePath: "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts",
        vscodeSourcePath: "src/vs/workbench/contrib/tasks/common/problemMatcher.ts",
      },
      migrationAudit: expect.objectContaining({
        stateSource: TASK_CONFIG_STATE_SOURCE,
        runtimeTaskSources: ["workspace", "profile", "extensionProvider"],
        debugRunConfigsUsage: "debug-only",
        debugRunConfigsInput: false,
        taskRunConfigFallback: false,
        configurationResolverOwner: "configurationResolverService/inputAndVariableResolution",
        userTasksOwner: "UserTasksService",
        problemMatcherOwner: "ProblemMatcherRegistry",
        profileTasksOwner: "IUserDataProfileService.currentProfile.tasksResource",
        blockers: [],
      }),
      constraints: expect.objectContaining({
        noSecondTaskState: true,
        problemMatcherRegistrySingleSource: true,
      }),
    }))
    expect(problemState.diagnostics).toEqual([
      expect.objectContaining({
        file: "src/main.ts",
        line: 12,
        column: 8,
        message: expect.stringContaining("Type mismatch"),
        severity: "error",
        source: "TypeScript",
        diagnosticSource: "compiler",
      }),
    ])
    expect(globalMarkerService.read({ owner: "compiler", ignoreResourceFilters: true })).toHaveLength(1)
    expect(globalTaskService.getTaskSnapshot().latestProblemProjection).toEqual({
      total: 1,
      files: ["src/main.ts"],
      matchedFiles: ["src/main.ts"],
      clearedFiles: [],
      taskIds: ["task-tsc"],
      stateSource: "problemsDiagnosticsService(globalMarkerService)",
      taskServiceOwner: "UserTasksService + TaskWorkbenchAdapterService",
      problemMatcherOwner: "ProblemMatcherRegistry",
      taskTerminalOwner: "TaskWorkbenchAdapterService taskRunner lifecycle",
      markerOwner: "globalMarkerService owner buckets (compiler/lint)",
      diagnosticSource: "taskProblems.applyTaskProblemDiagnostics -> compiler/lint",
      taskOutputSource: "taskRunner stdout/stderr command result",
      remainingUiOwnerGap: "Task terminal UI owner remains partial until TerminalTaskSystem/generic shell owner is wired",
      collectorOwner: "taskRunner command-output collector",
      registryOwner: "ProblemMatcherRegistry",
      vscodeOwner: "TerminalTaskSystem StartStopProblemCollector/WatchingProblemCollector + ProblemMatcherRegistry",
      currentOwner: "taskRunner command-output collector + taskProblems.applyTaskProblemDiagnostics + global marker lifecycle",
      vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
      currentSourcePath: "frontend/vite-project/src/workbench/taskRunner.ts",
      registrySourcePath: "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts",
      runtimeReference: false,
    })
    expect(globalTaskService.getTaskSnapshot().capabilities.ownershipAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: "problemMatcher",
        status: "available",
        currentOwner: "taskRunner command-output collector + taskProblems.applyTaskProblemDiagnostics + global marker lifecycle",
        missingOwner: "",
      }),
    ]))
    expect(globalTaskService.getTaskSnapshot().capabilities.terminalServiceLifecycle).toEqual(expect.objectContaining({
      status: "partial",
      tabActions: expect.objectContaining({
        status: "partial",
        ownerConnected: false,
        currentOwner: "TaskWorkbenchAdapterService terminalTabActions command projection",
        missingOwner: "terminal tab action command projection",
      }),
    }))
    expect(buildProblemsWorkbenchSnapshot()).toEqual(expect.objectContaining({
      diagnosticCount: 1,
      errorCount: 1,
      sourceNames: ["TypeScript"],
    }))
  })

  it("clears stale task problem markers when the next task run has no matches", async () => {
    const taskWithMatcher: RunConfig = {
      ...sampleTask,
      id: "task-tsc-clean",
      name: "Task: tsc clean",
      command: "npx tsc --noEmit",
      problemMatchers: resolveProblemMatchers("$tsc"),
    }
    addTaskConfig(taskWithMatcher)

    await globalTaskService.runTask(taskWithMatcher.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({
        stdout: "src/main.ts(12,8): error TS2322: Type mismatch",
        exitCode: 0,
      }),
    })
    expect(globalMarkerService.read({ owner: "compiler", ignoreResourceFilters: true })).toHaveLength(1)

    await globalTaskService.runTask(taskWithMatcher.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({
        stdout: "Found 0 errors. Watching for file changes.",
        exitCode: 0,
      }),
    })

    expect(globalMarkerService.read({ owner: "compiler", ignoreResourceFilters: true })).toHaveLength(0)
    expect(globalTaskService.getTaskSnapshot().latestProblemProjection).toEqual({
      total: 0,
      files: [],
      matchedFiles: [],
      clearedFiles: ["src/main.ts"],
      taskIds: ["task-tsc-clean"],
      stateSource: "problemsDiagnosticsService(globalMarkerService)",
      taskServiceOwner: "UserTasksService + TaskWorkbenchAdapterService",
      problemMatcherOwner: "ProblemMatcherRegistry",
      taskTerminalOwner: "TaskWorkbenchAdapterService taskRunner lifecycle",
      markerOwner: "globalMarkerService owner buckets (compiler/lint)",
      diagnosticSource: "taskProblems.applyTaskProblemDiagnostics -> compiler/lint",
      taskOutputSource: "taskRunner stdout/stderr command result",
      remainingUiOwnerGap: "Task terminal UI owner remains partial until TerminalTaskSystem/generic shell owner is wired",
      collectorOwner: "taskRunner command-output collector",
      registryOwner: "ProblemMatcherRegistry",
      vscodeOwner: "TerminalTaskSystem StartStopProblemCollector/WatchingProblemCollector + ProblemMatcherRegistry",
      currentOwner: "taskRunner command-output collector + taskProblems.applyTaskProblemDiagnostics + global marker lifecycle",
      vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
      currentSourcePath: "frontend/vite-project/src/workbench/taskRunner.ts",
      registrySourcePath: "frontend/vite-project/src/vscode-adapter/workbench/contrib/tasks/common/problemMatcher.ts",
      runtimeReference: false,
    })
    expect(buildProblemsWorkbenchSnapshot()).toEqual(expect.objectContaining({
      diagnosticCount: 0,
      errorCount: 0,
    }))
  })

  it("runs Debug start and stop through an injectable runtime while projecting into debugState", async () => {
    const events: string[] = []
    debugState.runConfigs.push(sampleTask)
    debugState.activeConfigId.value = sampleTask.id
    globalDebugService.setRuntime({
      start: async (config) => {
        events.push(`start:${config?.id}`)
        return {
          sessionId: "runtime-session-1",
          paused: true,
          consoleOutput: "runtime started",
          stackFrames: [{ id: 1, name: "main", file: "src/main.ts", line: 1, column: 1 }],
          variables: [{ name: "answer", value: "42", type: "number" }],
        }
      },
      stop: async (sessionId) => {
        events.push(`stop:${sessionId}`)
        return { consoleOutput: "runtime stopped" }
      },
    })

    registerTerminalDebugTaskWorkbenchContributions()
    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugStart, [sampleTask.id])

    expect(events).toEqual(["start:task-build"])
    expect(debugState.sessionId.value).toBe("runtime-session-1")
    expect(debugState.paused.value).toBe(true)
    expect(debugState.stackFrames.value).toEqual([
      expect.objectContaining({ id: 1, name: "main" }),
    ])
    expect(debugState.consoleOutput.value.map((entry) => entry.text)).toEqual(expect.arrayContaining([
      "runtime started",
    ]))
    expect(globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot().debug).toEqual(expect.objectContaining({
      isRunning: true,
      paused: true,
      runtime: "debugRuntime",
      stateSource: "debugState/debugRuntime",
    }))

    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugStop)

    expect(events).toEqual(["start:task-build", "stop:runtime-session-1"])
    expect(debugState.isRunning.value).toBe(false)
    expect(debugState.sessionId.value).toBeNull()
    expect(debugState.consoleOutput.value.map((entry) => entry.text)).toEqual(expect.arrayContaining([
      "runtime stopped",
    ]))
  })

  it("routes default Debug workbench commands through the shared debug manager runtime", async () => {
    debugState.runConfigs.push(sampleTask)
    debugState.activeConfigId.value = sampleTask.id
    debugManagerMock.startSession.mockImplementation(async (config: RunConfig) => {
      debugState.sessionId.value = "shared-runtime-session"
      debugState.isRunning.value = true
      debugState.paused.value = false
      debugState.consoleOutput.value.push({
        id: "shared-debug-start",
        type: "system",
        text: `started:${config.id}`,
        timestamp: 1,
      })
    })
    debugManagerMock.stopSession.mockImplementation(async () => {
      debugState.isRunning.value = false
      debugState.sessionId.value = null
      debugState.consoleOutput.value.push({
        id: "shared-debug-stop",
        type: "system",
        text: "stopped:shared-runtime-session",
        timestamp: 2,
      })
    })

    registerTerminalDebugTaskWorkbenchContributions()

    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugStart, [sampleTask.id])

    expect(debugManagerMock.startSession).toHaveBeenCalledWith(expect.objectContaining({
      id: sampleTask.id,
      command: sampleTask.command,
    }))
    expect(globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot().debug).toEqual(expect.objectContaining({
      runtime: "debugRuntime",
      stateSource: "debugState/debugRuntime",
      sessionId: "shared-runtime-session",
      isRunning: true,
    }))

    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugStop)

    expect(debugManagerMock.stopSession).toHaveBeenCalledTimes(1)
    expect(globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot().debug).toEqual(expect.objectContaining({
      runtime: "debugRuntime",
      stateSource: "debugState/debugRuntime",
      sessionId: "",
      isRunning: false,
    }))
  })

  it("builds terminal, debug, task and problems evidence from existing state sources", async () => {
    registerTerminalDebugTaskWorkbenchContributions()
    const terminal = createTerminal("powershell", "D:/Workspace")
    addTaskConfig(sampleTask)
    debugState.isRunning.value = true
    debugState.sessionId.value = "debug-session-1"
    debugState.consoleOutput.value.push({ id: "debug-1", type: "system", text: "debug started", timestamp: 1 })
    problemState.addDiagnostics([{
      file: "src/app.ts",
      line: 3,
      column: 2,
      message: "Example warning",
      severity: "warning",
      diagnosticSource: "lint",
    }])

    const taskEvidence = await globalTaskService.runTask(sampleTask.id, {
      workspaceFolder: "D:/Workspace",
      runCommand: async () => ({ stdout: "ok", exitCode: 0 }),
    })

    expect(buildTerminalWorkbenchEvidence()).toEqual(expect.objectContaining({
      serviceId: "terminalService",
      terminalCount: 1,
      activeTerminalId: terminal.id,
      stateSource: "terminalManager",
    }))
    expect(buildDebugSessionEvidence()).toEqual(expect.objectContaining({
      serviceId: "debugService",
      sessionId: "debug-session-1",
      isRunning: true,
      stateSource: "debugState",
      runConfigCount: 0,
    }))
    expect(taskEvidence.status).toBe("passed")
    expect(taskEvidence.steps[0]).toEqual(expect.objectContaining({
      id: sampleTask.id,
      status: "passed",
      outputPreview: "ok",
    }))
    expect(buildProblemsWorkbenchSnapshot()).toEqual(expect.objectContaining({
      viewId: TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems,
      stateSource: "problemsDiagnosticsService(globalMarkerService)",
      diagnosticCount: 1,
      warningCount: 1,
    }))

    const snapshot = globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot()
    expect(snapshot.vscodeServiceIds).toEqual(expect.arrayContaining([
      "terminalService",
      "outputService",
      "debugService",
      "taskService",
      "problemsWorkbenchService",
      "paneCompositePartService",
    ]))
    expect(snapshot.viewIds).toEqual(expect.arrayContaining([
      DEBUG_WORKBENCH_VIEW_IDS.Watch,
      TASK_WORKBENCH_VIEW_IDS.ProblemMatchers,
    ]))
    expect(snapshot.commandIds).toEqual(expect.arrayContaining(Object.values(TERMINAL_DEBUG_TASK_COMMAND_IDS)))
    expect(snapshot.constraints).toEqual(expect.objectContaining({
      noSecondTerminalState: true,
      noSecondOutputState: true,
      noSecondTaskState: true,
      problemsReadOnlyBridge: true,
    }))
    expect(snapshot.tasks.stateSource).toBe(TASK_CONFIG_STATE_SOURCE)
    expect(userTasksService.getContractSnapshot().migrationAudit).toEqual(expect.objectContaining({
      stateSource: TASK_CONFIG_STATE_SOURCE,
      debugRunConfigsUsage: "debug-only",
      debugRunConfigsInput: false,
      taskRunConfigFallback: false,
      blockers: [],
    }))
  })

  it("cleans contribution registrations without clearing underlying state sources", () => {
    const disposable = registerTerminalDebugTaskWorkbenchContributions()
    createTerminal("powershell", "D:/Workspace")
    globalCodekOutputService.appendLine("Workbench", "kept")

    disposable.dispose()

    expect(getCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalToggle)).toBeNull()
    expect(getOutputChannel("Workbench").getEntries()).toHaveLength(1)
    expect(buildTerminalWorkbenchEvidence().terminalCount).toBe(1)
  })

  it("can be instantiated as a scoped facade for focused tests", () => {
    const service = new TerminalDebugTaskWorkbenchService({
      terminalService: globalTerminalService,
      outputService: globalCodekOutputService,
      debugService: globalDebugService,
      taskService: globalTaskService,
      problemsService: globalProblemsWorkbenchService,
      paneCompositePartService: globalPaneCompositePartService,
    })

    const snapshot = service.getSurfaceSnapshot()
    expect(snapshot.serviceId).toBe("terminalDebugTaskWorkbenchService")
    expect(snapshot.vscodeServiceIds).toEqual(expect.arrayContaining([
      "terminalService",
      "outputService",
      "debugService",
      "taskService",
      "problemsWorkbenchService",
      "paneCompositePartService",
    ]))
  })

  it("updates Problems from real Monaco diagnostics through MarkerService and command bridge", async () => {
    const marker = {
      startLineNumber: 7,
      startColumn: 4,
      endLineNumber: 7,
      endColumn: 12,
      message: "Unexpected token from Monaco",
      severity: 8,
      source: "typescript",
    }
    const monaco = {
      Range: class Range {
        constructor(
          public startLineNumber: number,
          public startColumn: number,
          public endLineNumber: number,
          public endColumn: number,
        ) {}
      },
      editor: {
        OverviewRulerLane: { Right: 7 },
        getModelMarkers: () => [marker],
        onDidChangeMarkers: (callback: () => void) => {
          callback()
          return { dispose: () => undefined }
        },
      },
    }
    const editor = {
      getModel: () => ({ uri: "file://src/App.vue" }),
      deltaDecorations: () => [],
    }
    const opened: string[] = []

    registerTerminalDebugTaskWorkbenchContributions({
      openProblems: async (id) => { opened.push(id) },
    })

    installEditorMarkerSync({
      editor,
      monaco,
      getActiveFile: () => "src/App.vue",
      problemState,
      getScrollbarDecorations: () => [],
      setScrollbarDecorations: () => undefined,
    })

    expect(globalMarkerService.read({ owner: "monaco" }).map((candidate) => candidate.message)).toEqual([
      "Unexpected token from Monaco",
    ])
    await flushMarkerService()
    expect(problemState.diagnostics).toEqual([
      expect.objectContaining({
        file: "src/App.vue",
        line: 7,
        column: 4,
        severity: "error",
        diagnosticSource: "monaco",
      }),
    ])

    const problemsViewModel = createProblemMarkersViewModel(problemState.diagnostics)
    expect(problemsViewModel.sourceGroups.map((group) => group.source)).toEqual(["monaco"])
    expect(problemsViewModel.sourceGroups[0]?.fileGroups[0]?.items[0]?.message).toBe("Unexpected token from Monaco")

    const snapshot = buildProblemsWorkbenchSnapshot()
    expect(snapshot).toEqual(expect.objectContaining({
      stateSource: "problemsDiagnosticsService(globalMarkerService)",
      diagnosticCount: 1,
      errorCount: 1,
      sourceNames: ["typescript"],
    }))

    await executeCommand(TERMINAL_DEBUG_TASK_COMMAND_IDS.ProblemsToggle)
    expect(opened).toEqual([TERMINAL_DEBUG_TASK_WORKBENCH_VIEW_IDS.Problems])
    expect(globalPaneCompositePartService.getEvidence()).toEqual(expect.objectContaining({
      problemsOpened: true,
    }))
  })

  it("builds the Problems snapshot from MarkerService before the compatibility outlet refreshes", async () => {
    globalMarkerService.changeOne("compiler", URI.from({ scheme: "codek", path: "/src/snapshot-only.ts" }), [
      { startLineNumber: 11, startColumn: 5, message: "snapshot-only marker", severity: "error", source: "tsc" },
    ])

    expect(problemState.diagnostics).toEqual([])

    const snapshot = buildProblemsWorkbenchSnapshot()
    expect(snapshot).toEqual(expect.objectContaining({
      stateSource: "problemsDiagnosticsService(globalMarkerService)",
      diagnosticCount: 1,
      errorCount: 1,
      sourceNames: ["tsc"],
    }))
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        file: "src/snapshot-only.ts",
        line: 11,
        column: 5,
        message: "snapshot-only marker",
        diagnosticSource: "compiler",
      }),
    ])

    await flushMarkerService()
  })
})
