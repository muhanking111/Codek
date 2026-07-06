const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

const {
  buildRealProjectUiGateAttribution,
  formatRealProjectUiManualAcceptanceContractMarkdown,
  formatRealProjectUiGateAttributionMarkdown,
} = require("./realProjectUiGateAttribution")

function readCurrentAcceptanceKeys() {
  const mainPath = path.resolve(__dirname, "..", "..", "main.js")
  const source = fs.readFileSync(mainPath, "utf8")
  const start = source.indexOf("function buildRealProjectUiSmokeAcceptance")
  const returnStart = source.indexOf("  return {", start)
  const returnEnd = source.indexOf("\n  }\n}\n\nfunction renderRealProjectUiSmokeMarkdown", returnStart)
  assert.notEqual(start, -1)
  assert.notEqual(returnStart, -1)
  assert.notEqual(returnEnd, -1)

  return source
    .slice(returnStart, returnEnd)
    .split(/\r?\n/)
    .map((line) => {
      const property = line.match(/^    ([A-Za-z0-9_]+):/)
      if (property) return property[1]
      const shorthand = line.match(/^    ([A-Za-z0-9_]+),$/)
      return shorthand?.[1] || ""
    })
    .filter(Boolean)
}

function makeAcceptance(patch = {}) {
  return {
    opensConfiguredRoot: true,
    nativeExplorerMounted: true,
    explorerRowsVirtualizedAndNonBlank: true,
    visibleRowsStableAfterFastScroll: true,
    scrollP95WithinCursorGradeBudget: true,
    scrollMaxAvoidsHalfSecondStalls: true,
    normalEditorContentVisible: true,
    rootPackageExplorerClickRendersEditor: true,
    largeFileRealContentVisible: true,
    largeFileUserScrollAvoidsBlankViewport: true,
    largeFileAvoidsBlockingNotice: true,
    largeFileReopenRealContentVisible: true,
    largeFileCloseReopenKeepsWorkbenchResponsive: true,
    extremeFileAutoWindowNavigation: true,
    idleFakeLightbulbHidden: true,
    searchResultOpensNonBlankEditor: true,
    sameLineSearchDuplicatesCollapsed: true,
    sameLineSearchOccurrencesAccurate: true,
    searchViewRemainsActive: true,
    chatInputUsable: true,
    chatComposerAvoidsLargeWhiteBox: true,
    workbenchActivityBarRegistryDriven: true,
    workbenchSidebarRegistrySwitches: true,
    workbenchLayoutServiceFocusRestore: true,
    workbenchEditorPartSnapshotVisible: true,
    workbenchEditorPartStateObservable: true,
    workbenchPanelSnapshotVisible: true,
    workbenchTitleBarSurfaceVisible: true,
    workbenchStatusBarSurfaceVisible: true,
    workbenchCommandSurfaceVisible: true,
    agentEvidenceWorkbenchSurfaceVisible: true,
    agentEvidenceWorkbenchServiceBoundary: true,
    agentEvidenceWorkbenchListDetailExport: true,
    agentEvidenceWorkbenchTimelineLinks: true,
    agentEvidenceWorkbenchProgressNotifications: true,
    quickInputWorkbenchRealUi: true,
    quickInputWorkbenchServiceBoundary: true,
    terminalDebugTaskWorkbenchServiceBoundary: true,
    terminalDebugTaskWorkbenchPanelBridge: true,
    outputWorkbenchChannelEvidence: true,
    taskWorkbenchRunEvidence: true,
    taskWorkbenchPanelSurface: true,
    debugWorkbenchSessionEvidence: true,
    terminalWorkbenchCommandEvidence: true,
    problemsWorkbenchReadOnlyBridge: true,
    mcpWorkbenchSurfaceVisible: true,
    mcpWorkbenchServiceBoundary: true,
    mcpGalleryWorkbenchDetailActionEvidence: true,
    extensionGalleryWorkbenchSurfaceVisible: true,
    extensionGalleryWorkbenchServiceBoundary: true,
    extensionGalleryWorkbenchEditorActionEvidence: true,
    extensionTrustRemoteAuthWorkbenchSurfaceVisible: true,
    extensionTrustRemoteAuthWorkbenchServiceBoundary: true,
    extensionHostWorkbenchActivationEvidence: true,
    workspaceTrustWorkbenchDecisionEvidence: true,
    remoteAuthorityWorkbenchResolveEvidence: true,
    authenticationWorkbenchSessionEvidence: true,
    createTargetDisplayMatchesDisk: true,
    continuousCreateRemainsUsable: true,
    staleCreateSnapshotRejected: true,
    screenshotCapturesEditorSurface: true,
    ...patch,
  }
}

test("real-project-ui gate attribution reports every cross-stage owner", () => {
  const attribution = buildRealProjectUiGateAttribution(makeAcceptance())

  assert.deepEqual(attribution.unassignedChecks, [])
  assert.deepEqual(attribution.failedRows, [])
  assert.equal(attribution.manualAcceptanceContract.version, 1)
  assert.equal(attribution.manualAcceptanceContract.status, "manual-required")
  assert.equal(attribution.manualAcceptanceContract.automatedReady, true)
  assert.equal(attribution.manualAcceptanceContract.manualReady, false)
  assert.equal(attribution.manualAcceptanceContract.rows.length, 11)
  assert.deepEqual(attribution.rows.map((row) => row.stage), [
    "Explorer/File operation",
    "FileService/SearchService",
    "TextFile/WorkingCopy/Large-file",
    "Editor/Problems/Diagnostics",
    "Terminal/Debug/Output/Task",
    "MCP/QuickInput/Gallery",
    "Commands/Menu/Keybinding/Settings",
    "Workbench Layout/UI",
    "Agent Evidence",
    "SCM/Testing/Timeline/Notification/Progress",
    "Extension Host/Workspace Trust/Remote Authority/Authentication Workbench",
  ])
  assert.equal(attribution.rows.find((row) => row.stage === "Explorer/File operation")?.status, "pass")
  assert.equal(attribution.rows.find((row) => row.stage === "FileService/SearchService")?.status, "pass")
  assert.equal(attribution.rows.find((row) => row.stage === "TextFile/WorkingCopy/Large-file")?.status, "pass")
  assert.equal(attribution.rows.find((row) => row.stage === "Editor/Problems/Diagnostics")?.status, "pass")
  assert.equal(attribution.rows.find((row) => row.stage === "Terminal/Debug/Output/Task")?.status, "pass")
  assert.equal(attribution.rows.find((row) => row.stage === "MCP/QuickInput/Gallery")?.status, "pass")
  assert.equal(attribution.rows.find((row) => row.stage === "Commands/Menu/Keybinding/Settings")?.status, "pass")
  assert.equal(attribution.rows.find((row) => row.stage === "Agent Evidence")?.status, "pass")
  assert.equal(attribution.rows.find((row) => row.stage === "Workbench Layout/UI")?.status, "pass")
  assert.equal(attribution.rows.find((row) => row.stage === "SCM/Testing/Timeline/Notification/Progress")?.status, "pass")
  assert.equal(attribution.rows.find((row) => row.stage === "Extension Host/Workspace Trust/Remote Authority/Authentication Workbench")?.status, "pass")
  const largeFileContract = attribution.manualAcceptanceContract.rows.find((row) => row.stage === "TextFile/WorkingCopy/Large-file")
  assert.equal(largeFileContract?.manualStatus, "manual-required")
  assert.equal(largeFileContract?.failureOwner, "TextFile/WorkingCopy/Large-file")
  assert.deepEqual(largeFileContract?.manualEvidence, {
    jsonPath: ".codek/reports/manual-real-ui-evidence-latest.json",
    markdownPath: ".codek/reports/manual-real-ui-evidence-latest.md",
    templatePath: ".codek/reports/manual-real-ui/manual-real-ui-evidence-template.json",
    screenshotPolicy: "Use the automated PNG for replay orientation; attach manual or Computer Use screenshots for visual/feel confirmation.",
  })
  assert.ok(largeFileContract?.manualReplaySteps.some((step) => step.includes("PageDown")))
  assert.ok(largeFileContract?.manualReplaySteps.some((step) => step.includes("same directory") || step.includes("sibling")))
  assert.ok(largeFileContract?.cursorParityChecklist.some((item) => item.includes("Large-file scrolling")))

  const cursorParityContract = attribution.manualAcceptanceContract.rows.find((row) => row.stage === "Explorer/File operation")
  assert.ok(cursorParityContract?.manualReplaySteps.some((step) => step.includes("Cursor")))
  assert.ok(cursorParityContract?.cursorParityChecklist.some((item) => item.includes("file count")))

  const trustRemoteAuthContract = attribution.manualAcceptanceContract.rows.find((row) => row.stage === "Extension Host/Workspace Trust/Remote Authority/Authentication Workbench")
  assert.ok(trustRemoteAuthContract?.manualReplaySteps.some((step) => step.includes("trust allow/deny")))
  assert.ok(trustRemoteAuthContract?.manualReplaySteps.some((step) => step.includes("remote resolve success/failure/cache")))
  assert.ok(trustRemoteAuthContract?.manualReplaySteps.some((step) => step.includes("auth missing/pending/authorized/revoked/error")))

  const scmTestingContract = attribution.manualAcceptanceContract.rows.find((row) => row.stage === "SCM/Testing/Timeline/Notification/Progress")
  const scmTestingRow = attribution.rows.find((row) => row.stage === "SCM/Testing/Timeline/Notification/Progress")
  assert.deepEqual(scmTestingRow?.checks, [
    "agentEvidenceWorkbenchSurfaceVisible",
    "agentEvidenceWorkbenchTimelineLinks",
    "agentEvidenceWorkbenchProgressNotifications",
  ])
  assert.ok(scmTestingRow?.evidenceFields.includes("agentEvidenceScmStageCommandIds"))
  assert.ok(scmTestingRow?.evidenceFields.includes("agentEvidenceScmReadonlyEvidenceFlags"))
  assert.ok(scmTestingRow?.evidenceFields.includes("agentEvidenceTimelineResources"))
  assert.ok(scmTestingRow?.evidenceFields.includes("agentEvidenceProgressAriaLabels"))
  assert.ok(scmTestingRow?.evidenceFields.includes("agentEvidenceNotificationFocusTargets"))
  assert.ok(scmTestingContract?.manualReplaySteps.some((step) => step.includes("SCM, Testing, Timeline, Progress, and Notification")))
  assert.ok(scmTestingContract?.manualReplaySteps.some((step) => step.includes("progress cancel")))

  const markdown = formatRealProjectUiGateAttributionMarkdown(attribution)
  assert.match(markdown, /Agent Evidence \| Agent Evidence \| pass/)
  assert.match(markdown, /Terminal\/Debug\/Output\/Task \| Terminal\/Debug\/Output\/Task \| pass/)
  assert.match(markdown, /Extension Host\/Workspace Trust\/Remote Authority\/Authentication Workbench \| Extension Host\/Workspace Trust\/Remote Authority\/Authentication Workbench \| pass/)
  assert.match(markdown, /\.codek\/reports\/workbench-real-project-ui-latest\.json/)

  const manualMarkdown = formatRealProjectUiManualAcceptanceContractMarkdown(attribution.manualAcceptanceContract)
  assert.match(manualMarkdown, /TextFile\/WorkingCopy\/Large-file \| pass \| manual-required/)
  assert.match(manualMarkdown, /manual-real-ui-evidence-latest\.json/)
  assert.match(manualMarkdown, /Workspace Trust/)
  assert.match(manualMarkdown, /Notification Center affordances/)
})

test("real-project-ui gate attribution assigns gallery failures to the owning active stages", () => {
  const attribution = buildRealProjectUiGateAttribution(makeAcceptance({
    mcpGalleryWorkbenchDetailActionEvidence: false,
    extensionGalleryWorkbenchEditorActionEvidence: false,
  }))
  const failedByStage = new Map(attribution.failedRows.map((row) => [row.stage, row]))

  assert.deepEqual(failedByStage.get("MCP/QuickInput/Gallery")?.failedChecks, [
    "mcpGalleryWorkbenchDetailActionEvidence",
  ])
  assert.deepEqual(failedByStage.get("Extension Host/Workspace Trust/Remote Authority/Authentication Workbench")?.failedChecks, [
    "extensionGalleryWorkbenchEditorActionEvidence",
  ])
  assert.equal(failedByStage.get("MCP/QuickInput/Gallery")?.status, "active-stage")
  assert.equal(failedByStage.get("Extension Host/Workspace Trust/Remote Authority/Authentication Workbench")?.status, "active-stage")
  assert.equal(attribution.manualAcceptanceContract.status, "blocked-by-automation")
  assert.equal(attribution.manualAcceptanceContract.automatedReady, false)
  assert.deepEqual(
    attribution.manualAcceptanceContract.blockedRows.map((row) => row.stage).sort(),
    [
      "Extension Host/Workspace Trust/Remote Authority/Authentication Workbench",
      "MCP/QuickInput/Gallery",
    ],
  )
  assert.equal(attribution.manualAcceptanceContract.blockedRows.every((row) => row.manualStatus === "blocked-by-automation"), true)
})

test("real-project-ui gate attribution surfaces acceptance schema drift", () => {
  const attribution = buildRealProjectUiGateAttribution(makeAcceptance({
    newlyAddedGateWithoutOwner: true,
  }))
  const drift = attribution.rows.find((row) => row.stage === "Unassigned real-project-ui checks")

  assert.deepEqual(attribution.unassignedChecks, ["newlyAddedGateWithoutOwner"])
  assert.equal(drift?.status, "schema-drift")
  assert.deepEqual(drift?.checks, ["newlyAddedGateWithoutOwner"])
})

test("real-project-ui gate attribution covers every current acceptance check", () => {
  const acceptance = Object.fromEntries(readCurrentAcceptanceKeys().map((key) => [key, true]))
  const attribution = buildRealProjectUiGateAttribution(acceptance)
  const assignedChecks = attribution.rows.flatMap((row) => row.checks)

  assert.equal(Object.keys(acceptance).length, 61)
  assert.deepEqual(attribution.unassignedChecks, [])
  assert.deepEqual(attribution.failedRows, [])
  assert.equal(new Set(assignedChecks).size, assignedChecks.length)
  assert.deepEqual([...new Set(assignedChecks)].sort(), Object.keys(acceptance).sort())
})
