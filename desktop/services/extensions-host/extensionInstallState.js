const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")

function defaultStatePath() {
  const base = process.env.CODEK_DATA || path.join(os.homedir(), ".codek")
  return path.join(base, "User", "extensions", "install-state.json")
}

function defaultBackupRoot() {
  const base = process.env.CODEK_DATA || path.join(os.homedir(), ".codek")
  return path.join(base, "User", "extensions", "backups")
}

function normalizeExtensionId(id) {
  return String(id || "").trim()
}

function safeName(value) {
  return normalizeExtensionId(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "extension"
}

function emptyState() {
  return {
    schemaVersion: 1,
    updatedAt: "",
    extensions: {},
  }
}

function readExtensionInstallState(options = {}) {
  const filePath = options.filePath || defaultStatePath()
  try {
    if (!fs.existsSync(filePath)) return emptyState()
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"))
    return {
      ...emptyState(),
      ...parsed,
      extensions: parsed && typeof parsed.extensions === "object" && !Array.isArray(parsed.extensions)
        ? parsed.extensions
        : {},
    }
  } catch {
    return emptyState()
  }
}

function writeExtensionInstallState(state, options = {}) {
  const filePath = options.filePath || defaultStatePath()
  const normalized = {
    ...emptyState(),
    ...state,
    updatedAt: options.updatedAt || new Date().toISOString(),
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  return normalized
}

function getExtensionInstallRecord(extensionId, options = {}) {
  const id = normalizeExtensionId(extensionId)
  if (!id) return null
  const state = readExtensionInstallState(options)
  return state.extensions[id] || state.extensions[id.toLowerCase()] || null
}

function updateExtensionInstallRecord(extensionId, patch = {}, options = {}) {
  const id = normalizeExtensionId(extensionId)
  if (!id) throw new Error("extensionId is required")
  const state = readExtensionInstallState(options)
  const previous = state.extensions[id] || state.extensions[id.toLowerCase()] || {}
  const record = {
    ...previous,
    id,
    updatedAt: options.updatedAt || new Date().toISOString(),
    ...patch,
  }
  state.extensions[id] = record
  writeExtensionInstallState(state, options)
  return record
}

function listExtensionInstallStates(options = {}) {
  const state = readExtensionInstallState(options)
  return Object.values(state.extensions || {}).sort((a, b) =>
    String(a.id || "").localeCompare(String(b.id || "")),
  )
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function backupExtensionDirectory(extensionId, targetDir, options = {}) {
  const id = normalizeExtensionId(extensionId)
  const resolvedTarget = path.resolve(targetDir || "")
  if (!id || !resolvedTarget || !(await pathExists(resolvedTarget))) return null
  const stat = await fsp.stat(resolvedTarget)
  if (!stat.isDirectory()) return null

  const backupRoot = options.backupRoot || defaultBackupRoot()
  const backupDir = path.join(backupRoot, `${safeName(id)}-${Date.now()}`)
  await fsp.mkdir(path.dirname(backupDir), { recursive: true })
  await fsp.cp(resolvedTarget, backupDir, { recursive: true, force: true })
  return {
    extensionId: id,
    backupDir,
    targetDir: resolvedTarget,
    reason: options.reason || "replace",
    createdAt: new Date().toISOString(),
  }
}

async function restoreExtensionBackup(backup, options = {}) {
  if (!backup?.backupDir || !backup?.targetDir) {
    throw new Error("backup metadata is required")
  }
  const backupDir = path.resolve(backup.backupDir)
  const targetDir = path.resolve(backup.targetDir)
  if (!(await pathExists(backupDir))) {
    throw new Error(`backup not found: ${backupDir}`)
  }
  if (await pathExists(targetDir)) {
    await fsp.rm(targetDir, { recursive: true, force: true })
  }
  await fsp.mkdir(path.dirname(targetDir), { recursive: true })
  await fsp.cp(backupDir, targetDir, { recursive: true, force: true })
  if (options.updateState !== false) {
    updateExtensionInstallRecord(backup.extensionId, {
      status: "rolled-back",
      installPath: targetDir,
      lastRollbackAt: new Date().toISOString(),
      lastBackup: backup,
    }, options)
  }
  return { extensionId: backup.extensionId, targetDir, backupDir }
}

module.exports = {
  backupExtensionDirectory,
  defaultBackupRoot,
  defaultStatePath,
  getExtensionInstallRecord,
  listExtensionInstallStates,
  normalizeExtensionId,
  readExtensionInstallState,
  restoreExtensionBackup,
  safeName,
  updateExtensionInstallRecord,
  writeExtensionInstallState,
}
