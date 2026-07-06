export interface AgentEventBridgeContext {
  updateSessionById: (sessionId: string, updater: (session: any) => void) => void
  syncSessionConversationById: (sessionId: string) => void
  setSessionBusy: (sessionId: string, busy: boolean) => void
  setTaskGraphVisible: (visible: boolean) => void
  getTaskGraphTasks: () => any[]
  playSound: (name: string) => void
  t: (key: string) => string
}

export function handleAgentMessage(sessionId: string, message: unknown, context: AgentEventBridgeContext): void {
  context.updateSessionById(sessionId, (session) => {
    const lastMsg = session.messages[session.messages.length - 1]
    if (lastMsg && lastMsg._streaming) {
      session.messages.pop()
    }
    session.messages.push(clone(message))
  })
  context.syncSessionConversationById(sessionId)
}

export function handleAgentStream(sessionId: string, content: string, context: AgentEventBridgeContext): void {
  context.updateSessionById(sessionId, (session) => {
    const lastMsg = session.messages[session.messages.length - 1]
    if (lastMsg && lastMsg._streaming) {
      lastMsg.content = content
    } else {
      session.messages.push({ role: "assistant", content, _streaming: true })
    }
  })
}

export function handleAgentProgress(sessionId: string, message: string, context: AgentEventBridgeContext): void {
  context.updateSessionById(sessionId, (session) => {
    session.messages.push({
      role: "assistant",
      content: message,
      _progress: true,
    })
  })
}

export function handleToolUse(sessionId: string, info: any, context: AgentEventBridgeContext): void {
  if (info?.status === "running") {
    context.updateSessionById(sessionId, (session) => {
      session.messages.push({ role: "assistant", content: "", toolUse: clone(info) })
    })
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    context.getTaskGraphTasks().push({
      id: taskId,
      description: `${info.name}(${JSON.stringify(info.arguments).slice(0, 60)})`,
      status: "running",
    })
    context.setTaskGraphVisible(true)
    return
  }

  const runningIdx = findLastIndex(context.getTaskGraphTasks(), (task) => task.status === "running")
  if (runningIdx >= 0) {
    const task = context.getTaskGraphTasks()[runningIdx]
    task.status = info?.status === "error" ? "failed" : "completed"
    task.result = info?.result
    task.error = info?.error
  }

  context.updateSessionById(sessionId, (session) => {
    const runningIndex = findLastIndex<any>(
      session.messages,
      (message) => message.toolUse?.name === info?.name && message.toolUse?.status === "running",
    )

    if (runningIndex >= 0) {
      session.messages[runningIndex] = {
        ...session.messages[runningIndex],
        toolUse: {
          ...session.messages[runningIndex].toolUse,
          ...clone(info),
        },
      }
      return
    }

    session.messages.push({ role: "assistant", content: "", toolUse: clone(info) })
  })
}

export function handleAgentPartsStream(sessionId: string, parts: unknown, context: AgentEventBridgeContext): void {
  context.updateSessionById(sessionId, (session) => {
    const lastMsg = session.messages[session.messages.length - 1]
    if (lastMsg && lastMsg._streaming) {
      lastMsg.parts = clone(parts)
      lastMsg.content = ""
    } else {
      session.messages.push({ role: "assistant", content: "", parts: clone(parts), _streaming: true })
    }
  })
}

export function handleAgentPartsFinal(sessionId: string, parts: unknown, context: AgentEventBridgeContext): void {
  context.updateSessionById(sessionId, (session) => {
    const lastMsg = session.messages[session.messages.length - 1]
    if (lastMsg && lastMsg._streaming) {
      lastMsg.parts = clone(parts)
      delete lastMsg._streaming
    } else {
      session.messages.push({ role: "assistant", content: "", parts: clone(parts) })
    }
  })
  context.syncSessionConversationById(sessionId)
}

export function handleAgentPlanEvent(sessionId: string, event: any, context: AgentEventBridgeContext): void {
  context.updateSessionById(sessionId, (session) => {
    if (event?.type === "plan") {
      const plan = normalizePlanEventPayload(event)
      if (plan) upsertPlanMessage(session, plan)
      return
    }

    const msg = [...session.messages].reverse().find((message) =>
      Array.isArray(message.parts) && message.parts.some((part) => part.type === "plan"),
    )
    const part = msg?.parts?.find((item) => item.type === "plan")
    const plan = part?.plan
    if (!plan) return
    updatePlanPhase(plan, event)
    if (event?.type === "plan_done") {
      plan.status = "done"
      if (msg) delete msg._streaming
    }
  })
}

export function handleAgentError(sessionId: string, error: unknown, context: AgentEventBridgeContext): void {
  context.updateSessionById(sessionId, (session) => {
    const lastMsg = session.messages[session.messages.length - 1]
    if (lastMsg && lastMsg._streaming) {
      session.messages.pop()
    }
    session.messages.push({ role: "assistant", content: `**${context.t("agent.error")}**: ${error}` })
  })
  context.syncSessionConversationById(sessionId)
  context.setSessionBusy(sessionId, false)
}

export function handleAgentDone(sessionId: string, context: AgentEventBridgeContext): void {
  context.updateSessionById(sessionId, (session) => {
    const lastMsg = session.messages[session.messages.length - 1]
    if (lastMsg && lastMsg._streaming) {
      delete lastMsg._streaming
    }
  })
  context.syncSessionConversationById(sessionId)
  context.setSessionBusy(sessionId, false)
  context.playSound("complete")
}

function normalizePlanEventPayload(event: any): any | null {
  const rawPlan = event?.plan || null
  if (!rawPlan) return null
  return {
    ...rawPlan,
    phases: Array.isArray(rawPlan.phases)
      ? rawPlan.phases.map((phase) => ({
          ...phase,
          parallelWith: phase.parallelWith || phase.parallel_with || [],
          tasks: Array.isArray(phase.tasks) ? phase.tasks : [],
        }))
      : [],
  }
}

function upsertPlanMessage(session: any, plan: any): void {
  const idx = findLastIndex<any>(session.messages, (message) =>
    Array.isArray(message.parts) && message.parts.some((part) => part.type === "plan" && part.plan?.id === plan.id),
  )
  const part = { type: "plan", plan: clone(plan) }
  if (idx >= 0) {
    session.messages[idx] = {
      ...session.messages[idx],
      content: "",
      parts: [part],
      _streaming: plan.status !== "done" && plan.status !== "failed",
    }
  } else {
    session.messages.push({ role: "assistant", content: "", parts: [part], _streaming: true })
  }
}

function updatePlanPhase(plan: any, event: any): void {
  const phaseId = event?.phaseId
  if (!phaseId || !Array.isArray(plan?.phases)) return
  const phase = plan.phases.find((item) => item.id === phaseId)
  if (!phase) return
  if (event.type === "phase_start") phase.status = "running"
  if (event.type === "phase_done") {
    phase.status = "done"
    phase.result = {
      ...(phase.result || {}),
      summary: event.summary,
      filesChanged: event.filesChanged || [],
    }
  }
  if (event.type === "phase_failed") {
    phase.status = "failed"
    phase.result = { ...(phase.result || {}), error: event.error || "Phase failed" }
  }
  if (event.type === "phase_blocked") {
    phase.status = "blocked"
    phase.result = { ...(phase.result || {}), error: "File lock conflict", conflicts: event.conflicts }
  }
  if (event.type === "reflection") {
    phase.result = {
      ...(phase.result || {}),
      summary: `${phase.result?.summary || ""}\nReflection: ${JSON.stringify(event.decision || {})}`.trim(),
    }
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index
  }
  return -1
}
