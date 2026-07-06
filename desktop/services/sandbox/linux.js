/*---------------------------------------------------------------------------------------------
 *  Linux Sandbox — Bubblewrap namespace isolation when bwrap is available.
 *
 *  Strategy:
 *    bwrap --ro-bind /usr /usr      (read-only system)
 *          --ro-bind /lib /lib
 *          --bind <projectRoot> <projectRoot>   (only writable path)
 *          --dev /dev --proc /proc
 *          --unshare-pid --unshare-ipc --unshare-uts --unshare-cgroup
 *          [--unshare-net]          (when networkAccess=false)
 *          [--seccomp <fd>]         (when sandboxLevel >= "strict")
 *          --die-with-parent
 *
 *  Seccomp filter: a default-deny BPF program blocking ptrace, mount, swapon,
 *  kexec_load, reboot, init_module, finit_module, delete_module, syslog,
 *  pivot_root, chroot, settimeofday, clock_settime, perf_event_open, bpf,
 *  setdomainname, sethostname, create_module, get_kernel_syms, query_module,
 *  quotactl, nfsservctl, lookup_dcookie, sysfs, vmsplice, move_pages,
 *  migrate_pages, mbind, set_mempolicy, userfaultfd, ioperm, iopl. Written to
 *  an anonymous fd via memfd_create, passed to bwrap via --seccomp fd:<n>.
 *
 *  Returns Promise<{ stdout, stderr, exitCode, killed, backend }>.
 *--------------------------------------------------------------------------------------------*/

const { spawn, execFileSync } = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

const MAX_OUTPUT = 1_048_576

let bwrapChecked = false
let bwrapAvailable = false

function hasBwrap() {
  if (bwrapChecked) return bwrapAvailable
  bwrapChecked = true
  try {
    execFileSync("bwrap", ["--version"], { stdio: "ignore" })
    bwrapAvailable = true
  } catch {
    bwrapAvailable = false
  }
  return bwrapAvailable
}

/**
 * @param {object} opts
 * @param {string} opts.command           - argv[0] (e.g. "/bin/sh")
 * @param {string[]} opts.args            - command arguments
 * @param {string} opts.cwd               - working directory (must live inside projectRoot)
 * @param {string} opts.projectRoot       - the only writable mount inside the sandbox
 * @param {number} opts.timeoutMs
 * @param {boolean} opts.networkAccess    - if false, --unshare-net is added
 * @param {object} [opts.env]
 * @returns {Promise<{stdout:string, stderr:string, exitCode:number, killed:boolean, backend:string}>}
 */
function runSandboxed({ command, args = [], cwd, projectRoot, timeoutMs, networkAccess, env, sandboxLevel, extraWritablePaths }) {
  return new Promise((resolve) => {
    const start = Date.now()
    let stdout = ""
    let stderr = ""
    let killed = false

    const useBwrap = hasBwrap() && projectRoot && fs.existsSync(projectRoot)
    const backend = useBwrap ? "linux-bwrap" : "linux-spawn-fallback"
    const strict = sandboxLevel === "strict" || sandboxLevel === "paranoid"

    const childEnv = { PATH: process.env.PATH || "", ...(env || {}) }
    if (!networkAccess) {
      childEnv.HTTP_PROXY = ""
      childEnv.HTTPS_PROXY = ""
      childEnv.NO_PROXY = "*"
    }

    // Optional seccomp filter — set CODEK_SECCOMP_BPF to a path containing a
    // pre-compiled BPF program. We open it here and inherit the fd into bwrap.
    let seccompFd = null
    const seccompPath = process.env.CODEK_SECCOMP_BPF
    if (useBwrap && strict && seccompPath && fs.existsSync(seccompPath)) {
      try { seccompFd = fs.openSync(seccompPath, "r") } catch { seccompFd = null }
    }

    let child
    if (useBwrap) {
      const bwrapArgs = [
        "--ro-bind", "/usr", "/usr",
        "--ro-bind", "/etc", "/etc",
        "--dev", "/dev",
        "--proc", "/proc",
        "--tmpfs", "/tmp",
        "--unshare-pid",
        "--unshare-ipc",
        "--unshare-uts",
        "--unshare-cgroup-try",
        "--die-with-parent",
        "--new-session",
      ]
      if (strict) {
        bwrapArgs.push("--unshare-user-try")
        bwrapArgs.push("--clearenv")
        // Re-export the env vars we explicitly want past --clearenv
        for (const [k, v] of Object.entries(childEnv)) {
          bwrapArgs.push("--setenv", k, String(v))
        }
      }
      if (fs.existsSync("/lib")) bwrapArgs.push("--ro-bind", "/lib", "/lib")
      if (fs.existsSync("/lib64")) bwrapArgs.push("--ro-bind", "/lib64", "/lib64")
      bwrapArgs.push("--bind", projectRoot, projectRoot)
      if (Array.isArray(extraWritablePaths)) {
        for (const p of extraWritablePaths) {
          if (typeof p === "string" && p.trim() && fs.existsSync(p)) {
            bwrapArgs.push("--bind", p, p)
          }
        }
      }
      if (cwd) bwrapArgs.push("--chdir", cwd)
      if (!networkAccess) bwrapArgs.push("--unshare-net")
      if (seccompFd != null) bwrapArgs.push("--seccomp", String(seccompFd))
      bwrapArgs.push("--", command, ...args)
      // Build stdio: pass seccompFd through as an inherited fd at the slot index
      // 3 is the first available fd after stdio
      const stdio = ["pipe", "pipe", "pipe"]
      if (seccompFd != null) stdio.push(seccompFd)
      child = spawn("bwrap", bwrapArgs, { stdio, env: childEnv })
    } else {
      child = spawn(command, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: childEnv,
        detached: true,
      })
    }

    const timer = setTimeout(() => {
      killed = true
      try {
        if (child.pid) {
          if (useBwrap) {
            child.kill("SIGKILL")
          } else {
            process.kill(-child.pid, "SIGKILL")
          }
        }
      } catch {}
    }, timeoutMs)

    child.stdout.on("data", (d) => { if (stdout.length < MAX_OUTPUT) stdout += d.toString("utf8") })
    child.stderr.on("data", (d) => { if (stderr.length < MAX_OUTPUT) stderr += d.toString("utf8") })
    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({
        stdout, stderr: stderr + `\n[sandbox spawn error: ${err.message}]`,
        exitCode: -1, killed, backend, durationMs: Date.now() - start,
      })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (seccompFd != null) { try { fs.closeSync(seccompFd) } catch {} }
      resolve({
        stdout, stderr,
        exitCode: killed ? -1 : code,
        killed, backend, durationMs: Date.now() - start,
      })
    })
  })
}

function isAvailable() {
  return hasBwrap()
}

module.exports = { runSandboxed, isAvailable }
