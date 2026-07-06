#!/usr/bin/env node

"use strict"

const fs = require("node:fs")
const path = require("node:path")

const { collectImportReferences } = require("./vscode-dependency-closure-importer")

const repoRoot = path.resolve(__dirname, "..")

const DEFAULT_GENERATED_ROOT = path.join(repoRoot, "frontend", "vite-project", "src", "vscode-adapter", "generated", "vscode")
const DEFAULT_VENDOR_ROOT = path.join(repoRoot, "vendor", "vscode")
const DEFAULT_APP_SRC_ROOT = path.join(repoRoot, "frontend", "vite-project", "src")

const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".html"]
const TYPESCRIPT_SOURCE_FALLBACK_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"]
const JAVASCRIPT_SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"])

const ALLOWED_DECLARATION_ONLY_MISSING_SHIMS = new Set([
  "src/vs/base/common/observableInternal/logging/debugger/devToolsLogger.ts\0./debuggerApi.js\0unresolved-relative",
])

const APP_IMPORT_NEEDLES = [
  "vscode-adapter/generated",
  "generated/vscode",
  "generated\\vscode",
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
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/")
}

function relativeTo(root, target) {
  return normalizePath(path.relative(root, target))
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function resolveCandidate(basePath) {
  for (const extension of RESOLVE_EXTENSIONS) {
    const candidate = `${basePath}${extension}`
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }

  const sourceExtension = path.extname(basePath).toLowerCase()
  if (JAVASCRIPT_SOURCE_EXTENSIONS.has(sourceExtension)) {
    const sourceBasePath = basePath.slice(0, -sourceExtension.length)
    for (const extension of TYPESCRIPT_SOURCE_FALLBACK_EXTENSIONS) {
      const candidate = `${sourceBasePath}${extension}`
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
    }
  }

  for (const extension of RESOLVE_EXTENSIONS.filter(Boolean)) {
    const candidate = path.join(basePath, `index${extension}`)
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }

  return null
}

function walkFiles(root, callback) {
  if (!fs.existsSync(root)) return
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
        if (entry.name !== "node_modules" && entry.name !== ".git") stack.push(fullPath)
      } else if (entry.isFile()) {
        callback(fullPath)
      }
    }
  }
}

function readJson(filePath, findings, code) {
  if (!fs.existsSync(filePath)) {
    findings.push({ code, file: normalizePath(filePath), message: "Missing required generated closure report" })
    return null
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch (error) {
    findings.push({ code, file: normalizePath(filePath), message: `Invalid JSON: ${error.message}` })
    return null
  }
}

function missingShimKey(item) {
  return `${normalizePath(item.importer)}\0${item.specifier}\0${item.reason}`
}

function isAllowedMissingShim(importerRelativePath, specifier, reason) {
  return ALLOWED_DECLARATION_ONLY_MISSING_SHIMS.has(`${normalizePath(importerRelativePath)}\0${specifier}\0${reason}`)
}

function containsForbiddenExternalSourcePath(text) {
  return /D:\s*[\\/]+\s*SourceMirror(?:\s*[\\/]+\s*vscode)?/i.test(text)
    || /SourceMirror\s*[\\/]+\s*vscode/i.test(text)
}

function validateReportShape(report, findings) {
  if (!report) return
  if (report.reportKind !== "vscode-dependency-closure-import") {
    findings.push({ code: "report-kind", message: `Unexpected report kind: ${report.reportKind}` })
  }
  if (report.mode !== "import-closure") {
    findings.push({ code: "report-mode", message: `Generated closure report must be import-closure, got ${report.mode}` })
  }
  if (normalizePath(report.sourceRoot) !== "vendor/vscode") {
    findings.push({ code: "source-root", message: `Generated closure must read from vendor/vscode, got ${report.sourceRoot}` })
  }
  if (normalizePath(report.outRoot) !== "frontend/vite-project/src/vscode-adapter/generated/vscode") {
    findings.push({ code: "out-root", message: `Unexpected generated outRoot: ${report.outRoot}` })
  }
  if (!Array.isArray(report.copiedFiles) || report.copiedFiles.length === 0) {
    findings.push({ code: "copied-files", message: "Generated closure report has no copied files" })
  }
  if (Array.isArray(report.missingEntrypoints) && report.missingEntrypoints.length > 0) {
    findings.push({ code: "missing-entrypoint", message: `Missing entrypoints: ${report.missingEntrypoints.join(", ")}` })
  }
  if (containsForbiddenExternalSourcePath(JSON.stringify(report))) {
    findings.push({ code: "external-source-path", message: "Generated closure report contains a SourceMirror source path" })
  }
}

function validateCopiedFiles(report, root, generatedRoot, vendorRoot, findings) {
  if (!report || !Array.isArray(report.copiedFiles)) return

  for (const item of report.copiedFiles) {
    const sourceRelative = normalizePath(item.source)
    const destinationRelative = normalizePath(item.destination)
    const sourcePath = path.join(vendorRoot, sourceRelative)
    const destinationPath = path.join(root, destinationRelative)

    if (!sourceRelative.startsWith("src/vs/")) {
      findings.push({ code: "source-path", file: sourceRelative, message: "Copied source must stay under vendor/vscode/src/vs" })
    }
    if (!isInside(generatedRoot, destinationPath)) {
      findings.push({ code: "destination-path", file: destinationRelative, message: "Generated destination is outside generated/vscode" })
      continue
    }
    if (!fs.existsSync(sourcePath)) {
      findings.push({ code: "vendor-source-missing", file: sourceRelative, message: "Copied source is missing from vendor/vscode" })
    }
    if (!fs.existsSync(destinationPath)) {
      findings.push({ code: "generated-file-missing", file: destinationRelative, message: "Copied generated file is missing" })
    }
  }
}

function validateMissingShims(report, findings) {
  if (!report || !Array.isArray(report.missingShims)) return

  for (const item of report.missingShims) {
    if (!ALLOWED_DECLARATION_ONLY_MISSING_SHIMS.has(missingShimKey(item))) {
      findings.push({
        code: "unexpected-missing-shim",
        file: normalizePath(item.importer),
        message: `Unexpected missing shim ${item.specifier} (${item.reason})`,
      })
    }
  }
}

function validateGeneratedImports(report, root, generatedRoot, findings) {
  if (!report || !Array.isArray(report.copiedFiles)) return

  for (const item of report.copiedFiles) {
    const sourceRelative = normalizePath(item.source)
    const destinationPath = path.join(root, normalizePath(item.destination))
    if (!fs.existsSync(destinationPath) || !/\.[cm]?[jt]sx?$/i.test(destinationPath)) continue

    const source = fs.readFileSync(destinationPath, "utf8")
    if (containsForbiddenExternalSourcePath(source)) {
      findings.push({ code: "external-source-path", file: relativeTo(root, destinationPath), message: "Generated source contains a SourceMirror path" })
    }

    for (const reference of collectImportReferences(source)) {
      const specifier = reference.specifier
      if (specifier.startsWith("vs/")) {
        findings.push({ code: "unrewritten-vs-import", file: relativeTo(root, destinationPath), message: `Unrewritten VS Code import: ${specifier}` })
        continue
      }
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        findings.push({ code: "external-import", file: relativeTo(root, destinationPath), message: `Generated closure imports external module: ${specifier}` })
        continue
      }

      const resolved = resolveCandidate(path.resolve(path.dirname(destinationPath), specifier))
      if (!resolved && !isAllowedMissingShim(sourceRelative, specifier, "unresolved-relative")) {
        findings.push({ code: "unresolved-generated-import", file: relativeTo(root, destinationPath), message: `Generated relative import does not resolve: ${specifier}` })
      }
      if (resolved && !isInside(generatedRoot, resolved)) {
        findings.push({ code: "outside-generated-import", file: relativeTo(root, destinationPath), message: `Generated import escapes generated/vscode: ${specifier}` })
      }
    }
  }
}

function validateAppDoesNotImportGenerated(root, appSrcRoot, generatedRoot, findings) {
  walkFiles(appSrcRoot, (filePath) => {
    if (isInside(generatedRoot, filePath)) return
    if (!/\.(ts|tsx|vue|js|jsx|mjs|cjs)$/i.test(filePath)) return

    const source = fs.readFileSync(filePath, "utf8")
    const references = collectImportReferences(source)
    const generatedReferences = references.filter((reference) => {
      const specifier = normalizePath(reference.specifier)
      return APP_IMPORT_NEEDLES.some((needle) => specifier.includes(normalizePath(needle)))
    })

    if (generatedReferences.length > 0) {
      findings.push({
        code: "app-generated-import",
        file: relativeTo(root, filePath),
        message: "Main app/test source must not import isolated generated VS Code closure",
      })
    }
  })
}

function buildVscodeGeneratedClosureReport(options = {}) {
  const root = path.resolve(options.root || repoRoot)
  const generatedRoot = path.resolve(options.generatedRoot || path.join(root, "frontend", "vite-project", "src", "vscode-adapter", "generated", "vscode"))
  const vendorRoot = path.resolve(options.vendorRoot || path.join(root, "vendor", "vscode"))
  const appSrcRoot = path.resolve(options.appSrcRoot || path.join(root, "frontend", "vite-project", "src"))
  const reportPath = path.join(generatedRoot, "_import_report.json")
  const findings = []
  const generatedReport = readJson(reportPath, findings, "generated-report")

  validateReportShape(generatedReport, findings)
  validateCopiedFiles(generatedReport, root, generatedRoot, vendorRoot, findings)
  validateMissingShims(generatedReport, findings)
  validateGeneratedImports(generatedReport, root, generatedRoot, findings)
  validateAppDoesNotImportGenerated(root, appSrcRoot, generatedRoot, findings)

  return {
    reportKind: "vscode-generated-closure-check",
    root,
    ready: findings.length === 0,
    generatedRoot: relativeTo(root, generatedRoot),
    vendorRoot: relativeTo(root, vendorRoot),
    summary: {
      copiedFiles: Array.isArray(generatedReport?.copiedFiles) ? generatedReport.copiedFiles.length : 0,
      missingShims: Array.isArray(generatedReport?.missingShims) ? generatedReport.missingShims.length : 0,
      allowedMissingShims: Array.isArray(generatedReport?.missingShims)
        ? generatedReport.missingShims.filter((item) => ALLOWED_DECLARATION_ONLY_MISSING_SHIMS.has(missingShimKey(item))).length
        : 0,
      findings: findings.length,
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
    console.log(`VS Code generated closure check passed (${report.summary.copiedFiles} files, ${report.summary.allowedMissingShims}/${report.summary.missingShims} allowed declaration-only missing shims).`)
    return
  }

  console.error("VS Code generated closure check failed.")
  for (const finding of report.findings.slice(0, 50)) {
    const file = finding.file ? ` ${finding.file}` : ""
    console.error(`  [${finding.code}]${file} ${finding.message}`)
  }
  if (report.findings.length > 50) {
    console.error(`  ... ${report.findings.length - 50} more findings`)
  }
}

if (require.main === module) {
  try {
    const options = parseArgs()
    const report = buildVscodeGeneratedClosureReport(options)
    printReport(report, options)
    process.exit(report.ready ? 0 : 1)
  } catch (error) {
    console.error(`[vscode-generated-closure-check] ${error && error.message || error}`)
    process.exit(2)
  }
}

module.exports = {
  ALLOWED_DECLARATION_ONLY_MISSING_SHIMS,
  buildVscodeGeneratedClosureReport,
  parseArgs,
  printReport,
}
