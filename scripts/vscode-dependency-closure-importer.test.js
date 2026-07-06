const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  collectImportReferences,
  importVscodeClosure,
  parseArgs,
  validateOptions,
} = require("./vscode-dependency-closure-importer")
const {
  buildVscodeGeneratedClosureReport,
} = require("./vscode-generated-closure-check")

function fixtureRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codek-vscode-importer-"))
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, "utf8")
  return filePath
}

function readFile(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8")
}

test("collects static, dynamic, require, side-effect, and export imports without comment hits", () => {
  const refs = collectImportReferences(`
    // import { ignored } from "vs/comment/ignored"
    import { Event } from "vs/base/common/event"
    import type { IDisposable } from "vs/base/common/lifecycle"
    import "vs/css!./media/widget"
    export { Disposable } from "vs/base/common/lifecycle"
    const uri = require("vs/base/common/uri")
    import nls = require("vs/nls")
    const late = import("vs/platform/log/common/log")
  `)

  assert.deepEqual(refs.map((ref) => `${ref.kind}:${ref.specifier}`), [
    "static:vs/base/common/event",
    "type:vs/base/common/lifecycle",
    "amd-css:vs/css!./media/widget",
    "static:vs/base/common/lifecycle",
    "commonjs:vs/base/common/uri",
    "commonjs:vs/nls",
    "dynamic:vs/platform/log/common/log",
  ])
})

test("copies the src/vs dependency closure and rewrites copied VS Code imports to relative imports", () => {
  const root = fixtureRoot()
  const sourceRoot = path.join(root, "vendor", "vscode")
  const outRoot = path.join(root, "frontend", "vite-project", "src", "vscode-adapter", "generated", "vscode")

  writeFile(sourceRoot, "src/vs/platform/demo/common/demo.ts", `
    import { Event } from "vs/base/common/event"
    import { helper } from "./helper"
    import { missing } from "vs/platform/missing/common/missing"
    import { localMissing } from "./missingLocal"
    import "external-package"
    export const demo = Event + helper + missing + localMissing
  `)
  writeFile(sourceRoot, "src/vs/platform/demo/common/helper.ts", `
    import { Event } from "vs/base/common/event"
    export const helper = Event
  `)
  writeFile(sourceRoot, "src/vs/base/common/event.ts", "export const Event = 'event'\n")

  const report = importVscodeClosure({
    root,
    sourceRoot,
    outRoot,
    entrypoints: ["src/vs/platform/demo/common/demo.ts"],
    rewrite: "relative",
  })

  assert.equal(report.ready, true)
  assert.equal(report.summary.copiedFiles, 3)
  assert.deepEqual(report.copiedFiles.map((item) => item.source).sort(), [
    "src/vs/base/common/event.ts",
    "src/vs/platform/demo/common/demo.ts",
    "src/vs/platform/demo/common/helper.ts",
  ])
  assert.deepEqual(report.missingShims.map((item) => `${item.reason}:${item.specifier}`).sort(), [
    "external:external-package",
    "unresolved-relative:./missingLocal",
    "unresolved-vs:vs/platform/missing/common/missing",
  ])

  const imported = readFile(outRoot, "src/vs/platform/demo/common/demo.ts")
  assert.match(imported, /from "\.\.\/\.\.\/\.\.\/base\/common\/event"/)
  assert.match(imported, /from "\.\/helper"/)
  assert.match(imported, /from "vs\/platform\/missing\/common\/missing"/)
  assert.ok(fs.existsSync(path.join(outRoot, "_import_report.json")))
  assert.ok(fs.existsSync(path.join(outRoot, "_missing_shims.json")))

  const shimReport = JSON.parse(readFile(outRoot, "_missing_shims.json"))
  assert.equal(shimReport.reportKind, "vscode-missing-shims")
  assert.equal(shimReport.ready, false)
  assert.deepEqual(shimReport.missingShims, report.missingShims)
  assert.equal(report.shimReportPath, "frontend/vite-project/src/vscode-adapter/generated/vscode/_missing_shims.json")
})

test("copies VS Code AMD css plugin assets and rewrites them to bundled relative css imports", () => {
  const root = fixtureRoot()
  const sourceRoot = path.join(root, "vendor", "vscode")
  const outRoot = path.join(root, "frontend", "vite-project", "src", "vscode-adapter", "generated", "vscode")

  writeFile(sourceRoot, "src/vs/workbench/browser/parts/editor/editorPart.ts", `
    import "vs/css!./media/editorpart"
    export const editorPart = true
  `)
  writeFile(sourceRoot, "src/vs/workbench/browser/parts/editor/media/editorpart.css", ".editor-part { display: flex; }\n")

  const report = importVscodeClosure({
    root,
    sourceRoot,
    outRoot,
    entrypoints: ["src/vs/workbench/browser/parts/editor/editorPart.ts"],
    rewrite: "relative",
  })

  assert.equal(report.summary.copiedFiles, 2)
  assert.deepEqual(report.missingShims, [])
  assert.ok(report.edges.some((edge) => edge.kind === "amd-css" && edge.to.endsWith("media/editorpart.css")))

  const imported = readFile(outRoot, "src/vs/workbench/browser/parts/editor/editorPart.ts")
  assert.match(imported, /import "\.\/media\/editorpart\.css"/)
  assert.ok(fs.existsSync(path.join(outRoot, "src/vs/workbench/browser/parts/editor/media/editorpart.css")))
})

test("reports unresolved VS Code AMD css plugin imports as missing shims", () => {
  const root = fixtureRoot()
  const sourceRoot = path.join(root, "vendor", "vscode")
  const outRoot = path.join(root, "frontend", "vite-project", "src", "vscode-adapter", "generated", "vscode")

  writeFile(sourceRoot, "src/vs/workbench/browser/parts/editor/editorPart.ts", `
    import "vs/css!./media/missing"
    export const editorPart = true
  `)

  const report = importVscodeClosure({
    root,
    sourceRoot,
    outRoot,
    entrypoints: ["src/vs/workbench/browser/parts/editor/editorPart.ts"],
    rewrite: "relative",
  })

  assert.deepEqual(report.missingShims, [{
    importer: "src/vs/workbench/browser/parts/editor/editorPart.ts",
    specifier: "vs/css!./media/missing",
    kind: "amd-css",
    reason: "unresolved-css-plugin",
  }])
})

test("resolves VS Code .js specifiers to TypeScript source files", () => {
  const root = fixtureRoot()
  const sourceRoot = path.join(root, "vendor", "vscode")
  const outRoot = path.join(root, "frontend", "vite-project", "src", "vscode-adapter", "generated", "vscode")

  writeFile(sourceRoot, "src/vs/base/common/event.ts", `
    import { Disposable } from "./lifecycle.js"
    import { URI } from "vs/base/common/uri.js"
    export const value = Disposable.None && URI
  `)
  writeFile(sourceRoot, "src/vs/base/common/lifecycle.ts", "export const Disposable = { None: null }\n")
  writeFile(sourceRoot, "src/vs/base/common/uri.ts", "export const URI = { parse: () => ({}) }\n")

  const report = importVscodeClosure({
    root,
    sourceRoot,
    outRoot,
    entrypoints: ["src/vs/base/common/event.ts"],
    rewrite: "relative",
  })

  assert.equal(report.summary.copiedFiles, 3)
  assert.deepEqual(report.missingShims, [])
  assert.deepEqual(report.edges.map((edge) => `${edge.specifier}->${edge.to}`).sort(), [
    "./lifecycle.js->src/vs/base/common/lifecycle.ts",
    "vs/base/common/uri.js->src/vs/base/common/uri.ts",
  ])
  const imported = readFile(outRoot, "src/vs/base/common/event.ts")
  assert.match(imported, /from "\.\/lifecycle"/)
  assert.match(imported, /from "\.\/uri"/)
})

test("refreshes a small external VS Code mirror and imports generated closure without SourceMirror runtime paths", () => {
  const root = fixtureRoot()
  const externalSource = fixtureRoot()

  writeFile(externalSource, "src/vs/base/common/event.ts", `
    import { Disposable } from "./lifecycle.js"
    import { URI } from "vs/base/common/uri.js"
    import { missing } from "vs/base/common/missingShim"
    import "external-package"
    export const event = Disposable.None || URI || missing
  `)
  writeFile(externalSource, "src/vs/base/common/lifecycle.ts", "export const Disposable = { None: null }\n")
  writeFile(externalSource, "src/vs/base/common/uri.ts", "export const URI = { parse: () => ({}) }\n")

  const refreshReport = importVscodeClosure({
    root,
    sourceRoot: externalSource,
    outRoot: path.join(root, "vendor", "vscode"),
    entrypoints: ["src/vs/base/common/event.ts"],
    refreshVendor: true,
    rewrite: "preserve",
  })

  assert.equal(refreshReport.mode, "refresh-vendor")
  assert.equal(refreshReport.summary.copiedFiles, 3)
  assert.equal(refreshReport.sourceRoot, path.relative(root, externalSource).replace(/\\/g, "/"))
  assert.equal(refreshReport.mirrorManifestPath, "vendor/vscode/_mirror_manifest.json")

  const mirrorManifest = JSON.parse(readFile(root, "vendor/vscode/_mirror_manifest.json"))
  assert.equal(mirrorManifest.reportKind, "vscode-vendor-mirror-manifest")
  assert.equal(mirrorManifest.mirrorRoot, "vendor/vscode")
  assert.doesNotMatch(JSON.stringify(mirrorManifest), new RegExp(externalSource.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")))
  assert.doesNotMatch(JSON.stringify(mirrorManifest), /SourceMirror|D:[\\/]+SourceMirror/)

  const refreshShimReport = JSON.parse(readFile(root, "vendor/vscode/_missing_shims.json"))
  assert.equal(refreshShimReport.sourceRoot, "external-vscode-checkout")
  assert.doesNotMatch(JSON.stringify(refreshShimReport), new RegExp(externalSource.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")))

  const importReport = importVscodeClosure({
    root,
    entrypoints: ["src/vs/base/common/event.ts"],
    rewrite: "relative",
  })

  assert.equal(importReport.mode, "import-closure")
  assert.equal(importReport.sourceRoot, "vendor/vscode")
  assert.equal(importReport.summary.copiedFiles, 3)
  assert.deepEqual(importReport.missingShims.map((item) => `${item.reason}:${item.specifier}`).sort(), [
    "external:external-package",
    "unresolved-vs:vs/base/common/missingShim",
  ])

  const generatedFile = readFile(root, "frontend/vite-project/src/vscode-adapter/generated/vscode/src/vs/base/common/event.ts")
  const generatedReport = readFile(root, "frontend/vite-project/src/vscode-adapter/generated/vscode/_import_report.json")
  assert.doesNotMatch(generatedFile, /SourceMirror|D:[\\/]+SourceMirror/)
  assert.doesNotMatch(generatedReport, /SourceMirror|D:[\\/]+SourceMirror/)
})

test("defaults to repo vendor source and generated adapter output", () => {
  const root = fixtureRoot()
  const parsed = parseArgs(["--entry", "src/vs/base/common/event.ts"], root)
  const options = validateOptions(parsed)

  assert.equal(options.sourceRoot, path.join(root, "vendor", "vscode"))
  assert.equal(options.outRoot, path.join(root, "frontend", "vite-project", "src", "vscode-adapter", "generated", "vscode"))
  assert.equal(options.rewrite, "relative")
})

test("direct importer calls also default to the provided repo root vendor mirror", () => {
  const root = fixtureRoot()
  writeFile(root, "vendor/vscode/src/vs/base/common/event.ts", "export const Event = 'event'\n")

  const report = importVscodeClosure({
    root,
    entrypoints: ["src/vs/base/common/event.ts"],
    dryRun: true,
  })

  assert.equal(report.sourceRoot, "vendor/vscode")
  assert.equal(report.outRoot, "frontend/vite-project/src/vscode-adapter/generated/vscode")
  assert.equal(report.summary.copiedFiles, 1)
})

test("requires refresh-vendor for external source reads and constrains refresh output to vendor/vscode", () => {
  const root = fixtureRoot()
  const externalSource = fixtureRoot()

  assert.throws(
    () => validateOptions({
      root,
      sourceRoot: externalSource,
      outRoot: path.join(root, "frontend", "generated"),
      entrypoints: ["src/vs/base/common/event.ts"],
      rewrite: "relative",
    }),
    /External VS Code source reads require --refresh-vendor/,
  )

  assert.throws(
    () => validateOptions({
      root,
      sourceRoot: externalSource,
      outRoot: path.join(root, "frontend", "generated"),
      entrypoints: ["src/vs/base/common/event.ts"],
      refreshVendor: true,
      rewrite: "preserve",
    }),
    /--refresh-vendor output must stay inside vendor\/vscode/,
  )

  assert.throws(
    () => validateOptions({
      root,
      sourceRoot: externalSource,
      outRoot: path.join(root, "vendor", "vscode"),
      reportPath: path.join(root, "reports", "import.json"),
      entrypoints: ["src/vs/base/common/event.ts"],
      refreshVendor: true,
      rewrite: "preserve",
    }),
    /--refresh-vendor report output must stay inside vendor\/vscode/,
  )

  assert.throws(
    () => validateOptions({
      root,
      sourceRoot: externalSource,
      outRoot: path.join(root, "vendor", "vscode"),
      shimReportPath: path.join(root, "reports", "missing-shims.json"),
      entrypoints: ["src/vs/base/common/event.ts"],
      refreshVendor: true,
      rewrite: "preserve",
    }),
    /--refresh-vendor shim report output must stay inside vendor\/vscode/,
  )

  const options = validateOptions({
    root,
    sourceRoot: externalSource,
    outRoot: path.join(root, "vendor", "vscode"),
    entrypoints: ["src/vs/base/common/event.ts"],
    refreshVendor: true,
    rewrite: "preserve",
  })
  assert.equal(options.outRoot, path.join(root, "vendor", "vscode"))
})

test("rejects non-refresh reads from arbitrary in-repo folders", () => {
  const root = fixtureRoot()
  assert.throws(
    () => validateOptions({
      root,
      sourceRoot: path.join(root, "tmp", "vscode"),
      outRoot: path.join(root, "frontend", "vite-project", "src", "vscode-adapter", "generated", "vscode"),
      entrypoints: ["src/vs/base/common/event.ts"],
      rewrite: "relative",
    }),
    /Non-refresh imports must read from the repository vendor\/vscode mirror/,
  )
})

test("enforces the external source boundary for direct importer calls", () => {
  const root = fixtureRoot()
  const externalSource = fixtureRoot()
  writeFile(externalSource, "src/vs/base/common/event.ts", "export const Event = 'event'\n")

  assert.throws(
    () => importVscodeClosure({
      root,
      sourceRoot: externalSource,
      outRoot: path.join(root, "frontend", "vite-project", "src", "vscode-adapter", "generated", "vscode"),
      entrypoints: ["src/vs/base/common/event.ts"],
      rewrite: "relative",
    }),
    /External VS Code source reads require --refresh-vendor/,
  )
})

test("refuses to rewrite imports in place inside the vendor mirror", () => {
  const root = fixtureRoot()
  assert.throws(
    () => validateOptions({
      root,
      sourceRoot: path.join(root, "vendor", "vscode"),
      outRoot: path.join(root, "vendor", "vscode"),
      entrypoints: ["src/vs/base/common/event.ts"],
      rewrite: "relative",
    }),
    /Refusing to rewrite imports in place/,
  )
})

test("generated closure check accepts isolated vendor output with explicit declaration-only missing shim", () => {
  const root = fixtureRoot()
  const sourceRoot = path.join(root, "vendor", "vscode")
  const outRoot = path.join(root, "frontend", "vite-project", "src", "vscode-adapter", "generated", "vscode")

  writeFile(sourceRoot, "src/vs/base/common/observableInternal/logging/debugger/devToolsLogger.ts", `
    import { helper } from "./utils.js"
    import type { DebuggerApi } from "./debuggerApi.js"
    export const logger = helper as DebuggerApi
  `)
  writeFile(sourceRoot, "src/vs/base/common/observableInternal/logging/debugger/utils.ts", "export const helper = {}\n")
  writeFile(root, "frontend/vite-project/src/app.ts", "export const app = true\n")

  importVscodeClosure({
    root,
    sourceRoot,
    outRoot,
    entrypoints: ["src/vs/base/common/observableInternal/logging/debugger/devToolsLogger.ts"],
    rewrite: "relative",
  })

  const report = buildVscodeGeneratedClosureReport({ root })

  assert.equal(report.ready, true)
  assert.equal(report.summary.copiedFiles, 2)
  assert.equal(report.summary.missingShims, 1)
  assert.equal(report.summary.allowedMissingShims, 1)
})

test("generated closure check fails when app code imports isolated generated output", () => {
  const root = fixtureRoot()
  const sourceRoot = path.join(root, "vendor", "vscode")
  const outRoot = path.join(root, "frontend", "vite-project", "src", "vscode-adapter", "generated", "vscode")

  writeFile(sourceRoot, "src/vs/base/common/lifecycle.ts", "export const Disposable = { None: null }\n")
  writeFile(root, "frontend/vite-project/src/app.ts", `
    import { Disposable } from "./vscode-adapter/generated/vscode/src/vs/base/common/lifecycle"
    export const app = Disposable
  `)

  importVscodeClosure({
    root,
    sourceRoot,
    outRoot,
    entrypoints: ["src/vs/base/common/lifecycle.ts"],
    rewrite: "relative",
  })

  const report = buildVscodeGeneratedClosureReport({ root })

  assert.equal(report.ready, false)
  assert.ok(report.findings.some((finding) => finding.code === "app-generated-import"))
})
