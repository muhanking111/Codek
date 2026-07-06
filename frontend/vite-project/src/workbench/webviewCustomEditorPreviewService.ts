import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"

export type WebviewPanelState = "active" | "visible" | "hidden" | "revived" | "disposed"

export interface Disposable {
  dispose(): void
}

export interface WebviewSecurityOptions {
  sandbox: string
  allow: string
  localResourceRoots: string[]
  enableScripts: boolean
  retainContextWhenHidden: boolean
  origin: string
  cspSource: string
  contentSecurityPolicy: string
}

export interface WebviewResourceOwnership {
  uri: string
  owner: string
  viewType: string
  createdAt: number
  disposedAt: number | null
}

export interface WebviewMessage {
  type: string
  payload?: unknown
  panelId?: string
  direction?: "host" | "webview"
  timestamp?: number
}

export interface WebviewPanelProjection {
  id: string
  title: string
  viewType: string
  url: string
  src: string
  sandbox: string
  allow: string
  origin: string
  cspSource: string
  contentSecurityPolicy: string
  customEditorResource?: string
}

export interface CustomEditorProjection {
  panelId: string
  resource: string
  viewType: string
  editable: boolean
  readonly: boolean
  conflict: boolean
  dirty: boolean
  backupId?: string
}

export interface CustomEditorModel {
  resource: string
  viewType: string
  editable: boolean
  dirty: boolean
  conflict?: boolean
  backupId?: string
  restoredFromBackup?: boolean
}

export interface WebviewPanelDescriptor {
  id: string
  viewType: string
  title: string
  url: string
  owner: string
  security?: Partial<WebviewSecurityOptions>
  customEditor?: CustomEditorModel
}

export interface CustomEditorPreviewDescriptor {
  id: string
  viewType: string
  title: string
  resource: string
  url: string
  owner: string
  editable?: boolean
}

export interface WebviewPanelSnapshot {
  id: string
  viewType: string
  title: string
  url: string
  owner: string
  resource: WebviewResourceOwnership
  security: WebviewSecurityOptions
  customEditor?: CustomEditorModel
}

export interface LegacyIframeProjection {
  src: string
  sandbox: string
  allow: string
}

export interface CustomEditorBackupSnapshot {
  panelId: string
  backupId: string
  resource: string
  viewType: string
  title: string
  url: string
  owner: string
  editable: boolean
  dirty: boolean
  panel: WebviewPanelSnapshot
}

export interface WebviewCustomEditorSmokeEvidence {
  source: "webviewCustomEditorPreviewService"
  webviewServiceId: "webviewService"
  customEditorServiceId: "customEditorService"
  webviewServiceOwner: "webviewCustomEditorPreviewService"
  customEditorOwner: "webviewCustomEditorPreviewService"
  previewSource: "existingPreviewRegistry"
  messageChannelOwner: "WebviewMessageChannel"
  resourceUriKind: "webview-panel" | "vscode-custom-editor"
  securityPolicyOwner: "webviewCustomEditorPreviewService"
  remainingWebviewUiOwnerGap: "webview-dom-editor-shell-owner-not-connected"
  panelCount: number
  activePanelId: string
  messageBridgeReady: boolean
  resourceGuardReady: boolean
  customEditorCount: number
  customEditorDirtyCount: number
  restoredCustomEditorCount: number
  evidenceActionCount: number
}

export interface WebviewActionEvidence {
  panelId: string
  action: "create" | "message" | "resource-load" | "resource-block" | "dispose" | "state"
  timestamp: number
  direction?: "host" | "webview"
  type?: string
  payloadKeys?: string[]
  resource?: string
  state?: WebviewPanelState
}

export interface IWebviewWorkbenchService {
  readonly _serviceBrand: undefined
  createWebviewPanel(descriptor: WebviewPanelDescriptor): WebviewPanelModel
  postMessage(panelId: string, message: WebviewMessage): boolean
  onDidReceiveMessage(panelId: string, listener: Listener): Disposable
  canLoadResource(panelId: string, resource: string): boolean
}

export interface ICustomEditorWorkbenchService {
  readonly _serviceBrand: undefined
  createCustomEditorPreview(descriptor: CustomEditorPreviewDescriptor): WebviewPanelModel
  backupCustomEditor(panelId: string, backupId?: string): CustomEditorBackupSnapshot | undefined
  restoreCustomEditorBackup(snapshot: CustomEditorBackupSnapshot): WebviewPanelModel
}

export const IWebviewService = createDecorator<IWebviewWorkbenchService>("webviewService")
export const ICustomEditorService = createDecorator<ICustomEditorWorkbenchService>("customEditorService")

export type Listener = (message: WebviewMessage) => void
type LegacyTargetWindow =
  | Pick<Window, "postMessage">
  | { postMessage(message: unknown, targetOrigin: string): void }

const DEFAULT_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups"
const DEFAULT_ALLOW = "clipboard-read; clipboard-write"

export function createVisualEditorPreviewDescriptor(input: {
  id: string
  title: string
  url: string
  owner: string
  resource?: string
}): WebviewPanelDescriptor {
  return {
    id: input.id,
    viewType: "codek.visualEditor.preview",
    title: input.title,
    url: input.url,
    owner: input.owner,
    customEditor: input.resource
      ? {
          resource: input.resource,
          viewType: "codek.visualEditor.preview",
          editable: true,
          dirty: false,
        }
      : undefined,
  }
}

export class WebviewMessageChannel {
  private disposed = false
  private readonly hostListeners = new Set<Listener>()
  private readonly webviewListeners = new Set<Listener>()

  constructor(private readonly panelId: string) {}

  onDidReceiveFromWebview(listener: Listener): Disposable {
    this.hostListeners.add(listener)
    return { dispose: () => this.hostListeners.delete(listener) }
  }

  onDidReceiveFromHost(listener: Listener): Disposable {
    this.webviewListeners.add(listener)
    return { dispose: () => this.webviewListeners.delete(listener) }
  }

  postToHost(message: WebviewMessage): boolean {
    if (this.disposed) return false
    const normalized = this.normalizeMessage(message, "webview")
    for (const listener of this.hostListeners) listener(normalized)
    return true
  }

  postToWebview(message: WebviewMessage): boolean {
    if (this.disposed) return false
    const normalized = this.normalizeMessage(message, "host")
    for (const listener of this.webviewListeners) listener(normalized)
    return true
  }

  dispose(): void {
    this.disposed = true
    this.hostListeners.clear()
    this.webviewListeners.clear()
  }

  private normalizeMessage(message: WebviewMessage, direction: "host" | "webview"): WebviewMessage {
    return {
      ...message,
      panelId: this.panelId,
      direction,
      timestamp: message.timestamp ?? Date.now(),
    }
  }
}

export class WebviewPanelModel {
  readonly id: string
  readonly channel: WebviewMessageChannel
  readonly resource: WebviewResourceOwnership
  readonly security: WebviewSecurityOptions
  readonly customEditor?: CustomEditorModel
  state: WebviewPanelState
  title: string
  url: string

  constructor(
    descriptor: WebviewPanelDescriptor,
    state: WebviewPanelState = "active",
    resource?: WebviewResourceOwnership,
  ) {
    this.id = descriptor.id
    this.title = descriptor.title
    this.url = descriptor.url
    this.state = state
    this.channel = new WebviewMessageChannel(descriptor.id)
    this.security = normalizeSecurity(descriptor.security)
    this.customEditor = descriptor.customEditor ? { ...descriptor.customEditor } : undefined
    this.resource = resource ?? {
      uri: `webview-panel://${encodeURIComponent(descriptor.owner)}/${encodeURIComponent(descriptor.viewType)}/${encodeURIComponent(descriptor.id)}`,
      owner: descriptor.owner,
      viewType: descriptor.viewType,
      createdAt: Date.now(),
      disposedAt: null,
    }
  }

  get viewType(): string {
    return this.resource.viewType
  }

  get projection(): WebviewPanelProjection {
    return {
      id: this.id,
      title: this.title,
      viewType: this.viewType,
      url: this.url,
      src: this.url,
      sandbox: this.security.sandbox,
      allow: this.security.allow,
      origin: this.security.origin,
      cspSource: this.security.cspSource,
      contentSecurityPolicy: this.security.contentSecurityPolicy,
      customEditorResource: this.customEditor?.resource,
    }
  }

  serialize(): WebviewPanelSnapshot {
    return {
      id: this.id,
      viewType: this.viewType,
      title: this.title,
      url: this.url,
      owner: this.resource.owner,
      resource: { ...this.resource },
      security: { ...this.security, localResourceRoots: [...this.security.localResourceRoots] },
      customEditor: this.customEditor ? { ...this.customEditor } : undefined,
    }
  }

  dispose(): void {
    if (this.state === "disposed") return
    this.state = "disposed"
    this.resource.disposedAt = Date.now()
    this.channel.dispose()
  }
}

export class WebviewCustomEditorPreviewService {
  declare readonly _serviceBrand: undefined

  private readonly panels = new Map<string, WebviewPanelModel>()
  private readonly legacyWindows = new Map<string, LegacyTargetWindow>()
  private readonly legacyDisposables = new Map<string, Disposable>()
  private readonly actionEvidence = new Map<string, WebviewActionEvidence[]>()
  activePanelId: string | null = null

  createPanel(descriptor: WebviewPanelDescriptor): WebviewPanelModel {
    const panel = new WebviewPanelModel(descriptor)
    this.panels.set(panel.id, panel)
    this.activePanelId = panel.id
    this.recordEvidence(panel.id, { action: "create", state: panel.state })
    return panel
  }

  createWebviewPanel(descriptor: WebviewPanelDescriptor): WebviewPanelModel {
    return this.createPanel(descriptor)
  }

  openOrRevivePreview(
    id: string,
    input: Omit<WebviewPanelDescriptor, "id" | "viewType"> & { viewType?: string },
  ): WebviewPanelModel {
    const existing = this.panels.get(id)
    if (existing && existing.state !== "disposed") {
      existing.url = input.url
      existing.title = input.title
      existing.state = "visible"
      this.activePanelId = existing.id
      this.recordEvidence(existing.id, { action: "state", state: existing.state })
      return existing
    }

    return this.createPanel({
      id,
      viewType: input.viewType ?? "codek.preview",
      title: input.title,
      url: input.url,
      owner: input.owner,
      security: input.security,
      customEditor: input.customEditor,
    })
  }

  createCustomEditorPreview(descriptor: CustomEditorPreviewDescriptor): WebviewPanelModel {
    return this.createPanel({
      id: descriptor.id,
      viewType: descriptor.viewType,
      title: descriptor.title,
      url: descriptor.url,
      owner: descriptor.owner,
      customEditor: {
        resource: descriptor.resource,
        viewType: descriptor.viewType,
        editable: descriptor.editable ?? false,
        dirty: false,
      },
    })
  }

  getPanel(id: string): WebviewPanelModel | undefined {
    return this.panels.get(id)
  }

  revealPanel(id: string, _options: { preserveFocus?: boolean } = {}): boolean {
    const panel = this.panels.get(id)
    if (!panel || panel.state === "disposed") return false
    panel.state = "visible"
    this.activePanelId = id
    this.recordEvidence(id, { action: "state", state: panel.state })
    return true
  }

  hidePanel(id: string): boolean {
    const panel = this.panels.get(id)
    if (!panel || panel.state === "disposed") return false
    panel.state = "hidden"
    if (this.activePanelId === id) this.activePanelId = null
    this.recordEvidence(id, { action: "state", state: panel.state })
    return true
  }

  disposePanel(id: string): boolean {
    const panel = this.panels.get(id)
    if (!panel) return false
    panel.dispose()
    this.legacyWindows.delete(id)
    this.legacyDisposables.get(id)?.dispose()
    this.legacyDisposables.delete(id)
    if (this.activePanelId === id) this.activePanelId = null
    this.recordEvidence(id, { action: "dispose", state: "disposed" })
    return true
  }

  serializePanel(id: string): WebviewPanelSnapshot | undefined {
    return this.panels.get(id)?.serialize()
  }

  revivePanel(snapshot: WebviewPanelSnapshot): WebviewPanelModel {
    const panel = new WebviewPanelModel(
      {
        id: snapshot.id,
        viewType: snapshot.viewType,
        title: snapshot.title,
        url: snapshot.url,
        owner: snapshot.owner,
        security: snapshot.security,
        customEditor: snapshot.customEditor,
      },
      "revived",
      {
        ...snapshot.resource,
        disposedAt: null,
      },
    )
    this.panels.set(panel.id, panel)
    this.activePanelId = panel.id
    return panel
  }

  getCustomEditorProjection(
    resource: string,
    viewType: string,
  ): CustomEditorProjection | undefined {
    for (const panel of this.panels.values()) {
      if (panel.state === "disposed") continue
      if (panel.customEditor?.resource === resource && panel.customEditor.viewType === viewType) {
        return {
          panelId: panel.id,
          resource,
          viewType,
          editable: panel.customEditor.editable,
          readonly: !panel.customEditor.editable,
          conflict: panel.customEditor.conflict === true,
          dirty: panel.customEditor.dirty,
          backupId: panel.customEditor.backupId,
        }
      }
    }
    return undefined
  }

  markCustomEditorDirty(panelId: string, dirty: boolean): boolean {
    const panel = this.panels.get(panelId)
    if (!panel?.customEditor || panel.state === "disposed") return false
    panel.customEditor.dirty = dirty
    this.recordEvidence(panelId, { action: "state", state: panel.state })
    return true
  }

  updateCustomEditorState(
    panelId: string,
    state: Partial<Pick<CustomEditorModel, "editable" | "dirty" | "conflict" | "backupId">>,
  ): boolean {
    const panel = this.panels.get(panelId)
    if (!panel?.customEditor || panel.state === "disposed") return false
    if (typeof state.editable === "boolean") panel.customEditor.editable = state.editable
    if (typeof state.dirty === "boolean") panel.customEditor.dirty = state.dirty
    if (typeof state.conflict === "boolean") panel.customEditor.conflict = state.conflict
    if (typeof state.backupId === "string") panel.customEditor.backupId = state.backupId
    this.recordEvidence(panelId, { action: "state", state: panel.state })
    return true
  }

  postMessage(panelId: string, message: WebviewMessage): boolean {
    const panel = this.panels.get(panelId)
    if (!panel || panel.state === "disposed") return false
    const posted = panel.channel.postToWebview(message)
    if (posted) this.recordMessageEvidence(panelId, "host", message)
    return posted
  }

  onDidReceiveMessage(panelId: string, listener: Listener): Disposable {
    const panel = this.panels.get(panelId)
    if (!panel || panel.state === "disposed") return { dispose() {} }
    return panel.channel.onDidReceiveFromWebview(listener)
  }

  canLoadResource(panelId: string, resource: string): boolean {
    const panel = this.panels.get(panelId)
    if (!panel || panel.state === "disposed") return false
    const normalizedResource = normalizeResourceForGuard(resource)
    if (!normalizedResource) return false
    const allowed = panel.security.localResourceRoots.some((root) => {
      const normalizedRoot = normalizeResourceForGuard(root)
      return normalizedRoot ? isResourceInsideRoot(normalizedResource, normalizedRoot) : false
    })
    this.recordEvidence(panelId, {
      action: allowed ? "resource-load" : "resource-block",
      resource: redactResourceForEvidence(normalizedResource),
    })
    return allowed
  }

  backupCustomEditor(panelId: string, backupId = `backup:${panelId}:${Date.now()}`): CustomEditorBackupSnapshot | undefined {
    const panel = this.panels.get(panelId)
    if (!panel?.customEditor || panel.state === "disposed") return undefined
    panel.customEditor.backupId = backupId
    return {
      panelId,
      backupId,
      resource: panel.customEditor.resource,
      viewType: panel.customEditor.viewType,
      title: panel.title,
      url: panel.url,
      owner: panel.resource.owner,
      editable: panel.customEditor.editable,
      dirty: panel.customEditor.dirty,
      panel: panel.serialize(),
    }
  }

  restoreCustomEditorBackup(snapshot: CustomEditorBackupSnapshot): WebviewPanelModel {
    return this.revivePanel({
      ...snapshot.panel,
      title: snapshot.title,
      url: snapshot.url,
      owner: snapshot.owner,
      customEditor: {
        resource: snapshot.resource,
        viewType: snapshot.viewType,
        editable: snapshot.editable,
        dirty: snapshot.dirty,
        backupId: snapshot.backupId,
        restoredFromBackup: true,
      },
    })
  }

  getSmokeEvidence(): WebviewCustomEditorSmokeEvidence {
    const panels = [...this.panels.values()].filter((panel) => panel.state !== "disposed")
    const customEditors = panels.filter((panel) => panel.customEditor)
    const activePanel = panels.find((panel) => panel.id === this.activePanelId)
    return {
      source: "webviewCustomEditorPreviewService",
      webviewServiceId: "webviewService",
      customEditorServiceId: "customEditorService",
      webviewServiceOwner: "webviewCustomEditorPreviewService",
      customEditorOwner: "webviewCustomEditorPreviewService",
      previewSource: "existingPreviewRegistry",
      messageChannelOwner: "WebviewMessageChannel",
      resourceUriKind: getWebviewResourceUriKind(activePanel ?? panels[0]),
      securityPolicyOwner: "webviewCustomEditorPreviewService",
      remainingWebviewUiOwnerGap: "webview-dom-editor-shell-owner-not-connected",
      panelCount: panels.length,
      activePanelId: this.activePanelId || "",
      messageBridgeReady: true,
      resourceGuardReady: true,
      customEditorCount: customEditors.length,
      customEditorDirtyCount: customEditors.filter((panel) => panel.customEditor?.dirty).length,
      restoredCustomEditorCount: customEditors.filter((panel) => panel.customEditor?.restoredFromBackup).length,
      evidenceActionCount: Array.from(this.actionEvidence.values()).reduce((count, entries) => count + entries.length, 0),
    }
  }

  getEvidenceSafeActions(panelId?: string): readonly WebviewActionEvidence[] {
    if (panelId) return [...(this.actionEvidence.get(panelId) || [])]
    return Array.from(this.actionEvidence.values()).flat()
  }

  projectPanelForIframe(
    panelId: string,
    targetWindow?: LegacyTargetWindow | null,
  ): LegacyIframeProjection | undefined {
    const panel = this.panels.get(panelId)
    if (!panel || panel.state === "disposed") return undefined
    if (targetWindow) {
      this.legacyWindows.set(panelId, targetWindow)
      this.legacyDisposables.get(panelId)?.dispose()
      this.legacyDisposables.set(
        panelId,
        panel.channel.onDidReceiveFromHost((message) => {
          const raw = toLegacyMessage(message)
          this.legacyWindows.get(panelId)?.postMessage(raw, "*")
        }),
      )
    }
    return {
      src: panel.projection.src,
      sandbox: panel.projection.sandbox,
      allow: panel.projection.allow,
    }
  }

  postFromLegacyIframe(panelId: string, rawMessage: unknown): boolean {
    const panel = this.panels.get(panelId)
    if (!panel || panel.state === "disposed") return false
    const data = normalizeLegacyMessage(rawMessage)
    if (!data) return false
    const posted = panel.channel.postToHost(data)
    if (posted) this.recordMessageEvidence(panelId, "webview", data)
    return posted
  }

  postToLegacyIframe(panelId: string, rawMessage: unknown): boolean {
    const panel = this.panels.get(panelId)
    if (!panel || panel.state === "disposed") return false
    const data = normalizeLegacyMessage(rawMessage)
    if (!data) return false
    const posted = panel.channel.postToWebview(data)
    if (posted) this.recordMessageEvidence(panelId, "host", data)
    return posted
  }

  private recordMessageEvidence(panelId: string, direction: "host" | "webview", message: WebviewMessage): void {
    this.recordEvidence(panelId, {
      action: "message",
      direction,
      type: message.type,
      payloadKeys: getPayloadKeys(message.payload),
    })
  }

  private recordEvidence(
    panelId: string,
    evidence: Omit<WebviewActionEvidence, "panelId" | "timestamp">,
  ): void {
    const entries = this.actionEvidence.get(panelId) || []
    entries.push({
      panelId,
      timestamp: Date.now(),
      ...evidence,
    })
    this.actionEvidence.set(panelId, entries)
  }
}

export const globalWebviewCustomEditorPreviewService = new WebviewCustomEditorPreviewService()

registerSingleton(IWebviewService, globalWebviewCustomEditorPreviewService, InstantiationType.Delayed)
registerSingleton(ICustomEditorService, globalWebviewCustomEditorPreviewService, InstantiationType.Delayed)

function normalizeSecurity(
  security: Partial<WebviewSecurityOptions> | undefined,
): WebviewSecurityOptions {
  const origin = security?.origin || `codek-webview://${Math.random().toString(36).slice(2)}`
  const cspSource = security?.cspSource || origin
  return {
    sandbox: security?.sandbox ?? DEFAULT_SANDBOX,
    allow: security?.allow ?? DEFAULT_ALLOW,
    localResourceRoots: [...(security?.localResourceRoots ?? [])],
    enableScripts: security?.enableScripts ?? true,
    retainContextWhenHidden: security?.retainContextWhenHidden ?? true,
    origin,
    cspSource,
    contentSecurityPolicy: security?.contentSecurityPolicy ?? createDefaultCsp(cspSource, security?.enableScripts ?? true),
  }
}

function createDefaultCsp(cspSource: string, enableScripts: boolean): string {
  const scriptSrc = enableScripts ? `${cspSource} 'unsafe-inline'` : "'none'"
  return [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src ${scriptSrc}`,
    `connect-src ${cspSource} http://localhost:* https://localhost:* ws://localhost:* wss://localhost:*`,
    "frame-ancestors 'none'",
  ].join("; ")
}

function normalizeLegacyMessage(rawMessage: unknown): WebviewMessage | null {
  if (!rawMessage || typeof rawMessage !== "object") return null
  const record = rawMessage as Record<string, unknown>
  if (typeof record.type !== "string" || !record.type) return null
  const {
    type,
    panelId: _panelId,
    direction: _direction,
    timestamp: _timestamp,
    ...payload
  } = record
  return { type, payload }
}

function toLegacyMessage(message: WebviewMessage): unknown {
  if (message.payload && typeof message.payload === "object" && !Array.isArray(message.payload)) {
    return { type: message.type, ...(message.payload as Record<string, unknown>) }
  }
  return { type: message.type, payload: message.payload }
}

function normalizeResourceForGuard(resource: string): string {
  const normalized = String(resource || "").replace(/\\/g, "/").trim()
  if (!normalized) return ""
  return normalized.replace(/^file:\/+/i, "/").replace(/^([a-z]):/i, (_match, drive) => `/${String(drive).toLowerCase()}`)
}

function isResourceInsideRoot(resource: string, root: string): boolean {
  const normalizedRoot = root.endsWith("/") ? root : `${root}/`
  return resource === root || resource.startsWith(normalizedRoot)
}

function getPayloadKeys(payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return []
  return Object.keys(payload as Record<string, unknown>).sort()
}

function redactResourceForEvidence(resource: string): string {
  const normalized = normalizeResourceForGuard(resource)
  const parts = normalized.split("/").filter(Boolean)
  return parts.length <= 2 ? normalized : `.../${parts.slice(-2).join("/")}`
}

function getWebviewResourceUriKind(panel: WebviewPanelModel | undefined): "webview-panel" | "vscode-custom-editor" {
  if (!panel) return "webview-panel"
  const scheme = panel.resource.uri.split("://", 1)[0]
  return scheme === "vscode-custom-editor" ? "vscode-custom-editor" : "webview-panel"
}
