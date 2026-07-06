/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/workbench/services/workingCopy/common/workingCopyFileService.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from "../../../../base/common/event"
import type { IDisposable } from "../../../../base/common/lifecycle"
import { URI } from "../../../../base/common/uri"
import { FileOperation } from "../../../../platform/files/common/files"
import { InstantiationType, registerSingleton } from "../../../../platform/instantiation/common/extensions"
import { createDecorator } from "../../../../platform/instantiation/common/instantiation"
import type { SaveReason } from "../../textfile/common/textfiles"
import type { StoredFileWorkingCopy } from "./storedFileWorkingCopy"

export interface SourceTargetPair {
  readonly source?: URI
  readonly target: URI
}

export interface IFileOperationUndoRedoInfo {
  readonly undoRedoGroupId?: number
  readonly isUndoing?: boolean
}

export interface WorkingCopyFileEvent {
  readonly correlationId: number
  readonly operation: FileOperation
  readonly files: readonly SourceTargetPair[]
  waitUntil(promise: Promise<unknown>): void
}

export interface IWorkingCopyFileOperationParticipant {
  participate(
    files: readonly SourceTargetPair[],
    operation: FileOperation,
    undoInfo?: IFileOperationUndoRedoInfo,
  ): Promise<void> | void
}

export interface IStoredFileWorkingCopySaveParticipantContext {
  readonly reason: SaveReason
  readonly source?: string
  readonly savedFrom?: URI
}

export interface IStoredFileWorkingCopySaveParticipantProgress {
  report(step: { readonly message?: string }): void
}

export interface IStoredFileWorkingCopySaveParticipantToken {
  readonly isCancellationRequested: boolean
}

export interface IStoredFileWorkingCopySaveParticipant {
  readonly ordinal?: number
  participate(
    workingCopy: StoredFileWorkingCopy,
    context: IStoredFileWorkingCopySaveParticipantContext,
    progress: IStoredFileWorkingCopySaveParticipantProgress,
    token: IStoredFileWorkingCopySaveParticipantToken,
  ): Promise<void> | void
}

export type StoredFileWorkingCopySaveParticipantStepStatus = "ran" | "skipped" | "failed"

export interface StoredFileWorkingCopySaveParticipantStep {
  readonly ordinal: number
  readonly index: number
  readonly status: StoredFileWorkingCopySaveParticipantStepStatus
  readonly error?: string
}

export interface StoredFileWorkingCopySaveParticipantRunResult {
  readonly resource: URI
  readonly reason: SaveReason
  readonly source?: string
  readonly participantCount: number
  readonly steps: readonly StoredFileWorkingCopySaveParticipantStep[]
  readonly failed: boolean
  readonly cancelled: boolean
  readonly error?: string
}

export interface IWorkingCopy {
  readonly resource: URI
  isDirty(): boolean
  revert(options?: { readonly soft?: boolean }): Promise<void> | void
}

export type WorkingCopyProvider = (resourceOrFolder: URI) => readonly IWorkingCopy[]

export interface WorkingCopyFileOperationOptions<T> {
  readonly operation: FileOperation
  readonly files: readonly SourceTargetPair[]
  readonly execute: () => Promise<T> | T
  readonly undoInfo?: IFileOperationUndoRedoInfo
}

export interface IWorkingCopyFileService {
  readonly _serviceBrand: undefined
  readonly onWillRunWorkingCopyFileOperation: (listener: (event: WorkingCopyFileEvent) => unknown) => IDisposable
  readonly onDidFailWorkingCopyFileOperation: (listener: (event: WorkingCopyFileEvent) => unknown) => IDisposable
  readonly onDidRunWorkingCopyFileOperation: (listener: (event: WorkingCopyFileEvent) => unknown) => IDisposable
  readonly hasSaveParticipants: boolean
  getLastSaveParticipantResult(resource?: URI): StoredFileWorkingCopySaveParticipantRunResult | null
  addFileOperationParticipant(participant: IWorkingCopyFileOperationParticipant): IDisposable
  addSaveParticipant(participant: IStoredFileWorkingCopySaveParticipant): IDisposable
  runSaveParticipants(
    workingCopy: StoredFileWorkingCopy,
    context: IStoredFileWorkingCopySaveParticipantContext,
    progress?: IStoredFileWorkingCopySaveParticipantProgress,
    token?: IStoredFileWorkingCopySaveParticipantToken,
  ): Promise<void>
  registerWorkingCopyProvider(provider: WorkingCopyProvider): IDisposable
  getDirty(resource: URI): readonly IWorkingCopy[]
  create<T>(files: readonly SourceTargetPair[], execute: () => Promise<T> | T, undoInfo?: IFileOperationUndoRedoInfo): Promise<T>
  delete<T>(files: readonly SourceTargetPair[], execute: () => Promise<T> | T, undoInfo?: IFileOperationUndoRedoInfo): Promise<T>
  move<T>(files: readonly SourceTargetPair[], execute: () => Promise<T> | T, undoInfo?: IFileOperationUndoRedoInfo): Promise<T>
  copy<T>(files: readonly SourceTargetPair[], execute: () => Promise<T> | T, undoInfo?: IFileOperationUndoRedoInfo): Promise<T>
  run<T>(options: WorkingCopyFileOperationOptions<T>): Promise<T>
  dispose(): void
}

export const IWorkingCopyFileService = createDecorator<IWorkingCopyFileService>("workingCopyFileService")

export class WorkingCopyFileService implements IWorkingCopyFileService {
  declare readonly _serviceBrand: undefined

  private readonly onWillRunWorkingCopyFileOperationEmitter = new Emitter<WorkingCopyFileEvent>()
  readonly onWillRunWorkingCopyFileOperation = this.onWillRunWorkingCopyFileOperationEmitter.event
  private readonly onDidFailWorkingCopyFileOperationEmitter = new Emitter<WorkingCopyFileEvent>()
  readonly onDidFailWorkingCopyFileOperation = this.onDidFailWorkingCopyFileOperationEmitter.event
  private readonly onDidRunWorkingCopyFileOperationEmitter = new Emitter<WorkingCopyFileEvent>()
  readonly onDidRunWorkingCopyFileOperation = this.onDidRunWorkingCopyFileOperationEmitter.event
  private readonly participants = new Set<IWorkingCopyFileOperationParticipant>()
  private readonly saveParticipants = new Set<IStoredFileWorkingCopySaveParticipant>()
  private readonly workingCopyProviders = new Set<WorkingCopyProvider>()
  private lastSaveParticipantResult: StoredFileWorkingCopySaveParticipantRunResult | null = null
  private correlationIds = 0

  addFileOperationParticipant(participant: IWorkingCopyFileOperationParticipant): IDisposable {
    this.participants.add(participant)
    return { dispose: () => this.participants.delete(participant) }
  }

  addSaveParticipant(participant: IStoredFileWorkingCopySaveParticipant): IDisposable {
    this.saveParticipants.add(participant)
    return { dispose: () => this.saveParticipants.delete(participant) }
  }

  get hasSaveParticipants(): boolean {
    return this.saveParticipants.size > 0
  }

  getLastSaveParticipantResult(resource?: URI): StoredFileWorkingCopySaveParticipantRunResult | null {
    if (!resource) return this.lastSaveParticipantResult
    return this.lastSaveParticipantResult?.resource.toString() === resource.toString()
      ? this.lastSaveParticipantResult
      : null
  }

  async runSaveParticipants(
    workingCopy: StoredFileWorkingCopy,
    context: IStoredFileWorkingCopySaveParticipantContext,
    progress: IStoredFileWorkingCopySaveParticipantProgress = { report: () => undefined },
    token: IStoredFileWorkingCopySaveParticipantToken = { isCancellationRequested: false },
  ): Promise<void> {
    if (this.saveParticipants.size === 0) {
      this.lastSaveParticipantResult = {
        resource: workingCopy.resource,
        reason: context.reason,
        source: context.source,
        participantCount: 0,
        steps: [],
        failed: false,
        cancelled: Boolean(token.isCancellationRequested),
      }
      return
    }
    workingCopy.model?.pushStackElement()
    progress.report({ message: "Running Code Actions and Formatters..." })
    const participants = Array.from(this.saveParticipants).sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
    const steps: StoredFileWorkingCopySaveParticipantStep[] = []
    let failed = false
    let errorMessage: string | undefined
    try {
      for (const [index, participant] of participants.entries()) {
        const ordinal = participant.ordinal ?? 0
        if (token.isCancellationRequested) {
          steps.push({ ordinal, index, status: "skipped" })
          continue
        }
        try {
          await participant.participate(workingCopy, context, progress, token)
          steps.push({ ordinal, index, status: "ran" })
        } catch (error) {
          failed = true
          errorMessage = errorToMessage(error)
          steps.push({ ordinal, index, status: "failed", error: errorMessage })
          this.lastSaveParticipantResult = {
            resource: workingCopy.resource,
            reason: context.reason,
            source: context.source,
            participantCount: participants.length,
            steps,
            failed,
            cancelled: Boolean(token.isCancellationRequested),
            error: errorMessage,
          }
          throw error
        }
      }
    } finally {
      workingCopy.model?.pushStackElement()
      if (!failed) {
        this.lastSaveParticipantResult = {
          resource: workingCopy.resource,
          reason: context.reason,
          source: context.source,
          participantCount: participants.length,
          steps,
          failed: false,
          cancelled: Boolean(token.isCancellationRequested),
        }
      }
    }
  }

  registerWorkingCopyProvider(provider: WorkingCopyProvider): IDisposable {
    this.workingCopyProviders.add(provider)
    return { dispose: () => this.workingCopyProviders.delete(provider) }
  }

  getDirty(resource: URI): readonly IWorkingCopy[] {
    const dirty = new Map<string, IWorkingCopy>()
    for (const provider of this.workingCopyProviders) {
      for (const workingCopy of provider(resource)) {
        if (workingCopy.isDirty()) dirty.set(workingCopy.resource.toString(), workingCopy)
      }
    }
    return Array.from(dirty.values())
  }

  create<T>(files: readonly SourceTargetPair[], execute: () => Promise<T> | T, undoInfo?: IFileOperationUndoRedoInfo): Promise<T> {
    return this.run({ operation: FileOperation.CREATE, files, execute, undoInfo })
  }

  delete<T>(files: readonly SourceTargetPair[], execute: () => Promise<T> | T, undoInfo?: IFileOperationUndoRedoInfo): Promise<T> {
    return this.run({ operation: FileOperation.DELETE, files, execute, undoInfo })
  }

  move<T>(files: readonly SourceTargetPair[], execute: () => Promise<T> | T, undoInfo?: IFileOperationUndoRedoInfo): Promise<T> {
    return this.run({ operation: FileOperation.MOVE, files, execute, undoInfo })
  }

  copy<T>(files: readonly SourceTargetPair[], execute: () => Promise<T> | T, undoInfo?: IFileOperationUndoRedoInfo): Promise<T> {
    return this.run({ operation: FileOperation.COPY, files, execute, undoInfo })
  }

  async run<T>(options: WorkingCopyFileOperationOptions<T>): Promise<T> {
    const event = createWorkingCopyFileEvent(this.correlationIds++, options.operation, options.files)
    await this.runParticipants(options.files, options.operation, options.undoInfo)
    await this.fireAndWait(this.onWillRunWorkingCopyFileOperationEmitter, event)
    try {
      await this.revertDirtyWorkingCopies(options.operation, options.files)
      const result = await options.execute()
      await this.fireAndWait(this.onDidRunWorkingCopyFileOperationEmitter, event)
      return result
    } catch (error) {
      await this.fireAndWait(this.onDidFailWorkingCopyFileOperationEmitter, event)
      throw error
    }
  }

  dispose(): void {
    this.participants.clear()
    this.saveParticipants.clear()
    this.workingCopyProviders.clear()
    this.onWillRunWorkingCopyFileOperationEmitter.dispose()
    this.onDidFailWorkingCopyFileOperationEmitter.dispose()
    this.onDidRunWorkingCopyFileOperationEmitter.dispose()
  }

  private async runParticipants(
    files: readonly SourceTargetPair[],
    operation: FileOperation,
    undoInfo?: IFileOperationUndoRedoInfo,
  ): Promise<void> {
    for (const participant of Array.from(this.participants)) {
      await participant.participate(files, operation, undoInfo)
    }
  }

  private async revertDirtyWorkingCopies(operation: FileOperation, files: readonly SourceTargetPair[]): Promise<void> {
    if (operation === FileOperation.CREATE) return
    const dirty = new Map<string, IWorkingCopy>()
    for (const file of files) {
      for (const workingCopy of this.getWorkingCopiesToRevert(operation, file)) {
        dirty.set(workingCopy.resource.toString(), workingCopy)
      }
    }
    await Promise.all(Array.from(dirty.values(), (workingCopy) => workingCopy.revert({ soft: true })))
  }

  private getWorkingCopiesToRevert(operation: FileOperation, file: SourceTargetPair): readonly IWorkingCopy[] {
    if (operation === FileOperation.DELETE) return this.getDirty(file.target)
    if (operation === FileOperation.COPY) return this.getDirty(file.target)
    if (operation === FileOperation.MOVE) {
      return [
        ...(file.source ? this.getDirty(file.source) : []),
        ...this.getDirty(file.target),
      ]
    }
    return []
  }

  private async fireAndWait(emitter: Emitter<WorkingCopyFileEvent>, event: WorkingCopyFileEvent): Promise<void> {
    const waitUntil = getWaitUntil(event)
    emitter.fire(event)
    await waitUntil()
  }
}

function createWorkingCopyFileEvent(correlationId: number, operation: FileOperation, files: readonly SourceTargetPair[]): WorkingCopyFileEvent {
  const waits: Promise<unknown>[] = []
  return {
    correlationId,
    operation,
    files,
    waitUntil(promise) {
      waits.push(Promise.resolve(promise))
    },
    async __waitUntil() {
      await Promise.all(waits)
    },
  } as WorkingCopyFileEvent & { __waitUntil(): Promise<void> }
}

function getWaitUntil(event: WorkingCopyFileEvent): () => Promise<void> {
  return (event as WorkingCopyFileEvent & { __waitUntil?: () => Promise<void> }).__waitUntil ?? (() => Promise.resolve())
}

export function createWorkingCopyProviderFromResources(resources: readonly IWorkingCopy[]): WorkingCopyProvider {
  return (resourceOrFolder) => resources.filter((workingCopy) => isEqualOrParent(workingCopy.resource, resourceOrFolder))
}

export function isEqualOrParent(resource: URI, candidateParent: URI): boolean {
  if (resource.scheme !== candidateParent.scheme || resource.authority !== candidateParent.authority) return false
  const resourcePath = normalizeResourcePath(resource)
  const parentPath = normalizeResourcePath(candidateParent)
  return resourcePath === parentPath || resourcePath.startsWith(`${parentPath.replace(/\/+$/, "")}/`)
}

export const globalWorkingCopyFileService = new WorkingCopyFileService()
registerSingleton(IWorkingCopyFileService, globalWorkingCopyFileService, InstantiationType.Delayed)

function normalizeResourcePath(resource: URI): string {
  return (resource.path || resource.fsPath || "").replace(/\\/g, "/").toLowerCase()
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
