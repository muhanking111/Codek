const test = require("node:test")
const assert = require("node:assert/strict")
const os = require("node:os")
const path = require("node:path")

const {
  classifyProjectRoot,
  inferWriteMode,
  withProjectScope,
} = require("./projectScope")

test("classifyProjectRoot separates smoke temp, Codek self, and user projects", () => {
  const tempProject = path.join(os.tmpdir(), "codek-scope-test")
  const codekRoot = path.resolve(process.cwd())
  const codekProject = path.join(codekRoot, "desktop")
  const userProject = path.resolve("D:/SomeUserProject")

  assert.equal(classifyProjectRoot(tempProject, { codekRoot }).projectKind, "smoke-temp")
  assert.equal(classifyProjectRoot(codekProject, { codekRoot }).projectKind, "codek-self")
  assert.equal(classifyProjectRoot(userProject, { codekRoot }).projectKind, "user-real")
})

test("inferWriteMode reflects proposed patch, applied, blocked, rejected, and rollback states", () => {
  assert.equal(inferWriteMode({ status: "waiting_user", integrationDecision: { status: "pending" } }), "proposed_patch_only")
  assert.equal(inferWriteMode({ status: "completed", integrationDecision: { applyResult: { status: "applied" } } }), "applied")
  assert.equal(inferWriteMode({ status: "waiting_user", integrationDecision: { status: "rework_requested" } }), "blocked_no_write")
  assert.equal(inferWriteMode({ status: "cancelled" }), "rejected_no_write")
  assert.equal(inferWriteMode({ integrationDecision: { status: "rolled_back" } }), "rolled_back")
})

test("withProjectScope appends readable project and write mode labels", () => {
  const result = withProjectScope({
    projectRoot: path.join(os.tmpdir(), "codek-scope-label"),
    status: "waiting_user",
    integrationDecision: { status: "pending" },
  })

  assert.equal(result.projectKind, "smoke-temp")
  assert.equal(result.projectKindLabel, "smoke 临时项目")
  assert.equal(result.writeMode, "proposed_patch_only")
  assert.equal(result.writeModeLabel, "仅生成 proposed patch，等待确认")
})
