/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code:
 * - src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.ts
 * - src/vs/workbench/services/workingCopy/common/workingCopyBackup.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from "../../../../base/common/event"
import type { IDisposable } from "../../../../base/common/lifecycle"
import { URI } from "../../../../base/common/uri"
import {
  FileChangeType,
  FileOperationResult,
  FileService,
  FileSystemProviderErrorCode,
  createFileSystemProviderError,
  type IFileService,
} from "../../../../platform/files/common/files"
import { InstantiationType, registerSingleton } from "../../../../platform/instantiation/common/extensions"
import { createDecorator } from "../../../../platform/instantiation/common/instantiation"
import {
  SaveReason,
  TextFileEditorModelState,
  createTextFileModelState,
  getTextFileEditorModelStateName,
  isTextFileModelDirty,
  isTextFileModelModified,
  clearTextFileExternalChange,
  markTextFileExternalChange,
  markTextFileOrphaned,
  markTextFileSaveError,
  markTextFileSavePending,
  markTextFileSaveSucceeded,
  setTextFileModelState,
  type ITextFileSaveOptions,
  type TextFileEditorModelStateName,
  type TextFileModelState,
} from "../../textfile/common/textfiles"
import type { TextFileService } from "../../textfile/common/textFileService"
import type { IWorkingCopy, IWorkingCopyIdentifier, IWorkingCopySaveEvent, IWorkingCopyService } from "./workingCopyService"

const textDecoder = new TextDecoder()

export const STORED_FILE_WORKING_COPY_TYPE_ID = "codek.storedFile"

export interface StoredFileWorkingCopyModel {
  readonly resource: URI
  readonly versionId: number
  readonly onDidChangeContent: (listener: () => void) => IDisposable
  getValue(): string
  update(value: string): void
  pushStackElement(): void
}

export class CodekStoredFileWorkingCopyModel implements StoredFileWorkingCopyModel {
  private readonly onDidChangeContentEmitter = new Emitter<void>()
  readonly onDidChangeContent = this.onDidChangeContentEmitter.event
  private value: string
  private version = 1
  stackElementCount = 0

  constructor(readonly resource: URI, value = "") {
    this.value = value
  }

  get versionId(): number {
    return this.version
  }

  getValue(): string {
    return this.value
  }

  update(value: string): void {
    if (value === this.value) return
    this.value = value
    this.version += 1
    this.onDidChangeContentEmitter.fire()
  }

  pushStackElement(): void {
    this.stackElementCount += 1
  }

  dispose(): void {
    this.onDidChangeContentEmitter.dispose()
  }
}

export interface StoredFileWorkingCopyOptions {
  readonly resource: URI
  readonly textFileService: TextFileService
  readonly fileService?: IFileService
  readonly workingCopyService?: IWorkingCopyService
  readonly typeId?: string
  readonly model?: StoredFileWorkingCopyModel
  readonly state?: TextFileModelState
  readonly registerWithTextFileService?: boolean
  readonly registerWithWorkingCopyService?: boolean
}

export class StoredFileWorkingCopy implements IWorkingCopy {
  readonly typeId: string
  readonly resource: URI
  readonly state: TextFileModelState
  private readonly textFileService: TextFileService
  private readonly fileService: IFileService
  private readonly onDidResolveEmitter = new Emitter<void>()
  readonly onDidResolve = this.onDidResolveEmitter.event
  private readonly onDidChangeDirtyEmitter = new Emitter<void>()
  readonly onDidChangeDirty = this.onDidChangeDirtyEmitter.event
  private readonly onDidChangeContentEmitter = new Emitter<void>()
  readonly onDidChangeContent = this.onDidChangeContentEmitter.event
  private readonly onDidSaveEmitter = new Emitter<IWorkingCopySaveEvent>()
  readonly onDidSave = this.onDidSaveEmitter.event
  private readonly onDidSaveErrorEmitter = new Emitter<void>()
  readonly onDidSaveError = this.onDidSaveErrorEmitter.event
  private readonly onDidRevertEmitter = new Emitter<void>()
  readonly onDidRevert = this.onDidRevertEmitter.event
  private readonly onWillDisposeEmitter = new Emitter<void>()
  readonly onWillDispose = this.onWillDisposeEmitter.event
  private modelDisposable: IDisposable | null = null
  private textFileRegistration: IDisposable | null = null
  private workingCopyRegistration: IDisposable | null = null
  model: StoredFileWorkingCopyModel | null

  constructor(options: StoredFileWorkingCopyOptions) {
    this.resource = options.resource
    this.typeId = options.typeId ?? STORED_FILE_WORKING_COPY_TYPE_ID
    this.textFileService = options.textFileService
    this.fileService = options.fileService ?? options.textFileService.fileService ?? new FileService()
    this.state = options.state ?? createTextFileModelState()
    this.model = options.model ?? null
    if (this.model) this.bindModel(this.model)
    if (options.registerWithTextFileService !== false) {
      this.textFileRegistration = this.textFileService.registerWorkingCopy(this.resource, this.state)
    }
    if (options.workingCopyService && options.registerWithWorkingCopyService !== false) {
      this.workingCopyRegistration = options.workingCopyService.registerWorkingCopy(this)
    }
  }

  isResolved(): boolean {
    return Boolean(this.model)
  }

  isDirty(): boolean {
    return isTextFileModelDirty(this.state)
  }

  isModified(): boolean {
    return isTextFileModelModified(this.state)
  }

  hasState(state: TextFileEditorModelState): boolean {
    return this.state.state === state
  }

  stateName(): TextFileEditorModelStateName {
    return getTextFileEditorModelStateName(this.state.state)
  }

  async resolve(options: { readonly reload?: boolean } = {}): Promise<void> {
    if (!this.model || options.reload) {
      const content = await this.fileService.readFile(this.resource)
      this.resolveFromContents(textDecoder.decode(content), { dirty: false, external: false })
      return
    }
    this.onDidResolveEmitter.fire()
  }

  resolveFromContents(value: string, options: { readonly dirty?: boolean; readonly external?: boolean } = {}): void {
    const wasDirty = this.isDirty()
    this.bindModel(new CodekStoredFileWorkingCopyModel(this.resource, value))
    setTextFileModelState(this.state, options.dirty ? TextFileEditorModelState.DIRTY : TextFileEditorModelState.SAVED, {
      external: options.external ?? false,
    })
    this.onDidResolveEmitter.fire()
    this.onDidChangeContentEmitter.fire()
    if (wasDirty !== this.isDirty()) this.onDidChangeDirtyEmitter.fire()
  }

  update(value: string): void {
    if (!this.model) this.bindModel(new CodekStoredFileWorkingCopyModel(this.resource, value))
    else this.model.update(value)
  }

  markModified(): void {
    const wasDirty = this.isDirty()
    setTextFileModelState(this.state, TextFileEditorModelState.DIRTY)
    if (!wasDirty) this.onDidChangeDirtyEmitter.fire()
  }

  async save(options: ITextFileSaveOptions = {}): Promise<boolean> {
    if (!this.model) await this.resolve()
    const managerModel = this.textFileService.files.get(this.resource)
    const result = await this.textFileService.save({
      resource: this.resource,
      value: this.model?.getValue() ?? "",
      state: this.state,
      options: {
        reason: options.reason ?? SaveReason.EXPLICIT,
        source: options.source,
        force: options.force,
        skipSaveParticipants: options.skipSaveParticipants,
      },
    })
    if (managerModel !== this) {
      if (result.success) this.onDidSaveEmitter.fire({ reason: result.reason, source: result.source })
      else this.onDidSaveErrorEmitter.fire()
    }
    return result.success
  }

  async revert(_options: { readonly soft?: boolean } = {}): Promise<void> {
    const wasDirty = this.isDirty()
    setTextFileModelState(this.state, TextFileEditorModelState.SAVED, { external: false })
    this.onDidRevertEmitter.fire()
    if (wasDirty) this.onDidChangeDirtyEmitter.fire()
  }

  restoreFromBackup(backup: ResolvedWorkingCopyBackup): void {
    this.resolveFromContents(backup.value, { dirty: true })
  }

  applyFileChange(changeType: FileChangeType): void {
    const before = this.state.state
    if (changeType === FileChangeType.DELETED) markTextFileOrphaned(this.state)
    else if (changeType === FileChangeType.ADDED) clearTextFileExternalChange(this.state)
    else markTextFileExternalChange(this.state)
    if (before !== this.state.state) this.onDidChangeDirtyEmitter.fire()
  }

  markPendingSave(): void {
    const before = this.state.state
    markTextFileSavePending(this.state)
    if (before !== this.state.state) this.onDidChangeDirtyEmitter.fire()
  }

  markSaved(): void {
    const wasDirty = this.isDirty()
    markTextFileSaveSucceeded(this.state)
    if (wasDirty) this.onDidChangeDirtyEmitter.fire()
  }

  acceptSaveSucceeded(event: IWorkingCopySaveEvent): void {
    this.markSaved()
    this.onDidSaveEmitter.fire(event)
  }

  markError(): void {
    const wasDirty = this.isDirty()
    markTextFileSaveError(this.state)
    if (!wasDirty || this.isDirty()) this.onDidChangeDirtyEmitter.fire()
  }

  acceptSaveError(): void {
    this.markError()
    this.onDidSaveErrorEmitter.fire()
  }

  dispose(): void {
    this.onWillDisposeEmitter.fire()
    this.workingCopyRegistration?.dispose()
    this.textFileRegistration?.dispose()
    this.modelDisposable?.dispose()
    const disposableModel = this.model as unknown as { dispose?: () => void } | null
    if (typeof disposableModel?.dispose === "function") {
      disposableModel.dispose()
    }
    this.model = null
    this.onDidResolveEmitter.dispose()
    this.onDidChangeDirtyEmitter.dispose()
    this.onDidChangeContentEmitter.dispose()
    this.onDidSaveEmitter.dispose()
    this.onDidSaveErrorEmitter.dispose()
    this.onDidRevertEmitter.dispose()
    this.onWillDisposeEmitter.dispose()
  }

  private bindModel(model: StoredFileWorkingCopyModel): void {
    this.modelDisposable?.dispose()
    this.model = model
    this.modelDisposable = model.onDidChangeContent(() => {
      this.markModified()
      this.onDidChangeContentEmitter.fire()
    })
  }
}

export interface WorkingCopyBackupMeta {
  readonly mtime?: number
  readonly versionId?: number
  readonly state?: string
  readonly [key: string]: unknown
}

export interface ResolvedWorkingCopyBackup {
  readonly value: string
  readonly meta?: WorkingCopyBackupMeta
}

export interface IWorkingCopyBackupService {
  readonly _serviceBrand: undefined
  hasBackupSync(identifier: IWorkingCopyIdentifier, versionId?: number): boolean
  backup(identifier: IWorkingCopyIdentifier, value?: string, versionId?: number, meta?: WorkingCopyBackupMeta): Promise<void>
  resolve(identifier: IWorkingCopyIdentifier): Promise<ResolvedWorkingCopyBackup | undefined>
  getBackups(): Promise<readonly IWorkingCopyIdentifier[]>
  discardBackup(identifier: IWorkingCopyIdentifier): Promise<void>
  discardBackups(filter?: { readonly except: readonly IWorkingCopyIdentifier[] }): Promise<void>
  joinBackups(): Promise<void>
}

export const IWorkingCopyBackupService = createDecorator<IWorkingCopyBackupService>("workingCopyBackupService")

export interface SerializedWorkingCopyBackup {
  readonly identifier: {
    readonly typeId: string
    readonly resource: string
  }
  readonly value: string
  readonly meta?: WorkingCopyBackupMeta
  readonly versionId?: number
}

export interface WorkingCopyBackupStorage {
  keys(): readonly string[]
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
  clear(): void
}

export class InMemoryWorkingCopyBackupStorage implements WorkingCopyBackupStorage {
  private readonly entries = new Map<string, string>()

  keys(): readonly string[] {
    return Array.from(this.entries.keys())
  }

  get(key: string): string | undefined {
    return this.entries.get(key)
  }

  set(key: string, value: string): void {
    this.entries.set(key, value)
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }
}

export class InMemoryWorkingCopyBackupService implements IWorkingCopyBackupService {
  declare readonly _serviceBrand: undefined

  private readonly storage: WorkingCopyBackupStorage

  constructor(storage: WorkingCopyBackupStorage = new InMemoryWorkingCopyBackupStorage()) {
    this.storage = storage
  }

  hasBackupSync(identifier: IWorkingCopyIdentifier, versionId?: number): boolean {
    const backup = this.readBackup(backupKey(identifier))
    if (!backup) return false
    return typeof versionId !== "number" || backup.versionId === versionId
  }

  async backup(identifier: IWorkingCopyIdentifier, value = "", versionId?: number, meta?: WorkingCopyBackupMeta): Promise<void> {
    const backup: SerializedWorkingCopyBackup = {
      identifier: {
        typeId: identifier.typeId,
        resource: identifier.resource.toString(),
      },
      value,
      versionId,
      meta: cloneBackupMeta(meta),
    }
    this.storage.set(backupKey(identifier), serializeBackup(backup))
  }

  async resolve(identifier: IWorkingCopyIdentifier): Promise<ResolvedWorkingCopyBackup | undefined> {
    const backup = this.readBackup(backupKey(identifier))
    return backup ? { value: backup.value, meta: cloneBackupMeta(backup.meta) } : undefined
  }

  async getBackups(): Promise<readonly IWorkingCopyIdentifier[]> {
    return this.storage.keys()
      .map((key) => this.readBackup(key))
      .filter((backup): backup is SerializedWorkingCopyBackup => Boolean(backup))
      .map((backup) => ({
        typeId: backup.identifier.typeId,
        resource: URI.parse(backup.identifier.resource),
      }))
  }

  async discardBackup(identifier: IWorkingCopyIdentifier): Promise<void> {
    this.storage.delete(backupKey(identifier))
  }

  async discardBackups(filter?: { readonly except: readonly IWorkingCopyIdentifier[] }): Promise<void> {
    const except = new Set((filter?.except || []).map(backupKey))
    if (except.size === 0) {
      this.storage.clear()
      return
    }
    for (const key of this.storage.keys()) {
      if (!except.has(key)) this.storage.delete(key)
    }
  }

  async joinBackups(): Promise<void> {
    return undefined
  }

  private readBackup(key: string): SerializedWorkingCopyBackup | undefined {
    const raw = this.storage.get(key)
    if (!raw) return undefined
    return deserializeBackup(raw)
  }
}

interface BackupModelEntry {
  readonly identifier?: IWorkingCopyIdentifier
  readonly versionId?: number
  readonly meta?: WorkingCopyBackupMeta
}

class ResourceOperationQueue {
  private readonly tails = new Map<string, Promise<unknown>>()

  async queue<T>(resource: URI, task: () => Promise<T>): Promise<T> {
    const key = resource.toString()
    const previous = this.tails.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(task)
    this.tails.set(key, next)
    try {
      return await next
    } finally {
      if (this.tails.get(key) === next) this.tails.delete(key)
    }
  }

  async whenDrained(): Promise<void> {
    await Promise.allSettled(Array.from(this.tails.values()))
  }
}

export interface DiskWorkingCopyBackupServiceOptions {
  readonly backupWorkspaceHome: URI
  readonly fileService: IFileService
  readonly onError?: (error: unknown, operation: string, resource?: URI, diagnostic?: WorkingCopyBackupDiagnostic) => void
}

export interface WorkingCopyBackupDiagnostic {
  readonly severity: "error" | "nonBlocking"
  readonly reason: string
  readonly ignored?: boolean
}

export class DiskWorkingCopyBackupService implements IWorkingCopyBackupService {
  declare readonly _serviceBrand: undefined

  private static readonly PREAMBLE_END_MARKER = "\n"
  private static readonly PREAMBLE_META_SEPARATOR = " "
  private static readonly PREAMBLE_MAX_LENGTH = 10000

  private readonly fileService: IFileService
  private readonly backupWorkspaceHome: URI
  private readonly onError?: (error: unknown, operation: string, resource?: URI, diagnostic?: WorkingCopyBackupDiagnostic) => void
  private readonly queue = new ResourceOperationQueue()
  private readonly model = new Map<string, BackupModelEntry>()
  private ready: Promise<void> | undefined

  constructor(options: DiskWorkingCopyBackupServiceOptions) {
    this.fileService = options.fileService
    this.backupWorkspaceHome = options.backupWorkspaceHome
    this.onError = options.onError
  }

  hasBackupSync(identifier: IWorkingCopyIdentifier, versionId?: number): boolean {
    const entry = this.model.get(this.toBackupResource(identifier).toString())
    if (!entry) return false
    return typeof versionId !== "number" || entry.versionId === versionId
  }

  async backup(identifier: IWorkingCopyIdentifier, value = "", versionId?: number, meta?: WorkingCopyBackupMeta): Promise<void> {
    const backupResource = this.toBackupResource(identifier)
    try {
      await this.whenReady()
    } catch (error) {
      this.reportError(error, "backup", backupResource)
      throw error
    }
    const key = backupResource.toString()
    const existing = this.model.get(key)
    if (existing && typeof versionId === "number" && existing.versionId === versionId && backupMetaEquals(existing.meta, meta)) {
      return
    }

    await this.queue.queue(backupResource, async () => {
      const queuedExisting = this.model.get(key)
      if (queuedExisting && typeof versionId === "number" && queuedExisting.versionId === versionId && backupMetaEquals(queuedExisting.meta, meta)) {
        return
      }
      try {
        await this.ensureBackupFolder(identifier.resource.scheme)
        let preamble = this.createPreamble(identifier, meta)
        if (preamble.length >= DiskWorkingCopyBackupService.PREAMBLE_MAX_LENGTH) {
          preamble = this.createPreamble(identifier)
        }
        await this.fileService.writeFile(backupResource, new TextEncoder().encode(`${preamble}${value}`), {
          create: true,
          overwrite: true,
        })
        this.model.set(key, {
          identifier: cloneWorkingCopyIdentifier(identifier),
          versionId,
          meta: cloneBackupMeta(meta),
        })
      } catch (error) {
        this.reportError(error, "backup", backupResource)
        throw error
      }
    })
  }

  async resolve(identifier: IWorkingCopyIdentifier): Promise<ResolvedWorkingCopyBackup | undefined> {
    const backupResource = this.toBackupResource(identifier)
    try {
      await this.whenReady()
    } catch (error) {
      this.reportError(error, "resolve", backupResource)
      throw error
    }
    return this.queue.queue(backupResource, async () => {
      if (!this.model.has(backupResource.toString())) return undefined
      try {
        const raw = new TextDecoder().decode(await this.fileService.readFile(backupResource))
        const preambleEnd = raw.indexOf(DiskWorkingCopyBackupService.PREAMBLE_END_MARKER)
        if (preambleEnd < 0) return undefined
        const preamble = raw.slice(0, preambleEnd)
        const parsed = parseBackupPreamble(preamble)
        const value = raw.slice(preambleEnd + DiskWorkingCopyBackupService.PREAMBLE_END_MARKER.length)
        this.model.set(backupResource.toString(), {
          ...this.model.get(backupResource.toString()),
          identifier: parsed.resource
            ? {
                resource: URI.parse(parsed.resource),
                typeId: parsed.typeId || STORED_FILE_WORKING_COPY_TYPE_ID,
              }
            : this.model.get(backupResource.toString())?.identifier,
          meta: cloneBackupMeta(parsed.meta),
        })
        return {
          value,
          meta: cloneBackupMeta(parsed.meta),
        }
      } catch (error) {
        if (isFileNotFoundError(error)) {
          this.model.delete(backupResource.toString())
          return undefined
        }
        this.reportError(error, "resolve", backupResource)
        throw error
      }
    })
  }

  async getBackups(): Promise<readonly IWorkingCopyIdentifier[]> {
    await this.whenReady()
    await this.queue.whenDrained()
    await this.refreshBackupsFromDisk()
    const backups: IWorkingCopyIdentifier[] = []
    for (const [resource, entry] of this.model.entries()) {
      const identifier = entry.identifier ?? await this.resolveIdentifier(URI.parse(resource))
      if (identifier) backups.push(identifier)
    }
    return backups
  }

  async discardBackup(identifier: IWorkingCopyIdentifier): Promise<void> {
    const backupResource = this.toBackupResource(identifier)
    try {
      await this.whenReady()
    } catch (error) {
      this.reportError(error, "discard", backupResource)
      throw error
    }
    await this.queue.queue(backupResource, async () => {
      try {
        await this.fileService.delete(backupResource)
      } catch (error) {
        if (!isFileNotFoundError(error)) {
          this.reportError(error, "discard", backupResource)
          throw error
        }
        this.reportError(error, "discard", backupResource, {
          severity: "nonBlocking",
          reason: "backupMissing",
          ignored: true,
        })
      }
      this.model.delete(backupResource.toString())
    })
  }

  async discardBackups(filter?: { readonly except: readonly IWorkingCopyIdentifier[] }): Promise<void> {
    await this.whenReady()
    const except = new Set((filter?.except || []).map((identifier) => this.toBackupResource(identifier).toString()))
    if (except.size > 0) {
      for (const resource of Array.from(this.model.keys())) {
        if (!except.has(resource)) await this.discardBackupResource(URI.parse(resource))
      }
      return
    }
    try {
      await this.fileService.delete(this.backupWorkspaceHome, { recursive: true })
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        this.reportError(error, "discardAll", this.backupWorkspaceHome)
        throw error
      }
    }
    this.model.clear()
  }

  toBackupResource(identifier: IWorkingCopyIdentifier): URI {
    return URI.joinPath(this.backupWorkspaceHome, identifier.resource.scheme || "file", hashIdentifier(identifier))
  }

  async joinBackups(): Promise<void> {
    await this.queue.whenDrained()
  }

  private whenReady(): Promise<void> {
    if (!this.ready) this.ready = this.initialize()
    return this.ready
  }

  private async initialize(): Promise<void> {
    await this.refreshBackupsFromDisk()
  }

  private async refreshBackupsFromDisk(): Promise<void> {
    try {
      const root = await this.fileService.resolve(this.backupWorkspaceHome)
      for (const schemeFolder of root.children || []) {
        if (!schemeFolder.isDirectory) continue
        const folder = await this.fileService.resolve(schemeFolder.resource)
        for (const child of folder.children || []) {
          if (!child.isDirectory && !this.model.has(child.resource.toString())) this.model.set(child.resource.toString(), {})
        }
      }
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        this.reportError(error, "initialize", this.backupWorkspaceHome)
        throw error
      }
    }
  }

  private async ensureBackupFolder(scheme: string): Promise<void> {
    await ensureFolder(this.fileService, this.backupWorkspaceHome)
    await ensureFolder(this.fileService, URI.joinPath(this.backupWorkspaceHome, scheme || "file"))
  }

  private createPreamble(identifier: IWorkingCopyIdentifier, meta?: WorkingCopyBackupMeta): string {
    return `${identifier.resource.toString()}${DiskWorkingCopyBackupService.PREAMBLE_META_SEPARATOR}${JSON.stringify({ ...cloneBackupMeta(meta), typeId: identifier.typeId })}${DiskWorkingCopyBackupService.PREAMBLE_END_MARKER}`
  }

  private async resolveIdentifier(backupResource: URI): Promise<IWorkingCopyIdentifier | undefined> {
    return this.queue.queue(backupResource, async () => {
      if (!this.model.has(backupResource.toString())) return undefined
      try {
        const raw = new TextDecoder().decode(await this.fileService.readFile(backupResource, {
          length: DiskWorkingCopyBackupService.PREAMBLE_MAX_LENGTH,
        }))
        const preambleEnd = raw.indexOf(DiskWorkingCopyBackupService.PREAMBLE_END_MARKER)
        if (preambleEnd < 0) return undefined
        const parsed = parseBackupPreamble(raw.slice(0, preambleEnd))
        if (!parsed.resource) return undefined
        const identifier = {
          resource: URI.parse(parsed.resource),
          typeId: parsed.typeId || STORED_FILE_WORKING_COPY_TYPE_ID,
        }
        this.model.set(backupResource.toString(), {
          ...this.model.get(backupResource.toString()),
          identifier,
          meta: cloneBackupMeta(parsed.meta),
        })
        return identifier
      } catch (error) {
        if (isFileNotFoundError(error)) {
          this.model.delete(backupResource.toString())
          return undefined
        }
        this.reportError(error, "resolveIdentifier", backupResource)
        throw error
      }
    })
  }

  private async discardBackupResource(backupResource: URI): Promise<void> {
    await this.queue.queue(backupResource, async () => {
      try {
        await this.fileService.delete(backupResource)
      } catch (error) {
        if (!isFileNotFoundError(error)) {
          this.reportError(error, "discard", backupResource)
          throw error
        }
        this.reportError(error, "discard", backupResource, {
          severity: "nonBlocking",
          reason: "backupMissing",
          ignored: true,
        })
      }
      this.model.delete(backupResource.toString())
    })
  }

  private reportError(error: unknown, operation: string, resource?: URI, diagnostic?: WorkingCopyBackupDiagnostic): void {
    this.onError?.(error, operation, resource, diagnostic)
  }
}

export function toWorkingCopyIdentifier(resource: URI, typeId = STORED_FILE_WORKING_COPY_TYPE_ID): IWorkingCopyIdentifier {
  return { resource, typeId }
}

export const globalWorkingCopyBackupService = new InMemoryWorkingCopyBackupService()
registerSingleton(IWorkingCopyBackupService, globalWorkingCopyBackupService, InstantiationType.Delayed)

function backupKey(identifier: IWorkingCopyIdentifier): string {
  return `${identifier.typeId}:${identifier.resource.toString()}`
}

export function hashIdentifier(identifier: IWorkingCopyIdentifier): string {
  const raw = identifier.typeId
    ? `${identifier.typeId}:${identifier.resource.toString()}`
    : identifier.resource.toString()
  return hashString(raw)
}

function hashString(raw: string): string {
  let hash = 2166136261
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function serializeBackup(backup: SerializedWorkingCopyBackup): string {
  return JSON.stringify({
    identifier: backup.identifier,
    value: backup.value,
    meta: backup.meta,
    versionId: backup.versionId,
  })
}

function deserializeBackup(raw: string): SerializedWorkingCopyBackup | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<SerializedWorkingCopyBackup>
    if (!parsed.identifier || typeof parsed.identifier.resource !== "string" || typeof parsed.identifier.typeId !== "string") {
      return undefined
    }
    return {
      identifier: {
        typeId: parsed.identifier.typeId,
        resource: parsed.identifier.resource,
      },
      value: typeof parsed.value === "string" ? parsed.value : "",
      meta: cloneBackupMeta(parsed.meta),
      versionId: typeof parsed.versionId === "number" ? parsed.versionId : undefined,
    }
  } catch {
    return undefined
  }
}

function cloneBackupMeta(meta: WorkingCopyBackupMeta | undefined): WorkingCopyBackupMeta | undefined {
  if (!meta) return undefined
  return JSON.parse(JSON.stringify(meta)) as WorkingCopyBackupMeta
}

function backupMetaEquals(left: WorkingCopyBackupMeta | undefined, right: WorkingCopyBackupMeta | undefined): boolean {
  return JSON.stringify(left || null) === JSON.stringify(right || null)
}

function cloneWorkingCopyIdentifier(identifier: IWorkingCopyIdentifier): IWorkingCopyIdentifier {
  return {
    resource: URI.parse(identifier.resource.toString()),
    typeId: identifier.typeId,
  }
}

function parseBackupPreamble(raw: string): { resource?: string; typeId?: string; meta?: WorkingCopyBackupMeta } {
  const metaStart = raw.indexOf(" ")
  const resource = metaStart >= 0 ? raw.slice(0, metaStart) : raw
  const metaRaw = metaStart >= 0 ? raw.slice(metaStart + 1) : undefined
  if (!metaRaw) return { resource }
  try {
    const meta = JSON.parse(metaRaw) as WorkingCopyBackupMeta & { typeId?: string }
    const typeId = typeof meta.typeId === "string" ? meta.typeId : undefined
    delete meta.typeId
    return {
      resource,
      typeId,
      meta: Object.keys(meta).length ? cloneBackupMeta(meta) : undefined,
    }
  } catch {
    return { resource }
  }
}

async function ensureFolder(fileService: IFileService, resource: URI): Promise<void> {
  try {
    const stat = await fileService.stat(resource)
    if (stat.isDirectory) return
    throw createFileSystemProviderError(`Backup path is not a directory: ${resource.toString()}`, FileSystemProviderErrorCode.FileExists)
  } catch (error) {
    if (!isFileNotFoundError(error)) throw error
  }
  await fileService.createFolder(resource)
}

function isFileNotFoundError(error: unknown): boolean {
  const candidate = error as { fileOperationResult?: unknown; code?: unknown; name?: unknown } | null
  return Boolean(
    candidate
    && (
      candidate.fileOperationResult === FileOperationResult.FILE_NOT_FOUND
      || candidate.code === FileSystemProviderErrorCode.FileNotFound
      || candidate.name === FileSystemProviderErrorCode.FileNotFound
    ),
  )
}
