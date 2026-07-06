/**
 * Planner — calls the LLM with planner prompts and returns a validated PlanTree.
 *
 * Strategy: try up to 3 times to produce valid JSON. On final failure, return
 * a degenerate single-phase plan so the rest of the pipeline can still run.
 */

const { fetch } = require("undici")
const { getConfig } = require("../llm/config")
const { listSchemas } = require("../agentTools/tools")
const { buildPlannerSystem, buildPlannerUser } = require("./prompts/planner")
const planTree = require("./planTree")

const MAX_ATTEMPTS = 3
const PLAN_TIMEOUT_MS = 90_000

async function callLLM({ provider, model, apiKey, baseUrl, system, user, signal }) {
  const cfg = getConfig()
  const isAnthropic = provider === "claude" || provider === "anthropic"
  const key = apiKey || cfg[isAnthropic ? "anthropic" : provider]?.apiKey
  const url = baseUrl || cfg[isAnthropic ? "anthropic" : provider]?.baseUrl
  if (!key) throw new Error(`planner: API key missing for ${provider}`)

  const ctrl = AbortSignal.timeout(PLAN_TIMEOUT_MS)
  const composite = signal
    ? AbortSignal.any
      ? AbortSignal.any([ctrl, signal])
      : ctrl
    : ctrl

  if (isAnthropic) {
    const resp = await fetch(`${url}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": cfg.anthropic?.version || "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: composite,
    })
    if (!resp.ok) throw new Error(`planner anthropic HTTP ${resp.status}`)
    const data = await resp.json()
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("")
    return text
  }

  const resp = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    }),
    signal: composite,
  })
  if (!resp.ok) throw new Error(`planner ${provider} HTTP ${resp.status}`)
  const data = await resp.json()
  return data.choices?.[0]?.message?.content || ""
}

async function generate({ userInput, provider, model, apiKey, baseUrl, projectSummary, rules, signal }) {
  const tools = listSchemas().map((s) => ({ name: s.name, description: s.description }))
  const system = buildPlannerSystem({ tools, projectSummary, rules })
  const userMsg = buildPlannerUser(userInput)

  let lastErr = null
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const text = await callLLM({ provider, model, apiKey, baseUrl, system, user: userMsg, signal })
      const obj = planTree.extractJson(text)
      return planTree.createPlan(obj.goal || userInput, obj.phases || [])
    } catch (err) {
      lastErr = err
    }
  }

  // Degraded fallback — single main-agent phase echoing user input
  return planTree.createPlan(userInput, [
    {
      id: "phase_1",
      name: "Execute request (fallback)",
      agent: "main",
      dependsOn: [],
      tasks: [
        { description: userInput, tool: null },
      ],
    },
  ])
}

module.exports = { generate }
