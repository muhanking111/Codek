const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const { buildAndSaveReleaseEvidence, currentReleaseGateReport, parseArgs, readOrchestratorRuns } = require("./release-evidence-export")
const betaTrialPlan = require("./beta-trial-plan")
const betaTrialRun = require("./beta-trial-run")

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, value, "utf8")
}

function snapshotFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const files = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const filePath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(filePath)
      } else if (entry.isFile()) {
        files.push(filePath)
      }
    }
  }
  return files.sort().map((filePath) => ({
    path: path.relative(dir, filePath).replace(/\\/g, "/"),
    mtimeMs: fs.statSync(filePath).mtimeMs,
    content: fs.readFileSync(filePath, "utf8"),
  }))
}

test("parseArgs supports report dir and current release gate mode", () => {
  const parsed = parseArgs(["--report-dir=C:/tmp/codek", "--current-release-gate-mode=public-candidate-upstream", "--no-write"])

  assert.equal(parsed.reportDir, "C:/tmp/codek")
  assert.equal(parsed.currentReleaseGateMode, "public-candidate-upstream")
  assert.equal(parsed.noWrite, true)
})

test("currentReleaseGateReport marks upstream gate as ready without finalizing the run", () => {
  const report = currentReleaseGateReport("public-candidate-upstream")

  assert.equal(report.ready, true)
  assert.equal(report.upstreamReady, true)
  assert.equal(report.mode, "public-candidate-upstream")
  assert.equal(report.status, "upstream-ready")
})

test("release evidence export writes latest evidence and readiness artifacts", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-evidence-export-"))
  fs.mkdirSync(reportDir, { recursive: true })
  betaTrialPlan.save(betaTrialPlan.buildBetaTrialPlan({ createdAt: 1 }), { reportDir })
  betaTrialRun.saveBetaTrialRunReport(betaTrialRun.buildBetaTrialRunReport({
    createdAt: 1,
    taskResults: Array.from({ length: 10 }, (_, index) => ({
      id: `BD-T${String(index + 1).padStart(2, "0")}`,
      title: "fixture",
      expectedStrategy: index < 2 ? "single-agent" : "multi-agent",
      actualStrategy: index < 2 ? "single-agent" : "multi-agent",
      runId: `run_${index + 1}`,
      projectKind: "fixture",
      status: "passed",
      decisionPath: index === 7 ? "ask_user" : index === 8 ? "rollback" : "accepted",
      qualityGateStatus: index === 4 ? "failed" : "passed",
      recoveryActions: index === 7 ? ["ask_user"] : [],
      filesChanged: 1,
      mainWorkspaceProtected: true,
      rollbackVerified: index === 8,
      promptHash: "hash",
      promptLength: 10,
      evidence: {
        diffAvailable: true,
        reportSaved: true,
        attachmentMetadata: index === 6,
        releaseEvidence: index === 9,
      },
    })),
    feedbackEntries: [{
      feedbackId: "fb-cli-1",
      taskId: "BD-T03",
      runId: "run_3",
      status: "failed",
      severity: "P1",
      title: "人工反馈 fixture",
      screenshotPath: "D:/Workspace/screens/fb-cli-1.png",
      defectStatus: "verified",
      regressionEvidence: { runId: "run_regression_1" },
    }],
  }), { reportDir })
  fs.writeFileSync(path.join(reportDir, "workbench-deep-smoke-latest.json"), `${JSON.stringify({
    reportKind: "workbench-deep-smoke",
    ready: true,
    taskRunEvidence: [{
      id: "fixture_task_graph",
      name: "Fixture Task Graph",
      status: "passed",
      startedAt: 100,
      finishedAt: 105,
      durationMs: 5,
      blocked: [],
      steps: [{
        id: "build",
        name: "Task: build",
        status: "passed",
        command: "npm run build",
        workingDir: "D:/Workspace",
        exitCode: 0,
        durationMs: 5,
        runMode: "sequence",
        dependencyDepth: 0,
        outputPreview: "ok",
        errorPreview: "",
      }],
    }],
    taskTerminalReuseRegistry: {
      source: "TaskTerminalReuseRegistry",
      stateSource: "terminalManager/taskTerminalReuseRegistry",
      sameTaskCount: 1,
      idleTaskCount: 1,
      supportsPhysicalReuse: false,
      missingPhysicalReuseOwner: "terminal shell owner with reuseTerminal(launchConfigs)",
      sameTaskTerminals: [{ taskId: "watch", terminalInstanceId: 77, status: "active", executionId: "watch:run-1" }],
      idleTaskTerminals: [{ taskId: "build", terminalInstanceId: 78, status: "idle", executionId: "build:run-1" }],
      constraints: { noSecondTaskState: true, noExternalVscodeSourceReference: true, runtimeReference: false },
      vscodeSourcePath: "src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts",
      currentSourcePath: "frontend/vite-project/src/terminal/terminalManager.ts",
    },
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "explorer-fs-parity-latest.json"), `${JSON.stringify({
    reportKind: "explorer-fs-parity",
    ready: true,
    status: "ready",
    projectPath: "D:/Workspace",
    checkCount: 4,
    passed: 4,
    latestJsonPath: path.join(reportDir, "explorer-fs-parity-latest.json"),
    latestMarkdownPath: path.join(reportDir, "explorer-fs-parity-latest.md"),
    checks: [
      { id: "root", path: "D:/Workspace", source: "explorer", status: "passed", fsCount: 38, codekCount: 38, truncated: false, sentinelCount: 0, missing: [], extra: [], typeMismatches: [] },
      { id: "frontend", path: "D:/Workspace/frontend", source: "explorer", status: "passed", fsCount: 2, codekCount: 2, truncated: false, sentinelCount: 0, missing: [], extra: [], typeMismatches: [] },
      { id: "frontend_vite-project", path: "D:/Workspace/frontend/vite-project", source: "explorer", status: "passed", fsCount: 22, codekCount: 22, truncated: false, sentinelCount: 0, missing: [], extra: [], typeMismatches: [] },
      { id: "scripts", path: "D:/Workspace/scripts", source: "explorer", status: "passed", fsCount: 120, codekCount: 120, truncated: false, sentinelCount: 0, missing: [], extra: [], typeMismatches: [] },
    ],
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "explorer-fs-parity-latest.md"), "# Explorer FS Parity\n", "utf8")
  fs.writeFileSync(path.join(reportDir, "shell-integration-smoke-latest.json"), `${JSON.stringify({
    reportKind: "shell-integration-smoke",
    ready: true,
    status: "ready",
    summary: { total: 2, passed: 2, skipped: 0, failed: 0 },
    checks: [
      { shellType: "powershell", ok: true, skipped: false, durationMs: 1 },
      { shellType: "cmd", ok: true, skipped: false, durationMs: 1 },
    ],
    latestMarkdownPath: path.join(reportDir, "shell-integration-smoke-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "debug-adapter-smoke-latest.json"), `${JSON.stringify({
    reportKind: "debug-adapter-smoke",
    ready: true,
    status: "ready",
    summary: { total: 3, passed: 1, skipped: 2, failed: 0 },
    checks: [
      {
        id: "fixture",
        status: "passed",
        adapterAvailable: true,
        evidence: {
          metadataOnly: true,
          requestCommands: {
            setBreakpoints: true,
            configurationDone: true,
            stackTrace: true,
            scopes: true,
            variables: true,
            continue: true,
            next: true,
            terminate: true,
          },
          breakpoints: { verified: 1 },
          stackTrace: { frameCount: 1, sourcePathIncluded: false },
          scopes: { scopeCount: 1 },
          variables: { variableCount: 1, valueSamplesIncluded: false },
          bridgeEvidence: {
            source: "desktopDebugService",
            serviceId: "debugService",
            stateSource: "dapSessions",
            latestRequestCount: 8,
            latestEventCount: 3,
            noSecondDapState: true,
            evidenceSafeActions: true,
            redactsCommandArguments: true,
          },
          redaction: {
            expressionValuesRedacted: true,
            sourcePathsRedacted: true,
            adapterArgumentsRedacted: true,
          },
        },
      },
      { id: "node", status: "skipped", adapterAvailable: false },
      { id: "python", status: "skipped", adapterAvailable: false },
    ],
    latestMarkdownPath: path.join(reportDir, "debug-adapter-smoke-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "router-calibration-smoke-latest.json"), `${JSON.stringify({
    reportKind: "router-calibration-smoke",
    ready: true,
    status: "ready",
    minSamples: 100,
    summary: {
      total: 120,
      passed: 110,
      failed: 10,
      recommendationAligned: 110,
      routerAligned: 110,
      misaligned: 10,
      failureReports: 10,
      sampleCountOk: true,
      failureReportOk: true,
    },
    shadow: { recommendation: "keep-current-router" },
    latestMarkdownPath: path.join(reportDir, "router-calibration-smoke-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "extension-compatibility-latest.json"), `${JSON.stringify({
    reportKind: "extension-compatibility-report",
    ready: true,
    status: "ready",
    statusLabel: "Extension compatibility report ready",
    summary: { total: 2, native: 1, compatible: 1, degraded: 0, blocked: 0, passed: 2, warning: 0, failed: 0 },
    checks: [
      { id: "sample.extension-a", title: "sample.extension-a", status: "passed" },
      { id: "sample.extension-b", title: "sample.extension-b", status: "passed" },
    ],
    latestJsonPath: path.join(reportDir, "extension-compatibility-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-compatibility-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "extension-marketplace-smoke-latest.json"), `${JSON.stringify({
    reportKind: "extension-marketplace-smoke",
    ready: true,
    status: "ready",
    summary: { total: 5, passed: 5, warning: 0, failed: 0 },
    searchSamples: [{ query: "python", count: 3, top: [{ id: "ms-python.python" }] }],
    inspected: [{
      id: "ms-python.python",
      ok: true,
      detailsReady: true,
      readmeReady: true,
      versionsReady: true,
      installPlanReady: true,
    }],
    latestJsonPath: path.join(reportDir, "extension-marketplace-smoke-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-marketplace-smoke-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "extension-install-smoke-latest.json"), `${JSON.stringify({
    reportKind: "extension-install-smoke",
    ready: true,
    status: "degraded",
    summary: { total: 6, passed: 5, warning: 1, failed: 0 },
    checks: [
      { id: "fixture_vsix_created", status: "passed" },
      { id: "fixture_install", status: "passed" },
      { id: "fixture_update", status: "passed" },
      { id: "fixture_rollback", status: "passed" },
      { id: "fixture_uninstall", status: "passed" },
      { id: "marketplace_install_authorization", status: "warning" },
    ],
    artifacts: [{ name: "fixture-vsix-v1" }, { name: "fixture-vsix-v2" }],
    marketplace: { authorized: false, extensionId: "esbenp.prettier-vscode" },
    latestJsonPath: path.join(reportDir, "extension-install-smoke-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-install-smoke-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "extension-marketplace-install-matrix-latest.json"), `${JSON.stringify({
    reportKind: "extension-marketplace-install-matrix",
    ready: true,
    status: "ready",
    thresholds: { minMetadata: 2, minInstallChain: 2, minActivationPreflight: 2 },
    summary: {
      top: 2,
      sampled: 2,
      metadataUsable: 2,
      downloaded: 2,
      extracted: 2,
      manifestScanned: 2,
      installChainComplete: 2,
      activationPreflightReady: 2,
      failed: 0,
    },
    installation: { isolated: true },
    latestJsonPath: path.join(reportDir, "extension-marketplace-install-matrix-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-marketplace-install-matrix-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "extension-migration-smoke-latest.json"), `${JSON.stringify({
    reportKind: "extension-migration-smoke",
    ready: true,
    status: "ready",
    summary: { total: 5, passed: 5, warning: 0, failed: 0 },
    source: "cursor",
    dryRun: true,
    evidence: {
      preview: { settingsCount: 2, keybindingsCount: 1, snippetsCount: 1, extensionsCount: 3 },
      queue: { total: 3, pending: 3, installed: 0, failed: 0, installPolicy: "user-confirmed" },
    },
    checks: [
      { id: "dry_run_no_auto_install", status: "passed" },
    ],
    latestJsonPath: path.join(reportDir, "extension-migration-smoke-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-migration-smoke-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "extension-security-smoke-latest.json"), `${JSON.stringify({
    reportKind: "extension-security-smoke",
    ready: true,
    status: "ready",
    summary: { total: 4, passed: 4, warning: 0, failed: 0 },
    checks: [
      { id: "restricted_workspace_blocks_install", status: "passed" },
      { id: "unknown_workspace_requires_confirmation", status: "passed" },
      { id: "publisher_deny_policy", status: "passed" },
      { id: "audit_log_redacts_secrets", status: "passed" },
    ],
    latestJsonPath: path.join(reportDir, "extension-security-smoke-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-security-smoke-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "extension-host-restart-smoke-latest-result.json"), `${JSON.stringify({
    smokeCase: "extension-host-restart",
    mode: "runtime-route-smoke",
    ok: true,
    route: "POST /extensions-host/lifecycle/restart",
    before: { isRunning: true, pid: 111, installedExtensionsRegistered: true },
    after: { isRunning: true, pid: 222, processReplaced: true, installedExtensionsRegistered: true },
    evidence: {
      serviceId: "extensionHostLifecycleService",
      vscodeContract: "IExtensionService.stopExtensionHosts+startExtensionHosts",
      action: "restartExtensionHosts",
      restartRequested: true,
      restartObserved: true,
      restarted: true,
      reloadRequested: false,
      reloaded: false,
      hostKind: "LocalProcess",
      hostSource: "ExtensionHostServer",
      lifecyclePhase: "restarted",
      activationReplay: "preserveRequestedActivationEvents",
      blockedBy: "none",
      blockedReason: "",
      stopEvidence: {
        action: "stopExtensionHosts",
        stopped: true,
        lifecyclePhase: "stopped",
      },
      startEvidence: {
        action: "startExtensionHosts",
        started: true,
        lifecyclePhase: "started",
      },
    },
    manifestState: {
      registeredAfterRestart: true,
      emptyFixtureAccepted: true,
    },
    smokeConsolidation: {
      status: "connected",
      ok: true,
      failedCount: 0,
      resultFile: path.join(reportDir, "extension-host-restart-smoke-latest-result.json"),
    },
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "eh-e2e-marketplace-latest.json"), `${JSON.stringify({
    reportKind: "eh-e2e-marketplace",
    ready: true,
    status: "ready",
    phase: "done",
    extensionId: "streetsidesoftware.code-spell-checker-spanish",
    searchCount: 5,
    latestJsonPath: path.join(reportDir, "eh-e2e-marketplace-latest.json"),
    latestMarkdownPath: path.join(reportDir, "eh-e2e-marketplace-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "eh-e2e-memento-storage-latest.json"), `${JSON.stringify({
    reportKind: "eh-e2e-memento-storage",
    ready: true,
    status: "ready",
    extensionId: "codek-smoke.memento-storage-smoke",
    profileId: "__default__profile__",
    globalStateStored: true,
    workspaceStateStored: true,
    syncKeysStored: true,
    thirdPartyExtensionId: "sample-vendor.memento-storage-third-party-smoke",
    thirdPartyExtensionScanned: true,
    thirdPartyExtensionBuiltinFalse: true,
    thirdPartyInstalledMarkerPresent: true,
    thirdPartyGlobalStateStored: true,
    thirdPartyWorkspaceStateStored: true,
    thirdPartySyncKeysStored: true,
    legacyStorageWritten: false,
    latestJsonPath: path.join(reportDir, "eh-e2e-memento-storage-latest.json"),
    latestMarkdownPath: path.join(reportDir, "eh-e2e-memento-storage-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "eh-e2e-extension-context-latest.json"), `${JSON.stringify({
    reportKind: "eh-e2e-extension-context",
    ready: true,
    status: "ready",
    extensionId: "sample-vendor.extension-context-third-party-smoke",
    thirdPartyExtensionScanned: true,
    thirdPartyExtensionBuiltinFalse: true,
    thirdPartyInstalledMarkerPresent: true,
    packageJsonPreserved: true,
    extensionUriFile: true,
    extensionPathMatches: true,
    asAbsolutePathWorks: true,
    storageUriFile: true,
    globalStorageUriFile: true,
    logUriFile: true,
    passedChecks: 8,
    checkCount: 8,
    latestJsonPath: path.join(reportDir, "eh-e2e-extension-context-latest.json"),
    latestMarkdownPath: path.join(reportDir, "eh-e2e-extension-context-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "eh-e2e-implicit-activation-latest.json"), `${JSON.stringify({
    reportKind: "eh-e2e-implicit-activation",
    ready: true,
    status: "ready",
    extensionId: "sample-vendor.implicit-activation-third-party-smoke",
    activationEvent: "onCommand:thirdPartySmoke.implicitActivation",
    thirdPartyExtensionScanned: true,
    thirdPartyExtensionBuiltinFalse: true,
    thirdPartyInstalledMarkerPresent: true,
    manifestHasExplicitActivationEvents: false,
    implicitOnCommandGenerated: true,
    activationEventsByEventHasExtension: true,
    activatedByImplicitEvent: true,
    commandContributionPreserved: true,
    latestJsonPath: path.join(reportDir, "eh-e2e-implicit-activation-latest.json"),
    latestMarkdownPath: path.join(reportDir, "eh-e2e-implicit-activation-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "eh-e2e-dependency-loop-latest.json"), `${JSON.stringify({
    reportKind: "eh-e2e-dependency-loop",
    ready: true,
    status: "ready",
    loopExtensionIds: ["codek.loop-a", "codek.loop-b"],
    healthyExtensionId: "codek.good",
    removedDueToLooping: ["codek.loop-a", "codek.loop-b"],
    loopExtensionsAbsentFromAllExtensions: true,
    loopExtensionsAbsentFromById: true,
    loopActivationEventsAbsent: true,
    loopActivationEventsByEventAbsent: true,
    initDataLoopExtensionsAbsent: true,
    initDataMyExtensionsLoopAbsent: true,
    healthyExtensionScanned: true,
    healthyActivationEventIndexed: true,
    healthyExtensionInInitData: true,
    healthyActivated: true,
    latestJsonPath: path.join(reportDir, "eh-e2e-dependency-loop-latest.json"),
    latestMarkdownPath: path.join(reportDir, "eh-e2e-dependency-loop-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "eh-e2e-search-provider-latest.json"), `${JSON.stringify({
    reportKind: "eh-e2e-search-provider",
    ready: true,
    status: "ready",
    extensionId: "sample-vendor.search-provider-third-party-smoke",
    activationEvent: "onSearch:file",
    thirdPartyExtensionScanned: true,
    thirdPartyExtensionBuiltinFalse: true,
    thirdPartyInstalledMarkerPresent: true,
    activationEventsByEventHasExtension: true,
    enabledApiProposalsPresent: true,
    textProviderRegistered: true,
    fileProviderRegistered: true,
    activatedByOnSearchFile: true,
    textProviderCalled: true,
    fileProviderCalled: true,
    textSearchEngine: "extension-search",
    textSearchProvider: "extension-host",
    fileSearchEngine: "extension-search",
    fallbackBypassed: true,
    providerErrors: [],
    latestJsonPath: path.join(reportDir, "eh-e2e-search-provider-latest.json"),
    latestMarkdownPath: path.join(reportDir, "eh-e2e-search-provider-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "eh-e2e-profile-content-handler-latest.json"), `${JSON.stringify({
    reportKind: "eh-e2e-profile-content-handler",
    ready: true,
    status: "ready",
    extensionId: "sample-vendor.profile-content-handler-third-party-smoke",
    activationEvent: "onProfile:third-party-profile",
    handlerId: "third-party-profile",
    thirdPartyExtensionScanned: true,
    thirdPartyExtensionBuiltinFalse: true,
    thirdPartyInstalledMarkerPresent: true,
    activationEventsByEventHasExtension: true,
    enabledApiProposalsPresent: true,
    activatedByOnProfileHandler: true,
    handlerRegistered: true,
    handlerMetadataMatched: true,
    readProfileCalled: true,
    readProfileReturnedTemplate: true,
    saveProfileCalled: true,
    saveProfileReturnedResult: true,
    cleanupAfterStop: true,
    handlerCount: 1,
    readContentLength: 128,
    providerErrors: [],
    latestJsonPath: path.join(reportDir, "eh-e2e-profile-content-handler-latest.json"),
    latestMarkdownPath: path.join(reportDir, "eh-e2e-profile-content-handler-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "installed-mcp-discovery-latest.json"), `${JSON.stringify({
    reportKind: "installed-mcp-discovery-smoke",
    ready: true,
    status: "ready",
    extensionId: "publisher.installed-mcp-tools",
    installedMcpPersisted: true,
    installedDiscoveryRead: true,
    installedRegistryApplied: true,
    workspaceDiscoveryFilteredInRegistryMode: true,
    secretRedactionVerified: true,
    providerErrors: [],
    latestJsonPath: path.join(reportDir, "installed-mcp-discovery-latest.json"),
    latestMarkdownPath: path.join(reportDir, "installed-mcp-discovery-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "installed-mcp-discovery-latest.md"), "# Installed MCP discovery\n", "utf8")
  fs.writeFileSync(path.join(reportDir, "mcp-gallery-management-latest.json"), `${JSON.stringify({
    reportKind: "mcp-gallery-management-smoke",
    ready: true,
    status: "ready",
    galleryInstallReady: true,
    workspaceResourceWritten: true,
    workspaceRegistryConsumed: true,
    workbenchRegistryRouteReady: true,
    registryRouteSnapshot: { collections: 1, servers: 1, delegates: 1 },
    galleryUninstallReady: true,
    lifecycleEventsEmitted: true,
    providerErrors: [],
    latestJsonPath: path.join(reportDir, "mcp-gallery-management-latest.json"),
    latestMarkdownPath: path.join(reportDir, "mcp-gallery-management-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "mcp-gallery-management-latest.md"), "# MCP Gallery management\n", "utf8")
  fs.writeFileSync(path.join(reportDir, "eh-e2e-mcp-provider-latest.json"), `${JSON.stringify({
    reportKind: "mcp-provider-bridge-smoke",
    ready: true,
    status: "ready",
    extensionId: "publisher.sample",
    collectionId: "publisher.sample/sample-provider",
    mainThreadMcpRegistered: true,
    definitionsPublishedToExtHost: true,
    delegateTransportStarted: true,
    secretRedactionVerified: true,
    deletePublishesEmptyDefinitions: true,
    providerErrors: [],
    latestJsonPath: path.join(reportDir, "eh-e2e-mcp-provider-latest.json"),
    latestMarkdownPath: path.join(reportDir, "eh-e2e-mcp-provider-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "extension-compatibility-matrix-latest.json"), `${JSON.stringify({
    reportKind: "extension-compatibility-matrix",
    ready: true,
    status: "degraded",
    summary: {
      top: 100,
      sampled: 2,
      native: 0,
      compatible: 1,
      degraded: 1,
      blocked: 0,
      unsupportedContributionPoints: 0,
      partialContributionPoints: 1,
    },
    extensions: [
      { rank: 1, id: "ms-python.python", source: "marketplace", status: "compatible", unsupportedContributionPoints: [], partialContributionPoints: [] },
      { rank: 2, id: "dbaeumer.vscode-eslint", source: "marketplace", status: "degraded", unsupportedContributionPoints: [], partialContributionPoints: ["debuggers"] },
    ],
    latestJsonPath: path.join(reportDir, "extension-compatibility-matrix-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-compatibility-matrix-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "extension-enterprise-gate-latest.json"), `${JSON.stringify({
    reportKind: "extension-enterprise-gate",
    ready: true,
    status: "ready",
    statusLabel: "扩展生态企业级门禁已通过",
    summary: { total: 5, passed: 5, warning: 0, failed: 0 },
    gaps: [],
    latestJsonPath: path.join(reportDir, "extension-enterprise-gate-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-enterprise-gate-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "extension-plan-completion-audit-latest.json"), `${JSON.stringify({
    reportKind: "extension-plan-completion-audit",
    ready: true,
    status: "ready-with-manual-evidence-required",
    enterpriseComplete: false,
    summary: { total: 28, passed: 27, manualRequired: 1, missing: 0 },
    latestJsonPath: path.join(reportDir, "extension-plan-completion-audit-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-plan-completion-audit-latest.md"),
  }, null, 2)}\n`, "utf8")
  const saved = buildAndSaveReleaseEvidence({
    reportDir,
    currentReleaseGateMode: "public-candidate-upstream",
    runs: [],
  })

  assert.equal(saved.report.reportKind, "release-evidence")
  assert.equal(saved.report.summary.manualRealUiConfirmed, false)
  assert.equal(saved.report.gaps.some((gap) => gap.id === "manual_real_ui_evidence" && gap.severity === "low"), true)
  assert.equal(saved.report.gaps.some((gap) => gap.id === "manual_real_ui_evidence" && gap.severity !== "low"), false)
  assert.equal(saved.report.summary.blockingGaps, saved.report.gaps.filter((gap) => gap.severity !== "low" && gap.severity !== "info").length)
  assert.equal(saved.report.ready, saved.report.summary.baseReady)
  assert.equal(saved.report.summary.enterpriseComplete, false)
  assert.equal(fs.existsSync(saved.jsonPath), true)
  assert.equal(fs.existsSync(saved.markdownPath), true)
  assert.equal(fs.existsSync(path.join(reportDir, "orchestrator-readiness-latest.json")), true)
  assert.equal(saved.report.evidence.releaseGate.ready, true)
  assert.equal(saved.report.evidence.explorerFsParity.ready, true)
  assert.equal(saved.report.evidence.explorerFsParity.passed, 4)
  assert.equal(saved.report.evidence.explorerFsParity.missing, 0)
  assert.equal(saved.report.evidence.bdUserTrial.ready, true)
  assert.equal(saved.report.evidence.betaTrialRun.ready, true)
  assert.equal(saved.report.evidence.betaFeedback.ready, true)
  assert.equal(saved.report.evidence.betaFeedback.imported, 1)
  assert.equal(saved.report.evidence.shellIntegration.ready, true)
  assert.equal(saved.report.evidence.debugAdapterSmoke.ready, true)
  assert.equal(saved.report.evidence.debugAdapterSmoke.fixturePassed, true)
  assert.equal(saved.report.evidence.routerCalibration.ready, true)
  assert.equal(saved.report.evidence.routerCalibration.total, 120)
  assert.equal(saved.report.evidence.arHealth.compatibility.ready, true)
  assert.equal(saved.report.evidence.extensionMarketplaceSmoke.ready, true)
  assert.equal(saved.report.evidence.extensionMarketplaceSmoke.installPlanReady, 1)
  assert.equal(saved.report.evidence.extensionInstallSmoke.ready, true)
  assert.equal(saved.report.evidence.extensionInstallSmoke.fixtureInstallPassed, true)
  assert.equal(saved.report.evidence.extensionInstallSmoke.fixtureRollbackPassed, true)
  assert.equal(saved.report.evidence.extensionMarketplaceInstallMatrix.ready, true)
  assert.equal(saved.report.evidence.extensionMarketplaceInstallMatrix.installChainComplete, 2)
  assert.equal(saved.report.evidence.extensionMigrationSmoke.ready, true)
  assert.equal(saved.report.evidence.extensionMigrationSmoke.dryRunNoAutoInstall, true)
  assert.equal(saved.report.evidence.extensionSecuritySmoke.ready, true)
  assert.equal(saved.report.evidence.extensionHostRestartSmoke.ready, true)
  assert.equal(saved.report.evidence.extensionHostRestartSmoke.restartRequested, true)
  assert.equal(saved.report.evidence.extensionHostRestartSmoke.restartObserved, true)
  assert.equal(saved.report.evidence.extensionHostRestartSmoke.processReplaced, true)
  assert.equal(saved.report.evidence.extensionHostRestartSmoke.hostKind, "LocalProcess")
  assert.equal(saved.report.evidence.extensionHostRestartSmoke.hostSource, "ExtensionHostServer")
  assert.equal(saved.report.evidence.extensionHostRestartSmoke.lifecyclePhase, "restarted")
  assert.equal(saved.report.evidence.extensionHostRestartSmoke.activationReplay, "preserveRequestedActivationEvents")
  assert.equal(saved.report.evidence.extensionHostRestartSmoke.blockedReason, "")
  assert.equal(saved.report.evidence.extensionSecuritySmoke.auditRedactsSecrets, true)
  assert.equal(saved.report.evidence.ehMarketplaceE2e.ready, true)
  assert.equal(saved.report.evidence.ehMarketplaceE2e.phase, "done")
  assert.equal(saved.report.evidence.ehMarketplaceE2e.extensionId, "streetsidesoftware.code-spell-checker-spanish")
  assert.equal(saved.report.evidence.ehMementoStorageE2e.ready, true)
  assert.equal(saved.report.evidence.ehMementoStorageE2e.globalStateStored, true)
  assert.equal(saved.report.evidence.ehMementoStorageE2e.workspaceStateStored, true)
  assert.equal(saved.report.evidence.ehMementoStorageE2e.syncKeysStored, true)
  assert.equal(saved.report.evidence.ehMementoStorageE2e.thirdPartyExtensionScanned, true)
  assert.equal(saved.report.evidence.ehMementoStorageE2e.thirdPartyExtensionBuiltinFalse, true)
  assert.equal(saved.report.evidence.ehMementoStorageE2e.thirdPartyGlobalStateStored, true)
  assert.equal(saved.report.evidence.ehMementoStorageE2e.thirdPartyWorkspaceStateStored, true)
  assert.equal(saved.report.evidence.ehMementoStorageE2e.thirdPartySyncKeysStored, true)
  assert.equal(saved.report.evidence.ehMementoStorageE2e.legacyStorageWritten, false)
  assert.equal(saved.report.evidence.ehExtensionContextE2e.ready, true)
  assert.equal(saved.report.evidence.ehExtensionContextE2e.packageJsonPreserved, true)
  assert.equal(saved.report.evidence.ehExtensionContextE2e.extensionUriFile, true)
  assert.equal(saved.report.evidence.ehExtensionContextE2e.extensionPathMatches, true)
  assert.equal(saved.report.evidence.ehExtensionContextE2e.asAbsolutePathWorks, true)
  assert.equal(saved.report.evidence.ehExtensionContextE2e.storageUriFile, true)
  assert.equal(saved.report.evidence.ehExtensionContextE2e.globalStorageUriFile, true)
  assert.equal(saved.report.evidence.ehExtensionContextE2e.logUriFile, true)
  assert.equal(saved.report.evidence.ehImplicitActivationE2e.ready, true)
  assert.equal(saved.report.evidence.ehImplicitActivationE2e.manifestHasExplicitActivationEvents, false)
  assert.equal(saved.report.evidence.ehImplicitActivationE2e.implicitOnCommandGenerated, true)
  assert.equal(saved.report.evidence.ehImplicitActivationE2e.activatedByImplicitEvent, true)
  assert.equal(saved.report.evidence.ehDependencyLoopE2e.ready, true)
  assert.deepEqual(saved.report.evidence.ehDependencyLoopE2e.removedDueToLooping, ["codek.loop-a", "codek.loop-b"])
  assert.equal(saved.report.evidence.ehDependencyLoopE2e.loopExtensionsAbsentFromAllExtensions, true)
  assert.equal(saved.report.evidence.ehDependencyLoopE2e.loopExtensionsAbsentFromById, true)
  assert.equal(saved.report.evidence.ehDependencyLoopE2e.initDataLoopExtensionsAbsent, true)
  assert.equal(saved.report.evidence.ehDependencyLoopE2e.initDataMyExtensionsLoopAbsent, true)
  assert.equal(saved.report.evidence.ehDependencyLoopE2e.healthyActivated, true)
  assert.equal(saved.report.evidence.ehSearchProviderE2e.ready, true)
  assert.equal(saved.report.evidence.ehSearchProviderE2e.textProviderCalled, true)
  assert.equal(saved.report.evidence.ehSearchProviderE2e.fileProviderCalled, true)
  assert.equal(saved.report.evidence.ehSearchProviderE2e.textSearchEngine, "extension-search")
  assert.equal(saved.report.evidence.ehSearchProviderE2e.textSearchProvider, "extension-host")
  assert.equal(saved.report.evidence.ehSearchProviderE2e.fileSearchEngine, "extension-search")
  assert.equal(saved.report.evidence.ehSearchProviderE2e.fallbackBypassed, true)
  assert.equal(saved.report.evidence.ehSearchProviderE2e.providerErrors, 0)
  assert.equal(saved.report.evidence.ehProfileContentHandlerE2e.ready, true)
  assert.equal(saved.report.evidence.ehProfileContentHandlerE2e.handlerRegistered, true)
  assert.equal(saved.report.evidence.ehProfileContentHandlerE2e.handlerMetadataMatched, true)
  assert.equal(saved.report.evidence.ehProfileContentHandlerE2e.readProfileCalled, true)
  assert.equal(saved.report.evidence.ehProfileContentHandlerE2e.readProfileReturnedTemplate, true)
  assert.equal(saved.report.evidence.ehProfileContentHandlerE2e.saveProfileCalled, true)
  assert.equal(saved.report.evidence.ehProfileContentHandlerE2e.saveProfileReturnedResult, true)
  assert.equal(saved.report.evidence.ehProfileContentHandlerE2e.cleanupAfterStop, true)
  assert.equal(saved.report.evidence.ehProfileContentHandlerE2e.providerErrors, 0)
  assert.equal(saved.report.evidence.installedMcpDiscovery.ready, true)
  assert.equal(saved.report.evidence.installedMcpDiscovery.installedMcpPersisted, true)
  assert.equal(saved.report.evidence.installedMcpDiscovery.installedDiscoveryRead, true)
  assert.equal(saved.report.evidence.installedMcpDiscovery.installedRegistryApplied, true)
  assert.equal(saved.report.evidence.installedMcpDiscovery.workspaceDiscoveryFilteredInRegistryMode, true)
  assert.equal(saved.report.evidence.installedMcpDiscovery.secretRedactionVerified, true)
  assert.equal(saved.report.evidence.installedMcpDiscovery.providerErrors, 0)
  assert.equal(saved.report.evidence.mcpGalleryManagement.ready, true)
  assert.equal(saved.report.evidence.mcpGalleryManagement.galleryInstallReady, true)
  assert.equal(saved.report.evidence.mcpGalleryManagement.workspaceResourceWritten, true)
  assert.equal(saved.report.evidence.mcpGalleryManagement.workspaceRegistryConsumed, true)
  assert.equal(saved.report.evidence.mcpGalleryManagement.workbenchRegistryRouteReady, true)
  assert.equal(saved.report.evidence.mcpGalleryManagement.registryRouteSnapshot.collections, 1)
  assert.equal(saved.report.evidence.mcpGalleryManagement.registryRouteSnapshot.servers, 1)
  assert.equal(saved.report.evidence.mcpGalleryManagement.registryRouteSnapshot.delegates, 1)
  assert.equal(saved.report.evidence.mcpGalleryManagement.galleryUninstallReady, true)
  assert.equal(saved.report.evidence.mcpGalleryManagement.lifecycleEventsEmitted, true)
  assert.equal(saved.report.evidence.mcpGalleryManagement.providerErrors, 0)
  assert.equal(saved.report.evidence.ehMcpProviderBridge.ready, true)
  assert.equal(saved.report.evidence.ehMcpProviderBridge.mainThreadMcpRegistered, true)
  assert.equal(saved.report.evidence.ehMcpProviderBridge.definitionsPublishedToExtHost, true)
  assert.equal(saved.report.evidence.ehMcpProviderBridge.delegateTransportStarted, true)
  assert.equal(saved.report.evidence.ehMcpProviderBridge.secretRedactionVerified, true)
  assert.equal(saved.report.evidence.ehMcpProviderBridge.deletePublishesEmptyDefinitions, true)
  assert.equal(saved.report.evidence.ehMcpProviderBridge.providerErrors, 0)
  assert.equal(saved.report.evidence.extensionCompatibilityMatrix.ready, true)
  assert.equal(saved.report.evidence.extensionCompatibilityMatrix.sampled, 2)
  assert.equal(saved.report.evidence.extensionCompatibilityMatrix.blocked, 0)
  assert.equal(saved.report.evidence.extensionEnterpriseGate.ready, true)
  assert.equal(saved.report.evidence.extensionPlanAudit.ready, true)
  assert.equal(saved.report.evidence.extensionPlanAudit.manualRequired, 1)
  assert.equal(saved.report.paths.extensionMarketplaceSmokeJsonPath.endsWith("extension-marketplace-smoke-latest.json"), true)
  assert.equal(saved.report.paths.explorerFsParityJsonPath.endsWith("explorer-fs-parity-latest.json"), true)
  assert.equal(saved.report.paths.extensionInstallSmokeJsonPath.endsWith("extension-install-smoke-latest.json"), true)
  assert.equal(saved.report.paths.extensionMarketplaceInstallMatrixJsonPath.endsWith("extension-marketplace-install-matrix-latest.json"), true)
  assert.equal(saved.report.paths.extensionMigrationSmokeJsonPath.endsWith("extension-migration-smoke-latest.json"), true)
  assert.equal(saved.report.paths.extensionSecuritySmokeJsonPath.endsWith("extension-security-smoke-latest.json"), true)
  assert.equal(saved.report.paths.extensionHostRestartSmokeJsonPath.endsWith("extension-host-restart-smoke-latest-result.json"), true)
  assert.equal(saved.report.paths.ehMarketplaceE2eJsonPath.endsWith("eh-e2e-marketplace-latest.json"), true)
  assert.equal(saved.report.paths.ehMementoStorageE2eJsonPath.endsWith("eh-e2e-memento-storage-latest.json"), true)
  assert.equal(saved.report.paths.ehExtensionContextE2eJsonPath.endsWith("eh-e2e-extension-context-latest.json"), true)
  assert.equal(saved.report.paths.ehImplicitActivationE2eJsonPath.endsWith("eh-e2e-implicit-activation-latest.json"), true)
  assert.equal(saved.report.paths.ehDependencyLoopE2eJsonPath.endsWith("eh-e2e-dependency-loop-latest.json"), true)
  assert.equal(saved.report.paths.ehSearchProviderE2eJsonPath.endsWith("eh-e2e-search-provider-latest.json"), true)
  assert.equal(saved.report.paths.ehProfileContentHandlerE2eJsonPath.endsWith("eh-e2e-profile-content-handler-latest.json"), true)
  assert.equal(saved.report.paths.installedMcpDiscoveryJsonPath.endsWith("installed-mcp-discovery-latest.json"), true)
  assert.equal(saved.report.paths.mcpGalleryManagementJsonPath.endsWith("mcp-gallery-management-latest.json"), true)
  assert.equal(saved.report.paths.ehMcpProviderBridgeJsonPath.endsWith("eh-e2e-mcp-provider-latest.json"), true)
  assert.equal(saved.report.paths.extensionCompatibilityMatrixJsonPath.endsWith("extension-compatibility-matrix-latest.json"), true)
  assert.equal(saved.report.paths.extensionEnterpriseGateJsonPath.endsWith("extension-enterprise-gate-latest.json"), true)
  assert.equal(saved.report.paths.extensionPlanAuditJsonPath.endsWith("extension-plan-completion-audit-latest.json"), true)
  assert.notEqual(saved.report.evidence.betaTrialRun.markdownPath, "")
  assert.notEqual(saved.report.evidence.bdUserTrial.markdownPath, "")
  assert.equal(saved.report.evidence.bdUserTrial.historyCount >= 1, true)
  assert.equal(saved.report.evidence.taskRuns.available, true)
  assert.equal(saved.report.evidence.debugAdapterSmoke.dapMetadataOnly, true)
  assert.equal(saved.report.evidence.debugAdapterSmoke.dapCommandCoverage.covered, 8)
  assert.equal(saved.report.evidence.debugAdapterSmoke.stackFrames, 1)
  assert.equal(saved.report.evidence.debugAdapterSmoke.scopes, 1)
  assert.equal(saved.report.evidence.debugAdapterSmoke.variables, 1)
  assert.equal(saved.report.evidence.debugAdapterSmoke.breakpointsVerified, 1)
  assert.equal(saved.report.evidence.debugAdapterSmoke.bridgeEvidence.stateSource, "dapSessions")
  assert.equal(saved.report.evidence.debugAdapterSmoke.redaction.expressionValuesRedacted, true)
  assert.equal(saved.report.evidence.debugAdapterSmoke.redaction.sourcePathsRedacted, true)
  assert.equal(saved.report.evidence.debugAdapterSmoke.redaction.adapterArgumentsRedacted, true)
  assert.equal(saved.report.evidence.taskTerminalReuseRegistry.available, true)
  assert.equal(saved.report.evidence.taskTerminalReuseRegistry.ready, false)
  assert.equal(saved.report.evidence.taskTerminalReuseRegistry.connected, false)
  assert.equal(saved.report.evidence.taskTerminalReuseRegistry.supportsPhysicalReuse, false)
  assert.equal(saved.report.evidence.taskTerminalReuseRegistry.sameTaskOwnerCount, 1)
  assert.equal(saved.report.evidence.taskTerminalReuseRegistry.idleOwnerCount, 1)
  assert.equal(saved.report.evidence.taskTerminalReuseRegistry.statusLabel, "Terminal reuse registry evidence 可观测，physical reuse 未迁移")
  assert.match(saved.report.evidence.taskTerminalReuseRegistry.remainingGap, /reuseTerminal\(launchConfigs\)/)
  assert.equal(saved.report.gaps.some((gap) => gap.id === "task_runs"), false)
  const agentEvidenceWorkbench = saved.report.evidence.agentEvidenceWorkbench
  assert.equal(agentEvidenceWorkbench.report.source, "releaseEvidence")
  assert.equal(agentEvidenceWorkbench.surface.scm.stageCommandId, "agent.evidence.stageResource")
  assert.equal(agentEvidenceWorkbench.surface.scm.readonlyEvidence, true)
  assert.equal(agentEvidenceWorkbench.surface.scm.gitIndexMutation, false)
  assert.equal(agentEvidenceWorkbench.surface.scm.commandIds.includes("agent.evidence.stageResource"), true)
  assert.equal(agentEvidenceWorkbench.surface.testing.rerunCommandId, "agent.evidence.reviewTests")
  assert.equal(agentEvidenceWorkbench.surface.timeline.source, "agentEvidence")
  assert.equal(agentEvidenceWorkbench.surface.progress.cancelCommandId, "agent.evidence.cancelProgress")
  assert.equal(agentEvidenceWorkbench.surface.notifications.dismissCommandId, "agent.evidence.dismissNotification")
  assert.equal(agentEvidenceWorkbench.surface.list.total >= agentEvidenceWorkbench.surface.list.items.length, true)
  assert.equal(agentEvidenceWorkbench.surface.list.surfaces.includes(agentEvidenceWorkbench.surface.detail.surface), true)
  assert.equal(agentEvidenceWorkbench.surface.detail.readonly, true)
  assert.equal(agentEvidenceWorkbench.surface.export.evidenceCount, agentEvidenceWorkbench.surface.list.total)
  assert.equal(agentEvidenceWorkbench.surface.export.jsonCommandId, "agent.evidence.exportJson")
  assert.equal(agentEvidenceWorkbench.surface.export.markdownCommandId, "agent.evidence.exportMarkdown")
  assert.match(saved.report.markdown, /EH dependency loop E2E/)
  assert.match(saved.report.markdown, /EH restart smoke/)
  assert.match(saved.report.markdown, /EH SearchProvider E2E/)
  assert.match(saved.report.markdown, /EH ProfileContentHandler E2E/)
  assert.match(saved.report.markdown, /Installed MCP discovery/)
  assert.match(saved.report.markdown, /MCP Gallery management/)
  assert.match(saved.report.markdown, /EH MCP provider bridge/)
  assert.match(saved.report.markdown, /DAP metadata/)
  assert.match(saved.report.markdown, /Terminal reuse registry/)
  assert.equal(JSON.stringify(saved.report).includes("raw-secret-value"), false)
  assert.equal(JSON.stringify(saved.report).includes("D:\/Codek\/private"), false)
})

test("release evidence no-write does not create or modify readiness and release evidence artifacts", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-evidence-no-write-"))
  writeJson(path.join(reportDir, "orchestrator-readiness-latest.json"), {
    reportKind: "orchestrator-readiness",
    createdAt: 1,
    status: "ready",
    ready: true,
    summary: { total: 1, passed: 1, warning: 0, failed: 0 },
  })
  writeText(path.join(reportDir, "orchestrator-readiness-latest.md"), "# existing readiness\n")
  writeJson(path.join(reportDir, "release-evidence-latest.json"), {
    reportKind: "release-evidence",
    createdAt: 1,
    ready: false,
    status: "existing",
    summary: { enterpriseComplete: false },
  })
  writeText(path.join(reportDir, "release-evidence-latest.md"), "# existing release evidence\n")
  writeJson(path.join(reportDir, "history", "orchestrator-readiness-1970-01-01T00-00-00-000Z.json"), {
    reportKind: "orchestrator-readiness",
    createdAt: 1,
    ready: true,
    status: "ready",
  })
  writeText(path.join(reportDir, "history", "orchestrator-readiness-1970-01-01T00-00-00-000Z.md"), "# existing readiness history\n")
  writeJson(path.join(reportDir, "history", "release-evidence-1970-01-01T00-00-00-000Z.json"), {
    reportKind: "release-evidence",
    createdAt: 1,
    ready: false,
    status: "existing",
  })
  writeText(path.join(reportDir, "history", "release-evidence-1970-01-01T00-00-00-000Z.md"), "# existing release history\n")

  const before = snapshotFiles(reportDir)
  const saved = buildAndSaveReleaseEvidence({
    reportDir,
    currentReleaseGateMode: "bd-enterprise-candidate",
    runs: [],
    noWrite: true,
  })
  const after = snapshotFiles(reportDir)

  assert.equal(saved.report.reportKind, "release-evidence")
  assert.equal(saved.jsonPath, "")
  assert.equal(saved.markdownPath, "")
  assert.deepEqual(after, before)
})

test("release evidence export can read orchestrator runs from a local db", () => {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-evidence-runs-"))
  const dbPath = path.join(dbDir, "orchestrator.db")
  const { createOrchestratorStore } = require("../desktop/services/agentLoop/orchestratorStore")
  const store = createOrchestratorStore({ dbPath })
  store.saveRun({
    id: "run_from_db",
    projectRoot: "D:/Workspace",
    status: "completed",
    createdAt: 100,
    updatedAt: 110,
  })
  store.close()

  const runs = readOrchestratorRuns({ orchestratorDbPath: dbPath })
  assert.equal(runs.length, 1)
  assert.equal(runs[0].id, "run_from_db")
})
