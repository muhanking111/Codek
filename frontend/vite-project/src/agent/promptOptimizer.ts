import { reactive } from "vue"

export interface PromptFeedback {
  taskId: string
  promptVersion: string
  totalCalls: number
  parseFailures: number
  toolFailures: number
  retries: number
  success: boolean
  timestamp: number
  errorSamples: string[]
}

interface OptimizerState {
  recent: PromptFeedback[]
  maxRecent: number
}

const STORAGE_KEY = "codek.agent.promptOptimizer.v1"

export const optimizerState = reactive<OptimizerState>({
  recent: [],
  maxRecent: 100,
})

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ recent: optimizerState.recent }))
  } catch {
    /* ignore storage errors */
  }
}

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as { recent?: PromptFeedback[] }
    optimizerState.recent = Array.isArray(parsed.recent) ? parsed.recent : []
  } catch {
    /* ignore */
  }
}

load()

export function recordFeedback(feedback: PromptFeedback): void {
  optimizerState.recent.unshift(feedback)
  if (optimizerState.recent.length > optimizerState.maxRecent) {
    optimizerState.recent.length = optimizerState.maxRecent
  }
  persist()
}

export interface OptimizationHints {
  augmentations: string[]
  avoidances: string[]
  successfulPatterns: string[]
}

const STRICT_FORMAT_HINT = [
  "STRICT TOOL FORMAT REMINDER:",
  "Tool calls MUST be inside a ```tool fenced block containing valid JSON.",
  "Required JSON shape: {\"name\": \"<tool_name>\", \"arguments\": { ... }}.",
  "Do not invent tools — only call tools listed in the system prompt.",
  "Do not wrap the JSON in extra prose or markdown headings.",
].join("\n")

export function computeHints(taskGoal: string): OptimizationHints {
  const hints: OptimizationHints = {
    augmentations: [],
    avoidances: [],
    successfulPatterns: [],
  }

  const recent = optimizerState.recent.slice(0, 10)
  if (recent.length === 0) return hints

  const consecutiveParseFails = recent
    .slice(0, 3)
    .filter((f) => f.parseFailures > 0).length

  if (consecutiveParseFails >= 3) {
    hints.augmentations.push(STRICT_FORMAT_HINT)
  }

  const errorBuckets = new Map<string, number>()
  for (const fb of recent) {
    for (const err of fb.errorSamples) {
      const key = err.slice(0, 80).toLowerCase()
      errorBuckets.set(key, (errorBuckets.get(key) || 0) + 1)
    }
  }
  for (const [pattern, count] of errorBuckets) {
    if (count >= 3) {
      hints.avoidances.push(`Recurring error to avoid: ${pattern}`)
    }
  }

  const goalLower = taskGoal.toLowerCase()
  const matches = optimizerState.recent
    .filter((f) => f.success && f.parseFailures === 0)
    .filter((f) => f.taskId.toLowerCase().includes(goalLower.slice(0, 12)))
    .slice(0, 3)
  for (const match of matches) {
    hints.successfulPatterns.push(`Previously succeeded with prompt version ${match.promptVersion}`)
  }

  return hints
}

export function applyHints(basePrompt: string, hints: OptimizationHints): string {
  const sections: string[] = [basePrompt]
  if (hints.augmentations.length > 0) {
    sections.push(`\n# Format Enforcement\n${hints.augmentations.join("\n\n")}`)
  }
  if (hints.avoidances.length > 0) {
    sections.push(`\n# Avoid These Failures\n${hints.avoidances.map((s) => `- ${s}`).join("\n")}`)
  }
  if (hints.successfulPatterns.length > 0) {
    sections.push(`\n# Past Successes\n${hints.successfulPatterns.map((s) => `- ${s}`).join("\n")}`)
  }
  return sections.join("\n")
}

export function optimizePrompt(basePrompt: string, taskGoal: string): string {
  const hints = computeHints(taskGoal)
  return applyHints(basePrompt, hints)
}

export function clearFeedback(): void {
  optimizerState.recent = []
  persist()
}
