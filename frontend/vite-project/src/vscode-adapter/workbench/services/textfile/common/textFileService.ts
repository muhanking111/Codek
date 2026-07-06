/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code:
 * - src/vs/workbench/services/textfile/browser/textFileService.ts
 * - src/vs/workbench/services/textfile/common/textFileEditorModel.ts
 * - src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from "../../../../base/common/event"
import type { IDisposable } from "../../../../base/common/lifecycle"
import { URI } from "../../../../base/common/uri"
import {
  FileChangeType,
  FileOperation,
  FileService,
  FileSystemProviderCapabilities,
  FileSystemProviderErrorCode,
  FileType,
  createFileSystemProviderError,
  type FileChangesEvent,
  type FileOperationEvent,
  type IFileChange,
  type IFileService,
  type IFileStatWithMetadata,
  type IFileSystemProvider,
  type IFileWriteOptions,
  type IStat,
  type IWatchOptions,
} from "../../../../platform/files/common/files"
import { InstantiationType, registerSingleton } from "../../../../platform/instantiation/common/extensions"
import { createDecorator } from "../../../../platform/instantiation/common/instantiation"
import type { IWorkingCopyFileService } from "../../workingCopy/common/workingCopyFileService"
import type { IWorkingCopyService } from "../../workingCopy/common/workingCopyService"
import { STORED_FILE_WORKING_COPY_TYPE_ID, StoredFileWorkingCopy } from "../../workingCopy/common/storedFileWorkingCopy"
import {
  SaveReason,
  SaveSourceRegistry,
  TextFileEditorModelState,
  clearTextFileExternalChange,
  createTextFileModelState,
  getTextFileEditorModelStateName,
  hasExternalTextFileChange,
  isTextFileModelDirty,
  markTextFileExternalChange,
  markTextFileOrphaned,
  markTextFileSaveConflict,
  markTextFileSavePending,
  type ITextFileSaveOptions,
  type SaveSource,
  type TextFileModelState,
} from "./textfiles"

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const CODEK_TEXTFILE_SAVE_SOURCE: SaveSource = SaveSourceRegistry.registerSource(
  "codek.textFile.save",
  "Codek Text File Save",
)

export interface TextFileSaveEvent {
  readonly resource: URI
  readonly reason: SaveReason
  readonly source?: SaveSource
  readonly stat: IFileStatWithMetadata
}

export interface TextFileSaveErrorEvent {
  readonly resource: URI
  readonly error: unknown
  readonly reason: SaveReason
  readonly source?: SaveSource
}

export interface TextFileWorkingCopyStateEvent {
  readonly resource: URI
  readonly state: TextFileModelState
}

export type TextFileResourceUriKind = "file" | "untitled" | "inMemory" | "virtual"

export interface TextFileDirtySaveOwnerEvidence {
  readonly source: "codek.textFile.dirtySaveOwnerEvidence"
  readonly textModelOwner: "StoredFileWorkingCopy.model" | "missing"
  readonly textFileServiceOwner: "TextFileService.files"
  readonly workingCopyOwner: "WorkingCopyService" | "not-connected"
  readonly dirtySource: "TextFileModelState via StoredFileWorkingCopy.isDirty"
  readonly saveOwner: "TextFileService.save -> StoredFileWorkingCopy.acceptSaveSucceeded -> FileService.writeFile"
  readonly revertOwner: "TextFileService.revert -> StoredFileWorkingCopy.revert"
  readonly resourceUri: {
    readonly value: string
    readonly scheme: string
    readonly kind: TextFileResourceUriKind
  }
  readonly stateName: ReturnType<typeof getTextFileEditorModelStateName>
  readonly dirty: boolean
  readonly modelResolved: boolean
  readonly registeredInTextFileService: boolean
  readonly registeredInWorkingCopyService: boolean
  readonly stateSourceConsistent: boolean
  readonly usesSecondDirtyStateSource: false
  readonly evidenceOnly: true
  readonly remainingEditorUiOwnerGap: {
    readonly connected: false
    readonly owner: "missing"
    readonly reason: "Editor UI owner requires App.vue or generic editor shell wiring; this service projection intentionally stays headless."
  }
  readonly vscodeReferenceEntrypoints: readonly [
    "vs/workbench/services/textfile/browser/textFileService.ts",
    "vs/workbench/services/textfile/common/textFileEditorModel.ts",
    "vs/workbench/services/workingCopy/common/workingCopyService.ts",
    "vs/editor/common/services/modelService.ts",
  ]
}

export interface TextFileServiceOptions {
  readonly fileService?: IFileService
  readonly workingCopyFileService?: IWorkingCopyFileService
  readonly workingCopyService?: IWorkingCopyService
  readonly shouldHandleFileChange?: (resource: URI, changeType: FileChangeType) => boolean
}

export interface TextFileSaveInput {
  readonly resource: URI
  readonly value: string
  readonly state: TextFileModelState
  readonly options?: ITextFileSaveOptions
}

export interface TextFileSaveResult {
  readonly success: boolean
  readonly stat?: IFileStatWithMetadata
  readonly reason: SaveReason
  readonly source?: SaveSource
  readonly value?: string
  readonly error?: unknown
}

export interface TextFileResolveEvent {
  readonly model: StoredFileWorkingCopy
}

export interface TextFileModelSaveEvent extends TextFileSaveEvent {
  readonly model: StoredFileWorkingCopy
}

export interface TextFileModelSaveErrorEvent {
  readonly model: StoredFileWorkingCopy
  readonly error?: unknown
}

export interface TextFileModelManagerResolveOptions {
  readonly contents?: string
  readonly state?: TextFileModelState
  readonly dirty?: boolean
  readonly external?: boolean
  readonly reload?: boolean | { readonly async?: boolean }
}

export interface ITextFileService {
  readonly _serviceBrand: undefined
  readonly fileService: IFileService
  readonly workingCopyFileService?: IWorkingCopyFileService
  readonly workingCopyService?: IWorkingCopyService
  readonly files: TextFileModelManager
  readonly onDidSave: (listener: (event: TextFileSaveEvent) => unknown) => IDisposable
  readonly onDidSaveError: (listener: (event: TextFileSaveErrorEvent) => unknown) => IDisposable
  readonly onDidChangeWorkingCopyState: (listener: (event: TextFileWorkingCopyStateEvent) => unknown) => IDisposable
  registerWorkingCopy(resource: URI, state: TextFileModelState): { dispose(): void }
  unregisterWorkingCopy(resource: URI): void
  clearWorkingCopies(): void
  save(input: TextFileSaveInput): Promise<TextFileSaveResult>
  revert(resource: URI, state: TextFileModelState): void
  getDirtySaveOwnerEvidence(resource: URI, state?: TextFileModelState): TextFileDirtySaveOwnerEvidence
  dispose(): void
}

export const ITextFileService = createDecorator<ITextFileService>("textFileService")

export class TextFileModelManager {
  private readonly onDidCreateEmitter = new Emitter<StoredFileWorkingCopy>()
  readonly onDidCreate = this.onDidCreateEmitter.event
  private readonly onDidResolveEmitter = new Emitter<TextFileResolveEvent>()
  readonly onDidResolve = this.onDidResolveEmitter.event
  private readonly onDidChangeDirtyEmitter = new Emitter<StoredFileWorkingCopy>()
  readonly onDidChangeDirty = this.onDidChangeDirtyEmitter.event
  private readonly onDidSaveEmitter = new Emitter<TextFileModelSaveEvent>()
  readonly onDidSave = this.onDidSaveEmitter.event
  private readonly onDidSaveErrorEmitter = new Emitter<TextFileModelSaveErrorEvent>()
  readonly onDidSaveError = this.onDidSaveErrorEmitter.event
  private readonly onDidRevertEmitter = new Emitter<StoredFileWorkingCopy>()
  readonly onDidRevert = this.onDidRevertEmitter.event
  private readonly onDidRemoveEmitter = new Emitter<URI>()
  readonly onDidRemove = this.onDidRemoveEmitter.event
  private readonly models = new Map<string, StoredFileWorkingCopy>()
  private readonly listeners = new Map<string, IDisposable[]>()
  private readonly pendingResolves = new Map<string, Promise<StoredFileWorkingCopy>>()

  constructor(private readonly service: TextFileService) {}

  get(resource: URI): StoredFileWorkingCopy | undefined {
    return this.models.get(resource.toString())
  }

  all(): readonly StoredFileWorkingCopy[] {
    return Array.from(this.models.values())
  }

  has(resource: URI): boolean {
    return this.models.has(resource.toString())
  }

  ensure(resource: URI, state?: TextFileModelState): StoredFileWorkingCopy {
    const known = this.get(resource)
    if (known) return known
    const model = new StoredFileWorkingCopy({
      resource,
      textFileService: this.service,
      fileService: this.service.fileService,
      workingCopyService: this.service.workingCopyService,
      state: state ?? createTextFileModelState(),
      registerWithTextFileService: false,
    })
    this.add(model)
    return model
  }

  async resolve(resource: URI, options: TextFileModelManagerResolveOptions = {}): Promise<StoredFileWorkingCopy> {
    const key = resource.toString()
    const pending = this.pendingResolves.get(key)
    if (pending) await pending
    const resolve = this.doResolve(resource, options)
    this.pendingResolves.set(key, resolve)
    try {
      return await resolve
    } finally {
      if (this.pendingResolves.get(key) === resolve) this.pendingResolves.delete(key)
    }
  }

  remove(resource: URI): void {
    const key = resource.toString()
    const model = this.models.get(key)
    if (!model) return
    this.models.delete(key)
    for (const disposable of this.listeners.get(key) || []) disposable.dispose()
    this.listeners.delete(key)
    model.dispose()
    this.onDidRemoveEmitter.fire(resource)
  }

  clear(): void {
    for (const model of Array.from(this.models.values())) model.dispose()
    this.models.clear()
    for (const disposables of this.listeners.values()) {
      for (const disposable of disposables) disposable.dispose()
    }
    this.listeners.clear()
    this.pendingResolves.clear()
  }

  acceptFileChange(resource: URI, changeType: FileChangeType): StoredFileWorkingCopy | undefined {
    const model = this.get(resource)
    if (!model) return undefined
    model.applyFileChange(changeType)
    return model
  }

  dispose(): void {
    this.clear()
    this.onDidCreateEmitter.dispose()
    this.onDidResolveEmitter.dispose()
    this.onDidChangeDirtyEmitter.dispose()
    this.onDidSaveEmitter.dispose()
    this.onDidSaveErrorEmitter.dispose()
    this.onDidRevertEmitter.dispose()
    this.onDidRemoveEmitter.dispose()
  }

  private async doResolve(resource: URI, options: TextFileModelManagerResolveOptions): Promise<StoredFileWorkingCopy> {
    const model = this.ensure(resource, options.state)
    if (typeof options.contents === "string") {
      model.resolveFromContents(options.contents, {
        dirty: options.dirty ?? isTextFileModelDirty(model.state),
        external: options.external ?? hasExternalTextFileChange(model.state),
      })
    } else if (!model.isResolved() || options.reload) {
      await model.resolve({ reload: Boolean(options.reload) })
    }
    return model
  }

  private add(model: StoredFileWorkingCopy): void {
    const key = model.resource.toString()
    const known = this.models.get(key)
    if (known === model) return
    if (known) this.remove(model.resource)
    this.models.set(key, model)
    this.listeners.set(key, [
      model.onDidResolve(() => this.onDidResolveEmitter.fire({ model })),
      model.onDidChangeDirty(() => this.onDidChangeDirtyEmitter.fire(model)),
      model.onDidSave((event) => this.onDidSaveEmitter.fire({
        model,
        resource: model.resource,
        reason: event.reason ?? SaveReason.EXPLICIT,
        source: event.source,
        stat: event.stat as IFileStatWithMetadata,
      })),
      model.onDidSaveError(() => this.onDidSaveErrorEmitter.fire({ model })),
      model.onDidRevert(() => this.onDidRevertEmitter.fire(model)),
      model.onWillDispose(() => {
        if (this.models.get(key) !== model) return
        this.models.delete(key)
        for (const disposable of this.listeners.get(key) || []) disposable.dispose()
        this.listeners.delete(key)
        this.onDidRemoveEmitter.fire(model.resource)
      }),
    ])
    this.onDidCreateEmitter.fire(model)
    if (model.isDirty()) this.onDidChangeDirtyEmitter.fire(model)
  }
}

export class TextFileService implements ITextFileService {
  declare readonly _serviceBrand: undefined

  readonly fileService: IFileService
  readonly workingCopyFileService?: IWorkingCopyFileService
  readonly workingCopyService?: IWorkingCopyService
  readonly files: TextFileModelManager
  private readonly shouldHandleFileChange: (resource: URI, changeType: FileChangeType) => boolean
  private readonly ownFileService: boolean
  private readonly onDidSaveEmitter = new Emitter<TextFileSaveEvent>()
  readonly onDidSave = this.onDidSaveEmitter.event
  private readonly onDidSaveErrorEmitter = new Emitter<TextFileSaveErrorEvent>()
  readonly onDidSaveError = this.onDidSaveErrorEmitter.event
  private readonly onDidChangeWorkingCopyStateEmitter = new Emitter<TextFileWorkingCopyStateEvent>()
  readonly onDidChangeWorkingCopyState = this.onDidChangeWorkingCopyStateEmitter.event

  constructor(options: TextFileServiceOptions = {}) {
    this.fileService = options.fileService ?? new FileService()
    this.workingCopyFileService = options.workingCopyFileService
    this.workingCopyService = options.workingCopyService
    this.shouldHandleFileChange = options.shouldHandleFileChange ?? (() => true)
    this.files = new TextFileModelManager(this)
    this.ownFileService = !options.fileService
    this.fileService.onDidFilesChange((event) => this.onDidFilesChange(event))
    this.fileService.onDidRunOperation((event) => this.onDidRunOperation(event))
    this.files.onDidChangeDirty((model) => this.onDidChangeWorkingCopyStateEmitter.fire({
      resource: model.resource,
      state: model.state,
    }))
    this.files.onDidSave((event) => this.onDidSaveEmitter.fire(event))
    this.files.onDidRevert((model) => this.onDidChangeWorkingCopyStateEmitter.fire({
      resource: model.resource,
      state: model.state,
    }))
  }

  registerWorkingCopy(resource: URI, state: TextFileModelState): { dispose(): void } {
    const model = this.files.ensure(resource, state)
    return {
      dispose: () => {
        const registered = this.files.get(resource)
        if (registered === model && registered.state === state && !registered.isResolved()) this.files.remove(resource)
      },
    }
  }

  unregisterWorkingCopy(resource: URI): void {
    this.files.remove(resource)
  }

  clearWorkingCopies(): void {
    this.files.clear()
  }

  async save(input: TextFileSaveInput): Promise<TextFileSaveResult> {
    const reason = input.options?.reason ?? SaveReason.EXPLICIT
    const source = input.options?.source ?? CODEK_TEXTFILE_SAVE_SOURCE
    const model = this.files.ensure(input.resource, input.state)
    const state = model.state

    if (
      (state.state === TextFileEditorModelState.CONFLICT || state.state === TextFileEditorModelState.ERROR)
      && (reason === SaveReason.AUTO || reason === SaveReason.FOCUS_CHANGE || reason === SaveReason.WINDOW_CHANGE)
    ) {
      return { success: false, reason, source }
    }

    if (hasExternalTextFileChange(state) && input.options?.force !== true) {
      markTextFileSaveConflict(state)
      return { success: false, reason, source }
    }

    if (!model.isResolved()) {
      model.resolveFromContents(input.value, {
        dirty: isTextFileModelDirty(state),
        external: hasExternalTextFileChange(state),
      })
    } else if (model.model?.getValue() !== input.value) {
      model.update(input.value)
    }

    markTextFileSavePending(state)
    try {
      let value = input.value
      if (this.workingCopyFileService?.hasSaveParticipants && input.options?.skipSaveParticipants !== true) {
        await this.workingCopyFileService.runSaveParticipants(model, {
          reason,
          source,
        })
        value = model.model?.getValue() ?? value
      }
      const stat = await this.fileService.writeFile(input.resource, textEncoder.encode(value), {
        create: true,
        overwrite: true,
      })
      model.acceptSaveSucceeded({ reason, source, stat })
      return { success: true, reason, source, stat, value }
    } catch (error) {
      model.acceptSaveError()
      this.onDidSaveErrorEmitter.fire({ resource: input.resource, error, reason, source })
      return { success: false, reason, source, error }
    }
  }

  revert(resource: URI, state: TextFileModelState): void {
    const model = this.files.ensure(resource, state)
    void model.revert({ soft: true })
    clearTextFileExternalChange(model.state)
  }

  getDirtySaveOwnerEvidence(resource: URI, state?: TextFileModelState): TextFileDirtySaveOwnerEvidence {
    const model = this.files.get(resource)
    const resolvedState = state ?? model?.state ?? createTextFileModelState()
    const modelDirty = model?.isDirty()
    const stateDirty = isTextFileModelDirty(resolvedState)
    const registeredInWorkingCopyService = Boolean(this.workingCopyService?.has(resource, model?.typeId ?? STORED_FILE_WORKING_COPY_TYPE_ID))

    return {
      source: "codek.textFile.dirtySaveOwnerEvidence",
      textModelOwner: model?.model ? "StoredFileWorkingCopy.model" : "missing",
      textFileServiceOwner: "TextFileService.files",
      workingCopyOwner: registeredInWorkingCopyService ? "WorkingCopyService" : "not-connected",
      dirtySource: "TextFileModelState via StoredFileWorkingCopy.isDirty",
      saveOwner: "TextFileService.save -> StoredFileWorkingCopy.acceptSaveSucceeded -> FileService.writeFile",
      revertOwner: "TextFileService.revert -> StoredFileWorkingCopy.revert",
      resourceUri: {
        value: resource.toString(),
        scheme: resource.scheme,
        kind: getTextFileResourceUriKind(resource),
      },
      stateName: getTextFileEditorModelStateName(resolvedState.state),
      dirty: modelDirty ?? stateDirty,
      modelResolved: Boolean(model?.isResolved()),
      registeredInTextFileService: Boolean(model),
      registeredInWorkingCopyService,
      stateSourceConsistent: modelDirty === undefined || modelDirty === stateDirty,
      usesSecondDirtyStateSource: false,
      evidenceOnly: true,
      remainingEditorUiOwnerGap: {
        connected: false,
        owner: "missing",
        reason: "Editor UI owner requires App.vue or generic editor shell wiring; this service projection intentionally stays headless.",
      },
      vscodeReferenceEntrypoints: [
        "vs/workbench/services/textfile/browser/textFileService.ts",
        "vs/workbench/services/textfile/common/textFileEditorModel.ts",
        "vs/workbench/services/workingCopy/common/workingCopyService.ts",
        "vs/editor/common/services/modelService.ts",
      ],
    }
  }

  dispose(): void {
    this.onDidSaveEmitter.dispose()
    this.onDidSaveErrorEmitter.dispose()
    this.onDidChangeWorkingCopyStateEmitter.dispose()
    this.files.dispose()
    if (this.ownFileService && "dispose" in this.fileService && typeof this.fileService.dispose === "function") {
      this.fileService.dispose()
    }
  }

  private onDidFilesChange(event: FileChangesEvent): void {
    for (const workingCopy of this.files.all()) {
      if (event.contains(workingCopy.resource, FileChangeType.DELETED)) {
        if (!this.shouldHandleFileChange(workingCopy.resource, FileChangeType.DELETED)) continue
        this.files.acceptFileChange(workingCopy.resource, FileChangeType.DELETED)
        this.onDidChangeWorkingCopyStateEmitter.fire(workingCopy)
      } else if (event.contains(workingCopy.resource, FileChangeType.ADDED)) {
        if (!this.shouldHandleFileChange(workingCopy.resource, FileChangeType.ADDED)) continue
        this.files.acceptFileChange(workingCopy.resource, FileChangeType.ADDED)
        this.onDidChangeWorkingCopyStateEmitter.fire(workingCopy)
      } else if (
        event.contains(workingCopy.resource, FileChangeType.UPDATED)
        && workingCopy.state.state !== TextFileEditorModelState.PENDING_SAVE
      ) {
        if (!this.shouldHandleFileChange(workingCopy.resource, FileChangeType.UPDATED)) continue
        this.files.acceptFileChange(workingCopy.resource, FileChangeType.UPDATED)
        this.onDidChangeWorkingCopyStateEmitter.fire(workingCopy)
      }
    }
  }

  private onDidRunOperation(event: FileOperationEvent): void {
    if (!event.isOperation(FileOperation.WRITE)) return
    const workingCopy = this.files.get(event.resource)
    if (!workingCopy) return
    workingCopy.markSaved()
    this.onDidChangeWorkingCopyStateEmitter.fire(workingCopy)
  }
}

export const globalTextFileService = new TextFileService()
registerSingleton(ITextFileService, globalTextFileService, InstantiationType.Delayed)

export interface CodekFileSystemProviderDelegate {
  readonly readFile?: (path: string) => Promise<string | null | undefined> | string | null | undefined
  readonly writeFile?: (path: string, content: string) => Promise<boolean | void> | boolean | void
  readonly fileExists?: (path: string) => Promise<unknown> | unknown
  readonly readDir?: (path: string, options?: { maxEntries?: number }) => Promise<unknown[] | undefined> | unknown[] | undefined
  readonly createDir?: (path: string) => Promise<boolean | void> | boolean | void
  readonly deleteFile?: (path: string) => Promise<boolean | void> | boolean | void
  readonly rename?: (oldPath: string, newPath: string) => Promise<boolean | void> | boolean | void
  readonly copyEntry?: (sourcePath: string, targetPath: string) => Promise<boolean | void> | boolean | void
  readonly watch?: (
    path: string,
    options: IWatchOptions,
    onDidChange: (event: CodekFileSystemWatchEvent) => void,
    onDidError: (error: unknown) => void,
  ) => IDisposable | (() => void) | void
}

export interface CodekFileSystemProviderOptions {
  readonly delegate: CodekFileSystemProviderDelegate
  readonly normalizePath?: (path: string) => string
  readonly now?: () => number
}

export interface CodekFileSystemWatchEvent {
  readonly path?: string
  readonly type?: string
}

export function createCodekFileSystemProvider(options: CodekFileSystemProviderOptions): IFileSystemProvider & {
  readonly fireDidChangeFile: (changes: readonly IFileChange[]) => void
} {
  const onDidChangeCapabilities = new Emitter<void>()
  const onDidChangeFile = new Emitter<readonly IFileChange[]>()
  const onDidWatchError = new Emitter<string>()
  const normalize = options.normalizePath ?? ((path: string) => path.replace(/\\/g, "/"))
  const now = options.now ?? (() => Date.now())
  const knownDirectories = new Set<string>()
  const handles = new Map<number, { resource: URI; path: string; content: Uint8Array; dirty: boolean }>()
  let handlePool = 1

  function normalizeProviderPath(value: string): string {
    return normalize(String(value || "")).replace(/\/+$/, "")
  }

  function isWatchedPath(watchRoot: string, candidate: string, recursive: boolean): boolean {
    const root = normalizeProviderPath(watchRoot).toLowerCase()
    const normalizedCandidate = normalizeProviderPath(candidate).toLowerCase()
    if (!root || !normalizedCandidate) return false
    if (normalizedCandidate === root) return true
    if (!normalizedCandidate.startsWith(`${root}/`)) return false
    if (recursive) return true
    return !normalizedCandidate.slice(root.length + 1).includes("/")
  }

  function toWatchChangeType(type: string | undefined): FileChangeType {
    const normalizedType = String(type || "").toLowerCase()
    if (normalizedType === "add" || normalizedType === "adddir" || normalizedType === "created" || normalizedType === "create") {
      return FileChangeType.ADDED
    }
    if (normalizedType === "unlink" || normalizedType === "unlinkdir" || normalizedType === "deleted" || normalizedType === "delete") {
      return FileChangeType.DELETED
    }
    return FileChangeType.UPDATED
  }

  function fireWatchError(error: unknown): void {
    onDidWatchError.fire(error instanceof Error ? error.message : String(error || "File watcher failed"))
  }

  async function stat(resource: URI): Promise<IStat> {
    const normalizedPath = normalize(toProviderFsPath(resource))
    if (knownDirectories.has(normalizedPath.replace(/\/+$/, ""))) {
      return {
        type: FileType.Directory,
        size: 0,
        mtime: now(),
        ctime: now(),
      }
    }
    if (!options.delegate.fileExists) {
      return {
        type: FileType.File,
        size: 0,
        mtime: now(),
        ctime: now(),
      }
    }
    const rawStat = await options.delegate.fileExists?.(normalizedPath)
    const normalizedStat = normalizeBridgeStat(rawStat, normalizedPath, now)
    if (!normalizedStat) {
      throw createFileSystemProviderError(`文件不存在：${normalizedPath}`, FileSystemProviderErrorCode.FileNotFound)
    }
    return normalizedStat
  }

  return {
    capabilities: FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.FileOpenReadWriteClose | FileSystemProviderCapabilities.FileFolderCopy,
    onDidChangeCapabilities: onDidChangeCapabilities.event,
    onDidChangeFile: onDidChangeFile.event,
    onDidWatchError: onDidWatchError.event,
    fireDidChangeFile(changes) {
      onDidChangeFile.fire(changes)
    },
    stat,
    async readdir(resource) {
      if (!options.delegate.readDir) return []
      const normalizedPath = normalize(toProviderFsPath(resource))
      const entries = await options.delegate.readDir(normalizedPath, { maxEntries: Number.MAX_SAFE_INTEGER })
      if (!Array.isArray(entries)) return []
      return entries.map((entry) => {
        const candidate = entry && typeof entry === "object" ? entry as Record<string, unknown> : {}
        const name = String(candidate.name || "")
        const isDirectory = Boolean(candidate.isDirectory || candidate.isDir || candidate.type === FileType.Directory)
        return [name, isDirectory ? FileType.Directory : FileType.File] as [string, FileType]
      }).filter(([name]) => Boolean(name))
    },
    async readFile(resource) {
      if (!options.delegate.readFile) {
        throw createFileSystemProviderError("当前文件系统不支持读取。", FileSystemProviderErrorCode.Unavailable)
      }
      const normalizedPath = normalize(toProviderFsPath(resource))
      const content = await options.delegate.readFile(normalizedPath)
      if (content === null || content === undefined) {
        throw createFileSystemProviderError(`文件不存在：${normalizedPath}`, FileSystemProviderErrorCode.FileNotFound)
      }
      return textEncoder.encode(String(content))
    },
    async writeFile(resource, content, writeOptions: IFileWriteOptions) {
      if (!options.delegate.writeFile) {
        throw createFileSystemProviderError("当前文件系统不支持写入。", FileSystemProviderErrorCode.Unavailable)
      }
      const normalizedPath = normalize(toProviderFsPath(resource))
      if (writeOptions.overwrite === false) {
        try {
          await stat(resource)
          throw createFileSystemProviderError(`文件已存在：${normalizedPath}`, FileSystemProviderErrorCode.FileExists)
        } catch (error) {
          if (isProviderErrorCode(error, FileSystemProviderErrorCode.FileNotFound)) {
            // Continue: create is allowed for this save path.
          } else {
            throw error
          }
        }
      }
      const result = await options.delegate.writeFile(normalizedPath, textDecoder.decode(content))
      if (result === false) {
        throw createFileSystemProviderError(`写入失败：${normalizedPath}`, FileSystemProviderErrorCode.Unknown)
      }
      onDidChangeFile.fire([{ type: FileChangeType.UPDATED, resource }])
    },
    async open(resource, openOptions = {}) {
      const normalizedPath = normalize(toProviderFsPath(resource))
      let content = new Uint8Array()
      if (openOptions.create !== true || openOptions.append === true) {
        if (!options.delegate.readFile) {
          throw createFileSystemProviderError("当前文件系统不支持读取。", FileSystemProviderErrorCode.Unavailable)
        }
        const rawContent = await options.delegate.readFile(normalizedPath)
        if (rawContent === null || rawContent === undefined) {
          if (openOptions.create === true) content = new Uint8Array()
          else throw createFileSystemProviderError(`文件不存在：${normalizedPath}`, FileSystemProviderErrorCode.FileNotFound)
        } else {
          content = textEncoder.encode(String(rawContent))
        }
      }
      const handle = handlePool++
      handles.set(handle, { resource, path: normalizedPath, content, dirty: false })
      return handle
    },
    async read(handle, pos, data, offset, length) {
      const entry = handles.get(handle)
      if (!entry) throw createFileSystemProviderError("文件句柄无效。", FileSystemProviderErrorCode.Unavailable)
      const chunk = entry.content.slice(Math.max(0, pos), Math.max(0, pos) + Math.max(0, length))
      data.set(chunk, Math.max(0, offset))
      return chunk.byteLength
    },
    async write(handle, pos, data, offset, length) {
      const entry = handles.get(handle)
      if (!entry) throw createFileSystemProviderError("文件句柄无效。", FileSystemProviderErrorCode.Unavailable)
      const start = Math.max(0, pos)
      const chunk = data.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(0, length))
      const next = new Uint8Array(Math.max(entry.content.byteLength, start + chunk.byteLength))
      next.set(entry.content)
      next.set(chunk, start)
      entry.content = next
      entry.dirty = true
      return chunk.byteLength
    },
    async close(handle) {
      const entry = handles.get(handle)
      if (!entry) return
      handles.delete(handle)
      if (!entry.dirty) return
      if (!options.delegate.writeFile) {
        throw createFileSystemProviderError("当前文件系统不支持写入。", FileSystemProviderErrorCode.Unavailable)
      }
      const result = await options.delegate.writeFile(entry.path, textDecoder.decode(entry.content))
      if (result === false) {
        throw createFileSystemProviderError(`写入失败：${entry.path}`, FileSystemProviderErrorCode.Unknown)
      }
      onDidChangeFile.fire([{ type: FileChangeType.UPDATED, resource: entry.resource }])
    },
    async mkdir(resource) {
      if (!options.delegate.createDir) {
        throw createFileSystemProviderError("当前文件系统不支持创建文件夹。", FileSystemProviderErrorCode.Unavailable)
      }
      const normalizedPath = normalize(toProviderFsPath(resource))
      const result = await options.delegate.createDir(normalizedPath)
      if (result === false) {
        throw createFileSystemProviderError(`创建文件夹失败：${normalizedPath}`, FileSystemProviderErrorCode.Unknown)
      }
      knownDirectories.add(normalizedPath.replace(/\/+$/, ""))
      onDidChangeFile.fire([{ type: FileChangeType.ADDED, resource }])
    },
    async delete(resource) {
      if (!options.delegate.deleteFile) {
        throw createFileSystemProviderError("当前文件系统不支持删除。", FileSystemProviderErrorCode.Unavailable)
      }
      const normalizedPath = normalize(toProviderFsPath(resource))
      const result = await options.delegate.deleteFile(normalizedPath)
      if (result === false) {
        throw createFileSystemProviderError(`删除失败：${normalizedPath}`, FileSystemProviderErrorCode.Unknown)
      }
      knownDirectories.delete(normalizedPath.replace(/\/+$/, ""))
      onDidChangeFile.fire([{ type: FileChangeType.DELETED, resource }])
    },
    async rename(from, to, overwrite) {
      if (!options.delegate.rename) {
        throw createFileSystemProviderError("当前文件系统不支持重命名。", FileSystemProviderErrorCode.Unavailable)
      }
      if (overwrite.overwrite !== true) {
        try {
          await stat(to)
          throw createFileSystemProviderError(`目标已存在：${normalize(toProviderFsPath(to))}`, FileSystemProviderErrorCode.FileExists)
        } catch (error) {
          if (!isProviderErrorCode(error, FileSystemProviderErrorCode.FileNotFound)) throw error
        }
      }
      const oldPath = normalize(toProviderFsPath(from))
      const newPath = normalize(toProviderFsPath(to))
      const result = await options.delegate.rename(oldPath, newPath)
      if (result === false) {
        throw createFileSystemProviderError(`重命名失败：${oldPath}`, FileSystemProviderErrorCode.Unknown)
      }
      if (knownDirectories.delete(oldPath.replace(/\/+$/, ""))) knownDirectories.add(newPath.replace(/\/+$/, ""))
      onDidChangeFile.fire([
        { type: FileChangeType.DELETED, resource: from },
        { type: FileChangeType.ADDED, resource: to },
      ])
    },
    async copy(from, to, overwrite) {
      if (!options.delegate.copyEntry) {
        throw createFileSystemProviderError("当前文件系统不支持复制。", FileSystemProviderErrorCode.Unavailable)
      }
      if (overwrite.overwrite !== true) {
        try {
          await stat(to)
          throw createFileSystemProviderError(`目标已存在：${normalize(toProviderFsPath(to))}`, FileSystemProviderErrorCode.FileExists)
        } catch (error) {
          if (!isProviderErrorCode(error, FileSystemProviderErrorCode.FileNotFound)) throw error
        }
      }
      const sourcePath = normalize(toProviderFsPath(from))
      const targetPath = normalize(toProviderFsPath(to))
      const result = await options.delegate.copyEntry(sourcePath, targetPath)
      if (result === false) {
        throw createFileSystemProviderError(`复制失败：${sourcePath}`, FileSystemProviderErrorCode.Unknown)
      }
      if (knownDirectories.has(sourcePath.replace(/\/+$/, ""))) knownDirectories.add(targetPath.replace(/\/+$/, ""))
      onDidChangeFile.fire([{ type: FileChangeType.ADDED, resource: to }])
    },
    watch(resource: URI, opts: IWatchOptions = {}) {
      if (!options.delegate.watch) return { dispose: () => undefined }
      const watchedPath = normalizeProviderPath(toProviderFsPath(resource))
      const watchOptions = {
        recursive: Boolean(opts.recursive),
        excludes: [...(opts.excludes || [])],
        ...(typeof opts.correlationId === "number" ? { correlationId: opts.correlationId } : {}),
      }
      let disposed = false
      let delegateDisposable: IDisposable | (() => void) | undefined
      const onDidChange = (event: CodekFileSystemWatchEvent) => {
        if (disposed) return
        const eventPath = normalizeProviderPath(String(event?.path || ""))
        if (!isWatchedPath(watchedPath, eventPath, Boolean(opts.recursive))) return
        onDidChangeFile.fire([{
          type: toWatchChangeType(event?.type),
          resource: URI.file(eventPath),
          ...(typeof opts.correlationId === "number" ? { cId: opts.correlationId } : {}),
        }])
      }
      try {
        const disposable = options.delegate.watch(
          watchedPath,
          watchOptions,
          onDidChange,
          fireWatchError,
        )
        if (typeof disposable === "function") {
          delegateDisposable = disposable
        } else if (disposable && typeof disposable.dispose === "function") {
          delegateDisposable = disposable
        }
      } catch (error) {
        fireWatchError(error)
      }
      return {
        dispose: () => {
          if (disposed) return
          disposed = true
          if (typeof delegateDisposable === "function") {
            delegateDisposable()
          } else {
            delegateDisposable?.dispose?.()
          }
        },
      }
    },
  }
}

function normalizeBridgeStat(rawStat: unknown, path: string, now: () => number): IStat | null {
  if (rawStat === false || rawStat === null || rawStat === undefined) return null
  if (typeof rawStat === "object") {
    const stat = rawStat as Record<string, unknown>
    if (stat.exists === false) return null
    const isDirectory = Boolean(stat.isDirectory || stat.isDir || stat.type === FileType.Directory)
    const type = isDirectory ? FileType.Directory : FileType.File
    return {
      type,
      size: typeof stat.size === "number" ? stat.size : 0,
      mtime: typeof stat.mtime === "number" ? stat.mtime : now(),
      ctime: typeof stat.ctime === "number" ? stat.ctime : now(),
    }
  }
  return {
    type: FileType.File,
    size: 0,
    mtime: now(),
    ctime: now(),
  }
}

function isProviderErrorCode(error: unknown, code: FileSystemProviderErrorCode): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code
}

function toProviderFsPath(resource: URI): string {
  if (/^\/[a-zA-Z]:($|\/)/.test(resource.path)) return resource.path.slice(1)
  return resource.fsPath || resource.path
}

export function isTextFileSaveDirty(state: TextFileModelState | null | undefined): boolean {
  return isTextFileModelDirty(state)
}

export function markTextFileChangedByFileService(state: TextFileModelState, changeType: FileChangeType): void {
  if (changeType === FileChangeType.DELETED) {
    markTextFileOrphaned(state)
    return
  }
  if (changeType === FileChangeType.ADDED) {
    clearTextFileExternalChange(state)
    return
  }
  markTextFileExternalChange(state)
}

function getTextFileResourceUriKind(resource: URI): TextFileResourceUriKind {
  const scheme = resource.scheme.toLowerCase()
  if (scheme === "file") return "file"
  if (scheme === "untitled") return "untitled"
  if (scheme === "mem" || scheme === "inmemory") return "inMemory"
  return "virtual"
}
