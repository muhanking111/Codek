import { describe, expect, it, vi } from "vitest"
import {
  createLanguageFeatureOwnerEvidence,
  createEditorFeatureCommandRunner,
  EditorLanguageFeatureService,
  editorLanguageFeatureService,
  resolveEditorFeatureActionId,
  type EditorCodeActionProvider,
  type EditorReferenceProvider,
  type EditorRenameProvider,
} from "./editorLanguageFeatureService"

const fakeUri = { toString: () => "file:///workspace/src/main.ts" } as never

function createModel(languageId = "typescript") {
  return {
    uri: fakeUri,
    getLanguageId: () => languageId,
    getWordAtPosition: () => ({ word: "value", startColumn: 7, endColumn: 12 }),
  }
}

function createDisposableSpy() {
  return { dispose: vi.fn() }
}

describe("editorLanguageFeatureService", () => {
  it("registers providers by feature and disposes Monaco registrations when cancelled", () => {
    const monacoDisposable = createDisposableSpy()
    const registerReferenceProvider = vi.fn(() => monacoDisposable)
    const monaco = { languages: { registerReferenceProvider } }
    const provider: EditorReferenceProvider = { provideReferences: vi.fn(() => []) }

    const disposable = editorLanguageFeatureService.registerReferenceProvider("typescript", provider, monaco as never)

    expect(editorLanguageFeatureService.referenceProvider.has(createModel() as never)).toBe(true)
    expect(registerReferenceProvider).toHaveBeenCalledWith("typescript", provider)

    disposable.dispose()

    expect(monacoDisposable.dispose).toHaveBeenCalled()
    expect(editorLanguageFeatureService.referenceProvider.has(createModel() as never)).toBe(false)
  })

  it("projects rename edits through the ordered provider contract", async () => {
    const rejectingProvider: EditorRenameProvider = {
      provideRenameEdits: vi.fn(async () => ({ edits: [], rejectReason: "no rename here" })),
    }
    const acceptingProvider: EditorRenameProvider = {
      provideRenameEdits: vi.fn(async () => ({
        edits: [{
          resource: fakeUri,
          textEdit: {
            range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 12 },
            text: "nextValue",
          },
          versionId: undefined,
        }],
      })),
    }
    const rejectDisposable = editorLanguageFeatureService.registerRenameProvider("typescript", rejectingProvider)
    const acceptDisposable = editorLanguageFeatureService.registerRenameProvider("typescript", acceptingProvider)

    const result = await editorLanguageFeatureService.provideRenameEdits(
      createModel() as never,
      { lineNumber: 1, column: 8 },
      "nextValue",
    )

    expect(result?.rejectReason).toBeUndefined()
    expect(result?.edits).toHaveLength(1)
    expect(rejectingProvider.provideRenameEdits).toHaveBeenCalled()
    expect(acceptingProvider.provideRenameEdits).toHaveBeenCalled()

    rejectDisposable.dispose()
    acceptDisposable.dispose()
  })

  it("projects references through registered providers and preserves declaration context", async () => {
    const provider: EditorReferenceProvider = {
      provideReferences: vi.fn(async (_model, _position, context) => [
        {
          uri: fakeUri,
          range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 12 },
          includeDeclaration: context.includeDeclaration,
        } as never,
      ]),
    }
    const disposable = editorLanguageFeatureService.registerReferenceProvider("typescript", provider)

    const references = await editorLanguageFeatureService.provideReferences(
      createModel() as never,
      { lineNumber: 1, column: 8 },
      { includeDeclaration: false },
    )

    expect(references).toEqual([
      {
        uri: { toString: expect.any(Function) },
        range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 12 },
        includeDeclaration: false,
      },
    ])

    disposable.dispose()
  })

  it("filters code actions by requested kind and disposes provider lists", async () => {
    const listDisposable = createDisposableSpy()
    const provider: EditorCodeActionProvider = {
      providedCodeActionKinds: [{ value: "refactor.extract" }],
      provideCodeActions: vi.fn(async () => ({
        actions: [
          { title: "Extract Function", kind: "refactor.extract.function" },
          { title: "Quick Fix", kind: "quickfix" },
        ],
        dispose: listDisposable.dispose,
      })),
    }
    const disposable = editorLanguageFeatureService.registerCodeActionProvider("typescript", provider)

    const list = await editorLanguageFeatureService.provideCodeActions(
      createModel() as never,
      { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 12 },
      { markers: [], only: { value: "refactor" }, trigger: 2 },
    )

    expect(list.actions.map((action) => action.title)).toEqual(["Extract Function"])

    list.dispose()
    expect(listDisposable.dispose).toHaveBeenCalled()
    disposable.dispose()
  })

  it("routes legacy editor commands through the VS Code-style action ids", () => {
    const trigger = vi.fn()
    const runner = createEditorFeatureCommandRunner(() => ({ trigger }))

    runner("renameSymbol")
    runner("findReferences")
    runner("organizeImports")

    expect(trigger.mock.calls).toEqual([
      ["keyboard", "editor.action.rename", null],
      ["keyboard", "editor.action.goToReferences", null],
      ["keyboard", "editor.action.organizeImports", null],
    ])
    expect(resolveEditorFeatureActionId("codeAction")).toBe("editor.action.codeAction")
  })

  it("aggregates hover providers and keeps provider failures isolated", async () => {
    const service = new EditorLanguageFeatureService()
    service.registerHoverProvider("typescript", {
      provideHover: vi.fn(async () => ({ contents: [{ value: "type hover" }] })),
    }, undefined, { id: "lsp-hover", source: "lsp" })
    service.registerHoverProvider("typescript", {
      provideHover: vi.fn(async () => {
        throw new Error("bad hover")
      }),
    }, undefined, { id: "bad-hover", source: "test" })
    service.registerHoverProvider("typescript", {
      provideHover: vi.fn(async () => ({ contents: [{ value: "ext hover" }] })),
    }, undefined, { id: "legacy-hover", source: "ext-host", legacy: true })

    const hover = await service.provideHover(createModel() as never, { lineNumber: 1, column: 8 })

    expect(hover?.contents.map((item) => item.value)).toEqual(["type hover", "ext hover"])
    expect(service.createStateProjection(createModel() as never).features.hover).toEqual({
      count: 3,
      providers: [
        expect.objectContaining({ providerId: "lsp-hover", source: "lsp", legacy: false }),
        expect.objectContaining({ providerId: "bad-hover", source: "test", legacy: false }),
        expect.objectContaining({ providerId: "legacy-hover", source: "ext-host", legacy: true }),
      ],
    })
  })

  it("projects VS Code-style owner evidence from the existing language feature registry", () => {
    const service = new EditorLanguageFeatureService()
    const completionDisposable = service.registerCompletionItemProvider("typescript", {
      provideCompletionItems: vi.fn(async () => ({ suggestions: [] })),
    }, undefined, { id: "lsp-completion:typescript", source: "lsp" })
    const hoverDisposable = service.registerHoverProvider("typescript", {
      provideHover: vi.fn(async () => ({ contents: [{ value: "hover" }] })),
    }, undefined, { id: "lsp-hover:typescript", source: "lsp" })
    const codeActionDisposable = service.registerCodeActionProvider("typescript", {
      provideCodeActions: vi.fn(async () => ({ actions: [], dispose() {} })),
    }, undefined, { id: "lsp-code-action:typescript", source: "lsp" })

    const evidence = service.createOwnerEvidence(createModel() as never)

    expect(evidence.languageFeatureRegistryOwner).toEqual({
      id: "codek.editorLanguageFeatureService",
      source: "editorLanguageFeatureService",
      status: "connected",
      registryCount: 3,
      registryInstance: "existing",
    })
    expect(evidence.completionProviderOwner).toEqual({
      id: "codek.editorLanguageFeatureService.completionProvider",
      source: "lsp",
      status: "connected",
      providerCount: 1,
      providerIds: ["lsp-completion:typescript"],
    })
    expect(evidence.hoverProviderOwner).toEqual({
      id: "codek.editorLanguageFeatureService.hoverProvider",
      source: "lsp",
      status: "connected",
      providerCount: 1,
      providerIds: ["lsp-hover:typescript"],
    })
    expect(evidence.codeActionProviderOwner).toEqual({
      id: "codek.editorLanguageFeatureService.codeActionProvider",
      source: "lsp",
      status: "connected",
      providerCount: 1,
      providerIds: ["lsp-code-action:typescript"],
    })
    expect(evidence.modelLanguageSource).toEqual({
      id: "monaco.editor.ITextModel.getLanguageId",
      source: "monaco-model",
      status: "connected",
      languageId: "typescript",
    })
    expect(evidence.lspBridgeOwner).toEqual({
      id: "codek.languages.lsp.adapters",
      source: "lsp-adapter",
      status: "connected",
      providerIds: [
        "lsp-completion:typescript",
        "lsp-hover:typescript",
        "lsp-code-action:typescript",
      ],
    })
    expect(evidence.remainingEditorUiOwnerGap).toEqual({
      id: "codek.editor.ui.owner",
      status: "partial",
      source: "service-projection",
      reason: "Language feature providers are registered through the service contract, but full editor UI ownership still requires shell/editor wiring.",
      blockedBy: ["editor-shell-owner", "workbench-editor-widget-owner"],
    })

    completionDisposable.dispose()
    hoverDisposable.dispose()
    codeActionDisposable.dispose()
  })

  it("does not claim connected provider or UI owners for partial registry evidence", () => {
    const service = new EditorLanguageFeatureService()

    const evidence = service.createOwnerEvidence(createModel("python") as never)

    expect(evidence.languageFeatureRegistryOwner).toEqual({
      id: "codek.editorLanguageFeatureService",
      source: "editorLanguageFeatureService",
      status: "partial",
      registryCount: 0,
      registryInstance: "existing",
    })
    expect(evidence.completionProviderOwner.status).toBe("partial")
    expect(evidence.hoverProviderOwner.status).toBe("partial")
    expect(evidence.codeActionProviderOwner.status).toBe("partial")
    expect(evidence.lspBridgeOwner.status).toBe("partial")
    expect(evidence.remainingEditorUiOwnerGap.status).toBe("partial")
  })

  it("builds owner evidence from projection data without registering another provider registry", () => {
    const service = new EditorLanguageFeatureService()
    const registerSpy = vi.spyOn(service.completionProvider, "register")
    const projection = {
      features: {
        completion: {
          count: 1,
          providers: [{ providerId: "mock-completion", source: "mock", selector: "typescript", legacy: false }],
        },
        hover: {
          count: 0,
          providers: [],
        },
        codeAction: {
          count: 0,
          providers: [],
        },
      },
    }

    const evidence = createLanguageFeatureOwnerEvidence(projection as never, createModel() as never)

    expect(evidence.completionProviderOwner.providerIds).toEqual(["mock-completion"])
    expect(registerSpy).not.toHaveBeenCalled()
  })

  it("sorts and resolves CodeLens entries using provider rank before disposing source lists", async () => {
    const service = new EditorLanguageFeatureService()
    const disposeFirst = vi.fn()
    const disposeSecond = vi.fn()
    service.registerCodeLensProvider("typescript", {
      provideCodeLenses: vi.fn(async () => ({
        lenses: [
          { range: { startLineNumber: 5, startColumn: 2, endLineNumber: 5, endColumn: 4 }, data: "late" },
          { range: { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 12 }, data: "needs-resolve" },
        ],
        dispose: disposeFirst,
      })),
      resolveCodeLens: vi.fn(async (_model, lens) => ({
        ...lens,
        command: { id: "codek.runLens", title: "Run Lens" },
      })),
    }, undefined, { id: "primary-codelens", source: "lsp" })
    service.registerCodeLensProvider("typescript", {
      provideCodeLenses: vi.fn(async () => ({
        lenses: [
          {
            range: { startLineNumber: 1, startColumn: 4, endLineNumber: 1, endColumn: 6 },
            command: { id: "codek.extLens", title: "Ext Lens" },
          },
        ],
        dispose: disposeSecond,
      })),
    }, undefined, { id: "legacy-codelens", source: "ext-host", legacy: true })

    const lenses = await service.provideCodeLenses(createModel() as never, { itemResolveCount: 1 })

    expect(lenses.map((lens) => lens.command?.title || lens.data)).toEqual(["Run Lens", "Ext Lens", "late"])
    expect(disposeFirst).toHaveBeenCalled()
    expect(disposeSecond).toHaveBeenCalled()
  })

  it("provides inline completions with a request uuid and disposes provider lists", async () => {
    const service = new EditorLanguageFeatureService()
    const listDispose = vi.fn()
    const providerDispose = vi.fn()
    const seenRequestUuids: string[] = []
    service.registerInlineCompletionsProvider("typescript", {
      provideInlineCompletions: vi.fn(async (_model, position, context) => {
        seenRequestUuids.push(String(context.requestUuid))
        return {
          items: [
            {
              insertText: "return value",
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              },
            },
          ],
          dispose: listDispose,
        }
      }),
      disposeInlineCompletions: providerDispose,
    }, undefined, { id: "legacy-inline", source: "ai", legacy: true })

    const completions = await service.provideInlineCompletions(
      createModel() as never,
      { lineNumber: 2, column: 3 },
      { triggerKind: 1 },
    )

    expect(completions.items).toEqual([
      expect.objectContaining({ insertText: "return value" }),
    ])
    expect(seenRequestUuids[0]).toMatch(/^icr-/)

    completions.dispose?.()
    expect(listDispose).toHaveBeenCalled()
    expect(providerDispose).toHaveBeenCalledWith(expect.objectContaining({ items: expect.any(Array) }), { kind: "other" })
  })
})
