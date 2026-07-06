const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync } = require("node:child_process")

const {
  createAssignmentWorkspace,
  collectWorkspacePatch,
  cleanupWorkspaceLease,
} = require("./workspaceLease")

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

test("createAssignmentWorkspace uses git worktree for git projects and captures tracked/untracked diff", () => {
  const root = tempDir("worktree")
  git(["init"], root)
  git(["config", "user.email", "test@example.com"], root)
  git(["config", "user.name", "Codek Test"], root)
  fs.writeFileSync(path.join(root, "README.md"), "hello\n", "utf8")
  git(["add", "README.md"], root)
  git(["commit", "-m", "init"], root)

  const lease = createAssignmentWorkspace({
    runId: "run_1",
    assignmentId: "assignment_1",
    projectRoot: root,
    isolation: "auto",
  })

  assert.equal(lease.isolation, "worktree")
  assert.ok(fs.existsSync(path.join(lease.root, "README.md")))

  fs.writeFileSync(path.join(lease.root, "README.md"), "hello worktree\n", "utf8")
  fs.writeFileSync(path.join(lease.root, "NEW.md"), "new file\n", "utf8")
  const result = collectWorkspacePatch(lease)

  assert.match(result.patch, /diff --git a\/README\.md b\/README\.md/)
  assert.match(result.patch, /diff --git a\/NEW\.md b\/NEW\.md/)
  assert.deepEqual(result.filesChanged.sort(), ["NEW.md", "README.md"])

  const released = cleanupWorkspaceLease(lease, { remove: true })
  assert.equal(released.status, "released")
})

test("createAssignmentWorkspace falls back to snapshot for non-git projects and captures text diff", () => {
  const root = tempDir("snapshot")
  fs.writeFileSync(path.join(root, "app.js"), "console.log('before')\n", "utf8")

  const lease = createAssignmentWorkspace({
    runId: "run_2",
    assignmentId: "assignment_2",
    projectRoot: root,
    isolation: "auto",
  })

  assert.equal(lease.isolation, "snapshot")
  fs.writeFileSync(path.join(lease.root, "app.js"), "console.log('after')\n", "utf8")
  fs.writeFileSync(path.join(lease.root, "created.txt"), "created\n", "utf8")

  const result = collectWorkspacePatch(lease)
  assert.match(result.patch, /diff --git a\/app\.js b\/app\.js/)
  assert.match(result.patch, /console\.log\('after'\)/)
  assert.match(result.patch, /diff --git a\/created\.txt b\/created\.txt/)
  assert.deepEqual(result.filesChanged.sort(), ["app.js", "created.txt"])

  const released = cleanupWorkspaceLease(lease, { remove: true })
  assert.equal(released.status, "released")
  assert.equal(fs.existsSync(lease.root), false)
})
