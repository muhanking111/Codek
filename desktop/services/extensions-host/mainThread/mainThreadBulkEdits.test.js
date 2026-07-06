const assert = require("node:assert/strict")
const path = require("node:path")
const test = require("node:test")

const mainThreadBulkEdits = require("./mainThreadBulkEdits")

function fileUri(filePath) {
  return {
    scheme: "file",
    path: `/${filePath.replace(/\\/g, "/")}`,
  }
}

function createMemoryFileSystem(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles))
  return {
    files,
    fsAccess: {
      mkdir: async () => undefined,
      rename: async (oldPath, newPath) => {
        if (!files.has(oldPath)) throw new Error("missing source")
        files.set(newPath, files.get(oldPath))
        files.delete(oldPath)
      },
      rm: async (filePath) => {
        files.delete(filePath)
      },
      readFile: async (filePath) => {
        if (!files.has(filePath)) throw new Error("missing file")
        return files.get(filePath)
      },
      writeFile: async (filePath, content) => {
        if (filePath.endsWith(`${path.sep}fail.txt`)) throw new Error("write denied")
        files.set(filePath, Buffer.isBuffer(content) ? content.toString("utf8") : String(content))
      },
    },
  }
}

function createServer() {
  const handlers = new Map()
  return {
    onRpc(method, handler) {
      handlers.set(method, handler)
    },
    call(method, args) {
      const handler = handlers.get(method)
      assert.equal(typeof handler, "function", `missing handler ${method}`)
      return handler(args || [])
    },
  }
}

test("applyWorkspaceEditDto returns partial failure evidence for multi-resource text edits", async () => {
  const okPath = path.join("D:", "Codek", "ok.txt")
  const failPath = path.join("D:", "Codek", "fail.txt")
  const memory = createMemoryFileSystem({
    [okPath]: "needle\n",
    [failPath]: "needle\n",
  })

  const summary = await mainThreadBulkEdits.applyWorkspaceEditDto({
    edits: [
      {
        resource: fileUri(okPath),
        textEdits: [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 }, text: "haystack" }],
      },
      {
        resource: fileUri(failPath),
        textEdits: [{
          range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 },
          text: "haystack",
          metadata: { match: "needle" },
        }],
      },
    ],
  }, { fsAccess: memory.fsAccess })

  assert.equal(summary.applied, false)
  assert.equal(summary.successCount, 1)
  assert.equal(summary.failureCount, 1)
  assert.deepEqual(summary.changedResources, [okPath])
  assert.equal(memory.files.get(okPath), "haystack\n")
  assert.equal(memory.files.get(failPath), "needle\n")
  assert.equal(summary.failures[0].resource, failPath)
  assert.deepEqual(summary.failures[0].range, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 })
  assert.equal(summary.failures[0].match, "needle")
  assert.equal(summary.failures[0].operation, "save")
  assert.equal(summary.failures[0].reason, "fs-error")
  assert.equal(summary.failures[0].rollbackRisk, "partial-write")
  assert.equal(summary.rollbackRisk, "partial-write")
  assert.match(summary.rollbackDescription, /Partial WorkspaceEdit write/)
})

test("register keeps the extension-host boolean contract and reports summary evidence", async () => {
  const okPath = path.join("D:", "Codek", "ok.txt")
  const failPath = path.join("D:", "Codek", "fail.txt")
  const memory = createMemoryFileSystem({
    [okPath]: "needle\n",
    [failPath]: "needle\n",
  })
  const summaries = []
  const server = createServer()

  mainThreadBulkEdits.register(server, {
    fsAccess: memory.fsAccess,
    onWorkspaceEditSummary: (summary) => summaries.push(summary),
  })

  const applied = await server.call("$tryApplyWorkspaceEdit", [{
    edits: [
      { resource: fileUri(okPath), textEdits: [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 }, text: "haystack" }] },
      { resource: fileUri(failPath), textEdits: [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 }, text: "haystack" }] },
    ],
  }])

  assert.equal(applied, false)
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0].failureCount, 1)
  assert.equal(summaries[0].failures[0].rollbackRisk, "partial-write")
})

test("applyTextEdits uses VS Code 1-based exclusive end columns without dropping trailing text", () => {
  const next = mainThreadBulkEdits.applyTextEdits("alpha needle tail\n", [
    { range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 13 }, text: "haystack" },
  ])

  assert.equal(next, "alpha haystack tail\n")
})
