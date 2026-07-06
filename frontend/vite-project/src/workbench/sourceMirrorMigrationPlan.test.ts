import { describe, expect, it } from "vitest"
import { VSCODE_SOURCE_REFERENCE, sourceMirrorMigrationItems, getMigrationItemsByLevel } from "./sourceMirrorMigrationPlan"

describe("SourceMirror VS Code migration plan", () => {
  it("keeps VS Code source references self-contained before packaging", () => {
    expect(VSCODE_SOURCE_REFERENCE).toBe("VS Code source reference is copied or adapted into D:\\Workspace before packaging")
    expect(sourceMirrorMigrationItems.flatMap((item) => item.sourcePaths)).toEqual(
      expect.not.arrayContaining([
        expect.stringContaining("D:\\SourceMirror"),
        expect.stringContaining("SourceMirror/vscode"),
      ]),
    )
  })

  it("covers the AX M1 foundation modules", () => {
    const ids = sourceMirrorMigrationItems.map((item) => item.id)
    expect(ids).toEqual(expect.arrayContaining([
      "vendor-vscode-mirror",
      "vscode-platform-shims",
      "file-service",
      "textfile-working-copy-hot-exit-evidence",
      "large-file-real-project-ui-evidence",
      "editor-marker-problems-service",
      "search-service",
      "bulk-edit-replace",
      "vscode-dependency-closure-importer",
      "extension-marketplace-workbench-service",
      "extension-trust-remote-auth-workbench",
      "mcp-quickaccess-gallery-workbench-surface",
      "agent-evidence-workbench",
      "terminal-debug-output-task-problems-workbench",
      "contextkeys",
      "keybinding-resolver",
      "configuration-model",
      "commands",
      "views",
    ]))
  })

  it("classifies migration items by reuse level", () => {
    expect(getMigrationItemsByLevel("direct").length).toBeGreaterThan(0)
    expect(getMigrationItemsByLevel("adapter").length).toBeGreaterThan(0)
    expect(getMigrationItemsByLevel("protocol").length).toBeGreaterThan(0)
  })

  it("keeps the Code-OSS fork route as an isolated spike instead of the M1 mainline", () => {
    const spike = sourceMirrorMigrationItems.find((item) => item.id === "code-oss-fork-spike")
    expect(spike?.level).toBe("defer")
    expect(spike?.targetArea).toContain("isolated branch/worktree")
    expect(spike?.reason).toContain("不得替换 M1 主线")
  })

  it("documents the self-contained vendor importer instead of runtime SourceMirror reads", () => {
    const mirror = sourceMirrorMigrationItems.find((item) => item.id === "vendor-vscode-mirror")
    const shims = sourceMirrorMigrationItems.find((item) => item.id === "vscode-platform-shims")
    const importer = sourceMirrorMigrationItems.find((item) => item.id === "vscode-dependency-closure-importer")

    expect(mirror?.targetArea).toContain("vendor/vscode")
    expect(mirror?.reason).toContain("运行、构建和打包不能依赖外部工作区")
    expect(shims?.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/nls.ts",
      "src/vs/platform/instantiation/common",
    ]))
    expect(shims?.targetArea).toContain("frontend/vite-project/src/vscode-adapter")
    expect(importer?.targetArea).toContain("scripts/vscode-dependency-closure-importer.js")
    expect(importer?.reason).toContain("默认源必须是仓库内 vendor/vscode")
    expect(importer?.reason).toContain("--refresh-vendor")
    expect(importer?.reason).toContain("src/vs/base/common/lifecycle.ts")
    expect(importer?.reason).toContain("src/vs/base/common/uri.ts")
    expect(importer?.reason).toContain("闭包 68 个源码文件")
    expect(importer?.reason).toContain("generated import 已重写为相对路径")
    expect(importer?.reason).toContain("debuggerApi.d.ts")
  })

  it("tracks commands, menus, actions, and keybindings as one contribution surface", () => {
    const commands = sourceMirrorMigrationItems.find((item) => item.id === "commands")

    expect(commands?.title).toContain("Commands / Menu / Actions / Keybinding")
    expect(commands?.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/platform/actions/common/actions.ts",
      "src/vs/platform/keybinding/common/keybindingsRegistry.ts",
      "src/vs/workbench/browser/actions.ts",
    ]))
    expect(commands?.targetArea).toContain("menuRegistry.ts")
    expect(commands?.targetArea).toContain("CommandPalette.vue")
    expect(commands?.reason).toContain("ICommandService")
    expect(commands?.reason).toContain("ServiceCollection 解析")
    expect(commands?.reason).toContain("Workbench Navigation / Command Palette / Keybinding 回归桥接")
    expect(commands?.reason).toContain("extension command palette action")
    expect(commands?.reason).toContain("extension keybinding action")
    expect(commands?.reason).toContain("keybinding-only extension command backfill")
    expect(commands?.reason).toContain("executeCommand()/commandRegistry")
    expect(commands?.reason).toContain("enablement 作为 precondition")
    expect(commands?.reason).toContain("keybinding context")
    expect(commands?.reason).toContain("duplicate command id stack smoke")
    expect(commands?.reason).toContain("dispose 后可回退旧路径")
    expect(commands?.reason).toContain("不新增第二套状态源")
  })

  it("tracks service facades for command, keybinding, context key and configuration state", () => {
    const contextKeys = sourceMirrorMigrationItems.find((item) => item.id === "contextkeys")
    const keybindings = sourceMirrorMigrationItems.find((item) => item.id === "keybinding-resolver")
    const configuration = sourceMirrorMigrationItems.find((item) => item.id === "configuration-model")

    expect(contextKeys?.reason).toContain("IContextKeyService")
    expect(contextKeys?.reason).toContain("globalContextKeyService")
    expect(contextKeys?.reason).toContain("唯一 context key 状态源")
    expect(keybindings?.reason).toContain("IKeybindingService")
    expect(keybindings?.reason).toContain("handleKeyEvent")
    expect(keybindings?.reason).toContain("不新增第二套 keybinding 状态源")
    expect(configuration?.reason).toContain("IConfigurationService")
    expect(configuration?.reason).toContain("IWorkbenchConfigurationService")
    expect(configuration?.reason).toContain("SettingsStore")
    expect(configuration?.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/platform/theme/common/themeService.ts",
      "src/vs/platform/theme/common/iconRegistry.ts",
      "src/vs/workbench/services/themes/common/workbenchThemeService.ts",
      "src/vs/workbench/services/themes/common/themeConfiguration.ts",
    ]))
    expect(configuration?.reason).toContain("IThemeService")
    expect(configuration?.reason).toContain("IWorkbenchThemeService")
    expect(configuration?.reason).toContain("onDidColorThemeChange")
    expect(configuration?.reason).toContain("onDidFileIconThemeChange")
    expect(configuration?.reason).toContain("inspectColorTheme")
    expect(configuration?.reason).toContain("setFileIconTheme")
    expect(configuration?.reason).toContain("workbench.colorTheme")
    expect(configuration?.reason).toContain("workbench.iconTheme")
    expect(configuration?.reason).toContain("不新增第二套 theme/icon 状态源")
  })

  it("tracks Workbench view, layout, activity bar, sidebar, editor part and panel UI integration", () => {
    const views = sourceMirrorMigrationItems.find((item) => item.id === "views")

    expect(views?.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/browser/layout.ts",
      "src/vs/workbench/browser/parts/activitybar/activitybarPart.ts",
      "src/vs/workbench/browser/parts/sidebar/sidebarPart.ts",
      "src/vs/workbench/browser/parts/editor/editorPart.ts",
      "src/vs/workbench/browser/parts/panel/panelPart.ts",
      "src/vs/workbench/browser/parts/titlebar/titlebarPart.ts",
      "src/vs/workbench/browser/parts/statusbar/statusbarPart.ts",
      "src/vs/workbench/browser/parts/statusbar/statusbarModel.ts",
      "src/vs/workbench/common/views.ts",
      "src/vs/workbench/services/layout/browser/layoutService.ts",
      "src/vs/workbench/services/editor/common/editorGroupsService.ts",
      "src/vs/platform/actions/common/actions.ts",
      "src/vs/platform/commands/common/commands.ts",
    ]))
    expect(views?.targetArea).toContain("workbenchLayoutUiAdapter.ts")
    expect(views?.targetArea).toContain("workbenchLayoutActions.ts")
    expect(views?.targetArea).toContain("services/{layout,views,editor}")
    expect(views?.targetArea).toContain("App.vue")
    expect(views?.targetArea).toContain("MenuBar.vue")
    expect(views?.targetArea).toContain("desktop/main.js real-project-ui workbench layout acceptance")
    expect(views?.reason).toContain("真实 Vue Activity Bar")
    expect(views?.reason).toContain("TitleBar")
    expect(views?.reason).toContain("StatusBar")
    expect(views?.reason).toContain("Command surface")
    expect(views?.reason).toContain("data-workbench DOM")
    expect(views?.reason).toContain("data-workbench-title-bar")
    expect(views?.reason).toContain("data-workbench-status-bar")
    expect(views?.reason).toContain("data-workbench-command-surface")
    expect(views?.reason).toContain("MenuRegistry")
    expect(views?.reason).toContain("IWorkbenchLayoutService")
    expect(views?.reason).toContain("IViewsService")
    expect(views?.reason).toContain("IEditorPartService")
    expect(views?.reason).toContain("openView/openViewContainer/closeViewContainer")
    expect(views?.reason).toContain("snapshot serialize/deserialize")
    expect(views?.reason).toContain("open/close/focus/dirty/pin/reopen/move/split")
    expect(views?.reason).toContain("overflow summary")
    expect(views?.reason).toContain("active editor")
    expect(views?.reason).toContain("Activity badge projection")
    expect(views?.reason).toContain("WorkbenchLayoutService.createSnapshot()")
    expect(views?.reason).toContain("旧 snapshot hydrate")
    expect(views?.reason).toContain("workbenchTitleBarSurfaceVisible")
    expect(views?.reason).toContain("workbenchStatusBarSurfaceVisible")
    expect(views?.reason).toContain("workbenchCommandSurfaceVisible")
    expect(views?.reason).toContain("workbench.view.settings")
    expect(views?.reason).toContain("openSettingsView()/Settings overlay")
    expect(views?.reason).toContain("不再只有 registry placeholder")
    expect(views?.reason).toContain("不新增第二套 UI 或 command/menu/layout 状态源")
  })

  it("tracks FileService as the shared provider and workspace mutation foundation", () => {
    const fileService = sourceMirrorMigrationItems.find((item) => item.id === "file-service")

    expect(fileService?.title).toContain("FileService")
    expect(fileService?.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/platform/files/common/files.ts",
      "src/vs/platform/files/common/fileService.ts",
      "src/vs/platform/files/node/diskFileSystemProvider.ts",
      "src/vs/platform/files/node/watcher",
      "src/vs/platform/files/electron-main/diskFileSystemProvider.ts",
    ]))
    expect(fileService?.targetArea).toContain("frontend/vite-project/src/vscode-adapter/platform/files/common/files.ts")
    expect(fileService?.targetArea).toContain("textFileService.ts")
    expect(fileService?.targetArea).toContain("workspace/manager.js")
    expect(fileService?.reason).toContain("IFileService service brand")
    expect(fileService?.reason).toContain("open/read/write/close")
    expect(fileService?.reason).toContain("write cancellation")
    expect(fileService?.reason).toContain("onDidFailOperation failure evidence")
    expect(fileService?.reason).toContain("FileOperationError metadata")
    expect(fileService?.reason).toContain("watch request 去重/refcount")
    expect(fileService?.reason).toContain("provider watcher coalescing")
    expect(fileService?.reason).toContain("watcher create/change/delete ordering")
    expect(fileService?.reason).toContain("recursive/non-recursive filtering")
    expect(fileService?.reason).toContain("internalOnDidFilesChange")
    expect(fileService?.reason).toContain("全局 onDidFilesChange 分流")
    expect(fileService?.reason).toContain("createWatcher()/IFileSystemWatcher correlation-specific event routing")
    expect(fileService?.reason).toContain("provider-backed desktop watcher")
    expect(fileService?.reason).toContain("workspace file-operation failed evidence")
    expect(fileService?.reason).toContain("copy_entry failure evidence")
    expect(fileService?.reason).toContain("不新增第二套 FileService/workspace 状态源")
  })

  it("tracks TextFile and WorkingCopy hot-exit evidence as a renderer smoke contract", () => {
    const hotExit = sourceMirrorMigrationItems.find((item) => item.id === "textfile-working-copy-hot-exit-evidence")

    expect(hotExit?.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/services/textfile/browser/textFileService.ts",
      "src/vs/workbench/services/textfile/common/textfiles.ts",
      "src/vs/workbench/services/workingCopy/common/workingCopyService.ts",
      "src/vs/workbench/services/workingCopy/common/workingCopyBackupService.ts",
      "src/vs/workbench/services/workingCopy/common/workingCopyBackup.ts",
      "src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.ts",
      "src/vs/workbench/services/workingCopy/common/workingCopyFileService.ts",
    ]))
    expect(hotExit?.targetArea).toContain("textFileService.ts")
    expect(hotExit?.targetArea).toContain("workingCopyService")
    expect(hotExit?.targetArea).toContain("workspace/manager.js")
    expect(hotExit?.targetArea).toContain("App.vue smoke bridge")
    expect(hotExit?.targetArea).toContain("desktop/main.js smoke report")
    expect(hotExit?.reason).toContain("唯一 workspace.manager WorkingCopy 状态源")
    expect(hotExit?.reason).toContain("ITextFileService")
    expect(hotExit?.reason).toContain("IWorkingCopyService")
    expect(hotExit?.reason).toContain("IWorkingCopyFileService")
    expect(hotExit?.reason).toContain("IWorkingCopyBackupService")
    expect(hotExit?.reason).toContain("ServiceCollection 解析")
    expect(hotExit?.reason).toContain("旧 open/save/reload/backup/restore/retention helper")
    expect(hotExit?.reason).toContain("close guard")
    expect(hotExit?.reason).toContain("restore attempt")
    expect(hotExit?.reason).toContain("Native shutdown lifecycle")
    expect(hotExit?.reason).toContain("cancel/confirm/force")
    expect(hotExit?.reason).toContain("backup retained after cancel")
    expect(hotExit?.reason).toContain("save-to-disk clears dirty")
    expect(hotExit?.reason).toContain("revert-from-disk clears dirty")
    expect(hotExit?.reason).toContain("renderer unavailable")
    expect(hotExit?.reason).toContain("不新增第二套 hot-exit/global evidence store")
  })

  it("tracks real-project large-file UI evidence as a strict Electron smoke contract", () => {
    const largeFile = sourceMirrorMigrationItems.find((item) => item.id === "large-file-real-project-ui-evidence")

    expect(largeFile?.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/editor/common/model/textModel.ts",
      "src/vs/editor/browser",
      "src/vs/workbench/contrib/files/browser/editors/fileEditorInput.ts",
      "src/vs/workbench/contrib/files/browser/editors/textFileEditor.ts",
    ]))
    expect(largeFile?.targetArea).toContain("App.vue real-project-ui large-file smoke bridge")
    expect(largeFile?.targetArea).toContain("workspace/manager.js byte-window range state")
    expect(largeFile?.targetArea).toContain("workbench-large-file-256mb-smoke.js")
    expect(largeFile?.targetArea).toContain("workbench-large-file-256mb-smoke.test.js")
    expect(largeFile?.targetArea).toContain("desktop/main.js real-project-ui acceptance/Markdown")
    expect(largeFile?.reason).toContain("真实 Electron 工作台里大文件内容可见")
    expect(largeFile?.reason).toContain("显式 next-window 深视口可见")
    expect(largeFile?.reason).toContain("PageDown/scroll-bottom/scrollbar drag/End")
    expect(largeFile?.reason).toContain("TextModel heap-operation guard")
    expect(largeFile?.reason).toContain("128MiB")
    expect(largeFile?.reason).toContain("先验证首窗口 next-window")
    expect(largeFile?.reason).toContain("direct-loaded")
    expect(largeFile?.reason).toContain("不放宽真实可见性")
    expect(largeFile?.reason).toContain("node:test")
    expect(largeFile?.reason).toContain("manualAcceptanceContract")
    expect(largeFile?.reason).toContain("manual-real-ui 11 scenarios")
    expect(largeFile?.reason).toContain("同目录 Cursor/Codek 对照")
    expect(largeFile?.reason).toContain("普通 sibling 文件切换")
    expect(largeFile?.reason).toContain("不能替代用户手感确认")
    expect(largeFile?.reason).toContain("不新增第二套大文件状态源")
  })

  it("tracks Editor marker diagnostics through a VS Code-style MarkerService", () => {
    const markers = sourceMirrorMigrationItems.find((item) => item.id === "editor-marker-problems-service")

    expect(markers?.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/platform/markers/common/markers.ts",
      "src/vs/platform/markers/common/markerService.ts",
      "src/vs/workbench/contrib/markers/browser/markersModel.ts",
      "src/vs/workbench/contrib/markers/browser/markersView.ts",
      "src/vs/workbench/services/editor/common/editorService.ts",
      "src/vs/editor/common/model/textModel.ts",
    ]))
    expect(markers?.targetArea).toContain("platform/markers/common/markers.ts")
    expect(markers?.targetArea).toContain("components/problemState.ts")
    expect(markers?.targetArea).toContain("editorDiagnosticsLifecycle.ts")
    expect(markers?.targetArea).toContain("markersViewModel.ts")
    expect(markers?.targetArea).toContain("ProblemsPanel.vue")
    expect(markers?.reason).toContain("IMarkerService")
    expect(markers?.reason).toContain("MarkerService")
    expect(markers?.reason).toContain("_serviceBrand")
    expect(markers?.reason).toContain("singleton registration")
    expect(markers?.reason).toContain("ServiceCollection")
    expect(markers?.reason).toContain("owner/resource keyed marker store")
    expect(markers?.reason).toContain("onMarkerChanged")
    expect(markers?.reason).toContain("Windows path/URI")
    expect(markers?.reason).toContain("problemState")
    expect(markers?.reason).toContain("globalMarkerService")
    expect(markers?.reason).toContain("reactive diagnostics 引用不变")
    expect(markers?.reason).toContain("installEditorMarkerSync()")
    expect(markers?.reason).toContain("owner `monaco`")
    expect(markers?.reason).toContain("Monaco marker event")
    expect(markers?.reason).toContain("buildProblemsWorkbenchSnapshot()")
    expect(markers?.reason).toContain("workbench.actions.view.toggleProblems")
    expect(markers?.reason).toContain("点击 openFile range")
    expect(markers?.reason).toContain("不新增第二套 diagnostics/problems 状态源")
  })

  it("tracks SearchService and BulkEdit/Replace as DI-backed workspace services", () => {
    const search = sourceMirrorMigrationItems.find((item) => item.id === "search-service")
    const bulkEdit = sourceMirrorMigrationItems.find((item) => item.id === "bulk-edit-replace")

    expect(search?.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/services/search/common/search.ts",
      "src/vs/workbench/services/search/common/searchService.ts",
      "src/vs/workbench/services/search/common/queryBuilder.ts",
      "src/vs/workbench/services/search/common/searchExtTypes.ts",
      "src/vs/workbench/contrib/search/browser/searchActionsBase.ts",
      "src/vs/workbench/contrib/search/browser/searchActionsNav.ts",
      "src/vs/workbench/contrib/search/browser/searchTreeModel/searchModel.ts",
    ]))
    expect(search?.targetArea).toContain("workbench/services/search/common/searchService.ts")
    expect(search?.targetArea).toContain("desktop/services/search/{index,searchServiceAdapter}.js")
    expect(search?.reason).toContain("ISearchService service brand")
    expect(search?.reason).toContain("provider registration")
    expect(search?.reason).toContain("progress forwarding")
    expect(search?.reason).toContain("SearchError/limit/stale result mapping")
    expect(search?.reason).toContain("multi-scheme fanout")
    expect(search?.reason).toContain("unsupported provider")
    expect(search?.reason).toContain("providerFailures")
    expect(search?.reason).toContain("本地 file fallback 假成功")
    expect(search?.reason).toContain("provider lifecycle / clearCache 去重")
    expect(search?.reason).toContain("SearchPanel")
    expect(search?.reason).toContain("onSearch:* activation")
    expect(search?.reason).toContain("不新增第二套搜索状态源")

    expect(bulkEdit?.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/editor/browser/services/bulkEditService.ts",
      "src/vs/workbench/contrib/bulkEdit/browser/bulkEditService.ts",
      "src/vs/workbench/contrib/search/browser/replaceService.ts",
    ]))
    expect(bulkEdit?.targetArea).toContain("bulkEditService.ts")
    expect(bulkEdit?.targetArea).toContain("searchFileActions.ts")
    expect(bulkEdit?.targetArea).toContain("App.vue search-replace smoke bridge")
    expect(bulkEdit?.targetArea).toContain("desktop/main.js workbench-search-replace evidence")
    expect(bulkEdit?.targetArea).toContain("mainThreadBulkEdits.js")
    expect(bulkEdit?.reason).toContain("ReplaceService -> IBulkEditService")
    expect(bulkEdit?.reason).toContain("dry-run")
    expect(bulkEdit?.reason).toContain("先 dry-run preview 证明不写盘")
    expect(bulkEdit?.reason).toContain("workbench-search-replace JSON/Markdown evidence")
    expect(bulkEdit?.reason).toContain("searchRefreshEvidence")
    expect(bulkEdit?.reason).toContain("watcherRefreshStable")
    expect(bulkEdit?.reason).toContain("FileService watcher/coalescing")
    expect(bulkEdit?.reason).toContain("resource/range/match/operation/reason/rollbackRisk")
    expect(bulkEdit?.reason).toContain("partial failure")
    expect(bulkEdit?.reason).toContain("changedResources / rollbackRisk")
  })

  it("tracks MCP and Extension Gallery workbench surfaces without new state sources", () => {
    const extensions = sourceMirrorMigrationItems.find((item) => item.id === "extension-marketplace-workbench-service")
    const mcp = sourceMirrorMigrationItems.find((item) => item.id === "mcp-quickaccess-gallery-workbench-surface")

    expect(extensions?.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/platform/extensionManagement/common/extensionGalleryService.ts",
      "src/vs/workbench/contrib/extensions/browser/extensionsWorkbenchService.ts",
      "src/vs/workbench/contrib/extensions/browser/extensionsActions.ts",
      "src/vs/workbench/contrib/extensions/browser/extensionsQuickAccess.ts",
    ]))
    expect(extensions?.targetArea).toContain("extensionsWorkbenchService.ts")
    expect(extensions?.targetArea).toContain("Marketplace.vue")
    expect(extensions?.targetArea).toContain("ExtensionDetails.vue")
    expect(extensions?.targetArea).toContain("App.vue")
    expect(extensions?.targetArea).toContain("desktop/main.js")
    expect(extensions?.reason).toContain("IExtensionsWorkbenchService")
    expect(extensions?.reason).toContain("enable/disable")
    expect(extensions?.reason).toContain("evidence summary")
    expect(extensions?.reason).toContain("getSurfaceSnapshot()")
    expect(extensions?.reason).toContain("workbench.view.extensions")
    expect(extensions?.reason).toContain("workbench.extensions.marketplace")
    expect(extensions?.reason).toContain("real-project-ui smoke")
    expect(extensions?.reason).toContain("不新增第二套扩展安装状态源")

    expect(mcp?.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/platform/quickinput/common/quickInput.ts",
      "src/vs/workbench/services/quickinput/browser/quickInputService.ts",
      "src/vs/workbench/contrib/mcp/browser/mcpResourceQuickAccess.ts",
      "src/vs/workbench/contrib/mcp/browser/mcpServerEditor.ts",
      "src/vs/platform/mcp/common/mcpGalleryService.ts",
    ]))
    expect(mcp?.targetArea).toContain("mcpCommands.ts")
    expect(mcp?.targetArea).toContain("workbenchLayoutModel.ts")
    expect(mcp?.targetArea).toContain("workbenchLayoutActions.ts")
    expect(mcp?.targetArea).toContain("QuickPickDialog.vue")
    expect(mcp?.targetArea).toContain("App.vue")
    expect(mcp?.targetArea).toContain("desktop/main.js")
    expect(mcp?.targetArea).toContain("scripts/electron-ui-smoke.js")
    expect(mcp?.reason).toContain("provider-backed FileService")
    expect(mcp?.reason).toContain("AbortSignal")
    expect(mcp?.reason).toContain("data-codek-smoke=\"quick-input-workbench\"")
    expect(mcp?.reason).toContain("真实 dialog")
    expect(mcp?.reason).toContain("quick pick accept")
    expect(mcp?.reason).toContain("input box Escape cancel")
    expect(mcp?.reason).toContain("quickInputWorkbenchRealUi")
    expect(mcp?.reason).toContain("quickInputWorkbenchServiceBoundary")
    expect(mcp?.reason).toContain("IMcpWorkbenchService")
    expect(mcp?.reason).toContain("_serviceBrand")
    expect(mcp?.reason).toContain("registerSingleton")
    expect(mcp?.reason).toContain("ServiceCollection")
    expect(mcp?.reason).toContain("getMcpWorkbenchSurfaceSnapshot()")
    expect(mcp?.reason).toContain("evidence summary")
    expect(mcp?.reason).toContain("workbench.view.mcp")
    expect(mcp?.reason).toContain("getMcpResourceAccessEvidenceSummary()")
    expect(mcp?.reason).toContain("mcpGalleryWorkbenchDetailActionEvidence")
    expect(mcp?.reason).toContain("mcpWorkbenchPreservesAgentApproval")
    expect(mcp?.reason).toContain("mcpWorkbenchNoSecondState")
    expect(mcp?.reason).toContain("不展示 resource content")
    expect(mcp?.reason).toContain("real-project-ui smoke")
    expect(mcp?.reason).toContain("mcp-workbench-surface")
    expect(mcp?.reason).toContain("mcpWorkbenchSurfaceVisible")
    expect(mcp?.reason).toContain("mcpWorkbenchServiceBoundary")
    expect(mcp?.reason).toContain("不重写 transport")
  })

  it("tracks Extension Host, Workspace Trust, Remote Authority and Authentication contribution facades", () => {
    const item = sourceMirrorMigrationItems.find((migrationItem) => migrationItem.id === "extension-trust-remote-auth-workbench")

    expect(item?.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/services/extensions/common/extensions.ts",
      "src/vs/platform/workspace/common/workspaceTrust.ts",
      "src/vs/platform/remote/common/remoteAuthorityResolver.ts",
      "src/vs/workbench/services/authentication/common/authentication.ts",
      "src/vs/workbench/contrib/authentication/browser/authentication.contribution.ts",
      "src/vs/platform/actions/common/actions.ts",
      "src/vs/workbench/common/views.ts",
    ]))
    expect(item?.targetArea).toContain("extensionTrustRemoteAuthWorkbench.ts")
    expect(item?.targetArea).toContain("App.vue")
    expect(item?.targetArea).toContain("desktop/main.js")
    expect(item?.targetArea).toContain("realProjectUiGateAttribution.js")
    expect(item?.reason).toContain("service facade")
    expect(item?.reason).toContain("_serviceBrand")
    expect(item?.reason).toContain("registerSingleton")
    expect(item?.reason).toContain("ServiceCollection")
    expect(item?.reason).toContain("Action2/Menu/View contribution")
    expect(item?.reason).toContain("不是实现完整 VS Code extension host runtime")
    expect(item?.reason).toContain("IExtensionHostService")
    expect(item?.reason).toContain("extensionsWorkbenchService")
    expect(item?.reason).toContain("IWorkspaceTrustManagementService")
    expect(item?.reason).toContain("agentPolicy gate")
    expect(item?.reason).toContain("IRemoteAuthorityResolverService")
    expect(item?.reason).toContain("remoteManager")
    expect(item?.reason).toContain("IAuthenticationService")
    expect(item?.reason).toContain("authState")
    expect(item?.reason).toContain("MCP OAuth session")
    expect(item?.reason).toContain("不保存 token")
    expect(item?.reason).toContain("codek.view.extensionTrustRemoteAuth")
    expect(item?.reason).toContain("missing-pending-authorized-expired-revoked-error")
    expect(item?.reason).toContain("6 个 acceptance")
    expect(item?.reason).toContain("manualAcceptanceContract")
    expect(item?.reason).toContain("trust allow/deny")
    expect(item?.reason).toContain("remote resolve success/failure/cache")
    expect(item?.reason).toContain("auth missing/pending/authorized/expired/revoked/error")
    expect(item?.reason).toContain("token redaction")
    expect(item?.reason).toContain("blocked/pass 必须可归属")
    expect(item?.reason).toContain("不新增第二套 extension/trust/remote/auth store")
  })

  it("tracks Agent Evidence workbench SCM, Testing, Timeline, Progress and Notification surfaces", () => {
    const agentEvidence = sourceMirrorMigrationItems.find((item) => item.id === "agent-evidence-workbench")

    expect(agentEvidence?.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/testing",
      "src/vs/workbench/contrib/scm",
      "src/vs/workbench/contrib/timeline",
      "src/vs/workbench/services/progress",
      "src/vs/workbench/services/notification",
      "src/vs/workbench/common/views.ts",
      "src/vs/platform/actions/common/actions.ts",
      "src/vs/platform/commands/common/commands.ts",
    ]))
    expect(agentEvidence?.targetArea).toContain("agentEvidenceWorkbench.ts")
    expect(agentEvidence?.targetArea).toContain("App.vue")
    expect(agentEvidence?.targetArea).toContain("orchestratorClient.ts")
    expect(agentEvidence?.targetArea).toContain("releaseEvidenceExport.js")
    expect(agentEvidence?.targetArea).toContain("desktop/main.js real-project-ui smoke")
    expect(agentEvidence?.targetArea).toContain("view/menu/command registry")
    expect(agentEvidence?.targetArea).toContain("Agent Evidence SCM/Testing/Timeline/Progress/Notification facade services")
    expect(agentEvidence?.targetArea).toContain("Agent Evidence Action2/SCMTitle/TestItem/ViewTitle contribution")
    expect(agentEvidence?.targetArea).toContain("Agent Evidence unified list/detail/filter/export surface")
    expect(agentEvidence?.reason).toContain("release evidence 派生")
    expect(agentEvidence?.reason).toContain("统一 report contract")
    expect(agentEvidence?.reason).toContain("failure causes")
    expect(agentEvidence?.reason).toContain("correlation id")
    expect(agentEvidence?.reason).toContain("IAgentEvidenceWorkbenchService service brand")
    expect(agentEvidence?.reason).toContain("IAgentEvidenceScmService")
    expect(agentEvidence?.reason).toContain("IAgentEvidenceTestingService")
    expect(agentEvidence?.reason).toContain("IAgentEvidenceTimelineService")
    expect(agentEvidence?.reason).toContain("IAgentEvidenceProgressService")
    expect(agentEvidence?.reason).toContain("IAgentEvidenceNotificationService")
    expect(agentEvidence?.reason).toContain("ITimelineService='timeline'")
    expect(agentEvidence?.reason).toContain("ISCMService='scm'")
    expect(agentEvidence?.reason).toContain("ITestService='testService'")
    expect(agentEvidence?.reason).toContain("IProgressService='progressService'")
    expect(agentEvidence?.reason).toContain("INotificationService='notificationService'")
    expect(agentEvidence?.reason).toContain("只代理同一 workbench surface")
    expect(agentEvidence?.reason).toContain("VS Code 原名 service id 也解析到同一个 facade")
    expect(agentEvidence?.reason).toContain("Action2/registerAction2")
    expect(agentEvidence?.reason).toContain("SCMTitle")
    expect(agentEvidence?.reason).toContain("TestItem")
    expect(agentEvidence?.reason).toContain("getContributionSummary()")
    expect(agentEvidence?.reason).toContain("command/action ids")
    expect(agentEvidence?.reason).toContain("AGENT_EVIDENCE_SURFACE_BRIDGE_AUDIT")
    expect(agentEvidence?.reason).toContain("Codek state source")
    expect(agentEvidence?.reason).toContain("DOM smoke selector")
    expect(agentEvidence?.reason).toContain("real-project-ui metric key")
    expect(agentEvidence?.reason).toContain("App.vue sidebar pane")
    expect(agentEvidence?.reason).toContain("Electron real-project-ui smoke")
    expect(agentEvidence?.reason).toContain("SCM resource open/diff/stage/attach command metadata")
    expect(agentEvidence?.reason).toContain("Testing rerun command/failure detail/resource links")
    expect(agentEvidence?.reason).toContain("Timeline command/resource/link")
    expect(agentEvidence?.reason).toContain("Progress aggregate status/cancel command/aria label")
    expect(agentEvidence?.reason).toContain("Notification dedupe key/dismiss command/focus target")
    expect(agentEvidence?.reason).toContain("getScmRepositories()/getScmResourceGroups()/getScmResourceActions()/openScmResource()/diffScmResource()/stageScmResource()")
    expect(agentEvidence?.reason).toContain("getTestingRunSummary()/getTestResults()/rerunTests()")
    expect(agentEvidence?.reason).toContain("getTimelineItem()/getTimelineItemCommand()/getTimelineItemResource()")
    expect(agentEvidence?.reason).toContain("getProgressAggregate()/cancelProgress()")
    expect(agentEvidence?.reason).toContain("getNotificationSeverityCounts()/getNotificationActions()/dismissNotification()")
    expect(agentEvidence?.reason).toContain("agent.evidence.stageResource")
    expect(agentEvidence?.reason).toContain("read-only evidence action")
    expect(agentEvidence?.reason).toContain("real-project-ui metrics")
    expect(agentEvidence?.reason).toContain("统一 evidence list/detail/filter/export")
    expect(agentEvidence?.reason).toContain("getEvidenceItems()/getEvidenceDetail()/getExportDescriptor()")
    expect(agentEvidence?.reason).toContain("agent.evidence.openDetail")
    expect(agentEvidence?.reason).toContain("agent.evidence.exportJson")
    expect(agentEvidence?.reason).toContain("agent.evidence.exportMarkdown")
    expect(agentEvidence?.reason).toContain("data-agent-evidence-list/detail/editor/export DOM")
    expect(agentEvidence?.reason).toContain("agentEvidenceWorkbenchListDetailExport")
    expect(agentEvidence?.reason).toContain("Evidence List/Detail/Export")
    expect(agentEvidence?.reason).toContain("manualAcceptanceContract")
    expect(agentEvidence?.reason).toContain("SCM/Testing/Timeline/Notification Center/Progress 人工复验步骤")
    expect(agentEvidence?.reason).toContain("failure owner")
    expect(agentEvidence?.reason).toContain("manualStatus")
    expect(agentEvidence?.reason).toContain("不被误标为完整人工体验通过")
    expect(agentEvidence?.reason).toContain("不新增第二套 evidence/progress/notification/SCM/testing/timeline 状态源")
  })

  it("tracks Terminal, Debug, Output, Task and Problems as one Workbench contribution boundary", () => {
    const terminalDebugTask = sourceMirrorMigrationItems.find((item) => item.id === "terminal-debug-output-task-problems-workbench")

    expect(terminalDebugTask?.sourcePaths).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/terminal/browser/terminal.ts",
      "src/vs/workbench/services/output/common/output.ts",
      "src/vs/workbench/contrib/debug/common/debug.ts",
      "src/vs/workbench/contrib/tasks/common/taskService.ts",
      "src/vs/workbench/contrib/markers/common/markers.ts",
      "src/vs/workbench/services/panecomposite/browser/panecomposite.ts",
      "src/vs/workbench/browser/parts/panel",
    ]))
    expect(terminalDebugTask?.targetArea).toContain("terminalDebugTaskWorkbench.ts")
    expect(terminalDebugTask?.targetArea).toContain("TaskWorkbenchPanel.vue")
    expect(terminalDebugTask?.targetArea).toContain("App.vue")
    expect(terminalDebugTask?.targetArea).toContain("desktop/main.js")
    expect(terminalDebugTask?.targetArea).toContain("realProjectUiGateAttribution.js")
    expect(terminalDebugTask?.reason).toContain("contribution registration")
    expect(terminalDebugTask?.reason).toContain("view container")
    expect(terminalDebugTask?.reason).toContain("Action2/Menu")
    expect(terminalDebugTask?.reason).toContain("CommandPalette")
    expect(terminalDebugTask?.reason).toContain("ITerminalService")
    expect(terminalDebugTask?.reason).toContain("IOutputService")
    expect(terminalDebugTask?.reason).toContain("IDebugService")
    expect(terminalDebugTask?.reason).toContain("ITaskService")
    expect(terminalDebugTask?.reason).toContain("IProblemsWorkbenchService")
    expect(terminalDebugTask?.reason).toContain("IPaneCompositePartService")
    expect(terminalDebugTask?.reason).toContain("ITerminalDebugTaskWorkbenchService")
    expect(terminalDebugTask?.reason).toContain("ServiceCollection")
    expect(terminalDebugTask?.reason).toContain("terminalManager")
    expect(terminalDebugTask?.reason).toContain("outputLogTelemetryService")
    expect(terminalDebugTask?.reason).toContain("debugState")
    expect(terminalDebugTask?.reason).toContain("taskConfigurationModel/userTasksService/problemMatcherRegistry")
    expect(terminalDebugTask?.reason).toContain("taskRunner/TaskSystemLifecycleProjection")
    expect(terminalDebugTask?.reason).toContain("problemsDiagnosticsService(globalMarkerService)")
    expect(terminalDebugTask?.reason).toContain("TaskWorkbenchPanel.vue")
    expect(terminalDebugTask?.reason).toContain("只读 ProblemsPanel")
    expect(terminalDebugTask?.reason).toContain("旧 View 菜单和 Command Palette")
    expect(terminalDebugTask?.reason).toContain("workbench.action.terminal")
    expect(terminalDebugTask?.reason).toContain("workbench.action.output.showOutput")
    expect(terminalDebugTask?.reason).toContain("workbench.action.debug")
    expect(terminalDebugTask?.reason).toContain("workbench.action.tasks")
    expect(terminalDebugTask?.reason).toContain("workbench.actions.view.toggleProblems")
    expect(terminalDebugTask?.reason).toContain("`terminalDebugTaskWorkbench*` metrics")
    expect(terminalDebugTask?.reason).toContain("taskWorkbenchPanelSurface")
    expect(terminalDebugTask?.reason).toContain("8 个独立 acceptance")
    expect(terminalDebugTask?.reason).toContain("manualAcceptanceContract")
    expect(terminalDebugTask?.reason).toContain("真实 Workbench controls")
    expect(terminalDebugTask?.reason).toContain("Command Palette")
    expect(terminalDebugTask?.reason).toContain("action 可触发")
    expect(terminalDebugTask?.reason).toContain("失败归属清晰")
    expect(terminalDebugTask?.reason).toContain("不新增第二套 terminal/output/debug/task/problems 状态源")
  })
})
