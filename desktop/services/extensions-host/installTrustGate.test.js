const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const Module = require("node:module")
const os = require("node:os")
const path = require("node:path")
const router = require("../router")

function loadExtensionsHost(codekData = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-trust-"))) {
  const previousData = process.env.CODEK_DATA
  const originalLoad = Module._load
  process.env.CODEK_DATA = codekData
  delete require.cache[require.resolve("../workspaceTrust")]
  delete require.cache[require.resolve("./extensionManager")]
  delete require.cache[require.resolve("./index")]
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === "electron") {
      return {
        ipcMain: {
          handle() {},
          on() {},
          removeHandler() {},
          removeListener() {},
        },
        BrowserWindow: {
          getAllWindows: () => [],
        },
      }
    }
    if (request === "undici") {
      return {
        fetch: async () => ({
          ok: false,
          status: 503,
          json: async () => ({}),
          text: async () => "",
        }),
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const workspaceTrust = require("../workspaceTrust")
  const extMgr = require("./extensionManager")
  const originalInstallFromMarketplace = extMgr.installFromMarketplace
  const originalInstallVsix = extMgr.installVsix
  const calls = {
    marketplace: [],
    vsix: [],
  }
  extMgr.installFromMarketplace = async (extensionId, _name, _version, onProgress) => {
    calls.marketplace.push({ extensionId, version: _version })
    if (typeof onProgress === "function") onProgress({ phase: "done", percent: 100 })
    return { id: extensionId, version: "1.0.0" }
  }
  extMgr.installVsix = async (filePath) => {
    calls.vsix.push({ filePath })
    return { id: "fixture.vsix", filePath }
  }
  const extensionsHost = require("./index")
  Module._load = originalLoad
  if (previousData == null) delete process.env.CODEK_DATA
  else process.env.CODEK_DATA = previousData
  return {
    calls,
    extensionsHost,
    workspaceTrust,
    restore() {
      Module._load = originalLoad
      extMgr.installFromMarketplace = originalInstallFromMarketplace
      extMgr.installVsix = originalInstallVsix
    },
  }
}

test("extension marketplace install is blocked in restricted workspace", async () => {
  router.clearRoutes()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-restricted-ext-"))
  const { extensionsHost, workspaceTrust, restore } = loadExtensionsHost()
  workspaceTrust.setWorkspaceTrust(root, { status: "restricted" })
  extensionsHost.register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/marketplace/install",
    body: { extensionId: "ms-python.python", rootDir: root, confirmed: true },
  })

  restore()
  assert.equal(result.ok, true)
  assert.equal(result.data.success, false)
  assert.equal(result.data.code, "workspace_trust_restricted")
  assert.equal(result.data.workspaceTrust, "restricted")
})

test("extension marketplace install in unknown workspace requires explicit confirmation", async () => {
  router.clearRoutes()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-unknown-ext-"))
  const { calls, extensionsHost, restore } = loadExtensionsHost()
  extensionsHost.register(router)

  const denied = await router.dispatch({
    method: "POST",
    path: "/extensions-host/marketplace/install",
    body: { extensionId: "ms-python.python", rootDir: root },
  })

  restore()
  assert.equal(denied.ok, true)
  assert.equal(denied.data.success, false)
  assert.equal(denied.data.code, "workspace_trust_confirmation_required")
  assert.deepEqual(calls.marketplace, [])
  assert.equal(denied.data.confirmationEvidence.route, "/extensions-host/marketplace/install")
  assert.equal(denied.data.confirmationEvidence.installSource, "marketplace")
  assert.equal(denied.data.confirmationEvidence.status, "blocked")
  assert.equal(denied.data.confirmationEvidence.blockedBy, "appShellOrGenericDialogOwner")
  assert.equal(denied.data.confirmationEvidence.owner, "workbenchDialogOwner")
  assert.equal(denied.data.confirmationEvidence.workspaceTrustServiceOwner, "desktop/services/workspaceTrust")
  assert.equal(denied.data.confirmationEvidence.trustStateSource, "workspaceTrustStore")
  assert.equal(denied.data.confirmationEvidence.extensionTrustGateOwner, "desktop/services/extensions-host index.js install routes")
  assert.equal(denied.data.confirmationEvidence.securityPolicyOwner, "desktop/services/workspaceTrust enterprisePolicy")
  assert.equal(denied.data.confirmationEvidence.persistenceSource, "CODEK_DATA/workspace-trust.json")
  assert.match(
    denied.data.confirmationEvidence.remainingTrustUiOwnerGap,
    /full WorkspaceTrustEditor\/App shell owner/,
  )
  assert.equal(denied.data.confirmationEvidence.confirmed, false)
  assert.equal(denied.data.confirmationEvidence.confirmedSource, "none")
  assert.equal(denied.data.confirmationEvidence.routeDoesNotAutoConfirm, true)
  assert.equal(denied.data.confirmationEvidence.noSecondInstallState, true)
  assert.equal(denied.data.confirmationEvidence.runtimeReference, false)
  assert.match(
    denied.data.confirmationEvidence.vscodeContract,
    /IDialogService\.prompt/,
  )
  assert.ok(!JSON.stringify(denied.data.confirmationEvidence).includes("SourceMirror"))
})

test("vsix install is blocked in restricted workspace", async () => {
  router.clearRoutes()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-restricted-vsix-"))
  const { extensionsHost, workspaceTrust, restore } = loadExtensionsHost()
  workspaceTrust.setWorkspaceTrust(root, { status: "restricted" })
  extensionsHost.register(router)

  const result = await router.dispatch({
    method: "POST",
    path: "/extensions-host/install-vsix",
    body: { filePath: path.join(root, "fixture.vsix"), rootDir: root, confirmed: true },
  })

  restore()
  assert.equal(result.ok, true)
  assert.equal(result.data.success, false)
  assert.equal(result.data.code, "workspace_trust_restricted")
})

test("vsix install in unknown workspace requires explicit confirmation", async () => {
  router.clearRoutes()
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-unknown-vsix-"))
  const { calls, extensionsHost, restore } = loadExtensionsHost()
  extensionsHost.register(router)

  const denied = await router.dispatch({
    method: "POST",
    path: "/extensions-host/install-vsix",
    body: { filePath: path.join(root, "fixture.vsix"), rootDir: root },
  })

  restore()
  assert.equal(denied.ok, true)
  assert.equal(denied.data.success, false)
  assert.equal(denied.data.code, "workspace_trust_confirmation_required")
  assert.deepEqual(calls.vsix, [])
  assert.equal(denied.data.confirmationEvidence.route, "/extensions-host/install-vsix")
  assert.equal(denied.data.confirmationEvidence.installSource, "vsix")
  assert.equal(denied.data.confirmationEvidence.status, "blocked")
  assert.equal(denied.data.confirmationEvidence.blockedBy, "appShellOrGenericDialogOwner")
  assert.equal(denied.data.confirmationEvidence.workspaceTrustServiceOwner, "desktop/services/workspaceTrust")
  assert.equal(denied.data.confirmationEvidence.trustStateSource, "workspaceTrustStore")
  assert.equal(denied.data.confirmationEvidence.extensionTrustGateOwner, "desktop/services/extensions-host index.js install routes")
  assert.equal(denied.data.confirmationEvidence.securityPolicyOwner, "desktop/services/workspaceTrust enterprisePolicy")
  assert.equal(denied.data.confirmationEvidence.persistenceSource, "CODEK_DATA/workspace-trust.json")
  assert.match(
    denied.data.confirmationEvidence.remainingTrustUiOwnerGap,
    /full WorkspaceTrustEditor\/App shell owner/,
  )
  assert.equal(denied.data.confirmationEvidence.confirmed, false)
  assert.equal(denied.data.confirmationEvidence.confirmationRequired, true)
  assert.ok(!JSON.stringify(denied.data.confirmationEvidence).includes("SourceMirror"))
})
