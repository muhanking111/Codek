const fs = require("fs")
const os = require("os")

let available = null

/**
 * Linux Landlock requires kernel >= 5.13. Rather than probing landlock directly
 * (which requires syscalls), we look for `bwrap` (bubblewrap) which is the
 * pragmatic mainstream tool for unprivileged namespace sandboxing and is what
 * tools like Codex use on Linux. bwrap gives us: read-only /, writable cwd,
 * writable /tmp, no network when `--unshare-net` is set.
 */
async function isAvailable() {
  if (available !== null) return available
  if (os.platform() !== "linux") { available = false; return false }
  // Prefer bwrap. Fall back to false (degraded mode) if not installed.
  available = fs.existsSync("/usr/bin/bwrap") || fs.existsSync("/usr/local/bin/bwrap")
  return available
}

async function run(req, timeoutMs) {
  const { command, args, cwd, env, network } = req
  const bwrapArgs = [
    "--die-with-parent",
    "--unshare-user", "--unshare-pid", "--unshare-ipc", "--unshare-uts",
    ...(network ? [] : ["--unshare-net"]),
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/lib", "/lib",
    "--ro-bind", "/lib64", "/lib64",
    "--ro-bind", "/bin", "/bin",
    "--ro-bind", "/etc", "/etc",
    "--tmpfs", "/tmp",
    "--bind", cwd, cwd,
    "--chdir", cwd,
    "--proc", "/proc",
    "--dev", "/dev",
    "--",
    command, ...args,
  ]
  const { _runDirect } = require("./index")
  return _runDirect("bwrap", bwrapArgs, cwd, env, timeoutMs, "landlock")
}

module.exports = { isAvailable, run }
