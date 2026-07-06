import type { Event } from "../vscode-adapter/base/common/event"
import { Emitter } from "../vscode-adapter/base/common/event"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"

// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\notebook\common\notebookService.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\notebook\common\notebookEditorModel.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\notebook\common\notebookKernelService.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\notebook\common\notebookRendererMessagingService.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\markdown\browser\markdown.contribution.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\webview\browser\webviewService.ts
//
// Codek keeps this runtime self-contained: no SourceMirror imports, no second editor
// state store, and no UI binding until App.vue can safely delegate its internal
// markdown preview state to this service.

export type NotebookCellKind = "markup" | "code"
export type WorkbenchDocumentChangeKind =
  | "notebook-open"
  | "notebook-update"
  | "notebook-dispose"
  | "markdown-open"
  | "markdown-refresh"
  | "markdown-dispose"

export interface NotebookCellInput {
  readonly handle?: number
  readonly kind?: NotebookCellKind
  readonly languageId?: string
  readonly source?: string
  readonly metadata?: Record<string, unknown>
  readonly outputs?: readonly NotebookCellOutput[]
}

export interface NotebookCellOutput {
  readonly mime: string
  readonly value: string
}

export interface NotebookDocumentInput {
  readonly uri: string
  readonly viewType?: string
  readonly metadata?: Record<string, unknown>
  readonly cells?: readonly NotebookCellInput[]
  readonly readonly?: boolean | string
  readonly conflict?: boolean
  readonly dirty?: boolean
  readonly backupId?: string
}

export interface NotebookCellModel {
  readonly handle: number
  readonly index: number
  readonly kind: NotebookCellKind
  readonly languageId: string
  readonly source: string
  readonly metadata: Record<string, unknown>
  readonly outputs: readonly NotebookCellOutput[]
}

export interface NotebookDocumentModel {
  readonly uri: string
  readonly viewType: string
  readonly metadata: Record<string, unknown>
  readonly cells: readonly NotebookCellModel[]
  readonly versionId: number
  readonly cellCount: number
  readonly disposed: boolean
  readonly readonly: boolean | string
  readonly conflict: boolean
  readonly dirty: boolean
  readonly backupId?: string
}

export interface NotebookSnapshot {
  readonly source: "notebookMarkdownPreviewService"
  readonly documentCount: number
  readonly activeResource: string
  readonly documents: readonly NotebookDocumentModel[]
}

export interface NotebookDocumentProjection {
  readonly uri: string
  readonly viewType: string
  readonly versionId: number
  readonly cellCount: number
  readonly readonly: boolean
  readonly readonlyReason: string
  readonly conflict: boolean
  readonly dirty: boolean
  readonly backupId?: string
}

export interface NotebookBackupSnapshot {
  readonly backupId: string
  readonly uri: string
  readonly viewType: string
  readonly versionId: number
  readonly cellCount: number
  readonly readonly: boolean | string
  readonly conflict: boolean
  readonly dirty: boolean
  readonly snapshot: string
}

export interface NotebookSerializerData {
  readonly metadata?: Record<string, unknown>
  readonly cells?: readonly NotebookCellInput[]
}

export interface NotebookSerializer {
  dataToNotebook(data: string): NotebookSerializerData | Promise<NotebookSerializerData>
  notebookToData(document: NotebookDocumentModel): string | Promise<string>
}

export interface NotebookKernelDescriptor {
  readonly id: string
  readonly label: string
  readonly viewType: string
  readonly supportedLanguages?: readonly string[]
}

export interface NotebookRendererDescriptor {
  readonly id: string
  readonly mimeTypes: readonly string[]
  readonly messaging?: boolean
}

export interface NotebookRendererMessage {
  readonly rendererId: string
  readonly uri: string
  readonly type: string
  readonly payload?: unknown
}

export interface NotebookKernelProjection {
  readonly source: "notebookKernelService"
  readonly kernelCount: number
  readonly selectedKernelCount: number
  readonly selectedKernelId: string
  readonly selectedKernelLabel: string
  readonly kernels: readonly NotebookKernelDescriptor[]
}

export interface NotebookRendererProjection {
  readonly source: "notebookRendererMessagingService"
  readonly rendererOwner: "notebookMarkdownPreviewService"
  readonly messageChannelOwner: "notebookRendererMessagingService"
  readonly previewSource: "notebookMarkdownPreviewService"
  readonly rendererCount: number
  readonly rendererIds: readonly string[]
  readonly allowedMessageKinds: readonly NotebookRendererMessageKind[]
  readonly messageBridgeReady: boolean
  readonly uiOwnerConnected: boolean
  readonly blockedGaps: readonly NotebookRendererBlockedGap[]
  readonly rendererMessageCount: number
  readonly messages: readonly NotebookRendererMessageEvidence[]
}

export type NotebookRendererMessageKind = "renderer-to-extension" | "extension-to-renderer"
export type NotebookRendererBlockedGap = "notebook-editor-webview-owner" | "markdown-preview-webview-owner"

export interface NotebookRendererMessageEvidence {
  readonly kind: NotebookRendererMessageKind
  readonly rendererId: string
  readonly uri: string
  readonly type: string
  readonly payloadKeys: readonly string[]
  readonly payloadMetadata: NotebookRendererPayloadMetadata
}

export interface NotebookRendererPayloadMetadata {
  readonly kind: "none" | "object" | "array" | "string" | "number" | "boolean" | "unknown"
  readonly keyCount: number
  readonly keys: readonly string[]
}

export interface NotebookSmokeEvidence {
  readonly source: "notebookMarkdownPreviewService"
  readonly notebookServiceId: "notebookService"
  readonly serializerCount: number
  readonly notebookDocumentCount: number
  readonly activeNotebookResource: string
  readonly notebookDirtyCount: number
  readonly notebookConflictCount: number
  readonly notebookBackupCount: number
  readonly notebookKernelCount: number
  readonly selectedNotebookKernelCount: number
  readonly rendererOwner: "notebookMarkdownPreviewService"
  readonly messageChannelOwner: "notebookRendererMessagingService"
  readonly rendererAllowedMessageKinds: readonly NotebookRendererMessageKind[]
  readonly rendererUiOwnerConnected: boolean
  readonly rendererBlockedGaps: readonly NotebookRendererBlockedGap[]
  readonly notebookRendererCount: number
  readonly rendererMessageBridgeReady: boolean
  readonly rendererMessageCount: number
  readonly markdownPreviewCount: number
  readonly activeMarkdownResource: string
}

export interface MarkdownPreviewInput {
  readonly resource: string
  readonly content?: string
  readonly title?: string
  readonly sideBySide?: boolean
  readonly locked?: boolean
  readonly source?: "editor" | "command" | "legacy"
}

export interface MarkdownPreviewModel {
  readonly id: string
  readonly resource: string
  readonly previewResource: string
  readonly title: string
  readonly content: string
  readonly html: string
  readonly versionId: number
  readonly sideBySide: boolean
  readonly locked: boolean
  readonly disposed: boolean
  readonly lifecycle: "open" | "refresh" | "dispose"
  readonly source: "editor" | "command" | "legacy"
}

export interface MarkdownPreviewSnapshot {
  readonly source: "notebookMarkdownPreviewService"
  readonly previewCount: number
  readonly activeResource: string
  readonly previews: readonly MarkdownPreviewModel[]
}

export interface WorkbenchDocumentChangeEvent {
  readonly kind: WorkbenchDocumentChangeKind
  readonly resource: string
  readonly versionId: number
}

export interface INotebookWorkbenchService {
  readonly _serviceBrand: undefined
  readonly onDidChange: Event<WorkbenchDocumentChangeEvent>
  canResolve(viewType: string): Promise<boolean>
  registerNotebookSerializer(viewType: string, serializer: NotebookSerializer): { dispose(): void }
  createNotebookTextModel(viewType: string, uri: string, data?: string): Promise<NotebookDocumentModel>
  saveNotebookTextModel(uri: string): Promise<string>
  backupNotebookTextModel(uri: string, backupId?: string): Promise<NotebookBackupSnapshot | undefined>
  restoreNotebookTextModelFromSnapshot(uri: string, viewType: string, snapshot: string): Promise<NotebookDocumentModel>
  registerNotebookKernel(kernel: NotebookKernelDescriptor): { dispose(): void }
  selectNotebookKernel(uri: string, kernelId: string): boolean
  getNotebookKernelProjection(uri?: string): NotebookKernelProjection
  registerNotebookRenderer(renderer: NotebookRendererDescriptor): { dispose(): void }
  postNotebookRendererMessage(message: NotebookRendererMessage): boolean
  getNotebookRendererProjection(): NotebookRendererProjection
  openNotebookDocument(input: NotebookDocumentInput): NotebookDocumentModel
  updateNotebookCells(uri: string, cells: readonly NotebookCellInput[]): NotebookDocumentModel
  updateNotebookLifecycle(uri: string, lifecycle: Partial<Pick<NotebookDocumentModel, "readonly" | "conflict" | "dirty" | "backupId">>): boolean
  getNotebookDocumentProjection(uri: string): NotebookDocumentProjection | undefined
  getNotebookTextModel(uri: string): NotebookDocumentModel | undefined
  listNotebookDocuments(): readonly NotebookDocumentModel[]
  disposeNotebookDocument(uri: string): boolean
  getNotebookSnapshot(uri?: string): NotebookSnapshot
}

export interface IMarkdownPreviewWorkbenchService {
  readonly _serviceBrand: undefined
  readonly onDidChange: Event<WorkbenchDocumentChangeEvent>
  openMarkdownPreview(input: MarkdownPreviewInput): MarkdownPreviewModel
  refreshMarkdownPreview(resource: string, content?: string): MarkdownPreviewModel | null
  getMarkdownPreview(resource: string): MarkdownPreviewModel | undefined
  listMarkdownPreviews(): readonly MarkdownPreviewModel[]
  disposeMarkdownPreview(resource?: string): boolean
  getMarkdownPreviewSnapshot(resource?: string): MarkdownPreviewSnapshot
}

export const INotebookWorkbenchService = createDecorator<INotebookWorkbenchService>("notebookService")
export const IMarkdownPreviewWorkbenchService = createDecorator<IMarkdownPreviewWorkbenchService>("markdownPreviewService")
export const INotebookService = INotebookWorkbenchService

const NOTEBOOK_RENDERER_OWNER = "notebookMarkdownPreviewService" as const
const NOTEBOOK_RENDERER_MESSAGE_CHANNEL_OWNER = "notebookRendererMessagingService" as const
const NOTEBOOK_RENDERER_ALLOWED_MESSAGE_KINDS: readonly NotebookRendererMessageKind[] = [
  "renderer-to-extension",
  "extension-to-renderer",
]
const NOTEBOOK_RENDERER_BLOCKED_GAPS: readonly NotebookRendererBlockedGap[] = [
  "notebook-editor-webview-owner",
  "markdown-preview-webview-owner",
]

export class NotebookMarkdownPreviewWorkbenchService implements INotebookWorkbenchService, IMarkdownPreviewWorkbenchService {
  declare readonly _serviceBrand: undefined

  private readonly onDidChangeEmitter = new Emitter<WorkbenchDocumentChangeEvent>()
  readonly onDidChange = this.onDidChangeEmitter.event

  private readonly notebooks = new Map<string, NotebookDocumentModel>()
  private readonly markdownPreviews = new Map<string, MarkdownPreviewModel>()
  private readonly serializers = new Map<string, NotebookSerializer>()
  private readonly notebookBackups = new Map<string, NotebookBackupSnapshot>()
  private readonly notebookKernels = new Map<string, NotebookKernelDescriptor>()
  private readonly selectedNotebookKernels = new Map<string, string>()
  private readonly notebookRenderers = new Map<string, NotebookRendererDescriptor>()
  private readonly notebookRendererMessages: NotebookRendererMessageEvidence[] = []
  private activeNotebookResource = ""
  private activeMarkdownResource = ""

  async canResolve(viewType: string): Promise<boolean> {
    return this.serializers.has(normalizeResource(viewType))
  }

  registerNotebookSerializer(viewType: string, serializer: NotebookSerializer): { dispose(): void } {
    const key = normalizeResource(viewType)
    this.serializers.set(key, serializer)
    return {
      dispose: () => {
        if (this.serializers.get(key) === serializer) this.serializers.delete(key)
      },
    }
  }

  async createNotebookTextModel(
    viewType: string,
    uri: string,
    data = "",
  ): Promise<NotebookDocumentModel> {
    const key = normalizeResource(viewType)
    const serializer = this.serializers.get(key)
    const parsed = serializer ? await serializer.dataToNotebook(data) : parseNotebookJsonData(data)
    return this.openNotebookDocument({
      uri,
      viewType: key || "notebook",
      metadata: parsed.metadata || {},
      cells: parsed.cells || [],
      readonly: false,
      conflict: false,
      dirty: false,
    })
  }

  async saveNotebookTextModel(uri: string): Promise<string> {
    const document = this.getNotebookTextModel(uri)
    if (!document) return ""
    const serializer = this.serializers.get(document.viewType)
    if (serializer) return serializer.notebookToData(document)
    return JSON.stringify({
      metadata: document.metadata,
      cells: document.cells,
    })
  }

  async backupNotebookTextModel(uri: string, backupId = `notebook-backup:${Date.now()}`): Promise<NotebookBackupSnapshot | undefined> {
    const document = this.getNotebookTextModel(uri)
    if (!document) return undefined
    const snapshot = await this.saveNotebookTextModel(uri)
    const backup: NotebookBackupSnapshot = {
      backupId,
      uri: document.uri,
      viewType: document.viewType,
      versionId: document.versionId,
      cellCount: document.cellCount,
      readonly: document.readonly,
      conflict: document.conflict,
      dirty: document.dirty,
      snapshot,
    }
    this.notebookBackups.set(document.uri, backup)
    this.replaceNotebookDocument({
      uri: document.uri,
      viewType: document.viewType,
      metadata: document.metadata,
      cells: document.cells,
      readonly: document.readonly,
      conflict: document.conflict,
      dirty: document.dirty,
      backupId,
      versionId: document.versionId + 1,
      kind: "notebook-update",
    })
    return backup
  }

  async restoreNotebookTextModelFromSnapshot(
    uri: string,
    viewType: string,
    snapshot: string,
  ): Promise<NotebookDocumentModel> {
    const key = normalizeResource(viewType)
    const serializer = this.serializers.get(key)
    const parsed = serializer ? await serializer.dataToNotebook(snapshot) : parseNotebookJsonData(snapshot)
    const existing = this.getNotebookTextModel(uri)
    if (!existing) {
      return this.openNotebookDocument({
        uri,
        viewType: key || "notebook",
        metadata: parsed.metadata || {},
        cells: parsed.cells || [],
        readonly: false,
        conflict: false,
        dirty: false,
      })
    }
    return this.replaceNotebookDocument({
      uri,
      viewType: key || existing.viewType,
      metadata: parsed.metadata || {},
      cells: parsed.cells || [],
      readonly: existing.readonly,
      conflict: existing.conflict,
      dirty: existing.dirty,
      backupId: existing.backupId,
      versionId: existing.versionId + 1,
      kind: "notebook-update",
    })
  }

  registerNotebookKernel(kernel: NotebookKernelDescriptor): { dispose(): void } {
    const normalized = normalizeNotebookKernelDescriptor(kernel)
    this.notebookKernels.set(normalized.id, normalized)
    return {
      dispose: () => {
        if (this.notebookKernels.get(normalized.id) !== normalized) return
        this.notebookKernels.delete(normalized.id)
        for (const [uri, selectedKernelId] of this.selectedNotebookKernels) {
          if (selectedKernelId === normalized.id) this.selectedNotebookKernels.delete(uri)
        }
      },
    }
  }

  selectNotebookKernel(uri: string, kernelId: string): boolean {
    const resource = normalizeResource(uri)
    const document = this.getNotebookTextModel(resource)
    const kernel = this.notebookKernels.get(normalizeResource(kernelId))
    if (!document || !kernel || !kernelSupportsDocument(kernel, document)) return false
    this.selectedNotebookKernels.set(resource, kernel.id)
    this.activeNotebookResource = resource
    this.emit("notebook-update", resource, document.versionId)
    return true
  }

  getNotebookKernelProjection(uri?: string): NotebookKernelProjection {
    const resource = normalizeResource(uri || this.activeNotebookResource)
    const selectedKernelId = resource ? this.selectedNotebookKernels.get(resource) || "" : ""
    const selectedKernel = selectedKernelId ? this.notebookKernels.get(selectedKernelId) : undefined
    return {
      source: "notebookKernelService",
      kernelCount: this.notebookKernels.size,
      selectedKernelCount: this.selectedNotebookKernels.size,
      selectedKernelId,
      selectedKernelLabel: selectedKernel?.label || "",
      kernels: [...this.notebookKernels.values()],
    }
  }

  registerNotebookRenderer(renderer: NotebookRendererDescriptor): { dispose(): void } {
    const normalized = normalizeNotebookRendererDescriptor(renderer)
    this.notebookRenderers.set(normalized.id, normalized)
    return {
      dispose: () => {
        if (this.notebookRenderers.get(normalized.id) === normalized) {
          this.notebookRenderers.delete(normalized.id)
        }
      },
    }
  }

  postNotebookRendererMessage(message: NotebookRendererMessage): boolean {
    const renderer = this.notebookRenderers.get(normalizeResource(message.rendererId))
    const document = this.getNotebookTextModel(message.uri)
    if (!renderer || renderer.messaging !== true || !document) return false
    this.notebookRendererMessages.push({
      kind: "renderer-to-extension",
      rendererId: renderer.id,
      uri: document.uri,
      type: String(message.type || ""),
      payloadKeys: getPayloadKeys(message.payload),
      payloadMetadata: getPayloadMetadata(message.payload),
    })
    return true
  }

  getNotebookRendererProjection(): NotebookRendererProjection {
    const renderers = [...this.notebookRenderers.values()]
    return {
      source: "notebookRendererMessagingService",
      rendererOwner: NOTEBOOK_RENDERER_OWNER,
      messageChannelOwner: NOTEBOOK_RENDERER_MESSAGE_CHANNEL_OWNER,
      previewSource: NOTEBOOK_RENDERER_OWNER,
      rendererCount: renderers.length,
      rendererIds: renderers.map((renderer) => renderer.id),
      allowedMessageKinds: NOTEBOOK_RENDERER_ALLOWED_MESSAGE_KINDS,
      messageBridgeReady: renderers.some((renderer) => renderer.messaging === true),
      uiOwnerConnected: false,
      blockedGaps: NOTEBOOK_RENDERER_BLOCKED_GAPS,
      rendererMessageCount: this.notebookRendererMessages.length,
      messages: [...this.notebookRendererMessages],
    }
  }

  openNotebookDocument(input: NotebookDocumentInput): NotebookDocumentModel {
    const uri = normalizeResource(input.uri)
    const existing = this.notebooks.get(uri)
    const document = createNotebookDocumentModel({
      uri,
      viewType: input.viewType || existing?.viewType || "notebook",
      metadata: input.metadata || existing?.metadata || {},
      cells: input.cells || existing?.cells || [],
      readonly: input.readonly ?? existing?.readonly ?? false,
      conflict: input.conflict ?? existing?.conflict ?? false,
      dirty: input.dirty ?? existing?.dirty ?? false,
      backupId: input.backupId ?? existing?.backupId,
      versionId: existing ? existing.versionId + 1 : 1,
      disposed: false,
    })
    this.notebooks.set(uri, document)
    this.activeNotebookResource = uri
    this.emit("notebook-open", uri, document.versionId)
    return document
  }

  updateNotebookCells(uri: string, cells: readonly NotebookCellInput[]): NotebookDocumentModel {
    const resource = normalizeResource(uri)
    const existing = this.notebooks.get(resource)
    if (!existing || existing.disposed) {
      return this.openNotebookDocument({ uri: resource, cells })
    }
    const document = createNotebookDocumentModel({
      uri: resource,
      viewType: existing.viewType,
      metadata: existing.metadata,
      cells,
      readonly: existing.readonly,
      conflict: existing.conflict,
      dirty: true,
      backupId: existing.backupId,
      versionId: existing.versionId + 1,
      disposed: false,
    })
    this.notebooks.set(resource, document)
    this.activeNotebookResource = resource
    this.emit("notebook-update", resource, document.versionId)
    return document
  }

  updateNotebookLifecycle(
    uri: string,
    lifecycle: Partial<Pick<NotebookDocumentModel, "readonly" | "conflict" | "dirty" | "backupId">>,
  ): boolean {
    const resource = normalizeResource(uri)
    const existing = this.notebooks.get(resource)
    if (!existing || existing.disposed) return false
    const document = createNotebookDocumentModel({
      uri: resource,
      viewType: existing.viewType,
      metadata: existing.metadata,
      cells: existing.cells,
      readonly: lifecycle.readonly ?? existing.readonly,
      conflict: lifecycle.conflict ?? existing.conflict,
      dirty: lifecycle.dirty ?? existing.dirty,
      backupId: lifecycle.backupId ?? existing.backupId,
      versionId: existing.versionId + 1,
      disposed: false,
    })
    this.notebooks.set(resource, document)
    this.activeNotebookResource = resource
    this.emit("notebook-update", resource, document.versionId)
    return true
  }

  getNotebookDocumentProjection(uri: string): NotebookDocumentProjection | undefined {
    const document = this.getNotebookTextModel(uri)
    if (!document) return undefined
    const readonlyReason = typeof document.readonly === "string" ? document.readonly : ""
    return {
      uri: document.uri,
      viewType: document.viewType,
      versionId: document.versionId,
      cellCount: document.cellCount,
      readonly: document.readonly !== false,
      readonlyReason,
      conflict: document.conflict,
      dirty: document.dirty,
      backupId: document.backupId,
    }
  }

  getNotebookTextModel(uri: string): NotebookDocumentModel | undefined {
    const document = this.notebooks.get(normalizeResource(uri))
    return document?.disposed ? undefined : document
  }

  listNotebookDocuments(): readonly NotebookDocumentModel[] {
    return [...this.notebooks.values()].filter((document) => !document.disposed)
  }

  disposeNotebookDocument(uri: string): boolean {
    const resource = normalizeResource(uri)
    const document = this.notebooks.get(resource)
    if (!document || document.disposed) return false
    const disposed = { ...document, disposed: true }
    this.notebooks.delete(resource)
    if (this.activeNotebookResource === resource) this.activeNotebookResource = ""
    this.emit("notebook-dispose", resource, disposed.versionId)
    return true
  }

  getNotebookSnapshot(uri?: string): NotebookSnapshot {
    const activeResource = normalizeResource(uri || this.activeNotebookResource)
    const documents = activeResource
      ? this.listNotebookDocuments().filter((document) => document.uri === activeResource)
      : this.listNotebookDocuments()
    return {
      source: "notebookMarkdownPreviewService",
      documentCount: documents.length,
      activeResource,
      documents,
    }
  }

  openMarkdownPreview(input: MarkdownPreviewInput): MarkdownPreviewModel {
    const resource = normalizeResource(input.resource)
    const existing = this.markdownPreviews.get(resource)
    const model = createMarkdownPreviewModel({
      ...input,
      resource,
      content: input.content ?? existing?.content ?? "",
      versionId: existing ? existing.versionId + 1 : 1,
      lifecycle: "open",
      disposed: false,
    })
    this.markdownPreviews.set(resource, model)
    this.activeMarkdownResource = resource
    this.emit("markdown-open", resource, model.versionId)
    return model
  }

  refreshMarkdownPreview(resource: string, content?: string): MarkdownPreviewModel | null {
    const key = normalizeResource(resource)
    const existing = this.markdownPreviews.get(key)
    if (!existing || existing.disposed) return null
    const model = createMarkdownPreviewModel({
      ...existing,
      content: content ?? existing.content,
      versionId: existing.versionId + 1,
      lifecycle: "refresh",
      disposed: false,
    })
    this.markdownPreviews.set(key, model)
    this.activeMarkdownResource = key
    this.emit("markdown-refresh", key, model.versionId)
    return model
  }

  getMarkdownPreview(resource: string): MarkdownPreviewModel | undefined {
    const preview = this.markdownPreviews.get(normalizeResource(resource))
    return preview?.disposed ? undefined : preview
  }

  listMarkdownPreviews(): readonly MarkdownPreviewModel[] {
    return [...this.markdownPreviews.values()].filter((preview) => !preview.disposed)
  }

  disposeMarkdownPreview(resource?: string): boolean {
    const resources = resource ? [normalizeResource(resource)] : [...this.markdownPreviews.keys()]
    let disposed = false
    for (const key of resources) {
      const preview = this.markdownPreviews.get(key)
      if (!preview || preview.disposed) continue
      this.markdownPreviews.delete(key)
      if (this.activeMarkdownResource === key) this.activeMarkdownResource = ""
      this.emit("markdown-dispose", key, preview.versionId)
      disposed = true
    }
    return disposed
  }

  getMarkdownPreviewSnapshot(resource?: string): MarkdownPreviewSnapshot {
    const activeResource = normalizeResource(resource || this.activeMarkdownResource)
    const previews = activeResource
      ? this.listMarkdownPreviews().filter((preview) => preview.resource === activeResource)
      : this.listMarkdownPreviews()
    return {
      source: "notebookMarkdownPreviewService",
      previewCount: previews.length,
      activeResource,
      previews,
    }
  }

  clear(): void {
    this.notebooks.clear()
    this.markdownPreviews.clear()
    this.serializers.clear()
    this.notebookBackups.clear()
    this.notebookKernels.clear()
    this.selectedNotebookKernels.clear()
    this.notebookRenderers.clear()
    this.notebookRendererMessages.length = 0
    this.activeNotebookResource = ""
    this.activeMarkdownResource = ""
  }

  getSmokeEvidence(): NotebookSmokeEvidence {
    const rendererProjection = this.getNotebookRendererProjection()
    return {
      source: "notebookMarkdownPreviewService",
      notebookServiceId: "notebookService",
      serializerCount: this.serializers.size,
      notebookDocumentCount: this.listNotebookDocuments().length,
      activeNotebookResource: this.activeNotebookResource,
      notebookDirtyCount: this.listNotebookDocuments().filter((document) => document.dirty).length,
      notebookConflictCount: this.listNotebookDocuments().filter((document) => document.conflict).length,
      notebookBackupCount: this.notebookBackups.size,
      notebookKernelCount: this.notebookKernels.size,
      selectedNotebookKernelCount: this.selectedNotebookKernels.size,
      rendererOwner: rendererProjection.rendererOwner,
      messageChannelOwner: rendererProjection.messageChannelOwner,
      rendererAllowedMessageKinds: rendererProjection.allowedMessageKinds,
      rendererUiOwnerConnected: rendererProjection.uiOwnerConnected,
      rendererBlockedGaps: rendererProjection.blockedGaps,
      notebookRendererCount: rendererProjection.rendererCount,
      rendererMessageBridgeReady: rendererProjection.messageBridgeReady,
      rendererMessageCount: rendererProjection.rendererMessageCount,
      markdownPreviewCount: this.listMarkdownPreviews().length,
      activeMarkdownResource: this.activeMarkdownResource,
    }
  }

  private emit(kind: WorkbenchDocumentChangeKind, resource: string, versionId: number): void {
    this.onDidChangeEmitter.fire({ kind, resource, versionId })
  }

  private replaceNotebookDocument(input: {
    uri: string
    viewType: string
    metadata: Record<string, unknown>
    cells: readonly NotebookCellInput[]
    readonly: boolean | string
    conflict: boolean
    dirty: boolean
    backupId?: string
    versionId: number
    kind: WorkbenchDocumentChangeKind
  }): NotebookDocumentModel {
    const resource = normalizeResource(input.uri)
    const document = createNotebookDocumentModel({
      uri: resource,
      viewType: input.viewType,
      metadata: input.metadata,
      cells: input.cells,
      readonly: input.readonly,
      conflict: input.conflict,
      dirty: input.dirty,
      backupId: input.backupId,
      versionId: input.versionId,
      disposed: false,
    })
    this.notebooks.set(resource, document)
    this.activeNotebookResource = resource
    this.emit(input.kind, resource, document.versionId)
    return document
  }
}

export interface LegacyMarkdownPreviewController {
  setOpen(open: boolean, input?: Partial<MarkdownPreviewInput>): MarkdownPreviewModel | null
  refresh(resource: string, content?: string): MarkdownPreviewModel | null
  isOpen(resource?: string): boolean
  dispose(resource?: string): boolean
}

export function createLegacyMarkdownPreviewController(
  service: IMarkdownPreviewWorkbenchService,
): LegacyMarkdownPreviewController {
  return {
    setOpen(open, input = {}) {
      const resource = normalizeResource(input.resource || "markdown-preview")
      if (!open) {
        service.disposeMarkdownPreview(resource)
        return null
      }
      return service.openMarkdownPreview({
        resource,
        content: input.content || "",
        title: input.title,
        sideBySide: input.sideBySide,
        locked: input.locked,
        source: "legacy",
      })
    },
    refresh(resource, content) {
      return service.refreshMarkdownPreview(resource, content)
    },
    isOpen(resource) {
      if (resource) return Boolean(service.getMarkdownPreview(resource))
      return service.listMarkdownPreviews().length > 0
    },
    dispose(resource) {
      return service.disposeMarkdownPreview(resource)
    },
  }
}

export const globalNotebookMarkdownPreviewWorkbenchService = new NotebookMarkdownPreviewWorkbenchService()
export const globalLegacyMarkdownPreviewController = createLegacyMarkdownPreviewController(globalNotebookMarkdownPreviewWorkbenchService)

registerSingleton(INotebookWorkbenchService, globalNotebookMarkdownPreviewWorkbenchService, InstantiationType.Delayed)
registerSingleton(IMarkdownPreviewWorkbenchService, globalNotebookMarkdownPreviewWorkbenchService, InstantiationType.Delayed)

function createNotebookDocumentModel(input: {
  uri: string
  viewType: string
  metadata: Record<string, unknown>
  cells: readonly NotebookCellInput[]
  readonly?: boolean | string
  conflict?: boolean
  dirty?: boolean
  backupId?: string
  versionId: number
  disposed: boolean
}): NotebookDocumentModel {
  const cells = input.cells.map((cell, index) => normalizeNotebookCell(cell, index))
  return {
    uri: input.uri,
    viewType: input.viewType,
    metadata: { ...input.metadata },
    cells,
    versionId: input.versionId,
    cellCount: cells.length,
    disposed: input.disposed,
    readonly: input.readonly ?? false,
    conflict: input.conflict ?? false,
    dirty: input.dirty ?? false,
    backupId: input.backupId,
  }
}

function parseNotebookJsonData(data: string): NotebookSerializerData {
  if (!data) return { metadata: {}, cells: [] }
  try {
    const parsed = JSON.parse(data) as NotebookSerializerData
    return {
      metadata: parsed.metadata || {},
      cells: Array.isArray(parsed.cells) ? parsed.cells : [],
    }
  } catch {
    return { metadata: {}, cells: [{ languageId: "plaintext", source: data }] }
  }
}

function normalizeNotebookCell(cell: NotebookCellInput | NotebookCellModel, index: number): NotebookCellModel {
  const languageId = String(cell.languageId || "plaintext")
  return {
    handle: typeof cell.handle === "number" && Number.isFinite(cell.handle) ? cell.handle : index,
    index,
    kind: cell.kind || (languageId === "markdown" ? "markup" : "code"),
    languageId,
    source: String(cell.source || ""),
    metadata: { ...(cell.metadata || {}) },
    outputs: Array.isArray(cell.outputs) ? cell.outputs.map((output) => ({ mime: output.mime, value: output.value })) : [],
  }
}

function normalizeNotebookKernelDescriptor(kernel: NotebookKernelDescriptor): NotebookKernelDescriptor {
  return {
    id: normalizeResource(kernel.id),
    label: String(kernel.label || kernel.id || "Notebook Kernel"),
    viewType: normalizeResource(kernel.viewType || "notebook"),
    supportedLanguages: [...(kernel.supportedLanguages || [])].map((language) => normalizeResource(language)),
  }
}

function kernelSupportsDocument(kernel: NotebookKernelDescriptor, document: NotebookDocumentModel): boolean {
  if (kernel.viewType && kernel.viewType !== document.viewType) return false
  const languages = new Set((kernel.supportedLanguages || []).map((language) => normalizeResource(language)))
  if (languages.size === 0) return true
  return document.cells.some((cell) => languages.has(normalizeResource(cell.languageId)))
}

function normalizeNotebookRendererDescriptor(renderer: NotebookRendererDescriptor): NotebookRendererDescriptor {
  return {
    id: normalizeResource(renderer.id),
    mimeTypes: [...renderer.mimeTypes].map((mime) => normalizeResource(mime)),
    messaging: renderer.messaging === true,
  }
}

function createMarkdownPreviewModel(input: MarkdownPreviewInput & {
  resource: string
  content: string
  versionId: number
  lifecycle: MarkdownPreviewModel["lifecycle"]
  disposed: boolean
}): MarkdownPreviewModel {
  const title = input.title || `${basename(input.resource)} Preview`
  return {
    id: `markdown-preview:${input.resource}`,
    resource: input.resource,
    previewResource: `markdown-preview://${input.resource.replace(/^\/+/, "")}`,
    title,
    content: input.content,
    html: renderMinimalMarkdown(input.content),
    versionId: input.versionId,
    sideBySide: input.sideBySide === true,
    locked: input.locked === true,
    disposed: input.disposed,
    lifecycle: input.lifecycle,
    source: input.source || "command",
  }
}

function renderMinimalMarkdown(content: string): string {
  const lines = String(content || "").split(/\r?\n/)
  const html: string[] = []
  let listItems: string[] = []
  const flushList = () => {
    if (listItems.length === 0) return
    html.push("<ul>", ...listItems.map((item) => `<li>${escapeHtml(item)}</li>`), "</ul>")
    listItems = []
  }
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      flushList()
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      flushList()
      const level = heading[1].length
      html.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`)
      continue
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line)
    if (bullet) {
      listItems.push(bullet[1])
      continue
    }
    flushList()
    html.push(`<p>${escapeHtml(line)}</p>`)
  }
  flushList()
  return html.join("\n")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function normalizeResource(resource: string | null | undefined): string {
  return String(resource || "").replace(/\\/g, "/").trim()
}

function basename(resource: string): string {
  const normalized = normalizeResource(resource)
  return normalized.split("/").filter(Boolean).pop() || normalized || "Markdown"
}

function getPayloadKeys(payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return []
  return Object.keys(payload as Record<string, unknown>).sort()
}

function getPayloadMetadata(payload: unknown): NotebookRendererPayloadMetadata {
  if (payload === null || payload === undefined) {
    return { kind: "none", keyCount: 0, keys: [] }
  }
  if (Array.isArray(payload)) {
    return { kind: "array", keyCount: 0, keys: [] }
  }
  const payloadType = typeof payload
  if (payloadType === "object") {
    const keys = getPayloadKeys(payload)
    return { kind: "object", keyCount: keys.length, keys }
  }
  if (payloadType === "string" || payloadType === "number" || payloadType === "boolean") {
    return { kind: payloadType, keyCount: 0, keys: [] }
  }
  return { kind: "unknown", keyCount: 0, keys: [] }
}
