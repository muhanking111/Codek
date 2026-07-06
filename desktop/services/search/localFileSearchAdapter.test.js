const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const test = require("node:test")
const { createSearchQueryPlan } = require("./searchQueryAdapter")
const {
  collectMatchedFileContents,
  countSkippedLargeFiles,
  isLikelyBinary,
  runLocalFileSearch,
} = require("./localFileSearchAdapter")

async function makeFixture() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codek-local-search-"))
  await fs.promises.mkdir(path.join(root, "src"), { recursive: true })
  await fs.promises.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true })
  await fs.promises.writeFile(path.join(root, "src", "app.ts"), "export const needle = 'app'\n", "utf8")
  await fs.promises.writeFile(path.join(root, "src", "skip.test.ts"), "needle in test\n", "utf8")
  await fs.promises.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "needle ignored\n", "utf8")
  await fs.promises.writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2, 0, 4]))
  return root
}

test("runLocalFileSearch scans text files through the VS Code local worker adapter boundary", async () => {
  const root = await makeFixture()
  const queryPlan = createSearchQueryPlan({
    query: "needle",
    include: ["src/**/*.ts"],
    exclude: ["**/*.test.ts"],
    maxResults: 10,
  })

  const result = await runLocalFileSearch({
    root,
    queryPlan,
    textPattern: queryPlan.textPattern,
  })

  assert.equal(result.engine, "local-file-search")
  assert.equal(result.truncated, false)
  assert.deepEqual(result.matches.map((match) => match.path), ["src/app.ts"])
  assert.equal(result.matches[0].line, 1)
  assert.equal(result.matches[0].column, 14)
  assert.ok(result.matches.every((match) => !match.path.includes("node_modules")))
})

test("runLocalFileSearch streams long lines without losing column offsets", async () => {
  const root = await makeFixture()
  const prefix = "x".repeat((2 * 1024 * 1024) + 12)
  await fs.promises.writeFile(path.join(root, "one-line-large.json"), `${prefix}stream-token`, "utf8")
  const queryPlan = createSearchQueryPlan({
    query: "stream-token",
    include: ["*.json"],
    maxResults: 10,
  })

  const result = await runLocalFileSearch({
    root,
    queryPlan,
    textPattern: queryPlan.textPattern,
  })

  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].path, "one-line-large.json")
  assert.equal(result.matches[0].line, 1)
  assert.equal(result.matches[0].column, prefix.length + 1)
})

test("runLocalFileSearch discover mode filters filePattern before limiting", async () => {
  const root = await makeFixture()
  await fs.promises.writeFile(path.join(root, "a-first.txt"), "first\n", "utf8")
  await fs.promises.writeFile(path.join(root, "src", "special-target.ts"), "target\n", "utf8")
  const queryPlan = createSearchQueryPlan({
    query: "specialtarget",
    maxResults: 1,
    compileTextPattern: false,
  })

  const result = await runLocalFileSearch({
    root,
    queryPlan,
    discoverFiles: true,
    filePattern: "specialtarget",
  })

  assert.deepEqual(result.matches.map((match) => match.path), ["src/special-target.ts"])
  assert.equal(result.truncated, false)
})

test("runLocalFileSearch can collect bounded small file contents", async () => {
  const root = await makeFixture()
  await fs.promises.writeFile(path.join(root, "src", "cached.ts"), "first\nneedle\n", "utf8")
  await fs.promises.writeFile(path.join(root, "artifact.pak"), "needle in binary-named payload\n", "utf8")
  const queryPlan = createSearchQueryPlan({
    query: "needle",
    include: ["src/cached.ts", "artifact.pak"],
    maxResults: 10,
  })

  const result = await runLocalFileSearch({
    root,
    queryPlan,
    textPattern: queryPlan.textPattern,
    includeContentForSmallFiles: true,
    contentMaxFileBytes: 128,
    contentMaxTotalBytes: 128,
  })

  assert.equal(result.fileContents["src/cached.ts"], "first\nneedle\n")
  assert.equal(result.fileContents["artifact.pak"], undefined)
  assert.ok(result.fileContentBytes <= 128)
})

test("runLocalFileSearch skips truly huge files unless explicit large-file search is enabled", async () => {
  const root = await makeFixture()
  const hugePath = path.join(root, "logs-huge.txt")
  await fs.promises.writeFile(hugePath, `${"x".repeat((2 * 1024 * 1024) + 1024)}\nhuge-token\n`, "utf8")
  const queryPlan = createSearchQueryPlan({
    query: "huge-token",
    include: ["*.txt"],
    maxResults: 10,
  })

  const skipped = await runLocalFileSearch({
    root,
    queryPlan,
    textPattern: queryPlan.textPattern,
    searchMaxFileBytes: 2 * 1024 * 1024,
  })
  assert.equal(skipped.skippedLargeFiles, 1)
  assert.equal(skipped.matches.length, 0)

  const streamed = await runLocalFileSearch({
    root,
    queryPlan,
    textPattern: queryPlan.textPattern,
    searchLargeFiles: true,
    searchMaxFileBytes: 2 * 1024 * 1024,
  })
  assert.equal(streamed.skippedLargeFiles, 0)
  assert.equal(streamed.matches.length, 1)
})

test("collectMatchedFileContents and countSkippedLargeFiles share the local search safety model", async () => {
  const root = await makeFixture()
  await fs.promises.writeFile(path.join(root, "src", "cached.ts"), "needle cached\n", "utf8")
  const hugePath = path.join(root, "huge.txt")
  const handle = await fs.promises.open(hugePath, "w")
  try {
    await handle.truncate((65 * 1024 * 1024) + 1)
  } finally {
    await handle.close()
  }
  const queryPlan = createSearchQueryPlan({ query: "needle", include: ["src/*.ts", "*.txt"] })

  const contents = await collectMatchedFileContents({
    root,
    matches: [{ path: "src/cached.ts" }, { path: "../outside.txt" }, { path: "binary.bin" }],
    contentMaxFileBytes: 128,
    contentMaxTotalBytes: 128,
  })
  assert.equal(contents.fileContents["src/cached.ts"], "needle cached\n")
  assert.equal(contents.fileContents["binary.bin"], undefined)

  const skippedLargeFiles = await countSkippedLargeFiles(root, queryPlan, 64 * 1024 * 1024)
  assert.equal(skippedLargeFiles, 1)
})

test("runLocalFileSearch rejects immediately when cancelled", async () => {
  const root = await makeFixture()
  const queryPlan = createSearchQueryPlan({ query: "needle" })
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    runLocalFileSearch({
      root,
      queryPlan,
      textPattern: queryPlan.textPattern,
      signal: controller.signal,
    }),
    /Search cancelled/,
  )
})

test("isLikelyBinary detects null bytes in file heads", () => {
  assert.equal(isLikelyBinary(Buffer.from("plain text")), false)
  assert.equal(isLikelyBinary(Buffer.from([65, 0, 66])), true)
})
