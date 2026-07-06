const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  parseArgs,
  readLatestMcpProviderBridgeSmoke,
  runMcpProviderBridgeSmoke,
  saveMcpProviderBridgeSmoke,
  toMarkdown,
} = require("./mcp-provider-bridge-smoke")

test("parseArgs supports report dir and no-write", () => {
  const parsed = parseArgs(["--no-write", "--report-dir=C:/tmp/codek"])

  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.reportDir, "C:/tmp/codek")
})

test("MCP provider bridge smoke verifies VS Code-style definitions, delegate transport, and redaction", async () => {
  const report = await runMcpProviderBridgeSmoke({ noWrite: true })

  assert.equal(report.ready, true)
  assert.equal(report.mainThreadMcpRegistered, true)
  assert.equal(report.definitionsPublishedToExtHost, true)
  assert.equal(report.delegateTransportStarted, true)
  assert.equal(report.secretRedactionVerified, true)
  assert.equal(report.deletePublishesEmptyDefinitions, true)
  assert.deepEqual(report.providerErrors, [])
  assert.equal(JSON.stringify(report).includes("stdio-secret"), false)
  assert.equal(JSON.stringify(report).includes("http-secret"), false)
  assert.match(toMarkdown(report), /MCP Provider Bridge Smoke/)
})

test("MCP provider bridge smoke saves and reads latest report", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-mcp-provider-report-"))
  const report = await runMcpProviderBridgeSmoke({ noWrite: true })
  const saved = saveMcpProviderBridgeSmoke(report, { reportDir })
  const latest = readLatestMcpProviderBridgeSmoke({ reportDir })

  assert.equal(fs.existsSync(saved.jsonPath), true)
  assert.equal(fs.existsSync(saved.markdownPath), true)
  assert.equal(latest.report.reportKind, "mcp-provider-bridge-smoke")
  assert.equal(latest.report.ready, true)
})
