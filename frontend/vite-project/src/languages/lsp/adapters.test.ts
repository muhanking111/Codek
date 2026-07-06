import { describe, expect, it } from "vitest"
import { EditorLanguageFeatureService } from "../../editor/editorLanguageFeatureService"
import { convertCodeLens, monacoPositionToLsp, registerLspProviders } from "./adapters"
import type { CodeLens } from "./protocol"

const monaco = {
  Range: class Range {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  },
}

describe("lsp adapters", () => {
  it("maps LSP CodeLens range, command, and data into the editor service contract", () => {
    const lens: CodeLens = {
      range: {
        start: { line: 2, character: 4 },
        end: { line: 2, character: 12 },
      },
      command: {
        title: "Run test",
        command: "codek.runTest",
        arguments: ["src/app.test.ts"],
      },
      data: { provider: "tsserver" },
    }

    expect(convertCodeLens(lens, monaco as never)).toEqual({
      range: {
        startLineNumber: 3,
        startColumn: 5,
        endLineNumber: 3,
        endColumn: 13,
      },
      command: {
        id: "codek.runTest",
        title: "Run test",
        arguments: ["src/app.test.ts"],
      },
      data: { provider: "tsserver" },
    })
  })

  it("converts Monaco positions to zero-based LSP positions for request contracts", () => {
    expect(monacoPositionToLsp({ lineNumber: 9, column: 4 })).toEqual({
      line: 8,
      character: 3,
    })
  })

  it("registers LSP providers without contacting a real language server when no server is running", async () => {
    const service = new EditorLanguageFeatureService()
    const monacoWithProviderRegistry = {
      ...monaco,
      languages: {
        CompletionItemKind: { Text: 18 },
        CompletionItemTag: { Deprecated: 1 },
        CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
        registerCompletionItemProvider: (_selector: unknown, provider: unknown) =>
          service.registerCompletionItemProvider("typescript", provider as never),
        registerHoverProvider: (_selector: unknown, provider: unknown) =>
          service.registerHoverProvider("typescript", provider as never),
        registerCodeActionProvider: (_selector: unknown, provider: unknown) =>
          service.registerCodeActionProvider("typescript", provider as never),
        registerReferenceProvider: () => ({ dispose() {} }),
        registerRenameProvider: () => ({ dispose() {} }),
        registerSignatureHelpProvider: () => ({ dispose() {} }),
        registerCodeLensProvider: () => ({ dispose() {} }),
        registerDefinitionProvider: () => ({ dispose() {} }),
        registerDocumentSymbolProvider: () => ({ dispose() {} }),
      },
      Uri: {
        parse: (value: string) => ({ toString: () => value }),
      },
      MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
      MarkerTag: { Unnecessary: 1, Deprecated: 2 },
    }
    const model = {
      uri: { toString: () => "file:///workspace/src/app.ts" },
      getLanguageId: () => "typescript",
    }

    const disposable = registerLspProviders(monacoWithProviderRegistry as never)

    const completions = await service.completionProvider
      .ordered(model as never)[0]
      ?.provideCompletionItems(model as never, { lineNumber: 1, column: 1 } as never, {} as never, {} as never)
    const hover = await service.provideHover(model as never, { lineNumber: 1, column: 1 })
    const actions = await service.provideCodeActions(
      model as never,
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
      { markers: [], trigger: 2 },
    )

    expect(completions).toEqual({ suggestions: [] })
    expect(hover).toBeNull()
    expect(actions.actions).toEqual([])

    disposable.dispose()
  })
})
