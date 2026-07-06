import { describe, expect, it, vi } from "vitest"
import { RefactorProvider, registerRefactorProvider } from "./refactorProvider"

function createModel({
  languageId = "typescript",
  lines = ["const value = 1", "console.log(value)"],
  selectedText = "",
} = {}) {
  return {
    getLanguageId: () => languageId,
    getLineCount: () => lines.length,
    getLineContent: (lineNumber: number) => lines[lineNumber - 1] ?? "",
    getValueInRange: () => selectedText,
  }
}

function createRange(startLineNumber = 1, startColumn = 1, endLineNumber = startLineNumber, endColumn = startColumn) {
  return { startLineNumber, startColumn, endLineNumber, endColumn }
}

describe("RefactorProvider", () => {
  it("does not expose idle code actions or a fake Rename Symbol lightbulb", () => {
    const provider = new RefactorProvider()

    const actions = provider.getRefactorActions(
      createModel() as never,
      createRange(1, 1),
      { markers: [], trigger: 1 } as never,
    )

    expect(actions).toEqual([])
  })

  it("exposes extract refactors only for a real non-empty selection", () => {
    const provider = new RefactorProvider()

    const actions = provider.getRefactorActions(
      createModel({ selectedText: "value + 1" }) as never,
      createRange(1, 7, 1, 16),
      { markers: [], trigger: 2, only: { value: "refactor" } } as never,
    )

    expect(actions.map((action) => action.title)).toContain("Extract Function")
    expect(actions.map((action) => action.title)).toContain("Extract Variable")
    expect(actions.map((action) => action.title)).not.toContain("Rename Symbol")
  })

  it("limits organize imports to explicit source action requests", () => {
    const provider = new RefactorProvider()
    const model = createModel({
      lines: ["import z from 'z'", "import a from 'a'", "", "console.log(a, z)"],
    })

    const idleActions = provider.getRefactorActions(model as never, createRange(1, 1), { markers: [], trigger: 1 } as never)
    const sourceActions = provider.getRefactorActions(
      model as never,
      createRange(1, 1),
      { markers: [], trigger: 2, only: { value: "source.organizeImports" } } as never,
    )

    expect(idleActions.map((action) => action.title)).not.toContain("Organize Imports")
    expect(sourceActions.map((action) => action.title)).toEqual(["Organize Imports"])
  })

  it("registers only real refactor/source code action kinds", () => {
    const registerCodeActionProvider = vi.fn()
    const monaco = {
      languages: {
        CodeActionKind: {
          RefactorExtract: { value: "refactor.extract" },
          RefactorInline: { value: "refactor.inline" },
          SourceOrganizeImports: { value: "source.organizeImports" },
        },
        registerCodeActionProvider,
      },
    }

    registerRefactorProvider(monaco as never)

    expect(registerCodeActionProvider).toHaveBeenCalled()
    const provider = registerCodeActionProvider.mock.calls[0]?.[1]
    expect(provider.providedCodeActionKinds).toEqual([
      { value: "refactor.extract" },
      { value: "refactor.inline" },
      { value: "source.organizeImports" },
    ])
  })

  it("falls back to stable kind values when Monaco omits refactor constants", () => {
    const registerCodeActionProvider = vi.fn()
    const monaco = {
      languages: {
        CodeActionKind: {},
        registerCodeActionProvider,
      },
    }

    registerRefactorProvider(monaco as never)

    const provider = registerCodeActionProvider.mock.calls[0]?.[1]
    expect(provider.providedCodeActionKinds).toEqual([
      { value: "refactor.extract" },
      { value: "refactor.inline" },
      { value: "source.organizeImports" },
    ])
  })
})
