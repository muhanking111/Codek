const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const mainThreadOutputService = require("./mainThreadOutputService")
const { MainContext } = require("../extHostServer")
const { toFileUriComponents } = require("../uriComponents")

function createServer() {
  const handlers = new Map()
  return {
    handlers,
    onRpc(actorIdOrMethod, methodOrHandler, maybeHandler) {
      const key = typeof actorIdOrMethod === "number"
        ? `${actorIdOrMethod}:${methodOrHandler}`
        : actorIdOrMethod
      const handler = typeof actorIdOrMethod === "number" ? maybeHandler : methodOrHandler
      handlers.set(key, handler)
    },
    callRpc(method, args) {
      const handler = handlers.get(`${mainThreadOutputService.MAIN_THREAD_OUTPUT_SERVICE_NID}:${method}`) || handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
  }
}

test("MainThreadOutputService uses the bundled VS Code MainContext actor id", () => {
  assert.equal(mainThreadOutputService.MAIN_THREAD_OUTPUT_SERVICE_NID, MainContext.MainThreadOutputService)
})

test("MainThreadOutputService projects VS Code output channel lifecycle to renderer events", async () => {
  const server = createServer()
  const rendererEvents = []
  mainThreadOutputService.register(server, {
    sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
  })

  const channelId = server.callRpc("$register", ["Extension Output", { path: "out.log" }, "log", "ms.test"])
  await server.callRpc("$update", [channelId, 1])
  server.callRpc("$reveal", [channelId, false])
  server.callRpc("$close", [channelId])
  server.callRpc("$dispose", [channelId])

  assert.match(channelId, /^extension-output-ms\.test-#\d+-Extension Output$/)
  assert.deepEqual(rendererEvents.map((event) => event.channel), [
    "ext-host:output-register",
    "ext-host:output-update",
    "ext-host:output-reveal",
    "ext-host:output-close",
    "ext-host:output-dispose",
  ])
  assert.equal(rendererEvents[0].payload.channelId, channelId)
  assert.equal(rendererEvents[0].payload.label, "Extension Output")
  assert.equal(rendererEvents[0].payload.languageId, "log")
  assert.equal(rendererEvents[0].payload.file, undefined)
  assert.deepEqual(rendererEvents[0].payload.ownerEvidence, {
    owner: "MainThreadOutputService",
    rendererOwner: "OutputPanel",
    stateSource: "mainThreadOutputService/extHostOutputChannel",
    outputServiceOwner: "outputLogTelemetryService",
    channelLabel: "Extension Output",
    evidenceState: "partial",
    uiOwnerState: "partial",
    rawOutputPayloadIncluded: false,
  })
  assert.deepEqual(
    { ...rendererEvents[1].payload, ownerEvidence: undefined },
    { channelId, mode: 1, till: undefined, ownerEvidence: undefined },
  )
  assert.deepEqual(
    { ...rendererEvents[2].payload, ownerEvidence: undefined },
    { channelId, preserveFocus: false, ownerEvidence: undefined },
  )
  assert.deepEqual(
    { ...rendererEvents[3].payload, ownerEvidence: undefined },
    { channelId, ownerEvidence: undefined },
  )
  assert.deepEqual(
    { ...rendererEvents[4].payload, ownerEvidence: undefined },
    { channelId, ownerEvidence: undefined },
  )
})

test("MainThreadOutputService reads VS Code output backing file content on update", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-output-"))
  try {
    const backingFile = path.join(tempDir, "extension.log")
    fs.writeFileSync(backingFile, "first\n")
    const server = createServer()
    const rendererEvents = []
    mainThreadOutputService.register(server, {
      sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
    })

    const channelId = server.callRpc("$register", ["Extension Output", toFileUriComponents(backingFile), "log", "ms.test"])
    await server.callRpc("$update", [channelId, 1])
    fs.appendFileSync(backingFile, "second\n")
    await server.callRpc("$update", [channelId, 1])
    const replaceOffset = Buffer.byteLength("first\nsecond\n")
    fs.appendFileSync(backingFile, "replacement\n")
    await server.callRpc("$update", [channelId, 2, replaceOffset])
    await server.callRpc("$update", [channelId, 3, fs.statSync(backingFile).size])

    assert.deepEqual(
      rendererEvents
        .filter((event) => event.channel === "ext-host:output-content")
        .map((event) => ({
          channelId: event.payload.channelId,
          content: event.payload.content,
          mode: event.payload.mode,
          till: event.payload.till,
        })),
      [
        { channelId, content: "first\n", mode: 1, till: undefined },
        { channelId, content: "second\n", mode: 1, till: undefined },
        { channelId, content: "replacement\n", mode: 2, till: replaceOffset },
        { channelId, content: "", mode: 3, till: fs.statSync(backingFile).size },
      ],
    )
    assert.equal(rendererEvents[0].payload.file.path.toLowerCase(), backingFile.toLowerCase())
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test("MainThreadOutputService output content event is sourced from the backing file, not update projection", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-output-backing-contract-"))
  try {
    const backingFile = path.join(tempDir, "extension.log")
    const diskContent = "disk-backed-output\n"
    fs.writeFileSync(backingFile, diskContent)
    const server = createServer()
    const rendererEvents = []
    mainThreadOutputService.register(server, {
      sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
    })

    const channelId = server.callRpc("$register", ["Extension Output", toFileUriComponents(backingFile), "log", "ms.test"])
    await server.callRpc("$update", [channelId, 1, 999999])

    const contentEvents = rendererEvents.filter((event) => event.channel === "ext-host:output-content")
    assert.equal(contentEvents.length, 1)
    assert.deepEqual({
      channelId: contentEvents[0].payload.channelId,
      content: contentEvents[0].payload.content,
      mode: contentEvents[0].payload.mode,
      till: contentEvents[0].payload.till,
    }, {
      channelId,
      content: diskContent,
      mode: 1,
      till: 999999,
    })
    assert.equal(rendererEvents.some((event) => JSON.stringify(event).includes("999999\n")), false)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

test("MainThreadOutputService aligns clear and replace without till to the backing file end", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-output-offset-contract-"))
  try {
    const backingFile = path.join(tempDir, "extension.log")
    fs.writeFileSync(backingFile, "old content\n")
    const server = createServer()
    const rendererEvents = []
    mainThreadOutputService.register(server, {
      sendToRenderer: (channel, payload) => rendererEvents.push({ channel, payload }),
    })

    const channelId = server.callRpc("$register", ["Extension Output", toFileUriComponents(backingFile), "log", "ms.test"])
    await server.callRpc("$update", [channelId, 2])
    fs.appendFileSync(backingFile, "new content\n")
    await server.callRpc("$update", [channelId, 1])
    await server.callRpc("$update", [channelId, 3])

    assert.deepEqual(
      rendererEvents
        .filter((event) => event.channel === "ext-host:output-content")
        .map((event) => ({
          channelId: event.payload.channelId,
          content: event.payload.content,
          mode: event.payload.mode,
          till: event.payload.till,
        })),
      [
        { channelId, content: "", mode: 2, till: undefined },
        { channelId, content: "new content\n", mode: 1, till: undefined },
        { channelId, content: "", mode: 3, till: undefined },
      ],
    )
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
