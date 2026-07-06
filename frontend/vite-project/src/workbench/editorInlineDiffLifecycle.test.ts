import { describe, expect, it, vi } from "vitest"
import {
  installEditorInlineDiffOverlay,
  installInlineDiffAgentRefresh,
  readInlineDiffModelValues,
  shouldRefreshInlineDiffForAgentEvent,
} from "./editorInlineDiffLifecycle"
import { CodekStandaloneTextModelService } from "../vscode-adapter/editor/common/model/textModelService"

describe("editorInlineDiffLifecycle", () => {
  it("installs the inline diff overlay through editor features", () => {
    const detach = vi.fn()
    const editor = { id: "editor" }
    const monaco = { id: "monaco" }
    const attachInlineDiffOverlay = vi.fn(() => detach)

    const result = installEditorInlineDiffOverlay(editor, monaco, { attachInlineDiffOverlay })

    expect(result).toBe(detach)
    expect(attachInlineDiffOverlay).toHaveBeenCalledWith(editor, monaco)
  })

  it("detects agent events that should refresh inline diff", () => {
    expect(shouldRefreshInlineDiffForAgentEvent({ type: "file-changed" })).toBe(true)
    expect(shouldRefreshInlineDiffForAgentEvent({ type: "diff-available" })).toBe(true)
    expect(shouldRefreshInlineDiffForAgentEvent({ type: "command-executed" })).toBe(false)
  })

  it("refreshes inline diff for active file when relevant agent events arrive", () => {
    let listener: ((event: { type?: string }) => void) | undefined
    const detach = vi.fn()
    const refreshInlineDiff = vi.fn()
    const onAgentEvent = vi.fn((callback) => {
      listener = callback
      return detach
    })

    const result = installInlineDiffAgentRefresh({
      onAgentEvent,
      refreshInlineDiff,
      getActiveFile: () => "src/App.vue",
    })

    listener?.({ type: "command-executed" })
    listener?.({ type: "file-changed" })
    listener?.({ type: "diff-available" })

    expect(refreshInlineDiff).toHaveBeenCalledTimes(2)
    expect(refreshInlineDiff).toHaveBeenNthCalledWith(1, "src/App.vue")
    expect(refreshInlineDiff).toHaveBeenNthCalledWith(2, "src/App.vue")
    result()
    expect(detach).toHaveBeenCalledTimes(1)
  })

  it("reads inline diff inputs from VS Code-style text models", () => {
    const service = new CodekStandaloneTextModelService()
    const original = service.createModel("before\n", "typescript", "diff:///src/App.vue?original")
    const modified = service.createModel("after\n", "typescript", "diff:///src/App.vue?modified")

    expect(readInlineDiffModelValues({ original, modified })).toEqual({
      before: "before\n",
      after: "after\n",
    })
  })

  it("prefers the event path when refreshing agent inline diffs", () => {
    let listener: ((event: { type?: string; path?: string | null }) => void) | undefined
    const refreshInlineDiff = vi.fn()
    installInlineDiffAgentRefresh({
      onAgentEvent: (callback) => {
        listener = callback
        return vi.fn()
      },
      refreshInlineDiff,
      getActiveFile: () => "src/active.ts",
    })

    listener?.({ type: "file-changed", path: "src/generated.ts" })

    expect(refreshInlineDiff).toHaveBeenCalledWith("src/generated.ts")
  })
})
