const os = require("os")
const { spawn } = require("child_process")

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_OUTPUT = 1_048_576

/**
 * @typedef {Object} SandboxRequest
 * @property {string}   command
 * @property {string[]} args
 * @property {string}   cwd              Workspace root (also the sandbox writable root).
 * @property {Object}   [env]
 * @property {number}   [timeoutMs]
 * @property {boolean}  [network=false]  Default: no network for agent calls.
 * @property {'user'|'agent'} source
 *
 * @typedef {Object} SandboxResult
 * @property {boolean} success
 * @property {string}  output
 * @property {string}  error
 * @property {number}  exitCode
 * @property {number}  executionTimeMs
 * @property {string}  backend          'seatbelt' | 'landlock' | 'wsl' | 'degraded' | 'direct'
 */

const seatbelt = require("./seatbelt")
const landlock = require("./landlock")
const wsl = require("./wsl")

/**
 * Choose the best sandbox backend for this OS. The result is memoized after the first
 * probe so we don't shell out to `wsl.exe --status` on every IPC call.
 */
let cachedBackend = null
async function chooseBackend() {
  if (cachedBackend) return cachedBackend
  const platform = os.platform()
  if (platform === "darwin" && (await seatbelt.isAvailable())) {
    cachedBackend = "seatbelt"
  } else if (platform === "linux" && (await landlock.isAvailable())) {
    cachedBackend = "landlock"
  } else if (platform === "win32" && (await wsl.isAvailable())) {
    cachedBackend = "wsl"
  } else {
    cachedBackend = "degraded"
  }
  return cachedBackend
}

/**
 * Execute a command under the platform's sandbox. For source: 'user' we bypass and
 * spawn directly — the user has full authority. For source: 'agent' we route through
 * the sandbox backend and disable network by default.
 *
 * @param {SandboxRequest} req
 * @returns {Promise<SandboxResult>}
 */
async function spawnSandboxed(req) {
  const timeoutMs = req.timeoutMs || DEFAULT_TIMEOUT_MS
  if (req.source === "user") {
    return runDirect(req.command, req.args, req.cwd, req.env, timeoutMs, "direct")
  }
  const backend = await chooseBackend()
  if (backend === "seatbelt") return seatbelt.run(req, timeoutMs)
  if (backend === "landlock") return landlock.run(req, timeoutMs)
  if (backend === "wsl") return wsl.run(req, timeoutMs)
  // Degraded mode: no OS sandbox available. We've already passed pathGuard + shellGuard,
  // so the call surface is narrowed, but the caller should surface a UI indicator.
  return runDirect(req.command, req.args, req.cwd, req.env, timeoutMs, "degraded")
}

function runDirect(cmd, args, cwd, env, timeoutMs, backendTag) {
  return new Promise((resolve) => {
    const start = Date.now()
    let stdout = ""
    let stderr = ""
    let killed = false
    const child = spawn(cmd, args, {
      cwd,
      env: { PATH: process.env.PATH || "", ...(env || {}) },
      windowsHide: true,
      // Critical: never shell:true — argv form only.
    })
    const timer = setTimeout(() => {
      killed = true
      try { child.kill("SIGKILL") } catch {}
    }, timeoutMs)
    child.stdout.on("data", (d) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString("utf8")
    })
    child.stderr.on("data", (d) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString("utf8")
    })
    child.on("error", (e) => {
      clearTimeout(timer)
      resolve({
        success: false, output: stdout, error: e.message, exitCode: -1,
        executionTimeMs: Date.now() - start, backend: backendTag,
      })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (killed) {
        resolve({
          success: false, output: stdout, error: `Execution timeout after ${timeoutMs}ms`,
          exitCode: -1, executionTimeMs: timeoutMs, backend: backendTag,
        })
        return
      }
      resolve({
        success: code === 0, output: stdout, error: stderr, exitCode: code,
        executionTimeMs: Date.now() - start, backend: backendTag,
      })
    })
  })
}

function currentBackend() {
  return cachedBackend
}

function resetBackendCache() {
  cachedBackend = null
}

module.exports = {
  spawnSandboxed,
  chooseBackend,
  currentBackend,
  resetBackendCache,
  // exported for backend modules to share the direct-spawn path:
  _runDirect: runDirect,
  MAX_OUTPUT,
  DEFAULT_TIMEOUT_MS,
}
