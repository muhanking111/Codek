const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const test = require("node:test")

const root = path.resolve(__dirname, "..")
const smokeScript = path.join(root, "scripts", "electron-ui-smoke.js")
const packageJson = require("../package.json")

function runDryRunSmoke(flag) {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-electron-smoke-contract-"))
  const resultFile = path.join(reportDir, `${flag.replace(/^--/, "")}.json`)
  const result = spawnSync(process.execPath, [smokeScript, flag, "--dry-run"], {
    cwd: root,
    env: {
      ...process.env,
      CODEK_ELECTRON_SMOKE_RESULT_FILE: resultFile,
    },
    encoding: "utf8",
    windowsHide: true,
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(fs.existsSync(resultFile), true)
  const stdoutPayload = JSON.parse(result.stdout)
  const filePayload = JSON.parse(fs.readFileSync(resultFile, "utf8"))
  assert.deepEqual(stdoutPayload, filePayload)
  return filePayload
}

function assertDryRunConsolidation(payload, expectedStatus = "partial") {
  assert.equal(payload.smokeConsolidation.smokeCase, payload.smokeCase)
  assert.equal(payload.smokeConsolidation.mode, "dry-run-contract")
  assert.equal(payload.smokeConsolidation.status, expectedStatus)
  assert.equal(payload.smokeConsolidation.checkCount, payload.checks.length)
  assert.equal(payload.smokeConsolidation.failedCount, 0)
  assert.equal(payload.smokeConsolidation.resultFile.endsWith(".json"), true)
}

test("notification actions click smoke dry-run proves runnable bridge contract", () => {
  assert.equal(
    packageJson.scripts["smoke:workbench:notification-actions-click"],
    "node scripts/electron-ui-smoke.js --notification-actions-click",
  )

  const payload = runDryRunSmoke("--notification-actions-click")

  assert.equal(payload.ok, true)
  assert.equal(payload.smokeCase, "notification-actions-click")
  assert.equal(payload.blocked, false)
  assertDryRunConsolidation(payload)
  assert.deepEqual(payload.expectedEvidence.progressActionIds, [
    "progress.button.0",
    "workbench.extensions.manage",
    "progress.cancel",
  ])
  assert.equal(payload.expectedEvidence.primaryClickDispatches, true)
  assert.equal(payload.expectedEvidence.secondaryCommandRegisteredBeforeClick, true)
  assert.equal(payload.expectedEvidence.secondaryCommandInvocationCount, ">= 1")
  assert.equal(payload.expectedEvidence.cancelTokenObserved, true)
  assert.equal(payload.expectedEvidence.primaryBackChannelChoice, 0)
  assert.equal(payload.expectedEvidence.cancelBackChannelChoice, undefined)
  assert.equal(payload.expectedEvidence.separateCancelHandle, true)
  assert.equal(payload.expectedEvidence.notificationOwner, "NotificationToast")
  assert.equal(payload.expectedEvidence.actionOwner, "workbenchStatusNotificationProgressService.invokeNotificationAction")
  assert.equal(payload.expectedEvidence.noSecondNotificationStateSource, true)
  assert(payload.intendedRendererHooks.includes("NotificationToast [data-notification-action-id=\"workbench.extensions.manage\"]"))
  assert(payload.intendedRendererHooks.includes("NotificationToast [data-notification-service-source=\"workbenchStatusNotificationProgressService\"]"))
  assert(payload.intendedRendererHooks.includes("NotificationToast [data-notification-action-owner=\"workbenchStatusNotificationProgressService.invokeNotificationAction\"]"))
  assert(payload.intendedRendererHooks.includes("commandRegistry.executeCommand('workbench.extensions.manage')"))
  assert(payload.intendedMainHooks.includes("ipcMain.on('ext-host:progress-cancel')"))
  assert(payload.intendedMainHooks.includes("ExtHostProgress.$acceptProgressCanceled(handle)"))
})

test("debug output bridge smoke dry-run records backing-file and REPL evidence contract", () => {
  assert.equal(
    packageJson.scripts["smoke:workbench:debug-output-bridge"],
    "node scripts/electron-ui-smoke.js --debug-output-bridge",
  )

  const payload = runDryRunSmoke("--debug-output-bridge")

  assert.equal(payload.ok, true)
  assert.equal(payload.smokeCase, "debug-output-bridge")
  assertDryRunConsolidation(payload, "blocked")
  assert.equal(payload.expectedEvidence.outputRegisterEvent, "ext-host:output-register")
  assert.deepEqual(payload.expectedEvidence.backingFileContentEvents, [
    "debug-output-smoke:first\n",
    "debug-output-smoke:second\n",
  ])
  assert.deepEqual(payload.expectedEvidence.outputPreviewIncludes, [
    "debug-output-smoke:first",
    "debug-output-smoke:second",
  ])
  assert.equal(payload.expectedEvidence.rendererOutputEvidence.panelSelector, '[data-codek-smoke="output-panel"]')
  assert.equal(payload.expectedEvidence.rendererOutputEvidence.contentSelector, '[data-codek-smoke="output-content"]')
  assert.equal(payload.expectedEvidence.rendererOutputEvidence.serviceSource, "outputLogTelemetryService")
  assert.equal(payload.expectedEvidence.rendererOutputEvidence.activeChannel, "Debug Output Bridge Smoke")
  assert.deepEqual(payload.expectedEvidence.rendererOutputEvidence.previewIncludes, [
    "debug-output-smoke:first",
    "debug-output-smoke:second",
  ])
  assert.deepEqual(payload.expectedEvidence.rendererOutputEvidence.visibleTextIncludes, [
    "debug-output-smoke:first",
    "debug-output-smoke:second",
  ])
  assert.equal(payload.expectedEvidence.outputServiceId, "outputService")
  assert.equal(payload.expectedEvidence.outputStateSource, "outputLogTelemetryService")
  assert.equal(payload.expectedEvidence.outputNoDoubleAppendEvidence.noDoubleAppend, true)
  assert.equal(payload.expectedEvidence.outputNoDoubleAppendEvidence.contentEventCount, 2)
  assert.deepEqual(payload.expectedEvidence.outputNoDoubleAppendEvidence.contentEventContents, [
    "debug-output-smoke:first\\n",
    "debug-output-smoke:second\\n",
  ])
  assert.deepEqual(payload.expectedEvidence.outputNoDoubleAppendEvidence.expectedContentEventContents, [
    "debug-output-smoke:first\\n",
    "debug-output-smoke:second\\n",
  ])
  assert.equal(payload.expectedEvidence.outputNoDoubleAppendEvidence.contentEventsMatchBackingFile, true)
  assert.equal(payload.expectedEvidence.outputNoDoubleAppendEvidence.backingFileContentMatchesExpected, true)
  assert.equal(payload.expectedEvidence.outputNoDoubleAppendEvidence.backingFileFirstCount, 1)
  assert.equal(payload.expectedEvidence.outputNoDoubleAppendEvidence.backingFileSecondCount, 1)
  assert.equal(payload.expectedEvidence.outputNoDoubleAppendEvidence.previewFirstCount, 1)
  assert.equal(payload.expectedEvidence.outputNoDoubleAppendEvidence.previewSecondCount, 1)
  assert.equal(payload.expectedEvidence.replInput, "debug-output-bridge-repl-smoke")
  assert.equal(payload.expectedEvidence.evaluateResult, "Error: not connected")
  assert.equal(payload.expectedEvidence.successReplInput, "debug-output-bridge-repl-smoke-success")
  assert.equal(payload.expectedEvidence.successEvaluateResult, "debug-output-bridge-success-result")
  assert.equal(payload.expectedEvidence.errorReplInput, "debug-output-bridge-repl-smoke-error")
  assert.equal(payload.expectedEvidence.errorEvaluateResult, "Error: debug-output-bridge-error-result")
  assert.equal(payload.expectedEvidence.replConsoleOutputEvidence.stateSource, "debugState.consoleOutput")
  assert.equal(payload.expectedEvidence.replConsoleOutputEvidence.rendererOutputSource, "DebugPanel v-for debugState.consoleOutput.value")
  assert.equal(payload.expectedEvidence.replConsoleOutputEvidence.rendererSubmitPath, "DebugPanel.handleConsoleSubmit -> debugActions.sendInput -> DebugManager.evaluate")
  assert.equal(payload.expectedEvidence.replConsoleOutputEvidence.runningAppendOwner, "DebugManager.evaluate")
  assert.equal(payload.expectedEvidence.replConsoleOutputEvidence.debugActionsRunningDoubleAppend, false)
  assert.equal(payload.expectedEvidence.replConsoleOutputEvidence.inputSuccessErrorShareConsoleOutput, true)
  assert.deepEqual(payload.expectedEvidence.replConsoleOutputEvidence.expectedSuccessEntries, [
    { type: "input", text: "debug-output-bridge-repl-smoke-success" },
    { type: "output", text: "debug-output-bridge-success-result" },
  ])
  assert.deepEqual(payload.expectedEvidence.replConsoleOutputEvidence.expectedErrorEntries, [
    { type: "input", text: "debug-output-bridge-repl-smoke-error" },
    { type: "error", text: "Error: debug-output-bridge-error-result" },
  ])
  assert.equal(payload.expectedEvidence.noSecondOutputOrDebugStateSource, true)
  assert(payload.intendedMainHooks.includes("MainThreadOutputService.$register(channel, backingFile)"))
  assert(payload.intendedMainHooks.includes("MainThreadOutputService.$update(channelId, mode, till)"))
  assert(payload.intendedMainHooks.includes("BrowserWindow.webContents.send('ext-host:output-content')"))
  assert(payload.intendedRendererHooks.includes("extensionHostRuntimeBridge ext-host:output-content"))
  assert(payload.intendedRendererHooks.includes("globalCodekOutputService.getOutputSnapshot(channelLabel)"))
  assert(payload.intendedRendererHooks.includes("DebugManager.evaluate(expression)"))
  assert(payload.intendedRendererHooks.includes("debugState.consoleOutput"))
})

test("debug output bridge smoke script owns real Electron backing-file and REPL assertions", () => {
  const smokeSource = fs.readFileSync(smokeScript, "utf8")
  const mainSource = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8")
  const appSource = fs.readFileSync(path.join(root, "frontend", "vite-project", "src", "App.vue"), "utf8")

  assert(smokeSource.includes('CODEK_ELECTRON_SMOKE_DEBUG_OUTPUT_BRIDGE: shouldRunDebugOutputBridge ? "1" : ""'))
  assert(!packageJson.scripts["smoke:workbench:debug-output-bridge"].includes("--dry-run"))

  assert(mainSource.includes("async function exerciseElectronSmokeDebugOutputBridge(win)"))
  assert(mainSource.includes('const outputBackingDir = path.join(CODEK_DATA, "electron-smoke-debug-output-bridge")'))
  assert(mainSource.includes('fs.writeFileSync(backingFile, "debug-output-smoke:first\\n", "utf8")'))
  assert(mainSource.includes('fs.appendFileSync(backingFile, secondLine, "utf8")'))
  assert(mainSource.includes('await server.callRpc("$register"'))
  assert(mainSource.includes('await server.callRpc("$update"'))
  assert(mainSource.includes('await server.callRpc("$reveal"'))
  assert(mainSource.includes('document.querySelector(\'[data-codek-smoke="output-panel"]\')'))
  assert(mainSource.includes("getDebugOutputBridgeSnapshot?.(channelLabel)"))
  assert(mainSource.includes("rendererOutputEvidence"))
  assert(mainSource.includes("contentEventsMatchBackingFile === true"))
  assert(mainSource.includes("backingFileContentMatchesExpected === true"))
  assert(mainSource.includes('debugEvidence.successEvaluateResult === "debug-output-bridge-success-result"'))
  assert(mainSource.includes('debugEvidence.evaluateResult === "Error: not connected"'))
  assert(mainSource.includes("debugEvidence.noDoubleAppend === true"))

  assert(appSource.includes("getDebugOutputBridgeSnapshot"))
  assert(appSource.includes('document.querySelector(\'[data-codek-smoke="output-content"]\')'))
  assert(appSource.includes('document.querySelector(\'[data-codek-smoke="output-panel"]\')'))
  assert(appSource.includes('getAttribute?.("data-output-service-source")'))
  assert(appSource.includes("runDebugOutputBridgeReplSmoke"))
  assert(appSource.includes("globalCodekOutputService.getOutputSnapshot(channelLabel)"))
  assert(appSource.includes('serviceId: "debugService"'))
  assert(appSource.includes('stateSource: "debugState"'))
  assert(appSource.includes("await sendDebugInput(expression)"))
  assert(appSource.includes("await sendDebugInput(successExpression)"))
})

test("output log smoke dry-run records owner evidence contract", () => {
  assert.equal(
    packageJson.scripts["smoke:workbench:output-log"],
    "node scripts/electron-ui-smoke.js --output-log",
  )

  const payload = runDryRunSmoke("--output-log")

  assert.equal(payload.ok, true)
  assert.equal(payload.smokeCase, "output-log")
  assertDryRunConsolidation(payload, "blocked")
  assert.equal(payload.expectedEvidence.outputServiceId, "outputService")
  assert.equal(payload.expectedEvidence.outputStateSource, "outputLogTelemetryService")
  assert.equal(payload.expectedEvidence.outputOwner, "outputLogTelemetryService")
  assert.equal(payload.expectedEvidence.mainThreadOwner, "MainThreadOutputService")
  assert.equal(payload.expectedEvidence.rendererOwner, "OutputPanel")
  assert.equal(payload.expectedEvidence.uiOwnerState, "partial")
  assert.equal(payload.expectedEvidence.evidenceState, "partial")
  assert.equal(payload.expectedEvidence.noSecondOutputStateSource, true)
  assert.equal(payload.expectedEvidence.rawOutputPayloadRedactedFromOwnerEvidence, true)
  assert.equal(payload.expectedEvidence.partialUiOwnerNotConnected, true)
  assert.match(payload.expectedEvidence.remainingGap, /App\.vue/)
  assert(payload.intendedMainHooks.includes("MainThreadOutputService.$register(channel, backingFile)"))
  assert(payload.intendedMainHooks.includes("MainThreadOutputService.$update(channelId, Append|Clear, till)"))
  assert(payload.intendedRendererHooks.includes("globalOutputLogTelemetryService.getOwnerEvidence(channelLabel)"))
  assert(payload.intendedRendererHooks.includes("OutputPanel data-output-* smoke metadata"))
})

test("output log smoke script owns real Electron owner-evidence checks", () => {
  const smokeSource = fs.readFileSync(smokeScript, "utf8")
  const mainSource = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8")

  assert(smokeSource.includes('CODEK_ELECTRON_SMOKE_OUTPUT_LOG: shouldRunOutputLog ? "1" : ""'))
  assert(!packageJson.scripts["smoke:workbench:output-log"].includes("--dry-run"))
  assert(mainSource.includes("async function exerciseElectronSmokeOutputLog(win)"))
  assert(mainSource.includes('const outputBackingDir = path.join(CODEK_DATA, "electron-smoke-output-log")'))
  assert(mainSource.includes("outputLogOwnerEvidence"))
  assert(mainSource.includes("panelDataset"))
  assert(mainSource.includes("ownerEvidenceLeakCheck"))
  assert(mainSource.includes("rawSecretAbsent"))
  assert(mainSource.includes("uiOwnerState !== \"connected\""))
})

test("debug session smoke dry-run records metadata-only DAP contract", () => {
  assert.equal(
    packageJson.scripts["smoke:workbench:debug-session"],
    "node scripts/electron-ui-smoke.js --debug-session",
  )

  const payload = runDryRunSmoke("--debug-session")

  assert.equal(payload.ok, true)
  assert.equal(payload.smokeCase, "debug-session")
  assertDryRunConsolidation(payload, "blocked")
  assert.equal(payload.expectedEvidence.sessionObserved, true)
  assert.equal(payload.expectedEvidence.dapMetadataOnly, true)
  assert.equal(payload.expectedEvidence.adapterType, "node")
  assert.equal(payload.expectedEvidence.sessionIdPrefix, "dap-")
  assert.equal(payload.expectedEvidence.debugStateSource, "debugState")
  assert.equal(payload.expectedEvidence.bridgeEvidenceSource, "MainThreadDebugService.dapIpcBridge")
  assert.equal(payload.expectedEvidence.redaction.noExpressionText, true)
  assert.equal(payload.expectedEvidence.redaction.noSourcePathText, true)
  assert.equal(payload.expectedEvidence.redaction.noAdapterArgsText, true)
  assert.equal(payload.expectedEvidence.debugViewContainerOwner.status, "partial")
  assert.equal(payload.expectedEvidence.debugViewContainerOwner.connected, false)
})

test("debug session smoke script writes blocked result when Electron preflight fails", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-debug-session-preflight-"))
  const resultFile = path.join(reportDir, "debug-session.json")
  const result = spawnSync(process.execPath, [smokeScript, "--debug-session"], {
    cwd: root,
    env: {
      ...process.env,
      CODEK_ELECTRON_SMOKE_RESULT_FILE: resultFile,
    },
    encoding: "utf8",
    windowsHide: true,
  })

  if (result.status === 0) {
    return
  }

  assert.equal(fs.existsSync(resultFile), true)
  const payload = JSON.parse(fs.readFileSync(resultFile, "utf8"))
  assert.equal(payload.ok, false)
  assert.equal(payload.smokeCase, "debug-session")
  assert.equal(payload.blocked, true)
  assert.equal(payload.dapMetadataOnly, true)
  assert.equal(payload.debugSession.sessionObserved, false)
  assert.equal(payload.debugSession.redaction.noSourcePathText, true)
  assert.equal(payload.debugSession.debugViewContainerOwner.connected, false)
})

test("debug session smoke preserves specific blocked result on Electron nonzero exit", () => {
  const smokeSource = fs.readFileSync(smokeScript, "utf8")
  assert(smokeSource.includes("function hasSpecificDebugSessionBlockedResult()"))
  assert(smokeSource.includes('result?.smokeCase !== "debug-session"'))
  assert(smokeSource.includes("result?.blocked === true || result?.ok === false || result?.debugSession?.blocked === true"))
  assert(smokeSource.includes('!/^Electron UI smoke 失败，退出码 \\d+。$/.test(blockedReason)'))
  assert(smokeSource.includes("if (hasSpecificDebugSessionBlockedResult())"))
  assert(smokeSource.includes("process.stderr.write(`${result.blockedReason}\\n`)"))

  const preservationBranch = smokeSource.slice(
    smokeSource.indexOf("if (hasSpecificDebugSessionBlockedResult())"),
    smokeSource.indexOf("fail(`Electron UI smoke 失败，退出码 ${code}。`)"),
  )
  assert(preservationBranch.includes("process.exit(code || 1)"))
  assert(!preservationBranch.includes("fail("))
})

test("workspace trust smoke dry-runs distinguish runnable dialog from restart lifecycle blocker", () => {
  assert.equal(
    packageJson.scripts["smoke:workbench:workspace-trust-downgrade-restart"],
    "node scripts/electron-ui-smoke.js --workspace-trust-downgrade-restart",
  )
  assert.equal(
    packageJson.scripts["smoke:workbench:workspace-trust-request-dialog"],
    "node scripts/electron-ui-smoke.js --workspace-trust-request-dialog",
  )
  assert.equal(
    packageJson.scripts["smoke:workbench:workspace-trust-editor"],
    "node scripts/electron-ui-smoke.js --workspace-trust-editor",
  )

  const downgrade = runDryRunSmoke("--workspace-trust-downgrade-restart")
  const request = runDryRunSmoke("--workspace-trust-request-dialog")
  const editor = runDryRunSmoke("--workspace-trust-editor")

  assert.equal(downgrade.ok, true)
  assert.equal(downgrade.smokeCase, "workspace-trust-downgrade-restart")
  assert.equal(downgrade.blocked, true)
  assertDryRunConsolidation(downgrade, "blocked")
  assert.match(downgrade.blockedReason, /dry-run/)
  assert.equal(downgrade.expectedEvidence.noSecondTrustStore, true)
  assert.equal(downgrade.expectedEvidence.extensionEnablementState, "DisabledByTrustRequirement")
  assert.equal(downgrade.expectedEvidence.extensionHostLifecycleAction, "stopStart")
  assert(downgrade.intendedRendererHooks.includes("globalWorkspaceTrustManagementService.setWorkspaceTrust(root, 'restricted')"))

  assert.equal(request.ok, true)
  assert.equal(request.smokeCase, "workspace-trust-request-dialog")
  assert.equal(request.blocked, false)
  assertDryRunConsolidation(request)
  assert.equal(request.expectedEvidence.dialogSource, "WorkspaceTrustRequestHandler")
  assert.equal(request.expectedEvidence.commandId, "workbench.trust.request")
  assert.deepEqual(request.expectedEvidence.buttonLabels, ["Trust Workspace & Continue", "Manage", "Cancel"])
  assert.equal(request.expectedEvidence.noSecondTrustStore, true)
  assert(request.intendedRendererHooks.includes("globalCodekDialogService.getActiveDialog()"))
  assert(request.intendedRendererHooks.includes("button[data-dialog-button-index]"))

  assert.equal(editor.ok, true)
  assert.equal(editor.smokeCase, "workspace-trust-editor")
  assert.equal(editor.blocked, false)
  assertDryRunConsolidation(editor)
  assert.equal(editor.expectedEvidence.domSmokeStatus, "available")
  assert.equal(editor.expectedEvidence.paneOwnerStatus, "partial")
  assert.equal(editor.expectedEvidence.focusContract, "WorkspaceTrustEditor.focus -> rootElement.focus")
  assert.equal(editor.expectedEvidence.keyboardNavigation, true)
  assert.equal(editor.expectedEvidence.restrictedSettingsTree, "available")
  assert.equal(editor.expectedEvidence.restrictedSettingsStateSource, "workbenchConfigurationService")
  assert.equal(editor.expectedEvidence.filterUntrustedCommandId, "settings.filterUntrusted")
  assert.equal(editor.expectedEvidence.filterUntrustedQuery, "@tag:requireTrustedWorkspace")
  assert.deepEqual(editor.expectedEvidence.settingsEditor2WorkspaceTrustTags, ["workspaceTrust", "requireTrustedWorkspace"])
  assert.equal(
    editor.expectedEvidence.settingsEditor2TrustChangeModelUpdate,
    "IWorkspaceTrustManagementService.onDidChangeTrust -> SettingsTreeModel.updateWorkspaceTrust",
  )
  assert.equal(editor.expectedEvidence.settingsTreeIndicatorOwner, "SettingsTreeIndicatorsLabel")
  assert.equal(editor.expectedEvidence.settingsTreeIndicatorCommandId, "workbench.trust.manage")
  assert.equal(editor.expectedEvidence.settingsTreeModelTrustUpdateSignal, "SettingsTreeModel.updateWorkspaceTrust")
  assert.equal(editor.expectedEvidence.workbenchTableOwnerId, "WorkspaceTrust")
  assert.equal(
    editor.expectedEvidence.workbenchTableUpdateSignal,
    "WorkspaceTrustedUrisTable.updateTable -> WorkbenchTable.splice",
  )
  assert.equal(editor.expectedEvidence.settingsEditor2Owner, "partial")
  assert.equal(editor.expectedEvidence.settingsTreeOwner, "partial")
  assert.equal(editor.expectedEvidence.workbenchTableRowModel, "partial")
  assert.equal(editor.expectedEvidence.fullEditorPaneClass, "blocked")
  assert.equal(editor.expectedEvidence.noSecondTrustStore, true)
  assert(editor.intendedRendererHooks.includes("data-codek-smoke=\"workspace-trust-editor\""))
  assert(editor.intendedRendererHooks.includes("Ctrl+Enter toggle workspace trust"))
  assert(editor.intendedRendererHooks.includes("settings.filterUntrusted -> @tag:requireTrustedWorkspace"))
})

test("workspace trust host reload bridge is owned by preload IPC and Electron main BrowserWindow reload", () => {
  const preloadSource = fs.readFileSync(path.join(root, "desktop", "preload.js"), "utf8")
  const mainSource = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8")
  const reloadHandlerStart = mainSource.indexOf('ipcMain.handle("window:reloadWorkbench"')
  const nextHandlerStart = mainSource.indexOf('ipcMain.handle("window:simulateCloseLifecycle"', reloadHandlerStart)
  const reloadHandler = mainSource.slice(reloadHandlerStart, nextHandlerStart)

  assert(reloadHandlerStart >= 0)
  assert(nextHandlerStart > reloadHandlerStart)
  assert(preloadSource.includes("reloadWorkbenchWindow: (options) => ipcRenderer.invoke(\"window:reloadWorkbench\", options || {})"))
  assert(reloadHandler.includes("BrowserWindow.fromWebContents(event.sender)"))
  assert(reloadHandler.includes('const owner = "ElectronMain BrowserWindow.reload"'))
  assert(reloadHandler.includes("options?.dryRun === true"))
  assert(reloadHandler.includes("win.reload()"))
  assert(!reloadHandler.includes("ext-host:"))
  assert(!reloadHandler.includes("startExtensionHosts"))
  assert(!reloadHandler.includes("stopExtensionHosts"))
})

test("testing publish results bridge is exposed by real preload IPC", () => {
  const preloadSource = fs.readFileSync(path.join(root, "desktop", "preload.js"), "utf8")
  const mainSource = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8")
  const mainThreadTestingSource = fs.readFileSync(
    path.join(root, "desktop", "services", "extensions-host", "mainThread", "mainThreadTesting.js"),
    "utf8",
  )

  assert(preloadSource.includes("publishExtHostTestingResults: (payload) => ipcRenderer.invoke(\"ext-host:testing-publish-results\", payload || {})"))
  assert(preloadSource.includes("onExtHostTestingRunTaskStart: (callback) => listenToExtHost(\"ext-host:testing-run-task-start\", callback)"))
  assert(preloadSource.includes("onExtHostTestingRunTaskFinish: (callback) => listenToExtHost(\"ext-host:testing-run-task-finish\", callback)"))
  assert(preloadSource.includes("onExtHostTestingRetire: (callback) => listenToExtHost(\"ext-host:testing-retire\", callback)"))
  assert(mainSource.includes('const isTestingPublishResultsSmoke = process.env.CODEK_ELECTRON_SMOKE_TESTING_PUBLISH_RESULTS === "1"'))
  assert(mainSource.includes("async function exerciseElectronSmokeTestingPublishResults(win)"))
  assert(mainSource.includes("window.__codekSmokeWorkbenchControls.runTestingPublishResultsSmoke"))
  assert(mainThreadTestingSource.includes('ipcMain.handle("ext-host:testing-publish-results"'))
  assert(mainThreadTestingSource.includes('callEh(EXT_HOST_TESTING_NID, "$publishTestResults"'))
})

test("testing publish results smoke dry-run records renderer/preload/desktop bridge contract", () => {
  assert.equal(
    packageJson.scripts["smoke:workbench:testing-publish-results"],
    "node scripts/electron-ui-smoke.js --testing-publish-results",
  )

  const appSource = fs.readFileSync(path.join(root, "frontend", "vite-project", "src", "App.vue"), "utf8")
  assert(appSource.includes("runTestingPublishResultsSmoke"))
  assert(appSource.includes("globalTestingService.completeRun(runId, \"failed\")"))
  assert(appSource.includes("preloadApiAvailable: typeof window.codek?.publishExtHostTestingResults === \"function\""))
  assert(appSource.includes('data-codek-smoke="testing-results-viewpane-shell-owner"'))
  assert(appSource.includes('data-codek-smoke="testing-explorer-viewpane-shell-owner"'))
  assert(appSource.includes('data-testing-explorer-object-tree="true"'))
  assert(appSource.includes('data-testing-explorer-filter-input="true"'))
  assert(appSource.includes("globalTestingService.getTestResultsViewPaneShellProjection()"))
  assert(appSource.includes("globalTestingService.getTestingExplorerContractProjection()"))
  assert(appSource.includes("explorerDomHookConnected"))

  const payload = runDryRunSmoke("--testing-publish-results")

  assert.equal(payload.ok, true)
  assert.equal(payload.smokeCase, "testing-publish-results")
  assert.equal(payload.blocked, false)
  assertDryRunConsolidation(payload)
  assert.equal(payload.expectedEvidence.stateSource, "TestingService")
  assert.equal(payload.expectedEvidence.preloadApi, "publishExtHostTestingResults")
  assert.equal(payload.expectedEvidence.desktopChannel, "ext-host:testing-publish-results")
  assert.equal(payload.expectedEvidence.extHostMethod, "$publishTestResults")
  assert.equal(payload.expectedEvidence.resultsViewPaneShellSelector, '[data-codek-smoke="testing-results-viewpane-shell-owner"]')
  assert.equal(payload.expectedEvidence.testingExplorerViewPaneShellSelector, '[data-codek-smoke="testing-explorer-viewpane-shell-owner"]')
  assert.equal(payload.expectedEvidence.testingExplorerObjectTreeSelector, '[data-testing-explorer-object-tree="true"]')
  assert.equal(payload.expectedEvidence.testingExplorerFilterInputSelector, '[data-testing-explorer-filter-input="true"]')
  assert.equal(payload.expectedEvidence.testingExplorerStateSource, "TestingService.getTestingExplorerContractProjection()")
  assert.deepEqual(payload.expectedEvidence.testingExplorerOwnerEvidence, {
    viewPaneContainer: "partial-dom-shell-only",
    workbenchObjectTree: "partial-row-projection-only",
    storageService: "partial-external-persisted-state-only",
    menuIds: ["MenuId.TestItem", "MenuId.ViewTitle"],
    fullOwnerClaimed: false,
  })
  assert.deepEqual(payload.expectedEvidence.vscodeOwnerSourceComparison, {
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
  })
  assert.deepEqual(payload.expectedEvidence.minimalExecutableUiOwners, {
    testingExplorerViewPaneShell: 'App.vue data-codek-smoke="testing-explorer-viewpane-shell-owner"',
    testingExplorerObjectTreeRows: "App.vue data-testing-explorer-object-tree rows from TestingService.getTestingExplorerContractProjection()",
    testingExplorerFilterInput: "App.vue readonly data-testing-explorer-filter-input hook from TestingService filter projection",
    testResultsViewPaneShell: 'App.vue data-codek-smoke="testing-results-viewpane-shell-owner" rows from TestingService.getTestResultsViewPaneShellProjection()',
    testResultsViewContentFullOwnerClaimed: false,
  })
  assert.equal(payload.expectedEvidence.noSecondTestingStateSource, true)
  assert.equal(payload.expectedEvidence.fullViewPaneOwnerClaimed, false)
  assert(payload.connectedOwners.includes("desktop/main.js CODEK_ELECTRON_SMOKE_TESTING_PUBLISH_RESULTS dispatcher"))
  assert(payload.connectedOwners.includes("desktop/preload.js publishExtHostTestingResults IPC exposure"))
  assert(payload.partialOwners.some((owner) => owner.includes("Test Results ViewPane shell renders read-only TestingService result history rows")))
  assert(payload.partialOwners.some((owner) => owner.includes("Testing Explorer DOM/filter shell hook renders row/filter/action selectors")))
  assert(payload.partialOwners.some((owner) => owner.includes("ViewPaneContainer, WorkbenchObjectTree, IStorageService/StoredValue, and MenuId.TestItem/ViewTitle owner evidence")))
  assert(payload.blockedOwners.includes("VS Code TestingExplorerView ViewPane owner"))
  assert(payload.blockedOwners.includes("VS Code TestingViewPaneContainer owner"))
  assert(payload.blockedOwners.includes("VS Code WorkbenchObjectTree DOM virtualization owner"))
  assert(payload.blockedOwners.includes("VS Code TestingExplorerFilter input/history owner"))
  assert(payload.blockedOwners.includes("VS Code MenuId.TestItem/ViewTitle action runner owner"))
  assert(payload.blockedOwners.includes("VS Code IStorageService Testing Explorer persistence owner"))
  assert(payload.blockedOwners.includes("VS Code TestResultsViewContent/TestResultsTree DOM owner"))
  assert(!payload.blockedOwners.includes("desktop/main.js CODEK_ELECTRON_SMOKE_TESTING_PUBLISH_RESULTS dispatcher"))
})

test("search navigation smoke dry-run records result tree contract", () => {
  assert.equal(
    packageJson.scripts["smoke:workbench:search-navigation"],
    "node scripts/electron-ui-smoke.js --search-navigation",
  )

  const payload = runDryRunSmoke("--search-navigation")

  assert.equal(payload.ok, true)
  assert.equal(payload.smokeCase, "search-navigation")
  assert.equal(payload.blocked, false)
  assertDryRunConsolidation(payload)
  assert.equal(payload.expectedEvidence.textSearchSource, "globalSearchWorkbenchService.textSearch")
  assert.equal(payload.expectedEvidence.resultTreeSource, "searchWorkbenchService.resultTree")
  assert.equal(payload.expectedEvidence.matchRangeSource, "searchModel.resultTree.matches.occurrences")
  assert.equal(payload.expectedEvidence.noTemporarySearchResultProvider, true)
  assert.equal(payload.expectedEvidence.noRawMatchUiProjection, true)
  assert(payload.intendedRendererHooks.includes("SearchPanel globalSearchWorkbenchService.textSearch(request, token, onProgress)"))
  assert(payload.intendedRendererHooks.includes("SearchPanel renders CodekSearchWorkbenchProjection.resultTree"))
})

test("search replace smoke dry-run records replace preview and apply contract", () => {
  assert.equal(
    packageJson.scripts["smoke:workbench:search-replace"],
    "node scripts/electron-ui-smoke.js --search-replace",
  )

  const payload = runDryRunSmoke("--search-replace")

  assert.equal(payload.ok, true)
  assert.equal(payload.smokeCase, "search-replace")
  assert.equal(payload.blocked, false)
  assertDryRunConsolidation(payload)
  assert.equal(payload.expectedEvidence.textSearchSource, "globalSearchWorkbenchService.textSearch")
  assert.equal(payload.expectedEvidence.resultTreeSource, "searchWorkbenchService.resultTree")
  assert.equal(payload.expectedEvidence.replacePreviewSource, "searchWorkbenchService.previewReplace")
  assert.equal(payload.expectedEvidence.replacePreviewDryRun, true)
  assert.equal(payload.expectedEvidence.replaceApplySource, "searchWorkbenchService.applyReplacePreview")
  assert.equal(payload.expectedEvidence.workspaceMutation, "bulkEditService")
  assert.equal(payload.expectedEvidence.noTemporarySearchResultProvider, true)
  assert.equal(payload.expectedEvidence.noRawMatchReplaceFallback, true)
  assert(payload.intendedRendererHooks.includes("replaceService.replaceOne/replaceAll via bulkEditService.apply"))
  assert(payload.intendedRendererHooks.includes("SearchPanel renders CodekSearchWorkbenchProjection.resultTree"))
})

test("editor openFiles smoke dry-run records service-backed open editors contract", () => {
  assert.equal(
    packageJson.scripts["smoke:workbench:editor-open-files"],
    "node scripts/electron-ui-smoke.js --editor-open-files",
  )

  const payload = runDryRunSmoke("--editor-open-files")

  assert.equal(payload.ok, true)
  assert.equal(payload.smokeCase, "editor-open-files")
  assert.equal(payload.blocked, false)
  assertDryRunConsolidation(payload)
  assert.equal(payload.expectedEvidence.editorGroupsSource, "globalWorkbenchExplorerEditorService.getEditorGroupState")
  assert.equal(payload.expectedEvidence.openEditorsSource, "workbenchExplorerEditorService")
  assert.equal(payload.expectedEvidence.editorPartSource, "EditorPartService")
  assert.equal(payload.expectedEvidence.tabListSource, "workbenchOpenEditorsModel.entries")
  assert.equal(payload.expectedEvidence.noLocalOpenFilesArray, true)
  assert.equal(payload.expectedEvidence.noTemporaryOpenFilesProjection, true)
  assert.equal(payload.expectedEvidence.workspaceMutation, "none")
  assert(payload.intendedRendererHooks.includes("globalWorkbenchExplorerEditorService.getOpenEditorsModel()"))
  assert(payload.intendedRendererHooks.includes("App.vue openFiles computed maps workbenchOpenEditorsModel.entries"))
  assert(payload.intendedRendererHooks.includes("data-workbench-no-local-open-files-state=\"true\""))
})

test("notebook markdown preview smoke dry-run records runnable renderer-message contract", () => {
  assert.equal(
    packageJson.scripts["smoke:workbench:notebook-markdown-preview"],
    "node scripts/electron-ui-smoke.js --notebook-markdown-preview",
  )

  const payload = runDryRunSmoke("--notebook-markdown-preview")

  assert.equal(payload.ok, true)
  assert.equal(payload.smokeCase, "notebook-markdown-preview")
  assert.equal(payload.blocked, false)
  assert.equal(payload.blockedReason, "")
  assertDryRunConsolidation(payload)
  assert.equal(payload.expectedEvidence.notebookServiceId, "notebookService")
  assert.equal(payload.expectedEvidence.markdownPreviewSource, "notebookMarkdownPreviewService")
  assert.equal(payload.expectedEvidence.rendererMessagingSource, "notebookRendererMessagingService")
  assert.equal(payload.expectedEvidence.kernelSource, "notebookKernelService")
  assert.equal(payload.expectedEvidence.noSecondNotebookOrRendererStateSource, true)
  assert.equal(payload.expectedEvidence.payloadRedaction, "renderer message evidence records payload keys only")
  assert.equal(payload.expectedEvidence.realElectronOwner, "App.vue __codekSmokeWorkbenchControls.runNotebookMarkdownPreviewSmoke")
  assert(payload.intendedRendererHooks.includes("App.vue __codekSmokeWorkbenchControls.runNotebookMarkdownPreviewSmoke(input)"))
  assert(payload.intendedRendererHooks.includes("globalNotebookMarkdownPreviewWorkbenchService.openMarkdownPreview({ resource, content })"))
  assert(payload.intendedRendererHooks.includes("globalNotebookMarkdownPreviewWorkbenchService.postNotebookRendererMessage(message)"))
  assert(payload.vscodeSourceReferences.includes("src/vs/workbench/contrib/notebook/common/notebookRendererMessagingService.ts"))
  assert(payload.vscodeSourceReferences.includes("src/vs/workbench/contrib/notebook/browser/view/cellParts/markupCell.ts"))
})

test("accessible view visible owner smoke dry-run records App DOM shell with blocked VS Code owners", () => {
  assert.equal(
    packageJson.scripts["smoke:workbench:accessible-view-visible-owner"],
    "node scripts/electron-ui-smoke.js --accessible-view-visible-owner",
  )

  const smokeSource = fs.readFileSync(smokeScript, "utf8")
  const mainSource = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8")
  assert(smokeSource.includes('CODEK_ELECTRON_SMOKE_ACCESSIBLE_VIEW_VISIBLE_OWNER: shouldRunAccessibleViewVisibleOwner ? "1" : ""'))
  assert(mainSource.includes('const isAccessibleViewVisibleOwnerSmoke = process.env.CODEK_ELECTRON_SMOKE_ACCESSIBLE_VIEW_VISIBLE_OWNER === "1"'))
  assert(mainSource.includes("async function exerciseElectronSmokeAccessibleViewVisibleOwner(win)"))
  assert(mainSource.includes("if (isAccessibleViewVisibleOwnerSmoke) return"))
  assert(mainSource.includes("!isAccessibleViewVisibleOwnerSmoke && !isSearchNavigationSmoke"))
  assert(mainSource.includes("runAccessibleViewVisibleOwnerSmoke"))
  assert(!mainSource.includes('isAccessibleViewVisibleOwnerSmoke && document.body.innerText.includes("已进入任务中心")'))

  const payload = runDryRunSmoke("--accessible-view-visible-owner")

  assert.equal(payload.ok, true)
  assert.equal(payload.smokeCase, "accessible-view-visible-owner")
  assert.equal(payload.blocked, false)
  assert.equal(payload.blockedReason, "")
  assertDryRunConsolidation(payload)
  assert.equal(payload.expectedEvidence.appDomShellOwner, "App.vue accessible-view-dom-shell")
  assert.equal(payload.expectedEvidence.serviceStateSource, "globalAccessibleViewService")
  assert.equal(payload.expectedEvidence.providerLifecycle, "globalAccessibleViewService.show(providerId)")
  assert.equal(payload.expectedEvidence.domShellOwner, "headless-service-adapter")
  assert.equal(payload.expectedEvidence.noSecondAccessibilityState, true)
  assert.equal(payload.expectedEvidence.codeEditorWidgetBacked, false)
  assert.equal(payload.expectedEvidence.contextViewOwner, "missing")
  assert.equal(payload.expectedEvidence.workbenchToolbarBacked, false)
  assert.equal(payload.expectedEvidence.quickPickOwner, "missing")
  assert.equal(payload.expectedEvidence.genericQuickInputReusable, true)
  assert.equal(payload.expectedEvidence.domShellToolbarActionOwner, "App.vue DOM-shell menu-service projection")
  assert.equal(payload.expectedEvidence.domShellToolbarActionId, "editor.action.accessibleViewNext")
  assert.equal(payload.expectedEvidence.domShellToolbarMenuId, "AccessibleView")
  assert.equal(payload.expectedEvidence.domShellToolbarActionContentChanged, true)
  assert.equal(payload.expectedEvidence.focusInvocationOwner, "App.vue editor.focus")
  assert.equal(payload.expectedEvidence.realElectronOwner, "App.vue __codekSmokeWorkbenchControls.runAccessibleViewVisibleOwnerSmoke")
  assert(payload.connectedOwners.includes("App.vue visible DOM shell"))
  assert(payload.connectedOwners.includes("globalAccessibleViewService provider lifecycle"))
  assert(payload.connectedOwners.includes("App.vue DOM-shell menu-service action execution"))
  assert(payload.connectedOwners.includes("App.vue editor.focus restore invocation"))
  assert(payload.partialOwners.includes("AccessibleView command/menu projection"))
  assert(payload.blockedOwners.includes("CodeEditorWidget-backed AccessibleView content owner"))
  assert(payload.blockedOwners.includes("WorkbenchToolBar + MenuId.AccessibleView render lifecycle"))
  assert(payload.blockedOwners.includes("AccessibleViewSymbolQuickPick backed by IQuickInputService.createQuickPick"))
  assert(payload.blockedOwners.includes("IEditorService/CodeEditorWidget-owned focus lifecycle"))
  assert(payload.intendedRendererHooks.includes("App.vue __codekSmokeWorkbenchControls.runAccessibleViewVisibleOwnerSmoke(input)"))
  assert(payload.intendedRendererHooks.includes("data-codek-smoke=\"accessible-view-dom-shell\""))
  assert(payload.intendedRendererHooks.includes("data-accessible-view-action-id=\"editor.action.accessibleViewNext\""))
  assert(payload.intendedRendererHooks.includes("runAccessibleViewDomShellAction('editor.action.accessibleViewNext')"))
  assert(payload.intendedRendererHooks.includes("data-accessible-view-code-editor-backed=\"false\""))
  assert(payload.vscodeSourceReferences.includes("src/vs/workbench/contrib/accessibility/browser/accessibleView.ts"))
  assert(payload.vscodeSourceReferences.includes("src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts"))
})

test("extension install confirmation smoke dry-run records runnable service-backed dialog contract", () => {
  assert.equal(
    packageJson.scripts["smoke:workbench:extension-install-confirmation"],
    "node scripts/electron-ui-smoke.js --extension-install-confirmation",
  )

  const payload = runDryRunSmoke("--extension-install-confirmation")

  assert.equal(payload.ok, true)
  assert.equal(payload.smokeCase, "extension-install-confirmation")
  assert.equal(payload.blocked, false)
  assert.equal(payload.blockedReason, "")
  assertDryRunConsolidation(payload)
  assert.equal(payload.expectedEvidence.serviceId, "extensionsWorkbenchService")
  assert.equal(payload.expectedEvidence.confirmationSource, "ExtensionWorkbenchDetailSummary.requiresConfirmation")
  assert.equal(payload.expectedEvidence.marketplaceInstallConfirmationSource, "extensionsWorkbenchService.resolveInstallConfirmation")
  assert.equal(payload.expectedEvidence.dialogSource, "ExtensionInstallConfirmationSmoke")
  assert.equal(payload.expectedEvidence.dialogCommandId, "workbench.extensions.install")
  assert.equal(payload.expectedEvidence.rendererOwner, "App.vue __codekSmokeWorkbenchControls.runExtensionInstallConfirmationSmoke")
  assert.equal(payload.expectedEvidence.vsixRouteConfirmationSource, "body.confirmed === true")
  assert.equal(payload.expectedEvidence.rollbackSource, "extensionsWorkbenchService.rollback -> /extensions-host/rollback")
  assert.equal(payload.expectedEvidence.fixtureLifecycleSmoke, "scripts/extension-install-smoke.js")
  assert.equal(payload.expectedEvidence.noDefaultConfirmedTrue, true)
  assert.equal(payload.expectedEvidence.noSecondInstallStateSource, true)
  assert(payload.intendedRendererHooks.includes("App.vue __codekSmokeWorkbenchControls.runExtensionInstallConfirmationSmoke(input)"))
  assert(payload.intendedRendererHooks.includes("CodekDialogService modal exposes data-dialog-source=\"ExtensionInstallConfirmationSmoke\""))
  assert(payload.intendedRendererHooks.includes("Marketplace.handleInstall(ext) calls extensionWorkbenchService.open(ext.id, ext.version) before install"))
  assert(payload.intendedRendererHooks.includes("ExtensionDetails.handleRollback calls extensionWorkbenchService.rollback(extensionId)"))
  assert(payload.intendedMainHooks.includes("POST /extensions-host/install-vsix receives confirmed from ehClient.installVsix caller"))
  assert(payload.vscodeSourceReferences.includes("src/vs/workbench/contrib/extensions/browser/extensionsActions.ts"))
  assert(payload.vscodeSourceReferences.includes("src/vs/platform/extensionManagement/common/abstractExtensionManagementService.ts"))
})

test("extension host restart smoke dry-run records route/runtime contract without claiming window reload", () => {
  assert.equal(
    packageJson.scripts["smoke:workbench:extension-host-restart"],
    "node scripts/electron-ui-smoke.js --extension-host-restart",
  )
  assert.equal(
    packageJson.scripts["smoke:workbench:extension-host-restart:runtime"],
    "node scripts/extension-host-restart-smoke.js",
  )

  const payload = runDryRunSmoke("--extension-host-restart")

  assert.equal(payload.ok, true)
  assert.equal(payload.smokeCase, "extension-host-restart")
  assert.equal(payload.blocked, false)
  assert.equal(payload.blockedReason, "")
  assertDryRunConsolidation(payload)
  assert.equal(payload.expectedEvidence.serviceId, "extensionHostLifecycleService")
  assert.equal(payload.expectedEvidence.vscodeContract, "IExtensionService.stopExtensionHosts+startExtensionHosts")
  assert.equal(payload.expectedEvidence.action, "restartExtensionHosts")
  assert.equal(payload.expectedEvidence.reloadRequested, false)
  assert.equal(payload.expectedEvidence.reloaded, false)
  assert.equal(payload.expectedEvidence.noIHostServiceReload, true)
  assert.equal(payload.expectedEvidence.processReplacement, true)
  assert.equal(payload.expectedEvidence.manifestRegistrationAfterRestart, true)
  assert.equal(payload.expectedEvidence.runtimeRouteSmoke, "scripts/extension-host-restart-smoke.js")
  assert.equal(payload.expectedEvidence.electronMainWindowSmoke, "scripts/electron-ui-smoke.js --extension-host-restart")
  assert.equal(payload.expectedEvidence.rendererPreloadMainTrigger, true)
  assert.equal(payload.partialOwners.length, 0)
  assert(payload.intendedMainHooks.includes("POST /extensions-host/lifecycle/restart"))
  assert(payload.intendedMainHooks.includes("desktop/main.js exerciseElectronSmokeExtensionHostRestart"))
  assert(payload.intendedMainHooks.includes("scripts/extension-host-restart-smoke.js starts a real ExtensionHostServer process and dispatches the restart route"))
  assert(payload.intendedRendererHooks.includes("window.codek.restartExtensionHosts(reason, options)"))
  assert(payload.intendedRendererHooks.includes("ehClient.restartExtensionHosts(reason, options)"))
  assert(payload.connectedOwners.includes("desktop/main.js extension-host-restart Electron smoke"))
  assert(payload.connectedOwners.includes("desktop/preload.js window.codek.restartExtensionHosts"))
  assert(payload.connectedOwners.includes("desktop.extensionsHostService lifecycle restart route"))
})

test("file icon theme refresh smoke dry-run records workbench theme service contract", () => {
  assert.equal(
    packageJson.scripts["smoke:workbench:icon-theme-refresh"],
    "node scripts/electron-ui-smoke.js --icon-theme-refresh",
  )

  const payload = runDryRunSmoke("--icon-theme-refresh")

  assert.equal(payload.ok, true)
  assert.equal(payload.smokeCase, "icon-theme-refresh")
  assert.equal(payload.blocked, false)
  assertDryRunConsolidation(payload)
  assert.equal(payload.expectedEvidence.themeServiceId, "workbenchThemeService")
  assert.equal(payload.expectedEvidence.eventSource, "IWorkbenchThemeService.onDidFileIconThemeChange")
  assert.equal(payload.expectedEvidence.initialThemeId, "vs-seti")
  assert.equal(payload.expectedEvidence.changedThemeId, "minimal")
  assert.equal(payload.expectedEvidence.noStaticIconMapFallback, true)
  assert.equal(payload.expectedEvidence.noSecondFileIconThemeStateSource, true)
  assert(payload.intendedRendererHooks.includes("workbenchThemeService.getFileIconTheme()"))
  assert(payload.intendedRendererHooks.includes("workbenchThemeService.onDidFileIconThemeChange(listener)"))
  assert(payload.intendedRendererHooks.includes(".codek-explorer-icon[data-file-icon-theme-id][data-file-icon-source]"))
})
