/*
 * Adapted from VS Code:
 * - src/vs/platform/files/common/files.ts
 * - src/vs/platform/files/common/fileService.ts
 *
 * This module keeps Electron fs:listDir/fs:stat on the same FileType/stat
 * contract as the renderer vscode-adapter layer without importing TypeScript
 * into main.
 */

const path = require("path")

const FileType = Object.freeze({
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
})

const FilePermission = Object.freeze({
  Readonly: 1,
  Locked: 2,
  Executable: 4,
})

function createDirectoryEntryLimitSentinel({ parentPath, totalEntries, readDurationMs }) {
  return {
    name: "...",
    path: path.join(parentPath, "__codek_dir_entry_limit__"),
    type: FileType.File,
    isDirectory: false,
    isDir: false,
    isFile: true,
    isSymbolicLink: false,
    size: 0,
    mtime: 0,
    mtimeMs: 0,
    ctime: 0,
    ctimeMs: 0,
    limitReason: "children",
    truncated: true,
    totalEntries: Math.max(0, Number(totalEntries || 0)),
    readDurationMs: Math.max(0, Number(readDurationMs || 0)),
  }
}

async function mapDirentsToFileServiceEntries({ fsPromises, parentPath, dirents, includeStats = false }) {
  const entries = []
  for (const dirent of Array.isArray(dirents) ? dirents : []) {
    entries.push(await mapDirentToFileServiceEntry({ fsPromises, parentPath, dirent, includeStats }))
  }
  return entries
}

async function mapDirentToFileServiceEntry({ fsPromises, parentPath, dirent, includeStats = false }) {
  const name = String(dirent?.name || "")
  const entryPath = path.join(parentPath, name)
  const direntType = getFileTypeFromDirent(dirent)
  const stat = includeStats ? await statBestEffort(fsPromises, entryPath, direntType) : null
  const type = stat?.type ?? direntType
  const mtime = numberOrZero(stat?.mtime)
  const ctime = numberOrZero(stat?.ctime)
  const size = numberOrZero(stat?.size)
  const permissions = stat?.permissions

  return {
    name,
    path: entryPath,
    type,
    isDirectory: hasType(type, FileType.Directory),
    isDir: hasType(type, FileType.Directory),
    isFile: hasType(type, FileType.File),
    isSymbolicLink: hasType(type, FileType.SymbolicLink),
    size,
    mtime,
    mtimeMs: mtime,
    ctime,
    ctimeMs: ctime,
    readonly: hasPermission(permissions, FilePermission.Readonly),
    locked: hasPermission(permissions, FilePermission.Locked),
    executable: hasPermission(permissions, FilePermission.Executable),
    permissions,
  }
}

function mapStatToFileServiceEntry({ filePath, stat, sizeOverride }) {
  const fileStat = statToFileServiceStat(stat)
  const size = Number.isFinite(Number(sizeOverride)) && Number(sizeOverride) >= 0
    ? Number(sizeOverride)
    : fileStat.size
  const mtime = numberOrZero(fileStat.mtime)
  const ctime = numberOrZero(fileStat.ctime)
  const type = fileStat.type
  const permissions = fileStat.permissions

  return {
    exists: true,
    name: path.basename(String(filePath || "")),
    path: String(filePath || ""),
    type,
    isDirectory: hasType(type, FileType.Directory),
    isDir: hasType(type, FileType.Directory),
    isFile: hasType(type, FileType.File),
    isSymbolicLink: hasType(type, FileType.SymbolicLink),
    size,
    mtime,
    mtimeMs: mtime,
    ctime,
    ctimeMs: ctime,
    readonly: hasPermission(permissions, FilePermission.Readonly),
    locked: hasPermission(permissions, FilePermission.Locked),
    executable: hasPermission(permissions, FilePermission.Executable),
    permissions,
  }
}

function getFileTypeFromDirent(dirent) {
  let type = FileType.Unknown
  if (dirent?.isFile?.()) type |= FileType.File
  if (dirent?.isDirectory?.()) type |= FileType.Directory
  if (dirent?.isSymbolicLink?.()) type |= FileType.SymbolicLink
  return type
}

async function statBestEffort(fsPromises, entryPath, fallbackType) {
  try {
    const stat = await fsPromises.stat(entryPath)
    const fileStat = statToFileServiceStat(stat)
    return {
      ...fileStat,
      type: mergeFileType(fileStat.type, fallbackType),
    }
  } catch {
    return {
      type: fallbackType,
      size: 0,
      mtime: 0,
      ctime: 0,
      permissions: undefined,
    }
  }
}

function mergeFileType(statType, fallbackType) {
  let type = Number(statType || FileType.Unknown)
  if (hasType(fallbackType, FileType.SymbolicLink)) type |= FileType.SymbolicLink
  return type
}

function statToFileServiceStat(stat) {
  let type = FileType.Unknown
  if (stat?.isFile?.()) type |= FileType.File
  if (stat?.isDirectory?.()) type |= FileType.Directory
  if (stat?.isSymbolicLink?.()) type |= FileType.SymbolicLink
  return {
    type,
    size: numberOrZero(stat?.size),
    mtime: numberOrZero(stat?.mtimeMs),
    ctime: numberOrZero(stat?.ctimeMs),
    permissions: normalizePermissions(stat),
  }
}

function normalizePermissions(stat) {
  if (!stat || typeof stat.mode !== "number") return undefined
  let permissions = 0
  if ((stat.mode & 0o222) === 0) permissions |= FilePermission.Readonly
  if ((stat.mode & 0o111) !== 0) permissions |= FilePermission.Executable
  return permissions || undefined
}

function hasType(type, flag) {
  return (Number(type || 0) & flag) === flag
}

function hasPermission(permissions, flag) {
  return typeof permissions === "number" && (permissions & flag) === flag
}

function numberOrZero(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

module.exports = {
  FileType,
  FilePermission,
  createDirectoryEntryLimitSentinel,
  mapDirentToFileServiceEntry,
  mapDirentsToFileServiceEntries,
  mapStatToFileServiceEntry,
}
