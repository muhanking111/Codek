import { beforeEach, describe, expect, it } from "vitest"
import {
  applyProfileRunConfigsFromResource,
  addWatch,
  debugSessionService,
  debugState,
  debugWorkbenchModel,
  getDebugOwnerEvidenceProjection,
  getDebugServiceContractSnapshot,
  mergeProfileRunConfigs,
  mergeWorkspaceRunConfigs,
  runConfigs,
  selectFrame,
  setDebugModelProjection,
  toggleBreakpoint,
  updateDebugExternalEvidenceMetadata,
} from "./debugState"
import type { RunConfig, VariableNode } from "./debugState"

function config(id: string, name = id, source: RunConfig["source"] = "workspace"): RunConfig {
  return {
    id,
    name,
    type: "custom",
    command: `echo ${id}`,
    workingDir: "${workspaceFolder}",
    source,
  }
}

describe("debugState profile run configs", () => {
  beforeEach(() => {
    debugSessionService.stopSession("idle")
    debugState.breakpoints.value = []
    debugState.stackFrames.value = []
    debugState.variables.value = []
    debugState.watchEntries.value = []
    debugState.consoleOutput.value = []
    debugState.isRunning.value = false
    debugState.paused.value = false
    debugState.currentFrameId.value = null
    debugState.sessionId.value = null
    updateDebugExternalEvidenceMetadata({ dapEvidence: null, bridgeEvidence: null })
    runConfigs.splice(0, runConfigs.length)
    debugState.activeConfigId.value = ""
    localStorage.clear()
  })

  it("keeps profile tasks separate from workspace discovery and replaces old profile tasks", () => {
    mergeWorkspaceRunConfigs([config("task-build", "workspace build", "workspace")])
    const added = mergeProfileRunConfigs([
      config("task-build", "profile build", "profile"),
      config("task-profile-test", "profile test", "profile"),
    ])

    expect(added).toBe(2)
    expect(runConfigs.map((item) => `${item.source}:${item.id}:${item.name}`)).toEqual([
      "workspace:task-build:workspace build",
      "profile:profile-task-build:profile build",
      "profile:profile-task-profile-test:profile test",
    ])

    mergeProfileRunConfigs([config("task-profile-lint", "profile lint", "profile")])

    expect(runConfigs.map((item) => `${item.source}:${item.id}:${item.name}`)).toEqual([
      "workspace:task-build:workspace build",
      "profile:profile-task-profile-lint:profile lint",
    ])
  })

  it("applies VS Code profile tasks resource as profile-scoped run configs", () => {
    const added = applyProfileRunConfigsFromResource(JSON.stringify({
      tasks: JSON.stringify({
        tasks: [
          { label: "profile build", type: "shell", command: "npm", args: ["run", "build"] },
        ],
      }),
    }))

    expect(added).toBe(1)
    expect(runConfigs.map((item) => `${item.source}:${item.id}:${item.command}`)).toEqual([
      "profile:profile-task-profile-build:npm run build",
    ])

    expect(applyProfileRunConfigsFromResource(undefined)).toBe(0)
    expect(runConfigs).toHaveLength(0)
  })

  it("exposes a VS Code-style breakpoint registry backed by the existing debugState source", () => {
    const first = toggleBreakpoint("D:/Workspace/src/main.ts", 7, {
      condition: "answer === 42",
      hitCondition: "3",
      logMessage: "answer changed",
    })
    const second = toggleBreakpoint("D:/Workspace/src/main.ts", 9)
    toggleBreakpoint("D:/Workspace/src/other.ts", 1, { enabled: false })

    expect(first).toEqual(expect.objectContaining({
      file: "D:/Workspace/src/main.ts",
      line: 7,
      enabled: true,
      condition: "answer === 42",
      hitCondition: "3",
      logMessage: "answer changed",
      source: "debugState",
    }))
    expect(second).toEqual(expect.objectContaining({ line: 9, enabled: true }))
    expect(debugWorkbenchModel.getBreakpoints({ file: "D:/Workspace/src/main.ts" }).map((bp) => bp.line)).toEqual([7, 9])
    expect(debugWorkbenchModel.getBreakpointGroups()).toEqual([
      expect.objectContaining({
        file: "D:/Workspace/src/main.ts",
        enabledCount: 2,
        breakpoints: [
          expect.objectContaining({ line: 7 }),
          expect.objectContaining({ line: 9 }),
        ],
      }),
      expect.objectContaining({
        file: "D:/Workspace/src/other.ts",
        enabledCount: 0,
      }),
    ])

    debugWorkbenchModel.updateBreakpoint(first.id, { enabled: false, condition: "answer > 0" })
    expect(debugState.breakpoints.value.find((bp) => bp.id === first.id)).toEqual(expect.objectContaining({
      enabled: false,
      condition: "answer > 0",
    }))

    const removed = toggleBreakpoint("D:/Workspace/src/main.ts", 7)
    expect(removed).toBeNull()
    expect(debugWorkbenchModel.getBreakpoints({ file: "D:/Workspace/src/main.ts" }).map((bp) => bp.line)).toEqual([9])
  })

  it("projects debug session lifecycle, call stack, variables, and watch expressions through one model contract", () => {
    runConfigs.push(config("cfg-node", "Node", "workspace"))
    debugState.activeConfigId.value = "cfg-node"
    const variables: VariableNode[] = [{
      name: "局部变量",
      value: "{1 items}",
      type: "object",
      variablesReference: 101,
      children: [{ name: "answer", value: "42", type: "number", variablesReference: 0 }],
    }]

    debugSessionService.startSession({
      sessionId: "session-1",
      adapterType: "node",
      phase: "launching",
      threads: [{ id: 1, name: "主线程", stopped: false }],
      capabilities: { supportsConfigurationDoneRequest: true },
    })
    debugSessionService.pauseSession({
      threadId: 1,
      reason: "breakpoint",
      stackFrames: [{ id: 11, threadId: 1, name: "main", file: "D:/Workspace/src/main.ts", line: 7, column: 3 }],
      variables,
    })
    const watch = addWatch("answer")
    debugWorkbenchModel.updateWatchExpression(watch.id, {
      value: "42",
      type: "number",
      variablesReference: 0,
    })
    selectFrame(11)

    expect(debugWorkbenchModel.getSession()).toEqual(expect.objectContaining({
      sessionId: "session-1",
      adapterType: "node",
      phase: "paused",
      activeThreadId: 1,
      currentFrameId: 11,
      stoppedReason: "breakpoint",
    }))
    expect(debugWorkbenchModel.getCallStack()).toEqual([
      expect.objectContaining({
        id: 1,
        name: "主线程",
        stopped: true,
        frames: [expect.objectContaining({ id: 11, threadId: 1, name: "main" })],
      }),
    ])
    expect(debugWorkbenchModel.getVariables()).toEqual(variables)
    expect(debugWorkbenchModel.getWatchExpressions()).toEqual([
      expect.objectContaining({ expression: "answer", value: "42", type: "number" }),
    ])

    debugSessionService.continueSession({ allThreadsContinued: true })
    expect(debugWorkbenchModel.getSession()).toEqual(expect.objectContaining({ phase: "running", paused: false }))
    expect(debugWorkbenchModel.getCallStack()[0]?.frames).toEqual([])

    debugSessionService.stopSession("terminated")
    expect(debugWorkbenchModel.getSession()).toEqual(expect.objectContaining({
      phase: "terminated",
      isRunning: false,
      sessionId: null,
    }))
    expect(debugWorkbenchModel.getVariables()).toEqual([])
  })

  it("lets legacy projection updates delegate into the VS Code-style model", () => {
    setDebugModelProjection({
      session: {
        sessionId: "legacy-session",
        adapterType: "python",
        phase: "running",
        activeThreadId: 2,
        threads: [{ id: 2, name: "worker" }],
      },
      stackFrames: [{ id: 21, threadId: 2, name: "task", file: "worker.py", line: 3, column: 1 }],
      variables: [{ name: "status", value: "\"ok\"", type: "string", variablesReference: 0 }],
      watches: [{ expression: "status", value: "\"ok\"", type: "string", variablesReference: 0 }],
    })

    expect(debugState.sessionId.value).toBe("legacy-session")
    expect(debugState.stackFrames.value[0]).toEqual(expect.objectContaining({ threadId: 2 }))
    expect(debugState.variables.value[0]).toEqual(expect.objectContaining({ name: "status" }))
    expect(debugState.watchEntries.value[0]).toEqual(expect.objectContaining({ expression: "status", value: "\"ok\"" }))
    expect(debugWorkbenchModel.getCallStack()).toEqual([
      expect.objectContaining({ id: 2, frames: [expect.objectContaining({ id: 21 })] }),
    ])
  })

  it("projects metadata-only DAP and bridge evidence without adding a second debug state", () => {
    const ownerEvidence = updateDebugExternalEvidenceMetadata({
      dapEvidence: {
        source: "desktopDebugService",
        serviceId: "debugService",
        stateSource: "dapSessions",
        sessions: [{ sessionId: "dap-1", adapterId: "node", status: "running" }],
        constraints: { noSecondDapState: true },
      },
      bridgeEvidence: {
        source: "mainThreadDebugService",
        stateSource: "debugBridgeEvidence",
        debugTypes: ["node"],
        adapterFactories: [{ type: "node", handle: 7 }],
        configurationProviders: [{ type: "node", handle: 3 }],
      },
    })

    expect(ownerEvidence).toEqual(expect.objectContaining({
      source: "codek.debug.ownerEvidenceProjection",
      stateSource: "debugState",
      serviceConnected: true,
      bridgeConnected: true,
      dapEvidenceSource: "desktopDebugService/dapSessions",
      bridgeEvidenceSource: "mainThreadDebugService/debugBridgeEvidence",
      remainingUiGap: expect.stringContaining("Debug View Container UI"),
      debugServiceOwner: "DebugWorkbenchModel",
      breakpointModelOwner: "debugState.breakpoints",
      breakpointSource: "debugState",
      debugSessionOwner: "debugSessionService",
      viewOwner: "运行调试证据投影",
      resourceUriKind: "file-path-string",
      remainingUiOwnerGap: expect.arrayContaining([
        "Debug View Container / BreakpointsView owner 未在本后台线程接入",
        "App.vue/generic shell owner 未在本后台线程接入",
      ]),
      constraints: expect.objectContaining({
        noSecondDebugState: true,
        metadataOnlyEvidenceCannotConnectViewContainer: true,
      }),
    }))
    expect(ownerEvidence.callStack).toEqual(expect.objectContaining({
      area: "callStack",
      status: "partial",
      owner: "DebugWorkbenchModel.getCallStack",
      viewOwner: "Debug View Container UI owner",
      stateSource: "debugState",
      fallbackProjection: true,
      missingOwner: "Debug View Container UI owner",
      viewId: "workbench.debug.callStackView",
    }))
    expect(ownerEvidence.breakpoints.status).toBe("partial")
    expect(ownerEvidence.watch.status).toBe("partial")
    expect(ownerEvidence.variables.status).toBe("partial")

    const snapshot = getDebugServiceContractSnapshot()
    expect(snapshot.ownerEvidence).toEqual(ownerEvidence)
    expect(snapshot.constraints.noSecondDebugState).toBe(true)
    expect(debugState.externalEvidence.dapEvidence?.sessions).toHaveLength(1)
    expect(debugState.externalEvidence.bridgeEvidence?.adapterFactories).toHaveLength(1)
  })

  it("exposes stable Debug breakpoints owner evidence without starting a debug session", () => {
    const breakpoint = toggleBreakpoint("D:/Workspace/src/main.ts", 7, { verified: true })
    const ownerEvidence = getDebugOwnerEvidenceProjection()
    const snapshot = getDebugServiceContractSnapshot()

    expect(debugState.sessionId.value).toBeNull()
    expect(debugState.isRunning.value).toBe(false)
    expect(ownerEvidence.breakpointsOwnerEvidence).toEqual({
      debugServiceOwner: "DebugWorkbenchModel",
      breakpointModelOwner: "debugState.breakpoints",
      breakpointSource: "debugState",
      debugSessionOwner: "debugSessionService",
      viewOwner: "运行调试证据投影",
      resourceUriKind: "file-path-string",
      remainingUiOwnerGap: [
        "Debug View Container / BreakpointsView owner 未在本后台线程接入",
        "App.vue/generic shell owner 未在本后台线程接入",
      ],
      vscodeSourcePaths: {
        debugService: "src/vs/workbench/contrib/debug/browser/debugService.ts",
        debugModel: "src/vs/workbench/contrib/debug/common/debugModel.ts",
        breakpointsView: "src/vs/workbench/contrib/debug/browser/breakpointsView.ts",
        debugServiceInterface: "src/vs/workbench/contrib/debug/common/debug.ts",
      },
      currentSourcePath: "frontend/vite-project/src/components/debugState.ts",
      runtimeReference: false,
    })
    expect(ownerEvidence.breakpoints).toEqual(expect.objectContaining({
      area: "breakpoints",
      status: "connected",
      owner: "DebugWorkbenchModel.getBreakpoints",
      viewOwner: "DebugWorkbenchModel.getBreakpoints",
      stateSource: "debugState",
      itemCount: 1,
      runtimeReference: false,
    }))
    expect(snapshot.breakpoints.groups).toEqual([
      expect.objectContaining({
        file: "D:/Workspace/src/main.ts",
        breakpoints: [expect.objectContaining({ id: breakpoint!.id, source: "debugState" })],
      }),
    ])
    expect(snapshot.breakpoints.stateSource).toBe("debugState")
    expect(snapshot.ownerEvidence.breakpointsOwnerEvidence.breakpointModelOwner).toBe("debugState.breakpoints")
  })

  it("does not mark partial breakpoint UI owner as connected from metadata-only evidence", () => {
    toggleBreakpoint("D:/Workspace/src/main.ts", 7)

    const ownerEvidence = updateDebugExternalEvidenceMetadata({
      dapEvidence: {
        source: "desktopDebugService",
        serviceId: "debugService",
        stateSource: "dapSessions",
        sessions: [],
      },
    })

    expect(ownerEvidence.breakpoints).toEqual(expect.objectContaining({
      status: "partial",
      owner: "DebugWorkbenchModel.getBreakpoints",
      viewOwner: "Debug View Container UI owner",
      missingOwner: "Debug View Container UI owner",
      fallbackProjection: true,
      itemCount: 1,
    }))
    expect(ownerEvidence.breakpointsOwnerEvidence.remainingUiOwnerGap).toEqual(expect.arrayContaining([
      "Debug View Container / BreakpointsView owner 未在本后台线程接入",
    ]))
    expect(ownerEvidence.constraints.metadataOnlyEvidenceCannotConnectViewContainer).toBe(true)
  })

  it("keeps local call stack, breakpoints, watch, and variables connected through debugState owner projection", () => {
    updateDebugExternalEvidenceMetadata({ dapEvidence: null, bridgeEvidence: null })
    toggleBreakpoint("D:/Workspace/src/main.ts", 7)
    const watch = addWatch("answer")
    debugWorkbenchModel.updateWatchExpression(watch!.id, {
      value: "42",
      type: "number",
      variablesReference: 0,
    })
    debugSessionService.startSession({
      sessionId: "session-1",
      adapterType: "node",
      threads: [{ id: 1, name: "主线程", stopped: true }],
    })
    debugSessionService.pauseSession({
      threadId: 1,
      reason: "breakpoint",
      stackFrames: [{ id: 11, threadId: 1, name: "main", file: "D:/Workspace/src/main.ts", line: 7, column: 3 }],
      variables: [{ name: "局部变量", value: "{1 items}", type: "object", variablesReference: 101 }],
    })

    const ownerEvidence = getDebugOwnerEvidenceProjection()

    expect(ownerEvidence.callStack).toEqual(expect.objectContaining({
      status: "connected",
      fallbackProjection: false,
      missingOwner: "",
      itemCount: 1,
      stateSource: "debugState",
    }))
    expect(ownerEvidence.breakpoints).toEqual(expect.objectContaining({
      status: "connected",
      itemCount: 1,
      owner: "DebugWorkbenchModel.getBreakpoints",
    }))
    expect(ownerEvidence.watch).toEqual(expect.objectContaining({
      status: "connected",
      itemCount: 1,
      owner: "DebugWorkbenchModel.getWatchExpressions",
    }))
    expect(ownerEvidence.variables).toEqual(expect.objectContaining({
      status: "connected",
      itemCount: 1,
      owner: "DebugWorkbenchModel.getVariables",
    }))
    expect(ownerEvidence.constraints.noSecondDebugState).toBe(true)
  })
})
