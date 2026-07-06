const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const test = require("node:test")
const {
  disposeSearchServices,
  normalizeWorkspaceSearchFolders,
  searchInWorkspace,
  searchWorkspace,
} = require("./index")

async function makeFixture() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codek-search-"))
  await fs.promises.mkdir(path.join(root, "src"), { recursive: true })
  await fs.promises.mkdir(path.join(root, "docs"), { recursive: true })
  await fs.promises.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true })
  await fs.promises.mkdir(path.join(root, ".codek", "logs"), { recursive: true })
  await fs.promises.mkdir(path.join(root, "frontend-dist", "assets"), { recursive: true })
  await fs.promises.mkdir(path.join(root, "release", "win-unpacked"), { recursive: true })

  await fs.promises.writeFile(path.join(root, "src", "app.ts"), "export const needle = 'app'\n", "utf8")
  await fs.promises.writeFile(path.join(root, "src", "skip.test.ts"), "needle in test\n", "utf8")
  await fs.promises.writeFile(path.join(root, "docs", "guide.md"), "Needle in docs\n", "utf8")
  await fs.promises.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "needle ignored\n", "utf8")
  await fs.promises.writeFile(path.join(root, ".codek", "logs", "state.log"), "needle ignored\n", "utf8")
  await fs.promises.writeFile(path.join(root, "frontend-dist", "assets", "bundle.js"), "needle ignored\n", "utf8")
  await fs.promises.writeFile(path.join(root, "release", "win-unpacked", "app.js"), "needle ignored\n", "utf8")
  await fs.promises.writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2, 0, 4]))
  await fs.promises.writeFile(path.join(root, "huge.txt"), "needle".repeat(500000), "utf8")

  return root
}

test("searchInWorkspace searches text files and skips ignored or unsafe files", async () => {
  const root = await makeFixture()

  const result = await searchInWorkspace({ root, query: "needle", maxResults: 20, include: ["src/**/*.ts", "docs/**/*.md"] })

  assert.equal(result.error, undefined)
  assert.equal(result.truncated, false)
  assert.deepEqual(
    result.matches.map((match) => match.path).sort(),
    ["docs/guide.md", "src/app.ts", "src/skip.test.ts"],
  )
  assert.ok(result.matches.every((match) => !match.path.includes("node_modules")))
  assert.ok(result.matches.every((match) => !match.path.includes(".codek")))
  assert.ok(result.matches.every((match) => !match.path.includes("frontend-dist")))
  assert.ok(result.matches.every((match) => !match.path.includes("release")))
  assert.ok(result.matches.every((match) => !match.path.includes("binary.bin")))
})

test("searchInWorkspace streams large text files instead of skipping them", async () => {
  const root = await makeFixture()
  const largePath = path.join(root, "logs-large.jsonl")
  await fs.promises.writeFile(largePath, [
    "x".repeat(2 * 1024 * 1024),
    "\n",
    "{\"kind\":\"large-json\",\"marker\":\"stream-large-token\"}\n",
    "x".repeat(1024),
  ].join(""), "utf8")

  const result = await searchInWorkspace({
    root,
    query: "stream-large-token",
    include: ["*.jsonl"],
    maxResults: 10,
  })

  assert.equal(result.error, undefined)
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].path, "logs-large.jsonl")
  assert.equal(result.matches[0].line, 2)
  assert.equal(result.matches[0].column, 32)
  assert.match(result.matches[0].preview, /stream-large-token/)
})

test("searchInWorkspace streams enterprise-sized large files by default", async () => {
  const root = await makeFixture()
  const largePath = path.join(root, "logs-large-default.txt")
  await fs.promises.writeFile(largePath, [
    "x".repeat(9 * 1024 * 1024),
    "\n",
    "default-large-search-token\n",
  ].join(""), "utf8")

  const result = await searchInWorkspace({
    root,
    query: "default-large-search-token",
    include: ["*.txt"],
    maxResults: 10,
  })

  assert.equal(result.error, undefined)
  assert.equal(result.skippedLargeFiles, 0)
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].path, "logs-large-default.txt")
})

test("searchInWorkspace skips truly huge files by default so find-in-files stays responsive", async () => {
  const root = await makeFixture()
  const hugePath = path.join(root, "logs-huge.txt")
  const smallPath = path.join(root, "src", "target.ts")
  await fs.promises.writeFile(smallPath, "export const target = 'responsive-token'\n", "utf8")
  const handle = await fs.promises.open(hugePath, "w")
  try {
    const prefix = Buffer.from("responsive-token should be skipped in huge file\n")
    await handle.write(prefix, 0, prefix.length, 0)
    await handle.truncate((65 * 1024 * 1024) + 1)
  } finally {
    await handle.close()
  }

  const result = await searchInWorkspace({
    root,
    query: "responsive-token",
    include: ["*.txt", "src/*.ts"],
    maxResults: 10,
  })

  assert.equal(result.error, undefined)
  assert.equal(result.skippedLargeFiles, 1)
  assert.deepEqual(result.matches.map((match) => match.path), ["src/target.ts"])
})

test("searchInWorkspace can explicitly stream huge files when requested", async () => {
  const root = await makeFixture()
  const hugePath = path.join(root, "logs-huge-explicit.txt")
  await fs.promises.writeFile(hugePath, [
    "x".repeat(65 * 1024 * 1024),
    "\n",
    "explicit-huge-search-token\n",
  ].join(""), "utf8")

  const result = await searchInWorkspace({
    root,
    query: "explicit-huge-search-token",
    include: ["*.txt"],
    maxResults: 10,
    searchLargeFiles: true,
  })

  assert.equal(result.error, undefined)
  assert.equal(result.skippedLargeFiles, 0)
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].path, "logs-huge-explicit.txt")
})

test("searchInWorkspace can include bounded small-file contents for direct navigation", async () => {
  const root = await makeFixture()
  await fs.promises.writeFile(path.join(root, "src", "cached.ts"), "first line\nexport const value = 'needle'\n", "utf8")
  await fs.promises.writeFile(path.join(root, "src", "too-large.ts"), `needle\n${"x".repeat(200)}`, "utf8")

  const withoutContent = await searchInWorkspace({
    root,
    query: "needle",
    include: ["src/cached.ts"],
    maxResults: 10,
  })
  assert.equal(withoutContent.fileContents, undefined)

  const withContent = await searchInWorkspace({
    root,
    query: "needle",
    include: ["src/*.ts"],
    maxResults: 10,
    includeContentForSmallFiles: true,
    contentMaxFileBytes: 128,
    contentMaxTotalBytes: 128,
  })

  assert.equal(withContent.fileContents["src/cached.ts"], "first line\nexport const value = 'needle'\n")
  assert.equal(withContent.fileContents["src/too-large.ts"], undefined)
  assert.ok(withContent.fileContentBytes <= 128)
  assert.equal(withContent.engine, "ripgrep")
})

test("searchInWorkspace emits VS Code-style progress items from the real provider path", async () => {
  const root = await makeFixture()
  await fs.promises.writeFile(path.join(root, "src", "progress.ts"), "export const value = 'progress-token'\n", "utf8")
  const progress = []

  const result = await searchInWorkspace({
    root,
    query: "progress-token",
    include: ["src/*.ts"],
    maxResults: 10,
    includeContentForSmallFiles: true,
    onProgress: (event) => progress.push(event),
  })

  assert.equal(result.error, undefined)
  assert.equal(result.engine, "ripgrep")
  assert.deepEqual(
    progress.map((event) => event.stage),
    ["search:start", "search:provider", "search:skipped-large-files", "search:contents", "search:done"],
  )
  assert.equal(progress[1].message, "Searching with ripgrep")
  assert.equal(progress.at(-1).detail.matchCount, 1)
})

test("searchInWorkspace never returns binary editor extensions as cached file contents", async () => {
  const root = await makeFixture()
  await fs.promises.writeFile(path.join(root, "artifact.pak"), "needle in binary-named payload\n", "utf8")

  const result = await searchInWorkspace({
    root,
    query: "needle",
    include: ["artifact.pak"],
    maxResults: 10,
    includeContentForSmallFiles: true,
    contentMaxFileBytes: 128,
    contentMaxTotalBytes: 128,
  })

  assert.equal(result.fileContents["artifact.pak"], undefined)
})

test("searchInWorkspace streams very long lines with accurate columns", async () => {
  const root = await makeFixture()
  const largePath = path.join(root, "one-line-large.json")
  const prefix = "x".repeat((2 * 1024 * 1024) + 12)
  await fs.promises.writeFile(largePath, `${prefix}stream-long-line-token`, "utf8")

  const result = await searchInWorkspace({
    root,
    query: "stream-long-line-token",
    include: ["*.json"],
    maxResults: 10,
  })

  assert.equal(result.error, undefined)
  assert.equal(result.matches.length, 1)
  assert.equal(result.matches[0].path, "one-line-large.json")
  assert.equal(result.matches[0].line, 1)
  assert.equal(result.matches[0].column, prefix.length + 1)
})

test("searchInWorkspace can discover bounded file paths without scanning file contents", async () => {
  const root = await makeFixture()

  const result = await searchInWorkspace({
    root,
    discoverFiles: true,
    maxResults: 2,
  })

  assert.equal(result.error, undefined)
  assert.equal(result.matches.length, 2)
  assert.equal(result.truncated, true)
  assert.ok(result.visitedFiles <= 2)
  assert.ok(result.matches.every((match) => !match.path.includes("node_modules")))
})

test("searchInWorkspace sends discoverFiles query as VS Code filePattern before limiting", async () => {
  const root = await makeFixture()
  let providerRequest = null
  const result = await searchInWorkspace({
    root,
    query: "specialtarget",
    discoverFiles: true,
    maxResults: 1,
    providerRegistry: {
      schemeHasProvider: () => true,
      runSearch: async (_type, _scheme, request) => {
        providerRequest = request
        return {
          engine: "custom-files",
          matches: [
            { path: "a-first.txt" },
            { path: "src/special-target.ts" },
            { path: "z-last.txt" },
          ],
          visitedFiles: 3,
        }
      },
    },
  })

  assert.equal(providerRequest.filePattern, "specialtarget")
  assert.equal(providerRequest.sortByScore, true)
  assert.deepEqual(result.matches.map((match) => match.path), ["src/special-target.ts"])
  assert.equal(result.truncated, false)
})

test("searchInWorkspace includes visited-file budget in VS Code file search cacheKey", async () => {
  const root = await makeFixture()
  const cacheKeys = []
  const providerRegistry = {
    schemeHasProvider: () => true,
    runSearch: async (_type, _scheme, request) => {
      cacheKeys.push(request.cacheKey)
      return {
        engine: "custom-files",
        matches: [{ path: `${request.filePattern}.ts` }],
        visitedFiles: 1,
      }
    },
  }

  await searchInWorkspace({
    root,
    query: "alpha",
    discoverFiles: true,
    maxResults: 10,
    maxVisitedFiles: 2,
    providerRegistry,
  })
  await searchInWorkspace({
    root,
    query: "alpha",
    discoverFiles: true,
    maxResults: 10,
    maxVisitedFiles: 20,
    providerRegistry,
  })

  assert.equal(cacheKeys.length, 2)
  assert.notEqual(cacheKeys[0], cacheKeys[1])
})

test("searchInWorkspace activates onSearch providers before looking up provider registry", async () => {
  const root = await makeFixture()
  const events = []
  const providerRegistry = {
    schemeHasProvider: () => {
      events.push("provider-lookup")
      return true
    },
    runSearch: async () => {
      events.push("provider-search")
      return {
        engine: "extension-search",
        matches: [{ path: "src/app.ts", line: 1, column: 14, preview: "export const needle = 'app'" }],
        visitedFiles: 1,
      }
    },
  }

  const result = await searchInWorkspace({
    root,
    query: "needle",
    providerRegistry,
    activateSearchProviders: async ({ schemes }) => {
      events.push(`activate:${schemes.join(",")}`)
    },
  })

  assert.equal(result.engine, "extension-search")
  assert.deepEqual(events, ["activate:file", "provider-lookup", "provider-search"])
})

test("searchInWorkspace reports missing non-file providers from VS Code-style folder queries", async () => {
  const root = await makeFixture()
  const events = []

  const result = await searchInWorkspace({
    root,
    query: "needle",
    folderQueries: [{ folder: { scheme: "codek", fsPath: root } }],
    providerRegistry: {
      schemeHasProvider: () => {
        events.push("provider-lookup")
        return false
      },
      runSearch: async () => {
        throw new Error("provider search should not run")
      },
    },
    activateSearchProviders: async ({ schemes }) => {
      events.push(`activate:${schemes.join(",")}`)
    },
  })

  assert.equal(result.success, false)
  assert.equal(result.partial, false)
  assert.match(result.error, /text:codek/)
  assert.equal(result.matches.length, 0)
  assert.deepEqual(result.providerFailures, [{
    scheme: "codek",
    providerType: "text",
    code: 10,
    reason: "missing-provider",
    message: "No text search provider registered for scheme codek",
    activationEvent: "onSearch:codek",
  }])
  assert.deepEqual(events, ["activate:codek", "provider-lookup"])
})

test("searchInWorkspace uses registered non-file providers without local fallback", async () => {
  const root = await makeFixture()
  const events = []

  const result = await searchInWorkspace({
    root,
    query: "needle",
    folderQueries: [{ folder: { scheme: "codek", fsPath: root } }],
    providerRegistry: {
      schemeHasProvider: (type, scheme) => {
        events.push(`provider-lookup:${type}:${scheme}`)
        return type === "text" && scheme === "codek"
      },
      runSearch: async (type, scheme, request) => {
        events.push(`provider-search:${type}:${scheme}`)
        assert.equal(request.folderQueries[0].folder.scheme, "codek")
        return {
          engine: "extension-search",
          matches: [{ path: "virtual/result.ts", line: 2, column: 3, preview: "needle" }],
          visitedFiles: 1,
        }
      },
    },
    activateSearchProviders: async ({ schemes }) => {
      events.push(`activate:${schemes.join(",")}`)
    },
  })

  assert.equal(result.error, undefined)
  assert.equal(result.engine, "extension-search")
  assert.deepEqual(result.matches.map((match) => match.path), ["virtual/result.ts"])
  assert.deepEqual(events, ["activate:codek", "provider-lookup:text:codek", "provider-search:text:codek"])
})

test("searchInWorkspace reports missing non-file file-search providers", async () => {
  const root = await makeFixture()

  const result = await searchInWorkspace({
    root,
    query: "virtual",
    discoverFiles: true,
    folderQueries: [{ folder: { scheme: "codek", fsPath: root } }],
    providerRegistry: {
      schemeHasProvider: () => false,
      runSearch: async () => {
        throw new Error("provider search should not run")
      },
    },
  })

  assert.equal(result.success, false)
  assert.equal(result.partial, false)
  assert.match(result.error, /file:codek/)
  assert.deepEqual(result.providerFailures, [{
    scheme: "codek",
    providerType: "file",
    code: 10,
    reason: "missing-provider",
    message: "No file search provider registered for scheme codek",
    activationEvent: "onSearch:codek",
  }])
})

test("searchInWorkspace rejects when cancelled while activating search providers", async () => {
  const root = await makeFixture()
  const controller = new AbortController()
  let providerLookupCount = 0

  await assert.rejects(
    searchInWorkspace({
      root,
      query: "needle",
      signal: controller.signal,
      providerRegistry: {
        schemeHasProvider: () => {
          providerLookupCount += 1
          return true
        },
        runSearch: async () => ({ matches: [] }),
      },
      activateSearchProviders: async () => {
        controller.abort()
      },
    }),
    { name: "AbortError" },
  )

  assert.equal(providerLookupCount, 0)
})

test("searchWorkspace activates all query schemes once before folder provider lookup", async () => {
  const firstRoot = await makeFixture()
  const secondRoot = await makeFixture()
  const events = []

  const result = await searchWorkspace({
    folderQueries: [
      { root: firstRoot, folder: { scheme: "file", fsPath: firstRoot }, rootLabel: "file-root", folderIndex: 0 },
      { root: secondRoot, folder: { scheme: "codek", fsPath: secondRoot }, rootLabel: "virtual-root", folderIndex: 1 },
    ],
    query: "needle",
    maxResults: 20,
    allowedRoots: [firstRoot, secondRoot],
    providerRegistry: {
      schemeHasProvider: () => {
        events.push("provider-lookup")
        return false
      },
      runSearch: async () => {
        throw new Error("provider search should not run")
      },
    },
    activateSearchProviders: async ({ schemes }) => {
      events.push(`activate:${schemes.join(",")}`)
    },
  })

  assert.equal(result.success, false)
  assert.equal(result.partial, true)
  assert.match(result.error, /text:codek/)
  assert.equal(result.folderCount, 2)
  assert.ok(result.matches.length > 0)
  assert.ok(result.matches.every((match) => match.rootLabel === "file-root"))
  assert.deepEqual(result.providerFailures, [{
    scheme: "codek",
    providerType: "text",
    code: 10,
    reason: "missing-provider",
    message: "No text search provider registered for scheme codek",
    activationEvent: "onSearch:codek",
  }])
  assert.deepEqual(events, ["activate:file,codek", "provider-lookup", "provider-lookup"])
})

test("searchInWorkspace discoverFiles fallback also filters filePattern before limiting", async () => {
  const root = await makeFixture()
  await fs.promises.writeFile(path.join(root, "a-first.txt"), "first\n", "utf8")
  await fs.promises.writeFile(path.join(root, "src", "special-target.ts"), "target\n", "utf8")

  const result = await searchInWorkspace({
    root,
    query: "specialtarget",
    discoverFiles: true,
    maxResults: 1,
    providerRegistry: {
      schemeHasProvider: () => false,
      runSearch: async () => null,
    },
  })

  assert.deepEqual(result.matches.map((match) => match.path), ["src/special-target.ts"])
  assert.equal(result.truncated, false)
})

test("searchInWorkspace stops at workspace-scale visited-file budgets", async () => {
  const root = await makeFixture()
  for (let index = 0; index < 20; index += 1) {
    await fs.promises.writeFile(path.join(root, "src", `budget-${index}.ts`), `needle ${index}\n`, "utf8")
  }

  const result = await searchInWorkspace({
    root,
    query: "needle",
    maxResults: 100,
    workspaceScaleProfile: {
      scale: "huge",
      budgets: {
        searchMaxVisitedFiles: 3,
        searchMaxResults: 100,
      },
    },
  })

  assert.equal(result.truncated, true)
  assert.ok(result.visitedFiles <= 3)
})

test("searchInWorkspace applies include and exclude patterns", async () => {
  const root = await makeFixture()

  const result = await searchInWorkspace({
    root,
    query: "needle",
    include: ["src/**/*.ts"],
    exclude: ["**/*.test.ts"],
    maxResults: 20,
  })

  assert.equal(result.error, undefined)
  assert.deepEqual(result.matches.map((match) => match.path), ["src/app.ts"])
})

test("searchInWorkspace applies VS Code-style expanded include directories and brace patterns", async () => {
  const root = await makeFixture()
  await fs.promises.writeFile(path.join(root, "src", "component.tsx"), "needle in tsx\n", "utf8")
  await fs.promises.writeFile(path.join(root, "docs", "component.tsx"), "needle outside include\n", "utf8")

  const directoryInclude = await searchInWorkspace({
    root,
    query: "needle",
    include: ["src"],
    exclude: ["**/*.test.ts"],
    maxResults: 20,
  })
  assert.equal(directoryInclude.error, undefined)
  assert.deepEqual(
    directoryInclude.matches.map((match) => match.path).sort(),
    ["src/app.ts", "src/component.tsx"],
  )

  const braceInclude = await searchInWorkspace({
    root,
    query: "needle",
    include: ["src/**/*.{ts,tsx}"],
    exclude: ["**/*.test.ts"],
    maxResults: 20,
  })
  assert.equal(braceInclude.error, undefined)
  assert.deepEqual(
    braceInclude.matches.map((match) => match.path).sort(),
    ["src/app.ts", "src/component.tsx"],
  )
})

test("searchInWorkspace treats wildcard include as all workspace files", async () => {
  const root = await makeFixture()

  const result = await searchInWorkspace({
    root,
    query: "needle",
    include: ["*"],
    exclude: ["huge.txt"],
    maxResults: 20,
  })

  assert.equal(result.error, undefined)
  assert.deepEqual(
    result.matches.map((match) => match.path).sort(),
    ["docs/guide.md", "src/app.ts", "src/skip.test.ts"],
  )
})

test("searchInWorkspace reports invalid regex and invalid roots without throwing", async () => {
  const root = await makeFixture()

  const invalidRegex = await searchInWorkspace({ root, query: "(", regex: true })
  assert.equal(invalidRegex.matches.length, 0)
  assert.match(invalidRegex.error, /Invalid pattern/)

  const invalidRoot = await searchInWorkspace({ root: path.join(root, "missing"), query: "needle" })
  assert.equal(invalidRoot.matches.length, 0)
  assert.equal(invalidRoot.error, "Invalid workspace root")
})

test("searchInWorkspace caps result count and marks truncation", async () => {
  const root = await makeFixture()

  const result = await searchInWorkspace({ root, query: "needle", maxResults: 1 })

  assert.equal(result.matches.length, 1)
  assert.equal(result.truncated, true)
})

test("searchInWorkspace rejects roots outside the open workspace allowlist", async () => {
  const root = await makeFixture()
  const otherRoot = await makeFixture()

  const result = await searchInWorkspace({
    root: otherRoot,
    query: "needle",
    allowedRoots: [root],
  })

  assert.equal(result.matches.length, 0)
  assert.equal(result.error, "Workspace root is not open")
})

test("searchInWorkspace rejects immediately when cancelled", async () => {
  const root = await makeFixture()
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    searchInWorkspace({
      root,
      query: "needle",
      signal: controller.signal,
    }),
    /Search cancelled/,
  )
})

test("normalizeWorkspaceSearchFolders accepts VS Code-style folderQueries", () => {
  const folders = normalizeWorkspaceSearchFolders({
    folderQueries: [
      { folder: { fsPath: "D:/apps/client" }, rootLabel: "client (apps)", folderIndex: 0 },
      { root: "D:/libs/client", rootLabel: "client (libs)", folderIndex: 1 },
    ],
  })

  assert.equal(folders.length, 2)
  assert.equal(folders[0].rootLabel, "client (apps)")
  assert.equal(folders[1].rootLabel, "client (libs)")
})

test("searchWorkspace aggregates multi-root matches with root metadata and bounded contents", async () => {
  const firstRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codek-search-root-a-"))
  const secondRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codek-search-root-b-"))
  await fs.promises.mkdir(path.join(firstRoot, "src"), { recursive: true })
  await fs.promises.mkdir(path.join(secondRoot, "src"), { recursive: true })
  await fs.promises.writeFile(path.join(firstRoot, "src", "app.ts"), "needle in first root\n", "utf8")
  await fs.promises.writeFile(path.join(secondRoot, "src", "util.ts"), "needle in second root\n", "utf8")

  const progress = []
  const result = await searchWorkspace({
    folderQueries: [
      { root: firstRoot, rootLabel: "root-a", folderIndex: 0 },
      { root: secondRoot, rootLabel: "root-b", folderIndex: 1 },
    ],
    query: "needle",
    maxResults: 10,
    includeContentForSmallFiles: true,
    allowedRoots: [firstRoot, secondRoot],
    onProgress: (item) => progress.push(item),
  })

  assert.equal(result.error, undefined)
  assert.equal(result.folderCount, 2)
  assert.equal(result.matches.length, 2)
  assert.deepEqual(
    result.matches.map((match) => ({ path: match.path, rootLabel: match.rootLabel })).sort((left, right) => left.path.localeCompare(right.path)),
    [
      { path: "src/app.ts", rootLabel: "root-a" },
      { path: "src/util.ts", rootLabel: "root-b" },
    ],
  )
  assert.equal(result.fileContentsByRoot[firstRoot]["src/app.ts"], "needle in first root\n")
  assert.equal(result.fileContentsByRoot[secondRoot]["src/util.ts"], "needle in second root\n")
  assert.ok(progress.some((item) => item.stage === "search:workspace:start"))
  assert.ok(progress.some((item) => item.stage === "search:workspace:folder" && item.detail.rootLabel === "root-b"))
  assert.ok(progress.some((item) => item.stage === "search:workspace:done"))
})

test("searchWorkspace applies maxResults across roots and reports truncation", async () => {
  const firstRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codek-search-limit-a-"))
  const secondRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codek-search-limit-b-"))
  await fs.promises.writeFile(path.join(firstRoot, "first.txt"), "needle one\n", "utf8")
  await fs.promises.writeFile(path.join(secondRoot, "second.txt"), "needle two\n", "utf8")

  const result = await searchWorkspace({
    roots: [firstRoot, secondRoot],
    query: "needle",
    maxResults: 1,
    allowedRoots: [firstRoot, secondRoot],
  })

  assert.equal(result.matches.length, 1)
  assert.equal(result.truncated, true)
})

test("searchWorkspace rejects immediately when cancelled", async () => {
  const root = await makeFixture()
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    searchWorkspace({
      roots: [root],
      query: "needle",
      signal: controller.signal,
    }),
    /Search cancelled/,
  )
})

test("disposeSearchServices disposes the default worker process host boundary", () => {
  let disposed = 0
  disposeSearchServices({
    providerRegistry: {
      searchWorkerProcessHost: {
        dispose: () => { disposed += 1 },
      },
    },
  })

  assert.equal(disposed, 1)
})
