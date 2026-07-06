import { describe, expect, it } from "vitest"
import {
  applyLargeFileSegmentPatchToContent,
  buildLargeFileSegmentPatchPlan,
  createLargeFileEditBufferSavePlan,
  createLargeFileSegmentEditStackItem,
  createLargeFileSegmentRedoPlan,
  createLargeFileSegmentUndoPlan,
  getUtf8ByteLength,
  hashLargeFileSegment,
  pushLargeFileSegmentEditStackItem,
  validateLargeFileSegmentPatchPlan,
} from "./largeFileEditBuffer"

describe("largeFileEditBuffer", () => {
  it("builds a safe patch plan for the current editable large-file segment", () => {
    const plan = buildLargeFileSegmentPatchPlan({
      path: "logs/huge.log",
      size: 100,
      offset: 10,
      bytesRead: 5,
      windowBytes: 8,
      content: "abcde",
    }, "abXYZ")

    expect(plan).toEqual({
      path: "logs/huge.log",
      offset: 10,
      deleteBytes: 5,
      insertText: "abXYZ",
      expectedSize: 100,
      expectedHash: hashLargeFileSegment("abcde"),
      nextSize: 100,
      safety: "safe-segment-replace",
    })
  })

  it("uses UTF-8 byte length when computing edited segment size", () => {
    const plan = buildLargeFileSegmentPatchPlan({
      path: "logs/huge.log",
      size: 20,
      offset: 3,
      bytesRead: 4,
      windowBytes: 4,
      content: "abcd",
    }, "中🙂")

    expect(getUtf8ByteLength("中🙂")).toBe(new TextEncoder().encode("中🙂").length)
    expect(plan.nextSize).toBe(20 - 4 + 7)
  })

  it("validates path, offset, size and hash before segment write-back", () => {
    const plan = buildLargeFileSegmentPatchPlan({
      path: "logs/huge.log",
      size: 100,
      offset: 10,
      bytesRead: 5,
      windowBytes: 8,
      content: "abcde",
    }, "changed")

    expect(validateLargeFileSegmentPatchPlan({
      plan,
      path: "logs/huge.log",
      size: 100,
      offset: 10,
      currentWindowContent: "abcde",
    })).toEqual({ ok: true, message: "大文件分段保存计划可以安全写回。" })

    expect(validateLargeFileSegmentPatchPlan({
      plan,
      path: "logs/other.log",
      size: 100,
      offset: 10,
      currentWindowContent: "abcde",
    })).toEqual({ ok: false, reason: "path-mismatch", message: "大文件分段保存失败：文件路径已经变化。" })

    expect(validateLargeFileSegmentPatchPlan({
      plan,
      path: "logs/huge.log",
      size: 101,
      offset: 10,
      currentWindowContent: "abcde",
    })).toEqual({ ok: false, reason: "size-mismatch", message: "大文件分段保存失败：文件大小已经被外部修改。" })

    expect(validateLargeFileSegmentPatchPlan({
      plan,
      path: "logs/huge.log",
      size: 100,
      offset: 11,
      currentWindowContent: "abcde",
    })).toEqual({ ok: false, reason: "offset-mismatch", message: "大文件分段保存失败：当前窗口位置已经变化。" })

    expect(validateLargeFileSegmentPatchPlan({
      plan,
      path: "logs/huge.log",
      size: 100,
      offset: 10,
      currentWindowContent: "external",
    })).toEqual({ ok: false, reason: "hash-mismatch", message: "大文件分段保存失败：当前窗口内容已经变化。" })
  })

  it("applies a segment patch without rewriting unrelated content", () => {
    const plan = buildLargeFileSegmentPatchPlan({
      path: "logs/huge.log",
      size: 10,
      offset: 3,
      bytesRead: 4,
      windowBytes: 4,
      content: "3456",
    }, "AB")

    expect(applyLargeFileSegmentPatchToContent("0123456789", plan)).toBe("012AB789")
  })

  it("creates a bounded edit-buffer save plan for ordinary range windows", () => {
    const result = createLargeFileEditBufferSavePlan({
      state: {
        path: "logs/huge.log",
        size: 100,
        offset: 10,
        bytesRead: 5,
        previewBytes: 5,
        windowBytes: 8,
        content: "abcde",
        fileVersionHash: hashLargeFileSegment("abcde"),
      },
      currentEditorContent: "abcde",
      nextEditorContent: "abXYZ",
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      currentWindowContent: "abcde",
      nextSegmentContent: "abXYZ",
      nextDisplayedContent: "abXYZ",
      nextDisplayTransformed: false,
      nextWindowBytesRead: 5,
      nextFullWindowHash: hashLargeFileSegment("abXYZ"),
    }))
    expect(result.ok && result.plan).toEqual(expect.objectContaining({
      path: "logs/huge.log",
      offset: 10,
      deleteBytes: 5,
      insertText: "abXYZ",
      expectedSize: 100,
      expectedHash: hashLargeFileSegment("abcde"),
      nextSize: 100,
    }))
  })

  it("strips synthetic line breaks for safe-wrapped single-line display buffers", () => {
    const result = createLargeFileEditBufferSavePlan({
      state: {
        path: "logs/one-line.log",
        size: 12,
        offset: 0,
        bytesRead: 12,
        previewBytes: 12,
        windowBytes: 12,
        content: "xxxx\nyyyy\nzzzz",
        fileVersionHash: hashLargeFileSegment("xxxxyyyyzzzz"),
        displayTransformed: true,
      },
      currentEditorContent: "xxxx\nyyyy\nzzzz",
      nextEditorContent: "aaaa\nbbbb\ncccc",
      rememberedWindow: {
        rawContent: "xxxxyyyyzzzz",
        displayRawContent: "xxxxyyyyzzzz",
      },
      normalizeDisplayContent: (content) => content.replace(/(.{4})/g, "$1\n").replace(/\n$/, ""),
      displayRenderBytes: 12,
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      currentWindowContent: "xxxxyyyyzzzz",
      nextSegmentContent: "aaaabbbbcccc",
      nextDisplayedContent: "aaaa\nbbbb\ncccc",
      nextDisplayTransformed: true,
      nextRawWindowContent: "aaaabbbbcccc",
      nextWindowBytesRead: 12,
    }))
    expect(result.ok && result.plan).toEqual(expect.objectContaining({
      offset: 0,
      deleteBytes: 12,
      insertText: "aaaabbbbcccc",
      expectedHash: hashLargeFileSegment("xxxxyyyyzzzz"),
    }))
  })

  it("rejects transformed display windows that cannot be mapped back to source bytes", () => {
    expect(createLargeFileEditBufferSavePlan({
      state: {
        path: "logs/wrapped.log",
        size: 12,
        offset: 0,
        bytesRead: 12,
        previewBytes: 12,
        windowBytes: 12,
        content: "a\nb",
        displayTransformed: true,
      },
      currentEditorContent: "a\nb",
      nextEditorContent: "changed",
      rememberedWindow: {
        rawContent: "a\nb",
        displayRawContent: "a\nb",
      },
    })).toEqual({
      ok: false,
      reason: "unmappable-display",
      message: "大文件分段保存失败：当前窗口经过安全换行显示，且无法无损映射回原始文件。",
    })
  })

  it("creates VS Code-style undo and redo patch plans for saved large-file segments", () => {
    const item = createLargeFileSegmentEditStackItem({
      path: "logs/huge.log",
      offset: 10,
      before: {
        fileSize: 100,
        segmentContent: "abcde",
        rawWindowContent: "abcde",
        displayedContent: "abcde",
      },
      after: {
        fileSize: 101,
        segmentContent: "abXYZ!",
        rawWindowContent: "abXYZ!",
        displayedContent: "abXYZ!",
      },
      label: "large file segment save",
    })
    const stack = pushLargeFileSegmentEditStackItem({ undo: [], redo: [] }, item)

    const undo = createLargeFileSegmentUndoPlan({
      stack,
      path: "logs/huge.log",
      size: 101,
      offset: 10,
      currentSegmentContent: "abXYZ!",
    })

    expect(undo).toEqual(expect.objectContaining({
      ok: true,
      target: item.before,
    }))
    expect(undo.ok && undo.plan).toEqual(expect.objectContaining({
      path: "logs/huge.log",
      offset: 10,
      deleteBytes: 6,
      insertText: "abcde",
      expectedSize: 101,
      expectedHash: hashLargeFileSegment("abXYZ!"),
      nextSize: 100,
      safety: "safe-segment-replace",
    }))
    expect(undo.ok && undo.nextStack).toEqual({ undo: [], redo: [item] })

    const redo = createLargeFileSegmentRedoPlan({
      stack: undo.ok ? undo.nextStack : { undo: [], redo: [] },
      path: "logs/huge.log",
      size: 100,
      offset: 10,
      currentSegmentContent: "abcde",
    })

    expect(redo).toEqual(expect.objectContaining({
      ok: true,
      target: item.after,
    }))
    expect(redo.ok && redo.plan).toEqual(expect.objectContaining({
      path: "logs/huge.log",
      offset: 10,
      deleteBytes: 5,
      insertText: "abXYZ!",
      expectedSize: 100,
      expectedHash: hashLargeFileSegment("abcde"),
      nextSize: 101,
      safety: "safe-segment-replace",
    }))
    expect(redo.ok && redo.nextStack).toEqual({ undo: [item], redo: [] })
  })

  it("rejects stale segment edit stack plans when size, offset or hash drift", () => {
    const item = createLargeFileSegmentEditStackItem({
      path: "logs/huge.log",
      offset: 10,
      before: {
        fileSize: 100,
        segmentContent: "abcde",
        rawWindowContent: "abcde",
        displayedContent: "abcde",
      },
      after: {
        fileSize: 100,
        segmentContent: "abXYZ",
        rawWindowContent: "abXYZ",
        displayedContent: "abXYZ",
      },
    })
    const stack = pushLargeFileSegmentEditStackItem({ undo: [], redo: [] }, item)

    expect(createLargeFileSegmentUndoPlan({
      stack,
      path: "logs/huge.log",
      size: 101,
      offset: 10,
      currentSegmentContent: "abXYZ",
    })).toEqual(expect.objectContaining({
      ok: false,
      reason: "validation-failed",
      message: "大文件分段保存失败：文件大小已经被外部修改。",
    }))

    expect(createLargeFileSegmentUndoPlan({
      stack,
      path: "logs/huge.log",
      size: 100,
      offset: 12,
      currentSegmentContent: "abXYZ",
    })).toEqual(expect.objectContaining({
      ok: false,
      reason: "validation-failed",
      message: "大文件分段保存失败：当前窗口位置已经变化。",
    }))

    expect(createLargeFileSegmentUndoPlan({
      stack,
      path: "logs/huge.log",
      size: 100,
      offset: 10,
      currentSegmentContent: "external",
    })).toEqual(expect.objectContaining({
      ok: false,
      reason: "validation-failed",
      message: "大文件分段保存失败：当前窗口内容已经变化。",
    }))
  })
})
