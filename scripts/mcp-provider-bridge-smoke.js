#!/usr/bin/env node

const assert = require("node:assert/strict")
const EventEmitter = require("node:events")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const root = path.resolve(__dirname, "..")

class FakeServer extends EventEmitter {
  constructor() {
    super()
    this.handlers = new Map()
  }

  onRpc(method, handler) {
    this.handlers.set(method, handler)
  }

  callRpc(method, args) {
    const handler = this.handlers.get(method)
    if (!handler) throw new Error(`missing handler: ${method}`)
    return handler(args)
  }
}

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

function clearMcpModuleCache() {
  for (const modulePath of [
    "../desktop/services/settings",
    "../desktop/services/mcp/mcpAccess",
    "../desktop/services/mcp/profileMcpAdapter",
    "../desktop/services/extensions-host/mainThread/mainThreadMcp",
  ]) {
    delete require.cache[require.resolve(modulePath)]
  }
}

function loadMcpModules(tempDataDir) {
  const previous = process.env.CODEK_DATA
  process.env.CODEK_DATA = tempDataDir
  clearMcpModuleCache()
  const mainThreadMcp = require("../desktop/services/extensions-host/mainThread/mainThreadMcp")
  const mcpAdapter = require("../desktop/services/mcp/profileMcpAdapter")
  return {
    mainThreadMcp,
    mcpAdapter,
    restore() {
      if (previous == null) delete process.env.CODEK_DATA
      else process.env.CODEK_DATA = previous
      clearMcpModuleCache()
    },
  }
}

function sampleCollection() {
  return {
    id: "publisher.sample/sample-provider",
    label: "Sample MCP",
    extensionId: "publisher.sample",
    isTrustedByDefault: true,
    canResolveLaunch: false,
  }
}

function sampleDefinitions() {
  return [
    {
      id: "publisher.sample/local",
      label: "Local Tooling",
      cacheNonce: "v1",
      launch: {
        type: 1,
        command: "node",
        args: ["server.js"],
        env: { API_TOKEN: "stdio-secret" },
        cwd: "C:/workspace",
      },
    },
    {
      id: "publisher.sample/remote",
      label: "Remote Tooling",
      cacheNonce: "v2",
      launch: {
        type: 2,
        uri: { scheme: "http", authority: "127.0.0.1:4317", path: "/mcp", query: "", fragment: "" },
        headers: [["Authorization", "http-secret"]],
      },
    },
  ]
}

function passed(id, evidence = {}) {
  return { id, status: "passed", passed: true, evidence }
}

function failed(id, error) {
  return { id, status: "failed", passed: false, error: String(error?.message || error) }
}

async function runMcpProviderBridgeSmoke(options = {}) {
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-mcp-provider-bridge-"))
  const startedAt = Date.now()
  const checks = []
  const calls = []
  const publishedDefinitions = []
  const { mainThreadMcp, mcpAdapter, restore } = loadMcpModules(tempDataDir)
  const server = new FakeServer()

  try {
    mainThreadMcp.register(server, {
      callEh: async (nid, method, args) => {
        calls.push({ nid, method, args })
        if (method === "$onDidChangeMcpServerDefinitions") {
          publishedDefinitions.push(args[0])
        }
        if (method === "$sendMessage") {
          const [id, raw] = args
          const message = JSON.parse(raw)
          if (message.method === "initialize") {
            setImmediate(() => server.callRpc("$onDidReceiveMessage", [
              id,
              JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05" } }),
            ]))
          } else if (message.method === "tools/list") {
            setImmediate(() => server.callRpc("$onDidReceiveMessage", [
              id,
              JSON.stringify({
                jsonrpc: "2.0",
                id: message.id,
                result: {
                  tools: [{
                    name: "extensionTool",
                    description: "From extension host",
                    inputSchema: { type: "object", properties: {} },
                  }],
                },
              }),
            ]))
          } else if (message.method === "tools/call") {
            setImmediate(() => server.callRpc("$onDidReceiveMessage", [
              id,
              JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "ok" }] } }),
            ]))
          }
        }
        return undefined
      },
    })

    await server.callRpc("$upsertMcpCollection", [sampleCollection(), sampleDefinitions()])
    const configured = mcpAdapter.listConfiguredMcpServers()
    const serialized = JSON.stringify({ configured, publishedDefinitions })
    assert.equal(configured.length, 2)
    assert.equal(serialized.includes("stdio-secret"), false)
    assert.equal(serialized.includes("http-secret"), false)
    checks.push(passed("collection_registered_and_redacted", {
      configuredServers: configured.map((item) => item.serverName),
      publishedDefinitionCount: publishedDefinitions.at(-1)?.length || 0,
    }))

    const latestDefinitions = publishedDefinitions.at(-1) || []
    assert.deepEqual(latestDefinitions.map((item) => item.label), ["Local Tooling", "Remote Tooling"])
    assert.equal(latestDefinitions[0].launch.type, 1)
    assert.equal(latestDefinitions[1].launch.type, 2)
    checks.push(passed("definitions_published_to_ext_host", {
      labels: latestDefinitions.map((item) => item.label),
      launchTypes: latestDefinitions.map((item) => item.launch?.type),
    }))

    const client = await mcpAdapter.connectMcpServer("Remote Tooling")
    assert.equal(client.initialized, true)
    assert.deepEqual(client.getToolDefinitions().map((tool) => tool.name), ["extensionTool"])
    const toolResult = await mcpAdapter.callMcpTool("Remote Tooling", "extensionTool", {})
    assert.deepEqual(toolResult, [{ type: "text", text: "ok" }])
    checks.push(passed("delegate_transport_started_and_tools_called", {
      startCalled: calls.some((call) => call.method === "$startMcp"),
      sendMessageCalled: calls.some((call) => call.method === "$sendMessage"),
      toolNames: client.getToolDefinitions().map((tool) => tool.name),
    }))

    await server.callRpc("$deleteMcpCollection", ["publisher.sample/sample-provider"])
    assert.deepEqual(mcpAdapter.listConfiguredMcpServers(), [])
    assert.deepEqual(publishedDefinitions.at(-1), [])
    checks.push(passed("collection_delete_publishes_empty_definitions", {
      latestDefinitionCount: publishedDefinitions.at(-1)?.length || 0,
    }))
  } catch (error) {
    checks.push(failed("mcp_provider_bridge", error))
  } finally {
    try {
      await mcpAdapter.clearExtensionMcpServers()
    } catch {}
    restore()
  }

  const failedChecks = checks.filter((check) => !check.passed)
  return {
    reportKind: "mcp-provider-bridge-smoke",
    createdAt: Date.now(),
    durationMs: Date.now() - startedAt,
    ready: failedChecks.length === 0,
    status: failedChecks.length === 0 ? "ready" : "blocked",
    extensionId: "publisher.sample",
    collectionId: sampleCollection().id,
    mainThreadMcpRegistered: checks.some((check) => check.id === "collection_registered_and_redacted" && check.passed),
    definitionsPublishedToExtHost: checks.some((check) => check.id === "definitions_published_to_ext_host" && check.passed),
    delegateTransportStarted: checks.some((check) => check.id === "delegate_transport_started_and_tools_called" && check.passed),
    secretRedactionVerified: checks.some((check) => check.id === "collection_registered_and_redacted" && check.passed),
    deletePublishesEmptyDefinitions: checks.some((check) => check.id === "collection_delete_publishes_empty_definitions" && check.passed),
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
    "# MCP Provider Bridge Smoke",
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

function saveMcpProviderBridgeSmoke(report, options = {}) {
  const reportDir = resolveReportDir(options.reportDir)
  fs.mkdirSync(reportDir, { recursive: true })
  const latestJsonPath = path.join(reportDir, "eh-e2e-mcp-provider-latest.json")
  const latestMarkdownPath = path.join(reportDir, "eh-e2e-mcp-provider-latest.md")
  const payload = { ...report, latestJsonPath, latestMarkdownPath }
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestMarkdownPath, toMarkdown(payload), "utf8")
  return { report: payload, jsonPath: latestJsonPath, markdownPath: latestMarkdownPath }
}

function readLatestMcpProviderBridgeSmoke(options = {}) {
  const reportDir = resolveReportDir(options.reportDir)
  const jsonPath = path.join(reportDir, "eh-e2e-mcp-provider-latest.json")
  const markdownPath = path.join(reportDir, "eh-e2e-mcp-provider-latest.md")
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
  const report = await runMcpProviderBridgeSmoke(options)
  const saved = options.noWrite
    ? { report, jsonPath: "", markdownPath: "" }
    : saveMcpProviderBridgeSmoke(report, options)
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
  readLatestMcpProviderBridgeSmoke,
  runMcpProviderBridgeSmoke,
  saveMcpProviderBridgeSmoke,
  toMarkdown,
}
