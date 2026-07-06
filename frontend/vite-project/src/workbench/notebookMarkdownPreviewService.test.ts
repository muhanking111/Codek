import { describe, expect, it } from "vitest"
import {
  INotebookService,
  NotebookMarkdownPreviewWorkbenchService,
  createLegacyMarkdownPreviewController,
} from "./notebookMarkdownPreviewService"

describe("notebookMarkdownPreviewService", () => {
  it("exposes a notebook service facade with serializer and controller bridges", async () => {
    const service = new NotebookMarkdownPreviewWorkbenchService()
    const events: string[] = []
    service.onDidChange((event) => events.push(`${event.kind}:${event.resource}`))

    const disposable = service.registerNotebookSerializer("codek-notebook", {
      dataToNotebook(data) {
        const parsed = JSON.parse(data)
        return {
          metadata: parsed.metadata,
          cells: parsed.cells,
        }
      },
      notebookToData(document) {
        return JSON.stringify({
          metadata: document.metadata,
          cells: document.cells.map((cell) => ({
            kind: cell.kind,
            languageId: cell.languageId,
            source: cell.source,
            outputs: cell.outputs,
          })),
        })
      },
    })

    expect(String(INotebookService)).toBe("notebookService")
    expect(await service.canResolve("codek-notebook")).toBe(true)
    expect(await service.canResolve("missing-notebook")).toBe(false)

    const document = await service.createNotebookTextModel(
      "codek-notebook",
      "file:///workspace/demo.codek-nb",
      JSON.stringify({
        metadata: { trusted: true },
        cells: [{ languageId: "typescript", source: "const ok = true" }],
      }),
    )

    expect(document).toMatchObject({
      uri: "file:///workspace/demo.codek-nb",
      viewType: "codek-notebook",
      versionId: 1,
      cellCount: 1,
    })

    const saved = await service.saveNotebookTextModel("file:///workspace/demo.codek-nb")
    expect(saved).toContain("const ok = true")

    const restored = await service.restoreNotebookTextModelFromSnapshot(
      "file:///workspace/demo.codek-nb",
      "codek-notebook",
      JSON.stringify({
        metadata: { restored: true },
        cells: [{ languageId: "markdown", source: "# Restored" }],
      }),
    )
    expect(restored).toMatchObject({
      versionId: 2,
      metadata: { restored: true },
      cells: [{ kind: "markup", languageId: "markdown", source: "# Restored" }],
    })
    expect(service.getSmokeEvidence()).toMatchObject({
      source: "notebookMarkdownPreviewService",
      notebookServiceId: "notebookService",
      serializerCount: 1,
      notebookDocumentCount: 1,
      activeNotebookResource: "file:///workspace/demo.codek-nb",
    })

    disposable.dispose()
    expect(await service.canResolve("codek-notebook")).toBe(false)
    expect(events).toEqual([
      "notebook-open:file:///workspace/demo.codek-nb",
      "notebook-update:file:///workspace/demo.codek-nb",
    ])
  })

  it("creates, updates, snapshots, and disposes notebook documents with cells", () => {
    const service = new NotebookMarkdownPreviewWorkbenchService()
    const events: string[] = []
    service.onDidChange((event) => events.push(`${event.kind}:${event.resource}`))

    const document = service.openNotebookDocument({
      uri: "file:///workspace/analysis.ipynb",
      viewType: "jupyter-notebook",
      cells: [
        { handle: 7, languageId: "markdown", source: "# Title", metadata: { order: 1 } },
        { languageId: "python", source: "print('ok')", outputs: [{ mime: "text/plain", value: "ok" }] },
      ],
      metadata: { trusted: true },
    })

    expect(document.versionId).toBe(1)
    expect(document.cellCount).toBe(2)
    expect(document.cells[0]).toMatchObject({
      handle: 7,
      index: 0,
      kind: "markup",
      languageId: "markdown",
      source: "# Title",
    })
    expect(document.cells[1]).toMatchObject({
      handle: 1,
      index: 1,
      kind: "code",
      languageId: "python",
      source: "print('ok')",
    })

    const updated = service.updateNotebookCells("file:///workspace/analysis.ipynb", [
      { handle: 9, languageId: "markdown", source: "## Updated" },
    ])

    expect(updated.versionId).toBe(2)
    expect(updated.cells).toHaveLength(1)
    expect(updated.cells[0]).toMatchObject({ handle: 9, index: 0, source: "## Updated" })
    expect(service.getNotebookSnapshot("file:///workspace/analysis.ipynb")).toMatchObject({
      source: "notebookMarkdownPreviewService",
      documentCount: 1,
      activeResource: "file:///workspace/analysis.ipynb",
      documents: [{ uri: "file:///workspace/analysis.ipynb", versionId: 2, cellCount: 1 }],
    })

    expect(service.disposeNotebookDocument("file:///workspace/analysis.ipynb")).toBe(true)
    expect(service.getNotebookTextModel("file:///workspace/analysis.ipynb")).toBeUndefined()
    expect(events).toEqual([
      "notebook-open:file:///workspace/analysis.ipynb",
      "notebook-update:file:///workspace/analysis.ipynb",
      "notebook-dispose:file:///workspace/analysis.ipynb",
    ])
  })

  it("projects notebook backup, readonly, and conflict lifecycle without another state source", async () => {
    const service = new NotebookMarkdownPreviewWorkbenchService()
    const document = service.openNotebookDocument({
      uri: "file:///workspace/locked.ipynb",
      viewType: "jupyter-notebook",
      metadata: { trusted: false },
      readonly: true,
      conflict: false,
      cells: [{ languageId: "markdown", source: "# Locked" }],
    })

    expect(document).toMatchObject({
      readonly: true,
      conflict: false,
      backupId: undefined,
    })
    expect(service.updateNotebookLifecycle("file:///workspace/locked.ipynb", {
      dirty: true,
      conflict: true,
      readonly: "Workspace trust required",
    })).toBe(true)

    const backup = await service.backupNotebookTextModel("file:///workspace/locked.ipynb", "nb-backup-1")
    expect(backup).toMatchObject({
      backupId: "nb-backup-1",
      uri: "file:///workspace/locked.ipynb",
      viewType: "jupyter-notebook",
      readonly: "Workspace trust required",
      conflict: true,
      dirty: true,
      cellCount: 1,
    })
    expect(backup!.snapshot).toContain("# Locked")

    const projection = service.getNotebookDocumentProjection("file:///workspace/locked.ipynb")
    expect(projection).toMatchObject({
      uri: "file:///workspace/locked.ipynb",
      viewType: "jupyter-notebook",
      versionId: 3,
      cellCount: 1,
      readonly: true,
      readonlyReason: "Workspace trust required",
      conflict: true,
      dirty: true,
      backupId: "nb-backup-1",
    })
    expect(service.getSmokeEvidence()).toMatchObject({
      notebookDirtyCount: 1,
      notebookConflictCount: 1,
      notebookBackupCount: 1,
    })
  })

  it("registers notebook kernels and renderers through the same workbench service evidence source", () => {
    const service = new NotebookMarkdownPreviewWorkbenchService()
    service.openNotebookDocument({
      uri: "file:///workspace/analysis.ipynb",
      viewType: "jupyter-notebook",
      cells: [{ languageId: "python", source: "print('ok')" }],
    })

    const kernelDisposable = service.registerNotebookKernel({
      id: "python-kernel",
      label: "Python",
      viewType: "jupyter-notebook",
      supportedLanguages: ["python"],
    })
    const rendererDisposable = service.registerNotebookRenderer({
      id: "plot-renderer",
      mimeTypes: ["image/png", "application/vnd.code.notebook.stdout"],
      messaging: true,
    })

    expect(service.selectNotebookKernel("file:///workspace/analysis.ipynb", "python-kernel")).toBe(true)
    expect(service.postNotebookRendererMessage({
      rendererId: "plot-renderer",
      uri: "file:///workspace/analysis.ipynb",
      type: "render-output",
      payload: { secret: "do-not-log", outputId: "cell-1" },
    })).toBe(true)

    expect(service.getNotebookKernelProjection("file:///workspace/analysis.ipynb")).toMatchObject({
      source: "notebookKernelService",
      kernelCount: 1,
      selectedKernelCount: 1,
      selectedKernelId: "python-kernel",
      selectedKernelLabel: "Python",
    })
    expect(service.getNotebookRendererProjection()).toMatchObject({
      source: "notebookRendererMessagingService",
      rendererOwner: "notebookMarkdownPreviewService",
      messageChannelOwner: "notebookRendererMessagingService",
      previewSource: "notebookMarkdownPreviewService",
      rendererCount: 1,
      messageBridgeReady: true,
      rendererMessageCount: 1,
      rendererIds: ["plot-renderer"],
      allowedMessageKinds: ["renderer-to-extension", "extension-to-renderer"],
      uiOwnerConnected: false,
      blockedGaps: [
        "notebook-editor-webview-owner",
        "markdown-preview-webview-owner",
      ],
    })
    expect(JSON.stringify(service.getNotebookRendererProjection())).not.toContain("do-not-log")
    expect(service.getSmokeEvidence()).toMatchObject({
      notebookKernelCount: 1,
      selectedNotebookKernelCount: 1,
      notebookRendererCount: 1,
      rendererMessageBridgeReady: true,
    })

    kernelDisposable.dispose()
    rendererDisposable.dispose()
    expect(service.selectNotebookKernel("file:///workspace/analysis.ipynb", "python-kernel")).toBe(false)
    expect(service.postNotebookRendererMessage({
      rendererId: "plot-renderer",
      uri: "file:///workspace/analysis.ipynb",
      type: "render-output",
    })).toBe(false)
  })

  it("projects markdown resources into preview resources and refreshes without leaking disposed entries", () => {
    const service = new NotebookMarkdownPreviewWorkbenchService()

    const preview = service.openMarkdownPreview({
      resource: "src/readme.md",
      content: "# Hello\n\nBody",
      sideBySide: true,
      locked: true,
      source: "editor",
    })

    expect(preview).toMatchObject({
      id: "markdown-preview:src/readme.md",
      resource: "src/readme.md",
      previewResource: "markdown-preview://src/readme.md",
      title: "readme.md Preview",
      html: "<h1>Hello</h1>\n<p>Body</p>",
      disposed: false,
      versionId: 1,
      lifecycle: "open",
    })

    const refreshed = service.refreshMarkdownPreview("src/readme.md", "# Hello\n\n- one\n- two")
    expect(refreshed).toMatchObject({
      versionId: 2,
      html: "<h1>Hello</h1>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>",
      lifecycle: "refresh",
    })

    expect(service.getMarkdownPreviewSnapshot()).toMatchObject({
      source: "notebookMarkdownPreviewService",
      previewCount: 1,
      activeResource: "src/readme.md",
      previews: [{ resource: "src/readme.md", versionId: 2, disposed: false }],
    })

    expect(service.disposeMarkdownPreview("src/readme.md")).toBe(true)
    expect(service.refreshMarkdownPreview("src/readme.md", "# ignored")).toBeNull()
    expect(service.getMarkdownPreviewSnapshot()).toMatchObject({
      previewCount: 0,
      activeResource: "",
      previews: [],
    })
  })

  it("lets legacy markdown preview entries proxy the service lifecycle", () => {
    const service = new NotebookMarkdownPreviewWorkbenchService()
    const legacy = createLegacyMarkdownPreviewController(service)
    const events: string[] = []
    service.onDidChange((event) => events.push(`${event.kind}:${event.resource}`))

    expect(legacy.isOpen()).toBe(false)
    expect(legacy.setOpen(true, { resource: "README.md", content: "# README" })).toMatchObject({
      resource: "README.md",
      html: "<h1>README</h1>",
      lifecycle: "open",
    })
    expect(legacy.isOpen("README.md")).toBe(true)
    expect(legacy.refresh("README.md", "plain text")).toMatchObject({
      html: "<p>plain text</p>",
      lifecycle: "refresh",
    })
    expect(legacy.setOpen(false, { resource: "README.md" })).toBeNull()
    expect(legacy.isOpen()).toBe(false)
    expect(events).toEqual([
      "markdown-open:README.md",
      "markdown-refresh:README.md",
      "markdown-dispose:README.md",
    ])
  })

  it("uses the legacy default resource for boolean-only preview toggles", () => {
    const service = new NotebookMarkdownPreviewWorkbenchService()
    const legacy = createLegacyMarkdownPreviewController(service)

    expect(legacy.setOpen(true, { content: "from editor" })).toMatchObject({
      resource: "markdown-preview",
      source: "legacy",
      lifecycle: "open",
    })
    expect(service.getMarkdownPreviewSnapshot()).toMatchObject({
      previewCount: 1,
      activeResource: "markdown-preview",
      previews: [{ content: "from editor", lifecycle: "open" }],
    })
    expect(legacy.setOpen(false)).toBeNull()
    expect(service.getMarkdownPreviewSnapshot()).toMatchObject({
      previewCount: 0,
      activeResource: "",
      previews: [],
    })
  })

  it("drives markdown preview, notebook kernel, and renderer message smoke evidence from one service", () => {
    const service = new NotebookMarkdownPreviewWorkbenchService()

    const preview = service.openMarkdownPreview({
      resource: "file:///workspace/notebook-preview.md",
      content: "# Notebook Preview\n\n- rendered markdown",
      source: "command",
    })
    const document = service.openNotebookDocument({
      uri: "file:///workspace/notebook-preview.ipynb",
      viewType: "jupyter-notebook",
      cells: [
        { languageId: "markdown", source: "# Notebook Preview" },
        {
          languageId: "python",
          source: "print('plot')",
          outputs: [{ mime: "image/png", value: "redacted-binary" }],
        },
      ],
    })

    service.registerNotebookKernel({
      id: "python-kernel",
      label: "Python",
      viewType: "jupyter-notebook",
      supportedLanguages: ["python"],
    })
    service.registerNotebookRenderer({
      id: "plot-renderer",
      mimeTypes: ["image/png"],
      messaging: true,
    })

    expect(service.selectNotebookKernel(document.uri, "python-kernel")).toBe(true)
    expect(service.postNotebookRendererMessage({
      rendererId: "plot-renderer",
      uri: document.uri,
      type: "render-complete",
      payload: {
        outputId: "cell-output-1",
        secretToken: "must-not-be-projected",
      },
    })).toBe(true)

    expect(preview.html).toContain("<h1>Notebook Preview</h1>")
    expect(service.getMarkdownPreviewSnapshot(preview.resource)).toMatchObject({
      source: "notebookMarkdownPreviewService",
      previewCount: 1,
      activeResource: preview.resource,
      previews: [{ resource: preview.resource, lifecycle: "open", versionId: 1 }],
    })
    expect(service.getNotebookSnapshot(document.uri)).toMatchObject({
      source: "notebookMarkdownPreviewService",
      documentCount: 1,
      activeResource: document.uri,
      documents: [{ uri: document.uri, viewType: "jupyter-notebook", cellCount: 2 }],
    })
    expect(service.getNotebookKernelProjection(document.uri)).toMatchObject({
      source: "notebookKernelService",
      kernelCount: 1,
      selectedKernelCount: 1,
      selectedKernelId: "python-kernel",
    })
    expect(service.getNotebookRendererProjection()).toEqual({
      source: "notebookRendererMessagingService",
      rendererOwner: "notebookMarkdownPreviewService",
      messageChannelOwner: "notebookRendererMessagingService",
      previewSource: "notebookMarkdownPreviewService",
      rendererCount: 1,
      rendererIds: ["plot-renderer"],
      allowedMessageKinds: ["renderer-to-extension", "extension-to-renderer"],
      messageBridgeReady: true,
      uiOwnerConnected: false,
      blockedGaps: [
        "notebook-editor-webview-owner",
        "markdown-preview-webview-owner",
      ],
      rendererMessageCount: 1,
      messages: [{
        kind: "renderer-to-extension",
        rendererId: "plot-renderer",
        uri: document.uri,
        type: "render-complete",
        payloadKeys: ["outputId", "secretToken"],
        payloadMetadata: {
          kind: "object",
          keyCount: 2,
          keys: ["outputId", "secretToken"],
        },
      }],
    })
    expect(service.getSmokeEvidence()).toMatchObject({
      source: "notebookMarkdownPreviewService",
      notebookServiceId: "notebookService",
      notebookDocumentCount: 1,
      activeNotebookResource: document.uri,
      notebookKernelCount: 1,
      selectedNotebookKernelCount: 1,
      notebookRendererCount: 1,
      rendererMessageBridgeReady: true,
      rendererMessageCount: 1,
      markdownPreviewCount: 1,
      activeMarkdownResource: preview.resource,
    })
    expect(JSON.stringify(service.getNotebookRendererProjection())).not.toContain("must-not-be-projected")
  })

  it("projects renderer messaging owner evidence without a second payload state source", () => {
    const service = new NotebookMarkdownPreviewWorkbenchService()

    service.openMarkdownPreview({
      resource: "file:///workspace/notebook-preview.md",
      content: "# Preview",
      source: "editor",
    })
    const document = service.openNotebookDocument({
      uri: "file:///workspace/notebook-preview.ipynb",
      viewType: "jupyter-notebook",
      cells: [{ languageId: "markdown", source: "# Preview" }],
    })
    service.registerNotebookRenderer({
      id: "markdown-renderer",
      mimeTypes: ["text/markdown"],
      messaging: true,
    })

    expect(service.postNotebookRendererMessage({
      rendererId: "markdown-renderer",
      uri: document.uri,
      type: "preview-did-render",
      payload: {
        previewId: "preview-1",
        rawHtml: "<script>secret()</script>",
        token: "must-not-leak",
      },
    })).toBe(true)

    const projection = service.getNotebookRendererProjection()
    expect(projection).toMatchObject({
      source: "notebookRendererMessagingService",
      rendererOwner: "notebookMarkdownPreviewService",
      messageChannelOwner: "notebookRendererMessagingService",
      previewSource: "notebookMarkdownPreviewService",
      allowedMessageKinds: ["renderer-to-extension", "extension-to-renderer"],
      messageBridgeReady: true,
      uiOwnerConnected: false,
      blockedGaps: [
        "notebook-editor-webview-owner",
        "markdown-preview-webview-owner",
      ],
      rendererMessageCount: 1,
      messages: [{
        kind: "renderer-to-extension",
        rendererId: "markdown-renderer",
        uri: document.uri,
        type: "preview-did-render",
        payloadKeys: ["previewId", "rawHtml", "token"],
        payloadMetadata: {
          kind: "object",
          keyCount: 3,
          keys: ["previewId", "rawHtml", "token"],
        },
      }],
    })
    expect(service.getSmokeEvidence()).toMatchObject({
      rendererOwner: projection.rendererOwner,
      messageChannelOwner: projection.messageChannelOwner,
      rendererUiOwnerConnected: false,
      rendererBlockedGaps: projection.blockedGaps,
      markdownPreviewCount: 1,
      notebookDocumentCount: 1,
    })
    expect(service.getMarkdownPreviewSnapshot().source).toBe(projection.previewSource)
    expect(JSON.stringify(projection)).not.toContain("must-not-leak")
    expect(JSON.stringify(projection)).not.toContain("<script>secret()</script>")
  })
})
