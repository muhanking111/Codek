/**
 * Automation Manager — scheduled tasks and event triggers.
 *
 * Supports:
 * - Interval-based scheduling (every N minutes/hours)
 * - Cron-like patterns
 * - Event-based triggers (file save, git commit)
 * - Actions: run command, run agent prompt, HTTP request
 */

const STORAGE_KEY = "codek.automations.v1"

export type AutomationTrigger =
  | { type: "interval"; minutes: number }
  | { type: "cron"; expression: string }
  | { type: "onFileSave"; pattern?: string }
  | { type: "onGitCommit" }

export type AutomationAction =
  | { type: "runCommand"; command: string }
  | { type: "runAgent"; prompt: string }
  | { type: "httpRequest"; url: string; method?: string; body?: string }

export interface Automation {
  id: string
  name: string
  description: string
  enabled: boolean
  trigger: AutomationTrigger
  action: AutomationAction
  createdAt: number
  lastRunAt?: number
  runCount: number
}

let automations: Automation[] = []
let loaded = false
let intervalTimers: Map<string, ReturnType<typeof setInterval>> = new Map()

function load() {
  if (loaded) return
  loaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) automations = JSON.parse(raw)
  } catch {
    automations = []
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(automations))
  } catch {
    // storage full
  }
}

function generateId(): string {
  return `auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export function getAutomations(): Automation[] {
  load()
  return [...automations]
}

export function addAutomation(input: Omit<Automation, "id" | "createdAt" | "runCount">): Automation {
  load()
  const auto: Automation = {
    ...input,
    id: generateId(),
    createdAt: Date.now(),
    runCount: 0,
  }
  automations.push(auto)
  save()
  scheduleAutomation(auto)
  return auto
}

export function updateAutomation(id: string, patch: Partial<Automation>): Automation | null {
  load()
  const idx = automations.findIndex((a) => a.id === id)
  if (idx < 0) return null
  automations[idx] = { ...automations[idx], ...patch }
  save()
  // Re-schedule if trigger or enabled changed
  if (patch.trigger !== undefined || patch.enabled !== undefined) {
    unschedule(id)
    if (automations[idx].enabled) scheduleAutomation(automations[idx])
  }
  return automations[idx]
}

export function deleteAutomation(id: string): boolean {
  load()
  const idx = automations.findIndex((a) => a.id === id)
  if (idx < 0) return false
  unschedule(id)
  automations.splice(idx, 1)
  save()
  return true
}

export function toggleAutomation(id: string): Automation | null {
  load()
  const auto = automations.find((a) => a.id === id)
  if (!auto) return null
  auto.enabled = !auto.enabled
  save()
  if (auto.enabled) {
    scheduleAutomation(auto)
  } else {
    unschedule(id)
  }
  return auto
}

// ── Scheduling ────────────────────────────────────────────────────────────

export type AutomationRunner = (auto: Automation) => Promise<void>
let runner: AutomationRunner | null = null

export function setAutomationRunner(fn: AutomationRunner): void {
  runner = fn
}

function scheduleAutomation(auto: Automation) {
  if (!auto.enabled) return
  unschedule(auto.id)

  if (auto.trigger.type === "interval") {
    const ms = auto.trigger.minutes * 60 * 1000
    if (ms < 60000) return // min 1 minute
    const timer = setInterval(() => {
      if (runner) runner(auto).catch(() => {})
      auto.runCount++
      auto.lastRunAt = Date.now()
      save()
    }, ms)
    intervalTimers.set(auto.id, timer)
  }
  // TODO: cron parsing for type "cron"
  // Event-based triggers handled by external callers
}

function unschedule(id: string) {
  const timer = intervalTimers.get(id)
  if (timer) {
    clearInterval(timer)
    intervalTimers.delete(id)
  }
}

export function startAll(): void {
  load()
  for (const auto of automations) {
    scheduleAutomation(auto)
  }
}

export function stopAll(): void {
  for (const [id] of intervalTimers) {
    unschedule(id)
  }
}

// ── Event Triggers ────────────────────────────────────────────────────────

export function triggerOnFileSave(filePath: string): void {
  load()
  for (const auto of automations) {
    if (!auto.enabled || auto.trigger.type !== "onFileSave") continue
    if (auto.trigger.pattern && !filePath.includes(auto.trigger.pattern)) continue
    if (runner) runner(auto).catch(() => {})
    auto.runCount++
    auto.lastRunAt = Date.now()
    save()
  }
}

export function triggerOnGitCommit(): void {
  load()
  for (const auto of automations) {
    if (!auto.enabled || auto.trigger.type !== "onGitCommit") continue
    if (runner) runner(auto).catch(() => {})
    auto.runCount++
    auto.lastRunAt = Date.now()
    save()
  }
}
