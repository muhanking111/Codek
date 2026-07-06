/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code local file search worker:
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\worker\localFileSearch.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\common\getFileResults.ts
 *--------------------------------------------------------------------------------------------*/

const fs = require("fs")
const path = require("path")
const { StringDecoder } = require("string_decoder")
const {
  DEFAULT_IGNORED_DIR_NAMES,
  pathHasIgnoredSegment,
} = require("../workspace/workspaceScaleProfile")
const { isFilePatternMatch } = require("./filePatternMatcher")

const IGNORE_DIRS = new Set(DEFAULT_IGNORED_DIR_NAMES)

const MAX_FILE_BYTES = 2 * 1024 * 1024
const DEFAULT_SEARCH_MAX_FILE_BYTES = 64 * 1024 * 1024
const SEARCH_RESULT_CONTENT_MAX_FILE_BYTES = 512 * 1024
const SEARCH_RESULT_CONTENT_MAX_TOTAL_BYTES = 4 * 1024 * 1024
const MAX_STREAM_LINE_CHARS = 1024 * 1024
const STREAM_LINE_TAIL_CHARS = 4096
const BINARY_EDITOR_BLOCKED_EXTENSIONS = new Set([
  ".7z",
  ".asar",
  ".bin",
  ".bmp",
  ".br",
  ".class",
  ".dat",
  ".dll",
  ".dylib",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpg",
  ".jpeg",
  ".node",
  ".otf",
  ".pak",
  ".pdf",
  ".png",
  ".rar",
  ".so",
  ".tar",
  ".ttf",
  ".wasm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
])

async function runLocalFileSearch({
  root,
  queryPlan,
  textPattern,
  discoverFiles,
  filePattern,
  searchLargeFiles,
  searchMaxFileBytes,
  includeContentForSmallFiles,
  contentMaxFileBytes,
  contentMaxTotalBytes,
  signal,
} = {}) {
  if (!root || !queryPlan) {
    return { matches: [], truncated: false, visitedFiles: 0, visitedDirs: 0, skippedLargeFiles: 0, engine: "local-file-search" }
  }

  const searchRoot = path.resolve(root)
  const matches = []
  const seenMatches = new Set()
  const fileContents = {}
  const shouldIncludeFileContents = includeContentForSmallFiles === true && !discoverFiles
  const fileContentMaxBytes = normalizeContentLimit(contentMaxFileBytes, SEARCH_RESULT_CONTENT_MAX_FILE_BYTES, MAX_FILE_BYTES)
  const totalContentMaxBytes = normalizeContentLimit(contentMaxTotalBytes, SEARCH_RESULT_CONTENT_MAX_TOTAL_BYTES, 16 * 1024 * 1024)
  const discoverFilePattern = discoverFiles ? String(filePattern || "").trim() : ""
  const largeFileScanLimit = Math.max(
    MAX_FILE_BYTES,
    Number(searchMaxFileBytes || DEFAULT_SEARCH_MAX_FILE_BYTES),
  )
  let fileContentBytes = 0
  let truncated = false
  let visitedFiles = 0
  let visitedDirs = 0
  let skippedLargeFiles = 0

  const scanSmallFile = async (full, rel) => {
    throwIfAborted(signal)
    let stat
    try { stat = await fs.promises.stat(full) } catch { return }
    let buf
    try { buf = await fs.promises.readFile(full) } catch { return }
    if (isLikelyBinary(buf)) return
    const text = buf.toString("utf8")
    const lines = text.split(/\r?\n/)
    let matchedThisFile = false
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      textPattern.lastIndex = 0
      let match
      while ((match = textPattern.exec(line)) !== null) {
        matchedThisFile = true
        pushSearchMatch(matches, seenMatches, {
          path: rel,
          line: i + 1,
          column: match.index + 1,
          matchLength: match[0].length,
          preview: line.length > 400 ? line.slice(0, 400) : line,
        })
        if (matches.length >= queryPlan.resultLimit) {
          truncated = true
          return
        }
        if (match.index === textPattern.lastIndex) textPattern.lastIndex += 1
      }
    }
    if (
      matchedThisFile
      && shouldIncludeFileContents
      && stat.size <= fileContentMaxBytes
      && fileContentBytes + stat.size <= totalContentMaxBytes
      && !isBinaryEditorBlockedPath(rel)
      && !Object.prototype.hasOwnProperty.call(fileContents, rel)
    ) {
      fileContents[rel] = text
      fileContentBytes += stat.size
    }
  }

  const scanLargeFileStream = async (full, rel) => {
    throwIfAborted(signal)
    let head
    try {
      head = await readFileHead(full)
    } catch {
      return
    }
    if (isLikelyBinary(head)) return

    const decoder = new StringDecoder("utf8")
    const stream = fs.createReadStream(full, { highWaterMark: 256 * 1024 })
    let line = ""
    let lineNumber = 1
    let lineStartColumn = 0

    const scanCompletedLine = (value) => {
      scanLineSegment(value, rel, lineNumber, lineStartColumn, textPattern, matches, queryPlan.resultLimit, seenMatches)
      lineNumber += 1
      lineStartColumn = 0
      return matches.length < queryPlan.resultLimit
    }

    const scanLongLineChunk = () => {
      while (line.length > MAX_STREAM_LINE_CHARS) {
        const segment = line.slice(0, MAX_STREAM_LINE_CHARS)
        if (!scanLineSegment(segment, rel, lineNumber, lineStartColumn, textPattern, matches, queryPlan.resultLimit, seenMatches)) return false
        lineStartColumn += Math.max(0, segment.length - STREAM_LINE_TAIL_CHARS)
        line = line.slice(segment.length - STREAM_LINE_TAIL_CHARS)
      }
      return true
    }

    try {
      for await (const chunk of stream) {
        throwIfAborted(signal)
        line += decoder.write(chunk)
        if (!scanLongLineChunk()) {
          truncated = true
          stream.destroy()
          return
        }
        let newlineIndex
        while ((newlineIndex = line.search(/\r?\n/)) >= 0) {
          const current = line.slice(0, newlineIndex)
          const newlineLength = line[newlineIndex] === "\r" && line[newlineIndex + 1] === "\n" ? 2 : 1
          line = line.slice(newlineIndex + newlineLength)
          if (!scanCompletedLine(current)) {
            truncated = true
            stream.destroy()
            return
          }
        }
      }
      line += decoder.end()
      if (line && matches.length < queryPlan.resultLimit) {
        scanLineSegment(line, rel, lineNumber, lineStartColumn, textPattern, matches, queryPlan.resultLimit, seenMatches)
      }
    } catch (error) {
      if (isAbortError(error, signal)) throw normalizeAbortError(error)
    }
  }

  const scanFile = async (full, rel) => {
    throwIfAborted(signal)
    let stat
    try { stat = await fs.promises.stat(full) } catch { return }
    if (stat.size > MAX_FILE_BYTES) {
      if (searchLargeFiles !== true && stat.size > largeFileScanLimit) {
        skippedLargeFiles += 1
        return
      }
      await scanLargeFileStream(full, rel)
    } else {
      await scanSmallFile(full, rel)
    }
  }

  const walk = async (dir) => {
    throwIfAborted(signal)
    if (queryPlan.shouldStop(matches.length, visitedFiles)) {
      truncated = true
      return
    }
    visitedDirs += 1
    let entries
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      throwIfAborted(signal)
      if (queryPlan.shouldStop(matches.length, visitedFiles)) {
        truncated = true
        return
      }
      if (IGNORE_DIRS.has(ent.name)) continue
      const full = path.join(dir, ent.name)
      const rel = path.relative(searchRoot, full).replace(/\\/g, "/")
      if (pathHasIgnoredSegment(rel)) continue
      if (ent.isDirectory()) {
        await walk(full)
      } else if (ent.isFile()) {
        if (!queryPlan.matchesPath(rel)) continue
        if (discoverFilePattern && !isFilePatternMatch(rel, discoverFilePattern)) continue
        visitedFiles += 1
        if (discoverFiles) {
          matches.push({
            path: rel,
            line: 1,
            column: 1,
            matchLength: 0,
            preview: "",
          })
        } else {
          await scanFile(full, rel)
        }
      }
    }
  }

  await walk(searchRoot)
  const result = {
    matches,
    truncated,
    visitedFiles,
    visitedDirs,
    visitedLimit: queryPlan.visitedFileLimit,
    skippedLargeFiles,
    engine: "local-file-search",
  }
  if (shouldIncludeFileContents) {
    result.fileContents = fileContents
    result.fileContentBytes = fileContentBytes
  }
  return result
}

async function collectMatchedFileContents({
  root,
  matches,
  contentMaxFileBytes,
  contentMaxTotalBytes,
  signal,
}) {
  const fileContents = {}
  let fileContentBytes = 0
  const rootPath = path.resolve(root)
  const fileContentMaxBytes = normalizeContentLimit(contentMaxFileBytes, SEARCH_RESULT_CONTENT_MAX_FILE_BYTES, MAX_FILE_BYTES)
  const totalContentMaxBytes = normalizeContentLimit(contentMaxTotalBytes, SEARCH_RESULT_CONTENT_MAX_TOTAL_BYTES, 16 * 1024 * 1024)
  const uniquePaths = [...new Set((matches || []).map((match) => match.path).filter(Boolean))]
  for (const rel of uniquePaths) {
    throwIfAborted(signal)
    if (fileContentBytes >= totalContentMaxBytes) break
    if (isBinaryEditorBlockedPath(rel)) continue
    const full = path.resolve(rootPath, rel)
    if (!isEqualOrParentPath(full, rootPath)) continue
    let stat
    try { stat = await fs.promises.stat(full) } catch { continue }
    if (!stat.isFile() || stat.size > fileContentMaxBytes || fileContentBytes + stat.size > totalContentMaxBytes) continue
    let buf
    try { buf = await fs.promises.readFile(full) } catch { continue }
    if (isLikelyBinary(buf)) continue
    fileContents[rel] = buf.toString("utf8")
    fileContentBytes += stat.size
  }
  return { fileContents, fileContentBytes }
}

async function countSkippedLargeFiles(root, queryPlan, largeFileScanLimit, signal) {
  let skippedLargeFiles = 0
  let visitedFiles = 0
  const searchRoot = path.resolve(root)
  const limitBytes = Math.max(MAX_FILE_BYTES, Number(largeFileScanLimit || DEFAULT_SEARCH_MAX_FILE_BYTES))
  const walk = async (dir) => {
    throwIfAborted(signal)
    if (visitedFiles >= queryPlan.visitedFileLimit) return
    let entries
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      throwIfAborted(signal)
      if (visitedFiles >= queryPlan.visitedFileLimit) return
      if (IGNORE_DIRS.has(ent.name)) continue
      const full = path.join(dir, ent.name)
      const rel = path.relative(searchRoot, full).replace(/\\/g, "/")
      if (pathHasIgnoredSegment(rel)) continue
      if (ent.isDirectory()) {
        await walk(full)
      } else if (ent.isFile()) {
        if (!queryPlan.matchesPath(rel)) continue
        visitedFiles += 1
        let stat
        try { stat = await fs.promises.stat(full) } catch { continue }
        if (stat.size > limitBytes) skippedLargeFiles += 1
      }
    }
  }
  await walk(searchRoot)
  return skippedLargeFiles
}

function pushSearchMatch(matches, seenMatches, match) {
  const key = `${match.path}\u0000${match.line}\u0000${match.column}\u0000${match.matchLength}`
  if (seenMatches.has(key)) return true
  seenMatches.add(key)
  matches.push(match)
  return false
}

function scanLineSegment(line, rel, lineNumber, columnBase, re, matches, limit, seenMatches) {
  re.lastIndex = 0
  let match
  while ((match = re.exec(line)) !== null) {
    pushSearchMatch(matches, seenMatches, {
      path: rel,
      line: lineNumber,
      column: columnBase + match.index + 1,
      matchLength: match[0].length,
      preview: line.length > 400 ? line.slice(0, 400) : line,
    })
    if (matches.length >= limit) return false
    if (match.index === re.lastIndex) re.lastIndex += 1
  }
  return true
}

async function readFileHead(filePath, bytes = 4096) {
  const handle = await fs.promises.open(filePath, "r")
  try {
    const buffer = Buffer.allocUnsafe(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

function isLikelyBinary(buf) {
  const len = Math.min(buf.length, 4096)
  for (let i = 0; i < len; i += 1) if (buf[i] === 0) return true
  return false
}

function isBinaryEditorBlockedPath(filePath) {
  return BINARY_EDITOR_BLOCKED_EXTENSIONS.has(path.extname(String(filePath || "")).toLowerCase())
}

function isEqualOrParentPath(candidate, parent) {
  const normalizedCandidate = path.normalize(candidate).toLowerCase()
  const normalizedParent = path.normalize(parent).toLowerCase()
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`)
}

function normalizeContentLimit(value, fallback, max) {
  return Math.min(Math.max(0, Number(value || fallback)), max)
}

function isAbortError(error, signal) {
  return signal?.aborted === true || error?.name === "AbortError"
}

function normalizeAbortError(error) {
  if (error?.name === "AbortError") return error
  const abortError = new Error("Search cancelled")
  abortError.name = "AbortError"
  return abortError
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  throw normalizeAbortError()
}

module.exports = {
  DEFAULT_SEARCH_MAX_FILE_BYTES,
  MAX_FILE_BYTES,
  SEARCH_RESULT_CONTENT_MAX_FILE_BYTES,
  SEARCH_RESULT_CONTENT_MAX_TOTAL_BYTES,
  collectMatchedFileContents,
  countSkippedLargeFiles,
  isBinaryEditorBlockedPath,
  isLikelyBinary,
  runLocalFileSearch,
  throwIfAborted,
}
