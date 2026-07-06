const test = require("node:test")
const assert = require("node:assert/strict")

const {
  shouldKeepAliveOnWindowClosed,
  shouldPreventWindowCloseForWorkingCopies,
} = require("./lifecycle")

test("keeps Electron alive when goals are still running", () => {
  const decision = shouldKeepAliveOnWindowClosed({
    isQuitting: false,
    isMac: false,
    hasRunningGoals: true,
  })

  assert.deepEqual(decision, { keepAlive: true, hideWindow: true, quit: false })
})

test("quits on Windows/Linux when there are no running goals", () => {
  const decision = shouldKeepAliveOnWindowClosed({
    isQuitting: false,
    isMac: false,
    hasRunningGoals: false,
  })

  assert.deepEqual(decision, { keepAlive: false, hideWindow: false, quit: true })
})

test("does not quit on macOS when there are no windows", () => {
  const decision = shouldKeepAliveOnWindowClosed({
    isQuitting: false,
    isMac: true,
    hasRunningGoals: false,
  })

  assert.deepEqual(decision, { keepAlive: false, hideWindow: false, quit: false })
})

test("allows clean native close without shutdown veto", () => {
  const decision = shouldPreventWindowCloseForWorkingCopies({
    rendererLifecycle: {
      dirtyCount: 0,
      evidence: { phase: "shutdownRisk", risk: "none" },
    },
  })

  assert.deepEqual(decision, {
    allowed: true,
    preventClose: false,
    forceClose: false,
    forced: false,
    decision: "allow",
    dirtyCount: 0,
    risk: "none",
    backupJoin: null,
    source: "native-close",
  })
})

test("prevents dirty native close when renderer cancels", () => {
  const decision = shouldPreventWindowCloseForWorkingCopies({
    rendererLifecycle: {
      decision: "cancel",
      dirtyCount: 1,
      evidence: { phase: "shutdownRisk", risk: "dirty-working-copy" },
    },
    source: "app-quit",
  })

  assert.equal(decision.allowed, false)
  assert.equal(decision.preventClose, true)
  assert.equal(decision.forceClose, false)
  assert.equal(decision.decision, "cancel")
  assert.equal(decision.dirtyCount, 1)
  assert.equal(decision.risk, "dirty-working-copy")
  assert.equal(decision.source, "app-quit")
})

test("respects explicit renderer cancel even when dirty count is missing", () => {
  const decision = shouldPreventWindowCloseForWorkingCopies({
    rendererLifecycle: {
      decision: "cancel",
      evidence: { phase: "shutdownRisk", risk: "dirty-working-copy" },
    },
  })

  assert.equal(decision.allowed, false)
  assert.equal(decision.preventClose, true)
  assert.equal(decision.forceClose, false)
  assert.equal(decision.decision, "cancel")
  assert.equal(decision.dirtyCount, 1)
  assert.equal(decision.risk, "dirty-working-copy")
})

test("allows dirty native close when renderer confirms", () => {
  const decision = shouldPreventWindowCloseForWorkingCopies({
    rendererLifecycle: {
      decision: "confirm",
      dirtyCount: 2,
      evidence: {
        phase: "backupJoin",
        risk: "dirty-working-copy",
        backupJoin: { id: "join.workingCopyBackups", completed: true },
      },
    },
  })

  assert.equal(decision.allowed, true)
  assert.equal(decision.preventClose, false)
  assert.equal(decision.forceClose, true)
  assert.equal(decision.decision, "confirm")
  assert.equal(decision.dirtyCount, 2)
  assert.equal(decision.backupJoin.completed, true)
})

test("prevents dirty renderer confirm when dirty count is missing but risk remains dirty", () => {
  const decision = shouldPreventWindowCloseForWorkingCopies({
    rendererLifecycle: {
      decision: "confirm",
      evidence: { phase: "shutdownRisk", risk: "dirty-working-copy" },
    },
  })

  assert.equal(decision.allowed, false)
  assert.equal(decision.preventClose, true)
  assert.equal(decision.forceClose, false)
  assert.equal(decision.decision, "cancel")
  assert.equal(decision.dirtyCount, 1)
  assert.equal(decision.risk, "backup-unavailable")
})

test("prevents dirty renderer confirm until working copy backups are joined", () => {
  const decision = shouldPreventWindowCloseForWorkingCopies({
    rendererLifecycle: {
      decision: "confirm",
      dirtyCount: 1,
      evidence: { phase: "backup", risk: "dirty-working-copy" },
    },
  })

  assert.equal(decision.allowed, false)
  assert.equal(decision.preventClose, true)
  assert.equal(decision.forceClose, false)
  assert.equal(decision.decision, "cancel")
  assert.equal(decision.risk, "backup-unavailable")
})

test("prevents dirty renderer confirm when backupJoin completed is not tied to backupJoin phase", () => {
  const decision = shouldPreventWindowCloseForWorkingCopies({
    rendererLifecycle: {
      decision: "confirm",
      dirtyCount: 1,
      evidence: {
        phase: "shutdownRisk",
        risk: "dirty-working-copy",
        backupJoin: { id: "join.workingCopyBackups", completed: true },
      },
    },
  })

  assert.equal(decision.allowed, false)
  assert.equal(decision.preventClose, true)
  assert.equal(decision.forceClose, false)
  assert.equal(decision.decision, "cancel")
  assert.equal(decision.risk, "backup-unavailable")
  assert.equal(decision.backupJoin.completed, true)
})

test("force close bypasses renderer dirty veto", () => {
  const decision = shouldPreventWindowCloseForWorkingCopies({
    rendererLifecycle: {
      decision: "cancel",
      dirtyCount: 1,
      evidence: { phase: "shutdownRisk", risk: "dirty-working-copy" },
    },
    force: true,
  })

  assert.equal(decision.allowed, true)
  assert.equal(decision.preventClose, false)
  assert.equal(decision.forceClose, true)
  assert.equal(decision.forced, true)
  assert.equal(decision.decision, "force")
  assert.equal(decision.risk, "none")
})

test("allows close when renderer lifecycle is unavailable after timeout", () => {
  const decision = shouldPreventWindowCloseForWorkingCopies({
    rendererLifecycle: {
      rendererUnavailable: true,
      dirtyCount: 1,
      risk: "renderer-unavailable",
    },
  })

  assert.equal(decision.allowed, true)
  assert.equal(decision.preventClose, false)
  assert.equal(decision.forceClose, false)
  assert.equal(decision.decision, "allow-renderer-unavailable")
  assert.equal(decision.risk, "renderer-unavailable")
})
