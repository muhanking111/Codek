const assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")
const test = require("node:test")

const { TSLanguageService } = require("./index")

function createServiceWithFakeProcess(options = {}) {
  const service = new TSLanguageService()
  const writes = []
  const stdin = {
    write(message, callback) {
      writes.push(message)
      if (options.hangWrite) return true
      if (options.writeError) {
        callback?.(new Error(options.writeError))
        return false
      }
      callback?.()
      return true
    },
  }
  const proc = new EventEmitter()
  proc.stdin = stdin
  service._process = proc
  service._running = true
  return { service, writes }
}

test("LSP open notifications return after stdin write and do not wait for tsserver response", async () => {
  const { service, writes } = createServiceWithFakeProcess()

  const result = await service.openFile("src/App.ts", "export const ready = true\n")

  assert.deepEqual(result, { success: true, wrote: true })
  assert.equal(writes.length, 1)
  assert.match(writes[0], /"command":"open"/)
  assert.equal(service._pending.size, 0)
})

test("LSP best-effort notification times out when stdin write callback never returns", async () => {
  const { service } = createServiceWithFakeProcess({ hangWrite: true })

  const result = await service.sendBestEffortCommand("open", { file: "src/App.ts" }, 5)

  assert.deepEqual(result, { success: false, timeout: true, command: "open" })
  assert.equal(service._pending.size, 0)
})

test("LSP query commands still wait for matching tsserver responses", async () => {
  const { service, writes } = createServiceWithFakeProcess()
  const pending = service.getQuickInfo("src/App.ts", 1, 1)
  assert.equal(service._pending.size, 1)
  assert.match(writes[0], /"command":"quickinfo"/)

  service._handleMessage({
    type: "response",
    request_seq: 1,
    body: { displayString: "const ready: true" },
  })

  await assert.doesNotReject(async () => {
    const result = await pending
    assert.deepEqual(result, { displayString: "const ready: true" })
  })
  assert.equal(service._pending.size, 0)
})
