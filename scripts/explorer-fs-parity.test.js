const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildExplorerFsParityReport,
  compareDirentsToCodekEntries,
  parseArgs,
  saveExplorerFsParityReport,
} = require("./explorer-fs-parity")

function dirent(name, kind) {
  return {
    name,
    isFile: () => kind === "file",
    isDirectory: () => kind === "directory",
    isSymbolicLink: () => kind === "symlink",
  }
}

test("parseArgs accepts project, multiple dirs and source", () => {
  const parsed = parseArgs([
    "--project=C:/repo",
    "--dir=src",
    "--path=scripts",
    "--source=agent",
    "--report-dir=C:/reports",
    "--include-stats",
    "--no-write",
  ])

  assert.equal(parsed.projectPath, "C:/repo")
  assert.deepEqual(parsed.dirs, ["src", "scripts"])
  assert.equal(parsed.source, "agent")
  assert.equal(parsed.reportDir, "C:/reports")
  assert.equal(parsed.includeStats, true)
  assert.equal(parsed.noWrite, true)
})

test("compareDirentsToCodekEntries reports missing, extra and type mismatches", () => {
  const result = compareDirentsToCodekEntries([
    dirent("src", "directory"),
    dirent("main.ts", "file"),
  ], [
    { name: "src", isFile: true, isDirectory: false },
    { name: "extra.txt", isFile: true },
    { name: "...", truncated: true },
  ])

  assert.deepEqual(result.missing, ["main.ts"])
  assert.deepEqual(result.extra, ["extra.txt"])
  assert.equal(result.typeMismatches.length, 1)
  assert.equal(result.typeMismatches[0].name, "src")
  assert.equal(result.sentinelCount, 1)
})

test("explorer source parity passes when Codek entry contract returns all FS entries", async () => {
  const report = await buildExplorerFsParityReport({
    projectPath: "C:/repo",
    dirs: ["."],
    createdAt: 1,
    fsPromises: {
      readdir: async () => [dirent("src", "directory"), dirent("main.ts", "file")],
    },
  })

  assert.equal(report.ready, true)
  assert.equal(report.status, "ready")
  assert.equal(report.checks[0].fsCount, 2)
  assert.equal(report.checks[0].codekCount, 2)
  assert.equal(report.checks[0].truncated, false)
})

test("agent source parity fails when the Codek budget truncates directory entries", async () => {
  const report = await buildExplorerFsParityReport({
    projectPath: "C:/repo",
    dirs: ["."],
    source: "agent",
    profileEntryBudget: 1,
    createdAt: 1,
    fsPromises: {
      readdir: async () => [dirent("src", "directory"), dirent("main.ts", "file")],
    },
  })

  assert.equal(report.ready, false)
  assert.equal(report.status, "blocked")
  assert.equal(report.checks[0].status, "failed")
  assert.equal(report.checks[0].truncated, true)
  assert.equal(report.checks[0].sentinelCount, 1)
  assert.deepEqual(report.checks[0].missing, ["main.ts"])
})

test("saveExplorerFsParityReport writes latest JSON and markdown", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-explorer-fs-parity-"))
  const saved = saveExplorerFsParityReport({
    reportKind: "explorer-fs-parity",
    createdAt: 1,
    ready: true,
    status: "ready",
    projectPath: "C:/repo",
    checkCount: 1,
    passed: 1,
    checks: [{
      id: "root",
      path: "C:/repo",
      source: "explorer",
      status: "passed",
      fsCount: 1,
      codekCount: 1,
      truncated: false,
      sentinelCount: 0,
      missing: [],
      extra: [],
      typeMismatches: [],
      nextAction: "",
    }],
  }, { reportDir: tempDir })

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  const latest = JSON.parse(fs.readFileSync(saved.latestJsonPath, "utf8"))
  assert.equal(latest.ready, true)
})
