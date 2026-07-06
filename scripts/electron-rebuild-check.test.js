const assert = require("node:assert/strict")
const test = require("node:test")

const { buildElectronRebuildCheck } = require("./electron-rebuild-check")

test("electron rebuild check probes the installed CLI without misusing --version", () => {
  const report = buildElectronRebuildCheck({ createdAt: 123 })
  const rebuild = report.checks.find((check) => check.id === "rebuild_cli")

  assert.equal(report.reportKind, "electron-rebuild-check")
  assert.equal(rebuild.status, "passed")
  assert.match(rebuild.detail, /@electron\/rebuild/)
})
