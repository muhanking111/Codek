/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code MainThreadProfileContentHandlers:
 * - D:\SourceMirror\vscode\src\vs\workbench\api\browser\mainThreadProfileContentHandlers.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\api\common\extHostProfileContentHandler.ts
 *--------------------------------------------------------------------------------------------*/

const EXT_HOST_PROFILE_CONTENT_HANDLERS_NID = 129

const registeredHandlers = new Map()

class RemoteProfileContentHandler {
  constructor({ id, name, description, extensionId, callEh, timeoutMs }) {
    this.id = id
    this.name = name
    this.description = description
    this.extensionId = extensionId
    this.callEh = callEh
    this.timeoutMs = timeoutMs
  }

  async readProfile(idOrUri, token = cancellationTokenNone()) {
    return this.callEh(
      EXT_HOST_PROFILE_CONTENT_HANDLERS_NID,
      "$readProfile",
      [this.id, idOrUri, token || cancellationTokenNone()],
      this.timeoutMs,
    )
  }

  async saveProfile(name, content, token = cancellationTokenNone()) {
    const result = await this.callEh(
      EXT_HOST_PROFILE_CONTENT_HANDLERS_NID,
      "$saveProfile",
      [this.id, name, content, token || cancellationTokenNone()],
      this.timeoutMs,
    )
    return normalizeSaveProfileResult(result)
  }

  dispose() {
    registeredHandlers.delete(this.id)
  }
}

function register(server, opts = {}) {
  const callEh = typeof opts.callEh === "function"
    ? opts.callEh
    : (nid, method, args, timeoutMs) => server.call(nid, method, args, timeoutMs)
  const timeoutMs = normalizeTimeout(opts.timeoutMs)

  server.onRpc("$registerProfileContentHandler", (args) => {
    const [id, name, description, extensionId] = args || []
    return registerProfileContentHandler({
      id,
      name,
      description,
      extensionId,
      callEh,
      timeoutMs,
    })
  })

  server.onRpc("$unregisterProfileContentHandler", (args) => {
    const [id] = args || []
    unregisterProfileContentHandler(id)
    return undefined
  })

  const clear = () => clearProfileContentHandlers()
  if (typeof server.on === "function") {
    server.on("stopped", clear)
    server.on("exit", clear)
  }
}

function registerProfileContentHandler({ id, name, description, extensionId, callEh, timeoutMs }) {
  const handlerId = normalizeHandlerId(id)
  if (!handlerId) throw new Error("Profile content handler id is required")
  if (registeredHandlers.has(handlerId)) {
    throw new Error(`Profile content handler with id '${handlerId}' already registered.`)
  }
  const handler = new RemoteProfileContentHandler({
    id: handlerId,
    name: String(name || handlerId),
    description: typeof description === "string" ? description : undefined,
    extensionId: String(extensionId || ""),
    callEh,
    timeoutMs,
  })
  registeredHandlers.set(handlerId, handler)
  return undefined
}

function unregisterProfileContentHandler(id) {
  registeredHandlers.delete(normalizeHandlerId(id))
}

function listProfileContentHandlers() {
  return Array.from(registeredHandlers.values()).map((handler) => ({
    id: handler.id,
    name: handler.name,
    description: handler.description,
    extensionId: handler.extensionId,
  }))
}

async function readProfileContent(handlerId, idOrUri, token) {
  const handler = getProfileContentHandler(handlerId)
  return handler.readProfile(idOrUri, token)
}

async function saveProfileContent(handlerId, name, content, token) {
  const handler = getProfileContentHandler(handlerId)
  return handler.saveProfile(name, content, token)
}

function getProfileContentHandler(id) {
  const handlerId = normalizeHandlerId(id)
  const handler = registeredHandlers.get(handlerId)
  if (!handler) throw new Error(`Profile content handler not found: ${handlerId}`)
  return handler
}

function clearProfileContentHandlers() {
  registeredHandlers.clear()
}

function normalizeHandlerId(value) {
  return String(value || "").trim()
}

function cancellationTokenNone() {
  return { isCancellationRequested: false }
}

function normalizeTimeout(value) {
  const numeric = Math.trunc(Number(value))
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 30000
}

function normalizeSaveProfileResult(result) {
  if (!result) return null
  if (typeof result === "string") return { id: result }
  if (typeof result !== "object") return null
  const id = String(result.id || result.filePath || result.path || "")
  if (!id) return null
  return {
    id,
    filePath: result.filePath || result.path,
    link: result.link,
    bytesWritten: Number.isFinite(Number(result.bytesWritten)) ? Number(result.bytesWritten) : undefined,
  }
}

module.exports = {
  EXT_HOST_PROFILE_CONTENT_HANDLERS_NID,
  RemoteProfileContentHandler,
  clearProfileContentHandlers,
  listProfileContentHandlers,
  readProfileContent,
  register,
  registerProfileContentHandler,
  saveProfileContent,
  unregisterProfileContentHandler,
}
