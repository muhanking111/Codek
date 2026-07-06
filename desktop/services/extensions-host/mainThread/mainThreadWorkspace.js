/**
 * MainThreadWorkspace — handles workspace operations from the Extension Host.
 *
 * RPC handlers:
 *   $computeWorkspaceFolders()     — Return current workspace folders
 *   $resolveWorkspaceFolder(uri)   — Resolve a URI to a workspace folder
 *   $save(uri, options)            — Save a file
 *   $updateWorkspaceFolders(...)   — Update workspace folders
 */

const path = require("path")
const { fileUriPathToFsPath, toFileUriComponents } = require("../uriComponents")

const MAIN_THREAD_WORKSPACE_NID = 49

let workspaceRoots = []
let workspaceFile = null

function setWorkspaceRoot(root) {
  setWorkspaceRoots(root ? [root] : [], null)
}

function setWorkspaceRoots(roots, nextWorkspaceFile = null) {
  workspaceRoots = normalizeRoots(roots)
  workspaceFile = nextWorkspaceFile || null
}

function normalizeRoots(roots) {
  return [...new Set((Array.isArray(roots) ? roots : [])
    .map((root) => typeof root === "string" ? normalizeDriveLetter(path.resolve(root)) : "")
    .filter(Boolean))]
}

function normalizeDriveLetter(filePath) {
  return String(filePath || "").replace(/^([a-z]):[\\/]/, (match, drive) => `${drive.toUpperCase()}${match.slice(1)}`)
}

function getWorkspaceFolders() {
  return workspaceRoots.map((root, index) => ({
    uri: toFileUriComponents(root),
    name: path.basename(root) || root,
    index,
  }))
}

function getWorkspaceData() {
  const folders = getWorkspaceFolders()
  return {
    folders,
    workspaceFile: workspaceFile ? toFileUriComponents(workspaceFile) : null,
  }
}

function uriToFsPath(uri) {
  if (!uri) return ""
  if (uri.scheme && uri.scheme !== "file") return ""
  const uriPath = uri.fsPath || (uri.path ? fileUriPathToFsPath(uri.path) : "")
  return uriPath ? normalizeDriveLetter(path.resolve(uriPath)) : ""
}

function isEqualOrChild(candidate, root) {
  const relative = path.relative(root, candidate)
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

function spliceWorkspaceFolders(index, deleteCount, foldersToAdd) {
  const nextRoots = [...workspaceRoots]
  const start = Math.max(0, Math.min(Number.isFinite(index) ? index : 0, nextRoots.length))
  const removeCount = Math.max(0, Number.isFinite(deleteCount) ? deleteCount : 0)
  const additions = (Array.isArray(foldersToAdd) ? foldersToAdd : [])
    .map((folder) => uriToFsPath(folder?.uri) || (typeof folder?.path === "string" ? folder.path : ""))
    .filter(Boolean)
    .map((folderPath) => normalizeDriveLetter(path.resolve(folderPath)))
  nextRoots.splice(start, removeCount, ...additions)
  workspaceRoots = normalizeRoots(nextRoots)
}

function register(server, opts = {}) {
  if (Array.isArray(opts.workspaceRoots)) {
    setWorkspaceRoots(opts.workspaceRoots, opts.workspaceFile || null)
  } else if (typeof opts.workspaceRoot === "string") {
    setWorkspaceRoot(opts.workspaceRoot)
  }

  server.onRpc(MAIN_THREAD_WORKSPACE_NID, "$computeWorkspaceFolders", () => {
    return getWorkspaceFolders()
  })

  server.onRpc(MAIN_THREAD_WORKSPACE_NID, "$resolveWorkspaceFolder", (args) => {
    const [uri] = args || []
    const resourcePath = uriToFsPath(uri)
    if (!resourcePath) return undefined
    return getWorkspaceFolders().find((folder) => isEqualOrChild(resourcePath, uriToFsPath(folder.uri))) || undefined
  })

  server.onRpc(MAIN_THREAD_WORKSPACE_NID, "$save", (args) => {
    const [uri, options] = args || []
    if (!uri) return undefined
    // Save is handled by the editor — return the URI as-is
    return uri
  })

  server.onRpc(MAIN_THREAD_WORKSPACE_NID, "$saveAll", () => {
    return true
  })

  server.onRpc(MAIN_THREAD_WORKSPACE_NID, "$updateWorkspaceFolders", (args) => {
    const [extensionName, index, deleteCount, foldersToAdd] = args || []
    spliceWorkspaceFolders(Number(index), Number(deleteCount), foldersToAdd)
    opts.sendToRenderer?.("ext-host:workspace-folders-updated", {
      extensionName: typeof extensionName === "string" ? extensionName : "",
      workspaceFile,
      folders: getWorkspaceFolders(),
    })
    return undefined
  })

  // Expose workspaceRoot setter to other modules
  if (opts.setWorkspaceRoot) {
    opts.setWorkspaceRoot(setWorkspaceRoot)
  }
  if (opts.setWorkspaceRoots) {
    opts.setWorkspaceRoots(setWorkspaceRoots)
  }
}

module.exports = {
  MAIN_THREAD_WORKSPACE_NID,
  getWorkspaceData,
  register,
  setWorkspaceRoot,
  setWorkspaceRoots,
}
