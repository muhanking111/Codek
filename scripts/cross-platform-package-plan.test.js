const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  buildCrossPlatformPackagePlan,
  hasScript,
  readLatest,
  save,
  targetNames,
  toMarkdown,
} = require("./cross-platform-package-plan")

test("targetNames extracts string and object electron-builder targets", () => {
  assert.deepEqual(targetNames({ build: { win: { target: ["portable", { target: "nsis" }] } } }, "win"), ["portable", "nsis"])
})

test("hasScript requires a non-empty package script", () => {
  assert.equal(hasScript({ scripts: { "pack:win": "electron-builder --win" } }, "pack:win"), true)
  assert.equal(hasScript({ scripts: { "pack:win": " " } }, "pack:win"), false)
  assert.equal(hasScript({ scripts: {} }, "pack:win"), false)
})

test("cross-platform package plan reports Windows, macOS, and Linux strategy", () => {
  const report = buildCrossPlatformPackagePlan({ createdAt: 1 })

  assert.equal(report.reportKind, "cross-platform-package-plan")
  assert.equal(report.platforms.length, 3)
  assert.equal(report.platforms.some((item) => item.platform === "windows" && item.command === "npm run pack:win"), true)
  assert.equal(report.checks.some((item) => item.id === "windows_nsis" && item.passed), true)
  assert.equal(report.checks.some((item) => item.id === "windows_portable_or_unpacked" && item.passed), true)
  assert.equal(report.checks.some((item) => item.id === "linux_deb"), true)
  assert.equal(report.ready, true)
})

test("cross-platform package plan saves latest and history artifacts", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-cross-platform-"))
  const report = buildCrossPlatformPackagePlan({ createdAt: 1 })
  const saved = save(report, { reportDir })
  const latest = readLatest({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "cross-platform-package-plan")
  assert.match(toMarkdown(report), /Cross Platform Package Plan/)
})
