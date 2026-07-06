/*---------------------------------------------------------------------------------------------
 *  macOS Sandbox — sandbox-exec with a Seatbelt profile.
 *
 *  Strategy:
 *    1. Render macos/codek.sb with the current projectRoot + network policy.
 *    2. Invoke `sandbox-exec -f <tmp-profile> <command> <args...>`.
 *    3. Promise-resolve with { stdout, stderr, exitCode, killed, backend }.
 *
 *  Note: sandbox-exec is officially deprecated by Apple but still ships in
 *  every macOS release and is what Chromium / Codex / many sandboxing tools
 *  use. We treat its absence as "no sandbox available" and let the caller
 *  decide whether to fall back.
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs")
const path = require("path")
const os = require("os")
const { spawn, execFileSync } = require("child_process")
const crypto = require("crypto")

const SB_TEMPLATE = path.join(__dirname, "macos", "codek.sb")
const MAX_OUTPUT = 1_048_576

let availabilityChecked = false
let available = false

function isAvailable() {
  if (availabilityChecked) return available
  availabilityChecked = true
  try {
    execFileSync("sandbox-exec", ["-h"], { stdio: "ignore" })
    available = true
  } catch {
    available = false
  }
  return available
}

function buildProfile(projectRoot, networkAccess) {
  const tpl = fs.readFileSync(SB_TEMPLATE, "utf8")
  const networkRule = networkAccess ? "(allow network*)" : "(deny network*)"
  // Seatbelt profiles use Lisp-style strings; escape " inside projectRoot.
  const safeRoot = projectRoot.replace(/"/g, '\\"')
  return tpl
    .replace(/\{\{PROJECT_ROOT\}\}/g, safeRoot)
    .replace(/\{\{NETWORK_RULE\}\}/g, networkRule)
}

function runSandboxed({ command, args = [], cwd, projectRoot, timeoutMs, networkAccess, env }) {
  return new Promise((resolve) => {
    const start = Date.now()
    let stdout = ""
    let stderr = ""
    let killed = false

    const useSandbox = isAvailable() && projectRoot
    const backend = useSandbox ? "macos-sandbox-exec" : "macos-spawn-fallback"

    const childEnv = { PATH: process.env.PATH || "", ...(env || {}) }
    if (!networkAccess) {
      childEnv.HTTP_PROXY = ""
      childEnv.HTTPS_PROXY = ""
      childEnv.NO_PROXY = "*"
    }

    let profilePath = null
    let child
    try {
      if (useSandbox) {
        const profile = buildProfile(projectRoot, !!networkAccess)
        profilePath = path.join(os.tmpdir(), `codek-sb-${crypto.randomBytes(4).toString("hex")}.sb`)
        fs.writeFileSync(profilePath, profile, "utf8")
        child = spawn("sandbox-exec", ["-f", profilePath, command, ...args], {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          env: childEnv,
          detached: true,
        })
      } else {
        child = spawn(command, args, {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          env: childEnv,
          detached: true,
        })
      }
    } catch (err) {
      resolve({
        stdout: "", stderr: `[sandbox spawn error: ${err.message}]`,
        exitCode: -1, killed: false, backend, durationMs: Date.now() - start,
      })
      return
    }

    const timer = setTimeout(() => {
      killed = true
      try { if (child.pid) process.kill(-child.pid, "SIGKILL") } catch {}
    }, timeoutMs)

    child.stdout.on("data", (d) => { if (stdout.length < MAX_OUTPUT) stdout += d.toString("utf8") })
    child.stderr.on("data", (d) => { if (stderr.length < MAX_OUTPUT) stderr += d.toString("utf8") })

    const cleanup = () => {
      clearTimeout(timer)
      if (profilePath) { try { fs.unlinkSync(profilePath) } catch {} }
    }

    child.on("error", (err) => {
      cleanup()
      resolve({
        stdout, stderr: stderr + `\n[sandbox spawn error: ${err.message}]`,
        exitCode: -1, killed, backend, durationMs: Date.now() - start,
      })
    })
    child.on("close", (code) => {
      cleanup()
      resolve({
        stdout, stderr,
        exitCode: killed ? -1 : code,
        killed, backend, durationMs: Date.now() - start,
      })
    })
  })
}

module.exports = { runSandboxed, isAvailable }
