/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code file search rg flow:
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\node\ripgrepFileSearch.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\node\fileSearch.ts
 *--------------------------------------------------------------------------------------------*/

const { spawn } = require("child_process")
const { StringDecoder } = require("string_decoder")
const { findRipgrepPath, performBraceExpansionForRipgrep } = require("./ripgrepSearchAdapter")
const { isFilePatternMatch } = require("./filePatternMatcher")

const DEFAULT_MAX_FILE_RESULTS = 5000

async function runRipgrepFileSearch({
  root,
  queryPlan,
  ignoredGlobs = [],
  rgPath,
  numThreads,
  followSymlinks = true,
  disregardIgnoreFiles = true,
  disregardParentIgnoreFiles = false,
  disregardGlobalIgnoreFiles = false,
  signal,
  shouldIncludePath,
  filePattern,
  shouldGlobMatchFilePattern,
  sortByScore,
} = {}) {
  const resolvedRgPath = findRipgrepPath(rgPath ? [rgPath] : [])
  if (!resolvedRgPath || !root || !queryPlan) return null

  const args = buildRipgrepFileArgs({
    includePatterns: expressionKeys(queryPlan.includeExpression),
    excludePatterns: [...expressionKeys(queryPlan.excludeExpression), ...ignoredGlobs],
    numThreads,
    followSymlinks,
    disregardIgnoreFiles,
    disregardParentIgnoreFiles,
    disregardGlobalIgnoreFiles,
  })

  return new Promise((resolve, reject) => {
    const parser = new RipgrepFileParser({
      maxResults: sortByScore ? Number.POSITIVE_INFINITY : (queryPlan.resultLimit || DEFAULT_MAX_FILE_RESULTS),
      maxVisitedFiles: queryPlan.visitedFileLimit,
      matchesPath: queryPlan.matchesPath,
      shouldIncludePath,
      filePattern,
      shouldGlobMatchFilePattern,
    })
    let stderr = ""
    let settled = false
    const rg = spawn(resolvedRgPath, args, {
      cwd: root,
      windowsHide: true,
    })

    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const cancel = () => {
      parser.cancel()
      rg.kill()
      const error = new Error("Search cancelled")
      error.name = "AbortError"
      fail(error)
    }

    rg.on("error", fail)
    if (signal?.aborted) {
      cancel()
      return
    }
    signal?.addEventListener?.("abort", cancel, { once: true })
    rg.stdout.on("data", (chunk) => {
      try {
        parser.handleData(chunk)
        if (parser.hitLimit) rg.kill()
      } catch (error) {
        rg.kill()
        fail(error)
      }
    })
    rg.stderr.on("data", (chunk) => {
      const text = chunk.toString()
      if (stderr.length + text.length < 1_000_000) stderr += text
    })
    rg.on("close", (code) => {
      signal?.removeEventListener?.("abort", cancel)
      if (settled) return
      try {
        parser.flush()
      } catch (error) {
        fail(error)
        return
      }
      if (code && code !== 1 && !parser.hitLimit) {
        const error = new Error(rgFileErrorMessage(stderr) || `ripgrep file search exited with code ${code}`)
        error.code = code
        fail(error)
        return
      }

      finish({
        matches: parser.matches,
        truncated: parser.hitLimit,
        visitedFiles: parser.visitedFiles,
        visitedDirs: 0,
        visitedLimit: queryPlan.visitedFileLimit,
        skippedLargeFiles: 0,
        engine: "ripgrep-files",
        rgPath: resolvedRgPath,
      })
    })
  })
}

function buildRipgrepFileArgs({
  includePatterns = [],
  excludePatterns = [],
  numThreads,
  followSymlinks = true,
  disregardIgnoreFiles = true,
  disregardParentIgnoreFiles = false,
  disregardGlobalIgnoreFiles = false,
} = {}) {
  const args = ["--files", "--hidden", "--case-sensitive", "--no-require-git"]

  if (process.platform === "win32") {
    args.push("--glob-case-insensitive")
    args.push("--ignore-file-case-insensitive")
  }

  for (const include of uniqueStrings(includePatterns)) {
    for (const globArg of performBraceExpansionForRipgrep(include)) {
      args.push("-g", anchorGlob(globArg))
    }
  }

  for (const exclude of uniqueStrings(excludePatterns)) {
    for (const globArg of performBraceExpansionForRipgrep(exclude)) {
      args.push("-g", `!${anchorGlob(globArg)}`)
    }
  }

  if (disregardIgnoreFiles !== false) {
    args.push("--no-ignore")
  } else if (disregardParentIgnoreFiles !== false) {
    args.push("--no-ignore-parent")
  }
  if (disregardGlobalIgnoreFiles) args.push("--no-ignore-global")
  if (followSymlinks) args.push("--follow")
  if (numThreads && Number.isFinite(Number(numThreads)) && Number(numThreads) > 0) {
    args.push("--threads", String(Math.trunc(Number(numThreads))))
  }
  args.push("--no-config")
  return args
}

class RipgrepFileParser {
  constructor({
    maxResults = DEFAULT_MAX_FILE_RESULTS,
    maxVisitedFiles,
    matchesPath,
    shouldIncludePath,
    filePattern,
    shouldGlobMatchFilePattern,
  } = {}) {
    this.maxResults = maxResults
    this.maxVisitedFiles = Number.isFinite(Number(maxVisitedFiles)) && Number(maxVisitedFiles) > 0
      ? Math.trunc(Number(maxVisitedFiles))
      : Number.POSITIVE_INFINITY
    this.matchesPath = typeof matchesPath === "function" ? matchesPath : () => true
    this.shouldIncludePath = typeof shouldIncludePath === "function" ? shouldIncludePath : () => true
    this.filePattern = String(filePattern || "").trim()
    this.shouldGlobMatchFilePattern = shouldGlobMatchFilePattern === true
    this.decoder = new StringDecoder("utf8")
    this.remainder = ""
    this.matches = []
    this.seenPaths = new Set()
    this.visitedFiles = 0
    this.hitLimit = false
    this.cancelled = false
  }

  cancel() {
    this.hitLimit = true
    this.cancelled = true
  }

  handleData(chunk) {
    if (this.hitLimit) return
    const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk)
    this.handleDecodedData(text)
  }

  flush() {
    this.handleDecodedData(this.decoder.end())
    if (this.remainder) {
      this.handleLine(stripCarriageReturn(this.remainder))
      this.remainder = ""
    }
  }

  handleDecodedData(decodedData) {
    const data = this.remainder + decodedData
    let start = 0
    let newlineIndex = data.indexOf("\n")
    while (newlineIndex >= 0) {
      this.handleLine(stripCarriageReturn(data.slice(start, newlineIndex)))
      if (this.hitLimit) {
        this.remainder = ""
        return
      }
      start = newlineIndex + 1
      newlineIndex = data.indexOf("\n", start)
    }
    this.remainder = data.slice(start)
  }

  handleLine(line) {
    if (!line || this.hitLimit) return
    const rel = normalizeRgPath(line)
    if (!rel || this.seenPaths.has(rel)) return
    if (!this.matchesPath(rel) || !this.shouldIncludePath(rel)) return
    if (this.filePattern && !isFilePatternMatch(rel, this.filePattern, !this.shouldGlobMatchFilePattern, true)) return
    if (this.matches.length >= this.maxResults) {
      this.hitLimit = true
      return
    }
    this.visitedFiles += 1
    if (this.visitedFiles > this.maxVisitedFiles) {
      this.hitLimit = true
      return
    }
    this.seenPaths.add(rel)
    this.matches.push({
      path: rel,
      line: 1,
      column: 1,
      matchLength: 0,
      preview: "",
    })
  }
}

function expressionKeys(expression) {
  return Object.keys(expression || {}).filter((key) => expression[key] !== false)
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))]
}

function anchorGlob(glob) {
  return glob.startsWith("**") || glob.startsWith("/") ? glob : `/${glob}`
}

function normalizeRgPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "")
}

function stripCarriageReturn(value) {
  return String(value || "").replace(/\r$/, "")
}

function rgFileErrorMessage(stderr) {
  const firstLine = String(stderr || "").split("\n")[0]?.trim()
  if (!firstLine) return ""
  if (firstLine.startsWith("error parsing glob")) {
    return firstLine.charAt(0).toUpperCase() + firstLine.slice(1)
  }
  return firstLine
}

module.exports = {
  RipgrepFileParser,
  buildRipgrepFileArgs,
  runRipgrepFileSearch,
}
