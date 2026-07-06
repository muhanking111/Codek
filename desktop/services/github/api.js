/**
 * GitHub API Client — REST API wrapper using OAuth token.
 */

const https = require("https")

const API_BASE = "https://api.github.com"

function ghRequest(method, pathname, token, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      hostname: "api.github.com",
      path: pathname,
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Codek",
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
    const req = https.request(opts, (res) => {
      let data = ""
      res.on("data", (c) => { data += c })
      res.on("end", () => {
        try { resolve(JSON.parse(data)) }
        catch { resolve({ error: data }) }
      })
    })
    req.on("error", reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

async function getPrDiff(repo, prNumber, token) {
  const res = await ghRequest("GET", `/repos/${repo}/pulls/${prNumber}`, token)
  if (res.diff_url) {
    return new Promise((resolve, reject) => {
      https.get(res.diff_url, { headers: { Authorization: `Bearer ${token}`, "User-Agent": "Codek" } }, (r) => {
        let d = ""
        r.on("data", (c) => { d += c })
        r.on("end", () => resolve(d))
      }).on("error", reject)
    })
  }
  return ""
}

async function createReview(repo, prNumber, token, comments, event) {
  return ghRequest("POST", `/repos/${repo}/pulls/${prNumber}/reviews`, token, {
    body: "Codek AI Review",
    comments,
    event: event || "COMMENT",
  })
}

async function mergePr(repo, prNumber, token) {
  return ghRequest("PUT", `/repos/${repo}/pulls/${prNumber}/merge`, token)
}

async function createIssueComment(repo, issueNumber, token, body) {
  return ghRequest("POST", `/repos/${repo}/issues/${issueNumber}/comments`, token, { body })
}

async function listPullRequests(repo, token, state = "open") {
  return ghRequest("GET", `/repos/${repo}/pulls?state=${state}`, token)
}

async function getIssue(repo, issueNumber, token) {
  return ghRequest("GET", `/repos/${repo}/issues/${issueNumber}`, token)
}

async function getRepo(repo, token) {
  return ghRequest("GET", `/repos/${repo}`, token)
}

async function getRef(repo, ref, token) {
  return ghRequest("GET", `/repos/${repo}/git/ref/${ref}`, token)
}

async function createBranch(repo, newBranch, fromSha, token) {
  return ghRequest("POST", `/repos/${repo}/git/refs`, token, {
    ref: `refs/heads/${newBranch}`,
    sha: fromSha,
  })
}

async function getFileContent(repo, filePath, ref, token) {
  const path = `/repos/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(ref)}`
  return ghRequest("GET", path, token)
}

async function putFile(repo, filePath, branch, content, message, token, sha) {
  const payload = {
    message,
    branch,
    content: Buffer.from(content, "utf8").toString("base64"),
  }
  if (sha) payload.sha = sha
  return ghRequest("PUT", `/repos/${repo}/contents/${encodeURIComponent(filePath)}`, token, payload)
}

async function createPullRequest(repo, { title, body, head, base }, token) {
  return ghRequest("POST", `/repos/${repo}/pulls`, token, { title, body, head, base })
}

async function getCheckRuns(repo, ref, token) {
  return ghRequest("GET", `/repos/${repo}/commits/${ref}/check-runs`, token)
}

async function getCheckRunLogs(repo, runId, token) {
  return ghRequest("GET", `/repos/${repo}/actions/jobs/${runId}/logs`, token)
}

module.exports = {
  getPrDiff,
  createReview,
  mergePr,
  createIssueComment,
  listPullRequests,
  getIssue,
  getRepo,
  getRef,
  createBranch,
  getFileContent,
  putFile,
  createPullRequest,
  getCheckRuns,
  getCheckRunLogs,
}
