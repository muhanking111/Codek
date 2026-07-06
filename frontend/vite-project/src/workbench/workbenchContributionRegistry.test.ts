import { describe, expect, it, vi } from "vitest"
import {
  WorkbenchContributionRegistry,
  createWorkbenchContributionRegistry,
  getWorkbenchContributionRegistryProjection,
  registerWorkbenchContribution,
  resetWorkbenchContributionRegistry,
  shutdownWorkbenchContributionRegistry,
  startWorkbenchContributionRegistry,
  type WorkbenchContributionContext,
  type WorkbenchContributionPhase,
} from "./workbenchContributionRegistry"
import { disposeWorkbenchResources } from "./workbenchResourceLifecycle"

function context(): WorkbenchContributionContext {
  return {
    evidence: {
      project: "D:/Workspace",
      runId: "focused-test",
    },
  }
}

describe("WorkbenchContributionRegistry", () => {
  it("starts registered contributions by phase and order", () => {
    const calls: string[] = []
    const registry = createWorkbenchContributionRegistry()

    registry.register({
      id: "eventually",
      phase: "eventually",
      order: 1,
      start: () => { calls.push("eventually") },
    })
    registry.register({
      id: "startup-late",
      phase: "startup",
      order: 20,
      start: () => { calls.push("startup-late") },
    })
    registry.register({
      id: "startup-early",
      phase: "startup",
      order: 10,
      start: () => { calls.push("startup-early") },
    })
    registry.register({
      id: "restored",
      phase: "restored",
      order: 1,
      start: () => { calls.push("restored") },
    })

    registry.start(context(), { throughPhase: "restored", now: () => 1000 })

    expect(calls).toEqual(["startup-early", "startup-late", "restored"])
    expect(registry.getProjection().lifecycle).toEqual(expect.objectContaining({
      phase: "restored",
      started: 3,
      disposed: 0,
      failed: 0,
    }))
  })

  it("starts later phases on restart without creating already started contributions again", () => {
    const calls: string[] = []
    const registry = createWorkbenchContributionRegistry()
    registry.register({ id: "startup", phase: "startup", start: () => { calls.push("startup") } })
    registry.register({ id: "eventually", phase: "eventually", start: () => { calls.push("eventually") } })

    registry.start(context(), { throughPhase: "startup", now: () => 1000 })
    registry.start(context(), { throughPhase: "eventually", now: () => 1100 })

    expect(calls).toEqual(["startup", "eventually"])
    expect(registry.getProjection().lifecycle.phase).toBe("eventually")
  })

  it("disposes started contributions in reverse startup order and keeps diagnostics", () => {
    const calls: string[] = []
    const registry = createWorkbenchContributionRegistry()
    registry.register({
      id: "first",
      phase: "startup",
      order: 1,
      start: () => {
        calls.push("start:first")
        return { dispose: () => calls.push("dispose:first") }
      },
    })
    registry.register({
      id: "second",
      phase: "startup",
      order: 2,
      start: () => {
        calls.push("start:second")
        return { dispose: () => calls.push("dispose:second") }
      },
    })

    registry.start(context(), { throughPhase: "startup", now: () => 1000 })
    const result = registry.dispose({ reason: "window-close", now: () => 1200 })

    expect(result.errors).toEqual([])
    expect(calls).toEqual(["start:first", "start:second", "dispose:second", "dispose:first"])
    expect(registry.getProjection().lifecycle).toEqual(expect.objectContaining({
      disposed: 2,
      shutdownReason: "window-close",
    }))
  })

  it("protects duplicate registration ids and projects diagnostics", () => {
    const registry = createWorkbenchContributionRegistry()

    registry.register({ id: "duplicate", phase: "startup", start: () => undefined })
    expect(() => registry.register({ id: "duplicate", phase: "restored", start: () => undefined })).toThrow(
      "Workbench contribution already registered: duplicate",
    )

    const projection = registry.getProjection()
    expect(projection.diagnostics).toEqual([
      expect.objectContaining({
        id: "duplicate",
        severity: "error",
        code: "duplicate-registration",
      }),
    ])
  })

  it("projects evidence, source metadata, timings, and start failures", () => {
    const registry = createWorkbenchContributionRegistry()
    const error = new Error("boom")

    registry.register({
      id: "agent-evidence",
      phase: "restored",
      order: 5,
      source: "agent",
      serviceIds: ["agentEvidenceWorkbenchService"],
      viewIds: ["codek.agentEvidence.timeline"],
      commandIds: ["agent.evidence.openTimeline"],
      evidence: {
        source: "releaseEvidence",
        diagnostics: [{ id: "manual-real-ui", severity: "warning", message: "needs manual UI evidence" }],
      },
      start: () => {
        throw error
      },
    })

    registry.start(context(), { throughPhase: "restored", now: () => 2000 })

    expect(registry.getProjection()).toEqual(expect.objectContaining({
      schemaVersion: 1,
      startupOrder: ["agent-evidence"],
      lifecycle: expect.objectContaining({ failed: 1 }),
      contributions: [
        expect.objectContaining({
          id: "agent-evidence",
          phase: "restored",
          source: "agent",
          state: "failed",
          serviceIds: ["agentEvidenceWorkbenchService"],
          viewIds: ["codek.agentEvidence.timeline"],
          commandIds: ["agent.evidence.openTimeline"],
          evidence: expect.objectContaining({ source: "releaseEvidence" }),
        }),
      ],
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ id: "agent-evidence", severity: "error", code: "start-failed" }),
        expect.objectContaining({ id: "manual-real-ui", severity: "warning", code: "evidence" }),
      ]),
    }))
  })

  it("lets the legacy workbench resource cleanup dispose the registry", () => {
    const calls: string[] = []
    const registry = createWorkbenchContributionRegistry()
    registry.register({
      id: "legacy-proxy",
      phase: "startup",
      start: () => ({ dispose: () => calls.push("registry-dispose") }),
    })
    registry.start(context())

    const result = disposeWorkbenchResources({
      workbenchContributionRegistry: registry,
    })

    expect(result.errors).toEqual([])
    expect(calls).toEqual(["registry-dispose"])
  })
})

describe("global workbench contribution registry helpers", () => {
  it("register, start, project, shutdown, and reset through a single shared registry", () => {
    const calls: string[] = []
    resetWorkbenchContributionRegistry()

    registerWorkbenchContribution({
      id: "global",
      phase: "startup",
      start: () => {
        calls.push("start")
        return { dispose: () => calls.push("dispose") }
      },
    })

    startWorkbenchContributionRegistry(context(), { now: () => 3000 })
    expect(getWorkbenchContributionRegistryProjection().contributions[0]).toEqual(expect.objectContaining({
      id: "global",
      state: "started",
    }))

    shutdownWorkbenchContributionRegistry({ reason: "test", now: () => 3100 })
    expect(calls).toEqual(["start", "dispose"])

    resetWorkbenchContributionRegistry()
    expect(getWorkbenchContributionRegistryProjection().contributions).toEqual([])
  })
})

describe("workbench contribution phases", () => {
  it("orders phases using the Codek VS Code-compatible lifecycle subset", () => {
    const phases: WorkbenchContributionPhase[] = ["startup", "ready", "restored", "eventually"]
    const registry = new WorkbenchContributionRegistry()

    for (const phase of [...phases].reverse()) {
      registry.register({ id: phase, phase, start: vi.fn() })
    }
    registry.start(context(), { throughPhase: "eventually" })

    expect(registry.getProjection().startupOrder).toEqual(phases)
  })
})
