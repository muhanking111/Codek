/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/workbench/services/textfile/common/textfiles.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import {
  WorkingCopyCapabilities,
  isWorkingCopyDirty,
  isWorkingCopyModified,
  markWorkingCopyClean,
  markWorkingCopyDirty,
  type WorkingCopyDirtyState,
} from "../../workingCopy/common/workingCopy"

export enum TextFileEditorModelState {
  SAVED,
  DIRTY,
  PENDING_SAVE,
  CONFLICT,
  ORPHAN,
  ERROR,
}

export enum SaveReason {
  EXPLICIT = 1,
  AUTO = 2,
  FOCUS_CHANGE = 3,
  WINDOW_CHANGE = 4,
}

export type SaveSource = string

export interface SaveSourceDescriptor {
  source: SaveSource
  label: string
}

export const SaveSourceRegistry = new class {
  private readonly sources = new Map<SaveSource, SaveSourceDescriptor>()

  registerSource(source: SaveSource, label: string): SaveSource {
    const normalizedSource = String(source || "").trim()
    if (!normalizedSource) throw new Error("Save source is required")
    this.sources.set(normalizedSource, { source: normalizedSource, label })
    return normalizedSource
  }

  getSource(source: SaveSource | null | undefined): SaveSourceDescriptor | undefined {
    return source ? this.sources.get(source) : undefined
  }
}()

export interface ISaveOptions {
  readonly reason?: SaveReason
  readonly source?: SaveSource
  readonly force?: boolean
  readonly skipSaveParticipants?: boolean
}

export interface ITextFileSaveOptions extends ISaveOptions {
  readonly writeUnlock?: boolean
  readonly writeElevated?: boolean
}

export interface TextFileModelState extends WorkingCopyDirtyState {
  state: TextFileEditorModelState
  external?: boolean
}

export type TextFileEditorModelStateName =
  | "saved"
  | "dirty"
  | "pendingSave"
  | "conflict"
  | "orphan"
  | "error"

export function createTextFileModelState(options: {
  dirty?: boolean
  modified?: boolean
  external?: boolean
  capabilities?: WorkingCopyCapabilities
} = {}): TextFileModelState {
  const state: TextFileModelState = {
    state: options.dirty ? TextFileEditorModelState.DIRTY : TextFileEditorModelState.SAVED,
    dirty: false,
    modified: false,
    external: Boolean(options.external),
    capabilities: options.capabilities ?? WorkingCopyCapabilities.None,
  }
  if (options.dirty || options.modified) {
    setTextFileModelState(state, TextFileEditorModelState.DIRTY, { modified: options.modified ?? options.dirty })
  }
  return state
}

export function hasTextFileModelState(
  state: TextFileModelState | null | undefined,
  expectedState: TextFileEditorModelState,
): boolean {
  return state?.state === expectedState
}

export function setTextFileModelState(
  state: TextFileModelState,
  nextState: TextFileEditorModelState,
  options: { external?: boolean; modified?: boolean } = {},
): TextFileModelState {
  state.state = nextState
  if (options.external !== undefined) state.external = options.external

  if (nextState === TextFileEditorModelState.SAVED) {
    markWorkingCopyClean(state)
    return state
  }

  if (
    nextState === TextFileEditorModelState.DIRTY
    || nextState === TextFileEditorModelState.CONFLICT
    || nextState === TextFileEditorModelState.ORPHAN
    || nextState === TextFileEditorModelState.ERROR
  ) {
    markWorkingCopyDirty(state, options.modified ?? true)
    return state
  }

  state.modified = options.modified ?? isWorkingCopyModified(state)
  return state
}

export function isTextFileModelDirty(state: TextFileModelState | null | undefined): boolean {
  if (!state) return false
  if (
    state.state === TextFileEditorModelState.CONFLICT
    || state.state === TextFileEditorModelState.ORPHAN
    || state.state === TextFileEditorModelState.ERROR
  ) {
    return !hasScratchpadCapability(state)
  }
  return isWorkingCopyDirty(state)
}

export function isTextFileModelModified(state: TextFileModelState | null | undefined): boolean {
  return isWorkingCopyModified(state)
}

export function getTextFileEditorModelStateName(
  state: TextFileEditorModelState,
): TextFileEditorModelStateName {
  switch (state) {
    case TextFileEditorModelState.DIRTY:
      return "dirty"
    case TextFileEditorModelState.PENDING_SAVE:
      return "pendingSave"
    case TextFileEditorModelState.CONFLICT:
      return "conflict"
    case TextFileEditorModelState.ORPHAN:
      return "orphan"
    case TextFileEditorModelState.ERROR:
      return "error"
    case TextFileEditorModelState.SAVED:
    default:
      return "saved"
  }
}

export function hasExternalTextFileChange(state: TextFileModelState | null | undefined): boolean {
  return Boolean(state?.external)
}

export function markTextFileExternalChange(state: TextFileModelState): TextFileModelState {
  state.external = true
  return state
}

export function clearTextFileExternalChange(state: TextFileModelState): TextFileModelState {
  state.external = false
  return state
}

export function markTextFileSavePending(state: TextFileModelState): TextFileModelState {
  return setTextFileModelState(state, TextFileEditorModelState.PENDING_SAVE)
}

export function markTextFileSaveSucceeded(state: TextFileModelState): TextFileModelState {
  return setTextFileModelState(state, TextFileEditorModelState.SAVED, { external: false })
}

export function markTextFileSaveConflict(state: TextFileModelState): TextFileModelState {
  return setTextFileModelState(state, TextFileEditorModelState.CONFLICT, { external: true })
}

export function markTextFileOrphaned(state: TextFileModelState): TextFileModelState {
  return setTextFileModelState(state, TextFileEditorModelState.ORPHAN, { external: true })
}

export function markTextFileSaveError(state: TextFileModelState): TextFileModelState {
  return setTextFileModelState(state, TextFileEditorModelState.ERROR)
}

function hasScratchpadCapability(state: TextFileModelState): boolean {
  return typeof state.capabilities === "number" && (state.capabilities & WorkingCopyCapabilities.Scratchpad) === WorkingCopyCapabilities.Scratchpad
}
