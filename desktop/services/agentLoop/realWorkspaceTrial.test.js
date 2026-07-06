const test = require("node:test")
const assert = require("node:assert/strict")
const os = require("node:os")
const path = require("node:path")

const {
  buildRealWorkspaceTrialReport,
  buildRealWorkspaceTrialRequest,
  normalizeDemoTaskReport,
  normalizeRealWorkspaceTrialConfig,
} = require("./realWorkspaceTrial")

test("normalizeRealWorkspaceTrialConfig keeps real workspace trials proposal-only by default", () => {
  const projectRoot = path.join(os.tmpdir(), "codek-real-workspace")
  const config = normalizeRealWorkspaceTrialConfig({
    allowedPaths: ["src", "./package.json", "../escape"],
    qualityGateCommands: ["npm run typecheck", "npm install", "node --check src/app.js"],
    maxAssignments: 99,
    maxDurationMs: 60,
    allowNetwork: true,
    allowInstall: true,
  }, { projectRoot })

  assert.equal(config.projectRoot, projectRoot)
  assert.equal(config.writeMode, "proposed_patch_only")
  assert.equal(config.allowMainWorkspaceWrites, false)
  assert.deepEqual(config.allowedPaths, ["src", "package.json"])
  assert.deepEqual(config.qualityGateCommands, ["npm run typecheck", "node --check src/app.js"])
  assert.deepEqual(config.blockedQualityGateCommands, ["npm install"])
  assert.equal(config.maxAssignments, 16)
  assert.equal(config.maxDurationMs, 30_000)
  assert.equal(config.allowNetwork, false)
  assert.equal(config.allowInstall, false)
})

test("buildRealWorkspaceTrialRequest converts settings into an orchestrator-safe request", () => {
  const projectRoot = path.join(os.tmpdir(), "codek-real-workspace-request")
  const request = buildRealWorkspaceTrialRequest({
    projectRoot,
    userInput: "重构 src/app.js 和 src/store.js",
    files: ["src/app.js", "src/store.js"],
    contextEvidence: {
      mentions: [{ type: "file", id: "src/app.js", label: "src/app.js" }],
      budget: { totalSources: 1 },
    },
    settings: {
      "codek.agent.realWorkspaceTrial.allowedPaths": ["src"],
      "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm run typecheck"],
      "codek.agent.realWorkspaceTrial.maxAssignments": 4,
    },
  })

  assert.equal(request.visibleMode, "agent")
  assert.equal(request.agentStrategy, null)
  assert.equal(request.policyProfile, "real-workspace-trial")
  assert.deepEqual(request.files, ["src/app.js", "src/store.js"])
  assert.equal(request.contextEvidence.mentions[0].id, "src/app.js")
  assert.deepEqual(request.qualityGateCommands, ["npm run typecheck"])
  assert.equal(request.realWorkspaceTrial.maxAssignments, 4)
  assert.equal(request.realWorkspaceTrial.allowMainWorkspaceWrites, false)
  assert.equal(request.workspaceIsolation, "auto")
})

test("buildRealWorkspaceTrialRequest can carry an explicit agent strategy override", () => {
  const projectRoot = path.join(os.tmpdir(), "codek-real-workspace-strategy")
  const request = buildRealWorkspaceTrialRequest({
    projectRoot,
    userInput: "重构 src/app.js、src/store.js 并运行 typecheck",
    files: ["src/app.js", "src/store.js"],
    agentStrategy: "multi-agent",
    settings: {
      "codek.agent.realWorkspaceTrial.allowedPaths": ["src"],
      "codek.agent.realWorkspaceTrial.qualityGateCommands": ["npm run typecheck"],
    },
  })

  assert.equal(request.agentStrategy, "multi-agent")
  assert.equal(request.visibleMode, "agent")
  assert.equal(request.policyProfile, "real-workspace-trial")
})

test("buildRealWorkspaceTrialReport exposes proposal, rollback, permission, and recovery state", () => {
  const run = {
    id: "run_real_trial",
    projectRoot: path.join(os.tmpdir(), "codek-real-trial-report"),
    status: "waiting_user",
    visibleMode: "agent",
    executionStrategy: "multi-agent",
    strategyReason: "多文件真实工作区试运行",
    strategySignals: { fileCount: 2, risk: "medium" },
    userInput: "重构真实项目",
    qualityGateCommands: ["npm run typecheck"],
    realWorkspaceTrial: normalizeRealWorkspaceTrialConfig({
      allowedPaths: ["src"],
      qualityGateCommands: ["npm run typecheck"],
    }),
    permissionRequest: {
      id: "permission_1",
      status: "waiting_user",
      writePaths: ["src"],
      commandAllowlist: ["npm run typecheck"],
      network: false,
      install: false,
      externalTool: false,
      destructive: false,
    },
    integrationDecision: {
      id: "decision_1",
      status: "pending",
      proposedPatch: {
        filesChanged: ["src/app.js", "src/store.js"],
      },
      applySnapshot: null,
    },
  }

  const report = buildRealWorkspaceTrialReport(run, {
    recoveryActions: [{ id: "recovery_1", action: "retry", status: "suggested" }],
  })

  assert.equal(report.runId, "run_real_trial")
  assert.equal(report.workspaceRoot, run.projectRoot)
  assert.equal(report.writeMode, "proposed_patch_only")
  assert.equal(report.mainWorkspaceUntouchedBeforeAccept, true)
  assert.equal(report.rollbackAvailable, false)
  assert.equal(report.decisionId, "decision_1")
  assert.deepEqual(report.filesChanged, ["src/app.js", "src/store.js"])
  assert.equal(report.permissionRequests.length, 1)
  assert.equal(report.recoveryActions.length, 1)
})

test("normalizeDemoTaskReport summarizes Day 11-12 task, role, cost, and review evidence", () => {
  const report = normalizeDemoTaskReport({
    tasks: [
      { id: "T01", title: "proposal-only 单任务闭环", status: "passed", roleProfile: "implementer", benefit: "减少上下文切换", noise: "无" },
      { id: "T02", title: "状态机证据", status: "passed", roleProfile: "reviewer" },
      { id: "T03", title: "质量门", status: "passed", roleProfile: "verifier" },
      { id: "T04", title: "Accept/Rollback", status: "passed", roleProfile: "reviewer" },
      { id: "T05", title: "worktree 合入策略", status: "passed", roleProfile: "integrator" },
      { id: "T06", title: "成本报告", status: "passed", roleProfile: "verifier" },
      { id: "T07", title: "失败复盘", status: "passed", roleProfile: "reviewer" },
      { id: "T08", title: "角色试用", status: "passed", roleProfile: "implementer" },
    ],
    roleProfiles: [
      { id: "implementer", label: "实现", assignmentIds: ["a1"], benefit: "更快定位改动面", noise: "偶发过度拆分", recommendation: "recommended" },
    ],
    agentRoleTrials: [
      { id: "trial_1", profileId: "implementer", status: "passed", assignmentId: "a1", baselineMinutes: 30, trialMinutes: 20, benefit: "节省复核时间", noise: "需人工确认" },
    ],
    roleBenefitSummary: "角色分工减少人工复核时间",
    roleNoiseSummary: "噪音集中在重复建议",
    qualityGate: { status: "passed", summary: "focused tests passed" },
    costReview: { available: true, estimatedCostUsd: 0.12, pricedRequests: 3, unpricedRequests: 0 },
    manualReview: { minutes: 12 },
    failureReview: { summary: "无 P0，保留回滚建议" },
    rollbackRecommendation: { action: "keep_snapshot", reason: "等待人工验收" },
    nextHumanAcceptance: ["打开 release evidence", "执行三人试用反馈"],
  })

  assert.equal(report.available, true)
  assert.equal(report.ready, true)
  assert.deepEqual(report.coveredTasks, ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08"])
  assert.deepEqual(report.missingTasks, [])
  assert.equal(report.roleProfiles[0].id, "implementer")
  assert.equal(report.roleTrials[0].trialMinutes, 20)
  assert.equal(report.costReview.manualReviewMinutes, 12)
})
