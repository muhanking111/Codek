import { describe, expect, it } from "vitest"
import { WorkingCopyCapabilities } from "../../workingCopy/common/workingCopy"
import {
  TextFileEditorModelState,
  clearTextFileExternalChange,
  createTextFileModelState,
  hasExternalTextFileChange,
  isTextFileModelDirty,
  isTextFileModelModified,
  markTextFileExternalChange,
  setTextFileModelState,
} from "./textfiles"

describe("VS Code textfile working copy state adapter", () => {
  it("tracks saved and dirty states like VS Code text file models", () => {
    const state = createTextFileModelState()

    expect(isTextFileModelDirty(state)).toBe(false)
    expect(isTextFileModelModified(state)).toBe(false)

    setTextFileModelState(state, TextFileEditorModelState.DIRTY)

    expect(isTextFileModelDirty(state)).toBe(true)
    expect(isTextFileModelModified(state)).toBe(true)

    setTextFileModelState(state, TextFileEditorModelState.SAVED)

    expect(isTextFileModelDirty(state)).toBe(false)
    expect(isTextFileModelModified(state)).toBe(false)
  })

  it("treats conflict orphan and error states as dirty", () => {
    const state = createTextFileModelState()

    setTextFileModelState(state, TextFileEditorModelState.CONFLICT)
    expect(isTextFileModelDirty(state)).toBe(true)

    setTextFileModelState(state, TextFileEditorModelState.ORPHAN)
    expect(isTextFileModelDirty(state)).toBe(true)

    setTextFileModelState(state, TextFileEditorModelState.ERROR)
    expect(isTextFileModelDirty(state)).toBe(true)
  })

  it("keeps scratchpad working copies modified but not dirty", () => {
    const state = createTextFileModelState({
      capabilities: WorkingCopyCapabilities.Scratchpad,
    })

    setTextFileModelState(state, TextFileEditorModelState.DIRTY)

    expect(isTextFileModelDirty(state)).toBe(false)
    expect(isTextFileModelModified(state)).toBe(true)
  })

  it("tracks external changes separately from dirty state", () => {
    const state = createTextFileModelState()

    markTextFileExternalChange(state)
    expect(hasExternalTextFileChange(state)).toBe(true)
    expect(isTextFileModelDirty(state)).toBe(false)

    clearTextFileExternalChange(state)
    expect(hasExternalTextFileChange(state)).toBe(false)
  })
})
