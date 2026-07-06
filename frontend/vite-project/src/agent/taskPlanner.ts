import { chatSync } from "../ai/llmClient"
import { getActiveProvider } from "../ai/aiProviders"
import { PLANNER_SYSTEM_PROMPT } from "./prompts"
import type { AgentMemoryType, AgentRole } from "./agentMemory"

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped"
export type StepRisk = "safe" | "medium" | "high"

export interface TaskStep {
  id: string
  description: string
  instruction: string
  dependsOn: string[]
  parallelGroup?: string
  estimatedRisk: StepRisk
  agentRole?: AgentRole
  requiresConsensus?: boolean
  consensusWith?: AgentRole[]
  consensusForStepId?: string
  requiresMemoryEvidence?: boolean
  memoryTypes?: AgentMemoryType[]
  status: StepStatus
  result?: string
  error?: string
  startedAt?: number
  completedAt?: number
}

export interface TaskPlan {
  id: string
  goal: string
  steps: TaskStep[]
  projectRoot: string
  continueOnError: boolean
  createdAt: number
}

export interface CreatePlanOptions {
  goal: string
  projectRoot: string
  continueOnError?: boolean
}

export function createAgentPlan(options: CreatePlanOptions): TaskPlan {
  return {
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    goal: options.goal,
    steps: [],
    projectRoot: options.projectRoot,
    continueOnError: options.continueOnError ?? false,
    createdAt: Date.now(),
  }
}

interface RawStep {
  id?: unknown
  description?: unknown
  instruction?: unknown
  dependsOn?: unknown
  parallelGroup?: unknown
  estimatedRisk?: unknown
  agentRole?: unknown
  requiresConsensus?: unknown
  consensusWith?: unknown
  consensusForStepId?: unknown
  requiresMemoryEvidence?: unknown
  memoryTypes?: unknown
}

function normalizeStep(raw: RawStep, index: number): TaskStep {
  const id = typeof raw.id === "string" && raw.id ? raw.id : `step-${index + 1}`
  const description = typeof raw.description === "string" ? raw.description : `Step ${index + 1}`
  const instruction = typeof raw.instruction === "string" ? raw.instruction : description
  const dependsOn = Array.isArray(raw.dependsOn)
    ? raw.dependsOn.filter((d): d is string => typeof d === "string")
    : []
  const parallelGroup = typeof raw.parallelGroup === "string" ? raw.parallelGroup : undefined
  const risk = (raw.estimatedRisk === "high" || raw.estimatedRisk === "medium" || raw.estimatedRisk === "safe")
    ? raw.estimatedRisk
    : "medium"
  const agentRole = isAgentRole(raw.agentRole) ? raw.agentRole : undefined
  const consensusWith = Array.isArray(raw.consensusWith)
    ? raw.consensusWith.filter(isAgentRole)
    : undefined
  const memoryTypes = Array.isArray(raw.memoryTypes)
    ? raw.memoryTypes.filter(isAgentMemoryType)
    : undefined

  return {
    id,
    description,
    instruction,
    dependsOn,
    parallelGroup,
    estimatedRisk: risk,
    agentRole,
    requiresConsensus: raw.requiresConsensus === true,
    consensusWith,
    consensusForStepId: typeof raw.consensusForStepId === "string" ? raw.consensusForStepId : undefined,
    requiresMemoryEvidence: raw.requiresMemoryEvidence === true,
    memoryTypes,
    status: "pending",
  }
}

function isAgentRole(value: unknown): value is AgentRole {
  return (
    value === "planner" ||
    value === "coder" ||
    value === "tester" ||
    value === "reviewer" ||
    value === "security" ||
    value === "docs" ||
    value === "release" ||
    value === "research"
  )
}

function isAgentMemoryType(value: unknown): value is AgentMemoryType {
  return (
    value === "preference" ||
    value === "pattern" ||
    value === "error" ||
    value === "success" ||
    value === "decision" ||
    value === "verification" ||
    value === "tool-result"
  )
}

function parseJsonArray(text: string): RawStep[] | null {
  const trimmed = text.trim()
  const match = trimmed.match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function topologicalSort(steps: TaskStep[]): TaskStep[][] {
  const idMap = new Map(steps.map((s) => [s.id, s]))
  const inDegree = new Map<string, number>()
  const remaining = new Set(steps.map((s) => s.id))

  for (const step of steps) {
    inDegree.set(step.id, step.dependsOn.filter((d) => idMap.has(d)).length)
  }

  const layers: TaskStep[][] = []

  while (remaining.size > 0) {
    const layer: TaskStep[] = []
    for (const id of remaining) {
      if ((inDegree.get(id) || 0) === 0) {
        const step = idMap.get(id)
        if (step) layer.push(step)
      }
    }

    if (layer.length === 0) {
      // cycle detected — push remaining as a single fallback layer
      const fallback = Array.from(remaining).map((id) => idMap.get(id)).filter((s): s is TaskStep => !!s)
      layers.push(fallback)
      break
    }

    layers.push(layer)
    for (const step of layer) {
      remaining.delete(step.id)
      for (const other of steps) {
        if (other.dependsOn.includes(step.id) && remaining.has(other.id)) {
          inDegree.set(other.id, (inDegree.get(other.id) || 1) - 1)
        }
      }
    }
  }

  return layers
}

function fallbackSteps(goal: string): TaskStep[] {
  const lower = goal.toLowerCase()

  if (/test|测试|spec/.test(lower)) {
    return [
      { id: "step-1", description: "分析项目结构", instruction: `阅读 package.json 与测试目录，确认现有测试框架。目标：${goal}`, dependsOn: [], parallelGroup: "explore", estimatedRisk: "safe", status: "pending" },
      { id: "step-2", description: "识别测试目标", instruction: "找出需要补充测试的核心模块。", dependsOn: [], parallelGroup: "explore", estimatedRisk: "safe", status: "pending" },
      { id: "step-3", description: "编写测试", instruction: "为核心模块编写单元测试。", dependsOn: ["step-1", "step-2"], estimatedRisk: "medium", status: "pending" },
      { id: "step-4", description: "运行测试", instruction: "执行 npm test 并修复失败的用例。", dependsOn: ["step-3"], estimatedRisk: "safe", status: "pending" },
    ]
  }

  if (/refactor|重构|typescript/.test(lower)) {
    return [
      { id: "step-1", description: "理解当前实现", instruction: `阅读相关源码理解当前实现。目标：${goal}`, dependsOn: [], estimatedRisk: "safe", status: "pending" },
      { id: "step-2", description: "设计重构方案", instruction: "制定重构方案与边界。", dependsOn: ["step-1"], estimatedRisk: "safe", status: "pending" },
      { id: "step-3", description: "执行重构", instruction: "按方案修改代码。", dependsOn: ["step-2"], estimatedRisk: "medium", status: "pending" },
      { id: "step-4", description: "验证", instruction: "运行 build 与 test 确认无回归。", dependsOn: ["step-3"], estimatedRisk: "safe", status: "pending" },
    ]
  }

  return [
    { id: "step-1", description: "分析需求", instruction: `理解需求并阅读相关代码：${goal}`, dependsOn: [], estimatedRisk: "safe", status: "pending" },
    { id: "step-2", description: "实现", instruction: "实施所需的代码改动。", dependsOn: ["step-1"], estimatedRisk: "medium", status: "pending" },
    { id: "step-3", description: "验证", instruction: "运行 build 与 test 验证。", dependsOn: ["step-2"], estimatedRisk: "safe", status: "pending" },
  ]
}

export async function generatePlan(goal: string, model?: string, context?: string): Promise<TaskStep[]> {
  const provider = getActiveProvider()
  const systemPrompt = context
    ? `${PLANNER_SYSTEM_PROMPT}\n\nProject context:\n${context}`
    : PLANNER_SYSTEM_PROMPT

  try {
    const providerModel = "model" in provider ? (provider as { model?: string }).model : undefined
    const response = await chatSync({
      provider,
      model: model || providerModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Goal: ${goal}` },
      ],
      stream: false,
    })

    const raw = parseJsonArray(response)
    if (!raw || raw.length === 0) {
      return fallbackSteps(goal)
    }

    return raw.map((r, i) => normalizeStep(r, i))
  } catch {
    return fallbackSteps(goal)
  }
}
