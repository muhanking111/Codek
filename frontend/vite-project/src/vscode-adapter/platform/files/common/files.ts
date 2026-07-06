/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/platform/files/common/files.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Lazy } from "../../../base/common/lazy"
import { Emitter, type Event } from "../../../base/common/event"
import type { IDisposable } from "../../../base/common/lifecycle"
import { TernarySearchTree } from "../../../base/common/ternarySearchTree"
import { URI } from "../../../base/common/uri"
import { CancellationToken } from "../../../base/common/cancellation"
import { createDecorator } from "../../instantiation/common/instantiation"
import { InstantiationType, registerSingleton } from "../../instantiation/common/extensions"

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export enum FilePermission {
  Readonly = 1,
  Locked = 2,
  Executable = 4,
}

export enum FileOperation {
  CREATE,
  DELETE,
  MOVE,
  COPY,
  WRITE,
}

export enum FileChangeType {
  UPDATED,
  ADDED,
  DELETED,
}

export enum FileOperationResult {
  FILE_IS_DIRECTORY,
  FILE_NOT_FOUND,
  FILE_NOT_MODIFIED_SINCE,
  FILE_MODIFIED_SINCE,
  FILE_MOVE_CONFLICT,
  FILE_WRITE_LOCKED,
  FILE_PERMISSION_DENIED,
  FILE_TOO_LARGE,
  FILE_INVALID_PATH,
  FILE_NOT_DIRECTORY,
  FILE_OTHER_ERROR,
}

export interface IStat {
  readonly type: FileType
  readonly mtime: number
  readonly ctime: number
  readonly size: number
  readonly permissions?: FilePermission
}

export enum FileSystemProviderCapabilities {
  None = 0,
  FileReadWrite = 1 << 1,
  FileOpenReadWriteClose = 1 << 2,
  FileReadStream = 1 << 4,
  FileFolderCopy = 1 << 9,
  PathCaseSensitive = 1 << 10,
  Readonly = 1 << 11,
}

export interface IFileSystemProvider {
  readonly capabilities: FileSystemProviderCapabilities
  readonly onDidChangeCapabilities: Event<void>
  readonly onDidChangeFile: Event<readonly IFileChange[]>
  readonly onDidWatchError?: Event<string>
  stat(resource: URI): Promise<IStat>
  readdir(resource: URI): Promise<[string, FileType][]>
  readFile?(resource: URI, opts?: IFileReadOptions): Promise<Uint8Array>
  readFileStream?(resource: URI, opts: IFileReadStreamOptions, token?: CancellationToken): IReadableStreamEvents<Uint8Array>
  writeFile?(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void>
  open?(resource: URI, opts: IFileOpenOptions): Promise<number>
  close?(fd: number): Promise<void>
  read?(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>
  write?(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>
  mkdir?(resource: URI): Promise<void>
  delete?(resource: URI, opts: IFileDeleteOptions): Promise<void>
  rename?(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void>
  copy?(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void>
  watch?(resource: URI, opts: IWatchOptions): IDisposable
}

export interface IFileOpenOptions {
  readonly create?: boolean
  readonly append?: boolean
  readonly unlock?: boolean
}

export interface IFileSystemProviderWithOpenReadWriteCloseCapability extends IFileSystemProvider {
  open(resource: URI, opts: IFileOpenOptions): Promise<number>
  close(fd: number): Promise<void>
  read(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>
  write(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>
}

export interface IFileOverwriteOptions {
  readonly overwrite?: boolean
}

export interface IFileWriteOptions extends IFileOverwriteOptions {
  readonly create?: boolean
  readonly append?: boolean
  readonly signal?: AbortSignal
}

export interface IFileDeleteOptions {
  readonly recursive?: boolean
}

export interface IFileReadStreamOptions {
  readonly position?: number
  readonly length?: number
  readonly etag?: string
  readonly limits?: {
    readonly size?: number
  }
  readonly signal?: AbortSignal
  readonly allowDirectoryRead?: boolean
  readonly allowMissingReadMetadata?: boolean
}

export interface IFileReadOptions extends IFileReadStreamOptions {}

export interface IReadableStreamEvents<T> {
  onData(listener: (data: T) => unknown): IDisposable
  onError(listener: (error: Error) => unknown): IDisposable
  onEnd(listener: () => unknown): IDisposable
}

export interface IFileStreamContent extends IFileStatWithMetadata {
  readonly value: IReadableStreamEvents<Uint8Array>
}

export interface IWatchOptions {
  readonly recursive?: boolean
  readonly excludes?: readonly string[]
  readonly correlationId?: number
}

export interface IFileSystemWatcher extends IDisposable {
  readonly onDidChange: Event<FileChangesEvent>
}

export interface IFileSystemProviderRegistrationEvent {
  readonly added: boolean
  readonly scheme: string
  readonly provider?: IFileSystemProvider
}

export interface IFileSystemProviderCapabilitiesChangeEvent {
  readonly provider: IFileSystemProvider
  readonly scheme: string
}

export interface IFileSystemProviderActivationEvent {
  readonly scheme: string
  join(promise: Promise<void>): void
}

export interface IBaseFileStat {
  readonly resource: URI
  readonly name: string
  readonly size?: number
  readonly mtime?: number
  readonly ctime?: number
  readonly etag?: string
  readonly readonly?: boolean
  readonly locked?: boolean
  readonly executable?: boolean
}

export interface IBaseFileStatWithMetadata extends Required<IBaseFileStat> {}

export interface IFileStat extends IBaseFileStat {
  readonly type: FileType
  readonly isFile: boolean
  readonly isDirectory: boolean
  readonly isSymbolicLink: boolean
  children: IFileStat[] | undefined
}

export interface IResolveFileOptions {
  readonly resolveMetadata?: boolean
}

export interface IFileService {
  readonly onDidChangeFileSystemProviderRegistrations: Event<IFileSystemProviderRegistrationEvent>
  readonly onDidChangeFileSystemProviderCapabilities: Event<IFileSystemProviderCapabilitiesChangeEvent>
  readonly onWillActivateFileSystemProvider: Event<IFileSystemProviderActivationEvent>
  readonly onDidFilesChange: Event<FileChangesEvent>
  readonly onDidRunOperation: Event<FileOperationEvent>
  readonly onDidFailOperation: Event<FileOperationErrorEvent>
  readonly onDidWatchError: Event<Error>
  registerProvider(scheme: string, provider: IFileSystemProvider): IDisposable
  getProvider(scheme: string): IFileSystemProvider | undefined
  activateProvider(scheme: string): Promise<void>
  canHandleResource(resource: URI): Promise<boolean>
  hasProvider(resource: URI): boolean
  hasCapability(resource: URI, capability: FileSystemProviderCapabilities): boolean
  listCapabilities(): Iterable<{ scheme: string; capabilities: FileSystemProviderCapabilities }>
  resolve(resource: URI, options?: IResolveFileOptions): Promise<IFileStat>
  resolveAll(toResolve: { resource: URI; options?: IResolveFileOptions }[]): Promise<IFileStatResult[]>
  stat(resource: URI): Promise<IFileStat>
  exists(resource: URI): Promise<boolean>
  readFile(resource: URI, options?: IFileReadOptions, token?: CancellationToken): Promise<Uint8Array>
  readFileStream(resource: URI, options?: IFileReadStreamOptions, token?: CancellationToken): Promise<IFileStreamContent>
  writeFile(resource: URI, content: Uint8Array, options?: IFileWriteOptions, token?: CancellationToken): Promise<IFileStatWithMetadata>
  createFile(resource: URI, content?: Uint8Array, options?: ICreateFileOptions): Promise<IFileStatWithMetadata>
  createFolder(resource: URI): Promise<IFileStatWithMetadata>
  move(source: URI, target: URI, overwrite?: boolean): Promise<IFileStatWithMetadata>
  copy(source: URI, target: URI, overwrite?: boolean): Promise<IFileStatWithMetadata>
  delete(resource: URI, options?: IFileDeleteOptions): Promise<void>
  del(resource: URI, options?: IFileDeleteOptions): Promise<void>
  createWatcher(resource: URI, options?: IWatchOptions): IFileSystemWatcher
  watch(resource: URI, options: IWatchOptions & { readonly correlationId: number }): IFileSystemWatcher
  watch(resource: URI, options?: IWatchOptions): IDisposable
}

export interface ICreateFileOptions {
  readonly overwrite?: boolean
}

export interface IFileStatWithMetadata extends IFileStat, IBaseFileStatWithMetadata {
  readonly mtime: number
  readonly ctime: number
  readonly etag: string
  readonly size: number
  readonly readonly: boolean
  readonly locked: boolean
  readonly executable: boolean
  readonly children: IFileStatWithMetadata[] | undefined
}

export interface IFileStatResult {
  readonly success: boolean
  readonly stat: IFileStat | undefined
}

export interface NormalizedFileStat extends IFileStat {
  readonly exists: boolean
  readonly type: FileType
  readonly size: number
  readonly mtime?: number
  readonly ctime?: number
  readonly permissions?: FilePermission
  readonly etag?: string
}

export interface IFileChange {
  type: FileChangeType
  readonly resource: URI
  readonly cId?: number
}

interface IActiveFileWatcher {
  readonly disposable: IDisposable
  count: number
}

export interface IFileOperationEvent {
  readonly resource: URI
  readonly operation: FileOperation
  isOperation(operation: FileOperation.DELETE | FileOperation.WRITE): boolean
  isOperation(operation: FileOperation.CREATE | FileOperation.MOVE | FileOperation.COPY): this is IFileOperationEventWithMetadata
}

export interface IFileOperationEventWithMetadata extends IFileOperationEvent {
  readonly target: IFileStatWithMetadata
}

export class FileOperationEvent implements IFileOperationEvent {
  constructor(readonly resource: URI, readonly operation: FileOperation, readonly target?: IFileStatWithMetadata) {}

  isOperation(operation: FileOperation.DELETE | FileOperation.WRITE): boolean
  isOperation(operation: FileOperation.CREATE | FileOperation.MOVE | FileOperation.COPY): this is IFileOperationEventWithMetadata
  isOperation(operation: FileOperation): boolean {
    return this.operation === operation
  }
}

export type FileOperationRollbackRisk = "none" | "unknown" | "partial-write"

export interface IFileOperationFailureMetadata {
  readonly fileOperation?: FileOperation
  readonly fileOperationResult?: FileOperationResult
  readonly rollbackRisk?: FileOperationRollbackRisk
}

export class FileOperationErrorEvent {
  readonly reason: string
  readonly result: FileOperationResult

  constructor(
    readonly resource: URI,
    readonly operation: FileOperation,
    readonly error: Error,
    readonly target?: IFileStatWithMetadata,
    readonly rollbackRisk: FileOperationRollbackRisk = "unknown",
  ) {
    this.reason = error.message
    this.result = toFileOperationResult(error)
  }

  isOperation(operation: FileOperation): boolean {
    return this.operation === operation
  }
}

export class FileOperationError extends Error {
  constructor(
    message: string,
    readonly fileOperationResult: FileOperationResult,
    readonly options?: unknown,
    readonly rollbackRisk: FileOperationRollbackRisk = "unknown",
    readonly fileOperation?: FileOperation,
  ) {
    super(message)
  }
}

export enum FileSystemProviderErrorCode {
  FileExists = "EntryExists",
  FileNotFound = "EntryNotFound",
  FileNotADirectory = "EntryNotADirectory",
  FileIsADirectory = "EntryIsADirectory",
  FileExceedsStorageQuota = "EntryExceedsStorageQuota",
  FileTooLarge = "EntryTooLarge",
  NoPermissions = "NoPermissions",
  Unavailable = "Unavailable",
  Unknown = "Unknown",
}

export interface IFileSystemProviderError extends Error {
  readonly code: FileSystemProviderErrorCode
}

export class FileSystemProviderError extends Error implements IFileSystemProviderError {
  constructor(message: string, readonly code: FileSystemProviderErrorCode) {
    super(message)
    this.name = code
  }
}

export function createFileSystemProviderError(error: Error | string, code: FileSystemProviderErrorCode): FileSystemProviderError {
  const message = typeof error === "string" ? error : error.message
  return new FileSystemProviderError(message, code)
}

export function ensureFileSystemProviderError(error: unknown): Error {
  if (error instanceof Error) return error
  return createFileSystemProviderError(error === undefined ? "Unknown Error" : String(error), FileSystemProviderErrorCode.Unknown)
}

export function toFileSystemProviderErrorCode(error: unknown): FileSystemProviderErrorCode {
  if (!error) return FileSystemProviderErrorCode.Unknown
  if (error instanceof FileSystemProviderError) return error.code
  const candidate = error as { code?: unknown; name?: unknown }
  if (isFileSystemProviderErrorCode(candidate.code)) return candidate.code
  if (typeof candidate.name === "string") {
    if (isFileSystemProviderErrorCode(candidate.name)) return candidate.name
    const match = /^(.+) \(FileSystemError\)$/.exec(candidate.name)
    if (match && isFileSystemProviderErrorCode(match[1])) return match[1]
  }
  return FileSystemProviderErrorCode.Unknown
}

export function toFileOperationResult(error: unknown): FileOperationResult {
  if (error instanceof FileOperationError) return error.fileOperationResult
  const candidate = error as { fileOperationResult?: unknown } | null
  if (candidate && typeof candidate.fileOperationResult === "number") return candidate.fileOperationResult as FileOperationResult
  switch (toFileSystemProviderErrorCode(error)) {
    case FileSystemProviderErrorCode.FileNotFound:
      return FileOperationResult.FILE_NOT_FOUND
    case FileSystemProviderErrorCode.FileIsADirectory:
      return FileOperationResult.FILE_IS_DIRECTORY
    case FileSystemProviderErrorCode.FileNotADirectory:
      return FileOperationResult.FILE_NOT_DIRECTORY
    case FileSystemProviderErrorCode.NoPermissions:
      return FileOperationResult.FILE_PERMISSION_DENIED
    case FileSystemProviderErrorCode.FileExists:
      return FileOperationResult.FILE_MOVE_CONFLICT
    case FileSystemProviderErrorCode.FileTooLarge:
      return FileOperationResult.FILE_TOO_LARGE
    default:
      return FileOperationResult.FILE_OTHER_ERROR
  }
}

function isFileOperationRollbackRisk(value: unknown): value is FileOperationRollbackRisk {
  return value === "none" || value === "unknown" || value === "partial-write"
}

export function getFileOperationRollbackRisk(error: unknown, fallback: FileOperationRollbackRisk = "unknown"): FileOperationRollbackRisk {
  const candidate = error as IFileOperationFailureMetadata | null
  if (candidate && isFileOperationRollbackRisk(candidate.rollbackRisk)) return candidate.rollbackRisk
  return isFileOperationRollbackRisk(fallback) ? fallback : "unknown"
}

function defineFailureMetadataProperty<T>(error: Error, key: keyof IFileOperationFailureMetadata, value: T): void {
  try {
    Object.defineProperty(error, key, {
      value,
      writable: true,
      enumerable: false,
      configurable: true,
    })
  } catch {
    ;(error as unknown as Record<string, unknown>)[key] = value
  }
}

function annotateFileOperationFailure(
  error: Error,
  operation: FileOperation,
  rollbackRisk: FileOperationRollbackRisk,
): Error {
  defineFailureMetadataProperty(error, "fileOperation", operation)
  defineFailureMetadataProperty(error, "fileOperationResult", toFileOperationResult(error))
  defineFailureMetadataProperty(error, "rollbackRisk", rollbackRisk)
  return error
}

export class TooLargeFileOperationError extends FileOperationError {
  constructor(
    message: string,
    override readonly fileOperationResult: FileOperationResult.FILE_TOO_LARGE,
    readonly size: number,
    options?: unknown,
  ) {
    super(message, fileOperationResult, options)
  }
}

export class NotModifiedSinceFileOperationError extends FileOperationError {
  constructor(
    message: string,
    readonly stat: IFileStatWithMetadata,
    options?: unknown,
  ) {
    super(message, FileOperationResult.FILE_NOT_MODIFIED_SINCE, options)
  }
}

export class FileChangesEvent {
  private static readonly MIXED_CORRELATION = null
  private readonly correlationId: number | undefined | typeof FileChangesEvent.MIXED_CORRELATION = undefined
  readonly rawAdded: URI[] = []
  readonly rawUpdated: URI[] = []
  readonly rawDeleted: URI[] = []

  private readonly added = new Lazy(() => {
    const added = TernarySearchTree.forUris<boolean>(() => this.ignorePathCasing)
    added.fill(this.rawAdded.map((resource) => [resource, true]))
    return added
  })

  private readonly updated = new Lazy(() => {
    const updated = TernarySearchTree.forUris<boolean>(() => this.ignorePathCasing)
    updated.fill(this.rawUpdated.map((resource) => [resource, true]))
    return updated
  })

  private readonly deleted = new Lazy(() => {
    const deleted = TernarySearchTree.forUris<boolean>(() => this.ignorePathCasing)
    deleted.fill(this.rawDeleted.map((resource) => [resource, true]))
    return deleted
  })

  constructor(changes: readonly IFileChange[], private readonly ignorePathCasing: boolean) {
    for (const change of changes) {
      if (change.type === FileChangeType.ADDED) this.rawAdded.push(change.resource)
      else if (change.type === FileChangeType.UPDATED) this.rawUpdated.push(change.resource)
      else if (change.type === FileChangeType.DELETED) this.rawDeleted.push(change.resource)

      if (this.correlationId !== FileChangesEvent.MIXED_CORRELATION) {
        if (typeof change.cId === "number") {
          if (this.correlationId === undefined) this.correlationId = change.cId
          else if (this.correlationId !== change.cId) this.correlationId = FileChangesEvent.MIXED_CORRELATION
        } else if (this.correlationId !== undefined) {
          this.correlationId = FileChangesEvent.MIXED_CORRELATION
        }
      }
    }
  }

  contains(resource: URI, ...types: FileChangeType[]): boolean {
    return this.doContains(resource, { includeChildren: false }, ...types)
  }

  affects(resource: URI, ...types: FileChangeType[]): boolean {
    return this.doContains(resource, { includeChildren: true }, ...types)
  }

  gotAdded(): boolean {
    return this.rawAdded.length > 0
  }

  gotDeleted(): boolean {
    return this.rawDeleted.length > 0
  }

  gotUpdated(): boolean {
    return this.rawUpdated.length > 0
  }

  correlates(correlationId: number): boolean {
    return this.correlationId === correlationId
  }

  hasCorrelation(): boolean {
    return typeof this.correlationId === "number"
  }

  private doContains(resource: URI, options: { includeChildren: boolean }, ...types: FileChangeType[]): boolean {
    if (!resource) return false
    const hasTypesFilter = types.length > 0

    if (!hasTypesFilter || types.includes(FileChangeType.ADDED)) {
      if (this.added.value.get(resource)) return true
      if (options.includeChildren && this.added.value.findSuperstr(resource)) return true
    }
    if (!hasTypesFilter || types.includes(FileChangeType.UPDATED)) {
      if (this.updated.value.get(resource)) return true
      if (options.includeChildren && this.updated.value.findSuperstr(resource)) return true
    }
    if (!hasTypesFilter || types.includes(FileChangeType.DELETED)) {
      if (this.deleted.value.findSubstr(resource)) return true
      if (options.includeChildren && this.deleted.value.findSuperstr(resource)) return true
    }
    return false
  }
}

export function coalesceFileChanges(changes: readonly IFileChange[]): IFileChange[] {
  return coalesceFileChangesByCorrelation(changes).flat()
}

function coalesceFileChangesByCorrelation(changes: readonly IFileChange[]): IFileChange[][] {
  const coalescers = new Map<string, FileChangeEventCoalescer>()
  const orderedKeys: string[] = []
  for (const change of changes) {
    const key = getFileChangeCorrelationKey(change)
    let coalescer = coalescers.get(key)
    if (!coalescer) {
      coalescer = new FileChangeEventCoalescer()
      coalescers.set(key, coalescer)
      orderedKeys.push(key)
    }
    coalescer.process(change)
  }
  return orderedKeys
    .map((key) => coalescers.get(key)?.coalesce() ?? [])
    .filter((changes) => changes.length > 0)
}

function getFileChangeCorrelationKey(change: IFileChange): string {
  return typeof change.cId === "number" ? `c:${change.cId}` : "global"
}

class FileChangeEventCoalescer {
  private readonly coalesced = new Set<IFileChange>()
  private readonly pathToChange = new Map<string, IFileChange>()

  process(change: IFileChange): void {
    const key = this.toKey(change.resource)
    const existingChange = this.pathToChange.get(key)
    if (!existingChange) {
      this.keep(change, key)
      return
    }

    const currentType = existingChange.type
    const nextType = change.type
    const caseRename = existingChange.resource.fsPath !== change.resource.fsPath
      && (nextType === FileChangeType.ADDED || nextType === FileChangeType.DELETED)

    if (caseRename) {
      this.keep(change, key)
      return
    }

    if (currentType === FileChangeType.ADDED && nextType === FileChangeType.DELETED) {
      this.pathToChange.delete(key)
      this.coalesced.delete(existingChange)
      return
    }

    if (currentType === FileChangeType.DELETED && nextType === FileChangeType.ADDED) {
      existingChange.type = FileChangeType.UPDATED
      return
    }

    if (currentType === FileChangeType.ADDED && nextType === FileChangeType.UPDATED) {
      return
    }

    existingChange.type = nextType
  }

  coalesce(): IFileChange[] {
    const addOrChangeEvents: IFileChange[] = []
    const deletedPaths: string[] = []
    const deletedEvents = Array.from(this.coalesced).filter((change) => {
      if (change.type === FileChangeType.DELETED) return true
      addOrChangeEvents.push(change)
      return false
    })

    return deletedEvents
      .sort((first, second) => first.resource.fsPath.length - second.resource.fsPath.length)
      .filter((change) => {
        if (deletedPaths.some((deletedPath) => isParent(change.resource.fsPath, deletedPath, true))) {
          return false
        }
        deletedPaths.push(change.resource.fsPath)
        return true
      })
      .concat(addOrChangeEvents)
  }

  private keep(change: IFileChange, key: string): void {
    this.coalesced.add(change)
    this.pathToChange.set(key, change)
  }

  private toKey(resource: URI): string {
    return normalizePathForParent(resource.fsPath, true)
  }
}

export const ETAG_DISABLED = ""

export const IFileService = createDecorator<IFileService>("fileService")

export class FileService implements IFileService {
  declare readonly _serviceBrand: undefined
  private readonly providers = new Map<string, IFileSystemProvider>()
  private readonly providerChangeListeners = new Map<string, IDisposable>()
  private readonly providerCapabilityListeners = new Map<string, IDisposable>()
  private readonly providerWatchErrorListeners = new Map<string, IDisposable>()
  private readonly activeWatchers = new Map<string, Map<string, IActiveFileWatcher>>()
  private static watcherCorrelationIds = 0
  private readonly onDidChangeFileSystemProviderRegistrationsEmitter = new Emitter<IFileSystemProviderRegistrationEvent>()
  readonly onDidChangeFileSystemProviderRegistrations = this.onDidChangeFileSystemProviderRegistrationsEmitter.event
  private readonly onDidChangeFileSystemProviderCapabilitiesEmitter = new Emitter<IFileSystemProviderCapabilitiesChangeEvent>()
  readonly onDidChangeFileSystemProviderCapabilities = this.onDidChangeFileSystemProviderCapabilitiesEmitter.event
  private readonly onWillActivateFileSystemProviderEmitter = new Emitter<IFileSystemProviderActivationEvent>()
  readonly onWillActivateFileSystemProvider = this.onWillActivateFileSystemProviderEmitter.event
  private readonly internalOnDidFilesChangeEmitter = new Emitter<FileChangesEvent>()
  private readonly onDidFilesChangeEmitter = new Emitter<FileChangesEvent>()
  readonly onDidFilesChange = this.onDidFilesChangeEmitter.event
  private readonly onDidRunOperationEmitter = new Emitter<FileOperationEvent>()
  readonly onDidRunOperation = this.onDidRunOperationEmitter.event
  private readonly onDidFailOperationEmitter = new Emitter<FileOperationErrorEvent>()
  readonly onDidFailOperation = this.onDidFailOperationEmitter.event
  private readonly onDidWatchErrorEmitter = new Emitter<Error>()
  readonly onDidWatchError = this.onDidWatchErrorEmitter.event

  registerProvider(scheme: string, provider: IFileSystemProvider): IDisposable {
    const normalizedScheme = String(scheme || "").trim()
    if (!normalizedScheme) throw new Error("File system provider scheme is required")
    if (this.providers.has(normalizedScheme)) throw new Error(`File system provider already registered: ${normalizedScheme}`)
    this.providers.set(normalizedScheme, provider)
    const providerFileChangeListener = provider.onDidChangeFile((changes) => {
      if (changes.length === 0) return
      const coalescedChangeGroups = coalesceFileChangesByCorrelation(changes)
      for (const coalescedChanges of coalescedChangeGroups) {
        const event = new FileChangesEvent(coalescedChanges, !this.hasCapabilityForScheme(normalizedScheme, FileSystemProviderCapabilities.PathCaseSensitive))
        this.internalOnDidFilesChangeEmitter.fire(event)
        if (!event.hasCorrelation()) this.onDidFilesChangeEmitter.fire(event)
      }
    })
    this.providerChangeListeners.set(normalizedScheme, providerFileChangeListener)
    const providerCapabilityListener = provider.onDidChangeCapabilities(() => {
      this.onDidChangeFileSystemProviderCapabilitiesEmitter.fire({ provider, scheme: normalizedScheme })
    })
    this.providerCapabilityListeners.set(normalizedScheme, providerCapabilityListener)
    if (provider.onDidWatchError) {
      const providerWatchErrorListener = provider.onDidWatchError((error) => {
        this.onDidWatchErrorEmitter.fire(new Error(error))
      })
      this.providerWatchErrorListeners.set(normalizedScheme, providerWatchErrorListener)
    }
    this.onDidChangeFileSystemProviderRegistrationsEmitter.fire({ added: true, scheme: normalizedScheme, provider })
    return {
      dispose: () => {
        if (this.providers.get(normalizedScheme) !== provider) return
        this.disposeProviderWatchers(normalizedScheme)
        this.providerChangeListeners.get(normalizedScheme)?.dispose()
        this.providerChangeListeners.delete(normalizedScheme)
        this.providerCapabilityListeners.get(normalizedScheme)?.dispose()
        this.providerCapabilityListeners.delete(normalizedScheme)
        this.providerWatchErrorListeners.get(normalizedScheme)?.dispose()
        this.providerWatchErrorListeners.delete(normalizedScheme)
        this.providers.delete(normalizedScheme)
        this.onDidChangeFileSystemProviderRegistrationsEmitter.fire({ added: false, scheme: normalizedScheme, provider })
      },
    }
  }

  getProvider(scheme: string): IFileSystemProvider | undefined {
    return this.providers.get(String(scheme || "").trim())
  }

  async activateProvider(scheme: string): Promise<void> {
    const normalizedScheme = String(scheme || "").trim()
    const joiners: Promise<void>[] = []
    this.onWillActivateFileSystemProviderEmitter.fire({
      scheme: normalizedScheme,
      join(promise) {
        joiners.push(Promise.resolve(promise))
      },
    })
    if (this.providers.has(normalizedScheme)) return
    await Promise.allSettled(joiners)
  }

  async canHandleResource(resource: URI): Promise<boolean> {
    await this.activateProvider(resource.scheme)
    return this.hasProvider(resource)
  }

  hasProvider(resource: URI): boolean {
    return this.providers.has(resource.scheme)
  }

  hasCapability(resource: URI, capability: FileSystemProviderCapabilities): boolean {
    return this.hasCapabilityForScheme(resource.scheme, capability)
  }

  listCapabilities(): Iterable<{ scheme: string; capabilities: FileSystemProviderCapabilities }> {
    return Array.from(this.providers, ([scheme, provider]) => ({ scheme, capabilities: provider.capabilities }))
  }

  async resolve(resource: URI, _options: IResolveFileOptions = {}): Promise<IFileStat> {
    try {
      return await this.doResolve(resource, _options)
    } catch (error) {
      throw this.restoreResolveError(error, resource)
    }
  }

  async resolveAll(toResolve: { resource: URI; options?: IResolveFileOptions }[]): Promise<IFileStatResult[]> {
    return Promise.all(toResolve.map(async (entry) => {
      try {
        return { stat: await this.doResolve(entry.resource, entry.options), success: true }
      } catch {
        return { stat: undefined, success: false }
      }
    }))
  }

  async stat(resource: URI): Promise<IFileStat> {
    const provider = await this.providerFor(resource)
    try {
      return statToFileStat(resource, await provider.stat(resource))
    } catch (error) {
      throw ensureFileSystemProviderError(error)
    }
  }

  async exists(resource: URI): Promise<boolean> {
    try {
      await this.stat(resource)
      return true
    } catch {
      return false
    }
  }

  async readFile(resource: URI, options: IFileReadOptions = {}, token?: CancellationToken): Promise<Uint8Array> {
    const cancellation = createReadCancellationOptions(options, token)
    try {
      const stream = await this.readFileStream(resource, cancellation.options, token)
      this.throwIfAborted(cancellation.options.signal, resource, cancellation.options)
      return await consumeReadableStream(stream.value, cancellation.options.signal, (error) => this.restoreReadError(error, resource, cancellation.options))
    } catch (error) {
      throw this.restoreReadError(error, resource, cancellation.options)
    } finally {
      cancellation.dispose()
    }
  }

  async readFileStream(resource: URI, options: IFileReadStreamOptions = {}, token?: CancellationToken): Promise<IFileStreamContent> {
    const cancellation = createReadCancellationOptions(options, token)
    const provider = await this.providerFor(resource)
    try {
      this.throwIfAborted(cancellation.options.signal, resource, cancellation.options)
      const stat = await this.validateReadFile(resource, cancellation.options)
      this.throwIfAborted(cancellation.options.signal, resource, cancellation.options)
      return this.doReadFileStream(provider, resource, stat, cancellation.options, token)
    } catch (error) {
      cancellation.dispose()
      throw this.restoreReadError(error, resource, cancellation.options)
    }
  }

  private async doReadFileStream(
    provider: IFileSystemProvider,
    resource: URI,
    stat: IFileStatWithMetadata,
    options: IFileReadStreamOptions,
    token?: CancellationToken,
  ): Promise<IFileStreamContent> {
    if (stat.isDirectory && options.allowDirectoryRead !== true) {
      throw this.restoreReadError(
        createFileSystemProviderError(`File is a directory: ${resource.toString()}`, FileSystemProviderErrorCode.FileIsADirectory),
        resource,
        options,
      )
    }
    if (provider.readFileStream) {
      try {
        return {
          ...stat,
          value: mapReadableStreamErrors(
            provider.readFileStream(resource, options, token ?? CancellationToken.None),
            (error) => this.restoreReadError(error, resource, options),
            options.signal,
          ),
        }
      } catch (error) {
        throw this.restoreReadError(error, resource, options)
      }
    }
    if (!provider.readFile && !hasOpenReadWriteCloseCapability(provider)) {
      throw createFileSystemProviderError(
        `File system provider does not support readFile: ${resource.scheme}`,
        FileSystemProviderErrorCode.Unavailable,
      )
    }
    const stream = new OneShotReadableStream<Uint8Array>()
    const abortListener = createAbortListener(options.signal, () => {
      stream.error(this.restoreReadError(createAbortError(resource), resource, options))
    })
    let readPromise: Promise<Uint8Array>
    if (provider.readFile) readPromise = provider.readFile(resource, options)
    else if (hasOpenReadWriteCloseCapability(provider)) readPromise = this.readFileWithOpenReadClose(provider, resource, stat, options)
    else {
      throw createFileSystemProviderError(
        `File system provider does not support readFile: ${resource.scheme}`,
        FileSystemProviderErrorCode.Unavailable,
      )
    }
    readPromise.then((data) => {
      if (options.signal?.aborted) return
      this.validateReadFileLimits(resource, data.byteLength, options)
      stream.end(sliceReadBuffer(data, options))
    }).catch((error) => {
      if (options.signal?.aborted) return
      stream.error(this.restoreReadError(error, resource, options))
    }).finally(() => abortListener.dispose())
    return {
      ...stat,
      value: stream,
    }
  }

  async writeFile(resource: URI, content: Uint8Array, options: IFileWriteOptions = { create: true, overwrite: true }, token?: CancellationToken): Promise<IFileStatWithMetadata> {
    const cancellation = createOperationCancellationOptions(options, token, "Write aborted")
    let writeStarted = false
    try {
      const provider = await this.providerFor(resource)
      this.throwIfProviderReadonly(provider, resource)
      if (!provider.writeFile && !hasOpenReadWriteCloseCapability(provider)) {
        throw createFileSystemProviderError(
          `File system provider does not support writeFile: ${resource.scheme}`,
          FileSystemProviderErrorCode.Unavailable,
        )
      }
      this.throwIfAborted(cancellation.options.signal, resource, cancellation.options, "write")
      if (provider.writeFile) {
        writeStarted = true
        await provider.writeFile(resource, content, cancellation.options)
        this.throwIfAborted(cancellation.options.signal, resource, cancellation.options, "write")
      } else if (hasOpenReadWriteCloseCapability(provider)) {
        const writeState = { wrote: false }
        await this.writeFileWithOpenWriteClose(provider, resource, content, cancellation.options, writeState)
        writeStarted = writeState.wrote
      } else {
        throw createFileSystemProviderError(
          `File system provider does not support writeFile: ${resource.scheme}`,
          FileSystemProviderErrorCode.Unavailable,
        )
      }
      const target = toFileStatWithMetadata(await this.stat(resource))
      this.throwIfAborted(cancellation.options.signal, resource, cancellation.options, "write")
      this.onDidRunOperationEmitter.fire(new FileOperationEvent(resource, FileOperation.WRITE))
      return target
    } catch (error) {
      const operationError = this.restoreWriteError(error, resource, cancellation.options)
      this.fireOperationError(resource, FileOperation.WRITE, operationError, undefined, writeStarted ? "partial-write" : "none")
      throw operationError
    } finally {
      cancellation.dispose()
    }
  }

  async createFile(resource: URI, content: Uint8Array = new Uint8Array(), options: ICreateFileOptions = {}): Promise<IFileStatWithMetadata> {
    let started = false
    try {
      this.throwIfProviderReadonly(await this.providerFor(resource), resource)
      if (options.overwrite !== true && await this.exists(resource)) {
        throw createFileSystemProviderError(`File already exists: ${resource.toString()}`, FileSystemProviderErrorCode.FileExists)
      }
      started = true
      const target = await this.writeFile(resource, content, { create: true, overwrite: options.overwrite === true })
      this.onDidRunOperationEmitter.fire(new FileOperationEvent(resource, FileOperation.CREATE, target))
      return target
    } catch (error) {
      const operationError = ensureFileSystemProviderError(error)
      this.fireOperationError(resource, FileOperation.CREATE, operationError, undefined, getFileOperationRollbackRisk(error, started ? "unknown" : "none"))
      throw operationError
    }
  }

  async createFolder(resource: URI): Promise<IFileStatWithMetadata> {
    let started = false
    try {
      const provider = await this.providerFor(resource)
      this.throwIfProviderReadonly(provider, resource)
      if (!provider.mkdir) {
        throw createFileSystemProviderError(
          `File system provider does not support mkdir: ${resource.scheme}`,
          FileSystemProviderErrorCode.Unavailable,
        )
      }
      started = true
      await provider.mkdir(resource)
      const target = toFileStatWithMetadata(await this.stat(resource))
      this.onDidRunOperationEmitter.fire(new FileOperationEvent(resource, FileOperation.CREATE, target))
      return target
    } catch (error) {
      const operationError = ensureFileSystemProviderError(error)
      this.fireOperationError(resource, FileOperation.CREATE, operationError, undefined, getFileOperationRollbackRisk(error, started ? "unknown" : "none"))
      throw operationError
    }
  }

  async move(source: URI, target: URI, overwrite = false): Promise<IFileStatWithMetadata> {
    let started = false
    try {
      const sourceProvider = await this.providerFor(source)
      const targetProvider = await this.providerFor(target)
      this.throwIfProviderReadonly(sourceProvider, source)
      this.throwIfProviderReadonly(targetProvider, target)
      if (sourceProvider !== targetProvider) {
        started = true
        await this.copy(source, target, overwrite)
        await this.delete(source, { recursive: true })
      } else {
        if (!sourceProvider.rename) {
          throw createFileSystemProviderError(
            `File system provider does not support rename: ${source.scheme}`,
            FileSystemProviderErrorCode.Unavailable,
          )
        }
        started = true
        await sourceProvider.rename(source, target, { overwrite })
      }
      const targetStat = toFileStatWithMetadata(await this.stat(target))
      this.onDidRunOperationEmitter.fire(new FileOperationEvent(source, FileOperation.MOVE, targetStat))
      return targetStat
    } catch (error) {
      const operationError = ensureFileSystemProviderError(error)
      this.fireOperationError(source, FileOperation.MOVE, operationError, undefined, getFileOperationRollbackRisk(error, started ? "unknown" : "none"))
      throw operationError
    }
  }

  async copy(source: URI, target: URI, overwrite = false): Promise<IFileStatWithMetadata> {
    let started = false
    try {
      const sourceProvider = await this.providerFor(source)
      const targetProvider = await this.providerFor(target)
      this.throwIfProviderReadonly(targetProvider, target)
      started = true
      if (sourceProvider === targetProvider && sourceProvider.copy) {
        await sourceProvider.copy(source, target, { overwrite })
      } else {
        await this.copyFileWithReadWrite(source, target, overwrite)
      }
      const targetStat = toFileStatWithMetadata(await this.stat(target))
      this.onDidRunOperationEmitter.fire(new FileOperationEvent(source, FileOperation.COPY, targetStat))
      return targetStat
    } catch (error) {
      const operationError = ensureFileSystemProviderError(error)
      this.fireOperationError(source, FileOperation.COPY, operationError, undefined, getFileOperationRollbackRisk(error, started ? "unknown" : "none"))
      throw operationError
    }
  }

  async delete(resource: URI, options: IFileDeleteOptions = { recursive: false }): Promise<void> {
    let started = false
    try {
      const provider = await this.providerFor(resource)
      this.throwIfProviderReadonly(provider, resource)
      if (!provider.delete) {
        throw createFileSystemProviderError(
          `File system provider does not support delete: ${resource.scheme}`,
          FileSystemProviderErrorCode.Unavailable,
        )
      }
      started = true
      await provider.delete(resource, { recursive: Boolean(options.recursive) })
      this.onDidRunOperationEmitter.fire(new FileOperationEvent(resource, FileOperation.DELETE))
    } catch (error) {
      const operationError = ensureFileSystemProviderError(error)
      this.fireOperationError(resource, FileOperation.DELETE, operationError, undefined, getFileOperationRollbackRisk(error, started ? "unknown" : "none"))
      throw operationError
    }
  }

  del(resource: URI, options?: IFileDeleteOptions): Promise<void> {
    return this.delete(resource, options)
  }

  createWatcher(resource: URI, options: IWatchOptions = {}): IFileSystemWatcher {
    return this.watch(resource, {
      ...options,
      correlationId: FileService.watcherCorrelationIds++,
    }) as IFileSystemWatcher
  }

  watch(resource: URI, options: IWatchOptions & { readonly correlationId: number }): IFileSystemWatcher
  watch(resource: URI, options?: IWatchOptions): IDisposable
  watch(resource: URI, options: IWatchOptions = {}): IDisposable | IFileSystemWatcher {
    const provider = this.providerForSync(resource)
    if (!provider.watch) {
      throw createFileSystemProviderError(
        `File system provider does not support watch: ${resource.scheme}`,
        FileSystemProviderErrorCode.Unavailable,
      )
    }
    const normalizedOptions = {
      recursive: Boolean(options.recursive),
      excludes: [...(options.excludes || [])],
      ...(typeof options.correlationId === "number" ? { correlationId: options.correlationId } : {}),
    }
    const watchKey = getWatchRequestKey(resource, normalizedOptions)
    const schemeWatchers = this.activeWatchers.get(resource.scheme) ?? new Map<string, IActiveFileWatcher>()
    let watcher = schemeWatchers.get(watchKey)
    if (!watcher) {
      watcher = {
        disposable: provider.watch(resource, normalizedOptions),
        count: 0,
      }
      schemeWatchers.set(watchKey, watcher)
    }
    watcher.count += 1
    this.activeWatchers.set(resource.scheme, schemeWatchers)
    let disposed = false
    const releaseProviderWatch = () => {
      if (disposed) return
      disposed = true
      const active = this.activeWatchers.get(resource.scheme)?.get(watchKey)
      if (!active || active !== watcher) return
      active.count -= 1
      if (active.count > 0) return
      active.disposable.dispose()
      this.activeWatchers.get(resource.scheme)?.delete(watchKey)
      if (schemeWatchers.size === 0) this.activeWatchers.delete(resource.scheme)
    }

    if (typeof normalizedOptions.correlationId === "number") {
      const fileChangeEmitter = new Emitter<FileChangesEvent>()
      const listener = this.internalOnDidFilesChangeEmitter.event((event) => {
        if (event.correlates(normalizedOptions.correlationId!)) fileChangeEmitter.fire(event)
      })
      return {
        onDidChange: fileChangeEmitter.event,
        dispose: () => {
          listener.dispose()
          fileChangeEmitter.dispose()
          releaseProviderWatch()
        },
      }
    }

    return {
      dispose: () => {
        releaseProviderWatch()
      },
    }
  }

  dispose(): void {
    for (const scheme of Array.from(this.activeWatchers.keys())) {
      this.disposeProviderWatchers(scheme)
    }
    for (const listener of this.providerChangeListeners.values()) listener.dispose()
    this.providerChangeListeners.clear()
    for (const listener of this.providerCapabilityListeners.values()) listener.dispose()
    this.providerCapabilityListeners.clear()
    for (const listener of this.providerWatchErrorListeners.values()) listener.dispose()
    this.providerWatchErrorListeners.clear()
    this.providers.clear()
    this.internalOnDidFilesChangeEmitter.dispose()
    this.onDidFilesChangeEmitter.dispose()
    this.onDidRunOperationEmitter.dispose()
    this.onDidChangeFileSystemProviderRegistrationsEmitter.dispose()
    this.onDidChangeFileSystemProviderCapabilitiesEmitter.dispose()
    this.onWillActivateFileSystemProviderEmitter.dispose()
    this.onDidWatchErrorEmitter.dispose()
    this.onDidFailOperationEmitter.dispose()
  }

  private async providerFor(resource: URI): Promise<IFileSystemProvider> {
    await this.activateProvider(resource.scheme)
    return this.providerForSync(resource)
  }

  private providerForSync(resource: URI): IFileSystemProvider {
    const provider = this.getProvider(resource.scheme)
    if (!provider) throw new Error(`No file system provider registered for scheme: ${resource.scheme}`)
    return provider
  }

  private async doResolve(resource: URI, _options: IResolveFileOptions = {}): Promise<IFileStat> {
    const provider = await this.providerFor(resource)
    const stat = await provider.stat(resource)
    const normalized = statToFileStat(resource, stat)
    if (normalized.isDirectory) {
      const children = await provider.readdir(resource)
      normalized.children = children.map(([name, type]) => statToFileStat(joinResourcePath(resource, name), {
        type,
        size: 0,
        mtime: 0,
        ctime: 0,
      }))
    }
    return normalized
  }

  private restoreResolveError(error: unknown, resource: URI): Error {
    if (toFileSystemProviderErrorCode(error) === FileSystemProviderErrorCode.FileNotFound) {
      return new FileOperationError(`Unable to resolve nonexistent file: ${resource.toString()}`, FileOperationResult.FILE_NOT_FOUND)
    }
    return ensureFileSystemProviderError(error)
  }

  private restoreReadError(error: unknown, resource: URI, options?: IFileReadStreamOptions): FileOperationError {
    if (error instanceof NotModifiedSinceFileOperationError) {
      return new NotModifiedSinceFileOperationError(`Unable to read file: ${resource.toString()} (${error.message})`, error.stat, options)
    }
    if (error instanceof TooLargeFileOperationError) {
      return new TooLargeFileOperationError(`Unable to read file: ${resource.toString()} (${error.message})`, error.fileOperationResult, error.size, options)
    }
    return new FileOperationError(
      `Unable to read file: ${resource.toString()} (${ensureFileSystemProviderError(error).message})`,
      toFileOperationResult(error),
      options,
    )
  }

  private async validateReadFile(resource: URI, options?: IFileReadStreamOptions): Promise<IFileStatWithMetadata> {
    let stat: IFileStatWithMetadata
    try {
      stat = toFileStatWithMetadata(await this.stat(resource))
    } catch (error) {
      if (options?.allowMissingReadMetadata === true && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND) {
        stat = createReadStatWithoutMetadata(resource)
      } else {
        throw error
      }
    }
    if (stat.isDirectory && options?.allowDirectoryRead !== true) {
      throw new FileOperationError(`Unable to read directory as file: ${resource.toString()}`, FileOperationResult.FILE_IS_DIRECTORY, options)
    }
    if (typeof options?.etag === "string" && options.etag !== ETAG_DISABLED && options.etag === stat.etag) {
      throw new NotModifiedSinceFileOperationError("File not modified since", stat, options)
    }
    this.validateReadFileLimits(resource, stat.size, options)
    return stat
  }

  private validateReadFileLimits(resource: URI, size: number, options?: IFileReadStreamOptions): void {
    if (typeof options?.limits?.size === "number" && size > options.limits.size) {
      throw new TooLargeFileOperationError(`File is too large to read: ${resource.toString()}`, FileOperationResult.FILE_TOO_LARGE, size, options)
    }
  }

  private throwIfAborted(signal: AbortSignal | undefined, resource: URI, options?: IFileReadStreamOptions | IFileWriteOptions, operation = "read"): void {
    if (!signal?.aborted) return
    throw new FileOperationError(`Unable to ${operation} file: ${resource.toString()} (${abortErrorMessage(signal, operation)})`, FileOperationResult.FILE_OTHER_ERROR, options)
  }

  private async copyFileWithReadWrite(source: URI, target: URI, overwrite: boolean): Promise<void> {
    const sourceStat = await this.stat(source)
    if (sourceStat.isDirectory) {
      throw createFileSystemProviderError(
        `File system provider does not support folder copy: ${source.scheme}`,
        FileSystemProviderErrorCode.Unavailable,
      )
    }
    if (!overwrite && await this.exists(target)) {
      throw createFileSystemProviderError(`File already exists: ${target.toString()}`, FileSystemProviderErrorCode.FileExists)
    }
    await this.writeFile(target, await this.readFile(source), { create: true, overwrite: true })
  }

  private async readFileWithOpenReadClose(
    provider: IFileSystemProviderWithOpenReadWriteCloseCapability,
    resource: URI,
    stat: IFileStatWithMetadata,
    options: IFileReadStreamOptions,
  ): Promise<Uint8Array> {
    const position = 0
    const length = Math.max(0, stat.size)
    const result = new Uint8Array(length)
    let handle: number | undefined
    try {
      handle = await provider.open(resource, { create: false })
      let offset = 0
      while (offset < length) {
        this.throwIfAborted(options.signal, resource, options)
        const bytesRead = await provider.read(handle, position + offset, result, offset, length - offset)
        if (bytesRead <= 0) break
        offset += bytesRead
      }
      return result.slice(0, offset)
    } finally {
      if (typeof handle === "number") await provider.close(handle)
    }
  }

  private async writeFileWithOpenWriteClose(
    provider: IFileSystemProviderWithOpenReadWriteCloseCapability,
    resource: URI,
    content: Uint8Array,
    options: IFileWriteOptions,
    state: { wrote: boolean },
  ): Promise<void> {
    let position = 0
    if (options.append === true) {
      try {
        position = (await this.stat(resource)).size || 0
      } catch (error) {
        if (toFileOperationResult(error) !== FileOperationResult.FILE_NOT_FOUND) throw error
      }
    } else if (options.overwrite === false && await this.exists(resource)) {
      throw createFileSystemProviderError(`File already exists: ${resource.toString()}`, FileSystemProviderErrorCode.FileExists)
    }

    let handle: number | undefined
    try {
      this.throwIfAborted(options.signal, resource, options, "write")
      handle = await provider.open(resource, { create: options.create !== false, append: options.append === true })
      let offset = 0
      while (offset < content.byteLength) {
        this.throwIfAborted(options.signal, resource, options, "write")
        const written = await provider.write(handle, position + offset, content, offset, content.byteLength - offset)
        state.wrote = true
        this.throwIfAborted(options.signal, resource, options, "write")
        if (written <= 0) {
          throw createFileSystemProviderError(`Unable to write file: ${resource.toString()}`, FileSystemProviderErrorCode.Unavailable)
        }
        offset += written
      }
    } finally {
      if (typeof handle === "number") await provider.close(handle)
    }
  }

  private restoreWriteError(error: unknown, resource: URI, options?: IFileWriteOptions): FileOperationError {
    if (error instanceof FileOperationError) return error
    return new FileOperationError(
      `Unable to write file: ${resource.toString()} (${ensureFileSystemProviderError(error).message})`,
      toFileOperationResult(error),
      options,
    )
  }

  private fireOperationError(
    resource: URI,
    operation: FileOperation,
    error: Error,
    target?: IFileStatWithMetadata,
    rollbackRisk: FileOperationRollbackRisk = "unknown",
  ): void {
    const operationError = annotateFileOperationFailure(error, operation, rollbackRisk)
    this.onDidFailOperationEmitter.fire(new FileOperationErrorEvent(resource, operation, operationError, target, rollbackRisk))
  }

  private throwIfProviderReadonly(provider: IFileSystemProvider, resource: URI): void {
    if ((provider.capabilities & FileSystemProviderCapabilities.Readonly) !== FileSystemProviderCapabilities.Readonly) return
    throw createFileSystemProviderError(`Unable to modify readonly resource: ${resource.toString()}`, FileSystemProviderErrorCode.NoPermissions)
  }

  private hasCapabilityForScheme(scheme: string, capability: FileSystemProviderCapabilities): boolean {
    const provider = this.getProvider(scheme)
    return Boolean(provider && (provider.capabilities & capability) === capability)
  }

  private disposeProviderWatchers(scheme: string): void {
    const watchers = this.activeWatchers.get(scheme)
    if (!watchers) return
    this.activeWatchers.delete(scheme)
    for (const watcher of watchers.values()) watcher.disposable.dispose()
    watchers.clear()
  }
}

export const globalFileService = new FileService()
registerSingleton(IFileService, globalFileService, InstantiationType.Delayed)

export function etag(stat: { mtime: number; size: number }): string
export function etag(stat: { mtime: number | undefined; size: number | undefined }): string | undefined
export function etag(stat: { mtime: number | undefined; size: number | undefined }): string | undefined {
  if (typeof stat.size !== "number" || typeof stat.mtime !== "number") return undefined
  return stat.mtime.toString(29) + stat.size.toString(31)
}

export class ByteSize {
  static readonly KB = 1024
  static readonly MB = ByteSize.KB * ByteSize.KB
  static readonly GB = ByteSize.MB * ByteSize.KB
  static readonly TB = ByteSize.GB * ByteSize.KB

  static formatSize(size: number): string {
    if (!Number.isFinite(size)) size = 0
    if (size < ByteSize.KB) return `${size.toFixed(0)}B`
    if (size < ByteSize.MB) return `${(size / ByteSize.KB).toFixed(2)}KB`
    if (size < ByteSize.GB) return `${(size / ByteSize.MB).toFixed(2)}MB`
    if (size < ByteSize.TB) return `${(size / ByteSize.GB).toFixed(2)}GB`
    return `${(size / ByteSize.TB).toFixed(2)}TB`
  }
}

export function getLargeFileConfirmationLimit(remoteAuthority?: string): number
export function getLargeFileConfirmationLimit(uri?: URI): number
export function getLargeFileConfirmationLimit(arg?: string | URI): number {
  const isRemote = typeof arg === "string" || arg?.scheme === "vscode-remote"
  const isLocal = typeof arg !== "string" && arg?.scheme === "file"
  if (isLocal) return 1024 * ByteSize.MB
  if (isRemote) return 10 * ByteSize.MB
  return 1024 * ByteSize.MB
}

export function normalizeFileStat(raw: unknown, resourceHint?: URI | string): NormalizedFileStat {
  const candidate = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  const resource = normalizeResource(candidate.resource, resourceHint)
  const type = normalizeFileType(candidate)
  const size = Math.max(0, Number(candidate.size || 0))
  const mtime = numberOrUndefined(candidate.mtime)
  const ctime = numberOrUndefined(candidate.ctime)
  const permissions = normalizePermissions(candidate)
  const isFile = hasType(type, FileType.File)
  const isDirectory = hasType(type, FileType.Directory)
  const isSymbolicLink = hasType(type, FileType.SymbolicLink)
  const exists = candidate.exists !== undefined
    ? Boolean(candidate.exists)
    : raw === true || isFile || isDirectory || isSymbolicLink
  const normalizedEtag = typeof candidate.etag === "string" ? candidate.etag : etag({ mtime, size })

  return {
    exists,
    resource,
    name: String(candidate.name || basename(resource.path)),
    type,
    isFile,
    isDirectory,
    isSymbolicLink,
    size,
    mtime,
    ctime,
    etag: normalizedEtag,
    readonly: Boolean(candidate.readonly) || hasPermission(permissions, FilePermission.Readonly),
    locked: Boolean(candidate.locked) || hasPermission(permissions, FilePermission.Locked),
    executable: Boolean(candidate.executable) || hasPermission(permissions, FilePermission.Executable),
    permissions,
    children: Array.isArray(candidate.children)
      ? candidate.children.map((child) => normalizeFileStat(child, resource))
      : undefined,
  }
}

export function isParent(path: string, candidate: string, ignoreCase?: boolean): boolean {
  if (!path || !candidate || path === candidate) return false
  if (candidate.length > path.length) return false
  const separator = /[\\/]/.test(candidate) || /[\\/]/.test(path) ? "/" : "\\"
  const normalizedPath = normalizePathForParent(path, ignoreCase)
  let normalizedCandidate = normalizePathForParent(candidate, ignoreCase)
  if (!normalizedCandidate.endsWith(separator)) normalizedCandidate += separator
  return normalizedPath.startsWith(normalizedCandidate)
}

function normalizeFileType(candidate: Record<string, unknown>): FileType {
  if (typeof candidate.type === "number") return candidate.type as FileType
  let type = FileType.Unknown
  if (candidate.isFile === true) type |= FileType.File
  if (candidate.isDirectory === true || candidate.isDir === true) type |= FileType.Directory
  if (candidate.isSymbolicLink === true || candidate.isSymlink === true) type |= FileType.SymbolicLink
  return type
}

function statToFileStat(resource: URI, stat: IStat): IFileStat {
  const type = stat.type || FileType.Unknown
  return {
    resource,
    name: basename(resource.path),
    type,
    isFile: hasType(type, FileType.File),
    isDirectory: hasType(type, FileType.Directory),
    isSymbolicLink: hasType(type, FileType.SymbolicLink),
    size: stat.size,
    mtime: stat.mtime,
    ctime: stat.ctime,
    readonly: hasProviderReadonly(stat.permissions),
    children: undefined,
  }
}

function toFileStatWithMetadata(stat: IFileStat): IFileStatWithMetadata {
  const size = stat.size || 0
  const mtime = stat.mtime || 0
  const ctime = stat.ctime || 0
  return {
    ...stat,
    size,
    mtime,
    ctime,
    etag: stat.etag || etag({ mtime, size }) || ETAG_DISABLED,
    readonly: Boolean(stat.readonly),
    locked: Boolean(stat.locked),
    executable: Boolean(stat.executable),
    children: stat.children?.map((child) => toFileStatWithMetadata(child)),
  }
}

function createReadStatWithoutMetadata(resource: URI): IFileStatWithMetadata {
  return {
    resource,
    name: basename(resource.path),
    type: FileType.File,
    isFile: true,
    isDirectory: false,
    isSymbolicLink: false,
    size: 0,
    mtime: 0,
    ctime: 0,
    etag: ETAG_DISABLED,
    readonly: false,
    locked: false,
    executable: false,
    children: undefined,
  }
}

class OneShotReadableStream<T> implements IReadableStreamEvents<T> {
  private dataListeners = new Set<(data: T) => unknown>()
  private errorListeners = new Set<(error: Error) => unknown>()
  private endListeners = new Set<() => unknown>()
  private ended = false
  private bufferedData: T[] = []
  private bufferedError: Error | undefined

  onData(listener: (data: T) => unknown): IDisposable {
    this.dataListeners.add(listener)
    for (const data of this.bufferedData) listener(data)
    return { dispose: () => { this.dataListeners.delete(listener) } }
  }

  onError(listener: (error: Error) => unknown): IDisposable {
    this.errorListeners.add(listener)
    if (this.bufferedError) listener(this.bufferedError)
    return { dispose: () => { this.errorListeners.delete(listener) } }
  }

  onEnd(listener: () => unknown): IDisposable {
    this.endListeners.add(listener)
    if (this.ended) listener()
    return { dispose: () => { this.endListeners.delete(listener) } }
  }

  end(data: T): void {
    if (this.ended) return
    this.bufferedData.push(data)
    for (const listener of Array.from(this.dataListeners)) listener(data)
    this.ended = true
    for (const listener of Array.from(this.endListeners)) listener()
  }

  error(error: Error): void {
    if (this.ended) return
    this.bufferedError = error
    this.ended = true
    for (const listener of Array.from(this.errorListeners)) listener(error)
    for (const listener of Array.from(this.endListeners)) listener()
  }
}

function sliceReadBuffer(data: Uint8Array, options: IFileReadStreamOptions): Uint8Array {
  const position = Math.max(0, options.position || 0)
  const length = typeof options.length === "number" && options.length >= 0 ? options.length : undefined
  return length === undefined ? data.slice(position) : data.slice(position, position + length)
}

function mapReadableStreamErrors<T>(
  stream: IReadableStreamEvents<T>,
  mapper: (error: Error) => Error,
  signal?: AbortSignal,
): IReadableStreamEvents<T> {
  return {
    onData(listener: (data: T) => unknown): IDisposable {
      return stream.onData((data) => {
        if (!signal?.aborted) listener(data)
      })
    },
    onError(listener: (error: Error) => unknown): IDisposable {
      const source = stream.onError((error) => listener(mapper(error)))
      const abort = createAbortListener(signal, () => listener(mapper(createAbortError())))
      return {
        dispose: () => {
          source.dispose()
          abort.dispose()
        },
      }
    },
    onEnd(listener: () => unknown): IDisposable {
      return stream.onEnd(() => {
        if (!signal?.aborted) listener()
      })
    },
  }
}

function consumeReadableStream<T extends Uint8Array>(
  stream: IReadableStreamEvents<T>,
  signal: AbortSignal | undefined,
  mapper: (error: Error) => Error,
): Promise<Uint8Array> {
  const chunks: T[] = []
  return new Promise((resolve, reject) => {
    let settled = false
    const disposables: IDisposable[] = []
    const cleanup = () => {
      for (const disposable of disposables.splice(0)) disposable.dispose()
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(mapper(error))
    }
    const abortListener = createAbortListener(signal, () => fail(createAbortError()))
    disposables.push(abortListener)
    disposables.push(stream.onData((chunk) => {
      if (settled) return
      chunks.push(chunk)
    }))
    disposables.push(stream.onError((error) => fail(error)))
    disposables.push(stream.onEnd(() => {
      if (settled) return
      settled = true
      cleanup()
      const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
      const result = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
      }
      resolve(result)
    }))
    if (signal?.aborted) fail(createAbortError())
  })
}

function createAbortListener(signal: AbortSignal | undefined, listener: () => void): IDisposable {
  if (!signal) return { dispose() {} }
  if (signal.aborted) {
    queueMicrotask(listener)
    return { dispose() {} }
  }
  signal.addEventListener("abort", listener, { once: true })
  return {
    dispose: () => {
      signal.removeEventListener("abort", listener)
    },
  }
}

function createReadCancellationOptions<T extends IFileReadStreamOptions>(
  options: T,
  token: CancellationToken | undefined,
): { options: T; dispose(): void } {
  return createOperationCancellationOptions(options, token, "Read aborted")
}

function createOperationCancellationOptions<T extends { readonly signal?: AbortSignal }>(
  options: T,
  token: CancellationToken | undefined,
  message: string,
): { options: T; dispose(): void } {
  if (!token || token === CancellationToken.None) return { options, dispose() {} }
  const controller = new AbortController()
  const originalSignal = options.signal
  const disposables: IDisposable[] = []
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(message)
  }

  if (originalSignal) {
    if (originalSignal.aborted) abort()
    else {
      originalSignal.addEventListener("abort", abort, { once: true })
      disposables.push({
        dispose: () => originalSignal.removeEventListener("abort", abort),
      })
    }
  }
  if (token.isCancellationRequested) abort()
  disposables.push(token.onCancellationRequested(abort))

  return {
    options: { ...options, signal: controller.signal },
    dispose() {
      for (const disposable of disposables.splice(0)) disposable.dispose()
    },
  }
}

function hasOpenReadWriteCloseCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithOpenReadWriteCloseCapability {
  return (
    (provider.capabilities & FileSystemProviderCapabilities.FileOpenReadWriteClose) === FileSystemProviderCapabilities.FileOpenReadWriteClose
    && typeof provider.open === "function"
    && typeof provider.close === "function"
    && typeof provider.read === "function"
    && typeof provider.write === "function"
  )
}

function createAbortError(resource?: URI): Error {
  return new Error(`Read aborted${resource ? `: ${resource.toString()}` : ""}`)
}

function abortErrorMessage(signal: AbortSignal, operation = "read"): string {
  const reason = signal.reason
  if (reason instanceof Error) return reason.message
  if (typeof reason === "string" && reason) return reason
  return operation === "write" ? "Write aborted" : "Read aborted"
}

function isFileSystemProviderErrorCode(value: unknown): value is FileSystemProviderErrorCode {
  return Object.values(FileSystemProviderErrorCode).includes(value as FileSystemProviderErrorCode)
}

function joinResourcePath(parent: URI, name: string): URI {
  const parentPath = parent.path.endsWith("/") ? parent.path : `${parent.path}/`
  return parent.with({ path: `${parentPath}${name}` })
}

function getWatchRequestKey(resource: URI, options: IWatchOptions): string {
  return JSON.stringify([
    resource.toString(),
    Boolean(options.recursive),
    [...(options.excludes || [])].sort(),
    typeof options.correlationId === "number" ? options.correlationId : null,
  ])
}

function hasProviderReadonly(permissions: FilePermission | undefined): boolean {
  return typeof permissions === "number" && (permissions & FilePermission.Readonly) === FilePermission.Readonly
}

function normalizePermissions(candidate: Record<string, unknown>): FilePermission | undefined {
  if (typeof candidate.permissions === "number") return candidate.permissions as FilePermission
  let permissions = 0
  if (candidate.readonly === true) permissions |= FilePermission.Readonly
  if (candidate.locked === true) permissions |= FilePermission.Locked
  if (candidate.executable === true) permissions |= FilePermission.Executable
  return permissions || undefined
}

function hasType(type: FileType, flag: FileType): boolean {
  return (type & flag) === flag
}

function hasPermission(permissions: FilePermission | undefined, flag: FilePermission): boolean {
  return typeof permissions === "number" && (permissions & flag) === flag
}

function normalizeResource(value: unknown, fallback?: URI | string): URI {
  if (URI.isUri(value)) return value
  if (value && typeof value === "object" && typeof (value as { scheme?: unknown }).scheme === "string") {
    return URI.revive(value as { scheme: string; authority?: string; path?: string; query?: string; fragment?: string }) as URI
  }
  const raw = typeof value === "string" ? value : typeof fallback === "string" ? fallback : ""
  if (URI.isUri(fallback)) return fallback
  if (!raw) return URI.from({ scheme: "file", path: "/" })
  if (/^\w[\w\d+.-]*:/.test(raw)) return URI.parse(raw)
  return URI.file(raw)
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function basename(path: string): string {
  return String(path || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || String(path || "")
}

function normalizePathForParent(value: string, ignoreCase?: boolean): string {
  const normalized = String(value || "").replace(/\\/g, "/")
  return ignoreCase ? normalized.toLowerCase() : normalized
}
