/**
 * Issue → PR pipeline.
 *
 * Reads a GitHub issue, asks the LLM to produce a JSON file-change plan,
 * applies it on a new branch via the contents API, and opens a PR.
 *
 * Trigger paths:
 *   - HTTP: POST /github/issue-to-pr { repo, issueNumber, llm }
 *   - Webhook: issue-comment body matches /@codek\s+create\s+pr\s+from\s+issue\s+#(\d+)/i
 */

const { streamChat } = require("../llm")
const ghApi = require("./api")

const MAX_FILES = 12
const PROMPT_HEAD_LIMIT = 12000

const PLAN_PROMPT = `You are an autonomous senior engineer. Read the GitHub issue below and produce a concrete set of file changes that resolve it.

Return ONLY a JSON object with this shape:
{
  "title": "short PR title",
  "body": "PR description in markdown, 1-3 paragraphs",
  "files": [
    { "path": "src/...", "content": "FULL new file content (UTF-8 text)" }
  ]
}

Rules:
- Output the COMPLETE new content of every file you touch. Do NOT use diffs.
- Limit to at most ${MAX_FILES} files.
- Do not include binary files.
- Pick a minimal, focused change. Add tests when relevant.
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

function buildBranchName(issueNumber) {
  const stamp = Date.now().toString(36).slice(-5)
  return `codek/issue-${issueNumber}-${stamp}`
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object") return { ok: false, error: "plan is not an object" }
  if (typeof plan.title !== "string" || !plan.title.trim()) return { ok: false, error: "missing title" }
  if (!Array.isArray(plan.files) || plan.files.length === 0) return { ok: false, error: "no files in plan" }
  if (plan.files.length > MAX_FILES) return { ok: false, error: `too many files (max ${MAX_FILES})` }
  for (const f of plan.files) {
    if (typeof f.path !== "string" || !f.path.trim()) return { ok: false, error: "file missing path" }
    if (typeof f.content !== "string") return { ok: false, error: `file ${f.path} missing content` }
    if (f.path.includes("..") || f.path.startsWith("/")) return { ok: false, error: `unsafe path ${f.path}` }
  }
  return { ok: true }
}

/**
 * Generate a PR from a GitHub issue.
 *
 * @param {object} opts
 * @param {string} opts.repo
 * @param {number} opts.issueNumber
 * @param {string} opts.token
 * @param {object} opts.llm   { provider, model, apiKey?, baseUrl?, temperature? }
 */
async function createPrFromIssue({ repo, issueNumber, token, llm }) {
  if (!repo || !issueNumber || !token) {
    return { success: false, error: "repo/issueNumber/token required" }
  }
  if (!llm || !llm.provider || !llm.model) {
    return { success: false, error: "llm provider+model required" }
  }

  const issue = await ghApi.getIssue(repo, issueNumber, token)
  if (!issue || !issue.title) {
    return { success: false, error: `issue #${issueNumber} not found` }
  }

  const repoInfo = await ghApi.getRepo(repo, token)
  const baseBranch = repoInfo?.default_branch || "main"

  const baseRef = await ghApi.getRef(repo, `heads/${baseBranch}`, token)
  const baseSha = baseRef?.object?.sha
  if (!baseSha) {
    return { success: false, error: `could not resolve ${baseBranch} HEAD` }
  }

  const issueBody = (issue.body || "").slice(0, PROMPT_HEAD_LIMIT)
  const raw = await chatToBuffer({
    provider: llm.provider,
    model: llm.model,
    apiKey: llm.apiKey,
    baseUrl: llm.baseUrl,
    temperature: llm.temperature != null ? llm.temperature : 0.2,
    messages: [
      { role: "system", content: PLAN_PROMPT },
      {
        role: "user",
        content: `Repo: ${repo}\nDefault branch: ${baseBranch}\nIssue #${issueNumber}: ${issue.title}\n\n${issueBody}`,
      },
    ],
  })

  const plan = safeJson(raw)
  const validation = validatePlan(plan)
  if (!validation.ok) {
    return { success: false, error: `bad plan: ${validation.error}`, raw }
  }

  const branch = buildBranchName(issueNumber)
  const branchRes = await ghApi.createBranch(repo, branch, baseSha, token)
  if (branchRes?.message && !branchRes.ref) {
    return { success: false, error: `branch creation failed: ${branchRes.message}` }
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
    const commitMsg = `codek: ${plan.title} (${file.path})`
    const result = await ghApi.putFile(repo, file.path, branch, file.content, commitMsg, token, existingSha)
    if (result?.message && !result.commit) {
      return { success: false, error: `putFile ${file.path} failed: ${result.message}` }
    }
    written.push(file.path)
  }

  const prBody = `${plan.body || ""}

---
Closes #${issueNumber}
Generated by Codek from issue #${issueNumber}.`

  const pr = await ghApi.createPullRequest(repo, {
    title: plan.title,
    body: prBody,
    head: branch,
    base: baseBranch,
  }, token)

  if (!pr || pr.message) {
    return { success: false, error: `PR creation failed: ${pr && pr.message}`, branch, written }
  }

  return {
    success: true,
    prNumber: pr.number,
    prUrl: pr.html_url,
    branch,
    filesWritten: written,
  }
}

const COMMAND_RE = /@codek\s+create\s+pr\s+from\s+issue\s+#(\d+)/i

function parseTriggerComment(commentBody) {
  if (!commentBody) return null
  const m = commentBody.match(COMMAND_RE)
  if (!m) return null
  return { issueNumber: Number(m[1]) }
}

module.exports = { createPrFromIssue, parseTriggerComment }
