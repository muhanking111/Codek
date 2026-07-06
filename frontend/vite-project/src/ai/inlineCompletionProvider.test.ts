import { beforeEach, describe, expect, it, vi } from "vitest"

const editorFeatureState = vi.hoisted(() => {
  let capturedProvider: any = null
  const registerInlineCompletionsProvider = vi.fn((_selector, provider) => {
    capturedProvider = provider
    return { dispose: vi.fn() }
  })

  return {
    registerInlineCompletionsProvider,
    getCapturedProvider: () => capturedProvider,
    reset: () => {
      capturedProvider = null
      registerInlineCompletionsProvider.mockClear()
    },
  }
})

const lspClientState = vi.hoisted(() => ({
  getCompletions: vi.fn(),
}))

vi.mock("../editor/editorLanguageFeatureService", () => ({
  editorLanguageFeatureService: {
    registerInlineCompletionsProvider: editorFeatureState.registerInlineCompletionsProvider,
  },
}))

vi.mock("../languages/lspClient", () => ({
  getCompletions: lspClientState.getCompletions,
}))

describe("inlineCompletionProvider", () => {
  beforeEach(() => {
    vi.resetModules()
    editorFeatureState.reset()
    lspClientState.getCompletions.mockReset()
  })

  it("uses the unified lspClient completion bridge for LSP fallback", async () => {
    lspClientState.getCompletions.mockResolvedValue([
      { name: "map", insertText: "mappedValue()" },
    ])

    const mod = await import("./inlineCompletionProvider")
    mod.setCompletionModelEnabled(false)
    mod.setLspFallbackEnabled(true)

    const legacyLspCompletions = vi.fn()
    ;(window as any).codek = {
      lsp: {
        completions: legacyLspCompletions,
      },
    }

    mod.registerInlineCompletionProvider({} as never)
    const provider = editorFeatureState.getCapturedProvider()

    const result = await provider.provideInlineCompletions(
      {
        uri: { toString: () => "file:///src/app.ts", path: "/src/app.ts" },
        getLineContent: () => "const value = ma",
      },
      { lineNumber: 1, column: 17 },
      {},
      { isCancellationRequested: false },
    )

    expect(lspClientState.getCompletions).toHaveBeenCalledWith("file:///src/app.ts", 1, 17)
    expect(legacyLspCompletions).not.toHaveBeenCalled()
    expect(result).toEqual({
      items: [
        {
          insertText: "mappedValue()",
          range: {
            startLineNumber: 1,
            endLineNumber: 1,
            startColumn: 17,
            endColumn: 30,
          },
        },
      ],
    })
  })
})
