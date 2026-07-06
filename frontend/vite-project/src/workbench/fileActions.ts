import { registerCommand } from "./commandRegistry"
import type { CreateTargetSnapshot } from "./createTarget"
import { VSCODE_MODEL_SYNC_LIMIT_BYTES } from "../workspace/largeFilePolicy"
import {
  validateExplorerFileName,
  type ExplorerFileNameValidationResult,
} from "../vscode-adapter/workbench/contrib/files/fileActions"
import { globalWorkbenchExplorerEditorService } from "./workbenchExplorerEditorService"

interface EditorLike {
  getValue?: () => string
  setValue?: (content: string) => void
  getModel?: () => {
    getValueLength?: () => number
  } | null
}

interface WorkspaceLike {
  activeFile: string | null
  projectRoot: string | null
  files: Record<string, unknown>
  largeFileNotice?: {
    path: string
    size: number
    limit: number
    reason: string
  } | null
}

interface WorkspaceManagerLike {
  openFile: (path: string) => Promise<boolean>
  saveFile: (path: string, content: string) => Promise<boolean>
  addFile: (path: string, content?: string) => void
  createFile: (path: string, content?: string, options?: Record<string, unknown>) => Promise<boolean>
  createDir: (path: string) => Promise<boolean>
  deleteFile: (path: string) => Promise<boolean>
  renameEntry?: (oldPath: string, newPath: string) => Promise<boolean>
  entryExists?: (path: string) => Promise<boolean> | boolean
  copyEntry?: (path: string) => boolean
  cutEntry?: (path: string) => boolean
  pasteEntry?: (targetDir: string) => Promise<string | null>
  revealPath?: (path: string) => Promise<boolean>
  showItemInFolder?: (path: string) => Promise<boolean>
  refreshFileTree: () => Promise<void>
  updateFile: (path: string, content: string, options?: Record<string, unknown>) => void
  markClean: (path: string) => void
  readProjectFile: (path: string) => Promise<string | null>
  getRelativePath: (path: string) => string
  getLargeFileState?: (path: string) => { mode?: string; readOnly?: boolean; size?: number; bytesRead?: number } | null
}

interface FormatManagerLike {
  formatFile: (path: string, content: string) => Promise<{ success?: boolean; formatted?: string }>
}

interface LintManagerLike {
  lintFile: (path: string, content: string) => Promise<Array<{
    line: number
    column: number
    ruleId?: string
    message: string
    severity: string | number
  }>>
}

interface ProblemStateLike {
  addLintDiagnostics: (path: string, diagnostics: Array<Record<string, unknown>>) => void
}

export type ExplorerFileActionOwnerEvidenceAction = "open" | "create" | "rename" | "delete" | "copy" | "cut" | "paste"

export interface ExplorerFileActionOwnerEvidence {
  explorerOwner: string
  fileServiceOwner: string
  operationSource: string
  resourceUriKind: "workspace-relative"
  readonlyGuard: string
  destructiveGuard: string
  remainingUiOwnerGap: string
}

export interface FileActionContext {
  workspace: WorkspaceLike
  workspaceManager: WorkspaceManagerLike
  getEditor: () => EditorLike | null
  getOpenFiles: () => string[]
  isDirty: (path: string) => boolean
  isRealFS: () => boolean
  isFormatOnSave: () => boolean
  isLintOnSave: () => boolean
  setSuppressEditorSync: (suppress: boolean) => void
  syncEditorFromWorkspace: () => void
  ensureEditorContentVisible?: (path: string, expectedContent: string) => Promise<boolean>
  refreshActiveAnalysis: (path: string) => Promise<unknown>
  loadFormatManager: () => Promise<FormatManagerLike>
  loadLintManager: () => Promise<LintManagerLike>
  problemState: ProblemStateLike
  setSelectedDir: (path: string) => void
  setSelectedTree: (path: string, kind: string) => void
  confirmDelete: (path: string) => boolean
  promptRename?: (path: string, currentName: string) => string | null
  copyText?: (text: string) => void | Promise<void>
  openTerminalAtPath?: (path: string) => void | Promise<void>
  notifyLspFileOpened: (path: string, content: string) => void | Promise<void>
  joinRelativePath: (parentPath: string, name: string) => string
  reportOpenFileStage?: (stage: string, detail?: Record<string, unknown>) => void
  getPostOpenBackgroundDelayMs?: () => number
  shouldBlockUntilEditorContentVisible?: () => boolean
}

const OPEN_EDITOR_CONTENT_MOUNT_TIMEOUT_MS = 1500
const OPEN_EDITOR_CONTENT_MOUNT_POLL_MS = 16
const OPEN_EDITOR_CONTENT_VISIBLE_PROBE_TIMEOUT_MS = 250
const OPEN_EDITOR_CONTENT_BLOCKING_ATTEMPTS = 1
const openFileTaskGenerations = new WeakMap<FileActionContext, number>()

const EDITOR_DEFAULT_PLACEHOLDER_PATTERNS = [
  /打开一个项目或创建文件以开始/,
  /開啟一個專案或建立檔案以開始/,
  /Open a project or create a file to begin/i,
]

export function getExplorerFileActionOwnerEvidence(action: ExplorerFileActionOwnerEvidenceAction): ExplorerFileActionOwnerEvidence {
  const mutatingFileServiceOwners: Record<ExplorerFileActionOwnerEvidenceAction, string> = {
    open: "workspaceManager.openFile",
    create: "workspaceManager.createFile/createDir",
    rename: "workspaceManager.renameEntry",
    delete: "workspaceManager.deleteFile",
    copy: "workspaceManager.copyEntry",
    cut: "workspaceManager.cutEntry",
    paste: "workspaceManager.pasteEntry",
  }
  return {
    explorerOwner: "FileTree",
    fileServiceOwner: mutatingFileServiceOwners[action],
    operationSource: `explorer.${action}`,
    resourceUriKind: "workspace-relative",
    readonlyGuard: action === "open" ? "read-only-open-allowed" : "workspace-manager-guard",
    destructiveGuard: action === "delete" ? "confirmDelete-required" : "not-destructive",
    remainingUiOwnerGap: "service-evidence-only",
  }
}

export async function saveFile(path: string | null | undefined, context: FileActionContext): Promise<boolean> {
  if (!path) return false

  const editor = context.getEditor()
  const workspaceContent = asString(context.workspace.files[path])
  const editorContent = path === context.workspace.activeFile && editor ? editor.getValue?.() : undefined
  let content: string | undefined = editorContent ?? workspaceContent
  if (typeof content !== "string") return false

  if (
    typeof editorContent === "string"
    && typeof workspaceContent === "string"
    && editorContent !== workspaceContent
    && isEditorDefaultPlaceholder(editorContent)
    && !isEditorDefaultPlaceholder(workspaceContent)
  ) {
    content = workspaceContent
  }

  if (context.isFormatOnSave() && path === context.workspace.activeFile && editor) {
    const formatManager = await context.loadFormatManager()
    const result = await formatManager.formatFile(path, content)
    const liveContent = editor.getValue?.() ?? content
    if (path !== context.workspace.activeFile || liveContent !== content) {
      content = liveContent
    } else if (result.success && typeof result.formatted === "string" && result.formatted !== content) {
      content = result.formatted
      context.setSuppressEditorSync(true)
      editor.setValue?.(content)
      context.setSuppressEditorSync(false)
      context.workspaceManager.updateFile(path, content, { dirty: false, external: false })
    }
  }

  const success = await context.workspaceManager.saveFile(path, content)
  if (!success) return false

  if (path === context.workspace.activeFile) {
    context.workspaceManager.updateFile(path, content, { dirty: false, external: false })
  }

  await context.refreshActiveAnalysis(path)

  if (context.isLintOnSave() && path === context.workspace.activeFile) {
    const lintManager = await context.loadLintManager()
    const lintResults = await lintManager.lintFile(path, content)
    const lintDiagnostics = lintResults.map((result) => ({
      file: path,
      line: result.line,
      column: result.column,
      message: result.ruleId ? `[${result.ruleId}] ${result.message}` : result.message,
      severity: result.severity,
      source: "linter",
      diagnosticSource: "lint",
    }))
    context.problemState.addLintDiagnostics(path, lintDiagnostics)
  }

  return true
}

export async function maybeSaveCurrentFile(context: FileActionContext): Promise<boolean> {
  const activeFile = context.workspace.activeFile
  if (!activeFile || !context.isDirty(activeFile)) return true
  return saveFile(activeFile, context)
}

export async function openFile(path: string, context: FileActionContext): Promise<boolean> {
  const taskGeneration = beginOpenFileAction(context)
  context.reportOpenFileStage?.("start", { path, ...getExplorerFileActionOwnerEvidence("open") })
  const saved = await maybeSaveCurrentFile(context)
  context.reportOpenFileStage?.("after-save", { path, saved })
  if (!saved || !isCurrentOpenFileAction(context, taskGeneration)) return false

  const hadEditorBeforeOpen = Boolean(context.getEditor())
  context.reportOpenFileStage?.("workspace-open:start", { path })
  const ok = await context.workspaceManager.openFile(path)
  context.reportOpenFileStage?.("workspace-open:done", {
    path,
    ok,
    activeFile: context.workspace.activeFile,
    hasContent: typeof context.workspace.files[path] === "string",
  })
  const relativePath = context.workspaceManager.getRelativePath(path)
  if (!ok) {
    if (isCurrentOpenFileAction(context, taskGeneration)) {
      context.reportOpenFileStage?.("workspace-open:rejected-sync", {
        path,
        activeFile: context.workspace.activeFile,
      })
      context.syncEditorFromWorkspace()
    }
    return false
  }
  if (!isCurrentOpenFileAction(context, taskGeneration)) {
    return false
  }
  if (context.workspace.activeFile !== relativePath && context.workspace.activeFile !== path) {
    context.reportOpenFileStage?.("workspace-open:active-mismatch-sync", {
      path,
      relativePath,
      activeFile: context.workspace.activeFile,
    })
    context.syncEditorFromWorkspace()
    return false
  }
  globalWorkbenchExplorerEditorService.openEditor(relativePath, { permanent: true })

  const largeFileState = context.workspaceManager.getLargeFileState?.(relativePath) || null
  const isLargeFileMode = isManagedLargeFileState(largeFileState)
  const skipPostOpenHeavyWork = shouldSkipPostOpenHeavyWork(largeFileState)
  context.reportOpenFileStage?.("selection:start", { path })
  context.setSelectedDir("")
  context.setSelectedTree(relativePath, "file")
  context.reportOpenFileStage?.("selection:done", { path, relativePath })
  context.reportOpenFileStage?.("editor-mount:start", { path: relativePath })
  const isCurrentTask = () => isCurrentOpenFileAction(context, taskGeneration)
  const mounted = isLargeFileMode
    ? mountLargeFileEditor(relativePath, context, largeFileState?.mode)
    : await ensureEditorContentMounted(relativePath, context, {
      blockingAttempts: hadEditorBeforeOpen && context.shouldBlockUntilEditorContentVisible?.()
        ? 0
        : OPEN_EDITOR_CONTENT_BLOCKING_ATTEMPTS,
      isCurrentTask,
    })
  context.reportOpenFileStage?.("editor-mount:done", {
    path: relativePath,
    mounted,
    activeFile: context.workspace.activeFile,
    editorValueLength: getEditorValueLength(context.getEditor(), isLargeFileMode),
  })
  const backgroundDelayMs = Math.max(0, Number(context.getPostOpenBackgroundDelayMs?.() || 0))
  if (!mounted && !isLargeFileMode) {
    scheduleBackgroundFileOpenTask(
      () => ensureEditorContentMounted(relativePath, context, { isCurrentTask }),
      "ensure editor content mounted",
      relativePath,
      backgroundDelayMs,
      context,
      taskGeneration,
    )
  }
  context.reportOpenFileStage?.("background:start", { path, delayMs: backgroundDelayMs })
  if (!skipPostOpenHeavyWork) {
    scheduleBackgroundFileOpenTask(() => refreshAnalysisIfCurrent(path, context, taskGeneration), "refresh active analysis", path, backgroundDelayMs, context, taskGeneration)
  }
  scheduleBackgroundFileOpenTask(() => notifyLspIfNeeded(path, context, taskGeneration), "notify LSP file opened", path, backgroundDelayMs, context, taskGeneration)
  context.reportOpenFileStage?.("done", { path })
  return true
}

function beginOpenFileAction(context: FileActionContext): number {
  const generation = (openFileTaskGenerations.get(context) || 0) + 1
  openFileTaskGenerations.set(context, generation)
  return generation
}

function isCurrentOpenFileAction(context: FileActionContext, generation: number): boolean {
  return openFileTaskGenerations.get(context) === generation
}

function scheduleBackgroundFileOpenTask(
  task: () => Promise<unknown> | unknown,
  label: string,
  path: string,
  delayMs = 0,
  context?: FileActionContext,
  generation?: number,
): void {
  const runTask = () => {
    if (context && generation !== undefined && !isCurrentOpenFileAction(context, generation)) return
    runBackgroundFileOpenTask(Promise.resolve().then(async () => {
      if (context && generation !== undefined && !isCurrentOpenFileAction(context, generation)) return undefined
      return task()
    }), label, path)
  }
  if (delayMs <= 0) {
    runTask()
    return
  }
  setTimeout(runTask, delayMs)
}

async function ensureEditorContentMounted(
  path: string,
  context: FileActionContext,
  options: { blockingAttempts?: number; isCurrentTask?: () => boolean } = {},
): Promise<boolean> {
  const started = Date.now()
  let attempts = 0
  while (Date.now() - started <= OPEN_EDITOR_CONTENT_MOUNT_TIMEOUT_MS) {
    if (!isOpenFileTaskStillCurrent(path, context, options.isCurrentTask)) {
      context.reportOpenFileStage?.("editor-mount:stale", { path, attempts, activeFile: context.workspace.activeFile })
      return false
    }
    attempts += 1
    context.reportOpenFileStage?.("editor-mount:sync:start", { path, attempts })
    context.syncEditorFromWorkspace()
    context.reportOpenFileStage?.("editor-mount:sync:done", { path, attempts })
    if (!isOpenFileTaskStillCurrent(path, context, options.isCurrentTask)) {
      context.reportOpenFileStage?.("editor-mount:stale", { path, attempts, activeFile: context.workspace.activeFile })
      return false
    }
    const workspaceContent = getMountedWorkspaceContent(path, context)
    context.reportOpenFileStage?.("editor-mount:content-check", {
      path,
      attempts,
      hasWorkspaceContent: typeof workspaceContent === "string",
      activeFile: context.workspace.activeFile,
      editorValueLength: getEditorValueLength(context.getEditor(), false),
    })
    if (typeof workspaceContent === "string") {
      if (!context.getEditor()) return true
      const editorValue = getEditorValue(context.getEditor())
      if (typeof editorValue === "string" && editorValue === workspaceContent) return true
      if (!context.ensureEditorContentVisible) return true
      context.reportOpenFileStage?.("editor-mount:visible:start", { path, attempts })
      if (await runVisibleProbeWithTimeout(path, workspaceContent, context)) return true
      context.reportOpenFileStage?.("editor-mount:visible:miss", { path, attempts })
    }
    if (options.blockingAttempts && attempts >= options.blockingAttempts) {
      context.reportOpenFileStage?.("editor-mount:deferred", { path, elapsedMs: Date.now() - started, attempts })
      return false
    }
    await delay(OPEN_EDITOR_CONTENT_MOUNT_POLL_MS)
  }
  context.reportOpenFileStage?.("editor-mount:timeout", { path, elapsedMs: Date.now() - started, attempts })
  return false
}

async function runVisibleProbeWithTimeout(
  path: string,
  expectedContent: string,
  context: FileActionContext,
): Promise<boolean> {
  const probe = context.ensureEditorContentVisible
  if (!probe) return true
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      probe(path, expectedContent),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), OPEN_EDITOR_CONTENT_VISIBLE_PROBE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function getMountedWorkspaceContent(path: string, context: FileActionContext): string | null {
  if (context.workspace.activeFile !== path) return null
  const workspaceContent = asString(context.workspace.files[path])
  if (typeof workspaceContent !== "string") return null
  const largeFileState = context.workspaceManager.getLargeFileState?.(path) || null
  if (isManagedLargeFileState(largeFileState)) return workspaceContent
  const editorValue = getEditorValue(context.getEditor())
  return typeof editorValue !== "string" || editorValue === workspaceContent ? workspaceContent : null
}

function mountLargeFileEditor(path: string, context: FileActionContext, mode?: string): boolean {
  if (context.workspace.activeFile !== path) return false
  context.reportOpenFileStage?.("editor-mount:large-file-sync:start", { path, mode })
  context.syncEditorFromWorkspace()
  context.reportOpenFileStage?.("editor-mount:large-file-sync:done", {
    path,
    mode,
    activeFile: context.workspace.activeFile,
    editorValueLength: getEditorValueLength(context.getEditor(), true),
  })
  return true
}

function isManagedLargeFileState(state: { mode?: string } | null | undefined): boolean {
  return state?.mode === "range" || state?.mode === "optimized"
}

function shouldSkipPostOpenHeavyWork(state: { mode?: string; size?: number; bytesRead?: number } | null | undefined): boolean {
  if (state?.mode === "range") return true
  if (state?.mode !== "optimized") return false
  return Number(state.size || state.bytesRead || 0) > VSCODE_MODEL_SYNC_LIMIT_BYTES
}

function getEditorValue(editor: EditorLike | null | undefined): string | undefined {
  try {
    return editor?.getValue?.()
  } catch {
    return undefined
  }
}

function getEditorValueLength(editor: EditorLike | null | undefined, largeFileMode: boolean): number | null {
  const modelLength = Number(editor?.getModel?.()?.getValueLength?.())
  if (Number.isFinite(modelLength) && modelLength >= 0) return modelLength
  if (largeFileMode) return null
  const value = getEditorValue(editor)
  return typeof value === "string" ? value.length : null
}

function isOpenFileTaskStillCurrent(
  path: string,
  context: FileActionContext,
  isCurrentTask: (() => boolean) | undefined,
): boolean {
  if (typeof isCurrentTask === "function" && !isCurrentTask()) return false
  return context.workspace.activeFile === path
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function addScratchFile(context: FileActionContext): Promise<void> {
  const name = `file${context.getOpenFiles().length + 1}.js`
  context.workspaceManager.addFile(name, "\n".repeat(9))
  context.syncEditorFromWorkspace()
  await context.refreshActiveAnalysis(name)
}

export async function createJavaProject(context: FileActionContext): Promise<void> {
  const fileName = "Main.java"
  const code = [
    "public class Main {",
    "    public static void main(String[] args) {",
    "        System.out.println(\"Hello Codek\");",
    "    }",
    "}",
    "",
  ].join("\n")

  if (!context.isRealFS()) {
    context.workspaceManager.addFile(fileName, code)
  } else {
    await context.workspaceManager.createFile(fileName, code)
  }

  context.syncEditorFromWorkspace()
  context.workspaceManager.markClean(fileName)
  await context.refreshActiveAnalysis(fileName)
}

export async function inlineCreate(
  payload: { type: "file" | "folder"; parentPath: string; name: string; targetSnapshot?: CreateTargetSnapshot },
  context: FileActionContext,
): Promise<void> {
  const { type } = payload
  assertCreateTargetSnapshot(payload.targetSnapshot, payload.parentPath)
  const parentPath = payload.targetSnapshot?.parentPath ?? payload.parentPath
  const name = await resolveExplorerEditableName({
    inputName: payload.name,
    parentPath,
    context,
  })
  if (!name) throw new Error("A file or folder name must be provided.")

  if (!context.isRealFS()) {
    if (type === "file") {
      context.workspaceManager.addFile(name, "\n".repeat(9))
      context.syncEditorFromWorkspace()
      context.workspaceManager.markClean(name)
      await context.refreshActiveAnalysis(name)
    }
    return
  }

  const targetPath = context.joinRelativePath(parentPath, name)

  if (type === "file") {
    const created = await context.workspaceManager.createFile(targetPath, "\n".repeat(9), {
      source: "user",
      reason: "inline create file",
      openAfterCreate: true,
    })
    if (!created) return
    await context.workspaceManager.refreshFileTree()
    context.syncEditorFromWorkspace()
    context.workspaceManager.markClean(targetPath)
    await context.workspaceManager.revealPath?.(targetPath)
    context.setSelectedTree(targetPath, "file")
    context.setSelectedDir(parentPath)
    await context.refreshActiveAnalysis(targetPath)
    return
  }

  const created = await context.workspaceManager.createDir(targetPath)
  if (!created) return
  await context.workspaceManager.refreshFileTree()
  await context.workspaceManager.revealPath?.(targetPath)
  context.setSelectedDir(targetPath)
  context.setSelectedTree(targetPath, "dir")
}

export async function deleteEntry(path: string, context: FileActionContext): Promise<void> {
  if (!context.confirmDelete(path)) return
  await context.workspaceManager.deleteFile(path)
  context.syncEditorFromWorkspace()
}

export async function renameEntry(path: string, context: FileActionContext): Promise<boolean> {
  if (!path || !context.workspaceManager.renameEntry) return false
  const normalized = normalizePath(path)
  const currentName = basename(normalized)
  const nextName = context.promptRename?.(normalized, currentName)
  if (!nextName) return false
  const parentPath = dirname(normalized)
  const validatedName = await resolveExplorerEditableName({
    inputName: nextName,
    currentName,
    parentPath,
    currentPath: normalized,
    context,
    rejectOnError: false,
  })
  if (!validatedName || validatedName === currentName) return false
  const newPath = context.joinRelativePath(parentPath, validatedName)
  const success = await context.workspaceManager.renameEntry(normalized, newPath)
  if (!success) return false
  context.setSelectedTree(newPath, "file")
  context.syncEditorFromWorkspace()
  return true
}

async function resolveExplorerEditableName(options: {
  inputName: string
  parentPath: string
  context: FileActionContext
  currentName?: string
  currentPath?: string
  rejectOnError?: boolean
}): Promise<string | null> {
  const initial = validateExplorerFileName({
    name: options.inputName,
    currentName: options.currentName,
    isWindowsOS: true,
  })
  if (isExplorerNameError(initial)) {
    if (options.rejectOnError === false) return null
    throw new Error(initial.message.content)
  }

  const targetPath = options.context.joinRelativePath(options.parentPath, initial.name)
  let exists = false
  if (initial.name !== (options.currentName || "")) {
    const targetMatchesCurrent = options.currentPath
      ? normalizePath(targetPath).toLowerCase() === normalizePath(options.currentPath).toLowerCase()
      : false
    if (!targetMatchesCurrent) {
      exists = Boolean(await options.context.workspaceManager.entryExists?.(targetPath))
    }
  }

  const result = validateExplorerFileName({
    name: options.inputName,
    currentName: options.currentName,
    isWindowsOS: true,
    siblingExists: () => exists,
  })
  if (isExplorerNameError(result)) {
    if (options.rejectOnError === false) return null
    throw new Error(result.message.content)
  }

  return result.name
}

function isExplorerNameError(result: ExplorerFileNameValidationResult): result is ExplorerFileNameValidationResult & {
  message: { content: string; severity: "error" }
} {
  return result.message?.severity === "error"
}

export async function copyEntry(path: string, context: FileActionContext): Promise<boolean> {
  if (!path || !context.workspaceManager.copyEntry) return false
  return context.workspaceManager.copyEntry(normalizePath(path))
}

export async function cutEntry(path: string, context: FileActionContext): Promise<boolean> {
  if (!path || !context.workspaceManager.cutEntry) return false
  return context.workspaceManager.cutEntry(normalizePath(path))
}

export async function pasteEntry(targetDir: string, context: FileActionContext): Promise<string | null> {
  if (!context.workspaceManager.pasteEntry) return null
  const pasted = await context.workspaceManager.pasteEntry(normalizePath(targetDir || context.workspace.projectRoot || ""))
  if (!pasted) return null
  await context.workspaceManager.refreshFileTree()
  context.setSelectedTree(pasted, "file")
  context.syncEditorFromWorkspace()
  return pasted
}

export async function revealEntry(path: string, context: FileActionContext): Promise<boolean> {
  if (!path || !context.workspaceManager.revealPath) return false
  const success = await context.workspaceManager.revealPath(normalizePath(path))
  if (!success) return false
  const relativePath = context.workspaceManager.getRelativePath(path)
  context.setSelectedTree(relativePath, "file")
  return true
}

export async function copyPath(path: string, context: FileActionContext): Promise<void> {
  await context.copyText?.(normalizePath(path))
}

export async function copyRelativePath(path: string, context: FileActionContext): Promise<void> {
  await context.copyText?.(context.workspaceManager.getRelativePath(path))
}

export async function showItemInFolder(path: string, context: FileActionContext): Promise<boolean> {
  return Boolean(path && await context.workspaceManager.showItemInFolder?.(normalizePath(path)))
}

export async function openTerminalAtEntry(path: string, context: FileActionContext): Promise<void> {
  await context.openTerminalAtPath?.(normalizePath(path || context.workspace.projectRoot || ""))
}

export async function refreshTree(context: FileActionContext): Promise<void> {
  await context.workspaceManager.refreshFileTree()
  context.syncEditorFromWorkspace()
}

export function registerExplorerCommands(context: FileActionContext): void {
  const when = "explorerVisible"
  const commands: Array<{
    id: string
    title: string
    handler: (...args: unknown[]) => unknown | Promise<unknown>
    requiresPath?: boolean
  }> = [
    { id: "explorer.newFile", title: "新建文件", handler: () => context.setSelectedTree("", "newFile") },
    { id: "explorer.newFolder", title: "新建文件夹", handler: () => context.setSelectedTree("", "newFolder") },
    { id: "explorer.open", title: "打开", handler: (path: string) => openFile(path, context), requiresPath: true },
    { id: "explorer.rename", title: "重命名", handler: (path: string) => renameEntry(path, context), requiresPath: true },
    { id: "explorer.delete", title: "删除", handler: (path: string) => deleteEntry(path, context), requiresPath: true },
    { id: "explorer.copy", title: "复制", handler: (path: string) => copyEntry(path, context), requiresPath: true },
    { id: "explorer.cut", title: "剪切", handler: (path: string) => cutEntry(path, context), requiresPath: true },
    { id: "explorer.paste", title: "粘贴", handler: (targetDir: string) => pasteEntry(targetDir, context) },
    { id: "explorer.copyPath", title: "复制路径", handler: (path: string) => copyPath(path, context), requiresPath: true },
    { id: "explorer.copyRelativePath", title: "复制相对路径", handler: (path: string) => copyRelativePath(path, context), requiresPath: true },
    { id: "explorer.reveal", title: "在资源管理器中定位", handler: (path: string) => revealEntry(path, context), requiresPath: true },
    { id: "explorer.showInFolder", title: "在系统资源管理器中显示", handler: (path: string) => showItemInFolder(path, context), requiresPath: true },
    { id: "explorer.openTerminal", title: "在终端中打开", handler: (path: string) => openTerminalAtEntry(path, context) },
    { id: "explorer.refresh", title: "刷新", handler: () => refreshTree(context) },
  ]

  for (const command of commands) {
    registerCommand({
      id: command.id,
      title: command.title,
      category: "Explorer",
      source: "vscode",
      when: command.requiresPath ? `${when} && explorerResource` : when,
      handler: async (...args: unknown[]) => { await command.handler(...args) },
    })
  }
}

async function refreshAnalysisIfCurrent(path: string, context: FileActionContext, generation: number): Promise<unknown> {
  const relativePath = context.workspaceManager.getRelativePath(path)
  if (!isActiveOpenedPath(path, relativePath, context)) return undefined
  if (!isCurrentOpenFileAction(context, generation)) return undefined
  return context.refreshActiveAnalysis(path)
}

async function notifyLspIfNeeded(path: string, context: FileActionContext, generation?: number): Promise<void> {
  if (!context.workspace.projectRoot) return
  const relativePath = context.workspaceManager.getRelativePath(path)
  if (!/\.(tsx?|jsx?)$/i.test(relativePath)) return
  if (shouldSkipPostOpenHeavyWork(context.workspaceManager.getLargeFileState?.(relativePath))) return
  if (generation !== undefined && !isCurrentOpenFileAction(context, generation)) return
  if (!isActiveOpenedPath(path, relativePath, context)) return

  const content = await context.workspaceManager.readProjectFile(relativePath)
  if (generation !== undefined && !isCurrentOpenFileAction(context, generation)) return
  if (!isActiveOpenedPath(path, relativePath, context)) return
  if (typeof content === "string") {
    await context.notifyLspFileOpened(relativePath, content)
  }
}

function isActiveOpenedPath(path: string, relativePath: string, context: FileActionContext): boolean {
  return context.workspace.activeFile === relativePath || context.workspace.activeFile === path
}

function runBackgroundFileOpenTask(task: Promise<unknown>, label: string, path: string): void {
  void task.catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[fileActions] ${label} failed for ${path}: ${message}`)
  })
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function isEditorDefaultPlaceholder(content: string): boolean {
  const normalized = content.trim()
  return EDITOR_DEFAULT_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized))
}

function normalizePath(path: string): string {
  return String(path || "").replace(/\\/g, "/").replace(/\/+$/, "")
}

function basename(path: string): string {
  return normalizePath(path).split("/").filter(Boolean).pop() || ""
}

function dirname(path: string): string {
  const parts = normalizePath(path).split("/").filter(Boolean)
  parts.pop()
  return path.startsWith("/") ? `/${parts.join("/")}` : parts.join("/")
}

function assertCreateTargetSnapshot(snapshot: CreateTargetSnapshot | undefined, requestedParentPath: string): void {
  if (!snapshot) return
  if (snapshot.parentPath !== requestedParentPath) {
    throw new Error(`创建目标快照不一致：显示目标 ${snapshot.displayLabel} 与创建路径 ${requestedParentPath} 不一致`)
  }
}
