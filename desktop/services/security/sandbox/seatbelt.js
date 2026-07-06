const fs = require("fs")
const os = require("os")
const path = require("path")
const crypto = require("crypto")

let available = null

async function isAvailable() {
  if (available !== null) return available
  if (os.platform() !== "darwin") { available = false; return false }
  available = fs.existsSync("/usr/bin/sandbox-exec")
  return available
}

/**
 * macOS Seatbelt profile that grants:
 *   - read everywhere (needed for system libs & node_modules)
 *   - write only within the workspace root and /private/tmp
 *   - exec everywhere (so spawned child binaries still resolve)
 *   - network: deny by default; allow when req.network === true
 *
 * @param {string} cwd
 * @param {boolean} allowNetwork
 */
function buildProfile(cwd, allowNetwork) {
  const escapedCwd = cwd.replace(/"/g, '\\"')
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    "(allow process-exec)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow file-read*)",
    `(allow file-write* (subpath "${escapedCwd}"))`,
    '(allow file-write* (subpath "/private/tmp"))',
    '(allow file-write* (subpath "/private/var/folders"))',
    allowNetwork ? "(allow network*)" : "(deny network*)",
    "(allow mach-lookup)",
    "(allow ipc-posix-shm)",
  ].join("\n")
}

async function run(req, timeoutMs) {
  const { command, args, cwd, env, network } = req
  const tmpProfile = path.join(os.tmpdir(), `codek-sb-${crypto.randomBytes(4).toString("hex")}.sb`)
  fs.writeFileSync(tmpProfile, buildProfile(cwd, !!network), "utf8")
  const sbArgs = ["-f", tmpProfile, command, ...args]
  try {
    const { _runDirect } = require("./index")
    const r = await _runDirect("sandbox-exec", sbArgs, cwd, env, timeoutMs, "seatbelt")
    return r
  } finally {
    try { fs.unlinkSync(tmpProfile) } catch {}
  }
}

module.exports = { isAvailable, run }
