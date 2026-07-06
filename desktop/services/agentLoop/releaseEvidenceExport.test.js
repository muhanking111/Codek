const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")
const {
  buildReleaseEvidenceSummary,
  listReleaseEvidenceSummaries,
  readLatestReleaseEvidenceSummary,
  saveReleaseEvidenceSummary,
} = require("./releaseEvidenceExport")

function readyArHealth() {
  const makeReport = (kind) => ({
    reportKind: kind,
    ready: true,
    status: "ready",
    statusLabel: `${kind} ready`,
    summary: { passed: 1, warning: 0, failed: 0, total: 1 },
  })
  return {
    provider: makeReport("provider-health"),
    debug: makeReport("debug-adapter-health"),
    extensions: makeReport("extension-ecosystem-health"),
    compatibility: makeReport("extension-compatibility-report"),
    goals: makeReport("goal-runtime-health"),
    performance: makeReport("performance-baseline"),
  }
}

function readyWorkbenchDeep() {
  return {
    reportKind: "workbench-deep-smoke",
    ready: true,
    status: "ready",
    statusLabel: "Workbench 深水区 smoke 通过",
    summary: { passed: 11, warning: 0, failed: 0, total: 11 },
    workspace: { roots: [{ name: "app" }, { name: "java" }, { name: "python" }] },
    tasks: { app: [{ id: "task-build" }], java: [{ id: "maven-test" }], python: [{ id: "python-test" }] },
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
    taskRunEvidence: [{
      id: "workbench_deep_task_run",
      name: "Workbench deep smoke task graph",
      status: "passed",
      blocked: [],
      startedAt: 100,
      finishedAt: 104,
      durationMs: 4,
      steps: [{
        id: "task_task-build",
        name: "Task: build",
        command: "npm run build",
        workingDir: "${workspaceFolder}",
        status: "passed",
        exitCode: 0,
        durationMs: 1,
        runMode: "parallel",
        dependencyDepth: 0,
        outputPreview: "metadata-only task evidence",
        errorPreview: "",
        problemDiagnostics: 2,
      }],
    }],
  }
}

function readyWorkbenchRealProjectUi() {
  return {
    reportKind: "workbench-real-project-ui-smoke-evidence",
    ready: true,
    status: "ready",
    projectRoot: "D:/Workspace",
    latestMarkdownPath: "workbench-real-project-ui-latest.md",
    latestScreenshotPath: "workbench-real-project-ui-latest.png",
    metrics: {
      projectRoot: "D:/Workspace",
      domRows: 50,
      totalRows: 95,
      p95ScrollMs: 21.6,
      maxScrollMs: 120.9,
      longTasks: 2,
      idleLightbulbCount: 0,
      searchQuery: "json",
      searchMatchPath: ".claude/settings.local.json",
      createTargetDir: "codek-real-ui-smoke-target/nested",
    },
    acceptance: {
      opensConfiguredRoot: true,
      nativeExplorerMounted: true,
      explorerRowsVirtualizedAndNonBlank: true,
      scrollP95WithinCursorGradeBudget: true,
      scrollMaxAvoidsHalfSecondStalls: true,
      normalEditorContentVisible: true,
      idleFakeLightbulbHidden: true,
      searchResultOpensNonBlankEditor: true,
      searchViewRemainsActive: true,
      chatInputUsable: true,
      createTargetDisplayMatchesDisk: true,
    },
  }
}

function readyExplorerFsParity() {
  return {
    reportKind: "explorer-fs-parity",
    ready: true,
    status: "ready",
    projectPath: "D:/Workspace",
    checkCount: 4,
    passed: 4,
    latestMarkdownPath: "explorer-fs-parity-latest.md",
    latestJsonPath: "explorer-fs-parity-latest.json",
    checks: [
      { id: "root", path: "D:/Workspace", source: "explorer", status: "passed", fsCount: 38, codekCount: 38, truncated: false, sentinelCount: 0, missing: [], extra: [], typeMismatches: [] },
      { id: "frontend", path: "D:/Workspace/frontend", source: "explorer", status: "passed", fsCount: 2, codekCount: 2, truncated: false, sentinelCount: 0, missing: [], extra: [], typeMismatches: [] },
      { id: "frontend_vite-project", path: "D:/Workspace/frontend/vite-project", source: "explorer", status: "passed", fsCount: 22, codekCount: 22, truncated: false, sentinelCount: 0, missing: [], extra: [], typeMismatches: [] },
      { id: "scripts", path: "D:/Workspace/scripts", source: "explorer", status: "passed", fsCount: 120, codekCount: 120, truncated: false, sentinelCount: 0, missing: [], extra: [], typeMismatches: [] },
    ],
  }
}

function readyShellIntegration() {
  return {
    reportKind: "shell-integration-smoke",
    ready: true,
    status: "ready",
    summary: { total: 2, passed: 2, skipped: 0, failed: 0 },
    checks: [
      { shellType: "powershell", ok: true, skipped: false, durationMs: 1 },
      { shellType: "cmd", ok: true, skipped: false, durationMs: 1 },
    ],
    latestMarkdownPath: "shell-integration-smoke-latest.md",
    latestJsonPath: "shell-integration-smoke-latest.json",
  }
}

function readyDebugAdapterSmoke() {
  return {
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
      { id: "node", status: "skipped", adapterAvailable: false, mode: "extension-host", source: "missing" },
      { id: "python", status: "skipped", adapterAvailable: false, mode: "stdio", source: "missing" },
    ],
    latestMarkdownPath: "debug-adapter-smoke-latest.md",
    latestJsonPath: "debug-adapter-smoke-latest.json",
  }
}

function readyEnterpriseDocAudit() {
  return {
    reportKind: "enterprise-doc-completion-audit",
    ready: true,
    status: "ready-with-manual-evidence-required",
    enterpriseComplete: false,
    summary: { total: 20, automatedPassed: 19, manualRequired: 1, missing: 0 },
    latestMarkdownPath: "enterprise-doc-completion-audit-latest.md",
    latestJsonPath: "enterprise-doc-completion-audit-latest.json",
  }
}

function readyExtensionPlanAudit() {
  return {
    reportKind: "extension-plan-completion-audit",
    ready: true,
    status: "ready-with-manual-evidence-required",
    enterpriseComplete: false,
    summary: { total: 28, passed: 27, manualRequired: 1, missing: 0 },
    latestMarkdownPath: "extension-plan-completion-audit-latest.md",
    latestJsonPath: "extension-plan-completion-audit-latest.json",
  }
}

function readyAgentChangeSafety() {
  return {
    reportKind: "agent-change-safety-smoke",
    ready: true,
    status: "ready",
    summary: { total: 5, passed: 5, failed: 0 },
    evidence: {
      pendingBatch: {
        blockReason: "manual-change-detected",
        reviewDisplay: {
          status: "blocked",
          firstFileCanApply: false,
          firstFileCanReject: true,
        },
      },
      pendingHunk: { blockReason: "manual-change-detected" },
      rollback: {
        rollbackError: "manual-change-detected",
        operationLog: {
          title: "Agent Change Set",
          statusLabel: "Rollback blocked",
          rollbackBlocked: true,
          canRevert: false,
          isGitDiff: false,
        },
      },
    },
    latestMarkdownPath: "agent-change-safety-smoke-latest.md",
    latestJsonPath: "agent-change-safety-smoke-latest.json",
  }
}

function readyRouterCalibration() {
  return {
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
    latestMarkdownPath: "router-calibration-smoke-latest.md",
    latestJsonPath: "router-calibration-smoke-latest.json",
  }
}

function readyProductGradeGate() {
  return {
    reportKind: "au-product-grade-gate",
    ready: true,
    status: "ready",
    statusLabel: "AU 产品级候选门通过",
    summary: { total: 10, ready: 10, blocked: 0, missing: 0 },
  }
}

function readyAxEnterpriseGate() {
  return {
    reportKind: "ax-enterprise-gap-gate",
    ready: true,
    status: "ready",
    statusLabel: "AX 企业级门禁通过",
    summary: { total: 16, ready: 16, blocked: 0, missing: 0 },
  }
}

function readyExtensionEnterpriseGate() {
  return {
    reportKind: "extension-enterprise-gate",
    ready: true,
    status: "ready",
    statusLabel: "扩展生态企业级门禁已通过",
    summary: { total: 5, passed: 5, warning: 0, failed: 0 },
    gaps: [],
    latestMarkdownPath: "extension-enterprise-gate-latest.md",
    latestJsonPath: "extension-enterprise-gate-latest.json",
  }
}

function readyExtensionMarketplaceSmoke() {
  return {
    reportKind: "extension-marketplace-smoke",
    ready: true,
    status: "ready",
    summary: { total: 5, passed: 5, warning: 0, failed: 0 },
    searchSamples: [
      { query: "python", count: 10, top: [{ id: "ms-python.python", displayName: "Python" }] },
      { query: "eslint", count: 8, top: [{ id: "dbaeumer.vscode-eslint", displayName: "ESLint" }] },
    ],
    inspected: [
      {
        id: "ms-python.python",
        ok: true,
        detailsReady: true,
        readmeReady: true,
        versionsReady: true,
        installPlanReady: true,
        dependencies: [],
        extensionPack: [],
      },
      {
        id: "dbaeumer.vscode-eslint",
        ok: true,
        detailsReady: true,
        readmeReady: true,
        versionsReady: true,
        installPlanReady: true,
        dependencies: [],
        extensionPack: [],
      },
    ],
    latestMarkdownPath: "extension-marketplace-smoke-latest.md",
    latestJsonPath: "extension-marketplace-smoke-latest.json",
  }
}

function readyExtensionInstallSmoke() {
  return {
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
    latestMarkdownPath: "extension-install-smoke-latest.md",
    latestJsonPath: "extension-install-smoke-latest.json",
  }
}

function readyExtensionMarketplaceInstallMatrix() {
  return {
    reportKind: "extension-marketplace-install-matrix",
    ready: true,
    status: "ready",
    thresholds: { minMetadata: 95, minInstallChain: 90, minActivationPreflight: 40 },
    summary: {
      top: 100,
      sampled: 100,
      metadataUsable: 95,
      downloaded: 92,
      extracted: 91,
      manifestScanned: 91,
      installChainComplete: 90,
      activationPreflightReady: 40,
      failed: 0,
    },
    installation: { isolated: true },
    latestMarkdownPath: "extension-marketplace-install-matrix-latest.md",
    latestJsonPath: "extension-marketplace-install-matrix-latest.json",
  }
}

function readyExtensionMigrationSmoke() {
  return {
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
      { id: "source_discovery", status: "passed" },
      { id: "profile_preview", status: "passed" },
      { id: "extension_queue_import", status: "passed" },
      { id: "dry_run_no_auto_install", status: "passed" },
      { id: "queue_status_retryable", status: "passed" },
    ],
    latestMarkdownPath: "extension-migration-smoke-latest.md",
    latestJsonPath: "extension-migration-smoke-latest.json",
  }
}

function readyExtensionSecuritySmoke() {
  return {
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
    latestMarkdownPath: "extension-security-smoke-latest.md",
    latestJsonPath: "extension-security-smoke-latest.json",
  }
}

function readyEhMarketplaceE2e() {
  return {
    reportKind: "eh-e2e-marketplace",
    ready: true,
    status: "ready",
    phase: "done",
    extensionId: "streetsidesoftware.code-spell-checker-spanish",
    searchCount: 5,
    latestMarkdownPath: "eh-e2e-marketplace-latest.md",
    latestJsonPath: "eh-e2e-marketplace-latest.json",
  }
}

function readyEhMementoStorageE2e() {
  return {
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
    latestMarkdownPath: "eh-e2e-memento-storage-latest.md",
    latestJsonPath: "eh-e2e-memento-storage-latest.json",
  }
}

function readyEhExtensionContextE2e() {
  return {
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
    latestMarkdownPath: "eh-e2e-extension-context-latest.md",
    latestJsonPath: "eh-e2e-extension-context-latest.json",
  }
}

function readyEhImplicitActivationE2e() {
  return {
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
    latestMarkdownPath: "eh-e2e-implicit-activation-latest.md",
    latestJsonPath: "eh-e2e-implicit-activation-latest.json",
  }
}

function readyEhDependencyLoopE2e() {
  return {
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
    latestMarkdownPath: "eh-e2e-dependency-loop-latest.md",
    latestJsonPath: "eh-e2e-dependency-loop-latest.json",
  }
}

function readyEhSearchProviderE2e() {
  return {
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
    latestMarkdownPath: "eh-e2e-search-provider-latest.md",
    latestJsonPath: "eh-e2e-search-provider-latest.json",
  }
}

function readyEhProfileContentHandlerE2e() {
  return {
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
    latestMarkdownPath: "eh-e2e-profile-content-handler-latest.md",
    latestJsonPath: "eh-e2e-profile-content-handler-latest.json",
  }
}

function readyEhMcpProviderBridge() {
  return {
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
    latestMarkdownPath: "eh-e2e-mcp-provider-latest.md",
    latestJsonPath: "eh-e2e-mcp-provider-latest.json",
  }
}

function readyInstalledMcpDiscovery() {
  return {
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
    latestMarkdownPath: "installed-mcp-discovery-latest.md",
    latestJsonPath: "installed-mcp-discovery-latest.json",
  }
}

function readyMcpGalleryManagement() {
  return {
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
    latestMarkdownPath: "mcp-gallery-management-latest.md",
    latestJsonPath: "mcp-gallery-management-latest.json",
  }
}

function readyExtensionCompatibilityMatrix() {
  return {
    reportKind: "extension-compatibility-matrix",
    ready: true,
    status: "degraded",
    summary: {
      top: 100,
      sampled: 3,
      native: 1,
      compatible: 1,
      degraded: 1,
      blocked: 0,
      unsupportedContributionPoints: 0,
      partialContributionPoints: 2,
    },
    extensions: [
      { rank: 1, id: "ms-python.python", source: "marketplace", status: "compatible", unsupportedContributionPoints: [], partialContributionPoints: [] },
      { rank: 2, id: "dbaeumer.vscode-eslint", source: "marketplace", status: "degraded", unsupportedContributionPoints: [], partialContributionPoints: ["debuggers"] },
      { rank: 3, id: "codek.builtin", source: "installed", status: "native", unsupportedContributionPoints: [], partialContributionPoints: [] },
    ],
    latestMarkdownPath: "extension-compatibility-matrix-latest.md",
    latestJsonPath: "extension-compatibility-matrix-latest.json",
  }
}

function readyAtPreflight() {
  return {
    reportKind: "at-release-candidate-preflight",
    ready: true,
    status: "degraded",
    statusLabel: "AT 发布候选预检需复核",
    summary: { total: 12, passed: 10, warning: 2, failed: 0 },
    artifacts: [{ name: "Codek-Setup.exe" }],
  }
}

function readyBdUserTrial() {
  return {
    reportKind: "bd-user-trial-plan",
    ready: true,
    status: "ready",
    statusLabel: "BD 真实用户试运行计划已就绪",
    summary: { total: 7, passed: 7, failed: 0, requiredTasks: 10, startupChecks: 5, screenshotItems: 8 },
    checks: [
      { id: "bd_task_count", status: "passed", passed: true },
      { id: "single_agent_tasks", status: "passed", passed: true },
      { id: "multi_agent_tasks", status: "passed", passed: true },
      { id: "attachment_task", status: "passed", passed: true },
      { id: "accept_rollback_task", status: "passed", passed: true },
      { id: "quality_gate_failure_task", status: "passed", passed: true },
      { id: "privacy_boundary", status: "passed", passed: true },
    ],
    tasks: [
      { id: "BD-T01", title: "单文件文案修复", expectedStrategy: "single-agent", required: true },
      { id: "BD-T02", title: "单文件 bug 修复", expectedStrategy: "single-agent", required: true },
      { id: "BD-T03", title: "多文件 UI 整改", expectedStrategy: "multi-agent", required: true },
      { id: "BD-T04", title: "工作台行为修复", expectedStrategy: "multi-agent", required: true },
      { id: "BD-T05", title: "质量门失败恢复", expectedStrategy: "single-agent", requiredResult: "质量门失败分类", required: true },
      { id: "BD-T06", title: "冲突变更处理", expectedStrategy: "multi-agent", required: true },
      { id: "BD-T07", title: "附件参与任务", expectedStrategy: "multi-agent", prompt: "参考附件", required: true },
      { id: "BD-T08", title: "需求不清澄清", expectedStrategy: "single-agent clarify", evidence: "ask_user", required: true },
      { id: "BD-T09", title: "回滚路径", expectedStrategy: "single-agent", requiredResult: "Rollback 后恢复", required: true },
      { id: "BD-T10", title: "发布证据接入", expectedStrategy: "single-agent", required: true },
    ],
    privacyPolicy: {
      deny: ["prompt text", "attachment body", "source code body", "full command output"],
    },
  }
}

function readyBetaTrialRun() {
  return {
    reportKind: "be-beta-trial-run",
    ready: true,
    status: "ready",
    statusLabel: "真实 Beta 执行闭环已就绪",
    summary: { total: 10, passed: 10, failed: 0, blocked: 0, p0: 0, p1: 0, p2: 0 },
    coverage: {
      singleAgent: true,
      multiAgent: true,
      attachment: true,
      rollback: true,
      qualityGateFailure: true,
      clarification: true,
      releaseEvidence: true,
    },
    defects: [],
    betaFeedback: {
      available: true,
      ready: true,
      status: "ready",
      statusLabel: "人工 Beta 反馈已收敛",
      total: 10,
      imported: 10,
      rejected: 0,
      privacyViolations: 0,
      passed: 9,
      failed: 1,
      blocked: 0,
      p0: 0,
      p1: 1,
      p2: 0,
      screenshotCount: 10,
      pendingRegression: 0,
      averageScore: 4.6,
      entries: [{ feedbackId: "fb-1", taskId: "BD-T03", status: "failed", severity: "P1" }],
    },
  }
}

function readyContextRuns() {
  return [{
    id: "run_context_ready",
    updatedAt: 300,
    assignments: [{
      id: "assignment_1",
      status: "completed",
      workspace: { isolation: "worktree", status: "released" },
    }],
    permissionRequest: {
      id: "permission_1",
      status: "approved",
      risk: "medium",
      writePaths: ["src"],
      commandAllowlist: ["npm run typecheck"],
      network: false,
      install: false,
      externalTool: false,
      destructive: false,
    },
    qualityGateCommands: ["npm run typecheck"],
    integrationDecision: {
      proposedPatch: { filesChanged: ["src/app.ts"] },
      applySnapshot: { id: "snapshot_1" },
      qualityGate: {
        status: "passed",
        commandResults: [{ command: "npm run typecheck", exitCode: 0, timedOut: false }],
      },
    },
    contextEvidence: {
      mentions: [{ type: "file", id: "src/app.ts", label: "src/app.ts", detail: "metadata only" }],
      attachments: [{ name: "notes.md", size: 120, type: "text/markdown", kind: "text", status: "ready", truncated: false, contentLength: 120 }],
      rules: [{ path: ".cursor/rules/codek.mdc", title: "Codek", glob: "**/*", priority: 10, contentLength: 80 }],
      workspaceSources: [
        { type: "active-file", label: "active file", path: "src/app.ts", contentLength: 240, truncated: false },
        { type: "diagnostics", label: "diagnostics", count: 1, contentLength: 40, truncated: false },
      ],
      indexStatus: {
        enabled: true,
        state: "ready",
        indexedFiles: 42,
        indexableFiles: 50,
        excludedFiles: 8,
        workspaceRoots: 1,
        freshness: "fresh",
        updatedAt: 300,
      },
      warnings: [],
      budget: {
        totalSources: 5,
        estimatedChars: 480,
        contextBlockChars: 300,
        attachmentTextChars: 120,
        ruleChars: 80,
        workspaceContextChars: 280,
        truncatedSources: 0,
        warningCount: 0,
        policy: {
          modelWindowChars: 64000,
          reservedResponseChars: 8000,
          availableContextChars: 56000,
          taskType: "implementation",
          riskLevel: "medium",
          allocation: { workspace: 31360, mentions: 10080, attachments: 7840, rules: 4480, diagnostics: 2240 },
          overflowChars: 0,
        },
      },
    },
  }]
}

function readyRoleTrialRuns() {
  return [{
    id: "run_role_trials",
    projectRoot: "D:/Workspace",
    updatedAt: 400,
    assignments: [
      {
        id: "assignment_reviewer",
        phaseId: "T08-review",
        role: "reviewer",
        status: "completed",
        lockedFiles: ["frontend/vite-project/src/workbench/agentEvidenceWorkbench.ts"],
        workspace: { isolation: "worktree", status: "released" },
        profileTrial: {
          profileId: "agency-code-reviewer",
          profileSource: "agency-agents-zh",
          selectionReason: "适合检查证据链字段是否变成第二状态源。",
          validationAdvice: ["node --test desktop/services/agentLoop/releaseEvidenceExport.test.js"],
          benefit: "能聚焦契约和回归风险。",
          noise: "会建议较宽泛的 review checklist。",
          runtimeFit: "recommend-runtime-integration",
          worthRuntimeIntegration: true,
        },
      },
      {
        id: "assignment_tester",
        phaseId: "T08-test",
        role: "tester",
        status: "completed",
        lockedFiles: ["desktop/services/agentLoop/runReport.js"],
        workspace: { isolation: "worktree", status: "released" },
        profileTrial: {
          profileId: "testing-reality-checker",
          profileSource: "agency-agents-zh",
          selectionReason: "适合把角色试用收益绑定到可运行验证命令。",
          validationAdvice: ["node --test desktop/services/agentLoop/runReport.test.js"],
          benefit: "能暴露缺少验证建议的试用记录。",
          noise: "对 UI 体验判断帮助有限。",
          runtimeFit: "recommend-runtime-integration",
          worthRuntimeIntegration: true,
        },
      },
    ],
    permissionRequest: {
      id: "permission_role_trials",
      status: "approved",
      risk: "medium",
      readPaths: ["desktop/services/agentLoop"],
      writePaths: ["desktop/services/agentLoop"],
      commandAllowlist: ["node --test desktop/services/agentLoop/releaseEvidenceExport.test.js"],
      network: false,
      install: false,
      externalTool: false,
      destructive: false,
    },
    agentRoleTrialDecision: {
      requiredTrialCount: 2,
      runtimeIntegrationRecommended: true,
      recommendation: "recommend-runtime-integration",
      reason: "两个角色都能沉淀验证建议，且可挂到现有 assignment 证据链。",
    },
  }]
}

test("release evidence summary combines local release artifacts", () => {
  const report = buildReleaseEvidenceSummary({
    createdAt: 100,
    releaseGateReport: {
      ready: true,
      mode: "quick",
      durationMs: 12,
      plannedSteps: ["typecheck"],
      steps: [{ id: "typecheck", passed: true }],
      jsonPath: "release-gate-latest.json",
    },
    acceptanceReport: {
      ready: true,
      taskSet: "standard",
      passed: 10,
      total: 10,
      matrix: { passed: 4, total: 4 },
    },
    readinessReport: {
      ready: true,
      status: "ready",
      statusLabel: "企业级就绪",
      summary: { passed: 9, total: 9, warning: 0, failed: 0 },
      nextAction: "可以发起真实工作区 Agent 试运行",
    },
    realTrialReport: {
      runId: "run_1",
      finalStatusLabel: "等待验收",
      realWorkspaceTrial: {
        mainWorkspaceUntouchedBeforeAccept: true,
        rollbackAvailable: true,
        filesChanged: ["src/app.js"],
      },
    },
    runActionAudits: [{
      id: "audit_1",
      actionId: "run-release-gate",
      title: "运行快速门",
      status: "success",
      runId: "run_1",
      durationMs: 30,
      summary: "完成",
      createdAt: 100,
      finishedAt: 130,
    }],
    usageSummary: {
      totalRequests: 1,
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      providerUsageRequests: 1,
      estimatedUsageRequests: 0,
      cost: {
        available: true,
        estimated: true,
        currency: "USD",
        priceSource: "local-default",
        estimatedCostUsd: 0.001,
        pricedRequests: 1,
        unpricedRequests: 0,
        unpricedModels: [],
      },
      byProvider: { openai: { requests: 1, inputTokens: 12, outputTokens: 8, totalTokens: 20 } },
      history: [],
    },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    workbenchRealProjectUi: readyWorkbenchRealProjectUi(),
    workbenchRealProjectUiJsonPath: "workbench-real-project-ui-latest.json",
    workbenchRealProjectUiMarkdownPath: "workbench-real-project-ui-latest.md",
    workbenchRealProjectUiScreenshotPath: "workbench-real-project-ui-latest.png",
    explorerFsParity: readyExplorerFsParity(),
    explorerFsParityJsonPath: "explorer-fs-parity-latest.json",
    explorerFsParityMarkdownPath: "explorer-fs-parity-latest.md",
    shellIntegration: readyShellIntegration(),
    shellIntegrationJsonPath: "shell-integration-smoke-latest.json",
    shellIntegrationMarkdownPath: "shell-integration-smoke-latest.md",
    debugAdapterSmoke: readyDebugAdapterSmoke(),
    debugAdapterSmokeJsonPath: "debug-adapter-smoke-latest.json",
    debugAdapterSmokeMarkdownPath: "debug-adapter-smoke-latest.md",
    enterpriseDocAudit: readyEnterpriseDocAudit(),
    enterpriseDocAuditJsonPath: "enterprise-doc-completion-audit-latest.json",
    enterpriseDocAuditMarkdownPath: "enterprise-doc-completion-audit-latest.md",
    extensionPlanAudit: readyExtensionPlanAudit(),
    extensionPlanAuditJsonPath: "extension-plan-completion-audit-latest.json",
    extensionPlanAuditMarkdownPath: "extension-plan-completion-audit-latest.md",
    agentChangeSafety: readyAgentChangeSafety(),
    agentChangeSafetyJsonPath: "agent-change-safety-smoke-latest.json",
    agentChangeSafetyMarkdownPath: "agent-change-safety-smoke-latest.md",
    routerCalibration: readyRouterCalibration(),
    routerCalibrationJsonPath: "router-calibration-smoke-latest.json",
    routerCalibrationMarkdownPath: "router-calibration-smoke-latest.md",
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    extensionMarketplaceSmoke: readyExtensionMarketplaceSmoke(),
    extensionMarketplaceSmokeJsonPath: "extension-marketplace-smoke-latest.json",
    extensionMarketplaceSmokeMarkdownPath: "extension-marketplace-smoke-latest.md",
    extensionInstallSmoke: readyExtensionInstallSmoke(),
    extensionInstallSmokeJsonPath: "extension-install-smoke-latest.json",
    extensionInstallSmokeMarkdownPath: "extension-install-smoke-latest.md",
    extensionMarketplaceInstallMatrix: readyExtensionMarketplaceInstallMatrix(),
    extensionMarketplaceInstallMatrixJsonPath: "extension-marketplace-install-matrix-latest.json",
    extensionMarketplaceInstallMatrixMarkdownPath: "extension-marketplace-install-matrix-latest.md",
    extensionMigrationSmoke: readyExtensionMigrationSmoke(),
    extensionMigrationSmokeJsonPath: "extension-migration-smoke-latest.json",
    extensionMigrationSmokeMarkdownPath: "extension-migration-smoke-latest.md",
    extensionSecuritySmoke: readyExtensionSecuritySmoke(),
    extensionSecuritySmokeJsonPath: "extension-security-smoke-latest.json",
    extensionSecuritySmokeMarkdownPath: "extension-security-smoke-latest.md",
    ehMarketplaceE2e: readyEhMarketplaceE2e(),
    ehMarketplaceE2eJsonPath: "eh-e2e-marketplace-latest.json",
    ehMarketplaceE2eMarkdownPath: "eh-e2e-marketplace-latest.md",
    ehMementoStorageE2e: readyEhMementoStorageE2e(),
    ehMementoStorageE2eJsonPath: "eh-e2e-memento-storage-latest.json",
    ehMementoStorageE2eMarkdownPath: "eh-e2e-memento-storage-latest.md",
    ehExtensionContextE2e: readyEhExtensionContextE2e(),
    ehExtensionContextE2eJsonPath: "eh-e2e-extension-context-latest.json",
    ehExtensionContextE2eMarkdownPath: "eh-e2e-extension-context-latest.md",
    ehImplicitActivationE2e: readyEhImplicitActivationE2e(),
    ehImplicitActivationE2eJsonPath: "eh-e2e-implicit-activation-latest.json",
    ehImplicitActivationE2eMarkdownPath: "eh-e2e-implicit-activation-latest.md",
    ehDependencyLoopE2e: readyEhDependencyLoopE2e(),
    ehDependencyLoopE2eJsonPath: "eh-e2e-dependency-loop-latest.json",
    ehDependencyLoopE2eMarkdownPath: "eh-e2e-dependency-loop-latest.md",
    ehSearchProviderE2e: readyEhSearchProviderE2e(),
    ehSearchProviderE2eJsonPath: "eh-e2e-search-provider-latest.json",
    ehSearchProviderE2eMarkdownPath: "eh-e2e-search-provider-latest.md",
    ehProfileContentHandlerE2e: readyEhProfileContentHandlerE2e(),
    installedMcpDiscovery: readyInstalledMcpDiscovery(),
    mcpGalleryManagement: readyMcpGalleryManagement(),
    ehMcpProviderBridge: readyEhMcpProviderBridge(),
    ehProfileContentHandlerE2eJsonPath: "eh-e2e-profile-content-handler-latest.json",
    ehProfileContentHandlerE2eMarkdownPath: "eh-e2e-profile-content-handler-latest.md",
    extensionCompatibilityMatrix: readyExtensionCompatibilityMatrix(),
    extensionCompatibilityMatrixJsonPath: "extension-compatibility-matrix-latest.json",
    extensionCompatibilityMatrixMarkdownPath: "extension-compatibility-matrix-latest.md",
    extensionEnterpriseGate: readyExtensionEnterpriseGate(),
    extensionEnterpriseGateJsonPath: "extension-enterprise-gate-latest.json",
    extensionEnterpriseGateMarkdownPath: "extension-enterprise-gate-latest.md",
    atPreflight: readyAtPreflight(),
    bdUserTrialReport: readyBdUserTrial(),
    bdUserTrialMarkdownPath: "beta-trial-plan-latest.md",
    betaTrialRunReport: readyBetaTrialRun(),
    betaTrialRunMarkdownPath: "beta-trial-run-latest.md",
    betaTrialRunHistory: [{ jsonPath: "history/beta-trial-run.json" }],
    runs: [...readyContextRuns(), ...readyRoleTrialRuns()],
    packagingPreflight: {
      reportKind: "packaging-preflight",
      ready: true,
      status: "ready",
      statusLabel: "Windows 打包预检通过",
      summary: { passed: 4, warning: 0, failed: 0, total: 4 },
    },
  })

  assert.equal(report.reportKind, "release-evidence")
  assert.equal(report.ready, true)
  assert.equal(report.summary.enterpriseComplete, false)
  assert.equal(report.summary.manualRealUiConfirmed, false)
  assert.equal(report.summary.blockingGaps, 0)
  assert.equal(report.evidence.releaseGate.ready, true)
  assert.equal(report.evidence.acceptance.matrixPassed, 4)
  assert.equal(report.evidence.realWorkspaceTrial.filesChanged[0], "src/app.js")
  assert.equal(report.evidence.arHealth.ready, true)
  assert.equal(report.evidence.arHealth.compatibility.ready, true)
  assert.equal(report.evidence.workbenchDeep.ready, true)
  assert.equal(report.evidence.workbenchDeep.taskConfigs, 3)
  assert.equal(report.evidence.workbenchRealProjectUi.ready, true)
  assert.equal(report.evidence.workbenchRealProjectUi.acceptancePassed, 11)
  assert.equal(report.evidence.workbenchRealProjectUi.screenshotPath, "workbench-real-project-ui-latest.png")
  assert.equal(report.evidence.explorerFsParity.ready, true)
  assert.equal(report.evidence.explorerFsParity.passed, 4)
  assert.equal(report.evidence.explorerFsParity.missing, 0)
  assert.equal(report.paths.explorerFsParityJsonPath, "explorer-fs-parity-latest.json")
  assert.equal(report.evidence.shellIntegration.ready, true)
  assert.equal(report.evidence.shellIntegration.passed, 2)
  assert.equal(report.evidence.debugAdapterSmoke.ready, true)
  assert.equal(report.evidence.debugAdapterSmoke.fixturePassed, true)
  assert.equal(report.evidence.debugAdapterSmoke.dapMetadataOnly, true)
  assert.equal(report.evidence.debugAdapterSmoke.dapCommandCoverage.covered, 8)
  assert.deepEqual(report.evidence.debugAdapterSmoke.dapCommandCoverage.commands, [
    "setBreakpoints",
    "configurationDone",
    "stackTrace",
    "scopes",
    "variables",
    "continue",
    "next",
    "terminate",
  ])
  assert.equal(report.evidence.debugAdapterSmoke.stackFrames, 1)
  assert.equal(report.evidence.debugAdapterSmoke.scopes, 1)
  assert.equal(report.evidence.debugAdapterSmoke.variables, 1)
  assert.equal(report.evidence.debugAdapterSmoke.breakpointsVerified, 1)
  assert.equal(report.evidence.debugAdapterSmoke.bridgeEvidence.stateSource, "dapSessions")
  assert.equal(report.evidence.debugAdapterSmoke.bridgeEvidence.noSecondDapState, true)
  assert.equal(report.evidence.debugAdapterSmoke.redaction.expressionValuesRedacted, true)
  assert.equal(report.evidence.debugAdapterSmoke.redaction.sourcePathsRedacted, true)
  assert.equal(report.evidence.debugAdapterSmoke.redaction.adapterArgumentsRedacted, true)
  assert.equal(report.evidence.enterpriseDocAudit.ready, true)
  assert.equal(report.evidence.enterpriseDocAudit.enterpriseComplete, false)
  assert.equal(report.evidence.enterpriseDocAudit.manualRequired, 1)
  assert.equal(report.evidence.extensionPlanAudit.ready, true)
  assert.equal(report.evidence.extensionPlanAudit.enterpriseComplete, false)
  assert.equal(report.evidence.extensionPlanAudit.manualRequired, 1)
  assert.equal(report.evidence.agentChangeSafety.ready, true)
  assert.equal(report.evidence.agentChangeSafety.pendingBatchBlocked, true)
  assert.equal(report.evidence.agentChangeSafety.reviewDisplayBlocked, true)
  assert.equal(report.evidence.agentChangeSafety.operationLogVisible, true)
  assert.equal(report.evidence.agentChangeSafety.pendingHunkBlocked, true)
  assert.equal(report.evidence.agentChangeSafety.rollbackBlocked, true)
  assert.equal(report.evidence.routerCalibration.ready, true)
  assert.equal(report.evidence.routerCalibration.total, 120)
  assert.equal(report.evidence.routerCalibration.failureReports, 10)
  assert.equal(report.evidence.productGradeGate.ready, true)
  assert.equal(report.evidence.axEnterpriseGate.ready, true)
  assert.equal(report.evidence.extensionMarketplaceSmoke.ready, true)
  assert.equal(report.evidence.extensionMarketplaceSmoke.detailsReady, 2)
  assert.equal(report.evidence.extensionMarketplaceSmoke.readmeReady, 2)
  assert.equal(report.evidence.extensionMarketplaceSmoke.installPlanReady, 2)
  assert.equal(report.evidence.extensionInstallSmoke.ready, true)
  assert.equal(report.evidence.extensionInstallSmoke.fixtureInstallPassed, true)
  assert.equal(report.evidence.extensionInstallSmoke.fixtureRollbackPassed, true)
  assert.equal(report.evidence.extensionInstallSmoke.marketplaceInstallAuthorized, false)
  assert.equal(report.evidence.extensionMarketplaceInstallMatrix.ready, true)
  assert.equal(report.evidence.extensionMarketplaceInstallMatrix.installChainComplete, 90)
  assert.equal(report.evidence.extensionMarketplaceInstallMatrix.isolated, true)
  assert.equal(report.paths.extensionMarketplaceInstallMatrixJsonPath, "extension-marketplace-install-matrix-latest.json")
  assert.equal(report.evidence.extensionMigrationSmoke.ready, true)
  assert.equal(report.evidence.extensionMigrationSmoke.dryRunNoAutoInstall, true)
  assert.equal(report.evidence.extensionMigrationSmoke.queueInstalled, 0)
  assert.equal(report.evidence.extensionSecuritySmoke.ready, true)
  assert.equal(report.evidence.extensionSecuritySmoke.restrictedWorkspaceBlocked, true)
  assert.equal(report.evidence.extensionSecuritySmoke.auditRedactsSecrets, true)
  assert.equal(report.evidence.ehMarketplaceE2e.ready, true)
  assert.equal(report.evidence.ehMarketplaceE2e.phase, "done")
  assert.notEqual(report.evidence.ehMarketplaceE2e.extensionId, "")
  assert.equal(report.evidence.ehMementoStorageE2e.ready, true)
  assert.equal(report.evidence.ehMementoStorageE2e.thirdPartyExtensionBuiltinFalse, true)
  assert.equal(report.evidence.ehMementoStorageE2e.legacyStorageWritten, false)
  assert.equal(report.evidence.ehExtensionContextE2e.ready, true)
  assert.equal(report.evidence.ehExtensionContextE2e.packageJsonPreserved, true)
  assert.equal(report.evidence.ehExtensionContextE2e.extensionUriFile, true)
  assert.equal(report.evidence.ehExtensionContextE2e.asAbsolutePathWorks, true)
  assert.equal(report.evidence.ehExtensionContextE2e.globalStorageUriFile, true)
  assert.equal(report.evidence.ehImplicitActivationE2e.ready, true)
  assert.equal(report.evidence.ehImplicitActivationE2e.manifestHasExplicitActivationEvents, false)
  assert.equal(report.evidence.ehImplicitActivationE2e.implicitOnCommandGenerated, true)
  assert.equal(report.evidence.ehImplicitActivationE2e.activatedByImplicitEvent, true)
  assert.equal(report.evidence.ehDependencyLoopE2e.ready, true)
  assert.deepEqual(report.evidence.ehDependencyLoopE2e.removedDueToLooping, ["codek.loop-a", "codek.loop-b"])
  assert.equal(report.evidence.ehDependencyLoopE2e.loopExtensionsAbsentFromAllExtensions, true)
  assert.equal(report.evidence.ehDependencyLoopE2e.loopExtensionsAbsentFromById, true)
  assert.equal(report.evidence.ehDependencyLoopE2e.initDataLoopExtensionsAbsent, true)
  assert.equal(report.evidence.ehDependencyLoopE2e.initDataMyExtensionsLoopAbsent, true)
  assert.equal(report.evidence.ehDependencyLoopE2e.healthyActivated, true)
  assert.equal(report.paths.ehDependencyLoopE2eJsonPath, "eh-e2e-dependency-loop-latest.json")
  assert.equal(report.evidence.taskTerminalReuseRegistry.available, true)
  assert.equal(report.evidence.taskTerminalReuseRegistry.ready, false)
  assert.equal(report.evidence.taskTerminalReuseRegistry.connected, false)
  assert.equal(report.evidence.taskTerminalReuseRegistry.supportsPhysicalReuse, false)
  assert.equal(report.evidence.taskTerminalReuseRegistry.sameTaskOwnerCount, 1)
  assert.equal(report.evidence.taskTerminalReuseRegistry.idleOwnerCount, 1)
  assert.equal(report.evidence.taskTerminalReuseRegistry.statusLabel, "Terminal reuse registry evidence 可观测，physical reuse 未迁移")
  assert.match(report.evidence.taskTerminalReuseRegistry.remainingGap, /reuseTerminal\(launchConfigs\)/)
  assert.match(report.markdown, /DAP metadata/)
  assert.match(report.markdown, /Terminal reuse registry/)
  assert.match(report.markdown, /EH dependency loop E2E/)
  assert.equal(report.evidence.ehSearchProviderE2e.ready, true)
  assert.equal(report.evidence.ehSearchProviderE2e.textProviderCalled, true)
  assert.equal(report.evidence.ehSearchProviderE2e.fileProviderCalled, true)
  assert.equal(report.evidence.ehSearchProviderE2e.textSearchEngine, "extension-search")
  assert.equal(report.evidence.ehSearchProviderE2e.textSearchProvider, "extension-host")
  assert.equal(report.evidence.ehSearchProviderE2e.fileSearchEngine, "extension-search")
  assert.equal(report.evidence.ehSearchProviderE2e.fallbackBypassed, true)
  assert.equal(report.evidence.ehSearchProviderE2e.providerErrors, 0)
  assert.equal(report.paths.ehSearchProviderE2eJsonPath, "eh-e2e-search-provider-latest.json")
  assert.match(report.markdown, /EH SearchProvider E2E/)
  assert.equal(report.evidence.ehProfileContentHandlerE2e.ready, true)
  assert.equal(report.evidence.ehProfileContentHandlerE2e.handlerRegistered, true)
  assert.equal(report.evidence.ehProfileContentHandlerE2e.handlerMetadataMatched, true)
  assert.equal(report.evidence.ehProfileContentHandlerE2e.readProfileCalled, true)
  assert.equal(report.evidence.ehProfileContentHandlerE2e.readProfileReturnedTemplate, true)
  assert.equal(report.evidence.ehProfileContentHandlerE2e.saveProfileCalled, true)
  assert.equal(report.evidence.ehProfileContentHandlerE2e.saveProfileReturnedResult, true)
  assert.equal(report.evidence.ehProfileContentHandlerE2e.cleanupAfterStop, true)
  assert.equal(report.evidence.ehProfileContentHandlerE2e.providerErrors, 0)
  assert.equal(report.paths.ehProfileContentHandlerE2eJsonPath, "eh-e2e-profile-content-handler-latest.json")
  assert.match(report.markdown, /EH ProfileContentHandler E2E/)
  assert.equal(report.evidence.installedMcpDiscovery.ready, true)
  assert.equal(report.evidence.installedMcpDiscovery.installedMcpPersisted, true)
  assert.equal(report.evidence.installedMcpDiscovery.installedDiscoveryRead, true)
  assert.equal(report.evidence.installedMcpDiscovery.installedRegistryApplied, true)
  assert.equal(report.evidence.installedMcpDiscovery.workspaceDiscoveryFilteredInRegistryMode, true)
  assert.equal(report.evidence.installedMcpDiscovery.secretRedactionVerified, true)
  assert.equal(report.evidence.installedMcpDiscovery.providerErrors, 0)
  assert.equal(report.paths.installedMcpDiscoveryJsonPath, "installed-mcp-discovery-latest.json")
  assert.match(report.markdown, /Installed MCP discovery/)
  assert.equal(report.evidence.mcpGalleryManagement.ready, true)
  assert.equal(report.evidence.mcpGalleryManagement.galleryInstallReady, true)
  assert.equal(report.evidence.mcpGalleryManagement.workspaceResourceWritten, true)
  assert.equal(report.evidence.mcpGalleryManagement.workspaceRegistryConsumed, true)
  assert.equal(report.evidence.mcpGalleryManagement.galleryUninstallReady, true)
  assert.equal(report.evidence.mcpGalleryManagement.lifecycleEventsEmitted, true)
  assert.equal(report.evidence.mcpGalleryManagement.providerErrors, 0)
  assert.equal(report.paths.mcpGalleryManagementJsonPath, "mcp-gallery-management-latest.json")
  assert.match(report.markdown, /MCP Gallery management/)
  assert.equal(report.evidence.extensionCompatibilityMatrix.ready, true)
  assert.equal(report.evidence.extensionCompatibilityMatrix.sampled, 3)
  assert.equal(report.evidence.extensionCompatibilityMatrix.top, 100)
  assert.equal(report.evidence.extensionCompatibilityMatrix.blocked, 0)
  assert.equal(report.evidence.extensionEnterpriseGate.ready, true)
  assert.equal(report.evidence.atPreflight.ready, true)
  assert.equal(report.evidence.bdUserTrial.ready, true)
  assert.equal(report.evidence.bdUserTrial.requiredTasks, 10)
  assert.equal(report.evidence.betaTrialRun.ready, true)
  assert.equal(report.evidence.betaFeedback.ready, true)
  assert.equal(report.evidence.betaFeedback.imported, 10)
  assert.equal(report.evidence.betaFeedback.screenshotCount, 10)
  assert.equal(report.evidence.betaTrialRun.historyCount, 1)
  assert.equal(report.evidence.agentRoleTrials.ready, true)
  assert.equal(report.evidence.agentRoleTrials.trialCount, 2)
  assert.equal(report.evidence.agentRoleTrials.runtimeIntegrationRecommended, true)
  assert.equal(report.evidence.agentRoleTrials.runtimeContract.noSecondStateSource, true)
  assert.equal(report.evidence.agentRoleTrials.trials.some((item) => item.profileId === "agency-code-reviewer"), true)
  assert.equal(report.evidence.agentRoleTrials.trials.some((item) => item.permissionScope.writePaths.includes("frontend/vite-project/src/workbench/agentEvidenceWorkbench.ts")), true)
  assert.equal(report.evidence.agentRoleTrials.trials.some((item) => item.validationAdvice.includes("node --test desktop/services/agentLoop/runReport.test.js")), true)
  assert.equal(report.evidence.packagingPreflight.ready, true)
  assert.equal(report.evidence.sandboxSecurity.ready, true)
  assert.equal(report.evidence.sandboxSecurity.isolatedAssignments, 2)
  assert.equal(report.evidence.taskRuns.ready, true)
  assert.equal(report.evidence.taskRuns.runs[0].problemDiagnostics, 2)
  assert.equal(report.evidence.taskRuns.runs[0].hasProblemDiagnostics, true)
  assert.equal(report.ready, true)
  assert.equal(report.summary.total, Object.keys(report.evidence).filter((key) => key !== "agentEvidenceWorkbench").length)
  assert.equal(report.evidence.agentEvidenceWorkbench.schemaVersion, 1)
  assert.equal(report.evidence.agentEvidenceWorkbench.available, true)
  assert.equal(report.evidence.agentEvidenceWorkbench.ready, false)
  assert.deepEqual(report.evidence.agentEvidenceWorkbench.stageStatusSchema.stageIds, [
    "plan",
    "role-profile-trial",
    "execution",
    "tests",
    "failure-diagnostics",
    "real-ui",
    "workspace-diff",
    "approval",
    "rollback",
  ])
  assert.deepEqual(report.evidence.agentEvidenceWorkbench.stageStatusSchema.statuses, ["ready", "degraded", "blocked", "missing"])
  assert.deepEqual(report.evidence.agentEvidenceWorkbench.timeline.map((item) => item.stage), [
    "plan",
    "role-profile-trial",
    "execution",
    "tests",
    "failure-diagnostics",
    "real-ui",
    "workspace-diff",
    "approval",
    "rollback",
  ])
  assert.equal(report.evidence.agentEvidenceWorkbench.testing.taskRuns, 1)
  assert.equal(report.evidence.agentEvidenceWorkbench.testing.problemDiagnostics, 2)
  assert.equal(report.evidence.agentEvidenceWorkbench.failure.blockingGaps, 0)
  assert.equal(report.evidence.agentEvidenceWorkbench.scm.fileCount, 1)
  assert.equal(report.evidence.agentEvidenceWorkbench.scm.files[0], "src/app.js")
  assert.equal(report.evidence.agentEvidenceWorkbench.scm.mainWorkspaceProtected, true)
  assert.equal(report.evidence.agentEvidenceWorkbench.scm.rollbackAvailable, true)
  assert.equal(report.evidence.agentEvidenceWorkbench.approval.permissionApproved, true)
  assert.equal(report.evidence.agentEvidenceWorkbench.approval.agentReviewBlocked, true)
  assert.equal(report.evidence.agentEvidenceWorkbench.rollback.rollbackAvailable, true)
  assert.equal(report.evidence.agentEvidenceWorkbench.rollback.agentRollbackDriftBlocked, true)
  assert.equal(report.evidence.agentEvidenceWorkbench.agentRoleTrials.trialCount, 2)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.schemaVersion, 1)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.source, "releaseEvidence")
  assert.equal(report.evidence.agentEvidenceWorkbench.report.timestamp, 100)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.workspace.root, "D:/Workspace")
  assert.equal(report.evidence.agentEvidenceWorkbench.report.workspace.protected, true)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.correlationId, "agent-evidence:run_1")
  assert.deepEqual(report.evidence.agentEvidenceWorkbench.report.runStateSchema.states, [
    "planned",
    "assigned",
    "running",
    "review-ready",
    "verified",
    "blocked",
    "accepted",
    "rolled-back",
  ])
  assert.deepEqual(report.evidence.agentEvidenceWorkbench.report.runStateSchema.transitions.running, ["review-ready", "verified", "blocked"])
  assert.equal(report.evidence.agentEvidenceWorkbench.report.roleProfiles.trialCount, 2)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.roleProfiles.runtimeContract.noSecondStateSource, true)
  assert.equal(report.evidence.agentEvidenceWorkbench.timeline.some((item) => item.stage === "role-profile-trial" && item.ready === true), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.runs.some((item) =>
    item.id === "run_context_ready"
    && item.state === "verified"
    && item.plan.steps.length >= 8
    && item.changedFiles.includes("src/app.ts")
    && item.diffSummary.filesChanged === item.changedFiles.length
    && item.validationCommands.some((command) => command.command === "npm run typecheck" && command.status === "passed")
    && item.rollbackRecommendation.available === true
    && item.costSummary.available === true
  ), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.commands.some((item) => item.command === "npm run typecheck" && item.status === "passed"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.commands.some((item) => item.command === "npm run typecheck" && item.rerunCommandId === "agent.evidence.reviewTests"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.artifacts.some((item) => item.path === "workbench-real-project-ui-latest.png" && item.kind === "screenshot"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.failureCauses.some((item) => item.id === "manual_real_ui_evidence"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.failureCauses.some((item) => item.id === "extension_host_restart_smoke"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.failureCauses.some((item) => item.id === "demo_task_report"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.nextActions.some((item) => item.id === "manual_real_ui_evidence" && item.surface === "progress"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.nextActions.some((item) => item.id === "manual_real_ui_evidence" && item.focusTarget === "progress"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.progress.some((item) => item.stage === "real-ui" && item.correlationId === "agent-evidence:run_1" && item.cancelCommandId === "agent.evidence.cancelProgress"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.report.notifications.some((item) => item.id === "agentEvidence.manual_real_ui_evidence" && item.lifecycle.state === "active" && item.dismissCommandId === "agent.evidence.dismissNotification"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.schemaVersion, 1)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.scm.fileCount, 1)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.scm.resourceGroupCount, 1)
  assert.deepEqual(report.evidence.agentEvidenceWorkbench.surface.scm.commandIds, ["agent.evidence.openResource", "agent.evidence.diffResource", "agent.evidence.stageResource", "agent.evidence.attachResource"])
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.scm.resourceCommandCount, 4)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.scm.stageCommandId, "agent.evidence.stageResource")
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.scm.readonlyEvidence, true)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.scm.gitIndexMutation, false)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.testing.state, "passed")
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.testing.diagnostics, 2)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.testing.rerunCommandId, "agent.evidence.reviewTests")
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.timeline.itemCount, 9)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.timeline.commandIds.includes("agent.evidence.openTimeline"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.timeline.linkedResourceCount, 1)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.progress.active, 1)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.progress.cancelCommandId, "agent.evidence.cancelProgress")
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.notifications.warnings, 1)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.notifications.dismissCommandId, "agent.evidence.dismissNotification")
  assert.deepEqual(report.evidence.agentEvidenceWorkbench.surface.notifications.focusTargets, ["notifications"])
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.list.total > 0, true)
  assert.deepEqual(report.evidence.agentEvidenceWorkbench.surface.list.surfaces, ["timeline", "scm", "testing", "progress", "notifications"])
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.list.statuses.includes("passed"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.list.statuses.includes("active"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.list.severities.includes("warning"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.list.items.some((item) => item.id === "testing:agentEvidence.latestTask" && item.commandId === "agent.evidence.reviewTests"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.detail.selectedId.startsWith("notifications:"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.detail.editorId.startsWith("agentEvidence.detail.notifications."), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.detail.resourceUri.startsWith("agent-evidence://notifications/"), true)
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.export.jsonCommandId, "agent.evidence.exportJson")
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.export.markdownCommandId, "agent.evidence.exportMarkdown")
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.export.artifactPath, ".codek/reports/agent-evidence-workbench-latest.json")
  assert.equal(report.evidence.agentEvidenceWorkbench.surface.actions.some((item) => item.id === "agent.evidence.openTimeline"), true)
  assert.match(report.markdown, /问题诊断/)
  assert.match(report.markdown, /Agent Evidence Workbench/)
  assert.match(report.markdown, /failure-diagnostics/)
  assert.match(report.markdown, /workspace-diff/)
  assert.match(report.markdown, /Surface \| 状态 \/ 来源/)
  assert.match(report.markdown, /Report Contract/)
  assert.match(report.markdown, /Role Profile Trial/)
  assert.match(report.markdown, /agency-code-reviewer/)
  assert.match(report.markdown, /testing-reality-checker/)
  assert.match(report.markdown, /agent-evidence:run_1/)
  assert.match(report.markdown, /npm run typecheck/)
  assert.match(report.markdown, /workbench-real-project-ui-latest\.png/)
  assert.match(report.markdown, /SCM \| Codek Agent Evidence/)
  assert.match(report.markdown, /Testing \| 通过/)
  assert.match(report.markdown, /agent\.evidence\.diffResource/)
  assert.match(report.markdown, /rerun agent\.evidence\.reviewTests/)
  assert.match(report.markdown, /cancel agent\.evidence\.cancelProgress/)
  assert.match(report.markdown, /dismiss agent\.evidence\.dismissNotification/)
  assert.match(report.markdown, /Evidence List/)
  assert.match(report.markdown, /Evidence Detail/)
  assert.match(report.markdown, /Evidence Export/)
  assert.match(report.markdown, /agent\.evidence\.exportJson/)
  assert.match(report.markdown, /Notification/)
  assert.match(report.markdown, /Explorer FS parity/)
  assert.match(report.markdown, /Workbench deep smoke task graph \| 通过 \| 1\/1 \| 4ms \| 并行 \| 0 \| 2/)
  assert.equal(report.gaps.every((gap) => gap.severity === "low" || gap.severity === "info"), true)
  assert.equal(report.gaps.some((gap) => gap.id === "task_runs"), false)
  assert.equal(report.gaps.some((gap) => gap.id === "manual_real_ui_evidence" && gap.severity === "low"), true)
  assert.equal(report.nextActions[0].id, "manual_review")
  assert.match(report.markdown, /发布验收证据链摘要/)
  assert.match(report.markdown, /证据缺口与建议/)
  assert.match(report.markdown, /控制台动作审计/)
  assert.match(report.markdown, /AU Workbench/)
  assert.match(report.markdown, /Workbench 真实项目 UI/)
  assert.match(report.markdown, /Agent 变更安全/)
  assert.match(report.markdown, /任务路由校准/)
  assert.match(report.markdown, /操作日志 可见/)
  assert.match(report.markdown, /AU 产品级门禁/)
  assert.match(report.markdown, /AX 企业级门禁/)
  assert.match(report.markdown, /扩展市场 smoke/)
  assert.match(report.markdown, /扩展安装生命周期 smoke/)
  assert.match(report.markdown, /扩展 Top N 兼容矩阵/)
  assert.match(report.markdown, /扩展生态企业级门禁/)
  assert.match(report.markdown, /AT 发布候选预检/)
  assert.match(report.markdown, /BD 真实用户试运行/)
  assert.match(report.markdown, /BE 真实 Beta 执行/)
  assert.match(report.markdown, /BF 人工 Beta 反馈/)
  assert.match(report.markdown, /Windows 打包预检/)
  assert.doesNotMatch(report.markdown, /Task Run Evidence|Manual Real UI Evidence|Task Router Calibration/)
  assert.doesNotMatch(report.markdown, /operation log visible/)
})

test("release evidence treats missing beta feedback as advisory for product grade", () => {
  const report = buildReleaseEvidenceSummary({
    releaseGateReport: { ready: true, mode: "product-grade", plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    workbenchRealProjectUi: readyWorkbenchRealProjectUi(),
    explorerFsParity: readyExplorerFsParity(),
    shellIntegration: readyShellIntegration(),
    debugAdapterSmoke: readyDebugAdapterSmoke(),
    enterpriseDocAudit: readyEnterpriseDocAudit(),
    extensionPlanAudit: readyExtensionPlanAudit(),
    agentChangeSafety: readyAgentChangeSafety(),
    routerCalibration: readyRouterCalibration(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    extensionMarketplaceSmoke: readyExtensionMarketplaceSmoke(),
    extensionInstallSmoke: readyExtensionInstallSmoke(),
    extensionMarketplaceInstallMatrix: readyExtensionMarketplaceInstallMatrix(),
    extensionMigrationSmoke: readyExtensionMigrationSmoke(),
    extensionSecuritySmoke: readyExtensionSecuritySmoke(),
    ehMarketplaceE2e: readyEhMarketplaceE2e(),
    ehMementoStorageE2e: readyEhMementoStorageE2e(),
    ehExtensionContextE2e: readyEhExtensionContextE2e(),
    ehImplicitActivationE2e: readyEhImplicitActivationE2e(),
    ehDependencyLoopE2e: readyEhDependencyLoopE2e(),
    ehSearchProviderE2e: readyEhSearchProviderE2e(),
    ehProfileContentHandlerE2e: readyEhProfileContentHandlerE2e(),
    installedMcpDiscovery: readyInstalledMcpDiscovery(),
    mcpGalleryManagement: readyMcpGalleryManagement(),
    ehMcpProviderBridge: readyEhMcpProviderBridge(),
    extensionCompatibilityMatrix: readyExtensionCompatibilityMatrix(),
    extensionEnterpriseGate: readyExtensionEnterpriseGate(),
    bdUserTrialReport: readyBdUserTrial(),
    betaTrialRunReport: { ...readyBetaTrialRun(), betaFeedback: { available: false, ready: true, total: 0 } },
    runs: readyContextRuns(),
  })

  assert.equal(report.ready, true)
  assert.equal(report.evidence.betaFeedback.available, false)
  assert.equal(report.gaps.some((gap) => gap.id === "bf_beta_feedback" && gap.severity === "low"), true)
})

test("release evidence blocks enterprise candidate when shell, debug, agent safety, or router calibration evidence is missing", () => {
  const report = buildReleaseEvidenceSummary({
    releaseGateReport: { ready: true, mode: "bd-enterprise-candidate", plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    workbenchRealProjectUi: readyWorkbenchRealProjectUi(),
    explorerFsParity: readyExplorerFsParity(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    bdUserTrialReport: readyBdUserTrial(),
    betaTrialRunReport: readyBetaTrialRun(),
    runs: readyContextRuns(),
  })

  assert.equal(report.ready, false)
  assert.equal(report.evidence.shellIntegration.available, false)
  assert.equal(report.evidence.debugAdapterSmoke.available, false)
  assert.equal(report.evidence.agentChangeSafety.available, false)
  assert.equal(report.evidence.routerCalibration.available, false)
  assert.equal(report.gaps.some((gap) => gap.id === "shell_integration_smoke" && gap.severity === "high"), true)
  assert.equal(report.gaps.some((gap) => gap.id === "debug_adapter_smoke" && gap.severity === "high"), true)
  assert.equal(report.gaps.some((gap) => gap.id === "agent_change_safety_smoke" && gap.severity === "high"), true)
  assert.equal(report.gaps.some((gap) => gap.id === "router_calibration_smoke" && gap.severity === "high"), true)
})

test("release evidence blocks when Explorer FS parity evidence is missing or not ready", () => {
  const common = {
    releaseGateReport: { ready: true, mode: "bd-enterprise-candidate", plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    workbenchRealProjectUi: readyWorkbenchRealProjectUi(),
    shellIntegration: readyShellIntegration(),
    debugAdapterSmoke: readyDebugAdapterSmoke(),
    enterpriseDocAudit: readyEnterpriseDocAudit(),
    extensionPlanAudit: readyExtensionPlanAudit(),
    agentChangeSafety: readyAgentChangeSafety(),
    routerCalibration: readyRouterCalibration(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    bdUserTrialReport: readyBdUserTrial(),
    betaTrialRunReport: readyBetaTrialRun(),
    runs: readyContextRuns(),
  }
  const missing = buildReleaseEvidenceSummary(common)
  const failed = buildReleaseEvidenceSummary({
    ...common,
    explorerFsParity: {
      ...readyExplorerFsParity(),
      ready: false,
      status: "blocked",
      checks: [{
        id: "scripts",
        path: "D:/Workspace/scripts",
        source: "explorer",
        status: "failed",
        fsCount: 120,
        codekCount: 119,
        truncated: true,
        sentinelCount: 1,
        missing: ["example.js"],
        extra: [],
        typeMismatches: [],
      }],
    },
  })

  assert.equal(missing.ready, false)
  assert.equal(missing.gaps.some((gap) => gap.id === "explorer_fs_parity" && gap.status === "missing" && gap.severity === "high"), true)
  assert.equal(failed.ready, false)
  assert.equal(failed.evidence.explorerFsParity.truncated, 1)
  assert.equal(failed.evidence.explorerFsParity.missing, 1)
  assert.equal(failed.gaps.some((gap) => gap.id === "explorer_fs_parity" && gap.status === "not_ready" && gap.severity === "high"), true)
})

test("release evidence blocks public candidate when beta feedback has P0 or missing regression", () => {
  const common = {
    releaseGateReport: { ready: true, mode: "public-candidate-upstream", plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    workbenchRealProjectUi: readyWorkbenchRealProjectUi(),
    explorerFsParity: readyExplorerFsParity(),
    shellIntegration: readyShellIntegration(),
    debugAdapterSmoke: readyDebugAdapterSmoke(),
    enterpriseDocAudit: readyEnterpriseDocAudit(),
    extensionPlanAudit: readyExtensionPlanAudit(),
    agentChangeSafety: readyAgentChangeSafety(),
    routerCalibration: readyRouterCalibration(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    bdUserTrialReport: readyBdUserTrial(),
    runs: readyContextRuns(),
  }
  const p0 = buildReleaseEvidenceSummary({
    ...common,
    betaTrialRunReport: {
      ...readyBetaTrialRun(),
      betaFeedback: { ...readyBetaTrialRun().betaFeedback, ready: false, p0: 1, pendingRegression: 0 },
    },
  })
  assert.equal(p0.ready, false)
  assert.equal(p0.evidence.betaFeedback.p0, 1)
  assert.equal(p0.gaps.some((gap) => gap.id === "bf_beta_feedback" && gap.severity === "high"), true)

  const missingRegression = buildReleaseEvidenceSummary({
    ...common,
    betaTrialRunReport: {
      ...readyBetaTrialRun(),
      betaFeedback: { ...readyBetaTrialRun().betaFeedback, ready: false, p0: 0, pendingRegression: 1 },
    },
  })
  assert.equal(missingRegression.ready, false)
  assert.equal(missingRegression.evidence.betaFeedback.pendingRegression, 1)
})

test("release evidence classifies AR warnings for release review", () => {
  const ar = readyArHealth()
  ar.debug.ready = false
  ar.debug.status = "degraded"
  ar.debug.summary = { passed: 0, warning: 1, failed: 0, total: 1 }
  ar.debug.checks = [{
    id: "debug_adapter_node",
    title: "node 调试器",
    status: "warning",
    detail: "缺少 VS Code js-debug adapter",
    nextAction: "安装 js-debug adapter",
    warningCategory: "environment",
  }]
  ar.performance.ready = false
  ar.performance.status = "degraded"
  ar.performance.summary = { passed: 1, warning: 1, failed: 0, total: 2 }
  ar.performance.checks = [{
    id: "largest_chunk_budget",
    title: "最大 lazy chunk 预算",
    status: "warning",
    detail: "ts.worker 超预算",
    nextAction: "继续拆分 worker",
    warningCategory: "budget",
  }]

  const report = buildReleaseEvidenceSummary({
    releaseGateReport: { ready: true, plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    runActionAudits: [{ status: "success" }],
    usageSummary: { totalRequests: 1 },
    arHealth: ar,
    workbenchDeep: readyWorkbenchDeep(),
    workbenchRealProjectUi: readyWorkbenchRealProjectUi(),
    explorerFsParity: readyExplorerFsParity(),
    shellIntegration: readyShellIntegration(),
    debugAdapterSmoke: readyDebugAdapterSmoke(),
    enterpriseDocAudit: readyEnterpriseDocAudit(),
    extensionPlanAudit: readyExtensionPlanAudit(),
    agentChangeSafety: readyAgentChangeSafety(),
    routerCalibration: readyRouterCalibration(),
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    extensionMarketplaceSmoke: readyExtensionMarketplaceSmoke(),
    extensionInstallSmoke: readyExtensionInstallSmoke(),
    extensionMarketplaceInstallMatrix: readyExtensionMarketplaceInstallMatrix(),
    extensionMigrationSmoke: readyExtensionMigrationSmoke(),
    extensionSecuritySmoke: readyExtensionSecuritySmoke(),
    ehMarketplaceE2e: readyEhMarketplaceE2e(),
    ehMementoStorageE2e: readyEhMementoStorageE2e(),
    ehExtensionContextE2e: readyEhExtensionContextE2e(),
    ehImplicitActivationE2e: readyEhImplicitActivationE2e(),
    ehDependencyLoopE2e: readyEhDependencyLoopE2e(),
    ehSearchProviderE2e: readyEhSearchProviderE2e(),
    ehProfileContentHandlerE2e: readyEhProfileContentHandlerE2e(),
    installedMcpDiscovery: readyInstalledMcpDiscovery(),
    mcpGalleryManagement: readyMcpGalleryManagement(),
    ehMcpProviderBridge: readyEhMcpProviderBridge(),
    extensionCompatibilityMatrix: readyExtensionCompatibilityMatrix(),
    extensionEnterpriseGate: readyExtensionEnterpriseGate(),
    atPreflight: readyAtPreflight(),
    bdUserTrialReport: readyBdUserTrial(),
    runs: readyContextRuns(),
    packagingPreflight: {
      ready: true,
      status: "degraded",
      statusLabel: "Windows 打包预检需复核",
      summary: { passed: 3, warning: 1, failed: 0, total: 4 },
    },
  })

  assert.equal(report.ready, true)
  assert.equal(report.evidence.arHealth.ready, true)
  assert.equal(report.evidence.arHealth.warningCount, 2)
  assert.equal(report.evidence.arHealth.warningReview[0].category, "environment")
  assert.equal(report.evidence.arHealth.warningReview[1].category, "budget")
  assert.match(report.markdown, /AR 警告复核/)
})

test("release evidence records AT preflight as advisory unless failed", () => {
  const common = {
    releaseGateReport: { ready: true, plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    bdUserTrialReport: readyBdUserTrial(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
  }
  const missing = buildReleaseEvidenceSummary(common)
  assert.equal(missing.gaps.some((gap) => gap.id === "at_preflight" && gap.severity === "low"), true)

  const failed = buildReleaseEvidenceSummary({
    ...common,
    atPreflight: { ready: false, summary: { passed: 1, warning: 0, failed: 1, total: 2 } },
  })
  assert.equal(failed.gaps.some((gap) => gap.id === "at_preflight" && gap.severity === "medium"), true)
})

test("release evidence blocks product readiness when BD user trial is missing", () => {
  const report = buildReleaseEvidenceSummary({
    releaseGateReport: { ready: true, plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    runActionAudits: [{ status: "success" }],
    usageSummary: { totalRequests: 1 },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    atPreflight: readyAtPreflight(),
    runs: readyContextRuns(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
  })

  assert.equal(report.ready, false)
  assert.equal(report.evidence.bdUserTrial.available, false)
  assert.equal(report.gaps.some((gap) => gap.id === "bd_user_trial" && gap.severity === "high"), true)
})

test("release evidence requires enterprise document completion audit evidence", () => {
  const report = buildReleaseEvidenceSummary({
    releaseGateReport: { ready: true, plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    runActionAudits: [{ status: "success" }],
    usageSummary: { totalRequests: 1 },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    workbenchRealProjectUi: readyWorkbenchRealProjectUi(),
    workbenchRealProjectUiMarkdownPath: "workbench-real-project-ui-latest.md",
    workbenchRealProjectUiScreenshotPath: "workbench-real-project-ui-latest.png",
    shellIntegration: readyShellIntegration(),
    debugAdapterSmoke: readyDebugAdapterSmoke(),
    agentChangeSafety: readyAgentChangeSafety(),
    routerCalibration: readyRouterCalibration(),
    bdUserTrialReport: readyBdUserTrial(),
    betaTrialRunReport: readyBetaTrialRun(),
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    atPreflight: readyAtPreflight(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    runs: readyContextRuns(),
    taskRunEvidence: [{ id: "task", status: "passed", steps: [{ status: "passed" }] }],
  })

  assert.equal(report.ready, false)
  assert.equal(report.evidence.enterpriseDocAudit.available, false)
  assert.equal(report.gaps.some((gap) => gap.id === "enterprise_doc_completion_audit" && gap.severity === "high"), true)
})

test("release evidence summarizes codebase context without leaking source or prompt content", () => {
  const report = buildReleaseEvidenceSummary({
    runs: [{
      id: "run_context_leak_check",
      updatedAt: 500,
      userInput: "DO_NOT_LEAK_USER_PROMPT",
      contextEvidence: {
        mentions: [{ type: "terminal", id: "terminal:last", label: "terminal output", detail: "npm test" }],
        attachments: [{ name: "secret-notes.txt", size: 2048, type: "text/plain", kind: "text", status: "ready", truncated: false, contentLength: 2048, content: "DO_NOT_LEAK_ATTACHMENT" }],
        rules: [{ path: ".cursor/rules/team.mdc", title: "Team", glob: "**/*", priority: 1, contentLength: 99, content: "DO_NOT_LEAK_RULE" }],
        workspaceSources: [{ type: "active-file-content", label: "active file", path: "src/secret.ts", contentLength: 4096, truncated: true, content: "DO_NOT_LEAK_SOURCE" }],
        indexStatus: { enabled: true, state: "ready", indexedFiles: 7, indexableFiles: 9, excludedFiles: 2, workspaceRoots: 1, freshness: "fresh", updatedAt: 500 },
        warnings: ["workspace summary truncated"],
        budget: {
          totalSources: 4,
          estimatedChars: 9000,
          contextBlockChars: 4096,
          attachmentTextChars: 2048,
          ruleChars: 99,
          workspaceContextChars: 4096,
          truncatedSources: 1,
          warningCount: 1,
          policy: {
            modelWindowChars: 64000,
            reservedResponseChars: 8000,
            availableContextChars: 56000,
            taskType: "implementation",
            riskLevel: "medium",
            allocation: { workspace: 31360 },
            overflowChars: 0,
          },
        },
      },
    }],
  })

  assert.equal(report.evidence.codebaseContext.available, true)
  assert.equal(report.evidence.codebaseContext.ready, false)
  assert.equal(report.evidence.codebaseContext.runId, "run_context_leak_check")
  assert.equal(report.evidence.codebaseContext.workspaceSources, 1)
  assert.equal(report.evidence.codebaseContext.truncatedSources, 1)
  assert.equal(report.evidence.codebaseContext.indexStatus.indexedFiles, 7)
  assert.equal(report.gaps.some((gap) => gap.id === "codebase_context" && gap.status === "not_ready"), true)
  const serialized = JSON.stringify(report)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_USER_PROMPT/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_ATTACHMENT/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_RULE/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_SOURCE/)
  assert.match(report.markdown, /Codebase Context/)
})

test("release evidence summarizes task run evidence without leaking command output", () => {
  const report = buildReleaseEvidenceSummary({
    taskRunEvidence: [{
      id: "task_build",
      name: "build",
      status: "passed",
      blocked: [],
      startedAt: 100,
      finishedAt: 180,
      durationMs: 80,
      summary: "DO_NOT_LEAK_TASK_SUMMARY",
      steps: [{
        id: "task_lint",
        name: "lint",
        command: "npm run lint -- --token sk-test-should-not-leak",
        workingDir: "C:\\secret\\workspace",
        status: "passed",
        exitCode: 0,
        durationMs: 30,
        runMode: "parallel",
        dependencyDepth: 0,
        outputPreview: "DO_NOT_LEAK_TASK_STDOUT",
        errorPreview: "DO_NOT_LEAK_TASK_STDERR",
      }, {
        id: "task_build_step",
        name: "build",
        command: "npm run build",
        workingDir: "C:\\secret\\workspace",
        status: "passed",
        exitCode: 0,
        durationMs: 50,
        runMode: "sequence",
        dependencyDepth: 1,
        outputPreview: "build ok",
        errorPreview: "",
      }],
    }],
  })

  assert.equal(report.evidence.taskRuns.available, true)
  assert.equal(report.evidence.taskRuns.ready, true)
  assert.equal(report.evidence.taskRuns.total, 1)
  assert.equal(report.evidence.taskRuns.passed, 1)
  assert.equal(report.evidence.taskRuns.runs[0].hasParallelSteps, true)
  assert.equal(report.evidence.taskRuns.runs[0].problemDiagnostics, 0)
  assert.equal(report.evidence.taskRuns.runs[0].hasProblemDiagnostics, false)
  assert.equal(report.evidence.taskRuns.runs[0].steps[0].commandLength > 0, true)
  assert.equal(report.evidence.taskRuns.runs[0].steps[0].outputLength > 0, true)
  assert.match(report.markdown, /任务运行证据/)
  const serialized = JSON.stringify(report)
  assert.doesNotMatch(serialized, /sk-test-should-not-leak/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_TASK_STDOUT/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_TASK_STDERR/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_TASK_SUMMARY/)
  assert.doesNotMatch(serialized, /DO_NOT_LEAK_BLOCKED_REASON/)
  assert.doesNotMatch(serialized, /C:\\secret\\workspace/)
})

test("release evidence marks failed task run evidence as not ready", () => {
  const report = buildReleaseEvidenceSummary({
    taskRuns: [{
      id: "task_test",
      name: "test",
      status: "failed",
      blocked: [],
      startedAt: 200,
      finishedAt: 240,
      durationMs: 40,
      steps: [{
        id: "task_test_step",
        name: "test",
        command: "npm test",
        workingDir: "D:\\Workspace",
        status: "failed",
        exitCode: 1,
        durationMs: 40,
        runMode: "sequence",
        dependencyDepth: 0,
        outputPreview: "",
        errorPreview: "DO_NOT_LEAK_TEST_ERROR",
      }],
    }],
  })

  assert.equal(report.evidence.taskRuns.available, true)
  assert.equal(report.evidence.taskRuns.ready, false)
  assert.equal(report.evidence.taskRuns.failed, 1)
  assert.equal(report.gaps.some((gap) => gap.id === "task_runs" && gap.status === "not_ready"), true)
  assert.doesNotMatch(JSON.stringify(report), /DO_NOT_LEAK_TEST_ERROR/)
})

test("release evidence prefers ready codebase context over newer empty context", () => {
  const readyRun = readyContextRuns()[0]
  const report = buildReleaseEvidenceSummary({
    runs: [{
      id: "run_new_empty_context",
      updatedAt: 900,
      contextEvidence: {
        mentions: [],
        attachments: [],
        rules: [],
        workspaceSources: [],
        indexStatus: { enabled: true, state: "unknown", freshness: "unknown" },
        warnings: [],
        budget: { totalSources: 0, truncatedSources: 0, policy: { overflowChars: 0 } },
      },
    }, readyRun],
  })

  assert.equal(report.evidence.codebaseContext.ready, true)
  assert.equal(report.evidence.codebaseContext.runId, readyRun.id)
  assert.equal(report.evidence.codebaseContext.sources, 5)
})

test("release evidence recovers context and sandbox evidence from archived real workspace trial report", () => {
  const report = buildReleaseEvidenceSummary({
    releaseGateReport: { ready: true, plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: {
      runId: "archived_trial_run",
      createdAt: 700,
      updatedAt: 800,
      router: { visibleMode: "agent", executionStrategy: "single-agent" },
      fileScope: ["src/app.js"],
      contextEvidence: readyContextRuns()[0].contextEvidence,
      assignments: [{
        id: "assignment_1",
        phaseId: "phase_1",
        role: "implementer",
        status: "completed",
        files: ["src/app.js"],
        workspaceIsolation: "snapshot",
      }],
      qualityGate: {
        status: "passed",
        commandResults: [{ command: "node --check src/app.js", exitCode: 0, stdout: "DO_NOT_LEAK_ARCHIVED_STDOUT" }],
      },
      commandAuthorization: {
        ok: true,
        commands: [{ command: "node --check src/app.js", status: "allowed" }],
      },
      changeSummary: {
        rollbackResult: { status: "restored", filesChanged: ["src/app.js"] },
      },
      realWorkspaceTrial: {
        allowedPaths: ["src"],
        qualityGateCommands: ["node --check src/app.js"],
        mainWorkspaceUntouchedBeforeAccept: true,
        rollbackAvailable: true,
        filesChanged: ["src/app.js"],
      },
    },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
  })

  assert.equal(report.evidence.codebaseContext.ready, true)
  assert.equal(report.evidence.codebaseContext.runId, "archived_trial_run")
  assert.equal(report.evidence.sandboxSecurity.ready, true)
  assert.equal(report.evidence.sandboxSecurity.runId, "archived_trial_run")
  assert.equal(report.evidence.sandboxSecurity.isolatedAssignments, 1)
  assert.doesNotMatch(JSON.stringify(report), /DO_NOT_LEAK_ARCHIVED_STDOUT/)
})

test("release evidence blocks unsafe sandbox security evidence without leaking command output", () => {
  const report = buildReleaseEvidenceSummary({
    releaseGateReport: { ready: true, plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    runs: [{
      id: "run_sandbox_failed",
      updatedAt: 600,
      assignments: [{ id: "assignment_1", workspace: { isolation: "main" } }],
      permissionRequest: { status: "approved", risk: "high", writePaths: ["src"], commandAllowlist: [], network: false, install: false, externalTool: false },
      qualityGateCommands: ["npm run deploy"],
      integrationDecision: {
        proposedPatch: { filesChanged: ["src/app.js"] },
        qualityGate: {
          status: "failed",
          commandResults: [{ command: "npm run deploy", exitCode: 1, stdout: "DO_NOT_LEAK_RELEASE_STDOUT" }],
        },
      },
      contextEvidence: readyContextRuns()[0].contextEvidence,
    }],
  })

  assert.equal(report.ready, false)
  assert.equal(report.evidence.sandboxSecurity.available, true)
  assert.equal(report.evidence.sandboxSecurity.ready, false)
  assert.equal(report.gaps.some((gap) => gap.id === "sandbox_security" && gap.status === "not_ready"), true)
  assert.match(report.markdown, /沙箱安全证据/)
  assert.doesNotMatch(JSON.stringify(report), /DO_NOT_LEAK_RELEASE_STDOUT/)
})

test("release evidence summary explains missing and not ready evidence", () => {
  const report = buildReleaseEvidenceSummary({
    createdAt: 150,
    releaseGateReport: {
      ready: false,
      plannedSteps: ["typecheck", "smoke"],
      steps: [{ id: "typecheck", passed: true }, { id: "smoke", passed: false }],
    },
    readinessReport: {
      ready: false,
      status: "blocked",
      statusLabel: "阻塞",
      summary: { passed: 2, total: 4, warning: 1, failed: 1 },
      nextAction: "先配置允许路径和质量门。",
    },
  })

  assert.equal(report.ready, false)
  assert.equal(report.gaps.some((gap) => gap.id === "release_gate" && gap.status === "not_ready"), true)
  assert.equal(report.gaps.some((gap) => gap.id === "acceptance" && gap.status === "missing"), true)
  assert.equal(report.gaps.some((gap) => gap.id === "readiness" && gap.reason === "先配置允许路径和质量门。"), true)
  assert.equal(report.nextActions[0].id, "release_gate")
  assert.match(report.markdown, /发布质量门/)
  assert.match(report.markdown, /运行发布验收任务集/)
})

test("release evidence summary includes llm usage summary when available", () => {
  const report = buildReleaseEvidenceSummary({
    createdAt: 175,
    usageSummary: {
      totalRequests: 2,
      inputTokens: 10,
      outputTokens: 8,
      totalTokens: 18,
      providerUsageRequests: 1,
      estimatedUsageRequests: 1,
      cost: {
        available: true,
        estimated: true,
        currency: "USD",
        priceSource: "local-default",
        estimatedCostUsd: 0.42,
        pricedRequests: 1,
        unpricedRequests: 1,
        unpricedModels: [{ provider: "openai", model: "custom-model", requests: 1 }],
      },
      byProvider: {
        openai: { requests: 2, inputTokens: 10, outputTokens: 8, totalTokens: 18 },
      },
      history: [],
    },
  })

  assert.equal(report.evidence.llmUsage.available, true)
  assert.equal(report.evidence.llmUsage.ready, true)
  assert.equal(report.evidence.llmUsage.totalTokens, 18)
  assert.equal(report.evidence.llmUsage.estimatedCostUsd, 0.42)
  assert.equal(report.evidence.llmUsage.unpricedRequests, 1)
  assert.match(report.markdown, /LLM 用量/)
  assert.match(report.markdown, /估算成本/)
})

test("release evidence summary includes Day 11-12 demo task report from real trial evidence", () => {
  const demoTaskReport = {
    ready: true,
    status: "ready",
    requiredTasks: ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08"],
    coveredTasks: ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08"],
    missingTasks: [],
    tasks: ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08"].map((id) => ({ id, title: `${id} demo`, status: "passed" })),
    roleProfiles: [
      { id: "implementer", label: "实现 Agent", benefit: "减少串行等待", noise: "少量重复提示", recommendation: "recommended" },
      { id: "reviewer", label: "复核 Agent", benefit: "提前暴露验收缺口", noise: "需要人工裁剪", recommendation: "trial" },
    ],
    roleTrials: [
      { id: "trial_t08", profileId: "reviewer", status: "passed", baselineMinutes: 40, trialMinutes: 25, benefit: "复核时间下降", noise: "一条低价值建议" },
    ],
    roleBenefitSummary: "角色试用提升演示任务可复核性",
    roleNoiseSummary: "噪音集中在重复风险提示",
    qualityGate: { status: "passed", summary: "focused tests passed" },
    costReview: { available: true, estimatedCostUsd: 0.21, currency: "USD", manualReviewMinutes: 18, unpricedRequests: 0 },
    failureReview: { summary: "无 P0，失败复盘可追溯" },
    rollbackRecommendation: { action: "manual_accept_after_review", reason: "等待人工验收" },
    nextHumanAcceptance: ["打开演示报告", "继续 Day 13-14 三人反馈"],
  }
  const report = buildReleaseEvidenceSummary({
    createdAt: 190,
    realTrialReport: {
      finalStatusLabel: "等待验收",
      realWorkspaceTrial: {
        mainWorkspaceUntouchedBeforeAccept: true,
        rollbackAvailable: true,
        filesChanged: ["desktop/services/agentLoop/runReport.js"],
        demoTaskReport,
      },
    },
    realTrialMarkdownPath: "real-workspace-trial-latest.md",
  })

  assert.equal(report.evidence.demoTaskReport.available, true)
  assert.equal(report.evidence.demoTaskReport.ready, true)
  assert.deepEqual(report.evidence.demoTaskReport.missingTasks, [])
  assert.equal(report.evidence.demoTaskReport.roleProfileCount, 2)
  assert.equal(report.evidence.demoTaskReport.costReview.manualReviewMinutes, 18)
  assert.equal(report.gaps.some((gap) => gap.id === "demo_task_report"), false)
  assert.match(report.markdown, /Day 11-12 非玩具演示任务/)
  assert.match(report.markdown, /T01-T08 覆盖 \| T01, T02, T03, T04, T05, T06, T07, T08/)
  assert.match(report.markdown, /复核时间下降/)
  assert.match(report.markdown, /继续 Day 13-14 三人反馈/)
})

test("release evidence marks product-grade workbench smoke as blocking when missing or failed", () => {
  const common = {
    releaseGateReport: { ready: true, plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    arHealth: readyArHealth(),
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
  }
  const missing = buildReleaseEvidenceSummary(common)
  assert.equal(missing.ready, false)
  assert.equal(missing.gaps.some((gap) => gap.id === "workbench_deep" && gap.status === "missing"), true)

  const failed = buildReleaseEvidenceSummary({
    ...common,
    workbenchDeep: { ready: false, summary: { passed: 1, failed: 1, total: 2 } },
  })
  assert.equal(failed.gaps.some((gap) => gap.id === "workbench_deep" && gap.status === "not_ready"), true)
})

test("release evidence marks AU product-grade gate as blocking", () => {
  const common = {
    releaseGateReport: { ready: true, plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    workbenchRealProjectUi: readyWorkbenchRealProjectUi(),
    explorerFsParity: readyExplorerFsParity(),
    shellIntegration: readyShellIntegration(),
    debugAdapterSmoke: readyDebugAdapterSmoke(),
    enterpriseDocAudit: readyEnterpriseDocAudit(),
    extensionPlanAudit: readyExtensionPlanAudit(),
    agentChangeSafety: readyAgentChangeSafety(),
    routerCalibration: readyRouterCalibration(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    axEnterpriseGate: readyAxEnterpriseGate(),
  }
  const missing = buildReleaseEvidenceSummary(common)
  assert.equal(missing.gaps.some((gap) => gap.id === "product_grade_gate" && gap.status === "missing"), true)

  const failed = buildReleaseEvidenceSummary({
    ...common,
    productGradeGate: { ready: false, summary: { total: 10, ready: 9, blocked: 1 } },
  })
  assert.equal(failed.gaps.some((gap) => gap.id === "product_grade_gate" && gap.status === "not_ready"), true)
})

test("release evidence marks AX enterprise gate as blocking", () => {
  const common = {
    releaseGateReport: { ready: true, plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    workbenchRealProjectUi: readyWorkbenchRealProjectUi(),
    explorerFsParity: readyExplorerFsParity(),
    shellIntegration: readyShellIntegration(),
    debugAdapterSmoke: readyDebugAdapterSmoke(),
    enterpriseDocAudit: readyEnterpriseDocAudit(),
    extensionPlanAudit: readyExtensionPlanAudit(),
    agentChangeSafety: readyAgentChangeSafety(),
    routerCalibration: readyRouterCalibration(),
    productGradeGate: readyProductGradeGate(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    runs: readyContextRuns(),
  }
  const missing = buildReleaseEvidenceSummary(common)
  assert.equal(missing.gaps.some((gap) => gap.id === "ax_enterprise_gate" && gap.status === "missing"), true)

  const failed = buildReleaseEvidenceSummary({
    ...common,
    axEnterpriseGate: { ready: false, summary: { total: 16, ready: 15, blocked: 1, missing: 1 } },
  })
  assert.equal(failed.gaps.some((gap) => gap.id === "ax_enterprise_gate" && gap.status === "not_ready"), true)
})

test("release evidence marks extension enterprise gate as a blocking release requirement", () => {
  const common = {
    releaseGateReport: { ready: true, plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    workbenchRealProjectUi: readyWorkbenchRealProjectUi(),
    explorerFsParity: readyExplorerFsParity(),
    shellIntegration: readyShellIntegration(),
    debugAdapterSmoke: readyDebugAdapterSmoke(),
    enterpriseDocAudit: readyEnterpriseDocAudit(),
    extensionPlanAudit: readyExtensionPlanAudit(),
    agentChangeSafety: readyAgentChangeSafety(),
    routerCalibration: readyRouterCalibration(),
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    bdUserTrialReport: readyBdUserTrial(),
    runs: readyContextRuns(),
  }
  const missing = buildReleaseEvidenceSummary(common)
  assert.equal(missing.ready, false)
  assert.equal(missing.gaps.some((gap) => gap.id === "extension_enterprise_gate" && gap.status === "missing" && gap.severity === "high"), true)

  const failed = buildReleaseEvidenceSummary({
    ...common,
    extensionEnterpriseGate: {
      ...readyExtensionEnterpriseGate(),
      ready: false,
      status: "blocked",
      summary: { total: 5, passed: 4, warning: 0, failed: 1 },
      gaps: [{ id: "compatibility_blockers" }],
    },
  })
  assert.equal(failed.ready, false)
  assert.equal(failed.gaps.some((gap) => gap.id === "extension_enterprise_gate" && gap.status === "not_ready" && gap.severity === "high"), true)
})

test("release evidence marks EH SearchProvider E2E as a blocking release requirement", () => {
  const common = {
    releaseGateReport: { ready: true, plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    workbenchRealProjectUi: readyWorkbenchRealProjectUi(),
    explorerFsParity: readyExplorerFsParity(),
    shellIntegration: readyShellIntegration(),
    debugAdapterSmoke: readyDebugAdapterSmoke(),
    enterpriseDocAudit: readyEnterpriseDocAudit(),
    extensionPlanAudit: readyExtensionPlanAudit(),
    agentChangeSafety: readyAgentChangeSafety(),
    routerCalibration: readyRouterCalibration(),
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    bdUserTrialReport: readyBdUserTrial(),
    runs: readyContextRuns(),
    extensionMarketplaceSmoke: readyExtensionMarketplaceSmoke(),
    extensionInstallSmoke: readyExtensionInstallSmoke(),
    extensionMarketplaceInstallMatrix: readyExtensionMarketplaceInstallMatrix(),
    extensionMigrationSmoke: readyExtensionMigrationSmoke(),
    extensionSecuritySmoke: readyExtensionSecuritySmoke(),
    ehMarketplaceE2e: readyEhMarketplaceE2e(),
    ehMementoStorageE2e: readyEhMementoStorageE2e(),
    ehExtensionContextE2e: readyEhExtensionContextE2e(),
    ehImplicitActivationE2e: readyEhImplicitActivationE2e(),
    ehDependencyLoopE2e: readyEhDependencyLoopE2e(),
    ehProfileContentHandlerE2e: readyEhProfileContentHandlerE2e(),
    installedMcpDiscovery: readyInstalledMcpDiscovery(),
    mcpGalleryManagement: readyMcpGalleryManagement(),
    ehMcpProviderBridge: readyEhMcpProviderBridge(),
    extensionCompatibilityMatrix: readyExtensionCompatibilityMatrix(),
    extensionEnterpriseGate: readyExtensionEnterpriseGate(),
  }
  const missing = buildReleaseEvidenceSummary(common)
  assert.equal(missing.ready, false)
  assert.equal(missing.gaps.some((gap) => gap.id === "eh_search_provider_e2e" && gap.status === "missing" && gap.severity === "high"), true)

  const failed = buildReleaseEvidenceSummary({
    ...common,
    ehSearchProviderE2e: {
      ...readyEhSearchProviderE2e(),
      ready: true,
      fallbackBypassed: false,
      providerErrors: [{ error: "fq.folder.with is not a function" }],
    },
  })

  assert.equal(failed.ready, false)
  assert.equal(failed.evidence.ehSearchProviderE2e.ready, false)
  assert.equal(failed.evidence.ehSearchProviderE2e.providerErrors, 1)
  assert.equal(failed.gaps.some((gap) => gap.id === "eh_search_provider_e2e" && gap.status === "not_ready" && gap.severity === "high"), true)
})

test("release evidence marks EH ProfileContentHandler E2E as a blocking release requirement", () => {
  const common = {
    releaseGateReport: { ready: true, plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    workbenchRealProjectUi: readyWorkbenchRealProjectUi(),
    explorerFsParity: readyExplorerFsParity(),
    shellIntegration: readyShellIntegration(),
    debugAdapterSmoke: readyDebugAdapterSmoke(),
    enterpriseDocAudit: readyEnterpriseDocAudit(),
    extensionPlanAudit: readyExtensionPlanAudit(),
    agentChangeSafety: readyAgentChangeSafety(),
    routerCalibration: readyRouterCalibration(),
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    bdUserTrialReport: readyBdUserTrial(),
    runs: readyContextRuns(),
    extensionMarketplaceSmoke: readyExtensionMarketplaceSmoke(),
    extensionInstallSmoke: readyExtensionInstallSmoke(),
    extensionMarketplaceInstallMatrix: readyExtensionMarketplaceInstallMatrix(),
    extensionMigrationSmoke: readyExtensionMigrationSmoke(),
    extensionSecuritySmoke: readyExtensionSecuritySmoke(),
    ehMarketplaceE2e: readyEhMarketplaceE2e(),
    ehMementoStorageE2e: readyEhMementoStorageE2e(),
    ehExtensionContextE2e: readyEhExtensionContextE2e(),
    ehImplicitActivationE2e: readyEhImplicitActivationE2e(),
    ehDependencyLoopE2e: readyEhDependencyLoopE2e(),
    ehSearchProviderE2e: readyEhSearchProviderE2e(),
    extensionCompatibilityMatrix: readyExtensionCompatibilityMatrix(),
    extensionEnterpriseGate: readyExtensionEnterpriseGate(),
  }
  const missing = buildReleaseEvidenceSummary(common)
  assert.equal(missing.ready, false)
  assert.equal(missing.gaps.some((gap) => gap.id === "eh_profile_content_handler_e2e" && gap.status === "missing" && gap.severity === "high"), true)

  const failed = buildReleaseEvidenceSummary({
    ...common,
    ehProfileContentHandlerE2e: {
      ...readyEhProfileContentHandlerE2e(),
      ready: true,
      cleanupAfterStop: false,
      providerErrors: [{ error: "handler save failed" }],
    },
  })

  assert.equal(failed.ready, false)
  assert.equal(failed.evidence.ehProfileContentHandlerE2e.ready, false)
  assert.equal(failed.evidence.ehProfileContentHandlerE2e.cleanupAfterStop, false)
  assert.equal(failed.evidence.ehProfileContentHandlerE2e.providerErrors, 1)
  assert.equal(failed.gaps.some((gap) => gap.id === "eh_profile_content_handler_e2e" && gap.status === "not_ready" && gap.severity === "high"), true)
})

test("release evidence base readiness does not recurse through AU or AX gates", () => {
  const report = buildReleaseEvidenceSummary({
    releaseGateReport: { ready: true, plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    workbenchRealProjectUi: readyWorkbenchRealProjectUi(),
    explorerFsParity: readyExplorerFsParity(),
    shellIntegration: readyShellIntegration(),
    debugAdapterSmoke: readyDebugAdapterSmoke(),
    enterpriseDocAudit: readyEnterpriseDocAudit(),
    extensionPlanAudit: readyExtensionPlanAudit(),
    agentChangeSafety: readyAgentChangeSafety(),
    routerCalibration: readyRouterCalibration(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    productGradeGate: { ready: false, summary: { total: 10, ready: 9, blocked: 1 } },
    axEnterpriseGate: { ready: false, summary: { total: 16, ready: 15, blocked: 1 } },
    extensionMarketplaceSmoke: readyExtensionMarketplaceSmoke(),
    extensionInstallSmoke: readyExtensionInstallSmoke(),
    extensionMarketplaceInstallMatrix: readyExtensionMarketplaceInstallMatrix(),
    extensionMigrationSmoke: readyExtensionMigrationSmoke(),
    extensionSecuritySmoke: readyExtensionSecuritySmoke(),
    ehMarketplaceE2e: readyEhMarketplaceE2e(),
    ehMementoStorageE2e: readyEhMementoStorageE2e(),
    ehExtensionContextE2e: readyEhExtensionContextE2e(),
    ehImplicitActivationE2e: readyEhImplicitActivationE2e(),
    ehDependencyLoopE2e: readyEhDependencyLoopE2e(),
    ehSearchProviderE2e: readyEhSearchProviderE2e(),
    ehProfileContentHandlerE2e: readyEhProfileContentHandlerE2e(),
    installedMcpDiscovery: readyInstalledMcpDiscovery(),
    mcpGalleryManagement: readyMcpGalleryManagement(),
    ehMcpProviderBridge: readyEhMcpProviderBridge(),
    extensionCompatibilityMatrix: readyExtensionCompatibilityMatrix(),
    extensionEnterpriseGate: readyExtensionEnterpriseGate(),
    bdUserTrialReport: readyBdUserTrial(),
    runs: readyContextRuns(),
  })

  assert.equal(report.ready, true)
  assert.equal(report.summary.baseReady, true)
  assert.equal(report.gaps.some((gap) => gap.id === "product_grade_gate" && gap.severity === "low"), true)
  assert.equal(report.gaps.some((gap) => gap.id === "ax_enterprise_gate" && gap.severity === "low"), true)
})

test("release evidence treats missing BE beta run as advisory for product grade", () => {
  const report = buildReleaseEvidenceSummary({
    releaseGateReport: { ready: true, mode: "product-grade", plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    workbenchRealProjectUi: readyWorkbenchRealProjectUi(),
    explorerFsParity: readyExplorerFsParity(),
    shellIntegration: readyShellIntegration(),
    debugAdapterSmoke: readyDebugAdapterSmoke(),
    enterpriseDocAudit: readyEnterpriseDocAudit(),
    extensionPlanAudit: readyExtensionPlanAudit(),
    agentChangeSafety: readyAgentChangeSafety(),
    routerCalibration: readyRouterCalibration(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    extensionMarketplaceSmoke: readyExtensionMarketplaceSmoke(),
    extensionInstallSmoke: readyExtensionInstallSmoke(),
    extensionMarketplaceInstallMatrix: readyExtensionMarketplaceInstallMatrix(),
    extensionMigrationSmoke: readyExtensionMigrationSmoke(),
    extensionSecuritySmoke: readyExtensionSecuritySmoke(),
    ehMarketplaceE2e: readyEhMarketplaceE2e(),
    ehMementoStorageE2e: readyEhMementoStorageE2e(),
    ehExtensionContextE2e: readyEhExtensionContextE2e(),
    ehImplicitActivationE2e: readyEhImplicitActivationE2e(),
    ehDependencyLoopE2e: readyEhDependencyLoopE2e(),
    ehSearchProviderE2e: readyEhSearchProviderE2e(),
    ehProfileContentHandlerE2e: readyEhProfileContentHandlerE2e(),
    installedMcpDiscovery: readyInstalledMcpDiscovery(),
    mcpGalleryManagement: readyMcpGalleryManagement(),
    ehMcpProviderBridge: readyEhMcpProviderBridge(),
    extensionCompatibilityMatrix: readyExtensionCompatibilityMatrix(),
    extensionEnterpriseGate: readyExtensionEnterpriseGate(),
    bdUserTrialReport: readyBdUserTrial(),
    runs: readyContextRuns(),
  })

  assert.equal(report.ready, true)
  assert.equal(report.gaps.some((gap) => gap.id === "be_beta_trial_run" && gap.severity === "low"), true)
})

test("release evidence blocks public candidate when BE beta run is missing or has P0", () => {
  const common = {
    releaseGateReport: { ready: true, mode: "public-candidate-upstream", plannedSteps: ["typecheck"], steps: [{ id: "typecheck", passed: true }] },
    acceptanceReport: { ready: true, passed: 1, total: 1, matrix: { passed: 1, total: 1 } },
    readinessReport: { ready: true, status: "ready", statusLabel: "ready", summary: { passed: 1, total: 1 } },
    realTrialReport: { realWorkspaceTrial: { mainWorkspaceUntouchedBeforeAccept: true, rollbackAvailable: true } },
    arHealth: readyArHealth(),
    workbenchDeep: readyWorkbenchDeep(),
    workbenchRealProjectUi: readyWorkbenchRealProjectUi(),
    shellIntegration: readyShellIntegration(),
    debugAdapterSmoke: readyDebugAdapterSmoke(),
    agentChangeSafety: readyAgentChangeSafety(),
    routerCalibration: readyRouterCalibration(),
    packagingPreflight: { ready: true, summary: { passed: 1, failed: 0, total: 1 } },
    productGradeGate: readyProductGradeGate(),
    axEnterpriseGate: readyAxEnterpriseGate(),
    bdUserTrialReport: readyBdUserTrial(),
    runs: readyContextRuns(),
  }
  const missing = buildReleaseEvidenceSummary(common)
  assert.equal(missing.ready, false)
  assert.equal(missing.gaps.some((gap) => gap.id === "be_beta_trial_run" && gap.severity === "high"), true)

  const p0 = buildReleaseEvidenceSummary({
    ...common,
    betaTrialRunReport: {
      ...readyBetaTrialRun(),
      ready: false,
      status: "blocked",
      summary: { total: 10, passed: 9, failed: 1, blocked: 0, p0: 1, p1: 0, p2: 0 },
      defects: [{ severity: "P0", title: "主工作区误写" }],
    },
  })
  assert.equal(p0.ready, false)
  assert.equal(p0.evidence.betaTrialRun.p0, 1)
})

test("release evidence summary saves latest markdown, json, and history", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-release-evidence-"))
  const report = buildReleaseEvidenceSummary({
    createdAt: 200,
    releaseGateReport: { ready: false, plannedSteps: ["typecheck"], steps: [] },
  })

  const saved = saveReleaseEvidenceSummary(report, { reportDir })
  assert.equal(fs.existsSync(saved.markdownPath), true)
  assert.equal(fs.existsSync(saved.jsonPath), true)
  assert.equal(fs.existsSync(saved.historyMarkdownPath), true)
  assert.equal(fs.existsSync(saved.historyJsonPath), true)
  const markdown = fs.readFileSync(saved.markdownPath, "utf8")
  assert.match(markdown, /发布验收证据链摘要/)
  assert.match(markdown, /release-evidence-latest\.json/)
  assert.match(markdown, /release-evidence-latest\.md/)

  const latest = readLatestReleaseEvidenceSummary({ reportDir })
  const history = listReleaseEvidenceSummaries({ reportDir })
  assert.equal(latest.report.reportKind, "release-evidence")
  assert.equal(latest.markdownPath, saved.markdownPath)
  assert.equal(history.length, 1)
  assert.equal(history[0].jsonPath, saved.historyJsonPath)
})

test("release evidence manual UI gap reason matches remaining unconfirmed fields", () => {
  const report = buildReleaseEvidenceSummary({
    createdAt: 300,
    manualRealUiEvidence: {
      reportKind: "manual-real-ui-evidence",
      ready: false,
      status: "blocked",
      manualRunConfirmed: true,
      cursorLevelSmoothnessConfirmed: false,
      windowsExplorerCrossCheckConfirmed: true,
      latestJsonPath: "manual-real-ui-evidence-latest.json",
      latestMarkdownPath: "manual-real-ui-evidence-latest.md",
      summary: {
        totalScenarios: 11,
        passedScenarios: 11,
        requiredChecks: 35,
        passedChecks: 35,
        screenshotCount: 10,
        highGaps: 1,
        gaps: 1,
      },
    },
  })

  const gap = report.gaps.find((item) => item.id === "manual_real_ui_evidence")
  assert.equal(gap.status, "not_ready")
  assert.match(gap.reason, /Cursor 级主观流畅度确认/)
  assert.doesNotMatch(gap.reason, /Windows 资源管理器创建落点交叉检查/)
  assert.match(report.markdown, /Cursor 级主观流畅度确认/)
  assert.doesNotMatch(report.markdown, /也没有完成 Windows 资源管理器创建落点交叉检查/)
})

test("release evidence summarizes Agent MVP quality gates, failure classes, and cost placeholders", () => {
  const report = buildReleaseEvidenceSummary({
    createdAt: 123,
    usageSummary: {
      totalRequests: 2,
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      providerUsageRequests: 1,
      estimatedUsageRequests: 1,
      cost: {
        estimatedCostUsd: 0,
        currency: "USD",
        pricedRequests: 0,
        unpricedRequests: 2,
        unpricedModels: [{ provider: "openai", model: "gpt-next", requests: 2 }],
      },
      history: [
        { provider: "openai", model: "gpt-next", inputTokens: 120, outputTokens: 80, totalTokens: 200 },
      ],
    },
    runs: [{
      id: "run_quality_gate_fixture",
      projectRoot: "D:/Workspace",
      integrationDecision: {
        qualityGate: {
          status: "failed",
          commandResults: [
            { command: "node --test desktop/services/agentLoop/releaseEvidenceExport.test.js", exitCode: 0 },
            { command: "npm run typecheck", exitCode: 1 },
            { command: "npm run check:vscode-source-boundary", exitCode: 0 },
            { command: "git diff --check", exitCode: 0 },
          ],
        },
      },
    }],
    taskRunEvidence: [{
      id: "quality_gate_task",
      name: "Agent MVP Quality Gates",
      status: "failed",
      startedAt: 1,
      finishedAt: 2,
      steps: [
        { id: "focused", name: "focused tests", status: "passed", command: "node --test desktop/services/agentLoop/releaseEvidenceExport.test.js", exitCode: 0 },
        { id: "dist", name: "frontend dist consistency", status: "passed", command: "node scripts/frontend-dist-consistency.js", exitCode: 0 },
      ],
    }],
  })

  const quality = report.evidence.qualityGateSummary
  assert.equal(quality.available, true)
  assert.equal(quality.buckets.focusedTests.status, "passed")
  assert.equal(quality.buckets.typecheck.status, "failed")
  assert.equal(quality.buckets.sourceBoundary.status, "passed")
  assert.equal(quality.buckets.gitDiffCheck.status, "passed")
  assert.equal(quality.buckets.frontendDistConsistency.status, "passed")

  const failure = report.evidence.failureClassification
  assert.equal(failure.ready, false)
  assert.equal(failure.classifications.some((item) => item.id === "type_failure" && item.label === "类型失败"), true)
  assert.equal(failure.classifications.some((item) => item.id === "quality_gate_failure"), true)

  const cost = report.evidence.costReview
  assert.equal(cost.models[0].model, "gpt-next")
  assert.equal(cost.manualReviewPlaceholder, "manual_review_minutes_pending")
  assert.equal(cost.costUnavailableReason, "cost_price_table_unavailable")
  assert.equal(report.evidence.llmUsage.costUnavailableReason, "cost_price_table_unavailable")
  assert.equal(report.evidence.agentEvidenceWorkbench.report.qualityGateSummary.buckets.typecheck.status, "failed")
  assert.equal(report.evidence.agentEvidenceWorkbench.report.failureClassification.classifications.some((item) => item.id === "type_failure"), true)
  assert.match(report.markdown, /质量门与失败复盘/)
  assert.match(report.markdown, /成本摘要/)
})
