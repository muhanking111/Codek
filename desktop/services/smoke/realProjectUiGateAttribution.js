const REAL_PROJECT_UI_GATE_ATTRIBUTIONS = [
  {
    stageId: "explorer_file_operation",
    stage: "Explorer/File operation",
    owner: "Explorer/File operation",
    statusWhenFailing: "external-blocker",
    checks: [
      "opensConfiguredRoot",
      "nativeExplorerMounted",
      "explorerRowsVirtualizedAndNonBlank",
      "visibleRowsStableAfterFastScroll",
      "scrollP95WithinCursorGradeBudget",
      "scrollMaxAvoidsHalfSecondStalls",
      "rootPackageExplorerClickRendersEditor",
      "createTargetDisplayMatchesDisk",
      "continuousCreateRemainsUsable",
      "staleCreateSnapshotRejected",
    ],
    evidenceFields: [
      "projectRoot",
      "nativeHostMounted",
      "domRows",
      "blankVisibleRows",
      "p95ScrollMs",
      "createdFileExistsOnDisk",
      "continuousCreateAllExistOnDisk",
      "staleCreateSnapshotRejected",
    ],
    reportPaths: [
      ".codek/reports/workbench-real-project-ui-latest.json",
      ".codek/reports/workbench-real-project-ui-latest.md",
      ".codek/reports/workbench-real-project-ui-latest.png",
      ".codek/reports/electron-smoke-file-operation-visibility-latest-result.json",
    ],
    manualReplaySteps: [
      "Open the same project directory in Cursor and Codek.",
      "Compare Explorer file count, nested folders, hidden-row behavior, create target, rename target, and visible rows after fast scrolling.",
      "Capture Codek PNG plus the matching Cursor/Windows Explorer reference when a difference is visible.",
    ],
    cursorParityChecklist: [
      "Explorer same-directory file count matches Cursor/Windows Explorer.",
      "Create/rename target parent is the selected Explorer folder.",
      "Rows stay nonblank during fast scroll.",
    ],
  },
  {
    stageId: "file_service_search",
    stage: "FileService/SearchService",
    owner: "FileService/SearchService",
    statusWhenFailing: "active-stage",
    checks: [
      "searchResultOpensNonBlankEditor",
      "sameLineSearchDuplicatesCollapsed",
      "sameLineSearchOccurrencesAccurate",
      "searchViewRemainsActive",
    ],
    evidenceFields: [
      "searchQuery",
      "expectedSearchPath",
      "searchMatchPath",
      "searchExpectedPathMatched",
      "sameLineMatchRows",
      "sameLineOccurrences",
      "search-replace acceptance",
    ],
    reportPaths: [
      ".codek/reports/workbench-real-project-ui-latest.json",
      ".codek/reports/workbench-search-navigation-latest.json",
      ".codek/reports/electron-smoke-search-navigation-latest-result.json",
      ".codek/reports/workbench-search-replace-latest.json",
      ".codek/reports/electron-smoke-search-replace-latest-result.json",
    ],
    manualReplaySteps: [
      "Search the same token/path in Cursor and Codek from the same workspace root.",
      "Open multiple same-file and cross-file results in Codek and verify the editor is nonblank and lands on the matching line.",
      "Run replace preview/replace all only on disposable files and confirm stale search rows are cleared.",
    ],
    cursorParityChecklist: [
      "Search result grouping and match count are explainable against Cursor for the same directory.",
      "Codek does not fall back to a false-success search result when providers fail.",
    ],
  },
  {
    stageId: "textfile_workingcopy_large_file",
    stage: "TextFile/WorkingCopy/Large-file",
    owner: "TextFile/WorkingCopy/Large-file",
    statusWhenFailing: "active-stage",
    checks: [
      "largeFileRealContentVisible",
      "largeFileUserScrollAvoidsBlankViewport",
      "largeFileAvoidsBlockingNotice",
      "largeFileReopenRealContentVisible",
      "largeFileCloseReopenKeepsWorkbenchResponsive",
      "extremeFileAutoWindowNavigation",
    ],
    evidenceFields: [
      "largeFileRealContentVisible",
      "largeFileDeepViewportTextVisible",
      "largeFileNextWindowViewportTextVisible",
      "largeFileUserScrollbarDragDirectLoadRequired",
      "largeFileUserScrollbarDragDirectLoaded",
      "largeFileReopenRealContentVisible",
      "working-copy hot-exit acceptance",
    ],
    reportPaths: [
      ".codek/reports/workbench-real-project-ui-latest.json",
      ".codek/reports/electron-smoke-working-copy-hot-exit-latest-result.json",
      ".codek/reports/workbench-large-file-256mb-real-project-ui-latest.json",
    ],
    manualReplaySteps: [
      "Open a real large file and a normal sibling file from the same directory.",
      "Use PageDown, mouse wheel, scrollbar drag, a deep-window jump/search jump, End, close/reopen, and sibling-file switching.",
      "Confirm every viewport shows real text, never a blank editor, synthetic placeholder, blocking notice, or frozen shell.",
    ],
    cursorParityChecklist: [
      "Large-file scrolling is usable enough to compare with Cursor on the same file.",
      "Deep-window jump, reopen, and same-directory normal-file switching preserve visible content.",
    ],
  },
  {
    stageId: "editor_problems_diagnostics",
    stage: "Editor/Problems/Diagnostics",
    owner: "Editor/Problems/Diagnostics",
    statusWhenFailing: "active-stage",
    checks: [
      "normalEditorContentVisible",
      "workbenchEditorPartSnapshotVisible",
      "workbenchEditorPartStateObservable",
    ],
    evidenceFields: [
      "normalEditorContentVisible",
      "workbenchEditorPartEditorCount",
      "workbenchEditorPartActiveEditor",
      "workbenchTitleDiagnosticsErrorCount",
      "workbenchTitleDiagnosticsWarningCount",
    ],
    reportPaths: [
      ".codek/reports/workbench-real-project-ui-latest.json",
      "frontend/vite-project/src/workbench/editorDiagnosticsLifecycle.test.ts",
      "frontend/vite-project/src/components/problemState.test.ts",
      "frontend/vite-project/src/vscode-adapter/platform/markers/common/markers.test.ts",
    ],
    manualReplaySteps: [
      "Open a file with known diagnostics or trigger a disposable diagnostic.",
      "Open Problems and click a diagnostic to verify editor range navigation.",
      "Confirm problem counts, severity badges, and editor title diagnostics remain visible after file switches.",
    ],
    cursorParityChecklist: [
      "Problems visibility and click-to-range behavior are comparable to Cursor/VS Code expectations.",
    ],
  },
  {
    stageId: "terminal_debug_output_task",
    stage: "Terminal/Debug/Output/Task",
    owner: "Terminal/Debug/Output/Task",
    statusWhenFailing: "active-stage",
    checks: [
      "terminalDebugTaskWorkbenchServiceBoundary",
      "terminalDebugTaskWorkbenchPanelBridge",
      "outputWorkbenchChannelEvidence",
      "taskWorkbenchRunEvidence",
      "taskWorkbenchPanelSurface",
      "debugWorkbenchSessionEvidence",
      "terminalWorkbenchCommandEvidence",
      "problemsWorkbenchReadOnlyBridge",
    ],
    evidenceFields: [
      "terminalDebugTaskWorkbenchServiceId",
      "terminalDebugTaskWorkbenchVsCodeServiceIds",
      "terminalDebugTaskWorkbenchCommandIds",
      "terminalDebugTaskWorkbenchPanelId",
      "terminalDebugTaskWorkbenchOutputChannelName",
      "terminalDebugTaskWorkbenchTaskLatestStatus",
      "terminalDebugTaskWorkbenchTaskPanelViewId",
      "terminalDebugTaskWorkbenchTaskPanelStateSource",
      "terminalDebugTaskWorkbenchProblemsDiagnosticCount",
      "terminalDebugTaskWorkbenchProblemsVisible",
      "terminalDebugTaskWorkbenchDebugConsoleEntryCount",
    ],
    reportPaths: [
      ".codek/reports/workbench-real-project-ui-latest.json",
      "frontend/vite-project/src/workbench/terminalDebugTaskWorkbench.test.ts",
    ],
    manualReplaySteps: [
      "Open Terminal, Output, Debug, Tasks, and Problems from the real workbench controls or Command Palette.",
      "Run a harmless task/debug smoke action and confirm status/output/debug console evidence is visible.",
      "Confirm failures are attributed to the Terminal/Debug/Output/Task owner instead of a generic real UI failure.",
    ],
    cursorParityChecklist: [
      "Panel switching and output/task/debug observability are manually comparable to Cursor/VS Code workflow expectations.",
    ],
  },
  {
    stageId: "mcp_quickinput_gallery",
    stage: "MCP/QuickInput/Gallery",
    owner: "MCP/QuickInput/Gallery",
    statusWhenFailing: "active-stage",
    checks: [
      "quickInputWorkbenchRealUi",
      "quickInputWorkbenchServiceBoundary",
      "mcpWorkbenchSurfaceVisible",
      "mcpWorkbenchServiceBoundary",
      "mcpGalleryWorkbenchDetailActionEvidence",
    ],
    evidenceFields: [
      "quickInputWorkbenchServiceId",
      "quickInputWorkbenchStateSource",
      "mcpWorkbenchServiceId",
      "mcpWorkbenchViewIds",
      "mcpWorkbenchQuickAccessPrefixes",
      "mcpGalleryWorkbenchActionIds",
    ],
    reportPaths: [
      ".codek/reports/workbench-real-project-ui-latest.json",
      ".codek/reports/mcp-gallery-management-latest.json",
      ".codek/reports/installed-mcp-discovery-latest.json",
      "frontend/vite-project/src/workbench/mcpCommands.test.ts",
    ],
    manualReplaySteps: [
      "Open QuickInput and MCP Gallery from the workbench, then inspect a server detail.",
      "Verify install/action affordances are visible without bypassing approval or OAuth boundaries.",
      "Confirm MCP resources remain readonly/provider-backed and do not create a second MCP state store.",
    ],
    cursorParityChecklist: [
      "QuickInput and gallery action behavior are discoverable from normal IDE controls.",
    ],
  },
  {
    stageId: "commands_menu_keybinding_settings",
    stage: "Commands/Menu/Keybinding/Settings",
    owner: "Commands/Menu/Keybinding/Settings",
    statusWhenFailing: "active-stage",
    checks: [
      "workbenchCommandSurfaceVisible",
    ],
    evidenceFields: [
      "workbenchCommandSurfaceCommandIds",
      "workbenchCommandSurfaceMenuIds",
      "workbenchCommandPaletteCommandCount",
      "workbenchSettingsActivityVisible",
      "ICommandService",
      "IKeybindingService",
      "IContextKeyService",
      "IConfigurationService",
      "IWorkbenchConfigurationService",
    ],
    reportPaths: [
      ".codek/reports/workbench-real-project-ui-latest.json",
      "frontend/vite-project/src/workbench/commandRegistry.test.ts",
      "frontend/vite-project/src/keybindings.test.ts",
      "frontend/vite-project/src/settings/settingsStore.test.ts",
      "frontend/vite-project/src/workbench/contextKeys.test.ts",
    ],
    manualReplaySteps: [
      "Open menu entries, Command Palette, keyboard shortcuts, and Settings surfaces used by the smoke.",
      "Verify disabled/hidden commands match the current context and do not show dead actions.",
      "Confirm settings/keybinding changes used for the check are observable from the same workbench state.",
    ],
    cursorParityChecklist: [
      "Core commands and settings are reachable with IDE-style controls rather than hidden test hooks.",
    ],
  },
  {
    stageId: "workbench_layout_ui",
    stage: "Workbench Layout/UI",
    owner: "Workbench Layout/UI",
    statusWhenFailing: "active-stage",
    checks: [
      "workbenchActivityBarRegistryDriven",
      "workbenchSidebarRegistrySwitches",
      "workbenchLayoutServiceFocusRestore",
      "workbenchPanelSnapshotVisible",
      "workbenchTitleBarSurfaceVisible",
      "workbenchStatusBarSurfaceVisible",
      "chatInputUsable",
      "chatComposerAvoidsLargeWhiteBox",
      "idleFakeLightbulbHidden",
      "screenshotCapturesEditorSurface",
    ],
    evidenceFields: [
      "workbenchActivityContainerIds",
      "workbenchSidebarContainerId",
      "workbenchLayoutFocusPartIds",
      "workbenchLayoutRestoreMatches",
      "workbenchPanelId",
      "workbenchTitleBarVisible",
      "workbenchStatusBarVisible",
      "screenshotEvidence",
    ],
    reportPaths: [
      ".codek/reports/workbench-real-project-ui-latest.json",
      ".codek/reports/workbench-real-project-ui-latest.md",
      ".codek/reports/workbench-real-project-ui-latest.png",
      "frontend/vite-project/src/vscode-adapter/workbench/services/layout/browser/layoutService.test.ts",
    ],
    manualReplaySteps: [
      "Inspect Activity Bar, Sidebar, EditorPart, Panel, TitleBar, StatusBar, tabs, and chat composer at desktop size.",
      "Switch views, focus Sidebar/Editor/Panel, reopen tabs, and compare the screenshot against the live UI.",
      "Capture any overlap, blank editor, oversized composer, or visual regression with a PNG.",
    ],
    cursorParityChecklist: [
      "First viewport has a professional IDE workbench feel comparable to Cursor/VS Code.",
      "Tabs/header/icons/status surfaces remain legible under normal multi-file use.",
    ],
  },
  {
    stageId: "agent_evidence",
    stage: "Agent Evidence",
    owner: "Agent Evidence",
    statusWhenFailing: "accepted-stage-regression",
    checks: [
      "agentEvidenceWorkbenchServiceBoundary",
      "agentEvidenceWorkbenchListDetailExport",
    ],
    evidenceFields: [
      "agentEvidenceWorkbenchVisible",
      "agentEvidenceVsCodeServiceIds",
      "agentEvidenceListCount",
      "agentEvidenceDetailEditorUri",
      "agentEvidenceExportCommand",
      "agentEvidenceExportMarkdownCommand",
    ],
    reportPaths: [
      ".codek/reports/workbench-real-project-ui-latest.json",
      ".codek/reports/release-evidence-latest.json",
      "frontend/vite-project/src/workbench/agentEvidenceWorkbench.test.ts",
    ],
    manualReplaySteps: [
      "Open Agent Evidence and inspect list, detail, filters, JSON export, and Markdown export.",
      "Confirm evidence references the latest reports without exposing raw prompt/source/output bodies.",
      "Verify degraded or blocked rows explain owner, next action, and report path.",
    ],
    cursorParityChecklist: [
      "Agent evidence is clearer than a generic chat transcript and remains tied to real workspace evidence.",
    ],
  },
  {
    stageId: "scm_testing_timeline_notification_progress",
    stage: "SCM/Testing/Timeline/Notification/Progress",
    owner: "Agent Evidence SCM/Testing/Timeline/Notification/Progress",
    statusWhenFailing: "accepted-stage-regression",
    checks: [
      "agentEvidenceWorkbenchSurfaceVisible",
      "agentEvidenceWorkbenchTimelineLinks",
      "agentEvidenceWorkbenchProgressNotifications",
    ],
    evidenceFields: [
      "agentEvidenceScmVisible",
      "agentEvidenceTestingVisible",
      "agentEvidenceTimelineVisible",
      "agentEvidenceProgressVisible",
      "agentEvidenceNotificationsVisible",
      "agentEvidenceTimelineLinks",
      "agentEvidenceTimelineResources",
      "agentEvidenceProgressAggregateStatuses",
      "agentEvidenceProgressAriaLabels",
      "agentEvidenceNotificationDedupeKeys",
      "agentEvidenceNotificationFocusTargets",
      "agentEvidenceScmStageCommandIds",
      "agentEvidenceScmReadonlyEvidenceFlags",
    ],
    reportPaths: [
      ".codek/reports/workbench-real-project-ui-latest.json",
      ".codek/reports/release-evidence-latest.json",
      "frontend/vite-project/src/workbench/agentEvidenceWorkbench.test.ts",
    ],
    manualReplaySteps: [
      "Open SCM, Testing, Timeline, Progress, and Notification surfaces from Agent Evidence or workbench navigation.",
      "Trigger safe open/diff/attach, test rerun/review, progress cancel, and notification dismiss/focus actions where available.",
      "Confirm each visible failure is attributed to SCM/Testing/Timeline/Notification/Progress instead of a generic UI gate.",
    ],
    cursorParityChecklist: [
      "SCM/Testing/Timeline/Notification Center affordances are visible and action-oriented for manual review.",
    ],
  },
  {
    stageId: "extension_trust_remote_auth",
    stage: "Extension Host/Workspace Trust/Remote Authority/Authentication Workbench",
    owner: "Extension Host/Workspace Trust/Remote Authority/Authentication Workbench",
    statusWhenFailing: "active-stage",
    checks: [
      "extensionGalleryWorkbenchSurfaceVisible",
      "extensionGalleryWorkbenchServiceBoundary",
      "extensionGalleryWorkbenchEditorActionEvidence",
      "extensionTrustRemoteAuthWorkbenchSurfaceVisible",
      "extensionTrustRemoteAuthWorkbenchServiceBoundary",
      "extensionHostWorkbenchActivationEvidence",
      "workspaceTrustWorkbenchDecisionEvidence",
      "remoteAuthorityWorkbenchResolveEvidence",
      "authenticationWorkbenchSessionEvidence",
    ],
    evidenceFields: [
      "extensionGalleryWorkbenchServiceId",
      "extensionGalleryWorkbenchDetailOpened",
      "extensionGalleryWorkbenchDetailActionIds",
      "extensionTrustRemoteAuthWorkbenchExtensionHostServiceId",
      "extensionTrustRemoteAuthWorkbenchWorkspaceTrustServiceId",
      "extensionTrustRemoteAuthWorkbenchRemoteAuthorityServiceId",
      "extensionTrustRemoteAuthWorkbenchAuthenticationServiceId",
      "extensionHostWorkbenchActivationCount",
      "workspaceTrustWorkbenchDecisionCount",
      "remoteAuthorityWorkbenchResolveCount",
      "authenticationWorkbenchStatuses",
    ],
    reportPaths: [
      ".codek/reports/workbench-real-project-ui-latest.json",
      ".codek/reports/workbench-real-project-ui-latest.md",
      "frontend/vite-project/src/workbench/extensionTrustRemoteAuthWorkbench.test.ts",
      "frontend/vite-project/src/extensions/extensionsWorkbenchService.test.ts",
    ],
    notes: "This stage records facade/service-boundary evidence only. Full VS Code extension host runtime, remote account provider matrix, and durable Authentication provider persistence remain out of scope.",
    manualReplaySteps: [
      "Open the Remote/Extension Trust/Auth workbench surface.",
      "Exercise or inspect trust allow/deny, remote resolve success/failure/cache, and auth missing/pending/authorized/revoked/error states.",
      "Confirm no token appears in evidence and blocked states identify whether Trust, Remote Authority, Authentication, or Extension Host owns the failure.",
    ],
    cursorParityChecklist: [
      "Workspace Trust allow/deny, Remote Authority status, and Authentication session states are visible enough for a human reviewer to classify pass or blocked.",
    ],
  },
]

const REAL_PROJECT_UI_MANUAL_CONTRACT = {
  version: 1,
  manualEvidenceJsonPath: ".codek/reports/manual-real-ui-evidence-latest.json",
  manualEvidenceMarkdownPath: ".codek/reports/manual-real-ui-evidence-latest.md",
  manualEvidenceTemplatePath: ".codek/reports/manual-real-ui/manual-real-ui-evidence-template.json",
  automatedJsonPath: ".codek/reports/workbench-real-project-ui-latest.json",
  automatedMarkdownPath: ".codek/reports/workbench-real-project-ui-latest.md",
  automatedScreenshotPath: ".codek/reports/workbench-real-project-ui-latest.png",
}

function buildRealProjectUiGateAttribution(acceptance = {}) {
  const coveredChecks = new Set()
  const rows = REAL_PROJECT_UI_GATE_ATTRIBUTIONS.map((definition) => {
    const checks = definition.checks.filter((check) => Object.prototype.hasOwnProperty.call(acceptance, check))
    checks.forEach((check) => coveredChecks.add(check))
    const failedChecks = checks.filter((check) => acceptance[check] !== true)
    const status = checks.length === 0
      ? (definition.statusWhenNoChecks || "reference")
      : failedChecks.length === 0
        ? (definition.statusWhenPassing || "pass")
        : definition.statusWhenFailing

    return {
      stage: definition.stage,
      owner: definition.owner,
      status,
      checks,
      failedChecks,
      evidenceFields: definition.evidenceFields,
      reportPaths: definition.reportPaths,
      notes: definition.notes || "",
      stageId: definition.stageId,
    }
  })

  const unassignedChecks = Object.keys(acceptance).filter((check) => !coveredChecks.has(check))
  if (unassignedChecks.length > 0) {
    rows.push({
      stage: "Unassigned real-project-ui checks",
      owner: "Acceptance schema",
      status: "schema-drift",
      checks: unassignedChecks,
      failedChecks: unassignedChecks.filter((check) => acceptance[check] !== true),
      evidenceFields: [],
      reportPaths: [
        ".codek/reports/workbench-real-project-ui-latest.json",
        ".codek/reports/electron-smoke-real-project-ui-latest-result.json",
      ],
      notes: "Every new real-project-ui acceptance check must declare a stage owner before the report can be used for cross-stage triage.",
    })
  }

  return {
    rows,
    failedRows: rows.filter((row) => row.failedChecks.length > 0 || row.status === "schema-drift"),
    unassignedChecks,
    manualAcceptanceContract: buildRealProjectUiManualAcceptanceContractFromRows(rows),
  }
}

function buildRealProjectUiManualAcceptanceContractFromRows(rows = []) {
  const definitionByStage = new Map(REAL_PROJECT_UI_GATE_ATTRIBUTIONS.map((definition) => [definition.stage, definition]))
  const contractRows = rows.map((row) => {
    const definition = definitionByStage.get(row.stage) || {}
    const automatedPassed = row.status === "pass" || row.status === "reference"
    return {
      stageId: definition.stageId || "unassigned_real_project_ui_checks",
      stage: row.stage,
      owner: row.owner,
      failureOwner: row.owner,
      automatedStatus: row.status,
      manualStatus: automatedPassed ? "manual-required" : "blocked-by-automation",
      acceptanceChecks: Array.isArray(row.checks) ? row.checks : [],
      failedChecks: Array.isArray(row.failedChecks) ? row.failedChecks : [],
      evidenceFields: Array.isArray(row.evidenceFields) ? row.evidenceFields : [],
      automatedReportPaths: Array.isArray(row.reportPaths) ? row.reportPaths : [],
      manualEvidence: {
        jsonPath: REAL_PROJECT_UI_MANUAL_CONTRACT.manualEvidenceJsonPath,
        markdownPath: REAL_PROJECT_UI_MANUAL_CONTRACT.manualEvidenceMarkdownPath,
        templatePath: REAL_PROJECT_UI_MANUAL_CONTRACT.manualEvidenceTemplatePath,
        screenshotPolicy: "Use the automated PNG for replay orientation; attach manual or Computer Use screenshots for visual/feel confirmation.",
      },
      manualReplaySteps: Array.isArray(definition.manualReplaySteps) ? definition.manualReplaySteps : [
        "Replay this stage in the real Codek desktop UI.",
        "Capture a PNG or Computer Use screenshot reference if the stage is visual or fails.",
        "Record the failed check and owner in manual-real-ui evidence before closing the stage.",
      ],
      cursorParityChecklist: Array.isArray(definition.cursorParityChecklist) ? definition.cursorParityChecklist : [],
      notes: row.notes || "",
    }
  })
  const blockedRows = contractRows.filter((row) => row.manualStatus === "blocked-by-automation")
  return {
    ...REAL_PROJECT_UI_MANUAL_CONTRACT,
    status: blockedRows.length > 0 ? "blocked-by-automation" : "manual-required",
    automatedReady: blockedRows.length === 0,
    manualReady: false,
    fieldContract: {
      automatedPass: "report.acceptance[check] === true",
      stageOwner: "report.gateAttribution.rows[].owner",
      failureOwner: "report.manualAcceptanceContract.rows[].failureOwner",
      manualReplay: "report.manualAcceptanceContract.rows[].manualReplaySteps",
      manualStatus: "report.manualAcceptanceContract.rows[].manualStatus",
      screenshotEvidence: "report.latestScreenshotPath plus manual-real-ui scenario screenshotEvidence",
      reportJson: "report.latestJsonPath",
      reportMarkdown: "report.latestMarkdownPath",
    },
    rows: contractRows,
    blockedRows,
  }
}

function formatRealProjectUiManualAcceptanceContractMarkdown(contract) {
  const rows = Array.isArray(contract?.rows) ? contract.rows : []
  return rows
    .map((row) => {
      const replaySteps = Array.isArray(row.manualReplaySteps) ? row.manualReplaySteps.join("; ") : ""
      const cursorParity = Array.isArray(row.cursorParityChecklist) ? row.cursorParityChecklist.join("; ") : ""
      const reports = Array.isArray(row.automatedReportPaths) ? row.automatedReportPaths.join(", ") : ""
      const manualEvidence = row.manualEvidence
        ? [row.manualEvidence.jsonPath, row.manualEvidence.markdownPath, row.manualEvidence.templatePath].filter(Boolean).join(", ")
        : ""
      return [
        row.stage,
        row.automatedStatus,
        row.manualStatus,
        row.failureOwner,
        manualEvidence,
        replaySteps,
        cursorParity,
        reports,
      ].map((value) => String(value || "").replace(/\|/g, "\\|")).join(" | ")
    })
    .map((line) => `| ${line} |`)
    .join("\n")
}

function formatRealProjectUiGateAttributionMarkdown(gateAttribution) {
  const rows = Array.isArray(gateAttribution?.rows) ? gateAttribution.rows : []
  return rows
    .map((row) => {
      const checks = Array.isArray(row.checks) ? row.checks.join(", ") : ""
      const failedChecks = Array.isArray(row.failedChecks) ? row.failedChecks.join(", ") : ""
      const evidenceFields = Array.isArray(row.evidenceFields) ? row.evidenceFields.join(", ") : ""
      const reportPaths = Array.isArray(row.reportPaths) ? row.reportPaths.join(", ") : ""
      return [
        row.stage,
        row.owner,
        row.status,
        checks,
        failedChecks,
        evidenceFields,
        reportPaths,
        row.notes,
      ].map((value) => String(value || "").replace(/\|/g, "\\|")).join(" | ")
    })
    .map((line) => `| ${line} |`)
    .join("\n")
}

module.exports = {
  REAL_PROJECT_UI_GATE_ATTRIBUTIONS,
  buildRealProjectUiGateAttribution,
  buildRealProjectUiManualAcceptanceContractFromRows,
  formatRealProjectUiGateAttributionMarkdown,
  formatRealProjectUiManualAcceptanceContractMarkdown,
}
