const fs = require("node:fs")
const path = require("node:path")
const { execFileSync } = require("node:child_process")

function normalizePath(file) {
  return String(file || "").replace(/\\/g, "/").replace(/^\/+/, "")
}

function pathExists(target) {
  try {
    return fs.existsSync(target)
  } catch {
    return false
  }
}

function readFileBase64(abs) {
  return pathExists(abs) ? fs.readFileSync(abs).toString("base64") : null
}

function resolveInside(root, file) {
  const resolved = path.resolve(root, normalizePath(file))
  const base = path.resolve(root)
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`path escapes project root: ${file}`)
  }
  return resolved
}

function runGitApply(projectRoot, args, patchContent) {
  return execFileSync("git", ["apply", ...args], {
    cwd: projectRoot,
    input: patchContent,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  })
}

function parseSimplePatch(patchContent) {
  const files = []
  const lines = String(patchContent || "").split(/\r?\n/)
  let current = null
  for (const line of lines) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
    if (header) {
      current = { file: normalizePath(header[2]), before: [], after: [], inHunk: false }
      files.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith("Binary files ")) {
      throw new Error(`cannot apply binary snapshot patch: ${current.file}`)
    }
    if (line.startsWith("@@")) {
      current.inHunk = true
      continue
    }
    if (!current.inHunk) continue
    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue
    if (line.startsWith("-")) current.before.push(line.slice(1))
    else if (line.startsWith("+")) current.after.push(line.slice(1))
    else if (line.startsWith(" ")) {
      current.before.push(line.slice(1))
      current.after.push(line.slice(1))
    }
  }
  return files
}

function normalizeTextForCompare(value) {
  return String(value || "").replace(/\r\n/g, "\n")
}

function linesToText(lines) {
  return lines.join("\n")
}

function applySimplePatchSet({ projectRoot, patches }) {
  const changed = []
  for (const patch of patches) {
    for (const filePatch of parseSimplePatch(patch.content)) {
      const abs = resolveInside(projectRoot, filePatch.file)
      const current = pathExists(abs) ? fs.readFileSync(abs, "utf8") : ""
      const before = linesToText(filePatch.before)
      if (normalizeTextForCompare(current) !== normalizeTextForCompare(before)) {
        throw new Error(`snapshot patch precheck failed for ${filePatch.file}`)
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, linesToText(filePatch.after), "utf8")
      changed.push(filePatch.file)
    }
  }
  return uniqueFiles(changed)
}

function uniqueFiles(files) {
  return [...new Set((files || []).map(normalizePath).filter(Boolean))]
}

function filesFromPatches(patches) {
  const files = []
  for (const patch of patches || []) {
    if (Array.isArray(patch.filesChanged)) files.push(...patch.filesChanged)
    if (patch.path) files.push(patch.path)
  }
  return uniqueFiles(files)
}

function createApplySnapshot({ projectRoot, filesChanged }) {
  if (!projectRoot) throw new Error("projectRoot required")
  const files = uniqueFiles(filesChanged)
  return {
    id: `snapshot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    projectRoot,
    files,
    entries: files.map((file) => {
      const abs = resolveInside(projectRoot, file)
      return {
        file,
        existed: pathExists(abs),
        content: readFileBase64(abs),
      }
    }),
    createdAt: Date.now(),
  }
}

function createAppliedFileSnapshot({ projectRoot, filesChanged }) {
  if (!projectRoot) throw new Error("projectRoot required")
  const files = uniqueFiles(filesChanged)
  return {
    id: `applied_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    projectRoot,
    files,
    entries: files.map((file) => {
      const abs = resolveInside(projectRoot, file)
      return {
        file,
        existed: pathExists(abs),
        content: readFileBase64(abs),
      }
    }),
    createdAt: Date.now(),
  }
}

function collectSnapshotDrift(snapshot) {
  if (!snapshot?.projectRoot) throw new Error("snapshot required")
  const drifted = []
  for (const entry of snapshot.entries || []) {
    const abs = resolveInside(snapshot.projectRoot, entry.file)
    const exists = pathExists(abs)
    const content = exists ? fs.readFileSync(abs).toString("base64") : null
    if (exists !== entry.existed || content !== entry.content) {
      drifted.push({
        file: entry.file,
        reason: "manual-change-detected",
        expectedExisted: entry.existed,
        actualExisted: exists,
      })
    }
  }
  return drifted
}

function restoreApplySnapshot(snapshot) {
  if (!snapshot?.projectRoot) throw new Error("snapshot required")
  const restored = []
  for (const entry of snapshot.entries || []) {
    const abs = resolveInside(snapshot.projectRoot, entry.file)
    if (entry.existed) {
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, Buffer.from(entry.content || "", "base64"))
    } else {
      fs.rmSync(abs, { force: true })
    }
    restored.push(entry.file)
  }
  return {
    status: "restored",
    filesChanged: restored,
    restoredAt: Date.now(),
  }
}

function patchError(prefix, err) {
  const stderr = err?.stderr ? String(err.stderr).trim() : ""
  const message = stderr || err?.message || String(err)
  const wrapped = new Error(`${prefix}: ${message}`)
  wrapped.cause = err
  return wrapped
}

function applyPatchSet({ projectRoot, patches }) {
  if (!projectRoot) throw new Error("projectRoot required")
  const patchList = (patches || []).filter((patch) => patch?.content)
  if (!patchList.length) {
    return { status: "skipped", filesChanged: [], snapshot: null, appliedAt: Date.now() }
  }

  const filesChanged = filesFromPatches(patchList)
  const snapshot = createApplySnapshot({ projectRoot, filesChanged })

  for (const patch of patchList) {
    try {
      runGitApply(projectRoot, ["--check", "--whitespace=nowarn"], patch.content)
    } catch (err) {
      try {
        applySimplePatchSet({ projectRoot, patches: patchList })
        return {
          status: "applied",
          filesChanged,
          snapshot,
          appliedSnapshot: createAppliedFileSnapshot({ projectRoot, filesChanged }),
          appliedAt: Date.now(),
          strategy: "simple-snapshot",
        }
      } catch {
        restoreApplySnapshot(snapshot)
        throw patchError("patch precheck failed", err)
      }
    }
  }

  try {
    for (const patch of patchList) {
      runGitApply(projectRoot, ["--whitespace=nowarn"], patch.content)
    }
  } catch (err) {
    restoreApplySnapshot(snapshot)
    throw patchError("patch apply failed", err)
  }

  return {
    status: "applied",
    filesChanged,
    snapshot,
    appliedSnapshot: createAppliedFileSnapshot({ projectRoot, filesChanged }),
    appliedAt: Date.now(),
  }
}

module.exports = {
  applyPatchSet,
  collectSnapshotDrift,
  createAppliedFileSnapshot,
  createApplySnapshot,
  restoreApplySnapshot,
}
