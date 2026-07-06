import { computed, ref, type Ref, type ComputedRef } from "vue"

export interface ChatSessionMessage {
  [key: string]: unknown
}

export interface ChatSessionConversationEntry {
  [key: string]: unknown
}

export interface AgentLike {
  conversation: ChatSessionConversationEntry[]
  reset: () => void
  loadConversation?: (messages: ChatSessionConversationEntry[]) => void
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatSessionMessage[]
  conversation: ChatSessionConversationEntry[]
  updatedAt: number
  // 运行时字段（不持久化）
  agent?: AgentLike | null
  busy?: boolean
}

interface UseChatSessionOptions {
  storageKey: string
  defaultTitle: () => string
  /** 每个会话懒创建独立 agent；返回的 agent 必须支持 loadConversation 才能并行 */
  createAgent: (sessionId: string) => AgentLike | Promise<AgentLike>
}

interface UseChatSessionApi {
  sessions: Ref<ChatSession[]>
  currentSessionId: Ref<string>
  currentSession: ComputedRef<ChatSession | null>
  currentAgent: ComputedRef<AgentLike | null>
  currentBusy: ComputedRef<boolean>
  chatMessages: ComputedRef<ChatSessionMessage[]>
  currentSessionTitle: ComputedRef<string>
  sessionLabels: ComputedRef<Array<{ id: string; title: string }>>
  initFromStorage: () => void
  createSession: () => ChatSession
  ensureSessionExists: () => ChatSession
  ensureAgentForSession: (sessionId: string) => Promise<AgentLike | null>
  updateCurrentSession: (updater: (session: ChatSession) => void) => void
  updateSessionById: (sessionId: string, updater: (session: ChatSession) => void) => void
  setSessionBusy: (sessionId: string, busy: boolean) => void
  syncSessionConversationById: (sessionId: string) => void
  persistSessions: () => void
  reset: () => void
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function useChatSession(options: UseChatSessionOptions): UseChatSessionApi {
  const { storageKey, defaultTitle, createAgent } = options

  const sessions = ref<ChatSession[]>([])
  const currentSessionId = ref("")
  const agentCreation = new Map<string, Promise<AgentLike | null>>()

  function normalizeSession(input: Partial<ChatSession>): ChatSession {
    return {
      id: input.id || makeId("chat"),
      title: input.title || defaultTitle(),
      messages: Array.isArray(input.messages) ? input.messages : [],
      conversation: Array.isArray(input.conversation) ? input.conversation : [],
      updatedAt: input.updatedAt || Date.now(),
      agent: null,
      busy: false,
    }
  }

  function loadSessions(): ChatSession[] {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.map(normalizeSession)
    } catch {
      return []
    }
  }

  function persistSessions(): void {
    // 只持久化数据字段，剥离 agent/busy
    const serializable = sessions.value.map((s) => ({
      id: s.id,
      title: s.title,
      messages: s.messages,
      conversation: s.conversation,
      updatedAt: s.updatedAt,
    }))
    localStorage.setItem(storageKey, JSON.stringify(serializable))
  }

  const currentSession = computed<ChatSession | null>(() =>
    sessions.value.find((s) => s.id === currentSessionId.value) || null,
  )
  const currentAgent = computed<AgentLike | null>(() => currentSession.value?.agent || null)
  const currentBusy = computed<boolean>(() => currentSession.value?.busy === true)
  const chatMessages = computed<ChatSessionMessage[]>(() => currentSession.value?.messages || [])
  const currentSessionTitle = computed(() => currentSession.value?.title || "")
  const sessionLabels = computed(() =>
    sessions.value.map((session) => ({ id: session.id, title: session.title })),
  )

  async function ensureAgentForSession(sessionId: string): Promise<AgentLike | null> {
    const session = sessions.value.find((s) => s.id === sessionId)
    if (!session) return null
    if (session.agent) return session.agent
    const existing = agentCreation.get(sessionId)
    if (existing) return existing
    const creation = Promise.resolve(createAgent(sessionId))
      .then((agent) => {
        const target = sessions.value.find((s) => s.id === sessionId)
        if (!target) return null
        if (target.agent) return target.agent
        if (agent.loadConversation) {
          agent.loadConversation(clone(target.conversation || []))
        } else {
          agent.conversation = clone(target.conversation || [])
        }
        target.agent = agent
        return agent
      })
      .finally(() => {
        agentCreation.delete(sessionId)
      })
    agentCreation.set(sessionId, creation)
    return creation
  }

  function createSession(): ChatSession {
    const session = normalizeSession({
      id: makeId("chat"),
      title: "New chat",
      messages: [],
      conversation: [],
      updatedAt: Date.now(),
    })
    sessions.value.unshift(session)
    currentSessionId.value = session.id
    persistSessions()
    return session
  }

  function ensureSessionExists(): ChatSession {
    if (sessions.value.length > 0 && currentSession.value) return currentSession.value
    return createSession()
  }

  function updateSessionById(sessionId: string, updater: (session: ChatSession) => void): void {
    const index = sessions.value.findIndex((s) => s.id === sessionId)
    if (index < 0) return
    updater(sessions.value[index])
    sessions.value[index].updatedAt = Date.now()
    // 切到当前会话才动排序，避免后台会话改动一直 reorder 打扰用户
    if (sessionId === currentSessionId.value) {
      sessions.value = [...sessions.value].sort((l, r) => r.updatedAt - l.updatedAt)
    }
    persistSessions()
  }

  function updateCurrentSession(updater: (session: ChatSession) => void): void {
    if (!currentSessionId.value) return
    updateSessionById(currentSessionId.value, updater)
  }

  function setSessionBusy(sessionId: string, busy: boolean): void {
    const session = sessions.value.find((s) => s.id === sessionId)
    if (!session) return
    session.busy = busy
  }

  function syncSessionConversationById(sessionId: string): void {
    const session = sessions.value.find((s) => s.id === sessionId)
    if (!session || !session.agent) return
    updateSessionById(sessionId, (s) => {
      s.conversation = clone(session.agent?.conversation || [])
    })
  }

  function initFromStorage(): void {
    sessions.value = loadSessions()
    if (sessions.value.length === 0) createSession()
    else {
      currentSessionId.value = sessions.value[0].id
    }
  }

  function reset(): void {
    for (const s of sessions.value) {
      try { s.agent?.reset() } catch { /* ignore */ }
      s.agent = null
      s.busy = false
    }
    agentCreation.clear()
    sessions.value = []
    currentSessionId.value = ""
  }

  return {
    sessions,
    currentSessionId,
    currentSession,
    currentAgent,
    currentBusy,
    chatMessages,
    currentSessionTitle,
    sessionLabels,
    initFromStorage,
    createSession,
    ensureSessionExists,
    ensureAgentForSession,
    updateCurrentSession,
    updateSessionById,
    setSessionBusy,
    syncSessionConversationById,
    persistSessions,
    reset,
  }
}
