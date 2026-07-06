const assert = require("assert")
const { EventEmitter } = require("events")
const test = require("node:test")
const {
  SearchWorkerProcessHost,
  serializeWorkerRequest,
} = require("./searchWorkerProcessAdapter")
const {
  SearchProviderType,
  createDefaultSearchProviderRegistry,
  shouldUseSearchWorkerProcess,
} = require("./searchProviderRegistry")

class FakeChild extends EventEmitter {
  constructor() {
    super()
    this.sent = []
    this.killed = false
  }

  send(message, callback) {
    this.sent.push(message)
    callback?.()
  }

  kill() {
    this.killed = true
    this.emit("exit", 0)
  }
}

test("serializeWorkerRequest strips functions and keeps query options as JSON", () => {
  const request = serializeWorkerRequest(SearchProviderType.file, {
    root: "D:/Workspace",
    filePattern: "special",
    signal: new AbortController().signal,
    queryPlan: {
      resultLimit: 10,
      visitedFileLimit: 20,
      includeExpression: { "**/*.ts": true },
      excludeExpression: { "**/*.test.ts": true },
    },
    shouldIncludePath: () => true,
    shouldIncludePathMode: "defaultIgnoredSegments",
  })

  assert.equal(request.signal, undefined)
  assert.equal(request.queryPlan, undefined)
  assert.equal(request.shouldIncludePath, undefined)
  assert.equal(request.queryOptions.maxResults, 10)
  assert.deepEqual(request.queryOptions.include, ["**/*.ts"])
  assert.deepEqual(request.queryOptions.exclude, ["**/*.test.ts"])
  assert.equal(request.shouldIncludePathMode, "defaultIgnoredSegments")
})

test("SearchWorkerProcessHost sends requests to one search worker and resolves results", async () => {
  const child = new FakeChild()
  const host = new SearchWorkerProcessHost({
    idleMs: 0,
    forkImpl: () => child,
  })

  const promise = host.fileSearch({
    root: "D:/Workspace",
    filePattern: "needle",
    queryOptions: { query: "needle", maxResults: 10, compileTextPattern: false },
  })
  const sent = child.sent[0]
  assert.equal(sent.type, "search")
  assert.equal(sent.searchType, SearchProviderType.file)
  assert.equal(sent.request.filePattern, "needle")

  child.emit("message", {
    type: "result",
    id: sent.id,
    result: { engine: "ripgrep-files-worker", matches: [{ path: "src/app.ts" }] },
  })

  const result = await promise
  assert.deepEqual(result.matches.map((match) => match.path), ["src/app.ts"])
})

test("SearchWorkerProcessHost forwards AbortSignal as worker cancel", async () => {
  const child = new FakeChild()
  const host = new SearchWorkerProcessHost({
    idleMs: 0,
    forkImpl: () => child,
  })
  const controller = new AbortController()
  const promise = host.textSearch({
    root: "D:/Workspace",
    query: "needle",
    queryOptions: { query: "needle", maxResults: 10, compileTextPattern: true },
    signal: controller.signal,
  })

  const sent = child.sent[0]
  controller.abort()
  assert.deepEqual(child.sent[1], { type: "cancel", id: sent.id })
  child.emit("message", {
    type: "error",
    id: sent.id,
    error: { name: "AbortError", message: "Search cancelled" },
  })

  await assert.rejects(promise, /Search cancelled/)
})

test("createDefaultSearchProviderRegistry uses worker process only when explicitly enabled in Node", () => {
  const direct = createDefaultSearchProviderRegistry({ useWorkerProcess: false })
  const worker = createDefaultSearchProviderRegistry({
    useWorkerProcess: true,
    workerProcess: {
      forkImpl: () => new FakeChild(),
      idleMs: 0,
    },
  })

  assert.equal(direct.searchWorkerProcessHost, undefined)
  assert.ok(worker.searchWorkerProcessHost)
  worker.searchWorkerProcessHost.dispose()
})

test("shouldUseSearchWorkerProcess respects explicit environment override", () => {
  const oldValue = process.env.CODEK_SEARCH_WORKER_PROCESS
  try {
    process.env.CODEK_SEARCH_WORKER_PROCESS = "1"
    assert.equal(shouldUseSearchWorkerProcess(), true)
    process.env.CODEK_SEARCH_WORKER_PROCESS = "0"
    assert.equal(shouldUseSearchWorkerProcess(), false)
  } finally {
    if (oldValue === undefined) delete process.env.CODEK_SEARCH_WORKER_PROCESS
    else process.env.CODEK_SEARCH_WORKER_PROCESS = oldValue
  }
})
