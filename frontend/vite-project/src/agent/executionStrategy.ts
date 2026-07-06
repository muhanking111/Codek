import type { TaskStep } from "./taskPlanner"
import type { AgentMemoryType, AgentRole } from "./agentMemory"

export type ExecutionMode = "parallel" | "serial"
export type VisibleChatMode = "ask" | "plan" | "agent" | "auto"
export type AgentExecutionStrategy = "none" | "single-agent" | "multi-agent"

export interface StrategyDecision {
  mode: ExecutionMode
  reason: string
}

export interface AgentStrategyInput {
  visibleMode: VisibleChatMode
  text: string
  files?: string[]
  risk?: "safe" | "medium" | "high"
  agentStrategy?: "auto" | "single-agent" | "multi-agent"
}

export interface AgentStrategyDecision {
  visibleMode: VisibleChatMode
  executionStrategy: AgentExecutionStrategy
  reason: string
  signals: {
    files: string[]
    fileCount: number
    risk: "safe" | "medium" | "high"
    score: number
    matched: string[]
    overridden: boolean
  }
}

export interface RolePolicy {
  agentRole: AgentRole
  requiresConsensus: boolean
  consensusWith: AgentRole[]
  requiresMemoryEvidence: boolean
  memoryTypes: AgentMemoryType[]
}

interface WriteHint {
  pattern: RegExp
  weight: number
}

const WRITE_HINTS: WriteHint[] = [
  { pattern: /\b(write|edit|patch|delete|create|modify|rewrite|refactor)\b/i, weight: 2 },
  { pattern: /\b(写|修改|编辑|删除|新增|创建|重构|替换)\b/, weight: 2 },
  { pattern: /\b(npm install|pip install|yarn add|pnpm add)\b/i, weight: 3 },
  { pattern: /\b(migrate|migration|alter table|drop table)\b/i, weight: 3 },
  { pattern: /\b(git\s+(?:commit|push|merge|rebase|checkout))\b/i, weight: 3 },
  { pattern: /\bbuild\b/i, weight: 1 },
]

const PATH_TOKEN = /[\w./\\-]+\.(?:ts|tsx|js|jsx|vue|json|md|css|html|py|java|rs|go)/gi
const ROUTED_MODES = new Set<VisibleChatMode>(["agent", "auto"])
const MULTI_AGENT_HINTS = [
  /\b(refactor|migrate|migration|architecture|cross[- ]?module|end[- ]?to[- ]?end|integration|workspace|orchestrator)\b/i,
  /\b(test|typecheck|lint|build|verify|e2e|playwright)\b/i,
  /\b(frontend|backend|desktop|renderer|main process|api|database|settings|ui)\b/i,
  /\b(多文件|跨模块|重构|迁移|端到端|测试|构建|类型检查|联调|编排|工作区|沙箱|权限)\b/,
]
const SINGLE_AGENT_HINTS = [
  /\b(fix|bug|typo|rename|copy|label|style|css|small|simple)\b/i,
  /\b(修复|错别字|文案|样式|改名|小改|简单|单文件)\b/,
]

const CONSENSUS_ROLE_ORDER: AgentRole[] = ["reviewer", "tester", "security"]

function extractPaths(step: TaskStep): Set<string> {
  const text = `${step.description} ${step.instruction || ""}`
  const matches = text.match(PATH_TOKEN) || []
  return new Set(matches.map((m) => m.toLowerCase()))
}

function extractInputPaths(text: string, files?: string[]): string[] {
  const matches = text.match(PATH_TOKEN) || []
  return Array.from(new Set([...matches, ...(files || [])].map((path) => path.replace(/\\/g, "/"))))
}

function inferRisk(input: AgentStrategyInput): "safe" | "medium" | "high" {
  if (input.risk) return input.risk
  const text = input.text || ""
  if (/\b(delete|drop|rebase|push|publish|deploy|payment|auth|permission|secret|token)\b/i.test(text)) return "high"
  if (/(删除|权限|认证|密钥|部署|发布|支付|数据库)/.test(text)) return "high"
  if (/\b(refactor|migrate)\b/i.test(text) || /(重构|迁移)/.test(text)) return "medium"
  return "safe"
}

export function inferAgentRole(step: TaskStep): AgentRole {
  if (step.agentRole) return step.agentRole
  const text = `${step.description} ${step.instruction || ""}`
  const explicitWriteLike = /\b(write|edit|applyPatch|delete|create|modify|rewrite|refactor)\b/i.test(text) ||
    /(写|修改|编辑|删除|新增|创建|重构|替换)/.test(text)
  const writeLike = explicitWriteLike || /\b(implement|fix)\b/i.test(text) || /(实现|修复)/.test(text)
  if (!explicitWriteLike && (/\b(doc|docs|readme|manual|runbook)\b/i.test(text) || /(文档|说明|手册)/.test(text))) return "docs"
  if (!explicitWriteLike && (/\b(release|publish|package|gate|candidate|ship)\b/i.test(text) || /(发布|打包|候选|验收|质量门|交付)/.test(text))) return "release"
  if (!writeLike && (/\b(test|spec|verify|verification|e2e|playwright|typecheck|lint|build)\b/i.test(text) || /(测试|验证|质量门|类型检查|构建)/.test(text))) {
    return "tester"
  }
  if (!writeLike && (/\b(review|audit|inspect|code review)\b/i.test(text) || /(审查|审核|复核)/.test(text))) return "reviewer"
  if (!writeLike && (/\b(security|auth|permission|secret|token|privacy)\b/i.test(text) || /(安全|权限|认证|密钥|隐私)/.test(text))) return "security"
  if (writeLike) return "coder"
  if (/\b(research|investigate|benchmark)\b/i.test(text) || /(调研|研究|竞品|资料)/.test(text)) return "research"
  if (/\b(plan|design|architecture)\b/i.test(text) || /(计划|方案|设计|架构|阅读|分析需求|理解当前实现)/.test(text)) return "planner"
  return "coder"
}

export function getRolePolicy(step: TaskStep): RolePolicy {
  const agentRole = step.agentRole || inferAgentRole(step)
  const consensusWith = requiredConsensusRoles(step, agentRole)
  const memoryTypes = requiredMemoryTypes(step, agentRole)

  return {
    agentRole,
    requiresConsensus: step.requiresConsensus === true || consensusWith.length > 0,
    consensusWith,
    requiresMemoryEvidence: memoryTypes.length > 0,
    memoryTypes,
  }
}

export function applyConsensusPolicy(steps: TaskStep[]): TaskStep[] {
  const result: TaskStep[] = steps.map((step) => ({
    ...step,
    agentRole: inferAgentRole(step),
    consensusWith: step.consensusWith ? [...step.consensusWith] : undefined,
    memoryTypes: step.memoryTypes ? [...step.memoryTypes] : undefined,
  }))

  for (const step of result) {
    applyRolePolicy(step)
  }

  for (const step of [...result]) {
    const policy = getRolePolicy(step)
    const consensusRoles = policy.consensusWith
    if (consensusRoles.length === 0) continue

    step.requiresConsensus = true
    step.consensusWith = Array.from(new Set([...(step.consensusWith || []), ...consensusRoles]))

    for (const consensusRole of consensusRoles) {
      const exists = result.some((candidate) =>
        candidate.agentRole === consensusRole &&
        (candidate.consensusForStepId === step.id || candidate.dependsOn.includes(step.id))
      )
      if (exists) continue

      result.push(createConsensusStep(step, consensusRole))
    }
  }

  return result
}

function applyRolePolicy(step: TaskStep): void {
  const policy = getRolePolicy(step)
  step.agentRole = policy.agentRole
  if (!policy.requiresMemoryEvidence) return

  step.requiresMemoryEvidence = true
  step.memoryTypes = Array.from(new Set([...(step.memoryTypes || []), ...policy.memoryTypes]))
}

function requiredMemoryTypes(step: TaskStep, role: AgentRole): AgentMemoryType[] {
  if (step.consensusForStepId) return []
  const text = `${step.description} ${step.instruction || ""}`
  const required = new Set<AgentMemoryType>()

  const docEvidenceLike = role === "docs" ||
    /\b(doc|docs|readme|manual|runbook|audit|evidence|verification|acceptance)\b/i.test(text) ||
    /(文档|审计|证据|验收|复核|核对)/.test(text)
  if (role !== "release" && docEvidenceLike) {
    required.add("decision")
    required.add("verification")
  }

  if (
    role === "release" ||
    /\b(release|publish|package|gate|candidate|ship)\b/i.test(text) ||
    /(发布|打包|候选|质量门|交付)/.test(text)
  ) {
    required.add("verification")
    required.add("success")
  }

  return Array.from(required)
}

function requiredConsensusRoles(step: TaskStep, role: AgentRole): AgentRole[] {
  if (step.consensusForStepId) return []
  const text = `${step.description} ${step.instruction || ""}`
  const required = new Set<AgentRole>()
  for (const explicitRole of step.consensusWith || []) {
    required.add(explicitRole)
  }
  if (step.requiresConsensus || step.estimatedRisk === "high") {
    required.add("reviewer")
    required.add("tester")
  }
  if (
    step.estimatedRisk === "high" ||
    role === "security" ||
    /\b(auth|permission|secret|token|delete|network|payment|privacy)\b/i.test(text) ||
    /(权限|认证|密钥|删除|网络|支付|隐私|安全)/.test(text)
  ) {
    required.add("security")
  }
  if (role !== "coder" && !step.requiresConsensus && step.estimatedRisk !== "high") {
    required.delete("reviewer")
    required.delete("tester")
  }
  return CONSENSUS_ROLE_ORDER.filter((roleName) => required.has(roleName) && roleName !== role)
}

function createConsensusStep(step: TaskStep, role: AgentRole): TaskStep {
  const label =
    role === "reviewer" ? "Review"
    : role === "tester" ? "Verify"
    : "Security review"
  const instruction =
    role === "reviewer"
      ? `复核步骤 ${step.id} 的实现是否满足目标，发现问题时明确指出需要修复的文件和原因。`
      : role === "tester"
        ? `为步骤 ${step.id} 运行或指定必要验证，不能通过时标记为失败并给出修复依据。`
        : `检查步骤 ${step.id} 是否触碰权限、密钥、命令执行、隐私或危险写入边界。`
  return {
    id: `${step.id}-${role}-consensus`,
    description: `${label}: ${step.description}`,
    instruction,
    dependsOn: [step.id],
    estimatedRisk: "safe",
    agentRole: role,
    consensusForStepId: step.id,
    status: "pending",
  }
}

export function decideAgentExecutionStrategy(input: AgentStrategyInput): AgentStrategyDecision {
  const files = extractInputPaths(input.text || "", input.files)
  const risk = inferRisk(input)

  if (!ROUTED_MODES.has(input.visibleMode)) {
    return {
      visibleMode: input.visibleMode,
      executionStrategy: "none",
      reason: "Ask / Plan 模式保持只读，不进入执行策略路由",
      signals: { files, fileCount: files.length, risk, score: 0, matched: [], overridden: false },
    }
  }

  const multiMatched = MULTI_AGENT_HINTS.filter((pattern) => pattern.test(input.text)).map(() => "复杂任务信号")
  const singleMatched = SINGLE_AGENT_HINTS.filter((pattern) => pattern.test(input.text)).map(() => "小范围任务信号")
  let score = multiMatched.length - singleMatched.length

  if (files.length >= 3) {
    score += 2
    multiMatched.push("提到 3 个以上文件")
  } else if (files.length === 1) {
    score -= 1
    singleMatched.push("只提到 1 个文件")
  }
  if (risk === "high") {
    score += 2
    multiMatched.push("高风险任务需要 Reviewer / Verifier")
  } else if (risk === "medium") {
    score += 1
    multiMatched.push("中风险任务建议拆分验证")
  }

  const override = input.agentStrategy === "single-agent" || input.agentStrategy === "multi-agent"
    ? input.agentStrategy
    : null
  const executionStrategy = override || (score >= 2 ? "multi-agent" : "single-agent")
  const matched = executionStrategy === "multi-agent" ? multiMatched : singleMatched

  return {
    visibleMode: input.visibleMode,
    executionStrategy,
    reason: override
      ? `高级设置强制使用 ${override}`
      : (matched[0] || (executionStrategy === "multi-agent" ? "任务复杂度较高，适合多智能体协作" : "任务范围较小，单智能体执行更直接")),
    signals: {
      files,
      fileCount: files.length,
      risk,
      score,
      matched,
      overridden: Boolean(override),
    },
  }
}

function writePressure(step: TaskStep): number {
  const text = `${step.description} ${step.instruction || ""}`
  let score = 0
  for (const hint of WRITE_HINTS) {
    if (hint.pattern.test(text)) score += hint.weight
  }
  if (step.estimatedRisk === "high") score += 3
  else if (step.estimatedRisk === "medium") score += 1
  return score
}

function hasPathOverlap(steps: TaskStep[]): boolean {
  const seen = new Map<string, string>()
  for (const step of steps) {
    const paths = extractPaths(step)
    for (const path of paths) {
      const owner = seen.get(path)
      if (owner && owner !== step.id) return true
      seen.set(path, step.id)
    }
  }
  return false
}

function explicitGroupSignal(steps: TaskStep[]): { allTagged: boolean; allSameGroup: boolean } {
  const groups = steps.map((s) => s.parallelGroup).filter((g): g is string => !!g)
  return {
    allTagged: groups.length === steps.length,
    allSameGroup: groups.length === steps.length && new Set(groups).size === 1,
  }
}

export function decideExecutionMode(layer: TaskStep[]): StrategyDecision {
  if (layer.length <= 1) {
    return { mode: "serial", reason: "Single step — parallelism has no benefit" }
  }

  const groupSignal = explicitGroupSignal(layer)
  if (groupSignal.allSameGroup) {
    return { mode: "parallel", reason: "All steps share the same explicit parallelGroup" }
  }

  const highRiskCount = layer.filter((s) => s.estimatedRisk === "high").length
  if (highRiskCount >= 2) {
    return { mode: "serial", reason: "Multiple high-risk steps in the same layer" }
  }

  if (hasPathOverlap(layer)) {
    return { mode: "serial", reason: "Steps reference overlapping file paths" }
  }

  const writeHeavy = layer.filter((s) => writePressure(s) >= 4).length
  if (writeHeavy >= 2) {
    return { mode: "serial", reason: "Multiple write-heavy steps — serial avoids interference" }
  }

  if (groupSignal.allTagged) {
    return { mode: "parallel", reason: "Each step carries an explicit parallelGroup tag" }
  }

  const allSafe = layer.every((s) => s.estimatedRisk === "safe")
  if (allSafe) {
    return { mode: "parallel", reason: "All steps are read-only / safe" }
  }

  if (writeHeavy === 0 && highRiskCount === 0) {
    return { mode: "parallel", reason: "No write-heavy or high-risk conflicts detected" }
  }

  return { mode: "serial", reason: "Default conservative choice when signals are mixed" }
}
