import { generatePlan, createAgentPlan } from "./taskPlanner"
import type { TaskPlan, TaskStep } from "./taskPlanner"
import { Orchestrator } from "./orchestrator"
import type { StepResult } from "./orchestrator"
import { optimizePrompt } from "./promptOptimizer"
import { verifyAndDiagnose } from "./buildVerifier"
import type { VerificationReport } from "./buildVerifier"
import { diagnoseAndPlan } from "./agentVerify"
import { applyConsensusPolicy } from "./executionStrategy"
import { emitAgentLifecycleEvent } from "./agentLifecycle"
import { playSound } from "../utils/soundNotifier"
import { notify } from "../utils/notifications"

export interface AutoRunnerOptions {
  goal: string
  projectRoot: string
  model?: string
  maxConcurrency?: number
  maxFixRounds?: number // 默认 3 轮
  onPhase?: (phase: AutoPhase, detail?: string) => void
  onPlan?: (plan: TaskPlan) => void
  onStepStart?: (step: TaskStep, index: number, total: number) => void
  onStepDone?: (step: TaskStep, index: number, total: number) => void
  onStepError?: (step: TaskStep, index: number, total: number, error: string) => void
  onVerification?: (report: VerificationReport) => void
  onFixRound?: (round: number, guidance: string) => void
}

export type AutoPhase = "planning" | "optimizing" | "executing" | "verifying" | "fixing" | "done" | "failed" | "aborted"

export interface AutoRunResult {
  plan: TaskPlan
  steps: StepResult[]
  verification?: VerificationReport
  fixRoundsUsed: number
  success: boolean
}

export class AutoRunner {
  private readonly options: AutoRunnerOptions
  private orchestrator: Orchestrator | null = null
  private aborted = false

  constructor(options: AutoRunnerOptions) {
    this.options = options
  }

  abort(): void {
    this.aborted = true
    this.orchestrator?.abort()
  }

  async run(): Promise<AutoRunResult> {
    const { goal, projectRoot, model, maxConcurrency = 3, maxFixRounds = 3 } = this.options
    const phase = (p: AutoPhase, d?: string) => this.options.onPhase?.(p, d)

    phase("planning")
    const steps = await generatePlan(optimizePrompt(goal, goal), model)
    const plan: TaskPlan = {
      ...createAgentPlan({ goal, projectRoot }),
      steps: applyConsensusPolicy(steps),
    }
    this.options.onPlan?.(plan)

    phase("optimizing")

    phase("executing")
    this.orchestrator = new Orchestrator({
      model,
      projectRoot,
      maxConcurrency,
      verifyAfterRun: false,
      onStepStart: ({ index, step, total }) => this.options.onStepStart?.(step, index, total),
      onStepDone: ({ index, step, total }) => this.options.onStepDone?.(step, index, total),
      onStepError: ({ index, step, total, error }) => this.options.onStepError?.(step, index, total, error),
    })
    const stepResults = await this.orchestrator.execute(plan)

    const failedStep = stepResults.find((result) =>
      result.status === "failed" || result.status === "skipped" || result.status === "aborted"
    )
    if (failedStep) {
      const reason = failedStep.error || `Step ${failedStep.step.id} did not complete successfully`
      phase("failed", reason)
      playSound("error")
      notify("error", `Auto 模式失败：${reason}`)
      return { plan, steps: stepResults, fixRoundsUsed: 0, success: false }
    }

    if (this.aborted) {
      phase("aborted")
      playSound("alert")
      notify("warning", "任务已中止")
      return { plan, steps: stepResults, fixRoundsUsed: 0, success: false }
    }

    phase("verifying")
    let verification = await verifyAndDiagnose({ projectRoot })
    this.options.onVerification?.(verification)
    void emitAgentLifecycleEvent({
      type: "verification:done",
      goal,
      agentRole: "tester",
      workspaceRoot: projectRoot,
      payload: {
        passed: verification.passed,
        failingStage: verification.failingStage,
        guidance: verification.guidance,
        commands: verification.steps.map((step) => step.command),
      },
    })

    let fixRoundsUsed = 0
    while (!verification.passed && fixRoundsUsed < maxFixRounds && !this.aborted) {
      fixRoundsUsed++
      phase("fixing", `第 ${fixRoundsUsed} 轮修复`)

      const failingStep = verification.steps.find((s) => !s.success)
      const errorText = failingStep?.error || verification.guidance || ""
      const { promptInjection, shouldRetry } = diagnoseAndPlan(errorText, fixRoundsUsed - 1, goal)
      if (!shouldRetry) break

      this.options.onFixRound?.(fixRoundsUsed, promptInjection)

      const fixPlanSteps = await generatePlan(`${goal}\n\n${promptInjection}`, model)
      const fixPlan: TaskPlan = {
        ...createAgentPlan({ goal: `Fix round ${fixRoundsUsed}: ${goal}`, projectRoot, continueOnError: false }),
        steps: applyConsensusPolicy(fixPlanSteps),
      }

      this.orchestrator = new Orchestrator({ model, projectRoot, maxConcurrency })
      await this.orchestrator.execute(fixPlan)

      verification = await verifyAndDiagnose({ projectRoot })
      this.options.onVerification?.(verification)
      void emitAgentLifecycleEvent({
        type: "verification:done",
        goal,
        agentRole: "tester",
        workspaceRoot: projectRoot,
        payload: {
          round: fixRoundsUsed,
          passed: verification.passed,
          failingStage: verification.failingStage,
          guidance: verification.guidance,
          commands: verification.steps.map((step) => step.command),
        },
      })
    }

    if (verification.passed) {
      phase("done")
      playSound("complete")
      notify("success", "Auto 模式任务完成")
      return { plan, steps: stepResults, verification, fixRoundsUsed, success: true }
    }

    phase("failed", verification.guidance)
    playSound("error")
    notify("error", `Auto 模式失败：${verification.guidance || "验证未通过"}`)
    return { plan, steps: stepResults, verification, fixRoundsUsed, success: false }
  }
}

export function runAutoTask(options: AutoRunnerOptions): { runner: AutoRunner; promise: Promise<AutoRunResult> } {
  const runner = new AutoRunner(options)
  return { runner, promise: runner.run() }
}
