import { beforeEach, describe, expect, it } from "vitest"
import { createBottomPanelState } from "./bottomPanelState"
import { createEditorGroupState, openEditor } from "./editorGroups"
import {
  AGENT_EVIDENCE_WORKBENCH_VIEW_IDS,
  registerAgentEvidenceWorkbenchContributions,
} from "./agentEvidenceWorkbench"
import { MCP_WORKBENCH_VIEW_IDS, registerMcpInputCommands } from "./mcpCommands"
import {
  activateWorkbenchViewContainer,
  buildWorkbenchLayoutSnapshot,
  deserializeWorkbenchLayoutSnapshot,
  restoreWorkbenchLayoutStateFromSnapshot,
  serializeWorkbenchLayoutSnapshot,
  type WorkbenchLayoutState,
} from "./workbenchLayoutModel"
import { clearViews, registerDefaultWorkbenchViews, registerView, registerViewContainer } from "./viewRegistry"

describe("workbenchLayoutModel", () => {
  beforeEach(() => {
    clearViews()
    registerDefaultWorkbenchViews()
  })

  it("projects activity bar, sidebar, panel, and editor part into a serializable snapshot", () => {
    const editorGroups = createEditorGroupState()
    openEditor(editorGroups, "src/app.ts", { pinned: true })
    openEditor(editorGroups, "src/preview.ts", { preview: true })
    const bottomPanel = createBottomPanelState("terminal")

    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "search",
      sidebarVisible: true,
      sidebarWidth: 304,
      bottomPanel,
      bottomPanelHeight: 220,
      editorGroups,
      context: { workspaceFolderCount: 1 },
      titleBar: {
        projectName: "Codek",
        agentMode: "Agent",
        sandboxMode: "workspace-write",
      },
      statusBar: {
        visible: true,
        languageId: "typescript",
        line: 12,
        column: 8,
        errorCount: 1,
        warningCount: 2,
      },
      commandSurface: {
        commandIds: ["workbench.view.search", "workbench.action.toggleSidebarVisibility"],
        menuIds: ["CommandPalette", "MenubarViewMenu"],
        menuEntryCount: 7,
        commandPaletteCommandIds: ["workbench.view.search"],
      },
    })

    expect(snapshot.parts.activityBar.visible).toBe(true)
    expect(snapshot.parts.activityBar.containers.map((container) => container.activeViewId)).toContain("search")
    expect(snapshot.parts.sideBar).toEqual(expect.objectContaining({
      visible: true,
      activeViewId: "search",
      activeContainerId: "workbench.view.search",
      width: 304,
    }))
    expect(snapshot.parts.panel).toEqual({ visible: true, activePanelId: "terminal", height: 220 })
    expect(snapshot.parts.editorPart.groups[0]).toEqual(expect.objectContaining({
      activeEditor: "src/preview.ts",
      editorCount: 2,
    }))
    expect(snapshot.parts.editorPart).toEqual(expect.objectContaining({
      activeEditor: "src/preview.ts",
      totalEditors: 2,
      dirtyCount: 0,
      pinnedCount: 1,
      previewCount: 1,
      overflow: expect.objectContaining({ overflow: false, overflowCount: 0 }),
    }))
    expect(snapshot.parts.titleBar).toEqual(expect.objectContaining({
      visible: true,
      projectName: "Codek",
      activeEditor: "src/preview.ts",
      activeViewId: "search",
      agentMode: "Agent",
      sandboxMode: "workspace-write",
      commandPaletteHint: "Ctrl+Shift+P",
    }))
    expect(snapshot.parts.statusBar).toEqual(expect.objectContaining({
      visible: true,
      activeViewId: "search",
      activePanelId: "terminal",
      languageId: "typescript",
      line: 12,
      column: 8,
      errorCount: 1,
      warningCount: 2,
    }))
    expect(snapshot.parts.commandSurface).toEqual(expect.objectContaining({
      visible: true,
      commandCount: 2,
      commandIds: ["workbench.view.search", "workbench.action.toggleSidebarVisibility"],
      menuIds: ["CommandPalette", "MenubarViewMenu"],
      menuEntryCount: 7,
      commandPaletteCommandIds: ["workbench.view.search"],
    }))
    expect(snapshot.parts.paneComposite).toEqual(expect.objectContaining({
      stateSource: "workbenchLayoutService",
      locations: expect.objectContaining({
        sideBar: expect.objectContaining({ activeCompositeId: null, openCount: 0 }),
        panel: expect.objectContaining({ activeCompositeId: null, openCount: 0 }),
      }),
    }))

    const serialized = serializeWorkbenchLayoutSnapshot(snapshot)
    expect(JSON.parse(serialized)).toEqual(snapshot)
  })

  it("hydrates older persisted layout snapshots with title, status, and command surface defaults", () => {
    const editorGroups = createEditorGroupState()
    openEditor(editorGroups, "src/legacy.ts", { pinned: true })
    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "files",
      sidebarVisible: true,
      bottomPanel: createBottomPanelState(),
      editorGroups,
    })
    const legacyRaw = {
      version: 1,
      parts: {
        activityBar: snapshot.parts.activityBar,
        sideBar: snapshot.parts.sideBar,
        panel: snapshot.parts.panel,
        editorPart: snapshot.parts.editorPart,
      },
    }

    const restored = deserializeWorkbenchLayoutSnapshot(JSON.stringify(legacyRaw))

    expect(restored?.parts.titleBar).toEqual(expect.objectContaining({
      visible: true,
      activeEditor: "src/legacy.ts",
      activeViewId: "files",
    }))
    expect(restored?.parts.statusBar).toEqual(expect.objectContaining({
      visible: true,
      activeViewId: "files",
      activePanelId: null,
    }))
    expect(restored?.parts.commandSurface).toEqual(expect.objectContaining({
      visible: false,
      commandCount: 0,
      menuEntryCount: 0,
    }))
    expect(restored?.parts.paneComposite).toEqual(expect.objectContaining({
      stateSource: "workbenchLayoutService",
      events: [],
      locations: expect.objectContaining({
        sideBar: expect.objectContaining({ visible: false }),
        panel: expect.objectContaining({ visible: false }),
      }),
    }))
  })

  it("maps Codek sidebar ids onto VS Code view containers without adding a second UI state source", () => {
    const state: WorkbenchLayoutState = {
      activeSidebarView: "files",
      sidebarVisible: true,
    }

    const result = activateWorkbenchViewContainer(state, "workbench.view.scm")

    expect(result).toEqual({ activated: true, viewId: "changes", containerId: "workbench.view.scm" })
    expect(state).toEqual({ activeSidebarView: "changes", sidebarVisible: true })
  })

  it("maps Agent Evidence activity container onto the Agent Evidence sidebar view when context enables it", () => {
    registerAgentEvidenceWorkbenchContributions().dispose()
    const state: WorkbenchLayoutState = {
      activeSidebarView: "files",
      sidebarVisible: true,
    }

    const result = activateWorkbenchViewContainer(state, AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container, { agentEvidenceAvailable: true })
    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "agentEvidence",
      sidebarVisible: true,
      bottomPanel: createBottomPanelState(),
      editorGroups: createEditorGroupState(),
      context: { agentEvidenceAvailable: true },
    })

    expect(result).toEqual({ activated: true, viewId: "agentEvidence", containerId: AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container })
    expect(state).toEqual({ activeSidebarView: "agentEvidence", sidebarVisible: true })
    expect(snapshot.parts.activityBar.containers.map((container) => container.containerId)).toContain(AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container)
    expect(snapshot.parts.sideBar).toEqual(expect.objectContaining({
      activeContainerId: AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container,
      activeViewId: "agentEvidence",
      title: "智能体证据",
    }))
    expect(snapshot.parts.sideBar.views.map((view) => view.id)).toEqual(expect.arrayContaining([
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Timeline,
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Progress,
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Notifications,
    ]))
  })

  it("maps MCP activity container onto the MCP sidebar view without creating another MCP state source", () => {
    const disposable = registerMcpInputCommands()
    const state: WorkbenchLayoutState = {
      activeSidebarView: "files",
      sidebarVisible: false,
    }

    const result = activateWorkbenchViewContainer(state, MCP_WORKBENCH_VIEW_IDS.Container)
    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "mcp",
      sidebarVisible: true,
      bottomPanel: createBottomPanelState(),
      editorGroups: createEditorGroupState(),
    })

    expect(result).toEqual({ activated: true, viewId: "mcp", containerId: MCP_WORKBENCH_VIEW_IDS.Container })
    expect(state).toEqual({ activeSidebarView: "mcp", sidebarVisible: true })
    expect(snapshot.parts.sideBar).toEqual(expect.objectContaining({
      activeContainerId: MCP_WORKBENCH_VIEW_IDS.Container,
      activeViewId: "mcp",
      title: "MCP",
    }))
    expect(snapshot.parts.sideBar.views.map((view) => view.id)).toEqual([
      MCP_WORKBENCH_VIEW_IDS.Servers,
      MCP_WORKBENCH_VIEW_IDS.Resources,
      MCP_WORKBENCH_VIEW_IDS.Gallery,
    ])

    disposable.dispose()
  })

  it("restores sidebar, panel, and split layout state from a persisted snapshot without touching open editors", () => {
    const editorGroups = createEditorGroupState()
    openEditor(editorGroups, "src/app.ts", { pinned: true })
    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "symbols",
      sidebarVisible: true,
      sidebarWidth: 360,
      bottomPanel: createBottomPanelState("output"),
      bottomPanelHeight: 260,
      editorGroups: {
        ...editorGroups,
        split: { open: true, file: "src/app.ts", ratio: 62 },
      },
    })
    const serialized = serializeWorkbenchLayoutSnapshot(snapshot)
    const restored = deserializeWorkbenchLayoutSnapshot(serialized)
    const calls: string[] = []

    const result = restoreWorkbenchLayoutStateFromSnapshot(restored, {
      setActiveSidebarView: (view) => calls.push(`view:${view}`),
      setSidebarVisible: (visible) => calls.push(`sidebar:${visible}`),
      setSidebarWidth: (width) => calls.push(`width:${width}`),
      setBottomPanel: (panel) => calls.push(`panel:${panel}`),
      setBottomPanelHeight: (height) => calls.push(`panelHeight:${height}`),
      setSplitOpen: (open) => calls.push(`split:${open}`),
      setSplitFile: (file) => calls.push(`splitFile:${file}`),
      setSplitRatio: (ratio) => calls.push(`splitRatio:${ratio}`),
    })

    expect(result.restored).toBe(true)
    expect(calls).toEqual([
      "view:symbols",
      "sidebar:true",
      "width:360",
      "panel:output",
      "panelHeight:260",
      "split:true",
      "splitFile:src/app.ts",
      "splitRatio:62",
    ])
  })

  it("rejects corrupt or incompatible layout snapshots during restore", () => {
    expect(deserializeWorkbenchLayoutSnapshot("{not json")).toBeNull()
    expect(deserializeWorkbenchLayoutSnapshot({ version: 99 })).toBeNull()
    expect(restoreWorkbenchLayoutStateFromSnapshot(null, {}).restored).toBe(false)
  })

  it("keeps empty or disabled containers out of the activity/sidebar snapshot", () => {
    registerViewContainer({ id: "codek.view.conditionalTesting", name: "条件测试", location: "activityBar", source: "codek", order: 15 })
    registerView({
      id: "codek.view.conditionalTesting.testExplorer",
      name: "条件测试资源管理器",
      containerId: "codek.view.conditionalTesting",
      when: "testingEnabled",
      order: 0,
    })

    const hiddenSnapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "codek.view.conditionalTesting",
      sidebarVisible: true,
      bottomPanel: createBottomPanelState(),
      editorGroups: createEditorGroupState(),
      context: { testingEnabled: false },
    })
    expect(hiddenSnapshot.parts.activityBar.containers.map((container) => container.containerId)).not.toContain("codek.view.conditionalTesting")
    expect(hiddenSnapshot.parts.sideBar.activeContainerId).toBe("workbench.view.explorer")
    expect(hiddenSnapshot.parts.sideBar.activeViewId).toBe("files")

    const visibleSnapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "codek.view.conditionalTesting",
      sidebarVisible: true,
      bottomPanel: createBottomPanelState(),
      editorGroups: createEditorGroupState(),
      context: { testingEnabled: true },
    })
    expect(visibleSnapshot.parts.activityBar.containers.map((container) => container.containerId)).toContain("codek.view.conditionalTesting")
    expect(visibleSnapshot.parts.sideBar.activeContainerId).toBe("codek.view.conditionalTesting")
  })

  it("projects view badges through the activity container model", () => {
    registerViewContainer({ id: "codek.view.badged", name: "Badge", location: "activityBar", source: "codek", order: 12 })
    registerView({
      id: "codek.view.badged.alpha",
      name: "Alpha",
      containerId: "codek.view.badged",
      badge: 2,
      order: 0,
    })
    registerView({
      id: "codek.view.badged.beta",
      name: "Beta",
      containerId: "codek.view.badged",
      badge: 3,
      order: 1,
    })

    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "codek.view.badged",
      sidebarVisible: true,
      bottomPanel: createBottomPanelState(),
      editorGroups: createEditorGroupState(),
    })

    expect(snapshot.parts.activityBar.containers.find((container) => container.containerId === "codek.view.badged")?.badge).toBe(5)
  })

  it("projects child view progress through the activity container model", () => {
    registerViewContainer({ id: "codek.view.progress", name: "Progress", location: "activityBar", source: "agent", order: 12 })
    registerView({
      id: "codek.view.progress.agent",
      name: "Agent Progress",
      containerId: "codek.view.progress",
      progress: "syncing",
      order: 0,
    })

    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "codek.view.progress",
      sidebarVisible: true,
      bottomPanel: createBottomPanelState(),
      editorGroups: createEditorGroupState(),
    })

    expect(snapshot.parts.activityBar.containers.find((container) => container.containerId === "codek.view.progress")).toEqual(expect.objectContaining({
      badge: undefined,
      progress: "syncing",
    }))
  })

  it("projects user-readable sidebar metadata without using internal ids as visible labels", () => {
    registerViewContainer({
      id: "publisher.extension.internalView",
      name: "publisher.extension.internalView",
      location: "activityBar",
      source: "extension",
      icon: "resources/activity.svg",
      order: 12,
    })
    registerView({
      id: "publisher.extension.internalView.default",
      name: "publisher.extension.internalView.default",
      containerId: "publisher.extension.internalView",
      source: "extension",
      order: 0,
    })

    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "publisher.extension.internalView",
      sidebarVisible: true,
      bottomPanel: createBottomPanelState(),
      editorGroups: createEditorGroupState(),
    })

    expect(snapshot.parts.sideBar.activeContainerId).toBe("publisher.extension.internalView")
    expect(snapshot.parts.sideBar.title).toBe("Publisher Extension Internal View")
    expect(snapshot.parts.sideBar.emptyStateTitle).toBe("Publisher Extension Internal View")
    expect(snapshot.parts.sideBar.views[0]).toEqual(expect.objectContaining({
      id: "publisher.extension.internalView.default",
      name: "Publisher Extension Internal View",
      source: "extension",
    }))
  })

  it("projects editor part overflow through the shared editor part service boundary", () => {
    const editorGroups = createEditorGroupState()
    for (let index = 1; index <= 10; index += 1) {
      openEditor(editorGroups, `src/file-${index}.ts`, { permanent: true })
    }

    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "files",
      sidebarVisible: true,
      bottomPanel: createBottomPanelState(),
      editorGroups,
    })

    expect(snapshot.parts.editorPart).toEqual(expect.objectContaining({
      activeEditor: "src/file-10.ts",
      totalEditors: 10,
      overflow: {
        totalEditors: 10,
        visibleEditors: 8,
        overflowCount: 2,
        overflow: true,
      },
    }))
  })
})
