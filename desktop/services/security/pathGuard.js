const path = require("path")
const fs = require("fs")

/**
 * Normalize and validate a path against an allowed root.
 * Rejects: empty input, absolute paths in relative mode, ".." traversal,
 * symlinks that escape the root, and any resolved path outside the root.
 *
 * @param {string} root      Absolute path of the workspace/sandbox root.
 * @param {string} target    Path to validate (absolute or relative).
 * @param {Object} [opts]
 * @param {boolean} [opts.allowAbsolute=false]  When false, absolute `target` is rejected.
 * @param {boolean} [opts.mustExist=false]      When true, validates against the real resolved path.
 * @returns {import('./types').GuardResult}
 */
function validatePath(root, target, opts = {}) {
  const { allowAbsolute = false, mustExist = false } = opts
  if (typeof target !== "string" || target.length === 0) {
    return { ok: false, code: "EMPTY", message: "path is empty" }
  }
  if (typeof root !== "string" || !path.isAbsolute(root)) {
    return { ok: false, code: "BLOCKED", message: "root must be an absolute path" }
  }

  const isAbs = path.isAbsolute(target)
  if (isAbs && !allowAbsolute) {
    return { ok: false, code: "ABSOLUTE", message: "absolute paths are not allowed" }
  }

  // Quick string-level traversal probe before path.resolve collapses it.
  const segments = target.split(/[\\/]+/)
  if (segments.includes("..")) {
    return { ok: false, code: "TRAVERSAL", message: "'..' segments are not allowed" }
  }

  const normalizedRoot = path.resolve(root)
  const resolved = isAbs ? path.resolve(target) : path.resolve(normalizedRoot, target)

  if (!isInside(normalizedRoot, resolved)) {
    return { ok: false, code: "OUT_OF_ROOT", message: "path resolves outside the allowed root" }
  }

  if (mustExist) {
    try {
      const real = fs.realpathSync(resolved)
      if (!isInside(normalizedRoot, real)) {
        return { ok: false, code: "OUT_OF_ROOT", message: "symlink escapes the allowed root" }
      }
      return { ok: true, resolved: real }
    } catch (e) {
      return { ok: false, code: "BLOCKED", message: `realpath failed: ${e.message}` }
    }
  }

  return { ok: true, resolved }
}

function isInside(root, target) {
  const rel = path.relative(root, target)
  if (rel === "") return true
  if (rel.startsWith("..")) return false
  if (path.isAbsolute(rel)) return false
  return true
}

/**
 * Strip any absolute-path prefix and reject traversal. Use for "user passes a relative key"
 * cases where we want to coerce silently instead of throwing.
 * @param {string} input
 * @returns {string|null}  null when input cannot be safely coerced.
 */
function safeRelative(input) {
  if (typeof input !== "string" || input.length === 0) return null
  const normalized = input.replace(/\\/g, "/").replace(/^\/+/, "")
  if (normalized.split("/").includes("..")) return null
  return normalized
}

module.exports = { validatePath, safeRelative, isInside }
