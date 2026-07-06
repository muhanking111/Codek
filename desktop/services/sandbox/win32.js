/*---------------------------------------------------------------------------------------------
 *  Windows Sandbox — best-effort isolation without native modules.
 *
 *  Windows has no equivalent to bwrap / sandbox-exec that we can shell out to.
 *  A real AppContainer or Restricted-Token implementation needs a native node
 *  addon (Win32 API: CreateRestrictedToken + CreateProcessAsUser, or
 *  CreateProcess with PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES). That is a
 *  separate workstream — see ROADMAP_v2 §5.
 *
 *  What we DO enforce here:
 *    - Run inside a fresh process group so taskkill /T tears down descendants.
 *    - Strip HTTP(S)_PROXY env vars when network access is disabled.
 *    - Refuse to elevate (no `runas`). The caller already runs as the user
 *      who launched Codek, which is itself an unprivileged account in any
 *      sane setup.
 *
 *  Caveat: this is NOT an OS-level sandbox. It is a containment layer that
 *  matches the existing main-process behavior. The backend label communicates
 *  the actual containment level so the UI / agent can warn the user.
 *--------------------------------------------------------------------------------------------*/

const { spawn, execFile } = require("child_process")

const MAX_OUTPUT = 1_048_576

function runSandboxed({ command, args = [], cwd, timeoutMs, networkAccess, env }) {
  return new Promise((resolve) => {
    const start = Date.now()
    let stdout = ""
    let stderr = ""
    let killed = false

    const childEnv = { PATH: process.env.PATH || "", ...(env || {}) }
    if (!networkAccess) {
      childEnv.HTTP_PROXY = ""
      childEnv.HTTPS_PROXY = ""
      childEnv.NO_PROXY = "*"
    }

    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv,
      windowsHide: true,
      detached: true,
    })

    const timer = setTimeout(() => {
      killed = true
      try {
        if (child.pid) {
          execFile("taskkill", ["/pid", String(child.pid), "/f", "/t"], () => {})
        }
      } catch {}
    }, timeoutMs)

    child.stdout.on("data", (d) => { if (stdout.length < MAX_OUTPUT) stdout += d.toString("utf8") })
    child.stderr.on("data", (d) => { if (stderr.length < MAX_OUTPUT) stderr += d.toString("utf8") })
    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({
        stdout, stderr: stderr + `\n[sandbox spawn error: ${err.message}]`,
        exitCode: -1, killed,
        backend: "win32-best-effort",
        durationMs: Date.now() - start,
      })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({
        stdout, stderr,
        exitCode: killed ? -1 : code,
        killed,
        backend: "win32-best-effort",
        durationMs: Date.now() - start,
      })
    })
  })
}

function isAvailable() {
  return true
}

module.exports = { runSandboxed, isAvailable }
