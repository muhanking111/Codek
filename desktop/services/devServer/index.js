/**
 * Dev Server — detects project type and starts appropriate dev server.
 * Supports: Vite, Webpack, static files, and custom dev scripts.
 */

const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")
const { EventEmitter } = require("events")

const BASE_PORT = 5199

class DevServer extends EventEmitter {
  constructor() {
    super()
    this._process = null
    this._port = null
    this._type = null
    this._logs = []
  }

  get isRunning() { return this._process !== null && !this._process.killed }
  get port() { return this._port }
  get type() { return this._type }
  get logs() { return [...this._logs] }

  detectType(projectRoot) {
    if (fs.existsSync(path.join(projectRoot, "vite.config.ts")) ||
        fs.existsSync(path.join(projectRoot, "vite.config.js"))) return "vite"
    if (fs.existsSync(path.join(projectRoot, "webpack.config.js")) ||
        fs.existsSync(path.join(projectRoot, "webpack.config.ts"))) return "webpack"
    if (fs.existsSync(path.join(projectRoot, "package.json"))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"))
        if (pkg.scripts?.dev) return "npm-dev"
        if (pkg.scripts?.start) return "npm-start"
      } catch {}
    }
    return "static"
  }

  async start(projectRoot, preferredPort) {
    if (this.isRunning) return

    this._type = this.detectType(projectRoot)
    this._port = preferredPort || BASE_PORT
    this._logs = []

    const cmd = this._buildCommand(projectRoot)
    if (!cmd) { this.emit("error", new Error("No suitable dev server found")); return }

    this._process = spawn(cmd.command, cmd.args, {
      cwd: projectRoot,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PORT: String(this._port), BROWSER: "none" },
    })

    this._process.stdout.on("data", (d) => {
      const text = d.toString()
      this._logs.push(text)
      this.emit("log", text)
    })

    this._process.stderr.on("data", (d) => {
      const text = d.toString()
      this._logs.push(text)
      this.emit("log", text)
    })

    this._process.on("exit", (code) => {
      this._process = null
      this.emit("exit", code)
    })

    this.emit("started", { port: this._port, type: this._type })
  }

  stop() {
    if (this._process) {
      try { this._process.kill() } catch {}
      this._process = null
    }
    this.emit("stopped")
  }

  _buildCommand(projectRoot) {
    switch (this._type) {
      case "vite":
        return { command: "npx", args: ["vite", "--port", String(this._port), "--host"] }
      case "webpack":
        return { command: "npx", args: ["webpack", "serve", "--port", String(this._port)] }
      case "npm-dev":
        return { command: "npm", args: ["run", "dev", "--", "--port", String(this._port)] }
      case "npm-start":
        return { command: "npm", args: ["start", "--", "--port", String(this._port)] }
      default:
        return { command: "npx", args: ["serve", "-p", String(this._port), "."] }
    }
  }
}

let _devServer = null

function register(router) {
  _devServer = new DevServer()

  router.register("POST", "/api/dev-server/start", async ({ body }) => {
    const projectRoot = body?.projectRoot || process.cwd()
    try {
      await _devServer.start(projectRoot, body?.port)
      return { success: true, port: _devServer.port, type: _devServer.type }
    } catch (err) {
      throw new Error(`Failed to start dev server: ${err.message}`)
    }
  })

  router.register("POST", "/api/dev-server/stop", async () => {
    _devServer.stop()
    return { success: true }
  })

  router.register("GET", "/api/dev-server/status", async () => {
    return {
      running: _devServer.isRunning,
      port: _devServer.port,
      type: _devServer.type,
      logs: _devServer.logs.slice(-50),
    }
  })
}

module.exports = { DevServer, register }
