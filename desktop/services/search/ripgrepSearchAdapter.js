/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code search rg flow:
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\node\ripgrepTextSearchEngine.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\node\ripgrepSearchUtils.ts
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")
const { StringDecoder } = require("string_decoder")

const DEFAULT_MAX_SEARCH_RESULTS = 5000

function findRipgrepPath(candidates = []) {
  const envPath = process.env.CODEK_RG_PATH
  const defaultCandidates = [
    envPath,
    path.join(__dirname, "..", "extensions-host", "bundle", "node_modules", "@vscode", "ripgrep", "bin", process.platform === "win32" ? "rg.exe" : "rg"),
    path.join(__dirname, "..", "extensions-host", "bundle", "node_modules", "@github", "copilot", "ripgrep", "bin", process.platform === "win32" ? "win32-x64" : process.platform, process.platform === "win32" ? "rg.exe" : "rg"),
  ]

  for (const candidate of [...candidates, ...defaultCandidates].filter(Boolean)) {
    try {
      const stat = fs.statSync(candidate)
      if (stat.isFile()) return candidate
    } catch {
      // Try the next bundled candidate.
    }
  }
  return null
}

async function runRipgrepSearch({
  root,
  query,
  queryPlan,
  regex,
  caseSensitive,
  wholeWord,
  searchLargeFiles,
  searchMaxFileBytes,
  maxResults,
  ignoredGlobs = [],
  rgPath,
  numThreads,
  signal,
} = {}) {
  const resolvedRgPath = findRipgrepPath(rgPath ? [rgPath] : [])
  if (!resolvedRgPath || !queryPlan?.textPattern || !query) {
    return null
  }

  const args = buildRipgrepArgs({
    query,
    includePatterns: expressionKeys(queryPlan.includeExpression),
    excludePatterns: [...expressionKeys(queryPlan.excludeExpression), ...ignoredGlobs],
    regex,
    caseSensitive,
    wholeWord,
    maxResults: queryPlan.resultLimit || maxResults,
    maxFileSize: searchLargeFiles === true ? null : Math.max(0, Number(searchMaxFileBytes || 0)),
    numThreads,
  })

  return new Promise((resolve, reject) => {
    const parser = new RipgrepJsonParser({
      root,
      maxResults: queryPlan.resultLimit || maxResults || DEFAULT_MAX_SEARCH_RESULTS,
      maxVisitedFiles: queryPlan.visitedFileLimit,
      matchesPath: queryPlan.matchesPath,
    })
    let stderr = ""
    let settled = false
    const rg = spawn(resolvedRgPath, args, {
      cwd: root,
      windowsHide: true,
    })
    const cancel = () => {
      parser.cancel()
      rg.kill()
      const error = new Error("Search cancelled")
      error.name = "AbortError"
      fail(error)
    }

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
        const error = new Error(rgErrorMessage(stderr) || `ripgrep exited with code ${code}`)
        error.code = code
        fail(error)
        return
      }

      finish({
        matches: parser.matches,
        truncated: parser.hitLimit,
        visitedFiles: parser.visitedFiles.size,
        visitedDirs: 0,
        visitedLimit: queryPlan.visitedFileLimit,
        skippedLargeFiles: 0,
        engine: "ripgrep",
        rgPath: resolvedRgPath,
      })
    })
  })
}

function buildRipgrepArgs({
  query,
  includePatterns = [],
  excludePatterns = [],
  regex,
  caseSensitive,
  wholeWord,
  maxFileSize,
  numThreads,
} = {}) {
  const args = ["--hidden", "--no-require-git"]
  args.push(caseSensitive ? "--case-sensitive" : "--ignore-case")

  if (process.platform === "win32") {
    args.push("--glob-case-insensitive")
    args.push("--ignore-file-case-insensitive")
  }

  const uniqueIncludes = uniqueStrings(includePatterns)
  const otherIncludes = uniqueIncludes.filter((include) => !include.startsWith("**"))
  const doubleStarIncludes = uniqueIncludes.filter((include) => include.startsWith("**"))

  if (otherIncludes.length) {
    args.push("-g", "!*")
    for (const include of otherIncludes) {
      for (const glob of spreadGlobComponents(include).map(anchorGlob)) {
        args.push("-g", glob)
      }
    }
  }

  for (const include of doubleStarIncludes) {
    args.push("-g", include)
  }

  for (const exclude of uniqueStrings(excludePatterns).map(anchorGlob)) {
    args.push("-g", `!${exclude}`)
  }

  if (maxFileSize && Number.isFinite(maxFileSize) && maxFileSize > 0) {
    args.push("--max-filesize", String(Math.trunc(maxFileSize)))
  }

  if (numThreads && Number.isFinite(Number(numThreads)) && Number(numThreads) > 0) {
    args.push("--threads", String(Math.trunc(Number(numThreads))))
  }

  let patternAfterDoubleDash = null
  args.push("--crlf")
  if (regex) {
    args.push("--engine", "auto")
  }

  if (wholeWord) {
    const source = regex ? String(query || "") : escapeRegExp(String(query || ""))
    args.push("--regexp", `\\b${fixNewline(source)}\\b`)
  } else if (regex) {
    args.push("--regexp", fixNewline(String(query || "")))
  } else {
    patternAfterDoubleDash = String(query || "")
    args.push("--fixed-strings")
  }

  args.push("--no-config")
  args.push("--json")
  args.push("--")
  if (patternAfterDoubleDash) args.push(patternAfterDoubleDash)
  args.push(".")
  return args
}

class RipgrepJsonParser {
  constructor({ root, maxResults = DEFAULT_MAX_SEARCH_RESULTS, maxVisitedFiles, matchesPath } = {}) {
    this.root = root
    this.maxResults = maxResults
    this.maxVisitedFiles = Number.isFinite(Number(maxVisitedFiles)) && Number(maxVisitedFiles) > 0
      ? Math.trunc(Number(maxVisitedFiles))
      : Number.POSITIVE_INFINITY
    this.matchesPath = typeof matchesPath === "function" ? matchesPath : () => true
    this.decoder = new StringDecoder("utf8")
    this.remainder = ""
    this.matches = []
    this.seenMatches = new Set()
    this.visitedFiles = new Set()
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
    if (this.remainder.trim()) {
      this.handleLine(this.remainder.trim())
      this.remainder = ""
    }
  }

  handleDecodedData(decodedData) {
    const data = this.remainder + decodedData
    let start = 0
    let newlineIndex = data.indexOf("\n")
    while (newlineIndex >= 0) {
      this.handleLine(data.slice(start, newlineIndex).trim())
      start = newlineIndex + 1
      newlineIndex = data.indexOf("\n", start)
    }
    this.remainder = data.slice(start)
  }

  handleLine(line) {
    if (!line || this.hitLimit) return
    const message = JSON.parse(line)
    const data = message.data || {}
    if (message.type === "begin" || message.type === "end") {
      const rel = normalizeRgPath(bytesOrTextToString(data.path))
      if (rel) this.visitedFiles.add(rel)
      if (this.visitedFiles.size >= this.maxVisitedFiles) this.hitLimit = true
      return
    }
    if (message.type !== "match") return

    const rel = normalizeRgPath(bytesOrTextToString(data.path))
    if (!rel || !this.matchesPath(rel)) return
    this.visitedFiles.add(rel)
    if (this.visitedFiles.size >= this.maxVisitedFiles) {
      this.hitLimit = true
      return
    }

    const lineText = stripTrailingNewline(bytesOrTextToString(data.lines))
    const submatches = Array.isArray(data.submatches) && data.submatches.length
      ? data.submatches
      : [{ start: 0, end: lineText ? Buffer.from(lineText).subarray(0, 1).length : 0, match: { text: lineText ? lineText[0] : "" } }]

    for (const submatch of submatches) {
      if (this.matches.length >= this.maxResults) {
        this.hitLimit = true
        return
      }
      const match = createCodekMatch(rel, data.line_number, lineText, submatch)
      const key = `${match.path}\u0000${match.line}\u0000${match.column}\u0000${match.matchLength}`
      if (this.seenMatches.has(key)) continue
      this.seenMatches.add(key)
      this.matches.push(match)
    }
  }
}

function createCodekMatch(rel, lineNumber, lineText, submatch) {
  const start = Math.max(0, Number(submatch?.start || 0))
  const end = Math.max(start, Number(submatch?.end || start))
  const lineBuffer = Buffer.from(lineText)
  const before = lineBuffer.subarray(0, Math.min(start, lineBuffer.length)).toString()
  const matched = lineBuffer.subarray(Math.min(start, lineBuffer.length), Math.min(end, lineBuffer.length)).toString()
  return {
    path: rel,
    line: Math.max(1, Number(lineNumber || 1)),
    column: before.length + 1,
    matchLength: Math.max(0, matched.length),
    preview: lineText.length > 400 ? lineText.slice(0, 400) : lineText,
  }
}

function bytesOrTextToString(value) {
  if (!value) return ""
  if (typeof value.text === "string") return value.text
  if (typeof value.bytes === "string") return Buffer.from(value.bytes, "base64").toString()
  return ""
}

function stripTrailingNewline(value) {
  return String(value || "").replace(/\r?\n$/, "")
}

function normalizeRgPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "")
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

function spreadGlobComponents(globComponent) {
  const expanded = performBraceExpansionForRipgrep(globComponent)
  return expanded.flatMap((globArg) => {
    const components = splitGlobAware(globArg, "/")
    return components.map((_, index) => components.slice(0, index + 1).join("/"))
  })
}

function splitGlobAware(value, delimiter) {
  const parts = []
  let current = ""
  let braces = 0
  let brackets = 0
  let escaped = false
  for (const char of String(value || "")) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === "\\") {
      current += char
      escaped = true
      continue
    }
    if (char === "{" && brackets === 0) braces += 1
    else if (char === "}" && brackets === 0 && braces > 0) braces -= 1
    else if (char === "[" && braces === 0) brackets += 1
    else if (char === "]" && braces === 0 && brackets > 0) brackets -= 1
    if (char === delimiter && braces === 0 && brackets === 0) {
      parts.push(current)
      current = ""
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

function performBraceExpansionForRipgrep(pattern) {
  const split = getEscapeAwareSplitStringForRipgrep(pattern)
  if (split.fixedStart === undefined || split.fixedEnd === undefined) {
    return [split.strInBraces]
  }
  let choices = splitGlobAware(split.strInBraces, ",")
  if (!choices.length) choices = [""]
  const ends = performBraceExpansionForRipgrep(split.fixedEnd)
  return choices.flatMap((choice) => {
    const start = split.fixedStart + choice
    return ends.map((end) => start + end)
  })
}

function getEscapeAwareSplitStringForRipgrep(pattern) {
  let inBraces = false
  let escaped = false
  let fixedStart = ""
  let strInBraces = ""
  for (let index = 0; index < String(pattern || "").length; index += 1) {
    const char = pattern[index]
    switch (char) {
      case "\\":
        if (escaped) {
          if (inBraces) strInBraces += `\\${char}`
          else fixedStart += `\\${char}`
          escaped = false
        } else {
          escaped = true
        }
        break
      case "{":
        if (escaped) {
          if (inBraces) strInBraces += char
          else fixedStart += char
          escaped = false
        } else if (inBraces) {
          return { strInBraces: `${fixedStart}{${strInBraces}{${pattern.slice(index + 1)}` }
        } else {
          inBraces = true
        }
        break
      case "}":
        if (escaped) {
          if (inBraces) strInBraces += char
          else fixedStart += char
          escaped = false
        } else if (inBraces) {
          return { fixedStart, strInBraces, fixedEnd: pattern.slice(index + 1) }
        } else {
          fixedStart += char
        }
        break
      default:
        if (inBraces) strInBraces += `${escaped ? "\\" : ""}${char}`
        else fixedStart += `${escaped ? "\\" : ""}${char}`
        escaped = false
        break
    }
  }
  return { strInBraces: fixedStart + (inBraces ? `{${strInBraces}` : "") }
}

function fixNewline(pattern) {
  return String(pattern || "").replace(/\n/g, "\\r?\\n")
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function rgErrorMessage(stderr) {
  const firstLine = String(stderr || "").split("\n")[0]?.trim()
  if (!firstLine) return ""
  if (String(stderr).split("\n").some((line) => line.startsWith("regex parse error"))) {
    return "Regex parse error"
  }
  return firstLine
}

module.exports = {
  RipgrepJsonParser,
  buildRipgrepArgs,
  findRipgrepPath,
  performBraceExpansionForRipgrep,
  runRipgrepSearch,
}
