import { describe, expect, it, vi } from "vitest"
import type { RunConfig } from "../components/debugState"
import { buildTaskRunEvidence, createTaskRunPlan, runTaskPlan } from "./taskRunner"

function config(id: string, command: string, dependsOn?: string[]): RunConfig {
  return {
    id,
    name: `Task: ${id}`,
    type: "custom",
    command,
    workingDir: "${workspaceFolder}",
    source: "workspace",
    dependsOn,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("taskRunner", () => {
  it("orders dependsOn tasks before the requested root task", () => {
    const clean = config("clean", "npm run clean")
    const build = config("build", "npm run build", ["clean"])

    const plan = createTaskRunPlan([build, clean], build)

    expect(plan.blocked).toEqual([])
    expect(plan.steps.map((step) => step.config.id)).toEqual(["clean", "build"])
  })

  it("blocks missing dependency tasks with a Chinese reason", () => {
    const build = config("build", "npm run build", ["clean"])

    const plan = createTaskRunPlan([build], build)

    expect(plan.blocked).toEqual(["找不到依赖任务: clean"])
    expect(plan.steps.map((step) => step.config.id)).toEqual(["build"])
  })

  it("runs plan steps in order and skips remaining steps after a failure", async () => {
    const clean = config("clean", "npm run clean")
    const build = config("build", "npm run build", ["clean"])
    const test = config("test", "npm run test", ["build"])
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ stdout: "clean", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "failed", exitCode: 1 })

    const plan = createTaskRunPlan([clean, build, test], test)
    await runTaskPlan(plan, { workspaceFolder: "D:/Workspace", runCommand })

    expect(runCommand).toHaveBeenCalledTimes(2)
    expect(plan.steps.map((step) => [step.config.id, step.status, step.exitCode])).toEqual([
      ["clean", "passed", 0],
      ["build", "failed", 1],
      ["test", "skipped", null],
    ])
  })

  it("emits VS Code TaskSystem lifecycle projection with one run and execution identity", async () => {
    const build = config("build", "npm run build")
    const events: Array<{ type: string; runId: string; executionId: string; runType: string; terminalId: number | null }> = []

    const plan = createTaskRunPlan([build], build)
    await runTaskPlan(plan, {
      workspaceFolder: "D:/Workspace",
      runCommand: vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 }),
      onDidStateChange: (event) => {
        events.push({
          type: event.type,
          runId: event.runId,
          executionId: event.executionId,
          runType: event.runType,
          terminalId: event.terminalId,
        })
      },
    })

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "processStarted",
      "processEnded",
      "end",
    ])
    expect(new Set(events.map((event) => event.runId)).size).toBe(1)
    expect(new Set(events.map((event) => event.executionId)).size).toBe(1)
    expect(events[0]).toEqual(expect.objectContaining({
      runType: "singleRun",
      terminalId: null,
    }))
  })

  it("projects terminal/process owner ids only when the execution owner returns evidence", async () => {
    const build = config("build", "npm run build")
    const events: Array<{ type: string; terminalId: number | null; processId: number | null }> = []

    const plan = createTaskRunPlan([build], build)
    await runTaskPlan(plan, {
      workspaceFolder: "D:/Workspace",
      runCommand: vi.fn().mockResolvedValue({
        stdout: "ok",
        stderr: "",
        exitCode: 0,
        terminalId: 7,
        processId: 4321,
      }),
      onDidStateChange: (event) => {
        events.push({
          type: event.type,
          terminalId: event.terminalId,
          processId: event.processId,
        })
      },
    })

    expect(events).toEqual([
      { type: "start", terminalId: null, processId: null },
      { type: "processStarted", terminalId: null, processId: null },
      { type: "processStarted", terminalId: 7, processId: 4321 },
      { type: "processEnded", terminalId: 7, processId: 4321 },
      { type: "end", terminalId: 7, processId: 4321 },
    ])
  })

  it("accepts terminalInstanceId as the provider execution owner id", async () => {
    const build = config("build", "npm run build")
    const events: Array<{ type: string; terminalId: number | null; processId: number | null }> = []

    const plan = createTaskRunPlan([build], build)
    await runTaskPlan(plan, {
      workspaceFolder: "D:/Workspace",
      runCommand: vi.fn().mockResolvedValue({
        stdout: "ok",
        stderr: "",
        exitCode: 0,
        terminalInstanceId: 17,
        processId: 1701,
      }),
      onDidStateChange: (event) => {
        events.push({
          type: event.type,
          terminalId: event.terminalId,
          processId: event.processId,
        })
      },
    })

    expect(events).toEqual([
      { type: "start", terminalId: null, processId: null },
      { type: "processStarted", terminalId: null, processId: null },
      { type: "processStarted", terminalId: 17, processId: 1701 },
      { type: "processEnded", terminalId: 17, processId: 1701 },
      { type: "end", terminalId: 17, processId: 1701 },
    ])
  })

  it("builds serializable evidence for release reports and agents", async () => {
    const clean = config("clean", "npm run clean")
    const build = config("build", "npm run build", ["clean"])
    const plan = createTaskRunPlan([clean, build], build)

    await runTaskPlan(plan, {
      workspaceFolder: "D:/Workspace",
      runCommand: vi.fn()
        .mockResolvedValueOnce({ stdout: "clean output", stderr: "", exitCode: 0 })
        .mockResolvedValueOnce({ stdout: "build output", stderr: "", exitCode: 0 }),
    })

    const evidence = buildTaskRunEvidence(plan)

    expect(evidence).toMatchObject({
      id: "build",
      name: "Task: build",
      status: "passed",
      blocked: [],
      summary: "任务完成：2 个步骤全部通过",
    })
    expect(evidence.steps.map((step) => [step.id, step.status, step.exitCode, step.outputPreview])).toEqual([
      ["clean", "passed", 0, "clean output"],
      ["build", "passed", 0, "build output"],
    ])
    expect(JSON.parse(JSON.stringify(evidence)).status).toBe("passed")
  })

  it("runs parallel dependencies by dependency depth before the root task", async () => {
    const lint = config("lint", "npm run lint")
    const typecheck = config("typecheck", "npm run typecheck")
    const build = {
      ...config("build", "npm run build", ["lint", "typecheck"]),
      dependsOrder: "parallel" as const,
    }
    const events: string[] = []
    const runCommand = vi.fn(async (item: RunConfig) => {
      events.push(`start:${item.id}`)
      if (item.id === "lint" || item.id === "typecheck") await delay(20)
      events.push(`finish:${item.id}`)
      return { stdout: item.id, stderr: "", exitCode: 0 }
    })

    const plan = createTaskRunPlan([lint, typecheck, build], build)
    await runTaskPlan(plan, { workspaceFolder: "D:/Workspace", runCommand })

    expect(runCommand).toHaveBeenCalledTimes(3)
    expect(events.slice(0, 2).sort()).toEqual(["start:lint", "start:typecheck"])
    expect(events.indexOf("start:build")).toBeGreaterThan(events.indexOf("finish:lint"))
    expect(events.indexOf("start:build")).toBeGreaterThan(events.indexOf("finish:typecheck"))
    expect(plan.steps.map((step) => [step.config.id, step.status, step.runMode, step.dependencyDepth])).toEqual([
      ["lint", "passed", "parallel", 0],
      ["typecheck", "passed", "parallel", 0],
      ["build", "passed", "sequence", 1],
    ])
  })

  it("skips the root task when a parallel dependency fails", async () => {
    const lint = config("lint", "npm run lint")
    const typecheck = config("typecheck", "npm run typecheck")
    const build = {
      ...config("build", "npm run build", ["lint", "typecheck"]),
      dependsOrder: "parallel" as const,
    }

    const plan = createTaskRunPlan([lint, typecheck, build], build)
    await runTaskPlan(plan, {
      workspaceFolder: "D:/Workspace",
      runCommand: vi.fn(async (item: RunConfig) => ({
        stdout: "",
        stderr: item.id === "lint" ? "lint failed" : "",
        exitCode: item.id === "lint" ? 1 : 0,
      })),
    })

    expect(plan.steps.map((step) => [step.config.id, step.status, step.exitCode])).toEqual([
      ["lint", "failed", 1],
      ["typecheck", "passed", 0],
      ["build", "skipped", null],
    ])
    expect(buildTaskRunEvidence(plan).status).toBe("failed")
  })

  it("tracks background problem matcher begin and end events", async () => {
    const watch: RunConfig = {
      ...config("watch", "npm run watch"),
      isBackground: true,
      problemMatchers: [{
        id: "watch",
        owner: "typescript",
        source: "TypeScript",
        fileLocation: "relative",
        filePrefix: "D:/Workspace",
        pattern: {
          regexp: /^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/,
          file: 1,
          line: 2,
          column: 3,
          severity: 4,
          code: 5,
          message: 6,
        },
        background: {
          activeOnStart: true,
          beginsPattern: /Starting compilation/,
          endsPattern: /Watching for file changes/,
        },
      }],
    }
    const plan = createTaskRunPlan([watch], watch)
    await runTaskPlan(plan, {
      workspaceFolder: "D:/Workspace",
      runCommand: vi.fn().mockResolvedValue({
        stdout: "Starting compilation\nWatching for file changes",
        stderr: "",
        exitCode: 0,
      }),
    })

    const evidence = buildTaskRunEvidence(plan)

    expect(plan.steps[0].background).toMatchObject({
      active: false,
      beginsMatched: true,
      endsMatched: true,
    })
    expect(evidence.steps[0]).toMatchObject({
      backgroundStatus: "ended",
      backgroundBeginsMatched: true,
      backgroundEndsMatched: true,
    })
  })

  it("keeps long running background tasks active after begin events", async () => {
    const watch: RunConfig = {
      ...config("watch", "npm run watch"),
      isBackground: true,
      problemMatchers: [{
        id: "watch",
        owner: "typescript",
        source: "TypeScript",
        fileLocation: "relative",
        filePrefix: "D:/Workspace",
        pattern: {
          regexp: /^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/,
          file: 1,
          line: 2,
          column: 3,
          severity: 4,
          code: 5,
          message: 6,
        },
        background: {
          activeOnStart: false,
          beginsPattern: /Starting compilation/,
          endsPattern: /Watching for file changes/,
        },
      }],
    }
    const plan = createTaskRunPlan([watch], watch)
    await runTaskPlan(plan, {
      workspaceFolder: "D:/Workspace",
      runCommand: vi.fn().mockResolvedValue({
        stdout: "Starting compilation",
        stderr: "",
        exitCode: 0,
      }),
    })

    const evidence = buildTaskRunEvidence(plan)

    expect(evidence.steps[0]).toMatchObject({
      status: "passed",
      backgroundStatus: "active",
      backgroundBeginsMatched: true,
      backgroundEndsMatched: false,
    })
  })

  it("records timed out command results as failed task evidence", async () => {
    const build = config("build", "npm run build")
    const plan = createTaskRunPlan([build], build)

    await runTaskPlan(plan, {
      workspaceFolder: "D:/Workspace",
      runCommand: vi.fn().mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: true,
      }),
    })

    const evidence = buildTaskRunEvidence(plan)

    expect(evidence.status).toBe("failed")
    expect(evidence.summary).toBe("任务失败：Task: build 执行超时")
    expect(evidence.steps[0]).toMatchObject({
      status: "failed",
      timedOut: true,
      cancelled: false,
      failureReason: "执行超时",
    })
  })

  it("honors cancellation before starting the next task and keeps evidence attributable", async () => {
    const clean = config("clean", "npm run clean")
    const build = config("build", "npm run build", ["clean"])
    const controller = new AbortController()
    const runCommand = vi.fn(async () => {
      controller.abort()
      return { stdout: "clean", stderr: "", exitCode: 0 }
    })

    const plan = createTaskRunPlan([clean, build], build)
    await runTaskPlan(plan, {
      workspaceFolder: "D:/Workspace",
      runCommand,
      signal: controller.signal,
    })

    const evidence = buildTaskRunEvidence(plan)

    expect(runCommand).toHaveBeenCalledTimes(1)
    expect(plan.steps.map((step) => [step.config.id, step.status, step.exitCode, step.cancelled])).toEqual([
      ["clean", "passed", 0, undefined],
      ["build", "cancelled", null, true],
    ])
    expect(evidence).toMatchObject({
      status: "cancelled",
      summary: "任务已取消：Task: build",
    })
    expect(evidence.steps[1]).toMatchObject({
      status: "cancelled",
      cancelled: true,
      failureReason: "任务已取消",
    })
  })

  it("projects terminated lifecycle event when cancellation prevents a task from starting", async () => {
    const build = config("build", "npm run build")
    const controller = new AbortController()
    controller.abort()
    const events: string[] = []

    const plan = createTaskRunPlan([build], build)
    await runTaskPlan(plan, {
      workspaceFolder: "D:/Workspace",
      runCommand: vi.fn(),
      signal: controller.signal,
      onDidStateChange: (event) => events.push(event.type),
    })

    expect(events).toEqual(["terminated"])
    expect(buildTaskRunEvidence(plan)).toMatchObject({
      status: "cancelled",
      summary: "任务已取消：Task: build",
    })
  })
})
