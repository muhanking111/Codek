#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")
const {
  DEFAULT_MAX_RENDERER_READ_FILE_BYTES,
  hashLargeFileSegment,
  patchRendererTextFileSegment,
  readRendererTextFile,
} = require("../desktop/services/workspace/largeFileReader")
const { searchInWorkspace } = require("../desktop/services/search")

const root = path.resolve(__dirname, "..")

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const bytesArg = argv.find((arg) => arg.startsWith("--bytes="))
  return {
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
    bytes: bytesArg ? Number(bytesArg.slice("--bytes=".length)) : Number(process.env.CODEK_LARGE_FILE_ENTERPRISE_BYTES || 54 * 1024 * 1024),
  }
}

function writeChunk(handle, text) {
  const buffer = Buffer.from(text, "utf8")
  fs.writeSync(handle, buffer)
  return buffer.length
}

function prepareFixture(fixtureRoot, bytes) {
  fs.mkdirSync(fixtureRoot, { recursive: true })
  const filePath = path.join(fixtureRoot, "large-edit-buffer-smoke.log")
  const originalSegment = "CODEK_SEGMENT_ORIGINAL"
  const editedSegment = "CODEK_SEGMENT_EDITED"
  const searchMarker = "CODEK_STREAM_SEARCH_MARKER"
  const line = "0123456789abcdefghijklmnopqrstuvwxyz safe large file smoke line\n"
  const chunk = line.repeat(4096)
  let written = 0
  let segmentOffset = 0

  const handle = fs.openSync(filePath, "w")
  try {
    written += writeChunk(handle, "CODEK_LARGE_FILE_ENTERPRISE_SMOKE_BEGIN\n")
    while (written < 3 * 1024 * 1024) {
      written += writeChunk(handle, chunk)
    }
    segmentOffset = written
    written += writeChunk(handle, originalSegment)
    written += writeChunk(handle, "\n")
    while (written < bytes - (1024 * 1024)) {
      written += writeChunk(handle, chunk)
    }
    written += writeChunk(handle, `{"kind":"large-search","marker":"${searchMarker}"}\n`)
    while (written < bytes) {
      written += writeChunk(handle, chunk)
    }
  } finally {
    fs.closeSync(handle)
  }

  return {
    editedSegment,
    filePath,
    originalSegment,
    searchMarker,
    segmentOffset,
    size: fs.statSync(filePath).size,
  }
}

function makeCheck(id, title, passed, detail = {}) {
  return {
    id,
    title,
    passed: passed === true,
    detail,
  }
}

async function runSmoke(options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const fixtureRoot = path.join(root, ".codek", "large-file-enterprise-smoke")
  const fixture = prepareFixture(fixtureRoot, Math.max(options.bytes || 0, 3 * 1024 * 1024 + 4096))

  const preview = await readRendererTextFile({
    resolvedPath: fixture.filePath,
    requestedPath: fixture.filePath,
    readOptions: {
      maxBytes: DEFAULT_MAX_RENDERER_READ_FILE_BYTES / 5,
      preview: true,
      previewBytes: 1024 * 1024,
      length: 1024 * 1024,
      offset: fixture.segmentOffset,
    },
    readMeta: { source: "user" },
  })

  const patchPlan = {
    path: "large-edit-buffer-smoke.log",
    offset: fixture.segmentOffset,
    deleteBytes: Buffer.byteLength(fixture.originalSegment, "utf8"),
    insertText: fixture.editedSegment,
    expectedSize: fixture.size,
    expectedHash: hashLargeFileSegment(fixture.originalSegment),
    nextSize: fixture.size - Buffer.byteLength(fixture.originalSegment, "utf8") + Buffer.byteLength(fixture.editedSegment, "utf8"),
    safety: "safe-segment-replace",
  }
  const diffPreview = {
    before: fixture.originalSegment,
    after: fixture.editedSegment,
    offset: patchPlan.offset,
    deleteBytes: patchPlan.deleteBytes,
    insertBytes: Buffer.byteLength(patchPlan.insertText, "utf8"),
  }
  await patchRendererTextFileSegment(fixture.filePath, patchPlan)
  const editedWindow = await fs.promises.readFile(fixture.filePath, "utf8")

  let conflictBlocked = false
  let conflictMessage = ""
  try {
    await patchRendererTextFileSegment(fixture.filePath, {
      ...patchPlan,
      expectedSize: fs.statSync(fixture.filePath).size,
      expectedHash: hashLargeFileSegment("STALE_SEGMENT"),
      nextSize: fs.statSync(fixture.filePath).size,
    })
  } catch (error) {
    conflictBlocked = true
    conflictMessage = String(error?.message || error)
  }

  const search = await searchInWorkspace({
    root: fixtureRoot,
    query: fixture.searchMarker,
    include: ["*.log"],
    maxResults: 20,
  })
  const searchMatch = search.matches.find((match) => match.path === "large-edit-buffer-smoke.log")

  const checks = [
    makeCheck("large_preview_window", "50MB+ 文本使用有界真实窗口读取", preview && typeof preview === "object" && preview.bytesRead > 0 && preview.bytesRead <= 1024 * 1024, {
      bytesRead: preview?.bytesRead || 0,
      offset: preview?.offset ?? null,
      size: preview?.size ?? null,
    }),
    makeCheck("segment_edit_patch", "当前 segment 可编辑并安全写回", editedWindow.includes(fixture.editedSegment) && !editedWindow.includes(fixture.originalSegment), {
      offset: patchPlan.offset,
      expectedHash: patchPlan.expectedHash,
      nextSize: patchPlan.nextSize,
    }),
    makeCheck("diff_preview_available", "分段保存前具备最小 diff preview 数据", diffPreview.before === fixture.originalSegment && diffPreview.after === fixture.editedSegment, diffPreview),
    makeCheck("hash_conflict_blocked", "外部变更或 hash 不一致会中文阻断", conflictBlocked && /当前窗口内容已经变化/.test(conflictMessage), {
      conflictMessage,
    }),
    makeCheck("streaming_search_large_file", "大文件搜索走流式扫描并返回可跳转行列", search.error == null && Boolean(searchMatch) && searchMatch.line > 1 && searchMatch.column > 1, {
      visitedFiles: search.visitedFiles,
      truncated: search.truncated,
      line: searchMatch?.line ?? null,
      column: searchMatch?.column ?? null,
      preview: searchMatch?.preview || "",
    }),
  ]

  const ready = checks.every((check) => check.passed)
  return {
    reportKind: "workbench-large-file-enterprise-smoke",
    createdAt: new Date().toISOString(),
    ready,
    status: ready ? "ready" : "blocked",
    fixtureRoot,
    filePath: fixture.filePath,
    fileSize: fs.statSync(fixture.filePath).size,
    checks,
    metrics: {
      segmentOffset: fixture.segmentOffset,
      previewBytesRead: preview?.bytesRead || 0,
      searchVisitedFiles: search.visitedFiles,
      searchMatchLine: searchMatch?.line ?? null,
      searchMatchColumn: searchMatch?.column ?? null,
      conflictBlocked,
    },
  }
}

function toMarkdown(report) {
  return [
    "# Workbench Large File Enterprise Smoke",
    "",
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- Status: ${report.status}`,
    `- Created: ${report.createdAt}`,
    `- Fixture: ${report.fixtureRoot}`,
    `- File size: ${report.fileSize}`,
    `- Latest JSON: ${report.latestJsonPath || report.jsonPath || "-"}`,
    `- Latest Markdown: ${report.latestMarkdownPath || report.markdownPath || "-"}`,
    "",
    "| Check | Status | Title |",
    "| --- | --- | --- |",
    ...report.checks.map((check) => `| ${check.id} | ${check.passed ? "pass" : "fail"} | ${check.title} |`),
    "",
  ].join("\n")
}

function saveReport(report, reportDir = defaultReportDir()) {
  fs.mkdirSync(reportDir, { recursive: true })
  const stamp = report.createdAt.replace(/[:.]/g, "-")
  const jsonPath = path.join(reportDir, `workbench-large-file-enterprise-${stamp}.json`)
  const markdownPath = path.join(reportDir, `workbench-large-file-enterprise-${stamp}.md`)
  const latestJsonPath = path.join(reportDir, "workbench-large-file-enterprise-latest.json")
  const latestMarkdownPath = path.join(reportDir, "workbench-large-file-enterprise-latest.md")
  const normalized = { ...report, jsonPath, markdownPath, latestJsonPath, latestMarkdownPath }
  fs.writeFileSync(jsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  fs.writeFileSync(markdownPath, `${toMarkdown(normalized)}\n`, "utf8")
  fs.writeFileSync(latestMarkdownPath, `${toMarkdown(normalized)}\n`, "utf8")
  return normalized
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await runSmoke(options)
  const saved = saveReport(report, options.reportDir)
  process.stdout.write(`${JSON.stringify(saved, null, 2)}\n`)
  process.exit(report.ready ? 0 : 1)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`)
    process.exit(1)
  })
}

module.exports = {
  defaultReportDir,
  parseArgs,
  runSmoke,
  saveReport,
  toMarkdown,
}
