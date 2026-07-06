import { settingsStore } from "../settings/settingsStore"
import { emitAgentEvent } from "./agentEvents"
import {
  rememberMemory,
  redactAgentMemoryText,
  type AgentMemoryType,
  type AgentRole,
  type AgentMemoryContext,
} from "./agentMemory"

export type AgentLifecycleEventType =
  | "session:start"
  | "plan:created"
  | "step:start"
  | "tool:before"
  | "tool:after"
  | "step:done"
  | "step:error"
  | "verification:done"
  | "run:done"
  | "run:error"

export interface AgentLifecycleEvent {
  type: AgentLifecycleEventType
  goal?: string
  planId?: string
  stepId?: string
  runId?: string
  taskId?: string
  agentRole?: AgentRole
  workspaceRoot?: string
  repo?: string
  payload?: Record<string, unknown>
}

const MAX_SUMMARY_CHARS = 900
const MAX_OUTPUT_CHARS = 360
const OMITTED_PAYLOAD_KEYS = new Set([
  "content",
  "fileContent",
  "source",
  "code",
  "patch",
  "diff",
  "body",
])

let lifecycleSessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export async function emitAgentLifecycleEvent(event: AgentLifecycleEvent): Promise<void> {
  const content = buildLifecycleMemoryContent(event)
  if (content) {
    emitAgentEvent({
      type: "agent-lifecycle",
      payload: {
        lifecycleType: event.type,
        goal: event.goal,
        planId: event.planId,
        stepId: event.stepId,
        runId: event.runId || lifecycleSessionId,
        taskId: event.taskId,
        agentRole: event.agentRole,
        workspaceRoot: event.workspaceRoot,
        repo: event.repo,
        summary: content,
      },
    })
  }

  const memoryType = memoryTypeForLifecycle(event.type)
  if (!memoryType) return
  if (!content) return

  const source: AgentMemoryContext["source"] =
    event.type === "tool:after" || event.type === "tool:before" ? "tool"
    : event.type === "verification:done" ? "verification"
    : "lifecycle"

  try {
    await rememberMemory({
      type: memoryType,
      content,
      context: {
        workspaceRoot: event.workspaceRoot,
        repo: event.repo,
        taskId: event.taskId || event.stepId,
        runId: event.runId || lifecycleSessionId,
        agentRole: event.agentRole,
        source,
        tags: [event.type],
      },
    })
  } catch {
    // Lifecycle memory is diagnostic evidence; it must never block agent execution.
  }
}

export function summarizeLifecyclePayload(payload: Record<string, unknown> = {}): string {
  const includeToolOutputs = shouldIncludeToolOutputs()
  const parts: string[] = []

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue
    if (OMITTED_PAYLOAD_KEYS.has(key)) continue

    if (key === "stdout" || key === "stderr" || key === "output") {
      if (!includeToolOutputs) continue
      const text = redactAgentMemoryText(String(value)).replace(/\s+/g, " ").trim()
      if (text) parts.push(`${key}: ${text.slice(0, MAX_OUTPUT_CHARS)}`)
      continue
    }

    const rendered = renderPayloadValue(value)
    if (rendered) parts.push(`${key}: ${rendered}`)
  }

  return redactAgentMemoryText(parts.join("; ")).slice(0, MAX_SUMMARY_CHARS)
}

export function resetLifecycleSessionForTests(): void {
  lifecycleSessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function buildLifecycleMemoryContent(event: AgentLifecycleEvent): string {
  const summary = summarizeLifecyclePayload(event.payload || {})
  const base = [
    event.goal ? `goal=${event.goal}` : "",
    event.stepId ? `step=${event.stepId}` : "",
    event.agentRole ? `role=${event.agentRole}` : "",
    summary,
  ].filter(Boolean).join("; ")

  if (event.type === "step:error") return `Step failed: ${base}`
  if (event.type === "run:error") return `Run failed: ${base}`
  if (event.type === "verification:done") return `Verification result: ${base}`
  if (event.type === "run:done") return `Run completed: ${base}`
  if (event.type === "step:done") return `Step completed: ${base}`
  if (event.type === "tool:after") return `Tool result: ${base}`
  if (event.type === "plan:created") return `Plan created: ${base}`
  if (event.type === "session:start") return `Session started: ${base}`
  return base
}

function memoryTypeForLifecycle(type: AgentLifecycleEventType): AgentMemoryType | null {
  if (type === "step:error" || type === "run:error") return "error"
  if (type === "verification:done") return "verification"
  if (type === "run:done" || type === "step:done") return "success"
  if (type === "tool:after") return "tool-result"
  if (type === "plan:created" || type === "session:start") return "decision"
  return null
}

function renderPayloadValue(value: unknown): string {
  if (typeof value === "string") return redactAgentMemoryText(value).replace(/\s+/g, " ").trim().slice(0, 240)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      .slice(0, 8)
      .map(String)
      .join(", ")
  }
  if (typeof value === "object" && value !== null) {
    const safeValue = sanitizePayloadObject(value)
    if (!safeValue) return ""
    return redactAgentMemoryText(JSON.stringify(safeValue)).slice(0, 240)
  }
  return ""
}

function sanitizePayloadObject(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 8)
      .map((item) => sanitizePayloadObject(item, seen))
      .filter((item) => item !== undefined)
    return items.length ? items : undefined
  }
  if (typeof value !== "object" || value === null) {
    if (typeof value === "string") return redactAgentMemoryText(value).replace(/\s+/g, " ").trim().slice(0, 240)
    if (typeof value === "number" || typeof value === "boolean") return value
    return undefined
  }

  if (seen.has(value)) return "[Circular]"
  seen.add(value)
  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (OMITTED_PAYLOAD_KEYS.has(key)) continue
    if ((key === "stdout" || key === "stderr" || key === "output") && !shouldIncludeToolOutputs()) continue
    const safeNested = sanitizePayloadObject(nested, seen)
    if (safeNested !== undefined) result[key] = safeNested
  }
  return Object.keys(result).length ? result : undefined
}

function shouldIncludeToolOutputs(): boolean {
  return settingsStore.get<boolean>("codek.memory.includeToolOutputs", false) === true
}
