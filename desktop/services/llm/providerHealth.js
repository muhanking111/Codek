const fs = require("node:fs")
const path = require("node:path")
const { defaultReadinessReportDir } = require("../agentLoop/readiness")

function classifyProviderError(error) {
  const message = String(error?.message || error || "")
  const lower = message.toLowerCase()
  if (/abort|timeout|timed out/.test(lower)) return { code: "timeout", retryable: true, label: "请求超时" }
  if (/401|403|api key|auth/.test(lower)) return { code: "auth", retryable: false, label: "认证失败" }
  if (/429|rate/.test(lower)) return { code: "rate_limited", retryable: true, label: "请求限流" }
  if (/404|model|not found/.test(lower)) return { code: "model_unavailable", retryable: false, label: "模型不可用" }
  if (/network|fetch|econn|enotfound|socket/.test(lower)) return { code: "network", retryable: true, label: "网络异常" }
  return { code: "unknown", retryable: true, label: "未知错误" }
}

function buildProviderHealthReport(input = {}) {
  const providers = Array.isArray(input.providers) ? input.providers : []
  const checks = providers.map((provider) => {
    const error = provider.error ? classifyProviderError(provider.error) : null
    return {
      id: `provider_${provider.provider || "unknown"}`,
      title: `${provider.provider || "unknown"} 模型链路`,
      status: provider.ok ? "passed" : error?.retryable ? "warning" : "failed",
      detail: provider.ok
        ? `模型 ${provider.model || "-"} 可用，usage=${provider.usageSource || "unknown"}。`
        : `${error?.label || "失败"}: ${String(provider.error?.message || provider.error || "").slice(0, 160)}`,
      nextAction: provider.ok
        ? "继续记录 usage 和成本估算。"
        : error?.retryable
          ? "允许重试或切换 provider，并在 ChatAI 中显示中文原因。"
          : "请先修正 API Key、Base URL 或模型名称。",
    }
  })
  const summary = {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    warning: checks.filter((check) => check.status === "warning").length,
    failed: checks.filter((check) => check.status === "failed").length,
  }
  const status = summary.failed > 0 ? "blocked" : summary.warning > 0 ? "degraded" : "ready"
  return {
    reportKind: "provider-health",
    createdAt: Number(input.createdAt || Date.now()),
    status,
    statusLabel: status === "ready" ? "模型链路可用" : status === "degraded" ? "模型链路可重试" : "模型链路阻断",
    ready: status === "ready",
    summary,
    checks,
  }
}

function providerHealthPaths(reportDir = defaultReadinessReportDir()) {
  const resolved = reportDir || defaultReadinessReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "provider-health-latest.json"),
    latestMarkdownPath: path.join(resolved, "provider-health-latest.md"),
  }
}

function saveProviderHealthReport(report, options = {}) {
  const paths = providerHealthPaths(options.reportDir)
  fs.mkdirSync(paths.reportDir, { recursive: true })
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${toProviderHealthMarkdown(report)}\n`, "utf8")
  return { ...paths, report }
}

function readLatestProviderHealthReport(options = {}) {
  const paths = providerHealthPaths(options.reportDir)
  if (!fs.existsSync(paths.latestJsonPath)) return { report: null, ...paths }
  return { report: JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8")), ...paths }
}

function toProviderHealthMarkdown(report) {
  const rows = (report.checks || []).map((check) =>
    `| ${check.title} | ${check.status} | ${String(check.detail || "").replace(/\|/g, "\\|")} | ${String(check.nextAction || "").replace(/\|/g, "\\|")} |`,
  )
  return [
    "# 模型链路健康报告",
    "",
    `- 状态: ${report.statusLabel || report.status}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    "",
    "| 检查项 | 状态 | 详情 | 下一步 |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n")
}

module.exports = {
  buildProviderHealthReport,
  classifyProviderError,
  providerHealthPaths,
  readLatestProviderHealthReport,
  saveProviderHealthReport,
  toProviderHealthMarkdown,
}
