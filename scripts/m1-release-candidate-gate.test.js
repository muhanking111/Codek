const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  buildM1ReleaseCandidateGateReport,
  commandGates,
  compareDistDirs,
  markdownReport,
  parseArgs,
  readLatestM1ReleaseCandidateGate,
  saveReport,
} = require("./m1-release-candidate-gate")

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, value, "utf8")
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-m1-rc-"))
  const reportDir = path.join(root, ".codek", "reports")
  writeJson(path.join(root, "package.json"), {
    scripts: {
      "build:frontend": "vite build",
      build: "node scripts/build.js",
      "pack:win": "node scripts/build.js --pack win",
      "check:vscode-source-boundary": "node scripts/vscode-source-boundary-check.js",
      "smoke:workbench:real-project-ui": "node scripts/electron-ui-smoke.js --real-project-ui",
    },
  })
  const csp = [
    "font-src 'self' data: codek-extension-resource:",
    "img-src 'self' data: blob: file: codek-extension-resource:",
  ].join("; ")
  writeText(path.join(root, "frontend", "vite-project", "dist", "index.html"), csp)
  writeText(path.join(root, "frontend", "vite-project", "dist", "assets", "app.js"), "console.log('fixture')\n")
  writeText(path.join(root, "desktop", "frontend-dist", "index.html"), csp)
  writeText(path.join(root, "desktop", "frontend-dist", "assets", "app.js"), "console.log('fixture')\n")
  writeJson(path.join(reportDir, "workbench-real-project-ui-latest.json"), {
    reportKind: "workbench-real-project-ui-smoke-evidence",
    createdAt: Date.now(),
    ready: true,
    status: "ready",
    gateAttribution: {
      rows: Array.from({ length: 11 }, (_, index) => ({ stage: `stage-${index}`, status: "pass" })),
      failedRows: [],
    },
    manualAcceptanceContract: {
      rows: Array.from({ length: 11 }, (_, index) => ({ stageId: `stage-${index}`, manualReplaySteps: ["打开并确认"] })),
    },
  })
  writeText(path.join(reportDir, "workbench-real-project-ui-latest.md"), "# report\n")
  writeText(path.join(reportDir, "workbench-real-project-ui-latest.png"), "png")
  writeJson(path.join(reportDir, "electron-smoke-real-project-ui-latest-result.json"), {
    ok: true,
    checks: [{ name: "real project ui", passed: true }],
  })
  writeJson(path.join(reportDir, "manual-real-ui-evidence-latest.json"), {
    reportKind: "manual-real-ui-evidence",
    createdAt: Date.now(),
    ready: false,
    status: "blocked",
    summary: { passedChecks: 34, requiredChecks: 35 },
  })
  writeJson(path.join(reportDir, "release-evidence-latest.json"), {
    reportKind: "release-evidence",
    createdAt: Date.now(),
    ready: false,
    status: "degraded",
    summary: { enterpriseComplete: false },
  })
  return { root, reportDir }
}

function sourceBoundaryReady() {
  return {
    ready: true,
    summary: { scannedFiles: 10, findings: 0, runtimeFindings: 0 },
    findings: [],
  }
}

function cleanWorktree() {
  return {
    ok: true,
    dirty: false,
    entries: [],
    summary: { modified: 0, untracked: 0, deleted: 0, renamed: 0, copied: 0, other: 0, total: 0 },
  }
}

test("parseArgs supports root, report dir, max age and no-write", () => {
  const parsed = parseArgs(["--root=C:/work/codek", "--report-dir=.codek/out", "--max-evidence-age-ms=123", "--no-write"])

  assert.equal(parsed.root, path.resolve("C:/work/codek"))
  assert.equal(parsed.reportDir, path.resolve("C:/work/codek", ".codek/out"))
  assert.equal(parsed.maxEvidenceAgeMs, 123)
  assert.equal(parsed.noWrite, true)
})

test("command gate table covers M1 release candidate closure checks", () => {
  const gates = commandGates()
  const ids = gates.map((gate) => gate.id)

  assert.deepEqual(ids, [
    "dirty_worktree",
    "typecheck",
    "frontend_build",
    "full_build",
    "source_boundary",
    "diff_check",
    "desktop_syntax",
    "real_project_ui_smoke",
    "focused_tests",
    "manual_evidence_contract",
  ])
  assert.ok(gates.find((gate) => gate.id === "frontend_build").command.includes("build:frontend"))
  assert.ok(gates.find((gate) => gate.id === "dirty_worktree").command.includes("git status --short"))
  assert.ok(gates.find((gate) => gate.id === "source_boundary").command.includes("check:vscode-source-boundary"))
  assert.ok(gates.find((gate) => gate.id === "diff_check").command.includes("git diff --check"))
  assert.ok(gates.find((gate) => gate.id === "desktop_syntax").command.includes("desktop/main.js"))
  assert.equal(gates.find((gate) => gate.id === "manual_evidence_contract").manual, true)
})

test("compareDistDirs requires byte-for-byte synced frontend and desktop dist", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-dist-"))
  const frontend = path.join(root, "frontend")
  const desktop = path.join(root, "desktop")
  writeText(path.join(frontend, "index.html"), "same")
  writeText(path.join(frontend, "assets", "app.js"), "one")
  writeText(path.join(desktop, "index.html"), "same")
  writeText(path.join(desktop, "assets", "app.js"), "two")

  const report = compareDistDirs(frontend, desktop)

  assert.equal(report.synced, false)
  assert.deepEqual(report.changedFiles, ["assets/app.js"])
})

test("M1 gate reports automated-ready while manual evidence remains required", () => {
  const fixture = createFixture()
  const report = buildM1ReleaseCandidateGateReport({
    root: fixture.root,
    reportDir: fixture.reportDir,
    maxEvidenceAgeMs: 60 * 60 * 1000,
  }, {
    buildSourceBoundaryReport: sourceBoundaryReady,
    readGitStatus: cleanWorktree,
  })

  assert.equal(report.automatedReady, true)
  assert.equal(report.manualReady, false)
  assert.equal(report.ready, false)
  assert.equal(report.status, "manual-required")
  assert.equal(report.summary.failed, 0)
  assert.ok(report.summary.manualRequired >= 1)
  assert.equal(report.checks.find((check) => check.id === "source_boundary").passed, true)
  assert.equal(report.checks.find((check) => check.id === "dirty_worktree").passed, true)
  assert.equal(report.checks.find((check) => check.id === "frontend_desktop_dist_synced").passed, true)
  assert.equal(report.checks.find((check) => check.id === "manual_real_ui_latest_ready").status, "manual-required")
  assert.equal(report.checks.find((check) => check.id === "release_evidence_enterprise_complete").status, "manual-required")
})

test("M1 gate blocks automation and classifies dirty worktree before final ready", () => {
  const fixture = createFixture()
  const report = buildM1ReleaseCandidateGateReport({
    root: fixture.root,
    reportDir: fixture.reportDir,
  }, {
    buildSourceBoundaryReport: sourceBoundaryReady,
    readGitStatus: () => ({
      ok: true,
      dirty: true,
      entries: [
        { status: "M", path: "scripts/build-ext-host.js" },
        { status: "??", path: ".codek/reports/manual-real-ui-evidence-latest.json" },
      ],
      summary: { modified: 1, untracked: 1, deleted: 0, renamed: 0, copied: 0, other: 0, total: 2 },
    }),
  })
  const dirtyCheck = report.checks.find((check) => check.id === "dirty_worktree")

  assert.equal(report.automatedReady, false)
  assert.equal(report.status, "blocked")
  assert.equal(dirtyCheck.passed, false)
  assert.equal(dirtyCheck.classification, "dirty-worktree")
  assert.match(dirtyCheck.detail, /modified=1/)
  assert.deepEqual(dirtyCheck.data.samplePaths, [
    "scripts/build-ext-host.js",
    ".codek/reports/manual-real-ui-evidence-latest.json",
  ])
})

test("M1 gate blocks automation when source boundary fails", () => {
  const fixture = createFixture()
  const report = buildM1ReleaseCandidateGateReport({
    root: fixture.root,
    reportDir: fixture.reportDir,
  }, {
    buildSourceBoundaryReport: () => ({
      ready: false,
      summary: { scannedFiles: 10, findings: 1, runtimeFindings: 1 },
      findings: [{ file: "desktop/main.js", line: 1 }],
    }),
    readGitStatus: cleanWorktree,
  })

  assert.equal(report.automatedReady, false)
  assert.equal(report.status, "blocked")
  assert.equal(report.checks.find((check) => check.id === "source_boundary").passed, false)
})

test("M1 gate becomes ready only when manual and release evidence are complete", () => {
  const fixture = createFixture()
  writeJson(path.join(fixture.reportDir, "manual-real-ui-evidence-latest.json"), {
    reportKind: "manual-real-ui-evidence",
    createdAt: Date.now(),
    ready: true,
    status: "ready",
    summary: { passedChecks: 35, requiredChecks: 35 },
  })
  writeJson(path.join(fixture.reportDir, "release-evidence-latest.json"), {
    reportKind: "release-evidence",
    createdAt: Date.now(),
    ready: true,
    status: "ready",
    summary: { enterpriseComplete: true },
  })

  const report = buildM1ReleaseCandidateGateReport({
    root: fixture.root,
    reportDir: fixture.reportDir,
  }, {
    buildSourceBoundaryReport: sourceBoundaryReady,
    readGitStatus: cleanWorktree,
  })

  assert.equal(report.ready, true)
  assert.equal(report.automatedReady, true)
  assert.equal(report.manualReady, true)
  assert.equal(report.status, "ready")
})

test("M1 gate saves latest JSON and Markdown reports", () => {
  const fixture = createFixture()
  const report = buildM1ReleaseCandidateGateReport({
    root: fixture.root,
    reportDir: fixture.reportDir,
  }, {
    buildSourceBoundaryReport: sourceBoundaryReady,
    readGitStatus: cleanWorktree,
  })
  const saved = saveReport(report, fixture.reportDir)
  const latest = readLatestM1ReleaseCandidateGate({ reportDir: fixture.reportDir })
  const markdown = fs.readFileSync(saved.latestMarkdownPath, "utf8")

  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.historyJsonPath), true)
  assert.equal(latest.report.reportKind, "m1-release-candidate-gate")
  assert.match(markdown, /# M1 Release Candidate Gate/)
  assert.match(markdown, /## Gate 总表/)
  assert.match(markdown, /npm run build:frontend/)
  assert.match(markdown, /需人工确认/)
})

test("markdown report stays concise and includes manual confirmation items", () => {
  const fixture = createFixture()
  const report = buildM1ReleaseCandidateGateReport({
    root: fixture.root,
    reportDir: fixture.reportDir,
  }, {
    buildSourceBoundaryReport: sourceBoundaryReady,
    readGitStatus: cleanWorktree,
  })
  const markdown = markdownReport(report)

  assert.match(markdown, /Cursor 级主观流畅度人工确认/)
  assert.match(markdown, /summary\.enterpriseComplete=true/)
  assert.doesNotMatch(markdown, /undefined/)
})
