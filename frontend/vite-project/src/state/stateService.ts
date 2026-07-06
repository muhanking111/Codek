// VS Code source adapter.
// Source reference: D:\SourceMirror\vscode\src\vs\platform\state\node\stateService.ts

import { Emitter, type Event } from "../vscode-adapter/base/common/event"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import {
  codekStorageService,
  type ICodekStorageService,
  type StorageSnapshot,
  StorageScope,
  StorageTarget,
  type StorageValue,
  WillSaveStateReason,
} from "../storage/storageService"

export const ICodekStateService = createDecorator<ICodekStateService>("codekStateService")

export interface StateItem {
  readonly key: string
  readonly data: StorageValue
  readonly scope?: StorageScope
}

export interface StateItemChangeEvent {
  readonly key: string
  readonly scope: StorageScope
}

export interface StateActionRequest {
  readonly action: string
  readonly actorId?: string
  readonly key: string
  readonly scope: StorageScope
  readonly value?: unknown
  readonly mutatesWorkspace?: boolean
  readonly readonlyEvidence?: boolean
  readonly requiresApproval?: boolean
}

export interface StateActionEvidence {
  readonly action: string
  readonly actorId?: string
  readonly key: string
  readonly mutatesWorkspace: boolean
  readonly readonlyEvidence: boolean
  readonly requiresApproval: boolean
  readonly scope: StorageScope
  readonly timestamp: number
  readonly valueShape: string
}

export interface CodekStateServiceOptions {
  readonly now?: () => number
}

export interface ICodekStateService {
  readonly _serviceBrand: undefined
  readonly onDidChangeItem: Event<StateItemChangeEvent>
  getItem<T>(key: string, defaultValue: T, scope?: StorageScope): T
  setItem(key: string, data: StorageValue, scope?: StorageScope): void
  setItems(items: readonly StateItem[]): void
  removeItem(key: string, scope?: StorageScope): void
  recordStateAction(request: StateActionRequest): StateActionEvidence
  getEvidenceActions(): readonly StateActionEvidence[]
  flush(reason?: WillSaveStateReason): Promise<void>
  backup(reason: string): Promise<StorageSnapshot>
}

export class CodekStateService implements ICodekStateService {
  declare readonly _serviceBrand: undefined

  private static readonly prefix = "state/"
  private readonly now: () => number
  private readonly evidenceActions: StateActionEvidence[] = []
  private readonly didChangeItemEmitter = new Emitter<StateItemChangeEvent>()

  readonly onDidChangeItem = this.didChangeItemEmitter.event

  constructor(
    private readonly storageService: ICodekStorageService,
    options: CodekStateServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now
  }

  getItem<T>(key: string, defaultValue: T, scope = StorageScope.APPLICATION): T {
    const storageKey = this.toStorageKey(key)
    if (typeof defaultValue === "boolean") {
      return this.storageService.getBoolean(storageKey, scope, defaultValue) as T
    }
    if (typeof defaultValue === "number") {
      return this.storageService.getNumber(storageKey, scope, defaultValue) as T
    }
    if (typeof defaultValue === "object" && defaultValue !== null) {
      return this.storageService.getObject(storageKey, scope, defaultValue as object) as T
    }
    return (this.storageService.get(storageKey, scope, defaultValue as string | undefined) ?? defaultValue) as T
  }

  setItem(key: string, data: StorageValue, scope = StorageScope.APPLICATION): void {
    this.storageService.store(this.toStorageKey(key), data, scope, StorageTarget.MACHINE)
    this.didChangeItemEmitter.fire({ key, scope })
  }

  setItems(items: readonly StateItem[]): void {
    for (const item of items) {
      this.setItem(item.key, item.data, item.scope ?? StorageScope.APPLICATION)
    }
  }

  removeItem(key: string, scope = StorageScope.APPLICATION): void {
    this.storageService.remove(this.toStorageKey(key), scope)
    this.didChangeItemEmitter.fire({ key, scope })
  }

  recordStateAction(request: StateActionRequest): StateActionEvidence {
    const evidence: StateActionEvidence = {
      action: request.action,
      actorId: request.actorId,
      key: request.key,
      mutatesWorkspace: request.mutatesWorkspace ?? false,
      readonlyEvidence: request.readonlyEvidence ?? false,
      requiresApproval: request.requiresApproval ?? false,
      scope: request.scope,
      timestamp: this.now(),
      valueShape: getValueShape(request.value),
    }
    this.evidenceActions.push(evidence)
    return evidence
  }

  getEvidenceActions(): readonly StateActionEvidence[] {
    return this.evidenceActions.map((action) => ({ ...action }))
  }

  flush(reason = WillSaveStateReason.NONE): Promise<void> {
    return this.storageService.flush(reason)
  }

  backup(reason: string): Promise<StorageSnapshot> {
    return this.storageService.backup(reason)
  }

  private toStorageKey(key: string): string {
    return key.startsWith(CodekStateService.prefix) ? key : `${CodekStateService.prefix}${key}`
  }
}

export const codekStateService = new CodekStateService(codekStorageService)
registerSingleton(ICodekStateService, codekStateService)

function getValueShape(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return `array:${value.length}`
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort()
    return `object:${keys.join(",")}`
  }
  return typeof value
}
