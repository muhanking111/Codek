import { beforeEach, describe, expect, it, vi } from "vitest"
import { debugState, runConfigs } from "./debugState"
import type { RunConfig } from "./debugState"
import { sendInput, startDebug, stopDebug } from "./debugActions"

const debugManagerMock = vi.hoisted(() => ({
  startSession: vi.fn(),
  stopSession: vi.fn(),
  evaluate: vi.fn(),
}))

vi.mock("../debug/debugManager", () => ({
  getDebugManager: () => debugManagerMock,
}))

vi.mock("../workspace/manager.js", () => ({
  workspace: {
    workspaceRoots: ["D:/Workspace"],
    projectRoot: "D:/Workspace",
    activeFile: "D:/Workspace/src/main.ts",
  },
}))

const sampleConfig: RunConfig = {
  id: "cfg-node",
  name: "Node",
  type: "node",
  command: "node ${file}",
  workingDir: "${workspaceFolder}",
}

describe("debug actions", () => {
  beforeEach(() => {
    debugManagerMock.startSession.mockReset()
    debugManagerMock.stopSession.mockReset()
    debugManagerMock.evaluate.mockReset()
    runConfigs.splice(0, runConfigs.length, sampleConfig)
    debugState.activeConfigId.value = sampleConfig.id
    debugState.breakpoints.value = []
    debugState.stackFrames.value = []
    debugState.variables.value = []
    debugState.watchEntries.value = []
    debugState.consoleOutput.value = []
    debugState.isRunning.value = false
    debugState.paused.value = false
    debugState.currentFrameId.value = null
    debugState.sessionId.value = null
  })

  it("routes start/stop through the shared debug manager with resolved config", async () => {
    await startDebug()

    expect(debugManagerMock.startSession).toHaveBeenCalledWith(expect.objectContaining({
      id: "cfg-node",
      type: "node",
      workingDir: "D:/Workspace",
      command: "node D:/Workspace/src/main.ts",
    }))

    debugState.sessionId.value = "dap-session-1"
    debugState.isRunning.value = true
    await stopDebug()

    expect(debugManagerMock.stopSession).toHaveBeenCalledTimes(1)
  })

  it("routes debug console input through the shared REPL model instead of appending a second UI path", async () => {
    debugState.isRunning.value = true
    debugState.currentFrameId.value = 7
    debugManagerMock.evaluate.mockImplementation(async (expression: string) => {
      debugState.consoleOutput.value.push({ id: "repl-input", type: "input", text: expression, timestamp: 1 })
      debugState.consoleOutput.value.push({ id: "repl-result", type: "output", text: "42", timestamp: 2 })
      return "42"
    })

    await sendInput("answer")

    expect(debugManagerMock.evaluate).toHaveBeenCalledWith("answer", 7)
    expect(debugState.consoleOutput.value.map((entry) => `${entry.type}:${entry.text}`)).toEqual([
      "input:answer",
      "output:42",
    ])
  })
})
