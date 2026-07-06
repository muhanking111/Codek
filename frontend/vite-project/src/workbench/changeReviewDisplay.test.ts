import { describe, expect, it } from "vitest"
import { createChangeReviewBatchModel, createOperationLogModels, createScmAgentChangeSetModels } from "./changeReviewDisplay"

describe("change review display model", () => {
  it("shows manual-change blocked state with affected path and safe actions", () => {
    const model = createChangeReviewBatchModel({
      id: "batch-1",
      title: "agent patch",
      source: "agent",
      action: "patch",
      applyStatus: "blocked",
      blockReason: "manual-change-detected",
      blockedPath: "src/app.ts",
      changes: [{
        path: "src/app.ts",
        action: "patch",
        beforeContent: "const a = 1",
        afterContent: "const a = 2",
      }],
    })

    expect(model.status).toBe("blocked")
    expect(model.message).toMatchObject({
      kind: "blocked",
      path: "src/app.ts",
      title: "检测到用户手动修改，已暂停应用",
    })
    expect(model.files[0]).toMatchObject({
      path: "src/app.ts",
      canApply: false,
      canReject: true,
      hunkCount: 1,
    })
  })

  it("keeps unaffected files individually applicable when a different file is blocked", () => {
    const model = createChangeReviewBatchModel({
      id: "batch-1",
      title: "agent patch",
      source: "agent",
      action: "patch",
      applyStatus: "blocked",
      blockReason: "manual-change-detected",
      blockedPath: "src/app.ts",
      changes: [
        {
          path: "src/app.ts",
          action: "patch",
          beforeContent: "const a = 1",
          afterContent: "const a = 2",
        },
        {
          path: "src/other.ts",
          action: "patch",
          beforeContent: "const b = 1",
          afterContent: "const b = 2",
        },
      ],
    })

    expect(model.files.find((file) => file.path === "src/app.ts")?.canApply).toBe(false)
    expect(model.files.find((file) => file.path === "src/other.ts")?.canApply).toBe(true)
  })

  it("builds explicit agent operation log models instead of presenting history as git diff", () => {
    const models = createOperationLogModels([{
      id: "op-1",
      type: "update_file",
      source: "agent",
      agentId: "agent-a",
      runId: "run-1",
      pathBefore: "src/app.ts",
      pathAfter: "src/app.ts",
      beforeContent: "before",
      afterContent: "after",
      reason: "agent write",
      riskLevel: "medium",
      applyStatus: "rollback_blocked",
      rollbackError: "manual-change-detected",
      timestamp: 1000,
    }])

    expect(models[0]).toMatchObject({
      id: "op-1",
      title: "智能体变更集",
      badge: "智能体操作记录",
      sourceKind: "agent",
      sourceLabel: "智能体",
      operationLabel: "更新文件",
      primaryPath: "src/app.ts",
      pathBefore: "src/app.ts",
      pathAfter: "src/app.ts",
      agentId: "agent-a",
      runId: "run-1",
      riskLabel: "中风险",
      statusLabel: "回滚被阻止",
      rollbackBlocked: true,
      blockedReasonLabel: "检测到手动修改",
      canRevert: false,
      isGitDiff: false,
    })
  })

  it("labels user operations separately from agent change sets", () => {
    const models = createOperationLogModels([{
      id: "op-2",
      type: "create_file",
      source: "user",
      pathBefore: null,
      pathAfter: "src/manual.ts",
      beforeContent: null,
      afterContent: "manual",
      reason: "inline create",
      riskLevel: "safe",
      applyStatus: "applied",
      timestamp: 1000,
    }])

    expect(models[0]).toMatchObject({
      title: "用户操作",
      badge: "工作台操作记录",
      sourceKind: "user",
      sourceLabel: "用户",
      operationLabel: "创建文件",
      primaryPath: "src/manual.ts",
      riskLabel: "安全",
      statusLabel: "已应用",
      canRevert: true,
      isGitDiff: false,
    })
  })

  it("builds SCM agent change set models without mixing user workbench operations", () => {
    const models = createScmAgentChangeSetModels([
      {
        id: "agent-op",
        type: "update_file",
        source: "agent",
        agentId: "agent-a",
        runId: "run-1",
        pathBefore: "src/app.ts",
        pathAfter: "src/app.ts",
        beforeContent: "old",
        afterContent: "new",
        riskLevel: "medium",
        applyStatus: "rollback_blocked",
        rollbackError: "manual-change-detected",
      },
      {
        id: "user-op",
        type: "create_file",
        source: "user",
        pathAfter: "src/manual.ts",
        beforeContent: null,
        afterContent: "manual",
        riskLevel: "safe",
        applyStatus: "applied",
      },
    ])

    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      id: "agent-op",
      title: "智能体变更集",
      badge: "智能体操作记录",
      sourceKind: "agent",
      sourceLabel: "智能体",
      statusLabel: "回滚被阻止",
      rollbackBlocked: true,
      blockedReasonLabel: "检测到手动修改",
      isGitDiff: false,
    })
  })
})
