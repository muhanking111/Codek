const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const {
  buildRunReport,
  buildTrialTaskReport,
  listRealWorkspaceTrialReports,
  listTrialTaskReports,
  readLatestRealWorkspaceTrialReport,
  readLatestTrialTaskReport,
  saveRunReport,
} = require("./runReport")

test("buildRunReport creates a Chinese user-facing task report", () => {
  const run = {
    id: "run_report",
    projectRoot: path.join(os.tmpdir(), "codek-report"),
    status: "completed",
    visibleMode: "agent",
    executionStrategy: "multi-agent",
    strategyReason: "多文件任务，自动选择 multi-agent",
    strategySignals: { fileCount: 3 },
    userInput: "优化设置页面",
    qualityGateCommands: ["npm run typecheck"],
    createdAt: 1,
    updatedAt: 2,
    assignments: [
      { id: "a1", phaseId: "phase_1", role: "implementer", status: "completed", lockedFiles: ["src/app.js"], workspace: { isolation: "snapshot" } },
    ],
    integrationDecision: {
      status: "accepted",
      proposedPatch: { summary: "更新设置页面", filesChanged: ["src/app.js"] },
      applyResult: { status: "applied", filesChanged: ["src/app.js"] },
      qualityGate: { status: "passed", summary: "质量门通过" },
    },
    permissionRequest: {
      id: "permission_1",
      status: "approved",
      risk: "medium",
      readPaths: ["src"],
      writePaths: ["src"],
      commandAllowlist: ["npm run typecheck"],
      network: false,
      install: false,
      externalTool: false,
      destructive: false,
      reason: "允许 src 写入",
    },
    recoveryRecommendation: {
      action: "retry",
      reason: "checkpoint retry",
      createdAt: 2,
    },
    decisionLog: [
      { type: "router", status: "selected", selectedOption: "multi-agent", reason: "多文件", createdAt: 1 },
      { type: "user_decision", status: "accepted", selectedOption: "accepted", reason: "确认应用", createdAt: 2 },
    ],
  }

  const report = buildRunReport(run, {
    artifacts: [{ id: "artifact_1", type: "patch", content: "diff", metadata: {} }],
    recoveryActions: [{ id: "recovery_1", action: "retry", status: "completed", nextStatus: "running", reason: "重试" }],
  })

  assert.equal(report.userGoal, "优化设置页面")
  assert.equal(report.router.executionStrategy, "multi-agent")
  assert.equal(report.projectKind, "smoke-temp")
  assert.equal(report.writeMode, "applied")
  assert.equal(report.permissions.length, 1)
  assert.equal(report.commandAuthorization.allowed, 1)
  assert.equal(report.recoveryRecommendation.action, "retry")
  assert.match(report.markdown, /# Codek 自主 Agent 任务报告/)
  assert.match(report.markdown, /## 权限请求与审批/)
  assert.match(report.markdown, /## 命令授权/)
  assert.match(report.markdown, /checkpoint retry/)
  assert.match(report.markdown, /## 决策审计/)
})

test("buildRunReport includes real workspace trial safety details", () => {
  const report = buildRunReport({
    id: "run_real_workspace_trial",
    projectRoot: path.join(os.tmpdir(), "codek-report-real-trial"),
    status: "waiting_user",
    visibleMode: "agent",
    executionStrategy: "multi-agent",
    strategyReason: "real workspace proposal",
    strategySignals: { fileCount: 2, risk: "medium" },
    userInput: "真实项目试运行",
    qualityGateCommands: ["npm run typecheck"],
    createdAt: 1,
    updatedAt: 2,
    realWorkspaceTrial: {
      allowedPaths: ["src"],
      qualityGateCommands: ["npm run typecheck"],
    },
    assignments: [],
    integrationDecision: {
      id: "decision_real_trial",
      status: "pending",
      proposedPatch: { summary: "proposal", filesChanged: ["src/app.js"] },
    },
    permissionRequest: {
      id: "permission_real_trial",
      status: "waiting_user",
      writePaths: ["src"],
      commandAllowlist: ["npm run typecheck"],
    },
    decisionLog: [],
  })

  assert.equal(report.realWorkspaceTrial.writeMode, "proposed_patch_only")
  assert.equal(report.realWorkspaceTrial.mainWorkspaceUntouchedBeforeAccept, true)
  assert.deepEqual(report.realWorkspaceTrial.allowedPaths, ["src"])
  assert.match(report.markdown, /## Real Workspace Trial/)
  assert.match(report.markdown, /proposal-only/)
})

test("buildRunReport includes a reproducible Day 11-12 demo task report", () => {
  const tasks = ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08"].map((id) => ({
    id,
    title: `${id} evidence`,
    status: "passed",
    roleProfile: id === "T08" ? "planner-reviewer" : "implementer",
    benefit: "可复现",
    noise: "低",
  }))
  const report = buildRunReport({
    id: "run_day_11_12_demo",
    projectRoot: path.join(os.tmpdir(), "codek-report-day-demo"),
    status: "waiting_user",
    visibleMode: "agent",
    executionStrategy: "multi-agent",
    userInput: "生成非玩具演示任务报告",
    createdAt: 1,
    updatedAt: 2,
    realWorkspaceTrial: {
      allowedPaths: ["desktop/services/agentLoop"],
      qualityGateCommands: ["node --test desktop/services/agentLoop/runReport.test.js"],
      demoTaskReport: {
        tasks,
        roleProfiles: [
          { id: "implementer", label: "实现 Agent", assignmentIds: ["a1"], benefit: "减少串行等待", noise: "偶发重复建议", recommendation: "recommended" },
          { id: "planner-reviewer", label: "规划复核 Agent", assignmentIds: ["a2"], benefit: "提前暴露验收缺口", noise: "需要人工裁剪", recommendation: "trial" },
        ],
        agentRoleTrials: [
          { id: "role_trial_t08", profileId: "planner-reviewer", status: "passed", assignmentId: "a2", baselineMinutes: 45, trialMinutes: 28, benefit: "人工复核时间下降", noise: "多 1 条低价值建议" },
        ],
        roleBenefitSummary: "角色试用让实现、复核和质量门证据分离",
        roleNoiseSummary: "主要噪音是重复风险提示",
        qualityGate: { status: "passed", summary: "focused report tests passed" },
        costReview: { available: true, estimatedCostUsd: 0.08, pricedRequests: 2, unpricedRequests: 0 },
        manualReview: { minutes: 15 },
        failureReview: { summary: "无阻断失败；保留 rollback 建议" },
        rollbackRecommendation: { action: "manual_accept_after_review", reason: "等待人工验收演示报告" },
        nextHumanAcceptance: ["打开 release evidence", "继续 Day 13-14 三人反馈闭环"],
      },
    },
    assignments: [],
    integrationDecision: {
      id: "decision_day_demo",
      status: "pending",
      proposedPatch: { summary: "demo report", filesChanged: ["desktop/services/agentLoop/runReport.js"] },
      qualityGate: { status: "passed", summary: "focused report tests passed" },
    },
    decisionLog: [],
  })

  assert.equal(report.realWorkspaceTrial.demoTaskReport.ready, true)
  assert.deepEqual(report.realWorkspaceTrial.demoTaskReport.missingTasks, [])
  assert.match(report.markdown, /## Day 11-12 非玩具演示任务报告/)
  assert.match(report.markdown, /T08/)
  assert.match(report.markdown, /planner-reviewer/)
  assert.match(report.markdown, /人工复核 15 分钟/)
  assert.match(report.markdown, /继续 Day 13-14 三人反馈闭环/)
})

test("buildRunReport includes T08 role profile trial evidence on existing assignments", () => {
  const report = buildRunReport({
    id: "run_role_trials",
    projectRoot: path.join(os.tmpdir(), "codek-role-trials"),
    status: "completed",
    visibleMode: "agent",
    executionStrategy: "multi-agent",
    userInput: "试用不同 Agent 角色 profile",
    createdAt: 1,
    updatedAt: 2,
    assignments: [
      {
        id: "assignment_reviewer",
        phaseId: "T08-review",
        role: "reviewer",
        status: "completed",
        lockedFiles: ["frontend/vite-project/src/workbench/agentEvidenceWorkbench.ts"],
        profileTrial: {
          profileId: "agency-code-reviewer",
          profileSource: "agency-agents-zh",
          selectionReason: "适合检查证据链字段是否变成第二状态源。",
          validationAdvice: ["node --test desktop/services/agentLoop/releaseEvidenceExport.test.js"],
          benefit: "能聚焦契约和回归风险。",
          noise: "会建议较宽泛的 review checklist。",
          runtimeFit: "recommend-runtime-integration",
          worthRuntimeIntegration: true,
        },
      },
      {
        id: "assignment_tester",
        phaseId: "T08-test",
        role: "tester",
        status: "completed",
        lockedFiles: ["desktop/services/agentLoop/runReport.js"],
        profileTrial: {
          profileId: "testing-reality-checker",
          profileSource: "agency-agents-zh",
          selectionReason: "适合把角色试用收益绑定到可运行验证命令。",
          validationAdvice: ["node --test desktop/services/agentLoop/runReport.test.js"],
          benefit: "能暴露缺少验证建议的试用记录。",
          noise: "对 UI 体验判断帮助有限。",
          runtimeFit: "recommend-runtime-integration",
          worthRuntimeIntegration: true,
        },
      },
    ],
    permissionRequest: {
      id: "permission_role_trials",
      status: "approved",
      readPaths: ["desktop/services/agentLoop"],
      writePaths: ["desktop/services/agentLoop"],
      commandAllowlist: ["node --test desktop/services/agentLoop/runReport.test.js"],
      network: false,
      install: false,
      externalTool: false,
      destructive: false,
    },
    agentRoleTrialDecision: {
      requiredTrialCount: 2,
      runtimeIntegrationRecommended: true,
      recommendation: "recommend-runtime-integration",
      reason: "两个角色都能沉淀验证建议，且可挂到现有 assignment 证据链。",
    },
    integrationDecision: {
      status: "accepted",
      proposedPatch: { summary: "", filesChanged: [] },
    },
    decisionLog: [],
  })

  assert.equal(report.agentRoleTrials.ready, true)
  assert.equal(report.agentRoleTrials.trialCount, 2)
  assert.equal(report.agentRoleTrials.runtimeContract.noSecondStateSource, true)
  assert.equal(report.agentRoleTrials.runtimeIntegrationRecommended, true)
  assert.equal(report.agentRoleTrials.trials[0].permissionScope.writePaths[0], "frontend/vite-project/src/workbench/agentEvidenceWorkbench.ts")
  assert.match(report.markdown, /## Agent 角色 Profile 试用/)
  assert.match(report.markdown, /agency-code-reviewer/)
  assert.match(report.markdown, /testing-reality-checker/)
  assert.match(report.markdown, /复用现有 orchestrator run \/ assignment \/ event \/ artifact \/ evidence 链路/)
})

test("buildRunReport exposes worktree merge strategy evidence for main-thread review", () => {
  const report = buildRunReport({
    id: "run_worktree_merge_strategy",
    projectRoot: path.join(os.tmpdir(), "codek-worktree-merge-strategy"),
    status: "waiting_user",
    visibleMode: "agent",
    executionStrategy: "multi-agent",
    userInput: "2-5 文件小重构",
    createdAt: 1,
    updatedAt: 2,
    assignments: [
      { id: "agent_impl", phaseId: "phase_impl", role: "implementer", status: "completed", lockedFiles: ["src/shared.js"], workspace: { isolation: "git-worktree" } },
      { id: "agent_tests", phaseId: "phase_tests", role: "tester", status: "completed", lockedFiles: ["src/shared.test.js"], workspace: { isolation: "git-worktree" } },
    ],
    integrationDecision: {
      status: "pending",
      proposedPatch: {
        summary: "候选变更涉及 2 个文件",
        filesChanged: ["src/shared.js", "src/shared.test.js"],
      },
      worktreeMergeStrategy: {
        status: "blocked",
        mode: "proposal-only",
        stateSource: "integrationDecision",
        preservesSingleStateSource: true,
        conflictSummary: {
          status: "conflicted",
          total: 1,
          files: ["src/shared.js"],
        },
        validationMatrix: {
          status: "failed",
          summary: { total: 2, passed: 1, failed: 1, notRun: 0 },
          commands: [
            { command: "npm run typecheck", status: "passed", exitCode: 0 },
            { command: "npm test -- src/shared.test.js", status: "failed", exitCode: 1 },
          ],
        },
        evidence: {
          preMerge: { gitHead: "main", stagedFiles: [], dirtyFiles: [], reportRefs: ["report:pre"] },
          postMerge: { status: "not_run", reportRefs: [] },
        },
        failureClassification: [
          { id: "workspace_conflict", category: "conflict", severity: "high", summary: "同文件冲突", requiresHumanDecision: true },
          { id: "quality_gate_failed", category: "validation", severity: "high", summary: "测试失败", requiresHumanDecision: true },
        ],
        mainThreadDecision: {
          required: true,
          recommendedAction: "rework",
          allowedActions: ["accept", "rework", "reject"],
          requiredFields: ["conflictSummary", "validationMatrix", "preMergeEvidence", "postMergeEvidence", "failureClassification", "proposedPatch"],
          decisionPrompt: "存在冲突或质量门失败，主线程应要求对应 worktree 返工或人工拆解合入。",
        },
      },
    },
    decisionLog: [],
  })

  assert.equal(report.worktreeMergeStrategy.status, "blocked")
  assert.equal(report.worktreeMergeStrategy.conflictSummary.total, 1)
  assert.equal(report.worktreeMergeStrategy.validationMatrix.summary.failed, 1)
  assert.equal(report.worktreeMergeStrategy.mainThreadDecision.recommendedAction, "rework")
  assert.match(report.markdown, /## Worktree 合入策略/)
  assert.match(report.markdown, /proposal-only/)
  assert.match(report.markdown, /workspace_conflict/)
  assert.match(report.markdown, /npm test -- src\/shared.test.js/)
})

test("buildRunReport surfaces single-agent proposal-only delivery evidence", () => {
  const report = buildRunReport({
    id: "run_single_agent_proposal_report",
    projectRoot: path.join(os.tmpdir(), "codek-report-single-agent-proposal"),
    status: "waiting_user",
    visibleMode: "agent",
    executionStrategy: "single-agent",
    strategyReason: "单文件任务",
    userInput: "修复 src/app.js",
    createdAt: 1,
    updatedAt: 2,
    plan: {
      title: "单 Agent 修复计划",
      summary: "先改代码，再给出验证建议",
      phases: [{ id: "phase_1", name: "实现", tasks: [{ description: "修改 src/app.js" }] }],
    },
    assignments: [
      { id: "a1", phaseId: "phase_1", role: "implementer", status: "completed", lockedFiles: ["src/app.js"], workspace: { isolation: "overlay" } },
    ],
    integrationDecision: {
      id: "decision_single_agent",
      status: "pending",
      proposedPatch: {
        summary: "候选变更涉及 1 个文件",
        filesChanged: ["src/app.js"],
        patches: [{ artifactId: "artifact_patch", assignmentId: "a1", filesChanged: ["src/app.js"], content: "diff --git a/src/app.js b/src/app.js\n" }],
      },
      proposalOnlyDelivery: {
        mode: "proposal-only",
        mainWorkspaceWrite: false,
        requiresAcceptBeforeApply: true,
        executionStrategy: "single-agent",
        plan: { available: true, phaseCount: 1, taskCount: 1, title: "单 Agent 修复计划", summary: "先改代码，再给出验证建议" },
        proposedDiff: { available: true, fileCount: 1, patchCount: 1, filesChanged: ["src/app.js"] },
        artifacts: { total: 1, proposed: [{ id: "artifact_patch", type: "patch", assignmentId: "a1", filesChanged: ["src/app.js"] }] },
        verification: { status: "not_run", summary: "Accept 前不运行写入后质量门", commandCount: 0, failedCommandCount: 0 },
        decisionEvidence: {
          availableActions: ["accepted", "rework_requested", "rejected", "rollback"],
          accept: { status: "requires_explicit_accept", writesMainWorkspace: true },
          rework: { status: "available", writesMainWorkspace: false },
          reject: { status: "available", writesMainWorkspace: false },
          rollback: { status: "available_after_accept", writesMainWorkspace: true },
        },
      },
    },
    decisionLog: [],
  }, {
    artifacts: [{ id: "artifact_patch", type: "patch", assignmentId: "a1", content: "diff --git a/src/app.js b/src/app.js\n", metadata: { filesChanged: ["src/app.js"] } }],
  })

  assert.equal(report.proposalOnlyDelivery.mode, "proposal-only")
  assert.equal(report.proposalOnlyDelivery.mainWorkspaceWrite, false)
  assert.equal(report.proposalOnlyDelivery.plan.phaseCount, 1)
  assert.equal(report.proposalOnlyDelivery.proposedDiff.patchCount, 1)
  assert.equal(report.proposalOnlyDelivery.verification.status, "not_run")
  assert.equal(report.proposalOnlyDelivery.decisionEvidence.accept.status, "requires_explicit_accept")
  assert.match(report.markdown, /## Proposal-only 交付包/)
  assert.match(report.markdown, /Accept 前写入主工作区: NO/)
  assert.match(report.markdown, /accepted, rework_requested, rejected, rollback/)
})

test("buildRunReport includes context evidence metadata without leaking prompt bodies", () => {
  const report = buildRunReport({
    id: "run_context_evidence",
    projectRoot: path.join(os.tmpdir(), "codek-report-context"),
    status: "completed",
    visibleMode: "agent",
    executionStrategy: "single-agent",
    userInput: "使用附件修复问题",
    createdAt: 1,
    updatedAt: 2,
    contextEvidence: {
      prompt: "DO_NOT_STORE_PROMPT_BODY",
      mentions: [{ type: "file", id: "src/App.vue", label: "App.vue", detail: "src/App.vue" }],
      attachments: [{
        name: "secret.txt",
        size: 12,
        type: "text/plain",
        kind: "text",
        status: "ready",
        content: "DO_NOT_STORE_ATTACHMENT_BODY",
        dataUrl: "data:image/png;base64,DO_NOT_STORE_IMAGE",
        contentLength: 28,
      }],
      rules: [{ path: ".codek/rules.md", title: "Rules", content: "DO_NOT_STORE_RULE_BODY", contentLength: 22, priority: 100 }],
      budget: { totalSources: 3, estimatedChars: 80, contextBlockChars: 30, attachmentTextChars: 28, ruleChars: 22 },
    },
    assignments: [],
    integrationDecision: {
      status: "accepted",
      proposedPatch: { summary: "", filesChanged: [] },
    },
    decisionLog: [],
  })

  assert.equal(report.contextEvidence.attachments[0].name, "secret.txt")
  assert.equal(report.contextEvidence.attachments[0].contentLength, 28)
  assert.match(report.markdown, /## 上下文证据链/)
  assert.match(report.markdown, /secret.txt/)

  const serialized = JSON.stringify(report)
  assert.doesNotMatch(serialized, /DO_NOT_STORE_PROMPT_BODY/)
  assert.doesNotMatch(serialized, /DO_NOT_STORE_ATTACHMENT_BODY/)
  assert.doesNotMatch(serialized, /DO_NOT_STORE_IMAGE/)
  assert.doesNotMatch(serialized, /DO_NOT_STORE_RULE_BODY/)
})

test("saveRunReport writes markdown and json archive files", () => {
  const report = buildRunReport({
    id: "run_save_report",
    projectRoot: path.join(os.tmpdir(), "codek-report-save"),
    status: "completed",
    visibleMode: "agent",
    executionStrategy: "single-agent",
    userInput: "保存报告",
    createdAt: 1,
    updatedAt: 2,
    assignments: [],
    integrationDecision: {
      status: "accepted",
      proposedPatch: { summary: "", filesChanged: [] },
    },
    decisionLog: [],
  })
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-run-report-"))
  const saved = saveRunReport(report, { reportDir })

  assert.equal(fs.existsSync(saved.markdownPath), true)
  assert.equal(fs.existsSync(saved.jsonPath), true)
  assert.match(fs.readFileSync(saved.markdownPath, "utf8"), /保存报告/)
  assert.match(saved.markdownPath, /run_save_report-.*\.md$/)
})

test("saveRunReport writes real workspace trial latest and history artifacts", () => {
  const report = buildRunReport({
    id: "run_real_trial_archive",
    projectRoot: path.join(os.tmpdir(), "codek-real-trial-archive"),
    status: "waiting_user",
    visibleMode: "agent",
    executionStrategy: "multi-agent",
    userInput: "归档真实工作区试运行",
    qualityGateCommands: ["npm run typecheck"],
    createdAt: 10,
    updatedAt: 20,
    realWorkspaceTrial: {
      allowedPaths: ["src"],
      qualityGateCommands: ["npm run typecheck"],
    },
    assignments: [],
    integrationDecision: {
      id: "decision_real_trial_archive",
      status: "pending",
      proposedPatch: { summary: "proposal", filesChanged: ["src/app.js"] },
    },
    decisionLog: [],
  })
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-real-trial-report-"))
  const saved = saveRunReport(report, { reportDir })
  const latest = readLatestRealWorkspaceTrialReport({ reportDir })
  const history = listRealWorkspaceTrialReports({ reportDir })

  assert.equal(fs.existsSync(saved.realWorkspaceTrialMarkdownPath), true)
  assert.equal(fs.existsSync(saved.realWorkspaceTrialJsonPath), true)
  assert.equal(fs.existsSync(saved.realWorkspaceTrialHistoryMarkdownPath), true)
  assert.equal(fs.existsSync(saved.realWorkspaceTrialHistoryJsonPath), true)
  assert.equal(latest.report.runId, "run_real_trial_archive")
  assert.match(latest.markdown, /Real Workspace Trial/)
  assert.equal(history.length, 1)
  assert.equal(history[0].runId, "run_real_trial_archive")
  assert.deepEqual(history[0].filesChanged, ["src/app.js"])
})

test("buildTrialTaskReport creates MVP acceptance summary for a real task loop", () => {
  const runReport = buildRunReport({
    id: "run_trial_task_mvp",
    projectRoot: path.join(os.tmpdir(), "codek-trial-task"),
    status: "completed",
    visibleMode: "agent",
    executionStrategy: "multi-agent",
    strategyReason: "真实任务需要多 Agent 分工",
    strategySignals: { fileCount: 2 },
    userInput: "把试用任务闭环整理成报告",
    qualityGateCommands: ["node --check src/app.js"],
    budget: { token: 1234, cost: 0.012345, timeMs: 4567 },
    createdAt: 100,
    updatedAt: 200,
    realWorkspaceTrial: {
      allowedPaths: ["src"],
      qualityGateCommands: ["node --check src/app.js"],
    },
    assignments: [
      { id: "a1", phaseId: "phase_plan", role: "planner", status: "completed", lockedFiles: ["src/app.js"], workspace: { isolation: "snapshot" } },
      { id: "a2", phaseId: "phase_verify", role: "verifier", status: "completed", lockedFiles: ["src/app.test.js"], workspace: { isolation: "snapshot" } },
    ],
    integrationDecision: {
      id: "decision_trial_task",
      status: "accepted",
      proposedPatch: {
        summary: "新增报告导出",
        filesChanged: ["src/app.js", "src/app.test.js"],
      },
      applySnapshot: { id: "snapshot_1" },
      applyResult: { status: "applied", filesChanged: ["src/app.js"] },
      rollbackResult: { status: "restored", filesChanged: ["src/app.js"] },
      qualityGate: {
        status: "passed",
        summary: "1/1 commands passed",
        commandResults: [{ command: "node --check src/app.js", exitCode: 0, timedOut: false, durationMs: 42 }],
      },
    },
    decisionLog: [
      { type: "router", title: "路由决策", status: "selected", selectedOption: "multi-agent", reason: "多文件", createdAt: 100 },
      { type: "user_decision", title: "用户决策", status: "accepted", selectedOption: "accepted", reason: "人工确认可验收", createdAt: 200 },
    ],
  }, {
    recoveryActions: [{ id: "rec_1", action: "retry", status: "suggested", reason: "质量门失败时重跑聚焦测试" }],
  })

  const trialReport = buildTrialTaskReport(runReport, { humanAcceptance: { status: "pending", conclusion: "待人工打开报告复核" } })

  assert.equal(trialReport.reportKind, "trial-task-report")
  assert.equal(trialReport.ready, true)
  assert.equal(trialReport.task.goal, "把试用任务闭环整理成报告")
  assert.equal(trialReport.executionSteps.length, 5)
  assert.deepEqual(trialReport.diffSummary.filesChanged, ["src/app.js", "src/app.test.js"])
  assert.equal(trialReport.validation.commands[0].exitCode, 0)
  assert.equal(trialReport.cost.durationMs, 100)
  assert.equal(trialReport.cost.budgetTimeMs, 4567)
  assert.equal(trialReport.rollback.recommendation, "已执行 rollback；人工验收时复核回滚文件和 SCM 状态。")
  assert.equal(trialReport.humanAcceptance.status, "pending")
  assert.match(trialReport.markdown, /# Codek 试用任务验收报告/)
  assert.match(trialReport.markdown, /## Diff \/ 文件变更摘要/)
  assert.match(trialReport.markdown, /待人工打开报告复核/)

  const serialized = JSON.stringify(trialReport)
  assert.doesNotMatch(serialized, /diff --git/)
  assert.doesNotMatch(serialized, /command output/)
})

test("saveRunReport writes trial task latest and history artifacts", () => {
  const report = buildRunReport({
    id: "run_trial_task_archive",
    projectRoot: path.join(os.tmpdir(), "codek-trial-task-archive"),
    status: "waiting_user",
    visibleMode: "agent",
    executionStrategy: "single-agent",
    userInput: "保存试用任务报告",
    qualityGateCommands: ["node --check src/app.js"],
    createdAt: 10,
    updatedAt: 20,
    realWorkspaceTrial: {
      allowedPaths: ["src"],
      qualityGateCommands: ["node --check src/app.js"],
    },
    assignments: [],
    integrationDecision: {
      id: "decision_trial_task_archive",
      status: "pending",
      proposedPatch: { summary: "proposal", filesChanged: ["src/app.js"] },
    },
    decisionLog: [],
  })
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-trial-task-report-"))
  const saved = saveRunReport(report, { reportDir })
  const latest = readLatestTrialTaskReport({ reportDir })
  const history = listTrialTaskReports({ reportDir })

  assert.equal(fs.existsSync(saved.trialTaskReportMarkdownPath), true)
  assert.equal(fs.existsSync(saved.trialTaskReportJsonPath), true)
  assert.equal(fs.existsSync(saved.trialTaskReportHistoryMarkdownPath), true)
  assert.equal(fs.existsSync(saved.trialTaskReportHistoryJsonPath), true)
  assert.equal(latest.report.runId, "run_trial_task_archive")
  assert.match(latest.markdown, /试用任务验收报告/)
  assert.equal(history.length, 1)
  assert.equal(history[0].runId, "run_trial_task_archive")
  assert.deepEqual(history[0].filesChanged, ["src/app.js"])
})
