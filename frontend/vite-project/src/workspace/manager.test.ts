import { afterEach, describe, expect, it } from "vitest"
import {
  findInProject,
  createFile,
  createDir,
  deleteFile,
  getWorkspaceRootInfo,
  getLargeFileState,
  canRedoLargeFileSegmentEdit,
  canUndoLargeFileSegmentEdit,
  loadNextLargeFileWindow,
  loadPreviousLargeFileWindow,
  MAX_EDITABLE_FILE_BYTES,
  openProject,
  openWorkspaceFile,
  openProjectPath,
  openFile,
  openVirtualTextResource,
  pasteEntry,
  readLines,
  readProjectFile,
  reloadFile,
  redoLargeFileSegmentEdit,
  restoreOpenFiles,
  saveFile,
  isDirty,
  isReadOnlyFile,
  LARGE_FILE_EDITOR_RENDER_BYTES,
  LARGE_FILE_IPC_CHUNK_BYTES,
  LARGE_FILE_SAFE_RENDER_LINE_CHARS,
  LARGE_FILE_SAFE_RENDER_LINES_PER_WINDOW,
  LARGE_FILE_WINDOWING_BYTES,
  normalizeLargeFilePreviewContent,
  renameEntry,
  searchTextInProject,
  copyEntry,
  refreshFileTree,
  workspace,
  updateFile,
  undoLargeFileSegmentEdit,
  markChangedExternally,
  hasExternalChange,
  getTextFileStateName,
  getEditorTabState,
  getWorkingCopyRestoreActions,
  isTextFileState,
  clearExternalChange,
  markClean,
  getWorkspaceEditingSaveEvidence,
  getOpenFiles,
  closeFile,
  requestCloseFile,
  buildWorkingCopyHotExitEvidence,
  getWorkingCopyHotExitEvidence,
  addTextFileSaveParticipant,
  backupDirtyWorkingCopies,
  backupDirtyWorkingCopiesForLifecycle,
  cleanupWorkingCopyBackups,
  applyWorkingCopyRestoration,
  refreshWorkingCopyRestorations,
  restoreWorkingCopyBackups,
  resolveTextFileConflict,
  restoreOrphanedTextFile,
  resetTextFileStates,
  removeTextFileStateForPath,
} from "./manager.js"
import { LARGE_FILE_WINDOW_BYTES, VSCODE_TOKENIZATION_LARGE_FILE_BYTES, getLargeFileWindowBytes } from "./largeFilePolicy"
import { clearFileOperations, fileOperationState } from "./fileOperations"
import { FileType } from "../vscode-adapter/platform/files/common/files"
import { globalWorkspaceContextService } from "../vscode-adapter/platform/workspace/common/workspace"
import { globalLabelService } from "../vscode-adapter/platform/label/common/label"
import { URI } from "../vscode-adapter/base/common/uri"
import { globalEditorPartService } from "../vscode-adapter/workbench/services/editor/common/editorPartService"
import { buildEditorGroupStateFromOpenFiles } from "../workbench/editorGroupPersistence"

type FakeEntry = {
  name: string
  path: string
  isDir?: boolean
  isFile?: boolean
  size?: number
}

const files = new Map<string, string>()
const LARGE_WORKSPACE_FILE_COUNT = 3300
let readDirCalls: string[] = []
let readFileCalls: string[] = []
let apiSearchCalls: Array<{ path: string; body: Record<string, unknown> }> = []
let renameCalls: Array<{ oldPath: string; newPath: string }> = []
let copyCalls: Array<{ sourcePath: string; targetPath: string }> = []
let mkdirCalls: string[] = []
let patchSegmentCalls: Array<{ path: string; plan: Record<string, unknown> }> = []
let writeFileFailures = new Set<string>()
let copyEntryFailures = new Set<string>()
let fileChangeCallbacks: Array<(payload: { path: string; type?: string }) => void> = []
let fileChangeUnsubscribeCalls = 0

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "")
}

function maxLineLength(value: unknown): number {
  return String(value || "").split("\n").reduce((max, line) => Math.max(max, line.length), 0)
}

function lineCount(value: unknown): number {
  return String(value || "").split("\n").length
}

function repeatToLength(seed: string, length: number): string {
  return seed.repeat(Math.ceil(length / seed.length)).slice(0, length)
}

function sliceVirtualWindow(content: string, offset: number, length: number): string {
  if (offset >= content.length) return ""
  return content.slice(offset, offset + length)
}

function expectChunkedWindowRead(
  readOptions: Array<Record<string, unknown>>,
  logicalWindowBytes: number,
  startOffset = 0,
  startIndex = 0,
) {
  expect(LARGE_FILE_IPC_CHUNK_BYTES).toBe(512 * 1024)
  const chunkCount = Math.ceil(logicalWindowBytes / LARGE_FILE_IPC_CHUNK_BYTES)
  const chunks = readOptions.slice(startIndex, startIndex + chunkCount)
  expect(chunks).toHaveLength(chunkCount)
  chunks.forEach((options, index) => {
    const expectedOffset = startOffset + (index * LARGE_FILE_IPC_CHUNK_BYTES)
    const expectedLength = Math.min(LARGE_FILE_IPC_CHUNK_BYTES, logicalWindowBytes - (index * LARGE_FILE_IPC_CHUNK_BYTES))
    expect(options).toEqual(expect.objectContaining({
      maxBytes: expectedLength,
      previewBytes: expectedLength,
      length: expectedLength,
      offset: expectedOffset,
      preview: true,
    }))
  })
  return chunks
}

function expectWindowRead(
  readOptions: Array<Record<string, unknown>>,
  logicalWindowBytes: number,
  startOffset = 0,
  startIndex = 0,
) {
  expect(LARGE_FILE_IPC_CHUNK_BYTES).toBe(512 * 1024)
  expect(readOptions[startIndex]).toEqual(expect.objectContaining({
    maxBytes: expect.any(Number),
    previewBytes: expect.any(Number),
    length: expect.any(Number),
    offset: startOffset,
    preview: true,
  }))
  expect(readOptions.slice(startIndex).some((options) => Number(options.offset || 0) === startOffset)).toBe(true)
  expect(readOptions.slice(startIndex).reduce((total, options) => total + Number(options.length || options.previewBytes || 0), 0)).toBeGreaterThanOrEqual(logicalWindowBytes)
}

function expectOpenEditorsBridge(options: {
  openFiles: string[]
  activeFile: string | null
  dirtyFiles: string[]
  badgeByPath?: Record<string, string | null>
}) {
  expect(workspace.openFiles).toEqual(options.openFiles)
  expect(workspace.activeFile).toBe(options.activeFile)
  const visibleOpenFiles = getOpenFiles()
  expect(visibleOpenFiles).toEqual(options.openFiles)

  const state = buildEditorGroupStateFromOpenFiles({
    openFiles: visibleOpenFiles,
    activeFile: workspace.activeFile,
    dirtyFiles: (path) => isDirty(path),
  })
  const summary = globalEditorPartService.getSummary(state)
  expect(summary.activeEditor).toBe(options.activeFile)
  expect(summary.totalEditors).toBe(options.openFiles.length)
  expect(summary.dirtyCount).toBe(options.dirtyFiles.length)
  expect(state.groups[0].editors.map((editor) => editor.path)).toEqual(options.openFiles)
  expect(state.groups[0].activeEditor).toBe(options.activeFile)

  for (const path of options.openFiles) {
    expect(workspace.editorTabStates[path]).toEqual(expect.objectContaining({
      path,
      dirty: options.dirtyFiles.includes(path),
      badge: options.badgeByPath?.[path] ?? (options.dirtyFiles.includes(path) ? "dirty" : null),
    }))
  }
}

function installRangeReaders(reader: (pathValue: string, options?: Record<string, unknown>) => Promise<unknown> | unknown) {
  ;(window as unknown as { codek: Record<string, unknown> }).codek.readFile = reader
  ;(window as unknown as { codek: Record<string, unknown> }).codek.readFileTextChunk = reader
}

function installFakeFs(roots: string[]) {
  readDirCalls = []
  readFileCalls = []
  apiSearchCalls = []
  renameCalls = []
  copyCalls = []
  mkdirCalls = []
  patchSegmentCalls = []
  copyEntryFailures = new Set<string>()
  fileChangeCallbacks = []
  fileChangeUnsubscribeCalls = 0
  ;(window as unknown as { codek: Record<string, unknown> }).codek = {
    openWorkspaceFile: async () => ({
      projectRoot: roots[0],
      workspaceFile: "D:/workspace/demo.code-workspace",
      workspaceRoots: roots,
    }),
    openProjectPath: async (dir: string) => ({
      projectRoot: normalizePath(dir),
      workspaceFile: null,
      workspaceRoots: [normalizePath(dir)],
      workspaceScaleProfile: { scale: "huge", budgets: { watcherMode: "shallow" } },
    }),
    readDir: async (dir: string): Promise<FakeEntry[]> => {
      const normalizedDir = normalizePath(dir)
      readDirCalls.push(normalizedDir)
      const prefix = `${normalizedDir}/`
      const seen = new Set<string>()
      const entries: FakeEntry[] = []
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) continue
        const rest = filePath.slice(prefix.length)
        const [name] = rest.split("/")
        if (!name || seen.has(name)) continue
        seen.add(name)
        const childPath = `${normalizedDir}/${name}`
        const isDir = rest.includes("/")
        entries.push({
          name,
          path: childPath,
          isDir,
          isFile: !isDir,
          size: files.get(childPath)?.length || 0,
        })
      }
      return entries
    },
    readFile: async (pathValue: string, options: Record<string, unknown> = {}) => {
      const normalizedPath = normalizePath(pathValue)
      readFileCalls.push(normalizedPath)
      const content = files.get(normalizedPath)
      if (typeof content !== "string") return null
      const maxBytes = Number(options.maxBytes || 0)
      if (maxBytes > 0 && content.length > maxBytes) {
        if (options.preview) {
          const previewBytes = Math.max(1, Math.min(Number(options.previewBytes || maxBytes), maxBytes, content.length))
          const offset = Math.max(0, Math.min(Number(options.offset || 0), Math.max(0, content.length - previewBytes)))
          return {
            content: content.slice(offset, offset + previewBytes),
            size: content.length,
            bytesRead: previewBytes,
            limit: maxBytes,
            previewBytes,
            offset,
            truncated: previewBytes < content.length,
            path: normalizedPath,
          }
        }
        return {
          error: "FILE_TOO_LARGE",
          size: content.length,
          limit: maxBytes,
          path: normalizedPath,
        }
      }
      return content
    },
    readFileTextChunk: async (pathValue: string, options: Record<string, unknown> = {}) => {
      const normalizedPath = normalizePath(pathValue)
      readFileCalls.push(normalizedPath)
      const content = files.get(normalizedPath)
      if (typeof content !== "string") return null
      const length = Math.max(1, Number(options.length || options.previewBytes || options.maxBytes || LARGE_FILE_IPC_CHUNK_BYTES))
      const offset = Math.max(0, Math.min(Number(options.offset || 0), content.length))
      const chunk = content.slice(offset, offset + length)
      return {
        content: chunk,
        size: content.length,
        bytesRead: chunk.length,
        limit: Number(options.maxBytes || length),
        previewBytes: length,
        offset,
        truncated: offset + chunk.length < content.length,
        path: normalizedPath,
      }
    },
    writeFile: async (pathValue: string, content: string) => {
      const normalized = normalizePath(pathValue)
      if (writeFileFailures.has(normalized)) return false
      files.set(normalized, content)
      return true
    },
    patchFileSegment: async (pathValue: string, plan: Record<string, unknown>) => {
      const normalized = normalizePath(pathValue)
      patchSegmentCalls.push({ path: normalized, plan })
      const content = files.get(normalized)
      if (typeof content !== "string") return false
      const offset = Math.max(0, Number(plan.offset || 0))
      const deleteBytes = Math.max(0, Number(plan.deleteBytes || 0))
      files.set(normalized, `${content.slice(0, offset)}${String(plan.insertText || "")}${content.slice(offset + deleteBytes)}`)
      return true
    },
    createDir: async (pathValue: string) => {
      mkdirCalls.push(normalizePath(pathValue))
      return true
    },
    deleteFile: async (pathValue: string) => {
      files.delete(normalizePath(pathValue))
      return true
    },
    fileExists: async (pathValue: string) => {
      const normalized = normalizePath(pathValue)
      if (files.has(normalized)) {
        return { exists: true, isFile: true, isDirectory: false, size: files.get(normalized)?.length || 0 }
      }
      const prefix = `${normalized.replace(/\/+$/, "")}/`
      const isDirectory = Array.from(files.keys()).some((filePath) => filePath.startsWith(prefix))
      if (isDirectory) return { exists: true, isFile: false, isDirectory: true, isDir: true, size: 0 }
      return false
    },
    listWorkingCopyBackups: async () => Array.from(files.keys()).filter((filePath) => filePath.includes("/backups/workspaceStorage/")),
    rename: async (oldPath: string, newPath: string) => {
      const oldNormalized = normalizePath(oldPath)
      const newNormalized = normalizePath(newPath)
      renameCalls.push({ oldPath: oldNormalized, newPath: newNormalized })
      if (files.has(oldNormalized)) {
        const content = files.get(oldNormalized) || ""
        files.delete(oldNormalized)
        files.set(newNormalized, content)
        return true
      }
      for (const [filePath, content] of Array.from(files.entries())) {
        if (filePath.startsWith(`${oldNormalized}/`)) {
          files.delete(filePath)
          files.set(`${newNormalized}/${filePath.slice(oldNormalized.length + 1)}`, content)
        }
      }
      return true
    },
    copyEntry: async (sourcePath: string, targetPath: string) => {
      const sourceNormalized = normalizePath(sourcePath)
      const targetNormalized = normalizePath(targetPath)
      copyCalls.push({ sourcePath: sourceNormalized, targetPath: targetNormalized })
      if (copyEntryFailures.has(sourceNormalized) || copyEntryFailures.has(targetNormalized)) return false
      if (files.has(sourceNormalized)) {
        files.set(targetNormalized, files.get(sourceNormalized) || "")
        return true
      }
      for (const [filePath, content] of Array.from(files.entries())) {
        if (filePath.startsWith(`${sourceNormalized}/`)) {
          files.set(`${targetNormalized}/${filePath.slice(sourceNormalized.length + 1)}`, content)
        }
      }
      return true
    },
    onFileChanged: (callback: (payload: { path: string; type?: string }) => void) => {
      fileChangeCallbacks.push(callback)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        fileChangeUnsubscribeCalls += 1
        fileChangeCallbacks = fileChangeCallbacks.filter((entry) => entry !== callback)
      }
    },
    api: async (_method: string, requestPath: string, body: Record<string, unknown>) => {
      apiSearchCalls.push({ path: requestPath, body })
      const roots = Array.isArray(body.roots) && body.roots.length
        ? body.roots.map((root) => normalizePath(String(root)))
        : [normalizePath(String(body.root || ""))]
      const folderQueries = Array.isArray(body.folderQueries) ? body.folderQueries : []
      const query = String(body.query || "").toLowerCase()
      const matches = []
      const fileContentsByRoot: Record<string, Record<string, string>> = {}
      for (const [rootIndex, root] of roots.entries()) {
        const rootLabel = String((folderQueries[rootIndex] as { rootLabel?: string } | undefined)?.rootLabel || root.split("/").pop() || root)
        for (const [filePath, content] of files.entries()) {
          if (!filePath.startsWith(`${root}/`)) continue
          const relativePath = filePath.slice(root.length + 1)
          const lines = content.split("\n")
          for (let index = 0; index < lines.length; index += 1) {
            const column = query ? lines[index].toLowerCase().indexOf(query) : 0
            if (column < 0) continue
            matches.push({
              path: relativePath,
              root,
              rootLabel,
              line: index + 1,
              column: column + 1,
              matchLength: query.length,
              preview: lines[index],
            })
            if (body.includeContentForSmallFiles === true) {
              fileContentsByRoot[root] = fileContentsByRoot[root] || {}
              fileContentsByRoot[root][relativePath] = content
            }
            break
          }
        }
      }
      return { ok: true, data: { success: true, matches, truncated: false, fileContentsByRoot } }
    },
  }
  const fakeApi = (window as unknown as { codek: Record<string, unknown> }).codek.api as (
    method: string,
    requestPath: string,
    body: Record<string, unknown>,
  ) => Promise<unknown>
  ;(window as unknown as { codek: Record<string, unknown> }).codek.searchFiles = (request: Record<string, unknown>) => fakeApi("POST", "/search/files", request)
  ;(window as unknown as { codek: Record<string, unknown> }).codek.startSearchFiles = (request: Record<string, unknown>) => ({
    requestId: "test-search",
    promise: fakeApi("POST", "/search/files", request),
    cancel: () => undefined,
  })
}

afterEach(() => {
  files.clear()
  writeFileFailures = new Set<string>()
  copyEntryFailures = new Set<string>()
  fileChangeCallbacks = []
  fileChangeUnsubscribeCalls = 0
  clearFileOperations()
  resetTextFileStates()
  delete (window as unknown as { codek?: unknown }).codek
})

describe("readLines", () => {
  it("opens virtual text resources without touching the real filesystem or dirty state", async () => {
    installFakeFs(["D:/project"])
    await openProjectPath("D:/project")

    expect(openVirtualTextResource("/MCP Resources/fs/readme.md", "# README")).toBe(true)

    expect(workspace.activeFile).toBe("/MCP Resources/fs/readme.md")
    expect(workspace.openFiles).toContain("/MCP Resources/fs/readme.md")
    expect(workspace.files["/MCP Resources/fs/readme.md"]).toBe("# README")
    expect(isDirty("/MCP Resources/fs/readme.md")).toBe(false)
    expect(readFileCalls).toEqual([])
  })

  it("uses VS Code-style line indexing to slice requested lines without losing final lines", async () => {
    files.set("D:/project/src/read-lines.txt", "alpha\nbeta\ngamma\ndelta")
    installFakeFs(["D:/project"])
    await openProjectPath("D:/project")

    await expect(readLines("src/read-lines.txt", 2, 3)).resolves.toEqual({
      content: "beta\ngamma",
      totalLines: 4,
    })
    await expect(readLines("src/read-lines.txt", 4, 20)).resolves.toEqual({
      content: "delta",
      totalLines: 4,
    })
  })
})

describe("workspace manager multi-root behavior", () => {
  it("disambiguates duplicate root labels and resolves virtual paths", async () => {
    const roots = ["D:/apps/client", "D:/libs/client"]
    files.set("D:/apps/client/src/app.ts", "export const app = 'frontend app'")
    files.set("D:/libs/client/src/app.ts", "export const lib = 'shared library'")
    installFakeFs(roots)

    await openWorkspaceFile()

    expect(workspace.fileTree.map((entry) => entry.name)).toEqual(["client (apps)", "client (libs)"])
    expect(await readProjectFile("/client (apps)/src/app.ts")).toContain("frontend app")
    expect(await readProjectFile("/client (libs)/src/app.ts")).toContain("shared library")
    expect(getWorkspaceRootInfo("/client (libs)/src/app.ts")).toEqual({
      root: "D:/libs/client",
      label: "client (libs)",
    })
    expect(getWorkspaceRootInfo("D:/libs/client/src/app.ts")).toEqual({
      root: "D:/libs/client",
      label: "client (libs)",
    })
  })

  it("proxies legacy workspace path helpers through the VS Code workspace and label services", async () => {
    const roots = ["D:/apps/client", "D:/libs/client"]
    installFakeFs(roots)

    await openWorkspaceFile()

    expect(globalWorkspaceContextService.getWorkspace().folders.map((folder) => folder.name)).toEqual(["client (apps)", "client (libs)"])
    expect(globalWorkspaceContextService.getWorkspaceFolder(URI.file("D:/libs/client/src/app.ts"))?.name).toBe("client (libs)")
    expect(globalLabelService.getUriLabel(URI.file("D:/libs/client/src/app.ts"), { relative: true, separator: "/" })).toBe("client (libs) • src/app.ts")
    expect(getWorkspaceRootInfo("/client (libs)/src/app.ts")).toEqual({
      root: "D:/libs/client",
      label: "client (libs)",
    })
    expect(workspace.fileTree.map((entry) => [entry.name, entry.path, entry.rootPath])).toEqual([
      ["client (apps)", "/client (apps)", "D:/apps/client"],
      ["client (libs)", "/client (libs)", "D:/libs/client"],
    ])
  })

  it("uses one VS Code-style multi-root text search request and preserves root metadata", async () => {
    const roots = ["D:/apps/client", "D:/libs/client"]
    files.set("D:/apps/client/src/app.ts", "needle in frontend app")
    files.set("D:/libs/client/src/util.ts", "needle in shared util")
    installFakeFs(roots)

    await openWorkspaceFile()
    const results = await searchTextInProject("needle", {
      maxResults: 10,
      includeContentForSmallFiles: true,
    })

    expect(apiSearchCalls).toHaveLength(1)
    expect(apiSearchCalls[0]).toEqual(expect.objectContaining({
      path: "/search/files",
      body: expect.objectContaining({
        roots,
        folderQueries: [
          expect.objectContaining({ root: "D:/apps/client", rootLabel: "client (apps)", folderIndex: 0 }),
          expect.objectContaining({ root: "D:/libs/client", rootLabel: "client (libs)", folderIndex: 1 }),
        ],
      }),
    }))
    expect(results?.matches.map((item) => item.path).sort()).toEqual([
      "/client (apps)/src/app.ts",
      "/client (libs)/src/util.ts",
    ])
    expect(results?.matches.map((item) => item.rootLabel).sort()).toEqual(["client (apps)", "client (libs)"])
    expect(results?.fileContents?.["/client (libs)/src/util.ts"]).toBe("needle in shared util")
  })

  it("falls back when the cancellable search bridge cannot expose a thenable promise", async () => {
    const roots = ["D:/apps/client"]
    files.set("D:/apps/client/src/app.ts", "needle in frontend app")
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.startSearchFiles = () => ({
      requestId: "bridge-copy-without-promise",
      promise: {},
      cancel: () => undefined,
    })

    await openWorkspaceFile()
    const results = await searchTextInProject("needle", {
      maxResults: 10,
      includeContentForSmallFiles: true,
    })

    expect(apiSearchCalls).toHaveLength(1)
    expect(apiSearchCalls[0]?.body).toEqual(expect.objectContaining({
      roots,
      folderQueries: [expect.objectContaining({ root: "D:/apps/client", rootLabel: "client" })],
    }))
    expect(results?.matches.map((item) => item.path)).toEqual(["src/app.ts"])
    expect(results?.fileContents?.["src/app.ts"]).toBe("needle in frontend app")
  })

  it("discovers files through one multi-root search request for find-in-project", async () => {
    const roots = ["D:/apps/client", "D:/libs/client"]
    files.set("D:/apps/client/src/app.ts", "export const app = true")
    files.set("D:/libs/client/src/util.ts", "export const util = true")
    installFakeFs(roots)

    await openWorkspaceFile()
    const results = await findInProject("util", { maxResults: 10 })

    expect(apiSearchCalls).toHaveLength(1)
    expect(apiSearchCalls[0]?.body).toEqual(expect.objectContaining({
      roots,
      discoverFiles: true,
      query: "util",
    }))
    expect(results).toEqual([
      expect.objectContaining({
        path: "/client (libs)/src/util.ts",
        root: "D:/libs/client",
        rootLabel: "client (libs)",
      }),
    ])
  })

  it("uses the search service to find files in unloaded child directories", async () => {
    const roots = ["D:/apps/lazy-search"]
    files.set("D:/apps/lazy-search/src/deep/Hidden.ts", "export const hiddenNeedle = true")
    files.set("D:/apps/lazy-search/README.md", "plain docs")
    installFakeFs(roots)

    await openWorkspaceFile()

    expect(workspace.fileTree).toEqual([expect.objectContaining({ name: "lazy-search", virtual: true })])
    expect(readDirCalls).toEqual([])

    const textResults = await searchTextInProject("hiddenNeedle", { maxResults: 20 })
    const fileResults = await findInProject("Hidden", { maxResults: 20 })

    expect(apiSearchCalls.map((call) => call.path)).toEqual(["/search/files", "/search/files"])
    expect(apiSearchCalls[1]?.body).toEqual(expect.objectContaining({ discoverFiles: true, query: "Hidden" }))
    expect(textResults?.matches.map((item) => item.path)).toEqual(["src/deep/Hidden.ts"])
    expect(fileResults.map((item) => item.path)).toEqual(["src/deep/Hidden.ts"])
    expect(fileResults.map((item) => item.snippet)).toEqual([""])
    expect(readDirCalls).toEqual([])
  })

  it("uses a bounded small-file fast path while a 260MB optimized file is active", async () => {
    const roots = ["D:/apps/large-search"]
    const largePath = "D:/apps/large-search/current-smoke/logs/active-260mb.log"
    const smallPath = "D:/apps/large-search/current-smoke/nested/search-target.ts"
    const sameLinePath = "D:/apps/large-search/current-smoke/nested/same-line-repeated.ts"
    const virtualSize = 260 * 1024 * 1024
    const largeContent = Array.from({ length: 4096 }, (_value, index) => `active huge line ${index + 1}`).join("\n")
    for (let index = 0; index < 200; index += 1) {
      files.set(`D:/apps/large-search/old-smoke-${String(index).padStart(3, "0")}/nested/search-target.ts`, "export const stale = true\n")
    }
    files.set(largePath, largeContent)
    files.set(smallPath, "export const fastNeedle = 42\n")
    files.set(sameLinePath, "sameNeedle sameNeedle sameNeedle\n")
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async (pathValue: string) => {
      const normalized = normalizePath(pathValue)
      if (normalized === largePath) {
        return { exists: true, isFile: true, isDirectory: false, size: virtualSize }
      }
      if (files.has(normalized)) {
        return { exists: true, isFile: true, isDirectory: false, size: files.get(normalized)?.length || 0 }
      }
      const prefix = `${normalized}/`
      const isDirectory = Array.from(files.keys()).some((filePath) => filePath.startsWith(prefix))
      return { exists: isDirectory, isFile: false, isDirectory, size: 0 }
    }
    const readOptions: Array<Record<string, unknown>> = []
    const textChunkReads: string[] = []
    const readSmallFile = (pathValue: string, options: Record<string, unknown> = {}) => {
      const normalized = normalizePath(pathValue)
      const content = files.get(normalized)
      if (typeof content !== "string") throw new Error(`ENOENT: ${normalized}`)
      const length = Number(options.length || options.previewBytes || options.maxBytes || content.length)
      const offset = Number(options.offset || 0)
      return {
        content: content.slice(offset, offset + length),
        size: content.length,
        bytesRead: Math.min(length, Math.max(0, content.length - offset)),
        limit: Number(options.maxBytes || length),
        previewBytes: length,
        offset,
        truncated: offset + length < content.length,
        path: normalized,
      }
    }
    ;(window as unknown as { codek: Record<string, unknown> }).codek.readFile = async (pathValue: string, options: Record<string, unknown> = {}) => {
      readOptions.push(options)
      const normalized = normalizePath(pathValue)
      const content = files.get(normalized)
      if (typeof content !== "string") return null
      if (normalized === largePath && options.preview) {
        const offset = Number(options.offset || 0)
        const windowBytes = getLargeFileWindowBytes(virtualSize)
        const length = Number(options.length || options.previewBytes || windowBytes)
        return {
          content: content.slice(offset, offset + length),
          size: virtualSize,
          bytesRead: Math.min(length, Math.max(0, content.length - offset)),
          limit: Number(options.maxBytes || 0),
          previewBytes: length,
          offset,
          truncated: true,
          path: normalized,
        }
      }
      return content
    }
    ;(window as unknown as { codek: Record<string, unknown> }).codek.readFileTextChunk = async (pathValue: string, options: Record<string, unknown> = {}) => {
      textChunkReads.push(normalizePath(pathValue))
      return readSmallFile(pathValue, options)
    }

    await openWorkspaceFile()
    await expect(openFile("current-smoke/logs/active-260mb.log")).resolves.toBe(true)
    expect(getLargeFileState("current-smoke/logs/active-260mb.log")).toMatchObject({
      mode: "range",
      truncated: true,
      hasNext: true,
    })
    apiSearchCalls = []
    readDirCalls = []
    textChunkReads.length = 0

    const textResults = await searchTextInProject("fastNeedle", { include: ["*"], maxResults: 20 })

    expect(apiSearchCalls).toEqual([])
    expect(readDirCalls).toEqual([])
    expect(readDirCalls).not.toContain("D:/apps/large-search/old-smoke-000")
    expect(textChunkReads).toEqual(["D:/apps/large-search/current-smoke/nested/search-target.ts"])
    expect(readOptions.some((options) => Number(options.maxBytes || 0) <= 512 * 1024)).toBe(false)
    expect(textResults?.matches.map((item) => item.path)).toEqual(["current-smoke/nested/search-target.ts"])
    expect(textResults?.matches[0]).toEqual(expect.objectContaining({
      line: 1,
      column: 14,
      matchLength: "fastNeedle".length,
      preview: "export const fastNeedle = 42",
    }))
    expect(textResults?.fileContents?.["current-smoke/nested/search-target.ts"]).toBe("export const fastNeedle = 42\n")

    await expect(openFile("current-smoke/nested/search-target.ts")).resolves.toBe(true)
    apiSearchCalls = []
    readDirCalls = []
    textChunkReads.length = 0

    const sameLineResults = await searchTextInProject("sameNeedle", { include: ["*"], maxResults: 20 })

    expect(apiSearchCalls).toEqual([])
    expect(readDirCalls).toEqual([])
    expect(textChunkReads).toEqual(["D:/apps/large-search/current-smoke/nested/same-line-repeated.ts"])
    expect(sameLineResults?.matches.map((item) => item.path)).toEqual(["current-smoke/nested/same-line-repeated.ts"])
    expect(sameLineResults?.matches[0]).toEqual(expect.objectContaining({
      line: 1,
      column: 1,
      matchLength: "sameNeedle".length,
      count: 3,
    }))
    expect(sameLineResults?.fileContents?.["current-smoke/nested/same-line-repeated.ts"]).toBe("sameNeedle sameNeedle sameNeedle\n")
  })

  it("opens a folder into explorer mode without auto-opening the first file", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "console.log('hello')")
    installFakeFs(roots)

    await openWorkspaceFile()

    expect(workspace.projectRoot).toBe("D:/apps/codek")
    expect(workspace.fileTree).toEqual([expect.objectContaining({ name: "codek", virtual: true })])
    expect(workspace.activeFile).toBeNull()
    expect(workspace.openFiles).toEqual([])
  })

  it("does not scan large workspace trees during project open", async () => {
    const roots = ["D:/apps/huge"]
    for (let index = 0; index < LARGE_WORKSPACE_FILE_COUNT; index += 1) {
      files.set(`D:/apps/huge/src/file-${index}.ts`, `export const value${index} = ${index}`)
    }
    files.set("D:/apps/huge/node_modules/pkg/index.js", "module.exports = {}")
    installFakeFs(roots)

    await openWorkspaceFile()

    expect(workspace.fileTree).toEqual([expect.objectContaining({ name: "huge", virtual: true })])
    expect(workspace.fileTreeStats.truncated).toBe(false)
    expect(readDirCalls).toEqual([])
  })

  it("ignores stale file open results after switching workspaces", async () => {
    const roots = ["D:/apps/sourcemirror"]
    files.set("D:/apps/sourcemirror/src/slow.ts", "next content")
    installFakeFs(roots)
    const staleRead = createDeferred<string>()
    ;(window as unknown as { codek: Record<string, unknown> }).codek.readFile = async () => staleRead.promise

    await openProjectPath("D:/apps/sourcemirror")
    const staleOpen = openFile("src/slow.ts")
    await Promise.resolve()

    await openProjectPath("D:/apps/codek")

    staleRead.resolve("stale next content")
    await expect(staleOpen).resolves.toBe(false)

    expect(workspace.projectRoot).toBe("D:/apps/codek")
    expect(workspace.activeFile).toBeNull()
    expect(workspace.files).toEqual({})
    expect(workspace.openFiles).toEqual([])
  })

  it("opens recent project paths through the Electron workspace state", async () => {
    const roots = ["D:/apps/sourcemirror"]
    installFakeFs(roots)
    const openProjectPathCalls: string[] = []
    ;(window as unknown as { codek: Record<string, unknown> }).codek.openProjectPath = async (dir: string) => {
      openProjectPathCalls.push(normalizePath(dir))
      return {
        projectRoot: "D:/apps/sourcemirror",
        workspaceFile: null,
        workspaceRoots: ["D:/apps/sourcemirror"],
        workspaceScaleProfile: { scale: "huge", budgets: { watcherMode: "shallow" } },
      }
    }

    await openProjectPath("D:/apps/sourcemirror")

    expect(openProjectPathCalls).toEqual(["D:/apps/sourcemirror"])
    expect(workspace.projectRoot).toBe("D:/apps/sourcemirror")
    expect(workspace.workspaceRoots).toEqual(["D:/apps/sourcemirror"])
    expect(workspace.workspaceScaleProfile).toEqual({ scale: "huge", budgets: { watcherMode: "shallow" } })
    expect(workspace.fileTree).toEqual([expect.objectContaining({ name: "sourcemirror", virtual: true })])
  })

  it("keeps the current explorer and editor state when reopening the same project path", async () => {
    const roots = ["D:/apps/sourcemirror"]
    files.set("D:/apps/sourcemirror/src/main.ts", "export const main = true")
    installFakeFs(roots)

    await openProjectPath("D:/apps/sourcemirror")
    await openFile("src/main.ts")
    const previousTree = workspace.fileTree
    const previousProfile = workspace.workspaceScaleProfile
    const openProjectPathCalls: string[] = []
    ;(window as unknown as { codek: Record<string, unknown> }).codek.openProjectPath = async (dir: string) => {
      openProjectPathCalls.push(normalizePath(dir))
      throw new Error("same-root reopen should not round-trip through Electron")
    }

    await expect(openProjectPath("D:/apps/sourcemirror/")).resolves.toBe(true)

    expect(openProjectPathCalls).toEqual([])
    expect(workspace.projectRoot).toBe("D:/apps/sourcemirror")
    expect(workspace.fileTree).toBe(previousTree)
    expect(workspace.openFiles).toEqual(["src/main.ts"])
    expect(workspace.activeFile).toBe("src/main.ts")
    expect(workspace.files["src/main.ts"]).toBe("export const main = true")
    expect(workspace.workspaceScaleProfile).toBe(previousProfile)
  })

  it("does not blank the current tree while the folder picker reopens the same project", async () => {
    const roots = ["D:/apps/sourcemirror"]
    files.set("D:/apps/sourcemirror/src/main.ts", "export const main = true")
    installFakeFs(roots)

    await openProjectPath("D:/apps/sourcemirror")
    await openFile("src/main.ts")
    const previousTree = workspace.fileTree
    const previousProfile = workspace.workspaceScaleProfile
    const deferredState = createDeferred<{
      projectRoot: string
      workspaceFile: null
      workspaceRoots: string[]
    }>()
    ;(window as unknown as { codek: Record<string, unknown> }).codek.selectDirectory = async () => "D:/apps/sourcemirror"
    ;(window as unknown as { codek: Record<string, unknown> }).codek.getWorkspaceState = async () => deferredState.promise

    const reopen = openProject()
    await Promise.resolve()

    expect(workspace.fileTree).toBe(previousTree)
    expect(workspace.openFiles).toEqual(["src/main.ts"])
    expect(workspace.activeFile).toBe("src/main.ts")
    expect(workspace.workspaceScaleProfile).toBe(previousProfile)

    deferredState.resolve({
      projectRoot: "D:/apps/sourcemirror",
      workspaceFile: null,
      workspaceRoots: ["D:/apps/sourcemirror"],
    })
    await expect(reopen).resolves.toBe(true)

    expect(workspace.fileTree).toBe(previousTree)
    expect(workspace.openFiles).toEqual(["src/main.ts"])
    expect(workspace.activeFile).toBe("src/main.ts")
    expect(workspace.workspaceScaleProfile).toBe(previousProfile)
  })

  it("keeps the old explorer visible while a different project path is still opening", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const main = true")
    installFakeFs(roots)

    await openProjectPath("D:/apps/codek")
    await openFile("src/main.ts")
    const previousTree = workspace.fileTree
    const deferredState = createDeferred<{
      projectRoot: string
      workspaceFile: null
      workspaceRoots: string[]
      workspaceScaleProfile: { scale: string }
    }>()
    ;(window as unknown as { codek: Record<string, unknown> }).codek.openProjectPath = async () => deferredState.promise

    const openNext = openProjectPath("D:/apps/sourcemirror")
    await Promise.resolve()

    expect(workspace.projectRoot).toBe("D:/apps/codek")
    expect(workspace.fileTree).toBe(previousTree)
    expect(workspace.openFiles).toEqual(["src/main.ts"])
    expect(workspace.activeFile).toBe("src/main.ts")

    deferredState.resolve({
      projectRoot: "D:/apps/sourcemirror",
      workspaceFile: null,
      workspaceRoots: ["D:/apps/sourcemirror"],
      workspaceScaleProfile: { scale: "huge" },
    })
    await expect(openNext).resolves.toBe(true)

    expect(workspace.projectRoot).toBe("D:/apps/sourcemirror")
    expect(workspace.fileTree).toEqual([expect.objectContaining({ name: "sourcemirror", virtual: true })])
    expect(workspace.openFiles).toEqual([])
    expect(workspace.activeFile).toBeNull()
  })

  it("ignores stale workspace open results after a newer project path wins", async () => {
    const roots = ["D:/apps/sourcemirror"]
    installFakeFs(roots)
    await openProjectPath("D:/apps/initial")

    const staleSourceMirror = createDeferred<{
      projectRoot: string
      workspaceFile: null
      workspaceRoots: string[]
      workspaceScaleProfile: { scale: string }
    }>()
    ;(window as unknown as { codek: Record<string, unknown> }).codek.openProjectPath = async (dir: string) => {
      const normalized = normalizePath(dir)
      if (normalized === "D:/apps/sourcemirror") return staleSourceMirror.promise
      return {
        projectRoot: normalized,
        workspaceFile: null,
        workspaceRoots: [normalized],
        workspaceScaleProfile: { scale: "normal" },
      }
    }

    const staleOpen = openProjectPath("D:/apps/sourcemirror")
    await Promise.resolve()
    await expect(openProjectPath("D:/apps/codek")).resolves.toBe(true)

    staleSourceMirror.resolve({
      projectRoot: "D:/apps/sourcemirror",
      workspaceFile: null,
      workspaceRoots: ["D:/apps/sourcemirror"],
      workspaceScaleProfile: { scale: "huge" },
    })
    await expect(staleOpen).resolves.toBe(false)

    expect(workspace.projectRoot).toBe("D:/apps/codek")
    expect(workspace.workspaceRoots).toEqual(["D:/apps/codek"])
    expect(workspace.workspaceScaleProfile).toEqual({ scale: "normal" })
    expect(workspace.fileTree).toEqual([expect.objectContaining({ name: "codek", virtual: true })])
  })

  it("opens files above the old 2MB guard instead of blocking the editor", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/huge.log"
    const largeContent = repeatToLength("regular log line\n", (2 * 1024 * 1024) + 10)
    files.set(largePath, largeContent)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: (2 * 1024 * 1024) + 10,
    })

    await openWorkspaceFile()
    const ok = await openFile("logs/huge.log")

    expect(ok).toBe(true)
    expect(workspace.activeFile).toBe("logs/huge.log")
    expect(workspace.openFiles).toEqual(["logs/huge.log"])
    expect(workspace.largeFileNotice).toBeNull()
    expect(readFileCalls).toContain("D:/apps/codek/logs/huge.log")
  })

  it("keeps small direct-text files out of large-file state when the read budget is 50MB", async () => {
    const roots = ["D:/apps/codek"]
    const appPath = "D:/apps/codek/src/App.vue"
    const appContent = "<template>\n  <main>small file</main>\n</template>\n"
    const textChunkOptions: Array<Record<string, unknown>> = []
    files.set(appPath, appContent)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.readFileTextChunk = async (pathValue: string, options: Record<string, unknown> = {}) => {
      textChunkOptions.push(options)
      const normalizedPath = normalizePath(pathValue)
      const content = files.get(normalizedPath)
      if (typeof content !== "string") return null
      const length = Math.max(1, Number(options.length || options.previewBytes || options.maxBytes || LARGE_FILE_IPC_CHUNK_BYTES))
      const offset = Math.max(0, Math.min(Number(options.offset || 0), content.length))
      const chunk = content.slice(offset, offset + length)
      return {
        content: chunk,
        size: content.length,
        bytesRead: chunk.length,
        limit: Number(options.maxBytes || length),
        previewBytes: length,
        offset,
        truncated: offset + chunk.length < content.length,
        path: normalizedPath,
      }
    }

    await openWorkspaceFile()
    const ok = await openFile("src/App.vue")

    expect(ok).toBe(true)
    expect(workspace.activeFile).toBe("src/App.vue")
    expect(workspace.files["src/App.vue"]).toBe(appContent)
    expect(getLargeFileState("src/App.vue")).toBeNull()
    expect(workspace.largeFileNotice).toBeNull()
    expect(textChunkOptions[0]).toEqual(expect.objectContaining({
      maxBytes: LARGE_FILE_IPC_CHUNK_BYTES,
      length: LARGE_FILE_IPC_CHUNK_BYTES,
      returnContentOnly: true,
    }))
    expect(textChunkOptions.some((options) => Number(options.fileSize || 0) === LARGE_FILE_WINDOWING_BYTES)).toBe(false)
  })

  it("opens files above tokenization budget in optimized full-content mode while staying editable", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/huge.log"
    const marker = "real large log preview\n"
    const virtualSize = VSCODE_TOKENIZATION_LARGE_FILE_BYTES + 1
    const largeContent = `${marker}${repeatToLength("window line\n", virtualSize - marker.length)}`
    files.set(largePath, largeContent)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })

    await openWorkspaceFile()
    const ok = await openFile("logs/huge.log")

    expect(ok).toBe(true)
    expect(workspace.activeFile).toBe("logs/huge.log")
    expect(workspace.files["logs/huge.log"]).toContain(marker.trim())
    expect(isReadOnlyFile("logs/huge.log")).toBe(false)
    expect(getLargeFileState("logs/huge.log")).toMatchObject({ mode: "optimized", readOnly: false, truncated: false })
    expect(workspace.largeFileNotice).toBeNull()
    await expect(saveFile("logs/huge.log", "edited")).resolves.toBe(true)
    expect(patchSegmentCalls).toEqual([])
  })

  it("downgrades medium-size single-line files to editable safe windows before Monaco sees the long line", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/single-line.log"
    const virtualSize = 32 * 1024 * 1024
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const largeContent = "x".repeat(virtualSize)
    files.set(largePath, largeContent)
    installFakeFs(roots)
    const readOptions: Array<Record<string, unknown>> = []
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    const readRange = async (_path: string, options: Record<string, unknown> = {}) => {
      readOptions.push(options)
      if (!options.preview) return largeContent
      const offset = Number(options.offset || 0)
      const length = Number(options.length || options.previewBytes || windowBytes)
      return {
        content: largeContent.slice(offset, offset + length),
        size: virtualSize,
        bytesRead: Math.min(length, Math.max(0, largeContent.length - offset)),
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: offset + length < virtualSize,
        path: largePath,
      }
    }
    installRangeReaders(readRange)

    await openWorkspaceFile()
    const ok = await openFile("logs/single-line.log")

    expect(ok).toBe(true)
    expect(workspace.activeFile).toBe("logs/single-line.log")
    expect(isReadOnlyFile("logs/single-line.log")).toBe(false)
    expect(getLargeFileState("logs/single-line.log")).toMatchObject({
      mode: "range",
      readOnly: false,
      truncated: true,
      displayTransformed: true,
      offset: 0,
    })
    expect(workspace.largeFileNotice).toMatchObject({
      path: "logs/single-line.log",
      mode: "range",
      readOnly: false,
    })
    const singleLineState = getLargeFileState("logs/single-line.log")
    const singleLineDisplayBytes = Number(singleLineState?.displayBytes || 0)
    expect(singleLineDisplayBytes).toBeGreaterThan(0)
    expect(maxLineLength(workspace.files["logs/single-line.log"])).toBeLessThanOrEqual(LARGE_FILE_SAFE_RENDER_LINE_CHARS)
    expect(String(workspace.files["logs/single-line.log"]).length).toBeLessThanOrEqual(singleLineDisplayBytes + Math.ceil(singleLineDisplayBytes / LARGE_FILE_SAFE_RENDER_LINE_CHARS))
    expect(String(workspace.files["logs/single-line.log"]).split("\n").length).toBeGreaterThanOrEqual(Math.ceil(singleLineDisplayBytes / LARGE_FILE_SAFE_RENDER_LINE_CHARS))
    expect(readOptions.some((options) => options.preview === true && Number(options.length || 0) <= windowBytes)).toBe(true)
    expect(workspace.files["logs/single-line.log"]).toContain("xxxxxxxx")
    const edited = String(workspace.files["logs/single-line.log"]).replace("xxxxxxxx", "yyyyyyyy")
    await expect(saveFile("logs/single-line.log", edited)).resolves.toBe(true)
    expect(patchSegmentCalls).toEqual([expect.objectContaining({
      path: largePath,
      plan: expect.objectContaining({
        offset: 0,
        deleteBytes: singleLineDisplayBytes,
        insertText: expect.stringContaining("yyyyyyyy"),
      }),
    })])
    expect(String(files.get(largePath) || "").includes("\n")).toBe(false)
    expect(String(files.get(largePath) || "").startsWith("yyyyyyyy")).toBe(true)
  })

  it("opens files above the local confirmation safety limit as editable range windows with runtime editor downgrades", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/windowed.log"
    const marker = "real windowed log preview\n"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const firstWindow = `${marker}${repeatToLength("window line\n", windowBytes - marker.length)}`
    files.set(largePath, firstWindow)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    installRangeReaders(async (_path: string, options: Record<string, unknown> = {}) => {
      const offset = Number(options.offset || 0)
      const length = Number(options.length || options.previewBytes || windowBytes)
      const content = sliceVirtualWindow(firstWindow, offset, length)
      return {
        content,
        size: virtualSize,
        bytesRead: content.length,
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: offset + content.length < virtualSize,
        path: largePath,
      }
    })

    await openWorkspaceFile()
    const ok = await openFile("logs/windowed.log")

    expect(ok).toBe(true)
    expect(workspace.activeFile).toBe("logs/windowed.log")
    expect(workspace.files["logs/windowed.log"]).toContain(marker.trim())
    expect(String(workspace.files["logs/windowed.log"]).length).toBeLessThanOrEqual(LARGE_FILE_EDITOR_RENDER_BYTES + 1)
    expect(String(workspace.files["logs/windowed.log"]).length).toBeLessThan(virtualSize)
    expect(isReadOnlyFile("logs/windowed.log")).toBe(false)
    expect(getLargeFileState("logs/windowed.log")).toMatchObject({
      mode: "range",
      readOnly: false,
      truncated: true,
      offset: 0,
      bytesRead: windowBytes,
      windowBytes,
      displayBytes: LARGE_FILE_EDITOR_RENDER_BYTES,
    })
    expect(workspace.largeFileNotice).toMatchObject({
      path: "logs/windowed.log",
      mode: "range",
      readOnly: false,
    })
    await expect(saveFile("logs/windowed.log", "edited")).resolves.toBe(true)
    expect(patchSegmentCalls).toEqual([expect.objectContaining({
      path: largePath,
      plan: expect.objectContaining({
        offset: 0,
        deleteBytes: LARGE_FILE_EDITOR_RENDER_BYTES,
        insertText: "edited\n",
      }),
    })])
    expect(files.get(largePath)).toBe(`edited\n${firstWindow.slice(LARGE_FILE_EDITOR_RENDER_BYTES)}`)
  })

  it("records VS Code-style segment edit stack items and can undo and redo saved large-file windows", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/windowed-undo.log"
    const marker = "large edit stack marker\n"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const firstWindow = `${marker}${repeatToLength("window line\n", windowBytes - marker.length)}`
    files.set(largePath, firstWindow)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    installRangeReaders(async (_path: string, options: Record<string, unknown> = {}) => {
      const offset = Number(options.offset || 0)
      const length = Number(options.length || options.previewBytes || windowBytes)
      const content = sliceVirtualWindow(firstWindow, offset, length)
      return {
        content,
        size: virtualSize,
        bytesRead: content.length,
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: offset + content.length < virtualSize,
        path: largePath,
      }
    })

    await openWorkspaceFile()
    await expect(openFile("logs/windowed-undo.log")).resolves.toBe(true)
    await expect(saveFile("logs/windowed-undo.log", "edited")).resolves.toBe(true)
    expect(canUndoLargeFileSegmentEdit("logs/windowed-undo.log")).toBe(true)
    expect(canRedoLargeFileSegmentEdit("logs/windowed-undo.log")).toBe(false)
    expect(files.get(largePath)).toBe(`edited\n${firstWindow.slice(LARGE_FILE_EDITOR_RENDER_BYTES)}`)

    await expect(undoLargeFileSegmentEdit("logs/windowed-undo.log")).resolves.toBe(true)
    expect(files.get(largePath)).toBe(firstWindow)
    expect(workspace.files["logs/windowed-undo.log"]).toContain(marker.trim())
    expect(getLargeFileState("logs/windowed-undo.log")).toMatchObject({
      mode: "range",
      size: virtualSize,
      offset: 0,
      bytesRead: LARGE_FILE_EDITOR_RENDER_BYTES,
    })
    expect(canUndoLargeFileSegmentEdit("logs/windowed-undo.log")).toBe(false)
    expect(canRedoLargeFileSegmentEdit("logs/windowed-undo.log")).toBe(true)

    await expect(redoLargeFileSegmentEdit("logs/windowed-undo.log")).resolves.toBe(true)
    expect(files.get(largePath)).toBe(`edited\n${firstWindow.slice(LARGE_FILE_EDITOR_RENDER_BYTES)}`)
    expect(workspace.files["logs/windowed-undo.log"]).toBe("edited\n")
    expect(canUndoLargeFileSegmentEdit("logs/windowed-undo.log")).toBe(true)
    expect(canRedoLargeFileSegmentEdit("logs/windowed-undo.log")).toBe(false)
    expect(patchSegmentCalls).toHaveLength(3)
    expect(patchSegmentCalls[1]).toEqual(expect.objectContaining({
      path: largePath,
      plan: expect.objectContaining({
        offset: 0,
        deleteBytes: "edited\n".length,
        insertText: expect.stringContaining(marker.trim()),
        expectedSize: virtualSize - LARGE_FILE_EDITOR_RENDER_BYTES + "edited\n".length,
        nextSize: virtualSize,
      }),
    }))
    expect(patchSegmentCalls[2]).toEqual(expect.objectContaining({
      path: largePath,
      plan: expect.objectContaining({
        offset: 0,
        deleteBytes: LARGE_FILE_EDITOR_RENDER_BYTES,
        insertText: "edited\n",
        expectedSize: virtualSize,
        nextSize: virtualSize - LARGE_FILE_EDITOR_RENDER_BYTES + "edited\n".length,
      }),
    }))
  })

  it("refuses stale large-file segment undo when the active window moved", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/windowed-stale-undo.log"
    const marker = "large edit stale marker\n"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const firstWindow = `${marker}${repeatToLength("window line\n", windowBytes - marker.length)}`
    files.set(largePath, firstWindow)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    installRangeReaders(async (_path: string, options: Record<string, unknown> = {}) => {
      const offset = Number(options.offset || 0)
      const length = Number(options.length || options.previewBytes || windowBytes)
      const content = offset === 0
        ? sliceVirtualWindow(firstWindow, offset, length)
        : repeatToLength("second window line\n", length)
      return {
        content,
        size: virtualSize,
        bytesRead: content.length,
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: offset + content.length < virtualSize,
        path: largePath,
      }
    })

    await openWorkspaceFile()
    await expect(openFile("logs/windowed-stale-undo.log")).resolves.toBe(true)
    await expect(saveFile("logs/windowed-stale-undo.log", "edited")).resolves.toBe(true)
    await expect(loadNextLargeFileWindow("logs/windowed-stale-undo.log")).resolves.toBe(true)

    await expect(undoLargeFileSegmentEdit("logs/windowed-stale-undo.log")).resolves.toBe(false)
    expect(workspace.largeFileNotice).toMatchObject({
      path: "logs/windowed-stale-undo.log",
      reason: "大文件分段保存失败：当前窗口位置已经变化。",
    })
    expect(getTextFileStateName("logs/windowed-stale-undo.log")).toBe("conflict")
    expect(patchSegmentCalls).toHaveLength(1)
  })

  it("opens 64MB-class multiline text above the VS Code sync limit as byte-window range content", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/full-scroll-64mb.log"
    const virtualSize = 64 * 1024 * 1024
    const expectedWindowBytes = getLargeFileWindowBytes(virtualSize)
    const firstWindowLineCount = 130_000
    const secondWindowMarker = "optimized scroll second window marker\n"
    const firstWindow = repeatToLength(
      Array.from({ length: firstWindowLineCount }, (_value, index) => `optimized scroll line ${index + 1}`).join("\n") + "\n",
      expectedWindowBytes,
    )
    const secondWindow = `${secondWindowMarker}${repeatToLength("tail line\n", expectedWindowBytes - secondWindowMarker.length)}`
    const content = firstWindow + secondWindow
    files.set(largePath, content)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })

    await openWorkspaceFile()
    const ok = await openFile("logs/full-scroll-64mb.log")

    expect(ok).toBe(true)
    expect(workspace.activeFile).toBe("logs/full-scroll-64mb.log")
    expect(workspace.files["logs/full-scroll-64mb.log"]).toContain("optimized scroll line 130000")
    expect(workspace.files["logs/full-scroll-64mb.log"]).not.toContain(secondWindowMarker.trim())
    expect(String(workspace.files["logs/full-scroll-64mb.log"]).length).toBeLessThan(content.length)
    expect(lineCount(workspace.files["logs/full-scroll-64mb.log"])).toBeGreaterThan(120_000)
    expect(getLargeFileState("logs/full-scroll-64mb.log")).toMatchObject({
      mode: "range",
      readOnly: false,
      truncated: true,
      windowBytes: expectedWindowBytes,
      offset: 0,
      hasNext: true,
    })
    expect(workspace.largeFileNotice).toMatchObject({
      path: "logs/full-scroll-64mb.log",
      mode: "range",
      readOnly: false,
    })
    await expect(loadNextLargeFileWindow("logs/full-scroll-64mb.log")).resolves.toBe(true)
    expect(workspace.files["logs/full-scroll-64mb.log"]).toContain(secondWindowMarker.trim())
    expect(getLargeFileState("logs/full-scroll-64mb.log")).toMatchObject({
      mode: "range",
      offset: expectedWindowBytes,
      hasPrevious: true,
    })
  })

  it("opens files above the local confirmation safety limit as real range windows while keeping Monaco responsive", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/range-over-limit.log"
    const markerInFirstWindow = "marker in first large window\n"
    const markerInSecondWindow = "marker in second large window\n"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const largeContent = `${markerInFirstWindow}${"a".repeat(windowBytes - markerInFirstWindow.length)}${markerInSecondWindow}${"b".repeat(windowBytes - markerInSecondWindow.length)}`
    files.set(largePath, largeContent)
    installFakeFs(roots)
    const readOptions: Array<Record<string, unknown>> = []
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    const readRange = async (_path: string, options: Record<string, unknown> = {}) => {
      readOptions.push(options)
      if (!options.preview) return largeContent
      const offset = Number(options.offset || 0)
      const length = Number(options.length || options.previewBytes || windowBytes)
      return {
        content: largeContent.slice(offset, offset + length),
        size: virtualSize,
        bytesRead: Math.min(length, Math.max(0, largeContent.length - offset)),
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: offset + length < virtualSize,
        path: largePath,
      }
    }
    installRangeReaders(readRange)

    await openWorkspaceFile()
    const ok = await openFile("logs/range-over-limit.log")

    expect(ok).toBe(true)
    expect(workspace.activeFile).toBe("logs/range-over-limit.log")
    expect(workspace.files["logs/range-over-limit.log"]).toContain(markerInFirstWindow.trim())
    expectWindowRead(readOptions, windowBytes)
    expect(workspace.files["logs/range-over-limit.log"]).not.toContain("FILE_TOO_LARGE")
    expect(workspace.files["logs/range-over-limit.log"]).not.toContain("file is too large")
    expect(isReadOnlyFile("logs/range-over-limit.log")).toBe(false)
    expect(getLargeFileState("logs/range-over-limit.log")).toMatchObject({
      mode: "range",
      readOnly: false,
      truncated: true,
      offset: 0,
      hasNext: true,
    })
    expect(workspace.largeFileNotice).toMatchObject({
      path: "logs/range-over-limit.log",
      mode: "range",
      readOnly: false,
    })
    await expect(loadNextLargeFileWindow("logs/range-over-limit.log")).resolves.toBe(true)
    expect(workspace.files["logs/range-over-limit.log"]).toContain(markerInSecondWindow.trim())
  })

  it("keeps large range window browsing clean so tab close does not prompt", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/clean-window.log"
    const firstMarker = "clean first window\n"
    const secondMarker = "clean second window\n"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const largeContent = `${firstMarker}${"a".repeat(windowBytes - firstMarker.length)}${secondMarker}${"b".repeat(windowBytes - secondMarker.length)}`
    files.set(largePath, largeContent)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    const readRange = async (_path: string, options: Record<string, unknown> = {}) => {
      if (!options.preview) return largeContent
      const offset = Number(options.offset || 0)
      const length = Number(options.length || options.previewBytes || windowBytes)
      return {
        content: largeContent.slice(offset, offset + length),
        size: virtualSize,
        bytesRead: Math.min(length, Math.max(0, largeContent.length - offset)),
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: offset + length < virtualSize,
        path: largePath,
      }
    }
    installRangeReaders(readRange)

    await openWorkspaceFile()
    await expect(openFile("logs/clean-window.log")).resolves.toBe(true)
    updateFile("logs/clean-window.log", String(workspace.files["logs/clean-window.log"] || ""), { dirty: true, external: false })

    await expect(loadNextLargeFileWindow("logs/clean-window.log")).resolves.toBe(true)

    expect(workspace.files["logs/clean-window.log"]).toContain(secondMarker.trim())
    expect(isDirty("logs/clean-window.log")).toBe(false)
  })

  it("reads large range windows through the dedicated text chunk bridge", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/chunk-bridge-range-over-limit.log"
    const markerInFirstWindow = "dedicated chunk bridge first window\n"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const largeContent = `${markerInFirstWindow}${"a".repeat(windowBytes - markerInFirstWindow.length)}`
    files.set(largePath, largeContent)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    const chunkOptions: Array<Record<string, unknown>> = []
    ;(window as unknown as { codek: Record<string, unknown> }).codek.readFileTextChunk = async (_path: string, options: Record<string, unknown> = {}) => {
      chunkOptions.push(options)
      const offset = Number(options.offset || 0)
      const length = Number(options.length || options.previewBytes || windowBytes)
      return {
        content: largeContent.slice(offset, offset + length),
        size: virtualSize,
        bytesRead: Math.min(length, Math.max(0, largeContent.length - offset)),
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: offset + length < virtualSize,
        path: largePath,
      }
    }

    await openWorkspaceFile()
    const ok = await openFile("logs/chunk-bridge-range-over-limit.log")

    expect(ok).toBe(true)
    expectWindowRead(chunkOptions, windowBytes)
    expect(chunkOptions[0]).toEqual(expect.objectContaining({
      projectRoot: roots[0],
      workspaceRoots: roots,
    }))
    expect(workspace.activeFile).toBe("logs/chunk-bridge-range-over-limit.log")
    expect(workspace.files["logs/chunk-bridge-range-over-limit.log"]).toContain(markerInFirstWindow.trim())
    expect(getLargeFileState("logs/chunk-bridge-range-over-limit.log")).toMatchObject({
      mode: "range",
      readOnly: false,
      truncated: true,
      offset: 0,
      hasNext: true,
    })
  })

  it("streams large range windows through events before falling back to bridge return values", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/stream-bridge-range-over-limit.log"
    const markerInFirstWindow = "stream chunk bridge first window\n"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const largeContent = `${markerInFirstWindow}${"a".repeat(windowBytes - markerInFirstWindow.length)}`
    files.set(largePath, largeContent)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    const chunkOptions: Array<Record<string, unknown>> = []
    delete (window as unknown as { codek: Record<string, unknown> }).codek.readFile
    delete (window as unknown as { codek: Record<string, unknown> }).codek.readFileTextChunk
    const listeners: Array<(payload: unknown) => void> = []
    ;(window as unknown as { codek: Record<string, unknown> }).codek.onReadFileTextChunk = (callback: (payload: unknown) => void) => {
      listeners.push(callback)
      return () => {
        const index = listeners.indexOf(callback)
        if (index >= 0) listeners.splice(index, 1)
      }
    }
    ;(window as unknown as { codek: Record<string, unknown> }).codek.startReadFileTextChunks = (request: Record<string, unknown>) => {
      const options = request.options as Record<string, unknown>
      const requestId = String(request.requestId || "")
      const chunkBytes = Number(request.chunkBytes || LARGE_FILE_IPC_CHUNK_BYTES)
      chunkOptions.push({ ...options, chunkBytes })
      queueMicrotask(() => {
        for (let offset = 0; offset < windowBytes; offset += chunkBytes) {
          const length = Math.min(chunkBytes, windowBytes - offset)
          const payload = {
            requestId,
            type: "chunk",
            offset,
            content: largeContent.slice(offset, offset + length),
            size: virtualSize,
            bytesRead: length,
            path: largePath,
          }
          listeners.forEach((listener) => listener(payload))
        }
        listeners.forEach((listener) => listener({
          requestId,
          type: "done",
          offset: 0,
          bytesRead: windowBytes,
          size: virtualSize,
          limit: chunkBytes,
          previewBytes: windowBytes,
          truncated: true,
          path: largePath,
        }))
      })
      return true
    }

    await openWorkspaceFile()
    const ok = await openFile("logs/stream-bridge-range-over-limit.log")

    expect(ok).toBe(true)
    expect(chunkOptions[0]).toEqual(expect.objectContaining({
      maxBytes: windowBytes,
      preview: true,
      chunkBytes: 512 * 1024,
    }))
    expect(workspace.activeFile).toBe("logs/stream-bridge-range-over-limit.log")
    expect(workspace.files["logs/stream-bridge-range-over-limit.log"]).toContain(markerInFirstWindow.trim())
    expect(getLargeFileState("logs/stream-bridge-range-over-limit.log")).toMatchObject({
      mode: "range",
      readOnly: false,
      truncated: true,
      offset: 0,
      hasNext: true,
    })
  })

  it("uses the stream invoke return value when Electron chunk events do not reach the renderer", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/stream-return-range-over-limit.log"
    const markerInFirstWindow = "stream invoke return first window\n"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const largeContent = `${markerInFirstWindow}${"r".repeat(windowBytes - markerInFirstWindow.length)}`
    files.set(largePath, largeContent)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    const streamRequests: Array<Record<string, unknown>> = []
    delete (window as unknown as { codek: Record<string, unknown> }).codek.readFile
    delete (window as unknown as { codek: Record<string, unknown> }).codek.readFileTextChunk
    ;(window as unknown as { codek: Record<string, unknown> }).codek.onReadFileTextChunk = () => {
      return () => {}
    }
    ;(window as unknown as { codek: Record<string, unknown> }).codek.startReadFileTextChunks = async (request: Record<string, unknown>) => {
      streamRequests.push(request)
      return {
        streamed: true,
        requestId: request.requestId,
        content: largeContent,
        size: virtualSize,
        bytesRead: windowBytes,
        limit: request.chunkBytes,
        previewBytes: windowBytes,
        offset: 0,
        truncated: true,
        path: largePath,
      }
    }

    await openWorkspaceFile()
    const ok = await openFile("logs/stream-return-range-over-limit.log")

    expect(ok).toBe(true)
    expect(streamRequests).toHaveLength(1)
    expect(workspace.activeFile).toBe("logs/stream-return-range-over-limit.log")
    expect(workspace.files["logs/stream-return-range-over-limit.log"]).toContain(markerInFirstWindow.trim())
    expect(getLargeFileState("logs/stream-return-range-over-limit.log")).toMatchObject({
      mode: "range",
      readOnly: false,
      truncated: true,
      offset: 0,
      hasNext: true,
    })
  })

  it("normalizes editable range windows so a huge one-line file cannot freeze Monaco", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/one-line-260mb.log"
    const virtualSize = 260 * 1024 * 1024
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const firstWindow = "x".repeat(windowBytes)
    const secondWindow = "y".repeat(windowBytes)
    files.set(largePath, firstWindow + secondWindow)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    installRangeReaders(async (_path: string, options: Record<string, unknown> = {}) => {
      const offset = Number(options.offset || 0)
      const length = Number(options.length || options.previewBytes || windowBytes)
      return {
        content: (files.get(largePath) || "").slice(offset, offset + length),
        size: virtualSize,
        bytesRead: length,
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: offset + length < virtualSize,
        path: largePath,
      }
    })

    await openWorkspaceFile()
    await expect(openFile("logs/one-line-260mb.log")).resolves.toBe(true)

    expect(getLargeFileState("logs/one-line-260mb.log")).toMatchObject({
      mode: "range",
      readOnly: false,
      windowBytes,
      virtualStartLine: 1,
      sourceStartLine: 1,
      sourceLineAdvance: 0,
    })
    expect(maxLineLength(workspace.files["logs/one-line-260mb.log"])).toBeLessThanOrEqual(LARGE_FILE_SAFE_RENDER_LINE_CHARS)
    expect(lineCount(workspace.files["logs/one-line-260mb.log"])).toBeGreaterThanOrEqual(Math.ceil(LARGE_FILE_EDITOR_RENDER_BYTES / LARGE_FILE_SAFE_RENDER_LINE_CHARS))

    await expect(saveFile("logs/one-line-260mb.log", String(workspace.files["logs/one-line-260mb.log"]).replace("xxxx", "EDIT"))).resolves.toBe(true)
    expect(patchSegmentCalls).toEqual([expect.objectContaining({
      path: largePath,
      plan: expect.objectContaining({
        offset: 0,
        deleteBytes: LARGE_FILE_EDITOR_RENDER_BYTES,
        insertText: expect.stringContaining("EDIT"),
      }),
    })])
    expect(files.get(largePath)).toContain("EDIT")
    expect(String(files.get(largePath) || "").slice(0, windowBytes)).not.toContain("\n")

    await expect(loadNextLargeFileWindow("logs/one-line-260mb.log")).resolves.toBe(true)
    expect(getLargeFileState("logs/one-line-260mb.log")).toMatchObject({
      offset: windowBytes,
      virtualStartLine: Math.floor(windowBytes / LARGE_FILE_SAFE_RENDER_LINE_CHARS) + 1,
      sourceStartLine: 1,
      sourceLineAdvance: 0,
    })
    expect(maxLineLength(workspace.files["logs/one-line-260mb.log"])).toBeLessThanOrEqual(LARGE_FILE_SAFE_RENDER_LINE_CHARS)
    expect(lineCount(workspace.files["logs/one-line-260mb.log"])).toBeGreaterThanOrEqual(Math.ceil(LARGE_FILE_EDITOR_RENDER_BYTES / LARGE_FILE_SAFE_RENDER_LINE_CHARS))
    expect(workspace.files["logs/one-line-260mb.log"]).toContain("y".repeat(LARGE_FILE_SAFE_RENDER_LINE_CHARS))
    expect(workspace.files["logs/one-line-260mb.log"]).not.toContain("EDIT")
  })

  it("normalizes CR, LF, and long lines in large-file preview content", () => {
    const content = `short\r${"a".repeat(LARGE_FILE_SAFE_RENDER_LINE_CHARS + 3)}\r\n${"b".repeat(LARGE_FILE_SAFE_RENDER_LINE_CHARS)}`
    const normalized = normalizeLargeFilePreviewContent(content)

    expect(normalized).not.toContain("\r")
    expect(maxLineLength(normalized)).toBeLessThanOrEqual(LARGE_FILE_SAFE_RENDER_LINE_CHARS)
    expect(normalized.split("\n")).toHaveLength(4)
  })

  it("retries FILE_TOO_LARGE reads with a bounded real window and mounts real content", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/extreme.log"
    const realContent = "real fallback content\n".repeat(64)
    files.set(largePath, realContent)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: MAX_EDITABLE_FILE_BYTES + 10,
    })
    let readCount = 0
    delete (window as unknown as { codek: Record<string, unknown> }).codek.readFileTextChunk
    ;(window as unknown as { codek: Record<string, unknown> }).codek.readFile = async (_path: string, options: Record<string, unknown> = {}) => {
      readCount += 1
      if (readCount === 1) {
        return {
          error: "FILE_TOO_LARGE",
          size: MAX_EDITABLE_FILE_BYTES + 10,
          limit: MAX_EDITABLE_FILE_BYTES,
          path: largePath,
        }
      }
      return {
        content: realContent,
        size: MAX_EDITABLE_FILE_BYTES + 10,
        bytesRead: realContent.length,
        limit: Number(options.maxBytes || 0),
        previewBytes: Number(options.previewBytes || 0),
        offset: 0,
        truncated: true,
        path: largePath,
      }
    }

    await openWorkspaceFile()
    const ok = await openFile("logs/extreme.log")

    expect(ok).toBe(true)
    expect(readCount).toBe(2)
    expect(workspace.activeFile).toBe("logs/extreme.log")
    expect(workspace.files["logs/extreme.log"]).toContain("real fallback content")
    expect(isReadOnlyFile("logs/extreme.log")).toBe(false)
    expect(getLargeFileState("logs/extreme.log")).toMatchObject({
      mode: "range",
      readOnly: false,
      truncated: true,
    })
  })

  it("retries a legacy FILE_TOO_LARGE signal above the local confirmation safety limit as a real range window", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/bridge-over-limit.data"
    const markerInFirstWindow = "real content in first bounded window\n"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const largeContent = `${markerInFirstWindow}${"a".repeat(windowBytes - markerInFirstWindow.length)}`
    files.set(largePath, largeContent)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    const readOptions: Array<Record<string, unknown>> = []
    let readCount = 0
    delete (window as unknown as { codek: Record<string, unknown> }).codek.readFileTextChunk
    ;(window as unknown as { codek: Record<string, unknown> }).codek.readFile = async (_path: string, options: Record<string, unknown> = {}) => {
      readCount += 1
      readOptions.push(options)
      if (readCount === 1) {
        return {
          error: "FILE_TOO_LARGE",
          size: virtualSize,
          limit: MAX_EDITABLE_FILE_BYTES,
          path: largePath,
        }
      }
      const offset = Number(options.offset || 0)
      const length = Number(options.length || options.previewBytes || windowBytes)
      return {
        content: largeContent.slice(offset, offset + length),
        size: virtualSize,
        bytesRead: Math.min(length, Math.max(0, largeContent.length - offset)),
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: true,
        path: largePath,
      }
    }

    await openWorkspaceFile()
    const ok = await openFile("logs/bridge-over-limit.data")

    expect(ok).toBe(true)
    expect(readCount).toBeGreaterThanOrEqual(Math.ceil(windowBytes / LARGE_FILE_IPC_CHUNK_BYTES))
    expect(readOptions[0]).toEqual(expect.objectContaining({
      maxBytes: LARGE_FILE_IPC_CHUNK_BYTES,
      offset: 0,
      preview: true,
    }))
    expect(readOptions.some((options) => Number(options.offset || 0) === LARGE_FILE_IPC_CHUNK_BYTES)).toBe(true)
    expect(readOptions.every((options) => Number(options.maxBytes || 0) <= LARGE_FILE_IPC_CHUNK_BYTES)).toBe(true)
    expect(workspace.files["logs/bridge-over-limit.data"]).toContain(markerInFirstWindow.trim())
    expect(workspace.files["logs/bridge-over-limit.data"]).not.toContain("FILE_TOO_LARGE")
    expect(workspace.files["logs/bridge-over-limit.data"]).not.toContain("file is too large")
    expect(isReadOnlyFile("logs/bridge-over-limit.data")).toBe(false)
    expect(getLargeFileState("logs/bridge-over-limit.data")).toMatchObject({
      mode: "range",
      readOnly: false,
      truncated: true,
    })
    expect(workspace.largeFileNotice).toMatchObject({
      path: "logs/bridge-over-limit.data",
      mode: "range",
    })
  })

  it("opens a bounded range window when file stat does not return", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/stat-timeout-260mb.log"
    const marker = "stat timeout first window\n"
    const virtualSize = 260 * 1024 * 1024
    const windowBytes = getLargeFileWindowBytes(Number.MAX_SAFE_INTEGER)
    const largeContent = `${marker}${repeatToLength("stat timeout line\n", windowBytes - marker.length)}`
    files.set(largePath, largeContent)
    installFakeFs(roots)
    const readOptions: Array<Record<string, unknown>> = []
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = () => new Promise(() => {})
    installRangeReaders(async (_path: string, options: Record<string, unknown> = {}) => {
      readOptions.push(options)
      const length = Number(options.length || options.previewBytes || windowBytes)
      const offset = Number(options.offset || 0)
      return {
        content: largeContent.slice(offset, offset + length),
        size: virtualSize,
        bytesRead: Math.min(length, Math.max(0, largeContent.length - offset)),
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: offset + length < virtualSize,
        path: largePath,
      }
    })

    await openWorkspaceFile()
    const ok = await openFile("logs/stat-timeout-260mb.log")

    expect(ok).toBe(true)
    expectChunkedWindowRead(readOptions, windowBytes)
    expect(workspace.activeFile).toBe("logs/stat-timeout-260mb.log")
    expect(workspace.files["logs/stat-timeout-260mb.log"]).toContain(marker.trim())
    expect(getLargeFileState("logs/stat-timeout-260mb.log")).toMatchObject({
      mode: "range",
      readOnly: false,
      truncated: true,
      offset: 0,
      hasNext: true,
    })
    expect(workspace.largeFileNotice).toMatchObject({
      path: "logs/stat-timeout-260mb.log",
      mode: "range",
      readOnly: false,
    })
  })

  it("waits for stat before opening known large text candidates and then commits byte-window range content", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/direct-preview-64mb.log"
    const marker = "direct full read first line\n"
    const virtualSize = 64 * 1024 * 1024
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const secondMarker = "direct optimized second window\n"
    const largeContent = `${marker}${repeatToLength("direct full read line\n", windowBytes - marker.length)}${secondMarker}${repeatToLength("next range line\n", windowBytes - secondMarker.length)}`
    files.set(largePath, largeContent)
    installFakeFs(roots)
    let statCalls = 0
    const readOptions: Array<Record<string, unknown>> = []
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => {
      statCalls += 1
      return { exists: true, isFile: true, isDirectory: false, size: virtualSize }
    }
    installRangeReaders(async (_path: string, options: Record<string, unknown> = {}) => {
      readOptions.push(options)
      const offset = Number(options.offset || 0)
      const length = Number(options.length || options.previewBytes || options.maxBytes || windowBytes)
      return {
        content: largeContent.slice(offset, offset + length),
        size: virtualSize,
        bytesRead: Math.min(length, Math.max(0, largeContent.length - offset)),
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: offset + length < virtualSize,
        path: largePath,
      }
    })

    await openWorkspaceFile()
    const ok = await openFile("logs/direct-preview-64mb.log")

    expect(ok).toBe(true)
    expect(statCalls).toBeGreaterThan(0)
    expect(workspace.activeFile).toBe("logs/direct-preview-64mb.log")
    expect(workspace.files["logs/direct-preview-64mb.log"]).toContain(marker.trim())
    expect(workspace.files["logs/direct-preview-64mb.log"]).not.toContain(secondMarker.trim())
    expect(getLargeFileState("logs/direct-preview-64mb.log")).toMatchObject({
      mode: "range",
      readOnly: false,
      truncated: true,
      offset: 0,
      hasNext: true,
    })
    expectWindowRead(readOptions, windowBytes)
    await expect(loadNextLargeFileWindow("logs/direct-preview-64mb.log")).resolves.toBe(true)
    expect(workspace.files["logs/direct-preview-64mb.log"]).toContain(secondMarker.trim())
    expect(getLargeFileState("logs/direct-preview-64mb.log")).toMatchObject({
      mode: "range",
      offset: windowBytes,
      hasPrevious: true,
    })
  })

  it("keeps consecutive source/json file opens responsive when a later stat call stalls", async () => {
    const roots = ["D:/apps/sourcemirror"]
    const firstPath = "D:/apps/sourcemirror/vscode/.build/builtInExtensions/ms-vscode.js-debug/src/ui/basic-wat.configuration.json"
    const secondPath = "D:/apps/sourcemirror/vscode/.build/builtInExtensions/ms-vscode.js-debug/src/ui/basic-wat.tmLanguage.json"
    files.set(firstPath, '{ "configuration": true }\n')
    files.set(secondPath, '{ "scopeName": "source.wat" }\n')
    installFakeFs(roots)
    let statCalls = 0
    const textChunkReads: string[] = []
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = () => {
      statCalls += 1
      return new Promise(() => {})
    }
    ;(window as unknown as { codek: Record<string, unknown> }).codek.readFileTextChunk = async (pathValue: string, options: Record<string, unknown> = {}) => {
      const normalizedPath = normalizePath(pathValue)
      textChunkReads.push(normalizedPath)
      const content = files.get(normalizedPath)
      if (typeof content !== "string") return null
      const length = Math.max(1, Number(options.length || options.previewBytes || options.maxBytes || content.length))
      const offset = Math.max(0, Number(options.offset || 0))
      return {
        content: content.slice(offset, offset + length),
        size: content.length,
        bytesRead: Math.min(length, Math.max(0, content.length - offset)),
        limit: Number(options.maxBytes || length),
        previewBytes: length,
        offset,
        truncated: offset + length < content.length,
        path: normalizedPath,
      }
    }

    await openWorkspaceFile()
    await expect(openFile("vscode/.build/builtInExtensions/ms-vscode.js-debug/src/ui/basic-wat.configuration.json")).resolves.toBe(true)
    await expect(openFile("vscode/.build/builtInExtensions/ms-vscode.js-debug/src/ui/basic-wat.tmLanguage.json")).resolves.toBe(true)

    expect(statCalls).toBe(0)
    expect(textChunkReads).toEqual([firstPath, secondPath])
    expect(readFileCalls).toEqual([])
    expect(workspace.activeFile).toBe("vscode/.build/builtInExtensions/ms-vscode.js-debug/src/ui/basic-wat.tmLanguage.json")
    expect(workspace.openFiles).toEqual([
      "vscode/.build/builtInExtensions/ms-vscode.js-debug/src/ui/basic-wat.configuration.json",
      "vscode/.build/builtInExtensions/ms-vscode.js-debug/src/ui/basic-wat.tmLanguage.json",
    ])
    expect(workspace.files["vscode/.build/builtInExtensions/ms-vscode.js-debug/src/ui/basic-wat.tmLanguage.json"]).toContain("source.wat")
  })

  it("uses editable range windows beyond the renderer sync guard", async () => {
    const roots = ["D:/apps/codek"]
    const extremePath = "D:/apps/codek/logs/extreme.log"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const firstMarker = "first extreme window\n"
    const secondMarker = "second extreme window\n"
    const firstWindow = `${firstMarker}${repeatToLength("alpha line\n", windowBytes - firstMarker.length)}`
    const secondWindow = `${secondMarker}${repeatToLength("beta line\n", windowBytes - secondMarker.length)}`
    files.set(extremePath, firstWindow + secondWindow)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    installRangeReaders(async (_path: string, options: Record<string, unknown> = {}) => {
      if (options.preview && options.offset !== undefined) {
        const offset = Number(options.offset || 0)
        const length = Number(options.length || options.previewBytes || windowBytes)
        const content = files.get(extremePath) || ""
        return {
          content: content.slice(offset, offset + length),
          size: virtualSize,
          bytesRead: length,
          limit: Number(options.maxBytes || 0),
          previewBytes: length,
          offset,
          truncated: true,
          path: extremePath,
        }
      }
      return {
        error: "FILE_TOO_LARGE",
        size: virtualSize,
        limit: Number(options.maxBytes || 0),
        path: extremePath,
      }
    })

    await openWorkspaceFile()
    const ok = await openFile("logs/extreme.log")

    expect(ok).toBe(true)
    expect(workspace.activeFile).toBe("logs/extreme.log")
    expect(workspace.files["logs/extreme.log"]).toContain("first extreme window")
    expect(isReadOnlyFile("logs/extreme.log")).toBe(false)
    expect(getLargeFileState("logs/extreme.log")).toMatchObject({
      mode: "range",
      readOnly: false,
      truncated: true,
      offset: 0,
      hasPrevious: false,
      hasNext: true,
    })
    expect(workspace.largeFileNotice).toMatchObject({
      path: "logs/extreme.log",
      mode: "range",
      readOnly: false,
      truncated: true,
    })

    await expect(loadNextLargeFileWindow("logs/extreme.log")).resolves.toBe(true)
    expect(workspace.files["logs/extreme.log"]).toContain("second extreme window")
    expect(getLargeFileState("logs/extreme.log")).toMatchObject({
      mode: "range",
      readOnly: false,
      hasPrevious: true,
    })

    await expect(loadPreviousLargeFileWindow("logs/extreme.log")).resolves.toBe(true)
    expect(workspace.files["logs/extreme.log"]).toContain("first extreme window")
    expect(getLargeFileState("logs/extreme.log")).toMatchObject({
      offset: 0,
      hasPrevious: false,
      hasNext: true,
    })
    await expect(saveFile("logs/extreme.log", "edited")).resolves.toBe(true)
    expect(files.get(extremePath)).toBe(`edited\n${firstWindow.slice(LARGE_FILE_EDITOR_RENDER_BYTES)}${secondWindow}`)
  })

  it("can traverse a 260MiB range file to the final non-empty byte window", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/final-window-260mb.log"
    const virtualSize = 260 * 1024 * 1024
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const windowCount = Math.ceil(virtualSize / windowBytes)
    const finalWindowOffset = Math.max(0, virtualSize - windowBytes)
    const finalMarker = "final 260mb window marker\n"
    installFakeFs(roots)
    const windowReadOffsets: number[] = []
    const windowReadSizes: number[] = []
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    installRangeReaders(async (_path: string, options: Record<string, unknown> = {}) => {
      const offset = Number(options.offset || 0)
      const length = Number(options.length || options.previewBytes || windowBytes)
      windowReadOffsets.push(offset)
      windowReadSizes.push(Number(options.fileSize || options.size || 0))
      const remaining = Math.max(0, virtualSize - offset)
      const bytesRead = Math.min(length, remaining)
      const content = offset >= finalWindowOffset
        ? `${offset === finalWindowOffset ? finalMarker : ""}${"tail range line\n".repeat(32)}`
        : `range window at ${offset}\n`
      return {
        content,
        size: virtualSize,
        bytesRead,
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: offset + bytesRead < virtualSize,
        path: largePath,
      }
    })

    await openWorkspaceFile()
    await expect(openFile("logs/final-window-260mb.log")).resolves.toBe(true)

    for (let index = 1; index < windowCount; index += 1) {
      await expect(loadNextLargeFileWindow("logs/final-window-260mb.log")).resolves.toBe(true)
    }

    const finalState = getLargeFileState("logs/final-window-260mb.log")
    expect(finalState).toMatchObject({
      mode: "range",
      offset: finalWindowOffset,
      hasPrevious: true,
      hasNext: false,
    })
    expect(workspace.files["logs/final-window-260mb.log"]).toContain(finalMarker.trim())
    expect(lineCount(workspace.files["logs/final-window-260mb.log"])).toBeGreaterThan(2000)
    expect(maxLineLength(workspace.files["logs/final-window-260mb.log"])).toBeLessThanOrEqual(LARGE_FILE_SAFE_RENDER_LINE_CHARS)
    expect(windowReadOffsets).toContain(0)
    expect(windowReadOffsets).toContain(finalWindowOffset)
    expect(windowReadSizes.every((size) => size === virtualSize)).toBe(true)
  })

  it("uses the range-window cache when returning to a prefetched previous window", async () => {
    const roots = ["D:/apps/codek"]
    const extremePath = "D:/apps/codek/logs/cache-window.log"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const firstMarker = "cache first window\n"
    const secondMarker = "cache second window\n"
    const firstWindow = `${firstMarker}${repeatToLength("alpha line\n", windowBytes - firstMarker.length)}`
    const secondWindow = `${secondMarker}${repeatToLength("beta line\n", windowBytes - secondMarker.length)}`
    files.set(extremePath, firstWindow + secondWindow)
    installFakeFs(roots)
    const windowReadOffsets: number[] = []
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    installRangeReaders(async (_path: string, options: Record<string, unknown> = {}) => {
      const offset = Number(options.offset || 0)
      if (options.preview) windowReadOffsets.push(offset)
      const length = Number(options.length || options.previewBytes || windowBytes)
      const content = files.get(extremePath) || ""
      return {
        content: content.slice(offset, offset + length),
        size: virtualSize,
        bytesRead: length,
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: true,
        path: extremePath,
      }
    })

    await openWorkspaceFile()
    await expect(openFile("logs/cache-window.log")).resolves.toBe(true)
    await expect(loadNextLargeFileWindow("logs/cache-window.log")).resolves.toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const readsBeforeReturn = [...windowReadOffsets]

    await expect(loadPreviousLargeFileWindow("logs/cache-window.log")).resolves.toBe(true)

    expect(workspace.files["logs/cache-window.log"]).toContain("cache first window")
    expect(readsBeforeReturn).toContain(0)
    expect(readsBeforeReturn).toContain(windowBytes)
    expect(windowReadOffsets).toEqual(readsBeforeReturn)
  })

  it("does not treat an EOF range read as a populated next window", async () => {
    const roots = ["D:/apps/codek"]
    const extremePath = "D:/apps/codek/logs/eof-window.log"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const firstMarker = "eof first window\n"
    const firstWindow = `${firstMarker}${repeatToLength("alpha line\n", windowBytes - firstMarker.length)}`
    files.set(extremePath, firstWindow)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    ;(window as unknown as { codek: Record<string, unknown> }).codek.readFileTextChunk = async (_path: string, options: Record<string, unknown> = {}) => {
      const offset = Number(options.offset || 0)
      const length = Number(options.length || options.previewBytes || windowBytes)
      if (offset >= firstWindow.length) {
        return {
          content: "",
          size: firstWindow.length,
          bytesRead: 0,
          limit: Number(options.maxBytes || 0),
          previewBytes: length,
          offset,
          truncated: false,
          path: extremePath,
        }
      }
      const content = firstWindow.slice(offset, offset + length)
      return {
        content,
        size: virtualSize,
        bytesRead: content.length,
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: true,
        path: extremePath,
      }
    }

    await openWorkspaceFile()
    await expect(openFile("logs/eof-window.log")).resolves.toBe(true)
    const previousContent = workspace.files["logs/eof-window.log"]

    await expect(loadNextLargeFileWindow("logs/eof-window.log")).resolves.toBe(false)

    expect(workspace.files["logs/eof-window.log"]).toBe(previousContent)
    expect(getLargeFileState("logs/eof-window.log")).toMatchObject({
      offset: 0,
      hasNext: true,
    })
  })

  it("falls back to a real range window when a legacy bridge keeps returning FILE_TOO_LARGE", async () => {
    const roots = ["D:/apps/codek"]
    const extremePath = "D:/apps/codek/logs/legacy-bridge.log"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const firstMarker = "legacy bridge real first window\n"
    const secondMarker = "legacy bridge real second window\n"
    const firstWindow = `${firstMarker}${"a".repeat(windowBytes - firstMarker.length)}`
    const secondWindow = `${secondMarker}${"b".repeat(windowBytes - secondMarker.length)}`
    files.set(extremePath, firstWindow + secondWindow)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    installRangeReaders(async (_path: string, options: Record<string, unknown> = {}) => {
      if (options.preview && options.offset !== undefined) {
        expect(Number(options.maxBytes || 0)).toBeLessThanOrEqual(windowBytes)
        const previewBytes = Math.min(Number(options.length || options.previewBytes || windowBytes), windowBytes)
        const offset = Number(options.offset || 0)
        const content = files.get(extremePath) || ""
        return {
          content: content.slice(offset, offset + previewBytes),
          size: virtualSize,
          bytesRead: previewBytes,
          limit: Number(options.maxBytes || 0),
          previewBytes,
          offset,
          truncated: true,
          path: extremePath,
        }
      }
      return {
        error: "FILE_TOO_LARGE",
        size: virtualSize,
        limit: Number(options.maxBytes || 0),
        path: extremePath,
      }
    })

    await openWorkspaceFile()
    const ok = await openFile("logs/legacy-bridge.log")

    expect(ok).toBe(true)
    expect(workspace.activeFile).toBe("logs/legacy-bridge.log")
    expect(workspace.files["logs/legacy-bridge.log"]).toContain("legacy bridge real first window")
    expect(isReadOnlyFile("logs/legacy-bridge.log")).toBe(false)
    expect(getLargeFileState("logs/legacy-bridge.log")).toMatchObject({
      mode: "range",
      readOnly: false,
      truncated: true,
      offset: 0,
      hasPrevious: false,
      hasNext: true,
    })
    await expect(loadNextLargeFileWindow("logs/legacy-bridge.log")).resolves.toBe(true)
    expect(workspace.files["logs/legacy-bridge.log"]).toContain("legacy bridge real second window")
  })

  it("keeps range reloads bounded to the current byte window instead of re-reading the whole huge file", async () => {
    const roots = ["D:/apps/codek"]
    const extremePath = "D:/apps/codek/logs/range-reload.log"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const firstMarker = "range reload first window\n"
    const firstWindow = `${firstMarker}${"a".repeat(windowBytes - firstMarker.length)}`
    files.set(extremePath, firstWindow)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    const readOptions: Array<Record<string, unknown>> = []
    installRangeReaders(async (_path: string, options: Record<string, unknown> = {}) => {
      readOptions.push(options)
      if (options.preview && options.offset !== undefined) {
        const maxBytes = Number(options.maxBytes || 0)
        const length = Number(options.length || 0)
        expect(maxBytes).toBeLessThanOrEqual(windowBytes)
        expect(length).toBeLessThanOrEqual(windowBytes)
        const offset = Number(options.offset || 0)
        const previewBytes = Math.min(Number(options.length || options.previewBytes || windowBytes), windowBytes)
        return {
          content: firstWindow.slice(offset, offset + previewBytes),
          size: virtualSize,
          bytesRead: previewBytes,
          limit: maxBytes,
          previewBytes,
          offset,
          truncated: true,
          path: extremePath,
        }
      }
      return {
        error: "FILE_TOO_LARGE",
        size: (1024 * 1024 * 1024) + 1,
        limit: Number(options.maxBytes || 0),
        path: extremePath,
      }
    })

    await openWorkspaceFile()
    await expect(openFile("logs/range-reload.log")).resolves.toBe(true)
    await expect(reloadFile("logs/range-reload.log")).resolves.toBe(true)

    const rangeReads = readOptions.filter((options) => options.preview && options.offset !== undefined)
    expect(rangeReads.length).toBeGreaterThanOrEqual(2)
    expect(rangeReads.every((options) => Number(options.maxBytes || 0) <= windowBytes)).toBe(true)
    expect(workspace.files["logs/range-reload.log"]).toContain("range reload first window")
    expect(workspace.files["logs/range-reload.log"]).not.toContain("FILE_TOO_LARGE")
    expect(workspace.files["logs/range-reload.log"]).not.toContain("file is too large")
  })

  it("rejects directories before attempting to read them as editor files", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "console.log('hello')")
    installFakeFs(roots)

    await openWorkspaceFile()
    const ok = await openFile("src")

    expect(ok).toBe(false)
    expect(workspace.activeFile).toBeNull()
    expect(workspace.openFiles).toEqual([])
    expect(readFileCalls).toEqual([])
  })

  it("accepts VS Code FileType stats from the bridge before opening editor files", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async (pathValue: string) => {
      const normalized = normalizePath(pathValue)
      if (normalized === "D:/apps/codek/src") {
        return { exists: true, type: FileType.Directory, size: 0, mtime: 1710000000000 }
      }
      return { exists: true, type: FileType.File, size: files.get(normalized)?.length || 0, mtime: 1710000000001 }
    }

    await openWorkspaceFile()

    await expect(openFile("src")).resolves.toBe(false)
    expect(readFileCalls).toEqual([])

    await expect(openFile("src/main.ts")).resolves.toBe(true)
    expect(workspace.activeFile).toBe("src/main.ts")
    expect(workspace.files["src/main.ts"]).toBe("export const value = 1")
  })

  it("blocks binary built-in extension artifacts from opening as text editor files", async () => {
    const roots = ["D:/apps/sourcemirror"]
    const binaryPath = "D:/apps/sourcemirror/vscode/.build/builtInExtensions/ms-vscode.js-debug/src/chromehash_bg.wasm"
    files.set(binaryPath, "\0asm-binary")
    installFakeFs(roots)

    await openWorkspaceFile()
    const ok = await openFile("vscode/.build/builtInExtensions/ms-vscode.js-debug/src/chromehash_bg.wasm")

    expect(ok).toBe(false)
    expect(workspace.activeFile).toBeNull()
    expect(workspace.openFiles).toEqual([])
    expect(workspace.files).not.toHaveProperty("vscode/.build/builtInExtensions/ms-vscode.js-debug/src/chromehash_bg.wasm")
    expect(workspace.largeFileNotice).toMatchObject({
      path: "vscode/.build/builtInExtensions/ms-vscode.js-debug/src/chromehash_bg.wasm",
      reason: "binary-file",
    })
    expect(readFileCalls).toEqual([])
  })

  it("blocks Electron and VS Code binary resource artifacts before reading them into Monaco", async () => {
    const roots = ["D:/apps/sourcemirror"]
    const pakPath = "D:/apps/sourcemirror/vscode/.build/electron/locales/af.pak"
    const datPath = "D:/apps/sourcemirror/vscode/.build/electron/icudtl.dat"
    files.set(pakPath, "\0pak-binary")
    files.set(datPath, "\0dat-binary")
    installFakeFs(roots)

    await openWorkspaceFile()

    await expect(openFile("vscode/.build/electron/locales/af.pak")).resolves.toBe(false)
    await expect(openFile("vscode/.build/electron/icudtl.dat")).resolves.toBe(false)

    expect(workspace.activeFile).toBeNull()
    expect(workspace.openFiles).toEqual([])
    expect(workspace.files).not.toHaveProperty("vscode/.build/electron/locales/af.pak")
    expect(workspace.files).not.toHaveProperty("vscode/.build/electron/icudtl.dat")
    expect(workspace.largeFileNotice).toMatchObject({
      path: "vscode/.build/electron/icudtl.dat",
      reason: "binary-file",
    })
    expect(readFileCalls).toEqual([])
  })

  it("blocks binary artifacts from read and reload cache paths before they can re-enter the editor", async () => {
    const roots = ["D:/apps/sourcemirror"]
    const pakPath = "D:/apps/sourcemirror/vscode/.build/electron/locales/af.pak"
    const datPath = "D:/apps/sourcemirror/vscode/.build/electron/icudtl.dat"
    files.set(pakPath, "\0pak-binary")
    files.set(datPath, "\0dat-binary")
    installFakeFs(roots)

    await openWorkspaceFile()
    workspace.files["vscode/.build/electron/locales/af.pak"] = "\0stale-pak-cache"
    workspace.files["vscode/.build/electron/icudtl.dat"] = "\0stale-dat-cache"
    workspace.openFiles.push("vscode/.build/electron/locales/af.pak", "vscode/.build/electron/icudtl.dat")
    workspace.activeFile = "vscode/.build/electron/icudtl.dat"

    await expect(readProjectFile("vscode/.build/electron/locales/af.pak")).resolves.toBeNull()
    await expect(reloadFile("vscode/.build/electron/icudtl.dat")).resolves.toBe(false)

    expect(workspace.files).not.toHaveProperty("vscode/.build/electron/locales/af.pak")
    expect(workspace.files).not.toHaveProperty("vscode/.build/electron/icudtl.dat")
    expect(workspace.openFiles).toEqual([])
    expect(workspace.activeFile).toBeNull()
    expect(workspace.largeFileNotice).toMatchObject({
      path: "vscode/.build/electron/icudtl.dat",
      reason: "binary-file",
    })
    expect(readFileCalls).toEqual([])
  })

  it("removes stale binary artifact editor state when a previously opened artifact is clicked again", async () => {
    const roots = ["D:/apps/sourcemirror"]
    const pakPath = "D:/apps/sourcemirror/vscode/.build/electron/locales/af.pak"
    files.set(pakPath, "\0pak-binary")
    files.set("D:/apps/sourcemirror/src/main.ts", "export const alive = true\n")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    workspace.files["vscode/.build/electron/locales/af.pak"] = "\0stale binary text"
    workspace.openFiles.push("vscode/.build/electron/locales/af.pak")
    workspace.activeFile = "vscode/.build/electron/locales/af.pak"
    updateFile("vscode/.build/electron/locales/af.pak", "\0stale binary text", { dirty: true, external: false })

    await expect(openFile("vscode/.build/electron/locales/af.pak")).resolves.toBe(false)

    expect(workspace.activeFile).toBe("src/main.ts")
    expect(workspace.openFiles).toEqual(["src/main.ts"])
    expect(workspace.files).not.toHaveProperty("vscode/.build/electron/locales/af.pak")
    expect(workspace.dirtyFiles).not.toHaveProperty("vscode/.build/electron/locales/af.pak")
    expect(readFileCalls).not.toContain(pakPath)
  })

  it("blocks unknown-extension binary content after the safety probe instead of retrying it as a large text file", async () => {
    const roots = ["D:/apps/sourcemirror"]
    const binaryPath = "D:/apps/sourcemirror/vscode/.build/electron/resources"
    const binaryContent = `MZ\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u000b\u000e\u000f${"A".repeat(512)}`
    files.set(binaryPath, binaryContent)
    installFakeFs(roots)

    await openWorkspaceFile()
    const ok = await openFile("vscode/.build/electron/resources")

    expect(ok).toBe(false)
    expect(workspace.activeFile).toBeNull()
    expect(workspace.openFiles).toEqual([])
    expect(workspace.files).not.toHaveProperty("vscode/.build/electron/resources")
    expect(workspace.largeFileNotice).toMatchObject({
      path: "vscode/.build/electron/resources",
      reason: "binary-file",
    })
    expect(readFileCalls).toEqual([binaryPath])
  })

  it("restores only loaded open files and chooses a safe active file", async () => {
    const roots = ["D:/apps/session"]
    files.set("D:/apps/session/src/a.ts", "a")
    files.set("D:/apps/session/src/b.ts", "b")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/a.ts")
    await openFile("src/b.ts")

    await restoreOpenFiles(["src/a.ts", "src/missing.ts", "src/b.ts", "src/a.ts"], "src/missing.ts")

    expect(workspace.openFiles).toEqual(["src/a.ts", "src/b.ts"])
    expect(workspace.activeFile).toBe("src/b.ts")

    await restoreOpenFiles(["src/a.ts", "src/b.ts"], "src/a.ts")

    expect(workspace.openFiles).toEqual(["src/a.ts", "src/b.ts"])
    expect(workspace.activeFile).toBe("src/a.ts")
  })

  it("restores real filesystem tab paths without eagerly reading file contents", async () => {
    const roots = ["D:/apps/reopen"]
    files.set("D:/apps/reopen/src/a.ts", "a")
    files.set("D:/apps/reopen/src/b.ts", "b")
    installFakeFs(roots)

    await openWorkspaceFile()
    await restoreOpenFiles(["src/a.ts", "src/b.ts"], "src/a.ts")

    expect(workspace.openFiles).toEqual(["src/a.ts", "src/b.ts"])
    expect(workspace.activeFile).toBe("src/a.ts")
    expect(readFileCalls).toEqual([])
    expect(workspace.files).toEqual({})
  })

  it("filters stale binary artifact tabs during layout restore before they can become active again", async () => {
    const roots = ["D:/apps/sourcemirror"]
    files.set("D:/apps/sourcemirror/src/main.ts", "export const alive = true\n")
    files.set("D:/apps/sourcemirror/vscode/.build/electron/locales/af.pak", "\0pak-binary")
    files.set("D:/apps/sourcemirror/vscode/.build/electron/icudtl.dat", "\0dat-binary")
    installFakeFs(roots)

    await openWorkspaceFile()
    workspace.files["vscode/.build/electron/locales/af.pak"] = "\0stale-pak-cache"
    workspace.files["vscode/.build/electron/icudtl.dat"] = "\0stale-dat-cache"

    await restoreOpenFiles([
      "vscode/.build/electron/locales/af.pak",
      "src/main.ts",
      "vscode/.build/electron/icudtl.dat",
    ], "vscode/.build/electron/icudtl.dat")

    expect(workspace.openFiles).toEqual(["src/main.ts"])
    expect(workspace.activeFile).toBe("src/main.ts")
    expect(workspace.files).not.toHaveProperty("vscode/.build/electron/locales/af.pak")
    expect(workspace.files).not.toHaveProperty("vscode/.build/electron/icudtl.dat")
    expect(readFileCalls).toEqual([])
  })

  it("opens deep files without expanding and reading ancestor directories", async () => {
    const roots = ["D:/apps/deep"]
    files.set("D:/apps/deep/src/features/a/b/c/deep.ts", "export const deep = true")
    files.set("D:/apps/deep/package.json", "{}")
    installFakeFs(roots)

    await openWorkspaceFile()
    const ok = await openFile("src/features/a/b/c/deep.ts")

    expect(ok).toBe(true)
    expect(workspace.activeFile).toBe("src/features/a/b/c/deep.ts")
    expect(readDirCalls).toEqual([])

    await openWorkspaceFile()

    expect(readDirCalls).toEqual([])
  })

  it("refreshes the Explorer snapshot without reopening the active file", async () => {
    const roots = ["D:/apps/refresh-decoupled"]
    files.set("D:/apps/refresh-decoupled/src/main.ts", "export const value = 1")
    files.set("D:/apps/refresh-decoupled/package.json", "{}")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    readFileCalls = []

    await refreshFileTree()

    expect(workspace.activeFile).toBe("src/main.ts")
    expect(readFileCalls).toEqual([])
    expect(readDirCalls).toEqual([])
  })

  it("treats stale reload reads as a missing file instead of surfacing an IPC error", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    installFakeFs(roots)
    await openWorkspaceFile()
    await openFile("src/main.ts")
    delete (window as unknown as { codek: Record<string, unknown> }).codek.readFileTextChunk
    ;(window as unknown as { codek: Record<string, unknown> }).codek.readFile = async () => {
      throw new Error("Cannot read D:/apps/codek/src/main.ts: ENOENT: no such file or directory")
    }

    await expect(reloadFile("src/main.ts")).resolves.toBe(false)

    expect(workspace.files["src/main.ts"]).toBe("export const value = 1")
  })

  it("renames files and keeps editor state aligned", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    const ok = await renameEntry("src/main.ts", "src/app.ts")

    expect(ok).toBe(true)
    expect(renameCalls).toEqual([{ oldPath: "D:/apps/codek/src/main.ts", newPath: "D:/apps/codek/src/app.ts" }])
    expect(workspace.activeFile).toBe("src/app.ts")
    expect(workspace.openFiles).toEqual(["src/app.ts"])
    expect(workspace.files["src/app.ts"]).toContain("value")
  })

  it("keeps VS Code working copy dirty state aligned across update clean external rename and delete", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")

    updateFile("src/main.ts", "export const value = 2", { dirty: true, external: false })
    expect(isDirty("src/main.ts")).toBe(true)
    expect(workspace.dirtyFiles).toHaveProperty("src/main.ts")

    markChangedExternally("src/main.ts")
    expect(hasExternalChange("src/main.ts")).toBe(true)
    expect(workspace.externalChanges).toHaveProperty("src/main.ts")

    markClean("src/main.ts")
    expect(isDirty("src/main.ts")).toBe(false)
    expect(workspace.dirtyFiles).not.toHaveProperty("src/main.ts")
    expect(hasExternalChange("src/main.ts")).toBe(true)
    expect(workspace.externalChanges).toHaveProperty("src/main.ts")

    clearExternalChange("src/main.ts")
    expect(hasExternalChange("src/main.ts")).toBe(false)
    expect(workspace.externalChanges).not.toHaveProperty("src/main.ts")

    updateFile("src/main.ts", "export const value = 3", { dirty: true, external: false })
    expect(isDirty("src/main.ts")).toBe(true)
    markChangedExternally("src/main.ts")
    await renameEntry("src/main.ts", "src/app.ts")

    expect(isDirty("src/main.ts")).toBe(false)
    expect(hasExternalChange("src/main.ts")).toBe(false)
    expect(isDirty("src/app.ts")).toBe(false)
    expect(hasExternalChange("src/app.ts")).toBe(false)
    expect(workspace.dirtyFiles).not.toHaveProperty("src/main.ts")
    expect(workspace.dirtyFiles).not.toHaveProperty("src/app.ts")
    expect(workspace.externalChanges).not.toHaveProperty("src/main.ts")
    expect(workspace.externalChanges).not.toHaveProperty("src/app.ts")

    await deleteFile("src/app.ts")
    expect(isDirty("src/app.ts")).toBe(false)
    expect(workspace.dirtyFiles).not.toHaveProperty("src/app.ts")
    expect(workspace.externalChanges).not.toHaveProperty("src/app.ts")
  })

  it("exposes legacy dirty and external records as read-only projections", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")

    expect(() => {
      ;(workspace as unknown as { dirtyFiles: Record<string, unknown> }).dirtyFiles = {}
    }).toThrow(/read-only TextFileStateCollection projection/)
    expect(() => {
      ;(workspace.dirtyFiles as Record<string, unknown>)["src/main.ts"] = true
    }).toThrow(/read-only TextFileStateCollection projection/)
    expect(() => {
      delete (workspace.externalChanges as Record<string, unknown>)["src/main.ts"]
    }).toThrow(/read-only TextFileStateCollection projection/)

    updateFile("src/main.ts", "export const value = 2", { dirty: true, external: false })
    expect(workspace.dirtyFiles).toHaveProperty("src/main.ts")
    expect(isDirty("src/main.ts")).toBe(true)
  })

  it("maps save reload conflict and error paths to VS Code text file lifecycle states", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")

    updateFile("src/main.ts", "export const value = 2", { dirty: true, external: false })
    expect(getTextFileStateName("src/main.ts")).toBe("dirty")

    markChangedExternally("src/main.ts")
    await expect(saveFile("src/main.ts", "export const value = 3")).resolves.toBe(false)
    expect(getTextFileStateName("src/main.ts")).toBe("conflict")
    expect(isTextFileState("src/main.ts", "conflict")).toBe(true)
    expect(isDirty("src/main.ts")).toBe(true)
    expect(files.get("D:/apps/codek/src/main.ts")).toBe("export const value = 1")

    await expect(saveFile("src/main.ts", "export const value = 3", { ignoreModifiedSince: true })).resolves.toBe(true)
    expect(getTextFileStateName("src/main.ts")).toBe("saved")
    expect(hasExternalChange("src/main.ts")).toBe(false)
    expect(isDirty("src/main.ts")).toBe(false)
    expect(files.get("D:/apps/codek/src/main.ts")).toBe("export const value = 3\n")
    expect(fileOperationState.operations.at(-1)).toMatchObject({
      type: "update_file",
      source: "user",
      pathBefore: "src/main.ts",
      pathAfter: "src/main.ts",
      afterContent: "export const value = 3\n",
    })

    updateFile("src/main.ts", "export const value = 4", { dirty: true, external: false })
    writeFileFailures.add("D:/apps/codek/src/main.ts")
    await expect(saveFile("src/main.ts", "export const value = 4")).resolves.toBe(false)
    expect(getTextFileStateName("src/main.ts")).toBe("error")
    expect(isDirty("src/main.ts")).toBe(true)

    writeFileFailures = new Set<string>()
    files.delete("D:/apps/codek/src/main.ts")
    delete (window as unknown as { codek: Record<string, unknown> }).codek.readFileTextChunk
    await expect(reloadFile("src/main.ts")).resolves.toBe(false)
    expect(getTextFileStateName("src/main.ts")).toBe("orphan")
    expect(hasExternalChange("src/main.ts")).toBe(true)
  })

  it("keeps Explorer opens Open Editors and editor part breadcrumbs on one workspace source", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    files.set("D:/apps/codek/src/side.ts", "export const side = true")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    await openFile("src/side.ts")
    await saveFile("src/main.ts", "export const value = 2")

    expectOpenEditorsBridge({
      openFiles: ["src/main.ts", "src/side.ts"],
      activeFile: "src/side.ts",
      dirtyFiles: [],
    })

    closeFile("src/side.ts")
    expectOpenEditorsBridge({
      openFiles: ["src/main.ts"],
      activeFile: "src/main.ts",
      dirtyFiles: [],
    })

    updateFile("src/main.ts", "export const value = 3", { dirty: true, external: false })
    expectOpenEditorsBridge({
      openFiles: ["src/main.ts"],
      activeFile: "src/main.ts",
      dirtyFiles: ["src/main.ts"],
      badgeByPath: { "src/main.ts": "dirty" },
    })

    await renameEntry("src/main.ts", "src/app.ts")
    expectOpenEditorsBridge({
      openFiles: ["src/app.ts"],
      activeFile: "src/app.ts",
      dirtyFiles: [],
    })

    await deleteFile("src/app.ts")
    expectOpenEditorsBridge({
      openFiles: [],
      activeFile: null,
      dirtyFiles: [],
    })
  })

  it("runs VS Code-style save participants before ordinary text file writes", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    updateFile("src/main.ts", "export const value = 2", { dirty: true, external: false })
    const disposable = addTextFileSaveParticipant({
      ordinal: 5,
      participate(workingCopy: { update(value: string): void; model?: { getValue(): string } }) {
        workingCopy.update(`${workingCopy.model?.getValue() || ""}\n// formatted by participant`)
      },
    })

    try {
      await expect(saveFile("src/main.ts", "export const value = 2")).resolves.toBe(true)
    } finally {
      disposable.dispose()
    }

    expect(files.get("D:/apps/codek/src/main.ts")).toBe("export const value = 2\n\n// formatted by participant")
    expect(getTextFileStateName("src/main.ts")).toBe("saved")
    expect(isDirty("src/main.ts")).toBe(false)
    expect(fileOperationState.operations.at(-1)).toMatchObject({
      type: "update_file",
      afterContent: "export const value = 2\n\n// formatted by participant",
    })
    expect(getWorkspaceEditingSaveEvidence()).toEqual(expect.objectContaining({
      path: "src/main.ts",
      phase: "saved",
      success: true,
      state: "saved",
      dirty: false,
      external: false,
      participant: {
        participantCount: 1,
        failed: false,
        cancelled: false,
        steps: [{ ordinal: 5, index: 0, status: "ran", error: undefined }],
      },
    }))
  })

  it("keeps legacy dirty records as read-only TextFileStateCollection projections", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    updateFile("src/main.ts", "export const value = 2", { dirty: true, external: false })

    expect(workspace.dirtyFiles).toHaveProperty("src/main.ts")
    expect(() => {
      ;(workspace.dirtyFiles as Record<string, unknown>)["src/rogue.ts"] = true
    }).toThrow(/read-only TextFileStateCollection projection/)
    expect(isDirty("src/rogue.ts")).toBe(false)

    await expect(saveFile("src/main.ts", "export const value = 2")).resolves.toBe(true)
    expect(workspace.dirtyFiles).not.toHaveProperty("src/main.ts")
    expect(getWorkspaceEditingSaveEvidence()).toEqual(expect.objectContaining({
      path: "src/main.ts",
      phase: "saved",
      state: "saved",
      dirty: false,
    }))
  })

  it("routes desktop watcher changes through the VS Code FileService provider into working copy state", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")

    expect(fileChangeCallbacks).toHaveLength(1)
    fileChangeCallbacks[0]({ type: "change", path: "D:/apps/codek/src/main.ts" })

    expect(hasExternalChange("src/main.ts")).toBe(true)
    expect(getTextFileStateName("src/main.ts")).toBe("saved")
    expect(getEditorTabState("src/main.ts")).toEqual(expect.objectContaining({
      path: "src/main.ts",
      state: "saved",
      dirty: false,
    }))

    fileChangeCallbacks[0]({ type: "unlink", path: "D:/apps/codek/src/main.ts" })

    expect(getTextFileStateName("src/main.ts")).toBe("orphan")
    expect(hasExternalChange("src/main.ts")).toBe(true)
    expect(getEditorTabState("src/main.ts")).toEqual(expect.objectContaining({
      path: "src/main.ts",
      state: "orphan",
      dirty: true,
      badge: "orphan",
    }))

    await openProjectPath("D:/apps/other")

    expect(fileChangeUnsubscribeCalls).toBeGreaterThanOrEqual(1)
    expect(fileChangeCallbacks).toHaveLength(1)
  })

  it("keeps renderer-side watcher disposal from publishing stale FileService events", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")

    const firstWatcher = fileChangeCallbacks[0]
    await openProjectPath("D:/apps/other")

    firstWatcher({ type: "change", path: "D:/apps/codek/src/main.ts" })

    expect(hasExternalChange("src/main.ts")).toBe(false)
    expect(getTextFileStateName("src/main.ts")).toBe("saved")
  })

  it("keeps byte-window large file saves on the range path without ordinary text save participants", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/participant-range.log"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const marker = "range save window\n"
    const firstWindow = `${marker}${repeatToLength("range line\n", windowBytes - marker.length)}`
    files.set(largePath, firstWindow)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    installRangeReaders(async (_path: string, options: Record<string, unknown> = {}) => {
      const offset = Number(options.offset || 0)
      const length = Number(options.length || options.previewBytes || windowBytes)
      const content = sliceVirtualWindow(firstWindow, offset, length)
      return {
        content,
        size: virtualSize,
        bytesRead: content.length,
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: true,
        path: largePath,
      }
    })
    const disposable = addTextFileSaveParticipant({
      participate() {
        throw new Error("ordinary text save participant must not run for range saves")
      },
    })

    try {
      await openWorkspaceFile()
      await expect(openFile("logs/participant-range.log")).resolves.toBe(true)
      await expect(saveFile("logs/participant-range.log", "range edit")).resolves.toBe(true)
    } finally {
      disposable.dispose()
    }

    expect(patchSegmentCalls).toHaveLength(1)
    expect(patchSegmentCalls[0]).toEqual(expect.objectContaining({ path: largePath }))
    expect(files.get(largePath)).toContain("range edit")
  })

  it("fails save participants without writing and keeps a recoverable error state", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    updateFile("src/main.ts", "export const value = 2", { dirty: true, external: false })
    const disposable = addTextFileSaveParticipant({
      participate() {
        throw new Error("participant rejected save")
      },
    })

    try {
      await expect(saveFile("src/main.ts", "export const value = 2")).resolves.toBe(false)
    } finally {
      disposable.dispose()
    }
    expect(files.get("D:/apps/codek/src/main.ts")).toBe("export const value = 1")
    expect(getTextFileStateName("src/main.ts")).toBe("error")
    expect(isDirty("src/main.ts")).toBe(true)
    expect(getWorkspaceEditingSaveEvidence()).toEqual(expect.objectContaining({
      path: "src/main.ts",
      phase: "saveFailed",
      success: false,
      state: "error",
      dirty: true,
      participant: {
        participantCount: 1,
        failed: true,
        cancelled: false,
        error: "participant rejected save",
        steps: [{ ordinal: 0, index: 0, status: "failed", error: "participant rejected save" }],
      },
    }))
  })

  it("backs up and restores dirty working copies for a minimal hot-exit path", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    files.set("D:/apps/codek/src/clean.ts", "export const clean = true")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    await openFile("src/clean.ts")
    updateFile("src/main.ts", "unsaved value", { dirty: true, external: false })

    await expect(backupDirtyWorkingCopies()).resolves.toEqual(["src/main.ts"])
    closeFile("src/main.ts")
    delete workspace.files["src/main.ts"]
    removeTextFileStateForPath("src/main.ts")

    await expect(restoreWorkingCopyBackups()).resolves.toEqual(["src/main.ts"])

    expect(workspace.files["src/main.ts"]).toBe("unsaved value")
    expect(workspace.openFiles).toContain("src/main.ts")
    expect(workspace.activeFile).toBe("src/main.ts")
    expect(getTextFileStateName("src/main.ts")).toBe("dirty")
    expect(isDirty("src/main.ts")).toBe(true)
  })

  it("restores dirty working copies from a workspace-scoped disk backup after reload", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    updateFile("src/main.ts", "unsaved value after reload", { dirty: true, external: false })

    await expect(backupDirtyWorkingCopies()).resolves.toEqual(["src/main.ts"])
    await openWorkspaceFile()

    expect(workspace.files["src/main.ts"]).toBeUndefined()
    expect(workspace.pendingWorkingCopyRestorations).toEqual([
      expect.objectContaining({
        path: "src/main.ts",
        state: "dirty",
        choices: ["restore", "discard"],
      }),
    ])
    await expect(restoreWorkingCopyBackups()).resolves.toEqual(["src/main.ts"])
    expect(workspace.files["src/main.ts"]).toBe("unsaved value after reload")
    expect(workspace.openFiles).toContain("src/main.ts")
    expect(getTextFileStateName("src/main.ts")).toBe("dirty")
  })

  it("automatically backs up dirty working copies before a reload lifecycle and exposes restore choices without overwrite", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "disk before reload")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    updateFile("src/main.ts", "unsaved before reload", { dirty: true, external: false })

    await openWorkspaceFile()

    expect(files.get("D:/apps/codek/src/main.ts")).toBe("disk before reload")
    expect(workspace.files["src/main.ts"]).toBeUndefined()
    expect(workspace.pendingWorkingCopyRestorations).toEqual([
      expect.objectContaining({
        path: "src/main.ts",
        state: "dirty",
        choices: ["restore", "discard"],
      }),
    ])
  })

  it("backs up dirty working copies from an explicit window lifecycle hook", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "disk")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    updateFile("src/main.ts", "unsaved close", { dirty: true, external: false })

    await expect(backupDirtyWorkingCopiesForLifecycle("close")).resolves.toEqual(["src/main.ts"])
    expect(getWorkingCopyHotExitEvidence()).toEqual(expect.objectContaining({
      phase: "backupJoin",
      source: "close",
      backedUp: ["src/main.ts"],
      backupJoin: expect.objectContaining({
        id: "join.workingCopyBackups",
        completed: true,
        backedUp: ["src/main.ts"],
      }),
    }))
    await openWorkspaceFile()
    await refreshWorkingCopyRestorations()

    expect(workspace.pendingWorkingCopyRestorations.map((entry) => entry.path)).toEqual(["src/main.ts"])
  })

  it("builds dirty working copy hot-exit evidence from the workspace manager state", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "disk")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    updateFile("src/main.ts", "unsaved evidence", { dirty: true, external: false })

    const evidence = buildWorkingCopyHotExitEvidence("manual")

    expect(evidence).toEqual(expect.objectContaining({
      phase: "shutdownRisk",
      source: "manual",
      action: "shutdown",
      dirtyCount: 1,
      workspaceRoot: "D:/apps/codek",
      evidencePath: ".codek/reports/working-copy-hot-exit-latest-result.json",
      risk: "dirty-working-copy",
      backupArtifactPaths: [],
    }))
    expect(evidence.dirty).toEqual([
      expect.objectContaining({
        path: "src/main.ts",
        state: "dirty",
        backedUp: false,
        backupContentHash: expect.any(String),
      }),
    ])
    expect(getWorkingCopyHotExitEvidence()).toEqual(evidence)
  })

  it("includes disk backup artifact paths in hot-exit evidence after backup", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "disk")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    updateFile("src/main.ts", "unsaved artifact", { dirty: true, external: false })
    await expect(backupDirtyWorkingCopiesForLifecycle("reload")).resolves.toEqual(["src/main.ts"])

    const evidence = getWorkingCopyHotExitEvidence()

    expect(evidence).toEqual(expect.objectContaining({
      phase: "backupJoin",
      source: "reload",
      dirtyCount: 1,
      risk: "dirty-working-copy",
      backupArtifactPaths: [expect.stringMatching(/backups\/workspaceStorage\/[0-9a-f]+\/file\/[0-9a-f]+$/)],
      backupJoin: expect.objectContaining({
        id: "join.workingCopyBackups",
        completed: true,
      }),
    }))
    expect(evidence?.dirty).toEqual([
      expect.objectContaining({
        path: "src/main.ts",
        backedUp: true,
      }),
    ])
  })

  it("guards dirty close requests unless force is explicit", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "disk")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    updateFile("src/main.ts", "unsaved close guard", { dirty: true, external: false })

    expect(requestCloseFile("src/main.ts", { source: "tab" })).toBe(false)
    expect(workspace.openFiles).toContain("src/main.ts")
    expect(getWorkingCopyHotExitEvidence()).toEqual(expect.objectContaining({
      phase: "closeGuard",
      action: "close",
      source: "tab",
      allowed: false,
      cancelled: true,
      dirtyCount: 1,
      risk: "dirty-working-copy",
      dirty: [expect.objectContaining({ path: "src/main.ts", backedUp: false })],
    }))

    expect(requestCloseFile("src/main.ts", { force: true, source: "tab" })).toBe(true)
    expect(workspace.openFiles).not.toContain("src/main.ts")
    expect(getWorkingCopyHotExitEvidence()).toEqual(expect.objectContaining({
      phase: "closeGuard",
      allowed: true,
      cancelled: false,
      risk: "none",
    }))
  })

  it("records restore attempt success and failure cause in hot-exit evidence", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "disk")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    updateFile("src/main.ts", "unsaved restore evidence", { dirty: true, external: false })
    await expect(backupDirtyWorkingCopiesForLifecycle("reload")).resolves.toEqual(["src/main.ts"])
    await openWorkspaceFile()

    await expect(applyWorkingCopyRestoration("src/missing.ts", "restore")).resolves.toBe(false)
    expect(getWorkingCopyHotExitEvidence()).toEqual(expect.objectContaining({
      phase: "restoreAttempt",
      action: "restore",
      restored: [],
      failed: ["src/missing.ts"],
      failureCause: "pendingRestoreMissing",
    }))

    await expect(applyWorkingCopyRestoration("src/main.ts", "restore")).resolves.toBe(true)
    expect(getWorkingCopyHotExitEvidence()).toEqual(expect.objectContaining({
      phase: "restoreAttempt",
      action: "restore",
      restored: ["src/main.ts"],
      failed: [],
    }))
  })

  it("opens restored backups as conflict or orphan without writing to disk", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "disk v1")
    files.set("D:/apps/codek/src/delete-me.ts", "disk delete")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    updateFile("src/main.ts", "unsaved v2", { dirty: true, external: false })
    await openFile("src/delete-me.ts")
    updateFile("src/delete-me.ts", "unsaved delete", { dirty: true, external: false })
    await expect(backupDirtyWorkingCopiesForLifecycle("reload")).resolves.toEqual(["src/main.ts", "src/delete-me.ts"])

    files.set("D:/apps/codek/src/main.ts", "disk v3 from outside")
    files.delete("D:/apps/codek/src/delete-me.ts")
    await openWorkspaceFile()

    expect(workspace.pendingWorkingCopyRestorations).toEqual([
      expect.objectContaining({
        path: "src/delete-me.ts",
        state: "orphan",
        choices: ["restore", "discard", "openAsOrphan"],
      }),
      expect.objectContaining({
        path: "src/main.ts",
        state: "conflict",
        choices: ["restore", "discard", "openAsConflict"],
      }),
    ])

    await expect(applyWorkingCopyRestoration("src/main.ts", "restore")).resolves.toBe(true)
    expect(files.get("D:/apps/codek/src/main.ts")).toBe("disk v3 from outside")
    expect(workspace.files["src/main.ts"]).toBe("unsaved v2")
    expect(getTextFileStateName("src/main.ts")).toBe("conflict")
    expect(hasExternalChange("src/main.ts")).toBe(true)
    expect(getEditorTabState("src/main.ts")).toEqual(expect.objectContaining({
      badge: "conflict",
      backupRestored: true,
    }))

    await expect(applyWorkingCopyRestoration("src/delete-me.ts", "openAsOrphan")).resolves.toBe(true)
    expect(files.has("D:/apps/codek/src/delete-me.ts")).toBe(false)
    expect(workspace.files["src/delete-me.ts"]).toBe("unsaved delete")
    expect(getTextFileStateName("src/delete-me.ts")).toBe("orphan")
    expect(hasExternalChange("src/delete-me.ts")).toBe(true)
    expect(getEditorTabState("src/delete-me.ts")).toEqual(expect.objectContaining({
      badge: "orphan",
      backupRestored: true,
    }))
  })

  it("exposes restore action view models and tab dirty badges for backup restore states", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "disk v1")
    files.set("D:/apps/codek/src/clean.ts", "clean")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    await openFile("src/clean.ts")
    updateFile("src/main.ts", "unsaved v2", { dirty: true, external: false })
    await expect(backupDirtyWorkingCopiesForLifecycle("reload")).resolves.toEqual(["src/main.ts"])

    files.set("D:/apps/codek/src/main.ts", "disk v3 from outside")
    await openWorkspaceFile()
    await openFile("src/clean.ts")

    expect(getWorkingCopyRestoreActions("src/main.ts")).toEqual([
      expect.objectContaining({
        path: "src/main.ts",
        state: "conflict",
        message: "检测到未保存备份，但磁盘文件已被外部修改。",
        primaryAction: expect.objectContaining({
          id: "restore",
          label: "恢复备份并标记冲突",
        }),
        actions: expect.arrayContaining([
          expect.objectContaining({ id: "restore", label: "恢复备份并标记冲突" }),
          expect.objectContaining({ id: "discard", label: "丢弃备份" }),
          expect.objectContaining({ id: "openAsConflict", label: "作为冲突打开" }),
        ]),
      }),
    ])
    expect(getEditorTabState("src/main.ts")).toEqual(expect.objectContaining({
      dirty: true,
      conflict: true,
      badge: "conflict",
      labelSuffix: "冲突",
      backupRestored: true,
    }))
    expect(getEditorTabState("src/clean.ts")).toEqual(expect.objectContaining({
      dirty: false,
      badge: null,
      labelSuffix: "",
    }))
  })

  it("discards pending restore choices and clears backup without opening content", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "disk")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    updateFile("src/main.ts", "unsaved discard", { dirty: true, external: false })
    await expect(backupDirtyWorkingCopies()).resolves.toEqual(["src/main.ts"])
    await openWorkspaceFile()

    await expect(applyWorkingCopyRestoration("src/main.ts", "discard")).resolves.toBe(true)
    expect(workspace.files["src/main.ts"]).toBeUndefined()
    expect(workspace.pendingWorkingCopyRestorations).toEqual([])

    await expect(refreshWorkingCopyRestorations()).resolves.toEqual([])
  })

  it("treats missing backup discard as non-blocking diagnostic and clears stale restore choice", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "disk")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    updateFile("src/main.ts", "unsaved missing backup", { dirty: true, external: false })
    await expect(backupDirtyWorkingCopies()).resolves.toEqual(["src/main.ts"])
    await openWorkspaceFile()

    const pending = workspace.pendingWorkingCopyRestorations.find((entry) => entry.path === "src/main.ts")
    expect(pending).toBeTruthy()
    const backupFiles = Array.from(files.keys()).filter((filePath) => filePath.includes("/backups/workspaceStorage/"))
    expect(backupFiles.length).toBeGreaterThan(0)
    for (const filePath of backupFiles) files.delete(filePath)

    await expect(applyWorkingCopyRestoration("src/main.ts", "discard")).resolves.toBe(true)
    expect(workspace.pendingWorkingCopyRestorations).toEqual([])
    expect(workspace.workingCopyRestoredBackups["src/main.ts"]).toBeUndefined()
    expect(getWorkingCopyHotExitEvidence()).toEqual(expect.objectContaining({
      phase: "restoreAttempt",
      action: "discard",
      failed: [],
      risk: "none",
    }))
  })

  it("cleans stale clean backups without deleting active dirty backups or range-window skip state", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/active.ts", "active disk")
    files.set("D:/apps/codek/src/stale.ts", "stale disk")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/active.ts")
    updateFile("src/active.ts", "active unsaved", { dirty: true, external: false })
    await expect(backupDirtyWorkingCopies()).resolves.toEqual(["src/active.ts"])
    await openFile("src/stale.ts")
    updateFile("src/stale.ts", "stale temp", { dirty: true, external: false })
    await expect(backupDirtyWorkingCopies()).resolves.toEqual(["src/stale.ts"])
    markClean("src/stale.ts")

    await expect(cleanupWorkingCopyBackups({ source: "retention" })).resolves.toEqual(["src/stale.ts"])
    expect(getWorkingCopyHotExitEvidence()).toEqual(expect.objectContaining({
      phase: "backupCleanup",
      source: "retention",
      kept: ["src/active.ts"],
      removed: ["src/stale.ts"],
      cleanupOwner: expect.objectContaining({
        source: "WorkingCopyHotExitTracker.cleanupBackupsWithProjection",
        backupOwner: "IWorkingCopyBackupService",
        dirtySource: "IWorkingCopyService.dirtyWorkingCopies",
        stateSource: "single-working-copy-backup-service",
        status: "connected",
      }),
      cleanupPolicy: {
        keepDirty: true,
        exceptCount: 0,
        hasCustomKeep: true,
        readonly: true,
        safeCleanup: true,
      },
      cleanupDecisions: [
        expect.objectContaining({
          path: "src/active.ts",
          decision: "keep",
          reason: "activeDirtyWorkingCopy",
          readonly: true,
          safeCleanup: true,
        }),
        expect.objectContaining({
          path: "src/stale.ts",
          decision: "remove",
          reason: "staleBackup",
          readonly: true,
          safeCleanup: true,
        }),
      ],
    }))
    expect(files.get("D:/apps/codek/src/active.ts")).toBe("active disk")
    expect(files.get("D:/apps/codek/src/stale.ts")).toBe("stale disk")
    await openWorkspaceFile()
    await refreshWorkingCopyRestorations()

    expect(workspace.pendingWorkingCopyRestorations.map((entry) => entry.path)).toEqual(["src/active.ts"])

    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const largePath = "D:/apps/codek/logs/retention-range.log"
    const firstWindow = repeatToLength("retention range\n", windowBytes)
    files.set(largePath, firstWindow)
    installRangeReaders(async (_path: string, options: Record<string, unknown> = {}) => {
      const offset = Number(options.offset || 0)
      const length = Number(options.length || options.previewBytes || windowBytes)
      const content = sliceVirtualWindow(firstWindow, offset, length)
      return {
        content,
        size: virtualSize,
        bytesRead: content.length,
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: true,
        path: largePath,
      }
    })
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async (pathValue: string) => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: normalizePath(pathValue).endsWith("retention-range.log") ? virtualSize : files.get(normalizePath(pathValue))?.length || 0,
    })
    await expect(openFile("logs/retention-range.log")).resolves.toBe(true)
    updateFile("logs/retention-range.log", "edited visible range", { dirty: true, external: false })
    await expect(backupDirtyWorkingCopies()).resolves.toEqual([])
    await expect(cleanupWorkingCopyBackups({ keepPaths: ["src/active.ts"], source: "retention" })).resolves.toEqual([])
  })

  it("keeps cleanup UI owner evidence partial when only the service projection is connected", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/active.ts", "active disk")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/active.ts")
    updateFile("src/active.ts", "active unsaved", { dirty: true, external: false })
    await expect(backupDirtyWorkingCopies()).resolves.toEqual(["src/active.ts"])

    await expect(cleanupWorkingCopyBackups({
      keepPaths: ["src/active.ts"],
      source: "retention",
      uiOwnerConnected: false,
      uiOwnerBlockedReason: "App.vue owner not migrated in this thread",
    })).resolves.toEqual([])

    expect(getWorkingCopyHotExitEvidence()).toEqual(expect.objectContaining({
      phase: "backupCleanup",
      removed: [],
      kept: ["src/active.ts"],
      cleanupOwner: expect.objectContaining({
        status: "partial",
        blockedReason: "App.vue owner not migrated in this thread",
      }),
      cleanupDecisions: [
        expect.objectContaining({
          path: "src/active.ts",
          decision: "keep",
          reason: "activeDirtyWorkingCopy",
          blockedReason: "App.vue owner not migrated in this thread",
        }),
      ],
    }))
    expect(JSON.stringify(getWorkingCopyHotExitEvidence())).not.toContain("\"status\":\"connected\"")
  })

  it("cleans workspace disk backups after save success or explicit clean discard", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    files.set("D:/apps/codek/src/clean.ts", "export const clean = true")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    updateFile("src/main.ts", "unsaved save cleanup", { dirty: true, external: false })
    await expect(backupDirtyWorkingCopies()).resolves.toEqual(["src/main.ts"])
    await expect(saveFile("src/main.ts", "saved value")).resolves.toBe(true)
    await openWorkspaceFile()
    await expect(restoreWorkingCopyBackups()).resolves.toEqual([])

    await openFile("src/clean.ts")
    updateFile("src/clean.ts", "temporary backup", { dirty: true, external: false })
    await expect(backupDirtyWorkingCopies()).resolves.toEqual(["src/clean.ts"])
    updateFile("src/clean.ts", "explicitly clean", { dirty: false, external: false })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await openWorkspaceFile()
    await expect(restoreWorkingCopyBackups()).resolves.toEqual([])
  })

  it("keeps byte-window range files out of ordinary hot-exit full-content backups", async () => {
    const roots = ["D:/apps/codek"]
    const largePath = "D:/apps/codek/logs/hot-exit-range.log"
    const virtualSize = (1024 * 1024 * 1024) + 1
    const windowBytes = getLargeFileWindowBytes(virtualSize)
    const firstWindow = repeatToLength("hot exit range\n", windowBytes)
    files.set(largePath, firstWindow)
    installFakeFs(roots)
    ;(window as unknown as { codek: Record<string, unknown> }).codek.fileExists = async () => ({
      exists: true,
      isFile: true,
      isDirectory: false,
      size: virtualSize,
    })
    installRangeReaders(async (_path: string, options: Record<string, unknown> = {}) => {
      const offset = Number(options.offset || 0)
      const length = Number(options.length || options.previewBytes || windowBytes)
      const content = sliceVirtualWindow(firstWindow, offset, length)
      return {
        content,
        size: virtualSize,
        bytesRead: content.length,
        limit: Number(options.maxBytes || 0),
        previewBytes: length,
        offset,
        truncated: true,
        path: largePath,
      }
    })

    await openWorkspaceFile()
    await expect(openFile("logs/hot-exit-range.log")).resolves.toBe(true)
    updateFile("logs/hot-exit-range.log", "edited visible range", { dirty: true, external: false })

    await expect(backupDirtyWorkingCopies()).resolves.toEqual([])
  })

  it("recovers conflict and orphan states through explicit VS Code text file transitions", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const value = 1")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")
    updateFile("src/main.ts", "export const value = 2", { dirty: true, external: false })
    markChangedExternally("src/main.ts")
    await expect(saveFile("src/main.ts", "export const value = 2")).resolves.toBe(false)
    expect(getTextFileStateName("src/main.ts")).toBe("conflict")

    await expect(resolveTextFileConflict("src/main.ts", "export const value = 3")).resolves.toBe(true)
    expect(files.get("D:/apps/codek/src/main.ts")).toBe("export const value = 3\n")
    expect(getTextFileStateName("src/main.ts")).toBe("saved")
    expect(hasExternalChange("src/main.ts")).toBe(false)

    updateFile("src/main.ts", "restored orphan body", { dirty: true, external: false })
    files.delete("D:/apps/codek/src/main.ts")
    await expect(reloadFile("src/main.ts")).resolves.toBe(false)
    expect(getTextFileStateName("src/main.ts")).toBe("orphan")

    await expect(restoreOrphanedTextFile("src/main.ts", "restored orphan body")).resolves.toBe(true)
    expect(files.get("D:/apps/codek/src/main.ts")).toBe("restored orphan body\n")
    expect(getTextFileStateName("src/main.ts")).toBe("saved")
  })

  it("copies and pastes with VS Code style conflict names", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "source")
    files.set("D:/apps/codek/src/main copy.ts", "existing")
    installFakeFs(roots)

    await openWorkspaceFile()
    copyEntry("src/main.ts")
    const pasted = await pasteEntry("src")

    expect(pasted).toBe("src/main copy 2.ts")
    expect(copyCalls).toEqual([{ sourcePath: "D:/apps/codek/src/main.ts", targetPath: "D:/apps/codek/src/main copy 2.ts" }])
    expect(files.get("D:/apps/codek/src/main copy 2.ts")).toBe("source")
  })

  it("copies and pastes folders with VS Code default incremental naming", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/components/Button.tsx", "button")
    files.set("D:/apps/codek/src/components copy/Existing.tsx", "existing")
    installFakeFs(roots)

    await openWorkspaceFile()
    copyEntry("src/components")
    const pasted = await pasteEntry("src")

    expect(pasted).toBe("src/components copy 2")
    expect(copyCalls).toEqual([{ sourcePath: "D:/apps/codek/src/components", targetPath: "D:/apps/codek/src/components copy 2" }])
    expect(files.get("D:/apps/codek/src/components copy 2/Button.tsx")).toBe("button")
  })

  it("opens user-created files but keeps the active editor stable for agent-created files", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "export const main = true")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("src/main.ts")

    await createFile("src/user-created.ts", "export const userCreated = true")

    expect(workspace.activeFile).toBe("src/user-created.ts")
    expect(workspace.openFiles).toContain("src/user-created.ts")

    await openFile("src/main.ts")
    await createFile("src/agent-created.ts", "export const agentCreated = true", {
      source: "agent",
      agentId: "agent-a",
      runId: "run-1",
    })

    expect(workspace.activeFile).toBe("src/main.ts")
    expect(workspace.openFiles).not.toContain("src/agent-created.ts")
    expect(workspace.files["src/agent-created.ts"]).toBe("export const agentCreated = true")
    expect(fileOperationState.operations[0]).toMatchObject({
      type: "create_file",
      source: "agent",
      pathAfter: "src/agent-created.ts",
    })
  })

  it("creates files and folders under the selected multi-root virtual parent instead of the default root", async () => {
    const roots = ["D:/apps/client", "D:/libs/client"]
    files.set("D:/apps/client/src/app.ts", "export const app = true")
    files.set("D:/libs/client/src/lib.ts", "export const lib = true")
    installFakeFs(roots)

    await openWorkspaceFile()
    await openFile("/client (libs)/src/lib.ts")
    await createFile("/client (apps)/src/from-selected.ts", "export const selectedRoot = true")
    await createDir("/client (apps)/src/generated")

    expect(workspace.activeFile).toBe("/client (apps)/src/from-selected.ts")
    expect(files.get("D:/apps/client/src/from-selected.ts")).toBe("export const selectedRoot = true")
    expect(files.has("D:/libs/client/src/from-selected.ts")).toBe(false)
    expect(files.has("D:/apps/client/client (apps)/src/from-selected.ts")).toBe(false)
    expect(mkdirCalls).toEqual(["D:/apps/client/src/generated"])
  })

  it("records canonical file operations for Explorer and editor mutations", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "old")
    installFakeFs(roots)

    await openWorkspaceFile()
    await createFile("src/new.ts", "created")
    await renameEntry("src/new.ts", "src/renamed.ts")
    await deleteFile("src/renamed.ts")

    expect(fileOperationState.operations.map((operation) => operation.type)).toEqual([
      "delete_file",
      "rename_move",
      "create_file",
    ])
    expect(fileOperationState.operations[0]).toMatchObject({
      pathBefore: "src/renamed.ts",
      pathAfter: null,
      source: "user",
      riskLevel: "high",
    })
  })

  it("records FileService failure evidence without applying stale workspace state", async () => {
    const roots = ["D:/apps/codek"]
    installFakeFs(roots)

    await openWorkspaceFile()
    writeFileFailures.add("D:/apps/codek/src/fails.ts")

    await expect(createFile("src/fails.ts", "created")).resolves.toBe(false)

    expect(workspace.files).not.toHaveProperty("src/fails.ts")
    expect(files.has("D:/apps/codek/src/fails.ts")).toBe(false)
    expect(fileOperationState.operations[0]).toMatchObject({
      type: "create_file",
      source: "user",
      pathBefore: null,
      pathAfter: "src/fails.ts",
      applyStatus: "failed",
      serviceOperation: "create",
      serviceOperationResult: expect.any(Number),
      rollbackRisk: "partial-write",
      riskLevel: "safe",
    })
    expect(fileOperationState.operations[0].failureCause).toContain("写入失败")
  })

  it("records FileService copy failure evidence with operation result and rollback risk", async () => {
    const roots = ["D:/apps/codek"]
    files.set("D:/apps/codek/src/main.ts", "source")
    installFakeFs(roots)

    await openWorkspaceFile()
    copyEntry("src/main.ts")
    copyEntryFailures.add("D:/apps/codek/src/main.ts")

    await expect(pasteEntry("src")).resolves.toBeNull()

    expect(files.has("D:/apps/codek/src/main copy.ts")).toBe(false)
    expect(fileOperationState.operations[0]).toMatchObject({
      type: "copy_entry",
      source: "user",
      pathBefore: "src/main.ts",
      pathAfter: "src/main copy.ts",
      applyStatus: "failed",
      serviceOperation: "copy",
      serviceOperationResult: expect.any(Number),
      rollbackRisk: "unknown",
      riskLevel: "safe",
    })
    expect(fileOperationState.operations[0].failureCause).toContain("复制失败")
  })

  it("does not block real FS structural operations on explorer tree refresh", async () => {
    const roots = ["D:/apps/codek"]
    installFakeFs(roots)

    await openWorkspaceFile()
    readDirCalls.length = 0

    await createFile("src/no-refresh-create.ts", "created", { recordOperation: false })
    await renameEntry("src/no-refresh-create.ts", "src/no-refresh-rename.ts", { recordOperation: false })
    await deleteFile("src/no-refresh-rename.ts", { recordOperation: false })
    await createDir("src/no-refresh-folder", { recordOperation: false })

    expect(readDirCalls).toEqual([])
  })
})
