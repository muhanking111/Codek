import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ActivityProductIcon from "./components/ActivityProductIcon.vue"
import WorkingCopyTabBadge from "./components/WorkingCopyTabBadge.vue"
import { getProductIconPaths, resolveProductIcon } from "./workbench/productIcons"
import type { EditorTabState } from "./workspace/manager"

function createEditorTabState(overrides: Partial<EditorTabState> = {}): EditorTabState {
  return {
    path: "src/main.ts",
    dirty: true,
    saving: false,
    conflict: false,
    orphan: false,
    backupRestored: true,
    badge: "backup-restored",
    titleDecoration: "backup-restored",
    labelSuffix: "已恢复备份",
    state: "dirty",
    largeFileRange: false,
    ...overrides,
  }
}

describe("app working copy tab DOM", () => {
  it("renders restored backup state as an observable tab badge", () => {
    const wrapper = mount(WorkingCopyTabBadge, {
      props: { state: createEditorTabState(), fallbackTitle: "Unsaved" },
    })

    const badge = wrapper.find(".tab-dirty")
    expect(badge.exists()).toBe(true)
    expect(badge.classes()).toContain("tab-dirty-backup-restored")
    expect(badge.attributes("data-working-copy-badge")).toBe("backup-restored")
    expect(badge.attributes("title")).toBe("已恢复备份")
  })

  it("keeps conflict and orphan badge states distinguishable", () => {
    const conflict = mount(WorkingCopyTabBadge, {
      props: {
        state: createEditorTabState({ badge: "conflict", conflict: true, labelSuffix: "冲突" }),
      },
    })
    const orphan = mount(WorkingCopyTabBadge, {
      props: {
        state: createEditorTabState({ badge: "orphan", orphan: true, labelSuffix: "已删除" }),
      },
    })

    expect(conflict.find(".tab-dirty-conflict").exists()).toBe(true)
    expect(orphan.find(".tab-dirty-orphan").exists()).toBe(true)
  })

  it("does not render a restore badge for clean or pinned tabs", () => {
    const clean = mount(WorkingCopyTabBadge, {
      props: { state: createEditorTabState({ dirty: false, badge: null, backupRestored: false }) },
    })
    const pinned = mount(WorkingCopyTabBadge, {
      props: { state: createEditorTabState(), pinned: true },
    })

    expect(clean.find(".tab-dirty").exists()).toBe(false)
    expect(pinned.find(".tab-dirty").exists()).toBe(false)
  })
})

describe("app workbench layout DOM contract", () => {
  it("wires the main workbench shell to the layout snapshot UI model", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).toContain("workbenchLayoutUi.activityButtons")
    expect(appSource).toContain("globalWorkbenchLayoutService.createSnapshot")
    expect(appSource).toContain(':data-workbench-container-id="button.containerId"')
    expect(appSource).toContain(
      ':data-workbench-view-id="workbenchLayoutUi.sidebar.activeViewId || activeView"',
    )
    expect(appSource).toContain(':data-workbench-icon="button.iconFallback"')
    expect(appSource).toContain('data-workbench-editor-part="true"')
    expect(appSource).toContain(
      ":data-workbench-active-editor=\"workbenchLayoutUi.editorPart.activeEditor || ''\"",
    )
    expect(appSource).toContain(
      ':data-workbench-overflow-count="workbenchLayoutUi.editorPart.overflowCount"',
    )
    expect(appSource).toContain(
      ":data-workbench-panel-id=\"workbenchLayoutUi.panel.activePanelId || ''\"",
    )
    expect(appSource).toContain('data-workbench-title-bar="true"')
    expect(appSource).toContain(
      ':data-workbench-title-project="workbenchLayoutUi.titleBar.projectName"',
    )
    expect(appSource).toContain(
      ":data-workbench-title-active-editor=\"workbenchLayoutUi.titleBar.activeEditor || ''\"",
    )
    expect(appSource).toContain('data-workbench-status-bar="true"')
    expect(appSource).toContain(
      ":data-workbench-status-active-view=\"workbenchLayoutUi.statusBar.activeViewId || ''\"",
    )
    expect(appSource).toContain(
      ':data-workbench-status-language="workbenchLayoutUi.statusBar.languageId"',
    )
    expect(appSource).toContain(
      ':data-workbench-status-service-entry-count="workbenchStatusbarEntries.length"',
    )
    expect(appSource).toContain(
      ':data-workbench-notification-service-count="workbenchNotificationItems.length"',
    )
    expect(appSource).toContain(
      ':data-workbench-progress-service-count="workbenchProgressTasks.length"',
    )
    expect(appSource).toContain('data-workbench-command-surface="true"')
    expect(appSource).toContain(
      ':data-workbench-command-count="workbenchLayoutUi.commandSurface.commandCount"',
    )
    expect(appSource).toContain(
      ':data-workbench-command-palette-count="workbenchLayoutUi.commandSurface.commandPaletteCommandIds.length"',
    )
    expect(appSource).toContain(
      ":data-workbench-service-menu-ids=\"workbenchServiceMenuIds.join(',')\"",
    )
    expect(appSource).toContain(
      ':data-workbench-service-menu-entry-count="workbenchServiceMenuEntryCount"',
    )
    expect(appSource).toContain("workbenchTitleBarVisible")
    expect(appSource).toContain("workbenchStatusBarVisible")
    expect(appSource).toContain("workbenchCommandSurfaceVisible")
  })

  it("projects migrated status, notification, progress, and menu services into the app bridge", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).toContain("globalWorkbenchStatusNotificationProgressService")
    expect(appSource).toContain("onDidChangeStatusbar")
    expect(appSource).toContain("onDidChangeNotifications")
    expect(appSource).toContain("onDidChangeProgress")
    expect(appSource).toContain("workbenchStatusbarLeftEntries")
    expect(appSource).toContain("workbenchStatusbarRightEntries")
    expect(appSource).toContain(
      'class="status-item status-clickable workbench-status-service-entry"',
    )
    expect(appSource).toContain(':data-workbench-status-service-entry-id="entry.id"')
    expect(appSource).toContain('@click="entry.command && executeCommand(entry.command)"')
    expect(appSource).toContain("MenuRegistry.onDidChangeMenu")
    expect(appSource).toContain("getWorkbenchServiceMenuEntries(context)")
    expect(appSource).toContain("MenuId.SCMTitle")
    expect(appSource).toContain("MenuId.SCMResourceContext")
    expect(appSource).toContain("MenuId.TestItem")
    expect(appSource).toContain("MenuId.AgentEvidenceTimeline")
    expect(appSource).toContain("workbenchStatusbarSubscription?.dispose?.()")
    expect(appSource).toContain("workbenchMenuRegistrySubscription?.dispose?.()")
    expect(appSource).not.toContain("D:\\SourceMirror")
    expect(appSource).not.toContain("SourceMirror/vscode")
  })

  it("routes legacy markdown preview UI through the notebook markdown preview service bridge", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).toContain("globalLegacyMarkdownPreviewController")
    expect(appSource).toContain("globalNotebookMarkdownPreviewWorkbenchService")
    expect(appSource).toContain("markdownPreviewSnapshot")
    expect(appSource).toContain("getMarkdownPreviewSnapshot()")
    expect(appSource).toContain(
      ':data-markdown-preview-service-source="markdownPreviewSnapshot.source"',
    )
    expect(appSource).toContain(
      ':data-markdown-preview-count="markdownPreviewSnapshot.previewCount"',
    )
    expect(appSource).toContain(
      ':data-markdown-preview-active-resource="markdownPreviewSnapshot.activeResource"',
    )
    expect(appSource).toContain(
      ":data-markdown-preview-lifecycle=\"activeMarkdownPreview?.lifecycle || ''\"",
    )
    expect(appSource).toContain(
      ':data-markdown-preview-version="activeMarkdownPreview?.versionId || 0"',
    )
    expect(appSource).toContain(
      ':data-notebook-service-id="notebookWebviewCustomEditorSmokeEvidence.notebookServiceId"',
    )
    expect(appSource).toContain(
      ':data-notebook-serializer-count="notebookWebviewCustomEditorSmokeEvidence.notebookSerializerCount"',
    )
    expect(appSource).toContain(
      ':data-notebook-document-count="notebookWebviewCustomEditorSmokeEvidence.notebookDocumentCount"',
    )
    expect(appSource).toContain(
      ':data-notebook-active-resource="notebookWebviewCustomEditorSmokeEvidence.activeNotebookResource"',
    )
    expect(appSource).toContain(
      ':data-notebook-renderer-count="notebookWebviewCustomEditorSmokeEvidence.notebookRendererCount"',
    )
    expect(appSource).toContain(
      ':data-notebook-renderer-message-count="notebookWebviewCustomEditorSmokeEvidence.notebookRendererMessageCount"',
    )
    expect(appSource).toContain(
      ':data-webview-service-id="notebookWebviewCustomEditorSmokeEvidence.webviewServiceId"',
    )
    expect(appSource).toContain(
      ':data-webview-panel-count="notebookWebviewCustomEditorSmokeEvidence.webviewPanelCount"',
    )
    expect(appSource).toContain(
      ':data-webview-active-panel-id="notebookWebviewCustomEditorSmokeEvidence.activeWebviewPanelId"',
    )
    expect(appSource).toContain(
      ':data-custom-editor-service-id="notebookWebviewCustomEditorSmokeEvidence.customEditorServiceId"',
    )
    expect(appSource).toContain(
      ':data-custom-editor-restored-count="notebookWebviewCustomEditorSmokeEvidence.restoredCustomEditorCount"',
    )
    expect(appSource).toContain(
      ':data-custom-editor-dirty-count="notebookWebviewCustomEditorSmokeEvidence.customEditorDirtyCount"',
    )
    expect(appSource).toContain(
      ':data-webview-message-bridge-ready="notebookWebviewCustomEditorSmokeEvidence.webviewMessageBridgeReady"',
    )
    expect(appSource).toContain(
      ':data-webview-resource-guard-ready="notebookWebviewCustomEditorSmokeEvidence.webviewResourceGuardReady"',
    )
    expect(appSource).toContain("setLegacyMarkdownPreviewOpen")
    expect(appSource).toContain("globalLegacyMarkdownPreviewController.setOpen(open")
    expect(appSource).toContain("globalLegacyMarkdownPreviewController.refresh(resource, content)")
    expect(appSource).toContain("globalLegacyMarkdownPreviewController.dispose(closeResource)")
    expect(appSource).toContain("runNotebookMarkdownPreviewSmoke: async (input = {}) => {")
    expect(appSource).toContain(
      "const preview = globalNotebookMarkdownPreviewWorkbenchService.openMarkdownPreview({",
    )
    expect(appSource).toContain(
      "globalNotebookMarkdownPreviewWorkbenchService.openNotebookDocument({",
    )
    expect(appSource).toContain(
      "globalNotebookMarkdownPreviewWorkbenchService.registerNotebookKernel({",
    )
    expect(appSource).toContain(
      "globalNotebookMarkdownPreviewWorkbenchService.registerNotebookRenderer({",
    )
    expect(appSource).toContain(
      "globalNotebookMarkdownPreviewWorkbenchService.postNotebookRendererMessage({",
    )
    expect(appSource).toContain("window.__codekSmokeNotebookMarkdownPreviewResult")
    expect(appSource).toContain(
      "notebookRendererMessageCount: notebookEvidence.rendererMessageCount",
    )
    expect(appSource).toContain(
      'owner: "App.vue __codekSmokeWorkbenchControls.runNotebookMarkdownPreviewSmoke"',
    )
    expect(appSource).toContain(
      "const resource = input.resource || getActiveMarkdownPreviewResource()",
    )
    expect(appSource).toContain("content: input.content ?? currentFileContent.value")
    expect(appSource).toContain('source: "legacy"')
    expect(appSource).toContain("markdownPreviewServiceRevision.value += 1")
    expect(appSource).toContain("onDidChange((event)")
    expect(appSource).toContain('event.kind.startsWith("markdown-")')
    expect(appSource).toContain("setMarkdownPreviewOpen: (open) => {")
    expect(appSource).toContain("setLegacyMarkdownPreviewOpen(open)")
  })

  it("does not expose internal activity abbreviations or view source tags in user-visible workbench chrome", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).toContain("ActivityProductIcon")
    expect(appSource).not.toContain("iconFallback.slice(0, 2)")
    expect(appSource).not.toContain("{{ view.source }}")
    expect(appSource).not.toContain(':data-workbench-source="button.source"')
    expect(appSource).not.toContain(':data-workbench-view-source="view.source"')
    expect(appSource).not.toContain(">EH {{")
    expect(appSource).not.toContain(">Trust {{")
    expect(appSource).not.toContain(">Remote {{")
    expect(appSource).not.toContain(">Auth {{")
    expect(appSource).not.toContain(">Extension Host")
    expect(appSource).not.toContain(">Workspace Trust")
    expect(appSource).not.toContain(">Remote Authority")
    expect(appSource).not.toContain(">Authentication")
    expect(appSource).toContain("扩展宿主")
    expect(appSource).toContain("工作区信任")
    expect(appSource).toContain("远程解析")
    expect(appSource).toContain("认证")
    expect(appSource).toContain("workbenchLayoutUi.sidebar.emptyStateTitle")
    expect(appSource).toContain("workbenchLayoutUi.sidebar.emptyStateDescription")
  })

  it("does not render the removed auxiliary activity bar shortcuts", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).not.toContain('data-codek-smoke="open-problems"')
    expect(appSource).not.toContain('data-codek-smoke="open-chat"')
    expect(appSource).not.toContain("notepadVisible")
    expect(appSource).not.toContain("smartRewriteVisible")
    expect(appSource).not.toContain("NotepadsPanel")
    expect(appSource).not.toContain("SmartRewritePanel")
    expect(appSource).toContain("toggleProblemsPanel")
    expect(appSource).toContain("toggleChatPanel")
  })

  it("uses dedicated semantic SVG definitions for visible activity bar entries", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")
    const requiredIcons = [
      "files",
      "search",
      "source-control",
      "debug",
      "extensions",
      "symbols",
      "assistant-panel",
      "plug",
      "agent",
      "agent-evidence",
      "automation",
      "shield",
      "remote",
      "testing",
      "warning",
      "tasklist",
      "output",
      "settings",
    ]

    for (const icon of requiredIcons) {
      expect(resolveProductIcon(icon).fallback).toBe(icon)
      expect(getProductIconPaths(icon).length).toBeGreaterThan(0)
    }
    expect(appSource).not.toContain("ACTIVITY_ICON_PATHS")
    expect(appSource).not.toContain("|| ACTIVITY_ICON_PATHS.files")
    expect(getProductIconPaths("missing-extension-icon")).toEqual(getProductIconPaths("unknown"))
  })

  it("renders activity product icons from the product icon registry instead of text fallbacks", () => {
    const wrapper = mount(ActivityProductIcon, {
      props: { icon: "search" },
    })

    expect(wrapper.find("svg.activity-product-icon").exists()).toBe(true)
    expect(wrapper.findAll("path").map((path) => path.attributes("d"))).toEqual([
      ...getProductIconPaths("search"),
    ])
    expect(wrapper.text()).toBe("")
  })

  it("keeps the EditorPart probe scoped to the editor surface, not the workbench main container", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")
    const editorSurfaceMatch = appSource.match(
      /<div\s+class="editor-wrapper"[\s\S]*?data-workbench-editor-part="true"/,
    )
    const mainAreaMatch = appSource.match(/<div\s+class="main-area"[\s\S]*?>/)

    expect(editorSurfaceMatch).not.toBeNull()
    expect(mainAreaMatch?.[0] || "").not.toContain("data-workbench-editor-part")
  })

  it("renders open files from the workbench editor service instead of a local openFiles array", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).toContain("const workbenchOpenEditorsModel = computed(() => {")
    expect(appSource).toContain("return globalWorkbenchExplorerEditorService.getOpenEditorsModel()")
    expect(appSource).toContain(
      "return workbenchOpenEditorsModel.value.entries.map((entry) => entry.path)",
    )
    expect(appSource).toContain(
      ':data-workbench-open-editors-source="workbenchOpenEditorsModel.source"',
    )
    expect(appSource).toContain(
      ':data-workbench-open-editors-count="workbenchOpenEditorsModel.entries.length"',
    )
    expect(appSource).toContain('data-workbench-no-local-open-files-state="true"')
    expect(appSource).toContain(
      "editorGroups: globalWorkbenchExplorerEditorService.getEditorGroupState()",
    )
    expect(appSource).toContain(
      "globalWorkbenchExplorerEditorService.replaceEditorGroupStateFromOpenFiles({",
    )
    expect(appSource).not.toContain("const openFiles = ref(")
  })

  it("renders Agent Evidence through the workbench surface DOM contract", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).toContain("registerAgentEvidenceWorkbenchContributions")
    expect(appSource).toContain("getLatestReleaseEvidenceSummary")
    expect(appSource).toContain("setAgentEvidenceWorkbenchSummary")
    expect(appSource).toContain("activeView === 'agentEvidence'")
    expect(appSource).toContain('data-codek-smoke="agent-evidence-workbench"')
    expect(appSource).toContain(':data-agent-evidence-correlation-id="agentEvidenceCorrelationId"')
    expect(appSource).toContain(
      ":data-agent-evidence-vscode-service-ids=\"agentEvidenceVsCodeServiceIds.join(',')\"",
    )
    expect(appSource).toContain('data-agent-evidence-surface="list"')
    expect(appSource).toContain('data-codek-smoke="agent-evidence-list-detail-export"')
    expect(appSource).toContain(':data-agent-evidence-list-count="agentEvidenceListItems.length"')
    expect(appSource).toContain("agentEvidenceListVisibleItems")
    expect(appSource).toContain("agentEvidenceListRequiredSurfaces")
    expect(appSource).toContain('v-for="item in agentEvidenceListVisibleItems"')
    expect(appSource).toContain(
      ":data-agent-evidence-filter-surfaces=\"agentEvidenceSurface.list.filters.surfaces.join(',')\"",
    )
    expect(appSource).toContain(
      ":data-agent-evidence-detail-kind=\"agentEvidenceDetail.item?.surface || ''\"",
    )
    expect(appSource).toContain(':data-agent-evidence-editor-id="agentEvidenceDetail.editor.id"')
    expect(appSource).toContain(
      ':data-agent-evidence-export-command="agentEvidenceExport.jsonCommandId"',
    )
    expect(appSource).toContain(
      ':data-agent-evidence-export-path="agentEvidenceExport.artifactPath"',
    )
    expect(appSource).toContain(':data-agent-evidence-list-item-id="item.id"')
    expect(appSource).toContain(':data-agent-evidence-list-item-surface="item.surface"')
    expect(appSource).toContain('data-agent-evidence-surface="scm"')
    expect(appSource).toContain('data-agent-evidence-surface="testing"')
    expect(appSource).toContain("globalTestingService.getCoverageRendererShellProjection()")
    expect(appSource).toContain(
      "globalTestingService.getCoverageEditorContributionShellProjection(w.activeFile || undefined)",
    )
    expect(appSource).toContain("globalTestingService.getResultPeekProjection()")
    expect(appSource).toContain("globalTestingService.getProjection().upperOwnerProjection")
    expect(appSource).toContain('data-codek-smoke="testing-coverage-renderer-shell"')
    expect(appSource).toContain(
      ':data-testing-coverage-state-source="testingCoverageRendererShell.stateSource"',
    )
    expect(appSource).toContain(
      ":data-testing-coverage-command-ids=\"testingCoverageRendererShell.commandIds.join(',')\"",
    )
    expect(appSource).toContain(
      ':data-testing-coverage-no-second-state="testingCoverageRendererShell.adapter.noSecondState"',
    )
    expect(appSource).toContain(':data-testing-coverage-row-id="row.id"')
    expect(appSource).toContain('data-codek-smoke="testing-coverage-editor-contribution-shell"')
    expect(appSource).toContain(
      ':data-testing-coverage-editor-state-source="testingCoverageEditorContributionShell.stateSource"',
    )
    expect(appSource).toContain(
      ":data-testing-coverage-editor-command-ids=\"testingCoverageEditorContributionShell.commandIds.join(',')\"",
    )
    expect(appSource).toContain(
      ':data-testing-coverage-editor-no-second-state="testingCoverageEditorContributionShell.adapter.noSecondState"',
    )
    expect(appSource).toContain('data-codek-smoke="testing-result-peek-visible-owner"')
    expect(appSource).toContain(
      ":data-testing-result-peek-state-source=\"'TestingService.getResultPeekProjection()'\"",
    )
    expect(appSource).toContain(
      ':data-testing-result-peek-codek-owner="testingResultPeekVisibleOwner.adapter.codekOwner"',
    )
    expect(appSource).toContain(
      ':data-testing-followup-status="testingUpperOwnerProjection.messageFollowups.status"',
    )
    expect(appSource).toContain(
      ":data-testing-followup-blocked-owners=\"testingUpperOwnerProjection.messageFollowups.blockedOwners.join(',')\"",
    )
    expect(appSource).toContain(
      ":data-testing-result-peek-entry-command-ids=\"entry.commandIds.join(',')\"",
    )
    expect(appSource).toContain(
      ':data-testing-result-peek-no-second-state="testingResultPeekVisibleOwner.adapter.noSecondState"',
    )
    expect(appSource).toContain('data-agent-evidence-surface="timeline"')
    expect(appSource).toContain('data-agent-evidence-surface="progress"')
    expect(appSource).toContain('data-agent-evidence-surface="notifications"')
    expect(appSource).toContain(':data-agent-evidence-open-command="resource.openCommandId"')
    expect(appSource).toContain(':data-agent-evidence-diff-command="resource.diffCommandId"')
    expect(appSource).toContain(':data-agent-evidence-attach-command="resource.attachCommandId"')
    expect(appSource).toContain(':data-agent-evidence-rerun-command="item.rerunCommandId"')
    expect(appSource).toContain(':data-agent-evidence-timeline-command="item.command.id"')
    expect(appSource).toContain(':data-agent-evidence-aggregate-status="item.aggregateStatus"')
    expect(appSource).toContain(':data-agent-evidence-cancel-command="item.cancelCommandId"')
    expect(appSource).toContain(':data-agent-evidence-dedupe-key="item.dedupeKey"')
    expect(appSource).toContain(':data-agent-evidence-dismiss-command="item.dismissCommandId"')
    expect(appSource).toContain("agentEvidenceListVisible")
    expect(appSource).toContain("agentEvidenceDetailEditorId")
    expect(appSource).toContain("agentEvidenceExportCommand")
    expect(appSource).toContain("agentEvidenceVsCodeServiceIds")
    expect(appSource).toContain("agentEvidenceAvailable: agentEvidenceAvailable.value")
  })

  it("exposes Accessible View and accessibility signal blocked owner evidence through App shell", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).toContain("globalAccessibleViewService.getRendererProjection()")
    expect(appSource).toContain("globalAccessibleViewService.getContractProjection()")
    expect(appSource).toContain("registerAccessibleViewCommandContributions")
    expect(appSource).toContain(
      "removeAccessibleViewCommandContributions = registerAccessibleViewCommandContributions()",
    )
    expect(appSource).toContain("removeAccessibleViewCommandContributions?.dispose?.()")
    expect(
      appSource.indexOf(
        "removeAccessibleViewCommandContributions = registerAccessibleViewCommandContributions()",
      ),
    ).toBeLessThan(appSource.indexOf("\n  installSmokeWorkbenchControls()"))
    expect(appSource).toContain("const accessibleViewServiceRevision = ref(0)")
    expect(appSource).toContain("const refreshAccessibleViewDomShell = () => {")
    expect(appSource).toContain("const runAccessibleViewDomShellAction = async (actionId) => {")
    expect(appSource).toContain('@click="runAccessibleViewDomShellAction(actionId)"')
    expect(appSource).toContain(
      "accessibleViewSupportsNavigation: Boolean(context.supportsNavigation)",
    )
    expect(appSource).toContain("await executeCommand(actionId, [], context)")
    expect(appSource).toContain("const hideAccessibleViewDomShell = () => {")
    expect(appSource).toContain('data-codek-smoke="accessible-view-visible-owner"')
    expect(appSource).toContain('data-codek-smoke="accessible-view-dom-shell"')
    expect(appSource).toContain('data-accessible-view-dom-shell="true"')
    expect(appSource).toContain(
      ":data-accessible-view-state-source=\"'globalAccessibleViewService.getRendererProjection()'\"",
    )
    expect(appSource).toContain(
      ':data-accessible-view-dom-shell-owner="accessibleViewVisibleOwner.domShellReadiness.owner"',
    )
    expect(appSource).toContain(
      ':data-accessible-view-placement-owner="accessibleViewVisibleOwner.placement.owner"',
    )
    expect(appSource).toContain(
      ':data-accessible-view-context-view-owner="accessibleViewVisibleOwner.editorContextFocusOwnerMatrix.contextView.contextViewDelegateOwner"',
    )
    expect(appSource).toContain(
      ':data-accessible-view-toolbar-state="accessibleViewVisibleOwner.toolbarQuickPickFocusInvocation.state"',
    )
    expect(appSource).toContain(
      ':data-accessible-view-workbench-toolbar-backed="accessibleViewVisibleOwner.toolbarQuickPickFocusInvocation.toolbar.workbenchToolbarWidgetBacked"',
    )
    expect(appSource).toContain(
      ':data-accessible-view-quick-pick-owner="accessibleViewVisibleOwner.toolbarQuickPickFocusInvocation.quickPick.symbolQuickPickOwner"',
    )
    expect(appSource).toContain(
      ':data-accessible-view-generic-quick-input-reusable="accessibleViewVisibleOwner.toolbarQuickPickFocusInvocation.quickPick.genericQuickInputSurface.reusableInfrastructure"',
    )
    expect(appSource).toContain(
      ':data-accessible-view-focus-invocation-owner="accessibleViewVisibleOwner.toolbarQuickPickFocusInvocation.focusInvocation.focusRestoreInvocationOwner"',
    )
    expect(appSource).toContain(
      ':data-accessible-view-code-editor-backed="accessibleViewVisibleOwner.editor.codeEditorWidgetBacked"',
    )
    expect(appSource).toContain(
      ':data-accessible-view-no-second-state="accessibleViewContractProjection.trueOwnerFollowUp.noSecondAccessibilityState"',
    )
    expect(appSource).toContain(
      ':data-accessibility-signal-owner="accessibleViewContractProjection.accessibilitySignalUiProjection.actionOwner.owner"',
    )
    expect(appSource).toContain(
      ":data-accessibility-signal-blocked-capabilities=\"accessibleViewContractProjection.accessibilitySignalUiProjection.actionOwner.blockedCapabilities.join(',')\"",
    )
    expect(appSource).toContain('v-if="!accessibleViewVisibleOwner.hidden"')
    expect(appSource).toContain('ref="accessibleViewContentRef"')
    expect(appSource).toContain("accessibleViewContentRef.value?.focus?.()")
    expect(appSource).toContain("runAccessibleViewVisibleOwnerSmoke: async (input = {}) => {")
    expect(appSource).toContain("globalAccessibleViewService.registerProvider({")
    expect(appSource).toContain("const showResult = globalAccessibleViewService.show(providerId)")
    expect(appSource).toContain("provideNextContent: () => nextContent")
    expect(appSource).toContain("const toolbarActionClick = nextAction")
    expect(appSource).toContain("editor.action.accessibleViewNext")
    expect(appSource).toContain(
      "domShellToolbarAction: toolbarActionClick.executed === true && toolbarActionClick.contentChanged === true",
    )
    expect(appSource).toContain(
      "document.querySelector('[data-codek-smoke=\"accessible-view-dom-shell\"]')",
    )
    expect(appSource).toContain("window.__codekSmokeAccessibleViewVisibleOwnerResult")
    expect(appSource).toContain('serviceStateSource: "globalAccessibleViewService"')
    expect(appSource).toContain("runtimeReferenceToSourceMirror: false")
    expect(appSource).toContain("providerDisposable.dispose()")
    expect(appSource).not.toContain("SourceMirror\\\\vscode")
  })

  it("renders MCP through the workbench surface DOM contract", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).toContain("activeView === 'mcp'")
    expect(appSource).toContain('data-codek-smoke="mcp-workbench-surface"')
    expect(appSource).toContain(':data-mcp-service-id="mcpWorkbenchSurface.serviceId"')
    expect(appSource).toContain(':data-mcp-state-source="mcpWorkbenchSurface.stateSource"')
    expect(appSource).toContain(":data-mcp-view-ids=\"mcpWorkbenchSurface.viewIds.join(',')\"")
    expect(appSource).toContain(
      ":data-mcp-command-ids=\"mcpWorkbenchSurface.commandIds.join(',')\"",
    )
    expect(appSource).toContain(
      ":data-mcp-quick-access-prefixes=\"mcpWorkbenchSurface.quickAccessPrefixes.join(',')\"",
    )
    expect(appSource).toContain(':data-mcp-opened-count="mcpWorkbenchSurface.openedCount"')
    expect(appSource).toContain(':data-mcp-attachment-count="mcpWorkbenchSurface.attachmentCount"')
    expect(appSource).toContain(
      ":data-mcp-gallery-action-ids=\"(mcpWorkbenchSurface.latestGalleryDetail?.actions || []).map((action) => action.id).join(',')\"",
    )
    expect(appSource).toContain(
      ':data-mcp-gallery-metadata-count="mcpWorkbenchSurface.latestGalleryDetail?.evidence.metadataCount || 0"',
    )
    expect(appSource).toContain(
      ':data-mcp-preserves-agent-approval="mcpWorkbenchSurface.constraints.preservesAgentApproval"',
    )
    expect(appSource).toContain(
      ':data-mcp-no-second-state="mcpWorkbenchSurface.constraints.noSecondMcpState"',
    )
    expect(appSource).toContain('data-mcp-surface="servers"')
    expect(appSource).toContain('data-mcp-surface="resources"')
    expect(appSource).toContain('data-mcp-surface="gallery"')
    expect(appSource).toContain("getMcpWorkbenchSurfaceSnapshot()")
    expect(appSource).toContain("const mcpWorkbenchRevision = ref(0)")
    expect(appSource).toContain("void mcpWorkbenchRevision.value")
    expect(appSource).toContain("seedMcpGalleryWorkbenchDetailSmoke")
    expect(appSource).toContain("setMcpWorkbenchGalleryDetailForEvidence(model)")
    expect(appSource).toContain("mcpWorkbenchRevision.value += 1")
    expect(appSource).toContain("mcpWorkbenchServiceId")
    expect(appSource).toContain("mcpWorkbenchStateSource")
    expect(appSource).toContain("mcpWorkbenchCommandIds")
    expect(appSource).toContain("mcpWorkbenchQuickAccessPrefixes")
    expect(appSource).toContain("mcpGalleryWorkbenchDetailVisible")
    expect(appSource).toContain("mcpGalleryWorkbenchActionIds")
    expect(appSource).toContain("mcpWorkbenchPreservesAgentApproval")
    expect(appSource).toContain("mcpWorkbenchNoSecondState")
    expect(appSource).toContain("workbench.view.mcp")
    expect(appSource).toContain('openSidebarView("mcp")')
    expect(appSource).toContain("mcpWorkbenchSurfaceVisible")
    expect(appSource).toContain("mcpWorkbenchViewIds")
    expect(appSource).toContain("mcpWorkbenchReadonlyProviderPath")
    expect(appSource).toContain(
      'pane?.getAttribute?.("data-mcp-readonly-provider-path") === "true"',
    )
  })

  it("exercises real QuickInput UI through the smoke contract", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).toContain("quickInputService.showQuickPick")
    expect(appSource).toContain("quickInputService.showInputBox")
    expect(appSource).toContain("collectQuickInputWorkbenchSmoke")
    expect(appSource).toContain("quickInputWorkbenchPickAccepted")
    expect(appSource).toContain("quickInputWorkbenchInputCancelled")
    expect(appSource).toContain("quickInputWorkbenchServiceBoundary")
    expect(appSource).toContain('[data-codek-smoke="quick-input-workbench"]')
    expect(appSource).toContain("quickInputServiceId: String(IQuickInputService)")
  })

  it("exercises Terminal, Debug, Output, Task and Problems through one workbench contribution smoke contract", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).toContain("registerTerminalDebugTaskWorkbenchContributions")
    expect(appSource).toContain("removeTerminalDebugTaskWorkbenchContributions")
    expect(appSource).toContain("collectTerminalDebugTaskWorkbenchSmoke")
    expect(appSource).toContain("exerciseTerminalDebugTaskWorkbenchSmoke")
    expect(appSource).toContain("globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot()")
    expect(appSource).toContain("globalCodekOutputService.appendLine")
    expect(appSource).toContain("TerminalDebugTaskWorkbench Smoke")
    expect(appSource).toContain("TaskWorkbenchPanel")
    expect(appSource).toContain('data-codek-smoke="task-workbench-panel"')
    expect(appSource).toContain("TERMINAL_DEBUG_TASK_COMMAND_IDS.TerminalToggle")
    expect(appSource).toContain("TERMINAL_DEBUG_TASK_COMMAND_IDS.OutputShow")
    expect(appSource).toContain("TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugStart")
    expect(appSource).toContain("TERMINAL_DEBUG_TASK_COMMAND_IDS.DebugStop")
    expect(appSource).toContain("TERMINAL_DEBUG_TASK_COMMAND_IDS.TasksRun")
    expect(appSource).toContain("TERMINAL_DEBUG_TASK_COMMAND_IDS.ProblemsToggle")
    expect(appSource).toContain("openTerminalDebugTaskWorkbenchPanel")
    expect(appSource).toContain("toggleTerminalDebugTaskWorkbenchPanel")
    expect(appSource).toContain("openTerminalDebugTaskWorkbenchDebugView")
    expect(appSource).toContain("openTerminalDebugTaskWorkbenchTasksView")
    expect(appSource).toContain("openTaskProviderExecuteSmokePanel")
    expect(appSource).toContain("collectTaskProviderExecutePanelSmoke")
    expect(appSource).toContain("task provider execute smoke task panel")
    expect(appSource).toContain('[data-codek-smoke="task-workbench-panel"]')
    expect(appSource).toContain("openTerminalDebugTaskWorkbenchProblemsView")
    expect(appSource).toContain("recordTerminalDebugTaskWorkbenchEvidence")
    expect(appSource).toContain(
      'waitForSmokeState(() => Boolean(problemsVisible.value), "terminal debug task problems visible")',
    )
    expect(appSource).toContain("terminalDebugTaskWorkbenchServiceBoundary")
    expect(appSource).toContain("terminalDebugTaskWorkbenchPanelBridge")
    expect(appSource).toContain("taskWorkbenchPanelSurface")
    expect(appSource).toContain("outputWorkbenchChannelEvidence")
    expect(appSource).toContain("taskWorkbenchRunEvidence")
    expect(appSource).toContain("debugWorkbenchSessionEvidence")
    expect(appSource).toContain("terminalWorkbenchCommandEvidence")
    expect(appSource).toContain("problemsWorkbenchReadOnlyBridge")
    expect(appSource).toContain("problemsDiagnosticsService(globalMarkerService)")
    expect(appSource).toContain("codek-workbench-smoke-task")
    expect(appSource).toContain("terminalDebugTaskWorkbench.taskPanelVisible === true")
  })

  it("exposes provider-backed executeTask Task panel output through smoke DOM evidence", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")
    const taskPanelSource = readFileSync(
      join(process.cwd(), "src", "components", "TaskWorkbenchPanel.vue"),
      "utf8",
    )
    const desktopSmokeSource = readFileSync(
      join(process.cwd(), "..", "..", "desktop", "main.js"),
      "utf8",
    )

    expect(appSource).toContain("openTaskProviderExecuteSmokePanel")
    expect(appSource).toContain("taskProviderExecutePanelHook: true")
    expect(appSource).toContain("taskRows: taskRows.map")
    expect(appSource).toContain("taskLatestOutputPreview")
    expect(
      readFileSync(join(process.cwd(), "src", "extensions", "workbenchContributions.ts"), "utf8"),
    ).toContain("__codekSmokeExtensionHostRuntimeBridgeReady = true")
    expect(taskPanelSource).toContain('data-codek-smoke="task-workbench-output-preview"')
    expect(taskPanelSource).toContain(':data-task-workbench-output-preview="latestOutputPreview"')
    expect(taskPanelSource).toContain(
      "latestEvidence.value?.steps.find((step) => step.outputPreview)?.outputPreview",
    )
    expect(desktopSmokeSource).toContain("controls.openTaskProviderExecuteSmokePanel")
    expect(desktopSmokeSource).toContain("__codekSmokeExtensionHostRuntimeBridgeReady === true")
    expect(desktopSmokeSource).toContain(
      "task provider execute smoke opens Task panel through smoke-only hook",
    )
    expect(desktopSmokeSource).toContain(
      "taskConfigurationModel/userTasksService/problemMatcherRegistry",
    )
    expect(desktopSmokeSource).toContain("taskOutputVisibleInEvidence")
    expect(desktopSmokeSource).toContain("task provider execute smoke exposes output evidence")
    expect(desktopSmokeSource).toContain("electron-provider-output")
    expect(desktopSmokeSource).not.toContain("no authorized Task panel trigger/hook")
  })

  it("renders Extension Gallery through the workbench surface DOM and service contract", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")
    const marketplaceSource = readFileSync(
      join(process.cwd(), "src", "components", "Marketplace.vue"),
      "utf8",
    )
    const detailsSource = readFileSync(
      join(process.cwd(), "src", "components", "ExtensionDetails.vue"),
      "utf8",
    )

    expect(appSource).toContain("activeView === 'marketplace'")
    expect(appSource).toContain('data-codek-smoke="extension-gallery-workbench-surface"')
    expect(appSource).toContain('data-workbench-container-id="workbench.view.extensions"')
    expect(appSource).toContain('data-workbench-view-id="workbench.extensions.marketplace"')
    expect(appSource).toContain("collectExtensionGalleryWorkbenchSmoke")
    expect(appSource).toContain("openExtensionGalleryWorkbenchDetailSmoke")
    expect(appSource).toContain("extensionGalleryWorkbenchSurfaceVisible")
    expect(appSource).toContain("extensionGalleryWorkbenchDetailOpened")
    expect(appSource).toContain("extensionGalleryWorkbenchDetailActionIds")
    expect(appSource).toContain("extensionGalleryWorkbenchDetailServiceId")
    expect(appSource).toContain("extensionGalleryWorkbenchDetailStateSource")
    expect(appSource).toContain("__codekSeedExtensionGalleryWorkbenchDetailForSmoke")
    expect(appSource).toContain(
      "await window.__codekSeedExtensionGalleryWorkbenchDetailForSmoke?.()",
    )
    expect(appSource).toContain("Extension Gallery seeded detail visible through service open")
    expect(appSource).toContain("runExtensionInstallConfirmationSmoke")
    expect(appSource).toContain(
      "App.vue __codekSmokeWorkbenchControls.runExtensionInstallConfirmationSmoke",
    )
    expect(appSource).toContain("ExtensionInstallConfirmationSmoke")
    expect(appSource).toContain("workbench.extensions.install")
    expect(appSource).toContain("globalCodekDialogService.prompt")
    expect(appSource).toContain("extensionWorkbenchService.setEditorViewModelForEvidence")
    expect(appSource).toContain("extensionWorkbenchService.install(extensionId, version)")
    expect(appSource).toContain("getExtensionWorkbenchSurfaceSnapshot(extensionWorkbenchService)")
    expect(appSource).toContain("noSecondInstallStateSource")
    expect(appSource).toContain("workbench.view.extensions")

    expect(marketplaceSource).toContain("extensionWorkbenchService")
    expect(marketplaceSource).toContain("getExtensionWorkbenchSurfaceSnapshot")
    expect(marketplaceSource).toContain("seedExtensionGalleryWorkbenchDetailForSmoke")
    expect(marketplaceSource).toContain("await extensionWorkbenchService.open(id)")
    expect(marketplaceSource).toContain("__codekSeedExtensionGalleryWorkbenchDetailForSmoke")
    expect(marketplaceSource).toContain('data-extension-gallery-state-source="service"')
    expect(marketplaceSource).toContain('data-codek-smoke="extension-gallery-search-results"')
    expect(marketplaceSource).toContain('data-codek-smoke="extension-gallery-installed"')
    expect(marketplaceSource).toContain('data-codek-smoke="extension-gallery-detail"')
    expect(marketplaceSource).toContain("resolveIconDataUrl")
    expect(marketplaceSource).toContain("handleIconError")
    expect(marketplaceSource).toContain("getAvailabilityLabel")
    expect(marketplaceSource).toContain("ext.iconDataUrl")
    expect(marketplaceSource).toContain("ext.availability?.label")
    expect(marketplaceSource).not.toContain("await installExtension(")
    expect(marketplaceSource).not.toContain("await uninstallExtension(")
    expect(marketplaceSource).not.toContain("await enableExtension(")
    expect(marketplaceSource).not.toContain("await disableExtension(")

    expect(detailsSource).toContain("extensionWorkbenchService.getEditorViewModel")
    expect(detailsSource).toContain("extensionWorkbenchService.open")
    expect(detailsSource).toContain("forceRefresh")
    expect(detailsSource).toContain("extensionWorkbenchService.rollback")
    expect(detailsSource).toContain("ExtensionWorkbenchEditorViewModel")
    expect(detailsSource).toContain("IExtensionsWorkbenchService")
    expect(detailsSource).toContain("data-extension-gallery-detail-service-id")
    expect(detailsSource).toContain('data-extension-gallery-detail-state-source="service"')
    expect(detailsSource).toContain("data-extension-gallery-action-ids")
    expect(detailsSource).toContain("resolvedIconDataUrl")
    expect(detailsSource).toContain("availability")
    expect(detailsSource).toContain("availability?.detail")
    expect(detailsSource).not.toContain("rollbackExtension(")
    expect(detailsSource).not.toContain("getFullExtensionDetails(")
  })

  it("renders the Workspace Trust restricted-mode banner from the banner facade projection", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).toContain('data-codek-smoke="workspace-trust-restricted-banner"')
    expect(appSource).toContain("workspaceTrustBannerProjection.visible")
    expect(appSource).toContain("workspaceTrustBannerProjection.dismissed")
    expect(appSource).toContain(
      "globalWorkspaceTrustBannerService.getBannerItem(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)",
    )
    expect(appSource).toContain(
      "globalWorkspaceTrustBannerService.dismiss(WORKSPACE_TRUST_RESTRICTED_MODE_BANNER_ID)",
    )
    expect(appSource).toContain("globalWorkspaceTrustBannerService.onDidChangeBanner")
    expect(appSource).toContain("WorkspaceTrustBannerService")
    expect(appSource).toContain("data-workbench-banner-state-source")
    expect(appSource).toContain("data-workbench-banner-action-labels")
    expect(appSource).toContain("data-workbench-banner-action-hrefs")
    expect(appSource).toContain("handleWorkspaceTrustBannerAction(action)")
    expect(appSource).toContain('executeCommand(href.slice("command:".length))')
    expect(appSource).toContain(
      "workspaceTrustBannerVisible: isVisibleNode(workspaceTrustBannerNode)",
    )
    expect(appSource).not.toContain("SourceMirror\\\\vscode")
  })

  it("restores a real editor surface before real project UI screenshot evidence", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")
    const desktopSource = readFileSync(join(process.cwd(), "..", "..", "desktop", "main.js"), "utf8")

    expect(appSource).toContain("restoreRealProjectUiScreenshotSurface")
    expect(appSource).toContain('setRealUiSmokeStage("screenshot-restore:start"')
    expect(appSource).toContain("screenshotRestoreActiveFile")
    expect(appSource).toContain("screenshotRestoreEditorVisible")
    expect(appSource).toContain("screenshotRestoreExpectedTextVisible")
    expect(desktopSource).toContain("result?.screenshotRestoreActiveFile")
    expect(desktopSource).toContain("result?.screenshotRestoreEditorVisible")
    expect(desktopSource).toContain("result?.screenshotRestoreExpectedTextVisible")
    expect(desktopSource).toContain("const welcomeVisible = rects.welcomePage?.visible === true")
    expect(desktopSource).toContain("&& !welcomeVisible")
  })

  it("renders Workspace Trust request decisions through the shared dialog service modal", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).toContain("globalCodekDialogService")
    expect(appSource).toContain('data-codek-smoke="codek-dialog-service-modal"')
    expect(appSource).toContain(':data-dialog-source="activeCodekDialog.source"')
    expect(appSource).toContain(
      ":data-dialog-command-id=\"activeCodekDialog.evidenceContext?.commandId || ''\"",
    )
    expect(appSource).toContain(
      ":data-dialog-workspace-folder=\"activeCodekDialog.evidenceContext?.workspaceFolder || ''\"",
    )
    expect(appSource).toContain(
      ":data-dialog-button-labels=\"activeCodekDialog.buttons.map((button) => button.label).join(',')\"",
    )
    expect(appSource).toContain('@click="resolveCodekDialog(button.index)"')
    expect(appSource).toContain("globalCodekDialogService.resolveActiveDialog")
    expect(appSource).toContain("activeCodekDialogCheckboxChecked")
    expect(appSource).toContain("globalCodekDialogService.onWillShowDialog")
    expect(appSource).toContain("globalCodekDialogService.onDidShowDialog")
    expect(appSource).toContain("codekDialogWillShowSubscription?.dispose?.()")
    expect(appSource).not.toContain("SourceMirror\\\\vscode")
  })

  it("renders notification progress actions through NotificationToast service-owner attributes", () => {
    const notificationToastSource = readFileSync(
      join(process.cwd(), "src", "components", "NotificationToast.vue"),
      "utf8",
    )

    expect(notificationToastSource).toContain(":data-notification-owner=\"'NotificationToast'\"")
    expect(notificationToastSource).toContain(
      ":data-notification-service-source=\"'workbenchStatusNotificationProgressService'\"",
    )
    expect(notificationToastSource).toMatch(
      /:data-notification-progress-owner=\s*"\s*hasProgress\(item\) \? 'workbenchStatusNotificationProgressService\.withProgress' : ''\s*"/,
    )
    expect(notificationToastSource).toContain(":data-notification-no-second-state=\"'true'\"")
    expect(notificationToastSource).toContain(
      ":data-notification-action-owner=\"'workbenchStatusNotificationProgressService.invokeNotificationAction'\"",
    )
    expect(notificationToastSource).toContain(':data-notification-action-notification-id="item.id"')
    expect(notificationToastSource).toContain('@click="runAction(item.id, action.id)"')
    expect(notificationToastSource).not.toContain("SourceMirror\\\\vscode")
  })

  it("keeps notification toasts out of the native window control hit zone", () => {
    const notificationToastSource = readFileSync(
      join(process.cwd(), "src", "components", "NotificationToast.vue"),
      "utf8",
    )

    expect(notificationToastSource).toContain("--codek-caption-safe-right: 154px")
    expect(notificationToastSource).toContain("top: 52px")
    expect(notificationToastSource).toContain("right: calc(12px + var(--codek-caption-safe-right))")
    expect(notificationToastSource).toContain(
      "calc(100vw - 32px - var(--codek-caption-safe-right))",
    )
  })

  it("keeps the login topbar status controls out of the native window control hit zone", () => {
    const loginViewSource = readFileSync(
      join(process.cwd(), "src", "views", "LoginView.vue"),
      "utf8",
    )

    expect(loginViewSource).toContain("--codek-caption-safe-right: 154px")
    expect(loginViewSource).toContain(
      "padding: 0 calc(24px + var(--codek-caption-safe-right)) 0 24px",
    )
    expect(loginViewSource).toContain("max-width: min(520px, calc(100vw - 360px))")
    expect(loginViewSource).toContain("white-space: nowrap")
  })

  it("renders Extension Host, Workspace Trust, Remote Authority and Authentication through one workbench boundary", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).toContain("registerExtensionTrustRemoteAuthWorkbenchContributions")
    expect(appSource).toContain("removeExtensionTrustRemoteAuthWorkbenchContributions")
    expect(appSource).toContain("getExtensionTrustRemoteAuthWorkbenchSurfaceSnapshot")
    expect(appSource).toContain("activeView === 'remote'")
    expect(appSource).toContain('data-codek-smoke="extension-trust-remote-auth-workbench"')
    expect(appSource).toContain(
      ':data-extension-host-service-id="extensionTrustRemoteAuthSurface.serviceIds.extensionHost"',
    )
    expect(appSource).toContain(
      ':data-workspace-trust-service-id="extensionTrustRemoteAuthSurface.serviceIds.workspaceTrust"',
    )
    expect(appSource).toContain(
      ':data-remote-authority-service-id="extensionTrustRemoteAuthSurface.serviceIds.remoteAuthority"',
    )
    expect(appSource).toContain(
      ':data-authentication-service-id="extensionTrustRemoteAuthSurface.serviceIds.authentication"',
    )
    expect(appSource).toContain(
      ':data-extension-host-state-source="extensionTrustRemoteAuthSurface.extensionHost.stateSource"',
    )
    expect(appSource).toContain(
      ':data-workspace-trust-state-source="extensionTrustRemoteAuthSurface.workspaceTrust.stateSource"',
    )
    expect(appSource).toContain(
      ':data-remote-authority-state-source="extensionTrustRemoteAuthSurface.remoteAuthority.stateSource"',
    )
    expect(appSource).toContain(
      ':data-authentication-state-source="extensionTrustRemoteAuthSurface.authentication.stateSource"',
    )
    expect(appSource).toContain(
      ':data-authentication-token-redacted="extensionTrustRemoteAuthSurface.authentication.constraints.noTokenInEvidence"',
    )
    expect(appSource).toContain("seedExtensionTrustRemoteAuthWorkbenchSmoke")
    expect(appSource).toContain("runSeedCommand")
    expect(appSource).toContain("command timed out after")
    expect(appSource).toContain("seedRemoteAuthorityWorkbenchEvidenceForSmoke")
    expect(appSource).toContain("seedAuthenticationWorkbenchEvidenceForSmoke")
    expect(appSource).toContain("collectExtensionTrustRemoteAuthWorkbenchSmoke")
    expect(appSource).toContain("EXTENSION_HOST_WORKBENCH_COMMAND_IDS.ActivatePlaceholder")
    expect(appSource).toContain("WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Allow")
    expect(appSource).toContain("WORKSPACE_TRUST_WORKBENCH_COMMAND_IDS.Deny")
    expect(appSource).toContain("extensionTrustRemoteAuthWorkbenchSurfaceVisible")
    expect(appSource).toContain("extensionHostWorkbenchActivationCount")
    expect(appSource).toContain("workspaceTrustWorkbenchDecisionCount")
    expect(appSource).toContain('data-codek-smoke="workspace-trust-editor"')
    expect(appSource).toContain("handleWorkspaceTrustEditorKeydown")
    expect(appSource).toContain("runWorkspaceTrustEditorSmoke")
    expect(appSource).toContain("remoteAuthorityWorkbenchCacheHitCount")
    expect(appSource).toContain("authenticationWorkbenchStatuses")
    expect(appSource).toContain("extensionTrustRemoteAuthWorkbenchNoSecondAuthStore")
    expect(appSource).toContain("extensionTrustRemoteAuthWorkbenchPreservesAgentEvidence")
    expect(appSource).toContain("extensionTrustRemoteAuthWorkbenchSeedDegraded")
    expect(appSource).toContain("extensionTrustRemoteAuthWorkbenchSeedCommands")
  })

  it("routes Workspace Trust configure requests into the parameterized settings shell", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")
    const settingsPanelSource = readFileSync(
      join(process.cwd(), "src", "components", "SettingsPanel.vue"),
      "utf8",
    )

    expect(appSource).toContain("registerWorkspaceTrustConfigureSettingsShell")
    expect(appSource).toContain(
      "openSettingsSection(request.settingsSection, request.options.query)",
    )
    expect(appSource).toContain(':settingsQuery="activeSettingsQuery"')
    expect(settingsPanelSource).toContain('data-codek-smoke="settings-query-evidence"')
    expect(settingsPanelSource).toContain("IPreferencesService.openUserSettings")
    expect(settingsPanelSource).toContain("workspaceTrust")
    expect(appSource).not.toContain("SourceMirror\\\\vscode")
    expect(settingsPanelSource).not.toContain("SourceMirror\\\\vscode")
  })

  it("exercises Workspace Trust downgrade/restart through the smoke-only workbench controls", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).toContain("runWorkspaceTrustDowngradeRestartSmoke")
    expect(appSource).toContain(
      'globalWorkspaceTrustManagementService.setWorkspaceTrust(root, "trusted")',
    )
    expect(appSource).toContain(
      "globalWorkspaceTrustManagementService.openWorkspaceTrustConfigureSettings()",
    )
    expect(appSource).toContain(
      'globalWorkspaceTrustManagementService.setWorkspaceTrust(root, "restricted")',
    )
    expect(appSource).toContain("extensionWorkbenchService.getEnablementStateMatrix()")
    expect(appSource).toContain("DisabledByTrustRequirement")
    expect(appSource).toContain('data-codek-smoke="workspace-trust-restricted-banner"')
    expect(appSource).toContain('data-codek-smoke="extension-trust-remote-auth-workbench"')
    expect(appSource).toContain("window.__codekSmokeWorkspaceTrustDowngradeRestartResult")
    expect(appSource).not.toContain("SourceMirror\\\\vscode")
  })
})

describe("app native shutdown lifecycle bridge contract", () => {
  it("routes Electron close and beforeunload through the WorkingCopy hot-exit state source", () => {
    const appSource = readFileSync(join(process.cwd(), "src", "App.vue"), "utf8")

    expect(appSource).toContain("function installNativeShutdownLifecycleBridge()")
    expect(appSource).toContain("window.codek?.onWindowWillClose")
    expect(appSource).toContain("window.codek?.resolveWindowClose")
    expect(appSource).toContain("function buildNativeShutdownLifecycleDecision")
    expect(appSource).toContain("function normalizeNativeShutdownLifecycleDecisionPayload")
    expect(appSource).toContain("toSerializableWindowCloseValue")
    expect(appSource).toContain("ws.buildWorkingCopyHotExitEvidence(source)")
    expect(appSource).toContain("ws.backupDirtyWorkingCopiesForLifecycle(source)")
    expect(appSource).toContain('window.addEventListener("beforeunload"')
    expect(appSource).toContain('window.removeEventListener("beforeunload"')
    expect(appSource).toContain("simulateWindowCloseLifecycle")
  })
})
