/**
 * MainThreadSCM — VS Code style SCM bridge for the extension host.
 *
 * Current ext-host bundle uses the newer RPC surface:
 *   $registerSourceControl
 *   $updateSourceControl
 *   $unregisterSourceControl
 *   $registerGroups
 *   $updateGroup
 *   $updateGroupLabel
 *   $spliceResourceStates
 *   $unregisterGroup
 *   $setInputBoxValue / $setInputBoxPlaceholder / $setInputBoxEnablement / $setInputBoxVisibility
 *   $showValidationMessage / $setValidationProviderIsEnabled
 *   $onDidChangeHistoryProviderCurrentHistoryItemRefs / $onDidChangeHistoryProviderHistoryItemRefs
 *   $onDidChangeArtifacts
 *
 * Codek keeps a clone-safe in-memory SCM model here and forwards normalized
 * renderer events, while preserving a minimal compatibility layer for older
 * RPC names still referenced by legacy code.
 */

const { ExtHostContext } = require("../extHostServer")

const MAIN_THREAD_SCM_NID = 54
const EXT_HOST_SCM_NID = ExtHostContext.ExtHostSCM

function onRpc(server, method, handler) {
  server.onRpc(MAIN_THREAD_SCM_NID, method, handler)
  server.onRpc(method, handler)
}

function getCallEh(server, opts = {}) {
  if (typeof opts.callEh === "function") return opts.callEh
  return (nid, method, args, timeoutMs, options) => server.call(nid, method, args, timeoutMs, options)
}

function createStore() {
  return {
    repositories: new Map(),
    selectedSourceControlHandle: undefined,
  }
}

function clearStore(store) {
  store.repositories.clear()
  store.selectedSourceControlHandle = undefined
}

function ensureRepository(store, handle) {
  const key = toNumber(handle)
  if (!store.repositories.has(key)) {
    store.repositories.set(key, {
      handle: key,
      id: "",
      label: "",
      rootUri: undefined,
      parentHandle: undefined,
      iconPath: undefined,
      isHidden: undefined,
      inputBoxDocumentUri: undefined,
      selected: false,
      input: {
        value: "",
        placeholder: "",
        enabled: true,
        visible: true,
        validationMessage: null,
        validationType: null,
        validationProviderEnabled: false,
      },
      features: {},
      groups: new Map(),
      history: {
        currentRefs: { historyItemRef: undefined, historyItemRemoteRef: undefined, historyItemBaseRef: undefined },
        changes: { added: [], modified: [], removed: [], silent: false },
      },
      artifacts: { groups: [] },
    })
  }
  return store.repositories.get(key)
}

function getRepository(store, handle) {
  return store.repositories.get(toNumber(handle))
}

function removeRepository(store, handle) {
  const key = toNumber(handle)
  const repository = store.repositories.get(key)
  if (!repository) return null
  store.repositories.delete(key)
  if (store.selectedSourceControlHandle === key) {
    store.selectedSourceControlHandle = undefined
  }
  return repository
}

function ensureGroup(repository, groupHandle, partial = {}) {
  const key = toNumber(groupHandle)
  if (!repository.groups.has(key)) {
    repository.groups.set(key, {
      handle: key,
      id: "",
      label: "",
      features: {},
      multiDiffEditorEnableViewChanges: false,
      resources: [],
      ...partial,
    })
  }
  const group = repository.groups.get(key)
  Object.assign(group, partial)
  return group
}

function removeGroup(repository, groupHandle) {
  const key = toNumber(groupHandle)
  const group = repository.groups.get(key)
  if (!group) return null
  repository.groups.delete(key)
  return group
}

function register(server, opts = {}) {
  const { sendToRenderer, ipcMain } = opts
  const callEh = getCallEh(server, opts)
  const store = createStore()

  function emit(channel, payload) {
    if (sendToRenderer) sendToRenderer(channel, cloneSafe(payload))
  }

  async function setSelectedSourceControl(handle) {
    const numericHandle = handle == null ? undefined : toNumber(handle)
    if (store.selectedSourceControlHandle === numericHandle) return undefined
    if (store.selectedSourceControlHandle != null) {
      const previous = getRepository(store, store.selectedSourceControlHandle)
      if (previous) previous.selected = false
    }
    store.selectedSourceControlHandle = numericHandle
    if (numericHandle != null) {
      const repository = ensureRepository(store, numericHandle)
      repository.selected = true
    }
    try {
      await callEh(EXT_HOST_SCM_NID, "$setSelectedSourceControl", [numericHandle], 10000)
    } catch {
      // Renderer-driven selection sync is best effort.
    }
    emit("ext-host:scm-selectedSourceControl", { handle: numericHandle })
    return undefined
  }

  async function onInputBoxValueChange(handle, value) {
    const repository = getRepository(store, handle)
    if (!repository) return undefined
    repository.input.value = String(value || "")
    try {
      await callEh(EXT_HOST_SCM_NID, "$onInputBoxValueChange", [toNumber(handle), repository.input.value], 10000)
    } catch {
      // Input sync is best effort.
    }
    emit("ext-host:scm-inputBoxValue", { handle: toNumber(handle), value: repository.input.value })
    return undefined
  }

  onRpc(server, "$registerSourceControl", (args) => {
    const [handle, parentHandle, id, label, rootUri, iconPath, isHidden, inputBoxDocumentUri] = args || []
    if (handle == null) return undefined
    const repository = ensureRepository(store, handle)
    repository.parentHandle = parentHandle == null ? undefined : toNumber(parentHandle)
    repository.id = String(id || "")
    repository.label = String(label || id || "")
    repository.rootUri = normalizeUri(rootUri)
    repository.iconPath = cloneSafe(iconPath)
    repository.isHidden = isHidden === true
    repository.inputBoxDocumentUri = normalizeUri(inputBoxDocumentUri)
    emit("ext-host:scm-register", { repository: toRendererRepository(repository) })
    return undefined
  })

  onRpc(server, "$updateSourceControl", (args) => {
    const [handle, features] = args || []
    if (handle == null) return undefined
    const repository = getRepository(store, handle)
    if (!repository) return undefined
    repository.features = {
      ...repository.features,
      ...cloneSafe(features),
    }
    if (typeof features?.count === "number") repository.count = features.count
    if (typeof features?.commitTemplate !== "undefined") repository.commitTemplate = String(features.commitTemplate || "")
    if (typeof features?.contextValue !== "undefined") repository.contextValue = String(features.contextValue || "")
    repository.acceptInputCommand = normalizeCommand(features?.acceptInputCommand) || repository.acceptInputCommand
    repository.actionButton = normalizeCommand(features?.actionButton) || repository.actionButton
    repository.statusBarCommands = Array.isArray(features?.statusBarCommands)
      ? features.statusBarCommands.map(normalizeCommand).filter(Boolean)
      : repository.statusBarCommands
    emit("ext-host:scm-updateSourceControl", { repository: toRendererRepository(repository), features: cloneSafe(features) })
    return undefined
  })

  onRpc(server, "$unregisterSourceControl", (args) => {
    const [handle] = args || []
    const removed = removeRepository(store, handle)
    if (!removed) return undefined
    emit("ext-host:scm-dispose", { handle: toNumber(handle), repository: toRendererRepository(removed) })
    return undefined
  })

  onRpc(server, "$registerGroups", (args) => {
    const [sourceControlHandle, groups, splices] = args || []
    if (sourceControlHandle == null) return undefined
    const repository = getRepository(store, sourceControlHandle)
    if (!repository) return undefined
    const createdGroups = Array.isArray(groups) ? groups.map((entry) => {
      const [groupHandle, id, label, features, multiDiffEditorEnableViewChanges] = entry || []
      return ensureGroup(repository, groupHandle, {
        id: String(id || ""),
        label: String(label || id || ""),
        features: cloneSafe(features || {}),
        multiDiffEditorEnableViewChanges: multiDiffEditorEnableViewChanges === true,
      })
    }) : []
    if (Array.isArray(splices) && splices.length > 0) {
      applyResourceSplices(repository, splices)
    }
    emit("ext-host:scm-registerGroups", {
      handle: toNumber(sourceControlHandle),
      groups: createdGroups.map((group) => toRendererGroup(repository, group)),
      repository: toRendererRepository(repository),
    })
    return undefined
  })

  onRpc(server, "$updateGroup", (args) => {
    const [sourceControlHandle, groupHandle, features] = args || []
    if (sourceControlHandle == null || groupHandle == null) return undefined
    const repository = getRepository(store, sourceControlHandle)
    if (!repository) return undefined
    const group = ensureGroup(repository, groupHandle)
    group.features = {
      ...group.features,
      ...cloneSafe(features),
    }
    emit("ext-host:scm-updateGroup", {
      handle: toNumber(sourceControlHandle),
      groupHandle: toNumber(groupHandle),
      group: toRendererGroup(repository, group),
      features: cloneSafe(features),
    })
    return undefined
  })

  onRpc(server, "$updateGroupLabel", (args) => {
    const [sourceControlHandle, groupHandle, label] = args || []
    if (sourceControlHandle == null || groupHandle == null) return undefined
    const repository = getRepository(store, sourceControlHandle)
    if (!repository) return undefined
    const group = ensureGroup(repository, groupHandle)
    group.label = String(label || group.id || "")
    emit("ext-host:scm-updateGroup", {
      handle: toNumber(sourceControlHandle),
      groupHandle: toNumber(groupHandle),
      group: toRendererGroup(repository, group),
      label: group.label,
    })
    return undefined
  })

  onRpc(server, "$spliceResourceStates", (args) => {
    const [sourceControlHandle, splices] = args || []
    if (sourceControlHandle == null) return undefined
    const repository = getRepository(store, sourceControlHandle)
    if (!repository) return undefined
    applyResourceSplices(repository, Array.isArray(splices) ? splices : [])
    emit("ext-host:scm-updateResources", {
      handle: toNumber(sourceControlHandle),
      repository: toRendererRepository(repository),
    })
    return undefined
  })

  onRpc(server, "$unregisterGroup", (args) => {
    const [sourceControlHandle, groupHandle] = args || []
    if (sourceControlHandle == null || groupHandle == null) return undefined
    const repository = getRepository(store, sourceControlHandle)
    if (!repository) return undefined
    const removed = removeGroup(repository, groupHandle)
    if (!removed) return undefined
    emit("ext-host:scm-disposeGroup", {
      handle: toNumber(sourceControlHandle),
      groupHandle: toNumber(groupHandle),
      group: toRendererGroup(repository, removed),
    })
    return undefined
  })

  onRpc(server, "$setInputBoxValue", (args) => {
    const [handle, value] = args || []
    if (handle == null) return undefined
    const repository = getRepository(store, handle)
    if (!repository) return undefined
    repository.input.value = String(value || "")
    emit("ext-host:scm-inputBoxValue", { handle: toNumber(handle), value: repository.input.value })
    return undefined
  })

  onRpc(server, "$setInputBoxPlaceholder", (args) => {
    const [handle, placeholder] = args || []
    if (handle == null) return undefined
    const repository = getRepository(store, handle)
    if (!repository) return undefined
    repository.input.placeholder = String(placeholder || "")
    emit("ext-host:scm-inputBoxPlaceholder", { handle: toNumber(handle), placeholder: repository.input.placeholder })
    return undefined
  })

  onRpc(server, "$setInputBoxEnablement", (args) => {
    const [handle, enabled] = args || []
    if (handle == null) return undefined
    const repository = getRepository(store, handle)
    if (!repository) return undefined
    repository.input.enabled = enabled !== false
    emit("ext-host:scm-inputBoxEnablement", { handle: toNumber(handle), enabled: repository.input.enabled })
    return undefined
  })

  onRpc(server, "$setInputBoxVisibility", (args) => {
    const [handle, visible] = args || []
    if (handle == null) return undefined
    const repository = getRepository(store, handle)
    if (!repository) return undefined
    repository.input.visible = visible !== false
    emit("ext-host:scm-inputBoxVisibility", { handle: toNumber(handle), visible: repository.input.visible })
    return undefined
  })

  onRpc(server, "$showValidationMessage", (args) => {
    const [handle, message, type] = args || []
    if (handle == null) return undefined
    const repository = getRepository(store, handle)
    if (!repository) return undefined
    repository.input.validationMessage = normalizeValidationMessage(message)
    repository.input.validationType = typeof type === "number" ? type : null
    emit("ext-host:scm-inputBoxValidation", {
      handle: toNumber(handle),
      message: repository.input.validationMessage,
      type: repository.input.validationType,
    })
    return undefined
  })

  onRpc(server, "$setValidationProviderIsEnabled", (args) => {
    const [handle, enabled] = args || []
    if (handle == null) return undefined
    const repository = getRepository(store, handle)
    if (!repository) return undefined
    repository.input.validationProviderEnabled = enabled === true
    emit("ext-host:scm-validationProvider", {
      handle: toNumber(handle),
      enabled: repository.input.validationProviderEnabled,
    })
    return undefined
  })

  onRpc(server, "$onDidChangeHistoryProviderCurrentHistoryItemRefs", (args) => {
    const [handle, historyItemRef, historyItemRemoteRef, historyItemBaseRef] = args || []
    if (handle == null) return undefined
    const repository = getRepository(store, handle)
    if (!repository) return undefined
    repository.history.currentRefs = cloneSafe({
      historyItemRef,
      historyItemRemoteRef,
      historyItemBaseRef,
    })
    emit("ext-host:scm-historyRefs", {
      handle: toNumber(handle),
      currentRefs: repository.history.currentRefs,
    })
    return undefined
  })

  onRpc(server, "$onDidChangeHistoryProviderHistoryItemRefs", (args) => {
    const [handle, historyItemRefs] = args || []
    if (handle == null) return undefined
    const repository = getRepository(store, handle)
    if (!repository) return undefined
    repository.history.changes = cloneSafe(historyItemRefs || { added: [], modified: [], removed: [], silent: false })
    emit("ext-host:scm-historyRefChanges", {
      handle: toNumber(handle),
      changes: repository.history.changes,
    })
    return undefined
  })

  onRpc(server, "$onDidChangeArtifacts", (args) => {
    const [handle, groups] = args || []
    if (handle == null) return undefined
    const repository = getRepository(store, handle)
    if (!repository) return undefined
    repository.artifacts.groups = Array.isArray(groups) ? groups.map((value) => String(value)) : []
    emit("ext-host:scm-artifacts", {
      handle: toNumber(handle),
      groups: [...repository.artifacts.groups],
    })
    return undefined
  })

  onRpc(server, "$validateInput", async (args) => {
    const [sourceControlHandle, value, cursorPosition] = args || []
    const repository = getRepository(store, sourceControlHandle)
    if (!repository || repository.input.validationProviderEnabled !== true) return undefined
    if (typeof opts.validateInput !== "function") return undefined
    const result = await opts.validateInput({
      repository: toRendererRepository(repository),
      value: String(value || ""),
      cursorPosition: toNumber(cursorPosition),
    })
    if (!result) return undefined
    if (Array.isArray(result) && result.length >= 2) return [normalizeValidationMessage(result[0]), toNumber(result[1])]
    return undefined
  })

  onRpc(server, "$provideOriginalResource", async (args) => {
    const [sourceControlHandle, uri] = args || []
    const repository = getRepository(store, sourceControlHandle)
    if (!repository) return null
    const match = findResourceByUri(repository, normalizeUri(uri))
    if (!match) return null
    return match.multiDiffEditorOriginalUri || null
  })

  onRpc(server, "$provideSecondaryOriginalResource", async (args) => {
    const [sourceControlHandle, uri] = args || []
    const repository = getRepository(store, sourceControlHandle)
    if (!repository) return null
    const match = findResourceByUri(repository, normalizeUri(uri))
    if (!match) return null
    return match.multiDiffEditorModifiedUri || null
  })

  onRpc(server, "$executeResourceCommand", async (args) => {
    const [sourceControlHandle, groupHandle, handle, preserveFocus] = args || []
    const repository = getRepository(store, sourceControlHandle)
    const group = repository ? repository.groups.get(toNumber(groupHandle)) : null
    const resource = group ? group.resources.find((item) => item.handle === toNumber(handle)) : null
    emit("ext-host:scm-resourceCommand", {
      handle: toNumber(sourceControlHandle),
      groupHandle: toNumber(groupHandle),
      resourceHandle: toNumber(handle),
      preserveFocus: preserveFocus === true,
      resource: cloneSafe(resource),
    })
    return undefined
  })

  // Legacy compatibility layer.
  onRpc(server, "$registerGroup", (args) => {
    const [sourceControlHandle, groupHandle, id, label, hideWhenEmpty] = args || []
    return server._rpcHandlers?.["$registerGroups"]
      ? server._rpcHandlers["$registerGroups"]([sourceControlHandle, [[groupHandle, id, label, { hideWhenEmpty: hideWhenEmpty === true }, false]], []])
      : undefined
  })

  onRpc(server, "$updateResourceStates", (args) => {
    const [sourceControlHandle, resources] = args || []
    const repository = getRepository(store, sourceControlHandle)
    if (!repository) return undefined
    const group = ensureGroup(repository, 0, { id: "changes", label: "Changes", features: {} })
    group.resources = Array.isArray(resources) ? resources.map((resource, index) => normalizeLegacyResource(resource, index, group)) : []
    emit("ext-host:scm-updateResources", {
      handle: toNumber(sourceControlHandle),
      repository: toRendererRepository(repository),
    })
    return undefined
  })

  onRpc(server, "$disposeSourceControl", (args) => server._rpcHandlers?.["$unregisterSourceControl"]?.(args || []))

  onRpc(server, "$disposeGroup", (args) => {
    const [groupHandle] = args || []
    for (const repository of store.repositories.values()) {
      if (repository.groups.has(toNumber(groupHandle))) {
        removeGroup(repository, groupHandle)
        emit("ext-host:scm-disposeGroup", {
          handle: repository.handle,
          groupHandle: toNumber(groupHandle),
        })
        break
      }
    }
    return undefined
  })

  onRpc(server, "$commit", (args) => {
    const [handle, message] = args || []
    emit("ext-host:scm-commit", { handle: toNumber(handle), message: String(message || "") })
    return undefined
  })

  if (ipcMain?.on) {
    ipcMain.on("ext-host:scm-setSelected", (_event, payload) => {
      void setSelectedSourceControl(payload?.handle)
    })
    ipcMain.on("ext-host:scm-input", (_event, payload) => {
      void onInputBoxValueChange(payload?.handle, payload?.value)
    })
  }

  if (typeof server.on === "function") {
    const clear = () => clearStore(store)
    server.on("stopped", clear)
    server.on("exit", clear)
  }

  return {
    store,
    setSelectedSourceControl,
    onInputBoxValueChange,
  }
}

function applyResourceSplices(repository, splices) {
  for (const spliceEntry of splices || []) {
    const [groupHandle, groupSlices] = spliceEntry || []
    const group = ensureGroup(repository, groupHandle)
    const normalizedSlices = Array.isArray(groupSlices) ? [...groupSlices].reverse() : []
    for (const slice of normalizedSlices) {
      const [start, deleteCount, rawResources] = slice || []
      const normalizedResources = Array.isArray(rawResources)
        ? rawResources.map((rawResource) => normalizeRawResource(rawResource, group))
        : []
      group.resources.splice(toNumber(start), toNumber(deleteCount), ...normalizedResources)
    }
  }
}

function normalizeRawResource(rawResource, group) {
  const [handle, sourceUri, icons, tooltip, strikeThrough, faded, contextValue, command, multiDiffEditorOriginalUri, multiDiffEditorModifiedUri] = rawResource || []
  const source = normalizeUri(sourceUri)
  return {
    handle: toNumber(handle),
    sourceUri: source,
    resourceUri: source,
    icons: normalizeIcons(icons),
    tooltip: normalizeValidationMessage(tooltip),
    strikeThrough: strikeThrough === true,
    faded: faded === true,
    contextValue: contextValue ? String(contextValue) : "",
    command: normalizeCommand(command),
    multiDiffEditorOriginalUri: normalizeUri(multiDiffEditorOriginalUri),
    multiDiffEditorModifiedUri: normalizeUri(multiDiffEditorModifiedUri),
    groupId: group.id,
    path: source,
  }
}

function normalizeLegacyResource(resource, index, group) {
  const sourceUri = normalizeUri(resource?.sourceUri || resource?.resourceUri || resource?.path || "")
  return {
    handle: index,
    sourceUri,
    resourceUri: sourceUri,
    tooltip: normalizeValidationMessage(resource?.tooltip),
    strikeThrough: resource?.strikeThrough === true,
    faded: resource?.faded === true,
    contextValue: resource?.contextValue ? String(resource.contextValue) : "",
    command: normalizeCommand(resource?.command),
    multiDiffEditorOriginalUri: normalizeUri(resource?.multiDiffEditorOriginalUri),
    multiDiffEditorModifiedUri: normalizeUri(resource?.multiDiffEditorModifiedUri),
    groupId: group.id,
    path: sourceUri || String(resource?.path || ""),
  }
}

function toRendererRepository(repository) {
  return cloneSafe({
    handle: repository.handle,
    id: repository.id,
    label: repository.label,
    rootUri: repository.rootUri,
    parentHandle: repository.parentHandle,
    iconPath: repository.iconPath,
    isHidden: repository.isHidden,
    inputBoxDocumentUri: repository.inputBoxDocumentUri,
    selected: repository.selected === true,
    input: repository.input,
    features: repository.features,
    count: repository.count,
    commitTemplate: repository.commitTemplate,
    contextValue: repository.contextValue,
    acceptInputCommand: repository.acceptInputCommand,
    actionButton: repository.actionButton,
    statusBarCommands: repository.statusBarCommands,
    groups: [...repository.groups.values()].map((group) => toRendererGroup(repository, group)),
    history: repository.history,
    artifacts: repository.artifacts,
  })
}

function toRendererGroup(repository, group) {
  return cloneSafe({
    sourceControlHandle: repository.handle,
    handle: group.handle,
    id: group.id,
    label: group.label,
    features: group.features,
    multiDiffEditorEnableViewChanges: group.multiDiffEditorEnableViewChanges === true,
    resources: group.resources,
  })
}

function findResourceByUri(repository, uri) {
  const normalized = normalizeUri(uri)
  for (const group of repository.groups.values()) {
    const match = group.resources.find((resource) =>
      normalizeUri(resource.sourceUri) === normalized
      || normalizeUri(resource.resourceUri) === normalized,
    )
    if (match) return match
  }
  return null
}

function normalizeIcons(icons) {
  if (!Array.isArray(icons)) return { light: undefined, dark: undefined }
  return {
    light: cloneSafe(icons[0]),
    dark: cloneSafe(icons[1]),
  }
}

function normalizeValidationMessage(message) {
  if (message == null) return null
  if (typeof message === "string") return message
  if (typeof message === "object" && typeof message.value === "string") return message.value
  return String(message)
}

function normalizeCommand(command) {
  if (!command || typeof command !== "object") return null
  const commandId = String(command.command || command.commandId || "").trim()
  if (!commandId) return null
  return {
    commandId,
    title: String(command.title || command.label || commandId),
    arguments: Array.isArray(command.arguments) ? command.arguments.map((value) => cloneSafe(value)) : [],
  }
}

function normalizeUri(value) {
  if (!value) return undefined
  if (typeof value === "string") return value
  if (typeof value === "object") {
    if (typeof value.toString === "function" && value.toString !== Object.prototype.toString) {
      try {
        const text = value.toString()
        if (text && text !== "[object Object]") return text
      } catch {}
    }
    if (typeof value.fsPath === "string") return value.fsPath.replace(/\\/g, "/")
    if (typeof value.path === "string") {
      if (value.scheme === "file" && /^[A-Za-z]:/.test(value.path.slice(1))) return value.path.slice(1)
      return value.path
    }
  }
  return undefined
}

function cloneSafe(value, seen = new WeakSet()) {
  if (typeof value === "function") return undefined
  if (value == null || typeof value !== "object") return value
  if (Buffer.isBuffer(value)) return { type: "Buffer", data: Array.from(value.values()) }
  if (seen.has(value)) return undefined
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => cloneSafe(item, seen))
  const next = {}
  for (const [key, nested] of Object.entries(value)) {
    const cloned = cloneSafe(nested, seen)
    next[key] = cloned
  }
  return next
}

function toNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function listRepositories(store) {
  return [...store.repositories.values()].map((repository) => toRendererRepository(repository))
}

module.exports = {
  MAIN_THREAD_SCM_NID,
  EXT_HOST_SCM_NID,
  applyResourceSplices,
  cloneSafe,
  createStore,
  listRepositories,
  normalizeRawResource,
  register,
}
