/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code search query flow:
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\common\queryBuilder.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\common\fileSearchManager.ts
 *--------------------------------------------------------------------------------------------*/

const DEFAULT_MAX_RESULTS = 500
const DEFAULT_MAX_SEARCH_RESULTS = 5000
const MAX_RESULT_LIMIT = 5000
const MAX_VISITED_FILE_LIMIT = 50_000

function createSearchQueryPlan({
  query = "",
  include,
  exclude,
  regex,
  caseSensitive,
  wholeWord,
  maxResults,
  maxVisitedFiles,
  budgets = {},
  compileTextPattern = true,
} = {}) {
  const resultLimit = Math.min(
    normalizePositiveInteger(maxResults, DEFAULT_MAX_RESULTS),
    normalizePositiveInteger(budgets.searchMaxResults, DEFAULT_MAX_SEARCH_RESULTS),
    MAX_RESULT_LIMIT,
  )
  const visitedFileLimit = Math.min(
    normalizePositiveInteger(maxVisitedFiles, normalizePositiveInteger(budgets.searchMaxVisitedFiles, MAX_VISITED_FILE_LIMIT)),
    MAX_VISITED_FILE_LIMIT,
  )

  const includeExpression = buildSearchPatternExpression(include)
  const excludeExpression = buildSearchPatternExpression(exclude)
  const includeMatcher = includeExpression ? parseGlobExpression(includeExpression) : null
  const excludeMatcher = excludeExpression ? parseGlobExpression(excludeExpression) : null

  let textPattern = null
  let error = null
  if (compileTextPattern) {
    try {
      textPattern = compileTextSearchPattern(query, { regex, caseSensitive, wholeWord })
    } catch (err) {
      error = err
    }
  }

  return {
    resultLimit,
    visitedFileLimit,
    textPattern,
    error,
    includeExpression,
    excludeExpression,
    matchesPath(relativePath) {
      const normalizedPath = normalizeSearchPath(relativePath)
      const basename = getBasename(normalizedPath)
      if (includeMatcher && !includeMatcher(normalizedPath, basename)) return false
      if (excludeMatcher && excludeMatcher(normalizedPath, basename)) return false
      return true
    },
    shouldStop(resultCount, visitedFiles) {
      return resultCount >= resultLimit || visitedFiles >= visitedFileLimit
    },
  }
}

function compileTextSearchPattern(pattern, { regex, caseSensitive, wholeWord } = {}) {
  const flags = caseSensitive ? "g" : "gi"
  let source = String(pattern || "")
  if (!regex) source = escapeRegExp(source)
  if (wholeWord) source = `\\b${source}\\b`
  return new RegExp(source, flags)
}

function buildSearchPatternExpression(input) {
  const patterns = normalizeSearchPatterns(input)
    .filter((pattern) => pattern !== "*" && pattern !== "**" && pattern !== "**/*")
    .flatMap((pattern) => expandSearchGlob(pattern))
  if (!patterns.length) return null
  return patterns.reduce((expression, pattern) => {
    expression[pattern] = true
    return expression
  }, Object.create(null))
}

function normalizeSearchPatterns(input) {
  const rawPatterns = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? splitGlobPattern(input)
      : []
  return rawPatterns
    .map((pattern) => normalizeSearchPath(String(pattern || "").trim()))
    .filter(Boolean)
    .filter((pattern) => !pattern.split("/").includes(".."))
}

function splitGlobPattern(pattern) {
  const segments = []
  let inBraces = 0
  let inBrackets = 0
  let current = ""
  for (const char of String(pattern || "")) {
    if (char === "," && inBraces === 0 && inBrackets === 0) {
      if (current.trim()) segments.push(current.trim())
      current = ""
      continue
    }
    if (char === "{") inBraces += 1
    else if (char === "}" && inBraces > 0) inBraces -= 1
    else if (char === "[") inBrackets += 1
    else if (char === "]" && inBrackets > 0) inBrackets -= 1
    current += char
  }
  if (current.trim()) segments.push(current.trim())
  return segments
}

function expandSearchGlob(pattern) {
  let normalized = normalizeSearchPath(pattern)
  if (!normalized) return []
  if (normalized[0] === ".") normalized = `*${normalized}`
  return [
    `**/${normalized}/**`,
    `**/${normalized}`,
  ].map((value) => value.replace(/\*\*\/\*\*/g, "**"))
}

function parseGlobExpression(expression) {
  const matchers = Object.entries(expression || {})
    .filter(([, value]) => value !== false)
    .map(([pattern]) => parseGlobPattern(pattern))
  return (relativePath, basename) => matchers.some((matcher) => matcher(relativePath, basename))
}

function parseGlobPattern(pattern) {
  const normalizedPattern = normalizeSearchPath(pattern)
  const regex = new RegExp(`^${globToRegExp(normalizedPattern)}$`, "i")
  const basenameRegex = !normalizedPattern.includes("/")
    ? new RegExp(`^${globToRegExp(normalizedPattern)}$`, "i")
    : null
  return (relativePath, basename) => {
    const normalizedPath = normalizeSearchPath(relativePath)
    regex.lastIndex = 0
    if (regex.test(normalizedPath)) return true
    if (basenameRegex) {
      basenameRegex.lastIndex = 0
      return basenameRegex.test(basename || getBasename(normalizedPath))
    }
    return false
  }
}

function globToRegExp(pattern) {
  let source = ""
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    const next = pattern[index + 1]
    const afterNext = pattern[index + 2]
    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?"
      index += 2
      continue
    }
    if (char === "*" && next === "*") {
      source += ".*"
      index += 1
      continue
    }
    if (char === "*") {
      source += "[^/]*"
      continue
    }
    if (char === "?") {
      source += "[^/]"
      continue
    }
    if (char === "{") {
      const closeIndex = findClosing(pattern, index, "{", "}")
      if (closeIndex > index) {
        const body = pattern.slice(index + 1, closeIndex)
        const choices = splitGlobPattern(body).map((choice) => globToRegExp(choice))
        source += `(?:${choices.join("|")})`
        index = closeIndex
        continue
      }
    }
    if (char === "[") {
      const closeIndex = findClosing(pattern, index, "[", "]")
      if (closeIndex > index) {
        const body = pattern.slice(index + 1, closeIndex).replace(/\\/g, "\\\\")
        source += `[${body}]`
        index = closeIndex
        continue
      }
    }
    source += escapeRegExp(char)
  }
  return source
}

function findClosing(value, start, openChar, closeChar) {
  let depth = 0
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === openChar) depth += 1
    else if (value[index] === closeChar) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function normalizeSearchPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "")
}

function getBasename(value) {
  const normalized = normalizeSearchPath(value)
  const index = normalized.lastIndexOf("/")
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Math.trunc(Number(value))
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

module.exports = {
  createSearchQueryPlan,
  compileTextSearchPattern,
  buildSearchPatternExpression,
  normalizeSearchPatterns,
  splitGlobPattern,
}
