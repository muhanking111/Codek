const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const test = require("node:test")
const { createSearchQueryPlan } = require("./searchQueryAdapter")
const {
  RipgrepJsonParser,
  buildRipgrepArgs,
  findRipgrepPath,
  performBraceExpansionForRipgrep,
  runRipgrepSearch,
} = require("./ripgrepSearchAdapter")

test("buildRipgrepArgs follows VS Code rg json and fixed-string defaults", () => {
  const args = buildRipgrepArgs({
    query: "--needle",
    includePatterns: ["src/**/*.{ts,tsx}"],
    excludePatterns: ["**/node_modules/**"],
    caseSensitive: false,
  })

  assert.ok(args.includes("--hidden"))
  assert.ok(args.includes("--no-require-git"))
  assert.ok(args.includes("--ignore-case"))
  assert.ok(args.includes("--fixed-strings"))
  assert.ok(args.includes("--json"))
  assert.ok(args.includes("--"))
  assert.ok(args.includes("--needle"))
  assert.ok(args.includes("."))
  assert.ok(args.includes("!**/node_modules/**"))
})

test("buildRipgrepArgs uses VS Code-style regexp for whole word searches", () => {
  const args = buildRipgrepArgs({
    query: "needle",
    regex: false,
    wholeWord: true,
    caseSensitive: true,
  })

  const regexpIndex = args.indexOf("--regexp")
  assert.notEqual(regexpIndex, -1)
  assert.equal(args[regexpIndex + 1], "\\bneedle\\b")
  assert.ok(args.includes("--case-sensitive"))
})

test("performBraceExpansionForRipgrep expands search globs before rg args", () => {
  assert.deepEqual(
    performBraceExpansionForRipgrep("src/**/*.{ts,tsx}"),
    ["src/**/*.ts", "src/**/*.tsx"],
  )
})

test("RipgrepJsonParser parses chunked rg json matches", () => {
  const parser = new RipgrepJsonParser({
    root: "C:/workspace",
    maxResults: 10,
    matchesPath: (value) => value.startsWith("src/"),
  })
  const line = JSON.stringify({
    type: "match",
    data: {
      path: { text: "src/app.ts" },
      lines: { text: "const value = 'needle'\n" },
      line_number: 7,
      absolute_offset: 120,
      submatches: [
        {
          match: { text: "needle" },
          start: Buffer.from("const value = '").length,
          end: Buffer.from("const value = 'needle").length,
        },
      ],
    },
  })

  parser.handleData(line.slice(0, 24))
  parser.handleData(`${line.slice(24)}\n`)

  assert.deepEqual(parser.matches, [{
    path: "src/app.ts",
    line: 7,
    column: 16,
    matchLength: 6,
    preview: "const value = 'needle'",
  }])
  assert.equal(parser.visitedFiles.has("src/app.ts"), true)
})

test("RipgrepJsonParser maps byte offsets to character columns", () => {
  const parser = new RipgrepJsonParser({ maxResults: 10 })
  const prefix = "中文"
  const match = "needle"
  const lineText = `${prefix}${match}`
  parser.handleData(`${JSON.stringify({
    type: "match",
    data: {
      path: { text: "unicode.txt" },
      lines: { text: `${lineText}\n` },
      line_number: 1,
      submatches: [{
        match: { text: match },
        start: Buffer.from(prefix).length,
        end: Buffer.from(lineText).length,
      }],
    },
  })}\n`)

  assert.equal(parser.matches[0].column, 3)
  assert.equal(parser.matches[0].matchLength, 6)
})

test("runRipgrepSearch uses bundled rg when available", { skip: !findRipgrepPath() }, async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codek-rg-search-"))
  await fs.promises.mkdir(path.join(root, "src"), { recursive: true })
  await fs.promises.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true })
  await fs.promises.writeFile(path.join(root, "src", "app.ts"), "export const token = 'rg-token'\n", "utf8")
  await fs.promises.writeFile(path.join(root, "src", "app.test.ts"), "rg-token in test\n", "utf8")
  await fs.promises.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "rg-token ignored\n", "utf8")

  const queryPlan = createSearchQueryPlan({
    query: "rg-token",
    include: ["src/**/*.ts"],
    exclude: ["**/*.test.ts"],
    maxResults: 10,
  })
  const result = await runRipgrepSearch({
    root,
    query: "rg-token",
    queryPlan,
    ignoredGlobs: ["**/node_modules/**"],
  })

  assert.equal(result.engine, "ripgrep")
  assert.equal(result.truncated, false)
  assert.deepEqual(result.matches.map((match) => match.path), ["src/app.ts"])
  assert.equal(result.matches[0].line, 1)
  assert.equal(result.matches[0].column, 23)
})

test("runRipgrepSearch aborts an in-flight rg process", { skip: !findRipgrepPath() }, async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codek-rg-cancel-"))
  await fs.promises.writeFile(path.join(root, "large.txt"), `${"needle\n".repeat(20000)}`, "utf8")
  const queryPlan = createSearchQueryPlan({
    query: "needle",
    maxResults: 5000,
  })
  const controller = new AbortController()
  const searchPromise = runRipgrepSearch({
    root,
    query: "needle",
    queryPlan,
    signal: controller.signal,
  })
  controller.abort()

  await assert.rejects(searchPromise, /Search cancelled/)
})
