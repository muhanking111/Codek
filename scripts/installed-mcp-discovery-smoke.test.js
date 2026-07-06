const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  parseArgs,
  readLatestInstalledMcpDiscoverySmoke,
  runInstalledMcpDiscoverySmoke,
  saveInstalledMcpDiscoverySmoke,
  toMarkdown,
} = require("./installed-mcp-discovery-smoke")

test("parseArgs supports report dir and no-write", () => {
  const parsed = parseArgs(["--no-write", "--report-dir=C:/tmp/codek"])

  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.reportDir, "C:/tmp/codek")
})

test("Installed MCP discovery smoke verifies persisted manifest and registry source", async () => {
  const report = await runInstalledMcpDiscoverySmoke({ noWrite: true })

  assert.equal(report.ready, true)
  assert.equal(report.installedMcpPersisted, true)
  assert.equal(report.installedDiscoveryRead, true)
  assert.equal(report.installedRegistryApplied, true)
  assert.equal(report.workspaceDiscoveryFilteredInRegistryMode, true)
  assert.equal(report.secretRedactionVerified, true)
  assert.deepEqual(report.providerErrors, [])
  assert.equal(JSON.stringify(report).includes("installed-secret"), false)
  assert.match(toMarkdown(report), /Installed MCP Discovery Smoke/)
})

test("Installed MCP discovery smoke saves and reads latest report", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-installed-mcp-report-"))
  const report = await runInstalledMcpDiscoverySmoke({ noWrite: true })
  const saved = saveInstalledMcpDiscoverySmoke(report, { reportDir })
  const latest = readLatestInstalledMcpDiscoverySmoke({ reportDir })

  assert.equal(fs.existsSync(saved.jsonPath), true)
  assert.equal(fs.existsSync(saved.markdownPath), true)
  assert.equal(latest.report.reportKind, "installed-mcp-discovery-smoke")
  assert.equal(latest.report.ready, true)
})
