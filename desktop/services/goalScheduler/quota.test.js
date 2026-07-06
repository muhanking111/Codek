const test = require("node:test")
const assert = require("node:assert/strict")

const quota = require("./quota")

test("estimateTokens uses a stable character-based estimate", () => {
  assert.equal(quota.estimateTokens("abcd"), 1)
  assert.equal(quota.estimateTokens("abcde"), 2)
  assert.equal(quota.estimateTokens({ value: "abcd" }) > 1, true)
})
