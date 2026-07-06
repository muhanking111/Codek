type CleanupResource = (() => void) | { cancel?: () => void; disconnect?: () => void; dispose?: () => void } | null | undefined
type WorkbenchContributionRegistryCleanup = { dispose: (options?: { reason?: string }) => { errors?: unknown[] } | void } | null | undefined

export interface DisposeWorkbenchResourcesInput {
  workbenchContributionRegistry?: WorkbenchContributionRegistryCleanup
  removeWorkbenchKeybindings?: CleanupResource
  removeWorkbenchLayoutActions?: CleanupResource
  removeWindowBlurListener?: CleanupResource
  stopWorkspaceAiRuntime?: CleanupResource
  ollamaTimer?: ReturnType<typeof setTimeout> | number | null
  autosaveTimer?: ReturnType<typeof setTimeout> | number | null
  analysisTimer?: ReturnType<typeof setTimeout> | number | null
  fileOperationRefreshScheduler?: CleanupResource
  unsubscribeEditorSettings?: CleanupResource
  removeFsChangeListener?: CleanupResource
  removeOpenGoalListener?: CleanupResource
  removeUserDataProfileChangeListener?: CleanupResource
  userSettingsFileBridge?: CleanupResource
  removeSmokeOpenProjectPathListener?: CleanupResource
  removeSmokeAnalysisBridge?: CleanupResource
  removeSmokeExplorerPerformanceBridge?: CleanupResource
  removeFileOperationEventBridge?: CleanupResource
  removeWindowCloseLifecycleListener?: CleanupResource
  collabSession?: { value?: { disconnect?: () => void } | null }
  clearIntervalFn?: (timer: ReturnType<typeof setTimeout> | number) => void
  clearTimeoutFn?: (timer: ReturnType<typeof setTimeout> | number) => void
  setRemoveWorkbenchKeybindings?: (value: null) => void
  setRemoveWorkbenchLayoutActions?: (value: null) => void
  setFileOperationRefreshScheduler?: (value: null) => void
  setUnsubscribeEditorSettings?: (value: null) => void
  setRemoveFileOperationEventBridge?: (value: null) => void
  setRemoveWindowCloseLifecycleListener?: (value: null) => void
}

export interface DisposeWorkbenchResourcesResult {
  errors: unknown[]
}

export function disposeWorkbenchResources(input: DisposeWorkbenchResourcesInput): DisposeWorkbenchResourcesResult {
  const errors: unknown[] = []
  const clearIntervalFn = input.clearIntervalFn || clearInterval
  const clearTimeoutFn = input.clearTimeoutFn || clearTimeout

  disposeWorkbenchContributionRegistry(input.workbenchContributionRegistry, errors)
  disposeSafely(input.removeWorkbenchKeybindings, errors)
  input.setRemoveWorkbenchKeybindings?.(null)
  disposeSafely(input.removeWorkbenchLayoutActions, errors)
  input.setRemoveWorkbenchLayoutActions?.(null)
  disposeSafely(input.removeWindowBlurListener, errors)
  disposeSafely(input.stopWorkspaceAiRuntime, errors)
  clearTimer(input.ollamaTimer, clearIntervalFn, errors)
  clearTimer(input.autosaveTimer, clearTimeoutFn, errors)
  clearTimer(input.analysisTimer, clearTimeoutFn, errors)
  disposeSafely(input.fileOperationRefreshScheduler, errors, "cancel")
  input.setFileOperationRefreshScheduler?.(null)
  disposeSafely(input.unsubscribeEditorSettings, errors)
  input.setUnsubscribeEditorSettings?.(null)
  disposeSafely(input.removeFsChangeListener, errors)
  disposeSafely(input.removeOpenGoalListener, errors)
  disposeSafely(input.removeUserDataProfileChangeListener, errors)
  disposeSafely(input.userSettingsFileBridge, errors)
  disposeSafely(input.removeSmokeOpenProjectPathListener, errors)
  disposeSafely(input.removeSmokeAnalysisBridge, errors)
  disposeSafely(input.removeSmokeExplorerPerformanceBridge, errors)
  disposeSafely(input.removeFileOperationEventBridge, errors)
  input.setRemoveFileOperationEventBridge?.(null)
  disposeSafely(input.removeWindowCloseLifecycleListener, errors)
  input.setRemoveWindowCloseLifecycleListener?.(null)

  try {
    input.collabSession?.value?.disconnect?.()
    if (input.collabSession) input.collabSession.value = null
  } catch (error) {
    errors.push(error)
  }

  return { errors }
}

function disposeWorkbenchContributionRegistry(resource: WorkbenchContributionRegistryCleanup, errors: unknown[]): void {
  if (!resource) return
  try {
    const result = resource.dispose({ reason: "workbench-resource-lifecycle" })
    if (result) {
      for (const error of result.errors ?? []) errors.push(error)
    }
  } catch (error) {
    errors.push(error)
  }
}

function disposeSafely(resource: CleanupResource, errors: unknown[], preferredMethod?: "cancel" | "disconnect" | "dispose"): void {
  if (!resource) return
  try {
    if (typeof resource === "function") {
      resource()
      return
    }
    if (preferredMethod && typeof resource[preferredMethod] === "function") {
      resource[preferredMethod]?.()
      return
    }
    resource.dispose?.()
    resource.cancel?.()
    resource.disconnect?.()
  } catch (error) {
    errors.push(error)
  }
}

function clearTimer(
  timer: ReturnType<typeof setTimeout> | number | null | undefined,
  clearFn: (timer: ReturnType<typeof setTimeout> | number) => void,
  errors: unknown[],
): void {
  if (!timer) return
  try {
    clearFn(timer)
  } catch (error) {
    errors.push(error)
  }
}
