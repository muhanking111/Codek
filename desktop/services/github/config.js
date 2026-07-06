/**
 * .github/codek.yml loader.
 *
 * Pulls a per-repo config file from the default branch via the Contents API
 * and parses a minimal YAML subset (no anchors, no nested arrays of maps).
 *
 * Schema:
 *   autoReview: true                # run AI review on PR open/sync
 *   autoFixCi: true                 # push fix commits when checks fail
 *   issueToPr: true                 # honor `@codek create pr from issue #N`
 *   blockingRules:                  # categories that block merge
 *     - security
 *     - bug
 *   maxIssues: 10                   # cap for review issues
 *   ignorePaths:                    # globs the reviewer should skip
 *     - "dist/**"
 *     - "*.lock"
 *   reviewers:                      # GitHub handles to request review from
 *     - octocat
 */

const ghApi = require("./api")

const CONFIG_PATH = ".github/codek.yml"
const CACHE_TTL_MS = 60_000

const DEFAULTS = Object.freeze({
  autoReview: true,
  autoFixCi: true,
  issueToPr: true,
  blockingRules: ["security"],
  maxIssues: 10,
  ignorePaths: [],
  reviewers: [],
})

const cache = new Map() // repo -> { fetchedAt, config }

/**
 * Minimal YAML parser — handles only the schema above:
 *  - top-level `key: value` (string | boolean | number)
 *  - top-level `key:` followed by `- item` bullet list
 * Anything else is ignored. We avoid pulling a full YAML dep just for this.
 */
function parseYaml(text) {
  const out = {}
  if (!text || typeof text !== "string") return out
  const lines = text.split(/\r?\n/)
  let currentKey = null
  let currentList = null

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trimEnd()
    if (!line.trim()) continue

    const listMatch = line.match(/^\s+-\s+(.*)$/)
    if (listMatch && currentList) {
      const v = listMatch[1].replace(/^["']|["']$/g, "").trim()
      if (v) currentList.push(v)
      continue
    }

    const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/)
    if (kvMatch) {
      const key = kvMatch[1]
      const value = kvMatch[2].trim()
      if (!value) {
        currentKey = key
        currentList = []
        out[key] = currentList
        continue
      }
      currentList = null
      currentKey = null
      const cleaned = value.replace(/^["']|["']$/g, "")
      if (cleaned === "true") out[key] = true
      else if (cleaned === "false") out[key] = false
      else if (/^-?\d+(\.\d+)?$/.test(cleaned)) out[key] = Number(cleaned)
      else out[key] = cleaned
    }
  }
  return out
}

function mergeWithDefaults(parsed) {
  const cfg = { ...DEFAULTS }
  for (const k of Object.keys(parsed || {})) {
    cfg[k] = parsed[k]
  }
  return cfg
}

async function loadRepoConfig(repo, token) {
  if (!repo) return { ...DEFAULTS }
  const cached = cache.get(repo)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.config
  }

  let config = { ...DEFAULTS }
  try {
    const repoInfo = await ghApi.getRepo(repo, token)
    const branch = repoInfo?.default_branch || "main"
    const file = await ghApi.getFileContent(repo, CONFIG_PATH, branch, token)
    if (file && !file.message && typeof file.content === "string") {
      const raw = Buffer.from(file.content, "base64").toString("utf8")
      config = mergeWithDefaults(parseYaml(raw))
    }
  } catch {
    // missing file or fetch error — fall back to defaults silently
  }

  cache.set(repo, { fetchedAt: Date.now(), config })
  return config
}

function invalidateRepo(repo) {
  cache.delete(repo)
}

function hasBlockingIssue(issues, blockingRules) {
  if (!Array.isArray(issues) || !blockingRules?.length) return false
  return issues.some((i) => i && blockingRules.includes(i.category))
}

function pathIsIgnored(path, ignoreGlobs) {
  if (!path || !ignoreGlobs?.length) return false
  for (const glob of ignoreGlobs) {
    const re = new RegExp(
      "^" + glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, ".") + "$",
    )
    if (re.test(path)) return true
  }
  return false
}

module.exports = {
  DEFAULTS,
  loadRepoConfig,
  invalidateRepo,
  hasBlockingIssue,
  pathIsIgnored,
  parseYaml,
}
