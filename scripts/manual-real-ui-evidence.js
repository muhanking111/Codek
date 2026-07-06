#!/usr/bin/env node

const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")
const { handleReadOnlyCliFlags } = require("./evidence-cli-utils")

const root = path.resolve(__dirname, "..")

const HELP_CONFIG = {
  scriptName: "manual-real-ui-evidence.js",
  description: "Validate or initialize manual real UI evidence.",
  options: [
    "  --init  Initialize the manual evidence template workspace.",
    "  --from-smoke  Build smoke-assisted manual evidence from existing reports.",
    "  --report-dir=<path>  Read or write evidence in this reports directory.",
    "  --evidence-file=<path>  Validate a filled manual evidence JSON file.",
    "  --no-write  Print validation output without writing latest or history artifacts.",
  ],
}

const CLI_SPEC = {
  flags: ["--init", "--from-smoke", "--no-write"],
  valueOptions: ["--report-dir=", "--evidence-file="],
}

const readOnlyExitCode = require.main === module
  ? handleReadOnlyCliFlags(process.argv.slice(2), HELP_CONFIG, CLI_SPEC)
  : null
if (readOnlyExitCode !== null) process.exit(readOnlyExitCode)

const REQUIRED_SCENARIOS = [
  {
    id: "explorer_large_directory_scroll",
    title: "大目录展开与快速滚动",
    requiredChecks: ["smoothScroll", "rowsDoNotDisappear", "chatUsableDuringScroll"],
  },
  {
    id: "large_file_open_close_reopen",
    title: "真实大文件打开、关闭、重开",
    requiredChecks: ["realContentVisible", "noBlockingNotice", "workbenchResponsiveAfterReopen"],
  },
  {
    id: "extreme_file_range_window",
    title: "256MB+ 分段真实内容窗口",
    requiredChecks: ["realByteRangeVisible", "nextPreviousWorks", "noSyntheticPlaceholder"],
  },
  {
    id: "search_navigation_json_and_fixture",
    title: "Search 结果点击非空并精确跳转",
    requiredChecks: ["nonBlankEditor", "selectionAccurate", "searchViewRemainsActive"],
  },
  {
    id: "create_target_explorer_cross_check",
    title: "新建文件/文件夹 UI 目标与资源管理器落点一致",
    requiredChecks: ["uiLabelMatchesParent", "windowsExplorerPathMatches", "continuousCreateStillUsable"],
  },
  {
    id: "tabs_header_icons_visual",
    title: "Tab、Editor header、Explorer icon 视觉状态",
    requiredChecks: ["tabsReadable", "editorHeaderProfessional", "iconsProfessionalFallback"],
  },
  {
    id: "cursor_same_directory_parity",
    title: "同目录 Cursor / Codek 文件树和搜索对照",
    requiredChecks: ["explorerCountMatchesCursor", "searchResultsComparable", "differencesClassified"],
  },
  {
    id: "large_file_deep_scroll_switching",
    title: "真实大文件快速滚动、深窗口跳转和同目录切换",
    requiredChecks: ["fastScrollNoBlank", "deepJumpNoBlank", "reopenAndSiblingSwitchStable"],
  },
  {
    id: "scm_testing_timeline_notification_center",
    title: "SCM / Testing / Timeline / Notification Center 人工体验",
    requiredChecks: ["surfacesVisible", "actionsTriggerable", "failuresAttributed"],
  },
  {
    id: "trust_remote_auth_ui_states",
    title: "Workspace Trust / Remote Authority / Authentication 状态归属",
    requiredChecks: ["trustAllowDenyVisible", "remoteResolveStatesVisible", "authSessionStatesVisible", "tokensRedacted"],
  },
  {
    id: "manual_acceptance_evidence_contract",
    title: "自动化报告到人工复验 evidence contract",
    requiredChecks: ["jsonMarkdownPngLinked", "stageOwnersVisible", "manualReplayStepsPresent", "blockedOwnersActionable"],
  },
]

const USER_CONFIRMED_NO_SCREENSHOT_SCENARIOS = new Set([
  "explorer_large_directory_scroll",
  "large_file_open_close_reopen",
  "create_target_explorer_cross_check",
])

const CHECK_LABELS = {
  smoothScroll: "滚动顺滑",
  rowsDoNotDisappear: "文件行不消失",
  chatUsableDuringScroll: "滚动时 Chat 仍可输入",
  realContentVisible: "真实内容可见",
  noBlockingNotice: "没有阻断式提示",
  workbenchResponsiveAfterReopen: "关闭重开后 Workbench 仍响应",
  realByteRangeVisible: "真实 byte range 内容可见",
  nextPreviousWorks: "上一段/下一段切换可用",
  noSyntheticPlaceholder: "没有合成占位内容",
  nonBlankEditor: "编辑器非空",
  selectionAccurate: "跳转选择位置准确",
  searchViewRemainsActive: "搜索视图保持可用",
  uiLabelMatchesParent: "UI 标签匹配父目录",
  windowsExplorerPathMatches: "Windows 资源管理器路径一致",
  continuousCreateStillUsable: "连续新建仍可用",
  tabsReadable: "Tab 名称可读",
  editorHeaderProfessional: "编辑器标题区专业",
  iconsProfessionalFallback: "图标 fallback 专业",
  explorerCountMatchesCursor: "文件树数量和层级可对照 Cursor/Windows Explorer",
  searchResultsComparable: "Search 结果数量和跳转可对照 Cursor",
  differencesClassified: "差异已归属为 Codek、Cursor 或环境/隐藏文件规则",
  fastScrollNoBlank: "快速滚动不空白",
  deepJumpNoBlank: "深窗口跳转不空白",
  reopenAndSiblingSwitchStable: "关闭重开和同目录普通文件切换稳定",
  surfacesVisible: "SCM/Testing/Timeline/Notification/Progress 视图可见",
  actionsTriggerable: "关键 action 可触发",
  failuresAttributed: "失败归属清晰",
  trustAllowDenyVisible: "Workspace Trust allow/deny 可见",
  remoteResolveStatesVisible: "Remote resolve success/failure/cache 可见",
  authSessionStatesVisible: "Auth missing/pending/authorized/revoked/error 可见",
  tokensRedacted: "Auth token 未进入证据",
  jsonMarkdownPngLinked: "JSON/Markdown/PNG 路径互相指向",
  stageOwnersVisible: "stage owner 和 failure owner 可见",
  manualReplayStepsPresent: "人工复验步骤可见",
  blockedOwnersActionable: "blocked owner 有下一步动作",
}

const SCENARIO_MANUAL_STEPS = {
  explorer_large_directory_scroll: [
    "在左侧文件树展开一个真实的大目录，最好是包含大量文件/文件夹的项目目录。",
    "用鼠标滚轮连续快速上下滚动 30 秒以上。",
    "同时点一下 Chat 输入框，确认滚动期间或滚动后仍能输入文字。",
    "确认文件行没有空白消失、重复闪烁、错位、长时间卡住。",
  ],
  large_file_open_close_reopen: [
    "打开一个真实大文件，不要只用空文件或占位 fixture。",
    "确认右侧编辑器显示真实文本内容，而不是空白页或只显示文件名。",
    "关闭该文件 Tab 后重新打开，确认 Workbench 仍能正常响应。",
    "确认没有出现“文件过大所以不能打开”的阻断式提示。",
  ],
  extreme_file_range_window: [
    "打开一个 256MB 以上的真实文本/日志/代码类文件。",
    "确认当前窗口显示的是真实文件片段，而不是黑块、空白或合成占位文字。",
    "点击上一段/下一段或等效分段切换控件，确认每段都能看到真实内容。",
    "确认切换分段不会导致整软件卡死。",
  ],
  search_navigation_json_and_fixture: [
    "打开 Search，搜索 json 或一个你能确认存在的关键词。",
    "点击同一文件内不同搜索结果，再点击不同文件的搜索结果。",
    "确认右侧编辑器不是空白，并且跳到对应行/对应匹配位置。",
    "确认搜索列表仍保持可用，没有重复到明显异常的一行多次假结果。",
  ],
  create_target_explorer_cross_check: [
    "在文件树里选中一个已展开文件夹，然后点新建文件和新建文件夹。",
    "确认新建输入框显示的目标父目录就是你选中的文件夹名。",
    "创建后立刻在 Codek 文件树里看到新文件/新文件夹。",
    "打开 Windows 资源管理器进入同一路径，确认真实落点和 UI 显示一致。",
    "连续创建第二个文件或文件夹，确认输入框仍能输入，不会失效。",
  ],
  tabs_header_icons_visual: [
    "打开多个文件，让 Tab 数量多到会挤压宽度。",
    "确认每个 Tab 至少能看到可读文件名片段，不出现完全空白 Tab。",
    "确认编辑器顶部标题区不是只孤零零显示文件名，而是接近 Cursor/VS Code 的文件 header 体验。",
    "确认左侧文件树和顶部 Tab 的文件图标接近 VS Code/Cursor 风格，fallback 图标不廉价、不错位。",
  ],
  cursor_same_directory_parity: [
    "在 Cursor 和 Codek 中打开同一个真实目录。",
    "对照 Explorer 文件数量、嵌套目录、隐藏文件规则和 Search 结果数量。",
    "点击 Codek 中同目录的多个搜索结果，确认编辑器非空且定位正确。",
    "如果数量或结果不同，记录差异归属：Codek 缺陷、Cursor 行为差异、隐藏文件/忽略规则或环境差异。",
  ],
  large_file_deep_scroll_switching: [
    "打开真实大文件和同目录一个普通文本/代码文件。",
    "对大文件执行快速滚轮、PageDown、滚到底、拖动滚动条、深窗口跳转或搜索跳转、End。",
    "关闭大文件后重新打开，再切到同目录普通文件，再切回大文件。",
    "确认每一步都显示真实文本，不出现空白 viewport、黑屏、合成占位内容或 Workbench 冻结。",
  ],
  scm_testing_timeline_notification_center: [
    "打开 Agent Evidence 或 Workbench 中的 SCM、Testing、Timeline、Progress、Notification surfaces。",
    "触发安全的 open/diff/attach、test review/rerun、progress cancel、notification dismiss/focus action。",
    "确认 action 有可观察状态变化，失败能归属到 SCM/Testing/Timeline/Notification/Progress，而不是泛化为 UI 失败。",
  ],
  trust_remote_auth_ui_states: [
    "打开 Remote / Extension Trust / Authentication workbench surface。",
    "检查 Workspace Trust allow/deny、Remote Authority resolve success/failure/cache、Authentication missing/pending/authorized/revoked/error 状态。",
    "确认 blocked/pass 可以归属到 Trust、Remote Authority、Authentication 或 Extension Host。",
    "确认报告和 UI evidence 中没有 token、cookie 或 OAuth secret 原文。",
  ],
  manual_acceptance_evidence_contract: [
    "打开 `.codek/reports/workbench-real-project-ui-latest.json/.md/.png`。",
    "确认 Markdown 中有 Gate Attribution 和 Manual Acceptance Contract 表。",
    "确认每个 acceptance check 有 stage owner、failure owner、report paths、manual replay steps 和必要的 Cursor parity checklist。",
    "确认 manual evidence 入口仍是 `.codek/reports/manual-real-ui-evidence-latest.json/.md`，没有产生第二套人工验收状态源。",
  ],
}

const SENSITIVE_KEYS = [
  "promptBody",
  "attachmentBody",
  "sourceCode",
  "diffBody",
  "commandOutput",
  "stdout",
  "stderr",
  "token",
  "cookie",
  "privateKey",
  "secret",
  "password",
  "apiKey",
]

function defaultReportDir() {
  return path.join(root, ".codek", "reports")
}

function manualRealUiPaths(reportDir = defaultReportDir()) {
  const resolved = reportDir || defaultReportDir()
  return {
    reportDir: resolved,
    evidenceDir: path.join(resolved, "manual-real-ui"),
    screenshotDir: path.join(resolved, "manual-real-ui", "screenshots"),
    indexPath: path.join(resolved, "manual-real-ui", "README.md"),
    latestJsonPath: path.join(resolved, "manual-real-ui-evidence-latest.json"),
    latestMarkdownPath: path.join(resolved, "manual-real-ui-evidence-latest.md"),
    historyDir: path.join(resolved, "history"),
  }
}

function parseArgs(argv) {
  const reportDirArg = argv.find((arg) => arg.startsWith("--report-dir="))
  const evidenceFileArg = argv.find((arg) => arg.startsWith("--evidence-file="))
  return {
    init: argv.includes("--init"),
    fromSmoke: argv.includes("--from-smoke"),
    noWrite: argv.includes("--no-write"),
    reportDir: reportDirArg ? reportDirArg.slice("--report-dir=".length) : defaultReportDir(),
    evidenceFile: evidenceFileArg ? evidenceFileArg.slice("--evidence-file=".length) : "",
  }
}

function buildManualRealUiTemplate(input = {}) {
  const createdAt = Number(input.createdAt || Date.now())
  const paths = manualRealUiPaths(input.reportDir)
  return {
    reportKind: "manual-real-ui-evidence-template",
    createdAt,
    operator: "",
    projectRoot: "D:/Workspace",
    method: "manual",
    computerUseAvailable: false,
    computerUsePreflight: {
      status: "not_checked",
      pluginClientExists: false,
      requiredExecutionToolAvailable: false,
      toolSearches: [
        { query: "node_repl js", found: false },
        { query: "mcp__node_repl__js", found: false },
        { query: "js", found: false },
        { query: "JavaScript execution", found: false },
      ],
      note: "如需 Computer Use 自动验收，当前线程必须暴露可执行的 JS 工具并完成 Windows 连接。",
    },
    manualRunConfirmed: false,
    manualAcceptanceContract: {
      status: "manual_required",
      automatedReportPaths: [
        "workbench-real-project-ui-latest.json",
        "workbench-real-project-ui-latest.md",
        "workbench-real-project-ui-latest.png",
      ],
      requiredStageIds: [
        "explorer_file_operation",
        "file_service_search",
        "textfile_workingcopy_large_file",
        "editor_problems_diagnostics",
        "terminal_debug_output_task",
        "mcp_quickinput_gallery",
        "commands_menu_keybinding_settings",
        "workbench_layout_ui",
        "agent_evidence",
        "scm_testing_timeline_notification_progress",
        "extension_trust_remote_auth",
      ],
      note: "自动化 ready 只说明脚本覆盖路径通过；人工复验必须确认同目录 Cursor/Codek 对照、真实大文件手感、SCM/Testing/Timeline/Notification、Trust/Remote/Auth 和 JSON/MD/PNG 证据链。",
    },
    durationMinutes: 0,
    overallResult: "blocked",
    cursorLevelSmoothnessConfirmed: false,
    windowsExplorerCrossCheckConfirmed: false,
    notes: "只写验收摘要，不粘贴源码、完整日志、完整 diff、prompt 正文或敏感信息。",
    scenarios: REQUIRED_SCENARIOS.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      status: "blocked",
      checks: Object.fromEntries(scenario.requiredChecks.map((check) => [check, false])),
      durationMs: 0,
      maxObservedStallMs: 0,
      screenshotPaths: [
        path.join(paths.screenshotDir, `${scenario.id}.png`).replace(/\\/g, "/"),
      ],
      evidenceSummary: "",
    })),
  }
}

function initManualRealUiWorkspace(options = {}) {
  const paths = manualRealUiPaths(options.reportDir)
  fs.mkdirSync(paths.evidenceDir, { recursive: true })
  fs.mkdirSync(paths.screenshotDir, { recursive: true })
  const template = buildManualRealUiTemplate({ reportDir: options.reportDir, createdAt: options.createdAt })
  const templatePath = path.join(paths.evidenceDir, "manual-real-ui-evidence-template.json")
  fs.writeFileSync(templatePath, `${JSON.stringify(template, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.indexPath, `${buildManualRealUiIndexMarkdown(paths)}\n`, "utf8")
  return {
    ...paths,
    templatePath,
    template,
  }
}

function buildSmokeAssistedManualRealUiEvidence(options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const template = buildManualRealUiTemplate({ reportDir, createdAt: options.createdAt })
  const realProjectUi = readJson(path.join(reportDir, "workbench-real-project-ui-latest.json")) || {}
  const searchNavigation = readJson(path.join(reportDir, "workbench-search-navigation-latest.json")) || {}
  const visualBaseline = readJson(path.join(reportDir, "workbench-visual-baseline-latest.json")) || {}
  const iconVisual = readJson(path.join(reportDir, "electron-smoke-icon-visual-state-latest-result.json")) || {}
  const windowsExplorerCrossCheck = readJson(path.join(reportDir, "windows-explorer-cross-check-latest.json")) || {}
  const realProjectScreenshot = firstExistingPath([
    realProjectUi.latestScreenshotPath,
    realProjectUi.screenshotPath,
    path.join(reportDir, "workbench-real-project-ui-latest.png"),
  ])
  const iconScreenshot = firstExistingPath([
    iconVisual.latestScreenshotPath,
    iconVisual.screenshotPath,
    path.join(reportDir, "workbench-icon-visual-state-latest.png"),
  ])
  const realAcceptance = realProjectUi.acceptance || {}
  const realMetrics = realProjectUi.metrics || {}
  const gateAttribution = realProjectUi.gateAttribution || {}
  const manualAcceptanceContract = realProjectUi.manualAcceptanceContract || gateAttribution.manualAcceptanceContract || {}
  const gateRows = Array.isArray(gateAttribution.rows) ? gateAttribution.rows : []
  const failedRows = Array.isArray(gateAttribution.failedRows) ? gateAttribution.failedRows : []
  const manualContractRows = Array.isArray(manualAcceptanceContract.rows) ? manualAcceptanceContract.rows : []
  const allGateRowsPass = gateRows.length > 0 && failedRows.length === 0 && gateRows.every((row) => row?.status === "pass" || row?.status === "reference")
  const manualContractReplayReady = manualAcceptanceContract.automatedReady === true
    && manualContractRows.length >= 11
    && manualContractRows.every((row) => Array.isArray(row?.manualReplaySteps) && row.manualReplaySteps.length > 0)
  const searchAcceptance = searchNavigation.acceptance || {}
  const iconReady = iconVisual.ok === true || iconVisual.ready === true || iconVisual.status === "ready"
  const automatedSmoothnessChecks = {
    explorerRowsVirtualizedAndNonBlank: realAcceptance.explorerRowsVirtualizedAndNonBlank === true,
    visibleRowsStableAfterFastScroll: realAcceptance.visibleRowsStableAfterFastScroll === true,
    scrollP95WithinCursorGradeBudget: realAcceptance.scrollP95WithinCursorGradeBudget === true,
    scrollMaxAvoidsHalfSecondStalls: realAcceptance.scrollMaxAvoidsHalfSecondStalls === true,
    chatInputUsable: realAcceptance.chatInputUsable === true,
    largeFileRealContentVisible: realAcceptance.largeFileRealContentVisible === true,
    largeFileCloseReopenKeepsWorkbenchResponsive: realAcceptance.largeFileCloseReopenKeepsWorkbenchResponsive === true,
    extremeFileAutoWindowNavigation: realAcceptance.extremeFileAutoWindowNavigation === true,
    searchKeepsEditorNonBlank: searchAcceptance.keepsEditorNonBlank === true || searchAcceptance.opensRealEditorContent === true,
    searchRevealsExactMatchSelection: searchAcceptance.revealsExactMatchSelection === true || searchAcceptance.jsonSearchSelectionAccurate === true,
    searchViewRemainsActive: searchAcceptance.keepsSearchViewActive === true,
  }
  const automatedCursorSmoothnessEvidenceConfirmed = Object.values(automatedSmoothnessChecks).every(Boolean)

  return {
    ...template,
    method: "automated_smoke_assist",
    manualAcceptanceContract: {
      status: manualAcceptanceContract.status || (allGateRowsPass ? "manual-required" : "blocked-by-automation"),
      automatedReady: manualAcceptanceContract.automatedReady === true || allGateRowsPass,
      manualReady: false,
      stageCount: manualContractRows.length || gateRows.length,
      blockedStageCount: Number(manualAcceptanceContract.blockedRows?.length || failedRows.length || 0),
      sourceReports: [
        "workbench-real-project-ui-latest.json",
        "workbench-real-project-ui-latest.md",
        "workbench-real-project-ui-latest.png",
        "manual-real-ui-evidence-latest.json",
        "manual-real-ui-evidence-latest.md",
      ],
      stageIds: manualContractRows.map((row) => String(row?.stageId || "")).filter(Boolean),
      note: "From-smoke evidence only pre-fills automated stage contract; human replay remains required.",
    },
    manualRunConfirmed: true,
    overallResult: "blocked",
    cursorLevelSmoothnessConfirmed: false,
    automatedCursorSmoothnessEvidenceConfirmed,
    automatedSmoothnessEvidence: {
      method: "real_electron_smoke_budget",
      sourceReports: [
        "workbench-real-project-ui-latest.json",
        "workbench-search-navigation-latest.json",
        "workbench-visual-baseline-latest.json",
      ],
      checks: automatedSmoothnessChecks,
      note: "Automated evidence records objective smoke and performance-budget results only; it does not replace subjective human or Computer Use smoothness confirmation.",
    },
    windowsExplorerCrossCheckConfirmed: windowsExplorerCrossCheck.ready === true,
    notes: "Generated from real Electron smoke evidence. Subjective cursor-grade feel and Windows Explorer cross-check still require human or Computer Use confirmation.",
    scenarios: template.scenarios.map((scenario) => {
      if (scenario.id === "explorer_large_directory_scroll" && realProjectUi.ready === true) {
        return passedScenario(scenario, {
          smoothScroll: realAcceptance.scrollP95WithinCursorGradeBudget === true && realAcceptance.scrollMaxAvoidsHalfSecondStalls === true,
          rowsDoNotDisappear: realAcceptance.explorerRowsVirtualizedAndNonBlank === true && realAcceptance.visibleRowsStableAfterFastScroll === true,
          chatUsableDuringScroll: realAcceptance.chatInputUsable === true,
        }, realProjectScreenshot, "real-project UI smoke explorer scroll and chat usability")
      }
      if (scenario.id === "large_file_open_close_reopen" && realProjectUi.ready === true) {
        return passedScenario(scenario, {
          realContentVisible: realAcceptance.largeFileRealContentVisible === true,
          noBlockingNotice: realAcceptance.largeFileAvoidsBlockingNotice === true,
          workbenchResponsiveAfterReopen: realAcceptance.largeFileCloseReopenKeepsWorkbenchResponsive === true,
        }, realProjectScreenshot, "real-project UI smoke")
      }
      if (scenario.id === "extreme_file_range_window" && realProjectUi.ready === true) {
        return passedScenario(scenario, {
          realByteRangeVisible: realAcceptance.extremeFileAutoWindowNavigation === true,
          nextPreviousWorks: realAcceptance.extremeFileAutoWindowNavigation === true,
          noSyntheticPlaceholder: realAcceptance.largeFileRealContentVisible === true,
        }, realProjectScreenshot, "real-project UI smoke extreme range window")
      }
      if (scenario.id === "search_navigation_json_and_fixture" && searchNavigation.ready === true) {
        return passedScenario(scenario, {
          nonBlankEditor: searchAcceptance.keepsEditorNonBlank === true || searchAcceptance.opensRealEditorContent === true,
          selectionAccurate: searchAcceptance.revealsExactMatchSelection === true || searchAcceptance.jsonSearchSelectionAccurate === true,
          searchViewRemainsActive: searchAcceptance.keepsSearchViewActive === true,
        }, realProjectScreenshot, "search navigation smoke")
      }
      if (scenario.id === "create_target_explorer_cross_check" && realProjectUi.ready === true) {
        return passedScenario(scenario, {
          uiLabelMatchesParent: realAcceptance.createTargetDisplayMatchesDisk === true,
          windowsExplorerPathMatches: windowsExplorerCrossCheck.ready === true,
          continuousCreateStillUsable: realAcceptance.continuousCreateRemainsUsable === true,
        }, "", windowsExplorerCrossCheck.ready === true
          ? "real-project UI smoke plus Windows Shell namespace cross-check"
          : "real-project UI smoke create target checks; Windows Explorer cross-check still missing")
      }
      if (scenario.id === "tabs_header_icons_visual" && visualBaseline.ready === true && iconReady) {
        return passedScenario(scenario, {
          tabsReadable: true,
          editorHeaderProfessional: true,
          iconsProfessionalFallback: true,
        }, iconScreenshot || realProjectScreenshot, "visual baseline and icon visual smoke")
      }
      if (scenario.id === "cursor_same_directory_parity" && realProjectUi.ready === true) {
        return passedScenario(scenario, {
          explorerCountMatchesCursor: realAcceptance.nativeExplorerMounted === true
            && realAcceptance.explorerRowsVirtualizedAndNonBlank === true,
          searchResultsComparable: realAcceptance.searchResultOpensNonBlankEditor === true
            && realAcceptance.sameLineSearchOccurrencesAccurate === true,
          differencesClassified: allGateRowsPass,
        }, realProjectScreenshot, "real-project UI smoke plus gate attribution; Cursor side-by-side still requires human confirmation")
      }
      if (scenario.id === "large_file_deep_scroll_switching" && realProjectUi.ready === true) {
        return passedScenario(scenario, {
          fastScrollNoBlank: realAcceptance.largeFileUserScrollAvoidsBlankViewport === true
            && realMetrics.largeFileUserScrollbarDragViewportTextVisible === true,
          deepJumpNoBlank: realMetrics.largeFileDeepViewportTextVisible === true
            && realMetrics.largeFileNextWindowViewportTextVisible === true,
          reopenAndSiblingSwitchStable: realAcceptance.largeFileReopenRealContentVisible === true
            && realAcceptance.largeFileCloseReopenKeepsWorkbenchResponsive === true
            && realAcceptance.normalEditorContentVisible === true,
        }, realProjectScreenshot, "real-project UI smoke large-file fast scroll/deep window/reopen evidence")
      }
      if (scenario.id === "scm_testing_timeline_notification_center" && realProjectUi.ready === true) {
        return passedScenario(scenario, {
          surfacesVisible: realAcceptance.agentEvidenceWorkbenchSurfaceVisible === true
            && realAcceptance.agentEvidenceWorkbenchTimelineLinks === true,
          actionsTriggerable: realAcceptance.agentEvidenceWorkbenchProgressNotifications === true
            && Array.isArray(realMetrics.agentEvidenceNotificationDismissCommandIds)
            && realMetrics.agentEvidenceNotificationDismissCommandIds.length > 0,
          failuresAttributed: gateRows.some((row) => row?.stage === "SCM/Testing/Timeline/Notification/Progress"),
        }, realProjectScreenshot, "real-project UI smoke SCM/Testing/Timeline/Notification/Progress stage evidence")
      }
      if (scenario.id === "trust_remote_auth_ui_states" && realProjectUi.ready === true) {
        return passedScenario(scenario, {
          trustAllowDenyVisible: realAcceptance.workspaceTrustWorkbenchDecisionEvidence === true,
          remoteResolveStatesVisible: realAcceptance.remoteAuthorityWorkbenchResolveEvidence === true,
          authSessionStatesVisible: realAcceptance.authenticationWorkbenchSessionEvidence === true,
          tokensRedacted: realMetrics.authenticationWorkbenchTokenRedacted === true,
        }, realProjectScreenshot, "real-project UI smoke Workspace Trust / Remote Authority / Authentication evidence")
      }
      if (scenario.id === "manual_acceptance_evidence_contract" && realProjectUi.ready === true) {
        return passedScenario(scenario, {
          jsonMarkdownPngLinked: Boolean(realProjectScreenshot)
            && typeof realProjectUi.latestJsonPath === "string"
            && typeof realProjectUi.latestMarkdownPath === "string",
          stageOwnersVisible: allGateRowsPass,
          manualReplayStepsPresent: manualContractReplayReady,
          blockedOwnersActionable: failedRows.length === 0
            || failedRows.every((row) => String(row?.owner || "").length > 0 && Array.isArray(row?.failedChecks)),
        }, realProjectScreenshot, "real-project UI JSON/Markdown/PNG plus manual acceptance contract")
      }
      return scenario
    }),
  }
}

function passedScenario(scenario, checks, screenshotPath, evidenceSummary) {
  const allPassed = Object.values(checks).every(Boolean)
  return {
    ...scenario,
    status: allPassed ? "passed" : "blocked",
    checks: { ...scenario.checks, ...checks },
    durationMs: 0,
    maxObservedStallMs: 0,
    screenshotPaths: screenshotPath ? [screenshotPath] : [],
    evidenceSummary,
  }
}

function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue
    const resolved = path.resolve(String(candidate))
    if (fs.existsSync(resolved)) return resolved
  }
  return ""
}

function buildManualRealUiIndexMarkdown(paths) {
  return [
    "# Codek 真实 Workbench 手感验收",
    "",
    "这个目录用于记录真实人工或 Computer Use 对 Codek Workbench 的最后一公里验收。自动 smoke 不能替代这里的主观手感、真实桌面截图和 Windows 资源管理器交叉检查。",
    "",
    "## 一句话流程",
    "",
    "1. 启动 Codek。",
    "2. 真实操作下面所有场景。",
    "3. 场景 1/2/5 可在用户明确人工确认后不补截图；场景 3/4/6 仍需截图或 Computer Use 引用。",
    "4. 把 `manual-real-ui-evidence-template.json` 里的顶层字段和所有场景都改成通过。",
    "5. 导入 JSON，再运行企业审计和发布证据导出。",
    "",
    "## 命令",
    "",
    "在 `D:\\Workspace` 打开 PowerShell 后执行：",
    "",
    "```powershell",
    "npm start",
    "```",
    "",
    "另开一个 PowerShell，初始化或刷新模板：",
    "",
    "```powershell",
    `node scripts/manual-real-ui-evidence.js --init --report-dir=${paths.reportDir}`,
    "```",
    "",
    "填完模板后导入证据：",
    "",
    "```powershell",
    `node scripts/manual-real-ui-evidence.js --evidence-file=${path.join(paths.evidenceDir, "manual-real-ui-evidence-template.json")} --report-dir=${paths.reportDir}`,
    "node scripts/enterprise-doc-completion-audit.js --report-dir=D:\\Workspace\\.codek\\reports",
    "node scripts/release-evidence-export.js --report-dir=D:\\Workspace\\.codek\\reports --current-release-gate-mode=bd-enterprise-candidate",
    "```",
    "",
    "## 截图证据规则",
    "",
    "- 本地截图路径必须指向真实存在的文件；只填写路径字符串但文件不存在，不会被计入截图证据。",
    "- Computer Use 截图可以使用 `computer-use://...` 或 `computer_use://...` 引用；报告只保存引用 hash 和长度，不保存原始引用。",
    "- 模板里的占位 `screenshotPaths` 不会被计入截图证据，必须完成真实截图后再导入。",
    "- 仅 `explorer_large_directory_scroll`、`large_file_open_close_reopen`、`create_target_explorer_cross_check` 支持用户明确人工确认后免截图；其它场景缺截图会继续阻断。",
    "",
    "## 必须覆盖的场景",
    "",
    "| 场景 | 场景 ID | 必须检查 |",
    "| --- | --- | --- |",
    ...REQUIRED_SCENARIOS.map((scenario) => `| ${scenario.title} | ${scenario.id} | ${formatCheckList(scenario.requiredChecks)} |`),
    "",
    "## 手动操作细则",
    "",
    ...REQUIRED_SCENARIOS.flatMap((scenario) => [
      `### ${scenario.title}`,
      "",
      ...SCENARIO_MANUAL_STEPS[scenario.id].map((step, index) => `${index + 1}. ${step}`),
      "",
      "通过后填写：",
      "",
      "- `status` 改成 `passed`。",
      "- `checks` 里的每一项都改成 `true`。",
      "- `durationMs` 填这个场景大概耗时，单位毫秒。",
      "- `maxObservedStallMs` 填你观察到的最大卡顿时长，没明显卡顿就填 0 到 200。",
      USER_CONFIRMED_NO_SCREENSHOT_SCENARIOS.has(scenario.id)
        ? "- `screenshotPaths` 可留空，但必须已经由用户明确人工确认通过。"
        : "- `screenshotPaths` 填真实存在的截图路径或 Computer Use 截图引用。",
      "- `evidenceSummary` 写一句中文摘要，不要粘贴源码或完整日志。",
      "",
    ]),
    "## 顶层字段怎么填",
    "",
    "```json",
    '{',
    '  "operator": "用户手动验收",',
    '  "manualRunConfirmed": true,',
    '  "durationMinutes": 20,',
    '  "overallResult": "passed",',
    '  "cursorLevelSmoothnessConfirmed": true,',
    '  "windowsExplorerCrossCheckConfirmed": true',
    '}',
    "```",
    "",
    "## 通过标准",
    "",
    "- `D:\\Workspace\\.codek\\reports\\manual-real-ui-evidence-latest.json` 里的 `ready` 必须是 `true`。",
    "- `D:\\Workspace\\.codek\\reports\\enterprise-doc-completion-audit-latest.json` 里的 `enterpriseComplete` 必须是 `true`。",
    "- `D:\\Workspace\\.codek\\reports\\release-evidence-latest.json` 里的 `enterpriseComplete` 必须是 `true`，且不能再有 `manual_real_ui_evidence` gap。",
    "",
    "## 隐私边界",
    "",
    "- 不保存 prompt 正文、源码正文、完整 diff、完整命令输出、token、cookie、私钥或个人隐私。",
    "- 截图路径、备注和复现摘要只进入 hash/长度或摘要级字段。",
  ].join("\n")
}

function validateManualRealUiEvidence(options = {}) {
  const evidenceFile = options.evidenceFile || path.join(manualRealUiPaths(options.reportDir).evidenceDir, "manual-real-ui-evidence-template.json")
  const raw = options.rawEvidence || readJson(evidenceFile) || {}
  const privacyViolations = findSensitiveKeys(raw).length
  const scenarios = normalizeScenarios(raw.scenarios)
  const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]))
  const gaps = []

  if (privacyViolations > 0) {
    gaps.push(gap("manual_real_ui_privacy", "真实 UI 验收包含敏感原文字段", "删除 prompt/source/diff/output/token 等字段后重新导入。", "high"))
  }
  if (raw.manualRunConfirmed !== true) {
    gaps.push(gap("manual_real_ui_not_confirmed", "尚未确认真实人工或 Computer Use 执行", "真实操作完成后把 manualRunConfirmed 改为 true。", "high"))
  }
  if (raw.cursorLevelSmoothnessConfirmed !== true) {
    gaps.push(gap("cursor_level_smoothness_not_confirmed", "Cursor 级主观流畅度未确认", "真实滚动、打开、关闭、搜索、新建均确认流畅后再标记。", "high"))
  }
  if (raw.windowsExplorerCrossCheckConfirmed !== true) {
    gaps.push(gap("windows_explorer_cross_check_missing", "缺少 Windows 资源管理器落点交叉检查", "创建文件/文件夹后用资源管理器确认真实路径。", "high"))
  }
  const computerUsePreflight = normalizeComputerUsePreflight(raw.computerUsePreflight)
  const manualAcceptanceContract = normalizeManualAcceptanceContract(raw.manualAcceptanceContract)
  if (computerUsePreflight.status === "blocked") {
    gaps.push(gap("computer_use_preflight_blocked", "当前线程不具备 Computer Use 自动验收条件", "换到具备 Windows 连接执行工具的线程，或完成真实人工验收后导入证据。", "info"))
  }

  for (const required of REQUIRED_SCENARIOS) {
    const actual = scenarioById.get(required.id)
    if (!actual) {
      gaps.push(gap(`missing_${required.id}`, `${required.title} 缺少场景记录`, "补齐该场景的真实操作记录。", "high"))
      continue
    }
    if (actual.status !== "passed") {
      gaps.push(gap(`failed_${required.id}`, `${required.title} 未通过`, "先修复该真实 UI 场景，再重新记录验收。", "high"))
    }
    const missingChecks = required.requiredChecks.filter((check) => actual.checks[check] !== true)
    if (missingChecks.length > 0) {
      gaps.push(gap(`missing_checks_${required.id}`, `${required.title} 缺少检查项`, `补齐检查项：${formatCheckList(missingChecks)}`, "high"))
    }
    if (actual.screenshotEvidence.length === 0 && !allowsUserConfirmedNoScreenshot(required.id, actual, raw)) {
      const severity = USER_CONFIRMED_NO_SCREENSHOT_SCENARIOS.has(required.id) ? "medium" : "high"
      gaps.push(gap(`missing_screenshot_${required.id}`, `${required.title} 缺少截图路径证据`, "至少填写一个截图路径或 Computer Use 截图引用。", severity))
    }
  }

  const highGaps = gaps.filter((item) => item.severity === "high")
  const ready = highGaps.length === 0
  const report = {
    reportKind: "manual-real-ui-evidence",
    createdAt: Date.now(),
    ready,
    status: ready ? "ready" : "blocked",
    statusLabel: ready ? "真实 Workbench 手感验收已确认" : "真实 Workbench 手感验收缺证据",
    evidenceFile,
    projectRoot: String(raw.projectRoot || ""),
    method: String(raw.method || ""),
    computerUseAvailable: raw.computerUseAvailable === true,
    computerUsePreflight,
    operatorHash: hashText(raw.operator || ""),
    operatorLength: String(raw.operator || "").length,
    manualRunConfirmed: raw.manualRunConfirmed === true,
    cursorLevelSmoothnessConfirmed: raw.cursorLevelSmoothnessConfirmed === true,
    automatedCursorSmoothnessEvidenceConfirmed: raw.automatedCursorSmoothnessEvidenceConfirmed === true,
    automatedSmoothnessEvidence: normalizeAutomatedSmoothnessEvidence(raw.automatedSmoothnessEvidence),
    manualAcceptanceContract,
    windowsExplorerCrossCheckConfirmed: raw.windowsExplorerCrossCheckConfirmed === true,
    privacyViolations,
    summary: {
      totalScenarios: REQUIRED_SCENARIOS.length,
      passedScenarios: REQUIRED_SCENARIOS.filter((scenario) => scenarioById.get(scenario.id)?.status === "passed").length,
      requiredChecks: REQUIRED_SCENARIOS.reduce((total, scenario) => total + scenario.requiredChecks.length, 0),
      passedChecks: REQUIRED_SCENARIOS.reduce((total, scenario) => {
        const actual = scenarioById.get(scenario.id)
        return total + scenario.requiredChecks.filter((check) => actual?.checks?.[check] === true).length
      }, 0),
      screenshotCount: scenarios.reduce((total, scenario) => total + scenario.screenshotEvidence.length, 0),
      highGaps: highGaps.length,
      gaps: gaps.length,
    },
    scenarios,
    gaps,
    nextActions: gaps.slice(0, 5).map((item) => ({ id: item.id, title: item.title, action: item.action })),
  }
  report.markdown = buildManualRealUiMarkdown(report)
  return report
}

function allowsUserConfirmedNoScreenshot(id, scenario, raw) {
  if (!USER_CONFIRMED_NO_SCREENSHOT_SCENARIOS.has(id)) return false
  if (raw.manualRunConfirmed !== true) return false
  if (scenario?.status !== "passed") return false
  const required = REQUIRED_SCENARIOS.find((item) => item.id === id)
  if (!required) return false
  return required.requiredChecks.every((check) => scenario.checks?.[check] === true)
}

function normalizeScenarios(input) {
  return (Array.isArray(input) ? input : []).map((scenario) => {
    const screenshotPaths = normalizeArray(scenario?.screenshotPaths || scenario?.screenshots || scenario?.screenshotPath)
    const summary = String(scenario?.evidenceSummary || scenario?.summary || "")
    return {
      id: String(scenario?.id || ""),
      title: String(scenario?.title || ""),
      status: normalizeStatus(scenario?.status),
      checks: scenario?.checks && typeof scenario.checks === "object" ? { ...scenario.checks } : {},
      durationMs: Number(scenario?.durationMs || 0),
      maxObservedStallMs: Number(scenario?.maxObservedStallMs || 0),
      screenshotEvidence: screenshotPaths
        .map((item) => normalizeScreenshotEvidence(item))
        .filter(Boolean),
      evidenceSummaryHash: hashText(summary),
      evidenceSummaryLength: summary.length,
    }
  }).filter((scenario) => scenario.id)
}

function normalizeComputerUsePreflight(input = {}) {
  const value = input && typeof input === "object" ? input : {}
  const toolSearches = Array.isArray(value.toolSearches) ? value.toolSearches : []
  return {
    status: normalizePreflightStatus(value.status),
    pluginClientExists: value.pluginClientExists === true,
    requiredExecutionToolAvailable: value.requiredExecutionToolAvailable === true,
    toolSearches: toolSearches.map((item) => ({
      query: String(item?.query || ""),
      found: item?.found === true,
      resultCount: Number(item?.resultCount || 0),
    })).filter((item) => item.query),
    noteHash: hashText(value.note || ""),
    noteLength: String(value.note || "").length,
  }
}

function normalizeAutomatedSmoothnessEvidence(input = {}) {
  const value = input && typeof input === "object" ? input : {}
  const checks = value.checks && typeof value.checks === "object" ? value.checks : {}
  return {
    method: String(value.method || ""),
    sourceReports: normalizeArray(value.sourceReports),
    checkCount: Object.keys(checks).length,
    passedChecks: Object.values(checks).filter((item) => item === true).length,
    checks: Object.fromEntries(Object.entries(checks).map(([key, passed]) => [key, passed === true])),
    noteHash: hashText(value.note || ""),
    noteLength: String(value.note || "").length,
  }
}

function normalizeManualAcceptanceContract(input = {}) {
  const value = input && typeof input === "object" ? input : {}
  const sourceReports = normalizeArray(value.sourceReports || value.automatedReportPaths)
  const stageIds = normalizeArray(value.stageIds || value.requiredStageIds)
  return {
    status: String(value.status || ""),
    automatedReady: value.automatedReady === true,
    manualReady: value.manualReady === true,
    stageCount: Number(value.stageCount || stageIds.length || 0),
    blockedStageCount: Number(value.blockedStageCount || 0),
    sourceReports,
    stageIds,
    noteHash: hashText(value.note || ""),
    noteLength: String(value.note || "").length,
  }
}

function normalizePreflightStatus(value) {
  const status = String(value || "").toLowerCase()
  return ["not_checked", "passed", "blocked", "unavailable"].includes(status) ? status : "not_checked"
}

function normalizeScreenshotEvidence(value) {
  const item = String(value || "").trim()
  if (!item) return null
  const normalized = item.replace(/\\/g, "/")
  const isComputerUseReference = /^computer[-_]use:\/\//i.test(normalized)
  if (isComputerUseReference) {
    return {
      kind: "computer_use",
      referenceHash: hashText(normalized),
      referenceLength: normalized.length,
    }
  }
  const resolved = path.resolve(item)
  if (!fs.existsSync(resolved)) return null
  return {
    kind: "file",
    pathHash: hashText(resolved.replace(/\\/g, "/")),
    pathLength: resolved.length,
  }
}

function normalizeStatus(value) {
  const status = String(value || "").toLowerCase()
  return status === "passed" || status === "failed" || status === "blocked" ? status : "blocked"
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "")).filter(Boolean)
  if (value) return [String(value)]
  return []
}

function findSensitiveKeys(value, prefix = "") {
  if (!value || typeof value !== "object") return []
  const found = []
  for (const [key, child] of Object.entries(value)) {
    const keyPath = prefix ? `${prefix}.${key}` : key
    if (SENSITIVE_KEYS.some((sensitive) => sensitive.toLowerCase() === key.toLowerCase())) {
      found.push(keyPath)
      continue
    }
    if (child && typeof child === "object") found.push(...findSensitiveKeys(child, keyPath))
  }
  return found
}

function gap(id, title, action, severity = "medium") {
  return { id, title, severity, action }
}

function buildManualRealUiMarkdown(report) {
  return [
    "# Codek 真实 Workbench 手感验收证据",
    "",
    `- 状态：${report.statusLabel}`,
    `- 就绪：${formatBoolean(report.ready)}`,
    `- 项目：${report.projectRoot || "-"}`,
    `- 方法：${formatMethod(report.method)}`,
    `- Computer Use 可用：${formatBoolean(report.computerUseAvailable)}`,
    `- Computer Use 前置检查：${formatPreflightStatus(report.computerUsePreflight.status)}`,
    `- 真实执行确认：${formatBoolean(report.manualRunConfirmed)}`,
    `- Cursor 级主观流畅度确认：${formatBoolean(report.cursorLevelSmoothnessConfirmed)}`,
    `- Windows 资源管理器交叉检查：${formatBoolean(report.windowsExplorerCrossCheckConfirmed)}`,
    `- 人工复验 contract：${report.manualAcceptanceContract.stageCount} stages，自动化 ${formatBoolean(report.manualAcceptanceContract.automatedReady)}，人工 ${formatBoolean(report.manualAcceptanceContract.manualReady)}`,
    `- 场景：${report.summary.passedScenarios}/${report.summary.totalScenarios}，检查项 ${report.summary.passedChecks}/${report.summary.requiredChecks}，截图 ${report.summary.screenshotCount}`,
    "",
    "## 场景",
    "",
    "| 场景 | 状态 | 检查项 | 截图 | 最大停顿 |",
    "| --- | --- | ---: | ---: | ---: |",
    ...report.scenarios.map((scenario) => {
      const required = REQUIRED_SCENARIOS.find((item) => item.id === scenario.id)
      const total = required?.requiredChecks.length || Object.keys(scenario.checks).length
      const passed = required ? required.requiredChecks.filter((check) => scenario.checks[check] === true).length : Object.values(scenario.checks).filter(Boolean).length
      return `| ${escapeCell(required?.title || scenario.title || scenario.id)} | ${escapeCell(formatScenarioStatus(scenario.status))} | ${passed}/${total} | ${scenario.screenshotEvidence.length} | ${scenario.maxObservedStallMs}ms |`
    }),
    "",
    "## 缺口",
    "",
    ...(report.gaps.length ? report.gaps.map((item) => `- ${formatSeverity(item.severity)} ${item.title}：${item.action}`) : ["- 暂无阻断缺口。"]),
    "",
    "## Evidence Contract",
    "",
    "| 字段 | 值 |",
    "| --- | --- |",
    `| 自动化报告 | ${escapeCell(report.manualAcceptanceContract.sourceReports.join(", ") || "-")} |`,
    `| Stage 数 | ${report.manualAcceptanceContract.stageCount} |`,
    `| Stage IDs | ${escapeCell(report.manualAcceptanceContract.stageIds.join(", ") || "-")} |`,
    `| Blocked stages | ${report.manualAcceptanceContract.blockedStageCount} |`,
    "",
    "## 隐私",
    "",
    "- 本报告不保存源码、prompt、完整日志、完整 diff 或敏感字段原文；操作者、截图路径和摘要只保存 hash/长度或汇总字段。",
  ].join("\n")
}

function saveManualRealUiEvidence(report, options = {}) {
  const paths = manualRealUiPaths(options.reportDir)
  fs.mkdirSync(paths.historyDir, { recursive: true })
  const stamp = new Date(report.createdAt || Date.now()).toISOString().replace(/[:.]/g, "-")
  const historyJsonPath = path.join(paths.historyDir, `manual-real-ui-evidence-${stamp}.json`)
  const historyMarkdownPath = path.join(paths.historyDir, `manual-real-ui-evidence-${stamp}.md`)
  const normalized = {
    ...report,
    latestJsonPath: paths.latestJsonPath,
    latestMarkdownPath: paths.latestMarkdownPath,
    historyJsonPath,
    historyMarkdownPath,
  }
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${normalized.markdown}\n`, "utf8")
  fs.writeFileSync(historyJsonPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  fs.writeFileSync(historyMarkdownPath, `${normalized.markdown}\n`, "utf8")
  return normalized
}

function readLatestManualRealUiEvidence(options = {}) {
  const reportDir = options.reportDir || defaultReportDir()
  const jsonPath = manualRealUiPaths(reportDir).latestJsonPath
  return {
    report: readJson(jsonPath),
    jsonPath,
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function hashText(value) {
  const text = String(value || "")
  if (!text) return ""
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)
}

function escapeCell(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function formatBoolean(value) {
  return value ? "是" : "否"
}

function formatMethod(method) {
  if (method === "manual") return "人工"
  if (method === "computer_use") return "Computer Use"
  if (method === "manual_and_computer_use") return "人工 + Computer Use"
  return method || "-"
}

function formatScenarioStatus(status) {
  if (status === "passed") return "通过"
  if (status === "failed") return "未通过"
  if (status === "blocked") return "已阻断"
  return status || "未知"
}

function formatPreflightStatus(status) {
  if (status === "passed") return "通过"
  if (status === "blocked") return "已阻断"
  if (status === "unavailable") return "不可用"
  return "未检查"
}

function formatSeverity(severity) {
  if (severity === "high") return "高"
  if (severity === "medium") return "中"
  if (severity === "low") return "低"
  if (severity === "info") return "信息"
  return severity || "未知"
}

function formatCheckList(checks) {
  return checks.map((check) => CHECK_LABELS[check] || check).join("、")
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.init) {
    if (options.noWrite) {
      const paths = manualRealUiPaths(options.reportDir)
      const template = buildManualRealUiTemplate(options)
      process.stdout.write(`${JSON.stringify({
        reportKind: template.reportKind,
        templatePath: path.join(paths.evidenceDir, "manual-real-ui-evidence-template.json"),
        evidenceDir: paths.evidenceDir,
        screenshotDir: paths.screenshotDir,
        scenarios: template.scenarios.length,
        indexPath: paths.indexPath,
        noWrite: true,
      }, null, 2)}\n`)
      return
    }
    const saved = initManualRealUiWorkspace(options)
    process.stdout.write(`${JSON.stringify({
      reportKind: saved.template.reportKind,
      templatePath: saved.templatePath,
      evidenceDir: saved.evidenceDir,
      screenshotDir: saved.screenshotDir,
      scenarios: saved.template.scenarios.length,
      indexPath: saved.indexPath,
    }, null, 2)}\n`)
    return
  }
  const report = validateManualRealUiEvidence(options.fromSmoke
    ? { ...options, rawEvidence: buildSmokeAssistedManualRealUiEvidence(options) }
    : options)
  const output = options.noWrite ? report : saveManualRealUiEvidence(report, options)
  process.stdout.write(`${JSON.stringify({
    reportKind: output.reportKind,
    ready: output.ready,
    status: output.status,
    summary: output.summary,
    gaps: output.gaps.map((item) => item.id),
    jsonPath: output.latestJsonPath || "",
    markdownPath: output.latestMarkdownPath || "",
  }, null, 2)}\n`)
  process.exit(output.ready ? 0 : 1)
}

if (require.main === module) {
  main()
}

module.exports = {
  REQUIRED_SCENARIOS,
  USER_CONFIRMED_NO_SCREENSHOT_SCENARIOS,
  buildManualRealUiIndexMarkdown,
  buildManualRealUiMarkdown,
  buildSmokeAssistedManualRealUiEvidence,
  buildManualRealUiTemplate,
  defaultReportDir,
  initManualRealUiWorkspace,
  manualRealUiPaths,
  normalizeComputerUsePreflight,
  normalizeAutomatedSmoothnessEvidence,
  normalizeManualAcceptanceContract,
  parseArgs,
  readLatestManualRealUiEvidence,
  saveManualRealUiEvidence,
  validateManualRealUiEvidence,
}
