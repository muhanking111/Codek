/**
 * CI Auto-Fix — when a check_run completes with failure, fetch the run logs,
 * feed them to the LLM with the latest commit context, and push a fix commit.
 *
 * Hard-capped at MAX_ATTEMPTS per branch so a broken model doesn't loop.
 */

const { streamChat } = require("../llm")
const ghApi = require("./api")

const MAX_ATTEMPTS = 3
const LOG_TAIL_LIMIT = 6000
const MAX_FILES_PER_FIX = 6

const attempts = new Map()

function getAttempts(branchKey) {
  return attempts.get(branchKey) || 0
}

function bumpAttempts(branchKey) {
  const next = getAttempts(branchKey) + 1
  attempts.set(branchKey, next)
  return next
}

const FIX_PROMPT = `You are an autonomous senior engineer. A CI run on the branch below failed. Inspect the failure log and produce a focused patch that makes CI pass.

Return ONLY a JSON object with this shape:
{
  "summary": "short description of the fix",
  "files": [
    { "path": "src/...", "content": "FULL new file content (UTF-8 text)" }
  ]
}

Rules:
- Output the COMPLETE new content of every file you touch. Do NOT use diffs.
- Limit to at most ${MAX_FILES_PER_FIX} files.
- Touch only the minimum needed to make the failing check pass.
- Respond with ONLY the JSON object. No markdown fences, no prose.`

function safeJson(raw) {
  const text = (raw || "").trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) } catch { return null }
}

async function chatToBuffer(request) {
  let buf = ""
  await streamChat(request, (payload) => {
    if (payload && typeof payload.content === "string") buf += payload.content
  })
  return buf
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object") return false
  if (!Array.isArray(plan.files) || plan.files.length === 0) return false
  if (plan.files.length > MAX_FILES_PER_FIX) return false
  return plan.files.every(
    (f) =>
      typeof f.path === "string" &&
      f.path.trim() &&
      !f.path.includes("..") &&
      !f.path.startsWith("/") &&
      typeof f.content === "string",
  )
}

/**
 * Handle a failed check_run.completed payload.
 *
 * @param {object} opts
 * @param {string} opts.repo
 * @param {object} opts.checkRun       - payload.check_run
 * @param {string} opts.token
 * @param {object} opts.llm
 */
async function handleFailedCheck({ repo, checkRun, token, llm }) {
  if (!checkRun || checkRun.conclusion !== "failure") {
    return { success: false, error: "not a failed check_run" }
  }
  const branch = checkRun.check_suite?.head_branch
  const headSha = checkRun.head_sha
  if (!branch || !headSha) {
    return { success: false, error: "missing branch/headSha" }
  }
  const branchKey = `${repo}@${branch}`
  const count = getAttempts(branchKey)
  if (count >= MAX_ATTEMPTS) {
    return { success: false, error: `max ${MAX_ATTEMPTS} attempts exceeded`, branch }
  }
  bumpAttempts(branchKey)

  let logTail = ""
  try {
    const logs = await ghApi.getCheckRunLogs(repo, checkRun.id, token)
    if (typeof logs === "string") logTail = logs.slice(-LOG_TAIL_LIMIT)
    else if (logs && typeof logs.body === "string") logTail = logs.body.slice(-LOG_TAIL_LIMIT)
  } catch (err) {
    logTail = `(log fetch failed: ${err.message})`
  }

  const raw = await chatToBuffer({
    provider: llm.provider,
    model: llm.model,
    apiKey: llm.apiKey,
    baseUrl: llm.baseUrl,
    temperature: llm.temperature != null ? llm.temperature : 0.2,
    messages: [
      { role: "system", content: FIX_PROMPT },
      {
        role: "user",
        content: `Repo: ${repo}\nBranch: ${branch}\nFailed check: ${checkRun.name}\nAttempt: ${count + 1}/${MAX_ATTEMPTS}\n\nLog tail:\n${logTail}`,
      },
    ],
  })

  const plan = safeJson(raw)
  if (!validatePlan(plan)) {
    return { success: false, error: "invalid plan from model", raw }
  }

  const written = []
  for (const file of plan.files) {
    let existingSha
    try {
      const existing = await ghApi.getFileContent(repo, file.path, branch, token)
      existingSha = existing && !existing.message ? existing.sha : undefined
    } catch {
      existingSha = undefined
    }
    const msg = `codek(ci-fix): ${plan.summary || "auto-fix"} — ${file.path}`
    const res = await ghApi.putFile(repo, file.path, branch, file.content, msg, token, existingSha)
    if (res?.message && !res.commit) {
      return { success: false, error: `putFile ${file.path} failed: ${res.message}` }
    }
    written.push(file.path)
  }

  return {
    success: true,
    branch,
    attempt: count + 1,
    filesWritten: written,
    summary: plan.summary || "",
  }
}

function resetAttempts(repo, branch) {
  attempts.delete(`${repo}@${branch}`)
}

module.exports = { handleFailedCheck, resetAttempts, MAX_ATTEMPTS }
