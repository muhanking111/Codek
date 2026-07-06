const path = require("node:path")
const fs = require("node:fs")
const { execFileSync } = require("node:child_process")

function sanitize(value) {
  return String(value || "item").replace(/[^\w.-]+/g, "_").slice(0, 80)
}

function pathExists(target) {
  try {
    return fs.existsSync(target)
  } catch {
    return false
  }
}

function detectGitRoot(projectRoot) {
  const cwd = projectRoot || process.cwd()
  try {
    const stdout = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    const root = stdout.trim()
    return root || null
  } catch {
    return null
  }
}

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function createWorkspaceLease({ runId, assignmentId, projectRoot, isolation = "overlay" }) {
  const id = `workspace_${sanitize(runId)}_${sanitize(assignmentId)}`
  const baseRoot = projectRoot || process.cwd()
  const root = isolation === "main"
    ? baseRoot
    : path.join(baseRoot, ".codek", "workspaces", sanitize(runId), sanitize(assignmentId))
  return {
    id,
    runId,
    assignmentId,
    isolation,
    projectRoot: baseRoot,
    root,
    status: "leased",
    createdAt: Date.now(),
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function createWorktreeLease({ runId, assignmentId, projectRoot }) {
  const gitRoot = detectGitRoot(projectRoot)
  if (!gitRoot) return null
  const baseDir = path.join(gitRoot, ".codek", "worktrees", sanitize(runId))
  const root = path.join(baseDir, sanitize(assignmentId))
  ensureDir(baseDir)
  if (!pathExists(root)) {
    runGit(["worktree", "add", "--detach", root, "HEAD"], gitRoot)
  }
  return {
    ...createWorkspaceLease({ runId, assignmentId, projectRoot: gitRoot, isolation: "worktree" }),
    root,
    gitRoot,
    branch: "HEAD",
  }
}

function copyRecursive(src, dest, depth = 0) {
  if (depth > 12) return
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    const base = path.basename(src)
    if ([".git", "node_modules", "dist", ".codek"].includes(base)) return
    ensureDir(dest)
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry), depth + 1)
    }
    return
  }
  if (stat.isFile()) {
    ensureDir(path.dirname(dest))
    fs.copyFileSync(src, dest)
  }
}

function createSnapshotLease({ runId, assignmentId, projectRoot }) {
  const baseRoot = projectRoot || process.cwd()
  const root = path.join(baseRoot, ".codek", "snapshots", sanitize(runId), sanitize(assignmentId))
  if (!pathExists(root)) {
    ensureDir(root)
    copyRecursive(baseRoot, root)
  }
  return {
    ...createWorkspaceLease({ runId, assignmentId, projectRoot: baseRoot, isolation: "snapshot" }),
    root,
  }
}

function createAssignmentWorkspace({ runId, assignmentId, projectRoot, isolation = "auto" }) {
  if (isolation === "main" || isolation === "overlay") {
    return createWorkspaceLease({ runId, assignmentId, projectRoot, isolation })
  }
  if (isolation === "worktree" || isolation === "auto") {
    const lease = createWorktreeLease({ runId, assignmentId, projectRoot })
    if (lease) return lease
    if (isolation === "worktree") {
      throw new Error("git worktree requested but project is not a git repository")
    }
  }
  return createSnapshotLease({ runId, assignmentId, projectRoot })
}

function listFiles(root, dir = root, out = []) {
  if (!pathExists(dir)) return out
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    const rel = path.relative(root, full).replace(/\\/g, "/")
    if (rel.startsWith(".git/") || rel.startsWith("node_modules/") || rel.startsWith(".codek/")) continue
    const stat = fs.statSync(full)
    if (stat.isDirectory()) listFiles(root, full, out)
    else if (stat.isFile()) out.push(rel)
  }
  return out
}

function tryReadText(filePath) {
  if (!pathExists(filePath)) return ""
  const buffer = fs.readFileSync(filePath)
  if (buffer.includes(0)) return null
  return buffer.toString("utf8")
}

function unifiedDiff(file, before, after) {
  if (before === after) return ""
  if (before == null || after == null) {
    return [
      `diff --git a/${file} b/${file}`,
      `Binary files a/${file} and b/${file} differ`,
      "",
    ].join("\n")
  }
  const beforeLines = String(before || "").split(/\r?\n/)
  const afterLines = String(after || "").split(/\r?\n/)
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    "",
  ].join("\n")
}

function collectSnapshotPatch(lease) {
  const root = lease.root
  const projectRoot = lease.projectRoot
  const files = new Set([...listFiles(projectRoot), ...listFiles(root)])
  const patches = []
  const filesChanged = []
  for (const file of files) {
    const mainPath = path.join(projectRoot, file)
    const snapPath = path.join(root, file)
    const before = tryReadText(mainPath)
    const after = tryReadText(snapPath)
    const patch = unifiedDiff(file, before, after)
    if (patch) {
      patches.push(patch)
      filesChanged.push(file)
    }
  }
  return { patch: patches.join("\n"), filesChanged }
}

function collectWorkspacePatch(lease) {
  if (!lease || !lease.root) return { patch: "", filesChanged: [] }
  if (lease.isolation === "worktree") {
    try { runGit(["add", "-N", "--", "."], lease.root) } catch {}
    const patch = runGit(["diff", "--binary"], lease.root)
    const nameOnly = runGit(["diff", "--name-only"], lease.root)
    return {
      patch,
      filesChanged: nameOnly.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    }
  }
  if (lease.isolation === "snapshot") {
    return collectSnapshotPatch(lease)
  }
  return { patch: "", filesChanged: [] }
}

function releaseWorkspaceLease(lease) {
  if (!lease) return null
  return {
    ...lease,
    status: "released",
    releasedAt: Date.now(),
  }
}

function cleanupWorkspaceLease(lease, { remove = false } = {}) {
  if (!lease) return null
  if (remove && lease.isolation === "worktree" && lease.gitRoot && lease.root) {
    try { runGit(["worktree", "remove", "--force", lease.root], lease.gitRoot) } catch {}
  } else if (remove && lease.isolation === "snapshot" && lease.root) {
    fs.rmSync(lease.root, { recursive: true, force: true })
  }
  return releaseWorkspaceLease(lease)
}

module.exports = {
  detectGitRoot,
  createWorkspaceLease,
  createWorktreeLease,
  createSnapshotLease,
  createAssignmentWorkspace,
  collectWorkspacePatch,
  releaseWorkspaceLease,
  cleanupWorkspaceLease,
}
