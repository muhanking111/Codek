// VS Code source adapter.
// Source reference: D:\SourceMirror\vscode\src\vs\workbench\common\memento.ts

import {
  type CodekStorageOwnerEvidence,
  type ICodekStorageService,
  type RemainingProfileUiOwnerGap,
  StorageScope,
  StorageTarget,
} from "../storage/storageService"

export interface CodekMementoOwnerEvidence {
  readonly mementoOwner: "CodekMemento"
  readonly storageServiceOwner: CodekStorageOwnerEvidence["storageServiceOwner"]
  readonly profileStorageOwner: CodekStorageOwnerEvidence["profileStorageOwner"]
  readonly scopeOwner: CodekStorageOwnerEvidence["scopeOwner"]
  readonly persistenceSource: CodekStorageOwnerEvidence["persistenceSource"]
  readonly mainThreadBridgeOwner: CodekStorageOwnerEvidence["mainThreadBridgeOwner"]
  readonly storageKey: string
  readonly secondStateSourceCreated: false
  readonly remainingProfileUiOwnerGap: RemainingProfileUiOwnerGap
}

type MementoBucket<T extends object> = {
  readonly scope: StorageScope
  readonly target: StorageTarget
  readonly object: Partial<T>
}

export class CodekMemento<T extends object> {
  private static readonly commonPrefix = "memento/"
  private readonly id: string
  private readonly scopedMementos = new Map<StorageScope, MementoBucket<T>>()

  constructor(id: string, private readonly storageService: ICodekStorageService) {
    this.id = `${CodekMemento.commonPrefix}${id}`
  }

  getMemento(scope: StorageScope, target: StorageTarget): Partial<T> {
    let bucket = this.scopedMementos.get(scope)
    if (!bucket) {
      bucket = {
        scope,
        target,
        object: this.load(scope),
      }
      this.scopedMementos.set(scope, bucket)
    }
    return bucket.object
  }

  onDidChangeValue(scope: StorageScope) {
    return this.storageService.onDidChangeValue(scope, this.id)
  }

  saveMemento(): void {
    for (const bucket of this.scopedMementos.values()) {
      if (Object.keys(bucket.object).length === 0) {
        this.storageService.remove(this.id, bucket.scope)
      } else {
        this.storageService.store(this.id, bucket.object, bucket.scope, bucket.target)
      }
    }
  }

  reloadMemento(scope: StorageScope): void {
    const bucket = this.scopedMementos.get(scope)
    if (!bucket) return
    for (const key of Object.keys(bucket.object)) {
      delete bucket.object[key as keyof T]
    }
    Object.assign(bucket.object, this.load(scope))
  }

  getOwnerEvidence(): CodekMementoOwnerEvidence {
    const storageEvidence = this.storageService.getOwnerEvidence()
    return {
      mementoOwner: "CodekMemento",
      storageServiceOwner: storageEvidence.storageServiceOwner,
      profileStorageOwner: storageEvidence.profileStorageOwner,
      scopeOwner: storageEvidence.scopeOwner,
      persistenceSource: storageEvidence.persistenceSource,
      mainThreadBridgeOwner: storageEvidence.mainThreadBridgeOwner,
      storageKey: this.id,
      secondStateSourceCreated: false,
      remainingProfileUiOwnerGap: storageEvidence.remainingProfileUiOwnerGap,
    }
  }

  private load(scope: StorageScope): Partial<T> {
    return this.storageService.getObject<Partial<T>>(this.id, scope, {}) ?? {}
  }
}
