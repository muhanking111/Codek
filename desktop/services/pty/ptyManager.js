const os = require("os")
const path = require("path")
const { spawn } = require("child_process")
const { evaluateCommandExecution } = require("../workspaceTrust")

let pty
try {
  pty = require("node-pty")
} catch (err) {
  console.error("[ptyManager] node-pty not available:", err.message)
  pty = null
}

const sessions = new Map()
const subscribers = new Set()
let lastCommandBoundaryDecision = createEmptyCommandBoundaryDecision()

function defaultShell() {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "powershell.exe"
  }
  return process.env.SHELL || "/bin/bash"
}

function resolveShellCommand(shellType) {
  if (process.platform === "win32") {
    switch (shellType) {
      case "powershell":
        return { file: "powershell.exe", args: ["-NoLogo"] }
      case "cmd":
        return { file: "cmd.exe", args: [] }
      case "gitbash":
      case "bash": {
        const gitBash = path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe")
        return { file: gitBash, args: ["--login", "-i"] }
      }
      case "wsl":
        return { file: "wsl.exe", args: [] }
      case "zsh":
        return { file: "wsl.exe", args: ["zsh"] }
      default:
        return { file: defaultShell(), args: [] }
    }
  }
  if (shellType === "bash" || shellType === "gitbash" || shellType === "wsl") return { file: "/bin/bash", args: ["-l"] }
  if (shellType === "zsh") return { file: "/bin/zsh", args: ["-l"] }
  if (shellType === "powershell") return { file: "pwsh", args: ["-NoLogo"] }
  return { file: defaultShell(), args: [] }
}

function notify(event) {
  for (const cb of subscribers) {
    try {
      cb(event)
    } catch (err) {
      console.error("[ptyManager] subscriber error:", err)
    }
  }
}

function createSession({ id, shellType, cwd, cols, rows, env, confirmed }) {
  if (sessions.has(id)) {
    throw new Error(`pty session already exists: ${id}`)
  }

  const { file, args } = resolveShellCommand(shellType)
  const ptyEnv = { ...process.env, ...env, TERM: "xterm-256color", COLORTERM: "truecolor" }
  const workingDir = cwd || os.homedir()
  const trustDecision = evaluateCommandExecution(workingDir, [file, ...args].join(" "), {
    action: "创建终端",
    confirmed: confirmed === true,
  })
  lastCommandBoundaryDecision = createCommandBoundaryDecision({
    action: "创建终端",
    command: [file, ...args].join(" "),
    cwd: workingDir,
    decision: trustDecision,
  })
  if (!trustDecision.allowed) {
    const err = new Error(trustDecision.message)
    err.code = trustDecision.code
    err.workspaceTrust = trustDecision.status
    throw err
  }

  if (!pty) {
    return createSpawnSession({ id, shellType, cwd: workingDir, file, args, env: ptyEnv, cols, rows })
  }

  const proc = pty.spawn(file, args, {
    name: "xterm-256color",
    cols: Math.max(cols || 80, 1),
    rows: Math.max(rows || 24, 1),
    cwd: workingDir,
    env: ptyEnv,
    useConpty: process.platform === "win32",
  })

  const session = {
    id,
    proc,
    mode: "pty",
    shellType,
    cwd: workingDir,
    commandLine: [file, ...args].join(" "),
    envKeys: Object.keys(env || {}).sort(),
    cols: cols || 80,
    rows: rows || 24,
    createdAt: Date.now(),
    exitedAt: null,
    exitCode: null,
  }
  sessions.set(id, session)

  proc.onData((data) => {
    notify({ type: "data", id, data })
  })

  proc.onExit(({ exitCode, signal }) => {
    session.exitedAt = Date.now()
    session.exitCode = exitCode
    sessions.delete(id)
    notify({ type: "exit", id, exitCode, signal })
  })

  return { id, pid: proc.pid, shellType, cwd: session.cwd }
}

function createSpawnSession({ id, shellType, cwd, file, args, env, cols, rows }) {
  const proc = spawn(file, args, {
    cwd,
    env,
    shell: false,
    windowsHide: true,
    stdio: "pipe",
  })

  const session = {
    id,
    proc,
    mode: "spawn",
    shellType,
    cwd,
    commandLine: [file, ...args].join(" "),
    envKeys: Object.keys(env || {}).sort(),
    cols: cols || 80,
    rows: rows || 24,
    createdAt: Date.now(),
    exitedAt: null,
    exitCode: null,
  }
  sessions.set(id, session)

  notify({
    type: "data",
    id,
    data: "\x1b[33m[terminal] node-pty native module is unavailable; using compatibility shell mode.\x1b[0m\r\n",
  })

  proc.stdout.on("data", (data) => notify({ type: "data", id, data: data.toString() }))
  proc.stderr.on("data", (data) => notify({ type: "data", id, data: data.toString() }))
  proc.on("exit", (exitCode, signal) => {
    session.exitedAt = Date.now()
    session.exitCode = exitCode
    sessions.delete(id)
    notify({ type: "exit", id, exitCode, signal })
  })
  proc.on("error", (err) => {
    notify({ type: "data", id, data: `\x1b[31m[terminal] ${err.message}\x1b[0m\r\n` })
  })

  return { id, pid: proc.pid, shellType, cwd: session.cwd, compatibilityMode: true }
}

function write(id, data) {
  const session = sessions.get(id)
  if (!session) return false
  if (session.mode === "pty") {
    session.proc.write(data)
  } else if (session.proc.stdin?.writable) {
    session.proc.stdin.write(data)
  }
  return true
}

function resize(id, cols, rows) {
  const session = sessions.get(id)
  if (!session) return false
  const safeCols = Math.max(cols || 1, 1)
  const safeRows = Math.max(rows || 1, 1)
  if (session.mode === "pty") {
    session.proc.resize(safeCols, safeRows)
  }
  session.cols = safeCols
  session.rows = safeRows
  return true
}

function dispose(id) {
  const session = sessions.get(id)
  if (!session) return false
  try {
    session.proc.kill()
  } catch {
    // already exited
  }
  sessions.delete(id)
  return true
}

function disposeAll() {
  for (const id of [...sessions.keys()]) {
    dispose(id)
  }
}

function subscribe(callback) {
  subscribers.add(callback)
  return () => {
    subscribers.delete(callback)
  }
}

function listSessions() {
  return [...sessions.values()].map((s) => ({
    id: s.id,
    pid: s.proc.pid,
    shellType: s.shellType,
    cwd: s.cwd,
    mode: s.mode,
    cols: s.cols,
    rows: s.rows,
    createdAt: s.createdAt,
    uptimeMs: Math.max(0, Date.now() - s.createdAt),
    exitedAt: s.exitedAt,
    exitCode: s.exitCode,
  }))
}

function getProcessExplorerSnapshot() {
  return {
    generatedAt: Date.now(),
    ptyAvailable: isAvailable(),
    sessions: listSessions(),
  }
}

function getPtyHostBridgeSnapshot() {
  const sessionSnapshots = [...sessions.values()].map((session) => createSessionContractSnapshot(session))
  return {
    source: "ptyHostService/ptyHostBridge",
    stateSource: "ptyManager",
    generatedAt: Date.now(),
    ptyAvailable: isAvailable(),
    activeCount: sessionSnapshots.filter((session) => session.status === "running").length,
    exitedCount: sessionSnapshots.filter((session) => session.status === "exited").length,
    sessions: sessionSnapshots,
    commandBoundary: {
      source: "workspaceTrust/evidenceSafeCommandBoundary",
      stateSource: "ptyManager/workspaceTrust",
      requiresWorkspaceTrust: true,
      writesGitIndex: false,
      lastDecision: lastCommandBoundaryDecision,
    },
  }
}

function createSessionContractSnapshot(session) {
  const status = session.exitedAt ? "exited" : "running"
  return {
    id: session.id,
    pid: session.proc.pid,
    shellType: session.shellType,
    cwd: session.cwd,
    mode: session.mode,
    status,
    cols: session.cols,
    rows: session.rows,
    createdAt: session.createdAt,
    uptimeMs: Math.max(0, Date.now() - session.createdAt),
    exitedAt: session.exitedAt,
    exitCode: session.exitCode,
    lifecycleSource: "terminalProcessLifecycle",
    commandBoundary: {
      source: "workspaceTrust/evidenceSafeCommandBoundary",
      stateSource: "ptyManager/workspaceTrust",
      requiresWorkspaceTrust: true,
      writesGitIndex: false,
      command: session.commandLine || "",
      envKeys: [...(session.envKeys || [])],
    },
    envKeys: [...(session.envKeys || [])],
  }
}

function createCommandBoundaryDecision({ action, command, cwd, decision }) {
  return {
    action,
    command: typeof command === "string" ? command.slice(0, 200) : "",
    cwd,
    allowed: decision.allowed === true,
    code: decision.code || "",
    workspaceTrust: decision.workspaceTrust || decision.status || "",
    message: decision.message || "",
  }
}

function createEmptyCommandBoundaryDecision() {
  return {
    action: "",
    command: "",
    cwd: "",
    allowed: false,
    code: "",
    workspaceTrust: "",
    message: "",
  }
}

function isAvailable() {
  return Boolean(pty)
}

module.exports = {
  createSession,
  write,
  resize,
  dispose,
  disposeAll,
  subscribe,
  listSessions,
  getProcessExplorerSnapshot,
  getPtyHostBridgeSnapshot,
  isAvailable,
}
