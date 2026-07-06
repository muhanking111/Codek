import { describe, expect, it } from "vitest"
import {
  applyLargeFileSegmentPatchToContent,
  buildLargeFileSegmentPatchPlan,
  createLargeFileEditBufferSavePlan,
  getUtf8ByteLength,
  hashLargeFileSegment,
  validateLargeFileSegmentPatchPlan,
} from "./largeFileSegmentEdit"

describe("largeFileSegmentEdit", () => {
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

  it("keeps the legacy workspace import on the VS Code-style edit buffer adapter", () => {
    const result = createLargeFileEditBufferSavePlan({
      state: {
        path: "logs/huge.log",
        size: 10,
        offset: 3,
        bytesRead: 4,
        windowBytes: 4,
        content: "3456",
        fileVersionHash: hashLargeFileSegment("3456"),
      },
      currentEditorContent: "3456",
      nextEditorContent: "AB",
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      nextRawWindowContent: "AB",
    }))
    expect(result.ok && result.plan).toEqual(expect.objectContaining({
      offset: 3,
      deleteBytes: 4,
      insertText: "AB",
    }))
  })
})
