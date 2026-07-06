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
    "../desktop/services/userDataProfile",
    "../desktop/services/settings",
    "../desktop/services/mcp/mcpAccess",
    "../desktop/services/mcp/mcpGalleryInstallAdapter",
    "../desktop/services/mcp/mcpResourceScannerAdapter",
    "../desktop/services/mcp/profileMcpAdapter",
    "../desktop/services/extensions-host/index",
  ]) {
    delete require.cache[require.resolve(modulePath)]
  }
}

function loadModules(tempDataDir) {
  const previous = process.env.CODEK_DATA
  process.env.CODEK_DATA = tempDataDir
  clearModuleCache()
  const galleryInstall = require("../desktop/services/mcp/mcpGalleryInstallAdapter")
  const resourceScanner = require("../desktop/services/mcp/mcpResourceScannerAdapter")
  const mcpAdapter = require("../desktop/services/mcp/profileMcpAdapter")
  return {
    galleryInstall,
    resourceScanner,
    mcpAdapter,
    restore() {
      if (previous == null) delete process.env.CODEK_DATA
      else process.env.CODEK_DATA = previous
      clearModuleCache()
    },
  }
}

function sampleGalleryServer() {
  return {
    id: "gallery-filesystem",
    name: "io.modelcontextprotocol.filesystem",
    displayName: "Filesystem MCP",
    description: "Filesystem tools",
    version: "1.0.0",
    galleryUrl: "https://modelcontextprotocol.io/server/filesystem",
    repositoryUrl: "https://github.com/modelcontextprotocol/servers",
    readme: "# Filesystem MCP",
    configuration: {
      packages: [{
        registryType: "npm",
        identifier: "@modelcontextprotocol/server-filesystem",
        version: "1.0.0",
      }],
    },
  }
}

function passed(id, evidence = {}) {
  return { id, status: "passed", passed: true, evidence }
}

function failed(id, error) {
  return { id, status: "failed", passed: false, error: String(error?.message || error) }
}

async function runMcpGalleryManagementSmoke(options = {}) {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-mcp-gallery-management-"))
  const startedAt = Date.now()
  const checks = []
  const { galleryInstall, resourceScanner, mcpAdapter, restore } = loadModules(tempDataDir)
  const workspaceRoot = path.join(tempDataDir, "workspace")
  const workspaceFile = path.join(tempDataDir, "demo.code-workspace")
  const metadataRoot = path.join(tempDataDir, "User", "mcp")
  fs.mkdirSync(workspaceRoot, { recursive: true })
  fs.writeFileSync(workspaceFile, JSON.stringify({
    folders: [{ path: workspaceRoot }],
    settings: {
      "editor.tabSize": 2,
    },
  }, null, 2), "utf8")

  const lifecycle = []
  const disposables = [
    galleryInstall.onInstallMcpServer((event) => lifecycle.push(["install:start", event.name, event.mcpResource])),
    galleryInstall.onDidInstallMcpServers((results) => lifecycle.push(["install:did", results.map((result) => [result.name, Boolean(result.local), Boolean(result.error), result.mcpResource])])),
    galleryInstall.onUninstallMcpServer((event) => lifecycle.push(["uninstall:start", event.name, event.mcpResource])),
    galleryInstall.onDidUninstallMcpServer((event) => lifecycle.push(["uninstall:did", event.name, Boolean(event.error), event.mcpResource])),
  ]

  try {
    const server = sampleGalleryServer()
    const canInstall = galleryInstall.canInstallGalleryMcpServer(server)
    assert.equal(canInstall, true)
    const local = await galleryInstall.installGalleryMcpServer(server, {
      metadataRoot,
      mcpResource: workspaceFile,
      getReadme: async () => server.readme,
      now: () => "2026-06-21T00:00:00.000Z",
    })
    assert.equal(local.name, server.name)
    assert.equal(local.source, "gallery")
    assert.equal(local.config.command, "npx")
    assert.equal(fs.existsSync(path.join(local.location, "manifest.json")), true)
    assert.equal(fs.existsSync(path.join(local.location, "README.md")), true)
    checks.push(passed("gallery_install_writes_metadata", {
      serverName: local.name,
      location: local.location,
      command: local.config.command,
    }))

    const resourceWrite = resourceScanner.addMcpServers([local], {
      target: "workspace",
      workspaceFile,
      workspace: workspaceFile,
    })
    const workspace = JSON.parse(fs.readFileSync(workspaceFile, "utf8"))
    assert.equal(workspace.settings["editor.tabSize"], 2)
    assert.equal(Boolean(workspace.settings.mcp.servers[server.name]), true)
    assert.equal(resourceWrite.target, "workspace")
    checks.push(passed("workspace_settings_mcp_written", {
      target: resourceWrite.target,
      serverNames: Object.keys(workspace.settings.mcp.servers),
    }))

    const applied = await mcpAdapter.applyActiveProfileFromProject(workspaceRoot, { workspaceFile, mcpAccess: "all" })
    const appliedWorkspaceServer = applied.workspaceServers.find((entry) => entry.originalName === server.name || entry.serverName === server.name)
    assert.ok(appliedWorkspaceServer)
    const configured = mcpAdapter.listConfiguredMcpServers()
    const listed = configured.find((entry) => entry.workspaceScoped && (
      entry.serverName === appliedWorkspaceServer.serverName ||
      entry.config?.originalName === server.name ||
      entry.serverName === server.name
    ))
    assert.ok(listed)
    assert.equal(listed.workspaceScoped, true)
    assert.equal(listed.config.source, "workspace-settings-mcp")
    checks.push(passed("workspace_settings_mcp_consumed_by_registry", {
      configuredServers: configured.map((entry) => entry.serverName),
      source: listed.config.source,
    }))

    const routeRegistry = await readMcpRegistryRouteSnapshot()
    assert.equal(routeRegistry.ok, true)
    assert.ok(routeRegistry.collections.some((collection) => collection.serverNames.includes(listed.serverName)))
    assert.ok(routeRegistry.servers.some((entry) => entry.serverName === listed.serverName))
    assert.ok(routeRegistry.delegates.length >= 1)
    checks.push(passed("workbench_mcp_registry_route_ready", {
      route: "/extensions-host/mcp-registry",
      collections: routeRegistry.collections.length,
      servers: routeRegistry.servers.length,
      delegates: routeRegistry.delegates.length,
    }))

    const result = await galleryInstall.uninstallGalleryMcpServer(server.name, {
      metadataRoot,
      mcpResource: workspaceFile,
    })
    assert.equal(result.uninstalled, true)
    resourceScanner.removeMcpServers([server.name], {
      target: "workspace",
      workspaceFile,
      workspace: workspaceFile,
    })
    const afterRemove = JSON.parse(fs.readFileSync(workspaceFile, "utf8"))
    assert.equal(afterRemove.settings?.mcp?.servers?.[server.name], undefined)
    assert.equal(fs.existsSync(local.location), false)
    checks.push(passed("gallery_uninstall_cleans_metadata_and_workspace_resource", {
      uninstalled: result.uninstalled,
      metadataExists: fs.existsSync(local.location),
      remainingServers: Object.keys(afterRemove.settings?.mcp?.servers || {}),
    }))

    assert.deepEqual(lifecycle, [
      ["install:start", server.name, workspaceFile],
      ["install:did", [[server.name, true, false, workspaceFile]]],
      ["uninstall:start", server.name, workspaceFile],
      ["uninstall:did", server.name, false, workspaceFile],
    ])
    checks.push(passed("management_lifecycle_events_emitted", {
      events: lifecycle.map((event) => event[0]),
    }))
  } catch (error) {
    checks.push(failed("mcp_gallery_management", error))
  } finally {
    for (const disposable of disposables) disposable.dispose()
    try {
      await mcpAdapter.clearWorkspaceMcpServers()
      await mcpAdapter.clearProfileMcpServers()
      await mcpAdapter.clearInstalledMcpServers()
    } catch {}
    restore()
  }

  const failedChecks = checks.filter((check) => !check.passed)
  return {
    reportKind: "mcp-gallery-management-smoke",
    createdAt: Date.now(),
    durationMs: Date.now() - startedAt,
    ready: failedChecks.length === 0,
    status: failedChecks.length === 0 ? "ready" : "blocked",
    galleryInstallReady: checks.some((check) => check.id === "gallery_install_writes_metadata" && check.passed),
    workspaceResourceWritten: checks.some((check) => check.id === "workspace_settings_mcp_written" && check.passed),
    workspaceRegistryConsumed: checks.some((check) => check.id === "workspace_settings_mcp_consumed_by_registry" && check.passed),
    workbenchRegistryRouteReady: checks.some((check) => check.id === "workbench_mcp_registry_route_ready" && check.passed),
    galleryUninstallReady: checks.some((check) => check.id === "gallery_uninstall_cleans_metadata_and_workspace_resource" && check.passed),
    lifecycleEventsEmitted: checks.some((check) => check.id === "management_lifecycle_events_emitted" && check.passed),
    registryRouteSnapshot: latestEvidence(checks, "workbench_mcp_registry_route_ready"),
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

async function readMcpRegistryRouteSnapshot() {
  const router = require("../desktop/services/router")
  const extensionsHost = require("../desktop/services/extensions-host")
  router.clearRoutes()
  extensionsHost.register(router)
  const result = await router.dispatch({
    method: "GET",
    path: "/extensions-host/mcp-registry",
  })
  return {
    ok: result.ok === true,
    collections: Array.isArray(result.data?.collections) ? result.data.collections : [],
    servers: Array.isArray(result.data?.servers) ? result.data.servers : [],
    delegates: Array.isArray(result.data?.delegates) ? result.data.delegates : [],
  }
}

function latestEvidence(checks, id) {
  const check = checks.find((entry) => entry.id === id && entry.passed)
  return check?.evidence || {}
}

function toMarkdown(report) {
  return [
    "# MCP Gallery Management Smoke",
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

function saveMcpGalleryManagementSmoke(report, options = {}) {
  const reportDir = resolveReportDir(options.reportDir)
  fs.mkdirSync(reportDir, { recursive: true })
  const latestJsonPath = path.join(reportDir, "mcp-gallery-management-latest.json")
  const latestMarkdownPath = path.join(reportDir, "mcp-gallery-management-latest.md")
  const payload = { ...report, latestJsonPath, latestMarkdownPath }
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestMarkdownPath, toMarkdown(payload), "utf8")
  return { report: payload, jsonPath: latestJsonPath, markdownPath: latestMarkdownPath }
}

function readLatestMcpGalleryManagementSmoke(options = {}) {
  const reportDir = resolveReportDir(options.reportDir)
  const jsonPath = path.join(reportDir, "mcp-gallery-management-latest.json")
  const markdownPath = path.join(reportDir, "mcp-gallery-management-latest.md")
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
  const report = await runMcpGalleryManagementSmoke(options)
  const saved = options.noWrite
    ? { report, jsonPath: "", markdownPath: "" }
    : saveMcpGalleryManagementSmoke(report, options)
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
  readLatestMcpGalleryManagementSmoke,
  runMcpGalleryManagementSmoke,
  saveMcpGalleryManagementSmoke,
  toMarkdown,
}
