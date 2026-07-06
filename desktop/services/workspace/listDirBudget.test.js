const assert = require("assert")
const test = require("node:test")
const { resolveListDirEntryBudget } = require("./listDirBudget")

test("renderer explorer directory reads return all entries by default", () => {
  const budget = resolveListDirEntryBudget({
    totalEntries: 3_200,
    options: {},
    meta: null,
    profileEntryBudget: 1_200,
  })

  assert.equal(budget.source, "renderer")
  assert.equal(budget.maxEntries, 3_200)
  assert.equal(budget.truncated, false)
  assert.equal(budget.appendLimitSentinel, false)
})

test("renderer explorer explicit maxEntries still returns all entries", () => {
  const budget = resolveListDirEntryBudget({
    totalEntries: 3_200,
    options: { maxEntries: 2_000 },
    meta: null,
    profileEntryBudget: 1_200,
  })

  assert.equal(budget.maxEntries, 3_200)
  assert.equal(budget.truncated, false)
  assert.equal(budget.appendLimitSentinel, false)
})

test("ui and explorer directory reads never expose a profile entry limit sentinel", () => {
  for (const source of ["renderer", "explorer", "ui"]) {
    const budget = resolveListDirEntryBudget({
      totalEntries: 3_200,
      options: { maxEntries: 10 },
      meta: { source },
      profileEntryBudget: 1_200,
    })

    assert.equal(budget.source, source)
    assert.equal(budget.maxEntries, 3_200)
    assert.equal(budget.truncated, false)
    assert.equal(budget.appendLimitSentinel, false)
  }
})

test("agent directory reads keep a bounded default budget", () => {
  const budget = resolveListDirEntryBudget({
    totalEntries: 3_200,
    options: {},
    meta: { source: "agent" },
    profileEntryBudget: 1_200,
  })

  assert.equal(budget.source, "agent")
  assert.equal(budget.maxEntries, 1_200)
  assert.equal(budget.truncated, true)
  assert.equal(budget.appendLimitSentinel, true)
})
