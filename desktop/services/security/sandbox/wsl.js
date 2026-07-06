const fs = require("fs")
const os = require("os")
const path = require("path")

let available = null

/**
 * Windows: route agent-sourced commands through WSL when available. The mapping uses
 * `wsl.exe -d <distro> --cd <wsl-path> -- <cmd> <args...>`. We do NOT compose a single
 * bash -c string — argv stays as argv so shellGuard's guarantees hold.
 *
 * If WSL is not installed/registered, the dispatcher falls back to "degraded" mode.
 */
async function isAvailable() {
  if (available !== null) return available
  if (os.platform() !== "win32") { available = false; return false }
  const wslExe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "wsl.exe")
  if (!fs.existsSync(wslExe)) { available = false; return false }
  // Probe `wsl.exe --status`; if it errors, WSL is present but no distro is registered.
  const { _runDirect } = require("./index")
  const r = await _runDirect(wslExe, ["--status"], process.cwd(), {}, 5000, "wsl")
  available = r.success
  return available
}

/**
 * Convert a Windows path (D:\Workspace\foo) to a WSL path (/mnt/d/Codek/foo).
 */
function toWslPath(winPath) {
  const normalized = winPath.replace(/\\/g, "/")
  const m = /^([A-Za-z]):\/(.*)$/.exec(normalized)
  if (!m) return normalized
  return `/mnt/${m[1].toLowerCase()}/${m[2]}`
}

async function run(req, timeoutMs) {
  const { command, args, cwd, env, network } = req
  const wslCwd = toWslPath(cwd)
  // env propagation: WSLENV controls which Windows env vars are exposed in WSL.
  // We pass a minimal explicit env to avoid leaking host secrets.
  const wslEnv = {
    ...env,
    WSLENV: Object.keys(env || {}).join(":") || "PATH/l",
  }
  const wslArgs = ["--cd", wslCwd, "--", command, ...args]
  // Network gating on WSL2 is non-trivial (shared with host). We document this:
  // network=false here is a best-effort marker; full enforcement requires WSL2
  // networking mode = mirrored + firewall rule. The shellGuard + path scoping still apply.
  void network
  const wslExe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "wsl.exe")
  const { _runDirect } = require("./index")
  return _runDirect(wslExe, wslArgs, cwd, wslEnv, timeoutMs, "wsl")
}

module.exports = { isAvailable, run, toWslPath }
