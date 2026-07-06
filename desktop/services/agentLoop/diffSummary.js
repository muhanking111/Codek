const { isPathAllowed } = require("./permissionPolicy")

function normalizePath(file) {
  return String(file || "").replace(/\\/g, "/").replace(/^\/+/, "")
}

function countPatchLines(content) {
  let additions = 0
  let deletions = 0
  for (const line of String(content || "").split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue
    if (line.startsWith("+")) additions += 1
    else if (line.startsWith("-")) deletions += 1
  }
  return { additions, deletions }
}

function summarizeDiff(proposedPatch = {}, run = {}) {
  const byFile = new Map()
  const permission = run.permissionRequest || null
  const approvedWritePaths = permission?.status === "approved" ? permission.writePaths || [] : []
  const touch = (file, patch = {}) => {
    const normalized = normalizePath(file)
    if (!normalized) return
    const current = byFile.get(normalized) || {
      file: normalized,
      assignmentIds: [],
      artifactIds: [],
      additions: 0,
      deletions: 0,
      risk: "normal",
      permission: "not_required",
    }
    if (patch.assignmentId && !current.assignmentIds.includes(patch.assignmentId)) current.assignmentIds.push(patch.assignmentId)
    if (patch.artifactId && !current.artifactIds.includes(patch.artifactId)) current.artifactIds.push(patch.artifactId)
    const counts = countPatchLines(patch.content)
    current.additions += counts.additions
    current.deletions += counts.deletions
    if (permission?.status === "approved") {
      current.permission = isPathAllowed(normalized, approvedWritePaths) ? "approved" : "permission_violation"
      if (current.permission === "permission_violation") current.risk = "high"
    }
    byFile.set(normalized, current)
  }

  for (const patch of proposedPatch.patches || []) {
    for (const file of patch.filesChanged || []) touch(file, patch)
  }
  for (const file of proposedPatch.filesChanged || []) touch(file)

  const files = [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file))
  return {
    totalFiles: files.length,
    totalAdditions: files.reduce((sum, item) => sum + item.additions, 0),
    totalDeletions: files.reduce((sum, item) => sum + item.deletions, 0),
    permissionViolationCount: files.filter((item) => item.permission === "permission_violation").length,
    files,
  }
}

module.exports = {
  countPatchLines,
  summarizeDiff,
}
