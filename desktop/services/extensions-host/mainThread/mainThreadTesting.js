/**
 * MainThreadTesting - VS Code Testing API projection bridge.
 *
 * This adapter maps the Extension Host's MainThreadTesting RPC events into
 * renderer events consumed by Codek's TestingService facade. It deliberately
 * avoids claiming full VS Code TestService ownership while forwarding selected
 * execution and discovery callbacks back into ExtHostTesting.
 */

const { ExtHostContext } = require("../extHostServer")

const MAIN_THREAD_TESTING_NID = 71
const EXT_HOST_TESTING_NID = ExtHostContext.ExtHostTesting

const TestRunProfileGroup = {
  Run: 1,
  Debug: 2,
  Coverage: 4,
}

const TestResultState = {
  Queued: 1,
  Running: 2,
  Passed: 3,
  Failed: 4,
  Skipped: 5,
  Errored: 6,
}

const TestDiffOpType = {
  Add: 0,
  Update: 1,
  DocumentSynced: 2,
  Remove: 3,
  IncrementPendingExtHosts: 4,
  Retire: 5,
  AddTag: 6,
  RemoveTag: 7,
}

const TestItemExpandState = {
  NotExpandable: 0,
  Expandable: 1,
  BusyExpanding: 2,
  Expanded: 3,
}

let resolvedRunSequence = 0

function onRpc(server, method, handler) {
  server.onRpc(MAIN_THREAD_TESTING_NID, method, handler)
  server.onRpc(method, handler)
}

function getCallEh(server, opts = {}) {
  if (typeof opts.callEh === "function") return opts.callEh
  return (nid, method, args, timeoutMs, options) => server.call(nid, method, args, timeoutMs, options)
}

function registerIpcBackChannel(ipcMain, callEh) {
  if (!ipcMain || typeof ipcMain.on !== "function") return

  ipcMain.on("ext-host:testing-cancel", (_event, payload = {}) => {
    const runId = normalizeOptionalString(payload?.runId)
    const taskId = normalizeOptionalString(payload?.taskId)
    Promise.resolve(callEh(EXT_HOST_TESTING_NID, "$cancelExtensionTestRun", [runId, taskId], 30000)).catch(() => {})
  })

  ipcMain.on("ext-host:testing-configure-profile", (_event, payload = {}) => {
    const controllerId = normalizeOptionalString(payload?.controllerId)
    const profileId = normalizeNumber(payload?.profileId)
    if (!controllerId || profileId === undefined) return
    Promise.resolve(callEh(EXT_HOST_TESTING_NID, "$configureRunProfile", [controllerId, profileId], 30000)).catch(() => {})
  })

  if (typeof ipcMain.handle === "function") {
    ipcMain.handle("ext-host:testing-coverage-details", (_event, payload = {}) => {
      const coverageId = normalizeOptionalString(payload?.coverageId)
      if (!coverageId) return []
      return callEh(
        EXT_HOST_TESTING_NID,
        "$getCoverageDetails",
        [coverageId, normalizeOptionalString(payload?.testId)],
        30000,
        { usesCancellationToken: true },
      ).catch(() => [])
    })

    ipcMain.handle("ext-host:testing-provide-followups", (_event, payload = {}) => {
      const testId = normalizeOptionalString(payload?.testId)
      if (!testId) return []
      return callEh(
        EXT_HOST_TESTING_NID,
        "$provideTestFollowups",
        [{
          testId,
          message: payload?.message,
          resultId: normalizeOptionalString(payload?.resultId),
          taskId: normalizeOptionalString(payload?.taskId),
        }],
        30000,
        { usesCancellationToken: true },
      ).catch(() => [])
    })

    ipcMain.handle("ext-host:testing-execute-followup", (_event, payload = {}) => {
      const id = normalizeNumber(payload?.id)
      if (id === undefined) return false
      return callEh(EXT_HOST_TESTING_NID, "$executeTestFollowup", [id], 30000).then(() => true).catch(() => false)
    })

    ipcMain.handle("ext-host:testing-dispose-followups", (_event, payload = {}) => {
      const ids = Array.isArray(payload?.ids)
        ? payload.ids.map(normalizeNumber).filter((id) => id !== undefined)
        : []
      if (ids.length === 0) return false
      return callEh(EXT_HOST_TESTING_NID, "$disposeTestFollowups", [ids], 30000).then(() => true).catch(() => false)
    })

    ipcMain.handle("ext-host:testing-publish-results", (_event, payload = {}) => {
      const results = normalizePublishedResults(payload?.results)
      if (results.length === 0) return false
      return callEh(EXT_HOST_TESTING_NID, "$publishTestResults", [results], 30000).then(() => true).catch(() => false)
    })

    ipcMain.handle("ext-host:testing-sync-tests", () => {
      return callEh(EXT_HOST_TESTING_NID, "$syncTests", [], 30000, { usesCancellationToken: true }).then(() => true).catch(() => false)
    })

    ipcMain.handle("ext-host:testing-refresh-tests", (_event, payload = {}) => {
      const controllerId = normalizeOptionalString(payload?.controllerId)
      if (!controllerId) return false
      return callEh(EXT_HOST_TESTING_NID, "$refreshTests", [controllerId], 30000, { usesCancellationToken: true }).then(() => true).catch(() => false)
    })

    ipcMain.handle("ext-host:testing-expand-test", (_event, payload = {}) => {
      const testId = normalizeOptionalString(payload?.testId)
      if (!testId) return false
      const levels = normalizeNumber(payload?.levels)
      return callEh(EXT_HOST_TESTING_NID, "$expandTest", [testId, levels === undefined ? -1 : levels], 30000, { usesCancellationToken: true }).then(() => true).catch(() => false)
    })

    ipcMain.handle("ext-host:testing-code-related-to-test", (_event, payload = {}) => {
      const testId = normalizeOptionalString(payload?.testId)
      if (!testId) return []
      return callEh(EXT_HOST_TESTING_NID, "$getCodeRelatedToTest", [testId], 30000, { usesCancellationToken: true }).catch(() => [])
    })

    ipcMain.handle("ext-host:testing-tests-related-to-code", (_event, payload = {}) => {
      if (!payload?.uri || !payload?.position) return []
      return callEh(EXT_HOST_TESTING_NID, "$getTestsRelatedToCode", [payload.uri, payload.position], 30000, { usesCancellationToken: true }).catch(() => [])
    })
  }
}

function register(server, opts = {}) {
  const { ipcMain, sendToRenderer } = opts
  const callEh = getCallEh(server, opts)
  const knownItems = new Map()

  const emit = (channel, payload) => {
    if (sendToRenderer) sendToRenderer(channel, payload)
  }

  registerIpcBackChannel(ipcMain, callEh)

  onRpc(server, "$registerTestController", (args) => {
    const [controllerId, label, capabilities] = args || []
    if (!controllerId) return undefined
    emit("ext-host:testing-controller", {
      controllerId,
      label: String(label || controllerId),
      capabilities,
    })
    return undefined
  })

  onRpc(server, "$updateController", (args) => {
    const [controllerId, patch] = args || []
    if (!controllerId || !patch) return undefined
    emit("ext-host:testing-controller", {
      controllerId,
      label: patch.label,
      capabilities: patch.capabilities,
    })
    return undefined
  })

  onRpc(server, "$unregisterTestController", (args) => {
    const [controllerId] = args || []
    if (!controllerId) return undefined
    for (const id of [...knownItems.keys()]) {
      if (getControllerIdFromTestId(id) === controllerId) knownItems.delete(id)
    }
    emit("ext-host:testing-controller-remove", { controllerId })
    return undefined
  })

  onRpc(server, "$publishTestRunProfile", (args) => {
    const [profile] = args || []
    const normalized = normalizeProfile(profile)
    if (normalized) emit("ext-host:testing-profile", normalized)
    return undefined
  })

  onRpc(server, "$updateTestRunConfig", (args) => {
    const [controllerId, profileId, update] = args || []
    if (!controllerId || profileId === undefined) return undefined
    emit("ext-host:testing-profile-update", {
      controllerId,
      profileId,
      update: normalizeProfileUpdate(update),
    })
    return undefined
  })

  onRpc(server, "$removeTestProfile", (args) => {
    const [controllerId, profileId] = args || []
    if (!controllerId) return undefined
    emit("ext-host:testing-profile-remove", { controllerId, profileId })
    return undefined
  })

  onRpc(server, "$publishDiff", (args) => {
    const [controllerId, diff] = args || []
    if (!controllerId || !Array.isArray(diff)) return undefined
    for (const operation of diff) {
      if (!operation || typeof operation !== "object") continue
      if (operation.op === TestDiffOpType.Add) {
        const item = normalizeInternalTestItem(controllerId, operation.item)
        if (!item) continue
        knownItems.set(item.id, item)
        emit("ext-host:testing-item", item)
      } else if (operation.op === TestDiffOpType.Update) {
        const existing = knownItems.get(operation.item?.extId)
        const item = normalizeTestItemUpdate(controllerId, existing, operation.item)
        if (!item) continue
        knownItems.set(item.id, item)
        emit("ext-host:testing-item", item)
      } else if (operation.op === TestDiffOpType.Remove) {
        const itemId = operation.itemId
        if (!itemId) continue
        for (const knownId of [...knownItems.keys()]) {
          if (knownId === itemId || knownId.startsWith(`${itemId}\u0000`)) knownItems.delete(knownId)
        }
        emit("ext-host:testing-item-remove", { itemId })
      }
    }
    return undefined
  })

  onRpc(server, "$startedExtensionTestRun", (args) => {
    const [request] = args || []
    const run = normalizeRunRequest(request)
    if (run) emit("ext-host:testing-run-start", run)
    return undefined
  })

  onRpc(server, "$addTestsToRun", (args) => {
    const [controllerId, runId, tests] = args || []
    if (!controllerId || !runId || !Array.isArray(tests)) return undefined
    for (const serialized of tests) {
      const item = normalizeSerializedTestItem(controllerId, serialized)
      if (!item) continue
      knownItems.set(item.id, item)
      emit("ext-host:testing-item", item)
    }
    return undefined
  })

  onRpc(server, "$appendOutputToRun", (args) => {
    const [runId, _taskId, output, location, testId] = args || []
    if (!runId) return undefined
    emit("ext-host:testing-run-output", {
      runId,
      testId,
      message: decodeOutput(output),
      locationUri: toUriString(location?.uri),
    })
    return undefined
  })

  onRpc(server, "$appendTestMessagesInRun", (args) => {
    const [runId, _taskId, testId, messages] = args || []
    if (!runId || !testId) return undefined
    emit("ext-host:testing-run-state", {
      runId,
      testId,
      state: "running",
      durationMs: undefined,
      messages: normalizeMessages(messages),
    })
    return undefined
  })

  onRpc(server, "$updateTestStateInRun", (args) => {
    const [runId, _taskId, testId, state, durationMs] = args || []
    if (!runId || !testId) return undefined
    emit("ext-host:testing-run-state", {
      runId,
      testId,
      state: normalizeResultState(state),
      durationMs: normalizeNumber(durationMs),
      messages: [],
    })
    return undefined
  })

  onRpc(server, "$appendCoverage", (args) => {
    const [_runId, _taskId, coverage] = args || []
    const file = normalizeCoverageFile(coverage)
    if (file) emit("ext-host:testing-coverage", { files: [file] })
    return undefined
  })

  onRpc(server, "$finishedExtensionTestRun", (args) => {
    const [runId] = args || []
    if (runId) emit("ext-host:testing-run-complete", { runId })
    return undefined
  })

  onRpc(server, "$startedTestRunTask", (args) => {
    const [runId, task] = args || []
    if (!runId || !task?.id) return undefined
    emit("ext-host:testing-run-task-start", {
      runId,
      task: {
        id: String(task.id),
        controllerId: String(task.ctrlId || task.controllerId || ""),
        name: String(task.name || task.id),
        running: task.running !== false,
      },
    })
    return undefined
  })
  onRpc(server, "$finishedTestRunTask", (args) => {
    const [runId, taskId] = args || []
    if (runId && taskId) emit("ext-host:testing-run-task-finish", { runId, taskId })
    return undefined
  })
  onRpc(server, "$markTestRetired", (args) => {
    const [testIds] = args || []
    emit("ext-host:testing-retire", {
      testIds: Array.isArray(testIds)
        ? testIds.map(normalizeOptionalString).filter(Boolean)
        : undefined,
    })
    return undefined
  })
  onRpc(server, "$subscribeToDiffs", () => {
    Promise.resolve(callEh(EXT_HOST_TESTING_NID, "$syncTests", [], 30000, { usesCancellationToken: true })).catch(() => {})
    return undefined
  })
  onRpc(server, "$unsubscribeFromDiffs", () => undefined)
  onRpc(server, "$getCoverageDetails", () => [])
  onRpc(server, "$runTests", (args) => {
    const [request] = args || []
    const run = normalizeResolvedRunRequest(request)
    if (run) emit("ext-host:testing-run-start", run)
    const reqs = normalizeControllerRunRequests(request, run?.id)
    if (reqs.length > 0) {
      Promise.resolve(callEh(EXT_HOST_TESTING_NID, "$runControllerTests", [reqs], 30000, { usesCancellationToken: true })).catch(() => {})
    }
    return run?.id || undefined
  })

  onRpc(server, "$startContinuousRun", (args) => {
    const [request] = args || []
    const run = normalizeResolvedRunRequest({ ...request, continuous: true })
    if (run) emit("ext-host:testing-run-start", run)
    const reqs = normalizeControllerRunRequests(request, run?.id)
    if (reqs.length > 0) {
      Promise.resolve(callEh(EXT_HOST_TESTING_NID, "$startContinuousRun", [reqs], 30000, { usesCancellationToken: true })).catch(() => {})
    }
    return run?.id || undefined
  })
}

function normalizeProfile(profile) {
  if (!profile?.controllerId || profile.profileId === undefined) return null
  return {
    controllerId: profile.controllerId,
    profileId: Number(profile.profileId),
    label: String(profile.label || "Run"),
    group: normalizeProfileGroup(profile.group),
    isDefault: profile.isDefault === true,
    tag: profile.tag || undefined,
    configureCommandId: profile.hasConfigurationHandler ? "testing.configureProfile" : undefined,
  }
}

function normalizeProfileUpdate(update = {}) {
  const normalized = {}
  if ("label" in update) normalized.label = String(update.label || "")
  if ("group" in update) normalized.group = normalizeProfileGroup(update.group)
  if ("isDefault" in update) normalized.isDefault = update.isDefault === true
  if ("tag" in update) normalized.tag = update.tag || undefined
  if ("hasConfigurationHandler" in update) {
    normalized.configureCommandId = update.hasConfigurationHandler ? "testing.configureProfile" : undefined
  }
  return normalized
}

function normalizeInternalTestItem(controllerId, internal) {
  if (!internal?.item?.extId) return null
  return normalizeSerializedTestItem(controllerId, internal.item, internal.expand)
}

function normalizeSerializedTestItem(controllerId, serialized, expand) {
  if (!serialized?.extId) return null
  return {
    controllerId,
    id: serialized.extId,
    label: String(serialized.label || serialized.extId),
    parentId: getParentId(serialized.extId),
    uri: toUriString(serialized.uri),
    range: normalizeRange(serialized.range),
    tags: Array.isArray(serialized.tags) ? serialized.tags.filter((tag) => typeof tag === "string") : undefined,
    busy: serialized.busy === true,
    expand: normalizeExpandState(expand),
    description: serialized.description || undefined,
    error: normalizeError(serialized.error),
    sortText: serialized.sortText || undefined,
  }
}

function normalizeTestItemUpdate(controllerId, existing, update) {
  if (!update?.extId) return null
  const item = update.item || {}
  return {
    controllerId,
    id: update.extId,
    label: item.label !== undefined ? String(item.label || update.extId) : (existing?.label || update.extId),
    parentId: existing?.parentId || getParentId(update.extId),
    uri: item.uri !== undefined ? toUriString(item.uri) : existing?.uri,
    range: item.range !== undefined ? normalizeRange(item.range) : existing?.range,
    tags: item.tags !== undefined && Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === "string") : existing?.tags,
    busy: item.busy !== undefined ? item.busy === true : existing?.busy,
    expand: update.expand !== undefined ? normalizeExpandState(update.expand) : (existing?.expand || "notExpandable"),
    description: item.description !== undefined ? item.description || undefined : existing?.description,
    error: item.error !== undefined ? normalizeError(item.error) : existing?.error,
    sortText: item.sortText !== undefined ? item.sortText || undefined : existing?.sortText,
  }
}

function normalizeRunRequest(request) {
  if (!request?.id || !request.controllerId) return null
  return {
    id: request.id,
    controllerId: request.controllerId,
    profileId: request.profile?.id,
    group: normalizeProfileGroup(request.profile?.group),
    testIds: Array.isArray(request.include) ? request.include : [],
    excludeIds: Array.isArray(request.exclude) ? request.exclude : undefined,
    continuous: request.continuous === true,
    label: "Extension test run",
  }
}

function normalizeResolvedRunRequest(request) {
  const firstTarget = Array.isArray(request?.targets) ? request.targets[0] : undefined
  if (!firstTarget?.controllerId) return null
  return {
    id: createResolvedRunId(),
    controllerId: firstTarget.controllerId,
    profileId: firstTarget.profileId,
    group: normalizeProfileGroup(request.group),
    testIds: Array.isArray(firstTarget.testIds) ? firstTarget.testIds : [],
    excludeIds: Array.isArray(request.exclude) ? request.exclude : undefined,
    continuous: request.continuous === true,
    label: "Resolved extension test run",
  }
}

function createResolvedRunId() {
  resolvedRunSequence += 1
  return `run:${Date.now()}:${resolvedRunSequence}`
}

function normalizeControllerRunRequests(request, runId) {
  if (!request || !Array.isArray(request.targets)) return []
  return request.targets
    .map((target) => {
      const controllerId = normalizeOptionalString(target?.controllerId)
      const profileId = normalizeNumber(target?.profileId)
      if (!controllerId || profileId === undefined) return null
      const normalized = {
        controllerId,
        profileId,
        excludeExtIds: Array.isArray(request.exclude) ? request.exclude : [],
        testIds: Array.isArray(target.testIds) ? target.testIds : [],
      }
      if (runId) normalized.runId = runId
      return normalized
    })
    .filter(Boolean)
}

function normalizeCoverageFile(file) {
  if (!file?.id || !file.uri || !file.statement) return null
  return {
    id: file.id,
    uri: toUriString(file.uri),
    statement: file.statement,
    branch: file.branch,
    declaration: file.declaration,
    testIds: Array.isArray(file.testIds) ? file.testIds : undefined,
  }
}

function normalizeProfileGroup(group) {
  if (group === TestRunProfileGroup.Debug || group === "debug") return "debug"
  if (group === TestRunProfileGroup.Coverage || group === "coverage") return "coverage"
  return "run"
}

function normalizeResultState(state) {
  switch (state) {
    case TestResultState.Queued:
      return "queued"
    case TestResultState.Running:
      return "running"
    case TestResultState.Passed:
      return "passed"
    case TestResultState.Failed:
      return "failed"
    case TestResultState.Skipped:
      return "skipped"
    case TestResultState.Errored:
      return "errored"
    default:
      return "running"
  }
}

function normalizeExpandState(expand) {
  switch (expand) {
    case TestItemExpandState.Expandable:
      return "expandable"
    case TestItemExpandState.BusyExpanding:
      return "busyExpanding"
    case TestItemExpandState.Expanded:
      return "expanded"
    default:
      return "notExpandable"
  }
}

function normalizeRange(range) {
  if (!range || typeof range !== "object") return undefined
  const startLineNumber = normalizeNumber(range.startLineNumber)
  const startColumn = normalizeNumber(range.startColumn)
  const endLineNumber = normalizeNumber(range.endLineNumber)
  const endColumn = normalizeNumber(range.endColumn)
  if ([startLineNumber, startColumn, endLineNumber, endColumn].some((value) => value === undefined)) return undefined
  return { startLineNumber, startColumn, endLineNumber, endColumn }
}

function normalizeNumber(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return undefined
  const text = String(value)
  return text || undefined
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .map((message) => {
      if (typeof message === "string") return message
      return String(message?.message?.value || message?.message || "")
    })
    .filter(Boolean)
}

function normalizePublishedResults(results) {
  if (!Array.isArray(results)) return []
  return results
    .filter((result) => result && typeof result === "object" && normalizeOptionalString(result.id))
    .map((result) => ({
      ...result,
      id: normalizeOptionalString(result.id),
      controllerId: normalizeOptionalString(result.controllerId),
      tests: Array.isArray(result.tests) ? result.tests : [],
      tasks: Array.isArray(result.tasks) ? result.tasks : [],
      output: Array.isArray(result.output) ? result.output : [],
      noSecondState: true,
    }))
}

function normalizeError(error) {
  if (!error) return undefined
  if (typeof error === "string") return error
  return String(error.value || error.message || "")
}

function decodeOutput(output) {
  if (Buffer.isBuffer(output)) return output.toString("utf8")
  if (output instanceof Uint8Array) return Buffer.from(output).toString("utf8")
  if (output && typeof output === "object" && Array.isArray(output.data)) {
    return Buffer.from(output.data).toString("utf8")
  }
  return String(output || "")
}

function toUriString(uri) {
  if (!uri || typeof uri !== "object") return undefined
  const scheme = uri.scheme || "file"
  if (scheme === "file") {
    const pathValue = String(uri.path || uri.fsPath || "")
    return pathValue ? `file://${pathValue}` : undefined
  }
  if (typeof uri.toString === "function") return uri.toString()
  return undefined
}

function getControllerIdFromTestId(testId) {
  return String(testId || "").split("\u0000")[0]
}

function getParentId(testId) {
  const parts = String(testId || "").split("\u0000")
  if (parts.length <= 1) return undefined
  return parts.slice(0, -1).join("\u0000")
}

module.exports = {
  EXT_HOST_TESTING_NID,
  MAIN_THREAD_TESTING_NID,
  register,
  _test: {
    normalizeCoverageFile,
    normalizeInternalTestItem,
    normalizeProfile,
    normalizePublishedResults,
    normalizeResultState,
    normalizeRunRequest,
    createResolvedRunId,
  },
}
