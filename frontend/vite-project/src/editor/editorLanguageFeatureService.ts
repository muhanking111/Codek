import type { editor, languages, IPosition, IRange } from "monaco-editor"

type Monaco = typeof import("monaco-editor")

export interface DisposableLike {
  dispose(): void
}

export type EditorLanguageSelector = string | string[] | languages.LanguageSelector

export interface EditorFeatureProviderMetadata {
  id?: string
  source?: string
  legacy?: boolean
}

export interface EditorReferenceProvider {
  provideReferences(
    model: editor.ITextModel,
    position: IPosition,
    context: languages.ReferenceContext,
  ): languages.ProviderResult<languages.Location[]>
}

export interface EditorRenameLocation {
  range: IRange
  text: string
  rejectReason?: string
}

export interface EditorRenameResult extends languages.WorkspaceEdit {
  rejectReason?: string
}

export interface EditorRenameProvider {
  resolveRenameLocation?(
    model: editor.ITextModel,
    position: IPosition,
  ): languages.ProviderResult<EditorRenameLocation>
  provideRenameEdits(
    model: editor.ITextModel,
    position: IPosition,
    newName: string,
  ): languages.ProviderResult<EditorRenameResult | null>
}

export interface EditorCodeActionProvider {
  providedCodeActionKinds?: Array<string | { value?: string }>
  provideCodeActions(
    model: editor.ITextModel,
    range: IRange,
    context: EditorCodeActionContext,
  ): languages.ProviderResult<languages.CodeActionList>
}

export type EditorCodeActionContext = Omit<languages.CodeActionContext, "only"> & {
  readonly only?: string | { value?: string }
}

export interface EditorHoverProvider {
  provideHover(
    model: editor.ITextModel,
    position: IPosition,
  ): languages.ProviderResult<languages.Hover | null>
}

export interface EditorCompletionItemProvider extends languages.CompletionItemProvider {}

export interface EditorSignatureHelpProvider extends languages.SignatureHelpProvider {}

export interface EditorCodeLensCommand {
  id: string
  title: string
  arguments?: unknown[]
}

export interface EditorCodeLens {
  range: IRange
  command?: EditorCodeLensCommand
  data?: unknown
}

export interface EditorCodeLensList {
  lenses: EditorCodeLens[]
  dispose?: () => void
}

export interface EditorCodeLensProvider {
  provideCodeLenses(model: editor.ITextModel): languages.ProviderResult<EditorCodeLensList | EditorCodeLens[] | null>
  resolveCodeLens?(model: editor.ITextModel, codeLens: EditorCodeLens): languages.ProviderResult<EditorCodeLens | null>
}

export interface EditorCodeLensItem {
  symbol: EditorCodeLens
  provider: EditorCodeLensProvider
  providerOrdinal: number
}

export interface EditorCodeLensModel extends DisposableLike {
  lenses: EditorCodeLensItem[]
}

export interface EditorInlineCompletion {
  insertText: string | { snippet: string }
  range?: IRange
  command?: EditorCodeLensCommand
  filterText?: string
  completeBracketPairs?: boolean
  data?: unknown
}

export interface EditorInlineCompletions {
  items: EditorInlineCompletion[]
  dispose?: () => void
}

export interface EditorInlineCompletionContext {
  triggerKind?: number
  selectedSuggestionInfo?: unknown
  requestUuid?: string
  [key: string]: unknown
}

export interface EditorCancellationToken {
  isCancellationRequested?: boolean
  onCancellationRequested?: unknown
}

export interface EditorInlineCompletionsProvider {
  groupId?: string
  yieldsToGroupIds?: string[]
  provideInlineCompletions(
    model: editor.ITextModel,
    position: IPosition,
    context: EditorInlineCompletionContext,
    token?: EditorCancellationToken,
  ): languages.ProviderResult<EditorInlineCompletions | null>
  handleItemDidShow?(
    completions: EditorInlineCompletions,
    item: EditorInlineCompletion,
    updatedInsertText?: string,
    editDeltaInfo?: unknown,
  ): void
  disposeInlineCompletions?(completions: EditorInlineCompletions, reason?: { kind: string }): void
}

export interface EditorFeatureRegistryProjectionEntry {
  selector: EditorLanguageSelector
  providerId: string
  source: string
  legacy: boolean
}

export interface EditorFeatureStateProjection {
  features: Record<string, { count: number; providers: EditorFeatureRegistryProjectionEntry[] }>
  ownerEvidence: LanguageFeatureOwnerEvidence
}

export type LanguageFeatureOwnerStatus = "connected" | "partial"

export interface LanguageFeatureRegistryOwnerEvidence {
  id: "codek.editorLanguageFeatureService"
  source: "editorLanguageFeatureService"
  status: LanguageFeatureOwnerStatus
  registryCount: number
  registryInstance: "existing"
}

export interface LanguageFeatureProviderOwnerEvidence {
  id:
    | "codek.editorLanguageFeatureService.completionProvider"
    | "codek.editorLanguageFeatureService.hoverProvider"
    | "codek.editorLanguageFeatureService.codeActionProvider"
  source: string
  status: LanguageFeatureOwnerStatus
  providerCount: number
  providerIds: string[]
}

export interface ModelLanguageSourceEvidence {
  id: "monaco.editor.ITextModel.getLanguageId"
  source: "monaco-model"
  status: LanguageFeatureOwnerStatus
  languageId: string | null
}

export interface LspBridgeOwnerEvidence {
  id: "codek.languages.lsp.adapters"
  source: "lsp-adapter"
  status: LanguageFeatureOwnerStatus
  providerIds: string[]
}

export interface RemainingEditorUiOwnerGapEvidence {
  id: "codek.editor.ui.owner"
  status: "partial"
  source: "service-projection"
  reason: string
  blockedBy: string[]
}

export interface LanguageFeatureOwnerEvidence {
  languageFeatureRegistryOwner: LanguageFeatureRegistryOwnerEvidence
  completionProviderOwner: LanguageFeatureProviderOwnerEvidence
  hoverProviderOwner: LanguageFeatureProviderOwnerEvidence
  codeActionProviderOwner: LanguageFeatureProviderOwnerEvidence
  modelLanguageSource: ModelLanguageSourceEvidence
  lspBridgeOwner: LspBridgeOwnerEvidence
  remainingEditorUiOwnerGap: RemainingEditorUiOwnerGapEvidence
}

export class EditorLanguageFeatureRegistry<TProvider> {
  private readonly entries: Array<{
    selector: EditorLanguageSelector
    provider: TProvider
    monacoDisposable?: DisposableLike
    metadata: EditorFeatureProviderMetadata
  }> = []

  register(
    selector: EditorLanguageSelector,
    provider: TProvider,
    monacoDisposable?: DisposableLike,
    metadata: EditorFeatureProviderMetadata = {},
  ): DisposableLike {
    const entry = { selector, provider, monacoDisposable, metadata }
    this.entries.push(entry)

    return {
      dispose: () => {
        const index = this.entries.indexOf(entry)
        if (index >= 0) this.entries.splice(index, 1)
        monacoDisposable?.dispose()
      },
    }
  }

  all(model: editor.ITextModel): TProvider[] {
    return this.entries
      .filter((entry) => matchesLanguageSelector(entry.selector, model))
      .map((entry) => entry.provider)
  }

  ordered(model: editor.ITextModel): TProvider[] {
    return this.all(model)
  }

  has(model: editor.ITextModel): boolean {
    return this.all(model).length > 0
  }

  project(model?: editor.ITextModel): EditorFeatureRegistryProjectionEntry[] {
    return this.entries
      .filter((entry) => !model || matchesLanguageSelector(entry.selector, model))
      .map((entry, index) => ({
        selector: entry.selector,
        providerId: entry.metadata.id || `${entry.metadata.source || "provider"}-${index}`,
        source: entry.metadata.source || "unknown",
        legacy: entry.metadata.legacy === true,
      }))
  }
}

export class EditorLanguageFeatureService {
  readonly completionProvider = new EditorLanguageFeatureRegistry<EditorCompletionItemProvider>()
  readonly referenceProvider = new EditorLanguageFeatureRegistry<EditorReferenceProvider>()
  readonly renameProvider = new EditorLanguageFeatureRegistry<EditorRenameProvider>()
  readonly codeActionProvider = new EditorLanguageFeatureRegistry<EditorCodeActionProvider>()
  readonly hoverProvider = new EditorLanguageFeatureRegistry<EditorHoverProvider>()
  readonly signatureHelpProvider = new EditorLanguageFeatureRegistry<EditorSignatureHelpProvider>()
  readonly codeLensProvider = new EditorLanguageFeatureRegistry<EditorCodeLensProvider>()
  readonly inlineCompletionsProvider = new EditorLanguageFeatureRegistry<EditorInlineCompletionsProvider>()

  registerCompletionItemProvider(
    selector: EditorLanguageSelector,
    provider: EditorCompletionItemProvider,
    monaco?: Monaco,
    metadata?: EditorFeatureProviderMetadata,
  ): DisposableLike {
    return this.completionProvider.register(
      selector,
      provider,
      monaco?.languages.registerCompletionItemProvider(selector as never, provider as never),
      metadata,
    )
  }

  registerReferenceProvider(
    selector: EditorLanguageSelector,
    provider: EditorReferenceProvider,
    monaco?: Monaco,
    metadata?: EditorFeatureProviderMetadata,
  ): DisposableLike {
    return this.referenceProvider.register(
      selector,
      provider,
      monaco?.languages.registerReferenceProvider(selector as never, provider as never),
      metadata,
    )
  }

  registerRenameProvider(
    selector: EditorLanguageSelector,
    provider: EditorRenameProvider,
    monaco?: Monaco,
    metadata?: EditorFeatureProviderMetadata,
  ): DisposableLike {
    return this.renameProvider.register(
      selector,
      provider,
      monaco?.languages.registerRenameProvider(selector as never, provider as never),
      metadata,
    )
  }

  registerCodeActionProvider(
    selector: EditorLanguageSelector,
    provider: EditorCodeActionProvider,
    monaco?: Monaco,
    metadata?: EditorFeatureProviderMetadata,
  ): DisposableLike {
    return this.codeActionProvider.register(
      selector,
      provider,
      monaco?.languages.registerCodeActionProvider(selector as never, provider as never),
      metadata,
    )
  }

  registerHoverProvider(
    selector: EditorLanguageSelector,
    provider: EditorHoverProvider,
    monaco?: Monaco,
    metadata?: EditorFeatureProviderMetadata,
  ): DisposableLike {
    return this.hoverProvider.register(
      selector,
      provider,
      monaco?.languages.registerHoverProvider(selector as never, provider as never),
      metadata,
    )
  }

  registerSignatureHelpProvider(
    selector: EditorLanguageSelector,
    provider: EditorSignatureHelpProvider,
    monaco?: Monaco,
    metadata?: EditorFeatureProviderMetadata,
  ): DisposableLike {
    return this.signatureHelpProvider.register(
      selector,
      provider,
      monaco?.languages.registerSignatureHelpProvider(selector as never, provider as never),
      metadata,
    )
  }

  registerCodeLensProvider(
    selector: EditorLanguageSelector,
    provider: EditorCodeLensProvider,
    monaco?: Monaco,
    metadata?: EditorFeatureProviderMetadata,
  ): DisposableLike {
    const registerCodeLensProvider = (monaco?.languages as {
      registerCodeLensProvider?: (selector: never, provider: never) => DisposableLike
    } | undefined)?.registerCodeLensProvider
    return this.codeLensProvider.register(
      selector,
      provider,
      registerCodeLensProvider?.(selector as never, provider as never),
      metadata,
    )
  }

  registerInlineCompletionsProvider(
    selector: EditorLanguageSelector,
    provider: EditorInlineCompletionsProvider,
    monaco?: Monaco,
    metadata?: EditorFeatureProviderMetadata,
  ): DisposableLike {
    const registerInlineCompletionsProvider = (monaco?.languages as {
      registerInlineCompletionsProvider?: (selector: never, provider: never) => DisposableLike
    } | undefined)?.registerInlineCompletionsProvider
    return this.inlineCompletionsProvider.register(
      selector,
      provider,
      registerInlineCompletionsProvider?.(selector as never, provider as never),
      metadata,
    )
  }

  async provideReferences(
    model: editor.ITextModel,
    position: IPosition,
    context: languages.ReferenceContext,
  ): Promise<languages.Location[]> {
    const results = await Promise.all(
      this.referenceProvider.ordered(model).map(async (provider) => {
        try {
          return (await provider.provideReferences(model, position, context)) || []
        } catch {
          return []
        }
      }),
    )
    return results.flat()
  }

  async resolveRenameLocation(
    model: editor.ITextModel,
    position: IPosition,
  ): Promise<EditorRenameLocation | null> {
    const rejects: string[] = []
    for (const provider of this.renameProvider.ordered(model)) {
      if (!provider.resolveRenameLocation) break
      const location = await provider.resolveRenameLocation(model, position)
      if (!location) continue
      if (location.rejectReason) {
        rejects.push(location.rejectReason)
        continue
      }
      return location
    }

    const word = model.getWordAtPosition(position)
    if (!word) return null
    return {
      range: {
        startLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn,
      },
      text: word.word,
      rejectReason: rejects.length ? rejects.join("\n") : undefined,
    }
  }

  async provideRenameEdits(
    model: editor.ITextModel,
    position: IPosition,
    newName: string,
  ): Promise<EditorRenameResult | null> {
    const rejects: string[] = []
    for (const provider of this.renameProvider.ordered(model)) {
      const result = await provider.provideRenameEdits(model, position, newName)
      if (!result) {
        rejects.push("No result.")
        continue
      }
      if (result.rejectReason) {
        rejects.push(result.rejectReason)
        continue
      }
      return result
    }
    return rejects.length ? { edits: [], rejectReason: rejects.join("\n") } : null
  }

  async provideCodeActions(
    model: editor.ITextModel,
    range: IRange,
    context: EditorCodeActionContext,
  ): Promise<languages.CodeActionList> {
    const disposables: DisposableLike[] = []
    const actions: languages.CodeAction[] = []
    const requestedKind = getCodeActionKindValue(context.only)

    for (const provider of this.codeActionProvider.ordered(model)) {
      if (requestedKind && !providerMayIncludeKind(provider, requestedKind)) continue
      try {
        const list = await provider.provideCodeActions(model, range, context)
        if (!list) continue
        disposables.push(list)
        actions.push(...list.actions.filter((action) => matchesRequestedCodeActionKind(action.kind, requestedKind)))
      } catch {
        // Keep one failing provider from breaking the editor lightbulb surface.
      }
    }

    return {
      actions,
      dispose: () => {
        for (const disposable of disposables) disposable.dispose()
      },
    }
  }

  async provideHovers(model: editor.ITextModel, position: IPosition): Promise<languages.Hover[]> {
    const hovers: languages.Hover[] = []
    for (const provider of this.hoverProvider.ordered(model)) {
      try {
        const hover = await provider.provideHover(model, position)
        if (isValidHover(hover)) hovers.push(hover)
      } catch {
        // Keep one failing provider from breaking the hover surface.
      }
    }
    return hovers
  }

  async provideHover(model: editor.ITextModel, position: IPosition): Promise<languages.Hover | null> {
    const hovers = await this.provideHovers(model, position)
    if (!hovers.length) return null
    return {
      contents: hovers.flatMap((hover) => hover.contents),
      range: hovers[0].range,
    }
  }

  async provideCodeLensModel(model: editor.ITextModel): Promise<EditorCodeLensModel> {
    const lenses: EditorCodeLensItem[] = []
    const disposables: DisposableLike[] = []
    const providers = this.codeLensProvider.ordered(model)

    await Promise.all(providers.map(async (provider, providerOrdinal) => {
      try {
        const provided = await provider.provideCodeLenses(model)
        if (!provided) return
        const list = Array.isArray(provided) ? { lenses: provided } : provided
        if (list.dispose) disposables.push({ dispose: list.dispose })
        for (const symbol of list.lenses) {
          lenses.push({ symbol, provider, providerOrdinal })
        }
      } catch {
        // Keep one failing provider from breaking the codelens surface.
      }
    }))

    lenses.sort(compareCodeLensItems)
    return {
      lenses,
      dispose: () => {
        for (const disposable of disposables) disposable.dispose()
      },
    }
  }

  async provideCodeLenses(
    model: editor.ITextModel,
    options: { itemResolveCount?: number | null } = {},
  ): Promise<EditorCodeLens[]> {
    const codeLensModel = await this.provideCodeLensModel(model)
    const result: EditorCodeLens[] = []
    let remainingResolveCount = options.itemResolveCount
    try {
      for (const item of codeLensModel.lenses) {
        const shouldResolve =
          remainingResolveCount !== undefined &&
          remainingResolveCount !== null &&
          !item.symbol.command &&
          remainingResolveCount > 0 &&
          !!item.provider.resolveCodeLens
        if (!shouldResolve) {
          result.push(item.symbol)
          continue
        }
        remainingResolveCount -= 1
        const resolved = await item.provider.resolveCodeLens?.(model, item.symbol)
        result.push(resolved || item.symbol)
      }
      return result
    } finally {
      codeLensModel.dispose()
    }
  }

  async provideInlineCompletions(
    model: editor.ITextModel,
    position: IPosition,
    context: EditorInlineCompletionContext = {},
    token?: EditorCancellationToken,
  ): Promise<EditorInlineCompletions> {
    const requestUuid = context.requestUuid || createRequestUuid("icr")
    const contextWithUuid = { ...context, requestUuid }
    const lists: Array<{ list: EditorInlineCompletions; provider: EditorInlineCompletionsProvider }> = []
    const items: EditorInlineCompletion[] = []

    for (const provider of this.inlineCompletionsProvider.ordered(model)) {
      if (isCancellationRequested(token)) break
      try {
        const list = await provider.provideInlineCompletions(model, position, contextWithUuid, token)
        if (!list) continue
        lists.push({ list, provider })
        items.push(...list.items)
      } catch {
        // Keep one failing provider from breaking ghost text.
      }
    }

    return {
      items,
      dispose: () => {
        for (const { list, provider } of lists) {
          list.dispose?.()
          provider.disposeInlineCompletions?.(list, { kind: "other" })
        }
      },
    }
  }

  createStateProjection(model?: editor.ITextModel): EditorFeatureStateProjection {
    const projection = {
      features: {
        completion: createRegistryProjection(this.completionProvider, model),
        reference: createRegistryProjection(this.referenceProvider, model),
        rename: createRegistryProjection(this.renameProvider, model),
        codeAction: createRegistryProjection(this.codeActionProvider, model),
        hover: createRegistryProjection(this.hoverProvider, model),
        signatureHelp: createRegistryProjection(this.signatureHelpProvider, model),
        codeLens: createRegistryProjection(this.codeLensProvider, model),
        inlineCompletions: createRegistryProjection(this.inlineCompletionsProvider, model),
      },
    }
    return {
      ...projection,
      ownerEvidence: createLanguageFeatureOwnerEvidence(projection, model),
    }
  }

  createOwnerEvidence(model?: editor.ITextModel): LanguageFeatureOwnerEvidence {
    return this.createStateProjection(model).ownerEvidence
  }
}

export const editorLanguageFeatureService = new EditorLanguageFeatureService()

export type EditorFeatureCommand =
  | "codeAction"
  | "findReferences"
  | "organizeImports"
  | "renameSymbol"

const EDITOR_FEATURE_ACTIONS: Record<EditorFeatureCommand, string> = {
  codeAction: "editor.action.codeAction",
  findReferences: "editor.action.goToReferences",
  organizeImports: "editor.action.organizeImports",
  renameSymbol: "editor.action.rename",
}

export function resolveEditorFeatureActionId(command: EditorFeatureCommand): string {
  return EDITOR_FEATURE_ACTIONS[command]
}

export function createEditorFeatureCommandRunner(
  getEditor: () => { trigger?: (source: string, handlerId: string, payload: unknown) => void } | null | undefined,
): (command: EditorFeatureCommand, source?: string) => void {
  return (command, source = "keyboard") => {
    getEditor()?.trigger?.(source, resolveEditorFeatureActionId(command), null)
  }
}

function matchesLanguageSelector(selector: EditorLanguageSelector, model: editor.ITextModel): boolean {
  const languageId = model.getLanguageId()
  if (typeof selector === "string") return selector === languageId || selector === "*"
  if (Array.isArray(selector)) return selector.includes(languageId) || selector.includes("*")
  const candidate = selector as { language?: string; scheme?: string }
  if (candidate.language && candidate.language !== languageId) return false
  if (candidate.scheme && candidate.scheme !== "*") {
    const modelScheme = String((model.uri as { scheme?: string })?.scheme || "")
    if (candidate.scheme !== modelScheme) return false
  }
  return true
}

function providerMayIncludeKind(provider: EditorCodeActionProvider, requestedKind: string): boolean {
  const providedKinds = provider.providedCodeActionKinds?.map(getCodeActionKindValue).filter(Boolean) as string[] | undefined
  if (!providedKinds?.length) return true
  return providedKinds.some((kind) => kindIncludes(kind, requestedKind) || kindIncludes(requestedKind, kind))
}

function matchesRequestedCodeActionKind(kind: unknown, requestedKind?: string): boolean {
  if (!requestedKind) return true
  const actionKind = getCodeActionKindValue(kind)
  return !actionKind || kindIncludes(requestedKind, actionKind) || kindIncludes(actionKind, requestedKind)
}

function kindIncludes(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}.`)
}

function getCodeActionKindValue(kind: unknown): string | undefined {
  if (!kind) return undefined
  if (typeof kind === "string") return kind
  if (typeof kind === "object" && "value" in kind) return String((kind as { value?: unknown }).value || "")
  return String(kind)
}

function createRegistryProjection<TProvider>(
  registry: EditorLanguageFeatureRegistry<TProvider>,
  model?: editor.ITextModel,
): { count: number; providers: EditorFeatureRegistryProjectionEntry[] } {
  const providers = registry.project(model)
  return { count: providers.length, providers }
}

export function createLanguageFeatureOwnerEvidence(
  projection: Pick<EditorFeatureStateProjection, "features">,
  model?: editor.ITextModel,
): LanguageFeatureOwnerEvidence {
  const completion = projection.features.completion || { count: 0, providers: [] }
  const hover = projection.features.hover || { count: 0, providers: [] }
  const codeAction = projection.features.codeAction || { count: 0, providers: [] }
  const trackedProviderCount = completion.count + hover.count + codeAction.count
  const lspProviderIds = [
    ...completion.providers,
    ...hover.providers,
    ...codeAction.providers,
  ]
    .filter((provider) => provider.source === "lsp")
    .map((provider) => provider.providerId)

  return {
    languageFeatureRegistryOwner: {
      id: "codek.editorLanguageFeatureService",
      source: "editorLanguageFeatureService",
      status: trackedProviderCount > 0 ? "connected" : "partial",
      registryCount: trackedProviderCount,
      registryInstance: "existing",
    },
    completionProviderOwner: createProviderOwnerEvidence(
      "codek.editorLanguageFeatureService.completionProvider",
      completion,
    ),
    hoverProviderOwner: createProviderOwnerEvidence(
      "codek.editorLanguageFeatureService.hoverProvider",
      hover,
    ),
    codeActionProviderOwner: createProviderOwnerEvidence(
      "codek.editorLanguageFeatureService.codeActionProvider",
      codeAction,
    ),
    modelLanguageSource: {
      id: "monaco.editor.ITextModel.getLanguageId",
      source: "monaco-model",
      status: model ? "connected" : "partial",
      languageId: model?.getLanguageId() ?? null,
    },
    lspBridgeOwner: {
      id: "codek.languages.lsp.adapters",
      source: "lsp-adapter",
      status: lspProviderIds.length > 0 ? "connected" : "partial",
      providerIds: lspProviderIds,
    },
    remainingEditorUiOwnerGap: {
      id: "codek.editor.ui.owner",
      status: "partial",
      source: "service-projection",
      reason: "Language feature providers are registered through the service contract, but full editor UI ownership still requires shell/editor wiring.",
      blockedBy: ["editor-shell-owner", "workbench-editor-widget-owner"],
    },
  }
}

function createProviderOwnerEvidence(
  id: LanguageFeatureProviderOwnerEvidence["id"],
  feature: { count: number; providers: EditorFeatureRegistryProjectionEntry[] },
): LanguageFeatureProviderOwnerEvidence {
  const providerIds = feature.providers.map((provider) => provider.providerId)
  return {
    id,
    source: resolveProviderOwnerSource(feature.providers),
    status: feature.count > 0 ? "connected" : "partial",
    providerCount: feature.count,
    providerIds,
  }
}

function resolveProviderOwnerSource(providers: EditorFeatureRegistryProjectionEntry[]): string {
  if (providers.length === 0) return "service-projection"
  const sources = [...new Set(providers.map((provider) => provider.source))]
  return sources.length === 1 ? sources[0] : "mixed"
}

function isValidHover(hover: languages.Hover | null | undefined): hover is languages.Hover {
  return Array.isArray(hover?.contents) && hover.contents.length > 0
}

function compareCodeLensItems(a: EditorCodeLensItem, b: EditorCodeLensItem): number {
  if (a.symbol.range.startLineNumber !== b.symbol.range.startLineNumber) {
    return a.symbol.range.startLineNumber - b.symbol.range.startLineNumber
  }
  if (a.providerOrdinal !== b.providerOrdinal) {
    return a.providerOrdinal - b.providerOrdinal
  }
  return a.symbol.range.startColumn - b.symbol.range.startColumn
}

function createRequestUuid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function isCancellationRequested(token: EditorCancellationToken | undefined): boolean {
  return token?.isCancellationRequested === true
}
