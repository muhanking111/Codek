import { describe, expect, it, vi } from "vitest"
import { CodekStandaloneTextModelService } from "./textModelService"

describe("CodekStandaloneTextModelService", () => {
  it("creates, updates and disposes VS Code-style text models", () => {
    const service = new CodekStandaloneTextModelService()
    const onDidCreateModel = vi.fn()
    const onWillDisposeModel = vi.fn()
    service.onDidCreateModel(onDidCreateModel)
    service.onWillDisposeModel(onWillDisposeModel)

    const model = service.createModel("one\ntwo", "typescript", "file:///src/app.ts")
    const onDidChangeContent = vi.fn()
    model.onDidChangeContent(onDidChangeContent)

    expect(model.snapshot()).toEqual({
      uri: "file:///src/app.ts",
      languageId: "typescript",
      versionId: 1,
      value: "one\ntwo",
      lineCount: 2,
      valueLength: 7,
    })
    expect(onDidCreateModel).toHaveBeenCalledWith({ model, uri: "file:///src/app.ts" })

    const updated = service.updateModel("file:///src/app.ts", "one\ntwo\nthree", "javascript")

    expect(updated).toBe(model)
    expect(model.getLanguageId()).toBe("javascript")
    expect(model.getVersionId()).toBe(2)
    expect(model.getLineCount()).toBe(3)
    expect(onDidChangeContent).toHaveBeenCalledWith({
      model,
      uri: "file:///src/app.ts",
      versionId: 2,
      isFlush: true,
    })

    expect(service.disposeModel("file:///src/app.ts")).toBe(true)
    expect(onWillDisposeModel).toHaveBeenCalledWith({ model, uri: "file:///src/app.ts" })
    expect(service.getModel("file:///src/app.ts")).toBeNull()
  })

  it("uses VS Code-style positions and selections for text offsets", () => {
    const service = new CodekStandaloneTextModelService()
    const model = service.createModel("abc\ndef", "plaintext", "file:///note.txt")

    expect(model.getPositionAt(5).toJSON()).toEqual({ lineNumber: 2, column: 2 })
    expect(model.getOffsetAt({ lineNumber: 2, column: 2 })).toBe(5)
    expect(model.createSelection({ lineNumber: 1, column: 2 }, { lineNumber: 2, column: 3 }).toString()).toBe("[1,2 -> 2,3]")
  })
})
