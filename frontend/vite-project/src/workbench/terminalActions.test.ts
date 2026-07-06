import { describe, expect, it, vi } from "vitest"
import { resolveProblemMatchers } from "./problemMatcher"
import { runCommand, type TerminalActionContext, type TerminalEntry } from "./terminalActions"

function createContext(overrides: Partial<TerminalActionContext> = {}) {
  let entries: TerminalEntry[] = []
  let busy = false
  let terminalOpen = false
  const problemState = {
    addCompilerDiagnostics: vi.fn(),
    addLintDiagnostics: vi.fn(),
  }
  const context: TerminalActionContext = {
    getActiveFile: () => null,
    getSelectedText: () => "",
    getTerminalPanel: () => null,
    getTerminalBusy: () => busy,
    getEntries: () => entries,
    setEntries: (nextEntries) => {
      entries = nextEntries
    },
    setTerminalOpen: (open) => {
      terminalOpen = open
    },
    setTerminalBusy: (nextBusy) => {
      busy = nextBusy
    },
    openSettingsSection: vi.fn(),
    nextTick: async () => {},
    codek: {
      runCommand: vi.fn().mockResolvedValue({
        stdout: "src/main.ts(12,8): error TS2322: Type mismatch",
        stderr: "",
        exitCode: 1,
      }),
    },
    getRunConfigForCommand: () => ({
      id: "task-build",
      name: "Task: build",
      type: "custom",
      command: "npm run build",
      workingDir: "${workspaceFolder}",
      source: "workspace",
      problemMatchers: resolveProblemMatchers("$tsc"),
    }),
    problemState,
    getWorkspaceFolder: () => "D:/Workspace",
    ...overrides,
  }

  return {
    context,
    problemState,
    getEntries: () => entries,
    getBusy: () => busy,
    getTerminalOpen: () => terminalOpen,
  }
}

describe("terminalActions", () => {
  it("writes task problem matcher output into Problems after command completes", async () => {
    const harness = createContext()

    await runCommand("npm run build", harness.context)

    expect(harness.getTerminalOpen()).toBe(true)
    expect(harness.getBusy()).toBe(false)
    expect(harness.problemState.addCompilerDiagnostics).toHaveBeenCalledWith("src/main.ts", [
      expect.objectContaining({
        file: "src/main.ts",
        line: 12,
        column: 8,
        source: "TypeScript",
        diagnosticSource: "compiler",
      }),
    ])
    expect(harness.problemState.addLintDiagnostics).not.toHaveBeenCalled()
    expect(harness.getEntries()[0]).toMatchObject({
      command: "npm run build",
      running: false,
      exitCode: 1,
      error: true,
    })
  })

  it("does not write Problems for normal commands without problem matchers", async () => {
    const harness = createContext({
      getRunConfigForCommand: () => ({
        id: "custom-echo",
        name: "echo",
        type: "custom",
        command: "echo ok",
        workingDir: "${workspaceFolder}",
        source: "user",
      }),
    })

    await runCommand("echo ok", harness.context)

    expect(harness.problemState.addCompilerDiagnostics).not.toHaveBeenCalled()
    expect(harness.problemState.addLintDiagnostics).not.toHaveBeenCalled()
    expect(harness.getEntries()[0]).toMatchObject({
      command: "echo ok",
      running: false,
      exitCode: 1,
    })
  })

  it("runs task dependencies before the selected task", async () => {
    const runCommandMock = vi.fn()
      .mockResolvedValueOnce({ stdout: "clean", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "build", stderr: "", exitCode: 0 })
    const harness = createContext({
      codek: { runCommand: runCommandMock },
      getRunConfigs: () => [
        {
          id: "clean",
          name: "Task: clean",
          type: "custom",
          command: "npm run clean",
          workingDir: "${workspaceFolder}",
          source: "workspace",
        },
        {
          id: "build",
          name: "Task: build",
          type: "custom",
          command: "npm run build",
          workingDir: "${workspaceFolder}",
          source: "workspace",
          dependsOn: ["clean"],
        },
      ],
      getRunConfigForCommand: () => ({
        id: "build",
        name: "Task: build",
        type: "custom",
        command: "npm run build",
        workingDir: "${workspaceFolder}",
        source: "workspace",
        dependsOn: ["clean"],
      }),
    })

    await runCommand("npm run build", harness.context)

    expect(runCommandMock).toHaveBeenNthCalledWith(1, "npm run clean", {
      cwd: "D:/Workspace",
      env: undefined,
    })
    expect(runCommandMock).toHaveBeenNthCalledWith(2, "npm run build", {
      cwd: "D:/Workspace",
      env: undefined,
    })
    expect(harness.getEntries().map((entry) => [entry.command, entry.exitCode])).toEqual([
      ["npm run clean", 0],
      ["npm run build", 0],
    ])
  })

  it("emits task run evidence after a task plan completes", async () => {
    const onTaskRunEvidence = vi.fn()
    const harness = createContext({
      codek: {
        runCommand: vi.fn()
          .mockResolvedValueOnce({ stdout: "clean", stderr: "", exitCode: 0 })
          .mockResolvedValueOnce({ stdout: "build", stderr: "", exitCode: 0 }),
      },
      getRunConfigs: () => [
        {
          id: "clean",
          name: "Task: clean",
          type: "custom",
          command: "npm run clean",
          workingDir: "${workspaceFolder}",
          source: "workspace",
        },
        {
          id: "build",
          name: "Task: build",
          type: "custom",
          command: "npm run build",
          workingDir: "${workspaceFolder}",
          source: "workspace",
          dependsOn: ["clean"],
        },
      ],
      getRunConfigForCommand: () => ({
        id: "build",
        name: "Task: build",
        type: "custom",
        command: "npm run build",
        workingDir: "${workspaceFolder}",
        source: "workspace",
        dependsOn: ["clean"],
      }),
      onTaskRunEvidence,
    })

    await runCommand("npm run build", harness.context)

    expect(onTaskRunEvidence).toHaveBeenCalledWith(expect.objectContaining({
      id: "build",
      status: "passed",
      summary: "任务完成：2 个步骤全部通过",
    }))
  })
})
