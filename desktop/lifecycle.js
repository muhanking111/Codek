function shouldKeepAliveOnWindowClosed({ isQuitting, isMac, hasRunningGoals }) {
  if (!isQuitting && hasRunningGoals) {
    return { keepAlive: true, hideWindow: true, quit: false }
  }
  return { keepAlive: false, hideWindow: false, quit: !isMac }
}

function normalizeDirtyCount(rendererLifecycle) {
  const candidates = [
    rendererLifecycle?.dirtyCount,
    rendererLifecycle?.evidence?.dirtyCount,
    rendererLifecycle?.dirtyEvidence?.dirtyCount,
    Array.isArray(rendererLifecycle?.dirty) ? rendererLifecycle.dirty.length : undefined,
    Array.isArray(rendererLifecycle?.evidence?.dirty) ? rendererLifecycle.evidence.dirty.length : undefined,
    Array.isArray(rendererLifecycle?.dirtyEvidence?.dirty) ? rendererLifecycle.dirtyEvidence.dirty.length : undefined,
  ]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value) && value >= 0) return value
  }
  const riskCandidates = [
    rendererLifecycle?.risk,
    rendererLifecycle?.evidence?.risk,
    rendererLifecycle?.dirtyEvidence?.risk,
  ]
  if (riskCandidates.some((candidate) => candidate === "dirty-working-copy")) return 1
  return 0
}

function resolveShutdownDecision(rendererLifecycle = {}) {
  const explicit = typeof rendererLifecycle?.decision === "string"
    ? rendererLifecycle.decision
    : ""
  if (["cancel", "confirm", "force", "allow"].includes(explicit)) return explicit
  if (rendererLifecycle?.cancelled === true || rendererLifecycle?.allowed === false) return "cancel"
  if (rendererLifecycle?.forced === true) return "force"
  if (rendererLifecycle?.allowed === true) return "allow"
  return ""
}

function resolveShutdownRisk(rendererLifecycle, dirtyCount) {
  const candidates = [
    rendererLifecycle?.risk,
    rendererLifecycle?.evidence?.risk,
    rendererLifecycle?.dirtyEvidence?.risk,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate
  }
  return dirtyCount > 0 ? "dirty-working-copy" : "none"
}

function resolveBackupJoinEvidence(rendererLifecycle) {
  const candidates = [
    rendererLifecycle?.backupJoin,
    rendererLifecycle?.evidence?.backupJoin,
    rendererLifecycle?.joinBackups,
    rendererLifecycle?.evidence?.joinBackups,
  ]
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      return {
        ...candidate,
        completed: candidate.completed === true,
      }
    }
  }
  return null
}

function hasCompletedBackupJoinEvidence(rendererLifecycle, backupJoin) {
  if (backupJoin?.completed !== true) return false
  const phaseCandidates = [
    rendererLifecycle?.phase,
    rendererLifecycle?.evidence?.phase,
    rendererLifecycle?.joinBackups?.phase,
    rendererLifecycle?.evidence?.joinBackups?.phase,
    rendererLifecycle?.backupJoin?.phase,
    rendererLifecycle?.evidence?.backupJoin?.phase,
  ]
  return phaseCandidates.includes("backupJoin")
}

function shouldPreventWindowCloseForWorkingCopies({ rendererLifecycle = null, force = false, source = "native-close" } = {}) {
  if (force) {
    return {
      allowed: true,
      preventClose: false,
      forceClose: true,
      forced: true,
      decision: "force",
      dirtyCount: normalizeDirtyCount(rendererLifecycle),
      risk: "none",
      backupJoin: resolveBackupJoinEvidence(rendererLifecycle),
      source,
    }
  }

  const dirtyCount = normalizeDirtyCount(rendererLifecycle)
  const decision = resolveShutdownDecision(rendererLifecycle)
  const risk = resolveShutdownRisk(rendererLifecycle, dirtyCount)
  const backupJoin = resolveBackupJoinEvidence(rendererLifecycle)
  const backupJoinCompleted = hasCompletedBackupJoinEvidence(rendererLifecycle, backupJoin)
  const rendererUnavailable = rendererLifecycle?.rendererUnavailable === true
    || rendererLifecycle?.timedOut === true
    || rendererLifecycle?.error === true

  // Honor the renderer lifecycle decision first when it made an explicit choice.
  if (decision === "cancel" && !rendererUnavailable) {
    return {
      allowed: false,
      preventClose: true,
      forceClose: false,
      forced: false,
      decision,
      dirtyCount,
      risk,
      backupJoin,
      source,
    }
  }

  if (decision === "confirm" || decision === "force") {
    if (decision === "confirm" && dirtyCount > 0 && !backupJoinCompleted) {
      return {
        allowed: false,
        preventClose: true,
        forceClose: false,
        forced: false,
        decision: "cancel",
        dirtyCount,
        risk: "backup-unavailable",
        backupJoin,
        source,
      }
    }
    return {
      allowed: true,
      preventClose: false,
      forceClose: true,
      forced: decision === "force" || rendererLifecycle?.forced === true,
      decision,
      dirtyCount,
      risk: decision === "force" ? "none" : risk,
      backupJoin,
      source,
    }
  }

  if (dirtyCount <= 0) {
    return {
      allowed: true,
      preventClose: false,
      forceClose: false,
      forced: false,
      decision: decision || "allow",
      dirtyCount,
      risk: "none",
      backupJoin,
      source,
    }
  }

  if (rendererLifecycle?.allowed === true) {
    if (dirtyCount > 0 && !backupJoinCompleted) {
      return {
        allowed: false,
        preventClose: true,
        forceClose: false,
        forced: false,
        decision: "cancel",
        dirtyCount,
        risk: "backup-unavailable",
        backupJoin,
        source,
      }
    }
    return {
      allowed: true,
      preventClose: false,
      forceClose: true,
      forced: rendererLifecycle?.forced === true,
      decision: decision || "confirm",
      dirtyCount,
      risk,
      backupJoin,
      source,
    }
  }

  if (rendererUnavailable) {
    return {
      allowed: true,
      preventClose: false,
      forceClose: false,
      forced: false,
      decision: "allow-renderer-unavailable",
      dirtyCount,
      risk: risk === "none" ? "renderer-unavailable" : risk,
      backupJoin,
      source,
    }
  }

  return {
    allowed: false,
    preventClose: true,
    forceClose: false,
    forced: false,
    decision: decision || "cancel",
    dirtyCount,
    risk,
    backupJoin,
    source,
  }
}

module.exports = {
  shouldKeepAliveOnWindowClosed,
  shouldPreventWindowCloseForWorkingCopies,
  normalizeDirtyCount,
  resolveShutdownDecision,
  resolveShutdownRisk,
  resolveBackupJoinEvidence,
}
