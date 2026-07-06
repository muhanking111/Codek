export type DocumentUri = string
export type URI = string
export type LSPAny = string | number | boolean | null | LSPAny[] | { [key: string]: LSPAny }

export interface Position {
  line: number
  character: number
}

export interface Range {
  start: Position
  end: Position
}

export interface Location {
  uri: DocumentUri
  range: Range
}

export interface LocationLink {
  originSelectionRange?: Range
  targetUri: DocumentUri
  targetRange: Range
  targetSelectionRange: Range
}

export interface TextDocumentIdentifier {
  uri: DocumentUri
}

export interface VersionedTextDocumentIdentifier {
  uri: DocumentUri
  version: number
}

export interface OptionalVersionedTextDocumentIdentifier {
  uri: DocumentUri
  version: number | null
}

export interface TextDocumentItem {
  uri: DocumentUri
  languageId: string
  version: number
  text: string
}

export const enum TextDocumentSyncKind {
  None = 0,
  Full = 1,
  Incremental = 2,
}

export interface TextDocumentSyncOptions {
  openClose?: boolean
  change?: TextDocumentSyncKind
  willSave?: boolean
  willSaveWaitUntil?: boolean
  save?: boolean | SaveOptions
}

export interface SaveOptions {
  includeText?: boolean
}

export interface TextDocumentContentChangeEvent {
  range?: Range
  rangeLength?: number
  text: string
}

export interface TextDocumentChangeRegistrationOptions {
  documentSelector: DocumentSelector
  syncKind: TextDocumentSyncKind
}

export type DocumentSelector = DocumentFilter[]

export interface DocumentFilter {
  language?: string
  scheme?: string
  pattern?: string
}

export interface DidOpenTextDocumentParams {
  textDocument: TextDocumentItem
}

export interface DidChangeTextDocumentParams {
  textDocument: VersionedTextDocumentIdentifier
  contentChanges: TextDocumentContentChangeEvent[]
}

export interface DidCloseTextDocumentParams {
  textDocument: TextDocumentIdentifier
}

export interface DidSaveTextDocumentParams {
  textDocument: TextDocumentIdentifier
  text?: string
}

export interface WillSaveTextDocumentParams {
  textDocument: TextDocumentIdentifier
  reason: TextDocumentSaveReason
}

export const enum TextDocumentSaveReason {
  Manual = 1,
  AfterDelay = 2,
  FocusOut = 3,
}

export const enum MarkupKind {
  PlainText = "plaintext",
  Markdown = "markdown",
}

export interface MarkupContent {
  kind: MarkupKind
  value: string
}

export type MarkedString = string | MarkupContent | { language: string; value: string }

export const enum CompletionItemKind {
  Text = 1,
  Method = 2,
  Function = 3,
  Constructor = 4,
  Field = 5,
  Variable = 6,
  Class = 7,
  Interface = 8,
  Module = 9,
  Property = 10,
  Unit = 11,
  Value = 12,
  Enum = 13,
  Keyword = 14,
  Snippet = 15,
  Color = 16,
  File = 17,
  Reference = 18,
  Folder = 19,
  EnumMember = 20,
  Constant = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25,
}

export const enum CompletionItemTag {
  Deprecated = 1,
}

export interface CompletionItem {
  label: string
  labelDetails?: CompletionItemLabelDetails
  kind?: CompletionItemKind
  tags?: CompletionItemTag[]
  detail?: string
  documentation?: string | MarkupContent
  deprecated?: boolean
  preselect?: boolean
  sortText?: string
  filterText?: string
  insertText?: string
  insertTextFormat?: InsertTextFormat
  insertTextMode?: InsertTextMode
  textEdit?: TextEdit | InsertReplaceEdit
  textEditText?: string
  additionalTextEdits?: TextEdit[]
  commitCharacters?: string[]
  data?: LSPAny
}

export interface CompletionItemLabelDetails {
  detail?: string
  description?: string
}

export const enum InsertTextFormat {
  PlainText = 1,
  Snippet = 2,
}

export const enum InsertTextMode {
  AsIs = 1,
  AdjustIndentation = 2,
}

export interface InsertReplaceEdit {
  newText: string
  insert: Range
  replace: Range
}

export interface CompletionList {
  isIncomplete: boolean
  itemDefaults?: {
    commitCharacters?: string[]
    editRange?: Range | { insert: Range; replace: Range }
    insertTextFormat?: InsertTextFormat
    insertTextMode?: InsertTextMode
    data?: LSPAny
  }
  items: CompletionItem[]
}

export const enum CompletionTriggerKind {
  Invoked = 1,
  TriggerCharacter = 2,
  TriggerForIncompleteCompletions = 3,
}

export interface CompletionContext {
  triggerKind: CompletionTriggerKind
  triggerCharacter?: string
}

export interface CompletionParams {
  textDocument: TextDocumentIdentifier
  position: Position
  workDoneToken?: ProgressToken
  partialResultToken?: ProgressToken
  context?: CompletionContext
}

export type ProgressToken = number | string

export interface Hover {
  contents: MarkupContent | MarkedString[]
  range?: Range
}

export interface HoverParams {
  textDocument: TextDocumentIdentifier
  position: Position
  workDoneToken?: ProgressToken
}

export type Definition = Location | Location[]
export type DefinitionLink = LocationLink[]

export interface DefinitionParams {
  textDocument: TextDocumentIdentifier
  position: Position
  workDoneToken?: ProgressToken
  partialResultToken?: ProgressToken
}

export interface ReferenceContext {
  includeDeclaration: boolean
}

export interface ReferenceParams {
  textDocument: TextDocumentIdentifier
  position: Position
  context: ReferenceContext
  workDoneToken?: ProgressToken
  partialResultToken?: ProgressToken
}

export interface RenameParams {
  textDocument: TextDocumentIdentifier
  position: Position
  newName: string
  workDoneToken?: ProgressToken
}

export interface PrepareRenameParams {
  textDocument: TextDocumentIdentifier
  position: Position
  workDoneToken?: ProgressToken
}

export interface PrepareRenameResult {
  range: Range
  placeholder: string
}

export const enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export const enum SymbolTag {
  Deprecated = 1,
}

export interface DocumentSymbol {
  name: string
  detail?: string
  kind: SymbolKind
  tags?: SymbolTag[]
  deprecated?: boolean
  range: Range
  selectionRange: Range
  children?: DocumentSymbol[]
}

export interface DocumentSymbolParams {
  textDocument: TextDocumentIdentifier
  workDoneToken?: ProgressToken
  partialResultToken?: ProgressToken
}

export interface WorkspaceSymbol {
  name: string
  kind: SymbolKind
  tags?: SymbolTag[]
  containerName?: string
  location: Location | { uri: DocumentUri; range: Range }
  data?: LSPAny
}

export interface WorkspaceSymbolParams {
  query: string
  workDoneToken?: ProgressToken
  partialResultToken?: ProgressToken
}

export const enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export const enum DiagnosticTag {
  Unnecessary = 1,
  Deprecated = 2,
}

export interface DiagnosticRelatedInformation {
  location: Location
  message: string
}

export interface CodeDescription {
  href: URI
}

export interface Diagnostic {
  range: Range
  severity?: DiagnosticSeverity
  code?: number | string
  codeDescription?: CodeDescription
  source?: string
  message: string
  tags?: DiagnosticTag[]
  relatedInformation?: DiagnosticRelatedInformation[]
  data?: LSPAny
}

export interface PublishDiagnosticsParams {
  uri: DocumentUri
  version?: number
  diagnostics: Diagnostic[]
}

export const enum CodeActionKind {
  Empty = "",
  QuickFix = "quickfix",
  Refactor = "refactor",
  RefactorExtract = "refactor.extract",
  RefactorInline = "refactor.inline",
  RefactorRewrite = "refactor.rewrite",
  Source = "source",
  SourceOrganizeImports = "source.organizeImports",
  SourceFixAll = "source.fixAll",
}

export interface CodeActionContext {
  diagnostics: Diagnostic[]
  only?: CodeActionKind[]
  triggerKind?: CodeActionTriggerKind
}

export const enum CodeActionTriggerKind {
  Invoked = 1,
  Automatic = 2,
}

export interface CodeAction {
  title: string
  kind?: CodeActionKind
  diagnostics?: Diagnostic[]
  isPreferred?: boolean
  disabled?: { reason: string }
  edit?: WorkspaceEdit
  command?: Command
  data?: LSPAny
}

export interface Command {
  title: string
  command: string
  arguments?: LSPAny[]
}

export interface CodeLens {
  range: Range
  command?: Command
  data?: LSPAny
}

export interface CodeLensParams {
  textDocument: TextDocumentIdentifier
  workDoneToken?: ProgressToken
  partialResultToken?: ProgressToken
}

export interface CodeActionParams {
  textDocument: TextDocumentIdentifier
  range: Range
  context: CodeActionContext
  workDoneToken?: ProgressToken
  partialResultToken?: ProgressToken
}

export interface TextEdit {
  range: Range
  newText: string
}

export interface AnnotatedTextEdit extends TextEdit {
  annotationId: ChangeAnnotationIdentifier
}

export type ChangeAnnotationIdentifier = string

export interface ChangeAnnotation {
  label: string
  needsConfirmation?: boolean
  description?: string
}

export interface RenameFile {
  kind: "rename"
  oldUri: DocumentUri
  newUri: DocumentUri
  options?: RenameFileOptions
  annotationId?: ChangeAnnotationIdentifier
}

export interface RenameFileOptions {
  overwrite?: boolean
  ignoreIfExists?: boolean
}

export interface CreateFile {
  kind: "create"
  uri: DocumentUri
  options?: CreateFileOptions
  annotationId?: ChangeAnnotationIdentifier
}

export interface CreateFileOptions {
  overwrite?: boolean
  ignoreIfExists?: boolean
}

export interface DeleteFile {
  kind: "delete"
  uri: DocumentUri
  options?: DeleteFileOptions
  annotationId?: ChangeAnnotationIdentifier
}

export interface DeleteFileOptions {
  recursive?: boolean
  ignoreIfNotExists?: boolean
}

export type DocumentChange = TextEdit | CreateFile | RenameFile | DeleteFile

export interface WorkspaceEdit {
  changes?: Record<DocumentUri, TextEdit[]>
  documentChanges?: DocumentChange[]
  changeAnnotations?: Record<ChangeAnnotationIdentifier, ChangeAnnotation>
}

export interface SignatureHelp {
  signatures: SignatureInformation[]
  activeSignature?: number
  activeParameter?: number
}

export interface SignatureInformation {
  label: string
  documentation?: string | MarkupContent
  parameters?: ParameterInformation[]
  activeParameter?: number
}

export interface ParameterInformation {
  label: string | [number, number]
  documentation?: string | MarkupContent
}

export interface SignatureHelpParams {
  textDocument: TextDocumentIdentifier
  position: Position
  workDoneToken?: ProgressToken
  context?: SignatureHelpContext
}

export interface SignatureHelpContext {
  triggerKind: SignatureHelpTriggerKind
  triggerCharacter?: string
  isRetrigger: boolean
  activeSignatureHelp?: SignatureHelp
}

export const enum SignatureHelpTriggerKind {
  Invoked = 1,
  TriggerCharacter = 2,
  ContentChange = 3,
}

export interface TextDocumentRegistrationOptions {
  documentSelector: DocumentSelector | null
}

export interface WorkDoneProgressParams {
  workDoneToken?: ProgressToken
}

export interface PartialResultParams {
  partialResultToken?: ProgressToken
}

export interface InitializeParams {
  processId: number | null
  clientInfo?: { name: string; version?: string }
  locale?: string
  rootPath?: string | null
  rootUri: DocumentUri | null
  initializationOptions?: LSPAny
  capabilities: ClientCapabilities
  trace?: TraceValue
  workspaceFolders?: WorkspaceFolder[] | null
}

export const enum TraceValue {
  Off = "off",
  Messages = "messages",
  Verbose = "verbose",
}

export interface ClientCapabilities {
  workspace?: WorkspaceClientCapabilities
  textDocument?: TextDocumentClientCapabilities
  window?: WindowClientCapabilities
  general?: GeneralClientCapabilities
  experimental?: LSPAny
}

export interface WorkspaceClientCapabilities {
  applyEdit?: boolean
  workspaceEdit?: WorkspaceEditClientCapabilities
  didChangeConfiguration?: { dynamicRegistration?: boolean }
  didChangeWatchedFiles?: { dynamicRegistration?: boolean; relativePatternSupport?: boolean }
  symbol?: WorkspaceSymbolClientCapabilities
  executeCommand?: { dynamicRegistration?: boolean }
  workspaceFolders?: boolean
  configuration?: boolean
  semanticTokens?: { refreshSupport?: boolean }
  codeLens?: { refreshSupport?: boolean }
  fileOperations?: {
    dynamicRegistration?: boolean
    didCreate?: boolean
    willCreate?: boolean
    didRename?: boolean
    willRename?: boolean
    didDelete?: boolean
    willDelete?: boolean
  }
}

export interface WorkspaceEditClientCapabilities {
  documentChanges?: boolean
  resourceOperations?: ResourceOperationKind[]
  failureHandling?: FailureHandlingKind
  normalizesLineEndings?: boolean
  changeAnnotationSupport?: { groupsOnLabel?: boolean }
}

export type ResourceOperationKind = "create" | "rename" | "delete"
export type FailureHandlingKind = "abort" | "transactional" | "undo" | "textOnlyTransactional"

export interface WorkspaceSymbolClientCapabilities {
  dynamicRegistration?: boolean
  symbolKind?: { valueSet?: SymbolKind[] }
  tagSupport?: { valueSet: SymbolTag[] }
  resolveSupport?: { properties: string[] }
}

export interface TextDocumentClientCapabilities {
  synchronization?: TextDocumentSyncClientCapabilities
  completion?: CompletionClientCapabilities
  hover?: HoverClientCapabilities
  signatureHelp?: SignatureHelpClientCapabilities
  declaration?: { dynamicRegistration?: boolean; linkSupport?: boolean }
  definition?: DefinitionClientCapabilities
  typeDefinition?: { dynamicRegistration?: boolean; linkSupport?: boolean }
  implementation?: { dynamicRegistration?: boolean; linkSupport?: boolean }
  references?: { dynamicRegistration?: boolean }
  documentHighlight?: { dynamicRegistration?: boolean }
  documentSymbol?: DocumentSymbolClientCapabilities
  codeAction?: CodeActionClientCapabilities
  codeLens?: { dynamicRegistration?: boolean }
  documentLink?: { dynamicRegistration?: boolean; tooltipSupport?: boolean }
  colorProvider?: { dynamicRegistration?: boolean }
  formatting?: { dynamicRegistration?: boolean }
  rangeFormatting?: { dynamicRegistration?: boolean }
  onTypeFormatting?: { dynamicRegistration?: boolean }
  rename?: RenameClientCapabilities
  publishDiagnostics?: PublishDiagnosticsClientCapabilities
  foldingRange?: { dynamicRegistration?: boolean; rangeLimit?: number; lineFoldingOnly?: boolean }
  selectionRange?: { dynamicRegistration?: boolean }
  linkedEditingRange?: { dynamicRegistration?: boolean }
  callHierarchy?: { dynamicRegistration?: boolean }
  semanticTokens?: {
    dynamicRegistration?: boolean
    requests: { range?: boolean; full?: boolean | { delta?: boolean } }
    tokenTypes: string[]
    tokenModifiers: string[]
    formats: TokenFormat[]
    overlappingTokenSupport?: boolean
    multilineTokenSupport?: boolean
    serverCancelSupport?: boolean
    augmentsSyntaxTokens?: boolean
  }
  moniker?: { dynamicRegistration?: boolean }
  typeHierarchy?: { dynamicRegistration?: boolean }
  inlineValue?: { dynamicRegistration?: boolean }
  inlayHint?: { dynamicRegistration?: boolean; resolveSupport?: { properties: string[] } }
  diagnostic?: {
    dynamicRegistration?: boolean
    relatedDocumentSupport?: boolean
  }
}

export type TokenFormat = "relative"

export interface TextDocumentSyncClientCapabilities {
  dynamicRegistration?: boolean
  willSave?: boolean
  willSaveWaitUntil?: boolean
  didSave?: boolean
}

export interface CompletionClientCapabilities {
  dynamicRegistration?: boolean
  completionItem?: {
    snippetSupport?: boolean
    commitCharactersSupport?: boolean
    documentationFormat?: MarkupKind[]
    deprecatedSupport?: boolean
    preselectSupport?: boolean
    tagSupport?: { valueSet: CompletionItemTag[] }
    insertReplaceSupport?: boolean
    resolveSupport?: { properties: string[] }
    insertTextModeSupport?: { valueSet: InsertTextMode[] }
    labelDetailsSupport?: boolean
  }
  completionItemKind?: { valueSet?: CompletionItemKind[] }
  contextSupport?: boolean
  insertTextMode?: InsertTextMode
}

export interface HoverClientCapabilities {
  dynamicRegistration?: boolean
  contentFormat?: MarkupKind[]
}

export interface SignatureHelpClientCapabilities {
  dynamicRegistration?: boolean
  signatureInformation?: {
    documentationFormat?: MarkupKind[]
    parameterInformation?: { labelOffsetSupport?: boolean }
    activeParameterSupport?: boolean
  }
  contextSupport?: boolean
}

export interface DefinitionClientCapabilities {
  dynamicRegistration?: boolean
  linkSupport?: boolean
}

export interface DocumentSymbolClientCapabilities {
  dynamicRegistration?: boolean
  symbolKind?: { valueSet?: SymbolKind[] }
  hierarchicalDocumentSymbolSupport?: boolean
  tagSupport?: { valueSet: SymbolTag[] }
  labelSupport?: boolean
}

export interface CodeActionClientCapabilities {
  dynamicRegistration?: boolean
  codeActionLiteralSupport?: {
    codeActionKind: { valueSet: CodeActionKind[] }
  }
  isPreferredSupport?: boolean
  disabledSupport?: boolean
  dataSupport?: boolean
  resolveSupport?: { properties: string[] }
  honorsChangeAnnotations?: boolean
}

export interface RenameClientCapabilities {
  dynamicRegistration?: boolean
  prepareSupport?: boolean
  prepareSupportDefaultBehavior?: PrepareSupportDefaultBehavior
  honorsChangeAnnotations?: boolean
}

export const enum PrepareSupportDefaultBehavior {
  Identifier = 1,
}

export interface PublishDiagnosticsClientCapabilities {
  relatedInformation?: boolean
  tagSupport?: { valueSet: DiagnosticTag[] }
  versionSupport?: boolean
  codeDescriptionSupport?: boolean
  dataSupport?: boolean
}

export interface WindowClientCapabilities {
  workDoneProgress?: boolean
  showMessage?: { messageActionItem?: { additionalPropertiesSupport?: boolean } }
  showDocument?: { support?: boolean }
}

export interface GeneralClientCapabilities {
  staleRequestSupport?: {
    cancel: boolean
    retryOnContentModified: string[]
  }
  regularExpressions?: { engine: string; version?: string }
  markdown?: { parser: string; version?: string; allowedTags?: string[] }
  positionEncodings?: PositionEncodingKind[]
}

export type PositionEncodingKind = "utf-8" | "utf-16" | "utf-32"

export interface WorkspaceFolder {
  uri: DocumentUri
  name: string
}

export interface InitializeResult {
  capabilities: ServerCapabilities
  serverInfo?: { name: string; version?: string }
}

export interface ServerCapabilities {
  positionEncoding?: PositionEncodingKind
  textDocumentSync?: TextDocumentSyncKind | TextDocumentSyncOptions
  completionProvider?: CompletionOptions
  hoverProvider?: boolean | { workDoneProgress?: boolean }
  signatureHelpProvider?: SignatureHelpOptions
  declarationProvider?: boolean | { workDoneProgress?: boolean; documentSelector?: DocumentSelector }
  definitionProvider?: boolean | { workDoneProgress?: boolean }
  typeDefinitionProvider?: boolean | { workDoneProgress?: boolean; documentSelector?: DocumentSelector }
  implementationProvider?: boolean | { workDoneProgress?: boolean; documentSelector?: DocumentSelector }
  referencesProvider?: boolean | { workDoneProgress?: boolean }
  documentHighlightProvider?: boolean | { workDoneProgress?: boolean }
  documentSymbolProvider?: boolean | { workDoneProgress?: boolean }
  codeActionProvider?: boolean | CodeActionOptions
  codeLensProvider?: CodeLensOptions
  documentLinkProvider?: DocumentLinkOptions
  colorProvider?: boolean | { documentSelector?: DocumentSelector; workDoneProgress?: boolean }
  workspaceSymbolProvider?: boolean | { workDoneProgress?: boolean }
  documentFormattingProvider?: boolean | { workDoneProgress?: boolean }
  documentRangeFormattingProvider?: boolean | { workDoneProgress?: boolean }
  documentOnTypeFormattingProvider?: DocumentOnTypeFormattingOptions
  renameProvider?: boolean | RenameOptions
  foldingRangeProvider?: boolean | { workDoneProgress?: boolean; documentSelector?: DocumentSelector }
  executeCommandProvider?: ExecuteCommandOptions
  selectionRangeProvider?: boolean | { workDoneProgress?: boolean; documentSelector?: DocumentSelector }
  linkedEditingRangeProvider?: boolean | { workDoneProgress?: boolean; documentSelector?: DocumentSelector }
  callHierarchyProvider?: boolean | { workDoneProgress?: boolean; documentSelector?: DocumentSelector }
  semanticTokensProvider?: SemanticTokensOptions
  monikerProvider?: boolean | { workDoneProgress?: boolean; documentSelector?: DocumentSelector }
  typeHierarchyProvider?: boolean | { workDoneProgress?: boolean; documentSelector?: DocumentSelector }
  inlineValueProvider?: boolean | { workDoneProgress?: boolean; documentSelector?: DocumentSelector }
  inlayHintProvider?: boolean | InlayHintOptions
  diagnosticProvider?: DiagnosticOptions
  workspace?: { workspaceFolders?: WorkspaceFoldersServerCapabilities; fileOperations?: FileOperationOptions }
  experimental?: LSPAny
}

export interface CompletionOptions {
  workDoneProgress?: boolean
  triggerCharacters?: string[]
  allCommitCharacters?: string[]
  resolveProvider?: boolean
  completionItem?: { labelDetailsSupport?: boolean }
}

export interface SignatureHelpOptions {
  triggerCharacters?: string[]
  retriggerCharacters?: string[]
  workDoneProgress?: boolean
}

export interface CodeActionOptions {
  workDoneProgress?: boolean
  codeActionKinds?: CodeActionKind[]
  resolveProvider?: boolean
}

export interface CodeLensOptions {
  workDoneProgress?: boolean
  resolveProvider?: boolean
}

export interface DocumentLinkOptions {
  workDoneProgress?: boolean
  tooltipSupport?: boolean
}

export interface DocumentOnTypeFormattingOptions {
  firstTriggerCharacter: string
  moreTriggerCharacter?: string[]
}

export interface RenameOptions {
  workDoneProgress?: boolean
  prepareProvider?: boolean
  documentSelector?: DocumentSelector
}

export interface ExecuteCommandOptions {
  commands: string[]
  workDoneProgress?: boolean
}

export interface SemanticTokensOptions {
  full?: boolean | { delta?: boolean }
  range?: boolean | { documentSelector?: DocumentSelector }
  legend: SemanticTokensLegend
  workDoneProgress?: boolean
}

export interface SemanticTokensLegend {
  tokenTypes: string[]
  tokenModifiers: string[]
}

export interface InlayHintOptions {
  workDoneProgress?: boolean
  resolveProvider?: boolean
  documentSelector?: DocumentSelector
}

export interface DiagnosticOptions {
  identifier?: string
  interFileDependencies: boolean
  workspaceDiagnostics: boolean
  workDoneProgress?: boolean
  documentSelector?: DocumentSelector
}

export interface WorkspaceFoldersServerCapabilities {
  supported?: boolean
  changeNotifications?: boolean | string
}

export interface FileOperationOptions {
  didCreate?: FileOperationRegistrationOptions
  willCreate?: FileOperationRegistrationOptions
  didRename?: FileOperationRegistrationOptions
  willRename?: FileOperationRegistrationOptions
  didDelete?: FileOperationRegistrationOptions
  willDelete?: FileOperationRegistrationOptions
}

export interface FileOperationRegistrationOptions {
  filters: FileOperationPattern[]
}

export interface FileOperationPattern {
  glob: string
  options?: FileOperationPatternOptions
}

export interface FileOperationPatternOptions {
  ignoreCase?: boolean
}

export interface InitializedParams {
  clientInfo?: { name: string; version?: string }
}

export interface LogMessageParams {
  type: MessageType
  message: string
}

export const enum MessageType {
  Error = 1,
  Warning = 2,
  Info = 3,
  Log = 4,
}

export interface ShowMessageParams {
  type: MessageType
  message: string
}

export interface WorkDoneProgressBegin {
  kind: "begin"
  title: string
  cancellable?: boolean
  message?: string
  percentage?: number
}

export interface WorkDoneProgressReport {
  kind: "report"
  cancellable?: boolean
  message?: string
  percentage?: number
}

export interface WorkDoneProgressEnd {
  kind: "end"
  message?: string
}
