import type { AgentOptions } from "./agent"
import { AgentPool, createAgentPool } from "./agentPool"
import { topologicalSort } from "./taskPlanner"
import type { TaskPlan, TaskStep } from "./taskPlanner"
import { getActiveModel } from "../ai/aiProviders"
import { verifyAndDiagnose } from "./buildVerifier"
import type { VerificationReport } from "./buildVerifier"
import { applyConsensusPolicy, decideExecutionMode } from "./executionStrategy"
import type { ExecutionMode, StrategyDecision } from "./executionStrategy"
import { emitAgentLifecycleEvent } from "./agentLifecycle"
import { rememberMemory } from "./agentMemory"
import type { AgentMemoryType } from "./agentMemory"
import { parseConsensusVerdict } from "./consensusVerdict"

export interface StepEvent {
  index: number
  step: TaskStep
  total: number
}

export interface StepDoneEvent extends StepEvent {
  result: string
}

export interface StepErrorEvent extends StepEvent {
  error: string
}

export interface StepSkippedEvent {
  step: TaskStep
  reason: string
}

export interface OrchestratorOptions {
  model?: string
  projectRoot?: string
  maxConcurrency?: number
  contextProvider?: AgentOptions["contextProvider"]
  agentOptions?: Omit<AgentOptions, "model" | "projectRoot" | "contextProvider" | "onMessage" | "onStream" | "onDone">
  pool?: AgentPool
  onPlanStart?: (plan: TaskPlan) => void
  onStepStart?: (event: StepEvent) => void
  onStepDone?: (event: StepDoneEvent) => void
  onStepError?: (event: StepErrorEvent) => void
  onStepSkipped?: (event: StepSkippedEvent) => void
  onPlanDone?: (results: StepResult[]) => void
  onPlanAborted?: (results: StepResult[]) => void
  onVerification?: (report: VerificationReport) => void
  verifyAfterRun?: boolean
  executionMode?: ExecutionMode | "auto"
  onLayerStrategy?: (event: { layerIndex: number; steps: TaskStep[]; decision: StrategyDecision }) => void
}

export interface StepResult {
  stepIndex: number
  step: TaskStep
  status: "completed" | "failed" | "skipped" | "aborted"
  output?: string
  error?: string
  startedAt?: number
  completedAt?: number
}

export class Orchestrator {
  private readonly model: string
  private readonly projectRoot: string
  private readonly contextProvider: AgentOptions["contextProvider"]
  private readonly agentOptions: OrchestratorOptions["agentOptions"]
  private readonly pool: AgentPool
  private readonly ownsPool: boolean
  private readonly onPlanStart?: OrchestratorOptions["onPlanStart"]
  private readonly onStepStart?: OrchestratorOptions["onStepStart"]
  private readonly onStepDone?: OrchestratorOptions["onStepDone"]
  private readonly onStepError?: OrchestratorOptions["onStepError"]
  private readonly onStepSkipped?: OrchestratorOptions["onStepSkipped"]
  private readonly onPlanDone?: OrchestratorOptions["onPlanDone"]
  private readonly onPlanAborted?: OrchestratorOptions["onPlanAborted"]
  private readonly onVerification?: OrchestratorOptions["onVerification"]
  private readonly verifyAfterRun: boolean
  private readonly executionMode: ExecutionMode | "auto"
  private readonly onLayerStrategy?: OrchestratorOptions["onLayerStrategy"]
  private aborted = false

  constructor(options: OrchestratorOptions = {}) {
    this.model = options.model || getActiveModel()
    this.projectRoot = options.projectRoot || ""
    this.contextProvider = options.contextProvider
    this.agentOptions = options.agentOptions
    this.onPlanStart = options.onPlanStart
    this.onStepStart = options.onStepStart
    this.onStepDone = options.onStepDone
    this.onStepError = options.onStepError
    this.onStepSkipped = options.onStepSkipped
    this.onPlanDone = options.onPlanDone
    this.onPlanAborted = options.onPlanAborted
    this.onVerification = options.onVerification
    this.verifyAfterRun = options.verifyAfterRun ?? false
    this.executionMode = options.executionMode ?? "auto"
    this.onLayerStrategy = options.onLayerStrategy

    if (options.pool) {
      this.pool = options.pool
      this.ownsPool = false
    } else {
      this.pool = createAgentPool(
        {
          model: this.model,
          projectRoot: this.projectRoot,
          contextProvider: this.contextProvider,
          ...this.agentOptions,
        },
        options.maxConcurrency ?? 3
      )
      this.ownsPool = true
    }
  }

  abort(): void {
    this.aborted = true
  }

  async execute(plan: TaskPlan): Promise<StepResult[]> {
    this.aborted = false
    plan.steps = applyConsensusPolicy(plan.steps)
    this.onPlanStart?.(plan)
    void emitAgentLifecycleEvent({
      type: "plan:created",
      goal: plan.goal,
      planId: plan.id,
      workspaceRoot: plan.projectRoot || this.projectRoot,
      payload: {
        stepCount: plan.steps.length,
        continueOnError: plan.continueOnError,
      },
    })

    const total = plan.steps.length
    const indexMap = new Map<string, number>()
    plan.steps.forEach((s, i) => indexMap.set(s.id, i))

    const results = new Map<string, StepResult>()
    const layers = topologicalSort(plan.steps)

    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const layer = layers[layerIndex]
      if (this.aborted) {
        for (const step of layer) {
          if (!results.has(step.id)) {
            results.set(step.id, { stepIndex: indexMap.get(step.id) ?? 0, step, status: "aborted" })
          }
        }
        continue
      }

      const runnable: TaskStep[] = []
      for (const step of layer) {
        const failedDep = step.dependsOn.find((depId) => {
          const r = results.get(depId)
          return r && (r.status === "failed" || r.status === "skipped" || r.status === "aborted")
        })
        if (failedDep) {
          step.status = "skipped"
          const skipped: StepResult = {
            stepIndex: indexMap.get(step.id) ?? 0,
            step,
            status: "skipped",
            error: `Dependency ${failedDep} did not complete successfully`,
          }
          results.set(step.id, skipped)
          this.onStepSkipped?.({ step, reason: skipped.error! })
          void emitAgentLifecycleEvent({
            type: "step:error",
            goal: plan.goal,
            planId: plan.id,
            stepId: step.id,
            agentRole: step.agentRole,
            workspaceRoot: plan.projectRoot || this.projectRoot,
            payload: { error: skipped.error, skipped: true, dependency: failedDep },
          })
        } else {
          runnable.push(step)
        }
      }

      if (runnable.length === 0) continue

      const decision: StrategyDecision = this.executionMode === "auto"
        ? decideExecutionMode(runnable)
        : { mode: this.executionMode, reason: `Forced ${this.executionMode} mode by caller` }
      this.onLayerStrategy?.({ layerIndex, steps: runnable, decision })

      const stepOutcomes: Array<StepResult | { error: string; step: TaskStep }> = []
      if (decision.mode === "parallel") {
        const settled = await Promise.allSettled(
          runnable.map((step) => this.runStep(step, indexMap.get(step.id) ?? 0, total, plan))
        )
        settled.forEach((outcome, i) => {
          if (outcome.status === "fulfilled") {
            stepOutcomes.push(outcome.value)
          } else {
            const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)
            stepOutcomes.push({ error: reason, step: runnable[i] })
          }
        })
      } else {
        for (const step of runnable) {
          if (this.aborted) {
            stepOutcomes.push({ error: "Aborted before execution", step })
            continue
          }
          try {
            const value = await this.runStep(step, indexMap.get(step.id) ?? 0, total, plan)
            stepOutcomes.push(value)
            if (!plan.continueOnError && value.status === "failed") {
              this.aborted = true
            }
          } catch (err: unknown) {
            const reason = err instanceof Error ? err.message : String(err)
            stepOutcomes.push({ error: reason, step })
            if (!plan.continueOnError) this.aborted = true
          }
        }
      }

      stepOutcomes.forEach((outcome) => {
        if ("error" in outcome && !("status" in outcome)) {
          const step = outcome.step
          step.status = "failed"
          step.error = outcome.error
          results.set(step.id, {
            stepIndex: indexMap.get(step.id) ?? 0,
            step,
            status: "failed",
            error: outcome.error,
          })
        } else {
          const r = outcome as StepResult
          results.set(r.step.id, r)
        }
      })

      if (!plan.continueOnError) {
        const hasFailure = runnable.some((s) => results.get(s.id)?.status === "failed")
        if (hasFailure) {
          this.aborted = true
        }
      }
    }

    const ordered = plan.steps
      .map((s) => results.get(s.id))
      .filter((r): r is StepResult => !!r)

    if (this.verifyAfterRun && !this.aborted) {
      try {
        const report = await verifyAndDiagnose({ projectRoot: this.projectRoot })
        this.onVerification?.(report)
        void emitAgentLifecycleEvent({
          type: "verification:done",
          goal: plan.goal,
          planId: plan.id,
          agentRole: "tester",
          workspaceRoot: plan.projectRoot || this.projectRoot,
          payload: {
            passed: report.passed,
            failingStage: report.failingStage,
            guidance: report.guidance,
            commands: report.steps.map((step) => step.command),
          },
        })
      } catch {
        /* swallow verification errors */
      }
    }

    if (this.aborted) {
      this.onPlanAborted?.(ordered)
      void emitAgentLifecycleEvent({
        type: "run:error",
        goal: plan.goal,
        planId: plan.id,
        workspaceRoot: plan.projectRoot || this.projectRoot,
        payload: {
          error: "Plan aborted",
          completed: ordered.filter((item) => item.status === "completed").length,
          failed: ordered.filter((item) => item.status === "failed").length,
        },
      })
    } else {
      this.onPlanDone?.(ordered)
      void emitAgentLifecycleEvent({
        type: "run:done",
        goal: plan.goal,
        planId: plan.id,
        workspaceRoot: plan.projectRoot || this.projectRoot,
        payload: {
          completed: ordered.filter((item) => item.status === "completed").length,
          failed: ordered.filter((item) => item.status === "failed").length,
        },
      })
    }

    if (this.ownsPool) {
      this.pool.drain()
    }

    return ordered
  }

  private async runStep(step: TaskStep, index: number, total: number, plan: TaskPlan): Promise<StepResult> {
    step.status = "running"
    step.startedAt = Date.now()
    this.onStepStart?.({ index, step, total })
    void emitAgentLifecycleEvent({
      type: "step:start",
      goal: plan.goal,
      planId: plan.id,
      stepId: step.id,
      agentRole: step.agentRole,
      workspaceRoot: plan.projectRoot || this.projectRoot,
      payload: {
        description: step.description,
        estimatedRisk: step.estimatedRisk,
        requiresConsensus: step.requiresConsensus,
      },
    })

    const agent = await this.pool.acquire()
    try {
      const prompt = this.buildStepPrompt(plan, step, index, total)
      const output = await agent.send(prompt)
      const result = typeof output === "string" ? output : "Step completed."

      const consensusFailure = this.validateConsensusResult(step, result)
      if (consensusFailure) {
        step.status = "failed"
        step.error = consensusFailure
        step.completedAt = Date.now()
        this.onStepError?.({ index, step, total, error: consensusFailure })
        void emitAgentLifecycleEvent({
          type: "step:error",
          goal: plan.goal,
          planId: plan.id,
          stepId: step.id,
          agentRole: step.agentRole,
          workspaceRoot: plan.projectRoot || this.projectRoot,
          payload: {
            description: step.description,
            error: consensusFailure,
            result,
            consensusForStepId: step.consensusForStepId,
          },
        })
        return {
          stepIndex: index,
          step,
          status: "failed",
          output: result,
          error: consensusFailure,
          startedAt: step.startedAt,
          completedAt: step.completedAt,
        }
      }

      step.status = "completed"
      step.result = result
      step.completedAt = Date.now()

      const event: StepResult = {
        stepIndex: index,
        step,
        status: "completed",
        output: result,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
      }
      this.onStepDone?.({ index, step, total, result })
      void emitAgentLifecycleEvent({
        type: "step:done",
        goal: plan.goal,
        planId: plan.id,
        stepId: step.id,
        agentRole: step.agentRole,
        workspaceRoot: plan.projectRoot || this.projectRoot,
        payload: {
          description: step.description,
          result,
        },
      })
      this.writeRequiredEvidence(plan, step, result)
      return event
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      step.status = "failed"
      step.error = message
      step.completedAt = Date.now()
      this.onStepError?.({ index, step, total, error: message })
      void emitAgentLifecycleEvent({
        type: "step:error",
        goal: plan.goal,
        planId: plan.id,
        stepId: step.id,
        agentRole: step.agentRole,
        workspaceRoot: plan.projectRoot || this.projectRoot,
        payload: {
          description: step.description,
          error: message,
        },
      })
      return {
        stepIndex: index,
        step,
        status: "failed",
        error: message,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
      }
    } finally {
      this.pool.release(agent)
    }
  }

  private buildStepPrompt(plan: TaskPlan, step: TaskStep, index: number, total: number): string {
    const depSummary = step.dependsOn.length > 0
      ? `\nThis step depends on: ${step.dependsOn.join(", ")}`
      : ""
    const consensusInstruction = step.consensusForStepId
      ? [
          "",
          "Consensus verdict is mandatory. Return a machine-readable JSON object as the final answer:",
          '{ "verdict": "pass|fail|needs-fix", "reason": "...", "evidence": ["..."] }',
          "Only pass when this validation step actually accepts the referenced work. Use needs-fix or fail when issues remain.",
        ].join("\n")
      : ""
    return [
      `Overall goal: ${plan.goal}`,
      `Current step (${index + 1}/${total}): ${step.description}`,
      step.instruction || "",
      depSummary,
      consensusInstruction,
    ]
      .filter(Boolean)
      .join("\n")
  }

  private validateConsensusResult(step: TaskStep, result: string): string | null {
    if (!step.consensusForStepId) return null
    const parsed = parseConsensusVerdict(result)
    if (parsed.verdict === "pass") return null
    if (parsed.verdict === "unknown") {
      return `Consensus verdict unparseable for ${step.consensusForStepId}; high-risk validation cannot pass silently.`
    }
    const reason = parsed.reason ? `: ${parsed.reason}` : ""
    return `Consensus ${parsed.verdict} for ${step.consensusForStepId}${reason}`
  }

  private writeRequiredEvidence(plan: TaskPlan, step: TaskStep, result: string): void {
    if (!step.requiresMemoryEvidence || !step.memoryTypes?.length) return
    for (const type of step.memoryTypes) {
      void this.writeEvidenceMemory(plan, step, type, result)
    }
  }

  private async writeEvidenceMemory(plan: TaskPlan, step: TaskStep, type: AgentMemoryType, result: string): Promise<void> {
    try {
      await rememberMemory({
        type,
        content: `Required evidence for ${step.id}: ${step.description}; result=${result.slice(0, 500)}`,
        context: {
          workspaceRoot: plan.projectRoot || this.projectRoot,
          taskId: step.id,
          runId: plan.id,
          agentRole: step.agentRole,
          source: type === "verification" ? "verification" : "lifecycle",
          tags: ["required-evidence"],
        },
      })
    } catch {
      // Evidence memory is required diagnostic output, but provider failure must not crash the step.
    }
  }
}

export function createOrchestrator(options: OrchestratorOptions = {}): Orchestrator {
  return new Orchestrator(options)
}
