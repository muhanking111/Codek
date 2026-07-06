const test = require("node:test")
const assert = require("node:assert/strict")

const integrator = require("./integrator")

test("integrator includes patch artifact content in proposedPatch", () => {
  const decision = integrator.createIntegrationDecision({
    runId: "run_patch",
    assignments: [{ id: "a1", writePaths: [] }],
    artifacts: [
      {
        id: "artifact_1",
        assignmentId: "a1",
        type: "patch",
        content: "diff --git a/src/a.js b/src/a.js\n",
        metadata: { filesChanged: ["src/a.js"] },
      },
    ],
  })

  assert.equal(decision.status, "pending")
  assert.deepEqual(decision.proposedPatch.filesChanged, ["src/a.js"])
  assert.equal(decision.proposedPatch.patches.length, 1)
  assert.equal(decision.proposedPatch.patches[0].content, "diff --git a/src/a.js b/src/a.js\n")
})

test("integrator detects conflicts from patch artifact metadata", () => {
  const decision = integrator.createIntegrationDecision({
    runId: "run_conflict_patch",
    assignments: [{ id: "a1", writePaths: [] }, { id: "a2", writePaths: [] }],
    artifacts: [
      {
        id: "artifact_1",
        assignmentId: "a1",
        type: "patch",
        content: "diff --git a/src/shared.js b/src/shared.js\n",
        metadata: { filesChanged: ["src/shared.js"] },
      },
      {
        id: "artifact_2",
        assignmentId: "a2",
        type: "patch",
        content: "diff --git a/src/shared.js b/src/shared.js\n",
        metadata: { filesChanged: ["src/shared.js"] },
      },
    ],
  })

  assert.equal(decision.status, "pending")
  assert.equal(decision.conflicts.length, 1)
  assert.equal(decision.conflicts[0].file, "src/shared.js")
  assert.deepEqual(decision.conflicts[0].assignments, ["a1", "a2"])
})

test("integrator builds a multi-agent worktree merge strategy for main-thread review", () => {
  const decision = integrator.createIntegrationDecision({
    runId: "run_multi_worktree",
    assignments: [
      {
        id: "agent_impl",
        phaseId: "phase_impl",
        role: "implementer",
        writePaths: ["src/shared.js"],
        workspace: {
          id: "wt_impl",
          path: "C:/codek/.codex/worktrees/impl",
          isolation: "git-worktree",
          baseRef: "main",
          headRef: "impl-head",
        },
      },
      {
        id: "agent_tests",
        phaseId: "phase_tests",
        role: "tester",
        writePaths: ["src/shared.js", "src/shared.test.js"],
        workspace: {
          id: "wt_tests",
          path: "C:/codek/.codex/worktrees/tests",
          isolation: "git-worktree",
          baseRef: "main",
          headRef: "tests-head",
        },
      },
    ],
    artifacts: [
      {
        id: "patch_impl",
        assignmentId: "agent_impl",
        type: "patch",
        content: "diff --git a/src/shared.js b/src/shared.js\n",
        metadata: { filesChanged: ["src/shared.js"], evidenceRefs: ["report:impl"] },
      },
      {
        id: "patch_tests",
        assignmentId: "agent_tests",
        type: "patch",
        content: "diff --git a/src/shared.js b/src/shared.js\n",
        metadata: { filesChanged: ["src/shared.js", "src/shared.test.js"], evidenceRefs: ["report:tests"] },
      },
    ],
    qualityGate: {
      status: "failed",
      commandResults: [
        { command: "npm run typecheck", status: "passed", exitCode: 0, durationMs: 1200, artifactId: "gate:typecheck" },
        { command: "npm test -- src/shared.test.js", status: "failed", exitCode: 1, durationMs: 800, artifactId: "gate:test" },
      ],
    },
    mergeEvidence: {
      preMerge: {
        gitHead: "main",
        stagedFiles: [],
        dirtyFiles: [],
        reportRefs: ["report:impl", "report:tests"],
      },
      postMerge: {
        status: "not_run",
        reportRefs: [],
      },
    },
    validationCommands: ["npm run typecheck", "npm test -- src/shared.test.js", "npm run check:vscode-source-boundary"],
  })

  assert.equal(decision.status, "pending")
  assert.equal(decision.worktreeMergeStrategy.status, "blocked")
  assert.equal(decision.worktreeMergeStrategy.conflictSummary.status, "conflicted")
  assert.deepEqual(decision.worktreeMergeStrategy.conflictSummary.files, ["src/shared.js"])
  assert.equal(decision.worktreeMergeStrategy.validationMatrix.summary.total, 3)
  assert.equal(decision.worktreeMergeStrategy.validationMatrix.summary.failed, 1)
  assert.equal(decision.worktreeMergeStrategy.validationMatrix.commands[2].status, "not_run")
  assert.equal(decision.worktreeMergeStrategy.evidence.preMerge.gitHead, "main")
  assert.equal(decision.worktreeMergeStrategy.evidence.postMerge.status, "not_run")
  assert.deepEqual(
    decision.worktreeMergeStrategy.failureClassification.map((item) => item.id),
    ["workspace_conflict", "quality_gate_failed", "validation_not_run"],
  )
  assert.equal(decision.worktreeMergeStrategy.mainThreadDecision.required, true)
  assert.equal(decision.worktreeMergeStrategy.mainThreadDecision.recommendedAction, "rework")
  assert.deepEqual(decision.worktreeMergeStrategy.mainThreadDecision.requiredFields, [
    "conflictSummary",
    "validationMatrix",
    "preMergeEvidence",
    "postMergeEvidence",
    "failureClassification",
    "proposedPatch",
  ])
})

test("integrator marks validated non-conflicting worktree patches ready for human accept", () => {
  const decision = integrator.createIntegrationDecision({
    runId: "run_ready_for_accept",
    assignments: [
      {
        id: "agent_impl",
        writePaths: ["src/app.js"],
        workspace: { id: "wt_impl", isolation: "git-worktree", path: "C:/codek/.codex/worktrees/impl" },
      },
    ],
    artifacts: [
      {
        id: "patch_impl",
        assignmentId: "agent_impl",
        type: "patch",
        content: "diff --git a/src/app.js b/src/app.js\n",
        metadata: { filesChanged: ["src/app.js"] },
      },
    ],
    qualityGate: {
      status: "passed",
      commandResults: [{ command: "npm run typecheck", status: "passed", exitCode: 0 }],
    },
    validationCommands: ["npm run typecheck"],
    mergeEvidence: {
      preMerge: { gitHead: "main", stagedFiles: [], dirtyFiles: ["src/app.js"] },
      postMerge: { status: "simulated", dirtyFiles: ["src/app.js"], reportRefs: ["report:merge-preview"] },
    },
  })

  assert.equal(decision.worktreeMergeStrategy.status, "ready_for_accept")
  assert.deepEqual(decision.worktreeMergeStrategy.failureClassification, [])
  assert.equal(decision.worktreeMergeStrategy.mainThreadDecision.required, true)
  assert.equal(decision.worktreeMergeStrategy.mainThreadDecision.recommendedAction, "accept")
})

test("integrator exposes a proposal-only delivery contract before accept", () => {
  const decision = integrator.createIntegrationDecision({
    runId: "run_single_agent_proposal",
    executionStrategy: "single-agent",
    plan: {
      title: "单 Agent 修复计划",
      summary: "修改 src/app.js 并运行语法检查",
      phases: [
        { id: "phase_1", name: "实现改动", tasks: [{ description: "更新 src/app.js", files: ["src/app.js"] }] },
      ],
    },
    assignments: [{ id: "a1", writePaths: ["src/app.js"] }],
    artifacts: [
      {
        id: "artifact_patch",
        assignmentId: "a1",
        type: "patch",
        content: "diff --git a/src/app.js b/src/app.js\n",
        metadata: { filesChanged: ["src/app.js"] },
      },
      {
        id: "artifact_note",
        assignmentId: "a1",
        type: "artifact",
        content: "验证摘要",
        metadata: { kind: "verification-summary" },
      },
    ],
    qualityGate: { status: "not_run", summary: "Accept 前不运行写入后质量门", commandResults: [] },
  })

  assert.equal(decision.status, "pending")
  assert.equal(decision.proposalOnlyDelivery.mode, "proposal-only")
  assert.equal(decision.proposalOnlyDelivery.mainWorkspaceWrite, false)
  assert.equal(decision.proposalOnlyDelivery.requiresAcceptBeforeApply, true)
  assert.equal(decision.proposalOnlyDelivery.executionStrategy, "single-agent")
  assert.equal(decision.proposalOnlyDelivery.plan.phaseCount, 1)
  assert.equal(decision.proposalOnlyDelivery.plan.taskCount, 1)
  assert.equal(decision.proposalOnlyDelivery.proposedDiff.patchCount, 1)
  assert.equal(decision.proposalOnlyDelivery.artifacts.total, 2)
  assert.equal(decision.proposalOnlyDelivery.verification.status, "not_run")
  assert.deepEqual(decision.proposalOnlyDelivery.decisionEvidence.availableActions, [
    "accepted",
    "rework_requested",
    "rejected",
    "rollback",
  ])
  assert.equal(decision.proposalOnlyDelivery.decisionEvidence.accept.status, "requires_explicit_accept")
  assert.equal(decision.proposalOnlyDelivery.decisionEvidence.rollback.status, "available_after_accept")
})
