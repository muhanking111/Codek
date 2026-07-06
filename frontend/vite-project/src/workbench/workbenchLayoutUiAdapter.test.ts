import { beforeEach, describe, expect, it } from "vitest"
import { createBottomPanelState } from "./bottomPanelState"
import { createEditorGroupState, openEditor } from "./editorGroups"
import { AGENT_EVIDENCE_WORKBENCH_VIEW_IDS, registerAgentEvidenceWorkbenchContributions } from "./agentEvidenceWorkbench"
import { MCP_WORKBENCH_VIEW_IDS, registerMcpInputCommands } from "./mcpCommands"
import { buildWorkbenchLayoutSnapshot } from "./workbenchLayoutModel"
import { buildWorkbenchLayoutUiModel } from "./workbenchLayoutUiAdapter"
import { clearViews, registerDefaultWorkbenchViews, registerView, registerViewContainer } from "./viewRegistry"

describe("workbenchLayoutUiAdapter", () => {
  beforeEach(() => {
    clearViews()
    registerDefaultWorkbenchViews()
  })

  it("projects a layout snapshot into activity bar, sidebar, editor, and panel UI props", () => {
    const editorGroups = createEditorGroupState()
    openEditor(editorGroups, "src/app.ts", { pinned: true, dirty: true })
    openEditor(editorGroups, "src/preview.ts", { preview: true })
    editorGroups.split = { open: true, file: "src/preview.ts", ratio: 65 }

    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "search",
      sidebarVisible: true,
      sidebarWidth: 344,
      bottomPanel: createBottomPanelState("terminal"),
      bottomPanelHeight: 280,
      editorGroups,
      context: { workspaceFolderCount: 1, testingEnabled: true },
      titleBar: {
        projectName: "Codek",
        agentMode: "Auto",
        sandboxMode: "read-only",
        goalCount: 2,
      },
      statusBar: {
        visible: true,
        languageId: "typescript",
        line: 7,
        column: 3,
        branch: "main",
      },
      commandSurface: {
        commandIds: ["workbench.view.search", "workbench.action.splitEditor"],
        menuIds: ["CommandPalette", "MenubarViewMenu"],
        menuEntryCount: 4,
        commandPaletteCommandIds: ["workbench.view.search"],
      },
    })

    const ui = buildWorkbenchLayoutUiModel(snapshot)

    expect(ui.activityButtons.map((button) => button.containerId)).toEqual([
      "workbench.view.explorer",
      "workbench.view.search",
      "workbench.view.scm",
      "workbench.view.extensions",
      "codek.view.symbols",
      "codek.view.agent",
      "workbench.view.settings",
    ])
    expect(ui.activityButtons.find((button) => button.containerId === "workbench.view.search")).toEqual(
      expect.objectContaining({
        active: true,
        activeViewId: "search",
        ariaLabel: "搜索",
        codicon: "codicon-search",
        iconFallback: "search",
        smokeId: "open-search",
        tooltip: "搜索",
      }),
    )
    expect(ui.activityButtons.map((button) => button.iconFallback)).toEqual([
      "files",
      "search",
      "source-control",
      "extensions",
      "symbols",
      "agent",
      "settings",
    ])
    expect(new Set(ui.activityButtons.map((button) => button.iconFallback)).size).toBe(ui.activityButtons.length)
    expect(ui.sidebar).toEqual(expect.objectContaining({
      visible: true,
      activeContainerId: "workbench.view.search",
      activeViewId: "search",
      title: "搜索",
      emptyStateTitle: "搜索工作区",
      emptyStateDescription: "输入关键词后会显示文件匹配结果。",
      width: 344,
    }))
    expect(ui.panel).toEqual({ visible: true, activePanelId: "terminal", height: 280 })
    expect(ui.editorPart).toEqual(expect.objectContaining({
      activeGroupId: "group_1",
      activeEditor: "src/preview.ts",
      totalEditors: 2,
      dirtyCount: 1,
      pinnedCount: 1,
      previewCount: 1,
      overflow: false,
      overflowCount: 0,
      splitOpen: true,
    }))
    expect(ui.titleBar).toEqual(expect.objectContaining({
      visible: true,
      projectName: "Codek",
      activeEditor: "src/preview.ts",
      activeViewId: "search",
      agentMode: "Auto",
      sandboxMode: "read-only",
      goalCount: 2,
    }))
    expect(ui.statusBar).toEqual(expect.objectContaining({
      visible: true,
      activeViewId: "search",
      activePanelId: "terminal",
      languageId: "typescript",
      line: 7,
      column: 3,
      branch: "main",
    }))
    expect(ui.commandSurface).toEqual(expect.objectContaining({
      visible: true,
      commandCount: 2,
      menuEntryCount: 4,
      commandPaletteCommandIds: ["workbench.view.search"],
    }))
  })

  it("keeps hidden containers out and marks fallback containers as observable", () => {
    registerViewContainer({ id: "codek.view.hidden", name: "隐藏", location: "activityBar", icon: "missing", order: 5 })
    registerView({
      id: "codek.view.hidden.default",
      name: "隐藏",
      containerId: "codek.view.hidden",
      when: "hiddenEnabled",
    })

    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "files",
      sidebarVisible: false,
      bottomPanel: createBottomPanelState(),
      editorGroups: createEditorGroupState(),
      context: { hiddenEnabled: false },
    })
    const ui = buildWorkbenchLayoutUiModel(snapshot)

    expect(ui.activityButtons.map((button) => button.containerId)).not.toContain("codek.view.hidden")
    expect(ui.activityButtons.map((button) => button.containerId)).not.toContain("workbench.view.debug")
    expect(ui.activityButtons.map((button) => button.containerId)).not.toContain("codek.view.automation")
    expect(ui.activityButtons.map((button) => button.containerId)).not.toContain("codek.view.remote")
    expect(ui.activityButtons.map((button) => button.containerId)).not.toContain("workbench.view.testing")
    expect(ui.sidebar.visible).toBe(false)
    expect(ui.sidebar.width).toBeNull()
  })

  it("keeps non-default extension and evidence containers out of the activity bar", () => {
    registerViewContainer({ id: "codek.view.badged", name: "Badge", location: "activityBar", order: 12 })
    registerView({
      id: "codek.view.badged.default",
      name: "Badge",
      containerId: "codek.view.badged",
      badge: "!",
    })

    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "codek.view.badged",
      sidebarVisible: true,
      bottomPanel: createBottomPanelState(),
      editorGroups: createEditorGroupState(),
    })
    const ui = buildWorkbenchLayoutUiModel(snapshot)

    expect(ui.activityButtons.map((button) => button.containerId)).not.toContain("codek.view.badged")
  })

  it("keeps Agent Evidence available as a sidebar surface without adding a default activity entry", () => {
    registerAgentEvidenceWorkbenchContributions().dispose()
    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "agentEvidence",
      sidebarVisible: true,
      bottomPanel: createBottomPanelState(),
      editorGroups: createEditorGroupState(),
      context: { agentEvidenceAvailable: true },
    })

    const ui = buildWorkbenchLayoutUiModel(snapshot)

    expect(ui.activityButtons.map((item) => item.containerId)).not.toContain(AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container)
    expect(ui.sidebar.activeContainerId).toBe(AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container)
    expect(ui.sidebar.activeViewId).toBe("agentEvidence")
  })

  it("assigns stable MCP smoke ids and sidebar view metadata", () => {
    const disposable = registerMcpInputCommands()
    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "mcp",
      sidebarVisible: true,
      bottomPanel: createBottomPanelState(),
      editorGroups: createEditorGroupState(),
    })

    const ui = buildWorkbenchLayoutUiModel(snapshot)
    const button = ui.activityButtons.find((item) => item.containerId === MCP_WORKBENCH_VIEW_IDS.Container)

    expect(button).toEqual(expect.objectContaining({
      active: true,
      activeViewId: "mcp",
      smokeId: "open-mcp",
      iconFallback: "plug",
      codicon: "codicon-plug",
    }))
    expect(ui.sidebar.activeContainerId).toBe(MCP_WORKBENCH_VIEW_IDS.Container)
    expect(ui.sidebar.activeViewId).toBe("mcp")
    expect(ui.sidebar.views.map((view) => view.id)).toEqual([
      MCP_WORKBENCH_VIEW_IDS.Servers,
      MCP_WORKBENCH_VIEW_IDS.Resources,
      MCP_WORKBENCH_VIEW_IDS.Gallery,
    ])

    disposable.dispose()
  })

  it("keeps secondary extension and trust/auth containers out of the default activity bar", () => {
    registerViewContainer({
      id: "claude-sidebar-secondary",
      name: "Claude Code",
      location: "activityBar",
      icon: "resources/claude-logo.svg",
      source: "extension",
      order: 1,
    })
    registerView({
      id: "claudeVSCodeSidebarSecondary",
      name: "Claude Code",
      containerId: "claude-sidebar-secondary",
      location: "sideBar",
      source: "extension",
    })
    registerViewContainer({
      id: "codek.view.extensionTrustRemoteAuth",
      name: "Extension/Trust/Remote/Auth",
      location: "activityBar",
      icon: "shield",
      source: "vscode",
      order: 57,
    })
    registerView({
      id: "codek.view.extensionTrustRemoteAuth.extensionHost",
      name: "Extension Host",
      containerId: "codek.view.extensionTrustRemoteAuth",
      location: "sideBar",
      source: "vscode",
    })

    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "claude-sidebar-secondary",
      sidebarVisible: true,
      bottomPanel: createBottomPanelState(),
      editorGroups: createEditorGroupState(),
    })
    const ui = buildWorkbenchLayoutUiModel(snapshot)
    expect(ui.activityButtons.map((button) => button.containerId)).not.toContain("claude-sidebar-secondary")
    expect(ui.activityButtons.map((button) => button.containerId)).not.toContain("codek.view.extensionTrustRemoteAuth")
    expect(ui.sidebar.activeContainerId).toBe("claude-sidebar-secondary")
    expect(ui.sidebar.title).toBe("Claude Code")
  })

  it("sanitizes unknown extension ids, icon paths, and placeholder metadata for user-visible chrome", () => {
    registerViewContainer({
      id: "publisher.extension.internalView",
      name: "publisher.extension.internalView",
      location: "activityBar",
      icon: "resources/activity.svg",
      source: "extension",
      order: 2,
    })
    registerView({
      id: "publisher.extension.internalView.default",
      name: "publisher.extension.internalView.default",
      containerId: "publisher.extension.internalView",
      location: "sideBar",
      source: "extension",
    })

    const snapshot = buildWorkbenchLayoutSnapshot({
      activeSidebarView: "publisher.extension.internalView",
      sidebarVisible: true,
      bottomPanel: createBottomPanelState(),
      editorGroups: createEditorGroupState(),
    })
    const ui = buildWorkbenchLayoutUiModel(snapshot)
    const extensionButton = ui.activityButtons.find((button) => button.containerId === "publisher.extension.internalView")

    expect(extensionButton).toBeUndefined()
    expect(ui.sidebar).toEqual(expect.objectContaining({
      title: "Publisher Extension Internal View",
      emptyStateTitle: "Publisher Extension Internal View",
      emptyStateDescription: "当前视图还没有可显示的内容。",
    }))
    expect(ui.sidebar.views[0]).toEqual(expect.objectContaining({
      name: "Publisher Extension Internal View",
      source: "extension",
    }))
  })
})
