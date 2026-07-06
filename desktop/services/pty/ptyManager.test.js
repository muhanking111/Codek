const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const ptyManager = require("./ptyManager")
const workspaceTrust = require("../workspaceTrust")

test("process explorer snapshot exposes active pty session metadata", () => {
  const id = `pty-test-${Date.now()}`
  const session = ptyManager.createSession({
    id,
    shellType: process.platform === "win32" ? "cmd" : "bash",
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
    confirmed: true,
  })

  try {
    const snapshot = ptyManager.getProcessExplorerSnapshot()
    const found = snapshot.sessions.find((entry) => entry.id === session.id)

    assert.equal(snapshot.ptyAvailable, ptyManager.isAvailable())
    assert.ok(found)
    assert.equal(found.cwd, process.cwd())
    assert.equal(found.cols, 80)
    assert.equal(found.rows, 24)
    assert.equal(typeof found.pid, "number")
    assert.equal(typeof found.createdAt, "number")
    assert.equal(typeof found.uptimeMs, "number")
  } finally {
    ptyManager.dispose(session.id)
  }
})

test("restricted workspace blocks terminal session creation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-restricted-terminal-"))
  workspaceTrust.setWorkspaceTrust(root, { status: "restricted" })

  assert.throws(
    () => ptyManager.createSession({
      id: `pty-restricted-${Date.now()}`,
      shellType: process.platform === "win32" ? "cmd" : "bash",
      cwd: root,
      cols: 80,
      rows: 24,
      confirmed: true,
    }),
    /受限模式/,
  )
})

test("unknown workspace requires confirmation before terminal creation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codek-unknown-terminal-"))

  assert.throws(
    () => ptyManager.createSession({
      id: `pty-unknown-${Date.now()}`,
      shellType: process.platform === "win32" ? "cmd" : "bash",
      cwd: root,
      cols: 80,
      rows: 24,
    }),
    /需要用户确认/,
  )
})

test("pty host bridge snapshot exposes lifecycle and evidence-safe command boundary", () => {
  const id = `pty-contract-${Date.now()}`
  const session = ptyManager.createSession({
    id,
    shellType: process.platform === "win32" ? "cmd" : "bash",
    cwd: process.cwd(),
    cols: 100,
    rows: 30,
    env: { CODEK_TEST_ENV: "1" },
    confirmed: true,
  })

  try {
    const snapshot = ptyManager.getPtyHostBridgeSnapshot()
    const found = snapshot.sessions.find((entry) => entry.id === session.id)

    assert.equal(snapshot.source, "ptyHostService/ptyHostBridge")
    assert.equal(snapshot.stateSource, "ptyManager")
    assert.equal(snapshot.commandBoundary.source, "workspaceTrust/evidenceSafeCommandBoundary")
    assert.equal(snapshot.commandBoundary.requiresWorkspaceTrust, true)
    assert.equal(snapshot.commandBoundary.writesGitIndex, false)
    assert.equal(snapshot.commandBoundary.lastDecision.allowed, true)
    assert.equal(snapshot.commandBoundary.lastDecision.action, "创建终端")
    assert.ok(found)
    assert.equal(found.lifecycleSource, "terminalProcessLifecycle")
    assert.equal(found.status, "running")
    assert.equal(found.commandBoundary.requiresWorkspaceTrust, true)
    assert.equal(found.commandBoundary.writesGitIndex, false)
    assert.equal(found.envKeys.includes("CODEK_TEST_ENV"), true)
  } finally {
    ptyManager.dispose(session.id)
  }
})
