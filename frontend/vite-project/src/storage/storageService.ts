// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\platform\storage\common\storage.ts
// - D:\SourceMirror\vscode\src\vs\platform\storage\common\storageService.ts
// - D:\SourceMirror\vscode\src\vs\workbench\services\userDataProfile\browser\userDataProfileStorageService.ts
//
// Codek keeps this as an in-memory service contract for now. Memento and State
// use this same service so storage-scoped lifecycle does not split into a
// second source of truth.

import { Emitter, type Event } from "../vscode-adapter/base/common/event"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"

export const ICodekStorageService = createDecorator<ICodekStorageService>("codekStorageService")

export const enum StorageScope {
  APPLICATION_SHARED = -2,
  APPLICATION = -1,
  PROFILE = 0,
  WORKSPACE = 1,
}

export const enum StorageTarget {
  USER = 0,
  MACHINE = 1,
}

export const enum WillSaveStateReason {
  NONE = 0,
  SHUTDOWN = 1,
}

export type StorageValue = string | boolean | number | object | undefined | null

export interface StorageEntry {
  readonly key: string
  readonly value: StorageValue
  readonly scope: StorageScope
  readonly target: StorageTarget
}

export interface StorageValueChangeEvent {
  readonly scope: StorageScope
  readonly key: string
  readonly target: StorageTarget | undefined
  readonly external?: boolean
}

export interface StorageTargetChangeEvent {
  readonly scope: StorageScope
}

export interface WillSaveStateEvent {
  readonly reason: WillSaveStateReason
}

export interface StorageBackupEvent {
  readonly reason: string
  readonly snapshot: StorageSnapshot
}

export interface StorageMigrationEvent {
  readonly source: string
  readonly entryCount: number
}

export interface StorageMigrationRequest {
  readonly source: string
  readonly entries: readonly StorageEntry[]
}

export interface StorageBucketSnapshot {
  readonly id: string
  readonly entries: readonly SerializedStorageEntry[]
}

export interface SerializedStorageEntry {
  readonly key: string
  readonly value: string
  readonly target: StorageTarget
}

export interface StorageSnapshot {
  readonly workspaceId: string
  readonly profileId: string
  readonly scopes: {
    readonly applicationShared: StorageBucketSnapshot
    readonly application: StorageBucketSnapshot
    readonly profile: StorageBucketSnapshot
    readonly workspace: StorageBucketSnapshot
  }
}

export interface CodekStorageServiceOptions {
  readonly workspaceId?: string
  readonly profileId?: string
}

export interface RemainingProfileUiOwnerGap {
  readonly connected: false
  readonly owner: "workbench.profile.ui"
  readonly reason: string
}

export interface CodekStorageScopeOwnerEvidence {
  readonly applicationShared: "CodekStorageService.applicationSharedBucket"
  readonly application: "CodekStorageService.applicationBucket"
  readonly profile: "CodekStorageService.profileBucket"
  readonly workspace: "CodekStorageService.workspaceBucket"
}

export interface CodekStorageOwnerEvidence {
  readonly storageServiceOwner: "CodekStorageService"
  readonly profileStorageOwner: "CodekStorageService.profileBucket"
  readonly scopeOwner: CodekStorageScopeOwnerEvidence
  readonly persistenceSource: "CodekStorageService.inMemoryBuckets"
  readonly mainThreadBridgeOwner: "desktop/services/extensions-host/mainThread/mainThreadStorage.js"
  readonly workspaceId: string
  readonly profileId: string
  readonly secondStateSourceCreated: false
  readonly remainingProfileUiOwnerGap: RemainingProfileUiOwnerGap
}

export interface ICodekStorageService {
  readonly _serviceBrand: undefined
  readonly onDidChangeTarget: Event<StorageTargetChangeEvent>
  readonly onWillSaveState: Event<WillSaveStateEvent>
  readonly onDidBackup: Event<StorageBackupEvent>
  readonly onDidMigrate: Event<StorageMigrationEvent>

  onDidChangeValue(scope: StorageScope, key?: string): Event<StorageValueChangeEvent>
  get(key: string, scope: StorageScope, fallbackValue: string): string
  get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined
  getBoolean(key: string, scope: StorageScope, fallbackValue: boolean): boolean
  getBoolean(key: string, scope: StorageScope, fallbackValue?: boolean): boolean | undefined
  getNumber(key: string, scope: StorageScope, fallbackValue: number): number
  getNumber(key: string, scope: StorageScope, fallbackValue?: number): number | undefined
  getObject<T extends object>(key: string, scope: StorageScope, fallbackValue: T): T
  getObject<T extends object>(key: string, scope: StorageScope, fallbackValue?: T): T | undefined
  store(key: string, value: StorageValue, scope: StorageScope, target: StorageTarget): void
  storeAll(entries: readonly StorageEntry[], external?: boolean): void
  remove(key: string, scope: StorageScope): void
  keys(scope: StorageScope, target: StorageTarget): string[]
  hasScope(scope: { id: string; isDefault?: boolean } | string): boolean
  switchProfile(profileId: string, preserveData?: boolean): Promise<void>
  switchWorkspace(workspaceId: string, preserveData?: boolean): Promise<void>
  flush(reason?: WillSaveStateReason): Promise<void>
  backup(reason: string): Promise<StorageSnapshot>
  migrate(request: StorageMigrationRequest): void
  getOwnerEvidence(): CodekStorageOwnerEvidence
}

interface StorageBucket {
  readonly id: string
  readonly values: Map<string, string>
  readonly targets: Map<string, StorageTarget>
}

interface WorkspaceBuckets {
  readonly applicationShared: StorageBucket
  readonly application: StorageBucket
  readonly profiles: Map<string, StorageBucket>
  readonly workspaces: Map<string, StorageBucket>
}

export class CodekStorageService implements ICodekStorageService {
  declare readonly _serviceBrand: undefined

  private readonly buckets: WorkspaceBuckets
  private workspaceId: string
  private profileId: string

  private readonly didChangeValueEmitter = new Emitter<StorageValueChangeEvent>()
  private readonly didChangeTargetEmitter = new Emitter<StorageTargetChangeEvent>()
  private readonly willSaveStateEmitter = new Emitter<WillSaveStateEvent>()
  private readonly didBackupEmitter = new Emitter<StorageBackupEvent>()
  private readonly didMigrateEmitter = new Emitter<StorageMigrationEvent>()

  readonly onDidChangeTarget = this.didChangeTargetEmitter.event
  readonly onWillSaveState = this.willSaveStateEmitter.event
  readonly onDidBackup = this.didBackupEmitter.event
  readonly onDidMigrate = this.didMigrateEmitter.event

  constructor(options: CodekStorageServiceOptions = {}) {
    this.workspaceId = options.workspaceId ?? "default-workspace"
    this.profileId = options.profileId ?? "default-profile"
    this.buckets = {
      applicationShared: createBucket("application-shared"),
      application: createBucket("application"),
      profiles: new Map([[this.profileId, createBucket(this.profileId)]]),
      workspaces: new Map([[this.workspaceId, createBucket(this.workspaceId)]]),
    }
  }

  onDidChangeValue(scope: StorageScope, key?: string): Event<StorageValueChangeEvent> {
    return (listener, thisArgs, disposables) => this.didChangeValueEmitter.event((event) => {
      if (event.scope === scope && (key === undefined || event.key === key)) {
        listener.call(thisArgs, event)
      }
    }, undefined, disposables)
  }

  get(key: string, scope: StorageScope, fallbackValue: string): string
  get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined
  get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined {
    return this.getBucket(scope).values.get(key) ?? fallbackValue
  }

  getBoolean(key: string, scope: StorageScope, fallbackValue: boolean): boolean
  getBoolean(key: string, scope: StorageScope, fallbackValue?: boolean): boolean | undefined
  getBoolean(key: string, scope: StorageScope, fallbackValue?: boolean): boolean | undefined {
    const value = this.get(key, scope)
    if (value === undefined) return fallbackValue
    return value === "true"
  }

  getNumber(key: string, scope: StorageScope, fallbackValue: number): number
  getNumber(key: string, scope: StorageScope, fallbackValue?: number): number | undefined
  getNumber(key: string, scope: StorageScope, fallbackValue?: number): number | undefined {
    const value = this.get(key, scope)
    if (value === undefined) return fallbackValue
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallbackValue
  }

  getObject<T extends object>(key: string, scope: StorageScope, fallbackValue: T): T
  getObject<T extends object>(key: string, scope: StorageScope, fallbackValue?: T): T | undefined
  getObject<T extends object>(key: string, scope: StorageScope, fallbackValue?: T): T | undefined {
    const value = this.get(key, scope)
    if (value === undefined) return fallbackValue
    try {
      return JSON.parse(value) as T
    } catch {
      return fallbackValue
    }
  }

  store(key: string, value: StorageValue, scope: StorageScope, target: StorageTarget): void {
    this.doStore(key, value, scope, target, false)
  }

  storeAll(entries: readonly StorageEntry[], external = false): void {
    for (const entry of entries) {
      this.doStore(entry.key, entry.value, entry.scope, entry.target, external)
    }
  }

  remove(key: string, scope: StorageScope): void {
    this.doRemove(key, scope, false)
  }

  keys(scope: StorageScope, target: StorageTarget): string[] {
    const bucket = this.getBucket(scope)
    return Array.from(bucket.targets.entries())
      .filter(([, storedTarget]) => storedTarget === target)
      .map(([key]) => key)
      .sort()
  }

  hasScope(scope: { id: string; isDefault?: boolean } | string): boolean {
    const id = typeof scope === "string" ? scope : scope.id
    return id === this.workspaceId || id === this.profileId
  }

  async switchProfile(profileId: string, preserveData = false): Promise<void> {
    if (profileId === this.profileId) return
    const oldBucket = this.getBucket(StorageScope.PROFILE)
    const newBucket = this.ensureProfileBucket(profileId)
    if (preserveData) copyBucket(oldBucket, newBucket)
    this.profileId = profileId
    this.emitSwitchChanges(StorageScope.PROFILE, oldBucket, newBucket)
  }

  async switchWorkspace(workspaceId: string, preserveData = false): Promise<void> {
    if (workspaceId === this.workspaceId) return
    const oldBucket = this.getBucket(StorageScope.WORKSPACE)
    const newBucket = this.ensureWorkspaceBucket(workspaceId)
    if (preserveData) copyBucket(oldBucket, newBucket)
    this.workspaceId = workspaceId
    this.emitSwitchChanges(StorageScope.WORKSPACE, oldBucket, newBucket)
  }

  async flush(reason = WillSaveStateReason.NONE): Promise<void> {
    this.willSaveStateEmitter.fire({ reason })
  }

  async backup(reason: string): Promise<StorageSnapshot> {
    await this.flush(WillSaveStateReason.NONE)
    const snapshot = this.createSnapshot()
    this.didBackupEmitter.fire({ reason, snapshot })
    return snapshot
  }

  migrate(request: StorageMigrationRequest): void {
    this.storeAll(request.entries, true)
    this.didMigrateEmitter.fire({ source: request.source, entryCount: request.entries.length })
  }

  getOwnerEvidence(): CodekStorageOwnerEvidence {
    return {
      storageServiceOwner: "CodekStorageService",
      profileStorageOwner: "CodekStorageService.profileBucket",
      scopeOwner: {
        applicationShared: "CodekStorageService.applicationSharedBucket",
        application: "CodekStorageService.applicationBucket",
        profile: "CodekStorageService.profileBucket",
        workspace: "CodekStorageService.workspaceBucket",
      },
      persistenceSource: "CodekStorageService.inMemoryBuckets",
      mainThreadBridgeOwner: "desktop/services/extensions-host/mainThread/mainThreadStorage.js",
      workspaceId: this.workspaceId,
      profileId: this.profileId,
      secondStateSourceCreated: false,
      remainingProfileUiOwnerGap: createRemainingProfileUiOwnerGap(),
    }
  }

  private doStore(key: string, value: StorageValue, scope: StorageScope, target: StorageTarget, external: boolean): void {
    if (value === undefined || value === null) {
      this.doRemove(key, scope, external)
      return
    }
    const bucket = this.getBucket(scope)
    const serialized = serializeStorageValue(value)
    const oldTarget = bucket.targets.get(key)
    const oldValue = bucket.values.get(key)
    bucket.values.set(key, serialized)
    bucket.targets.set(key, target)
    if (oldTarget !== target) {
      this.didChangeTargetEmitter.fire({ scope })
    }
    if (oldValue !== serialized || oldTarget !== target) {
      this.didChangeValueEmitter.fire({ scope, key, target, external })
    }
  }

  private doRemove(key: string, scope: StorageScope, external: boolean): void {
    const bucket = this.getBucket(scope)
    const hadValue = bucket.values.delete(key)
    const hadTarget = bucket.targets.delete(key)
    if (hadTarget) {
      this.didChangeTargetEmitter.fire({ scope })
    }
    if (hadValue || hadTarget) {
      this.didChangeValueEmitter.fire({ scope, key, target: undefined, external })
    }
  }

  private getBucket(scope: StorageScope): StorageBucket {
    switch (scope) {
      case StorageScope.APPLICATION_SHARED:
        return this.buckets.applicationShared
      case StorageScope.APPLICATION:
        return this.buckets.application
      case StorageScope.PROFILE:
        return this.ensureProfileBucket(this.profileId)
      case StorageScope.WORKSPACE:
        return this.ensureWorkspaceBucket(this.workspaceId)
    }
  }

  private ensureProfileBucket(profileId: string): StorageBucket {
    let bucket = this.buckets.profiles.get(profileId)
    if (!bucket) {
      bucket = createBucket(profileId)
      this.buckets.profiles.set(profileId, bucket)
    }
    return bucket
  }

  private ensureWorkspaceBucket(workspaceId: string): StorageBucket {
    let bucket = this.buckets.workspaces.get(workspaceId)
    if (!bucket) {
      bucket = createBucket(workspaceId)
      this.buckets.workspaces.set(workspaceId, bucket)
    }
    return bucket
  }

  private emitSwitchChanges(scope: StorageScope, oldBucket: StorageBucket, newBucket: StorageBucket): void {
    const changedKeys = new Set([...oldBucket.values.keys(), ...newBucket.values.keys()])
    for (const key of changedKeys) {
      if (oldBucket.values.get(key) !== newBucket.values.get(key)) {
        this.didChangeValueEmitter.fire({ scope, key, target: newBucket.targets.get(key), external: true })
      }
    }
    this.didChangeTargetEmitter.fire({ scope })
  }

  private createSnapshot(): StorageSnapshot {
    return {
      workspaceId: this.workspaceId,
      profileId: this.profileId,
      scopes: {
        applicationShared: serializeBucket(this.buckets.applicationShared),
        application: serializeBucket(this.buckets.application),
        profile: serializeBucket(this.getBucket(StorageScope.PROFILE)),
        workspace: serializeBucket(this.getBucket(StorageScope.WORKSPACE)),
      },
    }
  }
}

export const codekStorageService = new CodekStorageService()
registerSingleton(ICodekStorageService, codekStorageService)

function createBucket(id: string): StorageBucket {
  return { id, values: new Map(), targets: new Map() }
}

function copyBucket(from: StorageBucket, to: StorageBucket): void {
  to.values.clear()
  to.targets.clear()
  for (const [key, value] of from.values) to.values.set(key, value)
  for (const [key, target] of from.targets) to.targets.set(key, target)
}

function serializeBucket(bucket: StorageBucket): StorageBucketSnapshot {
  return {
    id: bucket.id,
    entries: Array.from(bucket.values.entries())
      .map(([key, value]) => ({ key, value, target: bucket.targets.get(key) ?? StorageTarget.USER }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  }
}

function serializeStorageValue(value: Exclude<StorageValue, undefined | null>): string {
  if (typeof value === "string") return value
  if (typeof value === "boolean" || typeof value === "number") return String(value)
  return JSON.stringify(value)
}

function createRemainingProfileUiOwnerGap(): RemainingProfileUiOwnerGap {
  return {
    connected: false,
    owner: "workbench.profile.ui",
    reason: "Storage and profile data owners are service-level only; full profile UI owner remains outside this boundary.",
  }
}
