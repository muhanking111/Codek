const path = require("path")

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "")
}

function unique(items) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    const normalized = normalizePath(item)
    if (!normalized) continue
    const key = process.platform === "win32" ? normalized.toLowerCase() : normalized
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

function resolveFolderPath(folder, workspaceFilePath) {
  if (!folder || typeof folder !== "object") return ""
  const rawPath = typeof folder.path === "string" ? folder.path : ""
  const uri = typeof folder.uri === "string" ? folder.uri : ""
  const value = rawPath || (uri.startsWith("file://") ? decodeURIComponent(uri.slice("file://".length)) : "")
  if (!value) return ""
  if (path.isAbsolute(value)) return path.resolve(value)
  return path.resolve(path.dirname(workspaceFilePath), value)
}

function parseWorkspaceContent(content, workspaceFilePath) {
  let parsed
  try {
    parsed = JSON.parse(String(content || ""))
  } catch (err) {
    throw new Error(`无法解析 .code-workspace: ${err.message}`)
  }

  const folders = Array.isArray(parsed.folders) ? parsed.folders : []
  const roots = unique(folders.map((folder) => resolveFolderPath(folder, workspaceFilePath)))
  return {
    path: normalizePath(workspaceFilePath),
    roots,
    folders: folders
      .map((folder) => {
        const resolved = resolveFolderPath(folder, workspaceFilePath)
        if (!resolved) return null
        return {
          path: resolved,
          name: typeof folder.name === "string" ? folder.name : path.basename(resolved),
        }
      })
      .filter(Boolean)
      .filter((folder, index, all) => all.findIndex((item) => {
        const a = normalizePath(item.path)
        const b = normalizePath(folder.path)
        return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
      }) === index),
    settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {},
  }
}

function buildWorkspaceContent(roots, settings = {}) {
  const folders = unique(roots.map((root) => typeof root === "string" ? root : root?.path))
    .map((root) => {
      const source = roots.find((item) => typeof item === "object" && normalizePath(item.path) === root) || {}
      const folder = { path: normalizePath(root) }
      if (typeof source.name === "string" && source.name.trim()) folder.name = source.name.trim()
      return folder
    })
  return `${JSON.stringify({ folders, settings }, null, 2)}\n`
}

function getWorkspaceRootDescriptors(workspace) {
  const folders = Array.isArray(workspace?.folders) ? workspace.folders : []
  const roots = Array.isArray(workspace?.roots) ? workspace.roots : []
  const source = folders.length ? folders : roots.map((root) => ({ path: root }))
  return source.map((folder, index) => {
    const rootPath = normalizePath(folder.path)
    return {
      id: `root-${index + 1}`,
      name: folder.name || path.basename(rootPath) || `root-${index + 1}`,
      path: rootPath,
    }
  }).filter((root) => root.path)
}

function isPathInsideRoot(filePath, rootPath) {
  if (!filePath || !rootPath) return false
  const relative = path.relative(path.resolve(rootPath), path.resolve(filePath))
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

function resolveRootForPath(workspace, filePath) {
  const roots = getWorkspaceRootDescriptors(workspace)
    .filter((root) => isPathInsideRoot(filePath, root.path))
    .sort((a, b) => b.path.length - a.path.length)
  return roots[0] || null
}

function assertPathInWorkspace(workspace, filePath) {
  const root = resolveRootForPath(workspace, filePath)
  if (!root) {
    const err = new Error("目标路径不在当前 .code-workspace 的任一 root 边界内。")
    err.code = "WORKSPACE_ROOT_BOUNDARY"
    err.filePath = filePath
    throw err
  }
  return root
}

function renameWorkspaceRoot(workspace, rootPath, name) {
  const normalized = normalizePath(rootPath)
  const folders = getWorkspaceRootDescriptors(workspace).map((folder) =>
    normalizePath(folder.path) === normalized ? { path: folder.path, name } : { path: folder.path, name: folder.name },
  )
  return { ...workspace, folders, roots: folders.map((folder) => folder.path) }
}

function removeWorkspaceRoot(workspace, rootPath) {
  const normalized = normalizePath(rootPath)
  const folders = getWorkspaceRootDescriptors(workspace)
    .filter((folder) => normalizePath(folder.path) !== normalized)
    .map((folder) => ({ path: folder.path, name: folder.name }))
  return { ...workspace, folders, roots: folders.map((folder) => folder.path) }
}

module.exports = {
  assertPathInWorkspace,
  buildWorkspaceContent,
  getWorkspaceRootDescriptors,
  isPathInsideRoot,
  normalizePath,
  parseWorkspaceContent,
  removeWorkspaceRoot,
  renameWorkspaceRoot,
  resolveRootForPath,
}
