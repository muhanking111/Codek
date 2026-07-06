const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildProviderHealthReport,
  classifyProviderError,
  readLatestProviderHealthReport,
  saveProviderHealthReport,
} = require("./providerHealth")

test("classifyProviderError separates retryable and configuration failures", () => {
  assert.deepEqual(classifyProviderError(new Error("HTTP 429 rate limit")).code, "rate_limited")
  assert.equal(classifyProviderError(new Error("HTTP 401 invalid api key")).retryable, false)
  assert.equal(classifyProviderError(new Error("fetch ENOTFOUND")).retryable, true)
})

test("provider health report summarizes failed and retryable providers", () => {
  const report = buildProviderHealthReport({
    providers: [
      { provider: "openai", model: "gpt-test", ok: true, usageSource: "provider" },
      { provider: "anthropic", model: "claude-test", ok: false, error: new Error("HTTP 401 invalid api key") },
      { provider: "ollama", model: "llama", ok: false, error: new Error("fetch ENOTFOUND") },
    ],
  })

  assert.equal(report.ready, false)
  assert.equal(report.summary.passed, 1)
  assert.equal(report.summary.failed, 1)
  assert.equal(report.summary.warning, 1)
})

test("provider health persists latest report", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-provider-health-"))
  const report = buildProviderHealthReport({ providers: [{ provider: "openai", ok: true }] })
  const saved = saveProviderHealthReport(report, { reportDir })
  const latest = readLatestProviderHealthReport({ reportDir })

  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "provider-health")
})
