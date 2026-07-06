const test = require("node:test")
const assert = require("node:assert/strict")

const { warningCatalog } = require("./h-release-smoke")

test("H release smoke warning catalog separates non-blocking warnings", () => {
  const warnings = warningCatalog()

  assert.ok(warnings.length >= 3)
  assert.ok(warnings.every((item) => item.severity === "non_blocking"))
  assert.ok(warnings.some((item) => item.id === "vite_chunk_size_warning"))
  assert.ok(warnings.some((item) => item.id === "electron_dev_csp_warning"))
})
