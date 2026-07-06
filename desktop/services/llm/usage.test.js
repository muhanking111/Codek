const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const test = require("node:test")

const {
  estimateUsageCost,
  estimateUsageFromText,
  getDefaultUsagePriceTable,
  listUsageAudits,
  mergeUsage,
  normalizeUsage,
  saveUsageAudit,
  summarizeUsageAudits,
  usageAuditPath,
} = require("./usage")
const llmService = require("./index")
const router = require("../router")

test("normalizeUsage reads OpenAI compatible token usage", () => {
  const usage = normalizeUsage({
    provider: "openai",
    node: {
      usage: {
        prompt_tokens: 12,
        completion_tokens: 7,
        total_tokens: 19,
      },
    },
  })

  assert.deepEqual(usage, {
    inputTokens: 12,
    outputTokens: 7,
    totalTokens: 19,
    source: "provider",
    provider: "openai",
  })
})

test("normalizeUsage reads Anthropic message usage", () => {
  const usage = normalizeUsage({
    provider: "anthropic",
    node: {
      type: "message_delta",
      usage: {
        input_tokens: 21,
        output_tokens: 13,
      },
    },
  })

  assert.deepEqual(usage, {
    inputTokens: 21,
    outputTokens: 13,
    totalTokens: 34,
    source: "provider",
    provider: "anthropic",
  })
})

test("normalizeUsage reads Ollama eval counts", () => {
  const usage = normalizeUsage({
    provider: "ollama",
    node: {
      prompt_eval_count: 31,
      eval_count: 17,
    },
  })

  assert.deepEqual(usage, {
    inputTokens: 31,
    outputTokens: 17,
    totalTokens: 48,
    source: "provider",
    provider: "ollama",
  })
})

test("estimateUsageFromText creates a bounded estimate without retaining text", () => {
  const usage = estimateUsageFromText({
    provider: "openai",
    messages: [
      { role: "system", content: "你是 Codek" },
      { role: "user", content: "请解释这段代码" },
    ],
    output: "这是解释结果",
  })

  assert.equal(usage.source, "estimated")
  assert.equal(usage.provider, "openai")
  assert.equal(usage.inputTokens > 0, true)
  assert.equal(usage.outputTokens > 0, true)
  assert.equal(usage.totalTokens, usage.inputTokens + usage.outputTokens)
  assert.equal(JSON.stringify(usage).includes("请解释这段代码"), false)
})

test("mergeUsage prefers provider values over estimates", () => {
  const merged = mergeUsage(
    { inputTokens: 10, outputTokens: 3, totalTokens: 13, source: "estimated", provider: "openai" },
    { inputTokens: 12, outputTokens: 7, totalTokens: 19, source: "provider", provider: "openai" },
  )

  assert.deepEqual(merged, {
    inputTokens: 12,
    outputTokens: 7,
    totalTokens: 19,
    source: "provider",
    provider: "openai",
  })
})

test("saveUsageAudit stores sanitized local JSONL records", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-usage-audit-"))
  const saved = saveUsageAudit({
    requestId: "req_secret",
    provider: "openai",
    model: "gpt-test",
    usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19, source: "provider", provider: "openai" },
    prompt: "不要保存这段正文",
    apiKey: "sk-not-saved",
    output: "也不要保存输出",
  }, { reportDir })

  const auditPath = usageAuditPath(reportDir)
  const raw = fs.readFileSync(auditPath, "utf8")
  const history = listUsageAudits({ reportDir })

  assert.equal(saved.requestId, "req_secret")
  assert.equal(history.length, 1)
  assert.equal(history[0].totalTokens, 19)
  assert.equal(raw.includes("不要保存这段正文"), false)
  assert.equal(raw.includes("sk-not-saved"), false)
  assert.equal(raw.includes("也不要保存输出"), false)
})

test("summarizeUsageAudits aggregates provider and estimated usage", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-usage-summary-"))
  saveUsageAudit({
    requestId: "req_provider",
    provider: "openai",
    model: "gpt-test",
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, source: "provider", provider: "openai" },
  }, { reportDir })
  saveUsageAudit({
    requestId: "req_estimated",
    provider: "anthropic",
    model: "claude-test",
    usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, source: "estimated", provider: "anthropic" },
  }, { reportDir })

  const summary = summarizeUsageAudits({ reportDir })

  assert.equal(summary.totalRequests, 2)
  assert.equal(summary.totalTokens, 27)
  assert.equal(summary.providerUsageRequests, 1)
  assert.equal(summary.estimatedUsageRequests, 1)
  assert.equal(summary.byProvider.openai.totalTokens, 15)
  assert.equal(summary.history.length, 2)
})

test("estimateUsageCost uses local price table without external billing semantics", () => {
  const cost = estimateUsageCost({
    provider: "openai",
    model: "gpt-4o-mini",
    inputTokens: 1_000_000,
    outputTokens: 500_000,
  }, {
    priceTable: getDefaultUsagePriceTable(),
  })

  assert.equal(cost.priced, true)
  assert.equal(cost.currency, "USD")
  assert.equal(cost.estimatedCostUsd, 0.45)
  assert.equal(cost.inputCostUsd, 0.15)
  assert.equal(cost.outputCostUsd, 0.3)
  assert.equal(cost.priceSource, "local-default")
})

test("summarizeUsageAudits reports cost estimates and unpriced models", () => {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-usage-cost-"))
  saveUsageAudit({
    requestId: "req_priced",
    provider: "openai",
    model: "gpt-4o-mini",
    usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000, source: "provider", provider: "openai" },
  }, { reportDir })
  saveUsageAudit({
    requestId: "req_unpriced",
    provider: "openai",
    model: "custom-private-model",
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, source: "estimated", provider: "openai" },
  }, { reportDir })

  const summary = summarizeUsageAudits({ reportDir })

  assert.equal(summary.cost.pricedRequests, 1)
  assert.equal(summary.cost.unpricedRequests, 1)
  assert.equal(summary.cost.estimatedCostUsd, 0.75)
  assert.equal(summary.cost.unpricedModels[0].model, "custom-private-model")
  assert.equal(summary.byProvider.openai.estimatedCostUsd, 0.75)
  assert.equal(summary.byModel["openai:gpt-4o-mini"].estimatedCostUsd, 0.75)
  assert.equal(summary.history.find((item) => item.requestId === "req_unpriced").cost.priced, false)
})

test("llm usage summary route exposes sanitized usage history", async () => {
  router.clearRoutes()
  llmService.register(router)
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-usage-route-"))
  saveUsageAudit({
    requestId: "req_route",
    provider: "openai",
    model: "gpt-test",
    usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7, source: "provider", provider: "openai" },
  }, { reportDir })

  const result = await router.dispatch({
    method: "GET",
    path: `/llm/usage/summary?reportDir=${encodeURIComponent(reportDir)}`,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.totalRequests, 1)
  assert.equal(result.data.totalTokens, 7)
  assert.equal(result.data.history[0].requestId, "req_route")
})

test("llm usage cost route exposes local cost estimates", async () => {
  router.clearRoutes()
  llmService.register(router)
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "codek-usage-cost-route-"))
  saveUsageAudit({
    requestId: "req_cost_route",
    provider: "openai",
    model: "gpt-4o-mini",
    usage: { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000, source: "provider", provider: "openai" },
  }, { reportDir })

  const result = await router.dispatch({
    method: "GET",
    path: `/llm/usage/cost-summary?reportDir=${encodeURIComponent(reportDir)}`,
  })

  assert.equal(result.ok, true)
  assert.equal(result.data.reportKind, "llm-usage-cost-summary")
  assert.equal(result.data.cost.estimatedCostUsd, 0.15)
  assert.equal(result.data.cost.pricedRequests, 1)
})
