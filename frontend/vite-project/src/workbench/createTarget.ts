import {
  URI,
  basename as resourceBasename,
  dirname as resourceDirname,
  extUriIgnorePathCase,
  joinPath as resourceJoinPath,
  normalizePath as normalizeResourcePath,
  originalFSPath,
} from "../vscode-adapter/base/common"

export type ExplorerCreateKind = "file" | "dir" | "folder" | ""
export type ExplorerCreateSource =
  | "explicit"
  | "selected-directory"
  | "selected-file-parent"
  | "selected-directory-fallback"
  | "active-file-parent"
  | "workspace-root"

export interface ExplorerCreateRoot {
  path: string
  label?: string
}

export interface ExplorerCreateTargetInput {
  explicitParentPath?: string | null
  selectedPath?: string | null
  selectedKind?: ExplorerCreateKind | null
  selectedDir?: string | null
  activeFile?: string | null
  projectRoot?: string | null
  projectName?: string | null
  workspaceRoots?: string[] | ExplorerCreateRoot[] | null
  workspaceRootLabels?: Record<string, string> | null
}

export interface CreateTargetSnapshot {
  workspaceRoot: string
  rootLabel: string
  parentPath: string
  parentLabel: string
  parentKind: "root" | "directory" | "file-parent"
  source: ExplorerCreateSource
  selectedPathAtStart: string | null
  activeFileAtStart: string | null
  displayLabel: string
  resolvedAbsoluteParent: string
}

export function resolveExplorerCreateParent(input: ExplorerCreateTargetInput): string {
  return resolveExplorerCreateTargetSnapshot(input).parentPath
}

export function resolveExplorerCreateTargetSnapshot(input: ExplorerCreateTargetInput): CreateTargetSnapshot {
  const explicitParent = normalizePath(input.explicitParentPath)
  if (explicitParent) return createSnapshot(input, explicitParent, "explicit", "directory")

  const selectedPath = normalizePath(input.selectedPath)
  const selectedKind = normalizeKind(input.selectedKind)
  if (selectedPath && selectedKind === "dir") return createSnapshot(input, selectedPath, "selected-directory", "directory")
  if (selectedPath && selectedKind === "file") return createSnapshot(input, dirname(selectedPath), "selected-file-parent", "file-parent")

  const selectedDir = normalizePath(input.selectedDir)
  if (selectedDir) return createSnapshot(input, selectedDir, "selected-directory-fallback", "directory")

  const activeFile = normalizePath(input.activeFile)
  if (activeFile) return createSnapshot(input, dirname(activeFile), "active-file-parent", "file-parent")

  return createSnapshot(input, "", "workspace-root", "root")
}

export function describeCreateParent(parent: string | CreateTargetSnapshot): string {
  if (typeof parent === "object" && parent) return parent.displayLabel
  const normalized = normalizePath(parent as string)
  return normalized || "项目根目录"
}

export function dirname(pathValue: string): string {
  const normalized = normalizePath(pathValue)
  const parent = toDisplayPath(resourceDirname(toResource(normalized)))
  if (!isVirtualRootPath(normalized)) return parent
  return parent ? `/${parent.replace(/^\/+/, "")}` : ""
}

function normalizeKind(kind: ExplorerCreateKind | null | undefined): "file" | "dir" | "" {
  if (kind === "folder") return "dir"
  if (kind === "file" || kind === "dir") return kind
  return ""
}

function normalizePath(pathValue: string | null | undefined): string {
  const raw = String(pathValue || "").replace(/\\/g, "/")
  if (!raw) return ""
  if (isVirtualRootPath(raw)) return normalizeVirtualPath(raw)
  return toDisplayPath(toResource(raw))
}

function createSnapshot(
  input: ExplorerCreateTargetInput,
  parentPath: string,
  source: ExplorerCreateSource,
  parentKind: CreateTargetSnapshot["parentKind"],
): CreateTargetSnapshot {
  const normalizedParent = normalizePath(parentPath)
  const root = resolveWorkspaceRoot(input, normalizedParent)
  const parentLabel = normalizedParent ? basename(normalizedParent) : root.label
  const displayLabel = normalizedParent ? normalizedParent : root.label
  return {
    workspaceRoot: root.path,
    rootLabel: root.label,
    parentPath: normalizedParent,
    parentLabel,
    parentKind,
    source,
    selectedPathAtStart: normalizePath(input.selectedPath) || null,
    activeFileAtStart: normalizePath(input.activeFile) || null,
    displayLabel,
    resolvedAbsoluteParent: resolveAbsoluteParent(root.path, normalizedParent, root.label),
  }
}

function resolveWorkspaceRoot(input: ExplorerCreateTargetInput, parentPath: string): { path: string; label: string } {
  const roots = normalizeRoots(input)
  const labels = input.workspaceRootLabels || {}
  const selectedRoot = roots.find((root) => pathBelongsToRoot(parentPath, root.path, root.label))
    || roots.find((root) => pathBelongsToRoot(normalizePath(input.selectedPath), root.path, root.label))
    || roots.find((root) => pathBelongsToRoot(normalizePath(input.activeFile), root.path, root.label))
    || roots[0]

  if (selectedRoot) {
    return {
      path: selectedRoot.path,
      label: selectedRoot.label || labels[selectedRoot.path] || basename(selectedRoot.path) || String(input.projectName || "项目"),
    }
  }

  const rootPath = normalizePath(input.projectRoot)
  return {
    path: rootPath,
    label: labels[rootPath] || basename(rootPath) || String(input.projectName || "项目"),
  }
}

function normalizeRoots(input: ExplorerCreateTargetInput): ExplorerCreateRoot[] {
  const labels = input.workspaceRootLabels || {}
  const roots = Array.isArray(input.workspaceRoots) ? input.workspaceRoots : []
  const normalized = roots
    .map((root) => {
      if (typeof root === "string") return { path: normalizePath(root), label: labels[normalizePath(root)] || basename(root) }
      return { path: normalizePath(root?.path), label: root?.label || labels[normalizePath(root?.path)] || basename(root?.path || "") }
    })
    .filter((root) => root.path)
  const projectRoot = normalizePath(input.projectRoot)
  if (!normalized.length && projectRoot) {
    normalized.push({ path: projectRoot, label: labels[projectRoot] || basename(projectRoot) || String(input.projectName || "项目") })
  }
  return normalized
}

function pathBelongsToRoot(pathValue: string, rootPath: string, rootLabel = ""): boolean {
  const path = normalizePath(pathValue)
  const root = normalizePath(rootPath)
  const label = normalizePath(rootLabel)
  if (!path || !root) return false
  if (isAbsoluteFsPath(path) && isAbsoluteFsPath(root)) {
    return extUriIgnorePathCase.isEqualOrParent(toResource(path), toResource(root))
  }
  if (!label) return false
  const virtualRoot = normalizePath(`/${label}`)
  if (!isVirtualRootPath(path) || !virtualRoot) return false
  return extUriIgnorePathCase.isEqualOrParent(toResource(path), toResource(virtualRoot))
}

function resolveAbsoluteParent(rootPath: string, parentPath: string, rootLabel: string): string {
  const root = normalizePath(rootPath)
  const parent = normalizePath(parentPath)
  if (!parent) return root
  if (isAbsoluteFsPath(parent)) return parent
  if (parent.startsWith("/")) {
    const virtualPrefix = normalizePath(`/${rootLabel}`)
    if (root && extUriIgnorePathCase.isEqual(toResource(parent), toResource(virtualPrefix))) return root
    if (root && extUriIgnorePathCase.isEqualOrParent(toResource(parent), toResource(virtualPrefix))) {
      const relative = extUriIgnorePathCase.relativePath(toResource(virtualPrefix), toResource(parent))
      return relative ? toDisplayPath(resourceJoinPath(toResource(root), relative)) : root
    }
    return parent
  }
  return root ? toDisplayPath(resourceJoinPath(toResource(root), parent)) : parent
}

function basename(pathValue: string): string {
  const normalized = normalizePath(pathValue)
  return resourceBasename(toResource(normalized)) || normalized
}

function isAbsoluteFsPath(pathValue: string): boolean {
  return /^[A-Za-z]:\//.test(pathValue) || pathValue.startsWith("//")
}

function isVirtualRootPath(pathValue: string): boolean {
  return pathValue.startsWith("/") && !pathValue.startsWith("//") && !/^\/[A-Za-z]:\//.test(pathValue)
}

function normalizeVirtualPath(pathValue: string): string {
  const normalized = toDisplayPath(toResource(pathValue))
  return normalized.startsWith("/") ? normalized : `/${normalized}`
}

function toResource(pathValue: string): URI {
  const value = String(pathValue || "").replace(/\\/g, "/")
  if (isAbsoluteFsPath(value)) return normalizeResourcePath(URI.file(value))
  if (value.startsWith("/")) return normalizeResourcePath(URI.from({ scheme: "codek", path: value }))
  return normalizeResourcePath(URI.from({ scheme: "codek", path: `/${value}` }))
}

function toDisplayPath(resource: URI): string {
  const normalized = resource.path.replace(/\/+$/, "")
  if (resource.scheme === "file") {
    return originalFSPath(resource).replace(/\\/g, "/").replace(/\/+$/, "")
  }
  if (normalized === "/" || normalized === ".") return ""
  return normalized.startsWith("/") ? normalized.slice(1) : normalized
}
