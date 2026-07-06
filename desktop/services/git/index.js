const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")

const TIMEOUT_MS = 30_000

function runGit(projectRoot, args) {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd: projectRoot, windowsHide: true })
    let stdout = ""
    let stderr = ""
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { child.kill("SIGKILL") } catch {}
      resolve({ success: false, output: stdout.trim(), error: `Command timed out after ${TIMEOUT_MS / 1000}s` })
    }, TIMEOUT_MS)
    child.stdout.on("data", (d) => { stdout += d.toString("utf8") })
    child.stderr.on("data", (d) => { stderr += d.toString("utf8") })
    child.on("error", (e) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ success: false, output: "", error: e.message })
    })
    child.on("close", (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (code !== 0) {
        const err = stderr.trim() || `Exit code: ${code}`
        resolve({ success: false, output: stdout.trim(), error: err })
      } else {
        resolve({ success: true, output: stdout.trim(), error: "" })
      }
    })
  })
}

function parseBranchLine(line) {
  const content = line.slice(3).trim()
  const parts = content.split("...")
  let branch = parts[0].trim()
  let ahead = 0
  let behind = 0
  const remotePart = parts[1] || content
  const aheadM = remotePart.match(/ahead (\d+)/)
  const behindM = remotePart.match(/behind (\d+)/)
  if (aheadM) ahead = parseInt(aheadM[1], 10)
  if (behindM) behind = parseInt(behindM[1], 10)
  if (branch.startsWith("origin/")) branch = branch.slice("origin/".length)
  return { branch, ahead, behind }
}

async function status(projectRoot) {
  const out = await runGit(projectRoot, ["status", "--porcelain", "-b"])
  if (!out.success) {
    return buildStatusResult(projectRoot, "", 0, 0, [], [], [])
  }
  const staged = []
  const unstaged = []
  const untracked = []
  let branch = ""
  let ahead = 0
  let behind = 0
  for (const line of out.output.split("\n")) {
    if (line.startsWith("## ")) {
      const info = parseBranchLine(line)
      branch = info.branch; ahead = info.ahead; behind = info.behind
    } else if (line.length >= 2) {
      const x = line[0]
      const y = line[1]
      const parsed = parsePorcelainFile(line)
      const filePath = parsed.path
      const oldPath = parsed.oldPath
      if (x === "?" && y === "?") {
        untracked.push({ path: filePath, status: "??", staged: false, oldPath })
      } else {
        if (x !== " " && x !== "!") staged.push({ path: filePath, status: toScmStatus(x, y), staged: true, oldPath })
        if (y !== " " && y !== "!") unstaged.push({ path: filePath, status: toScmStatus(y, x), staged: false, oldPath })
      }
    }
  }
  return buildStatusResult(projectRoot, branch, ahead, behind, staged, unstaged, untracked)
}

function buildStatusResult(projectRoot, branch, ahead, behind, staged, unstaged, untracked) {
  const changes = [...unstaged, ...untracked]
  const hasChanges = staged.length > 0 || changes.length > 0
  return {
    branch,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    changes,
    conflicts: [...staged, ...changes].filter((item) => item.status === "U"),
    hasChanges,
    repoName: projectRoot ? path.basename(projectRoot) : "",
  }
}

function parsePorcelainFile(line) {
  const raw = line.length > 3 ? line.slice(3).trim() : ""
  const arrow = raw.indexOf(" -> ")
  if (arrow >= 0) {
    return { oldPath: raw.slice(0, arrow), path: raw.slice(arrow + 4) }
  }
  return { path: raw }
}

function toScmStatus(primary, secondary) {
  if (primary === "?" || secondary === "?") return "??"
  if (primary === "U" || secondary === "U" || primary === "A" && secondary === "A" || primary === "D" && secondary === "D") return "U"
  if (primary === "R") return "R"
  if (primary === "A") return "A"
  if (primary === "D") return "D"
  return "M"
}

async function gitLog(projectRoot, maxCount) {
  const n = Math.max(maxCount || 20, 1)
  const out = await runGit(projectRoot, ["log", "--oneline", `--max-count=${n}`, "--format=%H|||%s|||%an|||%ad", "--date=iso"])
  if (!out.success) return { entries: [] }
  const entries = []
  for (const line of out.output.split("\n")) {
    const t = line.trim()
    if (!t) continue
    const parts = t.split("|||")
    if (parts.length >= 4) {
      entries.push({ hash: parts[0].trim(), message: parts[1].trim(), author: parts[2].trim(), date: parts[3].trim() })
    }
  }
  return { entries }
}

async function diff(projectRoot, file) {
  const out = await runGit(projectRoot, ["diff", "--", file])
  return out.success ? out.output : out.error
}

async function diffStaged(projectRoot) {
  const out = await runGit(projectRoot, ["diff", "--staged"])
  return out.success ? out.output : out.error
}

const stage = (root, files) => runGit(root, ["add", "--", ...(files || [])])
const stageAll = (root) => runGit(root, ["add", "-A"])
const unstage = (root, file) => runGit(root, ["reset", "HEAD", "--", file])
const commit = (root, message) => runGit(root, ["commit", "-m", message])
const push = (root) => runGit(root, ["push"])
const pull = (root) => runGit(root, ["pull"])
const checkout = (root, branch) => runGit(root, ["checkout", branch])
const createBranch = (root, branch) => runGit(root, ["checkout", "-b", branch])
const stash = (root) => runGit(root, ["stash"])
const stashPop = (root) => runGit(root, ["stash", "pop"])
const discard = (root, file) => runGit(root, ["checkout", "--", file])
const discardUntracked = (root, file) => runGit(root, ["clean", "-f", "--", file])
const cherryPick = (root, hash) => runGit(root, ["cherry-pick", hash])
const revert = (root, hash) => runGit(root, ["revert", "--no-edit", hash])

async function branches(projectRoot) {
  const out = await runGit(projectRoot, ["branch", "-a"])
  if (!out.success) return []
  const list = []
  for (const line of out.output.split("\n")) {
    const t = line.trim()
    if (!t) continue
    const isCurrent = t.startsWith("* ")
    const name = isCurrent ? t.slice(2).trim() : t
    const isRemote = name.startsWith("remotes/")
    list.push({ name, isCurrent, isRemote })
  }
  return list
}

async function merge(projectRoot, sourceBranch, targetBranch) {
  const cur = (await runGit(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).output.trim()
  const needSwitch = cur !== targetBranch
  if (needSwitch) {
    const co = await runGit(projectRoot, ["checkout", targetBranch])
    if (!co.success) return co
  }
  const m = await runGit(projectRoot, ["merge", sourceBranch])
  if (needSwitch) await runGit(projectRoot, ["checkout", cur])
  const hasConflicts = m.output.includes("CONFLICT") || m.error.includes("CONFLICT")
  if (hasConflicts) {
    return { success: m.success, output: m.output, error: "Merge conflicts detected" + (m.error ? ": " + m.error : "") }
  }
  return m
}

async function rebase(projectRoot, branch, upstream) {
  const cur = (await runGit(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).output.trim()
  const needSwitch = cur !== branch
  if (needSwitch) {
    const co = await runGit(projectRoot, ["checkout", branch])
    if (!co.success) return co
  }
  const r = await runGit(projectRoot, ["rebase", upstream])
  if (needSwitch) await runGit(projectRoot, ["checkout", cur])
  const hasConflicts = r.output.includes("CONFLICT") || r.error.includes("CONFLICT")
  if (hasConflicts) {
    return { success: r.success, output: r.output, error: "Rebase conflicts detected" + (r.error ? ": " + r.error : "") }
  }
  return r
}

const VALID_RESET_MODES = new Set(["soft", "mixed", "hard"])
function reset(projectRoot, commitHash, mode) {
  const safe = VALID_RESET_MODES.has(mode) ? mode : "mixed"
  return runGit(projectRoot, ["reset", `--${safe}`, commitHash])
}

function tag(projectRoot, tagName, message) {
  if (message && message.trim()) return runGit(projectRoot, ["tag", "-a", tagName, "-m", message])
  return runGit(projectRoot, ["tag", tagName])
}

async function listTags(projectRoot) {
  const out = await runGit(projectRoot, ["tag", "-l", "--format=%(refname:short)|||%(subject)"])
  if (!out.success) return { tags: [] }
  const tags = []
  for (const line of out.output.split("\n")) {
    const t = line.trim()
    if (!t) continue
    const parts = t.split("|||")
    tags.push({ name: parts[0].trim(), message: (parts[1] || "").trim() })
  }
  return { tags }
}

async function remoteList(projectRoot) {
  const out = await runGit(projectRoot, ["remote", "-v"])
  if (!out.success) return { remotes: [] }
  const remotes = []
  const seen = new Set()
  for (const line of out.output.split("\n")) {
    const t = line.trim()
    if (!t) continue
    const parts = t.split(/\s+/)
    if (parts.length >= 2 && !seen.has(parts[0])) {
      seen.add(parts[0])
      remotes.push({ name: parts[0], url: parts[1] })
    }
  }
  return { remotes }
}

const remoteAdd = (root, name, url) => runGit(root, ["remote", "add", name, url])
const remoteRemove = (root, name) => runGit(root, ["remote", "remove", name])

async function getMergeConflicts(projectRoot) {
  const out = await runGit(projectRoot, ["diff", "--name-only", "--diff-filter=U"])
  if (!out.success) return { conflicts: [] }
  const conflicts = []
  for (const line of out.output.split("\n")) {
    const t = line.trim()
    if (t) conflicts.push({ path: t })
  }
  return { conflicts }
}

async function resolveConflict(projectRoot, filePath, resolvedContent) {
  try {
    fs.writeFileSync(path.join(projectRoot, filePath), resolvedContent, "utf8")
  } catch (e) {
    return { success: false, output: "", error: "Failed to write resolved content: " + e.message }
  }
  return runGit(projectRoot, ["add", "--", filePath])
}

function isGitRepo(projectRoot) {
  if (!projectRoot) return false
  try {
    const st = fs.statSync(path.join(projectRoot, ".git"))
    return st.isDirectory()
  } catch { return false }
}

function register(router) {
  const wrap = (fn) => async ({ body }) => {
    try { return await fn(body) }
    catch (e) { return { success: false, error: e.message } }
  }

  const blame = async (projectRoot, file) => {
    if (!file) return { success: false, error: "file required" }
    const result = await runGit(projectRoot, ["blame", "--porcelain", "--", file])
    if (!result.success) return { success: false, error: result.error, lines: [] }
    const lines = []
    const commits = {}
    const raw = result.output.split("\n")
    let i = 0
    while (i < raw.length) {
      const header = raw[i]
      if (!header) { i++; continue }
      const m = /^([0-9a-f]{40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/.exec(header)
      if (!m) { i++; continue }
      const sha = m[1]
      const finalLine = parseInt(m[3], 10)
      i++
      if (!commits[sha]) commits[sha] = { sha, author: "", authorMail: "", authorTime: 0, summary: "" }
      while (i < raw.length && !raw[i].startsWith("\t")) {
        const meta = raw[i]
        const sp = meta.indexOf(" ")
        const key = sp < 0 ? meta : meta.slice(0, sp)
        const val = sp < 0 ? "" : meta.slice(sp + 1)
        if (key === "author") commits[sha].author = val
        else if (key === "author-mail") commits[sha].authorMail = val
        else if (key === "author-time") commits[sha].authorTime = parseInt(val, 10) || 0
        else if (key === "summary") commits[sha].summary = val
        i++
      }
      const content = i < raw.length && raw[i].startsWith("\t") ? raw[i].slice(1) : ""
      i++
      lines.push({
        line: finalLine,
        sha,
        author: commits[sha].author,
        authorMail: commits[sha].authorMail,
        authorTime: commits[sha].authorTime,
        summary: commits[sha].summary,
        content,
      })
    }
    return { success: true, lines }
  }

  router.register("POST", "/git/blame", wrap(async (b) => await blame(b.projectRoot, b.file)))

  router.register("POST", "/git/status", wrap(async (b) => ({ success: true, ...(await status(b.projectRoot)) })))
  router.register("POST", "/git/log", wrap(async (b) => ({ success: true, ...(await gitLog(b.projectRoot, b.maxCount)) })))
  router.register("POST", "/git/diff", wrap(async (b) => ({ success: true, diff: await diff(b.projectRoot, b.file) })))
  router.register("POST", "/git/diffStaged", wrap(async (b) => ({ success: true, diff: await diffStaged(b.projectRoot) })))
  router.register("POST", "/git/stage", wrap(async (b) => await stage(b.projectRoot, b.files || (b.file ? [b.file] : []))))
  router.register("POST", "/git/stageAll", wrap(async (b) => await stageAll(b.projectRoot)))
  router.register("POST", "/git/unstage", wrap(async (b) => await unstage(b.projectRoot, b.file)))
  router.register("POST", "/git/commit", wrap(async (b) => await commit(b.projectRoot, b.message)))
  router.register("POST", "/git/push", wrap(async (b) => await push(b.projectRoot)))
  router.register("POST", "/git/pull", wrap(async (b) => await pull(b.projectRoot)))
  router.register("POST", "/git/branches", wrap(async (b) => ({ success: true, branches: await branches(b.projectRoot) })))
  router.register("POST", "/git/checkout", wrap(async (b) => await checkout(b.projectRoot, b.branch)))
  router.register("POST", "/git/createBranch", wrap(async (b) => await createBranch(b.projectRoot, b.branch)))
  router.register("POST", "/git/stash", wrap(async (b) => await stash(b.projectRoot)))
  router.register("POST", "/git/stashPop", wrap(async (b) => await stashPop(b.projectRoot)))
  router.register("POST", "/git/discard", wrap(async (b) => await discard(b.projectRoot, b.file)))
  router.register("POST", "/git/discardUntracked", wrap(async (b) => await discardUntracked(b.projectRoot, b.file)))
  router.register("POST", "/git/isRepo", wrap(async (b) => ({ success: true, isRepo: isGitRepo(b.projectRoot) })))
  router.register("POST", "/git/merge", wrap(async (b) => await merge(b.projectRoot, b.sourceBranch, b.targetBranch)))
  router.register("POST", "/git/rebase", wrap(async (b) => await rebase(b.projectRoot, b.branch, b.upstream)))
  router.register("POST", "/git/cherryPick", wrap(async (b) => await cherryPick(b.projectRoot, b.commitHash)))
  router.register("POST", "/git/reset", wrap(async (b) => await reset(b.projectRoot, b.commitHash, b.mode)))
  router.register("POST", "/git/revert", wrap(async (b) => await revert(b.projectRoot, b.commitHash)))
  router.register("POST", "/git/tag", wrap(async (b) => await tag(b.projectRoot, b.tagName, b.message)))
  router.register("POST", "/git/tags", wrap(async (b) => ({ success: true, ...(await listTags(b.projectRoot)) })))
  router.register("POST", "/git/remotes", wrap(async (b) => ({ success: true, ...(await remoteList(b.projectRoot)) })))
  router.register("POST", "/git/remoteAdd", wrap(async (b) => await remoteAdd(b.projectRoot, b.name, b.url)))
  router.register("POST", "/git/remoteRemove", wrap(async (b) => await remoteRemove(b.projectRoot, b.name)))
  router.register("POST", "/git/mergeConflicts", wrap(async (b) => ({ success: true, ...(await getMergeConflicts(b.projectRoot)) })))
  router.register("POST", "/git/resolveConflict", wrap(async (b) => await resolveConflict(b.projectRoot, b.filePath, b.resolvedContent)))
}

module.exports = {
  register,
  runGit,
  status,
  parsePorcelainFile,
  toScmStatus,
}
