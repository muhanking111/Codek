/**
 * Extension Host Service — manages VS Code Extension Host lifecycle.
 *
 * Architecture:
 *   Renderer (Web) ← IPC → Main Process (Electron)
 *     └── ExtensionHostServer
 *           ├── mainThread/ proxies (10 handlers)
 *           └── spawns EH bundle (extHost.bundle.mjs)
 *                 └── loads real VS Code extensions
 *
 * API Routes:
 *   POST /extensions-host/start     Start the extension host
 *   POST /extensions-host/stop      Stop the extension host
 *   GET  /extensions-host/status    Check if running
 *   POST /extensions-host/send      Send a message to EH
 */

const path = require("path")
function resolveIpcMain() {
  try {
    return require("electron").ipcMain
  } catch {
    return {
      handle() {},
      on() {},
      removeHandler() {},
      removeListener() {},
    }
  }
}
const ipcMain = resolveIpcMain()
const { ExtensionHostServer } = require("./extHostServer")
const { registerAllProxies } = require("./mainThread/index")
const { wrapWithAutoRestart } = require("./faultRecovery")
const { appendExtensionAudit } = require("./extensionAuditLog")
const { buildExtensionConfigurationDefaults } = require("./configurationDefaults")
const { buildExtensionWorkbenchContributions } = require("./workbenchContributions")
const mainThreadCommands = require("./mainThread/mainThreadCommands")
const { buildIconThemeCatalog, loadFileIconTheme } = require("./iconThemes")
const {
  evaluateWorkspaceTrustAction,
  WORKSPACE_TRUST_OWNER_EVIDENCE,
} = require("../workspaceTrust")
const profileContentHandlers = require("./mainThread/mainThreadProfileContentHandlers")
const {
  createExtensionHostProfileContentHandlerActivationAdapter,
} = require("./profileContentHandlerActivationAdapter")
const mcpGalleryService = require("../mcp/mcpGalleryServiceAdapter")
const mcpGalleryInstall = require("../mcp/mcpGalleryInstallAdapter")
const mcpResourceScanner = require("../mcp/mcpResourceScannerAdapter")
const mcpProfileRegistry = require("../mcp/profileMcpAdapter")
const { McpRegistryInputStorageAdapter } = require("../mcp/mcpRegistryInputStorageAdapter")

let host = null
let lastRootDir = __dirname
const providerRegistry = { providers: [] }

/** Lazily get the first BrowserWindow for renderer communication */
function getMainWindow() {
  try {
    const { BrowserWindow } = require("electron")
    const windows = BrowserWindow.getAllWindows()
    return windows.length > 0 ? windows[0] : null
  } catch {
    return null
  }
}

/**
 * Helper to call a method on the Extension Host via RPC and wait for reply.
 * Wraps server.call() with the correct ExtHost proxy nid.
 */
function makeCallEh(server) {
  return (extHostNid, method, args, timeoutMs, options) => {
    if (!server || !server.isRunning) return Promise.reject(new Error("EH not running"))
    return server.call(extHostNid, method, args, timeoutMs, options)
  }
}

function getHost() {
  if (!host) {
    host = new ExtensionHostServer({
      auditApiInvocation: (entry) => appendExtensionAudit(entry),
    })

    const sendToRenderer = (channel, data) => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        try { win.webContents.send(channel, data) } catch {}
      }
    }

    // Shared workspace root setter for MainThreadWorkspace
    let _setWorkspaceRoot = null
    let _setWorkspaceRoots = null
    let _setStorageWorkspaceRoot = null
    let _registerConfigurationDefaults = null
    const debugRegistry = { state: { debugTypes: [], configurationProviders: [], adapterFactories: [], sessions: [] } }

    // Register all MainThread proxies with full opts
    registerAllProxies(host, {
      sendToRenderer,
      ipcMain,
      callEh: makeCallEh(host),
      setWorkspaceRoot: (fn) => { _setWorkspaceRoot = fn },
      setWorkspaceRoots: (fn) => { _setWorkspaceRoots = fn },
      setWorkspaceRootForStorage: (fn) => { _setStorageWorkspaceRoot = fn },
      syncProviders: (providers) => {
        providerRegistry.providers = providers
      },
      syncDebugState: (state) => {
        debugRegistry.state = state
      },
      registerConfigurationDefaults: (fn) => {
        _registerConfigurationDefaults = fn
      },
      // Bridge to Codek's Git service (lazy-loaded)
      gitService: (() => {
        try { return require("../git") } catch { return null }
      })(),
    })

    // After proxies are registered, expose workspace root for later updates
    host._setWorkspaceRoot = (rootDir) => {
      if (_setWorkspaceRoot) _setWorkspaceRoot(rootDir)
      if (_setStorageWorkspaceRoot) _setStorageWorkspaceRoot(rootDir)
    }
    host._setWorkspaceRoots = (roots, workspaceFile = null) => {
      const nextRoots = Array.isArray(roots) ? roots : []
      if (_setWorkspaceRoots) _setWorkspaceRoots(nextRoots, workspaceFile)
      if (_setStorageWorkspaceRoot) _setStorageWorkspaceRoot(nextRoots[0] || null)
    }
    host._debugRegistry = debugRegistry
    host._registerConfigurationDefaults = () => {
      if (!_registerConfigurationDefaults) return
      try {
        const extMgr = require("./extensionManager")
        const contributions = extMgr
          .getInstalledExtensions()
          .filter((extension) => extension.enabled !== false)
          .map((extension) => extension.contributes)
          .filter(Boolean)
        if (contributions.length > 0) {
          _registerConfigurationDefaults(contributions)
        }
      } catch (err) {
        console.warn("[extensions-host] Failed to register configuration defaults:", err.message)
      }
    }

    // Wrap with fault recovery (W7)
    const recovery = wrapWithAutoRestart(host)
    host._recovery = recovery
  }
  return host
}

function getCurrentHost() {
  return host
}

function reloadHost(rootDir = lastRootDir) {
  const h = getHost()
  lastRootDir = rootDir || lastRootDir || __dirname
  if (h.isRunning) {
    try { h.stop() } catch {}
  }
  h.start({ rootDir: lastRootDir }).catch((e) => console.error("[eh] reload failed:", e.message))
  return true
}

const EXTENSION_INSTALL_CONFIRMATION_OWNER_EVIDENCE = Object.freeze({
  ...WORKSPACE_TRUST_OWNER_EVIDENCE,
  source: "desktop.extensionsHostService.installConfirmationOwner",
  stateSource: "workspaceTrustStore+extensionInstallRoute",
  trustStateSource: WORKSPACE_TRUST_OWNER_EVIDENCE.trustStateSource,
  extensionTrustGateOwner: "desktop/services/extensions-host index.js install routes",
  vscodeContract: "IExtensionsWorkbenchService._install -> IDialogService.prompt -> installFromVSIX/installFromGallery",
  owner: "workbenchDialogOwner",
  currentSourcePaths: Object.freeze([
    "desktop/services/extensions-host/index.js",
    "desktop/services/workspaceTrust/index.js",
    "frontend/vite-project/src/extensions/extensionsWorkbenchService.ts",
  ]),
  vscodeSourcePaths: Object.freeze([
    "src/vs/workbench/contrib/extensions/browser/extensionsWorkbenchService.ts",
  ]),
  noSecondInstallState: true,
  routeDoesNotAutoConfirm: true,
  runtimeReference: false,
})

function buildExtensionInstallConfirmationEvidence(input = {}) {
  const route = input.route || ""
  const installSource = input.installSource || "marketplace"
  const confirmed = input.confirmed === true
  const trustDecision = input.trustDecision || {}
  const confirmationRequired = trustDecision.code === "workspace_trust_confirmation_required"
  return {
    ...EXTENSION_INSTALL_CONFIRMATION_OWNER_EVIDENCE,
    route,
    installSource,
    workspaceTrust: trustDecision.status || "unknown",
    confirmationRequired,
    confirmed,
    confirmedSource: confirmed ? "request.confirmed" : "none",
    status: confirmationRequired ? "blocked" : confirmed ? "confirmed" : "notRequired",
    blockedBy: confirmationRequired ? "appShellOrGenericDialogOwner" : "none",
    reason: confirmationRequired
      ? "VS Code confirms extension and VSIX installs through IDialogService.prompt before installFromVSIX/installFromGallery. This desktop route has no dialog owner, so it must reject unknown-workspace installs until App shell or generic dialog owner supplies confirmed=true."
      : "The route only consumes explicit confirmation evidence from the workbench service/client boundary and never defaults confirmed=true.",
  }
}

function resolveLifecycleWorkspaceRoots(options = {}) {
  const workspaceRoots = Array.isArray(options.workspaceRoots)
    ? options.workspaceRoots.map((root) => String(root || "").trim()).filter(Boolean)
    : []
  if (workspaceRoots.length > 0) return workspaceRoots
  const fallback = [options.projectRoot, options.rootDir, lastRootDir, __dirname]
    .map((root) => String(root || "").trim())
    .find(Boolean)
  return [fallback || __dirname]
}

function resolveLifecycleWorkspaceFile(options = {}) {
  return typeof options.workspaceFile === "string" && options.workspaceFile.trim()
    ? options.workspaceFile.trim()
    : null
}

const EXTENSION_HOST_LIFECYCLE_SOURCE = Object.freeze({
  hostKind: "LocalProcess",
  hostSource: "ExtensionHostServer",
  lifecycleStateSource: "desktop.extensionsHostService",
  vscodeSourcePaths: Object.freeze([
    "src/vs/workbench/services/extensions/common/abstractExtensionService.ts",
    "src/vs/workbench/contrib/extensions/browser/extensionsWorkbenchService.ts",
    "src/vs/workbench/contrib/extensions/browser/extensionEnablementWorkspaceTrustTransitionParticipant.ts",
    "src/vs/workbench/services/userDataProfile/browser/userDataProfileManagement.ts",
  ]),
  currentSourcePaths: Object.freeze([
    "desktop/services/extensions-host/index.js",
    "scripts/extension-host-restart-smoke.js",
    "scripts/release-evidence-export.js",
    "desktop/services/agentLoop/releaseEvidenceExport.js",
  ]),
  runtimeReference: false,
  noSecondExtensionHostState: true,
})

function buildExtensionHostLifecycleEvidence(input = {}) {
  return {
    ...EXTENSION_HOST_LIFECYCLE_SOURCE,
    lifecyclePhase: input.lifecyclePhase || "requested",
    blockedBy: input.blockedBy || "none",
    blockedReason: input.blockedReason || "",
    activationReplay: input.activationReplay || "preserveRequestedActivationEvents",
  }
}

async function startExtensionHosts(options = {}) {
  const h = typeof options.getHost === "function" ? options.getHost() : getHost()
  const workspaceRoots = resolveLifecycleWorkspaceRoots(options)
  const rootDir = workspaceRoots[0] || __dirname
  const workspaceFile = resolveLifecycleWorkspaceFile(options)
  lastRootDir = rootDir
  const evidence = {
    serviceId: "extensionHostLifecycleService",
    stateSource: "desktop.extensionsHostService",
    vscodeContract: "IExtensionService.startExtensionHosts",
    action: "startExtensionHosts",
    reason: typeof options.reason === "string" && options.reason.trim() ? options.reason.trim() : "",
    requested: true,
    started: false,
    alreadyRunning: !!h.isRunning,
    ...buildExtensionHostLifecycleEvidence({ lifecyclePhase: h.isRunning ? "alreadyRunning" : "starting" }),
    rootDir,
    workspaceRoots,
    workspaceFile,
    createdAt: Date.now(),
  }
  if (h.isRunning) {
    return { success: true, message: "Already running", evidence: { ...evidence, started: true } }
  }

  try {
    const startPromise = h.start({ rootDir, workspaceRoots, workspaceFile })
    if (startPromise && typeof startPromise.catch === "function") {
      startPromise.catch((err) => {
        console.error("[extensions-host] Failed to start:", err.message)
      })
    }
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Extension host failed to start within 5s")), 5000)
      h.once("ready", () => {
        clearTimeout(timeout)
        if (h._setWorkspaceRoots) h._setWorkspaceRoots(workspaceRoots, workspaceFile)
        else if (h._setWorkspaceRoot) h._setWorkspaceRoot(rootDir)
        if (h._registerConfigurationDefaults) h._registerConfigurationDefaults()
        resolve()
      })
    })
    return { success: true, evidence: { ...evidence, started: true, lifecyclePhase: "started" } }
  } catch (err) {
    return {
      success: false,
      error: err.message,
      evidence: {
        ...evidence,
        started: false,
        lifecyclePhase: "blocked",
        blockedBy: "startExtensionHosts",
        blockedReason: err.message,
        error: err.message,
      },
    }
  }
}

async function stopExtensionHosts(options = {}) {
  const h = typeof options.getHost === "function" ? options.getHost() : getCurrentHost()
  const workspaceRoots = resolveLifecycleWorkspaceRoots(options)
  const rootDir = workspaceRoots[0] || __dirname
  const workspaceFile = resolveLifecycleWorkspaceFile(options)
  const reason = typeof options.reason === "string" && options.reason.trim()
    ? options.reason.trim()
    : "Stopping extension hosts"
  const auto = options.auto !== false
  const wasRunning = !!(h && h.isRunning)
  const evidence = {
    serviceId: "extensionHostLifecycleService",
    stateSource: "desktop.extensionsHostService",
    vscodeContract: "IExtensionService.stopExtensionHosts",
    action: "stopExtensionHosts",
    reason,
    auto,
    requested: true,
    stopped: false,
    wasRunning,
    vetoed: false,
    vetoReason: "",
    ...buildExtensionHostLifecycleEvidence({ lifecyclePhase: !h ? "missing" : wasRunning ? "stopping" : "notRunning" }),
    rootDir,
    workspaceRoots,
    workspaceFile,
    createdAt: Date.now(),
  }
  if (!h) {
    return {
      success: true,
      evidence: {
        ...evidence,
        reason: `${reason}; no extension host instance exists`,
        lifecyclePhase: "notRunning",
        blockedBy: "missingHost",
        blockedReason: "no extension host instance exists",
      },
    }
  }
  if (!wasRunning) {
    return { success: true, evidence }
  }
  try {
    const vetoReason = typeof options.willStopVeto === "function"
      ? await options.willStopVeto({ reason, auto })
      : ""
    if (vetoReason) {
      return {
        success: true,
        evidence: {
          ...evidence,
          vetoed: true,
          vetoReason: typeof vetoReason === "string" ? vetoReason : "extension host stop vetoed",
          lifecyclePhase: "blocked",
          blockedBy: "onWillStopVeto",
          blockedReason: typeof vetoReason === "string" ? vetoReason : "extension host stop vetoed",
        },
      }
    }
    h.stop()
    return { success: true, evidence: { ...evidence, stopped: true, lifecyclePhase: "stopped" } }
  } catch (err) {
    return {
      success: false,
      error: err.message,
      evidence: {
        ...evidence,
        lifecyclePhase: "blocked",
        blockedBy: "stopExtensionHosts",
        blockedReason: err.message,
        error: err.message,
      },
    }
  }
}

async function restartExtensionHosts(options = {}) {
  const workspaceRoots = resolveLifecycleWorkspaceRoots(options)
  const rootDir = workspaceRoots[0] || __dirname
  const workspaceFile = resolveLifecycleWorkspaceFile(options)
  const reason = typeof options.reason === "string" && options.reason.trim()
    ? options.reason.trim()
    : "Restarting extension hosts"
  const baseEvidence = {
    serviceId: "extensionHostLifecycleService",
    stateSource: "desktop.extensionsHostService",
    vscodeContract: "IExtensionService.stopExtensionHosts+startExtensionHosts",
    action: "restartExtensionHosts",
    reason,
    auto: options.auto !== false,
    requested: true,
    restartRequested: true,
    restartObserved: false,
    restarted: false,
    reloadRequested: false,
    reloaded: false,
    ...buildExtensionHostLifecycleEvidence({ lifecyclePhase: "restarting" }),
    rootDir,
    workspaceRoots,
    workspaceFile,
    createdAt: Date.now(),
  }
  const getHost = typeof options.getHost === "function" ? options.getHost : undefined
  const stopResult = await stopExtensionHosts({
    ...options,
    reason,
    workspaceRoots,
    rootDir,
    workspaceFile,
    getHost,
  })
  const stopEvidence = stopResult.evidence || null
  if (!stopResult.success) {
    return {
      success: false,
      error: stopResult.error,
      evidence: {
        ...baseEvidence,
        stopEvidence,
        error: stopResult.error,
        blockedBy: "stopExtensionHosts",
        blockedReason: stopResult.error || stopEvidence?.blockedReason || "",
        lifecyclePhase: "blocked",
        startEvidence: null,
      },
    }
  }
  if (stopEvidence?.vetoed) {
    return {
      success: true,
      evidence: {
        ...baseEvidence,
        stopEvidence,
        startEvidence: null,
        restartObserved: false,
        blockedBy: "onWillStopVeto",
        blockedReason: stopEvidence.vetoReason || stopEvidence.blockedReason || "extension host stop vetoed",
        lifecyclePhase: "blocked",
        vetoed: true,
        vetoReason: stopEvidence.vetoReason || "extension host stop vetoed",
      },
    }
  }
  if (stopEvidence && stopEvidence.wasRunning === false) {
    return {
      success: true,
      message: "Extension host was not running",
      evidence: {
        ...baseEvidence,
        stopEvidence,
        restartRequested: false,
        restartObserved: false,
        lifecyclePhase: "notRunning",
        blockedReason: "extension host was not running",
        startEvidence: null,
        blockedBy: "none",
      },
    }
  }

  const startResult = await startExtensionHosts({
    ...options,
    reason,
    workspaceRoots,
    rootDir,
    workspaceFile,
    getHost,
  })
  const startEvidence = startResult.evidence || null
  if (!startResult.success) {
    return {
      success: false,
      error: startResult.error,
      evidence: {
        ...baseEvidence,
        stopEvidence,
        startEvidence,
        error: startResult.error,
        blockedBy: "startExtensionHosts",
        blockedReason: startResult.error || startEvidence?.blockedReason || "",
        lifecyclePhase: "blocked",
      },
    }
  }
  return {
    success: true,
    evidence: {
      ...baseEvidence,
      restarted: startEvidence?.started === true,
      restartObserved: startEvidence?.started === true && stopEvidence?.stopped === true,
      lifecyclePhase: startEvidence?.started === true ? "restarted" : "blocked",
      blockedReason: startEvidence?.started === true ? "" : "start evidence did not report started=true",
      stopEvidence,
      startEvidence,
      blockedBy: "none",
    },
  }
}

function resolveMcpResourceTarget(body = {}) {
  const workspaceResource = [
    body.workspaceFile,
    body.workspaceResource,
    body.mcpResourcePath,
    body.resourcePath,
  ].find((value) => typeof value === "string" && value.trim())
  const isWorkspaceResource = typeof workspaceResource === "string"
    && path.resolve(workspaceResource).endsWith(".code-workspace")
  const target = typeof body.mcpTarget === "string" && body.mcpTarget.trim()
    ? body.mcpTarget.trim()
    : (typeof body.target === "string" && body.target.trim()
      ? body.target.trim()
      : (isWorkspaceResource ? "workspace" : "user"))
  const workspace = typeof body.workspace === "string" && body.workspace.trim()
    ? body.workspace.trim()
    : (typeof body.projectRoot === "string" && body.projectRoot.trim()
      ? body.projectRoot.trim()
      : (typeof body.rootDir === "string" && body.rootDir.trim()
        ? body.rootDir.trim()
        : (isWorkspaceResource ? workspaceResource.trim() : "")))
  const profileId = typeof body.profileId === "string" && body.profileId.trim() ? body.profileId.trim() : ""
  const profileResource = body.profileResource
  const filePath = typeof body.profileResourcePath === "string" && body.profileResourcePath.trim()
    ? body.profileResourcePath.trim()
    : (typeof profileResource === "string" && profileResource.trim()
      ? profileResource.trim()
      : (profileResource && typeof profileResource.filePath === "string" ? profileResource.filePath.trim() : ""))
  const explicit = Boolean(workspace || profileId || filePath || profileResource || workspaceResource)
  return {
    explicit,
    options: {
      target,
      workspace: workspace || undefined,
      workspaceFile: typeof body.workspaceFile === "string" && body.workspaceFile.trim() ? body.workspaceFile.trim() : undefined,
      workspaceResource: typeof body.workspaceResource === "string" && body.workspaceResource.trim() ? body.workspaceResource.trim() : undefined,
      profileId: profileId || undefined,
      filePath: filePath || undefined,
      mcpResourcePath: typeof body.mcpResourcePath === "string" && body.mcpResourcePath.trim() ? body.mcpResourcePath.trim() : undefined,
      resourcePath: typeof body.resourcePath === "string" && body.resourcePath.trim() ? body.resourcePath.trim() : undefined,
      changeReason: "mcp-gallery:resource",
    },
  }
}

function createMcpRegistryInputStorage(source = {}) {
  const profileId = typeof source.profileId === "string" && source.profileId.trim()
    ? source.profileId.trim()
    : undefined
  return new McpRegistryInputStorageAdapter({ profileId })
}

async function persistMcpGalleryInstallInputs(body = {}) {
  const hasValues = body?.values && typeof body.values === "object"
  const hasSecrets = body?.secrets && typeof body.secrets === "object"
  if (!hasValues && !hasSecrets) return null
  const storage = createMcpRegistryInputStorage(body)
  if (hasValues) await storage.setPlainText(body.values)
  if (hasSecrets) await storage.setSecrets(body.secrets)
  return {
    profileId: typeof body.profileId === "string" && body.profileId.trim() ? body.profileId.trim() : undefined,
    values: hasValues ? Object.keys(body.values).filter(Boolean) : [],
    secrets: hasSecrets ? Object.keys(body.secrets).filter(Boolean) : [],
  }
}

function register(router, opts = {}) {
  console.log("[extensions-host] Registering (VS Code EH)")
  const activateProfileContentHandlers = typeof opts.activateProfileContentHandlers === "function"
    ? opts.activateProfileContentHandlers
    : createExtensionHostProfileContentHandlerActivationAdapter({
      getHost: getCurrentHost,
      timeoutMs: opts.profileContentHandlerActivationTimeoutMs,
    })

  router.register("POST", "/extensions-host/start", async ({ body }) => {
    return startExtensionHosts({ ...(body || {}), getHost: () => getHost() })
  })

  router.register("POST", "/extensions-host/stop", async ({ body }) => {
    return stopExtensionHosts({ ...(body || {}), getHost: () => host })
  })

  router.register("GET", "/extensions-host/status", async () => {
    const h = getHost()
    const recovery = h._recovery ? h._recovery.getState() : null
    let activated = 0
    try {
      const exts = require("./extensionManager").getInstalledExtensions()
      activated = exts.filter((e) => e.enabled !== false).length
    } catch {}
    return {
      running: h.isRunning,
      state: h.isRunning ? "ready" : (recovery && recovery.state) || "idle",
      activated,
      lifecycle: (() => {
        try { return require("./mainThread/mainThreadExtensionService").getLifecycleState() } catch { return null }
      })(),
      error: recovery && recovery.lastError ? String(recovery.lastError.message || recovery.lastError) : undefined,
    }
  })

  router.register("GET", "/extensions-host/recovery", async () => {
    const h = getHost()
    const state = h._recovery ? h._recovery.getState() : { running: h.isRunning }
    return state
  })

  router.register("POST", "/extensions-host/send", async ({ body }) => {
    const h = getHost()
    if (!h.isRunning) return { success: false, error: "Extension host not running" }
    h.send(body?.message || "")
    return { success: true }
  })

  // ── Renderer→Main→EH RPC proxy (W3 Monaco bridge) ──────────────────

  router.register("POST", "/ext-host/call", async ({ body }) => {
    const h = getHost()
    if (!h.isRunning) throw new Error("EH not running")
    const { extHostNid, method, args } = body || {}
    const result = await h.call(extHostNid || 101, method, args || [])
    return { result }
  })

  // Provider registry access for renderer
  router.register("GET", "/ext-host/providers", async () => {
    return providerRegistry
  })

  router.register("GET", "/extensions-host/mcp-registry", async () => ({
    collections: mcpProfileRegistry.listMcpCollections(),
    servers: mcpProfileRegistry.listConfiguredMcpServers(),
    delegates: mcpProfileRegistry.listMcpDelegates(),
  }))

  router.register("POST", "/extensions-host/mcp-registry/servers/:serverName/start", async ({ params, body }) => {
    const client = await mcpProfileRegistry.connectMcpServer(params.serverName, body || {})
    return {
      success: true,
      server: mcpProfileRegistry.listConfiguredMcpServers().find((server) => server.serverName === client.serverName) || null,
    }
  })

  router.register("POST", "/extensions-host/mcp-registry/servers/:serverName/stop", async ({ params }) => {
    const client = await mcpProfileRegistry.disconnectMcpServer(params.serverName)
    return {
      success: true,
      server: mcpProfileRegistry.listConfiguredMcpServers().find((server) => server.serverName === client.serverName) || null,
    }
  })

  router.register("POST", "/extensions-host/mcp-registry/servers/:serverName/restart", async ({ params, body }) => {
    const client = await mcpProfileRegistry.restartMcpServer(params.serverName, body || {})
    return {
      success: true,
      server: mcpProfileRegistry.listConfiguredMcpServers().find((server) => server.serverName === client.serverName) || null,
    }
  })

  router.register("GET", "/extensions-host/mcp-registry/servers/:serverName/resources", async ({ params }) => {
    return {
      resources: await mcpProfileRegistry.listMcpResources(params.serverName),
    }
  })

  router.register("GET", "/extensions-host/mcp-registry/servers/:serverName/resource-templates", async ({ params }) => {
    return {
      resourceTemplates: await mcpProfileRegistry.listMcpResourceTemplates(params.serverName),
    }
  })

  router.register("POST", "/extensions-host/mcp-registry/servers/:serverName/read-resource", async ({ params, body }) => {
    return {
      contents: await mcpProfileRegistry.readMcpResource(params.serverName, body?.uri),
    }
  })

  router.register("POST", "/extensions-host/mcp-registry/servers/:serverName/resource-template-completions", async ({ params, body }) => {
    return {
      completion: await mcpProfileRegistry.completeMcpResourceTemplate(params.serverName, body || {}),
    }
  })

  router.register("GET", "/extensions-host/mcp-registry/inputs", async ({ query }) => {
    const storage = createMcpRegistryInputStorage(query)
    return { inputs: await storage.getMap() }
  })

  router.register("PUT", "/extensions-host/mcp-registry/inputs", async ({ body }) => {
    const storage = createMcpRegistryInputStorage(body)
    if (body?.values) await storage.setPlainText(body.values)
    if (body?.secrets) await storage.setSecrets(body.secrets)
    return { success: true, inputs: await storage.getMap() }
  })

  router.register("DELETE", "/extensions-host/mcp-registry/inputs", async ({ body }) => {
    const storage = createMcpRegistryInputStorage(body)
    await storage.clearAll()
    return { success: true }
  })

  router.register("DELETE", "/extensions-host/mcp-registry/inputs/:inputKey", async ({ params, body }) => {
    const storage = createMcpRegistryInputStorage(body)
    await storage.clear(params.inputKey)
    return { success: true }
  })

  router.register("GET", "/extensions-host/profile-content-handlers", async () => {
    await activateProfileContentHandlers()
    return { handlers: profileContentHandlers.listProfileContentHandlers() }
  })

  router.register("POST", "/extensions-host/profile-content-handlers/read", async ({ body }) => {
    const handlerId = typeof body?.handlerId === "string" ? body.handlerId : ""
    const idOrUri = typeof body?.idOrUri === "string" || (body?.idOrUri && typeof body.idOrUri === "object")
      ? body.idOrUri
      : ""
    if (!handlerId) return { success: false, error: "handlerId required" }
    if (!idOrUri) return { success: false, error: "idOrUri required" }
    await activateProfileContentHandlers({ handlerId, includeGeneric: false })
    if (!profileContentHandlers.listProfileContentHandlers().some((handler) => handler.id === handlerId)) {
      await activateProfileContentHandlers()
    }
    const content = await profileContentHandlers.readProfileContent(handlerId, idOrUri)
    return { success: true, content }
  })

  router.register("POST", "/extensions-host/profile-content-handlers/save", async ({ body }) => {
    const handlerId = typeof body?.handlerId === "string" ? body.handlerId : ""
    const name = typeof body?.name === "string" ? body.name : ""
    const content = typeof body?.content === "string" ? body.content : ""
    if (!handlerId) return { success: false, error: "handlerId required" }
    if (!name) return { success: false, error: "name required" }
    await activateProfileContentHandlers({ handlerId, includeGeneric: false })
    if (!profileContentHandlers.listProfileContentHandlers().some((handler) => handler.id === handlerId)) {
      await activateProfileContentHandlers()
    }
    const result = await profileContentHandlers.saveProfileContent(handlerId, name, content)
    return { success: Boolean(result), result }
  })

  router.register("GET", "/ext-host/debug", async () => {
    const h = getHost()
    return {
      running: h.isRunning,
      ...(h._debugRegistry?.state || { debugTypes: [], configurationProviders: [], adapterFactories: [], sessions: [] }),
    }
  })

  // Let the LanguageFeatures proxy register provider updates
  router.register("POST", "/ext-host/providers/sync", async ({ body }) => {
    providerRegistry.providers = body?.providers || []
    return { ok: true }
  })

  // ── Extension Manager API (W6) ────────────────────────────────────

  const extMgr = require("./extensionManager")

  router.register("GET", "/extensions-host/extensions", async () => {
    const exts = extMgr.getInstalledExtensions()
    return { extensions: exts }
  })

  router.register("GET", "/extensions-host/configuration-defaults", async () => {
    return buildExtensionConfigurationDefaults(extMgr.getInstalledExtensions())
  })

  router.register("GET", "/extensions-host/workbench-contributions", async () => {
    return buildExtensionWorkbenchContributions(extMgr.getInstalledExtensions())
  })

  router.register("POST", "/extensions-host/activate", async ({ body }) => {
    const activationEvent = typeof body?.activationEvent === "string" && body.activationEvent.trim()
      ? body.activationEvent.trim()
      : "onStartupFinished"
    const extensionId = typeof body?.extensionId === "string" && body.extensionId.trim()
      ? body.extensionId.trim()
      : "codek.placeholder"
    const evidence = {
      serviceId: "extensionHostService",
      stateSource: "extensionsWorkbenchService+ehClient",
      activationEvent,
      extensionId,
      createdAt: Date.now(),
    }
    const h = typeof opts.getHost === "function" ? opts.getHost() : getHost()
    if (!h.isRunning) {
      return {
        success: false,
        error: "Extension host not running",
        message: "扩展宿主未运行，无法触发激活事件",
        evidence: {
          ...evidence,
          status: "error",
          error: "Extension host not running",
        },
      }
    }
    try {
      await makeCallEh(h)(
        mainThreadCommands.EXT_HOST_EXTENSION_SERVICE_NID,
        "$activateByEvent",
        [activationEvent, mainThreadCommands.ActivationKind.Normal],
        30000,
      )
      return {
        success: true,
        evidence: {
          ...evidence,
          status: "activated",
        },
      }
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `扩展激活失败：${err.message}`,
        evidence: {
          ...evidence,
          status: "error",
          error: err.message,
        },
      }
    }
  })

  router.register("GET", "/extensions-host/icon-themes", async () => {
    return {
      themes: buildIconThemeCatalog(extMgr.getInstalledExtensions()).map(({ absolutePath, ...theme }) => theme),
    }
  })

  router.register("GET", "/extensions-host/icon-themes/:id", async ({ params }) => {
    return loadFileIconTheme(params.id, extMgr.getInstalledExtensions())
  })

  router.register("POST", "/extensions-host/commands/execute", async ({ body }) => {
    const commandId = body?.commandId || body?.id
    const args = Array.isArray(body?.args) ? body.args : []
    if (!commandId) return { success: false, error: "commandId required" }
    const evidence = {
      serviceId: "extensionHostCommandService",
      vscodeContract: "MainThreadCommands.$executeCommand -> ExtHostCommands.$executeContributedCommand",
      stateSource: "mainThreadCommands+shared commandRegistry",
      commandId,
      activationEvent: `onCommand:${commandId}`,
      activationStatus: "requested",
      argsCount: args.length,
      actorIds: {
        mainThreadCommands: mainThreadCommands.MAIN_THREAD_COMMANDS_NID,
        extHostCommands: mainThreadCommands.EXT_HOST_COMMANDS_NID,
        extHostExtensionService: mainThreadCommands.EXT_HOST_EXTENSION_SERVICE_NID,
      },
      status: "pending",
      createdAt: Date.now(),
    }
    const h = typeof opts.getHost === "function" ? opts.getHost() : getHost()
    if (!h.isRunning) {
      return {
        success: false,
        error: "Extension host not running",
        message: "扩展宿主未运行，无法执行扩展命令",
        evidence: {
          ...evidence,
          activationStatus: "skipped",
          status: "error",
          error: "Extension host not running",
        },
      }
    }
    try {
      await mainThreadCommands.fireCommandActivationEvent(commandId, makeCallEh(h), 30000)
      const result = await mainThreadCommands.executeContributedCommand(commandId, args, makeCallEh(h), 30000)
      return {
        success: true,
        result,
        evidence: {
          ...evidence,
          activationStatus: "requested",
          status: "executed",
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        error: message,
        message: `扩展命令执行失败：${message}`,
        evidence: {
          ...evidence,
          status: "error",
          error: message,
        },
      }
    }
  })

  router.register("POST", "/extensions-host/extensions/:id/toggle", async ({ params, body }) => {
    const { id } = params
    const enabled = body?.enabled !== false
    extMgr.setExtensionEnabled(id, enabled)
    // Restart EH to apply changes
    if (host && host.isRunning) {
      host.stop()
      host.start({ rootDir: body?.rootDir || __dirname }).catch(() => {})
    }
    return { success: true }
  })

  router.register("GET", "/extensions-host/marketplace/search", async ({ body, query }) => {
    const q = (query && (query.q || query.query)) || body?.q || body?.query || ""
    const category = (query && query.category) || body?.category
    const pageSize = Number((query && query.pageSize) || body?.pageSize) || 30
    let results = await extMgr.searchMarketplace(q, pageSize, {
      category,
      offset: Number((query && query.offset) || body?.offset || 0),
    })
    if (category) {
      results = results.filter((r) => (r.categories || []).includes(category))
    }
    return { extensions: results }
  })

  router.register("GET", "/extensions-host/marketplace/details/:namespace/:name", async ({ params, query }) => {
    const details = await extMgr.getExtensionDetails(params.namespace, params.name, query?.version)
    return { extension: details }
  })

  router.register("GET", "/extensions-host/marketplace/details/:namespace/:name/full", async ({ params, query }) => {
    return extMgr.getExtensionDetailsPayload(params.namespace, params.name, query?.version)
  })

  router.register("GET", "/extensions-host/marketplace/readme/:namespace/:name", async ({ params }) => {
    return extMgr.getExtensionReadme(params.namespace, params.name)
  })

  router.register("GET", "/extensions-host/marketplace/versions/:namespace/:name", async ({ params }) => {
    return extMgr.getExtensionVersions(params.namespace, params.name)
  })

  router.register("GET", "/extensions-host/mcp-gallery/search", async ({ query }) => {
    const page = Math.max(1, Math.trunc(Number(query?.page || 1)))
    const pager = await mcpGalleryService.queryMcpGallery({
      text: query?.q || query?.query || "",
      pageSize: Number(query?.pageSize || query?.limit || 50),
    })
    let currentPage = pager.firstPage
    for (let index = 1; index < page; index += 1) {
      if (!currentPage.hasMore) {
        currentPage = { items: [], hasMore: false }
        break
      }
      currentPage = await pager.getNextPage()
    }
    return {
      status: mcpGalleryService.isEnabled(),
      servers: currentPage.items,
      hasMore: currentPage.hasMore,
      page,
    }
  })

  router.register("POST", "/extensions-host/mcp-gallery/servers", async ({ body }) => {
    const infos = Array.isArray(body?.servers) ? body.servers : []
    const servers = await mcpGalleryService.getMcpServersFromGallery(infos)
    return {
      status: mcpGalleryService.isEnabled(),
      servers,
    }
  })

  router.register("POST", "/extensions-host/mcp-gallery/readme", async ({ body }) => {
    const readme = await mcpGalleryService.getMcpGalleryReadme(body?.server || body?.gallery || {})
    return { readme }
  })

  router.register("GET", "/extensions-host/mcp-gallery/installed", async () => {
    return {
      status: mcpGalleryService.isEnabled(),
      servers: mcpGalleryInstall.getInstalledGalleryMcpServers(),
    }
  })

  router.register("POST", "/extensions-host/mcp-gallery/can-install", async ({ body }) => {
    const result = mcpGalleryInstall.canInstallGalleryMcpServer(body?.server || body?.gallery || {})
    return {
      canInstall: result === true,
      reason: result === true ? "" : result.value,
      details: result === true ? undefined : result,
    }
  })

  router.register("POST", "/extensions-host/mcp-gallery/install", async ({ body }) => {
    try {
      const server = body?.server || body?.gallery
      if (!server) return { success: false, error: "server required" }
      const local = await mcpGalleryInstall.installGalleryMcpServer(server, {
        packageType: body?.packageType,
        getReadme: (galleryServer) => mcpGalleryService.getMcpGalleryReadme(galleryServer),
      })
      const savedInputs = await persistMcpGalleryInstallInputs(body)
      const target = resolveMcpResourceTarget(body)
      const inputResult = savedInputs ? { savedInputs } : {}
      if (target.explicit) {
        const profileResource = mcpResourceScanner.addMcpServers([local], target.options)
        return { success: true, server: local, profileResource, ...inputResult }
      }
      return { success: true, server: local, ...inputResult }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  router.register("POST", "/extensions-host/mcp-gallery/update-metadata", async ({ body }) => {
    try {
      const server = body?.server || body?.gallery
      if (!server) return { success: false, error: "server required" }
      const local = await mcpGalleryInstall.updateGalleryMcpServerMetadata(
        body?.local || body?.name || body?.serverName || server,
        server,
        {
          packageType: body?.packageType,
          getReadme: (galleryServer) => mcpGalleryService.getMcpGalleryReadme(galleryServer),
        },
      )
      return { success: true, server: local }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  router.register("POST", "/extensions-host/mcp-gallery/uninstall", async ({ body }) => {
    try {
      const name = body?.name || body?.serverName || body?.server?.name || body?.gallery?.name
      if (!name) return { success: false, error: "name required" }
      const result = await mcpGalleryInstall.uninstallGalleryMcpServer(name)
      const target = resolveMcpResourceTarget(body)
      if (target.explicit) {
        const profileResource = mcpResourceScanner.removeMcpServers([name], target.options)
        return { success: true, ...result, profileResource }
      }
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  router.register("POST", "/extensions-host/marketplace/install-plan", async ({ body }) => {
    const extensionId = body?.extensionId || body?.id || (body?.namespace && body?.name ? `${body.namespace}.${body.name}` : "")
    if (!extensionId && !(body?.namespace && body?.name)) {
      return { success: false, error: "extensionId required as 'publisher.name'" }
    }
    const plan = await extMgr.buildMarketplaceInstallPlan(body || {})
    return { success: true, plan }
  })

  router.register("GET", "/extensions-host/ecosystem-health", async ({ query }) => {
    const latest = extMgr.readLatestExtensionEcosystemHealth({ reportDir: query?.reportDir })
    return latest.report || {
      reportKind: "extension-ecosystem-health",
      status: "missing",
      statusLabel: "暂无扩展生态健康报告",
      ready: false,
      jsonPath: latest.latestJsonPath,
      markdownPath: latest.latestMarkdownPath,
    }
  })

  router.register("POST", "/extensions-host/ecosystem-health/run", async ({ body }) => {
    return extMgr.buildAndSaveEcosystemHealth(body || {})
  })

  router.register("GET", "/extensions-host/compatibility", async ({ query }) => {
    const latest = extMgr.readLatestExtensionCompatibilityReport({ reportDir: query?.reportDir })
    return latest.report || extMgr.buildInstalledCompatibilityReport({ write: false })
  })

  router.register("POST", "/extensions-host/compatibility/run", async ({ body }) => {
    return extMgr.buildAndSaveCompatibilityReport(body || {})
  })

  router.register("GET", "/extensions-host/marketplace/icon/:id", async ({ params, query }) => {
    const sourceUrl = query?.url || ""
    if (!sourceUrl) return { dataUrl: "" }
    const dataUrl = await extMgr.getMarketplaceIconDataUrl(params.id, sourceUrl)
    return { dataUrl }
  })

  router.register("GET", "/extensions-host/installed/:id/icon", async ({ params }) => {
    const dataUrl = await extMgr.getInstalledExtensionIconDataUrl(params.id)
    return { dataUrl }
  })

  // In-memory bus for SSE-style install progress events.
  const progressBus = new Map() // extensionId -> [listener]
  function publishProgress(id, ev) {
    const arr = progressBus.get(id) || []
    for (const fn of arr) { try { fn(ev) } catch {} }
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      try { win.webContents.send("ext-install-progress", { id, ...ev }) } catch {}
    }
  }
  function subscribeProgress(id, fn) {
    if (!progressBus.has(id)) progressBus.set(id, [])
    progressBus.get(id).push(fn)
    return () => {
      const arr = progressBus.get(id) || []
      const idx = arr.indexOf(fn)
      if (idx >= 0) arr.splice(idx, 1)
    }
  }

  router.register("POST", "/extensions-host/marketplace/install", async ({ body }) => {
    const extensionId = body?.extensionId || (body?.namespace && body?.name ? `${body.namespace}.${body.name}` : "")
    const version = body?.version
    if (!extensionId || !extensionId.includes(".")) {
      return { success: false, error: "extensionId required as 'publisher.name'" }
    }
    const trustDecision = evaluateWorkspaceTrustAction(
      body?.projectRoot || body?.rootDir || lastRootDir,
      "安装扩展",
      { confirmed: body?.confirmed === true },
    )
    const confirmationEvidence = buildExtensionInstallConfirmationEvidence({
      route: "/extensions-host/marketplace/install",
      installSource: "marketplace",
      confirmed: body?.confirmed === true,
      trustDecision,
    })
    if (!trustDecision.allowed) {
      publishProgress(extensionId, { phase: "error", message: trustDecision.message })
      return {
        success: false,
        error: trustDecision.message,
        code: trustDecision.code,
        workspaceTrust: trustDecision.status,
        confirmationEvidence,
      }
    }
    try {
      const result = await extMgr.installFromMarketplace(extensionId, undefined, version, (ev) => {
        publishProgress(extensionId, ev)
      })
      reloadHost(body?.rootDir || lastRootDir)
      return { success: true, extension: result, confirmationEvidence }
    } catch (err) {
      publishProgress(extensionId, { phase: "error", message: err.message })
      return { success: false, error: err.message }
    }
  })

  router.register("GET", "/extensions-host/install-stream", async ({ query }) => {
    const extensionId = (query && query.extensionId) || ""
    if (!extensionId) return { ok: false, error: "extensionId required" }
    return { ok: true, channel: "ext-install-progress", id: extensionId }
  })

  router.register("POST", "/extensions-host/install-vsix", async ({ body }) => {
    const filePath = body?.filePath || body?.vsixPath
    if (!filePath) return { success: false, error: "filePath required" }
    const trustDecision = evaluateWorkspaceTrustAction(
      body?.projectRoot || body?.rootDir || lastRootDir,
      "安装 VSIX 扩展",
      { confirmed: body?.confirmed === true },
    )
    const confirmationEvidence = buildExtensionInstallConfirmationEvidence({
      route: "/extensions-host/install-vsix",
      installSource: "vsix",
      confirmed: body?.confirmed === true,
      trustDecision,
    })
    if (!trustDecision.allowed) {
      return {
        success: false,
        error: trustDecision.message,
        code: trustDecision.code,
        workspaceTrust: trustDecision.status,
        confirmationEvidence,
      }
    }
    try {
      const result = await extMgr.installVsix(filePath)
      reloadHost(body?.rootDir || lastRootDir)
      return { success: true, extension: result, confirmationEvidence }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  router.register("POST", "/extensions-host/uninstall", async ({ body }) => {
    const id = body?.extensionId || body?.id
    if (!id) return { success: false, error: "extensionId required" }
    try {
      await extMgr.uninstallExtension(id)
      reloadHost(body?.rootDir || lastRootDir)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  router.register("POST", "/extensions-host/rollback", async ({ body }) => {
    const id = body?.extensionId || body?.id
    if (!id) return { success: false, error: "extensionId required" }
    try {
      const restored = await extMgr.rollbackExtension(id)
      reloadHost(body?.rootDir || lastRootDir)
      return { success: true, restored }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  router.register("GET", "/extensions-host/install-state", async () => ({
    extensions: extMgr.listExtensionInstallStates(),
  }))

  router.register("GET", "/extensions-host/audit", async ({ query }) => ({
    entries: extMgr.readExtensionAuditLog({ limit: Number(query?.limit || 200) }),
  }))

  router.register("GET", "/extensions-host/installed", async () => {
    const lifecycle = (() => {
      try { return require("./mainThread/mainThreadExtensionService").getLifecycleState() } catch { return null }
    })()
    const exts = extMgr.getInstalledExtensions({ lifecycle })
    return { extensions: exts.map((e) => ({ ...e, builtin: e.isBuiltin !== false })) }
  })

  router.register("GET", "/extensions-host/builtin", async () => {
    const lifecycle = (() => {
      try { return require("./mainThread/mainThreadExtensionService").getLifecycleState() } catch { return null }
    })()
    const exts = extMgr.getInstalledExtensions({ lifecycle }).filter((e) => e.isBuiltin !== false)
    return { extensions: exts.map((e) => ({ ...e, builtin: true })) }
  })

  router.register("POST", "/extensions-host/enable", async ({ body }) => {
    const id = body?.extensionId || body?.id
    if (!id) return { success: false, error: "extensionId required" }
    extMgr.setExtensionEnabled(id, true)
    reloadHost(body?.rootDir || lastRootDir)
    return { success: true }
  })

  router.register("POST", "/extensions-host/disable", async ({ body }) => {
    const id = body?.extensionId || body?.id
    if (!id) return { success: false, error: "extensionId required" }
    extMgr.setExtensionEnabled(id, false)
    reloadHost(body?.rootDir || lastRootDir)
    return { success: true }
  })

  router.register("POST", "/extensions-host/reload", async ({ body }) => {
    const rootDir = body?.rootDir || __dirname
    reloadHost(rootDir)
    return { success: true }
  })

  router.register("POST", "/extensions-host/lifecycle/stop", async ({ body }) => {
    return stopExtensionHosts({ ...(body || {}), getHost: opts.getHost, willStopVeto: opts.willStopVeto })
  })

  router.register("POST", "/extensions-host/lifecycle/start", async ({ body }) => {
    return startExtensionHosts({ ...(body || {}), getHost: opts.getHost || (() => getHost()) })
  })

  router.register("POST", "/extensions-host/lifecycle/restart", async ({ body }) => {
    return restartExtensionHosts({
      ...(body || {}),
      getHost: opts.getHost || (() => getHost()),
      willStopVeto: opts.willStopVeto,
    })
  })
}

module.exports = {
  getCurrentHost,
  getHost,
  makeCallEh,
  startExtensionHosts,
  stopExtensionHosts,
  restartExtensionHosts,
  register,
}
