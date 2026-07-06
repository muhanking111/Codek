#!/usr/bin/env node

const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const root = path.resolve(__dirname, "..")
const FIXTURE_ID = "codek-smoke.fixture"

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv = []) {
  const readArg = (prefix) => argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  return {
    noWrite: argv.includes("--no-write"),
    confirmMarketplaceInstall: argv.includes("--confirm-marketplace-install"),
    extensionId: readArg("--extension-id=") || "esbenp.prettier-vscode",
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

async function createFixtureVsix(version, options = {}) {
  const workRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "codek-vsix-fixture-"))
  const extensionDir = path.join(workRoot, "extension")
  await fsp.mkdir(extensionDir, { recursive: true })
  await fsp.writeFile(path.join(extensionDir, "package.json"), `${JSON.stringify({
    name: "fixture",
    publisher: "codek-smoke",
    version,
    displayName: "Codek Smoke Fixture",
    description: "Temporary extension used by Codek install lifecycle smoke.",
    engines: { vscode: "*" },
    activationEvents: [],
    main: "./extension.js",
    contributes: { commands: [{ command: "codekSmoke.hello", title: "Codek Smoke Hello" }] },
  }, null, 2)}\n`, "utf8")
  await fsp.writeFile(path.join(extensionDir, "extension.js"), "module.exports = { activate() {}, deactivate() {} }\n", "utf8")

  const vsixPath = path.join(workRoot, `codek-smoke-fixture-${version}.vsix`)
  const created = createZipFromDirectory(workRoot, vsixPath)
  if (!created.ok) {
    throw new Error(created.error || "failed to create fixture VSIX")
  }
  if (options.keepFixture !== true) {
    // Keep the root until install consumes the VSIX; caller cleans it up.
  }
  return { workRoot, vsixPath, version, extensionId: FIXTURE_ID }
}

function createZipFromDirectory(workRoot, vsixPath) {
  if (process.platform === "win32") {
    const zipPath = `${vsixPath}.zip`
    const command = [
      "$ErrorActionPreference = 'Stop';",
      `Compress-Archive -Path '${path.join(workRoot, "extension").replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force;`,
      `Move-Item -LiteralPath '${zipPath.replace(/'/g, "''")}' -Destination '${vsixPath.replace(/'/g, "''")}' -Force`,
    ].join(" ")
    const result = spawnSync("powershell", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      shell: false,
    })
    return {
      ok: result.status === 0 && fs.existsSync(vsixPath),
      error: result.stderr || result.stdout || "",
    }
  }

  const result = spawnSync("zip", ["-qr", vsixPath, "extension"], {
    cwd: workRoot,
    encoding: "utf8",
  })
  return {
    ok: result.status === 0 && fs.existsSync(vsixPath),
    error: result.stderr || result.stdout || "",
  }
}

function findInstalled(extMgr, extensionId = FIXTURE_ID) {
  return extMgr.getInstalledExtensions()
    .find((extension) => String(extension.id || "").toLowerCase() === extensionId.toLowerCase()) || null
}

async function cleanupFixture(extMgr) {
  const existing = findInstalled(extMgr, FIXTURE_ID)
  if (existing && existing.isBuiltin === false) {
    await extMgr.uninstallExtension(FIXTURE_ID).catch(() => {})
  }
}

async function runFixtureLifecycle(extMgr, deps = {}) {
  const createVsix = deps.createFixtureVsix || createFixtureVsix
  const checks = []
  const artifacts = []
  let v1 = null
  let v2 = null
  try {
    await cleanupFixture(extMgr)
    v1 = await createVsix("1.0.0")
    v2 = await createVsix("2.0.0")
    artifacts.push({ name: "fixture-vsix-v1", path: v1.vsixPath })
    artifacts.push({ name: "fixture-vsix-v2", path: v2.vsixPath })
    checks.push(makeCheck("fixture_vsix_created", "Fixture VSIX created", "passed", "Local fixture VSIX files were generated."))

    const installedV1 = await extMgr.installVsix(v1.vsixPath)
    const afterV1 = findInstalled(extMgr, FIXTURE_ID)
    checks.push(makeCheck(
      "fixture_install",
      "Fixture install",
      installedV1?.id === FIXTURE_ID && afterV1?.version === "1.0.0" ? "passed" : "failed",
      `Installed version is ${afterV1?.version || installedV1?.version || "missing"}.`,
      "VSIX install must copy extension files and refresh scanner state.",
    ))

    await extMgr.installVsix(v2.vsixPath)
    const afterV2 = findInstalled(extMgr, FIXTURE_ID)
    checks.push(makeCheck(
      "fixture_update",
      "Fixture update",
      afterV2?.version === "2.0.0" ? "passed" : "failed",
      `Updated version is ${afterV2?.version || "missing"}.`,
      "Updating a VSIX must replace the extension after taking a backup.",
    ))

    const rollback = await extMgr.rollbackExtension(FIXTURE_ID)
    const afterRollback = findInstalled(extMgr, FIXTURE_ID)
    checks.push(makeCheck(
      "fixture_rollback",
      "Fixture rollback",
      rollback?.targetDir && afterRollback?.version === "1.0.0" ? "passed" : "failed",
      `Rolled back version is ${afterRollback?.version || "missing"}.`,
      "Rollback must restore the previous extension directory from backup.",
    ))

    await extMgr.uninstallExtension(FIXTURE_ID)
    const afterUninstall = findInstalled(extMgr, FIXTURE_ID)
    checks.push(makeCheck(
      "fixture_uninstall",
      "Fixture uninstall",
      afterUninstall ? "failed" : "passed",
      afterUninstall ? "Fixture extension still appears installed." : "Fixture extension was removed after uninstall.",
      "Uninstall must remove only the target user extension.",
    ))

    const states = typeof extMgr.listExtensionInstallStates === "function" ? extMgr.listExtensionInstallStates() : []
    const audit = typeof extMgr.readExtensionAuditLog === "function" ? extMgr.readExtensionAuditLog({ limit: 100 }) : []
    checks.push(makeCheck(
      "state_and_audit",
      "State and audit evidence",
      states.some((entry) => entry.id === FIXTURE_ID) && audit.some((entry) => entry.extensionId === FIXTURE_ID) ? "passed" : "failed",
      `State records: ${states.filter((entry) => entry.id === FIXTURE_ID).length}; audit entries: ${audit.filter((entry) => entry.extensionId === FIXTURE_ID).length}.`,
      "Install lifecycle must leave metadata evidence without leaking secrets.",
    ))
  } catch (error) {
    checks.push(makeCheck(
      "fixture_lifecycle_error",
      "Fixture lifecycle error",
      "failed",
      error.message,
      "Fix VSIX extraction, backup, rollback, or cleanup before claiming install parity.",
    ))
    await cleanupFixture(extMgr)
  } finally {
    for (const item of [v1, v2]) {
      if (item?.workRoot) await fsp.rm(item.workRoot, { recursive: true, force: true }).catch(() => {})
    }
  }
  return { checks, artifacts }
}

async function runMarketplaceLifecycle(options, extMgr) {
  if (!options.confirmMarketplaceInstall) {
    return {
      checks: [makeCheck(
        "marketplace_install_authorization",
        "Marketplace install authorization",
        "warning",
        "Skipped real marketplace install because --confirm-marketplace-install was not provided.",
        "Run with explicit authorization only after reviewing registry policy and license risk.",
      )],
      artifacts: [],
    }
  }
  const extensionId = options.extensionId
  try {
    const result = await extMgr.installFromMarketplace(extensionId)
    await extMgr.uninstallExtension(result.id || extensionId)
    return {
      checks: [makeCheck("marketplace_install", "Marketplace install", "passed", `${result.id || extensionId} installed and uninstalled.`)],
      artifacts: [],
    }
  } catch (error) {
    return {
      checks: [makeCheck("marketplace_install", "Marketplace install", "failed", error.message, "Check registry availability, VSIX download URL, and install trust policy.")],
      artifacts: [],
    }
  }
}

async function buildInstallSmokeReport(options = {}, extMgr = require("../desktop/services/extensions-host/extensionManager"), deps = {}) {
  if (!process.env.CODEK_DATA) {
    process.env.CODEK_DATA = path.join(root, ".codek")
  }
  const startedAt = Date.now()
  const fixture = await runFixtureLifecycle(extMgr, deps)
  const marketplace = await runMarketplaceLifecycle(options, extMgr)
  const checks = [...fixture.checks, ...marketplace.checks]
  const summary = summarizeChecks(checks)
  const status = summary.failed > 0 ? "blocked" : summary.warning > 0 ? "degraded" : "ready"
  return {
    reportKind: "extension-install-smoke",
    createdAt: Date.now(),
    durationMs: Date.now() - startedAt,
    ready: summary.failed === 0,
    status,
    summary,
    checks,
    artifacts: [...fixture.artifacts, ...marketplace.artifacts],
    marketplace: {
      authorized: options.confirmMarketplaceInstall === true,
      extensionId: options.extensionId || "",
    },
  }
}

function installSmokePaths(reportDir = defaultReportDir()) {
  return {
    reportDir,
    latestJsonPath: path.join(reportDir, "extension-install-smoke-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-install-smoke-latest.md"),
  }
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((check) =>
    `| ${check.id} | ${check.status} | ${String(check.detail || "").replace(/\|/g, "\\|")} | ${String(check.nextAction || "").replace(/\|/g, "\\|")} |`,
  )
  return [
    "# Extension Install Smoke",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Status: ${report.status}`,
    `- Marketplace install authorized: ${report.marketplace?.authorized ? "YES" : "NO"}`,
    "",
    "| Check | Status | Detail | Next Action |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

function saveInstallSmokeReport(report, options = {}) {
  const paths = installSmokePaths(options.reportDir || defaultReportDir())
  fs.mkdirSync(paths.reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${toMarkdown(withPaths)}\n`, "utf8")
  return { ...paths, report: withPaths }
}

function readLatestInstallSmoke(options = {}) {
  const paths = installSmokePaths(options.reportDir || defaultReportDir())
  if (!fs.existsSync(paths.latestJsonPath)) return { report: null, ...paths }
  return { report: JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8")), ...paths }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await buildInstallSmokeReport(options)
  if (!options.noWrite) saveInstallSmokeReport(report, { reportDir: options.reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    marketplaceAuthorized: report.marketplace.authorized,
    jsonPath: options.noWrite ? "" : installSmokePaths(options.reportDir).latestJsonPath,
    markdownPath: options.noWrite ? "" : installSmokePaths(options.reportDir).latestMarkdownPath,
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
  FIXTURE_ID,
  buildInstallSmokeReport,
  createFixtureVsix,
  defaultReportDir,
  installSmokePaths,
  parseArgs,
  readLatestInstallSmoke,
  runFixtureLifecycle,
  saveInstallSmokeReport,
  toMarkdown,
}
