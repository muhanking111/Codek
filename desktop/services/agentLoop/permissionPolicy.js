const path = require("node:path")

const SAFE_QUALITY_GATE_COMMANDS = Object.freeze([
  "npm run typecheck",
  "npm run build",
  "npm test",
  "npm run test",
  "node --test",
  "node --check",
])

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").trim()
}

function normalizeCommand(value) {
  return String(value || "").trim().replace(/\s+/g, " ")
}

function isSubPath(file, allowedRoot) {
  const normalizedFile = normalizePath(file)
  const normalizedRoot = normalizePath(allowedRoot)
  if (!normalizedFile || !normalizedRoot) return false
  if (normalizedRoot === "." || normalizedRoot === "*" || normalizedRoot === "当前工作区") return true
  const relative = path.posix.relative(normalizedRoot, normalizedFile)
  return normalizedFile === normalizedRoot || (relative && !relative.startsWith("..") && !path.posix.isAbsolute(relative))
}

function isPathAllowed(file, allowedPaths = []) {
  const normalized = normalizePath(file)
  const allowed = (allowedPaths || []).map(normalizePath).filter(Boolean)
  return allowed.some((root) => isSubPath(normalized, root))
}

function commandRequiresNetwork(command) {
  return /\b(install|download|publish|deploy|push|curl|wget|npm\s+i|npm\s+install|pnpm\s+install|yarn\s+install|pip\s+install|cargo\s+install)\b/i.test(command)
}

function commandRequiresInstall(command) {
  return /\b(install|npm\s+i|npm\s+install|pnpm\s+install|yarn\s+install|pip\s+install|cargo\s+install)\b/i.test(command)
}

function commandRequiresExternalTool(command) {
  return /\b(push|publish|deploy|gh\s+|vercel\s+|netlify\s+|docker\s+push)\b/i.test(command)
}

function isCommandAllowed(command, permissionRequest = {}) {
  const normalized = normalizeCommand(command)
  if (!normalized) return true
  const allowlist = (permissionRequest.commandAllowlist || []).map(normalizeCommand).filter(Boolean)
  const safe = SAFE_QUALITY_GATE_COMMANDS.some((allowed) => normalized === allowed || normalized.startsWith(`${allowed} `))
  const explicit = allowlist.some((allowed) => normalized === allowed || normalized.startsWith(`${allowed} `))
  return safe || explicit
}

function validatePatchPermissions(run, filesChanged = []) {
  const permission = run?.permissionRequest || null
  if (!permission || permission.status !== "approved") return { ok: true, violations: [] }
  const violations = (filesChanged || [])
    .map(normalizePath)
    .filter(Boolean)
    .filter((file) => !isPathAllowed(file, permission.writePaths || []))
  return {
    ok: violations.length === 0,
    violations,
  }
}

function validateCommandPermissions(run, commands = []) {
  const permission = run?.permissionRequest || null
  const violations = []
  for (const command of commands || []) {
    const normalized = normalizeCommand(command)
    if (!normalized) continue
    if (permission?.status === "approved") {
      if (!isCommandAllowed(normalized, permission)) violations.push({ command: normalized, reason: "命令不在允许列表中" })
      if (commandRequiresNetwork(normalized) && !permission.network) violations.push({ command: normalized, reason: "命令需要网络权限" })
      if (commandRequiresInstall(normalized) && !permission.install) violations.push({ command: normalized, reason: "命令需要安装依赖权限" })
      if (commandRequiresExternalTool(normalized) && !permission.externalTool) violations.push({ command: normalized, reason: "命令需要外部工具权限" })
      continue
    }
    if (!isCommandAllowed(normalized, {})) violations.push({ command: normalized, reason: "高风险命令需要先获得权限" })
  }
  return {
    ok: violations.length === 0,
    violations,
  }
}

function createPermissionViolationMessage(violations, type) {
  if (!violations?.length) return ""
  if (type === "patch") {
    return `权限越界: proposed patch 包含未授权写路径 ${violations.join(", ")}`
  }
  return `权限越界: ${violations.map((item) => `${item.command}(${item.reason})`).join("; ")}`
}

module.exports = {
  SAFE_QUALITY_GATE_COMMANDS,
  commandRequiresExternalTool,
  commandRequiresInstall,
  commandRequiresNetwork,
  createPermissionViolationMessage,
  isCommandAllowed,
  isPathAllowed,
  validateCommandPermissions,
  validatePatchPermissions,
}
