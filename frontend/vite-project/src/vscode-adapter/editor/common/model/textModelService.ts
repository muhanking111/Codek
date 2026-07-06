/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code editor model service contracts.
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from "../../../base/common/event"
import { Position, type IPosition } from "../core/position"
import { Selection, type ISelection } from "../core/selection"
import { createLargeTextLineIndex } from "./largeTextLineIndex"

export interface CodekTextModelSnapshot {
  readonly uri: string
  readonly languageId: string
  readonly versionId: number
  readonly value: string
  readonly lineCount: number
  readonly valueLength: number
}

export interface CodekTextModelContentChangedEvent {
  readonly model: CodekTextModel
  readonly uri: string
  readonly versionId: number
  readonly isFlush: boolean
}

export interface CodekTextModelDisposedEvent {
  readonly uri: string
}

export class CodekTextModel {
  private readonly onDidChangeContentEmitter = new Emitter<CodekTextModelContentChangedEvent>()
  readonly onDidChangeContent: Event<CodekTextModelContentChangedEvent> = this.onDidChangeContentEmitter.event

  private readonly onWillDisposeEmitter = new Emitter<CodekTextModelDisposedEvent>()
  readonly onWillDispose: Event<CodekTextModelDisposedEvent> = this.onWillDisposeEmitter.event

  private value: string
  private versionId = 1
  private disposed = false

  constructor(
    readonly uri: string,
    value: string,
    private languageId: string,
  ) {
    this.value = value
  }

  getValue(): string {
    return this.value
  }

  setValue(value: string): void {
    this.assertNotDisposed()
    if (this.value === value) return
    this.value = value
    this.versionId += 1
    this.onDidChangeContentEmitter.fire({
      model: this,
      uri: this.uri,
      versionId: this.versionId,
      isFlush: true,
    })
  }

  getLanguageId(): string {
    return this.languageId
  }

  setLanguageId(languageId: string): void {
    this.assertNotDisposed()
    this.languageId = languageId
  }

  getVersionId(): number {
    return this.versionId
  }

  getLineCount(): number {
    return createLargeTextLineIndex(this.value).lineCount
  }

  getValueLength(): number {
    return this.value.length
  }

  getPositionAt(offset: number): Position {
    const safeOffset = Math.max(0, Math.min(offset, this.value.length))
    let lineNumber = 1
    let column = 1
    for (let index = 0; index < safeOffset; index += 1) {
      const char = this.value.charCodeAt(index)
      if (char === 10) {
        lineNumber += 1
        column = 1
      } else {
        column += 1
      }
    }
    return new Position(lineNumber, column)
  }

  getOffsetAt(position: IPosition): number {
    const targetLine = Math.max(1, position.lineNumber)
    const targetColumn = Math.max(1, position.column)
    let lineNumber = 1
    let column = 1
    for (let index = 0; index < this.value.length; index += 1) {
      if (lineNumber === targetLine && column === targetColumn) return index
      const char = this.value.charCodeAt(index)
      if (char === 10) {
        lineNumber += 1
        column = 1
      } else {
        column += 1
      }
    }
    return this.value.length
  }

  createSelection(start: IPosition, end: IPosition = start): Selection {
    return Selection.fromPositions(start, end)
  }

  snapshot(): CodekTextModelSnapshot {
    return {
      uri: this.uri,
      languageId: this.languageId,
      versionId: this.versionId,
      value: this.value,
      lineCount: this.getLineCount(),
      valueLength: this.value.length,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.onWillDisposeEmitter.fire({ uri: this.uri })
    this.onDidChangeContentEmitter.dispose()
    this.onWillDisposeEmitter.dispose()
  }

  isDisposed(): boolean {
    return this.disposed
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error(`Text model has been disposed: ${this.uri}`)
  }
}

export interface CodekTextModelServiceEvent {
  readonly model: CodekTextModel
  readonly uri: string
}

export interface CodekTextModelService {
  readonly onDidCreateModel: Event<CodekTextModelServiceEvent>
  readonly onWillDisposeModel: Event<CodekTextModelServiceEvent>
  createModel(value: string, languageId: string, uri: string): CodekTextModel
  updateModel(uri: string, value: string, languageId?: string): CodekTextModel
  getModel(uri: string): CodekTextModel | null
  getOrCreateModel(value: string, languageId: string, uri: string): CodekTextModel
  disposeModel(uri: string): boolean
  disposeAll(): void
}

export class CodekStandaloneTextModelService implements CodekTextModelService {
  private readonly models = new Map<string, CodekTextModel>()

  private readonly onDidCreateModelEmitter = new Emitter<CodekTextModelServiceEvent>()
  readonly onDidCreateModel: Event<CodekTextModelServiceEvent> = this.onDidCreateModelEmitter.event

  private readonly onWillDisposeModelEmitter = new Emitter<CodekTextModelServiceEvent>()
  readonly onWillDisposeModel: Event<CodekTextModelServiceEvent> = this.onWillDisposeModelEmitter.event

  createModel(value: string, languageId: string, uri: string): CodekTextModel {
    const existing = this.models.get(uri)
    if (existing) existing.dispose()
    const model = new CodekTextModel(uri, value, languageId)
    this.models.set(uri, model)
    model.onWillDispose(() => {
      if (this.models.get(uri) === model) {
        this.onWillDisposeModelEmitter.fire({ model, uri })
        this.models.delete(uri)
      }
    })
    this.onDidCreateModelEmitter.fire({ model, uri })
    return model
  }

  updateModel(uri: string, value: string, languageId?: string): CodekTextModel {
    const model = this.models.get(uri)
    if (!model) return this.createModel(value, languageId || "plaintext", uri)
    if (languageId) model.setLanguageId(languageId)
    model.setValue(value)
    return model
  }

  getModel(uri: string): CodekTextModel | null {
    return this.models.get(uri) ?? null
  }

  getOrCreateModel(value: string, languageId: string, uri: string): CodekTextModel {
    return this.models.get(uri) ?? this.createModel(value, languageId, uri)
  }

  disposeModel(uri: string): boolean {
    const model = this.models.get(uri)
    if (!model) return false
    model.dispose()
    return true
  }

  disposeAll(): void {
    for (const uri of [...this.models.keys()]) {
      this.disposeModel(uri)
    }
  }
}

export function isCodekSelection(value: unknown): value is ISelection {
  return Selection.isISelection(value)
}
