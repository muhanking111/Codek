import { normalizeRelativePath, workspace } from "./manager.js"

const DEFAULT_LIMIT = 1000

function api() {
  return typeof window !== "undefined" ? window.codek || null : null
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function uniquePush(output, seen, pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath || seen.has(relativePath)) return
  seen.add(relativePath)
  output.push(relativePath)
}

function normalizeTreePath(pathValue) {
  return String(pathValue || "").replace(/\\/g, "/")
}

function rootLabel(root) {
  const normalized = normalizeTreePath(root).replace(/\/+$/, "")
  return normalized.split("/").filter(Boolean).pop() || normalized
}

function rootKey(root) {
  const normalized = normalizeTreePath(root).replace(/\/+$/, "")
  return `/${workspace.workspaceRootLabels?.[normalized] || rootLabel(normalized)}`
}

function toWorkspaceRelativePath(root, relativePath) {
  const normalizedRelative = normalizeTreePath(relativePath).replace(/^\/+/, "")
  if (workspace.workspaceRoots?.length > 1) return `${rootKey(root)}/${normalizedRelative}`
  return normalizedRelative
}

function normalizeSearchPayload(response) {
  return response && typeof response === "object" && "ok" in response && "data" in response
    ? (response.ok ? response.data : null)
    : response && typeof response === "object" && "success" in response
      ? (response.success ? response : null)
      : response
}

async function invokeSearchFiles(fsApi, request) {
  if (typeof fsApi?.startSearchFiles === "function") return fsApi.startSearchFiles(request).promise
  if (typeof fsApi?.searchFiles === "function") return fsApi.searchFiles(request)
  if (typeof fsApi?.api === "function") return fsApi.api("POST", "/search/files", request)
  return null
}

function pushSearchMatches(output, seen, matches, fallbackRoot, limit) {
  for (const match of matches || []) {
    const root = normalizeTreePath(match?.root || fallbackRoot || "").replace(/\/+$/, "")
    const relativePath = match?.path || match?.file || ""
    uniquePush(output, seen, root ? toWorkspaceRelativePath(root, relativePath) : relativePath)
    if (output.length >= limit) return true
  }
  return false
}

export async function discoverWorkspaceFiles(options = {}) {
  const limit = Number(options.limit || DEFAULT_LIMIT)
  const query = String(options.query || "")
  const output = []
  const seen = new Set()

  for (const pathValue of Object.keys(workspace.files || {})) uniquePush(output, seen, pathValue)
  for (const pathValue of workspace.openFiles || []) uniquePush(output, seen, pathValue)
  if (workspace.activeFile) uniquePush(output, seen, workspace.activeFile)

  if (output.length >= limit) return output.slice(0, limit)

  const fsApi = api()
  if ((!fsApi?.api && typeof fsApi?.searchFiles !== "function" && typeof fsApi?.startSearchFiles !== "function") || !workspace.projectRoot) {
    return output.slice(0, limit)
  }

  const roots = workspace.workspaceRoots?.length ? workspace.workspaceRoots : [workspace.projectRoot]
  const folderQueries = roots.map((root, index) => ({
    root,
    rootLabel: workspace.workspaceRootLabels?.[normalizeTreePath(root).replace(/\/+$/, "")] || rootLabel(root),
    folderIndex: index,
  }))
  const workspaceResult = await invokeSearchFiles(fsApi, {
    root: roots[0],
    roots,
    folderQueries,
    query,
    maxResults: Math.max(limit * 2, limit),
    regex: false,
    discoverFiles: true,
  }).catch(() => null)
  const workspacePayload = normalizeSearchPayload(workspaceResult)
  if (pushSearchMatches(output, seen, workspacePayload?.matches || [], roots[0], limit)) {
    return output.slice(0, limit)
  }
  if (workspacePayload?.matches?.length) return output.slice(0, limit)

  for (const root of roots) {
    const result = await fsApi.api?.("POST", "/search/files", {
      root,
      query,
      maxResults: Math.max(limit * 2, limit),
      regex: false,
      discoverFiles: true,
    }).catch(() => null)
    const payload = normalizeSearchPayload(result)
    if (pushSearchMatches(output, seen, payload?.matches || [], root, limit)) return output.slice(0, limit)
  }

  return output.slice(0, limit)
}

export function knownWorkspaceFiles(limit = DEFAULT_LIMIT) {
  const output = []
  const seen = new Set()
  for (const pathValue of Object.keys(workspace.files || {})) {
    if (hasOwn(workspace.files, pathValue)) uniquePush(output, seen, pathValue)
    if (output.length >= limit) return output
  }
  for (const pathValue of workspace.openFiles || []) {
    uniquePush(output, seen, pathValue)
    if (output.length >= limit) return output
  }
  if (workspace.activeFile) uniquePush(output, seen, workspace.activeFile)
  return output
}
