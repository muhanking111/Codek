import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentEvidenceWorkbenchSummary } from "../agent/orchestratorClient"
import { MenuId, MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import { InstantiationService } from "../vscode-adapter/platform/instantiation/common/instantiationService"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import { clearCommands, executeCommand, getCommand } from "./commandRegistry"
import {
  AGENT_EVIDENCE_COMMAND_IDS,
  AGENT_EVIDENCE_SURFACE_BRIDGE_AUDIT,
  AGENT_EVIDENCE_WORKBENCH_VIEW_IDS,
  AgentEvidenceWorkbenchSurfaceFacadeService,
  AgentEvidenceWorkbenchService,
  IAgentEvidenceNotificationService,
  IAgentEvidenceProgressService,
  IAgentEvidenceScmService,
  IAgentEvidenceTestingService,
  IAgentEvidenceTimelineService,
  IAgentEvidenceWorkbenchService,
  INotificationService,
  IProgressService,
  ISCMService,
  ITestService,
  ITimelineService,
  buildAgentEvidenceWorkbenchSurface,
  getAgentEvidenceWorkbenchContributionSummary,
  getAgentEvidenceWorkbenchSurface,
  globalAgentEvidenceNotificationService,
  globalAgentEvidenceProgressService,
  globalAgentEvidenceScmService,
  globalAgentEvidenceTestingService,
  globalAgentEvidenceTimelineService,
  globalAgentEvidenceWorkbenchService,
  registerAgentEvidenceWorkbenchContributions,
  setAgentEvidenceWorkbenchSummary,
} from "./agentEvidenceWorkbench"
import { clearViews, getViewContainers, getViews, registerDefaultWorkbenchViews } from "./viewRegistry"

function sampleSummary(overrides: Partial<AgentEvidenceWorkbenchSummary> = {}): AgentEvidenceWorkbenchSummary {
  const summary: AgentEvidenceWorkbenchSummary = {
    schemaVersion: 1,
    available: true,
    ready: false,
    status: "degraded",
    statusLabel: "6/9 evidence workbench 阶段就绪",
    stageStatusSchema: {
      stageIds: ["plan", "role-profile-trial", "execution", "tests", "failure-diagnostics", "real-ui", "workspace-diff", "approval", "rollback"],
      statuses: ["ready", "degraded", "blocked", "missing"],
    },
    stageCount: 9,
    readyStages: 6,
    availableStages: 9,
    timeline: [
      { stage: "plan", title: "计划与上下文", status: "ready", ready: true, available: true, summary: "上下文 4 个来源", evidenceRefs: ["readiness"], nextAction: "" },
      { stage: "role-profile-trial", title: "角色 profile 试用", status: "ready", ready: true, available: true, summary: "2/2 完整试用", evidenceRefs: ["agentRoleTrials"], nextAction: "" },
      { stage: "tests", title: "测试与质量门", status: "blocked", ready: false, available: true, summary: "1/2 任务运行 · 诊断 2", evidenceRefs: ["taskRuns"], nextAction: "重跑 focused tests" },
      { stage: "real-ui", title: "真实 UI 验收", status: "degraded", ready: false, available: true, summary: "manual 缺失", evidenceRefs: ["manualRealUiEvidence"], nextAction: "导入真实 UI 证据" },
      { stage: "workspace-diff", title: "工作区 diff", status: "ready", ready: true, available: true, summary: "2 文件", evidenceRefs: ["realWorkspaceTrial"], nextAction: "" },
      { stage: "approval", title: "审批与漂移阻断", status: "blocked", ready: false, available: true, summary: "命令阻断 1", evidenceRefs: ["sandboxSecurity"], nextAction: "处理审批" },
      { stage: "rollback", title: "回滚风险说明", status: "blocked", ready: false, available: true, summary: "回滚不可用", evidenceRefs: ["agentChangeSafety"], nextAction: "补齐 rollback 快照" },
    ],
    testing: {
      taskRuns: 2,
      passed: 1,
      failed: 1,
      blocked: 0,
      running: 0,
      skipped: 0,
      problemDiagnostics: 2,
      qualityGateStatus: "failed",
      qualityGateCommands: 3,
      qualityGateFailures: 1,
      latestTask: "Search replace save rejection regression",
    },
    failure: {
      blockingGaps: 1,
      highGaps: 1,
      mediumGaps: 0,
      taskRunIssues: 1,
      qualityGateFailures: 1,
      problemDiagnostics: 2,
      latestBlockingGap: { id: "manual_real_ui_evidence", title: "真实 UI evidence 缺失", status: "missing", severity: "high" },
    },
    scm: {
      fileCount: 3,
      files: ["src/app.ts", "src/app.ts", "src/search.ts"],
      mainWorkspaceProtected: true,
      rollbackAvailable: false,
      pendingBatchBlocked: true,
      pendingHunkBlocked: false,
      reviewDisplayBlocked: true,
    },
    approval: {
      permissionStatus: "pending",
      permissionRisk: "medium",
      permissionApproved: false,
      writePathCount: 2,
      commandAllowlistCount: 1,
      commandAuthorizationBlocked: 1,
      commandAuthorizationNeedsPermission: 1,
      agentReviewBlocked: true,
      operationLogVisible: true,
    },
    rollback: {
      rollbackAvailable: false,
      mainWorkspaceProtected: true,
      agentRollbackDriftBlocked: true,
      operationLogVisible: true,
    },
    report: {
      schemaVersion: 1,
      source: "releaseEvidence",
      timestamp: 990,
      workspace: {
        root: "D:/Workspace",
        protected: true,
        isolation: "agent-worktree",
      },
      correlationId: "agent-evidence:run_1",
      commands: [
        { command: "npm run typecheck", source: "qualityGate", status: "failed", exitCode: 1, artifactIds: ["artifact:typecheck"], outputProjectionIds: ["output:tasks"], problemProjectionIds: ["problems:typecheck"], taskRunIds: ["task:typecheck"] },
      ],
      runStateSchema: {
        states: ["planned", "assigned", "running", "review-ready", "verified", "blocked", "accepted", "rolled-back"],
        transitions: {
          planned: ["assigned", "blocked"],
          assigned: ["running", "blocked"],
          running: ["review-ready", "verified", "blocked"],
          "review-ready": ["verified", "accepted", "blocked", "rolled-back"],
          verified: ["accepted", "blocked", "rolled-back"],
          blocked: ["planned", "assigned", "running", "rolled-back"],
          accepted: ["rolled-back"],
          "rolled-back": [],
        },
      },
      runs: [
        {
          id: "run_1",
          state: "review-ready",
          stateLabel: "待审阅",
          plannedAt: 900,
          assignedAt: 910,
          startedAt: 920,
          updatedAt: 990,
          completedAt: null,
          plan: {
            summary: "修复 typecheck failure",
            goal: "让 Agent run evidence 可审阅",
            steps: [
              { id: "plan", title: "计划", status: "verified" },
              { id: "tests", title: "验证", status: "blocked" },
            ],
            contextRefs: ["readiness", "src/app.ts"],
          },
          phases: [
            { id: "plan", title: "计划与上下文", status: "ready", ready: true, evidenceRefs: ["readiness"], nextAction: "" },
            { id: "tests", title: "测试与质量门", status: "blocked", ready: false, evidenceRefs: ["taskRuns"], nextAction: "重跑 focused tests" },
          ],
          changedFiles: ["src/app.ts"],
          diffSummary: {
            filesChanged: 1,
            files: ["src/app.ts"],
            summary: "1 文件变更待审阅",
            source: "integrationDecision.proposedPatch",
          },
          validationCommands: [
            { command: "npm run typecheck", status: "failed", exitCode: 1, source: "qualityGate", timedOut: false },
          ],
          failureReasons: [
            { id: "quality_gate_failed", stage: "tests", severity: "error", detail: "typecheck failed" },
          ],
          rollbackRecommendation: {
            available: true,
            action: "review-and-rollback-if-rejected",
            detail: "可基于 snapshot 回滚。",
            driftBlocked: true,
          },
          costSummary: {
            available: false,
            totalRequests: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0,
            currency: "USD",
            estimated: true,
            placeholder: true,
          },
        },
      ],
      artifacts: [
        { id: "artifact:typecheck", kind: "log", label: "typecheck output", path: ".codek/reports/typecheck.log", source: "taskRuns" },
      ],
      failureCauses: [
        { id: "quality_gate_failed", severity: "error", title: "质量门失败", detail: "typecheck failed", source: "taskRuns", stage: "tests" },
        { id: "rollback_missing", severity: "warning", title: "回滚证据缺失", detail: "rollback snapshot missing", source: "realWorkspaceTrial", stage: "rollback" },
      ],
      nextActions: [
        { id: "rerun-focused-tests", label: "重跑 focused tests", surface: "testing", stage: "tests", priority: "high", commandId: "agent.evidence.reviewTests" },
        { id: "review-rollback", label: "复核回滚风险", surface: "scm", stage: "rollback", priority: "high", commandId: "agent.evidence.reviewRollback" },
      ],
      roleProfiles: {
        available: true,
        ready: true,
        status: "ready",
        statusLabel: "2/2 角色 profile 试用证据已就绪",
        requiredTrialCount: 2,
        trialCount: 2,
        completeTrials: 2,
        runtimeIntegrationRecommended: true,
        recommendation: "recommend-runtime-integration",
        decisionReason: "两个角色都能沉淀验证建议，且可挂到现有 assignment 证据链。",
        runtimeContract: {
          attachToExistingOrchestratorRun: true,
          attachToAssignment: true,
          attachToEventArtifactEvidence: true,
          noSecondStateSource: true,
        },
        trials: [
          {
            id: "assignment_reviewer",
            taskId: "T08-review",
            runId: "run_1",
            assignmentId: "assignment_reviewer",
            role: "reviewer",
            profileId: "agency-code-reviewer",
            profileSource: "agency-agents-zh",
            selectionReason: "适合检查证据链字段是否变成第二状态源。",
            permissionScope: {
              readPaths: ["desktop/services/agentLoop"],
              writePaths: ["frontend/vite-project/src/workbench/agentEvidenceWorkbench.ts"],
              allowedTools: [],
              commandAllowlist: ["node --test desktop/services/agentLoop/releaseEvidenceExport.test.js"],
              network: false,
              install: false,
              externalTool: false,
              destructive: false,
            },
            validationAdvice: ["node --test desktop/services/agentLoop/releaseEvidenceExport.test.js"],
            benefit: "能聚焦契约和回归风险。",
            noise: "会建议较宽泛的 review checklist。",
            runtimeFit: "recommend-runtime-integration",
            worthRuntimeIntegration: true,
            evidenceRefs: [],
          },
          {
            id: "assignment_tester",
            taskId: "T08-test",
            runId: "run_1",
            assignmentId: "assignment_tester",
            role: "tester",
            profileId: "testing-reality-checker",
            profileSource: "agency-agents-zh",
            selectionReason: "适合把角色试用收益绑定到可运行验证命令。",
            permissionScope: {
              readPaths: ["desktop/services/agentLoop"],
              writePaths: ["desktop/services/agentLoop/runReport.js"],
              allowedTools: [],
              commandAllowlist: ["node --test desktop/services/agentLoop/runReport.test.js"],
              network: false,
              install: false,
              externalTool: false,
              destructive: false,
            },
            validationAdvice: ["node --test desktop/services/agentLoop/runReport.test.js"],
            benefit: "能暴露缺少验证建议的试用记录。",
            noise: "对 UI 体验判断帮助有限。",
            runtimeFit: "recommend-runtime-integration",
            worthRuntimeIntegration: true,
            evidenceRefs: [],
          },
        ],
      },
      progress: [
        {
          id: "progress:tests",
          title: "测试与质量门",
          message: "重跑 focused tests",
          stage: "tests",
          status: "blocked",
          correlationId: "agent-evidence:run_1",
          total: 1,
          worked: 0,
          location: "notification",
          cancellable: false,
        },
      ],
      notifications: [
        {
          id: "notification:quality-gate",
          severity: "error",
          message: "质量门失败",
          source: "Agent Evidence",
          correlationId: "agent-evidence:run_1",
          lifecycle: { state: "active", sticky: true, updatedAt: 990, dismissible: true },
          actions: [{ id: "agent.evidence.reviewTests", label: "复核测试", surface: "testing" }],
        },
      ],
      phaseStatusSchema: {
        stageIds: ["plan", "automation", "failure-recovery"],
        statuses: [
          "active",
          "completed",
          "systemError",
          "blocked",
          "needs-validation",
          "validated-pass",
          "validated-fail",
          "superseded",
        ],
      },
      phaseLifecycle: [
        {
          id: "phase:automation",
          stage: "automation",
          phaseName: "Agent Scheduler / Automation",
          threadId: "019ef8c0-10b4-7471-b69d-4c65d958776f",
          status: "validated-pass",
          validation: {
            status: "validated-pass",
            result: "pass",
            command: "node --test desktop/services/goalScheduler/phaseLifecycle.test.js",
            detail: "focused lifecycle validation passed",
            evidenceRefs: ["goal-runtime-health"],
            checkedAt: 991,
          },
          failureRecovery: {
            status: "completed",
            action: "keep manual scheduler flow",
            detail: "no Codex app automation changed",
            retryable: false,
            recoveredAt: 992,
          },
          evidenceRefs: ["goal-runtime-health"],
          updatedAt: 993,
        },
        {
          id: "phase:failure-recovery",
          stage: "failure-recovery",
          phaseName: "Failure Recovery",
          threadId: "019ef8c0-10b4-7471-b69d-4c65d958776f",
          status: "systemError",
          validation: {
            status: "systemError",
            result: "",
            command: "",
            detail: "",
            evidenceRefs: [],
            checkedAt: null,
          },
          failureRecovery: {
            status: "blocked",
            action: "surface retry state",
            detail: "requires operator retry after scheduler worker exit",
            retryable: true,
            recoveredAt: null,
          },
          evidenceRefs: ["goal-runtime-health"],
          updatedAt: 994,
        },
      ],
      projections: {
        taskRuns: [
          {
            id: "task:typecheck",
            stage: "tests",
            name: "typecheck",
            status: "failed",
            command: "npm run typecheck",
            exitCode: 1,
            durationMs: 1200,
            outputProjectionIds: ["output:tasks"],
            problemProjectionIds: ["problems:typecheck"],
            artifactIds: ["artifact:typecheck"],
            rerunCommandId: "agent.evidence.reviewTests",
          },
        ],
        outputs: [
          {
            id: "output:tasks",
            stage: "tests",
            channelName: "Tasks",
            source: "outputLogTelemetryService",
            status: "failed",
            entryCount: 3,
            warnCount: 0,
            errorCount: 1,
            preview: "src/app.ts(1,1): error TS2304: Cannot find name password=REDACTION_TEST_PASSWORD",
            artifactIds: ["artifact:typecheck"],
            commandIds: ["npm run typecheck"],
          },
        ],
        problems: [
          {
            id: "problems:typecheck",
            stage: "tests",
            source: "problemsDiagnosticsService(globalMarkerService)",
            status: "failed",
            total: 2,
            errorCount: 2,
            warningCount: 0,
            files: ["src/app.ts"],
            sourceNames: ["tsc"],
            outputProjectionIds: ["output:tasks"],
            taskRunIds: ["task:typecheck"],
          },
        ],
        debug: [
          {
            id: "debug:node",
            stage: "failure-diagnostics",
            source: "debugState/debugRuntime",
            status: "stopped",
            sessionId: "debug-1",
            activeConfigName: "Node",
            breakpointCount: 1,
            consoleEntryCount: 2,
            outputProjectionIds: ["output:tasks"],
          },
        ],
        approvalBoundaries: [
          {
            id: "approval:quality-gate",
            stage: "approval",
            status: "needs_permission",
            risk: "medium",
            reason: "quality gate command needs permission",
            commandIds: ["npm run typecheck"],
            protected: true,
          },
        ],
        failureDiagnosis: [
          {
            id: "diagnosis:typecheck",
            stage: "tests",
            status: "open",
            title: "Typecheck failed",
            detail: "TS2304 from task output",
            failureCauseIds: ["quality_gate_failed"],
            nextActionIds: ["rerun-focused-tests"],
            taskRunIds: ["task:typecheck"],
            outputProjectionIds: ["output:tasks"],
            problemProjectionIds: ["problems:typecheck"],
            debugProjectionIds: ["debug:node"],
            approvalBoundaryIds: ["approval:quality-gate"],
            workspaceChangeRefs: ["src/app.ts"],
            rerunCommandIds: ["agent.evidence.reviewTests"],
          },
        ],
        exportSnapshot: {
          id: "snapshot:agent-evidence",
          path: ".codek/reports/agent-evidence-workbench-latest.json",
          markdownPath: ".codek/reports/agent-evidence-workbench-latest.md",
          redacted: true,
          includes: ["timeline", "tasks", "output", "problems", "debug", "approval", "failureDiagnosis"],
        },
      },
    },
    sourceEvidence: ["taskRuns", "manualRealUiEvidence", "agentChangeSafety"],
  }
  return { ...summary, ...overrides }
}

describe("Agent Evidence Workbench surface", () => {
  beforeEach(() => {
    clearCommands()
    clearViews()
    MenuRegistry.clear()
  })

  it("derives SCM, Testing, Timeline, Progress and Notification surfaces from release evidence", () => {
    const surface = buildAgentEvidenceWorkbenchSurface(sampleSummary(), { createdAt: 1000 })

    expect(surface.schemaVersion).toBe(1)
    expect(surface.report).toEqual(expect.objectContaining({
      source: "releaseEvidence",
      timestamp: 990,
      correlationId: "agent-evidence:run_1",
    }))
    expect(surface.report.workspace).toEqual(expect.objectContaining({
      root: "D:/Workspace",
      protected: true,
      isolation: "agent-worktree",
    }))
    expect(surface.report.commands[0]).toEqual(expect.objectContaining({
      command: "npm run typecheck",
      source: "qualityGate",
      status: "failed",
      exitCode: 1,
      outputProjectionIds: ["output:tasks"],
      problemProjectionIds: ["problems:typecheck"],
      taskRunIds: ["task:typecheck"],
    }))
    expect(surface.report.runStateSchema.states).toEqual([
      "planned",
      "assigned",
      "running",
      "review-ready",
      "verified",
      "blocked",
      "accepted",
      "rolled-back",
    ])
    expect(surface.report.runStateSchema.transitions.running).toEqual(["review-ready", "verified", "blocked"])
    expect(surface.report.roleProfiles).toEqual(expect.objectContaining({
      trialCount: 2,
      runtimeIntegrationRecommended: true,
      runtimeContract: expect.objectContaining({
        noSecondStateSource: true,
      }),
    }))
    expect(surface.report.roleProfiles.trials.map((item) => item.profileId)).toEqual(["agency-code-reviewer", "testing-reality-checker"])
    expect(surface.report.roleProfiles.trials[0].permissionScope.writePaths).toEqual(["frontend/vite-project/src/workbench/agentEvidenceWorkbench.ts"])
    expect(surface.report.roleProfiles.trials[1].validationAdvice).toEqual(["node --test desktop/services/agentLoop/runReport.test.js"])
    expect(surface.report.runs[0]).toEqual(expect.objectContaining({
      id: "run_1",
      state: "review-ready",
      changedFiles: ["src/app.ts"],
      diffSummary: expect.objectContaining({
        filesChanged: 1,
        source: "integrationDecision.proposedPatch",
      }),
      rollbackRecommendation: expect.objectContaining({
        available: true,
        driftBlocked: true,
      }),
      costSummary: expect.objectContaining({
        placeholder: true,
      }),
    }))
    expect(surface.report.runs[0].validationCommands).toEqual([
      expect.objectContaining({ command: "npm run typecheck", status: "failed", exitCode: 1 }),
    ])
    expect(surface.report.artifacts[0]).toEqual(expect.objectContaining({
      id: "artifact:typecheck",
      kind: "log",
      path: ".codek/reports/typecheck.log",
    }))
    expect(surface.report.failureCauses.map((item) => item.id)).toEqual(expect.arrayContaining(["quality_gate_failed", "rollback_missing"]))
    expect(surface.report.nextActions.map((item) => item.commandId)).toEqual(expect.arrayContaining(["agent.evidence.reviewTests", "agent.evidence.reviewRollback"]))
    expect(surface.report.projections.taskRuns[0]).toEqual(expect.objectContaining({
      id: "task:typecheck",
      stage: "tests",
      status: "failed",
      outputProjectionIds: ["output:tasks"],
      problemProjectionIds: ["problems:typecheck"],
      rerunCommandId: "agent.evidence.reviewTests",
    }))
    expect(surface.report.projections.outputs[0]).toEqual(expect.objectContaining({
      id: "output:tasks",
      channelName: "Tasks",
      source: "outputLogTelemetryService",
      errorCount: 1,
      preview: expect.stringContaining("[redacted]"),
    }))
    expect(surface.report.projections.outputs[0].preview).not.toContain("REDACTION_TEST_PASSWORD")
    expect(surface.report.projections.problems[0]).toEqual(expect.objectContaining({
      id: "problems:typecheck",
      total: 2,
      files: ["src/app.ts"],
      taskRunIds: ["task:typecheck"],
    }))
    expect(surface.report.projections.debug[0]).toEqual(expect.objectContaining({
      id: "debug:node",
      source: "debugState/debugRuntime",
      sessionId: "debug-1",
    }))
    expect(surface.report.projections.approvalBoundaries[0]).toEqual(expect.objectContaining({
      id: "approval:quality-gate",
      status: "needs_permission",
      protected: true,
    }))
    expect(surface.report.projections.failureDiagnosis[0]).toEqual(expect.objectContaining({
      id: "diagnosis:typecheck",
      failureCauseIds: ["quality_gate_failed"],
      taskRunIds: ["task:typecheck"],
      outputProjectionIds: ["output:tasks"],
      problemProjectionIds: ["problems:typecheck"],
      debugProjectionIds: ["debug:node"],
      approvalBoundaryIds: ["approval:quality-gate"],
      rerunCommandIds: ["agent.evidence.reviewTests"],
    }))
    expect(surface.report.projections.exportSnapshot).toEqual(expect.objectContaining({
      id: "snapshot:agent-evidence",
      redacted: true,
      includes: expect.arrayContaining(["timeline", "tasks", "output", "problems", "debug", "approval", "failureDiagnosis"]),
    }))
    expect(surface.report.phaseStatusSchema.statuses).toEqual([
      "active",
      "completed",
      "systemError",
      "blocked",
      "needs-validation",
      "validated-pass",
      "validated-fail",
      "superseded",
    ])
    expect(surface.report.phaseLifecycle).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "automation",
        phaseName: "Agent Scheduler / Automation",
        threadId: "019ef8c0-10b4-7471-b69d-4c65d958776f",
        status: "validated-pass",
        validation: expect.objectContaining({
          result: "pass",
          command: "node --test desktop/services/goalScheduler/phaseLifecycle.test.js",
        }),
        failureRecovery: expect.objectContaining({
          status: "completed",
          action: "keep manual scheduler flow",
        }),
      }),
    ]))
    expect(surface.views.timeline.items.map((item) => item.label)).toContain("测试与质量门")
    expect(surface.views.timeline.items.find((item) => item.stage === "role-profile-trial")).toEqual(expect.objectContaining({
      label: "角色 profile 试用",
      status: "ready",
      contextValue: "agentEvidence.ready",
    }))
    expect(surface.views.timeline.items.find((item) => item.stage === "automation")).toEqual(expect.objectContaining({
      label: "智能体调度 / 自动化",
      status: "validated-pass",
      threadId: "019ef8c0-10b4-7471-b69d-4c65d958776f",
      validationResult: "pass",
      failureRecoveryStatus: "completed",
      contextValue: "agentEvidence.validated-pass",
    }))
    expect(surface.views.timeline.items.find((item) => item.stage === "tests")).toEqual(expect.objectContaining({
      correlationId: "agent-evidence:run_1",
      failureCauseIds: ["quality_gate_failed"],
      nextActionIds: ["rerun-focused-tests"],
      projectionIds: expect.objectContaining({
        taskRunIds: ["task:typecheck"],
        outputProjectionIds: ["output:tasks"],
        problemProjectionIds: ["problems:typecheck"],
        debugProjectionIds: [],
        failureDiagnosisIds: ["diagnosis:typecheck"],
        approvalBoundaryIds: [],
      }),
      command: expect.objectContaining({
        id: "agent.evidence.openTesting",
        title: "打开智能体测试证据",
      }),
      resource: expect.objectContaining({
        uri: ".codek/reports/typecheck.log",
        source: "taskRuns",
      }),
      link: expect.objectContaining({
        href: ".codek/reports/typecheck.log",
        label: "typecheck output",
      }),
    }))
    expect(surface.views.scm.resourceGroups[0].resources.map((item) => item.uri)).toEqual(["src/app.ts", "src/search.ts"])
    expect(surface.views.scm.resourceGroups[0].resources[0]).toEqual(expect.objectContaining({
      resourceUri: "src/app.ts",
      contextValue: "agentEvidence.scm.modified.rollbackMissing",
      openCommandId: "agent.evidence.openResource",
      diffCommandId: "agent.evidence.diffResource",
      discardCommandId: "agent.evidence.discardResource",
      stageCommandId: "agent.evidence.stageResource",
      attachCommandId: "agent.evidence.attachResource",
      rollbackRiskLabel: "需复核",
      readonlyEvidence: true,
      gitIndexMutation: false,
      ownerEvidence: expect.objectContaining({
        kind: "resource",
        codekStateSource: "IAgentEvidenceWorkbenchService.getSurface().views.scm",
        gitIndexMutation: false,
      }),
    }))
    expect(surface.views.scm.failureCauses.map((item) => item.id)).toEqual(["rollback_missing"])
    expect(surface.views.scm.nextActions.map((item) => item.id)).toEqual(["review-rollback"])
    expect(surface.views.scm.rollbackRisk).toEqual(expect.objectContaining({
      rollbackAvailable: false,
      pendingBatchBlocked: true,
      reviewDisplayBlocked: true,
    }))
    expect(surface.views.testing.runSummary).toEqual(expect.objectContaining({
      total: 2,
      failed: 1,
      qualityGateFailures: 1,
      state: "failed",
    }))
    expect(surface.views.testing.items[0]).toEqual(expect.objectContaining({
      commandIds: ["npm run typecheck"],
      artifactIds: ["artifact:typecheck"],
      failureCauseIds: ["quality_gate_failed"],
      nextActionIds: ["rerun-focused-tests"],
      projectionIds: expect.objectContaining({
        taskRunIds: ["task:typecheck"],
        outputProjectionIds: ["output:tasks"],
        problemProjectionIds: ["problems:typecheck"],
        failureDiagnosisIds: ["diagnosis:typecheck"],
      }),
      rerunCommandId: "agent.evidence.reviewTests",
      failureDetail: "typecheck failed",
      resourceLinks: [{
        uri: ".codek/reports/typecheck.log",
        label: "typecheck output",
        source: "taskRuns",
      }],
    }))
    expect(surface.views.progress.items.map((item) => item.stage)).toEqual(expect.arrayContaining(["tests", "real-ui", "approval", "rollback"]))
    expect(surface.views.progress.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "failure-recovery",
        title: "Failure Recovery",
        aggregateStatus: "systemError",
        threadId: "019ef8c0-10b4-7471-b69d-4c65d958776f",
        validationResult: "",
        failureRecoveryStatus: "blocked",
        lifecycle: expect.objectContaining({ state: "updated", cancellable: false }),
      }),
    ]))
    expect(surface.views.progress.items[0]).toEqual(expect.objectContaining({
      correlationId: "agent-evidence:run_1",
      lifecycle: { state: "active", cancellable: false },
      aggregateStatus: "blocked",
      cancelCommandId: "agent.evidence.cancelProgress",
      ariaLabel: "测试与质量门: 重跑 focused tests",
    }))
    expect(surface.views.notifications.items.map((item) => item.severity)).toEqual(expect.arrayContaining(["error", "warning"]))
    expect(surface.views.notifications.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "agentEvidence.phase.failure-recovery",
        severity: "error",
        message: expect.stringContaining("Failure Recovery"),
        threadId: "019ef8c0-10b4-7471-b69d-4c65d958776f",
        failureRecoveryStatus: "blocked",
      }),
    ]))
    expect(surface.views.notifications.items[0]).toEqual(expect.objectContaining({
      correlationId: "agent-evidence:run_1",
      lifecycle: expect.objectContaining({ state: "active", sticky: true, dismissible: true }),
      dedupeKey: "agentEvidence.notification.quality-gate",
      dismissCommandId: "agent.evidence.dismissNotification",
      focusTarget: "notifications",
      ariaLabel: "error: 质量门失败",
    }))
    expect(surface.actions.map((action) => action.id)).toEqual(expect.arrayContaining([
      "agent.evidence.reviewTests",
      "agent.evidence.importManualUiEvidence",
      "agent.evidence.reviewRollback",
    ]))
  })

  it("derives unified evidence list, detail, filter and export descriptors from the same surface", () => {
    const surface = buildAgentEvidenceWorkbenchSurface(sampleSummary(), { createdAt: 1000 })

    expect(surface.list.items.length).toBeGreaterThanOrEqual(
      surface.views.timeline.items.length
      + surface.views.scm.resourceGroups[0].resources.length
      + surface.views.testing.items.length
      + surface.views.progress.items.length
      + surface.views.notifications.items.length,
    )
    expect(surface.list.items.map((item) => item.surface)).toEqual(expect.arrayContaining([
      "timeline",
      "scm",
      "testing",
      "progress",
      "notifications",
    ]))
    expect(surface.list.filters.surfaces).toEqual(["timeline", "scm", "testing", "progress", "notifications"])
    expect(surface.list.filters.statuses).toEqual(expect.arrayContaining(["ready", "blocked", "degraded", "modified", "failed", "active"]))
    expect(surface.list.filters.severities).toEqual(expect.arrayContaining(["error", "warning"]))
    expect(surface.list.counts).toEqual(expect.objectContaining({
      total: surface.list.items.length,
      timeline: surface.views.timeline.items.length,
      scm: surface.views.scm.resourceGroups[0].resources.length,
      testing: surface.views.testing.items.length,
      progress: surface.views.progress.items.length,
      notifications: surface.views.notifications.items.length,
    }))

    expect(surface.list.items.filter((item) => item.surface === "scm").map((item) => item.resourceUri)).toEqual(["src/app.ts", "src/search.ts"])
    expect(surface.list.items.find((item) => item.id === "testing:agentEvidence.latestTask")).toEqual(expect.objectContaining({
      label: "Search replace save rejection regression",
      surface: "testing",
      status: "failed",
      severity: "error",
      commandId: "agent.evidence.reviewTests",
      artifactIds: ["artifact:typecheck"],
      failureCauseIds: ["quality_gate_failed"],
    }))
    expect(surface.list.items.find((item) => item.id === "notifications:notification:quality-gate")).toEqual(expect.objectContaining({
      surface: "notifications",
      status: "active",
      severity: "error",
      commandId: "agent.evidence.dismissNotification",
    }))
    expect(surface.list.items.find((item) => item.surface === "timeline" && item.stage === "automation")).toEqual(expect.objectContaining({
      stage: "automation",
      status: "validated-pass",
      threadId: "019ef8c0-10b4-7471-b69d-4c65d958776f",
      validationResult: "pass",
      failureRecoveryStatus: "completed",
    }))
    const lifecycleFilterService = new AgentEvidenceWorkbenchService()
    lifecycleFilterService.setSummary(sampleSummary(), { createdAt: 1000 })
    expect(lifecycleFilterService.getEvidenceItems({ query: "019ef8c0" }).map((item) => item.stage)).toEqual(expect.arrayContaining([
      "automation",
      "failure-recovery",
    ]))

    expect(surface.list.filtered).toEqual(expect.objectContaining({
      all: surface.list.items,
      blocked: expect.arrayContaining([expect.objectContaining({ stage: "tests", status: "blocked" })]),
      errors: expect.arrayContaining([expect.objectContaining({ severity: "error" })]),
    }))
    expect(surface.list.filtered.bySurface.testing).toEqual([
      expect.objectContaining({ id: "testing:agentEvidence.latestTask" }),
    ])
    expect(surface.list.filtered.byStatus.blocked.map((item) => item.stage)).toEqual(expect.arrayContaining(["tests", "approval", "rollback"]))
    expect(surface.list.filtered.bySeverity.error.map((item) => item.id)).toEqual(expect.arrayContaining([
      "testing:agentEvidence.latestTask",
      "notifications:notification:quality-gate",
    ]))
    expect(surface.list.filtered.query["typecheck output"]).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: "timeline", stage: "tests" }),
      expect.objectContaining({ id: "testing:agentEvidence.latestTask" }),
    ]))
    expect(surface.detail).toEqual(expect.objectContaining({
      selectedId: "notifications:notification:quality-gate",
      item: expect.objectContaining({ id: "notifications:notification:quality-gate", severity: "error" }),
      editor: expect.objectContaining({
        id: "agentEvidence.detail.notifications.notification-quality-gate",
        title: "质量门失败",
        resourceUri: "agent-evidence://notifications/notification%3Aquality-gate",
        readonly: true,
      }),
      export: expect.objectContaining({
        jsonCommandId: "agent.evidence.exportJson",
        markdownCommandId: "agent.evidence.exportMarkdown",
        artifactPath: ".codek/reports/agent-evidence-workbench-latest.json",
        evidenceCount: surface.list.items.length,
        redacted: true,
      }),
    }))
    expect(surface.export).toEqual(expect.objectContaining({
      jsonCommandId: "agent.evidence.exportJson",
      markdownCommandId: "agent.evidence.exportMarkdown",
      artifactPath: ".codek/reports/agent-evidence-workbench-latest.json",
      markdownPath: ".codek/reports/agent-evidence-workbench-latest.md",
      correlationId: "agent-evidence:run_1",
      evidenceCount: surface.list.items.length,
      redacted: true,
      snapshotId: "snapshot:agent-evidence",
    }))
  })

  it("filters unified evidence items without mutating the service-owned surface", () => {
    const service = new AgentEvidenceWorkbenchService()
    const surface = service.setSummary(sampleSummary(), { createdAt: 1000 })

    expect(service.getEvidenceItems({ surface: "testing" })).toEqual(surface.list.filtered.bySurface.testing)
    expect(service.getEvidenceItems({ status: "blocked" })).toEqual(surface.list.filtered.byStatus.blocked)
    expect(service.getEvidenceItems({ severity: "warning" })).toEqual(surface.list.filtered.bySeverity.warning)
    expect(service.getEvidenceItems({ query: "src/search.ts" })).toEqual([
      expect.objectContaining({ id: "scm:src/search.ts", resourceUri: "src/search.ts" }),
    ])
    expect(service.getEvidenceDetail("testing:agentEvidence.latestTask")).toEqual(expect.objectContaining({
      selectedId: "testing:agentEvidence.latestTask",
      item: expect.objectContaining({ surface: "testing" }),
      editor: expect.objectContaining({ id: "agentEvidence.detail.testing.agentEvidence.latestTask" }),
    }))
    expect(service.getExportDescriptor()).toBe(surface.export)
    expect(service.getSurface()).toBe(surface)
  })

  it("keeps every VS Code-style surface tied to a real state source, command entry and UI smoke contract", async () => {
    const openSurface = vi.fn()
    const disposable = registerAgentEvidenceWorkbenchContributions({ openSurface })
    const surface = setAgentEvidenceWorkbenchSummary(sampleSummary(), { createdAt: 1800 })
    const contribution = getAgentEvidenceWorkbenchContributionSummary()
    const bySurface = new Map(AGENT_EVIDENCE_SURFACE_BRIDGE_AUDIT.map((entry) => [entry.surface, entry]))

    expect(AGENT_EVIDENCE_SURFACE_BRIDGE_AUDIT.map((entry) => entry.surface)).toEqual([
      "scm",
      "timeline",
      "testing",
      "notifications",
      "progress",
    ])
    expect(bySurface.size).toBe(5)

    const expectedOpenCommands: Record<string, string> = {
      scm: AGENT_EVIDENCE_COMMAND_IDS.OpenScm,
      timeline: AGENT_EVIDENCE_COMMAND_IDS.OpenTimeline,
      testing: AGENT_EVIDENCE_COMMAND_IDS.OpenTesting,
      notifications: AGENT_EVIDENCE_COMMAND_IDS.OpenNotifications,
      progress: AGENT_EVIDENCE_COMMAND_IDS.OpenProgress,
    }
    const knownServiceIds = contribution.vscodeServiceIds.concat([
      "agentEvidenceScmService",
      "agentEvidenceTestingService",
      "agentEvidenceTimelineService",
      "agentEvidenceProgressService",
      "agentEvidenceNotificationService",
    ])

    for (const entry of AGENT_EVIDENCE_SURFACE_BRIDGE_AUDIT) {
      expect(entry.vscodeSourcePaths.length).toBeGreaterThanOrEqual(2)
      expect(entry.vscodeSourcePaths.every((path) => path.startsWith("src/vs/"))).toBe(true)
      expect(entry.codekStateSource).toBe(`IAgentEvidenceWorkbenchService.getSurface().views.${entry.surface}`)
      expect(entry.bridgeLevel).toBe("adapter")
      expect(entry.serviceIds.length).toBe(2)
      expect(knownServiceIds).toEqual(expect.arrayContaining(entry.serviceIds))
      expect(contribution.viewIds).toEqual(expect.arrayContaining(entry.viewIds))
      expect(contribution.viewContainerIds).toEqual(expect.arrayContaining(entry.viewContainerIds))
      expect(contribution.commandIds).toEqual(expect.arrayContaining(entry.commandIds))
      expect(contribution.menuIds).toEqual(expect.arrayContaining(entry.menuIds))
      expect(entry.uiSmokeSelectors.length).toBeGreaterThanOrEqual(2)
      expect(entry.smokeMetricKeys.every((key) => key.startsWith("agentEvidence"))).toBe(true)
      expect(entry.remainingGaps.join(" ")).toContain("人工 UI 验收")
      expect(getCommand(expectedOpenCommands[entry.surface])?.id).toBe(expectedOpenCommands[entry.surface])
      expect(await executeCommand(expectedOpenCommands[entry.surface], [], { agentEvidenceAvailable: true })).toBe(true)
      expect(openSurface).toHaveBeenLastCalledWith(entry.surface)
    }

    expect(bySurface.get("scm")?.serviceIds).toEqual(["agentEvidenceScmService", "scm"])
    expect(bySurface.get("testing")?.serviceIds).toEqual(["agentEvidenceTestingService", "testService"])
    expect(bySurface.get("timeline")?.serviceIds).toEqual(["agentEvidenceTimelineService", "timeline"])
    expect(bySurface.get("progress")?.serviceIds).toEqual(["agentEvidenceProgressService", "progressService"])
    expect(bySurface.get("notifications")?.serviceIds).toEqual(["agentEvidenceNotificationService", "notificationService"])
    expect(bySurface.get("scm")?.commandIds).toEqual(expect.arrayContaining([
      AGENT_EVIDENCE_COMMAND_IDS.OpenResource,
      AGENT_EVIDENCE_COMMAND_IDS.DiffResource,
      AGENT_EVIDENCE_COMMAND_IDS.StageResource,
      AGENT_EVIDENCE_COMMAND_IDS.DiscardResource,
      AGENT_EVIDENCE_COMMAND_IDS.AttachResource,
    ]))
    expect(bySurface.get("testing")?.commandIds).toContain(AGENT_EVIDENCE_COMMAND_IDS.ReviewTests)
    expect(bySurface.get("timeline")?.commandIds).toContain(AGENT_EVIDENCE_COMMAND_IDS.OpenDetail)
    expect(bySurface.get("progress")?.commandIds).toEqual(expect.arrayContaining([
      AGENT_EVIDENCE_COMMAND_IDS.CancelProgress,
      AGENT_EVIDENCE_COMMAND_IDS.ImportManualUiEvidence,
    ]))
    expect(bySurface.get("notifications")?.commandIds).toContain(AGENT_EVIDENCE_COMMAND_IDS.DismissNotification)

    expect(surface.views.scm.resourceGroups[0].resources.length).toBeGreaterThan(0)
    expect(surface.views.testing.items[0].rerunCommandId).toBe(AGENT_EVIDENCE_COMMAND_IDS.ReviewTests)
    expect(surface.views.timeline.items.some((item) => item.command.id === AGENT_EVIDENCE_COMMAND_IDS.OpenTesting)).toBe(true)
    expect(surface.views.progress.items.some((item) => item.cancelCommandId === AGENT_EVIDENCE_COMMAND_IDS.CancelProgress)).toBe(true)
    expect(surface.views.notifications.items.some((item) => item.dismissCommandId === AGENT_EVIDENCE_COMMAND_IDS.DismissNotification)).toBe(true)
    expect(surface.actions.find((item) => item.id === AGENT_EVIDENCE_COMMAND_IDS.StageResource)).toEqual(expect.objectContaining({
      surface: "scm",
      enabled: false,
      detail: expect.stringContaining("不写暂存区"),
    }))

    disposable.dispose()
  })

  it("marks partial pass and save rejection evidence as testing notification work instead of SCM success", () => {
    const surface = buildAgentEvidenceWorkbenchSurface(sampleSummary({
      testing: {
        taskRuns: 3,
        passed: 2,
        failed: 1,
        blocked: 0,
        running: 0,
        skipped: 0,
        problemDiagnostics: 1,
        qualityGateStatus: "failed",
        qualityGateCommands: 4,
        qualityGateFailures: 1,
        latestTask: "BulkEdit saveFile rejected",
      },
      failure: {
        blockingGaps: 0,
        highGaps: 0,
        mediumGaps: 1,
        taskRunIssues: 1,
        qualityGateFailures: 1,
        problemDiagnostics: 1,
        latestBlockingGap: null,
      },
    }))

    expect(surface.views.testing.items[0]).toEqual(expect.objectContaining({
      label: "BulkEdit saveFile rejected",
      state: "failed",
    }))
    expect(surface.views.notifications.items.some((item) => item.message.includes("BulkEdit saveFile rejected"))).toBe(true)
    expect(surface.views.scm.summary).toContain("2 个文件")
  })

  it("falls back to a generated report contract without creating a second evidence store", () => {
    const surface = buildAgentEvidenceWorkbenchSurface(sampleSummary({ report: undefined }), { createdAt: 1200 })

    expect(surface.report).toEqual(expect.objectContaining({
      schemaVersion: 1,
      source: "releaseEvidence",
      timestamp: 1200,
      correlationId: "agent-evidence:1200",
    }))
    expect(surface.report.workspace).toEqual(expect.objectContaining({
      protected: true,
    }))
    expect(surface.report.commands.map((item) => item.command)).toEqual(["Search replace save rejection regression"])
    expect(surface.report.failureCauses.map((item) => item.id)).toEqual(expect.arrayContaining([
      "manual_real_ui_evidence",
      "task_run_issues",
      "quality_gate_failures",
      "rollback_unavailable",
      "approval_pending",
    ]))
    expect(surface.report.nextActions.map((item) => item.stage)).toEqual(expect.arrayContaining(["tests", "real-ui", "approval", "rollback"]))
    expect(surface.report.projections.taskRuns[0]).toEqual(expect.objectContaining({
      id: "task:latest",
      stage: "tests",
      name: "Search replace save rejection regression",
      outputProjectionIds: ["output:tasks"],
      problemProjectionIds: ["problems:task-run"],
    }))
    expect(surface.report.projections.outputs[0]).toEqual(expect.objectContaining({
      id: "output:tasks",
      channelName: "Tasks",
      source: "outputLogTelemetryService",
      commandIds: ["Search replace save rejection regression"],
    }))
    expect(surface.report.projections.problems[0]).toEqual(expect.objectContaining({
      id: "problems:task-run",
      total: 2,
      source: "problemsDiagnosticsService(globalMarkerService)",
      taskRunIds: ["task:latest"],
    }))
    expect(surface.report.projections.failureDiagnosis.map((item) => item.id)).toEqual(expect.arrayContaining([
      "diagnosis:task_run_issues",
      "diagnosis:quality_gate_failures",
      "diagnosis:approval_pending",
    ]))
    expect(surface.views.notifications.items.every((item) => item.correlationId === surface.report.correlationId)).toBe(true)
  })

  it("exposes a VS Code-style service identifier and keeps helpers on the same evidence model", async () => {
    const service = new AgentEvidenceWorkbenchService()
    const collection = new ServiceCollection([IAgentEvidenceWorkbenchService, service])
    const instantiationService = new InstantiationService(collection)
    const resolved = instantiationService.invokeFunction((accessor) => accessor.get(IAgentEvidenceWorkbenchService))

    expect(String(IAgentEvidenceWorkbenchService)).toBe("agentEvidenceWorkbenchService")
    expect(resolved).toBe(service)
    expect(resolved._serviceBrand).toBeUndefined()
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === IAgentEvidenceWorkbenchService && instance === globalAgentEvidenceWorkbenchService)).toBe(true)

    const surface = resolved.setSummary(sampleSummary(), { createdAt: 1300 })

    expect(resolved.getSurface()).toBe(surface)
    expect(resolved.getSummary()?.statusLabel).toBe("6/9 evidence workbench 阶段就绪")

    const helperSurface = setAgentEvidenceWorkbenchSummary(sampleSummary({ statusLabel: "helper 同源更新" }), { createdAt: 1400 })
    expect(getAgentEvidenceWorkbenchSurface()).toBe(helperSurface)
    expect(globalAgentEvidenceWorkbenchService.getSummary()?.statusLabel).toBe("helper 同源更新")
  })

  it("resolves SCM, Testing, Timeline, Progress and Notification facades through the same workbench service", () => {
    const service = new AgentEvidenceWorkbenchService()
    const facade = new AgentEvidenceWorkbenchSurfaceFacadeService(service)
    const collection = new ServiceCollection(
      [IAgentEvidenceWorkbenchService, service],
      [IAgentEvidenceTimelineService, facade],
      [IAgentEvidenceScmService, facade],
      [IAgentEvidenceTestingService, facade],
      [IAgentEvidenceProgressService, facade],
      [IAgentEvidenceNotificationService, facade],
      [ITimelineService, facade],
      [ISCMService, facade],
      [ITestService, facade],
      [IProgressService, facade],
      [INotificationService, facade],
    )
    const instantiationService = new InstantiationService(collection)
    const surface = service.setSummary(sampleSummary({
      scm: {
        ...sampleSummary().scm,
        files: ["D:\\Workspace\\src\\agent.ts", "D:/Workspace/src/agent.ts", "D:\\Workspace\\src\\agent.ts"],
      },
      report: {
        ...sampleSummary().report!,
        failureCauses: [
          ...sampleSummary().report!.failureCauses,
          { id: "approval_cancelled", severity: "warning", title: "审批已取消", detail: "用户取消高风险命令", source: "sandboxSecurity", stage: "approval" },
        ],
        nextActions: [
          ...sampleSummary().report!.nextActions,
          { id: "retry-approval", label: "重新请求审批", surface: "notifications", stage: "approval", priority: "medium", commandId: "agent.evidence.openNotifications" },
        ],
        progress: [
          ...sampleSummary().report!.progress,
          { id: "progress:approval", title: "审批", message: "等待重新授权", stage: "approval", status: "cancelled", correlationId: "agent-evidence:run_1", total: 1, worked: 0, location: "notification", cancellable: true },
        ],
        notifications: [
          ...sampleSummary().report!.notifications,
          {
            id: "notification:approval-cancelled",
            severity: "warning",
            message: "审批已取消，可重新请求授权",
            source: "Agent Evidence",
            correlationId: "agent-evidence:run_1",
            lifecycle: { state: "updated", sticky: true, updatedAt: 991, dismissible: true },
            actions: [{ id: "agent.evidence.openNotifications", label: "查看审批", surface: "notifications" }],
          },
        ],
      },
    }), { createdAt: 1600 })

    const timeline = instantiationService.invokeFunction((accessor) => accessor.get(IAgentEvidenceTimelineService))
    const scm = instantiationService.invokeFunction((accessor) => accessor.get(IAgentEvidenceScmService))
    const testing = instantiationService.invokeFunction((accessor) => accessor.get(IAgentEvidenceTestingService))
    const progress = instantiationService.invokeFunction((accessor) => accessor.get(IAgentEvidenceProgressService))
    const notifications = instantiationService.invokeFunction((accessor) => accessor.get(IAgentEvidenceNotificationService))
    const vscodeTimeline = instantiationService.invokeFunction((accessor) => accessor.get(ITimelineService))
    const vscodeScm = instantiationService.invokeFunction((accessor) => accessor.get(ISCMService))
    const vscodeTesting = instantiationService.invokeFunction((accessor) => accessor.get(ITestService))
    const vscodeProgress = instantiationService.invokeFunction((accessor) => accessor.get(IProgressService))
    const vscodeNotifications = instantiationService.invokeFunction((accessor) => accessor.get(INotificationService))

    expect(String(IAgentEvidenceTimelineService)).toBe("agentEvidenceTimelineService")
    expect(String(IAgentEvidenceScmService)).toBe("agentEvidenceScmService")
    expect(String(IAgentEvidenceTestingService)).toBe("agentEvidenceTestingService")
    expect(String(IAgentEvidenceProgressService)).toBe("agentEvidenceProgressService")
    expect(String(IAgentEvidenceNotificationService)).toBe("agentEvidenceNotificationService")
    expect(String(ITimelineService)).toBe("timeline")
    expect(String(ISCMService)).toBe("scm")
    expect(String(ITestService)).toBe("testService")
    expect(String(IProgressService)).toBe("progressService")
    expect(String(INotificationService)).toBe("notificationService")
    expect(timeline._serviceBrand).toBeUndefined()
    expect(scm._serviceBrand).toBeUndefined()
    expect(testing._serviceBrand).toBeUndefined()
    expect(progress._serviceBrand).toBeUndefined()
    expect(notifications._serviceBrand).toBeUndefined()

    expect(timeline.getSurface()).toBe(surface)
    expect(scm.getSurface()).toBe(surface)
    expect(testing.getSurface()).toBe(surface)
    expect(progress.getSurface()).toBe(surface)
    expect(notifications.getSurface()).toBe(surface)
    expect(vscodeTimeline).toBe(facade)
    expect(vscodeScm).toBe(facade)
    expect(vscodeTesting).toBe(facade)
    expect(vscodeProgress).toBe(facade)
    expect(vscodeNotifications).toBe(facade)
    expect(vscodeTimeline.getTimelineItems()).toBe(surface.views.timeline.items)
    expect(vscodeScm.getScmResources()).toBe(scm.getScmResources())
    expect(vscodeTesting.getTestingItems()).toBe(surface.views.testing.items)
    expect(vscodeProgress.getProgressItems()).toBe(surface.views.progress.items)
    expect(vscodeNotifications.getNotifications()).toBe(surface.views.notifications.items)
    expect(timeline.getTimelineItems()).toBe(surface.views.timeline.items)
    expect(scm.getScmView()).toBe(surface.views.scm)
    expect(testing.getTestingView()).toBe(surface.views.testing)
    expect(progress.getProgressItems()).toBe(surface.views.progress.items)
    expect(notifications.getNotifications()).toBe(surface.views.notifications.items)
    expect(facade.getEvidenceItems()).toBe(surface.list.items)
    expect(facade.getEvidenceDetail()).toBe(surface.detail)
    expect(facade.getExportDescriptor()).toBe(surface.export)
    expect(facade.getContributionSummary()).toBe(surface.contribution)

    expect(scm.getScmResources().map((item) => item.uri)).toEqual(["D:\\Workspace\\src\\agent.ts", "D:/Workspace/src/agent.ts"])
    expect(progress.getProgressItems().find((item) => item.stage === "approval")).toEqual(expect.objectContaining({
      correlationId: "agent-evidence:run_1",
      lifecycle: { state: "dismissed", cancellable: false },
      failureCauseIds: ["approval_cancelled"],
      nextActionIds: ["retry-approval"],
      aggregateStatus: "cancelled",
      cancelCommandId: "agent.evidence.cancelProgress",
    }))
    expect(notifications.getNotifications()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "notification:approval-cancelled",
        severity: "warning",
        correlationId: "agent-evidence:run_1",
        lifecycle: expect.objectContaining({ state: "updated", sticky: true }),
        actions: [{ id: "agent.evidence.openNotifications", label: "查看审批", surface: "notifications" }],
        dedupeKey: "agentEvidence.notification.approval-cancelled",
        dismissCommandId: "agent.evidence.dismissNotification",
        focusTarget: "notifications",
      }),
    ]))
    expect(testing.getTestingItems()[0].commandIds).toEqual(["npm run typecheck"])
  })

  it("exposes VS Code-style service contracts for SCM resources, test results, timeline items, progress and notifications", () => {
    const service = new AgentEvidenceWorkbenchService()
    const facade = new AgentEvidenceWorkbenchSurfaceFacadeService(service)
    const surface = service.setSummary(sampleSummary(), { createdAt: 1900 })

    expect(facade.getScmRepositories()).toEqual([expect.objectContaining({
      id: "agentEvidence",
      providerLabel: "Codek 智能体证据",
      providerId: "agentEvidence",
      resourceGroups: surface.views.scm.resourceGroups,
      actionButton: expect.objectContaining({
        commandId: AGENT_EVIDENCE_COMMAND_IDS.ReviewRollback,
        enabled: true,
      }),
      gitIndexMutation: false,
      ownerEvidence: expect.objectContaining({
        kind: "provider",
        owner: "agentEvidenceWorkbenchService",
      }),
    })])
    expect(facade.getScmResourceGroups()).toBe(surface.views.scm.resourceGroups)
    expect(facade.getScmResourceActions("src/app.ts")).toEqual(expect.objectContaining({
      resourceUri: "src/app.ts",
      groupId: "agentEvidenceChanges",
      readonlyEvidence: true,
      gitIndexMutation: false,
      open: expect.objectContaining({ commandId: AGENT_EVIDENCE_COMMAND_IDS.OpenResource, arguments: ["src/app.ts"] }),
      diff: expect.objectContaining({ commandId: AGENT_EVIDENCE_COMMAND_IDS.DiffResource, arguments: ["src/app.ts"] }),
      stage: expect.objectContaining({
        commandId: AGENT_EVIDENCE_COMMAND_IDS.StageResource,
        arguments: ["src/app.ts"],
        enabled: false,
        title: expect.stringContaining("不写 Git index"),
      }),
      discard: expect.objectContaining({
        commandId: AGENT_EVIDENCE_COMMAND_IDS.DiscardResource,
        arguments: ["src/app.ts"],
        enabled: false,
        title: expect.stringContaining("不改工作区"),
      }),
      attach: expect.objectContaining({ commandId: AGENT_EVIDENCE_COMMAND_IDS.AttachResource, arguments: ["src/app.ts"] }),
      ownerEvidence: expect.objectContaining({
        provider: expect.objectContaining({ kind: "provider", connected: true }),
        resourceGroup: expect.objectContaining({ kind: "resourceGroup", groupId: "agentEvidenceChanges" }),
        resource: expect.objectContaining({ kind: "resource", resourceUri: "src/app.ts" }),
        actions: expect.objectContaining({
          stage: expect.objectContaining({ connected: false, gitIndexMutation: false }),
          discard: expect.objectContaining({
            commandId: AGENT_EVIDENCE_COMMAND_IDS.DiscardResource,
            connected: false,
            gitIndexMutation: false,
          }),
        }),
      }),
    }))
    expect(facade.openScmResource("src/app.ts")).toEqual(expect.objectContaining({
      surface: "scm",
      commandId: AGENT_EVIDENCE_COMMAND_IDS.OpenResource,
      targetId: "src/app.ts",
      handledBy: "agentEvidenceWorkbenchService",
      mutatesState: false,
    }))
    expect(facade.diffScmResource("src/app.ts").commandId).toBe(AGENT_EVIDENCE_COMMAND_IDS.DiffResource)
    expect(facade.stageScmResource("src/app.ts")).toEqual(expect.objectContaining({
      commandId: AGENT_EVIDENCE_COMMAND_IDS.StageResource,
      readonlyEvidence: true,
      mutatesState: false,
      gitIndexMutation: false,
      ownerEvidence: expect.objectContaining({
        commandId: AGENT_EVIDENCE_COMMAND_IDS.StageResource,
        connected: false,
      }),
    }))
    expect(facade.discardScmResource("src/app.ts")).toEqual(expect.objectContaining({
      commandId: AGENT_EVIDENCE_COMMAND_IDS.DiscardResource,
      readonlyEvidence: true,
      mutatesState: false,
      gitIndexMutation: false,
      ownerEvidence: expect.objectContaining({
        commandId: AGENT_EVIDENCE_COMMAND_IDS.DiscardResource,
        connected: false,
      }),
    }))

    expect(facade.getTestingRunSummary()).toBe(surface.views.testing.runSummary)
    expect(facade.getTestResults()).toEqual([expect.objectContaining({
      id: "agentEvidence.latestTask",
      state: "failed",
      rerunCommandId: AGENT_EVIDENCE_COMMAND_IDS.ReviewTests,
      resourceLinks: expect.arrayContaining([expect.objectContaining({ uri: ".codek/reports/typecheck.log" })]),
    })])
    expect(facade.rerunTests("agentEvidence.latestTask")).toEqual(expect.objectContaining({
      surface: "testing",
      commandId: AGENT_EVIDENCE_COMMAND_IDS.ReviewTests,
      targetId: "agentEvidence.latestTask",
      result: expect.objectContaining({ state: "failed" }),
      mutatesState: false,
    }))

    const testsTimeline = surface.views.timeline.items.find((item) => item.stage === "tests")!
    expect(facade.getTimelineItem(testsTimeline.handle)).toBe(testsTimeline)
    expect(facade.getTimelineItemCommand(testsTimeline.handle)).toEqual(expect.objectContaining({
      commandId: AGENT_EVIDENCE_COMMAND_IDS.OpenTesting,
      arguments: expect.arrayContaining(["tests", "agent-evidence:run_1"]),
    }))
    expect(facade.getTimelineItemResource(testsTimeline.handle)).toEqual(expect.objectContaining({
      uri: ".codek/reports/typecheck.log",
      source: "taskRuns",
    }))

    expect(facade.getProgressAggregate()).toEqual(expect.objectContaining({
      total: surface.views.progress.items.length,
      active: expect.any(Number),
      cancellable: 0,
      blocked: expect.any(Number),
      commandId: AGENT_EVIDENCE_COMMAND_IDS.CancelProgress,
      readonlyEvidence: true,
    }))
    expect(facade.cancelProgress("agentEvidence.progress.tests")).toEqual(expect.objectContaining({
      surface: "progress",
      commandId: AGENT_EVIDENCE_COMMAND_IDS.CancelProgress,
      targetId: "agentEvidence.progress.tests",
      mutatesState: false,
    }))

    expect(facade.getNotificationSeverityCounts()).toEqual(expect.objectContaining({
      error: expect.any(Number),
      warning: expect.any(Number),
      info: expect.any(Number),
    }))
    expect(facade.getNotificationActions("notification:quality-gate")).toEqual([
      expect.objectContaining({
        id: AGENT_EVIDENCE_COMMAND_IDS.ReviewTests,
        surface: "testing",
      }),
    ])
    expect(facade.dismissNotification("notification:quality-gate")).toEqual(expect.objectContaining({
      surface: "notifications",
      commandId: AGENT_EVIDENCE_COMMAND_IDS.DismissNotification,
      targetId: "notification:quality-gate",
      mutatesState: false,
      readonlyEvidence: true,
    }))
  })

  it("maps progress start, update, failure, cancel and done status without visual-only state", () => {
    const surface = buildAgentEvidenceWorkbenchSurface(sampleSummary({
      timeline: [
        { stage: "plan", title: "计划", status: "degraded", ready: false, available: true, summary: "进行中", evidenceRefs: ["readiness"], nextAction: "继续计划" },
        { stage: "tests", title: "测试", status: "blocked", ready: false, available: true, summary: "失败", evidenceRefs: ["taskRuns"], nextAction: "修复测试" },
        { stage: "approval", title: "审批", status: "blocked", ready: false, available: true, summary: "取消", evidenceRefs: ["sandboxSecurity"], nextAction: "重新审批" },
        { stage: "real-ui", title: "真实 UI", status: "blocked", ready: false, available: true, summary: "已完成但仍需记录", evidenceRefs: ["manualRealUiEvidence"], nextAction: "记录证据" },
      ],
      report: {
        ...sampleSummary().report!,
        progress: [
          { id: "progress:plan", title: "计划", message: "开始", stage: "plan", status: "running", correlationId: "agent-evidence:run_1", total: 2, worked: 1, location: "window", cancellable: true },
          { id: "progress:tests", title: "测试", message: "失败", stage: "tests", status: "failed", correlationId: "agent-evidence:run_1", total: 1, worked: 1, location: "notification", cancellable: true },
          { id: "progress:approval", title: "审批", message: "取消", stage: "approval", status: "cancelled", correlationId: "agent-evidence:run_1", total: 1, worked: 0, location: "notification", cancellable: true },
          { id: "progress:real-ui", title: "真实 UI", message: "完成", stage: "real-ui", status: "done", correlationId: "agent-evidence:run_1", total: 1, worked: 1, location: "window", cancellable: true },
        ],
      },
    }), { createdAt: 1700 })
    const byStage = new Map(surface.views.progress.items.map((item) => [item.stage, item]))

    expect(byStage.get("plan")).toEqual(expect.objectContaining({
      worked: 1,
      lifecycle: { state: "active", cancellable: true },
      aggregateStatus: "running",
    }))
    expect(byStage.get("tests")).toEqual(expect.objectContaining({
      lifecycle: { state: "updated", cancellable: false },
      location: "notification",
      aggregateStatus: "failed",
    }))
    expect(byStage.get("approval")).toEqual(expect.objectContaining({
      lifecycle: { state: "dismissed", cancellable: false },
      infinite: false,
      aggregateStatus: "cancelled",
    }))
    expect(byStage.get("real-ui")).toEqual(expect.objectContaining({
      lifecycle: { state: "dismissed", cancellable: false },
      worked: 1,
      aggregateStatus: "done",
    }))
  })

  it("preserves notification focus targets and SCM read-only resource action metadata from release evidence", () => {
    const surface = buildAgentEvidenceWorkbenchSurface(sampleSummary({
      report: {
        ...sampleSummary().report!,
        notifications: [
          {
            id: "notification:testing-focus",
            severity: "warning",
            message: "测试证据需要复核",
            source: "Agent Evidence",
            correlationId: "agent-evidence:run_1",
            lifecycle: { state: "active", sticky: true, updatedAt: 990, dismissible: true },
            actions: [{ id: "agent.evidence.reviewTests", label: "复核测试", surface: "testing" }],
            focusTarget: "testing",
          },
        ],
      },
    }), { createdAt: 2100 })

    expect(surface.views.scm.resourceGroups[0].resources[0]).toEqual(expect.objectContaining({
      stageCommandId: AGENT_EVIDENCE_COMMAND_IDS.StageResource,
      readonlyEvidence: true,
    }))
    expect(surface.views.notifications.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "notification:testing-focus",
        dedupeKey: "agentEvidence.notification.testing-focus",
        dismissCommandId: AGENT_EVIDENCE_COMMAND_IDS.DismissNotification,
        focusTarget: "testing",
      }),
    ]))
  })

  it("registers Agent Evidence sub-surface facade singletons without adding state stores", () => {
    const singletonEntries = getSingletonServiceDescriptors()
    const registeredIds = singletonEntries.map(([id]) => String(id))

    expect(registeredIds).toEqual(expect.arrayContaining([
      "agentEvidenceTimelineService",
      "agentEvidenceScmService",
      "agentEvidenceTestingService",
      "agentEvidenceProgressService",
      "agentEvidenceNotificationService",
      "timeline",
      "scm",
      "testService",
      "progressService",
      "notificationService",
    ]))
    expect(singletonEntries.find(([id]) => id === IAgentEvidenceTimelineService)?.[1]).toBe(globalAgentEvidenceTimelineService)
    expect(singletonEntries.find(([id]) => id === IAgentEvidenceScmService)?.[1]).toBe(globalAgentEvidenceScmService)
    expect(singletonEntries.find(([id]) => id === IAgentEvidenceTestingService)?.[1]).toBe(globalAgentEvidenceTestingService)
    expect(singletonEntries.find(([id]) => id === IAgentEvidenceProgressService)?.[1]).toBe(globalAgentEvidenceProgressService)
    expect(singletonEntries.find(([id]) => id === IAgentEvidenceNotificationService)?.[1]).toBe(globalAgentEvidenceNotificationService)
    expect(singletonEntries.find(([id]) => id === ITimelineService)?.[1]).toBe(globalAgentEvidenceTimelineService)
    expect(singletonEntries.find(([id]) => id === ISCMService)?.[1]).toBe(globalAgentEvidenceScmService)
    expect(singletonEntries.find(([id]) => id === ITestService)?.[1]).toBe(globalAgentEvidenceTestingService)
    expect(singletonEntries.find(([id]) => id === IProgressService)?.[1]).toBe(globalAgentEvidenceProgressService)
    expect(singletonEntries.find(([id]) => id === INotificationService)?.[1]).toBe(globalAgentEvidenceNotificationService)
    expect(globalAgentEvidenceTimelineService).toBe(globalAgentEvidenceScmService)
    expect(globalAgentEvidenceTestingService).toBe(globalAgentEvidenceScmService)
    expect(globalAgentEvidenceProgressService).toBe(globalAgentEvidenceScmService)
    expect(globalAgentEvidenceNotificationService).toBe(globalAgentEvidenceScmService)
  })

  it("redacts token-like values and raw content from the workbench report", () => {
    const surface = buildAgentEvidenceWorkbenchSurface(sampleSummary({
      report: {
        ...sampleSummary().report!,
        workspace: {
          root: "D:/Workspace/REDACTION_TEST_PROJECT_SECRET",
          protected: true,
          isolation: "agent-worktree token=abc123456789",
        },
        correlationId: "run REDACTION_TEST_LIVE_SECRET",
        commands: [
          { command: "curl -H Authorization: Bearer REDACTION_TEST_TOKEN", source: "qualityGate", status: "failed", exitCode: 1, artifactIds: ["artifact:secret"] },
        ],
        artifacts: [
          { id: "artifact:secret", kind: "log", label: "contains raw file content", path: ".codek/reports/secret-token.txt", source: "taskRuns" },
        ],
        failureCauses: [
          { id: "failure:secret", severity: "error", title: "token leaked", detail: "rawContent=REDACTION_TEST_FILE_BODY password=REDACTION_TEST_PASSWORD", source: "taskRuns", stage: "tests" },
        ],
        nextActions: [],
        progress: [
          { id: "progress:secret", title: "Authorization sk-test", message: "Bearer REDACTION_TEST_TOKEN", stage: "tests", status: "blocked", correlationId: "token-secret", total: 1, worked: 0, location: "notification", cancellable: false },
        ],
        notifications: [
          { id: "notification:secret", severity: "error", message: "api_key=REDACTION_TEST_VALUE", source: "Agent Evidence", correlationId: "token-secret", lifecycle: { state: "active", sticky: true, updatedAt: 990, dismissible: true }, actions: [] },
        ],
      },
    }), { createdAt: 1500 })
    const serialized = JSON.stringify(surface)

    expect(serialized).not.toMatch(/REDACTION_TEST_PROJECT_SECRET|sk-live-secret|Bearer abcdef|api_key=abcdef|REDACTION_TEST_PASSWORD|REDACTION_TEST_FILE_BODY/)
    expect(serialized).toContain("[redacted]")
  })

  it("registers low-conflict workbench views, menus and command actions", async () => {
    registerDefaultWorkbenchViews()
    const openSurface = vi.fn()
    const disposable = registerAgentEvidenceWorkbenchContributions({ openSurface })

    const context = { agentEvidenceAvailable: true }
    expect(getViewContainers("activityBar", context).map((container) => container.id)).toEqual(expect.arrayContaining([
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container,
      "workbench.view.testing",
    ]))
    expect(getViews(AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Container, context).map((view) => view.id)).toEqual([
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Timeline,
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Progress,
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Notifications,
    ])
    expect(getViews("workbench.view.scm", context).map((view) => view.id)).toContain(AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Scm)
    expect(getViews("workbench.view.testing", context).map((view) => view.id)).toContain(AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Testing)

    expect(getCommand(AGENT_EVIDENCE_COMMAND_IDS.OpenTimeline)?.title).toBe("打开智能体证据时间线")
    expect(getCommand(AGENT_EVIDENCE_COMMAND_IDS.StageResource)?.title).toContain("不写 Git index")
    const commandPaletteIds = MenuRegistry.getMenuEntries(MenuId.CommandPalette, context)
      .map((entry) => entry.type === "item" ? entry.commandId : entry.id)
    expect(commandPaletteIds).toEqual(expect.arrayContaining([
      AGENT_EVIDENCE_COMMAND_IDS.OpenTimeline,
      AGENT_EVIDENCE_COMMAND_IDS.OpenScm,
      AGENT_EVIDENCE_COMMAND_IDS.OpenTesting,
      AGENT_EVIDENCE_COMMAND_IDS.OpenProgress,
      AGENT_EVIDENCE_COMMAND_IDS.OpenNotifications,
      AGENT_EVIDENCE_COMMAND_IDS.OpenDetail,
      AGENT_EVIDENCE_COMMAND_IDS.ExportJson,
      AGENT_EVIDENCE_COMMAND_IDS.ExportMarkdown,
    ]))
    expect(MenuRegistry.getMenuEntries(MenuId.ViewTitle, { view: AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Scm, agentEvidenceAvailable: true }).map((entry) => entry.type === "item" ? entry.commandId : entry.id)).toEqual(expect.arrayContaining([
      AGENT_EVIDENCE_COMMAND_IDS.OpenScm,
    ]))
    expect(MenuRegistry.getMenuEntries(MenuId.ViewTitle, { view: AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Progress, agentEvidenceAvailable: true }).map((entry) => entry.type === "item" ? entry.commandId : entry.id)).toEqual(expect.arrayContaining([
      AGENT_EVIDENCE_COMMAND_IDS.OpenProgress,
      AGENT_EVIDENCE_COMMAND_IDS.CancelProgress,
      AGENT_EVIDENCE_COMMAND_IDS.ImportManualUiEvidence,
    ]))
    expect(MenuRegistry.getMenuEntries(MenuId.ViewTitle, { view: AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Notifications, agentEvidenceAvailable: true }).map((entry) => entry.type === "item" ? entry.commandId : entry.id)).toEqual(expect.arrayContaining([
      AGENT_EVIDENCE_COMMAND_IDS.OpenNotifications,
      AGENT_EVIDENCE_COMMAND_IDS.DismissNotification,
    ]))
    expect(MenuRegistry.getMenuEntries(MenuId.SCMTitle, context).map((entry) => entry.type === "item" ? entry.commandId : entry.id)).toEqual(expect.arrayContaining([
      AGENT_EVIDENCE_COMMAND_IDS.OpenScm,
      AGENT_EVIDENCE_COMMAND_IDS.OpenResource,
      AGENT_EVIDENCE_COMMAND_IDS.DiffResource,
      AGENT_EVIDENCE_COMMAND_IDS.StageResource,
      AGENT_EVIDENCE_COMMAND_IDS.DiscardResource,
      AGENT_EVIDENCE_COMMAND_IDS.AttachResource,
      AGENT_EVIDENCE_COMMAND_IDS.ReviewRollback,
    ]))
    expect(MenuRegistry.getMenuEntries(MenuId.TestItem, context).map((entry) => entry.type === "item" ? entry.commandId : entry.id)).toEqual(expect.arrayContaining([
      AGENT_EVIDENCE_COMMAND_IDS.OpenTesting,
      AGENT_EVIDENCE_COMMAND_IDS.ReviewTests,
    ]))
    expect(MenuRegistry.getMenuEntries(MenuId.AgentEvidenceTimeline, context).map((entry) => entry.type === "item" ? entry.commandId : entry.id)).toEqual(expect.arrayContaining([
      AGENT_EVIDENCE_COMMAND_IDS.OpenTimeline,
      AGENT_EVIDENCE_COMMAND_IDS.OpenDetail,
    ]))

    const contribution = getAgentEvidenceWorkbenchContributionSummary()
    expect(contribution).toEqual(expect.objectContaining({
      serviceId: "agentEvidenceWorkbenchService",
      stateSource: "agentEvidenceWorkbenchService",
      vscodeServiceIds: ["timeline", "scm", "testService", "progressService", "notificationService"],
      surfaces: ["timeline", "scm", "testing", "progress", "notifications"],
      constraints: expect.objectContaining({
        releaseEvidenceSingleSource: true,
        action2MenuDriven: true,
        noSecondEvidenceState: true,
      }),
    }))
    expect(contribution.viewIds).toEqual(expect.arrayContaining([
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Scm,
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Testing,
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Timeline,
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Progress,
      AGENT_EVIDENCE_WORKBENCH_VIEW_IDS.Notifications,
    ]))
    expect(contribution.commandIds).toEqual(expect.arrayContaining(Object.values(AGENT_EVIDENCE_COMMAND_IDS)))
    expect(contribution.actionIds).toEqual(contribution.commandIds)
    expect(contribution.menuIds).toEqual(expect.arrayContaining([
      "CommandPalette",
      "ViewTitle",
      "SCMTitle",
      "TestItem",
      "AgentEvidenceTimeline",
    ]))

    expect(await executeCommand(AGENT_EVIDENCE_COMMAND_IDS.OpenTesting, [], { agentEvidenceAvailable: true })).toBe(true)
    expect(openSurface).toHaveBeenCalledWith("testing")
    expect(await executeCommand(AGENT_EVIDENCE_COMMAND_IDS.OpenResource, ["src/app.ts"], { agentEvidenceAvailable: true })).toBe(true)
    expect(openSurface).toHaveBeenCalledWith("scm")
    expect(await executeCommand(AGENT_EVIDENCE_COMMAND_IDS.CancelProgress, ["progress:tests"], { agentEvidenceAvailable: true })).toBe(true)
    expect(openSurface).toHaveBeenCalledWith("progress")
    expect(await executeCommand(AGENT_EVIDENCE_COMMAND_IDS.DismissNotification, ["notification:quality-gate"], { agentEvidenceAvailable: true })).toBe(true)
    expect(openSurface).toHaveBeenCalledWith("notifications")

    disposable.dispose()
    expect(await executeCommand(AGENT_EVIDENCE_COMMAND_IDS.OpenTesting, [], { agentEvidenceAvailable: true })).toBe(false)
  })
})
