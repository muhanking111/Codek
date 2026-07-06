const assert = require("assert")
const test = require("node:test")
const {
  buildSearchPatternExpression,
  compileTextSearchPattern,
  createSearchQueryPlan,
  normalizeSearchPatterns,
  splitGlobPattern,
} = require("./searchQueryAdapter")

test("splitGlobPattern keeps comma groups inside braces", () => {
  assert.deepEqual(
    splitGlobPattern("src/**/*.{ts,tsx}, docs/**/*.md,*.json"),
    ["src/**/*.{ts,tsx}", "docs/**/*.md", "*.json"],
  )
})

test("normalizeSearchPatterns normalizes slashes and rejects parent traversal", () => {
  assert.deepEqual(
    normalizeSearchPatterns(["src\\**\\*.ts", "../secret", " docs/**/*.md "]),
    ["src/**/*.ts", "docs/**/*.md"],
  )
})

test("buildSearchPatternExpression follows VS Code global glob expansion", () => {
  assert.deepEqual(
    Object.keys(buildSearchPatternExpression(["src/**/*.ts"])),
    ["**/src/**/*.ts/**", "**/src/**/*.ts"],
  )
  assert.equal(buildSearchPatternExpression(["*"]), null)
})

test("createSearchQueryPlan applies include and exclude matchers", () => {
  const plan = createSearchQueryPlan({
    query: "needle",
    include: ["src/**/*.ts"],
    exclude: ["**/*.test.ts"],
    budgets: { searchMaxResults: 100, searchMaxVisitedFiles: 100 },
  })

  assert.equal(plan.matchesPath("src/app.ts"), true)
  assert.equal(plan.matchesPath("src/app.test.ts"), false)
  assert.equal(plan.matchesPath("docs/app.ts"), false)
})

test("createSearchQueryPlan caps result and visited-file limits", () => {
  const plan = createSearchQueryPlan({
    query: "needle",
    maxResults: 10_000,
    maxVisitedFiles: 100_000,
    budgets: { searchMaxResults: 12_000, searchMaxVisitedFiles: 90_000 },
  })

  assert.equal(plan.resultLimit, 5000)
  assert.equal(plan.visitedFileLimit, 50_000)
  assert.equal(plan.shouldStop(5000, 1), true)
  assert.equal(plan.shouldStop(1, 50_000), true)
})

test("compileTextSearchPattern supports literal, regex, case and whole-word flags", () => {
  assert.equal(compileTextSearchPattern("a.b", {}).test("a-b a.b"), true)
  assert.equal(compileTextSearchPattern("a.b", {}).test("axb"), false)
  assert.equal(compileTextSearchPattern("foo", { wholeWord: true }).test("food foo"), true)
  assert.equal(compileTextSearchPattern("foo", { wholeWord: true }).test("food"), false)
  assert.equal(compileTextSearchPattern("foo", { caseSensitive: true }).test("FOO"), false)
  assert.equal(compileTextSearchPattern("f.o", { regex: true }).test("foo"), true)
})
