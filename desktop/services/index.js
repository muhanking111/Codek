const { ipcMain } = require("electron")
const { WebSocketServer } = require("ws")
const { getDb } = require("./db")
const router = require("./router")

let wssCollab = null

function delayNextTick() {
  return new Promise((resolve) => setImmediate(resolve))
}

async function registerServices(opts = {}) {
  getDb()

  const modules = [
    "./auth",
    "./llm",
    "./git",
    "./idx",
    "./sandbox",
    "./settings",
    "./userDataProfile",
    "./updates",
    "./debug",
    "./search",
    "./workspace",
    "./collab",
    "./workspaceTrust",
    "./agentPolicy",
    "./agentTools",
    "./agentLoop",
    "./agentLoop/orchestratorRoutes",
    "./ccswitch",
    "./migration/vscodeImport",
    "./extensions-host",
    "./languageServices",
    "./github",
    "./goalRoutes",
    "./devServer",
  ]

  const timings = []
  const failures = []

  for (const modulePath of modules) {
    await delayNextTick()
    const label = modulePath
    const startedAt = Date.now()
    try {
      const mod = require(modulePath)
      if (typeof mod.register === "function") {
        mod.register(router, opts)
      }
    } catch (error) {
      failures.push({
        module: label,
        error: String(error?.message || error),
      })
      console.error(`[services] failed to register ${label}:`, error?.message || error)
    } finally {
      timings.push({
        module: label,
        durationMs: Date.now() - startedAt,
      })
    }
  }

  // Collab WebSocket server on a random port
  const collab = require("./collab")
  wssCollab = new WebSocketServer({ host: "127.0.0.1", port: 0 })
  wssCollab.on("connection", (ws, req) => {
    const sessionId = (req.url || "/default").split("/").pop() || "default"
    collab.handleConnection(ws, sessionId)
  })
  wssCollab.on("listening", () => {
    const { port } = wssCollab.address()
    console.log(`[collab] WebSocket server listening on 127.0.0.1:${port}`)
    ipcMain.handle("collab:port", () => port)
  })

  const routeCount = router.listRoutes().length
  console.log(`[services] registered ${routeCount} routes`)

  return { routeCount, timings, failures }
}

module.exports = { registerServices }
