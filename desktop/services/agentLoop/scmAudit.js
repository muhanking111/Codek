const { execFileSync } = require("node:child_process")

function normalizePath(file) {
  return String(file || "").replace(/\\/g, "/").replace(/^\/+/, "")
}

function uniqueFiles(files) {
  return [...new Set((files || []).map(normalizePath).filter(Boolean))]
}

function parsePorcelain(output) {
  const entries = []
  for (const line of String(output || "").split(/\r?\n/)) {
    if (!line || line.startsWith("## ")) continue
    const status = line.slice(0, 2)
    const raw = line.length > 3 ? line.slice(3).trim() : ""
    const arrow = raw.indexOf(" -> ")
    entries.push({
      path: arrow >= 0 ? raw.slice(arrow + 4) : raw,
      oldPath: arrow >= 0 ? raw.slice(0, arrow) : undefined,
      status: status.trim() || status,
      staged: status[0] !== " " && status[0] !== "?",
    })
  }
  return entries.filter((entry) => entry.path)
}

function collectScmAuditSnapshot({ projectRoot, files = [], phase = "snapshot" }) {
  const normalizedFiles = uniqueFiles(files)
  if (!projectRoot) {
    return {
      phase,
      available: false,
      reason: "projectRoot required",
      files: normalizedFiles,
      entries: [],
      collectedAt: Date.now(),
    }
  }

  try {
    const output = execFileSync("git", ["status", "--porcelain=v1", "-b", "--", ...normalizedFiles], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    return {
      phase,
      available: true,
      files: normalizedFiles,
      entries: parsePorcelain(output),
      collectedAt: Date.now(),
    }
  } catch (err) {
    return {
      phase,
      available: false,
      reason: err?.stderr ? String(err.stderr).trim() : err?.message || String(err),
      files: normalizedFiles,
      entries: [],
      collectedAt: Date.now(),
    }
  }
}

function buildPatchScmAudit({ projectRoot, filesChanged = [], before = null, after = null, action = "apply" }) {
  const files = uniqueFiles(filesChanged)
  return {
    action,
    projectRoot,
    filesChanged: files,
    boundary: {
      readonlyEvidence: action === "readonly_evidence",
      gitIndexMutation: action !== "readonly_evidence",
    },
    before: before || collectScmAuditSnapshot({ projectRoot, files, phase: "before" }),
    after: after || collectScmAuditSnapshot({ projectRoot, files, phase: "after" }),
  }
}

module.exports = {
  buildPatchScmAudit,
  collectScmAuditSnapshot,
  parsePorcelain,
}
