#!/usr/bin/env node

"use strict"

const fs = require("node:fs")
const path = require("node:path")

const repoRoot = path.resolve(__dirname, "..")
const defaultVendorRoot = path.join(repoRoot, "vendor", "vscode")
const defaultGeneratedOutRoot = path.join(repoRoot, "frontend", "vite-project", "src", "vscode-adapter", "generated", "vscode")
const DEFAULT_IMPORT_REPORT_NAME = "_import_report.json"
const DEFAULT_MISSING_SHIMS_REPORT_NAME = "_missing_shims.json"
const DEFAULT_VENDOR_MANIFEST_NAME = "_mirror_manifest.json"

const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".html"]
const STRIPPED_IMPORT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"])
const JAVASCRIPT_SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"])
const TYPESCRIPT_SOURCE_FALLBACK_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"]

function vendorRootFor(root = repoRoot) {
  return path.join(root, "vendor", "vscode")
}

function generatedOutRootFor(root = repoRoot) {
  return path.join(root, "frontend", "vite-project", "src", "vscode-adapter", "generated", "vscode")
}

function parseArgs(argv = process.argv.slice(2), root = repoRoot) {
  const options = {
    root,
    sourceRoot: vendorRootFor(root),
    sourceExplicit: false,
    outRoot: generatedOutRootFor(root),
    outExplicit: false,
    entrypoints: [],
    dryRun: false,
    json: false,
    refreshVendor: false,
    rewrite: "relative",
    reportPath: "",
    shimReportPath: "",
    mirrorManifestPath: "",
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const nextValue = () => {
      index += 1
      if (index >= argv.length) throw new Error(`${arg} requires a value`)
      return argv[index]
    }

    if (arg === "--dry" || arg === "--dry-run") {
      options.dryRun = true
    } else if (arg === "--json") {
      options.json = true
    } else if (arg === "--refresh-vendor") {
      options.refreshVendor = true
    } else if (arg === "--src") {
      options.sourceRoot = path.resolve(root, nextValue())
      options.sourceExplicit = true
    } else if (arg.startsWith("--src=")) {
      options.sourceRoot = path.resolve(root, arg.slice("--src=".length))
      options.sourceExplicit = true
    } else if (arg === "--out") {
      options.outRoot = path.resolve(root, nextValue())
      options.outExplicit = true
    } else if (arg.startsWith("--out=")) {
      options.outRoot = path.resolve(root, arg.slice("--out=".length))
      options.outExplicit = true
    } else if (arg === "--entry") {
      options.entrypoints.push(nextValue())
    } else if (arg.startsWith("--entry=")) {
      options.entrypoints.push(arg.slice("--entry=".length))
    } else if (arg === "--rewrite") {
      options.rewrite = nextValue()
    } else if (arg.startsWith("--rewrite=")) {
      options.rewrite = arg.slice("--rewrite=".length)
    } else if (arg === "--report") {
      options.reportPath = path.resolve(root, nextValue())
    } else if (arg.startsWith("--report=")) {
      options.reportPath = path.resolve(root, arg.slice("--report=".length))
    } else if (arg === "--shim-report") {
      options.shimReportPath = path.resolve(root, nextValue())
    } else if (arg.startsWith("--shim-report=")) {
      options.shimReportPath = path.resolve(root, arg.slice("--shim-report=".length))
    } else if (arg === "--mirror-manifest") {
      options.mirrorManifestPath = path.resolve(root, nextValue())
    } else if (arg.startsWith("--mirror-manifest=")) {
      options.mirrorManifestPath = path.resolve(root, arg.slice("--mirror-manifest=".length))
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (options.refreshVendor) {
    if (!options.sourceExplicit) {
      throw new Error("--refresh-vendor requires an explicit --src so external VS Code reads are intentional")
    }
    if (!options.outExplicit) {
      options.outRoot = vendorRootFor(root)
    }
    if (!argv.some((arg) => arg === "--rewrite" || arg.startsWith("--rewrite="))) {
      options.rewrite = "preserve"
    }
  }

  if (options.rewrite !== "relative" && options.rewrite !== "preserve") {
    throw new Error("--rewrite must be relative or preserve")
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

function validateOptions(options) {
  const root = path.resolve(options.root || repoRoot)
  const sourceRoot = path.resolve(options.sourceRoot || vendorRootFor(root))
  const outRoot = path.resolve(options.outRoot || generatedOutRootFor(root))
  const vendorRoot = vendorRootFor(root)

  if (!options.entrypoints.length) {
    throw new Error("At least one --entry is required")
  }
  if (!isInside(root, outRoot)) {
    throw new Error(`Output must stay inside the Codek repo: ${outRoot}`)
  }
  if (options.refreshVendor && !isInside(vendorRoot, outRoot)) {
    throw new Error(`--refresh-vendor output must stay inside vendor/vscode: ${outRoot}`)
  }
  if (!options.refreshVendor && !isInside(root, sourceRoot)) {
    throw new Error("External VS Code source reads require --refresh-vendor")
  }
  if (!options.refreshVendor && !isInside(vendorRoot, sourceRoot)) {
    throw new Error("Non-refresh imports must read from the repository vendor/vscode mirror")
  }
  if (isInside(sourceRoot, outRoot) && isInside(outRoot, sourceRoot) && options.rewrite === "relative") {
    throw new Error("Refusing to rewrite imports in place; use --out for generated adapters or --rewrite=preserve")
  }
  if (options.reportPath) {
    const reportPath = path.resolve(options.reportPath)
    if (!isInside(root, reportPath)) {
      throw new Error(`Report output must stay inside the Codek repo: ${reportPath}`)
    }
    if (options.refreshVendor && !isInside(vendorRoot, reportPath)) {
      throw new Error(`--refresh-vendor report output must stay inside vendor/vscode: ${reportPath}`)
    }
  }
  if (options.shimReportPath) {
    const shimReportPath = path.resolve(options.shimReportPath)
    if (!isInside(root, shimReportPath)) {
      throw new Error(`Shim report output must stay inside the Codek repo: ${shimReportPath}`)
    }
    if (options.refreshVendor && !isInside(vendorRoot, shimReportPath)) {
      throw new Error(`--refresh-vendor shim report output must stay inside vendor/vscode: ${shimReportPath}`)
    }
  }
  if (options.mirrorManifestPath) {
    const manifestPath = path.resolve(options.mirrorManifestPath)
    if (!isInside(root, manifestPath)) {
      throw new Error(`Mirror manifest output must stay inside the Codek repo: ${manifestPath}`)
    }
    if (options.refreshVendor && !isInside(vendorRoot, manifestPath)) {
      throw new Error(`--refresh-vendor mirror manifest must stay inside vendor/vscode: ${manifestPath}`)
    }
  }

  return { ...options, root, sourceRoot, outRoot }
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8")
}

function stripCommentsPreserveStrings(source) {
  const text = String(source || "")
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

function collectImportReferences(source) {
  const stripped = stripCommentsPreserveStrings(source)
  const references = []
  const patterns = [
    { kind: "static", pattern: /\b(?:import|export)\s+(?:type\s+)?[^;"'`]*?\bfrom\s*["']([^"']+)["']/g },
    { kind: "side-effect", pattern: /\bimport\s+(?:type\s+)?["']([^"']+)["']/g },
    { kind: "dynamic", pattern: /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g },
    { kind: "commonjs", pattern: /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g },
  ]

  for (const { kind, pattern } of patterns) {
    let match
    while ((match = pattern.exec(stripped))) {
      const specifier = match[1]
      const start = match.index + match[0].indexOf(specifier)
      references.push({ specifier, start, end: start + specifier.length, kind: classifyImportReferenceKind(kind, match[0], specifier) })
    }
  }

  return references.sort((a, b) => a.start - b.start)
}

function classifyImportReferenceKind(defaultKind, statement, specifier) {
  if (specifier.startsWith("vs/css!")) return "amd-css"
  if (specifier.startsWith("vs/nls!")) return "amd-nls"
  if (/^\s*(?:import|export)\s+type\b/.test(statement)) return "type"
  return defaultKind
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

function normalizeEntrypoint(entrypoint, sourceRoot) {
  const normalized = normalizePath(entrypoint)
  if (path.isAbsolute(entrypoint)) return path.resolve(entrypoint)
  if (normalized.startsWith("src/vs/")) return path.resolve(sourceRoot, normalized)
  if (normalized.startsWith("vs/")) return path.resolve(sourceRoot, "src", normalized)
  return path.resolve(sourceRoot, entrypoint)
}

function resolveAmdCssImport(specifier, importerFile, sourceRoot) {
  const target = specifier.slice("vs/css!".length)
  if (!target) return null
  if (target.startsWith("./") || target.startsWith("../")) {
    return resolveCandidate(path.resolve(path.dirname(importerFile), target))
  }
  if (target.startsWith("vs/")) {
    return resolveCandidate(path.join(sourceRoot, "src", target))
  }
  return null
}

function resolveImport(specifier, importerFile, sourceRoot) {
  if (specifier.startsWith("vs/css!")) {
    return resolveAmdCssImport(specifier, importerFile, sourceRoot)
  }
  if (specifier.startsWith("vs/")) {
    return resolveCandidate(path.join(sourceRoot, "src", specifier))
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return resolveCandidate(path.resolve(path.dirname(importerFile), specifier))
  }
  return null
}

function classifyMissing(specifier, importerFile, sourceRoot) {
  if (specifier.startsWith("vs/css!")) return "unresolved-css-plugin"
  if (specifier.startsWith("vs/nls!")) return "unresolved-nls-plugin"
  if (specifier.startsWith("vs/")) return "unresolved-vs"
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return isInside(sourceRoot, path.resolve(path.dirname(importerFile), specifier))
      ? "unresolved-relative"
      : "outside-source-root"
  }
  return "external"
}

function destinationFor(sourceFile, sourceRoot, outRoot) {
  return path.join(outRoot, path.relative(sourceRoot, sourceFile))
}

function importSpecifierFor(fromDestFile, toDestFile, options = {}) {
  let relative = normalizePath(path.relative(path.dirname(fromDestFile), toDestFile))
  if (!relative.startsWith(".")) relative = `./${relative}`
  const extension = path.extname(relative)
  if (options.stripExtension !== false && STRIPPED_IMPORT_EXTENSIONS.has(extension)) {
    relative = relative.slice(0, -extension.length)
  }
  return relative
}

function importSpecifierForReference(reference, fromDestFile, toDestFile) {
  if (reference.kind === "amd-css") {
    return importSpecifierFor(fromDestFile, toDestFile, { stripExtension: false })
  }
  return importSpecifierFor(fromDestFile, toDestFile)
}

function rewriteImports(source, sourceFile, sourceRoot, outRoot, copiedFiles) {
  const references = collectImportReferences(source)
  const replacements = []
  const missingShims = []

  for (const reference of references) {
    const resolved = resolveImport(reference.specifier, sourceFile, sourceRoot)
    if (resolved && copiedFiles.has(resolved)) {
      replacements.push({
        start: reference.start,
        end: reference.end,
        value: importSpecifierForReference(reference, destinationFor(sourceFile, sourceRoot, outRoot), destinationFor(resolved, sourceRoot, outRoot)),
      })
    } else if (!resolved) {
      missingShims.push({
        importer: relativeTo(sourceRoot, sourceFile),
        specifier: reference.specifier,
        kind: reference.kind,
        reason: classifyMissing(reference.specifier, sourceFile, sourceRoot),
      })
    }
  }

  let rewritten = source
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.value}${rewritten.slice(replacement.end)}`
  }
  return { rewritten, missingShims }
}

function buildClosure(options) {
  const sourceRoot = options.sourceRoot
  const queue = []
  const copiedFiles = new Set()
  const missingEntrypoints = []
  const edges = []

  for (const entrypoint of options.entrypoints) {
    const normalized = normalizeEntrypoint(entrypoint, sourceRoot)
    const resolved = resolveCandidate(normalized)
    if (!resolved || !isInside(path.join(sourceRoot, "src", "vs"), resolved)) {
      missingEntrypoints.push(entrypoint)
      continue
    }
    queue.push(resolved)
    copiedFiles.add(resolved)
  }

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]
    const source = readText(current)
    for (const reference of collectImportReferences(source)) {
      const resolved = resolveImport(reference.specifier, current, sourceRoot)
      edges.push({
        from: relativeTo(sourceRoot, current),
        specifier: reference.specifier,
        kind: reference.kind,
        to: resolved ? relativeTo(sourceRoot, resolved) : "",
      })
      if (!resolved || !isInside(path.join(sourceRoot, "src", "vs"), resolved)) continue
      if (!copiedFiles.has(resolved)) {
        copiedFiles.add(resolved)
        queue.push(resolved)
      }
    }
  }

  return { copiedFiles, edges, missingEntrypoints }
}

function uniqueMissingShims(items) {
  const seen = new Set()
  const unique = []
  for (const item of items) {
    const key = `${item.importer}\0${item.specifier}\0${item.kind || ""}\0${item.reason}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(item)
  }
  return unique.sort((a, b) => `${a.reason}:${a.specifier}:${a.kind || ""}:${a.importer}`.localeCompare(`${b.reason}:${b.specifier}:${b.kind || ""}:${b.importer}`))
}

function buildMissingShimReport(report, missingShims) {
  return {
    reportKind: "vscode-missing-shims",
    ready: missingShims.length === 0,
    mode: report.mode,
    rewrite: report.rewrite,
    sourceRoot: report.mode === "refresh-vendor" ? "external-vscode-checkout" : report.sourceRoot,
    outRoot: report.outRoot,
    entrypoints: report.entrypoints,
    summary: {
      missingShims: missingShims.length,
    },
    missingShims,
  }
}

function buildVendorMirrorManifest(report) {
  return {
    reportKind: "vscode-vendor-mirror-manifest",
    schemaVersion: 1,
    mirrorRoot: report.outRoot,
    sourcePolicy: "External VS Code checkout paths are intentionally not persisted; refresh requires explicit --refresh-vendor --src.",
    runtimePolicy: "Runtime, build, and packaged Codek code must use repository-local vendor/vscode or generated adapter output.",
    rewrite: report.rewrite,
    entrypoints: report.entrypoints,
    generatedAt: new Date().toISOString(),
    summary: {
      copiedFiles: report.summary.copiedFiles,
      edges: report.summary.edges,
      missingShims: report.summary.missingShims,
    },
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function importVscodeClosure(input = {}) {
  const options = validateOptions(input)
  const { copiedFiles, edges, missingEntrypoints } = buildClosure(options)
  const missingShims = []
  const written = []

  for (const sourceFile of Array.from(copiedFiles).sort()) {
    const source = readText(sourceFile)
    const destination = destinationFor(sourceFile, options.sourceRoot, options.outRoot)
    const result = options.rewrite === "relative"
      ? rewriteImports(source, sourceFile, options.sourceRoot, options.outRoot, copiedFiles)
      : { rewritten: source, missingShims: [] }
    missingShims.push(...result.missingShims)

    if (!options.dryRun) {
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, result.rewritten, "utf8")
    }
    written.push({
      source: relativeTo(options.sourceRoot, sourceFile),
      destination: relativeTo(options.root, destination),
    })
  }

  const uniqueShims = uniqueMissingShims(missingShims)
  const report = {
    reportKind: "vscode-dependency-closure-import",
    ready: missingEntrypoints.length === 0,
    mode: options.refreshVendor ? "refresh-vendor" : "import-closure",
    rewrite: options.rewrite,
    dryRun: Boolean(options.dryRun),
    sourceRoot: relativeTo(options.root, options.sourceRoot),
    outRoot: relativeTo(options.root, options.outRoot),
    entrypoints: options.entrypoints,
    summary: {
      entrypoints: options.entrypoints.length,
      missingEntrypoints: missingEntrypoints.length,
      copiedFiles: written.length,
      edges: edges.length,
      missingShims: uniqueShims.length,
    },
    contract: {
      source: options.refreshVendor
        ? "Explicit refresh-vendor run may read an external VS Code checkout."
        : "Default imports must read from repository-local vendor/vscode.",
      output: options.refreshVendor
        ? "Refresh output must stay inside vendor/vscode."
        : "Adapter output must stay inside the Codek repository.",
      importRewrite: options.rewrite === "relative"
        ? "Copied vs/* imports are rewritten to relative imports for self-contained adapter output."
        : "Imports are preserved for vendor mirror refresh output.",
      shimManifest: options.dryRun ? "inline-only" : DEFAULT_MISSING_SHIMS_REPORT_NAME,
    },
    missingEntrypoints,
    copiedFiles: written,
    missingShims: uniqueShims,
    edges,
  }

  if (!options.dryRun) {
    const reportPath = options.reportPath || path.join(options.outRoot, DEFAULT_IMPORT_REPORT_NAME)
    const shimReportPath = options.shimReportPath || path.join(options.outRoot, DEFAULT_MISSING_SHIMS_REPORT_NAME)
    report.reportPath = relativeTo(options.root, reportPath)
    report.shimReportPath = relativeTo(options.root, shimReportPath)
    writeJson(shimReportPath, buildMissingShimReport(report, uniqueShims))
    if (options.refreshVendor) {
      const mirrorManifestPath = options.mirrorManifestPath || path.join(options.outRoot, DEFAULT_VENDOR_MANIFEST_NAME)
      report.mirrorManifestPath = relativeTo(options.root, mirrorManifestPath)
      writeJson(mirrorManifestPath, buildVendorMirrorManifest(report))
    }
    writeJson(reportPath, report)
  }

  return report
}

function printReport(report, options = {}) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }
  console.log(`[vscode-import] mode: ${report.mode}`)
  console.log(`[vscode-import] source: ${report.sourceRoot}`)
  console.log(`[vscode-import] out: ${report.outRoot}`)
  console.log(`[vscode-import] copied: ${report.summary.copiedFiles}`)
  console.log(`[vscode-import] missing shims: ${report.summary.missingShims}`)
  if (report.missingEntrypoints.length) {
    console.error(`[vscode-import] missing entrypoints: ${report.missingEntrypoints.join(", ")}`)
  }
  if (report.reportPath) {
    console.log(`[vscode-import] report: ${report.reportPath}`)
  }
}

if (require.main === module) {
  try {
    const options = validateOptions(parseArgs())
    const report = importVscodeClosure(options)
    printReport(report, options)
    process.exit(report.ready ? 0 : 1)
  } catch (error) {
    console.error(`[vscode-import] ${error && error.message || error}`)
    process.exit(2)
  }
}

module.exports = {
  buildClosure,
  collectImportReferences,
  DEFAULT_IMPORT_REPORT_NAME,
  DEFAULT_MISSING_SHIMS_REPORT_NAME,
  DEFAULT_VENDOR_MANIFEST_NAME,
  defaultGeneratedOutRoot,
  defaultVendorRoot,
  importVscodeClosure,
  parseArgs,
  rewriteImports,
  stripCommentsPreserveStrings,
  validateOptions,
}
