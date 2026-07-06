const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const git = require("./index")

function run(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

test("status returns VS Code SCM style staged, changes, untracked, and repoName", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-git-"))
  run(root, ["init"])
  run(root, ["config", "user.email", "test@example.com"])
  run(root, ["config", "user.name", "Codek Test"])

  fs.writeFileSync(path.join(root, "tracked.txt"), "one\n", "utf8")
  run(root, ["add", "tracked.txt"])
  run(root, ["commit", "-m", "init"])

  fs.writeFileSync(path.join(root, "tracked.txt"), "two\n", "utf8")
  fs.writeFileSync(path.join(root, "staged.txt"), "staged\n", "utf8")
  fs.writeFileSync(path.join(root, "new.txt"), "new\n", "utf8")
  run(root, ["add", "staged.txt"])

  const status = await git.status(root)

  assert.equal(status.repoName, path.basename(root))
  assert.equal(status.hasChanges, true)
  assert.deepEqual(status.staged, [{ path: "staged.txt", status: "A", staged: true, oldPath: undefined }])
  assert.equal(status.changes.some((item) => item.path === "tracked.txt" && item.status === "M" && item.staged === false), true)
  assert.equal(status.untracked.some((item) => item.path === "new.txt" && item.status === "??"), true)
})

test("parsePorcelainFile preserves rename oldPath", () => {
  assert.deepEqual(git.parsePorcelainFile("R  old.txt -> new.txt"), {
    oldPath: "old.txt",
    path: "new.txt",
  })
})

test("status reports merge conflicts as SCM conflict resources", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-git-conflict-"))
  run(root, ["init"])
  run(root, ["config", "user.email", "test@example.com"])
  run(root, ["config", "user.name", "Codek Test"])

  fs.writeFileSync(path.join(root, "conflict.txt"), "base\n", "utf8")
  run(root, ["add", "conflict.txt"])
  run(root, ["commit", "-m", "base"])
  run(root, ["checkout", "-b", "feature"])
  fs.writeFileSync(path.join(root, "conflict.txt"), "feature\n", "utf8")
  run(root, ["commit", "-am", "feature"])
  run(root, ["checkout", "master"])
  fs.writeFileSync(path.join(root, "conflict.txt"), "master\n", "utf8")
  run(root, ["commit", "-am", "master"])

  const merge = spawnSync("git", ["merge", "feature"], { cwd: root, encoding: "utf8" })
  assert.notEqual(merge.status, 0)

  const status = await git.status(root)
  assert.equal(status.conflicts.some((item) => item.path === "conflict.txt" && item.status === "U"), true)
})
