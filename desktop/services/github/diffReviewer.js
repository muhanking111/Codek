/**
 * GitHub diff reviewer — runs in the main process so the webhook can post
 * AI-generated review comments back to GitHub without going through the
 * renderer. Mirrors the JSON contract from frontend/src/ai/codeReviewer.ts.
 */

const { streamChat } = require("../llm")
const ghApi = require("./api")
const ghConfig = require("./config")

const MAX_ISSUES = 10
const DIFF_HEAD_LIMIT = 8000

const REVIEW_DIFF_PROMPT = `You are a senior code reviewer. Review the following git diff for security vulnerabilities, performance issues, bugs, code style problems, and architecture concerns.

Return ONLY a JSON array of objects with these exact fields:
- "path": string (file path the issue applies to, taken from the diff header)
- "line": number (line number within the diff, 1-based)
- "message": string (concise description)
- "severity": one of "error", "warning", "info"
- "category": one of "security", "performance", "bug", "style", "architecture"
- "suggestion": string (specific fix recommendation)

Focus on changed lines. Include at most ${MAX_ISSUES} issues.
Respond with ONLY the JSON array. No markdown, no prose outside the JSON.`

async function chatToBuffer(request) {
  let buf = ""
  await streamChat(request, (payload) => {
    if (payload && typeof payload.content === "string") buf += payload.content
  })
  return buf
}

function parseIssues(raw) {
  const trimmed = (raw || "").trim()
  if (!trimmed) return []
  const match = trimmed.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((i) => i && typeof i.message === "string" && i.message.trim())
      .slice(0, MAX_ISSUES)
      .map((i) => ({
        path: typeof i.path === "string" ? i.path : "",
        line: Math.max(1, Number(i.line) || 1),
        message: String(i.message).trim(),
        severity: ["error", "warning", "info"].includes(i.severity) ? i.severity : "warning",
        category: ["security", "performance", "bug", "style", "architecture"].includes(i.category)
          ? i.category
          : "style",
        suggestion: typeof i.suggestion === "string" ? i.suggestion.trim() : "",
      }))
  } catch {
    return []
  }
}

/**
 * Render an issue list as a single markdown summary comment.
 * GitHub line-level review comments require diff-side positions that we cannot
 * reliably compute from a raw diff string, so we post a summary comment instead.
 */
function renderSummary(issues, prInfo) {
  const head = `### Codek AI Review — ${prInfo.repo}#${prInfo.prNumber}`
  if (!issues.length) {
    return [head, "", "No issues found. ✅"].join("\n")
  }
  const verdict = prInfo.blocking
    ? "🚫 Changes requested — blocking issues found"
    : "💬 Comment-only review"
  const lines = [
    head,
    verdict,
    `Found **${issues.length}** issue${issues.length === 1 ? "" : "s"}:`,
    "",
  ]
  const byCat = new Map()
  for (const issue of issues) {
    if (!byCat.has(issue.category)) byCat.set(issue.category, [])
    byCat.get(issue.category).push(issue)
  }
  for (const [cat, items] of byCat) {
    lines.push(`#### ${cat} (${items.length})`)
    for (const i of items) {
      const sev = i.severity === "error" ? "🔴" : i.severity === "warning" ? "🟡" : "🔵"
      const loc = i.path ? `\`${i.path}\`${i.line ? `:${i.line}` : ""}` : ""
      lines.push(`- ${sev} ${loc} — ${i.message}`)
      if (i.suggestion) lines.push(`  - Fix: ${i.suggestion}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

/**
 * Run a review on a single PR. Pulls the diff, asks the configured LLM to
 * critique it, and posts a single COMMENT review with a markdown summary.
 *
 * @param {object} opts
 * @param {string} opts.repo               - "owner/name"
 * @param {number} opts.prNumber
 * @param {string} opts.token              - GitHub OAuth token
 * @param {object} opts.llm                - { provider, model, apiKey?, baseUrl?, temperature? }
 */
async function reviewPullRequest({ repo, prNumber, token, llm }) {
  if (!repo || !prNumber || !token) {
    return { success: false, error: "repo/prNumber/token required" }
  }
  if (!llm || !llm.provider || !llm.model) {
    return { success: false, error: "llm provider+model required" }
  }

  const diff = await ghApi.getPrDiff(repo, prNumber, token)
  if (!diff) return { success: false, error: "empty diff" }

  const config = await ghConfig.loadRepoConfig(repo, token)

  const raw = await chatToBuffer({
    provider: llm.provider,
    model: llm.model,
    apiKey: llm.apiKey,
    baseUrl: llm.baseUrl,
    temperature: llm.temperature != null ? llm.temperature : 0.2,
    messages: [
      { role: "system", content: REVIEW_DIFF_PROMPT },
      { role: "user", content: `Repo: ${repo}\nPR: #${prNumber}\n\nDiff:\n\`\`\`diff\n${diff.slice(0, DIFF_HEAD_LIMIT)}\n\`\`\`` },
    ],
  })

  const allIssues = parseIssues(raw)
  const issues = allIssues.filter((i) => !ghConfig.pathIsIgnored(i.path, config.ignorePaths))
  const blocking = ghConfig.hasBlockingIssue(issues, config.blockingRules)
  const reviewEvent = blocking ? "REQUEST_CHANGES" : (issues.length === 0 ? "APPROVE" : "COMMENT")
  const summary = renderSummary(issues, { repo, prNumber, blocking, reviewEvent })

  await ghApi.createReview(repo, prNumber, token, [], reviewEvent)
  await ghApi.createIssueComment(repo, prNumber, token, summary)
  return { success: true, issueCount: issues.length, summary, reviewEvent, blocking, config }
}

module.exports = { reviewPullRequest, parseIssues, renderSummary }
