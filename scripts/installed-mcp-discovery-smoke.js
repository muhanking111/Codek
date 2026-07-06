#!/usr/bin/env node

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  return {
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
  }
}

function resolveReportDir(reportDir) {
  if (!reportDir) return defaultReportDir()
  return path.isAbsolute(reportDir) ? reportDir : path.resolve(root, reportDir)
}

function clearModuleCache() {
  for (const modulePath of [
    "../desktop/services/extensions-host/extensionInstallState",
    "../desktop/services/extensions-host/extensionManager",
    "../desktop/services/userDataProfile",
    "../desktop/services/mcp/profileMcpAdapter",
  ]) {
    delete require.cache[require.resolve(modulePath)]
  }
}

function loadModules(tempDataDir) {
  const previous = process.env.CODEK_DATA
  process.env.CODEK_DATA = tempDataDir
  clearModuleCache()
  const extensionInstallState = require("../desktop/services/extensions-host/extensionInstallState")
  const extensionManager = require("../desktop/services/extensions-host/extensionManager")
  const mcpAdapter = require("../desktop/services/mcp/profileMcpAdapter")
  return {
    extensionInstallState,
    extensionManager,
    mcpAdapter,
    restore() {
      if (previous == null) delete process.env.CODEK_DATA
      else process.env.CODEK_DATA = previous
      clearModuleCache()
    },
  }
}

function sampleManifest() {
  return {
    publisher: "publisher",
    name: "installed-mcp-tools",
    version: "1.0.0",
    displayName: "Installed MCP Tools",
    activationEvents: ["onStartupFinished"],
    contributes: {
      mcp: {
        servers: {
          installedServer: {
            command: "node",
            args: ["installed-server.js", "${workspaceFolderBasename}"],
            env: { API_TOKEN: "installed-secret" },
          },
        },
      },
      commands: [{ command: "ignored.command" }],
    },
  }
}

function passed(id, evidence = {}) {
  return { id, status: "passed", passed: true, evidence }
}

function failed(id, error) {
  return { id, status: "failed", passed: false, error: String(error?.message || error) }
}

async function runInstalledMcpDiscoverySmoke(options = {}) {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-installed-mcp-"))
  const startedAt = Date.now()
  const checks = []
  const { extensionInstallState, extensionManager, mcpAdapter, restore } = loadModules(tempDataDir)
  const workspace = path.join(tempDataDir, "workspace")
  fs.mkdirSync(workspace, { recursive: true })
  fs.writeFileSync(path.join(workspace, ".mcp.json"), JSON.stringify({
    mcpServers: {
      workspaceServer: { command: "node", args: ["workspace-server.js"] },
    },
  }, null, 2), "utf8")

  try {
    const manifestState = extensionManager.pickManifestInstallState(sampleManifest())
    extensionInstallState.updateExtensionInstallRecord("publisher.installed-mcp-tools", {
      status: "installed",
      enabled: true,
      source: "marketplace",
      version: "1.0.0",
      installPath: path.join(tempDataDir, "extensions", "publisher.installed-mcp-tools"),
      ...manifestState,
    })
    const record = extensionInstallState.getExtensionInstallRecord("publisher.installed-mcp-tools")
    assert.equal(record.status, "installed")
    assert.equal(record.mcp.servers.installedServer.command, "node")
    assert.equal(record.manifest.contributes.mcp.servers.installedServer.args[0], "installed-server.js")
    assert.equal(record.manifest.contributes.commands, undefined)
    checks.push(passed("install_state_manifest_mcp_persisted", {
      extensionId: record.id,
      source: record.source,
      manifestHasMcp: Boolean(record.manifest?.contributes?.mcp),
      topLevelMcp: Boolean(record.mcp),
    }))

    const discovered = await mcpAdapter.discoverInstalledMcpServers(workspace, { mcpAccess: "registry" })
    assert.equal(discovered.servers.length, 1)
    assert.equal(discovered.sources.length, 1)
    assert.equal(discovered.servers[0].serverName, "installedServer")
    assert.deepEqual(discovered.servers[0].args, ["installed-server.js", "${workspaceFolderBasename}"])
    checks.push(passed("installed_discovery_reads_install_state", {
      serverNames: discovered.servers.map((server) => server.serverName),
      source: discovered.sources[0].source,
      extensionId: discovered.sources[0].extensionId,
      rawWorkspaceVariablePreserved: discovered.servers[0].args.includes("${workspaceFolderBasename}"),
    }))

    const applied = await mcpAdapter.applyActiveProfileFromProject(workspace, { mcpAccess: "registry" })
    assert.deepEqual(applied.workspaceServers, [])
    assert.equal(applied.installedServers.length, 1)
    const configured = mcpAdapter.listConfiguredMcpServers()
    const serialized = JSON.stringify(configured)
    assert.equal(configured.some((server) => server.serverName === "workspaceServer"), false)
    const installedServer = configured.find((server) => server.serverName === "installedServer")
    assert.ok(installedServer)
    assert.equal(installedServer.installedScoped, true)
    assert.equal(installedServer.workspaceScoped, false)
    assert.equal(installedServer.config.source, "installed-mcp")
    assert.deepEqual(installedServer.config.args, ["installed-server.js", "workspace"])
    assert.deepEqual(installedServer.config.envKeys, ["API_TOKEN"])
    assert.equal(serialized.includes("installed-secret"), false)
    checks.push(passed("registry_access_applies_installed_and_filters_workspace", {
      configuredServers: configured.map((server) => server.serverName),
      installedScoped: installedServer.installedScoped,
      workspaceServerFiltered: !configured.some((server) => server.serverName === "workspaceServer"),
      secretRedacted: !serialized.includes("installed-secret"),
    }))
  } catch (error) {
    checks.push(failed("installed_mcp_discovery", error))
  } finally {
    try {
      await mcpAdapter.clearInstalledMcpServers()
      await mcpAdapter.clearWorkspaceMcpServers()
      await mcpAdapter.clearProfileMcpServers()
    } catch {}
    restore()
  }

  const failedChecks = checks.filter((check) => !check.passed)
  return {
    reportKind: "installed-mcp-discovery-smoke",
    createdAt: Date.now(),
    durationMs: Date.now() - startedAt,
    ready: failedChecks.length === 0,
    status: failedChecks.length === 0 ? "ready" : "blocked",
    extensionId: "publisher.installed-mcp-tools",
    installedMcpPersisted: checks.some((check) => check.id === "install_state_manifest_mcp_persisted" && check.passed),
    installedDiscoveryRead: checks.some((check) => check.id === "installed_discovery_reads_install_state" && check.passed),
    installedRegistryApplied: checks.some((check) => check.id === "registry_access_applies_installed_and_filters_workspace" && check.passed),
    workspaceDiscoveryFilteredInRegistryMode: checks.some((check) => check.id === "registry_access_applies_installed_and_filters_workspace" && check.passed),
    secretRedactionVerified: checks.some((check) => check.id === "registry_access_applies_installed_and_filters_workspace" && check.passed),
    providerErrors: failedChecks.map((check) => check.error),
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.passed).length,
      failed: failedChecks.length,
    },
    checks,
    latestJsonPath: options.latestJsonPath || "",
    latestMarkdownPath: options.latestMarkdownPath || "",
  }
}

function toMarkdown(report) {
  return [
    "# Installed MCP Discovery Smoke",
    "",
    `- Ready: ${report.ready}`,
    `- Status: ${report.status}`,
    `- Passed: ${report.summary.passed}/${report.summary.total}`,
    "",
    "| Check | Status | Evidence |",
    "| --- | --- | --- |",
    ...report.checks.map((check) => `| ${check.id} | ${check.status} | ${JSON.stringify(check.evidence || check.error || {})} |`),
    "",
  ].join("\n")
}

function saveInstalledMcpDiscoverySmoke(report, options = {}) {
  const reportDir = resolveReportDir(options.reportDir)
  fs.mkdirSync(reportDir, { recursive: true })
  const latestJsonPath = path.join(reportDir, "installed-mcp-discovery-latest.json")
  const latestMarkdownPath = path.join(reportDir, "installed-mcp-discovery-latest.md")
  const payload = { ...report, latestJsonPath, latestMarkdownPath }
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestMarkdownPath, toMarkdown(payload), "utf8")
  return { report: payload, jsonPath: latestJsonPath, markdownPath: latestMarkdownPath }
}

function readLatestInstalledMcpDiscoverySmoke(options = {}) {
  const reportDir = resolveReportDir(options.reportDir)
  const jsonPath = path.join(reportDir, "installed-mcp-discovery-latest.json")
  const markdownPath = path.join(reportDir, "installed-mcp-discovery-latest.md")
  try {
    return {
      report: JSON.parse(fs.readFileSync(jsonPath, "utf8")),
      jsonPath,
      markdownPath,
    }
  } catch {
    return { report: null, jsonPath, markdownPath }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await runInstalledMcpDiscoverySmoke(options)
  const saved = options.noWrite
    ? { report, jsonPath: "", markdownPath: "" }
    : saveInstalledMcpDiscoverySmoke(report, options)
  process.stdout.write(`${JSON.stringify({
    reportKind: saved.report.reportKind,
    ready: saved.report.ready,
    status: saved.report.status,
    summary: saved.report.summary,
    jsonPath: saved.jsonPath,
  }, null, 2)}\n`)
  process.exit(saved.report.ready ? 0 : 1)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`)
    process.exit(1)
  })
}

module.exports = {
  defaultReportDir,
  parseArgs,
  readLatestInstalledMcpDiscoverySmoke,
  runInstalledMcpDiscoverySmoke,
  saveInstalledMcpDiscoverySmoke,
  toMarkdown,
}
