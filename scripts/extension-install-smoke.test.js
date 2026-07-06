const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  FIXTURE_ID,
  buildInstallSmokeReport,
  parseArgs,
  readLatestInstallSmoke,
  saveInstallSmokeReport,
} = require("./extension-install-smoke")

function makeExtMgr() {
  let installed = null
  const audit = []
  const states = []
  return {
    getInstalledExtensions() {
      return installed ? [installed] : []
    },
    async installVsix(vsixPath) {
      const version = /2\.0\.0/.test(vsixPath) ? "2.0.0" : "1.0.0"
      installed = { id: FIXTURE_ID, version, isBuiltin: false }
      states.push({ id: FIXTURE_ID, status: "installed", version })
      audit.push({ extensionId: FIXTURE_ID, action: "install" })
      return installed
    },
    async rollbackExtension() {
      installed = { id: FIXTURE_ID, version: "1.0.0", isBuiltin: false }
      states.push({ id: FIXTURE_ID, status: "installed", version: "1.0.0" })
      audit.push({ extensionId: FIXTURE_ID, action: "rollback" })
      return { targetDir: "fixture" }
    },
    async uninstallExtension() {
      installed = null
      states.push({ id: FIXTURE_ID, status: "uninstalled" })
      audit.push({ extensionId: FIXTURE_ID, action: "uninstall" })
      return true
    },
    listExtensionInstallStates() {
      return states
    },
    readExtensionAuditLog() {
      return audit
    },
  }
}

async function fakeCreateFixtureVsix(version) {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-fake-vsix-"))
  const vsixPath = path.join(workRoot, `fixture-${version}.vsix`)
  fs.writeFileSync(vsixPath, "fake")
  return { workRoot, vsixPath, version, extensionId: FIXTURE_ID }
}

test("install smoke parseArgs keeps marketplace install opt-in", () => {
  const parsed = parseArgs(["--report-dir=D:/reports", "--extension-id=ms-python.python"])
  assert.equal(parsed.confirmMarketplaceInstall, false)
  assert.equal(parsed.extensionId, "ms-python.python")
  assert.equal(parsed.reportDir, "D:/reports")

  assert.equal(parseArgs(["--confirm-marketplace-install"]).confirmMarketplaceInstall, true)
})

test("install smoke validates fixture install, update, rollback, uninstall, and evidence", async () => {
  const report = await buildInstallSmokeReport({
    confirmMarketplaceInstall: false,
    extensionId: "esbenp.prettier-vscode",
  }, makeExtMgr(), { createFixtureVsix: fakeCreateFixtureVsix })

  assert.equal(report.ready, true)
  assert.equal(report.status, "degraded")
  assert.equal(report.checks.find((check) => check.id === "fixture_install").status, "passed")
  assert.equal(report.checks.find((check) => check.id === "fixture_update").status, "passed")
  assert.equal(report.checks.find((check) => check.id === "fixture_rollback").status, "passed")
  assert.equal(report.checks.find((check) => check.id === "fixture_uninstall").status, "passed")
  assert.equal(report.checks.find((check) => check.id === "marketplace_install_authorization").status, "warning")
})

test("install smoke saves latest json and markdown reports", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-install-smoke-"))
  const report = await buildInstallSmokeReport({}, makeExtMgr(), { createFixtureVsix: fakeCreateFixtureVsix })
  const saved = saveInstallSmokeReport(report, { reportDir })
  const latest = readLatestInstallSmoke({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "extension-install-smoke")
})
