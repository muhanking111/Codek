/*---------------------------------------------------------------------------------------------
 *  Agent tools service — wires the tool registry into the api: router.
 *
 *  Routes (all POST):
 *    /agent/tools/list                      → tool schemas
 *    /agent/tools/invoke                    → run a tool (handles authorization)
 *    /agent/tools/always-allow/clear        → clear in-memory always-allow flags
 *--------------------------------------------------------------------------------------------*/

const { listSchemas, getTool } = require("./tools")
const { requestAuthorization, isAlwaysAllowed, clearAlwaysAllow } = require("./authorize")
const { evaluateToolCall, getPolicy } = require("../agentPolicy")

function register(router) {
  router.register("POST", "/agent/tools/list", async () => {
    return { ok: true, tools: listSchemas() }
  })

  router.register("POST", "/agent/tools/invoke", async ({ body, sender }) => {
    const name = String(body?.name || "")
    const input = body?.input || {}
    const projectRoot = body?.projectRoot || null
    const tool = getTool(name)
    if (!tool) {
      return { ok: false, error: `unknown tool: ${name}`, isError: true, content: `unknown tool: ${name}` }
    }
    if (!projectRoot) {
      return { ok: false, error: "projectRoot required", isError: true, content: "projectRoot required" }
    }

    let decision
    try {
      decision = evaluateToolCall({ tool, input, projectRoot })
    } catch (err) {
      return { ok: false, error: err.message, isError: true, content: `policy error: ${err.message}` }
    }
    if (decision.decision === "deny") {
      return { ok: true, allowed: false, isError: true, content: `denied: ${decision.reason}`, structured: null }
    }
    if (decision.decision === "prompt" && !isAlwaysAllowed(name)) {
      const preview = safePreview(tool, input)
      const { allow } = await requestAuthorization(sender, { toolName: name, input, preview })
      if (!allow) {
        return { ok: true, allowed: false, isError: true, content: `user denied ${name}`, structured: null }
      }
    }

    const policy = getPolicy()
    try {
      const result = await tool.execute(input, {
        projectRoot,
        sandboxMode: policy.sandboxMode,
        networkAccess: decision.networkAccess,
      })
      return {
        ok: true,
        allowed: true,
        isError: !!result.isError,
        content: result.content ?? "",
        structured: result.structured ?? null,
      }
    } catch (err) {
      return {
        ok: true,
        allowed: true,
        isError: true,
        content: `Error: ${err && err.message ? err.message : String(err)}`,
        structured: null,
      }
    }
  })

  router.register("POST", "/agent/tools/always-allow/clear", async ({ body }) => {
    clearAlwaysAllow(body?.tool || null)
    return { ok: true }
  })
}

function safePreview(tool, input) {
  try {
    return tool.makePreview ? tool.makePreview(input) : tool.name
  } catch {
    return tool.name
  }
}

module.exports = { register }
