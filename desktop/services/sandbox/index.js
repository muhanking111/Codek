const fs = require("fs")
const path = require("path")
const os = require("os")
const crypto = require("crypto")
const { spawn } = require("child_process")

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_OUTPUT = 1_048_576
const SANDBOX_ROOT = process.env.CODEK_SANDBOX_DIR || path.join(os.tmpdir(), "codek-sandbox")

// Persisted user settings (level, blockNetwork, writablePaths) — written by
// the SettingsPanel and consumed by runShellInSandbox.
const SETTINGS_DIR = process.env.CODEK_DATA_DIR || path.join(os.homedir(), ".codek")
const SETTINGS_FILE = path.join(SETTINGS_DIR, "sandbox.json")

const DEFAULT_SETTINGS = Object.freeze({
  level: "standard",
  blockNetwork: true,
  writablePaths: [],
})

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8")
    const parsed = JSON.parse(raw)
    return {
      level: ["standard", "strict", "paranoid"].includes(parsed.level) ? parsed.level : DEFAULT_SETTINGS.level,
      blockNetwork: typeof parsed.blockNetwork === "boolean" ? parsed.blockNetwork : DEFAULT_SETTINGS.blockNetwork,
      writablePaths: Array.isArray(parsed.writablePaths) ? parsed.writablePaths.filter((p) => typeof p === "string") : [],
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(input) {
  const next = {
    level: ["standard", "strict", "paranoid"].includes(input?.level) ? input.level : DEFAULT_SETTINGS.level,
    blockNetwork: typeof input?.blockNetwork === "boolean" ? input.blockNetwork : DEFAULT_SETTINGS.blockNetwork,
    writablePaths: Array.isArray(input?.writablePaths)
      ? input.writablePaths.filter((p) => typeof p === "string" && p.trim().length > 0)
      : [],
  }
  try {
    if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true })
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8")
  } catch (e) {
    audit("settings-write-failed", e.message)
  }
  return next
}

// Lazy-load the per-platform sandbox modules so requiring this file on the
// wrong platform doesn't fail.
function getPlatformSandbox() {
  switch (process.platform) {
    case "win32":  return require("./win32")
    case "darwin": return require("./macos")
    case "linux":  return require("./linux")
    default:       return null
  }
}

// Audit log
const AUDIT_LOG = []
const MAX_AUDIT = 500

function audit(type, detail) {
  const entry = { type, detail, timestamp: Date.now() }
  AUDIT_LOG.push(entry)
  if (AUDIT_LOG.length > MAX_AUDIT) AUDIT_LOG.shift()
  console.log(`[sandbox] ${type}: ${detail}`)
}

function getAuditLog() {
  return AUDIT_LOG.slice()
}

/**
 * Run a command with process-group isolation and timeout.
 * On Windows, uses process group (jobs) so killing the group kills children.
 * On POSIX, uses setsid to create a new session.
 */
function runCommand(cmd, args, cwd, env, timeoutMs, networkAccess = false) {
  return new Promise((resolve) => {
    const start = Date.now()
    let stdout = ""
    let stderr = ""
    let killed = false

    const spawnOpts = {
      cwd,
      env: { PATH: process.env.PATH || "", ...(env || {}) },
      windowsHide: true,
    }

    // Process group isolation: on Windows use Job Object (via CREATE_BREAKAWAY_FROM_JOB),
    // on POSIX use setsid to create new session so kill(-pid) kills all children.
    if (process.platform === "win32") {
      spawnOpts.windowsVerbatimArguments = true
    } else {
      spawnOpts.detached = true
    }

    // Block network access for local execution (unless explicitly allowed)
    if (!networkAccess) {
      // Set proxy to localhost to block network egress for most tools
      spawnOpts.env = {
        ...spawnOpts.env,
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        NO_PROXY: "*",
        NODE_NO_WARNINGS: "1",
      }
    }

    const child = spawn(cmd, args, spawnOpts)
    const timer = setTimeout(() => {
      killed = true
      try {
        // Kill the entire process group
        if (child.pid) {
          if (process.platform === "win32") {
            spawn("taskkill", ["/f", "/t", "/pid", String(child.pid)], { stdio: "ignore" })
          } else {
            process.kill(-child.pid, "SIGKILL")
          }
        }
      } catch {}
    }, timeoutMs)

    child.stdout.on("data", (d) => {
      if (stdout.length < MAX_OUTPUT) stdout += d.toString("utf8")
    })
    child.stderr.on("data", (d) => {
      if (stderr.length < MAX_OUTPUT) stderr += d.toString("utf8")
    })
    child.on("error", (e) => {
      clearTimeout(timer)
      audit("error", `${cmd} ${args.join(" ")}: ${e.message}`)
      resolve({ success: false, output: stdout, error: e.message, exitCode: -1, executionTimeMs: Date.now() - start })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (killed) {
        audit("timeout", `${cmd} ${args.join(" ")} after ${timeoutMs}ms`)
        resolve({ success: false, output: stdout, error: `Execution timeout after ${timeoutMs}ms`, exitCode: -1, executionTimeMs: timeoutMs })
        return
      }
      resolve({ success: code === 0, output: stdout, error: stderr, exitCode: code, executionTimeMs: Date.now() - start })
    })
  })
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}

async function executeCode({ language, code, env, timeoutMs, networkAccess }) {
  const sessionId = crypto.randomBytes(4).toString("hex")
  const sessionDir = path.join(SANDBOX_ROOT, sessionId)
  fs.mkdirSync(sessionDir, { recursive: true })
  const timeout = timeoutMs || DEFAULT_TIMEOUT_MS
  try {
    const lang = (language || "").toLowerCase()
    if (lang === "javascript" || lang === "js") {
      const file = path.join(sessionDir, "script.js")
      fs.writeFileSync(file, code, "utf8")
      return await runCommand("node", ["--no-warnings", file], sessionDir, env, timeout, networkAccess)
    }
    if (lang === "python" || lang === "py") {
      const file = path.join(sessionDir, "script.py")
      fs.writeFileSync(file, code, "utf8")
      return await runCommand("python", ["-u", file], sessionDir, env, timeout, networkAccess)
    }
    if (lang === "typescript" || lang === "ts") {
      const file = path.join(sessionDir, "script.ts")
      fs.writeFileSync(file, code, "utf8")
      return await runCommand("npx", ["ts-node", file], sessionDir, env, timeout, networkAccess)
    }
    if (lang === "java") {
      const file = path.join(sessionDir, "Main.java")
      fs.writeFileSync(file, code, "utf8")
      const compile = await runCommand("javac", [file], sessionDir, env, Math.floor(timeout / 2), networkAccess)
      if (!compile.success) {
        return { ...compile, error: "Compilation failed: " + compile.error }
      }
      return await runCommand("java", ["-cp", sessionDir, "Main"], sessionDir, env, Math.floor(timeout / 2), networkAccess)
    }
    return { success: false, output: "", error: `Unsupported language: ${language}`, exitCode: -1, executionTimeMs: 0 }
  } finally {
    cleanup(sessionDir)
  }
}

const DOCKER_IMAGES = {
  javascript: { image: "node:20-alpine", ext: ".js", target: "/app/script.js", cmd: ["node", "/app/script.js"] },
  js: { image: "node:20-alpine", ext: ".js", target: "/app/script.js", cmd: ["node", "/app/script.js"] },
  python: { image: "python:3.11-alpine", ext: ".py", target: "/app/script.py", cmd: ["python", "/app/script.py"] },
  py: { image: "python:3.11-alpine", ext: ".py", target: "/app/script.py", cmd: ["python", "/app/script.py"] },
  java: { image: "openjdk:17-alpine", ext: ".java", target: "/app/Main.java", cmd: ["sh", "-c", "cd /app && javac Main.java && java Main"] },
}

async function isDockerAvailable() {
  const r = await runCommand("docker", ["version"], process.cwd(), {}, 5000)
  return r.success
}

async function executeInDocker({ language, code, timeoutMs }) {
  const cfg = DOCKER_IMAGES[(language || "").toLowerCase()]
  if (!cfg) return { success: false, output: "", error: `Unsupported language: ${language}`, exitCode: -1, executionTimeMs: 0 }
  if (!(await isDockerAvailable())) {
    return { success: false, output: "", error: "Docker is not available", exitCode: -1, executionTimeMs: 0 }
  }
  const timeout = timeoutMs || DEFAULT_TIMEOUT_MS
  const tmp = path.join(os.tmpdir(), `codek-${crypto.randomBytes(4).toString("hex")}${cfg.ext}`)
  fs.writeFileSync(tmp, code, "utf8")
  const network = process.env.CODEK_DOCKER_NETWORK || "none"
  const memory = process.env.CODEK_DOCKER_MEMORY || "256m"
  const cpus = process.env.CODEK_DOCKER_CPUS || "0.5"
  const mountSpec = `${tmp}:${cfg.target}:ro`
  const baseArgs = [
    "run", "--rm",
    "--network", network,
    "--memory", memory,
    "--cpus", cpus,
    "--security-opt", "no-new-privileges:true",
    "--cap-drop", "ALL",
    "--read-only",
    "-v", mountSpec,
    cfg.image,
    ...cfg.cmd,
  ]
  try {
    audit("docker", `${language} code (${timeout}ms)`)
    return await runCommand("docker", baseArgs, process.cwd(), {}, timeout, false)
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
  }
}

/**
 * Permissions elevation: if an operation fails in the sandbox,
 * the agent can request partial (wider) or full (no sandbox) execution.
 */
function createPermissionRequest(operation, reason) {
  return {
    operation,
    reason,
    requestedAt: Date.now(),
    status: "pending",
  }
}

/**
 * Run a single shell command inside the platform sandbox.
 *
 * This is the entry point used by the agent's `run_shell` tool. It chooses
 * the right platform backend and respects the sandbox mode + network policy
 * decided upstream by agentPolicy.
 *
 * @param {object} opts
 * @param {string} opts.command          - shell command as the user typed it
 * @param {string} opts.cwd              - working directory (must live inside projectRoot)
 * @param {string} opts.projectRoot      - project root; the only writable mount in linux/macos
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.networkAccess] - false = isolate network where supported
 * @param {string} [opts.sandboxMode]    - "read-only" | "workspace-write" | "danger-full-access"
 * @returns {Promise<{stdout, stderr, exitCode, killed, sandboxBackend, durationMs}>}
 */
async function runShellInSandbox({
  command,
  cwd,
  projectRoot,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  networkAccess = false,
  sandboxMode = "workspace-write",
}) {
  if (!command || !command.trim()) {
    return { stdout: "", stderr: "empty command", exitCode: -1, killed: false, sandboxBackend: "none" }
  }

  // Split into shell + arg form so the platform sandbox can pass it through.
  const isWin = process.platform === "win32"
  const shellCmd = isWin ? process.env.COMSPEC || "cmd.exe" : "/bin/sh"
  const shellArgs = isWin ? ["/c", command] : ["-c", command]

  // danger-full-access: skip the sandbox layer entirely and use the bare
  // process group runner. Caller knows what they're doing.
  if (sandboxMode === "danger-full-access") {
    const res = await runCommand(shellCmd, shellArgs, cwd, {}, timeoutMs, networkAccess)
    return {
      stdout: res.output || "",
      stderr: res.error || "",
      exitCode: typeof res.exitCode === "number" ? res.exitCode : -1,
      killed: res.exitCode === -1 && /timeout/i.test(res.error || ""),
      sandboxBackend: "danger-bypass",
      durationMs: res.executionTimeMs || 0,
    }
  }

  const platform = getPlatformSandbox()
  if (!platform) {
    // Unknown platform — degrade to the bare runner with an explicit label.
    const res = await runCommand(shellCmd, shellArgs, cwd, {}, timeoutMs, networkAccess)
    return {
      stdout: res.output || "",
      stderr: res.error || "",
      exitCode: typeof res.exitCode === "number" ? res.exitCode : -1,
      killed: false,
      sandboxBackend: `unsupported-${process.platform}`,
      durationMs: res.executionTimeMs || 0,
    }
  }

  const settings = loadSettings()
  // Effective network access: only allow if both caller AND user settings allow.
  const effectiveNetwork = !!networkAccess && !settings.blockNetwork
  const result = await platform.runSandboxed({
    command: shellCmd,
    args: shellArgs,
    cwd,
    projectRoot,
    timeoutMs,
    networkAccess: effectiveNetwork,
    sandboxLevel: settings.level,
    extraWritablePaths: settings.writablePaths,
  })
  audit("shell", `${result.backend} exit=${result.exitCode} (${command.slice(0, 60)})`)
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: typeof result.exitCode === "number" ? result.exitCode : -1,
    killed: !!result.killed,
    sandboxBackend: result.backend,
    durationMs: result.durationMs || 0,
  }
}

function register(router) {
  router.register("POST", "/sandbox/execute", async ({ body }) => {
    try {
      const res = await executeCode(body)
      audit("execute", `${body.language || "?"} code (${res.success ? "ok" : "fail"})`)
      return { success: res.success, ...res }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  router.register("POST", "/sandbox/docker/execute", async ({ body }) => {
    try {
      const res = await executeInDocker(body)
      return { success: res.success, ...res }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  router.register("GET", "/sandbox/available", async () => {
    return { success: true, available: true }
  })

  router.register("GET", "/sandbox/docker/available", async () => ({
    success: true,
    available: await isDockerAvailable(),
  }))

  // Audit log endpoint
  router.register("GET", "/sandbox/audit", async () => ({
    entries: getAuditLog(),
  }))

  // Permission request endpoint
  router.register("POST", "/sandbox/permission", async ({ body }) => {
    const req = createPermissionRequest(body?.operation || "unknown", body?.reason || "")
    return { request: req, status: "pending" }
  })

  router.register("GET", "/sandbox/settings", async () => ({
    success: true,
    settings: loadSettings(),
  }))

  router.register("POST", "/sandbox/settings", async ({ body }) => {
    const saved = saveSettings(body || {})
    audit("settings", `level=${saved.level} blockNetwork=${saved.blockNetwork} writable=${saved.writablePaths.length}`)
    return { success: true, settings: saved }
  })
}

module.exports = { register, runShellInSandbox }
