/**
 * MainThreadCommands — VS Code-compatible command bridge.
 *
 * VS Code registers contributed commands on the main thread, then routes
 * execution back into ExtHostCommands.$executeContributedCommand. This keeps
 * command palette/menu/keybinding contributions useful after installation
 * instead of stopping at manifest discovery.
 */

const EXT_HOST_COMMANDS_NID = 86
const EXT_HOST_EXTENSION_SERVICE_NID = 106
const MAIN_THREAD_COMMANDS_NID = 10
const ActivationKind = Object.freeze({
  Normal: 0,
  Immediate: 1,
})

const registeredCommands = new Map()

function getCallEh(server, opts = {}) {
  if (typeof opts.callEh === "function") return opts.callEh
  return (nid, method, args, timeoutMs) => server.call(nid, method, args, timeoutMs)
}

function normalizeCommandId(value) {
  return typeof value === "string" ? value.trim() : ""
}

function unwrapSerializableArgs(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === "object" && Array.isArray(value.value)) return value.value
  return []
}

function toCloneSafeValue(value, seen = new WeakSet()) {
  if (value == null) return value
  if (Buffer.isBuffer(value)) return { type: "Buffer", data: Array.from(value) }
  if (value instanceof Uint8Array) return Array.from(value)
  if (Array.isArray(value)) return value.map((item) => toCloneSafeValue(item, seen))
  if (typeof value !== "object") return value
  if (seen.has(value)) return undefined
  seen.add(value)

  const clone = {}
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested !== "function") {
      clone[key] = toCloneSafeValue(nested, seen)
    }
  }
  return clone
}

function unwrapCloneSafeArgs(value) {
  return unwrapSerializableArgs(value).map((arg) => toCloneSafeValue(arg))
}

async function fireCommandActivationEvent(commandId, callEh, timeoutMs = 30000) {
  const id = normalizeCommandId(commandId)
  if (!id) return undefined
  return callEh(
    EXT_HOST_EXTENSION_SERVICE_NID,
    "$activateByEvent",
    [`onCommand:${id}`, ActivationKind.Normal],
    timeoutMs,
  )
}

async function executeContributedCommand(commandId, args, callEh, timeoutMs = 30000) {
  const id = normalizeCommandId(commandId)
  if (!id) return undefined
  return callEh(
    EXT_HOST_COMMANDS_NID,
    "$executeContributedCommand",
    [id, ...unwrapCloneSafeArgs(args)],
    timeoutMs,
  )
}

function listRegisteredCommands({ includeInternal = true } = {}) {
  const commands = Array.from(registeredCommands.values())
  return includeInternal ? commands : commands.filter((command) => !command.id.startsWith("_"))
}

function clearRegisteredCommands() {
  registeredCommands.clear()
}

function register(server, opts = {}) {
  const callEh = getCallEh(server, opts)
  const timeoutMs = Math.trunc(Number(opts.timeoutMs)) > 0 ? Math.trunc(Number(opts.timeoutMs)) : 30000

  server.onRpc(MAIN_THREAD_COMMANDS_NID, "$registerCommand", (args) => {
    const [rawId, description] = args || []
    const id = normalizeCommandId(rawId)
    if (!id) return undefined
    registeredCommands.set(id, { id, description: description || "" })
    return undefined
  })

  server.onRpc(MAIN_THREAD_COMMANDS_NID, "$unregisterCommand", (args) => {
    const [rawId] = args || []
    const id = normalizeCommandId(rawId)
    if (id) registeredCommands.delete(id)
    return undefined
  })

  server.onRpc(MAIN_THREAD_COMMANDS_NID, "$fireCommandActivationEvent", (args) => {
    const [id] = args || []
    return fireCommandActivationEvent(id, callEh, timeoutMs)
  })

  server.onRpc(MAIN_THREAD_COMMANDS_NID, "$executeCommand", async (args) => {
    const [id, commandArgs, retry] = args || []
    const commandId = normalizeCommandId(id)
    if (!commandId) return undefined
    if (retry && !registeredCommands.has(commandId)) {
      await fireCommandActivationEvent(commandId, callEh, timeoutMs)
    }
    return executeContributedCommand(commandId, commandArgs, callEh, timeoutMs)
  })

  server.onRpc(MAIN_THREAD_COMMANDS_NID, "$getCommands", () => {
    return listRegisteredCommands().map((command) => command.id)
  })

  if (typeof server.on === "function") {
    const clear = () => clearRegisteredCommands()
    server.on("stopped", clear)
    server.on("exit", clear)
  }

  // Allow renderer to query registered commands.
  if (opts.registerApi) {
    opts.registerApi("GET", "/ext-host/commands", async () => listRegisteredCommands())
  }
}

module.exports = {
  ActivationKind,
  EXT_HOST_COMMANDS_NID,
  EXT_HOST_EXTENSION_SERVICE_NID,
  MAIN_THREAD_COMMANDS_NID,
  clearRegisteredCommands,
  executeContributedCommand,
  fireCommandActivationEvent,
  listRegisteredCommands,
  register,
  toCloneSafeValue,
  unwrapCloneSafeArgs,
}
