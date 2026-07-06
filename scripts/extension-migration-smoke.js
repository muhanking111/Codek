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
    source: readArg("--source=") || "cursor",
    dryRun: argv.includes("--dry-run"),
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function createFixtureUserData(source = "cursor") {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codek-extension-migration-"))
  const appData = path.join(home, "AppData", "Roaming")
  const appName = source === "vscode-insiders" ? "Code - Insiders" : source === "vscode" ? "Code" : "Cursor"
  const userDir = path.join(appData, appName, "User")
  const extensionsDir = path.join(appData, "extensions")
  fs.mkdirSync(path.join(userDir, "snippets"), { recursive: true })
  fs.mkdirSync(extensionsDir, { recursive: true })
  writeJson(path.join(userDir, "settings.json"), {
    "editor.fontSize": 14,
    "extensions.autoUpdate": false,
  })
  writeJson(path.join(userDir, "keybindings.json"), [
    { key: "ctrl+alt+k", command: "workbench.action.showCommands" },
  ])
  writeJson(path.join(userDir, "snippets", "javascript.json"), {
    log: { prefix: "log", body: "console.log($1)" },
  })
  const extensionManifest = [
    { identifier: { id: "ms-python.python" } },
    { identifier: { id: "esbenp.prettier-vscode" } },
    { identifier: { id: "dbaeumer.vscode-eslint" } },
  ]
  writeJson(path.join(extensionsDir, "extensions.json"), extensionManifest)
  writeJson(path.join(userDir, "extensions.json"), extensionManifest)
  return { home, appData, userDir }
}

function buildMigrationSmokeReport(options = {}, migration = require("../desktop/services/migration/vscodeImport")) {
  const startedAt = Date.now()
  const fixture = createFixtureUserData(options.source)
  const previousCodekData = process.env.CODEK_DATA
  const codekData = fs.mkdtempSync(path.join(os.tmpdir(), "codek-extension-migration-data-"))
  const checks = []
  let preview = null
  let imported = null
  let queue = null

  try {
    process.env.CODEK_DATA = codekData
    const sources = migration.getCandidateSources({
      platform: "win32",
      homedir: fixture.home,
      env: { APPDATA: fixture.appData },
    })
    const selected = sources.find((source) => source.app === options.source)
    checks.push(makeCheck(
      "source_discovery",
      "VS Code/Cursor source discovery",
      selected?.exists ? "passed" : "failed",
      selected?.exists ? `${selected.label} source was discovered in fixture user data.` : `Source ${options.source} was not discovered.`,
      "Migration must locate VS Code, Cursor, and Insiders user directories without editing them.",
    ))

    preview = migration.previewSource(selected?.userDir || fixture.userDir)
    checks.push(makeCheck(
      "profile_preview",
      "Migration preview",
      preview.extensionsCount >= 3 && preview.settingsCount >= 2 && preview.keybindingsCount >= 1 ? "passed" : "failed",
      `Preview found ${preview.extensionsCount} extensions, ${preview.settingsCount} settings, ${preview.keybindingsCount} keybindings.`,
      "Preview must show settings, keybindings, snippets, and extension counts before import.",
    ))

    imported = migration.importSource(selected?.userDir || fixture.userDir, {
      mode: "replace",
      sections: { settings: false, keybindings: false, snippets: false, extensions: true },
    })
    queue = migration.readExtensionInstallQueue({ filePath: imported.extensions.manifestPath })
    checks.push(makeCheck(
      "extension_queue_import",
      "Extension queue import",
      queue.total === 3 && queue.pending === 3 && queue.installPolicy === "user-confirmed" ? "passed" : "failed",
      `Queue total=${queue.total}, pending=${queue.pending}, installPolicy=${queue.installPolicy}.`,
      "Imported extensions must become a user-confirmed queue instead of automatic installs.",
    ))

    checks.push(makeCheck(
      "dry_run_no_auto_install",
      "Dry-run does not auto-install extensions",
      options.dryRun && queue.installed === 0 && queue.failed === 0 ? "passed" : "failed",
      `dryRun=${options.dryRun}; installed=${queue.installed}; failed=${queue.failed}.`,
      "Cursor/VS Code migration must not install extensions without explicit user or enterprise authorization.",
    ))

    const updated = migration.updateExtensionInstallQueueStatus("ms-python.python", "failed", {
      filePath: imported.extensions.manifestPath,
      error: "network unavailable in smoke",
    })
    checks.push(makeCheck(
      "queue_status_retryable",
      "Migration queue status is retryable",
      updated.failed === 1 && updated.pending === 2 ? "passed" : "failed",
      `After marking one failure, failed=${updated.failed}, pending=${updated.pending}.`,
      "Migration UI needs per-extension retry/ignore/install status without mutating the source profile.",
    ))
  } catch (error) {
    checks.push(makeCheck(
      "migration_smoke_error",
      "Migration smoke error",
      "failed",
      error.message,
      "Fix migration source discovery, preview, or extension queue persistence.",
    ))
  } finally {
    if (previousCodekData == null) delete process.env.CODEK_DATA
    else process.env.CODEK_DATA = previousCodekData
    fs.rmSync(fixture.home, { recursive: true, force: true })
    fs.rmSync(codekData, { recursive: true, force: true })
  }

  const summary = summarizeChecks(checks)
  const status = summary.failed > 0 ? "blocked" : summary.warning > 0 ? "degraded" : "ready"
  return {
    reportKind: "extension-migration-smoke",
    createdAt: Date.now(),
    durationMs: Date.now() - startedAt,
    ready: summary.failed === 0,
    status,
    summary,
    source: options.source,
    dryRun: options.dryRun,
    checks,
    evidence: {
      preview: preview ? {
        settingsCount: preview.settingsCount,
        keybindingsCount: preview.keybindingsCount,
        snippetsCount: preview.snippetsCount,
        extensionsCount: preview.extensionsCount,
      } : null,
      importedExtensions: imported?.extensions?.imported || 0,
      queue: queue ? {
        total: queue.total,
        pending: queue.pending,
        installed: queue.installed,
        failed: queue.failed,
        installPolicy: queue.installPolicy,
      } : null,
    },
  }
}

function migrationSmokePaths(reportDir = defaultReportDir()) {
  return {
    reportDir,
    latestJsonPath: path.join(reportDir, "extension-migration-smoke-latest.json"),
    latestMarkdownPath: path.join(reportDir, "extension-migration-smoke-latest.md"),
  }
}

function toMarkdown(report) {
  const rows = (report.checks || []).map((check) =>
    `| ${check.id} | ${check.status} | ${String(check.detail || "").replace(/\|/g, "\\|")} | ${String(check.nextAction || "").replace(/\|/g, "\\|")} |`,
  )
  return [
    "# Extension Migration Smoke",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Status: ${report.status}`,
    `- Source: ${report.source}`,
    `- Dry-run: ${report.dryRun ? "YES" : "NO"}`,
    "",
    "| Check | Status | Detail | Next Action |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

function saveMigrationSmokeReport(report, options = {}) {
  const paths = migrationSmokePaths(options.reportDir || defaultReportDir())
  fs.mkdirSync(paths.reportDir, { recursive: true })
  const withPaths = { ...report, ...paths }
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(withPaths, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${toMarkdown(withPaths)}\n`, "utf8")
  return { ...paths, report: withPaths }
}

function readLatestMigrationSmoke(options = {}) {
  const paths = migrationSmokePaths(options.reportDir || defaultReportDir())
  if (!fs.existsSync(paths.latestJsonPath)) return { report: null, ...paths }
  return { report: JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8")), ...paths }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = buildMigrationSmokeReport(options)
  if (!options.noWrite) saveMigrationSmokeReport(report, { reportDir: options.reportDir })
  process.stdout.write(`${JSON.stringify({
    reportKind: report.reportKind,
    ready: report.ready,
    status: report.status,
    summary: report.summary,
    jsonPath: options.noWrite ? "" : migrationSmokePaths(options.reportDir).latestJsonPath,
    markdownPath: options.noWrite ? "" : migrationSmokePaths(options.reportDir).latestMarkdownPath,
  }, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main()
}

module.exports = {
  buildMigrationSmokeReport,
  defaultReportDir,
  migrationSmokePaths,
  parseArgs,
  readLatestMigrationSmoke,
  saveMigrationSmokeReport,
  toMarkdown,
}
