const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildVscodeSourceBoundaryReport,
  scanFile,
  stripCommentsPreserveLines,
} = require("./vscode-source-boundary-check")

function makeFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codek-vscode-boundary-"))
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, "utf8")
  return filePath
}

test("flags runtime imports and filesystem references to SourceMirror vscode", () => {
  const root = makeFixture()
  writeFile(root, "src/runtime.js", `
    const fs = require("node:fs")
    const path = require("node:path")
    const source = fs.readFileSync("D:\\\\SourceMirror\\\\vscode\\\\src\\\\vs\\\\workbench\\\\common\\\\views.ts", "utf8")
    const other = path.join("D:", "SourceMirror", "vscode", "src")
    module.exports = source + other
  `)

  const report = buildVscodeSourceBoundaryReport({ root })

  assert.equal(report.ready, false)
  assert.equal(report.summary.findings, 2)
  assert.equal(report.summary.runtimeFindings, 2)
  assert.deepEqual(report.findings.map((finding) => finding.file), ["src/runtime.js", "src/runtime.js"])
})

test("allows documentation and comments that mention SourceMirror vscode", () => {
  const root = makeFixture()
  writeFile(root, "docs/plan.md", "Copy from D:\\SourceMirror\\vscode before adapting.\n")
  writeFile(root, "src/comment.ts", `
    // Reference: D:\\SourceMirror\\vscode\\src\\vs\\platform\\configuration
    /*
      Reference: SourceMirror/vscode/src/vs/workbench/common/views.ts
    */
    export const value = "self-contained"
  `)

  const report = buildVscodeSourceBoundaryReport({ root })

  assert.equal(report.ready, true)
  assert.equal(report.summary.findings, 0)
})

test("flags packaged extension host source comments and source maps", () => {
  const root = makeFixture()
  writeFile(root, "desktop/services/extensions-host/bundle/extHost.bundle.mjs", `
    // ../SourceMirror/vscode/src/vs/workbench/api/node/extensionHostProcess.ts
    export const value = "self-contained"
  `)
  writeFile(root, "desktop/services/extensions-host/bundle/extHost.bundle.mjs.map", JSON.stringify({
    version: 3,
    sources: ["../../../../../SourceMirror/vscode/src/vs/base/common/event.ts"],
    mappings: "",
  }))

  const report = buildVscodeSourceBoundaryReport({ root })

  assert.equal(report.ready, false)
  assert.equal(report.summary.findings, 2)
  assert.equal(report.summary.runtimeFindings, 0)
  assert.deepEqual(report.findings.map((finding) => finding.file), [
    "desktop/services/extensions-host/bundle/extHost.bundle.mjs",
    "desktop/services/extensions-host/bundle/extHost.bundle.mjs.map",
  ])
})

test("skips test files because they are not packaged runtime sources", () => {
  const root = makeFixture()
  writeFile(root, "src/boundary.test.js", `
    const fixture = require("D:\\\\SourceMirror\\\\vscode\\\\src\\\\vs\\\\base\\\\common\\\\event")
    module.exports = fixture
  `)
  writeFile(root, "src/runtime.js", "module.exports = 1\n")

  const report = buildVscodeSourceBoundaryReport({ root })

  assert.equal(report.ready, true)
  assert.equal(report.summary.scannedFiles, 1)
})

test("preserves lines while stripping comments", () => {
  const source = [
    "const a = 1",
    "// D:\\SourceMirror\\vscode",
    "const b = 'D:\\\\SourceMirror\\\\vscode'",
  ].join("\n")

  const stripped = stripCommentsPreserveLines(source, ".js")
  const findings = scanFile(writeFile(makeFixture(), "src/runtime.js", stripped), makeFixture())

  assert.equal(stripped.split(/\r?\n/).length, 3)
  assert.equal(stripped.includes("// D:"), false)
  assert.equal(stripped.includes("'D:\\\\SourceMirror\\\\vscode'"), true)
  assert.equal(Array.isArray(findings), true)
})
