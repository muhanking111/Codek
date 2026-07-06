/**
 * TypeScript Language Service — spawns tsserver and provides LSP via JSON-RPC.
 *
 * tsserver protocol: Content-Length headers + JSON body (standard LSP transport).
 * Spawned as a child process from the Electron main process.
 * Exposes HTTP routes for the renderer to call.
 */

const { spawn } = require("child_process")
const path = require("path")
const fs = require("fs")

const TSSERVER_REQUEST_TIMEOUT_MS = 30000
const TSSERVER_NOTIFICATION_TIMEOUT_MS = 1500

// Resolve tsserver path
const TSSERVER_PATH = (() => {
  const paths = [
    path.join(__dirname, "..", "..", "..", "frontend", "vite-project", "node_modules", "typescript", "lib", "tsserver.js"),
    path.join(__dirname, "..", "..", "node_modules", "typescript", "lib", "tsserver.js"),
  ]
  for (const p of paths) {
    if (fs.existsSync(p)) return p
  }
  return "tsserver" // fallback to PATH
})()

class TSLanguageService {
  constructor() {
    this._process = null
    this._running = false
    this._pending = new Map()
    this._reqId = 0
    this._buffer = ""
    this._projectRoot = ""
  }

  start(projectRoot = "") {
    if (this._running) this.stop()
    this._projectRoot = projectRoot
    this._running = true
    this._buffer = ""

    // Use spawn with stdio for LSP protocol
    const tsPath = TSSERVER_PATH
    if (!fs.existsSync(tsPath) && tsPath !== "tsserver") {
      console.error(`[lsp] tsserver not found at ${tsPath}`)
      this._running = false
      return
    }

    this._process = spawn("node", [tsPath, "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    })

    this._process.stdout.on("data", (chunk) => {
      this._buffer += chunk.toString()
      this._processMessages()
    })

    this._process.stderr.on("data", (chunk) => {
      console.error("[lsp:tsserver]", chunk.toString().trim())
    })

    this._process.on("exit", (code) => {
      console.log(`[lsp] tsserver exited with code ${code}`)
      this._running = false
      for (const [id, { reject }] of this._pending) {
        reject(new Error(`tsserver exited: ${code}`))
      }
      this._pending.clear()
    })

    console.log(`[lsp] tsserver started (${path.basename(tsPath)})`)
  }

  stop() {
    if (this._process) {
      try { this._process.stdin.end() } catch {}
      try { this._process.kill() } catch {}
      this._process = null
    }
    this._running = false
  }

  /**
   * Send a command to tsserver and wait for response.
   * Returns the response body matching the request sequence id.
   */
  async sendCommand(command, args = {}) {
    if (!this._running) throw new Error("Language service not running")

    const seq = ++this._reqId
    const body = JSON.stringify({
      seq,
      type: "request",
      command,
      arguments: args,
    })
    const msg = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this._pending.has(seq)) {
          this._pending.delete(seq)
          reject(new Error(`tsserver command '${command}' timed out`))
        }
      }, TSSERVER_REQUEST_TIMEOUT_MS)
      this._pending.set(seq, { resolve, reject, timeout })
      this._process.stdin.write(msg)
    })
  }

  async sendBestEffortCommand(command, args = {}, timeoutMs = TSSERVER_NOTIFICATION_TIMEOUT_MS) {
    if (!this._running) return { success: false, skipped: true }

    const seq = ++this._reqId
    const body = JSON.stringify({
      seq,
      type: "request",
      command,
      arguments: args,
    })
    const msg = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`

    return new Promise((resolve) => {
      let settled = false
      let timeout = null
      const finish = (result) => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        this._pending.delete(seq)
        resolve(result)
      }

      this._pending.set(seq, {
        resolve: () => finish({ success: true }),
        reject: () => finish({ success: false }),
      })

      try {
        this._process.stdin.write(msg, (error) => {
          if (error) {
            finish({ success: false, error: error.message })
            return
          }
          finish({ success: true, wrote: true })
        })
      } catch (error) {
        finish({ success: false, error: error?.message || String(error) })
        return
      }

      timeout = setTimeout(() => {
        finish({ success: false, timeout: true, command })
      }, Math.max(0, timeoutMs))
    })
  }

  _processMessages() {
    // Parse Content-Length headers + JSON body
    const headerRe = /Content-Length:\s*(\d+)\r\n\r\n/

    while (this._buffer.length > 0) {
      const match = this._buffer.match(headerRe)
      if (!match) break

      const headerEnd = match.index + match[0].length
      const contentLength = parseInt(match[1], 10)
      const bodyStart = headerEnd

      if (this._buffer.length < bodyStart + contentLength) break

      const bodyStr = this._buffer.slice(bodyStart, bodyStart + contentLength)
      this._buffer = this._buffer.slice(bodyStart + contentLength)

      try {
        const msg = JSON.parse(bodyStr)
        this._handleMessage(msg)
      } catch (e) {
        // Parse error — skip
      }
    }
  }

  _handleMessage(msg) {
    // Response to a request
    if (msg.type === "response" && this._pending.has(msg.request_seq)) {
      const entry = this._pending.get(msg.request_seq)
      this._pending.delete(msg.request_seq)
      if (entry.timeout) clearTimeout(entry.timeout)
      entry.resolve(msg)
      return
    }

    // Event (diagnostics, etc.)
    if (msg.type === "event") {
      // Events are handled by the caller via the event system
      // For now, we ignore tsserver events since diagnostics are
      // requested explicitly via geterr
    }
  }

  // ── High-level API ─────────────────────────────────────────────────────

  async openFile(filePath, content) {
    return this.sendBestEffortCommand("open", { file: filePath, fileContent: content || "" })
  }

  async closeFile(filePath) {
    return this.sendBestEffortCommand("close", { file: filePath })
  }

  async changeFile(filePath, content) {
    return this.sendBestEffortCommand("change", { file: filePath, line: 0, offset: 0, endLine: 0, endOffset: 0, insertString: content })
  }

  async getCompletions(filePath, line, offset) {
    const res = await this.sendCommand("completions", {
      file: filePath, line, offset,
      prefix: "",
      includeExternalModuleExports: true,
      includeInsertTextCompletions: true,
    })
    return res?.body || []
  }

  async getQuickInfo(filePath, line, offset) {
    const res = await this.sendCommand("quickinfo", { file: filePath, line, offset })
    return res?.body || null
  }

  async getDefinition(filePath, line, offset) {
    const res = await this.sendCommand("definition", { file: filePath, line, offset })
    return res?.body || []
  }

  async getDiagnostics(filePath) {
    // tsserver sends diagnostics as events after geterr. We request them
    // and collect the response via a promise with a short timeout.
    const res = await this.sendCommand("geterr", {
      files: [filePath],
      delay: 100,
    })
    return res
  }

  async getReferences(filePath, line, offset) {
    const res = await this.sendCommand("references", { file: filePath, line, offset })
    return res?.body || { refs: [] }
  }

  async getNavTree(filePath) {
    const res = await this.sendCommand("navtree", { file: filePath })
    return res?.body || null
  }
}

// ── HTTP Router Registration ──────────────────────────────────────────────

function register(router, opts = {}) {
  const ls = new TSLanguageService()

  router.register("POST", "/lsp/start", async ({ body }) => {
    ls.start(body?.projectRoot || "")
    return { success: true }
  })

  router.register("POST", "/lsp/stop", async () => {
    ls.stop()
    return { success: true }
  })

  router.register("POST", "/lsp/open", async ({ body }) => {
    const result = await ls.openFile(body?.file, body?.content)
    return { success: true, lspNotification: result }
  })

  router.register("POST", "/lsp/change", async ({ body }) => {
    const result = await ls.changeFile(body?.file, body?.content)
    return { success: true, lspNotification: result }
  })

  router.register("POST", "/lsp/close", async ({ body }) => {
    const result = await ls.closeFile(body?.file)
    return { success: true, lspNotification: result }
  })

  router.register("POST", "/lsp/completions", async ({ body }) => {
    const result = await ls.getCompletions(body?.file, body?.line, body?.offset)
    return { entries: result }
  })

  router.register("POST", "/lsp/quickinfo", async ({ body }) => {
    const result = await ls.getQuickInfo(body?.file, body?.line, body?.offset)
    return { info: result }
  })

  router.register("POST", "/lsp/definition", async ({ body }) => {
    const result = await ls.getDefinition(body?.file, body?.line, body?.offset)
    return { definitions: result }
  })

  router.register("POST", "/lsp/diagnostics", async ({ body }) => {
    await ls.getDiagnostics(body?.file)
    return { success: true }
  })

  router.register("POST", "/lsp/references", async ({ body }) => {
    const result = await ls.getReferences(body?.file, body?.line, body?.offset)
    return { refs: result?.refs || [] }
  })

  router.register("POST", "/lsp/navtree", async ({ body }) => {
    const result = await ls.getNavTree(body?.file)
    return { tree: result }
  })

  router.register("GET", "/lsp/status", async () => ({
    running: ls._running,
  }))
}

module.exports = { register, TSLanguageService }
