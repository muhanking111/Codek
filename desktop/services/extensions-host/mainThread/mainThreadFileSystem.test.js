const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const mainThreadFileSystem = require("./mainThreadFileSystem")
const { toFileUriComponents } = require("../uriComponents")

function createServer() {
  const handlers = new Map()
  return {
    handlers,
    onRpc(method, handler) {
      handlers.set(method, handler)
    },
    callRpc(method, args) {
      const handler = handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
  }
}

test("MainThreadFileSystem writes VSBuffer-style content and reads Buffer data for workspace.fs", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-fs-"))
  const fileUri = toFileUriComponents(path.join(tempDir, "nested", "sample.txt"))
  const server = createServer()
  mainThreadFileSystem.register(server)

  await server.callRpc("$writeFile", [fileUri, Buffer.from("hello workspace.fs", "utf8")])

  const content = await server.callRpc("$readFile", [fileUri])
  assert.ok(Buffer.isBuffer(content))
  assert.equal(content.toString("utf8"), "hello workspace.fs")

  const stat = await server.callRpc("$stat", [fileUri])
  assert.equal(stat.type, 1)
  assert.equal(stat.size, "hello workspace.fs".length)
})

test("MainThreadFileSystem honors workspace.fs overwrite and recursive delete contracts", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-ext-fs-"))
  const srcUri = toFileUriComponents(path.join(tempDir, "src.txt"))
  const dstUri = toFileUriComponents(path.join(tempDir, "dst.txt"))
  const folderUri = toFileUriComponents(path.join(tempDir, "folder"))
  const nestedUri = toFileUriComponents(path.join(tempDir, "folder", "nested.txt"))
  const server = createServer()
  mainThreadFileSystem.register(server)

  await server.callRpc("$writeFile", [srcUri, Buffer.from("source", "utf8")])
  await server.callRpc("$writeFile", [dstUri, Buffer.from("target", "utf8")])

  await assert.rejects(
    () => server.callRpc("$rename", [srcUri, dstUri, { overwrite: false }]),
    /EEXIST|FileExists/,
  )
  await server.callRpc("$rename", [srcUri, dstUri, { overwrite: true }])
  assert.equal(fs.readFileSync(path.join(tempDir, "dst.txt"), "utf8"), "source")

  await server.callRpc("$writeFile", [nestedUri, Buffer.from("nested", "utf8")])
  await assert.rejects(
    () => server.callRpc("$delete", [folderUri, { recursive: false }]),
    /ENOTEMPTY|recursive/i,
  )
  await server.callRpc("$delete", [folderUri, { recursive: true }])
  assert.equal(fs.existsSync(path.join(tempDir, "folder")), false)
})

test("toNodeBuffer accepts serialized byte arrays from RPC fallback paths", () => {
  assert.equal(mainThreadFileSystem.toNodeBuffer({ data: [65, 66, 67] }).toString("utf8"), "ABC")
  assert.equal(mainThreadFileSystem.toNodeBuffer({ value: [68, 69, 70] }).toString("utf8"), "DEF")
  assert.equal(mainThreadFileSystem.toNodeBuffer("plain text").toString("utf8"), "plain text")
})
