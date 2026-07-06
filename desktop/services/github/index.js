/**
 * GitHub Integration — webhook server + review API + Issue→PR flow.
 *
 * The webhook handler now runs the AI diff reviewer directly in the main
 * process so PR reviews don't require an active renderer window.
 */

const ghApi = require("./api")
const { startWebhookServer, stopWebhookServer } = require("./webhook")
const { reviewPullRequest } = require("./diffReviewer")
const { createPrFromIssue, parseTriggerComment } = require("./issueToPr")
const { handleFailedCheck, resetAttempts, MAX_ATTEMPTS } = require("./ciAutoFix")
const ghConfig = require("./config")

let webhookActive = false
// Reviewer config captured when /github/webhook/start is called. Without it
// the webhook can still acknowledge events, but it cannot run AI reviews.
let webhookReviewer = null

function getToken() {
  return process.env.GITHUB_TOKEN || ""
}

function register(router) {
  router.register("POST", "/github/webhook/start", async ({ body }) => {
    if (webhookActive) return { success: true, message: "Already running" }
    const secret = body?.secret || ""
    const port = Number(body?.port) || 3081
    const llm = body?.llm && body.llm.provider && body.llm.model ? body.llm : null
    const autoReview = body?.autoReview !== false  // default on
    webhookReviewer = llm

    startWebhookServer(port, secret, async (event, payload) => {
      try {
        const repo = payload.repository?.full_name
        if (!repo) return

        if (event === "pull_request" && (payload.action === "opened" || payload.action === "synchronize")) {
          const prNumber = payload.pull_request?.number
          if (!prNumber) return
          console.log(`[github] PR #${prNumber} in ${repo} — ${payload.action}`)
          if (!autoReview || !webhookReviewer) return
          const token = getToken()
          if (!token) {
            console.warn("[github] auto-review skipped: GITHUB_TOKEN missing")
            return
          }
          const cfg = await ghConfig.loadRepoConfig(repo, token)
          if (!cfg.autoReview) {
            console.log(`[github] auto-review disabled by .github/codek.yml for ${repo}`)
            return
          }
          const result = await reviewPullRequest({ repo, prNumber, token, llm: webhookReviewer })
          if (result.success) {
            console.log(`[github] posted review for ${repo}#${prNumber} (${result.issueCount} issues)`)
          } else {
            console.warn(`[github] auto-review failed for ${repo}#${prNumber}: ${result.error}`)
          }
          return
        }

        if (event === "check_run" && payload.action === "completed") {
          const checkRun = payload.check_run
          if (!checkRun || checkRun.conclusion !== "failure") return
          const token = getToken()
          if (!token || !webhookReviewer) {
            console.warn("[github] ci-auto-fix skipped: token or llm missing")
            return
          }
          const cfg = await ghConfig.loadRepoConfig(repo, token)
          if (!cfg.autoFixCi) {
            console.log(`[github] ci-auto-fix disabled by .github/codek.yml for ${repo}`)
            return
          }
          console.log(`[github] check_run failed: ${checkRun.name} on ${repo}`)
          const result = await handleFailedCheck({ repo, checkRun, token, llm: webhookReviewer })
          if (result.success) {
            console.log(`[github] ci-auto-fix attempt ${result.attempt}/${MAX_ATTEMPTS} pushed ${result.filesWritten.length} files on ${result.branch}`)
          } else {
            console.warn(`[github] ci-auto-fix failed: ${result.error}`)
          }
          return
        }

        if (event === "issue_comment" && payload.action === "created") {
          const trigger = parseTriggerComment(payload.comment?.body)
          if (!trigger) return
          const issueNumber = trigger.issueNumber || payload.issue?.number
          if (!issueNumber) return
          const token = getToken()
          if (!token || !webhookReviewer) {
            console.warn("[github] issue→PR skipped: token or llm missing")
            return
          }
          const cfg = await ghConfig.loadRepoConfig(repo, token)
          if (!cfg.issueToPr) {
            console.log(`[github] issue→PR disabled by .github/codek.yml for ${repo}`)
            return
          }
          console.log(`[github] @codek triggered: issue #${issueNumber} in ${repo}`)
          const result = await createPrFromIssue({ repo, issueNumber, token, llm: webhookReviewer })
          if (result.success) {
            console.log(`[github] issue→PR created: ${result.prUrl}`)
            await ghApi.createIssueComment(repo, issueNumber, token, `Codek created PR #${result.prNumber}: ${result.prUrl}`)
          } else {
            console.warn(`[github] issue→PR failed: ${result.error}`)
            await ghApi.createIssueComment(repo, issueNumber, token, `Codek failed to create PR: ${result.error}`)
          }
          return
        }
      } catch (e) {
        console.warn("[github] webhook handler error:", e.message)
      }
    })
    webhookActive = true
    return { success: true, autoReview: autoReview && !!webhookReviewer }
  })

  router.register("POST", "/github/webhook/stop", async () => {
    stopWebhookServer()
    webhookActive = false
    webhookReviewer = null
    return { success: true }
  })

  router.register("POST", "/github/review/pr", async ({ body }) => {
    const { repo, prNumber, llm } = body || {}
    const token = getToken()
    if (!token) throw new Error("GitHub token not configured")
    if (!repo || !prNumber) throw new Error("repo and prNumber required")
    if (!llm || !llm.provider || !llm.model) throw new Error("llm.provider and llm.model required")
    const result = await reviewPullRequest({ repo, prNumber, token, llm })
    if (!result.success) throw new Error(result.error || "review failed")
    return result
  })

  router.register("POST", "/github/pr/merge", async ({ body }) => {
    const { repo, prNumber } = body || {}
    const token = getToken()
    if (!token) throw new Error("GitHub token not configured")
    const result = await ghApi.mergePr(repo, prNumber, token)
    return { success: !result.error, result }
  })

  router.register("POST", "/github/ci/auto-fix", async ({ body }) => {
    const { repo, checkRun, llm } = body || {}
    const token = getToken()
    if (!token) throw new Error("GitHub token not configured")
    if (!repo || !checkRun) throw new Error("repo and checkRun required")
    if (!llm || !llm.provider || !llm.model) throw new Error("llm.provider and llm.model required")
    const result = await handleFailedCheck({ repo, checkRun, token, llm })
    if (!result.success) throw new Error(result.error || "ci-auto-fix failed")
    return result
  })

  router.register("POST", "/github/config/load", async ({ body }) => {
    const { repo } = body || {}
    const token = getToken()
    if (!repo) throw new Error("repo required")
    const config = await ghConfig.loadRepoConfig(repo, token)
    return { success: true, config }
  })

  router.register("POST", "/github/config/invalidate", async ({ body }) => {
    const { repo } = body || {}
    if (!repo) throw new Error("repo required")
    ghConfig.invalidateRepo(repo)
    return { success: true }
  })

  router.register("POST", "/github/ci/reset-attempts", async ({ body }) => {
    const { repo, branch } = body || {}
    if (!repo || !branch) throw new Error("repo and branch required")
    resetAttempts(repo, branch)
    return { success: true }
  })

  router.register("POST", "/github/pr/create-from-issue", async ({ body }) => {
    const { repo, issueNumber, llm } = body || {}
    const token = getToken()
    if (!token) throw new Error("GitHub token not configured")
    if (!repo || !issueNumber) throw new Error("repo and issueNumber required")
    if (!llm || !llm.provider || !llm.model) throw new Error("llm.provider and llm.model required")
    const result = await createPrFromIssue({ repo, issueNumber: Number(issueNumber), token, llm })
    if (!result.success) throw new Error(result.error || "issue→PR failed")
    return result
  })
}

module.exports = { register }
