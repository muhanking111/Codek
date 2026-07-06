const fs = require("fs")
const os = require("os")
const path = require("path")

// Mirrors VS Code's TextModel heap-operation guard: renderer/user file opens
// must switch to byte windows before a single huge string can pressure Monaco.
const DEFAULT_MAX_RENDERER_READ_FILE_BYTES = 256 * 1024 * 1024
const DEFAULT_MAX_RENDERER_PREVIEW_FILE_BYTES = 32 * 1024 * 1024
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

function normalizeReadOptions(options) {
  return options && typeof options === "object" && !Array.isArray(options) ? options : {}
}

function isBinaryEditorBlockedPath(filePath) {
  return BINARY_EDITOR_BLOCKED_EXTENSIONS.has(path.extname(String(filePath || "")).toLowerCase())
}

function buildBinaryEditorBlockedResult(requestedPath, size = 0) {
  return {
    error: "BINARY_FILE",
    size: Math.max(0, Number(size || 0)),
    path: requestedPath,
  }
}

function resolveRendererMaxBytes(readOptions, readMeta = null, fallback = DEFAULT_MAX_RENDERER_READ_FILE_BYTES) {
  if (readOptions.maxBytes == null && readMeta?.source === "agent") return 0
  const maxBytes = Number(readOptions.maxBytes || fallback)
  return Number.isFinite(maxBytes) ? maxBytes : fallback
}

function resolvePreviewWindow(readOptions, reportedSize, maxPreviewBytes = DEFAULT_MAX_RENDERER_PREVIEW_FILE_BYTES) {
  const previewBytes = Math.max(1, Math.min(
    Number(readOptions.length || readOptions.previewBytes || maxPreviewBytes),
    maxPreviewBytes,
    reportedSize,
  ))
  const offset = Math.max(0, Math.min(
    Number(readOptions.offset || 0),
    Math.max(0, reportedSize - previewBytes),
  ))
  return { offset, previewBytes }
}

async function readFileWindow(filePath, offset, previewBytes) {
  const handle = await fs.promises.open(filePath, "r")
  try {
    const buffer = Buffer.allocUnsafe(previewBytes)
    const { bytesRead } = await handle.read(buffer, 0, previewBytes, offset)
    return {
      content: buffer.subarray(0, bytesRead).toString("utf-8"),
      bytesRead,
    }
  } finally {
    await handle.close()
  }
}

async function readRendererTextFileChunk(input) {
  const resolvedPath = input.resolvedPath
  const requestedPath = input.requestedPath || resolvedPath
  const readOptions = normalizeReadOptions(input.readOptions)
  const stat = input.stat || await fs.promises.stat(resolvedPath)
  const reportedSize = Math.max(0, Number(input.reportedSize || stat.size || 0))
  if (isBinaryEditorBlockedPath(requestedPath) || isBinaryEditorBlockedPath(resolvedPath)) {
    return buildBinaryEditorBlockedResult(requestedPath, reportedSize)
  }
  const maxChunkBytes = Math.max(1, Number(input.maxChunkBytes || 512 * 1024))
  const requestedBytes = Math.max(1, Number(readOptions.length || readOptions.previewBytes || readOptions.maxBytes || maxChunkBytes))
  const previewBytes = Math.min(requestedBytes, maxChunkBytes, reportedSize || requestedBytes)
  const offset = Math.max(0, Math.min(
    Number(readOptions.offset || 0),
    Math.max(0, reportedSize - previewBytes),
  ))
  const { content, bytesRead } = await readFileWindow(resolvedPath, offset, previewBytes)
  return {
    content,
    size: reportedSize,
    bytesRead,
    limit: maxChunkBytes,
    previewBytes,
    offset,
    truncated: offset + bytesRead < reportedSize,
    path: requestedPath,
  }
}

function hashLargeFileSegment(content) {
  const value = String(content ?? "")
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function normalizePatchPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("大文件分段写回失败：写回计划无效。")
  }
  if (plan.safety !== "safe-segment-replace") {
    throw new Error("大文件分段写回失败：写回计划未通过安全标记。")
  }
  const offset = Math.max(0, Number(plan.offset || 0))
  const deleteBytes = Math.max(0, Number(plan.deleteBytes || 0))
  const expectedSize = Math.max(0, Number(plan.expectedSize || 0))
  const nextSize = Math.max(0, Number(plan.nextSize || 0))
  const expectedHash = String(plan.expectedHash || "")
  if (!expectedHash) {
    throw new Error("大文件分段写回失败：缺少窗口校验信息。")
  }
  if (offset + deleteBytes > expectedSize) {
    throw new Error("大文件分段写回失败：写回范围超出文件大小。")
  }
  return {
    path: String(plan.path || ""),
    offset,
    deleteBytes,
    insertText: String(plan.insertText ?? ""),
    expectedSize,
    expectedHash,
    nextSize,
    safety: "safe-segment-replace",
  }
}

async function pipeRange(inputPath, outputHandle, start, end) {
  if (end <= start) return
  const stream = fs.createReadStream(inputPath, { start, end: end - 1 })
  for await (const chunk of stream) {
    await outputHandle.write(chunk)
  }
}

async function patchRendererTextFileSegment(filePath, planInput) {
  const plan = normalizePatchPlan(planInput)
  const stat = await fs.promises.stat(filePath)
  if (!stat.isFile()) {
    throw new Error("大文件分段写回失败：目标不是文件。")
  }
  if (stat.size !== plan.expectedSize) {
    throw new Error("大文件分段写回失败：文件大小已经被外部修改。")
  }

  const currentWindow = await readFileWindow(filePath, plan.offset, plan.deleteBytes)
  if (currentWindow.bytesRead !== plan.deleteBytes) {
    throw new Error("大文件分段写回失败：当前窗口读取不完整。")
  }
  if (hashLargeFileSegment(currentWindow.content) !== plan.expectedHash) {
    throw new Error("大文件分段写回失败：当前窗口内容已经变化。")
  }

  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.codek-segment-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  )
  const outputHandle = await fs.promises.open(tempPath, "wx")
  try {
    await pipeRange(filePath, outputHandle, 0, plan.offset)
    await outputHandle.write(Buffer.from(plan.insertText, "utf8"))
    await pipeRange(filePath, outputHandle, plan.offset + plan.deleteBytes, stat.size)
    await outputHandle.sync()
  } catch (error) {
    await outputHandle.close().catch(() => {})
    await fs.promises.unlink(tempPath).catch(() => {})
    throw error
  }
  await outputHandle.close()

  const tempStat = await fs.promises.stat(tempPath)
  if (tempStat.size !== plan.nextSize) {
    await fs.promises.unlink(tempPath).catch(() => {})
    throw new Error("大文件分段写回失败：写回后的文件大小校验失败。")
  }

  if (os.platform() === "win32") {
    const backupPath = `${tempPath}.replace-backup`
    await fs.promises.rename(filePath, backupPath)
    try {
      await fs.promises.rename(tempPath, filePath)
      await fs.promises.unlink(backupPath).catch(() => {})
    } catch (error) {
      await fs.promises.rename(backupPath, filePath).catch(() => {})
      await fs.promises.unlink(tempPath).catch(() => {})
      throw error
    }
  } else {
    await fs.promises.rename(tempPath, filePath)
  }

  return true
}

function buildSmokeExtremeWindow(readOptions, reportedSize) {
  const { offset, previewBytes } = resolvePreviewWindow(readOptions, reportedSize)
  const windowIndex = Math.max(0, Math.floor(offset / Math.max(1, previewBytes)))
  const marker = windowIndex <= 0 ? "CODEK_EXTREME_WINDOW_001" : "CODEK_EXTREME_WINDOW_002"
  const content = Array.from({ length: 4096 }, (_value, index) => `${marker} line ${index}`).join("\n")
  return {
    content: content.slice(0, previewBytes),
    bytesRead: previewBytes,
    previewBytes,
    offset,
  }
}

async function readRendererTextFile(input) {
  const resolvedPath = input.resolvedPath
  const requestedPath = input.requestedPath || resolvedPath
  const readOptions = normalizeReadOptions(input.readOptions)
  const readMeta = input.readMeta || null
  const stat = input.stat || await fs.promises.stat(resolvedPath)
  const smokeExtremeFile = input.smokeExtremeFile || null
  const reportedSize = smokeExtremeFile ? smokeExtremeFile.virtualSize : stat.size
  if (isBinaryEditorBlockedPath(requestedPath) || isBinaryEditorBlockedPath(resolvedPath)) {
    return buildBinaryEditorBlockedResult(requestedPath, reportedSize)
  }
  const maxBytes = resolveRendererMaxBytes(
    readOptions,
    readMeta,
    input.maxBytes ?? DEFAULT_MAX_RENDERER_READ_FILE_BYTES,
  )

  if (stat.isFile() && maxBytes > 0 && reportedSize > maxBytes) {
    const window = smokeExtremeFile
      ? buildSmokeExtremeWindow(readOptions, reportedSize)
      : await (async () => {
          const { offset, previewBytes } = resolvePreviewWindow(readOptions, reportedSize)
          const { content, bytesRead } = await readFileWindow(resolvedPath, offset, previewBytes)
          return {
            content,
            bytesRead,
            previewBytes,
            offset,
          }
        })()
    if (window.bytesRead > 0) {
      return {
        content: window.content,
        size: reportedSize,
        bytesRead: window.bytesRead,
        limit: maxBytes,
        previewBytes: window.previewBytes,
        offset: window.offset,
        truncated: window.offset + window.bytesRead < reportedSize,
        path: requestedPath,
      }
    }
    return {
      error: "FILE_TOO_LARGE",
      size: reportedSize,
      limit: maxBytes,
      path: requestedPath,
    }
  }

  return fs.promises.readFile(resolvedPath, "utf-8")
}

module.exports = {
  DEFAULT_MAX_RENDERER_PREVIEW_FILE_BYTES,
  DEFAULT_MAX_RENDERER_READ_FILE_BYTES,
  hashLargeFileSegment,
  patchRendererTextFileSegment,
  readRendererTextFile,
  readRendererTextFileChunk,
  resolvePreviewWindow,
  resolveRendererMaxBytes,
}
