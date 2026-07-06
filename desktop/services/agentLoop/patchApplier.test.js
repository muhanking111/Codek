const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync } = require("node:child_process")

const {
  applyPatchSet,
  collectSnapshotDrift,
  createApplySnapshot,
  createAppliedFileSnapshot,
  restoreApplySnapshot,
} = require("./patchApplier")

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `codek-${name}-`))
}

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function createGitProject() {
  const root = tempDir("patch-applier")
  git(["init"], root)
  git(["config", "user.email", "test@example.com"], root)
  git(["config", "user.name", "Codek Test"], root)
  fs.writeFileSync(path.join(root, "demo.txt"), "before\n", "utf8")
  git(["add", "demo.txt"], root)
  git(["commit", "-m", "init"], root)
  return root
}

test("applyPatchSet checks and applies patch to the main workspace", () => {
  const root = createGitProject()
  const patch = [
    "diff --git a/demo.txt b/demo.txt",
    "--- a/demo.txt",
    "+++ b/demo.txt",
    "@@ -1 +1 @@",
    "-before",
    "+after",
    "",
  ].join("\n")

  const result = applyPatchSet({
    projectRoot: root,
    patches: [{ content: patch, filesChanged: ["demo.txt"] }],
  })

  assert.equal(result.status, "applied")
  assert.deepEqual(result.filesChanged, ["demo.txt"])
  assert.equal(fs.readFileSync(path.join(root, "demo.txt"), "utf8").replace(/\r\n/g, "\n"), "after\n")
})

test("applyPatchSet restores snapshot when patch application fails", () => {
  const root = createGitProject()
  const patch = [
    "diff --git a/demo.txt b/demo.txt",
    "--- a/demo.txt",
    "+++ b/demo.txt",
    "@@ -1 +1 @@",
    "-missing",
    "+after",
    "",
  ].join("\n")

  assert.throws(() => applyPatchSet({
    projectRoot: root,
    patches: [{ content: patch, filesChanged: ["demo.txt"] }],
  }), /patch precheck failed|patch apply failed/)
  assert.equal(fs.readFileSync(path.join(root, "demo.txt"), "utf8"), "before\n")
})

test("restoreApplySnapshot restores changed files and removes newly-created files", () => {
  const root = tempDir("snapshot-restore")
  fs.writeFileSync(path.join(root, "keep.txt"), "original\n", "utf8")
  const snapshot = createApplySnapshot({
    projectRoot: root,
    filesChanged: ["keep.txt", "new.txt"],
  })

  fs.writeFileSync(path.join(root, "keep.txt"), "changed\n", "utf8")
  fs.writeFileSync(path.join(root, "new.txt"), "created\n", "utf8")
  const result = restoreApplySnapshot(snapshot)

  assert.equal(result.status, "restored")
  assert.equal(fs.readFileSync(path.join(root, "keep.txt"), "utf8"), "original\n")
  assert.equal(fs.existsSync(path.join(root, "new.txt")), false)
})

test("collectSnapshotDrift detects manual changes before rollback restore", () => {
  const root = tempDir("snapshot-drift")
  fs.writeFileSync(path.join(root, "demo.txt"), "agent result\n", "utf8")
  const snapshot = createAppliedFileSnapshot({
    projectRoot: root,
    filesChanged: ["demo.txt", "created.txt"],
  })

  fs.writeFileSync(path.join(root, "demo.txt"), "manual edit\n", "utf8")
  fs.writeFileSync(path.join(root, "created.txt"), "manual create\n", "utf8")

  const drift = collectSnapshotDrift(snapshot)
  assert.deepEqual(drift.map((item) => item.file).sort(), ["created.txt", "demo.txt"])
  assert.equal(drift.every((item) => item.reason === "manual-change-detected"), true)
})
