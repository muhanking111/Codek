const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { test } = require("node:test")

const {
  buildSourceDeployDoctor,
  readLatest,
  save,
  toMarkdown,
} = require("./source-deploy-doctor")

test("source deploy doctor reports local source deployment contract", () => {
  const report = buildSourceDeployDoctor({ createdAt: 1, cleanClone: true })

  assert.equal(report.reportKind, "source-deploy-doctor")
  assert.equal(report.cleanClone, true)
  assert.equal(report.summary.total > 10, true)
  assert.equal(report.checks.some((item) => item.id === "node_runtime"), true)
  assert.equal(report.checks.some((item) => item.id === "root_script_build"), true)
  assert.equal(report.checks.some((item) => item.id === "readme"), true)
  assert.equal(report.sourceDeployCommand.includes("npm run start"), true)
  assert.equal(report.sourceDeployCommand.includes("npm run doctor -- --clean-clone"), true)
})

test("source deploy doctor markdown and latest artifacts are generated", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-source-doctor-"))
  const report = buildSourceDeployDoctor({ createdAt: 1 })
  const saved = save(report, { reportDir })
  const latest = readLatest({ reportDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "source-deploy-doctor")
  assert.match(toMarkdown(report), /Source Deploy Doctor/)
})
