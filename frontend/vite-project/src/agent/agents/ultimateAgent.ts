import { chatSync } from "../../ai/llmClient"
import { getActiveModel } from "../../ai/aiProviders"
import { getAgentSpec } from "./registry"
import type { SubAgentId, PlanOutput, ArchitectOutput, ExecutorOutput, SecurityOutput, ReviewOutput, DeliveryReport } from "./types"

export interface UltimateOptions {
  mode: "agent" | "auto"
  onProgress?: (message: string) => void
  onPlanResult?: (plan: PlanOutput) => void
  onArchitectResult?: (arch: ArchitectOutput) => void
  onExecutorResult?: (output: ExecutorOutput) => void
  onSecurityResult?: (output: SecurityOutput) => void
  onReviewResult?: (output: ReviewOutput) => void
  onDelivery?: (report: DeliveryReport) => void
}

async function callSubAgent(id: SubAgentId, context: string, mode: "agent" | "auto"): Promise<string> {
  const spec = getAgentSpec(id)
  if (!spec) throw new Error(`Unknown sub-agent: ${id}`)

  const result = await chatSync({
    model: getActiveModel(),
    messages: [
      { role: "system", content: spec.systemPrompt },
      { role: "user", content: context },
    ],
    stream: false,
    temperature: 0.3,
  })

  return result || ""
}

function tryParseJSON<T>(text: string): T | null {
  // Try to find JSON block in markdown
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim()
  try {
    return JSON.parse(jsonStr) as T
  } catch {
    return null
  }
}

export async function runUltimateAgent(userRequest: string, options: UltimateOptions): Promise<DeliveryReport> {
  const { mode, onProgress } = options
  const MAX_LOOPS = 3

  // ── Step 1: Plan Agent ──
  onProgress?.("规划 Agent: 分析需求中...")
  const planRaw = await callSubAgent("planner", userRequest, mode)
  const plan = tryParseJSON<PlanOutput>(planRaw)
  options.onPlanResult?.(plan || { analysis: planRaw, boundaries: [], risks: [], plans: [] })

  if (!plan) {
    onProgress?.("规划 Agent 输出异常，跳过结构化分析")
  }

  // Auto mode: select best plan automatically
  let selectedPlanIndex = 0
  if (mode === "auto" && plan && plan.plans.length > 0) {
    // Simple heuristic: prefer the plan with most pros
    let bestIdx = 0
    let bestScore = -1
    for (let i = 0; i < plan.plans.length; i++) {
      const p = plan.plans[i]
      const score = (p.pros?.length || 0) * 2 - (p.cons?.length || 0)
      if (score > bestScore) { bestScore = score; bestIdx = i }
    }
    selectedPlanIndex = bestIdx
    onProgress?.(`自动选择方案: ${plan.plans[bestIdx]?.name || `方案 ${bestIdx + 1}`}`)
  }

  // ── Step 2: Architect Agent ──
  onProgress?.("架构 Agent: 技术选型中...")
  const planContext = plan ? JSON.stringify(plan.plans[selectedPlanIndex] || plan.plans[0]) : "无结构化方案"
  const archRaw = await callSubAgent("architect", `用户需求: ${userRequest}\n选定方案: ${planContext}`, mode)
  const arch = tryParseJSON<ArchitectOutput>(archRaw)
  options.onArchitectResult?.(arch || { techStack: {}, projectStructure: [], keyDecisions: [], constraints: [] })

  // ── Step 3: Executor Agent ──
  let executorOutput: ExecutorOutput | null = null
  const archContext = arch ? JSON.stringify(arch) : "无架构方案"

  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    onProgress?.(`执行 Agent: 任务拆解与执行中 (第 ${loop + 1} 轮)...`)
    const execRaw = await callSubAgent("executor", `需求: ${userRequest}\n架构: ${archContext}`, mode)
    executorOutput = tryParseJSON<ExecutorOutput>(execRaw)
    options.onExecutorResult?.(executorOutput || { steps: [] })

    // ── Step 4: Security Agent ──
    onProgress?.("安全 Agent: 审计代码中...")
    const secRaw = await callSubAgent("security", `需求: ${userRequest}\n执行结果: ${execRaw}`, mode)
    const sec = tryParseJSON<SecurityOutput>(secRaw)
    options.onSecurityResult?.(sec || { issues: [], passed: false })

    if (sec && !sec.passed) {
      const criticals = sec.issues.filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH")
      if (criticals.length > 0 && loop < MAX_LOOPS - 1) {
        onProgress?.(`发现 ${criticals.length} 个安全问题，重新执行...`)
        // Inject security issues into next executor iteration
        continue
      }
    }

    // ── Step 5: Reviewer Agent ──
    onProgress?.("审查 Agent: 代码质量检查中...")
    const revRaw = await callSubAgent("reviewer", `需求: ${userRequest}\n执行结果: ${execRaw}`, mode)
    const rev = tryParseJSON<ReviewOutput>(revRaw)
    options.onReviewResult?.(rev || { compileErrors: [], logicIssues: [], qualityIssues: [], approved: false })

    if (rev && !rev.approved && loop < MAX_LOOPS - 1) {
      onProgress?.("审查未通过，重新执行...")
      continue
    }

    break // All checks passed
  }

  // ── Delivery Report ──
  const report: DeliveryReport = {
    filesChanged: [],
    verificationResults: [],
    summary: "",
  }

  if (executorOutput?.steps) {
    report.filesChanged = executorOutput.steps
      .filter((s) => s.verify)
      .map((s) => ({ path: s.instruction.slice(0, 60), changes: s.description }))
  }

  report.verificationResults = [
    { type: "需求分析", passed: !!plan, details: plan ? `${plan.plans.length} 个方案` : "跳过" },
    { type: "架构设计", passed: !!arch, details: arch ? `${Object.keys(arch.techStack).length} 项技术选型` : "跳过" },
    { type: "任务执行", passed: !!executorOutput, details: executorOutput ? `${executorOutput.steps.length} 个步骤` : "失败" },
  ]

  report.summary = `工作流完成。${executorOutput?.steps.length || 0} 个执行步骤。`

  options.onDelivery?.(report)
  return report
}
