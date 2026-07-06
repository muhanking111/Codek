import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import type { Disposable } from "../vscode-adapter/platform/commands/common/commandsRegistry"

// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\platform\secrets\common\secrets.ts
// - D:\SourceMirror\vscode\src\vs\workbench\services\secrets\browser\secretStorageService.ts
//
// Codek's renderer facade intentionally stores only local in-memory testable
// values here; evidence snapshots redact secret values and expose key-level
// lifecycle only. Desktop persistence can delegate behind this same contract.

export type SecretStorageProviderType = "in-memory" | "persisted" | "unknown"
export type SecretStorageAction = "get" | "set" | "delete" | "keys" | "change"

export interface SecretStorageEvidence {
  serviceId: string
  key: string
  action: SecretStorageAction
  found: boolean
  providerType: SecretStorageProviderType
  valueRedacted: true
  createdAt: number
}

export interface SecretStorageSnapshot {
  serviceId: string
  providerType: SecretStorageProviderType
  keyCount: number
  keys: string[]
  evidence: SecretStorageEvidence[]
  constraints: {
    noSecretValueInEvidence: true
    vscodeSecretStorageKeySemantics: true
    rendererFacadeOnly: true
  }
}

type Listener<T> = (event: T) => void

export interface WorkbenchSecretStorageService {
  readonly _serviceBrand: undefined
  readonly type: SecretStorageProviderType
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
  onDidChangeSecret(listener: Listener<string>): Disposable
  getSnapshot(): SecretStorageSnapshot
  clear(): void
  clearEvidence(): void
}

export const IWorkbenchSecretStorageService = createDecorator<WorkbenchSecretStorageService>("workbenchSecretStorageService")

export class CodekWorkbenchSecretStorageService implements WorkbenchSecretStorageService {
  declare readonly _serviceBrand: undefined
  private readonly store = new Map<string, string>()
  private readonly evidence: SecretStorageEvidence[] = []
  private readonly listeners = new Set<Listener<string>>()

  constructor(readonly type: SecretStorageProviderType = "in-memory") {}

  async get(key: string): Promise<string | undefined> {
    const normalized = normalizeSecretKey(key)
    const value = this.store.get(normalized)
    this.recordEvidence(normalized, "get", value !== undefined)
    return value
  }

  async set(key: string, value: string): Promise<void> {
    const normalized = normalizeSecretKey(key)
    this.store.set(normalized, String(value))
    this.recordEvidence(normalized, "set", true)
    this.fireChange(normalized)
  }

  async delete(key: string): Promise<void> {
    const normalized = normalizeSecretKey(key)
    const found = this.store.delete(normalized)
    this.recordEvidence(normalized, "delete", found)
    this.fireChange(normalized)
  }

  async keys(): Promise<string[]> {
    const keys = [...this.store.keys()].sort()
    this.recordEvidence("__keys__", "keys", keys.length > 0)
    return keys
  }

  onDidChangeSecret(listener: Listener<string>): Disposable {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  getSnapshot(): SecretStorageSnapshot {
    return {
      serviceId: String(IWorkbenchSecretStorageService),
      providerType: this.type,
      keyCount: this.store.size,
      keys: [...this.store.keys()].sort(),
      evidence: [...this.evidence],
      constraints: {
        noSecretValueInEvidence: true,
        vscodeSecretStorageKeySemantics: true,
        rendererFacadeOnly: true,
      },
    }
  }

  clear(): void {
    this.store.clear()
    this.clearEvidence()
  }

  clearEvidence(): void {
    this.evidence.length = 0
  }

  private fireChange(key: string): void {
    this.recordEvidence(key, "change", this.store.has(key))
    for (const listener of this.listeners) listener(key)
  }

  private recordEvidence(key: string, action: SecretStorageAction, found: boolean): void {
    this.evidence.push({
      serviceId: String(IWorkbenchSecretStorageService),
      key,
      action,
      found,
      providerType: this.type,
      valueRedacted: true,
      createdAt: Date.now(),
    })
  }
}

export const globalWorkbenchSecretStorageService = new CodekWorkbenchSecretStorageService()
registerSingleton(IWorkbenchSecretStorageService, globalWorkbenchSecretStorageService, InstantiationType.Delayed)

function normalizeSecretKey(key: string): string {
  const normalized = String(key || "").trim()
  if (!normalized) throw new Error("Secret key is required")
  return normalized
}
