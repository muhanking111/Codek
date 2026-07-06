const assert = require("assert")
const test = require("node:test")
const {
  compareFilePatternMatches,
  fuzzyContains,
  isFilePatternMatch,
  scoreFilePatternMatch,
} = require("./filePatternMatcher")

test("fuzzyContains follows VS Code subsequence matching", () => {
  assert.equal(fuzzyContains("src/special-target.ts", "spt"), true)
  assert.equal(fuzzyContains("src/special-target.ts", "specialtarget"), true)
  assert.equal(fuzzyContains("src/app.ts", "xyz"), false)
})

test("isFilePatternMatch filters file search candidates before result limits", () => {
  assert.equal(isFilePatternMatch({ relativePath: "src/special-target.ts" }, "specialtarget"), true)
  assert.equal(isFilePatternMatch({ relativePath: "src/app.ts" }, "specialtarget"), false)
  assert.equal(isFilePatternMatch({ relativePath: "src/app.test.ts" }, "**/*.test.ts", false), true)
})

test("compareFilePatternMatches prefers tighter VS Code-style file matches", () => {
  const matches = [
    { relativePath: "packages/foo/src/my-special-target.ts" },
    { relativePath: "src/special-target.ts" },
    { relativePath: "docs/special-target-notes.md" },
  ].sort((left, right) => compareFilePatternMatches("specialtarget", left, right))

  assert.equal(matches[0].relativePath, "src/special-target.ts")
  assert.ok(scoreFilePatternMatch(matches[0], "specialtarget") >= scoreFilePatternMatch(matches[1], "specialtarget"))
})
