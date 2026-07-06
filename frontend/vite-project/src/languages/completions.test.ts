import { beforeEach, describe, expect, it, vi } from "vitest"
import { editorLanguageFeatureService } from "../editor/editorLanguageFeatureService"
import { registerAllLanguageProviders, reloadLanguageProviders } from "./completions"

const engineState = vi.hoisted(() => ({
  registerAllIntellisense: vi.fn(() => ({ dispose: vi.fn() })),
  reloadIntellisense: vi.fn(() => ({ dispose: vi.fn() })),
}))

const snippetState = vi.hoisted(() => ({
  registerAllSnippetProviders: vi.fn(() => ({ dispose: vi.fn() })),
}))

const emmetState = vi.hoisted(() => ({
  registerEmmetProvider: vi.fn(() => ({ dispose: vi.fn() })),
}))

const refactorState = vi.hoisted(() => ({
  registerRefactorProvider: vi.fn(() => ({ dispose: vi.fn() })),
}))

const signatureState = vi.hoisted(() => ({
  registerSignatureProvider: vi.fn(() => ({ dispose: vi.fn() })),
}))

const lspState = vi.hoisted(() => ({
  registerLspProviders: vi.fn(() => ({ dispose: vi.fn() })),
}))

vi.mock("./intellisense/engine", () => engineState)
vi.mock("./snippets/snippetProvider", () => snippetState)
vi.mock("./emmet/emmetProvider", () => emmetState)
vi.mock("./refactor/refactorProvider", () => refactorState)
vi.mock("./intellisense/signatureProvider", () => signatureState)
vi.mock("./lsp/adapters", () => lspState)

describe("language provider registration lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reloads providers by disposing the previous combined registration before rebuilding", () => {
    const monaco = {}
    const firstDispose = vi.fn()
    const secondDispose = vi.fn()
    engineState.registerAllIntellisense.mockReturnValueOnce({ dispose: firstDispose })
    engineState.reloadIntellisense.mockReturnValueOnce({ dispose: secondDispose })

    registerAllLanguageProviders(monaco as never)
    reloadLanguageProviders(monaco as never)

    expect(firstDispose).toHaveBeenCalledTimes(1)
    expect(engineState.registerAllIntellisense).toHaveBeenCalledWith(monaco)
    expect(engineState.reloadIntellisense).toHaveBeenCalledWith(monaco)
    expect(snippetState.registerAllSnippetProviders).toHaveBeenCalledTimes(2)
    expect(emmetState.registerEmmetProvider).toHaveBeenCalledTimes(2)
    expect(refactorState.registerRefactorProvider).toHaveBeenCalledTimes(2)
    expect(signatureState.registerSignatureProvider).toHaveBeenCalledTimes(2)
    expect(lspState.registerLspProviders).toHaveBeenCalledTimes(2)
    expect(secondDispose).not.toHaveBeenCalled()
  })

  it("does not leave duplicate editor feature registrations after reload", () => {
    const monaco = {
      languages: {
        registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerSignatureHelpProvider: vi.fn(() => ({ dispose: vi.fn() })),
        registerCodeActionProvider: vi.fn(() => ({ dispose: vi.fn() })),
      },
    }

    registerAllLanguageProviders(monaco as never)
    const initialProjection = editorLanguageFeatureService.createStateProjection().features
    reloadLanguageProviders(monaco as never)
    const reloadedProjection = editorLanguageFeatureService.createStateProjection().features

    expect(reloadedProjection.completion.count).toBe(initialProjection.completion.count)
    expect(reloadedProjection.signatureHelp.count).toBe(initialProjection.signatureHelp.count)
    expect(reloadedProjection.codeAction.count).toBe(initialProjection.codeAction.count)
  })
})
