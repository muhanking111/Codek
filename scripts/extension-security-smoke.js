#!/usr/bin/env node

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv = []) {
  const readArg = (prefix) => argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  return {
    noWrite: argv.includes("--no-write"),
    reportDir: readArg("--report-dir=") || defaultReportDir(),
  }
}

function makeCheck(id, title, status, detail, nextAction = "") {
  return { id, title, status, detail, nextAction }
}

function summarizeChecks(checks) {
  return {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    warning: checks.filter((check) => check.status === "warning").length,
    failed: checks.filter((check) => check.status === "failed").length,
  }
}

function loadExtensionsHostWithFixture(codekData) {
  const previousData = process.env.CODEK_DATA
  process.env.CODEK_DATA = codekData
  for (const modulePath of [
    "../desktop/services/workspaceTrust",
    "../desktop/services/extensions-host/extensionManager",
    "../desktop/services/extensions-host/index",
  ]) {
    delete require.cache[require.resolve(modulePath)]
  }
  const router = require("../desktop/services/router")
  const workspaceTrust = require("../desktop/services/workspaceTrust")
  const extMgr = require("../desktop/services/extensions-host/extensionManager")
  const originalInstallFromMarketplace = extMgr.installFromMarketplace
  const originalInstallVsix = extMgr.installVsix
  extMgr.installFromMarketplace = async (extensionId, _name, _version, onProgress) => {
    if (typeof onProgress === "function") onProgress({ phase: "done", percent: 100 })
    return { id: extensionId, version: "1.0.0" }
  }
  extMgr.installVsix = async (filePath) => ({ id: "fixture.vsix", filePath })
  const extensionsHost = require("../desktop/services/extensions-host/index")
  router.clearRoutes()
  extensionsHost.register(router)
  return {
    router,
    workspaceTrust,
    restore() {
      extMgr.installFromMarketplace = originalInstallFromMarketplace
      extMgr.installVsix = originalInstallVsix
      if (previousData == null) delete process.env.CODEK_DATA
      else process.env.CODEK_DATA = previousData
    },
  }
}

async function buildSecuritySmokeReport(options = {}) {
  const startedAt = Date.now()
  const checks = []
  const codekData = fs.mkdtempSync(path.join(os.tmpdir(), "codek-extension-security-"))
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-extension-security-root-"))
  const { evaluatePublisherPolicy } = require("../desktop/services/extensions-host/extensionPublisherPolicy")
  const { appendExtensionAudit, readExtensionAuditLog } = require("../desktop/services/extensions-host/extensionAuditLog")
  const fixture = loadExtensionsHostWithFixture(codekData)

  try {
    fixture.workspaceTrust.setWorkspaceTrust(rootDir, { status: "restricted" })
    const restricted = await fixture.router.dispatch({
      method: "POST",
      path: "/extensions-host/marketplace/install",
      body: { extensionId: "ms-python.python", rootDir, confirmed: true },
    })
    checks.push(makeCheck(
      "restricted_workspace_blocks_install",
      "Restricted workspace blocks marketplace install",
      restricted?.data?.success === false && restricted?.data?.code === "workspace_trust_restricted" ? "passed" : "failed",
      `Result code: ${restricted?.data?.code || "missing"}.`,
      "Extension install must respect workspace trust before any network or disk write.",
    ))

    const unknownRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-extension-security-unknown-"))
    const unknown = await fixture.router.dispatch({
      method: "POST",
      path: "/extensions-host/marketplace/install",
      body: { extensionId: "ms-python.python", rootDir: unknownRoot },
    })
    checks.push(makeCheck(
      "unknown_workspace_requires_confirmation",
      "Unknown workspace requires explicit confirmation",
      unknown?.data?.success === false && unknown?.data?.code === "workspace_trust_confirmation_required" ? "passed" : "failed",
      `Result code: ${unknown?.data?.code || "missing"}.`,
      "Unknown workspaces must require user confirmation before installing extensions.",
    ))

    const policy = evaluatePublisherPolicy(
      { id: "untrusted.fixture", publisher: "untrusted" },
      { env: { CODEK_EXTENSION_PUBLISHER_DENY: "untrusted" } },
    )
    checks.push(makeCheck(
      "publisher_deny_policy",
      "Publisher deny policy",
      policy.blocked && policy.reason === "publisher_denied" ? "passed" : "failed",
      `blocked=${policy.blocked}; reason=${policy.reason}.`,
      "Enterprise publisher allow/deny policy must be enforceable before install.",
    ))

    const auditPath = path.join(codekData, "audit", "extension-audit.jsonl")
    appendExtensionAudit({
      action: "install",
      extensionId: "untrusted.fixture",
      status: "failed",
      phase: "install",
      metadata: {
        apiKey: "REDACTION_TEST_API_KEY",
        nested: { authorization: "Bearer REDACTION_TEST_TOKEN" },
      },
      error: "install failed with token REDACTION_TEST_GITHUB_TOKEN",
    }, { filePath: auditPath, createdAt: "2026-06-07T00:00:00.000Z" })
    const audit = readExtensionAuditLog({ filePath: auditPath, limit: 5 })
    const serialized = JSON.stringify(audit)
    checks.push(makeCheck(
      "audit_log_redacts_secrets",
      "Audit log redacts secrets",
      audit.length === 1 && !serialized.includes("REDACTION_TEST_API_KEY") && !serialized.includes("Bearer REDACTION_TEST_TOKEN") && !serialized.includes("REDACTION_TEST_GITHUB_TOKEN") ? "passed" : "failed",
      `Audit entries: ${audit.length}; contains raw secret: ${/REDACTION_TEST_API_KEY|Bearer REDACTION_TEST_TOKEN|REDACTION_TEST_GITHUB_TOKEN/.test(serialized)}.`,
      "Extension audit events must record failures without leaking tokens, cookies, or API keys.",
    ))
  } catch (error) {
    checks.push(makeCheck(
      "security_smoke_error",
      "Security smoke error",
      "failed",
      error.message,
      "Fix extension trust, policy, or audit-log security checks.",
    ))
  } finally {
    fixture.restore()
    fs.rmSync(codekData, { recursive: true, force: true })
    fs.rmSync(rootDir, { recursive: true, force: true })
  }

  const summary = summarizeChecks(checks)
  const status = summary.failed > 0 ? "blocked" : summary.warning > 0 ? "degraded" : "ready"
  return {
    reportKind: "extension-security-smoke",
    createdAt: Date.now(),
    durationMs: Date.now() - startedAt,
    ready: summary.failed === 0,
    status,
    summary,
    checks,
  }
}

function securitySmokePaths(reportDir = defaultReportDir()) {
  return {
    reportDir,
    latestJsonPath: path.join(reportDir, "extension-security-smoke-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-security-smoke-latest.md"),
  }
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((check) =>
    `| ${check.id} | ${check.status} | ${String(check.detail || "").replace(/\|/g, "\\|")} | ${String(check.nextAction || "").replace(/\|/g, "\\|")} |`,
  )
  return [
    "# Extension Security Smoke",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Status: ${report.status}`,
    "",
    "| Check | Status | Detail | Next Action |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

function saveSecuritySmokeReport(report, options = {}) {
  const paths = securitySmokePaths(options.reportDir || defaultReportDir())
  fs.mkdirSync(paths.reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${toMarkdown(withPaths)}\n`, "utf8")
  return { ...paths, report: withPaths }
}

function readLatestSecuritySmoke(options = {}) {
  const paths = securitySmokePaths(options.reportDir || defaultReportDir())
  if (!fs.existsSync(paths.latestJsonPath)) return { report: null, ...paths }
  return { report: JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8")), ...paths }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await buildSecuritySmokeReport(options)
  if (!options.noWrite) saveSecuritySmokeReport(report, { reportDir: options.reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    jsonPath: options.noWrite ? "" : securitySmokePaths(options.reportDir).latestJsonPath,
    markdownPath: options.noWrite ? "" : securitySmokePaths(options.reportDir).latestMarkdownPath,
  }, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`)
    process.exit(1)
  })
}

module.exports = {
  buildSecuritySmokeReport,
  defaultReportDir,
  parseArgs,
  readLatestSecuritySmoke,
  saveSecuritySmokeReport,
  securitySmokePaths,
  toMarkdown,
}
