import { reactive } from "vue"
import { settingsStore } from "../settings/settingsStore"

export type AgentRole =
  | "planner"
  | "coder"
  | "tester"
  | "reviewer"
  | "security"
  | "docs"
  | "release"
  | "research"

export type AgentMemoryType =
  | "preference"
  | "pattern"
  | "error"
  | "success"
  | "decision"
  | "verification"
  | "tool-result"

export interface AgentMemoryContext {
  workspaceRoot?: string
  repo?: string
  branch?: string
  taskId?: string
  runId?: string
  agentRole?: AgentRole
  source: "manual" | "lifecycle" | "tool" | "verification"
  tags?: string[]
}

export interface AgentMemoryEntry {
  id: string
  type: AgentMemoryType
  content: string
  context: AgentMemoryContext
  createdAt: number
  updatedAt?: number
  useCount?: number
}

export interface MemoryProvider {
  kind: "local" | "agentmemory"
  health(): Promise<{ ok: boolean; error?: string }>
  remember(entry: Omit<AgentMemoryEntry, "id" | "createdAt">): Promise<AgentMemoryEntry>
  recall(
    query: string,
    options?: { limit?: number; workspaceRoot?: string; types?: AgentMemoryType[]; agentRole?: AgentRole },
  ): Promise<AgentMemoryEntry[]>
  clear(options?: { workspaceRoot?: string; types?: AgentMemoryType[] }): Promise<void>
  export(): Promise<AgentMemoryEntry[]>
  import(entries: AgentMemoryEntry[]): Promise<void>
}

type LegacyMemoryType = "preference" | "pattern" | "error" | "success"

interface LegacyMemory {
  id: string
  type: LegacyMemoryType
  content: string
  context: Record<string, unknown>
  timestamp: number
  useCount: number
}

interface MemoryStore {
  preferences: AgentMemoryEntry[]
  patterns: AgentMemoryEntry[]
  errors: AgentMemoryEntry[]
  successes: AgentMemoryEntry[]
  decisions: AgentMemoryEntry[]
  verifications: AgentMemoryEntry[]
  toolResults: AgentMemoryEntry[]
}

type MemoryRuntimeStatus = "local" | "connected" | "fallback" | "disabled" | "error"

const STORAGE_KEY = "codek.agent.memory.v1"
const DEFAULT_MAX_MEMORIES_PER_TYPE = 50
const DEFAULT_AGENTMEMORY_BASE_URL = "http://127.0.0.1:3111"
const DEFAULT_AGENTMEMORY_TIMEOUT_MS = 5000
const MAX_MEMORY_CONTENT_CHARS = 2000

export const agentMemory = reactive<MemoryStore>({
  preferences: [],
  patterns: [],
  errors: [],
  successes: [],
  decisions: [],
  verifications: [],
  toolResults: [],
})

const runtimeState = reactive<{
  provider: "local" | "agentmemory"
  status: MemoryRuntimeStatus
  error?: string
}>({
  provider: "local",
  status: "local",
})

let loaded = false
let activeProvider: MemoryProvider | null = null
let activeProviderKey = ""

export class LocalMemoryProvider implements MemoryProvider {
  readonly kind = "local" as const

  async health(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true }
  }

  async remember(entry: Omit<AgentMemoryEntry, "id" | "createdAt">): Promise<AgentMemoryEntry> {
    return rememberLocal(entry)
  }

  async recall(
    query: string,
    options: { limit?: number; workspaceRoot?: string; types?: AgentMemoryType[]; agentRole?: AgentRole } = {},
  ): Promise<AgentMemoryEntry[]> {
    return recallLocal(query, options)
  }

  async clear(options: { workspaceRoot?: string; types?: AgentMemoryType[] } = {}): Promise<void> {
    clearLocal(options)
  }

  async export(): Promise<AgentMemoryEntry[]> {
    return getAllLocalMemories()
  }

  async import(entries: AgentMemoryEntry[]): Promise<void> {
    clearLocal()
    for (const entry of entries) {
      const normalized = normalizeEntry(entry)
      if (normalized) insertLocal(normalized)
    }
    saveMemory()
  }
}

export class AgentMemoryProvider implements MemoryProvider {
  readonly kind = "agentmemory" as const
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(options: { baseUrl?: string; timeoutMs?: number } = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl || DEFAULT_AGENTMEMORY_BASE_URL)
    this.timeoutMs = normalizeTimeout(options.timeoutMs)
  }

  async health(): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await this.request("/agentmemory/health", { method: "GET" })
      return response.ok ? { ok: true } : { ok: false, error: `HTTP ${response.status}` }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  async remember(entry: Omit<AgentMemoryEntry, "id" | "createdAt">): Promise<AgentMemoryEntry> {
    const timestamp = new Date().toISOString()
    const workspaceRoot = entry.context.workspaceRoot || ""
    const repo = entry.context.repo || projectName(workspaceRoot) || "codek"
    const payload = {
      hookType: "notification",
      sessionId: entry.context.runId || entry.context.taskId || getSessionId(),
      project: repo,
      cwd: workspaceRoot || repo,
      timestamp,
      data: {
        type: entry.type,
        content: sanitizeMemoryContent(entry.content),
        context: entry.context,
      },
    }

    const response = await this.request("/agentmemory/observe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!response.ok) throw new Error(`agentmemory observe failed: HTTP ${response.status}`)
    const body = await safeJson(response)
    const record = body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {}
    return {
      id: typeof record.id === "string" ? record.id : `${entry.type}-${Date.now()}`,
      type: entry.type,
      content: sanitizeMemoryContent(entry.content),
      context: entry.context,
      createdAt: Date.parse(timestamp),
      updatedAt: entry.updatedAt,
      useCount: entry.useCount || 0,
    }
  }

  async recall(
    query: string,
    options: { limit?: number; workspaceRoot?: string; types?: AgentMemoryType[]; agentRole?: AgentRole } = {},
  ): Promise<AgentMemoryEntry[]> {
    const response = await this.request("/agentmemory/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        limit: options.limit,
        project: options.workspaceRoot,
        cwd: options.workspaceRoot,
        format: "compact",
      }),
    })
    if (!response.ok) throw new Error(`agentmemory search failed: HTTP ${response.status}`)
    const body = await safeJson(response)
    return parseAgentMemorySearchResults(body)
      .filter((entry) => matchesRecallOptions(entry, options))
      .slice(0, options.limit || 5)
  }

  async clear(): Promise<void> {
    throw new Error("agentmemory clear is unsupported in v1; remote memory was not cleared")
  }

  async export(): Promise<AgentMemoryEntry[]> {
    const response = await this.request("/agentmemory/export", { method: "GET" })
    if (!response.ok) throw new Error(`agentmemory export failed: HTTP ${response.status}`)
    return parseAgentMemorySearchResults(await safeJson(response))
  }

  async import(entries: AgentMemoryEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.remember(entry)
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    if (!isAllowedAgentMemoryBaseUrl(this.baseUrl)) {
      throw new Error("agentmemory baseUrl must be localhost or 127.0.0.1 in v1")
    }

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null
    const timeout = controller
      ? setTimeout(() => controller.abort(), this.timeoutMs)
      : null
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...headersRecord(init.headers),
          ...agentMemoryAuthHeaders(),
        },
        signal: controller?.signal,
      })
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}

export function loadMemory(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return

    const parsed = JSON.parse(raw) as Partial<Record<keyof MemoryStore, unknown>>
    agentMemory.preferences = normalizeBucket(parsed.preferences, "preference")
    agentMemory.patterns = normalizeBucket(parsed.patterns, "pattern")
    agentMemory.errors = normalizeBucket(parsed.errors, "error")
    agentMemory.successes = normalizeBucket(parsed.successes, "success")
    agentMemory.decisions = normalizeBucket(parsed.decisions, "decision")
    agentMemory.verifications = normalizeBucket(parsed.verifications, "verification")
    agentMemory.toolResults = normalizeBucket(parsed.toolResults, "tool-result")
  } catch {
    // ignore corrupt data
  }
}

export function saveMemory(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(agentMemory))
  } catch {
    // ignore storage errors
  }
}

export function rememberPreference(content: string, context: Record<string, unknown> = {}): void {
  rememberMemoryBestEffort({ type: "preference", content, context: normalizeContext(context, "manual") })
}

export function rememberPattern(content: string, context: Record<string, unknown> = {}): void {
  rememberMemoryBestEffort({ type: "pattern", content, context: normalizeContext(context, "manual") })
}

export function rememberError(content: string, context: Record<string, unknown> = {}): void {
  rememberMemoryBestEffort({ type: "error", content, context: normalizeContext(context, "lifecycle") })
}

export function rememberSuccess(content: string, context: Record<string, unknown> = {}): void {
  rememberMemoryBestEffort({ type: "success", content, context: normalizeContext(context, "lifecycle") })
}

export function rememberUserCorrection(content: string, context: Record<string, unknown> = {}): void {
  const normalizedContext = normalizeContext({ ...context, source: "manual" }, "manual")
  normalizedContext.tags = Array.from(new Set([...(normalizedContext.tags || []), "user-correction"]))
  rememberMemoryBestEffort({
    type: "decision",
    content: `User correction: ${content}`,
    context: normalizedContext,
  })
}

export async function rememberMemory(entry: {
  type: AgentMemoryType
  content: string
  context: AgentMemoryContext
}): Promise<AgentMemoryEntry | null> {
  if (!isMemoryEnabled()) {
    setRuntimeState("local", "disabled")
    return null
  }
  const provider = getActiveMemoryProvider()
  try {
    const saved = await provider.remember({
      type: entry.type,
      content: entry.content,
      context: entry.context,
      useCount: 0,
    })
    if (provider.kind === "agentmemory") {
      setRuntimeState("agentmemory", "connected")
    }
    return saved
  } catch (error) {
    const message = errorMessage(error)
    if (provider.kind === "agentmemory" && shouldFallbackToLocal()) {
      setRuntimeState("agentmemory", "fallback", message)
      return new LocalMemoryProvider().remember({
        type: entry.type,
        content: entry.content,
        context: entry.context,
        useCount: 0,
      })
    }
    setRuntimeState(provider.kind, "error", message)
    throw error
  }
}

export function getRelevantLocalMemories(
  query: string,
  limitOrOptions: number | {
    limit?: number
    workspaceRoot?: string
    types?: AgentMemoryType[]
    agentRole?: AgentRole
  } = 5,
): AgentMemoryEntry[] {
  if (!isMemoryEnabled()) return []
  loadMemory()
  const options = typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions
  return recallLocal(query, options)
}

/**
 * @deprecated Local-only compatibility API. Runtime agent/UI paths should use recallMemories().
 */
export const getRelevantMemories = getRelevantLocalMemories

export async function recallMemories(
  query: string,
  options: { limit?: number; workspaceRoot?: string; types?: AgentMemoryType[]; agentRole?: AgentRole } = {},
): Promise<AgentMemoryEntry[]> {
  if (!isMemoryEnabled()) {
    setRuntimeState("local", "disabled")
    return []
  }
  const provider = getActiveMemoryProvider()
  try {
    const memories = await provider.recall(query, options)
    if (provider.kind === "agentmemory") setRuntimeState("agentmemory", "connected")
    return memories
  } catch (error) {
    const message = errorMessage(error)
    if (provider.kind === "agentmemory" && shouldFallbackToLocal()) {
      setRuntimeState("agentmemory", "fallback", message)
      return recallLocal(query, options)
    }
    setRuntimeState(provider.kind, "error", message)
    return []
  }
}

export async function checkMemoryHealth(): Promise<{ ok: boolean; error?: string }> {
  if (!isMemoryEnabled()) {
    setRuntimeState("local", "disabled")
    return { ok: true }
  }
  const provider = getActiveMemoryProvider()
  const result = await provider.health()
  if (provider.kind === "agentmemory") {
    setRuntimeState("agentmemory", result.ok ? "connected" : (shouldFallbackToLocal() ? "fallback" : "error"), result.error)
  }
  return result
}

export function buildLocalMemoryContext(goal: string): string {
  if (!isMemoryEnabled()) return ""

  const relevantMemories = getRelevantLocalMemories(goal, 3)
  return formatMemoryContext(relevantMemories)
}

/**
 * @deprecated Local-only compatibility API. Runtime agent/UI paths should use buildMemoryContextAsync().
 */
export const buildMemoryContext = buildLocalMemoryContext

export async function buildMemoryContextAsync(goal: string, options: {
  limit?: number
  workspaceRoot?: string
  types?: AgentMemoryType[]
  agentRole?: AgentRole
} = {}): Promise<string> {
  if (!isMemoryEnabled()) return ""
  const relevantMemories = await recallMemories(goal, { limit: options.limit || 3, ...options })
  return formatMemoryContext(relevantMemories)
}

function formatMemoryContext(relevantMemories: AgentMemoryEntry[]): string {
  if (relevantMemories.length === 0) return ""

  const sections: string[] = []

  const preferences = relevantMemories.filter((m) => m.type === "preference")
  if (preferences.length > 0) {
    sections.push("**User Preferences:**\n" + preferences.map((m) => `- ${m.content}`).join("\n"))
  }

  const patterns = relevantMemories.filter((m) => m.type === "pattern")
  if (patterns.length > 0) {
    sections.push("**Common Patterns:**\n" + patterns.map((m) => `- ${m.content}`).join("\n"))
  }

  const errors = relevantMemories.filter((m) => m.type === "error")
  if (errors.length > 0) {
    sections.push("**Known Issues (avoid these):**\n" +
      errors.map((m) => `- ${m.content} (occurred ${m.useCount || 0} times)`).join("\n"))
  }

  const successes = relevantMemories.filter((m) => m.type === "success")
  if (successes.length > 0) {
    sections.push("**Successful Approaches:**\n" + successes.map((m) => `- ${m.content}`).join("\n"))
  }

  const decisions = relevantMemories.filter((m) => m.type === "decision")
  if (decisions.length > 0) {
    sections.push("**Decisions:**\n" + decisions.map((m) => `- ${m.content}`).join("\n"))
  }

  const verifications = relevantMemories.filter((m) => m.type === "verification")
  if (verifications.length > 0) {
    sections.push("**Verification Evidence:**\n" + verifications.map((m) => `- ${m.content}`).join("\n"))
  }

  const toolResults = relevantMemories.filter((m) => m.type === "tool-result")
  if (toolResults.length > 0) {
    sections.push("**Tool Results:**\n" + toolResults.map((m) => `- ${m.content}`).join("\n"))
  }

  return sections.join("\n\n")
}

export function clearLocalMemory(): void {
  clearLocal()
}

/**
 * @deprecated Local-only compatibility API. It does not clear an active agentmemory provider.
 */
export const clearMemory = clearLocalMemory

export function exportLocalMemory(): string {
  return JSON.stringify(agentMemory, null, 2)
}

/**
 * @deprecated Local-only compatibility API. It does not export remote agentmemory data.
 */
export const exportMemory = exportLocalMemory

export function importLocalMemory(data: string): boolean {
  try {
    const parsed = JSON.parse(data) as Partial<Record<keyof MemoryStore, unknown>>
    clearLocal()
    agentMemory.preferences = normalizeBucket(parsed.preferences, "preference")
    agentMemory.patterns = normalizeBucket(parsed.patterns, "pattern")
    agentMemory.errors = normalizeBucket(parsed.errors, "error")
    agentMemory.successes = normalizeBucket(parsed.successes, "success")
    agentMemory.decisions = normalizeBucket(parsed.decisions, "decision")
    agentMemory.verifications = normalizeBucket(parsed.verifications, "verification")
    agentMemory.toolResults = normalizeBucket(parsed.toolResults, "tool-result")
    saveMemory()
    return true
  } catch {
    return false
  }
}

/**
 * @deprecated Local-only compatibility API. It does not import into remote agentmemory.
 */
export const importMemory = importLocalMemory

export function getActiveMemoryProvider(): MemoryProvider {
  loadMemory()
  const providerName = settingsStore.get<"local" | "agentmemory">("codek.memory.provider", "local")
  const key = JSON.stringify({
    providerName,
    baseUrl: settingsStore.get("codek.memory.agentmemory.baseUrl", DEFAULT_AGENTMEMORY_BASE_URL),
    timeoutMs: settingsStore.get("codek.memory.agentmemory.timeoutMs", DEFAULT_AGENTMEMORY_TIMEOUT_MS),
    authHeader: settingsStore.get("codek.memory.agentmemory.authHeader", ""),
  })
  if (activeProvider && activeProviderKey === key) return activeProvider

  activeProviderKey = key
  activeProvider = providerName === "agentmemory"
    ? new AgentMemoryProvider({
        baseUrl: settingsStore.get<string>("codek.memory.agentmemory.baseUrl", DEFAULT_AGENTMEMORY_BASE_URL),
        timeoutMs: settingsStore.get<number>("codek.memory.agentmemory.timeoutMs", DEFAULT_AGENTMEMORY_TIMEOUT_MS),
      })
    : new LocalMemoryProvider()
  setRuntimeState(activeProvider.kind, activeProvider.kind === "local" ? "local" : runtimeState.status)
  return activeProvider
}

export function getMemoryRuntimeState(): { provider: "local" | "agentmemory"; status: MemoryRuntimeStatus; error?: string } {
  return { ...runtimeState }
}

export function resetMemoryProviderForTests(): void {
  activeProvider = null
  activeProviderKey = ""
  loaded = false
  setRuntimeState("local", "local")
  loadMemory()
}

function rememberMemoryBestEffort(entry: {
  type: AgentMemoryType
  content: string
  context: AgentMemoryContext
}): void {
  void rememberMemory(entry).catch(() => {
    // Compatibility facade calls must remain non-blocking for agent execution.
  })
}

export function redactAgentMemoryText(text: string): string {
  return text
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, "[REDACTED_API_KEY]")
    .replace(/(xox[baprs]-[A-Za-z0-9-]{12,})/g, "[REDACTED_TOKEN]")
    .replace(/([A-Za-z0-9._%+-]+)[:=]([A-Za-z0-9_./+=-]{24,})/g, "$1=[REDACTED_SECRET]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s,;]+/gi, "$1=[REDACTED_SECRET]")
}

function rememberLocal(entry: Omit<AgentMemoryEntry, "id" | "createdAt">): AgentMemoryEntry {
  loadMemory()
  const content = sanitizeMemoryContent(entry.content)
  const existing = entry.type === "error" || entry.type === "verification"
    ? getBucket(entry.type).find((m) => m.content === content && sameScope(m.context, entry.context))
    : undefined
  if (existing) {
    existing.useCount = (existing.useCount || 0) + 1
    existing.updatedAt = Date.now()
    saveMemory()
    return existing
  }

  const memory: AgentMemoryEntry = {
    id: `${entry.type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type: entry.type,
    content,
    context: entry.context,
    createdAt: Date.now(),
    updatedAt: entry.updatedAt,
    useCount: entry.useCount || (entry.type === "error" ? 1 : 0),
  }

  insertLocal(memory)
  saveMemory()
  return memory
}

function insertLocal(memory: AgentMemoryEntry): void {
  const bucket = getBucket(memory.type)
  bucket.unshift(memory)
  trimMemories(bucket)
}

function recallLocal(
  query: string,
  options: { limit?: number; workspaceRoot?: string; types?: AgentMemoryType[]; agentRole?: AgentRole } = {},
): AgentMemoryEntry[] {
  loadMemory()
  const limit = options.limit || 5
  const queryLower = query.toLowerCase()
  const allMemories = getAllLocalMemories()
    .filter((memory) => matchesRecallOptions(memory, options))

  const scored = allMemories.map((memory) => {
    let score = 0
    if (memory.content.toLowerCase().includes(queryLower)) score += 10
    const contextStr = JSON.stringify(memory.context).toLowerCase()
    if (contextStr.includes(queryLower)) score += 5
    score += (memory.useCount || 0) * 2

    const ageMs = Date.now() - memory.createdAt
    const ageDays = ageMs / (1000 * 60 * 60 * 24)
    score -= ageDays * 0.1

    if (memory.type === "error") score += 3
    if (memory.type === "success") score += 2
    if (memory.type === "verification") score += 2
    if (memory.type === "decision") score += 2

    return { memory, score }
  })

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => {
      item.memory.useCount = (item.memory.useCount || 0) + 1
      return item.memory
    })
}

function clearLocal(options: { workspaceRoot?: string; types?: AgentMemoryType[] } = {}): void {
  if (!options.workspaceRoot && !options.types?.length) {
    agentMemory.preferences = []
    agentMemory.patterns = []
    agentMemory.errors = []
    agentMemory.successes = []
    agentMemory.decisions = []
    agentMemory.verifications = []
    agentMemory.toolResults = []
    saveMemory()
    return
  }

  for (const type of options.types || (["preference", "pattern", "error", "success", "decision", "verification", "tool-result"] as AgentMemoryType[])) {
    const bucket = getBucket(type)
    const kept = options.workspaceRoot
      ? bucket.filter((entry) => entry.context.workspaceRoot !== options.workspaceRoot)
      : []
    bucket.splice(0, bucket.length, ...kept)
  }
  saveMemory()
}

function getBucket(type: AgentMemoryType): AgentMemoryEntry[] {
  if (type === "preference") return agentMemory.preferences
  if (type === "pattern") return agentMemory.patterns
  if (type === "error") return agentMemory.errors
  if (type === "success") return agentMemory.successes
  if (type === "decision") return agentMemory.decisions
  if (type === "verification") return agentMemory.verifications
  return agentMemory.toolResults
}

function getAllLocalMemories(): AgentMemoryEntry[] {
  return [
    ...agentMemory.preferences,
    ...agentMemory.patterns,
    ...agentMemory.errors,
    ...agentMemory.successes,
    ...agentMemory.decisions,
    ...agentMemory.verifications,
    ...agentMemory.toolResults,
  ]
}

function normalizeBucket(value: unknown, fallbackType: AgentMemoryType): AgentMemoryEntry[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeEntry(item, fallbackType)).filter((item): item is AgentMemoryEntry => !!item)
}

function normalizeEntry(value: unknown, fallbackType?: AgentMemoryType): AgentMemoryEntry | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<AgentMemoryEntry> & Partial<LegacyMemory>
  const type = normalizeType(raw.type, fallbackType)
  if (!type || typeof raw.content !== "string") return null
  const createdAt = typeof raw.createdAt === "number"
    ? raw.createdAt
    : typeof raw.timestamp === "number"
      ? raw.timestamp
      : Date.now()
  return {
    id: typeof raw.id === "string" ? raw.id : `${type}-${createdAt}`,
    type,
    content: sanitizeMemoryContent(raw.content),
    context: normalizeContext(raw.context || {}, "manual"),
    createdAt,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
    useCount: typeof raw.useCount === "number" ? raw.useCount : 0,
  }
}

function normalizeType(value: unknown, fallbackType?: AgentMemoryType): AgentMemoryType | null {
  if (
    value === "preference" ||
    value === "pattern" ||
    value === "error" ||
    value === "success" ||
    value === "decision" ||
    value === "verification" ||
    value === "tool-result"
  ) {
    return value
  }
  return fallbackType || null
}

function normalizeContext(value: Record<string, unknown>, defaultSource: AgentMemoryContext["source"]): AgentMemoryContext {
  return {
    workspaceRoot: typeof value.workspaceRoot === "string" ? value.workspaceRoot : undefined,
    repo: typeof value.repo === "string" ? value.repo : undefined,
    branch: typeof value.branch === "string" ? value.branch : undefined,
    taskId: typeof value.taskId === "string" ? value.taskId : undefined,
    runId: typeof value.runId === "string" ? value.runId : undefined,
    agentRole: isAgentRole(value.agentRole) ? value.agentRole : undefined,
    source: isMemorySource(value.source) ? value.source : defaultSource,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
  }
}

function matchesRecallOptions(
  entry: AgentMemoryEntry,
  options: { workspaceRoot?: string; types?: AgentMemoryType[]; agentRole?: AgentRole },
): boolean {
  if (options.types?.length && !options.types.includes(entry.type)) return false
  if (options.workspaceRoot && entry.context.workspaceRoot && entry.context.workspaceRoot !== options.workspaceRoot) return false
  if (options.agentRole && entry.context.agentRole && entry.context.agentRole !== options.agentRole) return false
  return true
}

function sameScope(left: AgentMemoryContext, right: AgentMemoryContext): boolean {
  return left.workspaceRoot === right.workspaceRoot && left.taskId === right.taskId && left.runId === right.runId
}

function trimMemories(memories: AgentMemoryEntry[]): void {
  const max = getMaxMemoriesPerType()
  while (memories.length > max) memories.pop()
}

function isMemoryEnabled(): boolean {
  return settingsStore.get<boolean>("codek.memory.enabled", true) !== false
}

function getMaxMemoriesPerType(): number {
  const value = settingsStore.get<number>("codek.memory.maxEntriesPerType", DEFAULT_MAX_MEMORIES_PER_TYPE)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_MEMORIES_PER_TYPE
}

function shouldFallbackToLocal(): boolean {
  return settingsStore.get<boolean>("codek.memory.agentmemory.fallbackToLocal", true) !== false
}

function agentMemoryAuthHeaders(): Record<string, string> {
  const value = settingsStore.get<string>("codek.memory.agentmemory.authHeader", "").trim()
  return value ? { Authorization: value } : {}
}

function headersRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return headers
}

function setRuntimeState(provider: "local" | "agentmemory", status: MemoryRuntimeStatus, error?: string): void {
  runtimeState.provider = provider
  runtimeState.status = status
  runtimeState.error = error
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "") || DEFAULT_AGENTMEMORY_BASE_URL
}

function normalizeTimeout(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_AGENTMEMORY_TIMEOUT_MS
}

function isAllowedAgentMemoryBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    const hostname = url.hostname.replace(/^\[|\]$/g, "")
    return ["127.0.0.1", "localhost", "::1"].includes(hostname)
  } catch {
    return false
  }
}

function parseAgentMemorySearchResults(body: unknown): AgentMemoryEntry[] {
  const containers: unknown[] = []
  if (Array.isArray(body)) containers.push(...body)
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>
    for (const key of ["results", "memories", "observations", "items"]) {
      const value = record[key]
      if (Array.isArray(value)) containers.push(...value)
    }
  }

  return containers
    .map((item): AgentMemoryEntry | null => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {}
      const nested = (record.memory || record.observation || record.entry || record) as Record<string, unknown>
      const content = stringValue(nested.content) || stringValue(nested.narrative) || stringValue(nested.title)
      if (!content) return null
      const type = normalizeType(nested.type, "pattern") || "pattern"
      const createdAtRaw = stringValue(nested.createdAt) || stringValue(nested.timestamp)
      const parsedCreatedAt = createdAtRaw ? Date.parse(createdAtRaw) : NaN
      return {
        id: stringValue(nested.id) || `${type}-${Date.now()}`,
        type,
        content: sanitizeMemoryContent(content),
        context: normalizeContext(
          typeof nested.context === "object" && nested.context !== null
            ? nested.context as Record<string, unknown>
            : {},
          "lifecycle",
        ),
        createdAt: Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : Date.now(),
        useCount: 0,
      } satisfies AgentMemoryEntry
    })
    .filter((entry): entry is AgentMemoryEntry => !!entry)
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function sanitizeMemoryContent(content: string): string {
  return redactAgentMemoryText(content).replace(/\s+\n/g, "\n").trim().slice(0, MAX_MEMORY_CONTENT_CHARS)
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

function isMemorySource(value: unknown): value is AgentMemoryContext["source"] {
  return value === "manual" || value === "lifecycle" || value === "tool" || value === "verification"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getSessionId(): string {
  try {
    const key = "codek.agent.memory.session"
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    const created = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    sessionStorage.setItem(key, created)
    return created
  } catch {
    return `session-${Date.now()}`
  }
}

function projectName(workspaceRoot: string): string {
  return workspaceRoot.replace(/\\/g, "/").split("/").filter(Boolean).pop() || ""
}

loadMemory()
