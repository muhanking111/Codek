const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildDebugAdapterHealth,
  buildJsDebugBridgeFeasibility,
  findBundledDebugpy,
  findJsDebugExtension,
  readLatestDebugAdapterHealth,
  resolveAdapter,
  saveDebugAdapterHealth,
} = require("./adapterHealth")

function writeJsDebugExtension(root) {
  const extensionPath = path.join(root, "ms-vscode.js-debug")
  fs.mkdirSync(path.join(extensionPath, "src"), { recursive: true })
  fs.writeFileSync(path.join(extensionPath, "src", "extension.js"), "exports.activate = () => {}\n")
  fs.writeFileSync(path.join(extensionPath, "package.json"), JSON.stringify({
    name: "js-debug",
    publisher: "ms-vscode",
    version: "1.117.0",
    displayName: "JavaScript Debugger",
    main: "./src/extension.js",
    contributes: {
      debuggers: [
        { type: "pwa-node", label: "Node.js" },
        { type: "node", label: "Node.js" },
      ],
    },
  }, null, 2))
  return extensionPath
}

test("resolveAdapter explains missing explicit node js-debug adapter path", () => {
  const adapter = resolveAdapter("node", {}, { jsDebugPath: path.join(os.tmpdir(), "missing-debugServer.js") })

  assert.equal(adapter.available, false)
  assert.equal(adapter.adapterType, "node")
  assert.match(adapter.message, /不存在/)
  assert.equal(adapter.remediation.category, "environment")
  assert.equal(adapter.remediation.configKey, "codek.debug.nodeAdapterPath")
})

test("resolveAdapter reports available explicit local node adapter path", () => {
  const adapterPath = path.join(os.tmpdir(), `debugServer-${Date.now()}.js`)
  fs.writeFileSync(adapterPath, "process.exit(0)\n")
  const adapter = resolveAdapter("node", {}, { jsDebugPath: adapterPath })

  assert.equal(adapter.available, true)
  assert.equal(adapter.adapterPath, adapterPath)
  assert.equal(adapter.mode, "stdio")
  assert.equal(adapter.remediation.resolvedPath, adapterPath)
})

test("resolveAdapter accepts alternate explicit node adapter path keys", () => {
  const adapterPath = path.join(os.tmpdir(), `nodeAdapter-${Date.now()}.js`)
  fs.writeFileSync(adapterPath, "process.exit(0)\n")

  const fromAdapterPath = resolveAdapter("node", { adapterPath })
  const fromDescriptor = resolveAdapter("node", { adapterExecutable: { command: adapterPath } })

  assert.equal(fromAdapterPath.available, true)
  assert.equal(fromAdapterPath.adapterPath, adapterPath)
  assert.equal(fromDescriptor.available, true)
  assert.equal(fromDescriptor.source, "config")
  assert.equal(fromDescriptor.command, adapterPath)
  assert.deepEqual(fromDescriptor.args, [])
})

test("resolveAdapter can use official ms-vscode.js-debug extension contributions", () => {
  const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-js-debug-ext-"))
  const extensionPath = writeJsDebugExtension(extensionsDir)

  const found = findJsDebugExtension({ extensionsDir })
  const adapter = resolveAdapter("node", {}, { extensionsDir })

  assert.equal(found.extensionPath, extensionPath)
  assert.equal(adapter.available, true)
  assert.equal(adapter.source, "ms-vscode.js-debug")
  assert.equal(adapter.mode, "extension-host")
  assert.equal(adapter.dapTransportReady, true)
  assert.equal(adapter.sessionStartReady, true)
  assert.equal(adapter.feasibility.status, "ready")
  assert.match(adapter.feasibility.descriptorTypes.pipeServer, /supported via dapStart/)
  assert.equal(adapter.extension.debugTypes.includes("pwa-node"), true)
  assert.match(adapter.message, /JavaScript Debugger/)
})

test("js-debug bridge feasibility lists VS Code descriptor and DAP transport gaps", () => {
  const feasibility = buildJsDebugBridgeFeasibility({ extensionId: "ms-vscode.js-debug" })

  assert.equal(feasibility.status, "ready")
  assert.equal(feasibility.requiredSessionDtoFields.includes("configuration"), true)
  assert.equal(feasibility.verifiedBridgeApis.some((item) => item.includes("$provideDebugAdapter") && item.includes("dapStart")), true)
  assert.equal(feasibility.remainingLimitations.includes("inline DebugAdapterInlineImplementation descriptors are not supported by Codek desktop DAP service"), true)
  assert.match(feasibility.descriptorTypes.server, /supported via dapStart/)
})

test("resolveAdapter accepts custom command from launch config", () => {
  const adapter = resolveAdapter("node", { command: "node", args: ["adapter.js"] })

  assert.equal(adapter.available, true)
  assert.equal(adapter.source, "config")
  assert.deepEqual(adapter.args, ["adapter.js"])
  assert.equal(adapter.remediation.category, "custom-config")
})

test("resolveAdapter can use bundled ms-python.debugpy extension libs", () => {
  const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-debugpy-ext-"))
  const libsPath = path.join(extensionsDir, "ms-python.debugpy", "bundled", "libs")
  const adapterMain = path.join(libsPath, "debugpy", "adapter", "__main__.py")
  fs.mkdirSync(path.dirname(adapterMain), { recursive: true })
  fs.writeFileSync(adapterMain, "# adapter\n")

  const bundled = findBundledDebugpy({ extensionsDir })
  const adapter = resolveAdapter("python", {}, { extensionsDir, skipProbe: true })

  assert.equal(bundled.adapterMain, adapterMain)
  assert.equal(adapter.available, true)
  assert.equal(adapter.source, "ms-python.debugpy")
  assert.equal(adapter.adapterPath, adapterMain)
  assert.equal(adapter.env.PYTHONPATH.includes(libsPath), true)
})

test("debug adapter health persists latest report", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-debug-health-"))
  const report = buildDebugAdapterHealth({
    adapters: [{ type: "node", command: "node", args: ["adapter.js"] }],
  })
  const saved = saveDebugAdapterHealth(report, { reportDir })
  const latest = readLatestDebugAdapterHealth({ reportDir })

  assert.equal(report.ready, true)
  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(latest.report.reportKind, "debug-adapter-health")
})
