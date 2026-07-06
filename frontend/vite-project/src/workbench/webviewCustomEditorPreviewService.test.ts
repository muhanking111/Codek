import { describe, expect, it, vi } from "vitest"
import {
  WebviewCustomEditorPreviewService,
  ICustomEditorService,
  IWebviewService,
  createVisualEditorPreviewDescriptor,
} from "./webviewCustomEditorPreviewService"

describe("WebviewCustomEditorPreviewService", () => {
  it("exposes VS Code compatible webview and custom editor facade contracts without a second state store", () => {
    const service = new WebviewCustomEditorPreviewService()
    const panel = service.createWebviewPanel({
      id: "contract-preview",
      viewType: "codek.contractPreview",
      title: "Contract Preview",
      url: "http://localhost:5173",
      owner: "contract",
    })
    const received = vi.fn()

    expect(String(IWebviewService)).toBe("webviewService")
    expect(String(ICustomEditorService)).toBe("customEditorService")
    expect(service.getPanel(panel.id)).toBe(panel)

    service.onDidReceiveMessage(panel.id, received)
    expect(service.postMessage(panel.id, { type: "host-ready" })).toBe(true)
    expect(panel.channel.postToHost({ type: "webview-ready" })).toBe(true)
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ type: "webview-ready" }))

    expect(service.getSmokeEvidence()).toMatchObject({
      source: "webviewCustomEditorPreviewService",
      webviewServiceId: "webviewService",
      customEditorServiceId: "customEditorService",
      panelCount: 1,
      activePanelId: panel.id,
      messageBridgeReady: true,
    })
  })

  it("reports owner evidence from the existing preview registry without claiming DOM shell ownership", () => {
    const service = new WebviewCustomEditorPreviewService()
    const panel = service.createCustomEditorPreview({
      id: "owner-evidence-preview",
      viewType: "codek.visualCssEditor",
      title: "Owner Evidence Preview",
      resource: "file:///workspace/src/App.vue",
      url: "http://localhost:5173",
      owner: "visualEditor",
      editable: true,
    })

    expect(service.postMessage(panel.id, { type: "host-ready", payload: { secret: "redacted" } })).toBe(true)
    expect(panel.channel.postToHost({ type: "webview-ready", payload: { mounted: true } })).toBe(true)

    const smokeEvidence = service.getSmokeEvidence()
    expect(smokeEvidence).toMatchObject({
      source: "webviewCustomEditorPreviewService",
      webviewServiceOwner: "webviewCustomEditorPreviewService",
      customEditorOwner: "webviewCustomEditorPreviewService",
      previewSource: "existingPreviewRegistry",
      messageChannelOwner: "WebviewMessageChannel",
      resourceUriKind: "webview-panel",
      securityPolicyOwner: "webviewCustomEditorPreviewService",
      remainingWebviewUiOwnerGap: "webview-dom-editor-shell-owner-not-connected",
      messageBridgeReady: true,
      resourceGuardReady: true,
    })

    expect(smokeEvidence.panelCount).toBe(1)
    expect(smokeEvidence.customEditorCount).toBe(1)
    expect(JSON.stringify(service.getEvidenceSafeActions(panel.id))).not.toContain("redacted")
  })

  it("creates, reveals, disposes, and revives preview panels with stable ownership", () => {
    const service = new WebviewCustomEditorPreviewService()
    const panel = service.createPanel(
      createVisualEditorPreviewDescriptor({
        id: "visual-preview",
        title: "Visual Preview",
        url: "http://localhost:5173",
        owner: "visualEditor",
      }),
    )

    expect(panel.state).toBe("active")
    expect(panel.resource.owner).toBe("visualEditor")
    expect(panel.projection.url).toBe("http://localhost:5173")
    expect(panel.projection.sandbox).toBe(
      "allow-scripts allow-same-origin allow-forms allow-popups",
    )

    service.revealPanel(panel.id, { preserveFocus: true })
    expect(service.activePanelId).toBe(panel.id)
    expect(service.getPanel(panel.id)?.state).toBe("visible")

    const snapshot = service.serializePanel(panel.id)
    service.disposePanel(panel.id)
    expect(service.getPanel(panel.id)?.state).toBe("disposed")

    const revived = service.revivePanel(snapshot!)
    expect(revived.id).toBe(panel.id)
    expect(revived.state).toBe("revived")
    expect(revived.resource.uri).toBe(panel.resource.uri)
  })

  it("guards local webview resources against panel localResourceRoots", () => {
    const service = new WebviewCustomEditorPreviewService()
    const panel = service.createPanel({
      id: "guarded-preview",
      viewType: "codek.guardedPreview",
      title: "Guarded Preview",
      url: "http://localhost:5173",
      owner: "visualEditor",
      security: {
        localResourceRoots: [
          "file:///workspace/project/assets",
          "D:/Workspace/frontend/vite-project/public",
        ],
      },
    })

    expect(service.canLoadResource(panel.id, "file:///workspace/project/assets/logo.png")).toBe(true)
    expect(service.canLoadResource(panel.id, "D:/Workspace/frontend/vite-project/public/icon.svg")).toBe(true)
    expect(service.canLoadResource(panel.id, "file:///workspace/project/secrets/.env")).toBe(false)
    expect(service.canLoadResource(panel.id, "D:/Workspace/.env")).toBe(false)
    expect(service.canLoadResource("missing", "file:///workspace/project/assets/logo.png")).toBe(false)
  })

  it("projects origin, CSP, sandbox, and evidence-safe webview action boundaries", () => {
    const service = new WebviewCustomEditorPreviewService()
    const panel = service.createPanel({
      id: "secure-preview",
      viewType: "codek.securePreview",
      title: "Secure Preview",
      url: "http://localhost:5173",
      owner: "visualEditor",
      security: {
        origin: "codek-webview://secure-preview",
        localResourceRoots: ["file:///workspace/project/assets"],
      },
    })

    expect(panel.projection).toMatchObject({
      origin: "codek-webview://secure-preview",
      cspSource: "codek-webview://secure-preview",
      sandbox: "allow-scripts allow-same-origin allow-forms allow-popups",
    })
    expect(panel.projection.contentSecurityPolicy).toContain("default-src 'none'")
    expect(panel.projection.contentSecurityPolicy).toContain("img-src codek-webview://secure-preview data:")
    expect(service.canLoadResource(panel.id, "file:///workspace/project/assets/logo.png")).toBe(true)
    expect(service.canLoadResource(panel.id, "file:///workspace/project/secret.txt")).toBe(false)

    service.postMessage(panel.id, {
      type: "codek-action",
      payload: { selector: ".primary", secret: "do-not-log" },
    })
    const evidence = service.getEvidenceSafeActions(panel.id)

    expect(evidence.map((entry) => entry.action)).toEqual([
      "create",
      "resource-load",
      "resource-block",
      "message",
    ])
    expect(evidence.at(-1)).toMatchObject({
      panelId: panel.id,
      action: "message",
      direction: "host",
    })
    expect(evidence.at(-1)?.payloadKeys).toEqual(expect.arrayContaining(["selector", "secret"]))
    expect(JSON.stringify(evidence)).not.toContain("do-not-log")
  })

  it("routes host and webview messages through a panel-scoped channel", () => {
    const service = new WebviewCustomEditorPreviewService()
    const panel = service.createPanel(
      createVisualEditorPreviewDescriptor({
        id: "visual-preview",
        title: "Visual Preview",
        url: "http://localhost:5173",
        owner: "visualEditor",
      }),
    )
    const hostListener = vi.fn()
    const webviewListener = vi.fn()

    const hostDisposable = panel.channel.onDidReceiveFromWebview(hostListener)
    panel.channel.onDidReceiveFromHost(webviewListener)

    expect(
      panel.channel.postToHost({
        type: "codek-inspect",
        payload: { tag: "button", file: "src/App.vue" },
      }),
    ).toBe(true)
    expect(hostListener).toHaveBeenCalledWith(
      expect.objectContaining({
        panelId: panel.id,
        type: "codek-inspect",
        payload: { tag: "button", file: "src/App.vue" },
      }),
    )

    expect(
      panel.channel.postToWebview({
        type: "codek-style-update",
        payload: { selector: ".primary", prop: "color", value: "red" },
      }),
    ).toBe(true)
    expect(webviewListener).toHaveBeenCalledWith(
      expect.objectContaining({
        panelId: panel.id,
        type: "codek-style-update",
      }),
    )

    hostDisposable.dispose()
    panel.dispose()
    expect(panel.channel.postToHost({ type: "codek-click", payload: {} })).toBe(false)
    expect(panel.channel.postToWebview({ type: "codek-style-update", payload: {} })).toBe(false)
  })

  it("projects custom editor resources onto preview panels", () => {
    const service = new WebviewCustomEditorPreviewService()
    const panel = service.createCustomEditorPreview({
      id: "css-preview",
      viewType: "codek.visualCssEditor",
      title: "CSS Preview",
      resource: "file:///workspace/src/App.vue",
      url: "http://localhost:5173",
      owner: "visualEditor",
      editable: true,
    })

    expect(panel.customEditor).toMatchObject({
      viewType: "codek.visualCssEditor",
      resource: "file:///workspace/src/App.vue",
      editable: true,
      dirty: false,
    })
    expect(panel.projection.customEditorResource).toBe("file:///workspace/src/App.vue")
    expect(
      service.getCustomEditorProjection("file:///workspace/src/App.vue", "codek.visualCssEditor"),
    ).toMatchObject({
      panelId: panel.id,
      resource: "file:///workspace/src/App.vue",
      viewType: "codek.visualCssEditor",
      editable: true,
      dirty: false,
    })

    service.markCustomEditorDirty(panel.id, true)
    expect(
      service.getCustomEditorProjection("file:///workspace/src/App.vue", "codek.visualCssEditor")
        ?.dirty,
    ).toBe(true)

    expect(service.updateCustomEditorState(panel.id, { editable: false, conflict: true })).toBe(true)
    expect(
      service.getCustomEditorProjection("file:///workspace/src/App.vue", "codek.visualCssEditor"),
    ).toMatchObject({
      editable: false,
      readonly: true,
      conflict: true,
      dirty: true,
    })
  })

  it("backs up and restores custom editor panels through serialized snapshots", () => {
    const service = new WebviewCustomEditorPreviewService()
    const panel = service.createCustomEditorPreview({
      id: "diagram-preview",
      viewType: "codek.diagramEditor",
      title: "Diagram",
      resource: "file:///workspace/diagram.codek",
      url: "http://localhost:5173/diagram",
      owner: "visualEditor",
      editable: true,
    })

    service.markCustomEditorDirty(panel.id, true)
    const backup = service.backupCustomEditor(panel.id, "backup-1")

    expect(backup).toMatchObject({
      panelId: panel.id,
      backupId: "backup-1",
      resource: "file:///workspace/diagram.codek",
      viewType: "codek.diagramEditor",
      dirty: true,
    })

    service.disposePanel(panel.id)
    const restored = service.restoreCustomEditorBackup(backup!)

    expect(restored.state).toBe("revived")
    expect(restored.customEditor).toMatchObject({
      resource: "file:///workspace/diagram.codek",
      viewType: "codek.diagramEditor",
      dirty: true,
      backupId: "backup-1",
      restoredFromBackup: true,
    })
    expect(service.getSmokeEvidence()).toMatchObject({
      restoredCustomEditorCount: 1,
      customEditorDirtyCount: 1,
    })
  })

  it("lets old iframe preview entries proxy panel projection and message delivery", () => {
    const service = new WebviewCustomEditorPreviewService()
    const panel = service.openOrRevivePreview("visualEditor.preview", {
      title: "Visual Preview",
      url: "http://localhost:4173",
      owner: "visualEditor",
    })
    const targetWindow = { postMessage: vi.fn() }

    const projection = service.projectPanelForIframe(panel.id, targetWindow)
    expect(projection).toMatchObject({
      src: "http://localhost:4173",
      sandbox: "allow-scripts allow-same-origin allow-forms allow-popups",
      allow: "clipboard-read; clipboard-write",
    })

    expect(
      service.postFromLegacyIframe(panel.id, {
        type: "codek-inspect",
        tag: "main",
        styles: { display: "grid" },
      }),
    ).toBe(true)

    expect(
      service.postToLegacyIframe(panel.id, {
        type: "codek-style-update",
        selector: "main",
        prop: "display",
        value: "block",
      }),
    ).toBe(true)
    expect(targetWindow.postMessage).toHaveBeenCalledWith(
      {
        type: "codek-style-update",
        selector: "main",
        prop: "display",
        value: "block",
      },
      "*",
    )
  })
})
