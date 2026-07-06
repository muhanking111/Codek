const fs = require("node:fs")
const path = require("node:path")
const { defaultReadinessReportDir } = require("../agentLoop/readiness")

const DEFAULT_USAGE_PRICE_TABLE = {
  version: 1,
  currency: "USD",
  unit: "million_tokens",
  source: "local-default",
  prices: [
    { provider: "openai", model: "gpt-4o-mini", inputUsdPerMillionTokens: 0.15, outputUsdPerMillionTokens: 0.6 },
    { provider: "openai", model: "gpt-4o", inputUsdPerMillionTokens: 5, outputUsdPerMillionTokens: 15 },
    { provider: "openai", model: "gpt-4.1-mini", inputUsdPerMillionTokens: 0.4, outputUsdPerMillionTokens: 1.6 },
    { provider: "openai", model: "gpt-4.1", inputUsdPerMillionTokens: 2, outputUsdPerMillionTokens: 8 },
    { provider: "anthropic", model: "claude-3-5-haiku", inputUsdPerMillionTokens: 0.8, outputUsdPerMillionTokens: 4 },
    { provider: "anthropic", model: "claude-3-5-sonnet", inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
    { provider: "anthropic", model: "claude-3-7-sonnet", inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 15 },
    { provider: "ollama", model: "*", inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  ],
}

function normalizeUsage({ provider = "", node = null } = {}) {
  if (!node || typeof node !== "object") return null
  const normalizedProvider = normalizeProvider(provider)
  const raw = node.usage && typeof node.usage === "object" ? node.usage : node

  const openAiInput = numberOrNull(raw.prompt_tokens ?? raw.promptTokens)
  const openAiOutput = numberOrNull(raw.completion_tokens ?? raw.completionTokens)
  const anthropicInput = numberOrNull(raw.input_tokens ?? raw.inputTokens)
  const anthropicOutput = numberOrNull(raw.output_tokens ?? raw.outputTokens)
  const ollamaInput = numberOrNull(raw.prompt_eval_count ?? raw.promptEvalCount)
  const ollamaOutput = numberOrNull(raw.eval_count ?? raw.evalCount)

  const inputTokens = firstNumber(openAiInput, anthropicInput, ollamaInput)
  const outputTokens = firstNumber(openAiOutput, anthropicOutput, ollamaOutput)
  const explicitTotal = numberOrNull(raw.total_tokens ?? raw.totalTokens)

  if (inputTokens == null && outputTokens == null && explicitTotal == null) return null
  const safeInput = inputTokens || 0
  const safeOutput = outputTokens || 0
  return {
    inputTokens: safeInput,
    outputTokens: safeOutput,
    totalTokens: explicitTotal != null ? explicitTotal : safeInput + safeOutput,
    source: "provider",
    provider: normalizedProvider,
  }
}

function estimateUsageFromText({ provider = "", messages = [], output = "" } = {}) {
  const inputText = Array.isArray(messages)
    ? messages.map((message) => String(message?.content || "")).join("\n")
    : ""
  const inputTokens = estimateTokenCount(inputText)
  const outputTokens = estimateTokenCount(output)
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    source: "estimated",
    provider: normalizeProvider(provider),
  }
}

function mergeUsage(...items) {
  const valid = items.filter((item) => item && typeof item === "object")
  return valid.find((item) => item.source === "provider") || valid[0] || null
}

function usageAuditPath(reportDir = defaultReadinessReportDir()) {
  return path.join(reportDir || defaultReadinessReportDir(), "llm-usage-audit.jsonl")
}

function usagePriceTablePath(reportDir = defaultReadinessReportDir()) {
  return path.join(reportDir || defaultReadinessReportDir(), "llm-usage-prices.json")
}

function getDefaultUsagePriceTable() {
  return JSON.parse(JSON.stringify(DEFAULT_USAGE_PRICE_TABLE))
}

function readUsagePriceTable(options = {}) {
  const filePath = options.priceTablePath || usagePriceTablePath(options.reportDir)
  const defaults = getDefaultUsagePriceTable()
  if (!fs.existsSync(filePath)) return defaults
  try {
    return normalizePriceTable(JSON.parse(fs.readFileSync(filePath, "utf8")), defaults)
  } catch {
    return defaults
  }
}

function saveUsagePriceTable(priceTable = {}, options = {}) {
  const reportDir = options.reportDir || defaultReadinessReportDir()
  const filePath = options.priceTablePath || usagePriceTablePath(reportDir)
  const normalized = normalizePriceTable(priceTable, getDefaultUsagePriceTable())
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  return { priceTable: normalized, path: filePath }
}

function saveUsageAudit(input = {}, options = {}) {
  const usage = input.usage && typeof input.usage === "object" ? input.usage : null
  if (!usage) throw new Error("usage is required")
  const reportDir = options.reportDir || input.reportDir || defaultReadinessReportDir()
  const auditPath = usageAuditPath(reportDir)
  fs.mkdirSync(path.dirname(auditPath), { recursive: true })
  const entry = sanitizeUsageAuditEntry(input)
  fs.appendFileSync(auditPath, `${JSON.stringify(entry)}\n`, "utf8")
  return entry
}

function listUsageAudits(options = {}) {
  const auditPath = usageAuditPath(options.reportDir)
  if (!fs.existsSync(auditPath)) return []
  return fs.readFileSync(auditPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, Number(options.limit || 50))
}

function summarizeUsageAudits(options = {}) {
  const history = listUsageAudits({ reportDir: options.reportDir, limit: options.limit || 50 })
  const priceTable = options.priceTable || readUsagePriceTable(options)
  const summary = {
    reportKind: "llm-usage-summary",
    createdAt: Date.now(),
    totalRequests: history.length,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    providerUsageRequests: 0,
    estimatedUsageRequests: 0,
    cost: emptyCostSummary(priceTable),
    byProvider: {},
    byModel: {},
    history,
  }
  summary.history = history.map((item) => attachUsageCost(item, priceTable))
  for (const item of summary.history) {
    summary.inputTokens += Number(item.inputTokens || 0)
    summary.outputTokens += Number(item.outputTokens || 0)
    summary.totalTokens += Number(item.totalTokens || 0)
    if (item.source === "provider") summary.providerUsageRequests += 1
    if (item.source === "estimated") summary.estimatedUsageRequests += 1
    const provider = item.provider || "unknown"
    summary.byProvider[provider] = summary.byProvider[provider] || {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      pricedRequests: 0,
      unpricedRequests: 0,
    }
    summary.byProvider[provider].requests += 1
    summary.byProvider[provider].inputTokens += Number(item.inputTokens || 0)
    summary.byProvider[provider].outputTokens += Number(item.outputTokens || 0)
    summary.byProvider[provider].totalTokens += Number(item.totalTokens || 0)
    addCostToBucket(summary.byProvider[provider], item.cost)
    const modelKey = `${provider}:${item.model || "unknown"}`
    summary.byModel[modelKey] = summary.byModel[modelKey] || {
      provider,
      model: item.model || "unknown",
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      pricedRequests: 0,
      unpricedRequests: 0,
    }
    summary.byModel[modelKey].requests += 1
    summary.byModel[modelKey].inputTokens += Number(item.inputTokens || 0)
    summary.byModel[modelKey].outputTokens += Number(item.outputTokens || 0)
    summary.byModel[modelKey].totalTokens += Number(item.totalTokens || 0)
    addCostToBucket(summary.byModel[modelKey], item.cost)
    addCostToSummary(summary.cost, item)
  }
  summary.cost.estimatedCostUsd = roundMoney(summary.cost.estimatedCostUsd)
  return summary
}

function summarizeUsageCost(options = {}) {
  const summary = summarizeUsageAudits(options)
  return {
    ...summary,
    reportKind: "llm-usage-cost-summary",
  }
}

function estimateUsageCost(usage = {}, options = {}) {
  const priceTable = options.priceTable || readUsagePriceTable(options)
  const provider = normalizeProvider(usage.provider)
  const model = safeShortText(usage.model, 120) || "unknown"
  const price = findUsagePrice({ provider, model }, priceTable)
  if (!price) {
    return {
      priced: false,
      provider,
      model,
      currency: priceTable.currency || "USD",
      priceSource: "",
      inputCostUsd: 0,
      outputCostUsd: 0,
      estimatedCostUsd: 0,
      reason: "missing_model_price",
    }
  }
  const inputTokens = Number(usage.inputTokens || 0)
  const outputTokens = Number(usage.outputTokens || 0)
  const inputCostUsd = (inputTokens / 1_000_000) * Number(price.inputUsdPerMillionTokens || 0)
  const outputCostUsd = (outputTokens / 1_000_000) * Number(price.outputUsdPerMillionTokens || 0)
  return {
    priced: true,
    provider,
    model,
    currency: priceTable.currency || "USD",
    priceSource: price.source || priceTable.source || "local",
    inputUsdPerMillionTokens: Number(price.inputUsdPerMillionTokens || 0),
    outputUsdPerMillionTokens: Number(price.outputUsdPerMillionTokens || 0),
    inputCostUsd: roundMoney(inputCostUsd),
    outputCostUsd: roundMoney(outputCostUsd),
    estimatedCostUsd: roundMoney(inputCostUsd + outputCostUsd),
  }
}

function sanitizeUsageAuditEntry(input = {}) {
  const usage = input.usage || {}
  const inputTokens = Number(usage.inputTokens || 0)
  const outputTokens = Number(usage.outputTokens || 0)
  return {
    id: input.id || `usage_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    requestId: safeShortText(input.requestId, 120),
    provider: normalizeProvider(input.provider || usage.provider),
    model: safeShortText(input.model, 120),
    source: usage.source === "provider" ? "provider" : "estimated",
    inputTokens,
    outputTokens,
    totalTokens: Number(usage.totalTokens || inputTokens + outputTokens),
    createdAt: Number(input.createdAt || Date.now()),
  }
}

function estimateTokenCount(text) {
  const normalized = String(text || "").trim()
  if (!normalized) return 0
  // Deliberately coarse: enough for local visibility without retaining text.
  return Math.max(1, Math.ceil(normalized.length / 4))
}

function normalizePriceTable(input, fallback) {
  const base = fallback || getDefaultUsagePriceTable()
  const prices = Array.isArray(input?.prices) ? input.prices : base.prices
  return {
    version: Number(input?.version || base.version || 1),
    currency: safeShortText(input?.currency || base.currency || "USD", 12),
    unit: "million_tokens",
    source: safeShortText(input?.source || base.source || "local", 80),
    prices: prices
      .map((item) => ({
        provider: normalizeProvider(item?.provider),
        model: safeShortText(item?.model || "*", 120),
        inputUsdPerMillionTokens: Number(item?.inputUsdPerMillionTokens || 0),
        outputUsdPerMillionTokens: Number(item?.outputUsdPerMillionTokens || 0),
        source: safeShortText(item?.source || input?.source || base.source || "local", 80),
      }))
      .filter((item) => item.provider && item.model && Number.isFinite(item.inputUsdPerMillionTokens) && Number.isFinite(item.outputUsdPerMillionTokens)),
  }
}

function findUsagePrice({ provider, model }, priceTable = getDefaultUsagePriceTable()) {
  const prices = Array.isArray(priceTable.prices) ? priceTable.prices : []
  const normalizedProvider = normalizeProvider(provider)
  const normalizedModel = String(model || "").toLowerCase()
  return prices.find((item) =>
    normalizeProvider(item.provider) === normalizedProvider &&
    String(item.model || "").toLowerCase() === normalizedModel,
  ) || prices.find((item) =>
    normalizeProvider(item.provider) === normalizedProvider &&
    item.model === "*",
  ) || null
}

function attachUsageCost(item, priceTable) {
  return {
    ...item,
    cost: estimateUsageCost(item, { priceTable }),
  }
}

function emptyCostSummary(priceTable) {
  return {
    available: false,
    estimated: true,
    currency: priceTable.currency || "USD",
    priceSource: priceTable.source || "local",
    estimatedCostUsd: 0,
    pricedRequests: 0,
    unpricedRequests: 0,
    unpricedModels: [],
  }
}

function addCostToBucket(bucket, cost = {}) {
  if (cost.priced) {
    bucket.pricedRequests += 1
    bucket.estimatedCostUsd = roundMoney(Number(bucket.estimatedCostUsd || 0) + Number(cost.estimatedCostUsd || 0))
  } else {
    bucket.unpricedRequests += 1
  }
}

function addCostToSummary(costSummary, item) {
  const cost = item.cost || {}
  if (cost.priced) {
    costSummary.available = true
    costSummary.pricedRequests += 1
    costSummary.estimatedCostUsd += Number(cost.estimatedCostUsd || 0)
    return
  }
  costSummary.unpricedRequests += 1
  const key = `${item.provider || "unknown"}:${item.model || "unknown"}`
  if (!costSummary.unpricedModels.some((model) => model.key === key)) {
    costSummary.unpricedModels.push({
      key,
      provider: item.provider || "unknown",
      model: item.model || "unknown",
      requests: 1,
    })
  } else {
    const existing = costSummary.unpricedModels.find((model) => model.key === key)
    existing.requests += 1
  }
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1_000_000) / 1_000_000
}

function normalizeProvider(provider) {
  if (provider === "claude") return "anthropic"
  return provider || "unknown"
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function firstNumber(...values) {
  return values.find((value) => value != null) ?? null
}

function safeShortText(value, maxLength) {
  return String(value || "").slice(0, maxLength)
}

module.exports = {
  estimateUsageCost,
  estimateUsageFromText,
  getDefaultUsagePriceTable,
  listUsageAudits,
  mergeUsage,
  normalizeUsage,
  readUsagePriceTable,
  saveUsageAudit,
  saveUsagePriceTable,
  summarizeUsageCost,
  summarizeUsageAudits,
  usageAuditPath,
  usagePriceTablePath,
}
