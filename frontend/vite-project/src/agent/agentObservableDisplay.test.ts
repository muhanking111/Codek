import { describe, expect, it } from "vitest"
import { buildAgentObservableDisplay } from "./agentObservableDisplay"
import type { OrchestratorRun } from "./orchestratorClient"

function createRun(overrides: Partial<OrchestratorRun> = {}): OrchestratorRun {
  return {
    id: "run-1",
    projectRoot: "D:/apps/codek",
    status: "running",
    runtimeStatus: "running",
    visibleMode: "agent",
    executionStrategy: "multi-agent",
    strategyReason: "任务需要拆分为实现和验证两个阶段",
    assignments: [
      {
        id: "agent-a",
        phaseId: "phase-impl",
        role: "implementer",
        status: "running",
        sandboxMode: "workspace-write",
        writePaths: ["src/app.ts"],
      },
      {
        id: "agent-b",
        phaseId: "phase-test",
        role: "tester",
        status: "queued",
        sandboxMode: "read-only",
        writePaths: ["tests/app.test.ts"],
      },
    ],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }
}

describe("agent observable display", () => {
  it("shows running agents and current stage with Chinese labels", () => {
    const display = buildAgentObservableDisplay({
      run: createRun({ runtimeReason: "正在修改 src/app.ts" }),
    })

    expect(display.summary.title).toBe("智能体正在处理任务")
    expect(display.summary.nextAction).toContain("观察当前阶段")
    expect(display.stageRows.map((row) => row.label)).toContain("当前阶段")
    expect(display.stageRows.find((row) => row.id === "running-agents")).toEqual(expect.objectContaining({
      statusLabel: "2/2",
      detail: expect.stringContaining("实现智能体:运行中"),
    }))
  })

  it("shows terminal commands, file operations and diff activities", () => {
    const display = buildAgentObservableDisplay({
      run: createRun(),
      commandAuthorization: {
        ok: false,
        total: 2,
        allowed: 1,
        blocked: 1,
        needsPermission: 0,
        commands: [
          {
            command: "npm run build",
            status: "allowed",
            reasons: [],
            capabilities: { network: false, install: false, externalTool: false },
            source: "quality-gate",
          },
          {
            command: "npm install",
            status: "blocked",
            reasons: ["安装依赖需要显式授权"],
            capabilities: { network: true, install: true, externalTool: false },
            source: "agent",
          },
        ],
      },
      events: [
        { id: "event-command", type: "command-executed", status: "completed", command: "npm run build", createdAt: 10 },
        { id: "event-file", type: "workspace-file-operation", status: "completed", path: "src/app.ts", operation: "update_file", createdAt: 11 },
        { id: "event-diff", type: "diff-available", status: "ready", summary: "2 files changed", createdAt: 12 },
      ],
      diff: {
        summary: "修改 app 和测试",
        filesChanged: ["src/app.ts", "tests/app.test.ts"],
      },
    })

    expect(display.activityRows.some((row) => row.label === "终端命令" && row.detail === "npm install" && row.severity === "danger")).toBe(true)
    expect(display.activityRows.some((row) => row.label === "文件操作" && row.detail === "src/app.ts")).toBe(true)
    expect(display.activityRows.some((row) => row.label === "变更预览" && row.statusLabel === "2 个文件")).toBe(true)
  })

  it("surfaces approval request as the primary next action", () => {
    const display = buildAgentObservableDisplay({
      run: createRun({
        runtimeStatus: "waiting_permission",
        permissionRequest: {
          id: "permission-1",
          runId: "run-1",
          status: "waiting_user",
          risk: "medium",
          readPaths: ["src"],
          writePaths: ["src/app.ts"],
          commandAllowlist: ["npm test"],
          network: false,
          install: false,
          externalTool: false,
          destructive: false,
          reason: "需要写入 src/app.ts",
          createdAt: 10,
        },
      }),
    })

    expect(display.summary.title).toBe("智能体等待权限确认")
    expect(display.summary.nextAction).toContain("允许或拒绝")
    expect(display.activityRows).toContainEqual(expect.objectContaining({
      label: "权限请求",
      statusLabel: "等待用户确认",
      severity: "warning",
    }))
    expect(display.actionRows[0]).toEqual(expect.objectContaining({
      label: "下一步",
      statusLabel: "等待权限",
    }))
  })

  it("surfaces failed quality gate command output and recovery guidance", () => {
    const display = buildAgentObservableDisplay({
      run: createRun({
        runtimeStatus: "failed",
        integrationDecision: {
          id: "decision-1",
          runId: "run-1",
          status: "blocked",
          conflicts: [],
          proposedPatch: { summary: "patch", filesChanged: ["src/app.ts"] },
          qualityGate: {
            status: "failed",
            summary: "类型检查失败",
            commandResults: [
              { command: "npm run typecheck", exitCode: 2, stderr: "Type error in src/app.ts", durationMs: 1234 },
            ],
          },
          reason: "质量门失败",
        },
      }),
      recoveryActions: [
        {
          id: "recovery-1",
          runId: "run-1",
          action: "retry",
          status: "pending",
          reason: "修复类型错误后重试",
          createdAt: 20,
        },
      ],
    })

    expect(display.summary.title).toBe("智能体质量门未通过")
    expect(display.activityRows).toContainEqual(expect.objectContaining({
      label: "质量门命令",
      statusLabel: "失败 2",
      detail: "npm run typecheck",
      severity: "danger",
    }))
    expect(display.actionRows).toContainEqual(expect.objectContaining({
      label: "修复质量门",
      severity: "danger",
    }))
    expect(display.actionRows).toContainEqual(expect.objectContaining({
      label: "重试当前阶段",
      nextAction: expect.stringContaining("刷新任务状态"),
    }))
  })

  it("shows all recovery action labels in Chinese", () => {
    const display = buildAgentObservableDisplay({
      run: createRun({ status: "failed", runtimeStatus: "failed" }),
      recoveryActions: [
        { id: "retry", runId: "run-1", action: "retry", status: "pending", reason: "retry", createdAt: 1 },
        { id: "split", runId: "run-1", action: "split", status: "pending", reason: "split", createdAt: 1 },
        { id: "ask", runId: "run-1", action: "ask_user", status: "pending", reason: "ask", createdAt: 1 },
        { id: "abort", runId: "run-1", action: "abort", status: "pending", reason: "abort", createdAt: 1 },
      ],
    })

    expect(display.actionRows.map((row) => row.label)).toEqual([
      "重试当前阶段",
      "拆分任务",
      "向用户澄清",
      "终止任务",
    ])
  })

  it("shows completed delivery evidence, changed files and artifacts", () => {
    const display = buildAgentObservableDisplay({
      run: createRun({
        status: "completed",
        runtimeStatus: "completed",
        summary: "已完成任务",
        assignments: [],
        integrationDecision: {
          id: "decision-1",
          runId: "run-1",
          status: "accepted",
          conflicts: [],
          proposedPatch: { summary: "修改 2 个文件", filesChanged: ["src/app.ts", "README.md"] },
          qualityGate: { status: "passed", summary: "全部质量门通过" },
          reason: "已通过",
        },
      }),
      artifacts: [
        { id: "artifact-1", runId: "run-1", type: "patch", path: "patch.diff", content: "diff", createdAt: 10 },
      ],
    })

    expect(display.summary.title).toBe("智能体任务已完成")
    expect(display.activityRows).toContainEqual(expect.objectContaining({
      label: "质量门",
      statusLabel: "已通过",
      severity: "success",
    }))
    expect(display.activityRows).toContainEqual(expect.objectContaining({
      label: "变更预览",
      statusLabel: "2 个文件",
    }))
    expect(display.activityRows).toContainEqual(expect.objectContaining({
      label: "交付证据",
      statusLabel: "1 个产物",
    }))
  })

  it("shows memory hits and consensus state", () => {
    const display = buildAgentObservableDisplay({
      run: createRun({
        memoryHits: [
          {
            id: "memory-1",
            type: "error",
            source: "lifecycle",
            agentRole: "tester",
            content: "上次 typecheck 失败，需要先修复 src/app.ts",
          },
        ],
        assignments: [
          {
            id: "agent-coder",
            phaseId: "phase-impl",
            role: "coder",
            status: "running",
            sandboxMode: "workspace-write",
            writePaths: ["src/app.ts"],
            requiresConsensus: true,
            consensusWith: ["reviewer", "tester"],
          },
        ],
      }),
    })

    expect(display.stageRows).toContainEqual(expect.objectContaining({
      label: "编码智能体 / 阶段 impl",
      detail: expect.stringContaining("需要共识 reviewer，tester"),
    }))
    expect(display.activityRows).toContainEqual(expect.objectContaining({
      label: "记忆命中",
      statusLabel: "1 条",
    }))
    expect(display.activityRows).toContainEqual(expect.objectContaining({
      label: "记忆",
      detail: expect.stringContaining("typecheck 失败"),
    }))
  })

  it("localizes internal orchestrator event types for user-visible rows", () => {
    const display = buildAgentObservableDisplay({
      run: createRun(),
      events: [
        { id: "event-1", type: "orchestrator:recovered interrupted", status: "failed", createdAt: 20 },
        { id: "event-2", type: "orchestrator:strategy selected", status: "unknown", createdAt: 21 },
      ],
    })

    const text = display.activityRows.map((row) => `${row.label} ${row.nextAction || ""}`).join(" ")
    expect(text).toContain("编排器恢复中断")
    expect(text).toContain("已选择执行策略")
    expect(text).not.toContain("orchestrator")
    expect(text).not.toContain("timeline")
  })
})
