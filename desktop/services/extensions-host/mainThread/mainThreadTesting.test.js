const assert = require("node:assert/strict")
const test = require("node:test")

const mainThreadTesting = require("./mainThreadTesting")
const { ExtHostContext, MainContext } = require("../extHostServer")

function createServer() {
  const handlers = new Map()
  const calls = []
  return {
    calls,
    handlers,
    onRpc(actorIdOrMethod, methodOrHandler, maybeHandler) {
      const key = typeof actorIdOrMethod === "number"
        ? `${actorIdOrMethod}:${methodOrHandler}`
        : actorIdOrMethod
      const handler = typeof actorIdOrMethod === "number" ? maybeHandler : methodOrHandler
      handlers.set(key, handler)
    },
    callRpc(method, args) {
      const handler = handlers.get(`${mainThreadTesting.MAIN_THREAD_TESTING_NID}:${method}`) || handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
    call(nid, method, args, timeoutMs, options) {
      calls.push({ nid, method, args, timeoutMs, options })
      if (method === "$getCoverageDetails") {
        return Promise.resolve([{ type: "statement", count: 1, executed: 1, location: { line: 1, character: 1 } }])
      }
      if (method === "$provideTestFollowups") {
        return Promise.resolve([{ id: 7, title: "Explain failure" }])
      }
      return Promise.resolve(undefined)
    },
  }
}

function createIpcMain() {
  const listeners = new Map()
  const handlers = new Map()
  return {
    listeners,
    handlers,
    on(channel, handler) {
      listeners.set(channel, handler)
    },
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    emitPayload(channel, payload) {
      const handler = listeners.get(channel)
      assert.equal(typeof handler, "function", `missing listener ${channel}`)
      handler({}, payload)
    },
    invoke(channel, payload) {
      const handler = handlers.get(channel)
      assert.equal(typeof handler, "function", `missing handler ${channel}`)
      return handler({}, payload)
    },
  }
}

test("MainThreadTesting uses VS Code protocol ids for main-thread and extension-host testing", () => {
  assert.equal(mainThreadTesting.MAIN_THREAD_TESTING_NID, MainContext.MainThreadTesting)
  assert.equal(mainThreadTesting.EXT_HOST_TESTING_NID, ExtHostContext.ExtHostTesting)
})

test("MainThreadTesting projects VS Code controller profile and diff lifecycle to renderer events", () => {
  const server = createServer()
  const rendererEvents = []
  mainThreadTesting.register(server, {
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  server.callRpc("$registerTestController", ["vitest", "Vitest", 0])
  server.callRpc("$publishTestRunProfile", [{
    controllerId: "vitest",
    profileId: 1,
    label: "Run focused",
    group: 1,
    isDefault: true,
    tag: "unit",
    hasConfigurationHandler: true,
  }])
  server.callRpc("$publishDiff", ["vitest", [
    {
      op: 0,
      item: {
        expand: 3,
        item: {
          extId: "vitest\u0000src/testing/testingService.test.ts",
          label: "testingService.test.ts",
          tags: ["unit"],
          busy: false,
          uri: { scheme: "file", path: "/workspace/src/testing/testingService.test.ts" },
          range: { startLineNumber: 1, startColumn: 1, endLineNumber: 10, endColumn: 1 },
          description: "unit suite",
          error: null,
          sortText: "001",
        },
      },
    },
    {
      op: 1,
      item: {
        extId: "vitest\u0000src/testing/testingService.test.ts",
        expand: 0,
        item: { label: "testingService renamed.test.ts", busy: true },
      },
    },
  ]])
  server.callRpc("$removeTestProfile", ["vitest", 1])
  server.callRpc("$unregisterTestController", ["vitest"])

  assert.deepEqual(rendererEvents.map((event) => event.channel), [
    "ext-host:testing-controller",
    "ext-host:testing-profile",
    "ext-host:testing-item",
    "ext-host:testing-item",
    "ext-host:testing-profile-remove",
    "ext-host:testing-controller-remove",
  ])
  assert.deepEqual(rendererEvents[0].payload, { controllerId: "vitest", label: "Vitest", capabilities: 0 })
  assert.deepEqual(rendererEvents[1].payload, {
    controllerId: "vitest",
    profileId: 1,
    label: "Run focused",
    group: "run",
    isDefault: true,
    tag: "unit",
    configureCommandId: "testing.configureProfile",
  })
  assert.deepEqual(rendererEvents[2].payload, {
    controllerId: "vitest",
    id: "vitest\u0000src/testing/testingService.test.ts",
    label: "testingService.test.ts",
    parentId: "vitest",
    uri: "file:///workspace/src/testing/testingService.test.ts",
    range: { startLineNumber: 1, startColumn: 1, endLineNumber: 10, endColumn: 1 },
    tags: ["unit"],
    busy: false,
    expand: "expanded",
    description: "unit suite",
    error: undefined,
    sortText: "001",
  })
  assert.equal(rendererEvents[3].payload.label, "testingService renamed.test.ts")
  assert.equal(rendererEvents[3].payload.busy, true)
  assert.equal(rendererEvents[3].payload.expand, "notExpandable")
  assert.deepEqual(rendererEvents[4].payload, { controllerId: "vitest", profileId: 1 })
  assert.deepEqual(rendererEvents[5].payload, { controllerId: "vitest" })
})

test("MainThreadTesting projects VS Code run result output and coverage lifecycle", () => {
  const server = createServer()
  const rendererEvents = []
  mainThreadTesting.register(server, {
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  server.callRpc("$startedExtensionTestRun", [{
    id: "run:1",
    include: ["vitest\u0000suite\u0000test"],
    exclude: ["vitest\u0000suite\u0000skip"],
    controllerId: "vitest",
    profile: { group: 1, id: 1 },
    continuous: false,
  }])
  server.callRpc("$startedTestRunTask", ["run:1", {
    id: "task:1",
    ctrlId: "vitest",
    name: "Vitest task",
    running: true,
  }])
  server.callRpc("$appendOutputToRun", [
    "run:1",
    "task:1",
    Buffer.from("collected 1 test"),
    { uri: { scheme: "file", path: "/workspace/src/test.ts" } },
    "vitest\u0000suite\u0000test",
  ])
  server.callRpc("$appendTestMessagesInRun", ["run:1", "task:1", "vitest\u0000suite\u0000test", [
    { message: "expected true", type: 0 },
  ]])
  server.callRpc("$updateTestStateInRun", ["run:1", "task:1", "vitest\u0000suite\u0000test", 3, 12])
  server.callRpc("$appendCoverage", ["run:1", "task:1", {
    id: "coverage:1",
    uri: { scheme: "file", path: "/workspace/src/test.ts" },
    statement: { covered: 8, total: 10 },
    branch: { covered: 1, total: 2 },
    testIds: ["vitest\u0000suite\u0000test"],
  }])
  server.callRpc("$markTestRetired", [["vitest\u0000suite"]])
  server.callRpc("$finishedTestRunTask", ["run:1", "task:1"])
  server.callRpc("$finishedExtensionTestRun", ["run:1"])

  assert.deepEqual(rendererEvents.map((event) => event.channel), [
    "ext-host:testing-run-start",
    "ext-host:testing-run-task-start",
    "ext-host:testing-run-output",
    "ext-host:testing-run-state",
    "ext-host:testing-run-state",
    "ext-host:testing-coverage",
    "ext-host:testing-retire",
    "ext-host:testing-run-task-finish",
    "ext-host:testing-run-complete",
  ])
  assert.deepEqual(rendererEvents[0].payload, {
    id: "run:1",
    controllerId: "vitest",
    profileId: 1,
    group: "run",
    testIds: ["vitest\u0000suite\u0000test"],
    excludeIds: ["vitest\u0000suite\u0000skip"],
    continuous: false,
    label: "Extension test run",
  })
  assert.deepEqual(rendererEvents[1].payload, {
    runId: "run:1",
    task: {
      id: "task:1",
      controllerId: "vitest",
      name: "Vitest task",
      running: true,
    },
  })
  assert.deepEqual(rendererEvents[2].payload, {
    runId: "run:1",
    testId: "vitest\u0000suite\u0000test",
    message: "collected 1 test",
    locationUri: "file:///workspace/src/test.ts",
  })
  assert.deepEqual(rendererEvents[3].payload, {
    runId: "run:1",
    testId: "vitest\u0000suite\u0000test",
    state: "running",
    durationMs: undefined,
    messages: ["expected true"],
  })
  assert.deepEqual(rendererEvents[4].payload, {
    runId: "run:1",
    testId: "vitest\u0000suite\u0000test",
    state: "passed",
    durationMs: 12,
    messages: [],
  })
  assert.deepEqual(rendererEvents[5].payload.files, [{
    id: "coverage:1",
    uri: "file:///workspace/src/test.ts",
    statement: { covered: 8, total: 10 },
    branch: { covered: 1, total: 2 },
    declaration: undefined,
    testIds: ["vitest\u0000suite\u0000test"],
  }])
  assert.deepEqual(rendererEvents[6].payload, { testIds: ["vitest\u0000suite"] })
  assert.deepEqual(rendererEvents[7].payload, { runId: "run:1", taskId: "task:1" })
  assert.deepEqual(rendererEvents[8].payload, { runId: "run:1" })
})

test("MainThreadTesting bridges renderer cancellation configuration and coverage detail callbacks to ExtHostTesting", async () => {
  const server = createServer()
  const ipcMain = createIpcMain()
  mainThreadTesting.register(server, { ipcMain })

  ipcMain.emitPayload("ext-host:testing-cancel", { runId: "run:1", taskId: "task:1" })
  ipcMain.emitPayload("ext-host:testing-configure-profile", { controllerId: "vitest", profileId: 3 })
  const details = await ipcMain.invoke("ext-host:testing-coverage-details", { coverageId: "coverage:1", testId: "vitest\u0000suite\u0000test" })
  const followups = await ipcMain.invoke("ext-host:testing-provide-followups", {
    testId: "vitest\u0000suite\u0000test",
    resultId: "run:1",
    taskId: "task:1",
    message: { message: "failed" },
  })
  const executed = await ipcMain.invoke("ext-host:testing-execute-followup", { id: 7 })
  const disposed = await ipcMain.invoke("ext-host:testing-dispose-followups", { ids: [7, "bad"] })
  const published = await ipcMain.invoke("ext-host:testing-publish-results", {
    results: [{
      id: "run:1",
      controllerId: "vitest",
      tests: [{ id: "run:1:vitest\u0000suite\u0000test", testId: "vitest\u0000suite\u0000test", state: "passed", messages: [] }],
      tasks: [{ id: "task:1", running: false }],
      output: [{ message: "ok" }],
    }],
  })
  await Promise.resolve()

  assert.deepEqual(details, [{ type: "statement", count: 1, executed: 1, location: { line: 1, character: 1 } }])
  assert.deepEqual(followups, [{ id: 7, title: "Explain failure" }])
  assert.equal(executed, true)
  assert.equal(disposed, true)
  assert.equal(published, true)
  assert.deepEqual(server.calls, [
    {
      nid: mainThreadTesting.EXT_HOST_TESTING_NID,
      method: "$cancelExtensionTestRun",
      args: ["run:1", "task:1"],
      timeoutMs: 30000,
      options: undefined,
    },
    {
      nid: mainThreadTesting.EXT_HOST_TESTING_NID,
      method: "$configureRunProfile",
      args: ["vitest", 3],
      timeoutMs: 30000,
      options: undefined,
    },
    {
      nid: mainThreadTesting.EXT_HOST_TESTING_NID,
      method: "$getCoverageDetails",
      args: ["coverage:1", "vitest\u0000suite\u0000test"],
      timeoutMs: 30000,
      options: { usesCancellationToken: true },
    },
    {
      nid: mainThreadTesting.EXT_HOST_TESTING_NID,
      method: "$provideTestFollowups",
      args: [{
        testId: "vitest\u0000suite\u0000test",
        message: { message: "failed" },
        resultId: "run:1",
        taskId: "task:1",
      }],
      timeoutMs: 30000,
      options: { usesCancellationToken: true },
    },
    {
      nid: mainThreadTesting.EXT_HOST_TESTING_NID,
      method: "$executeTestFollowup",
      args: [7],
      timeoutMs: 30000,
      options: undefined,
    },
    {
      nid: mainThreadTesting.EXT_HOST_TESTING_NID,
      method: "$disposeTestFollowups",
      args: [[7]],
      timeoutMs: 30000,
      options: undefined,
    },
    {
      nid: mainThreadTesting.EXT_HOST_TESTING_NID,
      method: "$publishTestResults",
      args: [[{
        id: "run:1",
        controllerId: "vitest",
        tests: [{ id: "run:1:vitest\u0000suite\u0000test", testId: "vitest\u0000suite\u0000test", state: "passed", messages: [] }],
        tasks: [{ id: "task:1", running: false }],
        output: [{ message: "ok" }],
        noSecondState: true,
      }]],
      timeoutMs: 30000,
      options: undefined,
    },
  ])
})

test("MainThreadTesting exposes VS Code discovery callbacks through ExtHostTesting", async () => {
  const server = createServer()
  const ipcMain = createIpcMain()
  server.call = (nid, method, args, timeoutMs, options) => {
    server.calls.push({ nid, method, args, timeoutMs, options })
    if (method === "$getCodeRelatedToTest") {
      return Promise.resolve([{ uri: { scheme: "file", path: "/workspace/src/test.ts" }, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 } }])
    }
    if (method === "$getTestsRelatedToCode") {
      return Promise.resolve(["vitest\u0000suite\u0000test"])
    }
    return Promise.resolve(undefined)
  }
  mainThreadTesting.register(server, { ipcMain })

  server.callRpc("$subscribeToDiffs")
  const synced = await ipcMain.invoke("ext-host:testing-sync-tests", {})
  const refreshed = await ipcMain.invoke("ext-host:testing-refresh-tests", { controllerId: "vitest" })
  const expanded = await ipcMain.invoke("ext-host:testing-expand-test", { testId: "vitest\u0000suite", levels: 2 })
  const code = await ipcMain.invoke("ext-host:testing-code-related-to-test", { testId: "vitest\u0000suite\u0000test" })
  const tests = await ipcMain.invoke("ext-host:testing-tests-related-to-code", {
    uri: { scheme: "file", path: "/workspace/src/test.ts" },
    position: { lineNumber: 1, column: 2 },
  })
  await Promise.resolve()

  assert.equal(synced, true)
  assert.equal(refreshed, true)
  assert.equal(expanded, true)
  assert.deepEqual(code, [{ uri: { scheme: "file", path: "/workspace/src/test.ts" }, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 } }])
  assert.deepEqual(tests, ["vitest\u0000suite\u0000test"])
  assert.deepEqual(server.calls, [
    {
      nid: mainThreadTesting.EXT_HOST_TESTING_NID,
      method: "$syncTests",
      args: [],
      timeoutMs: 30000,
      options: { usesCancellationToken: true },
    },
    {
      nid: mainThreadTesting.EXT_HOST_TESTING_NID,
      method: "$syncTests",
      args: [],
      timeoutMs: 30000,
      options: { usesCancellationToken: true },
    },
    {
      nid: mainThreadTesting.EXT_HOST_TESTING_NID,
      method: "$refreshTests",
      args: ["vitest"],
      timeoutMs: 30000,
      options: { usesCancellationToken: true },
    },
    {
      nid: mainThreadTesting.EXT_HOST_TESTING_NID,
      method: "$expandTest",
      args: ["vitest\u0000suite", 2],
      timeoutMs: 30000,
      options: { usesCancellationToken: true },
    },
    {
      nid: mainThreadTesting.EXT_HOST_TESTING_NID,
      method: "$getCodeRelatedToTest",
      args: ["vitest\u0000suite\u0000test"],
      timeoutMs: 30000,
      options: { usesCancellationToken: true },
    },
    {
      nid: mainThreadTesting.EXT_HOST_TESTING_NID,
      method: "$getTestsRelatedToCode",
      args: [{ scheme: "file", path: "/workspace/src/test.ts" }, { lineNumber: 1, column: 2 }],
      timeoutMs: 30000,
      options: { usesCancellationToken: true },
    },
  ])
})

test("MainThreadTesting projects resolved and continuous run requests while forwarding ExtHostTesting execution", async () => {
  const server = createServer()
  const rendererEvents = []
  let nextNow = 1000
  const originalNow = Date.now
  Date.now = () => nextNow++
  try {
    mainThreadTesting.register(server, {
      sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
    })

    const resolvedRunId = server.callRpc("$runTests", [{
      group: 4,
      exclude: ["vitest\u0000skip"],
      targets: [{
        controllerId: "vitest",
        profileId: 2,
        testIds: ["vitest\u0000suite"],
      }],
    }])
    const continuousRunId = server.callRpc("$startContinuousRun", [{
      group: 1,
      targets: [{
        controllerId: "vitest",
        profileId: 1,
        testIds: ["vitest\u0000watch"],
      }],
    }])
    await Promise.resolve()

    assert.deepEqual(rendererEvents, [
      {
        channel: "ext-host:testing-run-start",
        payload: {
          id: "run:1000:1",
          controllerId: "vitest",
          profileId: 2,
          group: "coverage",
          testIds: ["vitest\u0000suite"],
          excludeIds: ["vitest\u0000skip"],
          continuous: false,
          label: "Resolved extension test run",
        },
      },
      {
        channel: "ext-host:testing-run-start",
        payload: {
          id: "run:1001:2",
          controllerId: "vitest",
          profileId: 1,
          group: "run",
          testIds: ["vitest\u0000watch"],
          excludeIds: undefined,
          continuous: true,
          label: "Resolved extension test run",
        },
      },
    ])
    assert.equal(resolvedRunId, "run:1000:1")
    assert.equal(continuousRunId, "run:1001:2")
    assert.deepEqual(server.calls, [
      {
        nid: mainThreadTesting.EXT_HOST_TESTING_NID,
        method: "$runControllerTests",
        args: [[{
          controllerId: "vitest",
          profileId: 2,
          excludeExtIds: ["vitest\u0000skip"],
          testIds: ["vitest\u0000suite"],
          runId: "run:1000:1",
        }]],
        timeoutMs: 30000,
        options: { usesCancellationToken: true },
      },
      {
        nid: mainThreadTesting.EXT_HOST_TESTING_NID,
        method: "$startContinuousRun",
        args: [[{
          controllerId: "vitest",
          profileId: 1,
          excludeExtIds: [],
          testIds: ["vitest\u0000watch"],
          runId: "run:1001:2",
        }]],
        timeoutMs: 30000,
        options: { usesCancellationToken: true },
      },
    ])
  } finally {
    Date.now = originalNow
  }
})
