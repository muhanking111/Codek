#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")

const repoRoot = path.resolve(__dirname, "..")

const DEFAULT_EXCLUDED_DIRS = new Set([
  ".git",
  ".codek",
  ".planning",
  ".vite",
  "coverage",
  "dist",
  "frontend-dist",
  "node_modules",
  "out",
  "reports",
  "tmp",
])

const DOC_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".rst",
  ".adoc",
])

const SCANNED_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".map",
  ".mjs",
  ".ts",
  ".tsx",
  ".vue",
  ".yaml",
  ".yml",
])

const FORBIDDEN_PATH_PATTERNS = [
  /D:\s*[\\/]+\s*SourceMirror(?:\s*[\\/]+\s*vscode)?/i,
  /SourceMirror\s*[\\/]+\s*vscode/i,
  /["'`]SourceMirror["'`]\s*,\s*["'`]vscode["'`]/i,
]

const RUNTIME_REFERENCE_PATTERNS = [
  /\bimport\b/,
  /\brequire\s*\(/,
  /\bfs\.(?:readFileSync|readFile|existsSync|statSync|readdirSync|cpSync|copyFileSync)\s*\(/,
  /\bpath\.(?:join|resolve|normalize)\s*\(/,
  /\bspawnSync\s*\(/,
  /\bexecFileSync\s*\(/,
]

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    root: repoRoot,
    json: false,
  }

  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true
    } else if (arg.startsWith("--root=")) {
      options.root = path.resolve(arg.slice("--root=".length))
    }
  }

  return options
}

function normalizeForMatch(value) {
  return String(value || "").replace(/\\\\/g, "\\").replace(/\//g, "\\")
}

function isDocumentationFile(filePath) {
  const normalized = filePath.replace(/\\/g, "/")
  const extension = path.extname(filePath).toLowerCase()
  return DOC_EXTENSIONS.has(extension)
    || normalized.includes("/docs/")
    || normalized.includes("/.planning/")
}

function isPackagedGeneratedSource(filePath, root = repoRoot) {
  const normalized = path.relative(root, filePath).replace(/\\/g, "/")
  return normalized.startsWith("desktop/services/extensions-host/bundle/")
}

function shouldSkipFile(filePath, root = repoRoot) {
  const relative = path.relative(root, filePath)
  if (!relative || relative.startsWith("..")) return true

  const parts = relative.split(path.sep)
  if (parts.some((part) => DEFAULT_EXCLUDED_DIRS.has(part))) return true

  const basename = path.basename(filePath)
  if (basename === "vscode-source-boundary-check.js") return true
  if (basename === "_import_report.json") return true
  if (/\.test\.[cm]?[jt]sx?$/i.test(basename)) return true
  if (/\.spec\.[cm]?[jt]sx?$/i.test(basename)) return true
  if (/\.d\.ts$/i.test(basename)) return false

  if (isDocumentationFile(filePath)) return true

  const extension = path.extname(filePath).toLowerCase()
  return !SCANNED_EXTENSIONS.has(extension)
}

function stripCommentsPreserveLines(source, extension) {
  const text = String(source || "")
  if (![".cjs", ".css", ".js", ".jsx", ".mjs", ".ts", ".tsx", ".vue"].includes(extension)) {
    return text
  }

  let output = ""
  let state = "code"
  let quote = ""
  let templateExpressionDepth = 0

  for (let index = 0; index < text.length; index += 1) {
    const current = text[index]
    const next = text[index + 1]

    if (state === "lineComment") {
      if (current === "\n") {
        output += "\n"
        state = "code"
      } else {
        output += " "
      }
      continue
    }

    if (state === "blockComment") {
      if (current === "*" && next === "/") {
        output += "  "
        index += 1
        state = "code"
      } else {
        output += current === "\n" ? "\n" : " "
      }
      continue
    }

    if (state === "string") {
      output += current
      if (current === "\\") {
        if (next) {
          output += next
          index += 1
        }
        continue
      }
      if (current === quote) {
        state = "code"
        quote = ""
      }
      continue
    }

    if (state === "template") {
      output += current
      if (current === "\\") {
        if (next) {
          output += next
          index += 1
        }
        continue
      }
      if (current === "`" && templateExpressionDepth === 0) {
        state = "code"
        continue
      }
      if (current === "$" && next === "{") {
        output += next
        index += 1
        templateExpressionDepth += 1
        continue
      }
      if (current === "}" && templateExpressionDepth > 0) {
        templateExpressionDepth -= 1
      }
      continue
    }

    if (current === "/" && next === "/") {
      output += "  "
      index += 1
      state = "lineComment"
      continue
    }

    if (current === "/" && next === "*") {
      output += "  "
      index += 1
      state = "blockComment"
      continue
    }

    if (current === "\"" || current === "'") {
      output += current
      quote = current
      state = "string"
      continue
    }

    if (current === "`") {
      output += current
      state = "template"
      templateExpressionDepth = 0
      continue
    }

    output += current
  }

  return output
}

function hasForbiddenPath(line) {
  const normalized = normalizeForMatch(line)
  return FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(normalized))
}

function hasRuntimeReference(line) {
  return RUNTIME_REFERENCE_PATTERNS.some((pattern) => pattern.test(line))
}

function scanFile(filePath, root = repoRoot) {
  const extension = path.extname(filePath).toLowerCase()
  const source = fs.readFileSync(filePath, "utf8")
  const stripped = isPackagedGeneratedSource(filePath, root)
    ? source
    : stripCommentsPreserveLines(source, extension)
  const lines = stripped.split(/\r?\n/)
  const findings = []

  lines.forEach((line, index) => {
    if (!hasForbiddenPath(line)) return
    findings.push({
      file: path.relative(root, filePath).replace(/\\/g, "/"),
      line: index + 1,
      runtimeReference: hasRuntimeReference(line),
      text: line.trim().slice(0, 240),
    })
  })

  return findings
}

function walkFiles(root, callback) {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!DEFAULT_EXCLUDED_DIRS.has(entry.name)) {
          stack.push(fullPath)
        }
        continue
      }
      if (entry.isFile()) {
        callback(fullPath)
      }
    }
  }
}

function buildVscodeSourceBoundaryReport(options = {}) {
  const root = path.resolve(options.root || repoRoot)
  const findings = []
  const scannedFiles = []

  walkFiles(root, (filePath) => {
    if (shouldSkipFile(filePath, root)) return
    scannedFiles.push(path.relative(root, filePath).replace(/\\/g, "/"))
    findings.push(...scanFile(filePath, root))
  })

  const runtimeFindings = findings.filter((finding) => finding.runtimeReference)
  return {
    reportKind: "vscode-source-boundary-check",
    root,
    ready: findings.length === 0,
    summary: {
      scannedFiles: scannedFiles.length,
      findings: findings.length,
      runtimeFindings: runtimeFindings.length,
    },
    findings,
  }
}

function printReport(report, options = {}) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }

  if (report.ready) {
    console.log(`VS Code source boundary check passed (${report.summary.scannedFiles} files scanned).`)
    return
  }

  console.error("VS Code source boundary check failed.")
  console.error("Runtime code and packaged sources must not reference D:\\SourceMirror or SourceMirror/vscode.")
  for (const finding of report.findings.slice(0, 50)) {
    const marker = finding.runtimeReference ? "runtime" : "source"
    console.error(`  [${marker}] ${finding.file}:${finding.line} ${finding.text}`)
  }
  if (report.findings.length > 50) {
    console.error(`  ... ${report.findings.length - 50} more findings`)
  }
}

if (require.main === module) {
  const options = parseArgs()
  const report = buildVscodeSourceBoundaryReport(options)
  printReport(report, options)
  process.exit(report.ready ? 0 : 1)
}

module.exports = {
  buildVscodeSourceBoundaryReport,
  hasForbiddenPath,
  hasRuntimeReference,
  isDocumentationFile,
  isPackagedGeneratedSource,
  parseArgs,
  printReport,
  scanFile,
  shouldSkipFile,
  stripCommentsPreserveLines,
}
