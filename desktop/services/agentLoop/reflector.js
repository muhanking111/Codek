/**
 * Reflector — when execution stalls, gather evidence and ask the LLM to
 * decide whether to retry, rewind to the previous phase, or escalate to user.
 */

const { fetch } = require("undici")
const { getConfig } = require("../llm/config")
const planTree = require("./planTree")

const REFLECTION_TIMEOUT_MS = 60_000
const MAX_REFLECTIONS_PER_PHASE = 3

const reflectionCount = new Map() // phaseId → count

function shouldReflect({ phaseId, recentErrors = 0, sameFileEditCount = 0, gaveUp = false }) {
  const used = reflectionCount.get(phaseId) || 0
  if (used >= MAX_REFLECTIONS_PER_PHASE) return false
  if (gaveUp) return true
  if (recentErrors >= 2) return true
  if (sameFileEditCount > 3) return true
  return false
}

function buildReflectionPrompt({ phase, evidence }) {
  const evLines = (evidence || []).slice(-5).map((e, i) => {
    const status = e.isError ? "FAILED" : "ok"
    return `  ${i + 1}. ${e.tool || "(text)"} → ${status}: ${(e.content || "").slice(0, 200)}`
  }).join("\n")

  return `You are a Reflector for a coding agent. The current phase is stuck.

Phase: ${phase?.name || "(unknown)"}
Goal: ${phase?.tasks?.map((t) => t.description).join("; ") || "(unknown)"}

Recent tool activity:
${evLines || "  (none)"}

Analyze:
1. Was the tool used incorrectly, or was the approach wrong?
2. Is some prerequisite missing (file unread, doc unsearched)?
3. Choose ONE next action.

Reply ONLY in this strict JSON shape (no commentary, no fences):
{
  "action": "retry" | "rewind" | "ask_user",
  "reason": "<one short sentence>",
  "new_plan": [ { "description": "...", "tool": null } ]   // required only if action = "retry"
}`
}

async function callLLM({ provider, model, system, signal }) {
  const cfg = getConfig()
  const isAnthropic = provider === "claude" || provider === "anthropic"
  const key = cfg[isAnthropic ? "anthropic" : provider]?.apiKey
  const url = cfg[isAnthropic ? "anthropic" : provider]?.baseUrl
  if (!key) throw new Error("reflector: API key missing")
  const t = AbortSignal.timeout(REFLECTION_TIMEOUT_MS)
  const composite = signal && AbortSignal.any ? AbortSignal.any([t, signal]) : t

  if (isAnthropic) {
    const resp = await fetch(`${url}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": cfg.anthropic?.version || "2023-06-01",
      },
      body: JSON.stringify({
        model, max_tokens: 1024,
        messages: [{ role: "user", content: system }],
      }),
      signal: composite,
    })
    if (!resp.ok) throw new Error(`reflector anthropic HTTP ${resp.status}`)
    const data = await resp.json()
    return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("")
  }

  const resp = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: system }],
      temperature: 0,
    }),
    signal: composite,
  })
  if (!resp.ok) throw new Error(`reflector ${provider} HTTP ${resp.status}`)
  const data = await resp.json()
  return data.choices?.[0]?.message?.content || ""
}

async function reflect({ phase, evidence, provider, model, signal }) {
  const used = reflectionCount.get(phase.id) || 0
  if (used >= MAX_REFLECTIONS_PER_PHASE) {
    return { action: "ask_user", reason: "reflection budget exhausted" }
  }
  reflectionCount.set(phase.id, used + 1)

  const prompt = buildReflectionPrompt({ phase, evidence })
  try {
    const text = await callLLM({ provider, model, system: prompt, signal })
    const obj = planTree.extractJson(text)
    if (!obj.action || !["retry", "rewind", "ask_user"].includes(obj.action)) {
      return { action: "ask_user", reason: "invalid reflection action" }
    }
    return obj
  } catch (err) {
    return { action: "ask_user", reason: `reflector error: ${err.message}` }
  }
}

function resetPhase(phaseId) {
  reflectionCount.delete(phaseId)
}

module.exports = { shouldReflect, reflect, resetPhase, MAX_REFLECTIONS_PER_PHASE }
