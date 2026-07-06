/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code file search matching:
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\common\search.ts
 * - D:\SourceMirror\vscode\src\vs\base\common\strings.ts
 * - D:\SourceMirror\vscode\src\vs\base\common\fuzzyScorer.ts
 *--------------------------------------------------------------------------------------------*/

const path = require("path")

function isFilePatternMatch(candidate, filePatternToUse, fuzzy = true, ignoreCase = true) {
  const pattern = normalizeFilePattern(filePatternToUse, ignoreCase)
  if (!pattern) return true
  if (pattern === "*") return true

  const pathToMatch = candidatePath(candidate)
  if (!pathToMatch) return false
  const normalizedPath = normalizeSearchPath(pathToMatch, ignoreCase)
  return fuzzy
    ? fuzzyContains(normalizedPath, pattern)
    : globFilePatternMatch(pattern, normalizedPath, ignoreCase)
}

function compareFilePatternMatches(filePatternToUse, left, right) {
  const pattern = normalizeFilePattern(filePatternToUse, true)
  if (!pattern) return comparePaths(left, right)
  const leftScore = scoreFilePatternMatch(left, pattern)
  const rightScore = scoreFilePatternMatch(right, pattern)
  if (leftScore !== rightScore) return rightScore - leftScore
  const leftLabelLength = path.posix.basename(normalizeSearchPath(candidatePath(left), true)).length
  const rightLabelLength = path.posix.basename(normalizeSearchPath(candidatePath(right), true)).length
  if (leftLabelLength !== rightLabelLength) return leftLabelLength - rightLabelLength
  const leftPathLength = normalizeSearchPath(candidatePath(left), true).length
  const rightPathLength = normalizeSearchPath(candidatePath(right), true).length
  if (leftPathLength !== rightPathLength) return leftPathLength - rightPathLength
  return comparePaths(left, right)
}

function scoreFilePatternMatch(candidate, normalizedPattern) {
  const normalizedPath = normalizeSearchPath(candidatePath(candidate), true)
  const basename = path.posix.basename(normalizedPath)
  if (!normalizedPath || !normalizedPattern) return 0
  if (normalizedPath === normalizedPattern) return 1000
  if (basename === normalizedPattern) return 950
  if (basename.startsWith(normalizedPattern)) return 850 - Math.max(0, basename.length - normalizedPattern.length)
  if (normalizedPath.startsWith(normalizedPattern)) return 800 - Math.max(0, normalizedPath.length - normalizedPattern.length)
  if (basename.includes(normalizedPattern)) return 700 - basename.indexOf(normalizedPattern)
  if (normalizedPath.includes(normalizedPattern)) return 650 - normalizedPath.indexOf(normalizedPattern)
  if (fuzzyContains(basename, normalizedPattern)) return 500 - fuzzyDistance(basename, normalizedPattern)
  if (fuzzyContains(normalizedPath, normalizedPattern)) return 400 - fuzzyDistance(normalizedPath, normalizedPattern)
  return 0
}

function fuzzyContains(target, query) {
  if (!target || !query) return false
  if (target.length < query.length) return false
  const queryLen = query.length
  const targetLower = target.toLowerCase()
  const queryLower = query.toLowerCase()
  let index = 0
  let lastIndexOf = -1
  while (index < queryLen) {
    const indexOf = targetLower.indexOf(queryLower[index], lastIndexOf + 1)
    if (indexOf < 0) return false
    lastIndexOf = indexOf
    index += 1
  }
  return true
}

function fuzzyDistance(target, query) {
  const targetLower = String(target || "").toLowerCase()
  const queryLower = String(query || "").toLowerCase()
  let index = 0
  let first = -1
  let last = -1
  for (let targetIndex = 0; targetIndex < targetLower.length && index < queryLower.length; targetIndex += 1) {
    if (targetLower[targetIndex] !== queryLower[index]) continue
    if (first < 0) first = targetIndex
    last = targetIndex
    index += 1
  }
  if (index < queryLower.length) return Number.POSITIVE_INFINITY
  return Math.max(0, last - first + 1 - queryLower.length) + Math.max(0, first)
}

function globFilePatternMatch(pattern, normalizedPath, ignoreCase = true) {
  const source = normalizeSearchPath(pattern, ignoreCase)
  const target = normalizeSearchPath(normalizedPath, ignoreCase)
  const regex = new RegExp(`^${globToRegExp(source)}$`, ignoreCase ? "i" : "")
  return regex.test(target)
}

function globToRegExp(pattern) {
  let source = ""
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    const next = pattern[index + 1]
    if (char === "*" && next === "*") {
      source += ".*"
      index += 1
    } else if (char === "*") {
      source += "[^/]*"
    } else if (char === "?") {
      source += "[^/]"
    } else {
      source += escapeRegExp(char)
    }
  }
  return source
}

function candidatePath(candidate) {
  if (typeof candidate === "string") return candidate
  return candidate?.searchPath || candidate?.relativePath || candidate?.path || candidate?.file || ""
}

function normalizeFilePattern(value, ignoreCase = true) {
  return normalizeSearchPath(value, ignoreCase).trim()
}

function normalizeSearchPath(value, ignoreCase = true) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "")
  return ignoreCase ? normalized.toLowerCase() : normalized
}

function comparePaths(left, right) {
  return normalizeSearchPath(candidatePath(left), true).localeCompare(normalizeSearchPath(candidatePath(right), true))
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

module.exports = {
  compareFilePatternMatches,
  fuzzyContains,
  isFilePatternMatch,
  normalizeFilePattern,
  scoreFilePatternMatch,
}
