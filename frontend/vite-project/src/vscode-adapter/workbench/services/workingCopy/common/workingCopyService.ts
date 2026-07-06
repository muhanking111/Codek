/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/workbench/services/workingCopy/common/workingCopyService.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from "../../../../base/common/event"
import type { IDisposable } from "../../../../base/common/lifecycle"
import { URI } from "../../../../base/common/uri"
import { InstantiationType, registerSingleton } from "../../../../platform/instantiation/common/extensions"
import { createDecorator } from "../../../../platform/instantiation/common/instantiation"
import type {
  IWorkingCopyBackupService,
  ResolvedWorkingCopyBackup,
  WorkingCopyBackupMeta,
} from "./storedFileWorkingCopy"

export interface IWorkingCopyIdentifier {
  readonly resource: URI
  readonly typeId: string
}

export interface IWorkingCopySaveEvent {
  readonly reason?: number
  readonly source?: string
  readonly stat?: unknown
}

export interface IWorkingCopy {
  readonly resource: URI
  readonly typeId: string
  readonly onDidChangeDirty: (listener: () => void) => IDisposable
  readonly onDidChangeContent: (listener: () => void) => IDisposable
  readonly onDidSave: (listener: (event: IWorkingCopySaveEvent) => void) => IDisposable
  readonly onWillDispose?: (listener: () => void) => IDisposable
  isDirty(): boolean
  isModified?(): boolean
}

export interface WorkingCopyBackupCleanupPolicy {
  readonly except?: readonly IWorkingCopyIdentifier[]
  readonly keepDirty?: boolean
  readonly keep?: (identifier: IWorkingCopyIdentifier) => boolean
  readonly uiOwnerConnected?: boolean
  readonly uiOwnerBlockedReason?: string
}

export interface IWorkingCopyServiceSaveEvent extends IWorkingCopySaveEvent {
  readonly workingCopy: IWorkingCopy
}

export interface IWorkingCopyService {
  readonly _serviceBrand: undefined
  readonly workingCopies: readonly IWorkingCopy[]
  readonly dirtyWorkingCopies: readonly IWorkingCopy[]
  readonly dirtyCount: number
  readonly hasDirty: boolean
  readonly modifiedWorkingCopies: readonly IWorkingCopy[]
  readonly modifiedCount: number
  readonly onDidRegister: (listener: (workingCopy: IWorkingCopy) => unknown) => IDisposable
  readonly onDidUnregister: (listener: (workingCopy: IWorkingCopy) => unknown) => IDisposable
  readonly onDidChangeDirty: (listener: (workingCopy: IWorkingCopy) => unknown) => IDisposable
  readonly onDidChangeContent: (listener: (workingCopy: IWorkingCopy) => unknown) => IDisposable
  readonly onDidSave: (listener: (event: IWorkingCopyServiceSaveEvent) => unknown) => IDisposable
  registerWorkingCopy(workingCopy: IWorkingCopy): IDisposable
  get(resource: URI, typeId: string): IWorkingCopy | undefined
  has(resource: URI, typeId?: string): boolean
  isDirty(resource: URI, typeId?: string): boolean
  dispose(): void
}

export const IWorkingCopyService = createDecorator<IWorkingCopyService>("workingCopyService")

export class WorkingCopyService implements IWorkingCopyService {
  declare readonly _serviceBrand: undefined

  private readonly onDidRegisterEmitter = new Emitter<IWorkingCopy>()
  readonly onDidRegister = this.onDidRegisterEmitter.event
  private readonly onDidUnregisterEmitter = new Emitter<IWorkingCopy>()
  readonly onDidUnregister = this.onDidUnregisterEmitter.event
  private readonly onDidChangeDirtyEmitter = new Emitter<IWorkingCopy>()
  readonly onDidChangeDirty = this.onDidChangeDirtyEmitter.event
  private readonly onDidChangeContentEmitter = new Emitter<IWorkingCopy>()
  readonly onDidChangeContent = this.onDidChangeContentEmitter.event
  private readonly onDidSaveEmitter = new Emitter<IWorkingCopyServiceSaveEvent>()
  readonly onDidSave = this.onDidSaveEmitter.event
  private readonly workingCopiesByKey = new Map<string, IWorkingCopy>()
  private readonly listenerDisposables = new Map<IWorkingCopy, IDisposable[]>()

  get workingCopies(): readonly IWorkingCopy[] {
    return Array.from(this.workingCopiesByKey.values())
  }

  get dirtyWorkingCopies(): readonly IWorkingCopy[] {
    return this.workingCopies.filter((workingCopy) => workingCopy.isDirty())
  }

  get dirtyCount(): number {
    return this.dirtyWorkingCopies.length
  }

  get hasDirty(): boolean {
    return this.dirtyCount > 0
  }

  get modifiedWorkingCopies(): readonly IWorkingCopy[] {
    return this.workingCopies.filter((workingCopy) => workingCopy.isModified?.() ?? workingCopy.isDirty())
  }

  get modifiedCount(): number {
    return this.modifiedWorkingCopies.length
  }

  registerWorkingCopy(workingCopy: IWorkingCopy): IDisposable {
    const key = workingCopyKey(workingCopy.resource, workingCopy.typeId)
    if (this.workingCopiesByKey.has(key)) {
      throw new Error(`Cannot register more than one working copy with the same resource ${workingCopy.resource.toString()} and type ${workingCopy.typeId}.`)
    }
    this.workingCopiesByKey.set(key, workingCopy)
    const disposables = [
      workingCopy.onDidChangeDirty(() => this.onDidChangeDirtyEmitter.fire(workingCopy)),
      workingCopy.onDidChangeContent(() => this.onDidChangeContentEmitter.fire(workingCopy)),
      workingCopy.onDidSave((event) => this.onDidSaveEmitter.fire({ workingCopy, ...event })),
    ]
    if (workingCopy.onWillDispose) {
      disposables.push(workingCopy.onWillDispose(() => disposable.dispose()))
    }
    this.listenerDisposables.set(workingCopy, disposables)
    this.onDidRegisterEmitter.fire(workingCopy)
    if (workingCopy.isDirty()) this.onDidChangeDirtyEmitter.fire(workingCopy)
    const disposable = {
      dispose: () => {
        const registered = this.workingCopiesByKey.get(key)
        if (registered !== workingCopy) return
        this.workingCopiesByKey.delete(key)
        for (const disposable of this.listenerDisposables.get(workingCopy) || []) disposable.dispose()
        this.listenerDisposables.delete(workingCopy)
        this.onDidUnregisterEmitter.fire(workingCopy)
      },
    }
    return disposable
  }

  get(resource: URI, typeId: string): IWorkingCopy | undefined {
    return this.workingCopiesByKey.get(workingCopyKey(resource, typeId))
  }

  has(resource: URI, typeId?: string): boolean {
    if (typeId) return this.workingCopiesByKey.has(workingCopyKey(resource, typeId))
    return this.workingCopies.some((workingCopy) => isSameResource(workingCopy.resource, resource))
  }

  isDirty(resource: URI, typeId?: string): boolean {
    return this.workingCopies.some((workingCopy) => (
      isSameResource(workingCopy.resource, resource)
      && (!typeId || workingCopy.typeId === typeId)
      && workingCopy.isDirty()
    ))
  }

  dispose(): void {
    for (const disposables of this.listenerDisposables.values()) {
      for (const disposable of disposables) disposable.dispose()
    }
    this.listenerDisposables.clear()
    this.workingCopiesByKey.clear()
    this.onDidRegisterEmitter.dispose()
    this.onDidUnregisterEmitter.dispose()
    this.onDidChangeDirtyEmitter.dispose()
    this.onDidChangeContentEmitter.dispose()
    this.onDidSaveEmitter.dispose()
  }
}

export interface WorkingCopyHotExitBackupEntry {
  readonly identifier: IWorkingCopyIdentifier
  readonly backup: ResolvedWorkingCopyBackup
}

export type WorkingCopyHotExitActionId = "backup" | "restore" | "discard" | "open-as-conflict" | "open-as-orphan" | "cleanup"

export interface WorkingCopyHotExitActionDescriptor {
  readonly id: WorkingCopyHotExitActionId
  readonly resource: string
  readonly typeId: string
  readonly state?: string
  readonly source?: string
  readonly payloadKeys: readonly string[]
  readonly evidenceSafe: true
}

export interface WorkingCopyHotExitBackupProjection {
  readonly backedUp: readonly URI[]
  readonly actions: readonly WorkingCopyHotExitActionDescriptor[]
}

export interface WorkingCopyHotExitRestoreEntry {
  readonly identifier: IWorkingCopyIdentifier
  readonly state?: string
  readonly source?: string
  readonly mtime?: number
  readonly backupContentHash?: string
  readonly diskContentHash?: string
  readonly actions: readonly WorkingCopyHotExitActionDescriptor[]
}

export interface WorkingCopyHotExitRestoreModel {
  readonly hasBackups: boolean
  readonly count: number
  readonly entries: readonly WorkingCopyHotExitRestoreEntry[]
}

export interface WorkingCopyShutdownVetoProjection {
  readonly reason: string
  readonly veto: boolean
  readonly dirtyCount: number
  readonly pendingBackupCount: number
  readonly force: boolean
  readonly actions: readonly WorkingCopyHotExitActionDescriptor[]
}

export interface WorkingCopyBackupCleanupProjection {
  readonly kept: readonly IWorkingCopyIdentifier[]
  readonly removed: readonly IWorkingCopyIdentifier[]
  readonly actions: readonly WorkingCopyHotExitActionDescriptor[]
  readonly owner: WorkingCopyBackupCleanupOwnerEvidence
  readonly policy: WorkingCopyBackupCleanupPolicyEvidence
  readonly decisions: readonly WorkingCopyBackupCleanupDecision[]
}

export interface WorkingCopyBackupCleanupOwnerEvidence {
  readonly source: "WorkingCopyHotExitTracker.cleanupBackupsWithProjection"
  readonly backupOwner: "IWorkingCopyBackupService"
  readonly dirtySource: "IWorkingCopyService.dirtyWorkingCopies"
  readonly stateSource: "single-working-copy-backup-service"
  readonly status: "connected" | "partial"
  readonly blockedReason?: string
}

export interface WorkingCopyBackupCleanupPolicyEvidence {
  readonly keepDirty: boolean
  readonly exceptCount: number
  readonly hasCustomKeep: boolean
  readonly readonly: true
  readonly safeCleanup: true
}

export interface WorkingCopyBackupCleanupDecision {
  readonly resource: string
  readonly typeId: string
  readonly decision: "keep" | "remove"
  readonly reason: "explicitKeep" | "activeDirtyWorkingCopy" | "customKeepPolicy" | "staleBackup"
  readonly readonly: true
  readonly safeCleanup: true
  readonly blockedReason?: string
}

export type WorkingCopyHotExitContentProvider = (workingCopy: IWorkingCopy) => string | undefined
export type WorkingCopyHotExitMetaProvider = (workingCopy: IWorkingCopy) => WorkingCopyBackupMeta | undefined

export class WorkingCopyHotExitTracker {
  constructor(
    private readonly workingCopyService: WorkingCopyService,
    private readonly backupService: IWorkingCopyBackupService,
  ) {}

  get dirtyWorkingCopies(): readonly IWorkingCopy[] {
    return this.workingCopyService.dirtyWorkingCopies
  }

  async backupDirtyWorkingCopies(
    getContent: WorkingCopyHotExitContentProvider,
    getMeta: WorkingCopyHotExitMetaProvider = () => ({ state: "dirty" }),
    filter: (workingCopy: IWorkingCopy) => boolean = () => true,
  ): Promise<readonly URI[]> {
    const backedUp: URI[] = []
    for (const workingCopy of this.dirtyWorkingCopies) {
      if (!filter(workingCopy)) continue
      const content = getContent(workingCopy)
      if (content === undefined) continue
      await this.backupService.backup(
        toWorkingCopyIdentifier(workingCopy),
        content,
        undefined,
        getMeta(workingCopy),
      )
      backedUp.push(workingCopy.resource)
    }
    return backedUp
  }

  async backupDirtyWorkingCopiesWithProjection(
    getContent: WorkingCopyHotExitContentProvider,
    getMeta: WorkingCopyHotExitMetaProvider = () => ({ state: "dirty" }),
    filter: (workingCopy: IWorkingCopy) => boolean = () => true,
  ): Promise<WorkingCopyHotExitBackupProjection> {
    const backedUp: URI[] = []
    const actions: WorkingCopyHotExitActionDescriptor[] = []
    for (const workingCopy of this.dirtyWorkingCopies) {
      if (!filter(workingCopy)) continue
      const content = getContent(workingCopy)
      if (content === undefined) continue
      const meta = getMeta(workingCopy)
      await this.backupService.backup(
        toWorkingCopyIdentifier(workingCopy),
        content,
        undefined,
        meta,
      )
      backedUp.push(workingCopy.resource)
      actions.push(createHotExitActionDescriptor("backup", toWorkingCopyIdentifier(workingCopy), meta))
    }
    return { backedUp, actions }
  }

  async resolveBackups(): Promise<readonly WorkingCopyHotExitBackupEntry[]> {
    const entries: WorkingCopyHotExitBackupEntry[] = []
    for (const identifier of await this.backupService.getBackups()) {
      const backup = await this.backupService.resolve(identifier)
      if (!backup) continue
      entries.push({ identifier, backup })
    }
    return entries
  }

  async createRestoreModel(): Promise<WorkingCopyHotExitRestoreModel> {
    const entries: WorkingCopyHotExitRestoreEntry[] = []
    for (const { identifier, backup } of await this.resolveBackups()) {
      const meta = backup.meta
      entries.push({
        identifier,
        state: readStringMeta(meta, "state"),
        source: readStringMeta(meta, "source"),
        mtime: readNumberMeta(meta, "mtime"),
        backupContentHash: readStringMeta(meta, "backupContentHash"),
        diskContentHash: readStringMeta(meta, "diskContentHash"),
        actions: [
          createHotExitActionDescriptor("restore", identifier, meta),
          createHotExitActionDescriptor("discard", identifier, meta),
          createHotExitActionDescriptor("open-as-conflict", identifier, meta),
          createHotExitActionDescriptor("open-as-orphan", identifier, meta),
        ],
      })
    }
    return {
      hasBackups: entries.length > 0,
      count: entries.length,
      entries,
    }
  }

  async createShutdownVetoProjection(
    reason: string,
    options: { readonly force?: boolean } = {},
  ): Promise<WorkingCopyShutdownVetoProjection> {
    const pendingBackups = await this.resolveBackups()
    const dirtyCount = this.dirtyWorkingCopies.length
    return {
      reason,
      veto: !options.force && dirtyCount > 0,
      dirtyCount,
      pendingBackupCount: pendingBackups.length,
      force: options.force === true,
      actions: pendingBackups.map(({ identifier, backup }) => createHotExitActionDescriptor("backup", identifier, backup.meta)),
    }
  }

  async discardBackup(identifier: IWorkingCopyIdentifier): Promise<void> {
    await this.backupService.discardBackup(identifier)
  }

  async discardBackups(filter?: { readonly except: readonly IWorkingCopyIdentifier[] }): Promise<void> {
    await this.backupService.discardBackups(filter)
  }

  async cleanupBackups(policy: WorkingCopyBackupCleanupPolicy = {}): Promise<readonly IWorkingCopyIdentifier[]> {
    const result = await this.cleanupBackupsWithProjection(policy)
    return result.removed
  }

  async cleanupBackupsWithProjection(policy: WorkingCopyBackupCleanupPolicy = {}): Promise<WorkingCopyBackupCleanupProjection> {
    const backups = await this.backupService.getBackups()
    const explicitKeep = new Set((policy.except || []).map((identifier) => workingCopyKey(identifier.resource, identifier.typeId)))
    const dirtyKeep = policy.keepDirty === false
      ? new Set<string>()
      : new Set(this.dirtyWorkingCopies.map((workingCopy) => workingCopyKey(workingCopy.resource, workingCopy.typeId)))
    const kept: IWorkingCopyIdentifier[] = []
    const removed: IWorkingCopyIdentifier[] = []
    const actions: WorkingCopyHotExitActionDescriptor[] = []
    const decisions: WorkingCopyBackupCleanupDecision[] = []
    const blockedReason = policy.uiOwnerConnected === false
      ? policy.uiOwnerBlockedReason || "Working copy backup cleanup UI owner is not connected in this service projection."
      : undefined
    for (const identifier of backups) {
      const key = workingCopyKey(identifier.resource, identifier.typeId)
      const keepReason = explicitKeep.has(key)
        ? "explicitKeep"
        : dirtyKeep.has(key)
          ? "activeDirtyWorkingCopy"
          : policy.keep?.(identifier)
            ? "customKeepPolicy"
            : undefined
      if (keepReason) {
        kept.push(identifier)
        decisions.push(createBackupCleanupDecision(identifier, "keep", keepReason, blockedReason))
      } else {
        removed.push(identifier)
        const backup = await this.backupService.resolve(identifier)
        actions.push(createHotExitActionDescriptor("cleanup", identifier, backup?.meta))
        decisions.push(createBackupCleanupDecision(identifier, "remove", "staleBackup", blockedReason))
      }
    }
    await this.backupService.discardBackups({ except: kept })
    return {
      kept,
      removed,
      actions,
      owner: {
        source: "WorkingCopyHotExitTracker.cleanupBackupsWithProjection",
        backupOwner: "IWorkingCopyBackupService",
        dirtySource: "IWorkingCopyService.dirtyWorkingCopies",
        stateSource: "single-working-copy-backup-service",
        status: blockedReason ? "partial" : "connected",
        ...(blockedReason ? { blockedReason } : {}),
      },
      policy: {
        keepDirty: policy.keepDirty !== false,
        exceptCount: policy.except?.length || 0,
        hasCustomKeep: typeof policy.keep === "function",
        readonly: true,
        safeCleanup: true,
      },
      decisions,
    }
  }
}

export function workingCopyKey(resource: URI, typeId: string): string {
  return `${typeId}:${resource.toString()}`
}

export const globalWorkingCopyService = new WorkingCopyService()
registerSingleton(IWorkingCopyService, globalWorkingCopyService, InstantiationType.Delayed)

function toWorkingCopyIdentifier(workingCopy: IWorkingCopy): IWorkingCopyIdentifier {
  return {
    resource: workingCopy.resource,
    typeId: workingCopy.typeId,
  }
}

function createHotExitActionDescriptor(
  id: WorkingCopyHotExitActionId,
  identifier: IWorkingCopyIdentifier,
  meta: WorkingCopyBackupMeta | undefined,
): WorkingCopyHotExitActionDescriptor {
  return {
    id,
    resource: identifier.resource.toString(),
    typeId: identifier.typeId,
    state: readStringMeta(meta, "state"),
    source: readStringMeta(meta, "source"),
    payloadKeys: Object.keys(meta || {}).sort(),
    evidenceSafe: true,
  }
}

function createBackupCleanupDecision(
  identifier: IWorkingCopyIdentifier,
  decision: WorkingCopyBackupCleanupDecision["decision"],
  reason: WorkingCopyBackupCleanupDecision["reason"],
  blockedReason: string | undefined,
): WorkingCopyBackupCleanupDecision {
  return {
    resource: identifier.resource.toString(),
    typeId: identifier.typeId,
    decision,
    reason,
    readonly: true,
    safeCleanup: true,
    blockedReason,
  }
}

function readStringMeta(meta: WorkingCopyBackupMeta | undefined, key: string): string | undefined {
  const value = readMetaValue(meta, key)
  return typeof value === "string" ? value : undefined
}

function readNumberMeta(meta: WorkingCopyBackupMeta | undefined, key: string): number | undefined {
  const value = readMetaValue(meta, key)
  return typeof value === "number" ? value : undefined
}

function readMetaValue(meta: WorkingCopyBackupMeta | undefined, key: string): unknown {
  return meta && Object.prototype.hasOwnProperty.call(meta, key) ? (meta as Record<string, unknown>)[key] : undefined
}

function isSameResource(left: URI, right: URI): boolean {
  return left.toString().toLowerCase() === right.toString().toLowerCase()
}
