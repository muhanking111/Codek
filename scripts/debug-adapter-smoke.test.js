const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildFixtureEvidence,
  buildExternalAdapterCheck,
  buildExtensionHostAdapterFeasibility,
  parseArgs,
  runDebugAdapterSmoke,
  runJsDebugExtensionHostSmoke,
  runDebugpySmoke,
  saveDebugAdapterSmoke,
} = require("./debug-adapter-smoke")

test("debug adapter smoke runs real child-process DAP adapters and persists report", async () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-debug-smoke-"))
  const report = await runDebugAdapterSmoke({ reportDir, skipJsDebugExtensionHostSmoke: true })
  const debugpy = report.checks.find((check) => check.id === "python-debugpy")

  assert.equal(report.ready, true)
  const fixture = report.checks.find((check) => check.id === "fixture")
  assert.equal(fixture.status, "passed")
  assert.equal(fixture.breakpointsVerified, true)
  assert.equal(fixture.threads > 0, true)
  assert.equal(fixture.variables > 0, true)
  assert.equal(fixture.evaluateResult, "true")
  assert.equal(fixture.evaluateError, "fixture evaluate failed")
  assert.equal(fixture.evidence.metadataOnly, true)
  assert.equal(fixture.evidence.requestCommands.setBreakpoints, true)
  assert.equal(fixture.evidence.requestCommands.configurationDone, true)
  assert.equal(fixture.evidence.requestCommands.stackTrace, true)
  assert.equal(fixture.evidence.requestCommands.scopes, true)
  assert.equal(fixture.evidence.requestCommands.variables, true)
  assert.equal(fixture.evidence.requestCommands.continue, true)
  assert.equal(fixture.evidence.requestCommands.next, true)
  assert.equal(fixture.evidence.requestCommands.terminate, true)
  assert.equal(fixture.evidence.stackTrace.frameCount, 1)
  assert.equal(fixture.evidence.scopes.scopeCount, 1)
  assert.equal(fixture.evidence.variables.variableCount, 1)
  assert.equal(fixture.evidence.bridgeEvidence.stateSource, "dapSessions")
  assert.equal(fixture.evidence.redaction.expressionValuesRedacted, true)
  assert.equal(fixture.evidence.redaction.sourcePathsRedacted, true)
  assert.equal(fixture.evidence.redaction.adapterArgumentsRedacted, true)
  assert.equal(debugpy.status, "passed")
  assert.equal(debugpy.source, "ms-python.debugpy")
  assert.equal(debugpy.evaluateResult, "40")
  assert.equal(debugpy.breakpointsVerified, true)
  assert.equal(debugpy.stackFrames > 0, true)
  assert.equal(Array.isArray(debugpy.reverseRequests), true)
  assert.equal(fs.existsSync(path.join(reportDir, "debug-adapter-smoke-latest.json")), true)
})

test("fixture evidence is metadata-only and omits expression values, source paths, and adapter args", () => {
  const evidence = buildFixtureEvidence({
    started: {
      sessionId: "session-1",
      adapterId: "fixture",
      command: process.execPath,
      rawArgs: ["--token", "super-secret-token"],
    },
    breakpoints: { body: { breakpoints: [{ verified: true, line: 2 }] } },
    threads: { body: { threads: [{ id: 1, name: "main" }] } },
    stack: {
      body: {
        stackFrames: [{
          id: 7,
          name: "main",
          line: 2,
          column: 1,
          source: { path: "D:/Workspace/private/smoke.js" },
        }],
        totalFrames: 1,
      },
    },
    scopes: { body: { scopes: [{ name: "Locals", variablesReference: 10, expensive: false }] } },
    variables: { body: { variables: [{ name: "secret", value: "raw-secret-value", type: "string" }] } },
    commands: ["setBreakpoints", "stackTrace", "scopes", "variables", "terminate"],
    bridgeEvidence: {
      source: "desktopDebugService",
      serviceId: "debugService",
      stateSource: "dapSessions",
      constraints: { noSecondDebugState: true, dapBoundaryOnly: true, preservesDapBehavior: true, redactsCommandArguments: true },
      latest: { requests: [{ command: "variables" }], events: [{ event: "stopped" }] },
      owners: { variables: { status: "available" } },
    },
  })
  const serialized = JSON.stringify(evidence)

  assert.equal(evidence.metadataOnly, true)
  assert.equal(evidence.breakpoints.verified, 1)
  assert.equal(evidence.variables.valueCount, 1)
  assert.equal(evidence.variables.valueSamplesIncluded, false)
  assert.equal(evidence.adapter.commandLabel, path.basename(process.execPath))
  assert.equal(serialized.includes("raw-secret-value"), false)
  assert.equal(serialized.includes("D:/Workspace/private/smoke.js"), false)
  assert.equal(serialized.includes("super-secret-token"), false)
  assert.equal(serialized.includes("--token"), false)
})

test("debugpy smoke reports a real third-party adapter boundary when available", async () => {
  const check = await runDebugpySmoke()

  assert.equal(check.id, "python-debugpy")
  if (check.status === "skipped") {
    assert.equal(check.adapterAvailable, false)
    return
  }

  assert.equal(check.status, "passed")
  assert.equal(check.mode, "stdio")
  assert.equal(check.source, "ms-python.debugpy")
  assert.equal(check.evaluateResult, "40")
  assert.equal(check.variables > 0, true)
})

test("external adapter check returns skipped when an environment adapter is missing", () => {
  const check = buildExternalAdapterCheck("unknown-adapter")

  assert.equal(check.status, "skipped")
  assert.equal(check.adapterAvailable, false)
})

test("external adapter check labels extension-host adapters honestly", () => {
  const check = buildExternalAdapterCheck("node")

  if (check.adapterAvailable && check.mode === "extension-host") {
    assert.equal(check.status, "skipped")
    assert.equal(check.dapSessionCovered, false)
    assert.equal(check.adapterStarted, false)
    assert.equal(check.source, "ms-vscode.js-debug")
    assert.match(check.detail, /session-start descriptor handoff/)
    assert.equal(check.feasibility.status, "contract-ready")
    assert.equal(check.feasibility.evidence.extensionInstalled, true)
    assert.equal(check.feasibility.evidence.recordsDescriptorFactoryRegistration, true)
    assert.equal(check.feasibility.evidence.hasProvideDebugAdapterBridge, true)
    assert.equal(check.feasibility.evidence.hasSessionStartDescriptorHandoff, true)
    assert.equal(check.feasibility.evidence.hasDescriptorToDapTransportBridge, true)
    assert.equal(check.hasSessionStartDescriptorHandoff, true)
    assert.match(check.descriptorHandoffTarget, /\$provideDebugAdapter/)
    assert.equal(check.realLaunchSmoke, "pending-environment-adapter-session")
    assert.ok(check.feasibility.requiredBridge.includes("调用扩展宿主 $provideDebugAdapter(handle, sessionDto)"))
    assert.equal(check.feasibility.missingBridge.some((item) => item.includes("$provideDebugAdapter") && item.includes("dapStart")), false)
    assert.equal(check.feasibility.verifiedBridgeApis.some((item) => item.includes("$provideDebugAdapter") && item.includes("dapStart")), true)
    assert.equal(check.feasibility.remainingLimitations.includes("inline DebugAdapterInlineImplementation descriptors are not supported by Codek desktop DAP service"), true)
  }
})

test("runJsDebugExtensionHostSmoke returns injected real launch evidence", () => {
  const check = runJsDebugExtensionHostSmoke({
    runJsDebugSmoke: () => ({
      id: "node",
      status: "passed",
      detail: "injected",
      adapterAvailable: true,
      dapSessionCovered: true,
      mode: "extension-host",
      source: "ms-vscode.js-debug",
      realLaunchSmoke: "passed",
      startDebuggingResult: true,
      launchSessionStatus: "dap-handoff",
    }),
  })

  if (!check) return
  assert.equal(check.status, "passed")
  assert.equal(check.source, "ms-vscode.js-debug")
  assert.equal(check.startDebuggingResult, true)
  assert.equal(check.launchSessionStatus, "dap-handoff")
})

test("js-debug feasibility reports the missing extension-host DAP transport bridge", () => {
  const check = buildExternalAdapterCheck("node")

  if (check.adapterAvailable && check.mode === "extension-host") {
    const feasibility = check.feasibility

    assert.equal(feasibility.status, "contract-ready")
    assert.equal(feasibility.evidence.hasJsDebugActivationProbe, true)
    assert.equal(feasibility.evidence.hasDescriptorToDapTransportBridge, true)
    assert.ok(feasibility.missingBridge.some((item) => item.includes("initialize/launch smoke")))
  }
})

test("debug adapter smoke report writer creates markdown and json", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-debug-smoke-save-"))
  const saved = saveDebugAdapterSmoke({
    ready: true,
    summary: { total: 1, passed: 1, skipped: 0, failed: 0 },
    checks: [{
      id: "fixture",
      status: "passed",
      detail: "ok",
      evidence: {
        metadataOnly: true,
        stackTrace: { frameCount: 1 },
        scopes: { scopeCount: 1 },
        variables: { variableCount: 1 },
        requestCommands: { setBreakpoints: true, configurationDone: true },
      },
    }],
  }, { reportDir })

  assert.equal(fs.existsSync(saved.jsonPath), true)
  assert.equal(fs.existsSync(saved.markdownPath), true)
  assert.match(fs.readFileSync(saved.markdownPath, "utf8"), /metadata-only/)
})

test("parseArgs supports no-write and report dir", () => {
  assert.deepEqual(parseArgs(["--no-write", "--report-dir=C:/tmp/debug-smoke"]), {
    noWrite: true,
    reportDir: "C:/tmp/debug-smoke",
  })
})
