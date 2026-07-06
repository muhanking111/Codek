#!/usr/bin/env node
/**
 * Codek CLI — ask, plan, agent, auto, goal, exec, config, init
 *
 * Usage:
 *   codek ask "question"
 *   codek plan "plan"
 *   codek agent "task"
 *   codek auto "task"
 *   codek goal create "description"
 *   codek goal list
 *   codek exec "command"
 *   codek config set key value
 *   codek init
 */

const http = require("http")
const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")

const CONFIG_DIR = path.join(require("os").homedir(), ".codek")
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json")
const DEFAULT_HOST = "http://localhost:3080"

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"))
  } catch {}
  return { host: DEFAULT_HOST }
}

function saveConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

function api(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const cfg = loadConfig()
    const url = new URL(pathname, cfg.host)
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { "Content-Type": "application/json" },
      timeout: 120000,
    }
    const req = http.request(opts, (res) => {
      let data = ""
      res.on("data", (chunk) => { data += chunk })
      res.on("end", () => {
        try { resolve(JSON.parse(data)) }
        catch { resolve({ ok: false, error: data }) }
      })
    })
    req.on("error", reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function streamApi(method, pathname, body, onChunk) {
  return new Promise((resolve, reject) => {
    const cfg = loadConfig()
    const url = new URL(pathname, cfg.host)
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { "Content-Type": "application/json" },
      timeout: 300000,
    }
    const req = http.request(opts, (res) => {
      let fullData = ""
      res.on("data", (chunk) => {
        const text = chunk.toString()
        fullData += text
        if (onChunk) onChunk(text)
      })
      res.on("end", () => resolve(fullData))
    })
    req.on("error", reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

async function main() {
  const args = process.argv.slice(2)
  const cmd = args[0]

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(`
Codek CLI — AI coding assistant

Usage:
  codek ask "question"          Ask a question (streaming)
  codek plan "description"      Generate a plan
  codek agent "task"            Interactive agent mode (streaming + diff)
  codek auto "task"             Autonomous mode
  codek goal create "desc"      Create a persistent goal
  codek goal list               List all goals
  codek goal status <id>        Show goal status
  codek goal resume <id>        Resume a goal
  codek exec "command"          Run a command in project
  codek config set key value    Set config
  codek config get key          Get config
  codek init                    Initialize project
    `)
    return
  }

  let stdinData = ""
  if (!process.stdin.isTTY) {
    for await (const chunk of process.stdin) stdinData += chunk
  }

  const cfg = loadConfig()
  const projectRoot = process.cwd()

  switch (cmd) {
    case "ask": {
      const query = args.slice(1).join(" ") || stdinData
      if (!query) { console.error("Usage: codek ask \"question\""); process.exit(1) }
      process.stdout.write("\n")
      await streamApi("POST", "/api/chat", { message: query, stream: true, projectRoot }, (chunk) => process.stdout.write(chunk))
      process.stdout.write("\n")
      break
    }
    case "plan": {
      const desc = args.slice(1).join(" ") || stdinData
      if (!desc) { console.error("Usage: codek plan \"description\""); process.exit(1) }
      const result = await api("POST", "/api/plan", { description: desc, projectRoot })
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case "agent": {
      const task = args.slice(1).join(" ") || stdinData
      if (!task) { console.error("Usage: codek agent \"task\""); process.exit(1) }
      await streamApi("POST", "/api/agent/run", { task, stream: true, projectRoot }, (chunk) => process.stdout.write(chunk))
      process.stdout.write("\n")
      break
    }
    case "auto": {
      const task = args.slice(1).join(" ") || stdinData
      if (!task) { console.error("Usage: codek auto \"task\""); process.exit(1) }
      const result = await api("POST", "/api/auto", { task, projectRoot })
      console.log(JSON.stringify(result, null, 2))
      break
    }
    case "goal": {
      const sub = args[1]
      if (sub === "create") {
        const desc = args.slice(2).join(" ")
        if (!desc) { console.error("Usage: codek goal create \"description\""); process.exit(1) }
        const result = await api("POST", "/api/goals/create", { description: desc, projectRoot })
        const goalId = result.id
        console.log(`Goal created: ${goalId || "ok"}`)
        if (goalId) {
          const started = await api("POST", `/api/goals/${goalId}/start`, { projectRoot, request: desc })
          if (started?.success) console.log("Enqueued for scheduler")
          else console.log(`Enqueue skipped: ${started?.error || "scheduler unavailable"}`)
        }
      } else if (sub === "list") {
        const result = await api("GET", "/api/goals/list")
        const goals = result.goals || []
        for (const g of goals) console.log(`${g.id} [${g.status}] ${g.description}`)
      } else if (sub === "status") {
        const id = args[2]
        if (!id) { console.error("Usage: codek goal status <id>"); process.exit(1) }
        const result = await api("GET", `/api/goals/${id}`)
        console.log(JSON.stringify(result, null, 2))
      } else if (sub === "resume") {
        const id = args[2]
        if (!id) { console.error("Usage: codek goal resume <id>"); process.exit(1) }
        const result = await api("POST", `/api/goals/${id}/resume`)
        console.log(`Resumed: ${result.status || "ok"}`)
      } else if (sub === "logs") {
        const id = args[2]
        if (!id) { console.error("Usage: codek goal logs <id>"); process.exit(1) }
        const result = await api("GET", `/api/goals/${id}/logs`)
        if (Array.isArray(result.logs)) for (const line of result.logs) console.log(line)
        else console.log(JSON.stringify(result, null, 2))
      } else if (sub === "wait") {
        const id = args[2]
        if (!id) { console.error("Usage: codek goal wait <id>"); process.exit(1) }
        const POLL_MS = 2000
        while (true) {
          const result = await api("GET", `/api/goals/${id}`)
          const status = result.status || result.goal?.status
          if (status === "completed") { console.log("completed"); process.exit(0) }
          if (status === "failed") { console.log("failed"); process.exit(1) }
          if (status === "cancelled") { console.log("cancelled"); process.exit(2) }
          await new Promise((r) => setTimeout(r, POLL_MS))
        }
      } else if (sub === "cancel") {
        const id = args[2]
        if (!id) { console.error("Usage: codek goal cancel <id>"); process.exit(1) }
        const result = await api("POST", `/api/goals/${id}/cancel`)
        console.log(`Cancelled: ${result.success ? "ok" : "failed"}`)
      } else {
        console.error("Usage: codek goal <create|list|status|resume|logs|wait|cancel>")
        process.exit(1)
      }
      break
    }
    case "daemon": {
      const sub = args[1]
      if (sub === "start") {
        const electronBin = process.env.ELECTRON_BIN || "npx"
        const electronArgs = process.env.ELECTRON_BIN ? [] : ["electron"]
        const desktopPath = path.resolve(__dirname, "..", "desktop")
        electronArgs.push(desktopPath)
        const child = spawn(electronBin, electronArgs, {
          detached: true, stdio: "ignore",
          env: { ...process.env, CODEK_DAEMON: "1", CODEK_HEADLESS: "1" },
        })
        child.unref()
        console.log(`Daemon started (pid ${child.pid})`)
        process.exit(0)
      } else if (sub === "stop") {
        const result = await api("POST", "/api/daemon/stop")
        console.log(`Daemon stop: ${result.success ? "ok" : "failed"}`)
      } else if (sub === "status") {
        try {
          const result = await api("GET", "/api/daemon/status")
          console.log(JSON.stringify(result, null, 2))
        } catch (err) {
          console.log("Daemon not running")
          process.exit(1)
        }
      } else {
        console.error("Usage: codek daemon <start|stop|status>")
        process.exit(1)
      }
      break
    }
    case "exec": {
      const command = args.slice(1).join(" ")
      if (!command) { console.error("Usage: codek exec \"command\""); process.exit(1) }
      const child = spawn(command, [], { cwd: projectRoot, shell: true, stdio: "inherit" })
      child.on("exit", (code) => process.exit(code || 0))
      break
    }
    case "config": {
      const sub = args[1]
      if (sub === "set") {
        const key = args[2]; const val = args[3]
        if (!key || val === undefined) { console.error("Usage: codek config set <key> <value>"); process.exit(1) }
        cfg[key] = val; saveConfig(cfg); console.log(`Config: ${key}=${val}`)
      } else if (sub === "get") {
        const key = args[2]
        if (!key) { console.error("Usage: codek config get <key>"); process.exit(1) }
        console.log(cfg[key] || "")
      } else {
        console.log(JSON.stringify(cfg, null, 2))
      }
      break
    }
    case "init": {
      const codekDir = path.join(projectRoot, ".codek")
      fs.mkdirSync(codekDir, { recursive: true })
      fs.writeFileSync(path.join(codekDir, "config.json"), JSON.stringify({ host: DEFAULT_HOST, model: "default" }, null, 2))
      console.log(`Initialized Codek in ${projectRoot}`)
      break
    }
    default:
      console.error(`Unknown command: ${cmd}`)
      process.exit(1)
  }
}

main().catch((err) => { console.error(err.message); process.exit(1) })
