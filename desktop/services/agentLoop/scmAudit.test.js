const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const { buildPatchScmAudit, collectScmAuditSnapshot, parsePorcelain } = require("./scmAudit")

test("parsePorcelain maps git status lines into SCM audit entries", () => {
  const entries = parsePorcelain("## main\n M src/a.js\nR  old.js -> new.js\n?? tmp.txt\n")
  assert.deepEqual(entries, [
    { path: "src/a.js", oldPath: undefined, status: "M", staged: false },
    { path: "new.js", oldPath: "old.js", status: "R", staged: true },
    { path: "tmp.txt", oldPath: undefined, status: "??", staged: false },
  ])
})

test("collectScmAuditSnapshot records scoped Git status without file content", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-scm-audit-"))
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" })
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root })
  execFileSync("git", ["config", "user.name", "Codek Test"], { cwd: root })
  fs.mkdirSync(path.join(root, "src"), { recursive: true })
  fs.writeFileSync(path.join(root, "src", "a.js"), "one\n")
  execFileSync("git", ["add", "."], { cwd: root })
  execFileSync("git", ["commit", "-m", "init"], { cwd: root, stdio: "ignore" })
  fs.writeFileSync(path.join(root, "src", "a.js"), "two\n")

  const snapshot = collectScmAuditSnapshot({ projectRoot: root, files: ["src/a.js"], phase: "after" })

  assert.equal(snapshot.available, true)
  assert.equal(snapshot.phase, "after")
  assert.deepEqual(snapshot.files, ["src/a.js"])
  assert.equal(snapshot.entries[0].path, "src/a.js")
  assert.equal(JSON.stringify(snapshot).includes("two"), false)
})

test("buildPatchScmAudit keeps before and after metadata together", () => {
  const audit = buildPatchScmAudit({
    projectRoot: "D:/Workspace",
    filesChanged: ["src/a.js", "src/a.js"],
    before: { phase: "before", available: false, entries: [] },
    after: { phase: "after", available: false, entries: [] },
  })

  assert.equal(audit.action, "apply")
  assert.deepEqual(audit.filesChanged, ["src/a.js"])
  assert.deepEqual(audit.boundary, { readonlyEvidence: false, gitIndexMutation: true })
  assert.equal(audit.before.phase, "before")
  assert.equal(audit.after.phase, "after")
})

test("buildPatchScmAudit marks readonly evidence boundaries without changing scm snapshot source", () => {
  const audit = buildPatchScmAudit({
    projectRoot: "D:/Workspace",
    filesChanged: ["src/evidence.js"],
    action: "readonly_evidence",
    before: { phase: "before", available: true, entries: [] },
    after: { phase: "after", available: true, entries: [] },
  })

  assert.deepEqual(audit.boundary, { readonlyEvidence: true, gitIndexMutation: false })
  assert.equal(audit.before.available, true)
  assert.equal(audit.after.available, true)
})
