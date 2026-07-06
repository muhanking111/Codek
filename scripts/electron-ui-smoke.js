#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")
const { spawn } = require("node:child_process")
const { assertFrontendDistConsistency } = require("./frontend-dist-consistency")

const root = path.resolve(__dirname, "..")
const desktopDir = path.join(root, "desktop")
const distIndex = path.join(root, "frontend", "vite-project", "dist", "index.html")
const desktopDistDir = path.join(root, "desktop", "frontend-dist")
const desktopDistIndex = path.join(desktopDistDir, "index.html")
const smokeUserDataBaseDir = path.join(root, ".codek", "electron-smoke-user-data")
const packagedUserDataBaseDir = path.join(root, ".codek", "electron-packaged-smoke-user-data")
const smokeReportDir = path.join(root, ".codek", "reports")
const shouldLoginWorkbench = process.argv.includes("--login-workbench")
const shouldRunAnalysisWorkspace = process.argv.includes("--analysis-workspace")
const shouldRunExplorerPerformance = process.argv.includes("--explorer-performance")
const shouldRunRealExplorer = process.argv.includes("--real-explorer")
const shouldRunExplorerStress = process.argv.includes("--explorer-stress")
const shouldRunFileOperationVisibility = process.argv.includes("--file-operation-visibility")
const shouldRunSearchReplace = process.argv.includes("--search-replace")
const shouldRunEditorOpenFiles = process.argv.includes("--editor-open-files")
const shouldRunNotebookMarkdownPreview = process.argv.includes("--notebook-markdown-preview")
const shouldRunAccessibleViewVisibleOwner = process.argv.includes("--accessible-view-visible-owner")
const shouldRunMultiRootCreateTarget = process.argv.includes("--multiroot-create-target")
const shouldRunCreateTargetAccuracy = process.argv.includes("--create-target-accuracy")
const shouldRunInlineCreateFocus = process.argv.includes("--inline-create-focus")
const shouldRunSearchNavigation = process.argv.includes("--search-navigation")
const shouldRunArtifactOpen = process.argv.includes("--artifact-open")
const shouldRunTabOverflow = process.argv.includes("--tab-overflow")
const shouldRunIconVisualState = process.argv.includes("--icon-visual-state")
const shouldRunIconThemeRefresh = process.argv.includes("--icon-theme-refresh")
const shouldRunRealProjectUi = process.argv.includes("--real-project-ui")
const shouldRunWorkbenchUiAudit = process.argv.includes("--workbench-ui-audit")
const shouldRunNotificationActionsClick = process.argv.includes("--notification-actions-click")
const shouldRunTaskProviderExecute = process.argv.includes("--task-provider-execute")
const shouldRunTaskProviderBackgroundOwner = process.argv.includes("--task-provider-background-owner")
const shouldRunDebugOutputBridge = process.argv.includes("--debug-output-bridge")
const shouldRunOutputLog = process.argv.includes("--output-log")
const shouldRunDebugSession = process.argv.includes("--debug-session")
const shouldRunTestingPublishResults = process.argv.includes("--testing-publish-results")
const shouldRunWorkspaceTrustDowngradeRestart = process.argv.includes("--workspace-trust-downgrade-restart")
const shouldRunWorkspaceTrustRequestDialog = process.argv.includes("--workspace-trust-request-dialog")
const shouldRunWorkspaceTrustEditor = process.argv.includes("--workspace-trust-editor")
const shouldRunExtensionInstallConfirmation = process.argv.includes("--extension-install-confirmation")
const shouldRunExtensionHostRestart = process.argv.includes("--extension-host-restart")
const shouldRunWorkingCopyHotExit = process.argv.includes("--working-copy-hot-exit")
const shouldRunDevServerFallback = process.argv.includes("--dev-server-fallback")
const shouldUsePackaged = process.argv.includes("--packaged")
const shouldRunStartupOnly = process.argv.includes("--startup-only")
const shouldDryRun = process.argv.includes("--dry-run")
const viewportArg = process.argv.find((arg) => arg.startsWith("--viewport="))
const smokeViewport = viewportArg ? viewportArg.slice("--viewport=".length).split("x").map((part) => Number(part)) : []
const shouldRunFocusedWorkbenchSmoke = shouldRunAnalysisWorkspace || shouldRunExplorerPerformance || shouldRunRealExplorer || shouldRunExplorerStress || shouldRunFileOperationVisibility || shouldRunSearchReplace || shouldRunEditorOpenFiles || shouldRunNotebookMarkdownPreview || shouldRunAccessibleViewVisibleOwner || shouldRunMultiRootCreateTarget || shouldRunCreateTargetAccuracy || shouldRunInlineCreateFocus || shouldRunSearchNavigation || shouldRunArtifactOpen || shouldRunTabOverflow || shouldRunIconVisualState || shouldRunIconThemeRefresh || shouldRunRealProjectUi || shouldRunWorkbenchUiAudit || shouldRunNotificationActionsClick || shouldRunTaskProviderExecute || shouldRunTaskProviderBackgroundOwner || shouldRunDebugOutputBridge || shouldRunOutputLog || shouldRunDebugSession || shouldRunTestingPublishResults || shouldRunWorkspaceTrustDowngradeRestart || shouldRunWorkspaceTrustRequestDialog || shouldRunWorkspaceTrustEditor || shouldRunExtensionInstallConfirmation || shouldRunExtensionHostRestart || shouldRunWorkingCopyHotExit
const defaultSmokeTimeoutMs = shouldRunRealProjectUi || shouldRunWorkbenchUiAudit || shouldRunExplorerStress || shouldRunDebugSession ? "120000" : shouldRunFocusedWorkbenchSmoke ? "60000" : "20000"
function resolveSmokeResultFile() {
  if (process.env.CODEK_ELECTRON_SMOKE_RESULT_FILE) return process.env.CODEK_ELECTRON_SMOKE_RESULT_FILE
  const smokeName = shouldRunRealProjectUi
    ? "real-project-ui"
    : shouldRunWorkbenchUiAudit
      ? "workbench-ui-audit"
    : shouldRunNotificationActionsClick
      ? "notification-actions-click"
    : shouldRunTaskProviderExecute
      ? "task-provider-execute"
    : shouldRunTaskProviderBackgroundOwner
      ? "task-provider-background-owner"
    : shouldRunDebugOutputBridge
      ? "debug-output-bridge"
    : shouldRunOutputLog
      ? "output-log"
    : shouldRunDebugSession
      ? "debug-session"
    : shouldRunTestingPublishResults
      ? "testing-publish-results"
    : shouldRunWorkspaceTrustDowngradeRestart
      ? "workspace-trust-downgrade-restart"
    : shouldRunWorkspaceTrustRequestDialog
      ? "workspace-trust-request-dialog"
    : shouldRunWorkspaceTrustEditor
      ? "workspace-trust-editor"
    : shouldRunExtensionInstallConfirmation
      ? "extension-install-confirmation"
    : shouldRunExtensionHostRestart
      ? "extension-host-restart"
    : shouldRunDevServerFallback
      ? "startup-dev-server-fallback"
      : shouldRunExplorerPerformance
      ? "explorer-performance"
      : shouldRunRealExplorer
        ? "real-explorer"
        : shouldRunExplorerStress
          ? "explorer-stress"
          : shouldRunWorkingCopyHotExit
            ? "working-copy-hot-exit"
            : shouldRunFileOperationVisibility
              ? "file-operation-visibility"
              : shouldRunSearchNavigation
              ? "search-navigation"
              : shouldRunArtifactOpen
                ? "artifact-open"
                : shouldRunSearchReplace
                  ? "search-replace"
                  : shouldRunEditorOpenFiles
                    ? "editor-open-files"
                    : shouldRunNotebookMarkdownPreview
                      ? "notebook-markdown-preview"
                      : shouldRunAccessibleViewVisibleOwner
                        ? "accessible-view-visible-owner"
                      : shouldRunTabOverflow
                        ? "tab-overflow"
                        : shouldRunIconThemeRefresh
                          ? "icon-theme-refresh"
                          : shouldRunIconVisualState
                            ? "icon-visual-state"
                            : shouldRunInlineCreateFocus
                              ? "inline-create-focus"
                              : shouldRunCreateTargetAccuracy
                                ? "create-target-accuracy"
                                : shouldRunMultiRootCreateTarget
                                  ? "multiroot-create-target"
                                  : shouldRunAnalysisWorkspace
                                    ? "analysis-workspace"
                                    : "startup"
  return path.join(smokeReportDir, `electron-smoke-${smokeName}-latest-result.json`)
}
const smokeResultFile = resolveSmokeResultFile()
const electronExe = process.platform === "win32"
  ? path.join(desktopDir, "node_modules", "electron", "dist", "electron.exe")
  : null
const electronShim = process.platform === "win32"
  ? path.join(desktopDir, "node_modules", ".bin", "electron.cmd")
  : path.join(desktopDir, "node_modules", ".bin", "electron")
const electronBin = electronExe && fs.existsSync(electronExe) ? electronExe : electronShim
const packagedExe = process.platform === "win32"
  ? path.join(desktopDir, "release", "win-unpacked", "Codek.exe")
  : ""

function writeDebugSessionBlockedResult(message) {
  if (!shouldRunDebugSession || shouldDryRun) return
  try {
    const latestMarkdownPath = path.join(smokeReportDir, "electron-smoke-debug-session-latest-result.md")
    const payload = {
      ok: false,
      smokeCase: "debug-session",
      blocked: true,
      blockedReason: message,
      dapMetadataOnly: true,
      debugSession: {
        sessionObserved: false,
        metadata: {
          sessionIdPrefix: "",
          sessionIdLength: 0,
          adapterType: "",
          phase: "",
          stateSource: "",
          capabilityKeys: [],
        },
        bridgeEvidence: {
          source: "MainThreadDebugService.dapIpcBridge",
          status: "not-started",
        },
        redaction: {
          noExpressionText: true,
          noSourcePathText: true,
          noAdapterArgsText: true,
        },
        debugViewContainerOwner: {
          status: "partial",
          connected: false,
          reason: "Electron did not reach the DebugPanel/DAP session exercise; full Debug View Container owner remains a follow-up.",
        },
      },
      checks: [{
        name: "debug session smoke reaches Electron DAP session exercise",
        passed: false,
        detail: message,
      }],
      latestMarkdownPath,
    }
    fs.mkdirSync(path.dirname(smokeResultFile), { recursive: true })
    fs.writeFileSync(smokeResultFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    fs.writeFileSync(latestMarkdownPath, [
      "# Electron Debug Session Smoke Evidence",
      "",
      "- Status: blocked",
      `- Reason: ${message}`,
      "- Session observed: false",
      "- DAP metadata only: true",
      "- Debug View Container owner: partial, not connected",
      "",
    ].join("\n"), "utf8")
  } catch {
    // Keep the original failure path authoritative.
  }
}

function fail(message) {
  writeDebugSessionBlockedResult(message)
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function buildExtensionHostRestartContract() {
  return {
    ok: false,
    smokeCase: "extension-host-restart",
    dryRun: shouldDryRun,
    blocked: false,
    blockedReason: "",
    intendedMainHooks: [
      "desktop/main.js exerciseElectronSmokeExtensionHostRestart",
      "POST /extensions-host/lifecycle/restart",
      "restartExtensionHosts() composes stopExtensionHosts()+startExtensionHosts()",
      "scripts/extension-host-restart-smoke.js starts a real ExtensionHostServer process and dispatches the restart route",
      "ExtensionHostServer.stop() terminates the old process before ExtensionHostServer.start() creates the replacement process",
    ],
    intendedRendererHooks: [
      "window.codek.restartExtensionHosts(reason, options)",
      "ehClient.restartExtensionHosts(reason, options)",
      "api.post('/extensions-host/lifecycle/restart', { reason, rootDir, workspaceRoots, workspaceFile })",
    ],
    expectedEvidence: {
      serviceId: "extensionHostLifecycleService",
      stateSource: "desktop.extensionsHostService",
      vscodeContract: "IExtensionService.stopExtensionHosts+startExtensionHosts",
      action: "restartExtensionHosts",
      stopEvidenceAction: "stopExtensionHosts",
      startEvidenceAction: "startExtensionHosts",
      reloadRequested: false,
      reloaded: false,
      noIHostServiceReload: true,
      processReplacement: true,
      manifestRegistrationAfterRestart: true,
      isolatedExtensionsDir: true,
      runtimeRouteSmoke: "scripts/extension-host-restart-smoke.js",
      electronMainWindowSmoke: "scripts/electron-ui-smoke.js --extension-host-restart",
      rendererPreloadMainTrigger: true,
    },
    connectedOwners: [
      "desktop/main.js extension-host-restart Electron smoke",
      "desktop/preload.js window.codek.restartExtensionHosts",
      "desktop.extensionsHostService lifecycle restart route",
      "ExtensionHostServer real process lifecycle smoke helper",
      "ehClient.restartExtensionHosts route contract",
    ],
    partialOwners: [],
    blockedOwners: [],
    vscodeSourceReferences: [
      "src/vs/workbench/services/extensions/common/extensions.ts",
      "src/vs/workbench/services/host/browser/host.ts",
    ],
  }
}

function buildWorkspaceTrustDowngradeRestartContract() {
  return {
    ok: false,
    smokeCase: "workspace-trust-downgrade-restart",
    dryRun: shouldDryRun,
    blocked: shouldDryRun,
    blockedReason: shouldDryRun
      ? "dry-run only reports the registered WorkspaceTrust downgrade/restart contract; omit --dry-run to execute the real Electron smoke."
      : "",
    intendedRendererHooks: [
      "globalWorkspaceTrustManagementService.setWorkspaceTrust(root, 'trusted')",
      "globalWorkspaceTrustManagementService.setWorkspaceTrust(root, 'restricted')",
      "globalWorkspaceTrustManagementService.openWorkspaceTrustConfigureSettings()",
      "globalWorkspaceTrustManagementService.getTrustSnapshot(root).latestTransition.extensionHostLifecycle",
      "data-codek-smoke=\"workspace-trust-restricted-banner\"",
      "data-codek-smoke=\"extension-trust-remote-auth-workbench\"",
    ],
    expectedEvidence: {
      configureSettingsQuery: "@tag:workspaceTrust",
      transitionStatus: "restricted",
      extensionEnablementState: "DisabledByTrustRequirement",
      extensionHostLifecycleAction: "stopStart",
      extensionHostLifecycleStatus: "completed|blocked",
      stopStartVetoBlockedBy: "extensionHostStopVeto",
      noSecondTrustStore: true,
    },
    vscodeSourceReferences: [
      "src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts",
      "src/vs/workbench/services/extensions/common/extensions.ts",
    ],
  }
}

function buildWorkspaceTrustRequestDialogContract() {
  return {
    ok: false,
    smokeCase: "workspace-trust-request-dialog",
    dryRun: shouldDryRun,
    blocked: false,
    blockedReason: "",
    intendedRendererHooks: [
      "globalWorkspaceTrustManagementService.requestWorkspaceTrustOnStartup(root)",
      "globalCodekDialogService.getActiveDialog()",
      "data-codek-smoke=\"codek-dialog-service-modal\"",
      "data-dialog-source=\"WorkspaceTrustRequestHandler\"",
      "data-dialog-command-id=\"workbench.trust.request\"",
      "data-dialog-workspace-folder",
      "data-dialog-button-labels",
      "button[data-dialog-button-index]",
      "globalCodekDialogService.getDecisionProjections()",
      "globalWorkspaceTrustManagementService.getTrustSnapshot(root)",
    ],
    expectedEvidence: {
      dialogSource: "WorkspaceTrustRequestHandler",
      commandId: "workbench.trust.request",
      buttonLabels: ["Trust Workspace & Continue", "Manage", "Cancel"],
      clickedDecision: "Trust Workspace & Continue",
      dialogDecisionProjectionSource: "CodekDialogService.getDecisionProjections",
      trustSnapshotSource: "WorkspaceTrustWorkbenchService.getTrustSnapshot",
      requestLifecycleSource: "WorkspaceTrustWorkbenchService.requestLifecycle",
      noSecondTrustStore: true,
      managePane: "partial: button visible only; full WorkspaceTrustEditor pane is not claimed by this smoke",
    },
    vscodeSourceReferences: [
      "src/vs/workbench/contrib/workspace/browser/workspaceTrust.ts",
      "src/vs/workbench/contrib/workspace/browser/workspaceTrustEditor.ts",
      "src/vs/workbench/services/workspaces/common/workspaceTrust.ts",
    ],
  }
}

function buildWorkspaceTrustEditorContract() {
  return {
    ok: false,
    smokeCase: "workspace-trust-editor",
    dryRun: shouldDryRun,
    blocked: false,
    blockedReason: "",
    intendedRendererHooks: [
      "globalWorkspaceTrustManagementService.openWorkspaceTrustManageEditor()",
      "data-codek-smoke=\"workspace-trust-editor\"",
      "data-codek-smoke=\"workspace-trust-editor-trusted-folders-table\"",
      "data-codek-smoke=\"workspace-trust-editor-affected-features\"",
      "editorPane.restrictedSettingsRender.stateSource === \"workbenchConfigurationService\"",
      "settings.filterUntrusted -> @tag:requireTrustedWorkspace",
      "WorkspaceTrustEditor.focus -> rootElement.focus",
      "ArrowDown section navigation",
      "Escape root focus",
      "Ctrl+Enter toggle workspace trust",
      "globalWorkspaceTrustManagementService.getTrustSnapshot(root).capabilities.requestService.editorPane",
    ],
    expectedEvidence: {
      editorId: "workbench.editor.workspaceTrust",
      inputId: "workbench.input.workspaceTrust",
      domSmokeStatus: "available",
      paneOwnerStatus: "partial",
      focusContract: "WorkspaceTrustEditor.focus -> rootElement.focus",
      keyboardNavigation: true,
      trustedFoldersTable: "available",
      affectedFeaturesList: "available",
      restrictedSettingsTree: "available",
      restrictedSettingsStateSource: "workbenchConfigurationService",
      filterUntrustedCommandId: "settings.filterUntrusted",
      filterUntrustedQuery: "@tag:requireTrustedWorkspace",
      settingsEditor2WorkspaceTrustTags: ["workspaceTrust", "requireTrustedWorkspace"],
      settingsEditor2TrustChangeModelUpdate: "IWorkspaceTrustManagementService.onDidChangeTrust -> SettingsTreeModel.updateWorkspaceTrust",
      settingsTreeIndicatorOwner: "SettingsTreeIndicatorsLabel",
      settingsTreeIndicatorCommandId: "workbench.trust.manage",
      settingsTreeModelTrustUpdateSignal: "SettingsTreeModel.updateWorkspaceTrust",
      workbenchTableOwnerId: "WorkspaceTrust",
      workbenchTableUpdateSignal: "WorkspaceTrustedUrisTable.updateTable -> WorkbenchTable.splice",
      settingsEditor2Owner: "partial",
      settingsTreeOwner: "partial",
      workbenchTableRowModel: "partial",
      fullEditorPaneClass: "blocked",
      noSecondTrustStore: true,
    },
    vscodeSourceReferences: [
      "src/vs/workbench/contrib/workspace/browser/workspaceTrustEditor.ts",
      "src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts",
      "src/vs/platform/workspace/common/workspaceTrust.ts",
      "src/vs/workbench/services/extensionManagement/browser/extensionEnablementService.ts",
      "src/vs/workbench/contrib/preferences/browser/preferences.contribution.ts",
      "src/vs/workbench/contrib/preferences/browser/settingsEditor2.ts",
      "src/vs/workbench/contrib/preferences/browser/settingsTree.ts",
      "src/vs/workbench/services/configuration/common/configuration.ts",
    ],
  }
}

function buildSearchNavigationContract() {
  return {
    ok: false,
    smokeCase: "search-navigation",
    dryRun: shouldDryRun,
    blocked: false,
    blockedReason: "",
    intendedRendererHooks: [
      "SearchPanel globalSearchWorkbenchService.textSearch(request, token, onProgress)",
      "SearchPanel renders CodekSearchWorkbenchProjection.resultTree",
      "createSearchPreviewParts(match.text, { line, column, matchLength })",
      "searchModel.resultTree.matches.occurrences drives collapsed match ranges",
      "openFile(path, line, column) from resultTree match metadata",
    ],
    expectedEvidence: {
      textSearchSource: "globalSearchWorkbenchService.textSearch",
      searchWorkbenchServiceId: "searchWorkbenchService",
      resultTreeSource: "searchWorkbenchService.resultTree",
      matchRangeSource: "searchModel.resultTree.matches.occurrences",
      progressSource: "SearchWorkbenchService.textSearch onProgress",
      noTemporarySearchResultProvider: true,
      noRawMatchUiProjection: true,
      workspaceMutation: "none",
    },
    vscodeSourceReferences: [
      "src/vs/workbench/contrib/search/browser/searchView.ts",
      "src/vs/workbench/contrib/search/browser/searchResultsView.ts",
      "src/vs/workbench/services/search/common/search.ts",
    ],
  }
}

function buildSearchReplaceContract() {
  return {
    ok: false,
    smokeCase: "search-replace",
    dryRun: shouldDryRun,
    blocked: false,
    blockedReason: "",
    intendedRendererHooks: [
      "SearchPanel globalSearchWorkbenchService.textSearch(request, token, onProgress)",
      "SearchPanel renders CodekSearchWorkbenchProjection.resultTree",
      "search file actions read resultTree match ranges",
      "searchWorkbenchService.previewReplace({ mode, request })",
      "searchWorkbenchService.applyReplacePreview(preview)",
      "replaceService.replaceOne/replaceAll via bulkEditService.apply",
      "workspaceEditService.apply persists changed resources",
    ],
    expectedEvidence: {
      textSearchSource: "globalSearchWorkbenchService.textSearch",
      searchWorkbenchServiceId: "searchWorkbenchService",
      resultTreeSource: "searchWorkbenchService.resultTree",
      matchRangeSource: "searchModel.resultTree.matches.occurrences",
      replacePreviewSource: "searchWorkbenchService.previewReplace",
      replacePreviewDryRun: true,
      replaceApplySource: "searchWorkbenchService.applyReplacePreview",
      replaceServiceSource: "IReplaceService.replaceOne/replaceAll",
      workspaceMutation: "bulkEditService",
      workspaceEditSource: "workspaceEditService.apply",
      noTemporarySearchResultProvider: true,
      noRawMatchReplaceFallback: true,
    },
    vscodeSourceReferences: [
      "src/vs/workbench/contrib/search/browser/replace.ts",
      "src/vs/workbench/contrib/search/browser/searchActions.ts",
      "src/vs/workbench/services/bulkEdit/browser/bulkEditService.ts",
    ],
  }
}

function buildEditorOpenFilesContract() {
  return {
    ok: false,
    smokeCase: "editor-open-files",
    dryRun: shouldDryRun,
    blocked: false,
    blockedReason: "",
    intendedRendererHooks: [
      "globalWorkbenchExplorerEditorService.getOpenEditorsModel()",
      "App.vue openFiles computed maps workbenchOpenEditorsModel.entries",
      "data-workbench-open-editors-source=\"workbenchExplorerEditorService\"",
      "data-workbench-open-editors-count",
      "data-workbench-no-local-open-files-state=\"true\"",
      "data-workbench-editor-part=\"true\"",
    ],
    expectedEvidence: {
      editorGroupsSource: "globalWorkbenchExplorerEditorService.getEditorGroupState",
      openEditorsSource: "workbenchExplorerEditorService",
      editorPartSource: "EditorPartService",
      tabListSource: "workbenchOpenEditorsModel.entries",
      noLocalOpenFilesArray: true,
      noTemporaryOpenFilesProjection: true,
      workspaceMutation: "none",
    },
    vscodeSourceReferences: [
      "src/vs/workbench/services/editor/common/editorGroupsService.ts",
      "src/vs/workbench/browser/parts/editor/editorPart.ts",
      "src/vs/workbench/browser/parts/editor/editorTabsControl.ts",
    ],
  }
}

function buildNotebookMarkdownPreviewContract() {
  return {
    ok: false,
    smokeCase: "notebook-markdown-preview",
    dryRun: shouldDryRun,
    blocked: false,
    blockedReason: "",
    intendedRendererHooks: [
      "App.vue __codekSmokeWorkbenchControls.runNotebookMarkdownPreviewSmoke(input)",
      "globalNotebookMarkdownPreviewWorkbenchService.openMarkdownPreview({ resource, content })",
      "globalNotebookMarkdownPreviewWorkbenchService.openNotebookDocument({ uri, viewType, cells })",
      "globalNotebookMarkdownPreviewWorkbenchService.registerNotebookKernel(kernel)",
      "globalNotebookMarkdownPreviewWorkbenchService.registerNotebookRenderer({ messaging: true })",
      "globalNotebookMarkdownPreviewWorkbenchService.postNotebookRendererMessage(message)",
      "data-markdown-preview-service-source=\"notebookMarkdownPreviewService\"",
      "data-notebook-service-id=\"notebookService\"",
      "data-notebook-renderer-message-count",
    ],
    expectedEvidence: {
      notebookServiceId: "notebookService",
      markdownPreviewSource: "notebookMarkdownPreviewService",
      rendererMessagingSource: "notebookRendererMessagingService",
      kernelSource: "notebookKernelService",
      noSecondNotebookOrRendererStateSource: true,
      payloadRedaction: "renderer message evidence records payload keys only",
      realElectronOwner: "App.vue __codekSmokeWorkbenchControls.runNotebookMarkdownPreviewSmoke",
    },
    vscodeSourceReferences: [
      "src/vs/workbench/contrib/notebook/common/notebookService.ts",
      "src/vs/workbench/contrib/notebook/common/notebookEditorModel.ts",
      "src/vs/workbench/contrib/notebook/common/notebookKernelService.ts",
      "src/vs/workbench/contrib/notebook/common/notebookRendererMessagingService.ts",
      "src/vs/workbench/contrib/notebook/browser/notebookExtensionPoint.ts",
      "src/vs/workbench/contrib/notebook/browser/view/cellParts/markupCell.ts",
      "src/vs/workbench/contrib/notebook/browser/view/renderers/backLayerWebView.ts",
    ],
  }
}

function buildAccessibleViewVisibleOwnerContract() {
  return {
    ok: false,
    smokeCase: "accessible-view-visible-owner",
    dryRun: shouldDryRun,
    blocked: false,
    blockedReason: "",
    intendedRendererHooks: [
      "App.vue __codekSmokeWorkbenchControls.runAccessibleViewVisibleOwnerSmoke(input)",
      "globalAccessibleViewService.registerProvider({ providerId, createProvider })",
      "globalAccessibleViewService.show(providerId)",
      "data-codek-smoke=\"accessible-view-dom-shell\"",
      "data-accessible-view-state-source=\"globalAccessibleViewService.getRendererProjection()\"",
      "data-accessible-view-dom-shell-owner=\"headless-service-adapter\"",
      "data-accessible-view-code-editor-backed=\"false\"",
      "data-accessible-view-workbench-toolbar-backed=\"false\"",
      "data-accessible-view-quick-pick-owner=\"missing\"",
      "data-accessible-view-action-id=\"editor.action.accessibleViewNext\"",
      "runAccessibleViewDomShellAction('editor.action.accessibleViewNext')",
      "hideAccessibleViewDomShell()",
      "globalAccessibleViewService.recordFocusRestoreInvocation({ targetId: \"editor:active\", invoked })",
    ],
    expectedEvidence: {
      appDomShellOwner: "App.vue accessible-view-dom-shell",
      serviceStateSource: "globalAccessibleViewService",
      providerLifecycle: "globalAccessibleViewService.show(providerId)",
      domShellOwner: "headless-service-adapter",
      noSecondAccessibilityState: true,
      codeEditorWidgetBacked: false,
      contextViewOwner: "missing",
      workbenchToolbarBacked: false,
      quickPickOwner: "missing",
      genericQuickInputReusable: true,
      domShellToolbarActionOwner: "App.vue DOM-shell menu-service projection",
      domShellToolbarActionId: "editor.action.accessibleViewNext",
      domShellToolbarMenuId: "AccessibleView",
      domShellToolbarActionContentChanged: true,
      focusInvocationOwner: "App.vue editor.focus",
      realElectronOwner: "App.vue __codekSmokeWorkbenchControls.runAccessibleViewVisibleOwnerSmoke",
    },
    connectedOwners: [
      "App.vue visible DOM shell",
      "globalAccessibleViewService provider lifecycle",
      "readonly DOM-shell content selector",
      "App.vue DOM-shell menu-service action execution",
      "App.vue editor.focus restore invocation",
    ],
    partialOwners: [
      "AccessibleView command/menu projection",
      "AccessibilityKeyboardNavigationService live-region signal UI projection",
    ],
    blockedOwners: [
      "CodeEditorWidget-backed AccessibleView content owner",
      "IContextViewService/ILayoutService context-view owner",
      "WorkbenchToolBar + MenuId.AccessibleView render lifecycle",
      "AccessibleViewSymbolQuickPick backed by IQuickInputService.createQuickPick",
      "IEditorService/CodeEditorWidget-owned focus lifecycle",
    ],
    vscodeSourceReferences: [
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts",
      "src/vs/workbench/contrib/accessibility/browser/accessibleViewActions.ts",
      "src/vs/platform/quickinput/browser/quickInputService.ts",
      "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts",
    ],
  }
}

function buildDebugOutputBridgeContract() {
  return {
    ok: false,
    smokeCase: "debug-output-bridge",
    dryRun: shouldDryRun,
    blocked: shouldDryRun,
    blockedReason: shouldDryRun
      ? "dry-run only reports the registered Debug/Output bridge contract; omit --dry-run to execute the real Electron smoke."
      : "",
    intendedMainHooks: [
      "MainThreadOutputService.$register(channel, backingFile)",
      "MainThreadOutputService.$update(channelId, mode, till)",
      "BrowserWindow.webContents.send('ext-host:output-register')",
      "BrowserWindow.webContents.send('ext-host:output-content')",
    ],
    intendedRendererHooks: [
      "extensionHostRuntimeBridge ext-host:output-register",
      "extensionHostRuntimeBridge ext-host:output-content",
      "globalCodekOutputService.getOutputSnapshot(channelLabel)",
      "DebugPanel .console-input Enter",
      "DebugManager.evaluate(expression)",
      "debugState.consoleOutput",
    ],
    expectedEvidence: {
      outputRegisterEvent: "ext-host:output-register",
      backingFileContentEvents: [
        "debug-output-smoke:first\n",
        "debug-output-smoke:second\n",
      ],
      outputPreviewIncludes: [
        "debug-output-smoke:first",
        "debug-output-smoke:second",
      ],
      rendererOutputEvidence: {
        panelSelector: "[data-codek-smoke=\"output-panel\"]",
        contentSelector: "[data-codek-smoke=\"output-content\"]",
        serviceSource: "outputLogTelemetryService",
        activeChannel: "Debug Output Bridge Smoke",
        previewIncludes: [
          "debug-output-smoke:first",
          "debug-output-smoke:second",
        ],
        visibleTextIncludes: [
          "debug-output-smoke:first",
          "debug-output-smoke:second",
        ],
      },
      outputServiceId: "outputService",
      outputStateSource: "outputLogTelemetryService",
      outputNoDoubleAppendEvidence: {
        contentEventCount: 2,
        contentEventContents: [
          "debug-output-smoke:first\\n",
          "debug-output-smoke:second\\n",
        ],
        expectedContentEventContents: [
          "debug-output-smoke:first\\n",
          "debug-output-smoke:second\\n",
        ],
        previewFirstCount: 1,
        previewSecondCount: 1,
        backingFileContentMatchesExpected: true,
        backingFileFirstCount: 1,
        backingFileSecondCount: 1,
        contentEventsMatchBackingFile: true,
        noDoubleAppend: true,
      },
      debugServiceId: "debugService",
      debugStateSource: "debugState",
      replInput: "debug-output-bridge-repl-smoke",
      evaluateResult: "Error: not connected",
      successReplInput: "debug-output-bridge-repl-smoke-success",
      successEvaluateResult: "debug-output-bridge-success-result",
      errorReplInput: "debug-output-bridge-repl-smoke-error",
      errorEvaluateResult: "Error: debug-output-bridge-error-result",
      replConsoleOutputEvidence: {
        stateSource: "debugState.consoleOutput",
        rendererOutputSource: "DebugPanel v-for debugState.consoleOutput.value",
        rendererSubmitPath: "DebugPanel.handleConsoleSubmit -> debugActions.sendInput -> DebugManager.evaluate",
        runningAppendOwner: "DebugManager.evaluate",
        debugActionsRunningDoubleAppend: false,
        inputSuccessErrorShareConsoleOutput: true,
        expectedSuccessEntries: [
          { type: "input", text: "debug-output-bridge-repl-smoke-success" },
          { type: "output", text: "debug-output-bridge-success-result" },
        ],
        expectedErrorEntries: [
          { type: "input", text: "debug-output-bridge-repl-smoke-error" },
          { type: "error", text: "Error: debug-output-bridge-error-result" },
        ],
      },
      noDoubleAppend: true,
      noSecondOutputOrDebugStateSource: true,
    },
  }
}

function buildOutputLogContract() {
  return {
    ok: false,
    smokeCase: "output-log",
    dryRun: shouldDryRun,
    blocked: shouldDryRun,
    blockedReason: shouldDryRun
      ? "dry-run only reports the registered Output/Log owner evidence contract; omit --dry-run to execute the real Electron smoke."
      : "",
    intendedMainHooks: [
      "MainThreadOutputService.$register(channel, backingFile)",
      "MainThreadOutputService.$update(channelId, Append|Clear, till)",
      "MainThreadOutputService.$reveal(channelId, preserveFocus=false)",
      "BrowserWindow.webContents.send('ext-host:output-*')",
    ],
    intendedRendererHooks: [
      "extensionHostRuntimeBridge ext-host:output-register",
      "extensionHostRuntimeBridge ext-host:output-content",
      "extensionHostRuntimeBridge ext-host:output-reveal",
      "globalCodekOutputService.getOutputSnapshot(channelLabel)",
      "globalOutputLogTelemetryService.getOwnerEvidence(channelLabel)",
      "OutputPanel data-output-* smoke metadata",
    ],
    expectedEvidence: {
      outputRegisterEvent: "ext-host:output-register",
      outputContentEvent: "ext-host:output-content",
      outputClearEvent: "ext-host:output-content mode=Clear",
      outputServiceId: "outputService",
      outputStateSource: "outputLogTelemetryService",
      outputOwner: "outputLogTelemetryService",
      mainThreadOwner: "MainThreadOutputService",
      rendererOwner: "OutputPanel",
      uiOwnerState: "partial",
      evidenceState: "partial",
      remainingGap: "Full VS Code Output view ownership requires App.vue/bottom-panel shell wiring; this smoke does not touch it.",
      nextAuthorizedFiles: [
        "frontend/vite-project/src/components/OutputPanel.vue",
        "frontend/vite-project/src/workbench/outputLogTelemetryService.ts",
        "desktop/services/extensions-host/mainThread/mainThreadOutputService.js",
        "scripts/electron-ui-smoke.js",
      ],
      noSecondOutputStateSource: true,
      rawOutputPayloadRedactedFromOwnerEvidence: true,
      partialUiOwnerNotConnected: true,
    },
    vscodeSourceReferences: [
      "src/vs/workbench/services/output/common/output.ts",
      "src/vs/workbench/services/output/common/delayedLogChannel.ts",
      "src/vs/workbench/api/browser/mainThreadOutputService.ts",
      "src/vs/workbench/api/common/extHostOutput.ts",
    ],
  }
}

function buildDebugSessionContract() {
  return {
    ok: false,
    smokeCase: "debug-session",
    dryRun: shouldDryRun,
    blocked: shouldDryRun,
    blockedReason: shouldDryRun
      ? "dry-run only reports the registered Debug DAP session contract; omit --dry-run to execute the real Electron smoke."
      : "",
    intendedMainHooks: [
      "desktop/main.js prepares an isolated Electron smoke workspace with .vscode/launch.json",
      "DebugPanel select.config-select chooses the smoke Node launch configuration",
      "DebugPanel toolbar start button invokes DebugManager.startSession",
      "window.codek.dap.start / dap:send / dap:event / dap:stop bridge real DAP traffic",
    ],
    expectedEvidence: {
      smokeCase: "debug-session",
      sessionObserved: true,
      dapMetadataOnly: true,
      adapterType: "node",
      sessionIdPrefix: "dap-",
      debugStateSource: "debugState",
      bridgeEvidenceSource: "MainThreadDebugService.dapIpcBridge",
      redaction: {
        noExpressionText: true,
        noSourcePathText: true,
        noAdapterArgsText: true,
      },
      debugViewContainerOwner: {
        status: "partial",
        connected: false,
        reason: "This smoke observes DebugPanel/debugState through the current Electron window but does not claim the full VS Code Debug View Container owner.",
      },
    },
  }
}

function buildTestingPublishResultsContract() {
  return {
    ok: false,
    smokeCase: "testing-publish-results",
    dryRun: shouldDryRun,
    blocked: false,
    blockedReason: "",
    intendedMainHooks: [
      "desktop/main.js CODEK_ELECTRON_SMOKE_TESTING_PUBLISH_RESULTS dispatcher",
      "desktop/main.js exerciseElectronSmokeTestingPublishResults calls App.vue smoke hook",
      "desktop/preload.js publishExtHostTestingResults -> ipcRenderer.invoke('ext-host:testing-publish-results')",
      "desktop/services/extensions-host/mainThread/mainThreadTesting.js ipcMain.handle('ext-host:testing-publish-results')",
      "ExtHostTesting.$publishTestResults receives completed TestingService result snapshots",
    ],
    intendedRendererHooks: [
      "TestingService.completeRun() serializes PublishedTestResultSnapshot from the single TestingService state source",
      "extensionHostRuntimeBridge.publishTestResults() calls window.codek.publishExtHostTestingResults({ results })",
      "App.vue __codekSmokeWorkbenchControls.runTestingPublishResultsSmoke(input)",
      "Agent Evidence testing surface [data-agent-evidence-surface='testing'] and [data-codek-smoke='testing-result-peek-visible-owner']",
      "App.vue Test Results ViewPane shell [data-codek-smoke='testing-results-viewpane-shell-owner']",
      "App.vue Testing Explorer DOM hook renders TestingService.getTestingExplorerContractProjection().domOwnerAdapter shell/filter/tree rows without a second Testing state source",
    ],
    expectedEvidence: {
      stateSource: "TestingService",
      publishSource: "TestingService.completeRun()",
      preloadApi: "publishExtHostTestingResults",
      desktopChannel: "ext-host:testing-publish-results",
      extHostMethod: "$publishTestResults",
      resultPeekSelector: '[data-codek-smoke="testing-result-peek-visible-owner"]',
      resultsViewPaneShellSelector: '[data-codek-smoke="testing-results-viewpane-shell-owner"]',
      testingExplorerViewPaneShellSelector: '[data-codek-smoke="testing-explorer-viewpane-shell-owner"]',
      testingExplorerObjectTreeSelector: '[data-testing-explorer-object-tree="true"]',
      testingExplorerFilterInputSelector: '[data-testing-explorer-filter-input="true"]',
      testingExplorerStateSource: "TestingService.getTestingExplorerContractProjection()",
      testingExplorerOwnerEvidence: {
        viewPaneContainer: "partial-dom-shell-only",
        workbenchObjectTree: "partial-row-projection-only",
        storageService: "partial-external-persisted-state-only",
        menuIds: ["MenuId.TestItem", "MenuId.ViewTitle"],
        fullOwnerClaimed: false,
      },
      vscodeOwnerSourceComparison: {
        testingExplorerView: {
          vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
          vscodeOwner: "TestingExplorerView extends ViewPane and creates TestingExplorerViewModel over .test-explorer-tree",
          codekStatus: "partial-dom-shell-only",
          blockedOwner: "ViewPane renderBody/layoutBody/focus owner",
        },
        testingViewPaneContainer: {
          vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testingViewPaneContainer.ts",
          vscodeOwner: "TestingViewPaneContainer extends ViewPaneContainer",
          codekStatus: "blocked",
          blockedOwner: "generic workbench sidebar container lifecycle",
        },
        workbenchObjectTree: {
          vscodeSourcePath: "src/vs/platform/list/browser/listService.ts",
          vscodeOwner: "WorkbenchObjectTree DOM virtualization, keyboard navigation, and accessibility provider",
          codekStatus: "partial-row-projection-only",
          blockedOwner: "TestingObjectTree extends WorkbenchObjectTree DOM/keyboard/lifecycle owner",
        },
        testResultsViewContent: {
          vscodeSourcePath: "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts",
          vscodeOwner: "TestResultsViewContent SplitView plus TestResultsTree/followup widget lifecycle",
          codekStatus: "partial-viewpane-shell-rows-only",
          blockedOwner: "TestResultsViewContent DOM tree, LiveTestResult listeners, and FollowupActionWidget owner",
        },
      },
      minimalExecutableUiOwners: {
        testingExplorerViewPaneShell: "App.vue data-codek-smoke=\"testing-explorer-viewpane-shell-owner\"",
        testingExplorerObjectTreeRows: "App.vue data-testing-explorer-object-tree rows from TestingService.getTestingExplorerContractProjection()",
        testingExplorerFilterInput: "App.vue readonly data-testing-explorer-filter-input hook from TestingService filter projection",
        testResultsViewPaneShell: "App.vue data-codek-smoke=\"testing-results-viewpane-shell-owner\" rows from TestingService.getTestResultsViewPaneShellProjection()",
        testResultsViewContentFullOwnerClaimed: false,
      },
      agentEvidenceTestingSelector: '[data-agent-evidence-surface="testing"]',
      noSecondTestingStateSource: true,
      fullViewPaneOwnerClaimed: false,
    },
    connectedOwners: [
      "TestingService.completeRun result serialization",
      "extensionHostRuntimeBridge publishTestResults callback",
      "desktop/preload.js publishExtHostTestingResults IPC exposure",
      "desktop mainThreadTesting ext-host:testing-publish-results handler",
      "desktop/main.js CODEK_ELECTRON_SMOKE_TESTING_PUBLISH_RESULTS dispatcher",
    ],
    partialOwners: [
      "App.vue renderer smoke hook can project TestingService evidence into Agent Evidence testing DOM.",
      "App.vue Test Results ViewPane shell renders read-only TestingService result history rows while full VS Code TestResultsViewContent/TestResultsTree remains blocked.",
      "App.vue Testing Explorer DOM/filter shell hook renders row/filter/action selectors from the same TestingService rows, while the real ViewPane/ObjectTree DOM owner remains blocked.",
      "TestingService.getTestingExplorerContractProjection() records ViewPaneContainer, WorkbenchObjectTree, IStorageService/StoredValue, and MenuId.TestItem/ViewTitle owner evidence as partial projection plus explicit blocked owners.",
    ],
    blockedOwners: [
      "VS Code TestingExplorerView ViewPane owner",
      "VS Code TestingViewPaneContainer owner",
      "VS Code WorkbenchObjectTree DOM virtualization owner",
      "VS Code TestingExplorerFilter input/history owner",
      "VS Code MenuId.TestItem/ViewTitle action runner owner",
      "VS Code IStorageService Testing Explorer persistence owner",
      "VS Code TestResultsViewContent/TestResultsTree DOM owner",
    ],
    vscodeSourceReferences: [
      "src/vs/workbench/contrib/testing/browser/testingExplorerView.ts",
      "src/vs/workbench/contrib/testing/browser/explorerProjections/testingObjectTree.ts",
      "src/vs/workbench/contrib/testing/browser/testingExplorerFilter.ts",
      "src/vs/workbench/contrib/testing/common/testExplorerFilterState.ts",
      "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts",
      "src/vs/workbench/contrib/testing/browser/testResultsView/testResultsTree.ts",
      "src/vs/workbench/contrib/testing/browser/testingViewPaneContainer.ts",
      "src/vs/workbench/api/browser/mainThreadTesting.ts",
    ],
  }
}

function buildNotificationActionsClickContract() {
  return {
    ok: false,
    smokeCase: "notification-actions-click",
    dryRun: shouldDryRun,
    blocked: false,
    blockedReason: "",
    intendedMainHooks: [
      "MainThreadProgress.$startProgress(handle, options, extensionId)",
      "BrowserWindow.webContents.send('ext-host:progress-start')",
      "ipcMain.on('ext-host:progress-cancel')",
      "ExtHostProgress.$acceptProgressCanceled(handle)",
    ],
    intendedRendererHooks: [
      "extensionHostRuntimeBridge onExtHostProgressStart",
      "NotificationToast [data-notification-action-id=\"progress.button.0\"]",
      "NotificationToast [data-notification-action-id=\"workbench.extensions.manage\"]",
      "NotificationToast [data-notification-action-id=\"progress.cancel\"]",
      "NotificationToast [data-notification-service-source=\"workbenchStatusNotificationProgressService\"]",
      "NotificationToast [data-notification-action-owner=\"workbenchStatusNotificationProgressService.invokeNotificationAction\"]",
      "commandRegistry.executeCommand('workbench.extensions.manage')",
    ],
    expectedEvidence: {
      progressActionIds: ["progress.button.0", "workbench.extensions.manage", "progress.cancel"],
      primaryClickDispatches: true,
      primaryBackChannelChoice: 0,
      secondaryCommandId: "workbench.extensions.manage",
      secondaryCommandRegisteredBeforeClick: true,
      secondaryCommandInvocationCount: ">= 1",
      secondaryKeptOpen: true,
      cancelTokenObserved: true,
      cancelBackChannelChoice: undefined,
      separateCancelHandle: true,
      notificationOwner: "NotificationToast",
      actionOwner: "workbenchStatusNotificationProgressService.invokeNotificationAction",
      noSecondNotificationStateSource: true,
    },
  }
}

function buildIconThemeRefreshContract() {
  return {
    ok: false,
    smokeCase: "icon-theme-refresh",
    dryRun: shouldDryRun,
    blocked: false,
    blockedReason: "",
    intendedRendererHooks: [
      "workbenchThemeService.getFileIconTheme()",
      "workbenchThemeService.onDidFileIconThemeChange(listener)",
      "workbenchThemeService.setFileIconTheme('minimal')",
      ".file-icon-svg[data-file-icon-theme-id][data-file-icon-source]",
      ".codek-explorer-icon[data-file-icon-theme-id][data-file-icon-source]",
    ],
    expectedEvidence: {
      themeServiceId: "workbenchThemeService",
      eventSource: "IWorkbenchThemeService.onDidFileIconThemeChange",
      initialThemeId: "vs-seti",
      changedThemeId: "minimal",
      fileIconDataEvidence: "data-file-icon-theme-id",
      explorerIconDataEvidence: "data-file-icon-source",
      noStaticIconMapFallback: true,
      noSecondFileIconThemeStateSource: true,
    },
    vscodeSourceReferences: [
      "src/vs/workbench/services/themes/common/workbenchThemeService.ts",
      "src/vs/workbench/services/themes/browser/fileIconThemeData.ts",
      "src/vs/workbench/contrib/files/browser/views/explorerViewer.ts",
    ],
  }
}

function buildExtensionInstallConfirmationContract() {
  return {
    ok: true,
    smokeCase: "extension-install-confirmation",
    dryRun: shouldDryRun,
    blocked: false,
    blockedReason: "",
    intendedRendererHooks: [
      "App.vue __codekSmokeWorkbenchControls.runExtensionInstallConfirmationSmoke(input)",
      "CodekDialogService modal exposes data-dialog-source=\"ExtensionInstallConfirmationSmoke\"",
      "Marketplace.handleInstall(ext) calls extensionWorkbenchService.open(ext.id, ext.version) before install",
      "ExtensionDetails exposes data-extension-gallery-detail-requires-confirmation from detailSummary",
      "extensionWorkbenchService.install(ext.id, ext.version) resolves confirmed from detailSummary.requiresConfirmation",
      "ExtensionDetails.handleRollback calls extensionWorkbenchService.rollback(extensionId)",
      "data-extension-gallery-no-second-state=\"true\"",
    ],
    intendedMainHooks: [
      "POST /extensions-host/marketplace/install receives confirmed from ehClient.installExtension",
      "POST /extensions-host/install-vsix receives confirmed from ehClient.installVsix caller",
      "POST /extensions-host/rollback calls extMgr.rollbackExtension",
      "scripts/extension-install-smoke.js fixture install/update/rollback/uninstall",
    ],
    expectedEvidence: {
      serviceId: "extensionsWorkbenchService",
      confirmationSource: "ExtensionWorkbenchDetailSummary.requiresConfirmation",
      marketplaceInstallConfirmationSource: "extensionsWorkbenchService.resolveInstallConfirmation",
      dialogSource: "ExtensionInstallConfirmationSmoke",
      dialogCommandId: "workbench.extensions.install",
      vsixRouteConfirmationSource: "body.confirmed === true",
      rollbackSource: "extensionsWorkbenchService.rollback -> /extensions-host/rollback",
      fixtureLifecycleSmoke: "scripts/extension-install-smoke.js",
      noDefaultConfirmedTrue: true,
      noSecondInstallStateSource: true,
      rendererOwner: "App.vue __codekSmokeWorkbenchControls.runExtensionInstallConfirmationSmoke",
      realElectronOwner: "App.vue __codekSmokeWorkbenchControls.runExtensionInstallConfirmationSmoke",
    },
    vscodeSourceReferences: [
      "src/vs/workbench/contrib/extensions/browser/extensionsActions.ts",
      "src/vs/workbench/contrib/extensions/browser/extensionsWorkbenchService.ts",
      "src/vs/platform/extensionManagement/common/abstractExtensionManagementService.ts",
      "src/vs/platform/extensionManagement/node/extensionManagementService.ts",
    ],
  }
}

function getActiveSmokeCase() {
  return shouldRunRealProjectUi
    ? "real-project-ui"
    : shouldRunNotificationActionsClick
      ? "notification-actions-click"
    : shouldRunTaskProviderExecute
      ? "task-provider-execute"
    : shouldRunTaskProviderBackgroundOwner
      ? "task-provider-background-owner"
    : shouldRunDebugOutputBridge
      ? "debug-output-bridge"
    : shouldRunOutputLog
      ? "output-log"
    : shouldRunDebugSession
      ? "debug-session"
    : shouldRunTestingPublishResults
      ? "testing-publish-results"
    : shouldRunWorkspaceTrustDowngradeRestart
      ? "workspace-trust-downgrade-restart"
    : shouldRunWorkspaceTrustRequestDialog
      ? "workspace-trust-request-dialog"
    : shouldRunExtensionInstallConfirmation
      ? "extension-install-confirmation"
    : shouldRunExtensionHostRestart
      ? "extension-host-restart"
    : shouldRunDevServerFallback
      ? "startup-dev-server-fallback"
      : shouldRunExplorerPerformance
      ? "explorer-performance"
      : shouldRunRealExplorer
        ? "real-explorer"
        : shouldRunExplorerStress
          ? "explorer-stress"
          : shouldRunWorkingCopyHotExit
            ? "working-copy-hot-exit"
            : shouldRunFileOperationVisibility
              ? "file-operation-visibility"
              : shouldRunSearchNavigation
              ? "search-navigation"
              : shouldRunArtifactOpen
                ? "artifact-open"
                : shouldRunSearchReplace
                  ? "search-replace"
                  : shouldRunEditorOpenFiles
                    ? "editor-open-files"
                    : shouldRunNotebookMarkdownPreview
                      ? "notebook-markdown-preview"
                      : shouldRunAccessibleViewVisibleOwner
                        ? "accessible-view-visible-owner"
                      : shouldRunTabOverflow
                        ? "tab-overflow"
                        : shouldRunIconThemeRefresh
                          ? "icon-theme-refresh"
                          : shouldRunIconVisualState
                            ? "icon-visual-state"
                            : shouldRunInlineCreateFocus
                              ? "inline-create-focus"
                              : shouldRunCreateTargetAccuracy
                                ? "create-target-accuracy"
                                : shouldRunMultiRootCreateTarget
                                  ? "multiroot-create-target"
                                  : shouldRunAnalysisWorkspace
                                    ? "analysis-workspace"
                                    : "startup"
}

function buildSmokeConsolidation(payload) {
  const checks = Array.isArray(payload?.checks) ? payload.checks : []
  const failedChecks = checks.filter((check) => check?.passed !== true)
  const blockingDiagnostics = collectBackupCleanupDiagnostics(payload).blocking
  const blocked = payload?.blocked === true || Boolean(payload?.blockedReason) || failedChecks.length > 0 || payload?.ok === false || blockingDiagnostics.length > 0
  const mode = payload?.dryRun === true || shouldDryRun ? "dry-run-contract" : "real-electron"
  const status = blocked ? "blocked" : (mode === "real-electron" ? "connected" : "partial")
  return {
    status,
    mode,
    smokeCase: payload?.smokeCase || getActiveSmokeCase(),
    ok: payload?.ok === true && !blocked,
    blocked,
    blockedReason: payload?.blockedReason || "",
    checkCount: checks.length,
    passedCount: checks.length - failedChecks.length,
    failedCount: failedChecks.length,
    resultFile: smokeResultFile,
    source: "scripts/electron-ui-smoke.js",
  }
}

function withSmokeConsolidation(payload) {
  const backupCleanupDiagnostics = collectBackupCleanupDiagnostics(payload)
  return {
    ...payload,
    nonBlockingDiagnostics: {
      ...(payload?.nonBlockingDiagnostics || {}),
      backupCleanup: backupCleanupDiagnostics.nonBlocking,
    },
    blockingDiagnostics: {
      ...(payload?.blockingDiagnostics || {}),
      backupCleanup: backupCleanupDiagnostics.blocking,
    },
    smokeConsolidation: buildSmokeConsolidation(payload),
  }
}

function collectBackupCleanupDiagnostics(payload) {
  const stages = Array.isArray(payload?.stages) ? payload.stages : []
  const seen = new Set()
  const diagnostics = stages
    .filter((entry) => entry?.stage === "working-copy-backup:diagnostic" || entry?.stage === "working-copy-backup:error")
    .filter((entry) => {
      const key = JSON.stringify([entry.stage, entry.at || "", entry.detail || {}])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((entry) => ({
      stage: entry.stage,
      operation: entry.detail?.operation || "",
      resource: entry.detail?.resource || null,
      severity: entry.detail?.severity || (entry.stage === "working-copy-backup:error" ? "error" : "nonBlocking"),
      reason: entry.detail?.reason || "",
      ignored: entry.detail?.ignored === true,
      nonBlocking: entry.detail?.nonBlocking === true || entry.detail?.severity === "nonBlocking",
      error: entry.detail?.error || "",
      at: entry.at || null,
    }))
  return {
    nonBlocking: diagnostics.filter((entry) => entry.nonBlocking && entry.reason === "backupMissing"),
    blocking: diagnostics.filter((entry) => !entry.nonBlocking),
  }
}

function writeSmokeResult(payload) {
  const normalized = withSmokeConsolidation(payload)
  fs.mkdirSync(path.dirname(smokeResultFile), { recursive: true })
  fs.writeFileSync(smokeResultFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  return normalized
}

if (shouldRunNotificationActionsClick && shouldDryRun) {
  const payload = {
    ...buildNotificationActionsClickContract(),
    ok: true,
    checks: [{
      name: "notification actions click smoke case is registered as runnable contract",
      passed: true,
      detail: "dry-run only reports the registered Notification progress action contract; omit --dry-run to execute the real Electron smoke.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunIconThemeRefresh && shouldDryRun) {
  const payload = {
    ...buildIconThemeRefreshContract(),
    ok: true,
    checks: [{
      name: "file icon theme refresh smoke case is registered as workbench theme service contract",
      passed: true,
      detail: "dry-run reports the FileIcon/FileTree icon theme refresh contract; omit --dry-run to execute the broader Electron icon visual smoke path.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunDebugOutputBridge && shouldDryRun) {
  const payload = {
    ...buildDebugOutputBridgeContract(),
    ok: true,
    checks: [{
      name: "debug/output bridge smoke case is registered as runnable contract",
      passed: true,
      detail: "dry-run only reports the registered Debug/Output bridge contract; omit --dry-run to execute the real Electron smoke.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunOutputLog && shouldDryRun) {
  const payload = {
    ...buildOutputLogContract(),
    ok: true,
    checks: [{
      name: "output/log owner evidence smoke case is registered as runnable contract",
      passed: true,
      detail: "dry-run only reports the registered Output/Log owner evidence contract; omit --dry-run to execute the real Electron smoke.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunDebugSession && shouldDryRun) {
  const payload = {
    ...buildDebugSessionContract(),
    ok: true,
    checks: [{
      name: "debug session smoke case is registered as runnable metadata-only contract",
      passed: true,
      detail: "dry-run only reports the registered Debug DAP session contract; omit --dry-run to execute the real Electron smoke.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunTestingPublishResults && shouldDryRun) {
  const payload = {
    ...buildTestingPublishResultsContract(),
    ok: true,
    checks: [{
      name: "testing publish results smoke case is registered as renderer/preload/desktop contract",
      passed: true,
      detail: "dry-run records the TestingService -> extensionHostRuntimeBridge -> preload -> desktop mainThreadTesting -> ExtHostTesting.$publishTestResults path and keeps full ViewPane owner blocked.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunWorkspaceTrustDowngradeRestart && shouldDryRun) {
  const payload = {
    ...buildWorkspaceTrustDowngradeRestartContract(),
    ok: true,
    checks: [{
      name: "workspace trust downgrade/restart smoke case is registered as blocked contract",
      passed: true,
      detail: "dry-run only reports the registered WorkspaceTrust downgrade/restart contract; omit --dry-run to execute the real Electron smoke.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunWorkspaceTrustRequestDialog && shouldDryRun) {
  const payload = {
    ...buildWorkspaceTrustRequestDialogContract(),
    ok: true,
    checks: [{
      name: "workspace trust request dialog smoke case is registered as runnable contract",
      passed: true,
      detail: "dry-run only reports the registered WorkspaceTrust request dialog contract; omit --dry-run to execute the real Electron smoke.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunWorkspaceTrustEditor && shouldDryRun) {
  const payload = {
    ...buildWorkspaceTrustEditorContract(),
    ok: true,
    checks: [{
      name: "workspace trust editor smoke case is registered as runnable contract",
      passed: true,
      detail: "dry-run only reports the registered WorkspaceTrustEditor DOM/focus/keyboard contract; omit --dry-run to execute the real Electron smoke.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunSearchNavigation && shouldDryRun) {
  const payload = {
    ...buildSearchNavigationContract(),
    ok: true,
    checks: [{
      name: "search navigation smoke case is registered as result-tree contract",
      passed: true,
      detail: "dry-run only reports the SearchPanel text-search/resultTree contract; omit --dry-run to execute the real Electron smoke.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunSearchReplace && shouldDryRun) {
  const payload = {
    ...buildSearchReplaceContract(),
    ok: true,
    checks: [{
      name: "search replace smoke case is registered as result-tree replace contract",
      passed: true,
      detail: "dry-run only reports the SearchPanel replace preview/apply contract; omit --dry-run to execute the real Electron smoke.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunEditorOpenFiles && shouldDryRun) {
  const payload = {
    ...buildEditorOpenFilesContract(),
    ok: true,
    checks: [{
      name: "editor openFiles smoke case is registered as service-backed open editors contract",
      passed: true,
      detail: "dry-run only reports the EditorGroups/openFiles service-backed contract; omit --dry-run to execute the real Electron smoke.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunNotebookMarkdownPreview && shouldDryRun) {
  const payload = {
    ...buildNotebookMarkdownPreviewContract(),
    ok: true,
    checks: [{
      name: "notebook markdown preview smoke case is registered as runnable renderer-message contract",
      passed: true,
      detail: "dry-run records the App.vue generic smoke owner and service-backed Notebook markdown preview contract; omit --dry-run to execute the real Electron smoke.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunAccessibleViewVisibleOwner && shouldDryRun) {
  const payload = {
    ...buildAccessibleViewVisibleOwnerContract(),
    ok: true,
    checks: [{
      name: "accessible view visible owner smoke case is registered as App DOM shell contract",
      passed: true,
      detail: "dry-run records the App.vue visible DOM shell owner and keeps VS Code CodeEditorWidget/context-view/toolbar/quick-pick/focus owners blocked; omit --dry-run after wiring the Electron harness to execute the real smoke.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunExtensionInstallConfirmation && shouldDryRun) {
  const payload = {
    ...buildExtensionInstallConfirmationContract(),
    ok: true,
    checks: [{
      name: "extension install/VSIX confirmation smoke is registered as runnable dialog contract",
      passed: true,
      detail: "dry-run records the App.vue generic dialog owner plus service-backed confirmation and rollback contract; omit --dry-run to execute the real Electron smoke.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunExtensionHostRestart && shouldDryRun) {
  const payload = {
    ...buildExtensionHostRestartContract(),
    ok: true,
    checks: [{
      name: "extension host restart smoke case is registered as route/runtime contract",
      passed: true,
      detail: "dry-run records the restart route contract and points real process validation to scripts/extension-host-restart-smoke.js.",
    }],
  }
  const normalized = writeSmokeResult(payload)
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`)
  process.exit(0)
}

if (shouldRunExtensionInstallConfirmation) {
  // Continue into the Electron runner; App.vue owns the renderer-side dialog click smoke.
}

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return []

  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

function assertElectronFrontendDistIsCurrent() {
  if (shouldUsePackaged) return
  if (!fs.existsSync(desktopDistIndex)) {
    fail("desktop/frontend-dist/index.html is missing. Run npm run build:frontend to sync the Electron frontend.")
  }
  const indexHtml = fs.readFileSync(desktopDistIndex, "utf8")
  const hasExtensionFontCsp = indexHtml.includes("font-src 'self' data: codek-extension-resource:")
  const hasExtensionImageCsp = indexHtml.includes("img-src 'self' data: blob: file: codek-extension-resource:")
  if (!hasExtensionFontCsp || !hasExtensionImageCsp) {
    fail("desktop/frontend-dist 的 CSP 未允许 VS Code 图标主题资源，请运行 npm run build:frontend 重新同步 Electron 前端产物。")
  }

  const forbiddenPatterns = [
    /DebugPanel/,
    /debugVisible/,
    /setDebugVisible/,
    /toggleDebugConsole/,
    /openDebugConfig/,
    /addDebugConfig/,
    /toggleRunView/,
  ]

  const files = listFilesRecursive(desktopDistDir).filter((item) => /\.(html|js|css)$/i.test(item))
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8")
    const match = forbiddenPatterns.find((pattern) => pattern.test(content))
    if (match) {
      fail(`desktop/frontend-dist contains stale removed UI (${match.source}) in ${path.relative(root, file)}. Run npm run build:frontend.`)
    }
  }

  try {
    assertFrontendDistConsistency({ root })
  } catch (error) {
    fail(`${error.message}\nRun npm run build:frontend to regenerate and synchronize Electron frontend assets.`)
  }
}

if (!shouldUsePackaged && !fs.existsSync(distIndex)) {
  fail("frontend/vite-project/dist/index.html 不存在，请先运行 npm run build:frontend。")
}

assertElectronFrontendDistIsCurrent()

if (shouldUsePackaged && process.platform !== "win32") {
  fail("--packaged smoke currently expects desktop/release/win-unpacked/Codek.exe.")
}

const launchBin = shouldUsePackaged ? packagedExe : electronBin
const userDataBaseDir = shouldUsePackaged ? packagedUserDataBaseDir : smokeUserDataBaseDir
fs.mkdirSync(userDataBaseDir, { recursive: true })
const smokeUserDataDir = fs.mkdtempSync(path.join(userDataBaseDir, "run-"))
const gpuStabilityArgs = shouldRunIconVisualState || shouldRunRealProjectUi
  ? []
  : [
      "--disable-gpu",
      "--disable-gpu-sandbox",
      "--disable-gpu-compositing",
      "--in-process-gpu",
    ]
const launchArgs = shouldUsePackaged
  ? [
      `--user-data-dir=${smokeUserDataDir}`,
      ...gpuStabilityArgs,
    ]
  : [
      `--user-data-dir=${smokeUserDataDir}`,
      ...gpuStabilityArgs,
      ".",
    ]
const launchCwd = shouldUsePackaged ? path.dirname(packagedExe) : desktopDir

if (!fs.existsSync(launchBin)) {
  fail("desktop/node_modules/.bin/electron 不存在，请先安装 desktop 依赖。")
}

const env = {
  ...process.env,
  CODEK_ELECTRON_SMOKE: "1",
  CODEK_ELECTRON_SMOKE_STARTUP_ONLY: shouldRunStartupOnly ? "1" : "",
  CODEK_ELECTRON_SMOKE_LOGIN_WORKBENCH: shouldLoginWorkbench || shouldRunFocusedWorkbenchSmoke ? "1" : "",
  CODEK_ELECTRON_SMOKE_ANALYSIS_WORKSPACE: shouldRunAnalysisWorkspace ? "1" : "",
  CODEK_ELECTRON_SMOKE_EXPLORER_PERFORMANCE: shouldRunExplorerPerformance ? "1" : "",
  CODEK_ELECTRON_SMOKE_REAL_EXPLORER: shouldRunRealExplorer ? "1" : "",
  CODEK_ELECTRON_SMOKE_EXPLORER_STRESS: shouldRunExplorerStress ? "1" : "",
  CODEK_ELECTRON_SMOKE_FILE_OPERATION_VISIBILITY: shouldRunFileOperationVisibility ? "1" : "",
  CODEK_ELECTRON_SMOKE_SEARCH_REPLACE: shouldRunSearchReplace ? "1" : "",
  CODEK_ELECTRON_SMOKE_EDITOR_OPEN_FILES: shouldRunEditorOpenFiles ? "1" : "",
  CODEK_ELECTRON_SMOKE_NOTEBOOK_MARKDOWN_PREVIEW: shouldRunNotebookMarkdownPreview ? "1" : "",
  CODEK_ELECTRON_SMOKE_ACCESSIBLE_VIEW_VISIBLE_OWNER: shouldRunAccessibleViewVisibleOwner ? "1" : "",
  CODEK_ELECTRON_SMOKE_MULTIROOT_CREATE_TARGET: shouldRunMultiRootCreateTarget || shouldRunCreateTargetAccuracy ? "1" : "",
  CODEK_ELECTRON_SMOKE_CREATE_TARGET_ACCURACY: shouldRunCreateTargetAccuracy ? "1" : "",
  CODEK_ELECTRON_SMOKE_INLINE_CREATE_FOCUS: shouldRunInlineCreateFocus ? "1" : "",
  CODEK_ELECTRON_SMOKE_SEARCH_NAVIGATION: shouldRunSearchNavigation ? "1" : "",
  CODEK_ELECTRON_SMOKE_ARTIFACT_OPEN: shouldRunArtifactOpen ? "1" : "",
  CODEK_ELECTRON_SMOKE_TAB_OVERFLOW: shouldRunTabOverflow ? "1" : "",
  CODEK_ELECTRON_SMOKE_ICON_THEME_REFRESH: shouldRunIconThemeRefresh ? "1" : "",
  CODEK_ELECTRON_SMOKE_ICON_VISUAL_STATE: shouldRunIconVisualState ? "1" : "",
  CODEK_ELECTRON_SMOKE_REAL_PROJECT_UI: shouldRunRealProjectUi ? "1" : "",
  CODEK_ELECTRON_SMOKE_WORKBENCH_UI_AUDIT: shouldRunWorkbenchUiAudit ? "1" : "",
  CODEK_ELECTRON_SMOKE_NOTIFICATION_ACTIONS_CLICK: shouldRunNotificationActionsClick ? "1" : "",
  CODEK_ELECTRON_SMOKE_TASK_PROVIDER_EXECUTE: shouldRunTaskProviderExecute ? "1" : "",
  CODEK_ELECTRON_SMOKE_TASK_PROVIDER_BACKGROUND_OWNER: shouldRunTaskProviderBackgroundOwner ? "1" : "",
  CODEK_ELECTRON_SMOKE_DEBUG_OUTPUT_BRIDGE: shouldRunDebugOutputBridge ? "1" : "",
  CODEK_ELECTRON_SMOKE_OUTPUT_LOG: shouldRunOutputLog ? "1" : "",
  CODEK_ELECTRON_SMOKE_DEBUG_SESSION: shouldRunDebugSession ? "1" : "",
  CODEK_ELECTRON_SMOKE_TESTING_PUBLISH_RESULTS: shouldRunTestingPublishResults ? "1" : "",
  CODEK_ELECTRON_SMOKE_WORKSPACE_TRUST_DOWNGRADE_RESTART: shouldRunWorkspaceTrustDowngradeRestart ? "1" : "",
  CODEK_ELECTRON_SMOKE_WORKSPACE_TRUST_REQUEST_DIALOG: shouldRunWorkspaceTrustRequestDialog ? "1" : "",
  CODEK_ELECTRON_SMOKE_WORKSPACE_TRUST_EDITOR: shouldRunWorkspaceTrustEditor ? "1" : "",
  CODEK_ELECTRON_SMOKE_EXTENSION_INSTALL_CONFIRMATION: shouldRunExtensionInstallConfirmation ? "1" : "",
  CODEK_ELECTRON_SMOKE_EXTENSION_HOST_RESTART: shouldRunExtensionHostRestart ? "1" : "",
  CODEK_ELECTRON_SMOKE_WORKING_COPY_HOT_EXIT: shouldRunWorkingCopyHotExit ? "1" : "",
  CODEK_ELECTRON_SMOKE_DEV_SERVER_FALLBACK: shouldRunDevServerFallback ? "1" : "",
  CODEK_USE_DEV_SERVER: shouldRunDevServerFallback ? "1" : process.env.CODEK_USE_DEV_SERVER,
  CODEK_DEV_SERVER_URL: shouldRunDevServerFallback ? "http://127.0.0.1:59997" : process.env.CODEK_DEV_SERVER_URL,
  CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT: process.env.CODEK_ELECTRON_SMOKE_REAL_PROJECT_ROOT || root,
  CODEK_ELECTRON_SMOKE_TIMEOUT_MS: process.env.CODEK_ELECTRON_SMOKE_TIMEOUT_MS || defaultSmokeTimeoutMs,
  CODEK_ELECTRON_SMOKE_RESULT_FILE: smokeResultFile,
  CODEK_ELECTRON_SMOKE_WIDTH: smokeViewport[0] ? String(smokeViewport[0]) : process.env.CODEK_ELECTRON_SMOKE_WIDTH,
  CODEK_ELECTRON_SMOKE_HEIGHT: smokeViewport[1] ? String(smokeViewport[1]) : process.env.CODEK_ELECTRON_SMOKE_HEIGHT,
  CODEK_DATA: path.join(root, ".codek"),
  CODEK_DATA_DIR: path.join(root, ".codek"),
}

function cleanupUserDataDir() {
  try {
    fs.rmSync(smokeUserDataDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup failures; Windows can keep cache files briefly locked.
  }
}

function assertDevServerFallbackSmokePassed() {
  if (!shouldRunDevServerFallback) return
  if (!fs.existsSync(smokeResultFile)) {
    fail("Dev-server fallback smoke did not write a result file.")
  }
  const result = JSON.parse(fs.readFileSync(smokeResultFile, "utf8"))
  const stages = Array.isArray(result.stages) ? result.stages : []
  const devServerFailed = stages.some((entry) => entry.stage === "load-frontend-dev-server-failed")
  const completedWithDevServer = stages.some(
    (entry) => entry.stage === "load-frontend-complete"
      && entry.detail?.fallback === false
      && String(entry.detail?.loadedPath || "").startsWith("http"),
  )
  if (shouldRunExtensionInstallConfirmation && result.ok === true && completedWithDevServer) {
    return
  }
  const completedWithFallback = stages.some(
    (entry) => entry.stage === "load-frontend-complete" && entry.detail?.fallback === true,
  )
  if (!devServerFailed || !completedWithFallback) {
    fail("Dev-server fallback smoke did not prove fallback loading.")
  }
}

const child = spawn(launchBin, launchArgs, {
  cwd: launchCwd,
  env,
  shell: process.platform === "win32" && launchBin.endsWith(".cmd"),
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
})

let output = ""
let stdoutClosed = false
const ignoredNodePtyAttachConsoleNoise = []

process.stdout.on("error", (error) => {
  if (error?.code === "EPIPE") {
    stdoutClosed = true
    return
  }
  throw error
})

function safeWriteStdout(text) {
  if (stdoutClosed) return
  try {
    process.stdout.write(text)
  } catch (error) {
    if (error?.code === "EPIPE") {
      stdoutClosed = true
      return
    }
    throw error
  }
}

function isNodePtyAttachConsoleNoise(text) {
  return /node_modules[\\/]+node-pty[\\/]+lib[\\/]+conpty_console_list_agent\.js/.test(text)
    && text.includes("AttachConsole failed")
}

function collect(chunk) {
  const text = chunk.toString()
  output += text
  safeWriteStdout(text)
}

function collectStderr(chunk) {
  const text = chunk.toString()
  if (isNodePtyAttachConsoleNoise(text)) {
    ignoredNodePtyAttachConsoleNoise.push(text)
    return
  }
  collect(chunk)
}

function appendHarnessDiagnostics() {
  if (ignoredNodePtyAttachConsoleNoise.length === 0 || !fs.existsSync(smokeResultFile)) return
  try {
    const result = JSON.parse(fs.readFileSync(smokeResultFile, "utf8"))
    result.harnessDiagnostics = {
      ...(result.harnessDiagnostics || {}),
      nodePtyAttachConsoleNoise: {
        ignored: true,
        count: ignoredNodePtyAttachConsoleNoise.length,
        source: "scripts/electron-ui-smoke.js",
        reason: "Windows node-pty conpty_console_list_agent can fail AttachConsole while querying the child process list after the task owner has already been disposed; the smoke result still relies on Electron exit code and explicit owner/action checks.",
      },
    }
    writeSmokeResult(result)
  } catch {
    // Keep the smoke outcome tied to Electron exit code and explicit checks.
  }
}

function appendSmokeConsolidation() {
  if (!fs.existsSync(smokeResultFile)) return
  try {
    const result = JSON.parse(fs.readFileSync(smokeResultFile, "utf8"))
    writeSmokeResult(result)
  } catch {
    // Keep the smoke outcome tied to Electron exit code and explicit checks.
  }
}

function readSmokeResult() {
  if (!fs.existsSync(smokeResultFile)) return null
  try {
    return JSON.parse(fs.readFileSync(smokeResultFile, "utf8"))
  } catch {
    return null
  }
}

function hasSpecificDebugSessionBlockedResult() {
  if (!shouldRunDebugSession) return false
  const result = readSmokeResult()
  const blockedReason = typeof result?.blockedReason === "string" ? result.blockedReason : ""
  const isBlocked = result?.blocked === true || result?.ok === false || result?.debugSession?.blocked === true
  if (result?.smokeCase !== "debug-session" || !isBlocked || !blockedReason) {
    return false
  }
  return !/^Electron UI smoke 失败，退出码 \d+。$/.test(blockedReason)
}

function assertWorkspaceTrustDowngradeRestartResult() {
  if (!shouldRunWorkspaceTrustDowngradeRestart) return
  const result = readSmokeResult()
  if (!result || result.smokeCase !== "workspace-trust-downgrade-restart") {
    fail("Workspace Trust downgrade/restart smoke did not write the expected result contract.")
  }
  const smokeResult = result.workspaceTrustDowngradeRestart || result.result || result
  const states = Array.isArray(smokeResult?.disabledByTrustRequirementStates)
    ? smokeResult.disabledByTrustRequirementStates
    : []
  const missingLocationEvidence = states.filter((state) => {
    const evidence = state?.workspaceLocationEvidence || {}
    return evidence.status !== "available"
      || !Array.isArray(evidence.workspaceRoots)
      || evidence.workspaceRoots.length === 0
      || typeof evidence.isInsideWorkspace !== "boolean"
  })
  if (states.length === 0 || missingLocationEvidence.length > 0) {
    fail(`Workspace Trust downgrade/restart smoke did not produce available workspace-location evidence for DisabledByTrustRequirement states: ${JSON.stringify(missingLocationEvidence || [])}`)
  }
}

function assertWorkspaceTrustEditorResult() {
  if (!shouldRunWorkspaceTrustEditor) return
  const result = readSmokeResult()
  if (!result || result.smokeCase !== "workspace-trust-editor") {
    fail("WorkspaceTrustEditor smoke did not write the expected result contract.")
  }
  const smokeResult = result.workspaceTrustEditor || result.result || result
  if (!smokeResult.domVisible || !smokeResult.activeAfterFocus || !smokeResult.activeAfterEscape) {
    fail(`WorkspaceTrustEditor smoke did not prove visible DOM/root focus/Escape focus: ${JSON.stringify({
      domVisible: smokeResult.domVisible,
      activeAfterFocus: smokeResult.activeAfterFocus,
      activeAfterEscape: smokeResult.activeAfterEscape,
    })}`)
  }
  if (!smokeResult.trustedFoldersTableVisible || !smokeResult.affectedFeaturesVisible) {
    fail(`WorkspaceTrustEditor smoke did not prove trusted folders table and affected features visibility: ${JSON.stringify({
      trustedFoldersTableVisible: smokeResult.trustedFoldersTableVisible,
      affectedFeaturesVisible: smokeResult.affectedFeaturesVisible,
    })}`)
  }
  const restrictedSettingsRender = smokeResult.editorPane?.restrictedSettingsRender || {}
  if (restrictedSettingsRender.status !== "available"
    || restrictedSettingsRender.stateSource !== "workbenchConfigurationService"
    || restrictedSettingsRender.filterUntrustedCommand?.commandId !== "settings.filterUntrusted"
    || restrictedSettingsRender.filterUntrustedCommand?.options?.query !== "@tag:requireTrustedWorkspace"
    || (Array.isArray(restrictedSettingsRender.blockedSignals) && restrictedSettingsRender.blockedSignals.length > 0)) {
    fail(`WorkspaceTrustEditor smoke did not prove restricted settings/filterUntrusted projection: ${JSON.stringify({
      status: restrictedSettingsRender.status,
      stateSource: restrictedSettingsRender.stateSource,
      filterUntrustedCommand: restrictedSettingsRender.filterUntrustedCommand,
      blockedSignals: restrictedSettingsRender.blockedSignals,
    })}`)
  }
  const editorPane = smokeResult.editorPane || {}
  if (editorPane.paneOwnerStatus !== "partial"
    || editorPane.settingsEditor2?.owner !== "SettingsEditor2"
    || editorPane.settingsEditor2?.status !== "partial"
    || editorPane.settingsTree?.owner !== "SettingsTree"
    || editorPane.settingsTree?.status !== "partial"
    || editorPane.workbenchTableRowModel?.owner !== "WorkbenchTable"
    || editorPane.workbenchTableRowModel?.status !== "partial"
    || editorPane.blocked?.fullEditorPaneClass !== true
    || editorPane.blocked?.trustedUrisTable !== false
    || editorPane.blocked?.affectedFeaturesList !== false
    || editorPane.blocked?.restrictedSettingsRender !== false) {
    fail(`WorkspaceTrustEditor smoke did not prove SettingsEditor2/SettingsTree/WorkbenchTable owner projection boundaries: ${JSON.stringify({
      paneOwnerStatus: editorPane.paneOwnerStatus,
      settingsEditor2: editorPane.settingsEditor2,
      settingsTree: editorPane.settingsTree,
      workbenchTableRowModel: editorPane.workbenchTableRowModel,
      blocked: editorPane.blocked,
    })}`)
  }
  if (editorPane.settingsEditor2?.reusedConfigurationSource !== "workbenchConfigurationService"
    || !Array.isArray(editorPane.settingsEditor2?.workspaceTrustQueryTags)
    || !editorPane.settingsEditor2.workspaceTrustQueryTags.includes("workspaceTrust")
    || !editorPane.settingsEditor2.workspaceTrustQueryTags.includes("requireTrustedWorkspace")
    || editorPane.settingsEditor2?.trustChangeModelUpdate !== "IWorkspaceTrustManagementService.onDidChangeTrust -> SettingsTreeModel.updateWorkspaceTrust"
    || editorPane.settingsTree?.rowModelSource !== "IWorkbenchConfigurationService.restrictedSettings"
    || editorPane.settingsTree?.indicatorOwner !== "SettingsTreeIndicatorsLabel"
    || editorPane.settingsTree?.indicatorCommandId !== "workbench.trust.manage"
    || editorPane.settingsTree?.modelTrustUpdateSignal !== "SettingsTreeModel.updateWorkspaceTrust"
    || editorPane.workbenchTableRowModel?.stateSource !== "WorkspaceTrustWorkbenchService"
    || editorPane.workbenchTableRowModel?.tableOwnerId !== "WorkspaceTrust"
    || editorPane.workbenchTableRowModel?.tableUpdateSignal !== "WorkspaceTrustedUrisTable.updateTable -> WorkbenchTable.splice"
    || editorPane.covered?.noSecondTrustStore !== true) {
    fail(`WorkspaceTrustEditor smoke lost service-backed owner/source invariants: ${JSON.stringify({
      settingsEditor2Source: editorPane.settingsEditor2?.reusedConfigurationSource,
      settingsEditor2Tags: editorPane.settingsEditor2?.workspaceTrustQueryTags,
      settingsEditor2TrustChangeModelUpdate: editorPane.settingsEditor2?.trustChangeModelUpdate,
      settingsTreeSource: editorPane.settingsTree?.rowModelSource,
      settingsTreeIndicatorOwner: editorPane.settingsTree?.indicatorOwner,
      settingsTreeIndicatorCommandId: editorPane.settingsTree?.indicatorCommandId,
      settingsTreeModelTrustUpdateSignal: editorPane.settingsTree?.modelTrustUpdateSignal,
      workbenchTableSource: editorPane.workbenchTableRowModel?.stateSource,
      workbenchTableOwnerId: editorPane.workbenchTableRowModel?.tableOwnerId,
      workbenchTableUpdateSignal: editorPane.workbenchTableRowModel?.tableUpdateSignal,
      covered: editorPane.covered,
    })}`)
  }
  if (smokeResult.contracts?.noSecondTrustStore !== true) {
    fail("WorkspaceTrustEditor smoke lost the noSecondTrustStore invariant.")
  }
}

child.stdout.on("data", collect)
child.stderr.on("data", collectStderr)

const killTimer = setTimeout(() => {
  try {
    child.kill("SIGKILL")
  } catch {
    // ignore
  }
  cleanupUserDataDir()
  fail("Electron UI smoke 超时。")
}, Number(env.CODEK_ELECTRON_SMOKE_TIMEOUT_MS) + 30000)

child.on("error", (err) => {
  clearTimeout(killTimer)
  cleanupUserDataDir()
  fail(`Electron UI smoke 启动失败: ${err.message}`)
})

child.on("exit", (code) => {
  clearTimeout(killTimer)
  cleanupUserDataDir()
  if (code !== 0) {
    appendSmokeConsolidation()
    for (const text of ignoredNodePtyAttachConsoleNoise) {
      safeWriteStdout(text)
    }
    if (hasSpecificDebugSessionBlockedResult()) {
      const result = readSmokeResult()
      process.stderr.write(`${result.blockedReason}\n`)
      process.exit(code || 1)
    }
    fail(`Electron UI smoke 失败，退出码 ${code}。`)
  }
  if (!output.includes("[electron-smoke]") && !output.includes("[electron-startup-smoke]")) {
    fail("Electron UI smoke 未收到主进程 smoke 结果。")
  }
	  assertDevServerFallbackSmokePassed()
	  assertWorkspaceTrustDowngradeRestartResult()
	  assertWorkspaceTrustEditorResult()
	  appendSmokeConsolidation()
	  appendHarnessDiagnostics()
  if (ignoredNodePtyAttachConsoleNoise.length > 0) {
    safeWriteStdout(`[electron-smoke] ignored node-pty AttachConsole cleanup noise: ${ignoredNodePtyAttachConsoleNoise.length}\n`)
  }
  safeWriteStdout("Electron UI smoke passed.\n")
})
