import { registerAllIntellisense, reloadIntellisense } from "./intellisense/engine"
import { registerAllSnippetProviders } from "./snippets/snippetProvider"
import { registerEmmetProvider } from "./emmet/emmetProvider"
import { registerRefactorProvider } from "./refactor/refactorProvider"
import { registerSignatureProvider } from "./intellisense/signatureProvider"
import { registerLspProviders } from "./lsp/adapters"
import { combineDisposables, NOOP_DISPOSABLE, type DisposableLike } from "./disposable"

type Monaco = typeof import("monaco-editor")

let registeredProvidersDisposable: DisposableLike = NOOP_DISPOSABLE

function registerProviders(monaco: Monaco): DisposableLike {
  return combineDisposables(
    registerAllIntellisense(monaco),
    registerAllSnippetProviders(monaco),
    registerEmmetProvider(monaco),
    registerRefactorProvider(monaco),
    registerSignatureProvider(monaco),
    registerLspProviders(monaco),
  )
}

export function registerAllLanguageProviders(monaco: Monaco): void {
  registeredProvidersDisposable.dispose()
  registeredProvidersDisposable = registerProviders(monaco)
}

export function reloadLanguageProviders(monaco: Monaco): void {
  registeredProvidersDisposable.dispose()
  registeredProvidersDisposable = combineDisposables(
    reloadIntellisense(monaco),
    registerAllSnippetProviders(monaco),
    registerEmmetProvider(monaco),
    registerRefactorProvider(monaco),
    registerSignatureProvider(monaco),
    registerLspProviders(monaco),
  )
}
