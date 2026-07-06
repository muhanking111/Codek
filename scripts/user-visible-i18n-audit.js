#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const reportDir = path.join(root, ".codek", "reports")
const sourceRoots = [
  path.join(root, "frontend", "vite-project", "src"),
]

const blockedPhrases = [
  "Start",
  "Restart",
  "Stop",
  "Continue",
  "Step Over",
  "Step Into",
  "Step Out",
  "Select configuration",
  "Add Configuration",
  "Edit Configuration",
  "Close Panel",
  "VARIABLES",
  "WATCH",
  "CALL STACK",
  "PAUSED",
  "RUNNING",
  "BREAKPOINTS",
  "No variables",
  "No stack frames",
  "No breakpoints",
  "Expression to watch",
  "Conditional",
  "Debug console output will appear here",
  "Debug console input",
  "Configuration name",
  "Command / Program",
  "Working Directory",
  "Codebase Context",
  "Mentions",
  "Rules",
  "Warning",
  "Ready",
  "Checkpoint",
  "Pause run",
  "Resume run",
  "Available:",
  "Save a checkpoint",
  "Resume is already running",
  "No resumable checkpoint is available",
  "Autonomous Agent",
  "View Graph",
  "Switch to Supervised",
  "Switch to Autonomous",
  "Start Agent",
  "Goal:",
  "Pending Approvals",
  "Progress Log",
  "Operations",
  "Approve",
  "Reject",
  "Target:",
  "Loaded relevant memories from past sessions",
  "Goal completed successfully",
  "Agent failed",
  "Cannot edit in read-only editor",
  "This file is too large to load fully",
  "Toggle split editor",
  "Rename symbol",
  "Format document",
  "Quick question",
  "Focus next region",
  "Focus previous region",
  "Start dev server",
  "Stop dev server",
  "Close inspector",
  "Save to source via AI",
  "Breakpoint at line",
  "Disabled breakpoint",
  "Verified breakpoint",
  "Condition:",
  "aria-label=\"Search\"",
  "aria-label=\"Symbols\"",
  "aria-label=\"Source Control\"",
  "aria-label=\"Problems\"",
  "aria-label=\"Notepads\"",
  "aria-label=\"Smart Rewrite\"",
  "aria-label=\"Remote Connection\"",
  "aria-label=\"Sidebar panels\"",
  "aria-label=\"Sidebar panel\"",
  "aria-label=\"File Explorer\"",
  "aria-label=\"Code Editor\"",
  "aria-label=\"Command Palette\"",
  ">Pinned<",
]

const ignoredRelativePathPatterns = [
  /(^|[\\/])i18n[\\/]en\.ts$/,
  /\.test\.(ts|tsx|js|jsx|vue)$/,
  /(^|[\\/])smoke[\\/]/,
  /(^|[\\/])plugins[\\/]builtin[\\/].+\.json\.ts$/,
  /(^|[\\/])vscode-adapter[\\/]generated[\\/]/,
]

const scannedExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".vue"])

function shouldIgnore(filePath) {
  const relative = path.relative(root, filePath)
  return ignoredRelativePathPatterns.some((pattern) => pattern.test(relative))
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function hasVisibleTemplateText(line, phrase) {
  const templateMatches = line.matchAll(/>([^<{}]*)</g)
  for (const match of templateMatches) {
    if (match[1].includes(phrase)) return true
  }
  return false
}

function readStringLiteral(line, quoteIndex) {
  const quote = line[quoteIndex]
  if (!["\"", "'", "`"].includes(quote)) return null
  let value = ""
  for (let index = quoteIndex + 1; index < line.length; index += 1) {
    const char = line[index]
    if (char === "\\") {
      if (index + 1 < line.length) {
        value += line[index + 1]
        index += 1
      }
      continue
    }
    if (char === quote) {
      return {
        value: stripTemplateExpressions(value),
        start: quoteIndex,
        end: index,
      }
    }
    value += char
  }
  return null
}

function stripTemplateExpressions(value) {
  let output = ""
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "$" && value[index + 1] === "{") {
      index += 2
      let depth = 1
      while (index < value.length && depth > 0) {
        if (value[index] === "{") depth += 1
        else if (value[index] === "}") depth -= 1
        index += 1
      }
      index -= 1
      continue
    }
    output += value[index]
  }
  return output
}

function stringLiterals(line) {
  const literals = []
  for (let index = 0; index < line.length; index += 1) {
    if (!["\"", "'", "`"].includes(line[index])) continue
    const literal = readStringLiteral(line, index)
    if (!literal) continue
    literals.push(literal)
    index = literal.end
  }
  return literals
}

function immediateFieldLiteralContainsPhrase(line, field, phrase) {
  const fieldPattern = new RegExp(`\\b${field}\\s*:`, "g")
  let match
  while ((match = fieldPattern.exec(line)) !== null) {
    let index = match.index + match[0].length
    while (index < line.length && /\s/.test(line[index])) index += 1
    const literal = readStringLiteral(line, index)
    if (literal?.value.includes(phrase)) return true
  }
  return false
}

function attributeLiteralContainsPhrase(line, phrase) {
  const attrPattern = /(?:^|\s)(?::)?(?:title|placeholder|aria-label|alt)\s*=\s*/g
  let match
  while ((match = attrPattern.exec(line)) !== null) {
    let index = match.index + match[0].length
    while (index < line.length && /\s/.test(line[index])) index += 1
    if (line[index] === "{") {
      index += 1
      while (index < line.length && /\s/.test(line[index])) index += 1
    }
    const literal = readStringLiteral(line, index)
    if (literal?.value.includes(phrase)) return true
  }
  return false
}

function hasVisibleAttributeOrBinding(line, phrase) {
  if (!/[`'"]/.test(line)) return false
  if (attributeLiteralContainsPhrase(line, phrase)) return true
  for (const field of ["label", "title", "detail", "disabledReason", "statusLabel", "subtitle", "summary", "nextAction", "reason", "message", "text"]) {
    if (immediateFieldLiteralContainsPhrase(line, field, phrase)) return true
  }
  if (/^\s*return\b/.test(line)) {
    return stringLiterals(line).some((literal) => literal.value.includes(phrase))
  }
  return false
}

function isLikelyUserVisibleLine(line, phrase) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*")) return false
  return hasVisibleTemplateText(line, phrase) || hasVisibleAttributeOrBinding(line, phrase)
}

function shouldIgnoreFinding(filePath, line, phrase) {
  const relative = path.relative(root, filePath).replace(/\\/g, "/")
  if (relative === "frontend/vite-project/src/App.vue" && phrase === "This file is too large to load fully") {
    return /blockingNoticeVisible|staleGuardTextVisible/.test(line)
  }
  if (
    relative.endsWith("frontend/vite-project/src/workspace/fileOperations.js")
    && phrase === "Operations"
    && /workspace\.fileOperations\./.test(line)
  ) {
    return true
  }
  return false
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, files)
      continue
    }
    if (entry.isFile() && scannedExtensions.has(path.extname(entry.name)) && !shouldIgnore(fullPath)) {
      files.push(fullPath)
    }
  }
  return files
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8")
  const lines = content.split(/\r?\n/)
  const findings = []
  for (const phrase of blockedPhrases) {
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].includes(phrase)) {
        if (!isLikelyUserVisibleLine(lines[index], phrase)) continue
        if (shouldIgnoreFinding(filePath, lines[index], phrase)) continue
        findings.push({
          phrase,
          file: path.relative(root, filePath).replace(/\\/g, "/"),
          line: index + 1,
          preview: lines[index].trim().slice(0, 200),
        })
      }
    }
  }
  return findings
}

function writeReports(result) {
  fs.mkdirSync(reportDir, { recursive: true })
  const jsonPath = path.join(reportDir, "user-visible-i18n-audit-latest.json")
  const mdPath = path.join(reportDir, "user-visible-i18n-audit-latest.md")
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf8")
  const lines = [
    "# Codek 用户可见英文阻断文案审计",
    "",
    `- 状态：${result.ready ? "通过" : "失败"}`,
    `- 扫描文件数：${result.scannedFiles}`,
    `- 命中数：${result.findings.length}`,
    `- 生成时间：${result.createdAt}`,
    "",
  ]
  if (result.findings.length > 0) {
    lines.push("## 命中项", "")
    for (const finding of result.findings) {
      lines.push(`- ${finding.file}:${finding.line} 命中 \`${finding.phrase}\`：${finding.preview}`)
    }
  } else {
    lines.push("未发现本轮阻断清单中的用户可见英文文案。")
  }
  fs.writeFileSync(mdPath, `${lines.join("\n")}\n`, "utf8")
  return { jsonPath, mdPath }
}

function buildAuditResult(options = {}) {
  const auditSourceRoots = options.sourceRoots || sourceRoots
  const auditFiles = auditSourceRoots.flatMap((sourceRoot) => walk(sourceRoot))
  const auditFindings = auditFiles.flatMap(scanFile)
  return {
    ready: auditFindings.length === 0,
    status: auditFindings.length === 0 ? "ready" : "blocked",
    createdAt: options.createdAt || new Date().toISOString(),
    scannedFiles: auditFiles.length,
    blockedPhrases,
    findings: auditFindings,
  }
}

function main() {
  const result = buildAuditResult()
  const paths = writeReports(result)

  console.log(`[i18n-audit] ${result.status}: ${result.findings.length} finding(s)`)
  console.log(`[i18n-audit] json: ${paths.jsonPath}`)
  console.log(`[i18n-audit] markdown: ${paths.mdPath}`)

  if (!result.ready) {
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  blockedPhrases,
  buildAuditResult,
  isLikelyUserVisibleLine,
  scanFile,
}
