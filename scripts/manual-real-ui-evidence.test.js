const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  REQUIRED_SCENARIOS,
  USER_CONFIRMED_NO_SCREENSHOT_SCENARIOS,
  buildSmokeAssistedManualRealUiEvidence,
  buildManualRealUiMarkdown,
  buildManualRealUiTemplate,
  initManualRealUiWorkspace,
  normalizeComputerUsePreflight,
  readLatestManualRealUiEvidence,
  saveManualRealUiEvidence,
  validateManualRealUiEvidence,
} = require("./manual-real-ui-evidence")

function writeEvidence(filePath, patch = {}) {
  const template = buildManualRealUiTemplate({ reportDir: path.dirname(path.dirname(filePath)), createdAt: 1 })
  const payload = {
    ...template,
    ...patch,
    scenarios: patch.scenarios || template.scenarios,
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  return payload
}

function makePassedEvidence(reportDir) {
  const template = buildManualRealUiTemplate({ reportDir, createdAt: 1 })
  const screenshotDir = path.join(reportDir, "manual-real-ui", "screenshots")
  fs.mkdirSync(screenshotDir, { recursive: true })
  return {
    ...template,
    operator: "用户手动验收",
    method: "manual",
    manualRunConfirmed: true,
    cursorLevelSmoothnessConfirmed: true,
    windowsExplorerCrossCheckConfirmed: true,
    overallResult: "passed",
    durationMinutes: 12,
    scenarios: template.scenarios.map((scenario) => {
      const screenshotPath = path.join(screenshotDir, `${scenario.id}.png`)
      fs.writeFileSync(screenshotPath, `fake png evidence for ${scenario.id}`, "utf8")
      return {
        ...scenario,
        status: "passed",
        checks: Object.fromEntries(Object.keys(scenario.checks).map((key) => [key, true])),
        durationMs: 1000,
        maxObservedStallMs: 40,
        screenshotPaths: [screenshotPath],
        evidenceSummary: `已验收 ${scenario.title}`,
      }
    }),
  }
}

test("manual real UI template covers all required scenarios without sensitive raw fields", () => {
  const template = buildManualRealUiTemplate({ createdAt: 1 })

  assert.equal(template.reportKind, "manual-real-ui-evidence-template")
  assert.equal(template.manualRunConfirmed, false)
  assert.equal(template.computerUsePreflight.status, "not_checked")
  assert.equal(template.computerUsePreflight.requiredExecutionToolAvailable, false)
  assert.equal(template.computerUsePreflight.toolSearches.length, 4)
  assert.equal(template.manualAcceptanceContract.status, "manual_required")
  assert.equal(template.manualAcceptanceContract.requiredStageIds.length, 11)
  assert.equal(template.scenarios.length, REQUIRED_SCENARIOS.length)
  assert.equal(template.scenarios[0].id, "explorer_large_directory_scroll")
  assert.equal(template.scenarios[0].title, "大目录展开与快速滚动")
  assert.equal(template.scenarios.some((scenario) => scenario.id === "cursor_same_directory_parity"), true)
  assert.equal(template.scenarios.some((scenario) => scenario.id === "large_file_deep_scroll_switching"), true)
  assert.equal(template.scenarios.some((scenario) => scenario.id === "scm_testing_timeline_notification_center"), true)
  assert.equal(template.scenarios.some((scenario) => scenario.id === "trust_remote_auth_ui_states"), true)
  assert.equal(template.scenarios.some((scenario) => scenario.id === "manual_acceptance_evidence_contract"), true)
  assert.equal(Object.hasOwn(template, "promptBody"), false)
  assert.doesNotMatch(JSON.stringify(template), /sourceCode|commandOutput|apiKey/)
})

test("manual real UI init writes Chinese template and README", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-manual-real-ui-"))
  const saved = initManualRealUiWorkspace({ reportDir, createdAt: 1 })

  assert.equal(fs.existsSync(saved.evidenceDir), true)
  assert.equal(fs.existsSync(saved.screenshotDir), true)
  assert.equal(fs.existsSync(saved.indexPath), true)
  assert.equal(fs.existsSync(saved.templatePath), true)
  const template = JSON.parse(fs.readFileSync(saved.templatePath, "utf8"))
  const readme = fs.readFileSync(saved.indexPath, "utf8")
  assert.equal(template.scenarios.length, REQUIRED_SCENARIOS.length)
  assert.equal(template.notes, "只写验收摘要，不粘贴源码、完整日志、完整 diff、prompt 正文或敏感信息。")
  assert.match(readme, /# Codek 真实 Workbench 手感验收/)
  assert.match(readme, /## 截图证据规则/)
  assert.match(readme, /本地截图路径必须指向真实存在的文件/)
  assert.match(readme, /computer-use:\/\/.+computer_use:\/\//)
  assert.match(readme, /模板里的占位 `screenshotPaths` 不会被计入截图证据/)
  assert.match(readme, /## 手动操作细则/)
  assert.match(readme, /点击同一文件内不同搜索结果/)
  assert.match(readme, /同目录 Cursor \/ Codek 文件树和搜索对照/)
  assert.match(readme, /Workspace Trust \/ Remote Authority \/ Authentication 状态归属/)
  assert.match(readme, /自动化报告到人工复验 evidence contract/)
  assert.doesNotMatch(readme, /鎴|鐪|绛|锛|銆/)
})

test("manual real UI validation blocks unconfirmed template", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-manual-real-ui-"))
  const evidenceFile = path.join(reportDir, "manual-real-ui", "manual-real-ui-evidence-template.json")
  writeEvidence(evidenceFile)

  const report = validateManualRealUiEvidence({ reportDir, evidenceFile })

  assert.equal(report.ready, false)
  assert.equal(report.status, "blocked")
  assert.equal(report.gaps.some((item) => item.id === "manual_real_ui_not_confirmed"), true)
  assert.equal(report.gaps.some((item) => item.id === "cursor_level_smoothness_not_confirmed"), true)
  assert.equal(report.summary.totalScenarios, REQUIRED_SCENARIOS.length)
})

test("manual real UI smoke assist imports objective smoke scenarios without confirming subjective gates", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-manual-real-ui-smoke-assist-"))
  fs.writeFileSync(path.join(reportDir, "workbench-real-project-ui-latest.json"), `${JSON.stringify({
    ready: true,
    acceptance: {
      explorerRowsVirtualizedAndNonBlank: true,
      visibleRowsStableAfterFastScroll: true,
      scrollP95WithinCursorGradeBudget: true,
      scrollMaxAvoidsHalfSecondStalls: true,
      chatInputUsable: true,
      largeFileRealContentVisible: true,
      largeFileAvoidsBlockingNotice: true,
      largeFileCloseReopenKeepsWorkbenchResponsive: true,
      largeFileReopenRealContentVisible: true,
      normalEditorContentVisible: true,
      largeFileUserScrollAvoidsBlankViewport: true,
      extremeFileAutoWindowNavigation: true,
      nativeExplorerMounted: true,
      searchResultOpensNonBlankEditor: true,
      sameLineSearchOccurrencesAccurate: true,
      agentEvidenceWorkbenchSurfaceVisible: true,
      agentEvidenceWorkbenchTimelineLinks: true,
      agentEvidenceWorkbenchProgressNotifications: true,
      workspaceTrustWorkbenchDecisionEvidence: true,
      remoteAuthorityWorkbenchResolveEvidence: true,
      authenticationWorkbenchSessionEvidence: true,
      createTargetDisplayMatchesDisk: true,
      continuousCreateRemainsUsable: true,
    },
    metrics: {
      largeFileUserScrollbarDragViewportTextVisible: true,
      largeFileDeepViewportTextVisible: true,
      largeFileNextWindowViewportTextVisible: true,
      agentEvidenceNotificationDismissCommandIds: ["agent.evidence.dismissNotification"],
      authenticationWorkbenchTokenRedacted: true,
    },
    gateAttribution: {
      rows: [
        { stage: "Explorer/File operation", status: "pass", owner: "Explorer/File operation" },
        { stage: "SCM/Testing/Timeline/Notification/Progress", status: "pass", owner: "Agent Evidence SCM/Testing/Timeline/Notification/Progress" },
      ],
      failedRows: [],
    },
    manualAcceptanceContract: {
      automatedReady: true,
      rows: Array.from({ length: 11 }, (_, index) => ({
        stageId: `stage_${index}`,
        stage: `Stage ${index}`,
        manualReplaySteps: ["Replay manually"],
      })),
      blockedRows: [],
    },
    latestScreenshotPath: path.join(reportDir, "workbench-real-project-ui-latest.png"),
    latestJsonPath: path.join(reportDir, "workbench-real-project-ui-latest.json"),
    latestMarkdownPath: path.join(reportDir, "workbench-real-project-ui-latest.md"),
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "workbench-real-project-ui-latest.png"), "png", "utf8")
  fs.writeFileSync(path.join(reportDir, "workbench-search-navigation-latest.json"), `${JSON.stringify({
    ready: true,
    acceptance: {
      keepsEditorNonBlank: true,
      revealsExactMatchSelection: true,
      keepsSearchViewActive: true,
    },
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "workbench-visual-baseline-latest.json"), `${JSON.stringify({
    ready: true,
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "electron-smoke-icon-visual-state-latest-result.json"), `${JSON.stringify({
    ok: true,
    checks: [{ passed: true }],
  }, null, 2)}\n`, "utf8")
  fs.writeFileSync(path.join(reportDir, "workbench-icon-visual-state-latest.png"), "png", "utf8")
  fs.writeFileSync(path.join(reportDir, "windows-explorer-cross-check-latest.json"), `${JSON.stringify({
    ready: true,
    checkCount: 2,
    passed: 2,
  }, null, 2)}\n`, "utf8")

  const evidence = buildSmokeAssistedManualRealUiEvidence({ reportDir, createdAt: 1 })
  const report = validateManualRealUiEvidence({ reportDir, rawEvidence: evidence })

  const scenarioById = new Map(evidence.scenarios.map((scenario) => [scenario.id, scenario]))
  assert.equal(scenarioById.get("explorer_large_directory_scroll").status, "passed")
  assert.equal(scenarioById.get("large_file_open_close_reopen").status, "passed")
  assert.equal(scenarioById.get("extreme_file_range_window").status, "passed")
  assert.equal(scenarioById.get("search_navigation_json_and_fixture").status, "passed")
  assert.equal(scenarioById.get("create_target_explorer_cross_check").status, "passed")
  assert.equal(scenarioById.get("create_target_explorer_cross_check").checks.uiLabelMatchesParent, true)
  assert.equal(scenarioById.get("create_target_explorer_cross_check").checks.windowsExplorerPathMatches, true)
  assert.equal(scenarioById.get("create_target_explorer_cross_check").checks.continuousCreateStillUsable, true)
  assert.equal(scenarioById.get("tabs_header_icons_visual").status, "passed")
  assert.equal(scenarioById.get("cursor_same_directory_parity").status, "passed")
  assert.equal(scenarioById.get("large_file_deep_scroll_switching").status, "passed")
  assert.equal(scenarioById.get("scm_testing_timeline_notification_center").status, "passed")
  assert.equal(scenarioById.get("trust_remote_auth_ui_states").status, "passed")
  assert.equal(scenarioById.get("manual_acceptance_evidence_contract").status, "passed")
  assert.equal(evidence.manualAcceptanceContract.automatedReady, true)
  assert.equal(evidence.manualAcceptanceContract.stageCount, 11)
  assert.equal(evidence.manualRunConfirmed, true)
  assert.equal(evidence.cursorLevelSmoothnessConfirmed, false)
  assert.equal(evidence.automatedCursorSmoothnessEvidenceConfirmed, true)
  assert.equal(evidence.automatedSmoothnessEvidence.checks.scrollP95WithinCursorGradeBudget, true)
  assert.equal(evidence.automatedSmoothnessEvidence.checks.searchRevealsExactMatchSelection, true)
  assert.equal(evidence.windowsExplorerCrossCheckConfirmed, true)
  assert.equal(report.ready, false)
  assert.equal(report.cursorLevelSmoothnessConfirmed, false)
  assert.equal(report.automatedCursorSmoothnessEvidenceConfirmed, true)
  assert.equal(report.automatedSmoothnessEvidence.passedChecks, report.automatedSmoothnessEvidence.checkCount)
  assert.equal(report.gaps.some((gap) => gap.id === "cursor_level_smoothness_not_confirmed"), true)
  assert.equal(report.gaps.some((gap) => gap.id === "windows_explorer_cross_check_missing"), false)
})

test("manual real UI validation records blocked Computer Use preflight without counting it as real UI evidence", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-manual-real-ui-preflight-"))
  const evidenceFile = path.join(reportDir, "manual-real-ui", "manual-real-ui-evidence-template.json")
  writeEvidence(evidenceFile, {
    computerUseAvailable: false,
    computerUsePreflight: {
      status: "blocked",
      pluginClientExists: true,
      requiredExecutionToolAvailable: false,
      toolSearches: [
        { query: "node_repl js", found: false, resultCount: 0 },
        { query: "mcp__node_repl__js", found: false, resultCount: 0 },
        { query: "js", found: false, resultCount: 0 },
        { query: "JavaScript execution", found: false, resultCount: 0 },
      ],
      note: "当前线程没有暴露执行工具，不能采集 Computer Use 截图。",
    },
  })

  const report = validateManualRealUiEvidence({ reportDir, evidenceFile })

  assert.equal(report.ready, false)
  assert.equal(report.computerUseAvailable, false)
  assert.equal(report.computerUsePreflight.status, "blocked")
  assert.equal(report.computerUsePreflight.pluginClientExists, true)
  assert.equal(report.computerUsePreflight.requiredExecutionToolAvailable, false)
  assert.equal(report.computerUsePreflight.toolSearches.length, 4)
  assert.equal(report.gaps.some((item) => item.id === "computer_use_preflight_blocked" && item.severity === "info"), true)
  assert.doesNotMatch(JSON.stringify(report), /当前线程没有暴露执行工具/)
})

test("manual real UI validation does not count placeholder screenshot paths as evidence", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-manual-real-ui-placeholder-"))
  const evidenceFile = path.join(reportDir, "manual-real-ui", "manual-real-ui-evidence-template.json")
  writeEvidence(evidenceFile)

  const report = validateManualRealUiEvidence({ reportDir, evidenceFile })

  assert.equal(report.summary.screenshotCount, 0)
  assert.equal(report.scenarios.every((scenario) => scenario.screenshotEvidence.length === 0), true)
  assert.equal(report.gaps.some((item) => item.id === "missing_screenshot_explorer_large_directory_scroll"), true)
})

test("manual real UI validation accepts user-confirmed scenarios 1, 2 and 5 without screenshots only", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-manual-real-ui-user-confirmed-"))
  const evidenceFile = path.join(reportDir, "manual-real-ui", "manual-real-ui-evidence.json")
  const payload = makePassedEvidence(reportDir)

  payload.scenarios = payload.scenarios.map((scenario) => {
    if (USER_CONFIRMED_NO_SCREENSHOT_SCENARIOS.has(scenario.id)) {
      return {
        ...scenario,
        screenshotPaths: [],
        evidenceSummary: "用户明确人工确认通过，无需补截图。",
      }
    }
    return scenario
  })
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true })
  fs.writeFileSync(evidenceFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8")

  const report = validateManualRealUiEvidence({ reportDir, evidenceFile })

  assert.equal(report.ready, true)
  assert.equal(report.summary.screenshotCount, REQUIRED_SCENARIOS.length - USER_CONFIRMED_NO_SCREENSHOT_SCENARIOS.size)
  assert.equal(report.gaps.some((item) => item.id.startsWith("missing_screenshot_")), false)
})

test("manual real UI validation still blocks scenarios 3, 4 and 6 when screenshots are missing", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-manual-real-ui-required-screenshots-"))
  const evidenceFile = path.join(reportDir, "manual-real-ui", "manual-real-ui-evidence.json")
  const payload = makePassedEvidence(reportDir)
  const requiredScreenshotIds = new Set(
    REQUIRED_SCENARIOS
      .map((scenario) => scenario.id)
      .filter((id) => !USER_CONFIRMED_NO_SCREENSHOT_SCENARIOS.has(id)),
  )

  payload.scenarios = payload.scenarios.map((scenario) => {
    if (requiredScreenshotIds.has(scenario.id)) {
      return {
        ...scenario,
        screenshotPaths: [],
        evidenceSummary: "仍需截图验证。",
      }
    }
    return scenario
  })
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true })
  fs.writeFileSync(evidenceFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8")

  const report = validateManualRealUiEvidence({ reportDir, evidenceFile })
  const missingScreenshotGaps = report.gaps.filter((item) => item.id.startsWith("missing_screenshot_"))

  assert.equal(report.ready, false)
  assert.equal(missingScreenshotGaps.length, requiredScreenshotIds.size)
  assert.deepEqual(
    missingScreenshotGaps.map((item) => item.id.replace("missing_screenshot_", "")).sort(),
    [...requiredScreenshotIds].sort(),
  )
  assert.equal(missingScreenshotGaps.every((item) => item.severity === "high"), true)
})

test("manual real UI validation accepts Computer Use screenshot references without storing raw reference", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-manual-real-ui-computer-use-"))
  const evidenceFile = path.join(reportDir, "manual-real-ui", "manual-real-ui-evidence.json")
  const payload = makePassedEvidence(reportDir)
  const reference = "computer-use://session-123/screenshot-001"
  payload.scenarios[0].screenshotPaths = [reference]
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true })
  fs.writeFileSync(evidenceFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8")

  const report = validateManualRealUiEvidence({ reportDir, evidenceFile })

  assert.equal(report.ready, true)
  assert.equal(report.scenarios[0].screenshotEvidence.length, 1)
  assert.equal(report.scenarios[0].screenshotEvidence[0].kind, "computer_use")
  assert.doesNotMatch(JSON.stringify(report), /session-123|screenshot-001/)
})

test("manual real UI validation rejects sensitive raw fields", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-manual-real-ui-"))
  const evidenceFile = path.join(reportDir, "manual-real-ui", "manual-real-ui-evidence.json")
  const payload = makePassedEvidence(reportDir)
  payload.scenarios[0].sourceCode = "secret source body"
  payload.apiKey = "sk-test"
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true })
  fs.writeFileSync(evidenceFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8")

  const report = validateManualRealUiEvidence({ reportDir, evidenceFile })

  assert.equal(report.ready, false)
  assert.equal(report.privacyViolations, 2)
  assert.equal(report.gaps.some((item) => item.id === "manual_real_ui_privacy"), true)
  assert.doesNotMatch(JSON.stringify(report), /secret source body/)
  assert.doesNotMatch(JSON.stringify(report), /sk-test/)
})

test("manual real UI validation passes complete real evidence and saves latest", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-manual-real-ui-"))
  const evidenceFile = path.join(reportDir, "manual-real-ui", "manual-real-ui-evidence.json")
  const payload = makePassedEvidence(reportDir)
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true })
  fs.writeFileSync(evidenceFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8")

  const report = validateManualRealUiEvidence({ reportDir, evidenceFile })
  const saved = saveManualRealUiEvidence(report, { reportDir })
  const latest = readLatestManualRealUiEvidence({ reportDir })

  assert.equal(report.ready, true)
  assert.equal(report.summary.passedScenarios, REQUIRED_SCENARIOS.length)
  assert.equal(report.summary.passedChecks, report.summary.requiredChecks)
  assert.equal(report.gaps.length, 0)
  assert.equal(fs.existsSync(saved.latestJsonPath), true)
  assert.equal(fs.existsSync(saved.latestMarkdownPath), true)
  assert.equal(latest.report.reportKind, "manual-real-ui-evidence")
  assert.equal(latest.report.ready, true)
})

test("manual real UI markdown localizes user-visible status text", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-manual-real-ui-zh-"))
  const evidenceFile = path.join(reportDir, "manual-real-ui", "manual-real-ui-evidence-template.json")
  writeEvidence(evidenceFile)

  const report = validateManualRealUiEvidence({ reportDir, evidenceFile })
  const markdown = buildManualRealUiMarkdown(report)

  assert.match(markdown, /^# Codek 真实 Workbench 手感验收证据/m)
  assert.match(markdown, /- 就绪：否/)
  assert.match(markdown, /- 方法：人工/)
  assert.match(markdown, /- Computer Use 可用：否/)
  assert.match(markdown, /- Computer Use 前置检查：未检查/)
  assert.match(markdown, /- 真实执行确认：否/)
  assert.match(markdown, /- Cursor 级主观流畅度确认：否/)
  assert.match(markdown, /- Windows 资源管理器交叉检查：否/)
  assert.match(markdown, /- 人工复验 contract：11 stages，自动化 否，人工 否/)
  assert.match(markdown, /\| 大目录展开与快速滚动 \| 已阻断 \| 0\/3 \| 0 \| 0ms \|/)
  assert.match(markdown, /\| Workspace Trust \/ Remote Authority \/ Authentication 状态归属 \| 已阻断 \| 0\/4 \| 0 \| 0ms \|/)
  assert.match(markdown, /- 高 尚未确认真实人工或 Computer Use 执行：真实操作完成后把 manualRunConfirmed 改为 true。/)
  assert.match(markdown, /补齐检查项：滚动顺滑、文件行不消失、滚动时 Chat 仍可输入/)
  assert.match(markdown, /## Evidence Contract/)
  assert.match(markdown, /\| Stage 数 \| 11 \|/)
  assert.doesNotMatch(markdown, /Ready: YES|Ready: NO/)
  assert.doesNotMatch(markdown, /\| (passed|failed|blocked) \|/)
  assert.doesNotMatch(markdown, /- (high|medium|low) /)
  assert.doesNotMatch(markdown, /方法：manual/)
  assert.doesNotMatch(markdown, /smoothScroll|rowsDoNotDisappear|chatUsableDuringScroll/)
})

test("manual real UI preflight normalization keeps only bounded non-sensitive result fields", () => {
  const normalized = normalizeComputerUsePreflight({
    status: "blocked",
    pluginClientExists: true,
    requiredExecutionToolAvailable: false,
    toolSearches: [{ query: "js", found: false, resultCount: 0, rawOutput: "secret" }],
    note: "不要保存原始工具输出。",
  })

  assert.deepEqual(normalized.toolSearches, [{ query: "js", found: false, resultCount: 0 }])
  assert.equal(normalized.noteLength, "不要保存原始工具输出。".length)
  assert.doesNotMatch(JSON.stringify(normalized), /secret|不要保存原始工具输出/)
})
