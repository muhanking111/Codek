/**
 * Sub-Agent — isolated mini agentLoop.
 *
 * Runs a single phase of a PlanTree with its own message history, only the
 * tools relevant to the phase, and the parent's sandbox setting. Returns a
 * SUMMARY (not full history) so the parent agent's context stays small.
 */

const { runLoop } = require("./index")
const { listSchemas } = require("../agentTools/tools")
let sandboxPool = null
try { sandboxPool = require("../sandbox/pool") } catch {}

function pickToolsForTasks(tasks) {
  const all = listSchemas().map((s) => s.name)
  const hinted = new Set()
  for (const t of tasks || []) {
    if (t.tool && all.includes(t.tool)) hinted.add(t.tool)
  }
  if (hinted.size === 0) return all
  // Always include read/list essentials so the sub-agent can orient itself
  for (const must of ["readFile", "listDir", "searchCode", "search", "writeFile", "applyPatch", "runCommand"]) {
    if (all.includes(must)) hinted.add(must)
  }
  return [...hinted]
}

function buildSubAgentSystemPrompt({ phase, sharedContext }) {
  const taskLines = (phase.tasks || []).map((t, i) => `  ${i + 1}. ${t.description}`).join("\n")
  return `You are a sub-agent dispatched to complete one phase of a larger plan.

Phase: ${phase.name}
Phase id: ${phase.id}
Tasks (must be done in order):
${taskLines || "  (no tasks)"}

Shared context from main agent:
${sharedContext || "(none)"}

Rules:
- Stay within this phase's scope. Do NOT do work belonging to other phases.
- When all tasks are done, summarize what changed (files touched, key decisions) and stop.
- If a task is impossible, stop and report why. The main agent will reflect.
`
}

async function runSubAgent({ phase, sharedContext, parentRequest, emit, signal }) {
  const projectRoot = phase?.workspaceRoot || parentRequest?.projectRoot || parentRequest?.cwd || process.cwd()
  const pool = sandboxPool?.getPool ? sandboxPool.getPool() : null
  const sandboxLease = pool ? await pool.acquire(projectRoot) : null
  const messages = [
    { role: "system", content: buildSubAgentSystemPrompt({ phase, sharedContext }) },
    { role: "user", content: `Complete phase "${phase.name}" now.` },
  ]

  const filtered = pickToolsForTasks(phase.tasks)
  const filesChanged = new Set()
  let summaryText = ""

  const subEmit = (ev) => {
    if (!ev) return
    if (ev.type === "text_delta" && typeof ev.content === "string") {
      summaryText += ev.content
    }
    if (ev.type === "tool_call") {
      const inp = ev.input || {}
      const p = inp.path || inp.filePath || inp.file
      if (p && (ev.name === "writeFile" || ev.name === "applyPatch" || ev.name === "editFile")) {
        filesChanged.add(String(p))
      }
    }
    // Re-emit upward with phase tagging so the executor can fan events to UI
    if (typeof emit === "function") emit({ ...ev, phaseId: phase.id })
  }

  const sender = { isDestroyed: () => false, send: () => {} }

  const request = {
    ...parentRequest,
    messages,
    toolNameFilter: filtered, // honored by runLoop only if it supports it
    agentId: phase.agent || phase.id,
    phaseId: phase.id,
    sandboxLease,
    sandboxId: sandboxLease?.id,
    projectRoot,
    cwd: projectRoot,
    workspace: phase?.workspace || null,
  }

  try {
    if (typeof emit === "function" && sandboxLease) {
      emit({
        type: "sub_agent_sandbox",
        phaseId: phase.id,
        agent: phase.agent || phase.id,
        sandboxId: sandboxLease.id,
        sandboxMode: sandboxLease.mode,
        projectRoot: sandboxLease.projectRoot,
      })
    }

    await runLoop({ request, sender, emit: subEmit, signal })

    return {
      phaseId: phase.id,
      success: true,
      filesChanged: [...filesChanged],
      summary: summaryText.slice(0, 4000),
      sandboxId: sandboxLease?.id,
    }
  } finally {
    if (pool && sandboxLease) {
      pool.release(sandboxLease)
    }
  }
}

module.exports = { runSubAgent, pickToolsForTasks, buildSubAgentSystemPrompt }
