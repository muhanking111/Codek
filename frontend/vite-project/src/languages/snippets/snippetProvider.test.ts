import { afterEach, describe, expect, it } from "vitest"
import { editorLanguageFeatureService } from "../../editor/editorLanguageFeatureService"
import { snippetManager } from "./snippetManager"
import { registerSnippetProvider } from "./snippetProvider"

const monaco = {
  languages: {
    CompletionItemKind: { Snippet: 27 },
    CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    registerCompletionItemProvider: () => ({ dispose() {} }),
  },
}

describe("snippetProvider", () => {
  afterEach(() => {
    snippetManager.clear()
  })

  it("uses snippet registry prefixes and resolves variables for completion insert text", () => {
    snippetManager.registerSnippet({
      name: "Console log",
      prefix: ["clg", "log"],
      body: "console.log(${TM_FILENAME_BASE}, ${1:value})",
      description: "Log",
      scope: ["typescript"],
    })

    const disposable = registerSnippetProvider(monaco as never, ["typescript"])
    const model = {
      getLanguageId: () => "typescript",
      getWordUntilPosition: () => ({ word: "cl" }),
      uri: { path: "/workspace/src/app.ts" },
    }

    const provider = editorLanguageFeatureService.completionProvider.ordered(model as never).at(-1)!
    const result = provider.provideCompletionItems(model as never, { lineNumber: 3, column: 8 } as never, {} as never, {} as never)

    expect(result).toMatchObject({
      suggestions: [{
        label: "clg",
        insertText: "console.log(app, ${1:value})",
        detail: "Log",
        filterText: "clg log",
      }],
    })
    disposable.dispose()
  })
})
