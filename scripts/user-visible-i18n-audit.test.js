const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  blockedPhrases,
  buildAuditResult,
  isLikelyUserVisibleLine,
} = require("./user-visible-i18n-audit")

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, "utf8")
}

test("user-visible i18n audit blocks Debug and Agent English UI strings", () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-i18n-visible-"))
  writeFile(path.join(sourceRoot, "Panel.vue"), [
    "<template>",
    "  <button title=\"Step Over\">x</button>",
    "  <div>Codebase Context</div>",
    "</template>",
    "<script setup>",
    "const action = { label: \"Pause run\", disabledReason: \"Available: pause this run\" }",
    "</script>",
    "",
  ].join("\n"))

  const result = buildAuditResult({ sourceRoots: [sourceRoot], createdAt: "2026-06-07T00:00:00.000Z" })

  assert.equal(result.ready, false)
  assert.equal(result.status, "blocked")
  assert.deepEqual(
    result.findings.map((finding) => finding.phrase).sort(),
    ["Available:", "Codebase Context", "Pause run", "Step Over"].sort(),
  )
})

test("user-visible i18n audit does not block internal identifiers only", () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-i18n-internal-"))
  writeFile(path.join(sourceRoot, "logic.ts"), [
    "function handleStartRealWorkspaceTrial() { return true }",
    "const checkpointBusy = false",
    "const status = \"ready\"",
    "",
  ].join("\n"))

  const result = buildAuditResult({ sourceRoots: [sourceRoot], createdAt: "2026-06-07T00:00:00.000Z" })

  assert.equal(result.ready, true)
  assert.equal(result.findings.length, 0)
})

test("user-visible i18n audit ignores generated adapters and internal event source ids", () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codek-i18n-generated-"))
  const workspaceRoot = path.join(sourceRoot, "frontend", "vite-project", "src")
  writeFile(path.join(workspaceRoot, "vscode-adapter", "generated", "vscode", "src", "vs", "base", "common", "async.ts"), [
    "export function first<T>(promiseFactories: ITask<Promise<T>>[], shouldStop: (t: T) => boolean = t => !!t) { return null }",
    "",
  ].join("\n"))
  writeFile(path.join(workspaceRoot, "workspace", "fileOperations.js"), [
    "function defaultOperationSource(input) {",
    "  const source = input?.source || \"user\"",
    "  return `workspace.fileOperations.${source}`",
    "}",
    "",
  ].join("\n"))

  const result = buildAuditResult({ sourceRoots: [workspaceRoot], createdAt: "2026-06-07T00:00:00.000Z" })

  assert.equal(result.ready, true)
  assert.equal(result.findings.length, 0)
})

test("user-visible i18n audit keeps newly discovered blocker phrases in the gate", () => {
  for (const phrase of [
    "Step Over",
    "Debug console output will appear here",
    "Codebase Context",
    "Pause run",
    "Resume run",
    "No resumable checkpoint is available",
  ]) {
    assert.ok(blockedPhrases.includes(phrase), `missing blocked phrase ${phrase}`)
  }
  assert.equal(isLikelyUserVisibleLine("const action = { label: \"Pause run\" }", "Pause run"), true)
  assert.equal(isLikelyUserVisibleLine("function handlePauseRun() {}", "Pause run"), false)
  assert.equal(isLikelyUserVisibleLine("return `${m}:${String(s).padStart(2, '0')}`", "Start"), false)
  assert.equal(
    isLikelyUserVisibleLine(
      "disabledReason: busy ? \"恢复操作正在运行\" : latestCheckpoint.value?.canResume ? \"可执行：从最近检查点恢复\" : \"当前没有可恢复的检查点\",",
      "Checkpoint",
    ),
    false,
  )
})
