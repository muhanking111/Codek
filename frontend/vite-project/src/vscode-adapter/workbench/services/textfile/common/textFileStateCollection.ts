/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code:
 * - src/vs/workbench/services/textfile/common/textfiles.ts
 * - src/vs/workbench/services/workingCopy/common/workingCopyService.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import {
  TextFileEditorModelState,
  clearTextFileExternalChange,
  createTextFileModelState,
  getTextFileEditorModelStateName,
  hasExternalTextFileChange,
  isTextFileModelDirty,
  markTextFileExternalChange,
  markTextFileOrphaned,
  markTextFileSaveConflict,
  markTextFileSaveError,
  markTextFileSavePending,
  markTextFileSaveSucceeded,
  setTextFileModelState,
  type TextFileEditorModelStateName,
  type TextFileModelState,
} from "./textfiles"

export interface TextFileLegacyProjection {
  dirtyFiles: Record<string, unknown>
  externalChanges: Record<string, unknown>
}

export interface TextFileStateCollectionOptions {
  normalizePath: (path: unknown) => string
  projection: TextFileLegacyProjection
}

export class TextFileStateCollection {
  private readonly states = new Map<string, TextFileModelState>()

  constructor(private readonly options: TextFileStateCollectionOptions) {}

  get(pathValue: unknown, create = true): TextFileModelState | null {
    const path = this.normalize(pathValue)
    if (!path) return null
    if (!this.states.has(path) && create) {
      this.states.set(path, createTextFileModelState())
    }
    return this.states.get(path) || null
  }

  sync(pathValue: unknown): void {
    const path = this.normalize(pathValue)
    if (!path) return
    const state = this.get(path, false)
    if (!state) {
      delete this.options.projection.dirtyFiles[path]
      delete this.options.projection.externalChanges[path]
      return
    }
    if (isTextFileModelDirty(state)) this.options.projection.dirtyFiles[path] = true
    else delete this.options.projection.dirtyFiles[path]
    if (hasExternalTextFileChange(state)) this.options.projection.externalChanges[path] = true
    else delete this.options.projection.externalChanges[path]
  }

  markDirty(pathValue: unknown): void {
    this.withState(pathValue, (state) => setTextFileModelState(state, TextFileEditorModelState.DIRTY))
  }

  markPendingSave(pathValue: unknown): void {
    this.withState(pathValue, markTextFileSavePending)
  }

  markSaved(pathValue: unknown): void {
    this.withState(pathValue, markTextFileSaveSucceeded)
  }

  markClean(pathValue: unknown): void {
    this.withState(pathValue, (state) => setTextFileModelState(state, TextFileEditorModelState.SAVED))
  }

  markConflict(pathValue: unknown): void {
    this.withState(pathValue, markTextFileSaveConflict)
  }

  markOrphan(pathValue: unknown): void {
    this.withState(pathValue, markTextFileOrphaned)
  }

  markError(pathValue: unknown): void {
    this.withState(pathValue, markTextFileSaveError)
  }

  markExternal(pathValue: unknown): void {
    this.withState(pathValue, markTextFileExternalChange)
  }

  clearExternal(pathValue: unknown): void {
    this.withState(pathValue, clearTextFileExternalChange)
  }

  remove(pathValue: unknown): void {
    const path = this.normalize(pathValue)
    if (!path) return
    this.states.delete(path)
    delete this.options.projection.dirtyFiles[path]
    delete this.options.projection.externalChanges[path]
  }

  move(oldPathValue: unknown, newPathValue: unknown): void {
    const oldPath = this.normalize(oldPathValue)
    const newPath = this.normalize(newPathValue)
    if (!oldPath || !newPath) return
    const existing = this.get(oldPath, false)
    if (existing) {
      this.states.set(newPath, existing)
      this.states.delete(oldPath)
    }
    delete this.options.projection.dirtyFiles[oldPath]
    delete this.options.projection.externalChanges[oldPath]
    this.sync(newPath)
  }

  clear(): void {
    this.states.clear()
    clearRecord(this.options.projection.dirtyFiles)
    clearRecord(this.options.projection.externalChanges)
  }

  isDirty(pathValue: unknown): boolean {
    return isTextFileModelDirty(this.get(pathValue))
  }

  hasExternalChange(pathValue: unknown): boolean {
    return hasExternalTextFileChange(this.get(pathValue))
  }

  stateName(pathValue: unknown): TextFileEditorModelStateName {
    const state = this.get(pathValue, false)
    return getTextFileEditorModelStateName(state?.state ?? TextFileEditorModelState.SAVED)
  }

  isState(pathValue: unknown, expected: TextFileEditorModelStateName): boolean {
    return this.stateName(pathValue) === expected
  }

  paths(filter: { dirty?: boolean; external?: boolean } = {}): string[] {
    const paths = new Set<string>()
    for (const [path, state] of this.states) {
      if (filter.dirty === true && !isTextFileModelDirty(state)) continue
      if (filter.external === true && !hasExternalTextFileChange(state)) continue
      paths.add(path)
    }
    return Array.from(paths)
  }

  private withState(pathValue: unknown, mutate: (state: TextFileModelState) => void): void {
    const path = this.normalize(pathValue)
    const state = this.get(path)
    if (!path || !state) return
    mutate(state)
    this.sync(path)
  }

  private normalize(pathValue: unknown): string {
    return this.options.normalizePath(pathValue)
  }
}

export function createTextFileStateCollection(options: TextFileStateCollectionOptions): TextFileStateCollection {
  return new TextFileStateCollection(options)
}

function clearRecord(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) delete record[key]
}
