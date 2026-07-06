#!/usr/bin/env node

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const router = require(path.join(root, "desktop", "services", "router"))

const reportDir = process.env.CODEK_EXTENSION_HOST_RESTART_SMOKE_REPORT_DIR
  || path.join(root, ".codek", "reports")
const resultFile = process.env.CODEK_EXTENSION_HOST_RESTART_SMOKE_RESULT_FILE
  || path.join(reportDir, "extension-host-restart-smoke-latest-result.json")

function writeReport(payload) {
  const checks = Array.isArray(payload.checks) ? payload.checks : []
  const failed = checks.filter((check) => check.passed !== true)
  const normalized = {
    ...payload,
    smokeConsolidation: {
      smokeCase: "extension-host-restart",
      mode: payload.mode || "runtime-route-smoke",
      status: failed.length === 0 && payload.ok === true ? "connected" : "blocked",
      ok: failed.length === 0 && payload.ok === true,
      checkCount: checks.length,
      passedCount: checks.length - failed.length,
      failedCount: failed.length,
      resultFile,
      source: "scripts/extension-host-restart-smoke.js",
    },
  }
  fs.mkdirSync(path.dirname(resultFile), { recursive: true })
  fs.writeFileSync(resultFile, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  return normalized
}

function addCheck(checks, name, passed, detail = "") {
  checks.push({ name, passed: Boolean(passed), detail })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function removeTempRootBestEffort(tempRoot) {
  let lastError = ""
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true })
      return ""
    } catch (error) {
      lastError = String(error?.message || error)
      await sleep(100 * (attempt + 1))
    }
  }
  return lastError
}

async function main() {
  const startedAt = Date.now()
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-eh-restart-smoke-"))
  const workspaceRoot = path.join(tempRoot, "workspace")
  const extensionsDir = path.join(tempRoot, "extensions")
  const workspaceFile = path.join(tempRoot, "restart-smoke.code-workspace")
  fs.mkdirSync(workspaceRoot, { recursive: true })
  fs.mkdirSync(extensionsDir, { recursive: true })
  fs.writeFileSync(workspaceFile, `${JSON.stringify({
    folders: [{ path: workspaceRoot }],
    settings: {},
  }, null, 2)}\n`, "utf8")

  let server = null
  let hostAdapter = null
  const checks = []
  const report = {
    ok: false,
    smokeCase: "extension-host-restart",
    mode: "runtime-route-smoke",
    createdAt: Date.now(),
    route: "POST /extensions-host/lifecycle/restart",
    result: null,
    evidence: null,
    before: {},
    after: {},
    manifestState: {},
    connected: [],
    partial: [
      "Electron UI main-window smoke is not wired in this lane because desktop/main.js and App.vue are outside the allowed edit surface.",
    ],
    blocked: [],
    checks,
    cleanupError: "",
    durationMs: 0,
  }

  try {
    const extensionsHost = require(path.join(root, "desktop", "services", "extensions-host"))
    const { ExtensionHostServer } = require(path.join(root, "desktop", "services", "extensions-host", "extHostServer"))
    const { scanExtensions } = require(path.join(root, "desktop", "services", "extensions-host", "extensionScanner"))
    server = new ExtensionHostServer()
    hostAdapter = {
      get isRunning() {
        return server.isRunning
      },
      get _installedExtensionsRegistered() {
        return server._installedExtensionsRegistered
      },
      get _process() {
        return server._process
      },
      once: (...args) => server.once(...args),
      stop: () => server.stop(),
      start: (initData = {}) => server.start({
        ...initData,
        extensionsDir,
        extensionsMaxDepth: 1,
      }),
      _setWorkspaceRoots: (...args) => {
        if (typeof server._setWorkspaceRoots === "function") server._setWorkspaceRoots(...args)
      },
      _setWorkspaceRoot: (...args) => {
        if (typeof server._setWorkspaceRoot === "function") server._setWorkspaceRoot(...args)
      },
      _registerConfigurationDefaults: (...args) => {
        if (typeof server._registerConfigurationDefaults === "function") server._registerConfigurationDefaults(...args)
      },
    }
    const scanBefore = scanExtensions({ extensionsDir, maxDepth: 1 })
    await server.start({
      rootDir: workspaceRoot,
      workspaceRoots: [workspaceRoot],
      workspaceFile,
      extensionsDir,
      extensionsMaxDepth: 1,
    })
    await server.whenInstalledExtensionsRegistered(10000)
    const beforePid = server._process?.pid || 0
    report.before = {
      isRunning: server.isRunning,
      pid: beforePid,
      installedExtensionsRegistered: server._installedExtensionsRegistered === true,
    }

    router.clearRoutes()
    extensionsHost.register(router, { getHost: () => hostAdapter })
    const result = await router.dispatch({
      method: "POST",
      path: "/extensions-host/lifecycle/restart",
      body: {
        reason: "Extension host restart smoke",
        rootDir: workspaceRoot,
        workspaceRoots: [workspaceRoot],
        workspaceFile,
        extensionsDir,
        extensionsMaxDepth: 1,
      },
    })
    await server.whenInstalledExtensionsRegistered(10000)
    const afterPid = server._process?.pid || 0
    const evidence = result.data?.evidence || null
    const evidenceJson = JSON.stringify(evidence || {})
    const scanAfter = scanExtensions({ extensionsDir, maxDepth: 1 })

    report.result = result
    report.evidence = evidence
    report.after = {
      isRunning: server.isRunning,
      pid: afterPid,
      processReplaced: beforePid > 0 && afterPid > 0 && beforePid !== afterPid,
      installedExtensionsRegistered: server._installedExtensionsRegistered === true,
    }
    report.hostKind = evidence?.hostKind || ""
    report.hostSource = evidence?.hostSource || ""
    report.lifecyclePhase = evidence?.lifecyclePhase || ""
    report.activationReplay = evidence?.activationReplay || ""
    report.restartRequested = evidence?.restartRequested === true
    report.restartObserved = evidence?.restartObserved === true
    report.blockedBy = evidence?.blockedBy || ""
    report.blockedReason = evidence?.blockedReason || ""
    report.manifestState = {
      isolatedExtensionsDir: extensionsDir,
      beforeCount: scanBefore.allExtensions.length,
      afterCount: scanAfter.allExtensions.length,
      emptyFixtureAccepted: scanAfter.allExtensions.length === 0,
      registeredAfterRestart: server._installedExtensionsRegistered === true,
    }

    addCheck(checks, "restart route dispatch succeeds", result.ok === true && result.data?.success === true, JSON.stringify(result))
    addCheck(checks, "restart evidence uses extension host lifecycle service", evidence?.serviceId === "extensionHostLifecycleService", JSON.stringify(evidence))
    addCheck(checks, "restart evidence records VS Code-style host source", evidence?.hostKind === "LocalProcess" && evidence?.hostSource === "ExtensionHostServer", JSON.stringify(evidence))
    addCheck(checks, "restart evidence records lifecycle phase and activation replay", evidence?.lifecyclePhase === "restarted" && evidence?.activationReplay === "preserveRequestedActivationEvents", JSON.stringify(evidence))
    addCheck(checks, "restart evidence records requested and observed restart", evidence?.restartRequested === true && evidence?.restartObserved === true && evidence?.blockedReason === "", JSON.stringify(evidence))
    addCheck(checks, "restart composes stop and start evidence", evidence?.stopEvidence?.stopped === true && evidence?.startEvidence?.started === true, JSON.stringify(evidence))
    addCheck(checks, "restart does not request workbench window reload", evidence?.reloadRequested === false && evidence?.reloaded === false && !evidenceJson.includes("IHostService.reload"), evidenceJson)
    addCheck(checks, "restart keeps workspace roots and workspace file evidence", Array.isArray(evidence?.workspaceRoots) && evidence.workspaceRoots[0] === workspaceRoot && evidence.workspaceFile === workspaceFile, JSON.stringify(evidence))
    addCheck(checks, "extension host process is running after restart", server.isRunning === true && afterPid > 0, JSON.stringify(report.after))
    addCheck(checks, "extension host process was replaced by restart", report.after.processReplaced === true, JSON.stringify({ beforePid, afterPid }))
    addCheck(checks, "extension manifest state is registered after restart", report.manifestState.registeredAfterRestart === true && report.manifestState.emptyFixtureAccepted === true, JSON.stringify(report.manifestState))

    report.connected = [
      "desktop/services/extensions-host/register lifecycle restart route",
      "ExtensionHostServer real process start/stop/start lifecycle",
      "restart evidence stopEvidence/startEvidence contract",
      "isolated extension manifest registration after restart",
    ]
    report.ok = checks.every((check) => check.passed === true)
  } catch (error) {
    report.error = String(error?.message || error)
    report.errorName = String(error?.name || "")
    report.errorStack = String(error?.stack || "")
    report.hostKind = ""
    report.hostSource = ""
    report.lifecyclePhase = "blocked"
    report.activationReplay = ""
    report.restartRequested = true
    report.restartObserved = false
    report.blockedBy = "runtime-route-smoke"
    report.blockedReason = report.error
    report.evidence = report.evidence || {
      serviceId: "extensionHostLifecycleService",
      stateSource: "desktop.extensionsHostService",
      vscodeContract: "IExtensionService.stopExtensionHosts+startExtensionHosts",
      action: "restartExtensionHosts",
      restartRequested: true,
      restartObserved: false,
      restarted: false,
      reloadRequested: false,
      reloaded: false,
      hostKind: "",
      hostSource: "",
      lifecyclePhase: "blocked",
      activationReplay: "",
      blockedBy: "runtime-route-smoke",
      blockedReason: report.error,
      stopEvidence: null,
      startEvidence: null,
    }
    report.blocked.push({
      id: "runtime-route-smoke",
      reason: report.error,
      nextAction: "Install desktop dependencies or run in the packaged Electron smoke environment, then rerun node scripts/extension-host-restart-smoke.js.",
    })
    addCheck(checks, "extension host restart smoke completed without throwing", false, report.error)
  } finally {
    try { if (server) server.stop() } catch {}
    router.clearRoutes()
    report.cleanupError = await removeTempRootBestEffort(tempRoot)
    report.durationMs = Date.now() - startedAt
  }

  const saved = writeReport(report)
  process.stdout.write(`${JSON.stringify(saved, null, 2)}\n`)
  process.exit(saved.smokeConsolidation.ok ? 0 : 1)
}

main().catch((error) => {
  const saved = writeReport({
    ok: false,
    smokeCase: "extension-host-restart",
    mode: "runtime-route-smoke",
    error: String(error?.message || error),
    errorStack: String(error?.stack || ""),
    checks: [{
      name: "extension host restart smoke fatal error",
      passed: false,
      detail: String(error?.message || error),
    }],
  })
  process.stdout.write(`${JSON.stringify(saved, null, 2)}\n`)
  process.exit(1)
})
