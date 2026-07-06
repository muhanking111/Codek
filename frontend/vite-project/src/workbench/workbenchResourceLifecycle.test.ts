import { describe, expect, it, vi } from "vitest"
import { disposeWorkbenchResources } from "./workbenchResourceLifecycle"

describe("workbenchResourceLifecycle", () => {
  it("cleans window, timers, scheduler, subscriptions, bridges, and collab session", () => {
    const calls: string[] = []
    const collabSession = { value: { disconnect: vi.fn(() => calls.push("collab")) } }
    let removeWorkbenchKeybindings: unknown = () => calls.push("keybindings")
    let fileOperationRefreshScheduler: unknown = { cancel: vi.fn(() => calls.push("scheduler")) }
    let unsubscribeEditorSettings: unknown = () => calls.push("settings")
    let removeFileOperationEventBridge: unknown = () => calls.push("file-operation-bridge")
    const userSettingsFileBridge = { dispose: vi.fn(() => calls.push("settings-file-bridge")) }

    const result = disposeWorkbenchResources({
      removeWorkbenchKeybindings: removeWorkbenchKeybindings as any,
      removeWindowBlurListener: () => calls.push("window-blur"),
      stopWorkspaceAiRuntime: () => calls.push("workspace-ai"),
      ollamaTimer: 1,
      autosaveTimer: 2,
      analysisTimer: 3,
      fileOperationRefreshScheduler: fileOperationRefreshScheduler as any,
      unsubscribeEditorSettings: unsubscribeEditorSettings as any,
      removeFsChangeListener: () => calls.push("fs"),
      removeOpenGoalListener: () => calls.push("open-goal"),
      userSettingsFileBridge,
      removeSmokeOpenProjectPathListener: () => calls.push("smoke-project"),
      removeSmokeAnalysisBridge: () => calls.push("smoke-analysis"),
      removeSmokeExplorerPerformanceBridge: () => calls.push("smoke-explorer"),
      removeFileOperationEventBridge: removeFileOperationEventBridge as any,
      collabSession,
      clearIntervalFn: (timer) => calls.push(`interval:${timer}`),
      clearTimeoutFn: (timer) => calls.push(`timeout:${timer}`),
      setRemoveWorkbenchKeybindings: (value) => { removeWorkbenchKeybindings = value },
      setFileOperationRefreshScheduler: (value) => { fileOperationRefreshScheduler = value },
      setUnsubscribeEditorSettings: (value) => { unsubscribeEditorSettings = value },
      setRemoveFileOperationEventBridge: (value) => { removeFileOperationEventBridge = value },
    })

    expect(result.errors).toEqual([])
    expect(calls).toEqual([
      "keybindings",
      "window-blur",
      "workspace-ai",
      "interval:1",
      "timeout:2",
      "timeout:3",
      "scheduler",
      "settings",
      "fs",
      "open-goal",
      "settings-file-bridge",
      "smoke-project",
      "smoke-analysis",
      "smoke-explorer",
      "file-operation-bridge",
      "collab",
    ])
    expect(removeWorkbenchKeybindings).toBeNull()
    expect(fileOperationRefreshScheduler).toBeNull()
    expect(unsubscribeEditorSettings).toBeNull()
    expect(removeFileOperationEventBridge).toBeNull()
    expect(collabSession.value).toBeNull()
  })

  it("continues cleanup and reports errors when individual resources throw", () => {
    const calls: string[] = []
    const result = disposeWorkbenchResources({
      removeWorkbenchKeybindings: () => {
        throw new Error("keybindings failed")
      },
      stopWorkspaceAiRuntime: () => calls.push("workspace-ai"),
      fileOperationRefreshScheduler: {
        cancel() {
          throw new Error("scheduler failed")
        },
      },
      removeFsChangeListener: () => calls.push("fs"),
      collabSession: {
        value: {
          disconnect() {
            throw new Error("collab failed")
          },
        },
      },
    })

    expect(calls).toEqual(["workspace-ai", "fs"])
    expect(result.errors).toHaveLength(3)
  })
})
