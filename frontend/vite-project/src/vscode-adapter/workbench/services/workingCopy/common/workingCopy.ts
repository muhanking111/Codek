/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/workbench/services/workingCopy/common/workingCopy.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export enum WorkingCopyCapabilities {
  None = 0,
  Untitled = 1 << 1,
  Scratchpad = 1 << 2,
}

export interface WorkingCopyDirtyState {
  dirty?: boolean
  modified?: boolean
  capabilities?: WorkingCopyCapabilities
}

export function isWorkingCopyDirty(state: WorkingCopyDirtyState | null | undefined): boolean {
  if (!state) return false
  if (hasCapability(state.capabilities, WorkingCopyCapabilities.Scratchpad)) return false
  return Boolean(state.dirty)
}

export function isWorkingCopyModified(state: WorkingCopyDirtyState | null | undefined): boolean {
  if (!state) return false
  return Boolean(state.modified ?? state.dirty)
}

export function markWorkingCopyDirty(state: WorkingCopyDirtyState, modified = true): WorkingCopyDirtyState {
  if (hasCapability(state.capabilities, WorkingCopyCapabilities.Scratchpad)) {
    state.dirty = false
    state.modified = Boolean(modified)
    return state
  }
  state.dirty = true
  state.modified = Boolean(modified)
  return state
}

export function markWorkingCopyClean(state: WorkingCopyDirtyState): WorkingCopyDirtyState {
  state.dirty = false
  state.modified = false
  return state
}

export function hasCapability(capabilities: WorkingCopyCapabilities | undefined, capability: WorkingCopyCapabilities): boolean {
  return typeof capabilities === "number" && (capabilities & capability) === capability
}
