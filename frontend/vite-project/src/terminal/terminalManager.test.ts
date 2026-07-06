import { describe, expect, it, beforeEach } from "vitest"
import {
  createTerminal,
  closeTerminal,
  getTerminalById,
  getVisibleTerminalIds,
  resetAll,
  splitTerminal,
  updateShellIntegration,
  getShellLabel,
  getShellTypes,
  getTerminalProfiles,
  createTerminalEnvironmentProjection,
  attachPty,
  markExited,
  recordTaskTerminalReuse,
  createTerminalContractProjection,
  getTaskTerminalReuseRegistrySnapshot,
  getTerminalByInstanceId,
  canTerminateTerminalByInstanceId,
  terminateTerminalByInstanceId,
  canReuseTaskTerminal,
  reuseTaskTerminalForLaunchConfig,
} from "./terminalManager"

describe("terminalManager split terminals", () => {
  beforeEach(() => {
    resetAll()
    delete (globalThis as { codek?: unknown }).codek
  })

  it("keeps split terminals visible in the active group", () => {
    const first = createTerminal("powershell", "D:/demo")
    const second = splitTerminal("powershell")

    expect(second.cwd).toBe("D:/demo")
    expect(second.groupId).toBe(first.groupId)
    expect(getVisibleTerminalIds()).toEqual([first.id, second.id])
  })

  it("stores shell integration command state without replacing the terminal instance", () => {
    const terminal = createTerminal("powershell", "D:/demo")

    updateShellIntegration(terminal.id, {
      available: true,
      cwd: "D:/demo/src",
      activeCommand: {
        id: "cmd-1",
        terminalId: terminal.id,
        commandLine: "npm test",
        cwd: "D:/demo/src",
        startedAt: 10,
        executedAt: 12,
        finishedAt: null,
        durationMs: null,
        exitCode: null,
        output: "",
        status: "running",
      },
    })

    expect(getTerminalById(terminal.id)).toMatchObject({
      cwd: "D:/demo/src",
      shellIntegrationAvailable: true,
      activeCommand: { commandLine: "npm test", status: "running" },
    })
  })

  it("exposes VS Code style terminal profiles", () => {
    expect(getShellTypes()).toEqual(["powershell", "cmd", "gitbash", "wsl", "bash", "zsh"])
    expect(getShellLabel("gitbash")).toBe("Git Bash")
    expect(getShellLabel("wsl")).toBe("WSL")
    expect(getTerminalProfiles()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "powershell", profileName: "PowerShell", isDefault: true }),
      expect.objectContaining({ id: "bash", path: "bash" }),
    ]))
  })

  it("projects VS Code style terminal environment without replacing the manager state", () => {
    const terminal = createTerminal("bash", "D:/demo")

    expect(terminal.profile.profileName).toBe("Bash")
    expect(terminal.environment).toEqual(expect.objectContaining({
      cwd: "D:/demo",
      source: "terminalProfileResolverService/terminalEnvironment",
    }))
    expect(terminal.environment.env).toEqual(expect.objectContaining({
      TERM_PROGRAM: "codek",
      COLORTERM: "truecolor",
      CODEK_TERMINAL_PROFILE: "bash",
    }))

    const strict = createTerminalEnvironmentProjection({
      shellType: "powershell",
      strictEnv: true,
      env: { KEEP: "yes", DROP: null },
    })
    expect(strict.strictEnv).toBe(true)
    expect(strict.env).toEqual(expect.objectContaining({
      KEEP: "yes",
      CODEK_TERMINAL_PROFILE: "powershell",
    }))
    expect(strict.env.DROP).toBeUndefined()
  })

  it("derives pty host, process lifecycle and command boundary from the terminal instance", () => {
    const terminal = createTerminal("powershell", "D:/Workspace")
    attachPty(terminal.id, "pty-1", 1234)
    updateShellIntegration(terminal.id, {
      available: true,
      activeCommand: {
        id: "cmd-1",
        terminalId: terminal.id,
        commandLine: "git status",
        cwd: "D:/Workspace",
        startedAt: 100,
        executedAt: 120,
        finishedAt: 160,
        durationMs: 60,
        exitCode: 0,
        output: "clean",
        status: "finished",
      },
      recentCommands: [{
        id: "cmd-1",
        terminalId: terminal.id,
        commandLine: "git status",
        cwd: "D:/Workspace",
        startedAt: 100,
        executedAt: 120,
        finishedAt: 160,
        durationMs: 60,
        exitCode: 0,
        output: "clean",
        status: "finished",
      }],
    })

    let projection = createTerminalContractProjection(getTerminalById(terminal.id)!, 200)
    expect(projection).toEqual(expect.objectContaining({
      terminalId: terminal.id,
      stateSource: "terminalManager",
      ptyHostBridge: expect.objectContaining({
        source: "ptyHostService/ptyHostBridge",
        ptyId: "pty-1",
        pid: 1234,
        status: "attached",
      }),
      processLifecycle: expect.objectContaining({
        source: "terminalProcessLifecycle",
        status: "running",
        uptimeMs: expect.any(Number),
      }),
      commandBoundary: expect.objectContaining({
        source: "terminalShellIntegration/evidenceSafeCommandBoundary",
        activeCommandLine: "git status",
        recentCommandCount: 1,
        lastCommandLine: "git status",
        lastExitCode: 0,
        writesGitIndex: false,
        requiresWorkspaceTrust: true,
      }),
    }))

    markExited(terminal.id, 2)
    projection = createTerminalContractProjection(getTerminalById(terminal.id)!, 300)
    expect(projection.ptyHostBridge.status).toBe("exited")
    expect(projection.processLifecycle).toEqual(expect.objectContaining({
      status: "exited",
      exitCode: 2,
    }))
  })

  it("keeps VS Code-style same and idle task terminal reuse registry in the terminal owner", () => {
    const dedicated = createTerminal("powershell", "D:/Workspace")
    attachPty(dedicated.id, "pty-dedicated", 3210)
    const shared = createTerminal("powershell", "D:/Workspace")
    markExited(shared.id, 0)

    recordTaskTerminalReuse({
      taskId: "task-build",
      taskName: "Task: build",
      terminalInstanceId: dedicated.instanceId,
      processId: 3210,
      runId: "run-1",
      executionId: "task-build:run-1",
      runType: "background",
      panelKind: "dedicated",
      eventType: "active",
    })
    recordTaskTerminalReuse({
      taskId: "task-test",
      taskName: "Task: test",
      terminalInstanceId: shared.instanceId,
      processId: null,
      runId: "run-2",
      executionId: "task-test:run-2",
      runType: "singleRun",
      panelKind: "shared",
      group: "build",
      eventType: "end",
    })

    const snapshot = getTaskTerminalReuseRegistrySnapshot()

    expect(snapshot).toEqual(expect.objectContaining({
      source: "TaskTerminalReuseRegistry",
      stateSource: "terminalManager/taskTerminalReuseRegistry",
      sameTaskCount: 1,
      idleTaskCount: 1,
      supportsPhysicalReuse: false,
      missingPhysicalReuseOwner: "terminal shell owner with reuseTerminal(launchConfigs)",
    }))
    expect(snapshot.sameTaskTerminals).toEqual([expect.objectContaining({
      taskId: "task-build",
      taskName: "Task: build",
      terminalId: dedicated.id,
      terminalInstanceId: dedicated.instanceId,
      ptyId: "pty-dedicated",
      pid: 3210,
      processId: 3210,
      status: "active",
      panelKind: "dedicated",
      ownerSource: "terminalManager",
    })])
    expect(snapshot.idleTaskTerminals).toEqual([expect.objectContaining({
      taskId: "task-test",
      taskName: "Task: test",
      terminalId: shared.id,
      terminalInstanceId: shared.instanceId,
      exitCode: 0,
      status: "idle",
      panelKind: "shared",
      group: "build",
      ownerSource: "terminalManager",
    })])
    expect(snapshot.constraints).toEqual({
      noSecondTaskState: true,
      noExternalVscodeSourceReference: true,
      runtimeReference: false,
    })
  })

  it("removes task terminal reuse registry entries when their terminal owner closes", () => {
    const terminal = createTerminal("powershell", "D:/Workspace")

    recordTaskTerminalReuse({
      taskId: "task-build",
      taskName: "Task: build",
      terminalInstanceId: terminal.instanceId,
      processId: null,
      runId: "run-1",
      executionId: "task-build:run-1",
      runType: "singleRun",
      panelKind: "shared",
      eventType: "end",
    })
    expect(getTaskTerminalReuseRegistrySnapshot().idleTaskCount).toBe(1)

    closeTerminal(terminal.id)

    expect(getTaskTerminalReuseRegistrySnapshot().idleTaskTerminals).toEqual([])
  })

  it("reuses an existing terminal for a VS Code-style task launch config without creating a second terminal", () => {
    const terminal = createTerminal("powershell", "D:/Workspace")
    attachPty(terminal.id, "pty-reuse-1", 2468)

    expect(canReuseTaskTerminal(terminal.instanceId)).toBe(true)

    const result = reuseTaskTerminalForLaunchConfig(terminal.instanceId, {
      taskId: "task-build",
      taskName: "Task: build",
      commandLine: "npm run build",
      cwd: "D:/Workspace/packages/app",
      group: "build",
      reuseKind: "sameTask",
      source: "TerminalTaskSystem.reuseTerminal(launchConfigs)",
    })

    expect(result).toEqual(expect.objectContaining({
      success: true,
      terminalId: terminal.id,
      terminalInstanceId: terminal.instanceId,
      taskId: "task-build",
      commandLine: "npm run build",
      cwd: "D:/Workspace/packages/app",
      group: "build",
      reuseKind: "sameTask",
      ptyId: "pty-reuse-1",
      pid: 2468,
      stateSource: "terminalManager/taskTerminalReuseOwner",
      vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
      runtimeReference: false,
    }))
    expect(getTerminalByInstanceId(terminal.instanceId)).toEqual(expect.objectContaining({
      id: terminal.id,
      cwd: "D:/Workspace/packages/app",
      ptyId: "pty-reuse-1",
      pid: 2468,
      lastTaskReuse: expect.objectContaining({
        taskId: "task-build",
        reuseKind: "sameTask",
      }),
    }))
  })

  it("moves a task terminal reuse record between pools without leaving stale task entries", () => {
    const first = createTerminal("powershell", "D:/Workspace")
    const second = createTerminal("powershell", "D:/Workspace")

    recordTaskTerminalReuse({
      taskId: "task-build",
      taskName: "Task: build",
      terminalInstanceId: first.instanceId,
      processId: null,
      runId: "run-1",
      executionId: "task-build:run-1",
      runType: "singleRun",
      panelKind: "shared",
      eventType: "end",
    })
    recordTaskTerminalReuse({
      taskId: "task-build",
      taskName: "Task: build",
      terminalInstanceId: second.instanceId,
      processId: null,
      runId: "run-2",
      executionId: "task-build:run-2",
      runType: "background",
      panelKind: "dedicated",
      eventType: "active",
    })

    const snapshot = getTaskTerminalReuseRegistrySnapshot()

    expect(snapshot.idleTaskTerminals).toEqual([])
    expect(snapshot.sameTaskTerminals).toEqual([expect.objectContaining({
      taskId: "task-build",
      terminalId: second.id,
      terminalInstanceId: second.instanceId,
    })])
  })

  it("terminates a terminal through the pty owner only after matching onExit resolves", async () => {
    const terminal = createTerminal("powershell", "D:/Workspace")
    attachPty(terminal.id, "pty-1", 1234)
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

    expect(getTerminalByInstanceId(terminal.instanceId)?.id).toBe(terminal.id)
    expect(canTerminateTerminalByInstanceId(terminal.instanceId)).toBe(true)

    const result = await terminateTerminalByInstanceId(terminal.instanceId)

    expect(disposed).toEqual(["pty-1"])
    expect(result).toEqual(expect.objectContaining({
      success: true,
      terminalId: terminal.id,
      terminalInstanceId: terminal.instanceId,
      ptyId: "pty-1",
      pid: 1234,
      exitCode: 143,
      stateSource: "terminalManager/terminalOwnerApi",
    }))
    expect(getTerminalByInstanceId(terminal.instanceId)).toBeNull()
  })
})
