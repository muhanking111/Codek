const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const test = require("node:test")
const { createSearchQueryPlan } = require("./searchQueryAdapter")
const { findRipgrepPath } = require("./ripgrepSearchAdapter")
const {
  RipgrepFileParser,
  buildRipgrepFileArgs,
  runRipgrepFileSearch,
} = require("./ripgrepFileSearchAdapter")

test("buildRipgrepFileArgs follows VS Code rg --files defaults", () => {
  const args = buildRipgrepFileArgs({
    includePatterns: ["src/**/*.{ts,tsx}"],
    excludePatterns: ["**/node_modules/**"],
    followSymlinks: true,
  })

  assert.ok(args.includes("--files"))
  assert.ok(args.includes("--hidden"))
  assert.ok(args.includes("--case-sensitive"))
  assert.ok(args.includes("--no-require-git"))
  assert.ok(args.includes("--no-ignore"))
  assert.ok(args.includes("--follow"))
  assert.ok(args.includes("--no-config"))
  assert.ok(args.includes("/src/**/*.ts"))
  assert.ok(args.includes("/src/**/*.tsx"))
  assert.ok(args.includes("!**/node_modules/**"))
})

test("RipgrepFileParser parses chunked file paths into Codek discover matches", () => {
  const parser = new RipgrepFileParser({
    maxResults: 10,
    matchesPath: (value) => value.startsWith("src/"),
  })

  parser.handleData("src/app")
  parser.handleData(".ts\r\n")
  parser.handleData("docs/guide.md\n")
  parser.flush()

  assert.deepEqual(parser.matches, [{
    path: "src/app.ts",
    line: 1,
    column: 1,
    matchLength: 0,
    preview: "",
  }])
  assert.equal(parser.visitedFiles, 1)
})

test("RipgrepFileParser caps results and reports truncation", () => {
  const parser = new RipgrepFileParser({ maxResults: 1 })

  parser.handleData("a.txt\nb.txt\n")

  assert.deepEqual(parser.matches.map((match) => match.path), ["a.txt"])
  assert.equal(parser.hitLimit, true)
})

test("RipgrepFileParser applies VS Code filePattern before result limits", () => {
  const parser = new RipgrepFileParser({
    maxResults: 1,
    filePattern: "specialtarget",
  })

  parser.handleData("a-first.txt\n")
  parser.handleData("src/special-target.ts\n")
  parser.handleData("z-last.txt\n")
  parser.flush()

  assert.deepEqual(parser.matches.map((match) => match.path), ["src/special-target.ts"])
  assert.equal(parser.hitLimit, false)
})

test("runRipgrepFileSearch uses bundled rg --files when available", { skip: !findRipgrepPath() }, async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codek-rg-files-"))
  await fs.promises.mkdir(path.join(root, "src"), { recursive: true })
  await fs.promises.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true })
  await fs.promises.writeFile(path.join(root, "src", "app.ts"), "export const app = true\n", "utf8")
  await fs.promises.writeFile(path.join(root, "src", "app.test.ts"), "export const test = true\n", "utf8")
  await fs.promises.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "ignored\n", "utf8")

  const queryPlan = createSearchQueryPlan({
    include: ["src/**/*.ts"],
    exclude: ["**/*.test.ts"],
    maxResults: 10,
    compileTextPattern: false,
  })
  const result = await runRipgrepFileSearch({
    root,
    queryPlan,
    ignoredGlobs: ["**/node_modules/**"],
  })

  assert.equal(result.engine, "ripgrep-files")
  assert.equal(result.truncated, false)
  assert.deepEqual(result.matches.map((match) => match.path), ["src/app.ts"])
  assert.equal(result.visitedFiles >= 1, true)
})

test("runRipgrepFileSearch aborts an in-flight rg --files process", { skip: !findRipgrepPath() }, async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "codek-rg-files-cancel-"))
  for (let index = 0; index < 2000; index += 1) {
    await fs.promises.writeFile(path.join(root, `file-${index}.txt`), "x\n", "utf8")
  }
  const queryPlan = createSearchQueryPlan({
    maxResults: 5000,
    compileTextPattern: false,
  })
  const controller = new AbortController()
  const searchPromise = runRipgrepFileSearch({
    root,
    queryPlan,
    signal: controller.signal,
  })
  controller.abort()

  await assert.rejects(searchPromise, /Search cancelled/)
})
