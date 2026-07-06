const assert = require("assert")
const test = require("node:test")
const { createSearchProgressReporter, searchProgressMessage } = require("./searchProgressAdapter")

test("createSearchProgressReporter emits VS Code-style progress messages once per stage", () => {
  const events = []
  const reporter = createSearchProgressReporter((event) => events.push(event))

  reporter.start({ queryLength: 6 })
  reporter.provider({ engine: "ripgrep" })
  reporter.provider({ engine: "ripgrep" })
  reporter.providerError({ engine: "ripgrep", error: "provider failed" })
  reporter.contents({ matchedFiles: 2 })
  reporter.done({ matchCount: 3 })

  assert.deepEqual(events.map((event) => event.stage), [
    "search:start",
    "search:provider",
    "search:provider-error",
    "search:contents",
    "search:done",
  ])
  assert.equal(events[1].type, "message")
  assert.equal(events[1].message, "Searching with ripgrep")
  assert.equal(events[1].detail.engine, "ripgrep")
  assert.equal(events[2].message, "Search provider failed")
  assert.equal(events[2].detail.error, "provider failed")
  assert.equal(typeof events[1].elapsedMs, "number")
})

test("searchProgressMessage keeps stable UI labels for known stages", () => {
  assert.equal(searchProgressMessage("search:start"), "Searching workspace")
  assert.equal(searchProgressMessage("search:provider-error"), "Search provider failed")
  assert.equal(searchProgressMessage("search:fallback"), "Falling back to workspace file scan")
  assert.equal(searchProgressMessage("search:cancelled"), "Search cancelled")
  assert.equal(searchProgressMessage("custom-stage"), "custom-stage")
})

test("createSearchProgressReporter allows repeated RawSearchService result batches", () => {
  const events = []
  const reporter = createSearchProgressReporter((event) => events.push(event))

  reporter.resultBatch({ matches: [{ path: "a.ts" }], count: 1, total: 2 })
  reporter.resultBatch({ matches: [{ path: "b.ts" }], count: 1, total: 2 })

  assert.deepEqual(events.map((event) => event.stage), ["search:result-batch", "search:result-batch"])
  assert.deepEqual(events.map((event) => event.matches[0].path), ["a.ts", "b.ts"])
  assert.equal(events[0].type, "result")
})
