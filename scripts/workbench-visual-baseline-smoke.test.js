const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  collectEvidence,
  computeVisualBaselineReady,
  evidenceReady,
  evidenceStepsFromLatest,
  isReportFreshForStep,
  parseReportTimeMs,
  smokeReportHasChecks,
  stepStartedAtMs,
  writeElectronSmokeResult,
} = require("./workbench-visual-baseline-smoke")

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

function writeReadyReports(reportDir, createdAt) {
  writeJson(path.join(reportDir, "electron-smoke-tab-overflow-latest-result.json"), {
    ok: true,
    checks: [{ name: "tab", passed: true }],
  })
  writeJson(path.join(reportDir, "electron-smoke-icon-visual-state-latest-result.json"), {
    ok: true,
    checks: [{ name: "icon", passed: true }],
  })
  writeJson(path.join(reportDir, "workbench-real-project-ui-latest.json"), {
    reportKind: "workbench-real-project-ui-smoke-evidence",
    createdAt,
    ready: true,
    acceptance: {
      opensConfiguredRoot: true,
      nativeExplorerMounted: true,
      explorerRowsVirtualizedAndNonBlank: true,
      largeFileAvoidsBlockingNotice: true,
      searchResultOpensNonBlankEditor: true,
      workbenchActivityBarRegistryDriven: true,
      workbenchSidebarRegistrySwitches: true,
      workbenchEditorPartSnapshotVisible: true,
      workbenchPanelSnapshotVisible: true,
    },
    metrics: {
      rootPackageEditorValueVisible: true,
      largeFileWarningBadgeHidden: true,
    },
  })
  fs.writeFileSync(path.join(reportDir, "workbench-real-project-ui-latest.png"), Buffer.from("png"))
}

test("visual baseline evidence rejects stale real UI reports from earlier runs", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-visual-baseline-"))
  const createdAt = "2026-06-07T01:00:00.000Z"
  const stepStart = Date.parse("2026-06-07T02:00:00.000Z")
  writeReadyReports(reportDir, createdAt)

  const evidence = collectEvidence([
    { id: "tab_overflow", startedAt: 0 },
    { id: "icon_visual_state", startedAt: 0 },
    { id: "real_project_ui", startedAt: stepStart },
  ], { reportDir })

  assert.equal(evidence.realUiReportFresh, false)
  assert.equal(evidence.realProjectUiReady, false)
  assert.equal(evidence.tabOverflowReady, true)
  assert.equal(evidence.iconVisualReady, true)
})

test("visual baseline evidence accepts real UI reports created by the current run", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-visual-baseline-"))
  const createdAt = "2026-06-07T02:00:01.000Z"
  const stepStart = Date.parse("2026-06-07T02:00:00.000Z")
  writeReadyReports(reportDir, createdAt)

  const evidence = collectEvidence([
    { id: "tab_overflow", startedAt: 0 },
    { id: "icon_visual_state", startedAt: 0 },
    { id: "real_project_ui", startedAt: stepStart },
  ], { reportDir })

  assert.equal(evidence.realUiReportFresh, true)
  assert.equal(evidence.realProjectUiReady, true)
  assert.equal(Object.values(evidence.screenshotChecks).every(Boolean), true)
})

test("visual baseline reuses latest ready evidence instead of rerunning Electron smoke", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-visual-baseline-reuse-"))
  writeReadyReports(reportDir, new Date().toISOString())

  const evidence = collectEvidence([], { reportDir })
  const steps = evidenceStepsFromLatest(evidence)

  assert.equal(evidenceReady(evidence), true)
  assert.equal(steps.length, 3)
  assert.equal(steps.every((step) => step.passed), true)
  assert.equal(steps.every((step) => step.reusedLatestEvidence), true)
  assert.deepEqual(steps.map((step) => step.id), ["tab_overflow", "icon_visual_state", "real_project_ui"])
})

test("visual baseline rejects reused evidence older than the current frontend build", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-visual-baseline-stale-build-"))
  const createdAt = "2026-06-07T02:00:00.000Z"
  writeReadyReports(reportDir, createdAt)
  const buildTime = Date.now() + 60_000

  const evidence = collectEvidence([], { reportDir, reuseSinceMs: buildTime })

  assert.equal(evidence.reuseSinceMs, buildTime)
  assert.equal(evidence.tabOverflowReady, false)
  assert.equal(evidence.iconVisualReady, false)
  assert.equal(evidence.realProjectUiReady, false)
  assert.equal(evidence.screenshotFresh, false)
  assert.equal(evidenceReady(evidence), false)
})

test("visual baseline ready requires successful frontend build preflight", () => {
  const readyEvidence = {
    tabOverflowReady: true,
    iconVisualReady: true,
    realProjectUiReady: true,
    screenshotExists: true,
    screenshotFresh: true,
    screenshotChecks: {
      noBlankTabs: true,
      editorTitleVisible: true,
      fileIconsVisible: true,
      noLargeFileWarningBadge: true,
      searchNonBlank: true,
    },
  }
  const steps = [
    { id: "tab_overflow", passed: true },
    { id: "icon_visual_state", passed: true },
    { id: "real_project_ui", passed: true },
  ]

  assert.equal(computeVisualBaselineReady({ passed: true }, steps, readyEvidence), true)
  assert.equal(computeVisualBaselineReady({ passed: false }, steps, readyEvidence), false)
})

test("visual baseline evidence rejects empty wrapper smoke reports", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-visual-baseline-empty-smoke-"))
  const createdAt = "2026-06-07T02:00:01.000Z"
  writeReadyReports(reportDir, createdAt)
  writeJson(path.join(reportDir, "electron-smoke-tab-overflow-latest-result.json"), {
    ok: true,
    checks: [],
  })
  writeJson(path.join(reportDir, "electron-smoke-icon-visual-state-latest-result.json"), {
    ok: true,
    checks: [],
  })

  const evidence = collectEvidence([
    { id: "tab_overflow", startedAt: 0 },
    { id: "icon_visual_state", startedAt: 0 },
    { id: "real_project_ui", startedAt: Date.parse("2026-06-07T02:00:00.000Z") },
  ], { reportDir })

  assert.equal(evidence.tabOverflowReady, false)
  assert.equal(evidence.iconVisualReady, false)
  assert.equal(evidence.tabReadable, false)
  assert.equal(evidence.iconStateReady, false)
})

test("visual baseline freshness helpers parse timestamps and step starts", () => {
  const stepStart = Date.parse("2026-06-07T02:00:00.000Z")

  assert.equal(parseReportTimeMs("2026-06-07T02:00:00.000Z"), stepStart)
  assert.equal(parseReportTimeMs("not-a-date"), 0)
  assert.equal(stepStartedAtMs([{ id: "real_project_ui", startedAt: stepStart }], "real_project_ui"), stepStart)
  assert.equal(isReportFreshForStep({ createdAt: "2026-06-07T02:00:01.000Z" }, stepStart), true)
  assert.equal(isReportFreshForStep({ createdAt: "2026-06-07T01:59:59.000Z" }, stepStart), false)
  assert.equal(smokeReportHasChecks({ ok: true, checks: [{ passed: true }] }), true)
  assert.equal(smokeReportHasChecks({ ok: true, checks: [] }), false)
  assert.equal(smokeReportHasChecks({ ok: true, checks: [{ passed: false }] }), false)
})

test("visual baseline writes a standard Electron smoke result for BD gate evidence", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-visual-baseline-smoke-result-"))
  const resultFile = path.join(reportDir, "electron-smoke-visual-baseline-bd-try-1.json")
  const previous = process.env.CODEK_ELECTRON_SMOKE_RESULT_FILE
  process.env.CODEK_ELECTRON_SMOKE_RESULT_FILE = resultFile
  try {
    writeElectronSmokeResult({
      ready: true,
      status: "ready",
      latestJsonPath: path.join(reportDir, "workbench-visual-baseline-latest.json"),
      evidence: {
        tabOverflowReady: true,
        iconVisualReady: true,
        realProjectUiReady: true,
        screenshotExists: true,
        screenshotPath: path.join(reportDir, "workbench-real-project-ui-latest.png"),
        screenshotChecks: {
          noBlankTabs: true,
          editorTitleVisible: true,
          fileIconsVisible: true,
          noLargeFileWarningBadge: true,
          searchNonBlank: true,
        },
      },
    })
  } finally {
    if (previous === undefined) delete process.env.CODEK_ELECTRON_SMOKE_RESULT_FILE
    else process.env.CODEK_ELECTRON_SMOKE_RESULT_FILE = previous
  }

  const payload = JSON.parse(fs.readFileSync(resultFile, "utf8"))
  assert.equal(payload.ok, true)
  assert.equal(payload.reportKind, "workbench-visual-baseline-smoke-result")
  assert.ok(Array.isArray(payload.checks))
  assert.ok(payload.checks.length > 0)
  assert.equal(payload.checks.every((check) => check.passed !== false), true)
})
