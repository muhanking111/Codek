const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  parseArgs,
  readLatestMcpGalleryManagementSmoke,
  runMcpGalleryManagementSmoke,
  saveMcpGalleryManagementSmoke,
  toMarkdown,
} = require("./mcp-gallery-management-smoke")

test("parseArgs supports report dir and no-write", () => {
  const parsed = parseArgs(["--no-write", "--report-dir=C:/tmp/codek"])

  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.reportDir, "C:/tmp/codek")
})

test("MCP gallery management smoke verifies install, workspace target, lifecycle and uninstall", async () => {
  const report = await runMcpGalleryManagementSmoke({ noWrite: true })

  assert.equal(report.ready, true)
  assert.equal(report.galleryInstallReady, true)
  assert.equal(report.workspaceResourceWritten, true)
  assert.equal(report.workspaceRegistryConsumed, true)
  assert.equal(report.workbenchRegistryRouteReady, true)
  assert.equal(report.galleryUninstallReady, true)
  assert.equal(report.lifecycleEventsEmitted, true)
  assert.ok(report.registryRouteSnapshot.collections >= 1)
  assert.ok(report.registryRouteSnapshot.servers >= 1)
  assert.ok(report.registryRouteSnapshot.delegates >= 1)
  assert.deepEqual(report.providerErrors, [])
  assert.match(toMarkdown(report), /MCP Gallery Management Smoke/)
})

test("MCP gallery management smoke saves and reads latest report", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-mcp-gallery-management-report-"))
  const report = await runMcpGalleryManagementSmoke({ noWrite: true })
  const saved = saveMcpGalleryManagementSmoke(report, { reportDir })
  const latest = readLatestMcpGalleryManagementSmoke({ reportDir })

  assert.equal(fs.existsSync(saved.jsonPath), true)
  assert.equal(fs.existsSync(saved.markdownPath), true)
  assert.equal(latest.report.reportKind, "mcp-gallery-management-smoke")
  assert.equal(latest.report.ready, true)
})
