#!/usr/bin/env node
/**
 * Extension Host validation script.
 *
 * Walks the extensions/ directory, scans each extension via the same
 * extensionScanner the EH uses at boot, statically extracts the
 * `vscode.<namespace>` API surface each extension touches, and compares
 * that against the mainThread* proxies actually implemented under
 * desktop/services/extensions-host/mainThread/.
 *
 * The goal is to answer:
 *   1. Do all bundled extensions even parse?
 *   2. What API surfaces do they touch?
 *   3. Which of those surfaces are still missing from our EH proxies?
 *
 * Run: node scripts/validate-eh.js
 */

const fs = require("fs")
const path = require("path")

const REPO_ROOT = path.resolve(__dirname, "..")
const EXTENSIONS_DIR = path.join(REPO_ROOT, "extensions")
const MAINTHREAD_DIR = path.join(REPO_ROOT, "desktop", "services", "extensions-host", "mainThread")

const { getExtensionId, scanExtensions } = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "extensionScanner"))
const { fileUriPathToFsPath } = require(path.join(REPO_ROOT, "desktop", "services", "extensions-host", "uriComponents"))

const TARGET_EXTENSIONS = ["theme-defaults", "typescript-language-features", "git"]

const VSCODE_NAMESPACES = [
  "commands", "window", "workspace", "languages", "extensions", "env",
  "Uri", "Range", "Position", "Selection", "EventEmitter",
  "scm", "debug", "tasks", "tests", "comments", "notebooks", "authentication",
  "l10n", "lm",
]

const VALUE_TYPE_SYMBOLS = new Set([
  "Uri", "Range", "Position", "Selection", "EventEmitter",
  "Disposable", "ThemeColor", "ThemeIcon", "MarkdownString",
])

const BUNDLE_PROVIDED_NAMESPACES = new Set([
  "l10n", "tasks", "tests", "comments", "notebooks",
  "authentication", "lm", "debug",
])

const PROXY_TO_NAMESPACE = {
  mainThreadCommands: ["commands"],
  mainThreadWindow: ["window"],
  mainThreadWorkspace: ["workspace"],
  mainThreadLanguageFeatures: ["languages"],
  mainThreadDocuments: ["workspace"],
  mainThreadTextEditors: ["window"],
  mainThreadDiagnostics: ["languages"],
  mainThreadMessageService: ["window"],
  mainThreadStatusBar: ["window"],
  mainThreadQuickOpen: ["window"],
  mainThreadProgress: ["window"],
  mainThreadOutputService: ["window"],
  mainThreadFileSystem: ["workspace"],
  mainThreadFileSystemEvents: ["workspace"],
  mainThreadConfiguration: ["workspace"],
  mainThreadStorage: ["extensions"],
  mainThreadClipboard: ["env"],
  mainThreadTheming: ["window"],
  mainThreadSCM: ["scm"],
  mainThreadTelemetry: ["env"],
  mainThreadLogService: ["env"],
  mainThreadBulkEdits: ["workspace"],
  mainThreadErrors: ["window"],
  mainThreadExtensionService: ["extensions"],
  mainThreadDebugService: ["debug"],
}

function listImplementedNamespaces() {
  const result = new Set()
  let proxies = []
  try {
    proxies = fs.readdirSync(MAINTHREAD_DIR).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js") && f !== "index.js")
  } catch {
    return { proxies: [], namespaces: result }
  }
  for (const file of proxies) {
    const base = file.replace(/\.js$/, "")
    const ns = PROXY_TO_NAMESPACE[base]
    if (ns) ns.forEach((n) => result.add(n))
  }
  return { proxies, namespaces: result }
}

function readAllSourceFiles(extDir) {
  const collected = []
  const stack = [extDir]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (/\.(js|ts|mjs|cjs)$/.test(entry.name)) {
        collected.push(full)
      }
    }
  }
  return collected
}

function extractApiUsage(extDir) {
  const namespaces = new Set()
  const apiCalls = new Set()
  const files = readAllSourceFiles(extDir).slice(0, 200)
  const apiPattern = /\bvscode\.(\w+)(?:\.(\w+))?/g

  for (const file of files) {
    let src
    try {
      src = fs.readFileSync(file, "utf8")
    } catch {
      continue
    }
    if (!src.includes("vscode")) continue
    let m
    while ((m = apiPattern.exec(src))) {
      const ns = m[1]
      const method = m[2]
      if (VSCODE_NAMESPACES.includes(ns)) {
        namespaces.add(ns)
        if (method) apiCalls.add(`${ns}.${method}`)
      }
    }
  }
  return { namespaces, apiCalls, fileCount: files.length }
}

function pad(s, n) {
  s = String(s)
  return s.length >= n ? s : s + " ".repeat(n - s.length)
}

function main() {
  console.log("=== Extension Host validation ===")
  console.log(`Repo root:       ${REPO_ROOT}`)
  console.log(`Extensions dir:  ${EXTENSIONS_DIR}`)
  console.log(`MainThread dir:  ${MAINTHREAD_DIR}`)
  console.log()

  const { proxies, namespaces: implemented } = listImplementedNamespaces()
  console.log(`Implemented mainThread proxies (${proxies.length}):`)
  for (const p of proxies) console.log(`  · ${p}`)
  console.log()
  console.log(`Implemented namespaces: ${[...implemented].sort().join(", ") || "(none)"}`)
  console.log()

  const scan = scanExtensions({ extensionsDir: EXTENSIONS_DIR })
  console.log(`Scanned extensions: ${scan.allExtensions.length}`)
  console.log()

  const allMissing = new Set()
  const rows = []

  for (const ext of scan.allExtensions) {
    const id = getExtensionId(ext)
    const extDir = fileUriPathToFsPath(ext.extensionLocation.path)
    const usage = extractApiUsage(extDir)
    const used = [...usage.namespaces].sort()
    const missing = used.filter(
      (ns) =>
        !implemented.has(ns) &&
        !VALUE_TYPE_SYMBOLS.has(ns) &&
        !BUNDLE_PROVIDED_NAMESPACES.has(ns),
    )
    missing.forEach((ns) => allMissing.add(ns))
    rows.push({
      id,
      target: TARGET_EXTENSIONS.some((t) => id.endsWith(`.${t}`)),
      hasMain: !!ext.main,
      activationEvents: Array.isArray(ext.activationEvents) ? ext.activationEvents.length : 0,
      contributesKeys: ext.contributes ? Object.keys(ext.contributes).length : 0,
      fileCount: usage.fileCount,
      used,
      missing,
      apiCalls: [...usage.apiCalls],
    })
  }

  console.log("Per-extension report:")
  console.log(
    pad("id", 48) +
      pad("target", 8) +
      pad("main", 6) +
      pad("acts", 6) +
      pad("contrib", 8) +
      pad("files", 7) +
      "uses",
  )
  console.log("-".repeat(120))
  for (const r of rows) {
    console.log(
      pad(r.id, 48) +
        pad(r.target ? "yes" : "", 8) +
        pad(r.hasMain ? "yes" : "no", 6) +
        pad(String(r.activationEvents), 6) +
        pad(String(r.contributesKeys), 8) +
        pad(String(r.fileCount), 7) +
        r.used.join(","),
    )
  }
  console.log()

  console.log("Coverage gaps (missing mainThread proxies):")
  if (!allMissing.size) {
    console.log("  ✓ No missing namespace proxies detected for the bundled extensions.")
  } else {
    for (const ns of [...allMissing].sort()) {
      const consumers = rows.filter((r) => r.missing.includes(ns)).map((r) => r.id)
      console.log(`  · ${ns}  ← needed by: ${consumers.join(", ")}`)
    }
  }
  console.log()
  console.log("(value-type symbols and bundle-provided namespaces are excluded from gaps)")
  console.log()

  const targetsFound = TARGET_EXTENSIONS.filter((t) =>
    rows.some((r) => r.id.endsWith(`.${t}`)),
  )
  const targetsMissing = TARGET_EXTENSIONS.filter((t) => !targetsFound.includes(t))
  console.log(`Target extensions found: ${targetsFound.join(", ") || "(none)"}`)
  if (targetsMissing.length) {
    console.log(`Target extensions MISSING: ${targetsMissing.join(", ")}`)
  }

  const hadFailures = !!targetsMissing.length
  process.exit(hadFailures ? 1 : 0)
}

if (require.main === module) {
  try {
    main()
  } catch (err) {
    console.error("[validate-eh] crashed:", err && err.stack ? err.stack : err)
    process.exit(2)
  }
}

module.exports = { extractApiUsage, listImplementedNamespaces }
