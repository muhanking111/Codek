const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  parseArgs,
  saveShellIntegrationReport,
  toMarkdown,
} = require("./shell-integration-smoke")

test("shell integration parseArgs supports no-write, all shells, and report dir", () => {
  const parsed = parseArgs(["--all", "--no-write", "--report-dir=C:/tmp/shell-smoke"])

  assert.equal(parsed.all, true)
  assert.equal(parsed.noWrite, true)
  assert.equal(parsed.reportDir, "C:/tmp/shell-smoke")
})

test("shell integration parseArgs keeps explicit shell list", () => {
  const parsed = parseArgs(["powershell", "cmd"])

  assert.deepEqual(parsed.shells, ["powershell", "cmd"])
})

test("shell integration report writer creates latest markdown and json", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-shell-smoke-"))
  const saved = saveShellIntegrationReport({
    reportKind: "shell-integration-smoke",
    ready: true,
    summary: { total: 1, passed: 1, skipped: 0, failed: 0 },
    checks: [{ shellType: "powershell", ok: true, skipped: false, durationMs: 1, status: 0 }],
  }, { reportDir })

  assert.equal(fs.existsSync(saved.jsonPath), true)
  assert.equal(fs.existsSync(saved.markdownPath), true)
  assert.match(fs.readFileSync(saved.markdownPath, "utf8"), /Shell Integration Smoke/)
})

test("shell integration markdown includes skipped shells", () => {
  const markdown = toMarkdown({
    ready: true,
    summary: { total: 1, passed: 0, skipped: 1, failed: 0 },
    checks: [{ shellType: "gitbash", ok: false, skipped: true, durationMs: 2, status: null }],
  })

  assert.match(markdown, /gitbash/)
  assert.match(markdown, /skipped/)
})
