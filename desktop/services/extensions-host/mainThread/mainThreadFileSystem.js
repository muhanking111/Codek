/**
 * MainThreadFileSystem — handles file system operations from the Extension Host.
 *
 * RPC handlers:
 *   $stat(resource)              → IStat { type, ctime, mtime, size }
 *   $readdir(resource)           → [string, FileType][]
 *   $readFile(resource)          → VSBuffer (Buffer)
 *   $writeFile(resource, buffer) → void
 *   $rename(resource, target)    → void
 *   $copy(resource, target)      → void
 *   $mkdir(resource)             → void
 *   $delete(resource, opts)      → void
 *   $ensureActivation(scheme)    → void
 *   $registerFileSystemProvider(...) → void (no-op for remote providers)
 *
 * All file operations use Node's fs module directly (main process).
 */

const fs = require("fs")
const fsp = require("fs/promises")
const path = require("path")
const { fileUriPathToFsPath } = require("../uriComponents")

const MAIN_THREAD_FILE_SYSTEM_NID = 50

// FileType enum matching VS Code's values
const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
}

/** Convert a UriComponents to a local file path */
function uriToPath(uri) {
  if (!uri) return null
  if (uri.scheme && uri.scheme !== "file") return null // Only handle file:// URIs
  let p = uri.path || uri.fsPath || ""
  return fileUriPathToFsPath(p)
}

function toNodeBuffer(content) {
  if (Buffer.isBuffer(content)) return content
  if (content instanceof Uint8Array) return Buffer.from(content)
  if (Array.isArray(content)) return Buffer.from(content)
  if (content && Buffer.isBuffer(content.buffer)) return content.buffer
  if (content && content.buffer instanceof Uint8Array) return Buffer.from(content.buffer)
  if (content && Array.isArray(content.data)) return Buffer.from(content.data)
  if (content && Array.isArray(content.value)) return Buffer.from(content.value)
  if (typeof content === "string") return Buffer.from(content, "utf8")
  return Buffer.alloc(0)
}

/** Determine FileType from fs.Stat */
function getFileType(stat) {
  if (stat.isSymbolicLink()) return FileType.SymbolicLink | (stat.isFile() ? FileType.File : FileType.Directory)
  if (stat.isFile()) return FileType.File
  if (stat.isDirectory()) return FileType.Directory
  return FileType.Unknown
}

function codeError(code, message) {
  const error = new Error(message || code)
  error.code = code
  error.name = code
  return error
}

async function assertCanOverwrite(targetPath, overwrite, code = "EEXIST") {
  if (overwrite) return
  try {
    await fsp.stat(targetPath)
    throw codeError(code, `${code}: ${targetPath}`)
  } catch (err) {
    if (err.code === "ENOENT") return
    throw err
  }
}

function onRpc(server, method, handler) {
  server.onRpc(MAIN_THREAD_FILE_SYSTEM_NID, method, handler)
  server.onRpc(method, handler)
}

function register(server) {
  // ── Core file operations ────────────────────────────────────────────

  onRpc(server, "$stat", async (args) => {
    const [resource] = args || []
    const filePath = uriToPath(resource)
    if (!filePath) return { type: FileType.Unknown, ctime: 0, mtime: 0, size: 0 }

    try {
      const stat = await fsp.stat(filePath)
      return {
        type: getFileType(stat),
        ctime: stat.birthtimeMs,
        mtime: stat.mtimeMs,
        size: stat.size,
        permissions: stat.mode,
      }
    } catch (err) {
      throw new Error(`ENOENT: ${filePath}`)
    }
  })

  onRpc(server, "$readdir", async (args) => {
    const [resource] = args || []
    const dirPath = uriToPath(resource)
    if (!dirPath) return []

    try {
      const entries = await fsp.readdir(dirPath, { withFileTypes: true })
      return entries.map((entry) => {
        let type = FileType.Unknown
        if (entry.isFile()) type = FileType.File
        else if (entry.isDirectory()) type = FileType.Directory
        else if (entry.isSymbolicLink()) type = FileType.SymbolicLink
        return [entry.name, type]
      })
    } catch (err) {
      throw new Error(`ENOENT: ${dirPath}`)
    }
  })

  onRpc(server, "$readFile", async (args) => {
    const [resource] = args || []
    const filePath = uriToPath(resource)
    if (!filePath) throw new Error("Invalid URI")

    try {
      const content = await fsp.readFile(filePath)
      // Return as Buffer (VS Code expects VSBuffer which is similar to Buffer)
      // The reply serializer will handle Buffer → wire format
      return content
    } catch (err) {
      if (err.code === "ENOENT") throw new Error(`ENOENT: ${filePath}`)
      throw err
    }
  })

  onRpc(server, "$writeFile", async (args) => {
    const [resource, content] = args || []
    const filePath = uriToPath(resource)
    if (!filePath) return

    try {
      // Ensure parent directory exists
      await fsp.mkdir(path.dirname(filePath), { recursive: true })
      await fsp.writeFile(filePath, toNodeBuffer(content))
    } catch (err) {
      throw err
    }
  })

  onRpc(server, "$rename", async (args) => {
    const [resource, target, opts] = args || []
    const srcPath = uriToPath(resource)
    const dstPath = uriToPath(target)
    if (!srcPath || !dstPath) return

    try {
      await fsp.mkdir(path.dirname(dstPath), { recursive: true })
      await assertCanOverwrite(dstPath, opts?.overwrite === true)
      if (opts?.overwrite === true) {
        await fsp.rm(dstPath, { recursive: true, force: true })
      }
      await fsp.rename(srcPath, dstPath)
    } catch (err) {
      throw err
    }
  })

  onRpc(server, "$copy", async (args) => {
    const [resource, target, opts] = args || []
    const srcPath = uriToPath(resource)
    const dstPath = uriToPath(target)
    if (!srcPath || !dstPath) return

    try {
      await fsp.mkdir(path.dirname(dstPath), { recursive: true })
      await assertCanOverwrite(dstPath, opts?.overwrite === true)
      await fsp.cp(srcPath, dstPath, { recursive: true, force: opts?.overwrite === true, errorOnExist: opts?.overwrite !== true })
    } catch (err) {
      throw err
    }
  })

  onRpc(server, "$mkdir", async (args) => {
    const [resource] = args || []
    const dirPath = uriToPath(resource)
    if (!dirPath) return

    try {
      await fsp.mkdir(dirPath, { recursive: true })
    } catch (err) {
      throw err
    }
  })

  onRpc(server, "$delete", async (args) => {
    const [resource, opts] = args || []
    const filePath = uriToPath(resource)
    if (!filePath) return

    try {
      const stat = await fsp.stat(filePath)
      if (stat.isDirectory()) {
        if (opts?.recursive !== true) {
          const entries = await fsp.readdir(filePath)
          if (entries.length > 0) throw codeError("ENOTEMPTY", `ENOTEMPTY: ${filePath}`)
        }
        await fsp.rm(filePath, { recursive: opts?.recursive === true, force: true })
      } else {
        await fsp.unlink(filePath)
      }
    } catch (err) {
      if (err.code !== "ENOENT") throw err
    }
  })

  // ── Activation ──────────────────────────────────────────────────────

  onRpc(server, "$ensureActivation", (args) => {
    const [scheme] = args || []
    void scheme
    // No-op — Codek handles all file:// URIs natively
    return undefined
  })

  // ── Provider registration (no-op for built-in file:// provider) ───

  onRpc(server, "$registerFileSystemProvider", () => {
    // Extension-registered file system providers are not supported yet
    return undefined
  })

  onRpc(server, "$unregisterProvider", () => {
    return undefined
  })
}

module.exports = { MAIN_THREAD_FILE_SYSTEM_NID, register, toNodeBuffer, uriToPath }
