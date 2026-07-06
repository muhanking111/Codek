/**
 * Extension Host Server — spawns VS Code EH bundle via named pipe IPC.
 *
 * Uses PersistentProtocol frame format (13-byte header + data):
 *   [1 byte: type] [4 bytes: id (BE)] [4 bytes: ack (BE)] [4 bytes: data len (BE)] [data]
 *
 * ProtocolMessageType: 1=Regular, 3=Ack, 8=Resume, 9=KeepAlive
 * AppMessageType:      1=Initialized (0x01), 2=Ready (0x02), 3=Terminate (0x03)
 *
 * Handshake flow:
 *   ← Ready (0x02)
 *   → InitData (JSON with workspace, extensions, environment config)
 *   ← Initialized (0x01)
 */

const net = require("net")
const path = require("path")
const { spawn } = require("child_process")
const { EventEmitter } = require("events")

const { scanExtensions } = require("./extensionScanner")
const { toFileUriComponents } = require("./uriComponents")
const { buildConfigurationData } = require("./mainThread/mainThreadConfiguration")
const { hashError } = require("./extensionAuditLog")
const BUNDLE_PATH = path.join(__dirname, "bundle", "extHost.bundle.mjs")
const HEADER_LEN = 13

const ProtocolMessageType = { Regular: 1, Ack: 3, Resume: 8, KeepAlive: 9 }
const AppMessageType = { Initialized: 1, Ready: 2, Terminate: 3 }
const RpcMessageType = {
  RequestJSONArgs: 1,
  RequestJSONArgsWithCancellation: 2,
  RequestMixedArgs: 3,
  RequestMixedArgsWithCancellation: 4,
  ReplyOKEmpty: 7,
  ReplyOKVSBuffer: 8,
  ReplyOKJSON: 9,
  ReplyOKJSONWithBuffers: 10,
  ReplyErrError: 11,
  ReplyErrEmpty: 12,
}
const RpcArgType = {
  String: 1,
  VSBuffer: 2,
  SerializedObjectWithBuffers: 3,
  Undefined: 4,
}
const ExtHostContext = {
  ExtHostCommands: 86,
  ExtHostConfiguration: 87,
  ExtHostDebugService: 89,
  ExtHostExtensionService: 106,
  ExtHostSCM: 110,
  ExtHostTask: 112,
  ExtHostWorkspace: 113,
  ExtHostProgress: 122,
  ExtHostOutputService: 130,
  ExtHostTesting: 154,
}

const MainContext = {
  MainThreadAuthentication: 1,
  MainThreadBulkEdits: 2,
  MainThreadClipboard: 9,
  MainThreadCommands: 10,
  MainThreadConfiguration: 12,
  MainThreadDebugService: 14,
  MainThreadDiagnostics: 16,
  MainThreadDocuments: 18,
  MainThreadTextEditors: 20,
  MainThreadEditorInsets: 21,
  MainThreadEditorTabs: 22,
  MainThreadErrors: 23,
  MainThreadTreeViews: 24,
  MainThreadDownloadService: 25,
  MainThreadLanguageFeatures: 26,
  MainThreadLanguages: 27,
  MainThreadLogger: 28,
  MainThreadMessageService: 29,
  MainThreadOutputService: 30,
  MainThreadProgress: 31,
  MainThreadQuickOpen: 34,
  MainThreadStatusBar: 35,
  MainThreadSecretState: 36,
  MainThreadStorage: 37,
  MainThreadTelemetry: 39,
  MainThreadProfileContentHandlers: 49,
  MainThreadWorkspace: 50,
  MainThreadFileSystem: 51,
  MainThreadFileSystemEventService: 52,
  MainThreadExtensionService: 53,
  MainThreadSCM: 54,
  MainThreadSearch: 55,
  MainThreadTask: 57,
  MainThreadWindow: 58,
  MainThreadTheming: 67,
  MainThreadTesting: 71,
  MainThreadLocalization: 72,
  MainThreadMcp: 73,
}

function normalizeWorkspaceRoots(initData = {}) {
  const roots = Array.isArray(initData.workspaceRoots) && initData.workspaceRoots.length > 0
    ? initData.workspaceRoots
    : (initData.rootDir ? [initData.rootDir] : [__dirname])
  return [...new Set(roots
    .filter((root) => typeof root === "string" && root.trim())
    .map((root) => path.resolve(root)))]
}

function buildWorkspaceData(initData = {}) {
  const roots = normalizeWorkspaceRoots(initData)
  const workspaceFile = typeof initData.workspaceFile === "string" && initData.workspaceFile.trim()
    ? path.resolve(initData.workspaceFile)
    : null
  const name = workspaceFile
    ? path.basename(workspaceFile, path.extname(workspaceFile))
    : (roots.length === 1 ? path.basename(roots[0]) : "codek")
  return {
    id: "00000000-0000-0000-0000-000000000000",
    folders: roots.map((root, index) => ({
      uri: toFileUriComponents(root),
      name: path.basename(root) || root,
      index,
    })),
    name: name || "codek",
    transient: !workspaceFile,
    isUntitled: false,
    configuration: workspaceFile ? toFileUriComponents(workspaceFile) : null,
  }
}

function summarizeRpcValue(value) {
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (Buffer.isBuffer(value)) return `<Buffer:${value.length}>`
  if (Array.isArray(value)) return `<Array:${value.length}>`
  if (typeof value === "object") {
    const keys = Object.keys(value).slice(0, 6)
    return `<Object:${keys.join(",")}>`
  }
  const text = String(value)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

function summarizeRpcArgs(args) {
  return (args || []).map(summarizeRpcValue).join(", ")
}

function isBufferLike(value) {
  return Buffer.isBuffer(value) || value instanceof Uint8Array
}

function readLongString(data, offset) {
  if (offset + 4 > data.length) return { value: undefined, offset: data.length }
  const byteLength = data.readUInt32BE(offset)
  offset += 4
  if (offset + byteLength > data.length) return { value: undefined, offset: data.length }
  const value = data.toString("utf8", offset, offset + byteLength)
  return { value, offset: offset + byteLength }
}

function readVSBuffer(data, offset) {
  if (offset + 4 > data.length) return { value: undefined, offset: data.length }
  const byteLength = data.readUInt32BE(offset)
  offset += 4
  if (offset + byteLength > data.length) return { value: undefined, offset: data.length }
  const value = Buffer.from(data.subarray(offset, offset + byteLength))
  return { value, offset: offset + byteLength }
}

function restoreSerializedObjectWithBuffers(value, buffers) {
  if (!value || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((item) => restoreSerializedObjectWithBuffers(item, buffers))
  if (value.$mid === 17 && Number.isInteger(value.index)) {
    return buffers[value.index]
  }
  const restored = {}
  for (const [key, nested] of Object.entries(value)) {
    restored[key] = restoreSerializedObjectWithBuffers(nested, buffers)
  }
  return restored
}

// ── PersistentProtocol helpers ─────────────────────────────────────────────

function createParser(onMessage) {
  let buf = Buffer.alloc(0)
  return (chunk) => {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= HEADER_LEN) {
      const type = buf[0]
      const id = buf.readUInt32BE(1)
      const ack = buf.readUInt32BE(5)
      const dataLen = buf.readUInt32BE(9)
      const totalLen = HEADER_LEN + dataLen
      if (buf.length < totalLen) break
      const data = buf.slice(HEADER_LEN, totalLen)
      buf = buf.slice(totalLen)
      onMessage({ type, id, ack, data, dataLen })
    }
  }
}

function makeFrame(type, id, ack, data) {
  const buf = Buffer.isBuffer(data) ? data : (data ? Buffer.from(data, "utf8") : Buffer.alloc(0))
  const header = Buffer.alloc(HEADER_LEN)
  header[0] = type
  header.writeUInt32BE(id, 1)
  header.writeUInt32BE(ack, 5)
  header.writeUInt32BE(buf.length, 9)
  return Buffer.concat([header, buf])
}

// ── RPC message decoder (VS Code's RequestMessage protocol) ────────────────

/**
 * Decode a VS Code RPC message from PersistentProtocol data payload.
 *
 * Format (MessageType.RequestJSONArgs = 1):
 *   [1 byte: MessageType] [4 bytes: reqId (BE)] [1 byte: rpcId]
 *   [1 byte: methodLen] [method bytes] [4 bytes: argsLen (BE)] [args JSON]
 *
 * Format (MessageType.RequestMixedArgs = 3):
 *   Same header, but args are type-tagged: [1 byte: ArgType] [payload...]
 *   ArgType: 1=String(4b len + UTF8 JSON), 2=VSBuffer(4b len + raw),
 *            3=SerializedObjectWithBuffers, 4=Undefined
 */
function decodeRpcMessage(data) {
  if (!data || data.length < 6) return null

  const msgType = data[0]
  if (msgType < 1 || msgType > 4) return null

  if (data.length < 5) return null
  const reqId = data.readUInt32BE(1)

  // Common header: msgType(1) + reqId(4)
  let offset = 5

  // Read rpcId (1 byte)
  if (offset >= data.length) return null
  const rpcId = data[offset]
  offset += 1

  // Read method name as short string (1 byte length + content)
  if (offset >= data.length) return null
  const methodLen = data[offset]
  offset += 1
  if (offset + methodLen > data.length) return null
  const method = data.toString("utf8", offset, offset + methodLen)
  offset += methodLen

  // Read args
  let args

  if (msgType === RpcMessageType.RequestJSONArgs || msgType === RpcMessageType.RequestJSONArgsWithCancellation) {
    // JSON-encoded args: 4 byte length + JSON string
    if (offset + 4 > data.length) return { method, rpcId, reqId, msgType, args: [] }
    const argsLen = data.readUInt32BE(offset)
    offset += 4
    if (offset + argsLen > data.length) return { method, rpcId, reqId, msgType, args: [] }
    try {
      args = JSON.parse(data.toString("utf8", offset, offset + argsLen))
    } catch {
      args = [data.toString("utf8", offset, offset + argsLen)]
    }
  } else if (msgType === RpcMessageType.RequestMixedArgs || msgType === RpcMessageType.RequestMixedArgsWithCancellation) {
    // Type-tagged mixed args
    args = []
    if (offset >= data.length) return { method, rpcId, reqId, msgType, args }
    const argCount = data[offset]
    offset += 1
    for (let index = 0; index < argCount && offset < data.length; index += 1) {
      const argType = data[offset]
      offset += 1

      if (argType === RpcArgType.Undefined) {
        args.push(undefined)
      } else if (argType === RpcArgType.VSBuffer) {
        const read = readVSBuffer(data, offset)
        offset = read.offset
        args.push(read.value)
      } else if (argType === RpcArgType.String) {
        const read = readLongString(data, offset)
        offset = read.offset
        try {
          args.push(JSON.parse(read.value))
        } catch {
          args.push(read.value)
        }
      } else if (argType === RpcArgType.SerializedObjectWithBuffers) {
        if (offset + 4 > data.length) break
        const bufferCount = data.readUInt32BE(offset)
        offset += 4
        const stringRead = readLongString(data, offset)
        offset = stringRead.offset
        const buffers = []
        for (let bufferIndex = 0; bufferIndex < bufferCount; bufferIndex += 1) {
          const bufferRead = readVSBuffer(data, offset)
          offset = bufferRead.offset
          buffers.push(bufferRead.value)
        }
        try {
          args.push(restoreSerializedObjectWithBuffers(JSON.parse(stringRead.value), buffers))
        } catch {
          args.push({ value: stringRead.value, buffers })
        }
      } else {
        break
      }
    }
  }

  return { method, rpcId, reqId, msgType, args: args || [] }
}

// ── ExtensionHostServer ───────────────────────────────────────────────────

class ExtensionHostServer extends EventEmitter {
  constructor(options = {}) {
    super()
    this._options = options || {}
    this._process = null
    this._pipeServer = null
    this._pipeName = null
    this._running = false
    this._socket = null
    this._parser = null
    this._msgId = 1
    this._lastReceivedId = 0
    this._callId = 0
    this._installedExtensionsRegistered = false
    /** @type {Record<number, {resolve: function, reject: function, timeout: setTimeout}>} */
    this._pendingCalls = {}
    /** @type {Record<string, function>} */
    this._rpcHandlers = {}
    /** @type {Record<string, function>} */
    this._rpcActorHandlers = {}
    // ── Write batching (W8) ────────────────────────────────────────────
    this._writeBatch = []
    this._writeScheduled = false
  }

  /** Batch socket writes — coalesce multiple frames into one write() call */
  _writeBuffered(buf) {
    this._writeBatch.push(buf)
    if (!this._writeScheduled) {
      this._writeScheduled = true
      setImmediate(() => {
        if (!this._socket || this._socket.destroyed || this._writeBatch.length === 0) {
          this._writeBatch = []
          this._writeScheduled = false
          return
        }
        const frames = this._writeBatch
        this._writeBatch = []
        this._writeScheduled = false
        if (frames.length === 1) {
          this._socket.write(frames[0])
        } else {
          this._socket.write(Buffer.concat(frames))
        }
      })
    }
  }

  /**
   * Register a handler for an incoming RPC method call.
   * The handler receives (args, rpcMeta) and should return the reply value
   * (or a Promise of the reply value).
   */
  onRpc(actorIdOrMethod, methodOrHandler, maybeHandler) {
    if (typeof actorIdOrMethod === "number") {
      const actorId = actorIdOrMethod
      const method = methodOrHandler
      const handler = maybeHandler
      if (typeof method === "string" && typeof handler === "function") {
        this._rpcActorHandlers[`${actorId}:${method}`] = handler
      }
      return
    }

    const method = actorIdOrMethod
    const handler = methodOrHandler
    if (typeof method === "string" && typeof handler === "function") {
      this._rpcHandlers[method] = handler
    }
  }

  get isRunning() {
    return this._running
  }

  whenInstalledExtensionsRegistered(timeoutMs = 30000) {
    if (this._installedExtensionsRegistered) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`Extension host did not become ready after ${timeoutMs}ms`))
      }, timeoutMs)
      const cleanup = () => {
        clearTimeout(timeout)
        this.off?.("ready", onReady)
        this.off?.("stopped", onStopped)
        this.off?.("exit", onExit)
      }
      const onReady = () => {
        cleanup()
        resolve()
      }
      const onStopped = () => {
        cleanup()
        reject(new Error("Extension host stopped before extensions registered"))
      }
      const onExit = () => {
        cleanup()
        reject(new Error("Extension host exited before extensions registered"))
      }
      this.once("ready", onReady)
      this.once("stopped", onStopped)
      this.once("exit", onExit)
    })
  }

  async start(initData = {}) {
    if (this._running) return
    this._stopping = false
    this._initData = initData
    this._installedExtensionsRegistered = false
    this._socket = null
    this._parser = null
    this._msgId = 1
    this._lastReceivedId = 0
    this._callId = 0
    for (const pending of Object.values(this._pendingCalls)) {
      try { clearTimeout(pending.timeout) } catch {}
    }
    this._pendingCalls = {}
    this._writeBatch = []
    this._writeScheduled = false

    this._pipeName = `\\\\.\\pipe\\codek-ext-host-${Date.now()}`
    await this._createPipeServer()
    await this._spawnBundle()
    await this._performHandshake()

    this._running = true
    await this._initializeExtHostServices()
    this._installedExtensionsRegistered = true
    console.log("[ext-host] ✅ Extension host ready")
    this.emit("ready")
  }

  stop() {
    if (!this._running && !this._process) return
    this._stopping = true
    this._running = false
    this._installedExtensionsRegistered = false

    // Send Terminate then close socket
    if (this._socket && !this._socket.destroyed) {
      const socket = this._socket
      this._writeBatch = []
      this._writeScheduled = false
      try {
        socket.write(makeFrame(ProtocolMessageType.Regular, this._msgId++, this._lastReceivedId, Buffer.from([AppMessageType.Terminate])))
      } catch {}
      try { socket.end() } catch {}
      try { socket.destroy() } catch {}
    }
    this._socket = null
    for (const pending of Object.values(this._pendingCalls)) {
      try { clearTimeout(pending.timeout) } catch {}
    }
    this._pendingCalls = {}

    if (this._process) {
      try { this._process.kill() } catch {}
      this._process = null
    }
    if (this._pipeServer) {
      try { this._pipeServer.close() } catch {}
      this._pipeServer = null
    }
    this.emit("stopped")
  }

  /**
   * Send a JSON-RPC style message to the EH as a Regular PersistentProtocol frame.
   */
  send(data) {
    if (!this._socket || this._socket.destroyed || !this._running) return
    const payload = typeof data === "string" ? data : JSON.stringify(data)
    this._writeBuffered(makeFrame(ProtocolMessageType.Regular, this._msgId++, this._lastReceivedId, payload))
  }

  /**
   * Send a ReplyOKJSON response to an RPC request.
   * @param {number} reqId - The request ID from the incoming RPC message
   * @param {*} data - The data to reply with (will be JSON-stringified)
   */
  sendReply(reqId, data) {
    if (!this._socket || this._socket.destroyed || !this._running) return
    const body = data === undefined
      ? this._serializeReplyOKEmpty(reqId)
      : isBufferLike(data)
      ? this._serializeReplyOKVSBuffer(reqId, data)
      : this._serializeReplyOKJSON(reqId, data)
    this._writeBuffered(makeFrame(ProtocolMessageType.Regular, this._msgId++, this._lastReceivedId, body))
  }

  _serializeReplyOKEmpty(reqId) {
    const body = Buffer.alloc(5)
    body[0] = RpcMessageType.ReplyOKEmpty
    body.writeUInt32BE(reqId, 1)
    return body
  }

  _serializeReplyOKJSON(reqId, data) {
    const jsonStr = JSON.stringify(data, (key, val) => {
      // Handle undefined -> null for JSON
      return val === undefined ? null : val
    })
    const jsonBuf = Buffer.from(jsonStr, "utf8")
    const body = Buffer.alloc(5 + 4 + jsonBuf.length)
    body[0] = RpcMessageType.ReplyOKJSON
    body.writeUInt32BE(reqId, 1)
    body.writeUInt32BE(jsonBuf.length, 5)
    jsonBuf.copy(body, 9)
    return body
  }

  _serializeReplyOKVSBuffer(reqId, data) {
    const dataBuf = Buffer.from(data)
    const body = Buffer.alloc(5 + 4 + dataBuf.length)
    body[0] = RpcMessageType.ReplyOKVSBuffer
    body.writeUInt32BE(reqId, 1)
    body.writeUInt32BE(dataBuf.length, 5)
    dataBuf.copy(body, 9)
    return body
  }

  /**
   * Send a ReplyErrError response to an RPC request.
   * @param {number} reqId
   * @param {Error|string} err
   */
  sendError(reqId, err) {
    if (!this._socket || this._socket.destroyed || !this._running) return
    const errObj = {
      $isError: true,
      name: err?.name || "Error",
      message: err?.message || String(err),
      stack: err?.stack || "",
    }
    const errStr = JSON.stringify(errObj)
    const errBuf = Buffer.from(errStr, "utf8")
    const body = Buffer.alloc(5 + 4 + errBuf.length)
    body[0] = RpcMessageType.ReplyErrError
    body.writeUInt32BE(reqId, 1)
    body.writeUInt32BE(errBuf.length, 5)
    errBuf.copy(body, 9)
    this._writeBuffered(makeFrame(ProtocolMessageType.Regular, this._msgId++, this._lastReceivedId, body))
  }

  /**
   * Call a remote method on the Extension Host and wait for the reply.
   *
   * Sends a VS Code RequestJSONArgs RPC message and returns a Promise that
   * resolves with the decoded reply value. Pass
   * `{ usesCancellationToken: true }` as the fifth argument to use VS Code's
   * protocol-level cancellation token instead of serializing a token object.
   *
   * @param {number} rpcId  - The ExtHost proxy identifier (nid) to call
   * @param {string} method - Method name (e.g. "$provideCompletionItems")
   * @param {any[]}  args   - Arguments to pass
   * @param {number} [timeoutMs=30000] - Timeout in milliseconds
   * @returns {Promise<any>}
   */
  call(rpcId, method, args = [], timeoutMs = 30000, options = {}) {
    if (!this._socket || this._socket.destroyed || !this._running) {
      return Promise.reject(new Error("Extension host not running"))
    }

    const callId = ++this._callId
    const argsJson = JSON.stringify(args)

    // Build RequestJSONArgs binary: [1=type] [4=reqId BE] [1=rpcId] [1=methodLen] [method] [4=argsLen BE] [argsJson]
    const methodBuf = Buffer.from(method, "utf8")
    const argsBuf = Buffer.from(argsJson, "utf8")
    const body = Buffer.alloc(1 + 4 + 1 + 1 + methodBuf.length + 4 + argsBuf.length)

    body[0] = options?.usesCancellationToken ? 2 : 1 // MessageType.RequestJSONArgs(WithCancellation)
    body.writeUInt32BE(callId, 1)
    body[5] = rpcId
    body[6] = methodBuf.length
    methodBuf.copy(body, 7)
    body.writeUInt32BE(argsBuf.length, 7 + methodBuf.length)
    argsBuf.copy(body, 7 + methodBuf.length + 4)

    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        delete this._pendingCalls[callId]
        reject(new Error(`RPC call '${method}' timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this._pendingCalls[callId] = { resolve, reject, timeout }
    })

    this._writeBuffered(makeFrame(ProtocolMessageType.Regular, this._msgId++, this._lastReceivedId, body))
    return promise
  }

  // ── Private: Pipe server ────────────────────────────────────────────

  _createPipeServer() {
    return new Promise((resolve, reject) => {
      this._pipeServer = net.createServer((socket) => {
        console.log("[ext-host] EH connected to pipe")
        this._socket = socket

        this._parser = createParser((msg) => this._onFrame(msg))
        socket.on("data", this._parser)

        socket.on("error", (err) => {
          console.error("[ext-host] Pipe error:", err.message)
        })

        socket.on("close", () => {
          console.log("[ext-host] Pipe closed")
          this._socket = null
          this._running = false
          if (!this._stopping) {
            this.emit("exit", -1)
          }
        })

        resolve(socket)
      })

      this._pipeServer.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          this._pipeName = `\\\\.\\pipe\\codek-ext-host-${Date.now() + 1}`
          this._createPipeServer().then(resolve).catch(reject)
          return
        }
        reject(err)
      })

      this._pipeServer.listen(this._pipeName, () => {
        console.log(`[ext-host] Pipe listening: ${this._pipeName}`)
        resolve()
      })
    })
  }

  // ── Private: Spawn EH bundle ────────────────────────────────────────

  _spawnBundle() {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        VSCODE_EXTHOST_IPC_HOOK: this._pipeName,
        VSCODE_ESM_ENTRYPOINT: "vs/workbench/api/node/extensionHostProcess",
        ELECTRON_RUN_AS_NODE: "1",
      }

      const child = spawn("node", ["--experimental-vm-modules", BUNDLE_PATH], {
        env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      })
      this._process = child

      child.stdout.on("data", (d) => {
        const text = d.toString().trim()
        if (text) console.log(`[ext-host] ${text}`)
      })

      child.stderr.on("data", (d) => {
        const text = d.toString().trim()
        if (text) console.error(`[ext-host:err] ${text}`)
      })

      child.on("error", (err) => {
        console.error("[ext-host] Failed to spawn:", err.message)
        reject(err)
      })

      child.on("exit", (code) => {
        console.log(`[ext-host] EH exited with code ${code}`)
        const isCurrentProcess = this._process === child
        if (isCurrentProcess) {
          this._process = null
          this._running = false
        }
        if (isCurrentProcess && !this._stopping) {
          this.emit("exit", code)
        }
      })

      setImmediate(() => resolve())
    })
  }

  // ── Private: Frame handler ──────────────────────────────────────────

  _onFrame(msg) {
    this.emit("frame", msg)

    if (msg.type === ProtocolMessageType.Regular) {
      this._lastReceivedId = msg.id
    }

    if (msg.type !== ProtocolMessageType.Regular) return

    // Check for single-byte app messages
    if (msg.dataLen === 1) {
      const appType = msg.data[0]
      if (appType === AppMessageType.Ready) {
        console.log("[ext-host] ← Ready received")
        this._sendInitData()
        return
      }
      if (appType === AppMessageType.Initialized) {
        console.log("[ext-host] ← Initialized received")
        this.emit("initialized")
        return
      }
    }

    // Multi-byte data: decode the RPC layer
    if (msg.dataLen > 1) {
      const rpcType = msg.data[0]

      // RPC replies (MessageType 7-12) — route to pending call
      if (rpcType >= 7 && rpcType <= 12) {
        this._handleReply(rpcType, msg.data)
        return
      }

      // RPC requests (MessageType 1-4) — decode and handle
      if (rpcType >= 1 && rpcType <= 4) {
        const rpc = decodeRpcMessage(msg.data)
        if (rpc) {
          this.emit("rpc", rpc)
          this._handleRpcRequest(rpc)
        }
      }
      this.emit("message", msg.data)
    }
  }

  /**
   * Handle an RPC reply — match it to a pending call.
   * ReplyOKJSON: [1=type(9)] [4=reqId BE] [4=jsonLen BE] [json]
   * ReplyErrError: [1=type(11)] [4=reqId BE] [4=errLen BE] [errJson]
   */
  _handleReply(rpcType, data) {
    if (data.length < 5) return
    const reqId = data.readUInt32BE(1)
    const pending = this._pendingCalls[reqId]
    if (!pending) return

    clearTimeout(pending.timeout)
    delete this._pendingCalls[reqId]

    if (rpcType === RpcMessageType.ReplyOKJSON) {
      if (data.length < 9) { pending.resolve(undefined); return }
      const jsonLen = data.readUInt32BE(5)
      if (data.length < 9 + jsonLen) { pending.resolve(undefined); return }
      try {
        pending.resolve(JSON.parse(data.toString("utf8", 9, 9 + jsonLen)))
      } catch {
        pending.resolve(undefined)
      }
    } else if (rpcType === RpcMessageType.ReplyOKJSONWithBuffers) {
      if (data.length < 13) { pending.resolve(undefined); return }
      let offset = 5
      const bufferCount = data.readUInt32BE(offset)
      offset += 4
      const stringRead = readLongString(data, offset)
      offset = stringRead.offset
      const buffers = []
      for (let index = 0; index < bufferCount; index += 1) {
        const bufferRead = readVSBuffer(data, offset)
        offset = bufferRead.offset
        buffers.push(bufferRead.value)
      }
      try {
        pending.resolve(restoreSerializedObjectWithBuffers(JSON.parse(stringRead.value), buffers))
      } catch {
        pending.resolve({ value: stringRead.value, buffers })
      }
    } else if (rpcType === RpcMessageType.ReplyOKVSBuffer) {
      const read = readVSBuffer(data, 5)
      pending.resolve(read.value)
    } else if (rpcType === RpcMessageType.ReplyOKEmpty || rpcType === RpcMessageType.ReplyErrEmpty) {
      pending.resolve(undefined)
    } else if (rpcType === RpcMessageType.ReplyErrError) {
      // ReplyErrError
      if (data.length < 9) { pending.reject(new Error("RPC error")); return }
      const errLen = data.readUInt32BE(5)
      try {
        const errObj = JSON.parse(data.toString("utf8", 9, 9 + errLen))
        pending.reject(new Error(errObj.message || String(errObj)))
      } catch {
        pending.reject(new Error("RPC error"))
      }
    }
  }

  /**
   * Handle an incoming RPC request by dispatching to a handler and sending a reply.
   */
  _handleRpcRequest(rpc) {
    const { method, reqId, rpcId } = rpc
    const handler = this._rpcActorHandlers[`${rpcId}:${method}`] || this._rpcHandlers[method]
    const startTime = Date.now()
    const audit = (status, err) => {
      if (typeof this._options.auditApiInvocation !== "function") return
      try {
        this._options.auditApiInvocation({
          action: "extensionHost.rpc",
          status,
          phase: "mainThreadProxy",
          correlationId: `rpc-${reqId}`,
          durationMs: Date.now() - startTime,
          metadata: {
            actorId: rpcId,
            method,
            argShapes: (rpc.args || []).map((arg) => {
              if (arg === undefined) return "undefined"
              if (arg === null) return "null"
              if (Buffer.isBuffer(arg)) return "buffer"
              if (Array.isArray(arg)) return "array"
              return typeof arg
            }),
            errorHash: err ? hashError(err) : undefined,
          },
        })
      } catch {}
    }
    if (process.env.EH_RPC_TRACE) {
      console.log(`[ext-host:rpc] <- #${reqId} ${method} actor=${rpc.rpcId} args=[${summarizeRpcArgs(rpc.args)}]`)
    }
    if (handler) {
      try {
        const result = handler(rpc.args, rpc)
        if (result && typeof result.then === "function") {
          result.then(
            (val) => {
              const elapsed = Date.now() - startTime
              if (elapsed > 1000) console.warn(`[ext-host] Slow handler: ${method} took ${elapsed}ms`)
              if (process.env.EH_RPC_TRACE) console.log(`[ext-host:rpc] -> #${reqId} ${method} ok (${elapsed}ms) ${summarizeRpcValue(val)}`)
              audit("ok")
              this.sendReply(reqId, val)
            },
            (err) => {
              console.error(`[ext-host] Handler error: ${method} → ${err?.message || err}`)
              audit("failed", err)
              this.sendError(reqId, err || new Error("Handler error"))
            }
          )
        } else {
          if (process.env.EH_RPC_TRACE) console.log(`[ext-host:rpc] -> #${reqId} ${method} ok ${summarizeRpcValue(result)}`)
          audit("ok")
          this.sendReply(reqId, result)
        }
      } catch (err) {
        console.error(`[ext-host] Handler exception: ${method} → ${err?.stack || err?.message || err}`)
        audit("failed", err)
        this.sendError(reqId, err || new Error("Handler exception"))
      }
    } else {
      if (process.env.EH_RPC_TRACE) console.log(`[ext-host:rpc] -> #${reqId} ${method} default undefined`)
      audit("unhandled")
      this.sendReply(reqId, undefined)
    }
  }

  // ── Private: Send InitData ──────────────────────────────────────────

  _sendInitData() {
    const rootDir = this._initData.rootDir || __dirname
    const workspaceData = buildWorkspaceData(this._initData)

    // Scan extensions directory for real VS Code extensions. Smoke tests can
    // pass an isolated directory so production/user extensions are not touched.
    const scanned = scanExtensions({
      extensionsDir: this._initData.extensionsDir,
      maxDepth: this._initData.extensionsMaxDepth,
    })

    const initData = JSON.stringify({
      version: "1.96.0",
      quality: "stable",
      commit: "codek-dev",
      parentPid: process.pid,
      environment: {
        isExtensionDevelopmentDebug: false,
        appName: "codek",
        appHost: "desktop",
        appRoot: toFileUriComponents(rootDir),
        appLanguage: "zh-cn",
        isExtensionTelemetryLoggingOnly: false,
        appUriScheme: "file",
        globalStorageHome: toFileUriComponents(path.join(rootDir, ".global-storage")),
        workspaceStorageHome: toFileUriComponents(path.join(rootDir, ".workspace-storage")),
        extensionDevelopmentLocationURI: null,
        extensionTestsLocationURI: null,
      },
      workspace: {
        id: workspaceData.id,
        folders: workspaceData.folders,
        name: workspaceData.name,
        transient: workspaceData.transient,
        configuration: workspaceData.configuration,
      },
      extensions: {
        versionId: 1,
        allExtensions: scanned.allExtensions,
        activationEvents: scanned.activationEvents,
        myExtensions: scanned.allExtensions.map((extension) => extension.identifier),
      },
      telemetryInfo: {
        sessionId: "00000000-0000-0000-0000-000000000000",
        machineId: "codek-machine",
        sqmId: "",
        devDeviceId: "",
        firstSessionDate: new Date().toISOString(),
      },
      logLevel: 3,
      loggers: [],
      logsLocation: toFileUriComponents(path.join(rootDir, ".logs")),
      autoStart: true,
      remote: { isRemote: false, authority: "", connectionData: null },
      consoleForward: { includeStack: false, logNative: false },
      uiKind: 1,
    })

    this._writeBuffered(makeFrame(ProtocolMessageType.Regular, this._msgId++, this._lastReceivedId, initData))
    console.log("[ext-host] → InitData sent")
  }

  async _initializeExtHostServices() {
    const workspaceData = buildWorkspaceData(this._initData)

    await this.call(ExtHostContext.ExtHostConfiguration, "$initializeConfiguration", [buildConfigurationData()], 10000)
    await this.call(ExtHostContext.ExtHostWorkspace, "$initializeWorkspace", [workspaceData, true], 10000)
  }

  // ── Private: Wait for handshake ─────────────────────────────────────

  _performHandshake() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Handshake timeout after 30s"))
      }, 30000)

      this.once("initialized", () => {
        clearTimeout(timeout)
        console.log("[ext-host] ✅✅✅ Handshake complete!")
        resolve()
      })
    })
  }
}

module.exports = {
  ExtHostContext,
  MainContext,
  ExtensionHostServer,
  buildWorkspaceData,
  createParser,
  decodeRpcMessage,
  makeFrame,
}
