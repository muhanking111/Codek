const PHASE_STATUS_MODEL = Object.freeze([
  "active",
  "completed",
  "systemError",
  "blocked",
  "needs-validation",
  "validated-pass",
  "validated-fail",
  "superseded",
])

const PHASE_STATUS_SET = new Set(PHASE_STATUS_MODEL)

function clip(value, limit = 500) {
  const text = String(value ?? "")
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function normalizePhaseStatus(value, fallback = "active") {
  const raw = String(value || "").trim()
  if (PHASE_STATUS_SET.has(raw)) return raw
  const normalized = raw.toLowerCase().replace(/_/g, "-")
  if (normalized === "running" || normalized === "started" || normalized === "in-progress" || normalized === "pending") return "active"
  if (normalized === "done" || normalized === "complete" || normalized === "completed" || normalized === "success" || normalized === "succeeded") return "completed"
  if (normalized === "error" || normalized === "failed" || normalized === "failure" || normalized === "crashed" || normalized === "system-error") return "systemError"
  if (normalized === "blocked" || normalized === "waiting-user" || normalized === "waiting-for-user") return "blocked"
  if (normalized === "needs-validation" || normalized === "validation-needed" || normalized === "validating") return "needs-validation"
  if (normalized === "validated-pass" || normalized === "validation-pass" || normalized === "validation-passed" || normalized === "passed") return "validated-pass"
  if (normalized === "validated-fail" || normalized === "validation-fail" || normalized === "validation-failed") return "validated-fail"
  if (normalized === "superseded" || normalized === "cancelled" || normalized === "canceled" || normalized === "skipped") return "superseded"
  return PHASE_STATUS_SET.has(fallback) ? fallback : "active"
}

function lifecycleStatusForEvent(event = {}) {
  const type = String(event.type || "").toLowerCase()
  if (event.status) return normalizePhaseStatus(event.status)
  if (event.validation?.result || type.includes("validation")) {
    const result = String(event.validation?.result || event.validationResult || "").toLowerCase()
    if (result === "pass" || result === "passed" || result === "success") return "validated-pass"
    if (result === "fail" || result === "failed" || result === "error") return "validated-fail"
    return "needs-validation"
  }
  if (type === "phase_start" || type === "goal_start" || type === "progress") return "active"
  if (type === "phase_done" || type === "plan_done" || type === "done") return "completed"
  if (type === "phase_blocked") return "blocked"
  if (type === "phase_failed" || type === "error" || type === "quota_exceeded") return "systemError"
  if (type === "cancelled" || type === "superseded") return "superseded"
  return "active"
}

function normalizeValidation(value = {}, status) {
  const input = value && typeof value === "object" ? value : {}
  const result = clip(input.result || input.outcome || "")
  return {
    status,
    result,
    command: clip(input.command || input.check || ""),
    detail: clip(input.detail || input.message || input.error || ""),
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.map((item) => clip(item, 240)).filter(Boolean) : [],
    checkedAt: Number.isFinite(Number(input.checkedAt || input.updatedAt)) ? Number(input.checkedAt || input.updatedAt) : null,
  }
}

function normalizeFailureRecovery(value = {}, fallbackStatus) {
  const input = value && typeof value === "object" ? value : {}
  return {
    status: normalizePhaseStatus(input.status || fallbackStatus || "active"),
    action: clip(input.action || input.nextAction || ""),
    detail: clip(input.detail || input.reason || input.error || ""),
    retryable: input.retryable === true,
    recoveredAt: Number.isFinite(Number(input.recoveredAt || input.updatedAt)) ? Number(input.recoveredAt || input.updatedAt) : null,
  }
}

function normalizePhaseLifecycleEntry(entry = {}) {
  const status = normalizePhaseStatus(entry.status || entry.phaseStatus)
  const stage = clip(entry.stage || entry.phaseId || entry.id || "phase", 160)
  return {
    id: clip(entry.id || `phase:${stage}`, 240),
    stage,
    phaseName: clip(entry.phaseName || entry.name || entry.title || stage, 240),
    threadId: clip(entry.threadId || entry.sourceThreadId || entry.runId || entry.goalId || "", 240),
    status,
    validation: normalizeValidation(entry.validation, status),
    failureRecovery: normalizeFailureRecovery(entry.failureRecovery || entry.recovery, status),
    evidenceRefs: Array.isArray(entry.evidenceRefs) ? entry.evidenceRefs.map((item) => clip(item, 240)).filter(Boolean) : [],
    updatedAt: Number.isFinite(Number(entry.updatedAt || entry.timestamp)) ? Number(entry.updatedAt || entry.timestamp) : Date.now(),
  }
}

function recordPhaseLifecycleEvent(previous, event = {}) {
  const previousEntry = previous ? normalizePhaseLifecycleEntry(previous) : {}
  const phaseId = event.phaseId || event.stage || previousEntry.stage || "phase"
  const status = lifecycleStatusForEvent(event)
  return normalizePhaseLifecycleEntry({
    ...previousEntry,
    id: previousEntry.id || `phase:${phaseId}`,
    stage: phaseId,
    phaseName: event.phaseName || event.name || event.title || previousEntry.phaseName || phaseId,
    threadId: event.threadId || event.sourceThreadId || event.runId || event.goalId || previousEntry.threadId || "",
    status,
    validation: {
      ...previousEntry.validation,
      ...(event.validation || {}),
      result: event.validationResult || event.validation?.result || previousEntry.validation?.result,
    },
    failureRecovery: {
      ...previousEntry.failureRecovery,
      ...(event.failureRecovery || event.recovery || {}),
      status: event.failureRecovery?.status || event.recovery?.status || previousEntry.failureRecovery?.status || status,
    },
    evidenceRefs: event.evidenceRefs || previousEntry.evidenceRefs || [],
    updatedAt: event.updatedAt || event.timestamp || Date.now(),
  })
}

function buildPhaseLifecycleSummary(entries = []) {
  const normalizedEntries = entries.map(normalizePhaseLifecycleEntry)
  const byStatus = PHASE_STATUS_MODEL.reduce((result, status) => {
    result[status] = normalizedEntries.filter((entry) => entry.status === status).length
    return result
  }, {})
  const validationStatuses = new Set(["needs-validation", "validated-pass", "validated-fail"])
  const recoveryStatuses = new Set(["systemError", "blocked"])
  return {
    total: normalizedEntries.length,
    byStatus,
    active: byStatus.active,
    terminal: byStatus.completed + byStatus["validated-pass"] + byStatus["validated-fail"] + byStatus.superseded,
    validationVisible: normalizedEntries.filter((entry) => Boolean(entry.validation.command || entry.validation.result || entry.validation.detail)).length,
    validationMissing: normalizedEntries.filter((entry) => validationStatuses.has(entry.status) && !entry.validation.result).length,
    failureRecoveryVisible: normalizedEntries.filter((entry) => Boolean(entry.failureRecovery.action || entry.failureRecovery.detail || entry.failureRecovery.retryable)).length,
    failureRecoveryMissing: normalizedEntries.filter((entry) => recoveryStatuses.has(entry.status) && !entry.failureRecovery.detail && !entry.failureRecovery.action).length,
  }
}

module.exports = {
  PHASE_STATUS_MODEL,
  buildPhaseLifecycleSummary,
  normalizePhaseLifecycleEntry,
  normalizePhaseStatus,
  recordPhaseLifecycleEvent,
}
