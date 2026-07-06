import { describe, expect, it } from "vitest"
import {
  EDITABLE_FILE_BYTES,
  LARGE_FILE_HARD_BYTES,
  LARGE_FILE_HEAP_OPERATION_BYTES,
  LARGE_FILE_MAX_WINDOW_BYTES,
  LARGE_FILE_PREVIEW_BYTES,
  LARGE_FILE_WINDOW_BYTES,
  VSCODE_MODEL_SYNC_LIMIT_BYTES,
  VSCODE_TOKENIZATION_LARGE_FILE_BYTES,
  buildLargeFileRangeState,
  buildLargeFileOpenPlan,
  buildLargeFileReadOptions,
  clampLargeFileWindow,
  decideLargeFileOpen,
  getLargeFileWindowBytes,
  getLargeFileWindowTargetOffset,
  isLargeFileMode,
} from "./largeFilePolicy"

describe("large file open policy", () => {
  it("keeps files around 2MB editable instead of blocking them", () => {
    const decision = decideLargeFileOpen(2.3 * 1024 * 1024)
    const plan = buildLargeFileOpenPlan(2.3 * 1024 * 1024)

    expect(decision).toEqual(expect.objectContaining({
      mode: "normal",
      readOnly: false,
      maxBytes: EDITABLE_FILE_BYTES,
      truncated: false,
      reason: "normal",
    }))
    expect(plan).toEqual(expect.objectContaining({
      editorMode: "editable-full-content",
      userVisibleKind: "normal-text-editor",
      readOptions: { maxBytes: EDITABLE_FILE_BYTES },
    }))
  })

  it("uses optimized full-content mode above the VS Code tokenization budget while staying editable", () => {
    const decision = decideLargeFileOpen(VSCODE_TOKENIZATION_LARGE_FILE_BYTES + 1)
    const plan = buildLargeFileOpenPlan(VSCODE_TOKENIZATION_LARGE_FILE_BYTES + 1)

    expect(VSCODE_TOKENIZATION_LARGE_FILE_BYTES).toBe(20 * 1024 * 1024)
    expect(decision).toEqual(expect.objectContaining({
      mode: "optimized",
      readOnly: false,
      maxBytes: EDITABLE_FILE_BYTES,
      truncated: false,
      reason: "optimized-full-read",
    }))
    expect(plan).toEqual(expect.objectContaining({
      editorMode: "optimized-full-content",
      userVisibleKind: "normal-text-editor",
      readOptions: {
        maxBytes: EDITABLE_FILE_BYTES,
      },
    }))
  })

  it("uses byte windows above the VS Code model sync budget so Monaco is not fed a huge full model", () => {
    const decision = decideLargeFileOpen(64 * 1024 * 1024)
    const plan = buildLargeFileOpenPlan(64 * 1024 * 1024)
    const expectedWindowBytes = getLargeFileWindowBytes(64 * 1024 * 1024)

    expect(buildLargeFileReadOptions(decision)).toEqual({
      maxBytes: expectedWindowBytes,
      previewBytes: expectedWindowBytes,
      length: expectedWindowBytes,
      offset: 0,
      preview: true,
    })
    expect(decision).toEqual(expect.objectContaining({
      mode: "range",
      readOnly: false,
      maxBytes: expectedWindowBytes,
      readBytes: expectedWindowBytes,
      previewBytes: expectedWindowBytes,
      truncated: true,
      reason: "range-read",
    }))
    expect(plan).toEqual(expect.objectContaining({
      editorMode: "editable-byte-window",
      userVisibleKind: "range-text-editor",
    }))
  })

  it("keeps 260MiB multiline files in byte-window mode to avoid the 2000-line black-screen renderer failure", () => {
    const size = 260 * 1024 * 1024
    const decision = decideLargeFileOpen(size)
    const plan = buildLargeFileOpenPlan(size)
    const expectedWindowBytes = getLargeFileWindowBytes(size)

    expect(size).toBeGreaterThan(LARGE_FILE_HEAP_OPERATION_BYTES)
    expect(size).toBeLessThan(EDITABLE_FILE_BYTES)
    expect(decision).toEqual(expect.objectContaining({
      mode: "range",
      readOnly: false,
      readBytes: expectedWindowBytes,
      previewBytes: expectedWindowBytes,
      maxBytes: expectedWindowBytes,
      truncated: true,
      reason: "range-read",
    }))
    expect(plan).toEqual(expect.objectContaining({
      editorMode: "editable-byte-window",
      userVisibleKind: "range-text-editor",
      readOptions: {
        maxBytes: expectedWindowBytes,
        previewBytes: expectedWindowBytes,
        length: expectedWindowBytes,
        offset: 0,
        preview: true,
      },
    }))
  })

  it("caps dynamic range windows so extreme files stay under the renderer IPC budget", () => {
    expect(getLargeFileWindowBytes(2 * 1024 * 1024)).toBe(LARGE_FILE_WINDOW_BYTES)
    expect(getLargeFileWindowBytes(64 * 1024 * 1024)).toBe(32 * 1024 * 1024)
    expect(getLargeFileWindowBytes(260 * 1024 * 1024)).toBe(LARGE_FILE_MAX_WINDOW_BYTES)
    expect(LARGE_FILE_MAX_WINDOW_BYTES).toBe(32 * 1024 * 1024)
  })

  it("treats the VS Code model sync limit as the handoff to byte-window editing", () => {
    const size = VSCODE_MODEL_SYNC_LIMIT_BYTES + 1
    const decision = decideLargeFileOpen(size)
    const plan = buildLargeFileOpenPlan(size)
    const expectedWindowBytes = getLargeFileWindowBytes(size)

    expect(decision).toEqual(expect.objectContaining({
      mode: "range",
      readOnly: false,
      maxBytes: expectedWindowBytes,
      readBytes: expectedWindowBytes,
      previewBytes: expectedWindowBytes,
      truncated: true,
      reason: "range-read",
    }))
    expect(plan).toEqual(expect.objectContaining({
      editorMode: "editable-byte-window",
      userVisibleKind: "range-text-editor",
      readOptions: {
        maxBytes: expectedWindowBytes,
        previewBytes: expectedWindowBytes,
        length: expectedWindowBytes,
        offset: 0,
        preview: true,
      },
    }))
  })

  it("continues using byte window reads above the local confirmation safety limit", () => {
    const size = LARGE_FILE_HARD_BYTES + 1
    const decision = decideLargeFileOpen(size)
    const expectedWindowBytes = getLargeFileWindowBytes(size)

    expect(buildLargeFileReadOptions(decision)).toEqual({
      maxBytes: expectedWindowBytes,
      previewBytes: expectedWindowBytes,
      length: expectedWindowBytes,
      offset: 0,
      preview: true,
    })
  })

  it("identifies optimized and range states as current large file modes", () => {
    expect(isLargeFileMode("normal")).toBe(false)
    expect(isLargeFileMode("optimized")).toBe(true)
    expect(isLargeFileMode("range")).toBe(true)
  })

  it("clamps extreme-file read windows instead of treating range view as a dead end", () => {
    const size = LARGE_FILE_HARD_BYTES + (64 * 1024 * 1024)
    const expectedWindowBytes = getLargeFileWindowBytes(size)

    expect(clampLargeFileWindow(size, 0)).toEqual({
      offset: 0,
      length: expectedWindowBytes,
    })
    expect(clampLargeFileWindow(size, size)).toEqual({
      offset: size - expectedWindowBytes,
      length: expectedWindowBytes,
    })
    expect(clampLargeFileWindow(size, -100, 1024)).toEqual({
      offset: 0,
      length: 1024,
    })
  })

  it("builds a normal editor range state without any blocking-open semantics", () => {
    expect(buildLargeFileRangeState({
      path: "logs/huge.log",
      size: LARGE_FILE_WINDOW_BYTES * 3,
      limit: LARGE_FILE_WINDOW_BYTES,
      previewBytes: LARGE_FILE_WINDOW_BYTES,
      bytesRead: LARGE_FILE_WINDOW_BYTES,
      offset: LARGE_FILE_WINDOW_BYTES,
      windowBytes: LARGE_FILE_WINDOW_BYTES,
    })).toEqual({
      path: "logs/huge.log",
      size: LARGE_FILE_WINDOW_BYTES * 3,
      limit: LARGE_FILE_WINDOW_BYTES,
      previewBytes: LARGE_FILE_WINDOW_BYTES,
      bytesRead: LARGE_FILE_WINDOW_BYTES,
      offset: LARGE_FILE_WINDOW_BYTES,
      windowBytes: LARGE_FILE_WINDOW_BYTES,
      hasPrevious: true,
      hasNext: true,
      virtualStartLine: 1,
      sourceStartLine: 1,
      fileVersionHash: null,
      fullWindowHash: null,
      displayBytes: 0,
      displayHash: null,
      displayTransformed: false,
      sourceLineAdvance: 0,
      renderedLineAdvance: 0,
      renderedLineCount: 0,
      mode: "range",
      readOnly: false,
      truncated: true,
      reason: "range-read",
    })
  })

  it("computes adjacent range offsets through the same clamp used by real reads", () => {
    const size = 64 * 1024 * 1024
    const state = buildLargeFileRangeState({
      path: "logs/huge.log",
      size,
      offset: 32 * 1024 * 1024,
      previewBytes: 32 * 1024 * 1024,
      windowBytes: 32 * 1024 * 1024,
    })

    expect(getLargeFileWindowTargetOffset(state, "previous")).toBe(0)
    expect(getLargeFileWindowTargetOffset(state, "next")).toBe(32 * 1024 * 1024)
    expect(getLargeFileWindowTargetOffset({ ...state, offset: 32 * 1024 * 1024 }, "next")).toBe(32 * 1024 * 1024)
  })

  it("keeps fixed window size when the last range read returns fewer bytes", () => {
    const state = buildLargeFileRangeState({
      path: "logs/tail.log",
      size: LARGE_FILE_WINDOW_BYTES * 2 + 512,
      offset: LARGE_FILE_WINDOW_BYTES * 2,
      bytesRead: 512,
      windowBytes: LARGE_FILE_WINDOW_BYTES,
    })

    expect(state.previewBytes).toBe(512)
    expect(state.bytesRead).toBe(512)
    expect(state.windowBytes).toBe(LARGE_FILE_WINDOW_BYTES)
    expect(state.hasPrevious).toBe(true)
    expect(state.hasNext).toBe(false)
    expect(getLargeFileWindowTargetOffset(state, "previous")).toBe(LARGE_FILE_WINDOW_BYTES)
  })
})
