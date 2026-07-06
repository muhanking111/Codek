const assert = require("assert")
const test = require("node:test")
const {
  groupWorkspaceFoldersByScheme,
  getSearchSchemesInQuery,
  normalizeWorkspaceSearchFolders,
  runWorkspaceSearch,
} = require("./searchServiceAdapter")

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test("normalizeWorkspaceSearchFolders accepts VS Code-style folder queries and groups by scheme", () => {
  const folders = normalizeWorkspaceSearchFolders({
    folderQueries: [
      { folder: { scheme: "file", fsPath: "D:/apps/client" }, rootLabel: "client (apps)", folderIndex: 0 },
      { root: "D:/libs/client", rootLabel: "client (libs)", folderIndex: 1 },
      { folder: { scheme: "custom", path: "/virtual/project" }, rootLabel: "virtual", folderIndex: 2 },
    ],
  })
  const grouped = groupWorkspaceFoldersByScheme(folders)

  assert.equal(folders.length, 3)
  assert.equal(folders[0].rootLabel, "client (apps)")
  assert.equal(folders[2].scheme, "custom")
  assert.equal(grouped.get("file").length, 2)
  assert.equal(grouped.get("custom").length, 1)
})

test("getSearchSchemesInQuery mirrors VS Code folderQueries and extraFileResources scheme collection", () => {
  const schemes = getSearchSchemesInQuery({
    folderQueries: [
      { folder: { scheme: "file", fsPath: "D:/workspace/a" } },
      { folder: { scheme: "codek", path: "/virtual/project" } },
    ],
    extraFileResources: [
      { scheme: "git", path: "/index" },
      { scheme: "file", fsPath: "D:/workspace/b" },
    ],
  })

  assert.deepEqual(schemes, ["file", "codek", "git"])
})

test("runWorkspaceSearch starts folder searches concurrently like VS Code searchWithProviders", async () => {
  let active = 0
  let maxActive = 0
  const started = []

  const result = await runWorkspaceSearch({
    roots: ["D:/workspace/a", "D:/workspace/b"],
    maxResults: 10,
    runFolderSearch: async (folder) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      started.push(folder.rootLabel)
      await delay(folder.rootLabel === "a" ? 30 : 5)
      active -= 1
      return {
        engine: "test-provider",
        matches: [{ path: `${folder.rootLabel}.ts`, line: 1 }],
        visitedFiles: 1,
      }
    },
  })

  assert.equal(maxActive, 2)
  assert.deepEqual(started.sort(), ["a", "b"])
  assert.deepEqual(result.matches.map((match) => match.path), ["a.ts", "b.ts"])
  assert.equal(result.engine, "test-provider")
})

test("runWorkspaceSearch applies a global result limit in folder order and filters cached contents", async () => {
  const result = await runWorkspaceSearch({
    folderQueries: [
      { root: "D:/workspace/a", rootLabel: "a", folderIndex: 0 },
      { root: "D:/workspace/b", rootLabel: "b", folderIndex: 1 },
    ],
    maxResults: 2,
    runFolderSearch: async (folder) => ({
      engine: "test-provider",
      matches: [
        { path: `${folder.rootLabel}-one.ts`, line: 1 },
        { path: `${folder.rootLabel}-two.ts`, line: 2 },
      ],
      fileContents: {
        [`${folder.rootLabel}-one.ts`]: "one",
        [`${folder.rootLabel}-two.ts`]: "two",
      },
      visitedFiles: 2,
    }),
  })

  assert.equal(result.truncated, true)
  assert.deepEqual(result.matches.map((match) => match.path), ["a-one.ts", "a-two.ts"])
  assert.deepEqual(Object.keys(result.fileContentsByRoot), [result.matches[0].root])
  assert.equal(result.fileContentsByRoot[result.matches[0].root]["a-one.ts"], "one")
})

test("runWorkspaceSearch decorates provider progress with folder metadata", async () => {
  const progress = []
  await runWorkspaceSearch({
    roots: ["D:/workspace/a"],
    maxResults: 10,
    onProgress: (item) => progress.push(item),
    runFolderSearch: async (_folder, options) => {
      options.onProgress({ stage: "search:provider", detail: { engine: "test-provider" } })
      return { matches: [], engine: "test-provider" }
    },
  })

  const providerEvent = progress.find((item) => item.stage === "search:provider")
  assert.equal(providerEvent.detail.rootLabel, "a")
  assert.equal(providerEvent.detail.scheme, "file")
  assert.ok(progress.some((item) => item.stage === "search:workspace:start"))
  assert.ok(progress.some((item) => item.stage === "search:workspace:done"))
})

test("runWorkspaceSearch forwards the shared cancellation signal into folder provider options", async () => {
  const controller = new AbortController()
  const seenSignals = []

  await runWorkspaceSearch({
    roots: ["D:/workspace/a"],
    maxResults: 10,
    signal: controller.signal,
    runFolderSearch: async (_folder, options) => {
      seenSignals.push(options.signal)
      return { matches: [], truncated: false }
    },
  })

  assert.equal(seenSignals[0], controller.signal)
})

test("runWorkspaceSearch preserves missing provider failures as partial workspace results", async () => {
  const result = await runWorkspaceSearch({
    folderQueries: [
      { root: "D:/workspace/file-root", rootLabel: "file-root", folderIndex: 0 },
      { root: "/virtual/project", folder: { scheme: "codek", path: "/virtual/project" }, rootLabel: "virtual-root", folderIndex: 1 },
    ],
    maxResults: 10,
    runFolderSearch: async (folder) => {
      if (folder.scheme === "codek") {
        return {
          matches: [],
          truncated: false,
          providerFailures: [{
            scheme: "codek",
            providerType: "text",
            code: 10,
            reason: "missing-provider",
            message: "No text search provider registered for scheme codek",
            activationEvent: "onSearch:codek",
          }],
        }
      }
      return {
        engine: "test-provider",
        matches: [{ path: "src/app.ts", line: 1 }],
        visitedFiles: 1,
      }
    },
  })

  assert.equal(result.success, false)
  assert.equal(result.partial, true)
  assert.match(result.error, /text:codek/)
  assert.deepEqual(result.matches.map((match) => match.rootLabel), ["file-root"])
  assert.deepEqual(result.providerFailures, [{
    scheme: "codek",
    providerType: "text",
    code: 10,
    reason: "missing-provider",
    message: "No text search provider registered for scheme codek",
    activationEvent: "onSearch:codek",
  }])
})
