const VISIBLE_MODES = new Set(["ask", "plan", "agent", "auto"])
const ROUTED_MODES = new Set(["agent", "auto"])

const PATH_RE = /[\w./\\-]+\.(?:ts|tsx|js|jsx|vue|json|md|css|scss|html|py|java|rs|go|c|cpp|h|hpp|cs|yml|yaml|toml|sql)/gi

const MULTI_AGENT_SIGNALS = [
  { pattern: /\b(refactor|migrate|migration|architecture|cross[- ]?module|end[- ]?to[- ]?end|integration|workspace|orchestrator)\b/i, label: "任务包含跨模块或架构级变更" },
  { pattern: /\b(test|typecheck|lint|build|verify|e2e|playwright)\b/i, label: "任务需要独立验证阶段" },
  { pattern: /\b(frontend|backend|desktop|renderer|main process|api|database|settings|ui)\b/i, label: "任务涉及多个子系统信号" },
  { pattern: /\b(多文件|跨模块|重构|迁移|端到端|测试|构建|类型检查|联调|编排|工作区|沙箱|权限)\b/, label: "任务包含中文复杂协作信号" },
]

const SINGLE_AGENT_SIGNALS = [
  { pattern: /\b(fix|bug|typo|rename|copy|label|style|css|small|simple)\b/i, label: "任务像局部小修" },
  { pattern: /\b(修复|错别字|文案|样式|改名|小改|简单|单文件)\b/, label: "任务像单文件或小范围修改" },
]

function normalizeMode(mode) {
  const value = String(mode || "").toLowerCase()
  return VISIBLE_MODES.has(value) ? value : "ask"
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())))
}

function extractMentionedPaths(text, files) {
  const matches = String(text || "").match(PATH_RE) || []
  return uniqueStrings([...matches, ...(Array.isArray(files) ? files : [])]).map((path) => path.replace(/\\/g, "/"))
}

function scorePatterns(text, signals) {
  const matched = []
  let score = 0
  for (const signal of signals) {
    if (signal.pattern.test(text)) {
      score += 1
      matched.push(signal.label)
    }
  }
  return { score, matched }
}

function estimateRisk(input) {
  const risk = String(input.risk || "").toLowerCase()
  if (risk === "high" || risk === "medium" || risk === "safe") return risk

  const text = String(input.text || "")
  if (/\b(delete|drop|rebase|push|publish|deploy|payment|auth|permission|secret|token)\b/i.test(text)) return "high"
  if (/(删除|权限|认证|密钥|部署|发布|支付|数据库)/.test(text)) return "high"
  if (/\b(refactor|migrate)\b/i.test(text) || /(重构|迁移)/.test(text)) return "medium"
  return "safe"
}

function chooseAgentStrategy(input = {}) {
  const visibleMode = normalizeMode(input.visibleMode || input.mode)
  const text = String(input.text || input.prompt || "")
  const files = extractMentionedPaths(text, input.files)

  if (!ROUTED_MODES.has(visibleMode)) {
    return {
      visibleMode,
      executionStrategy: "none",
      reason: "Ask / Plan 模式保持只读，不进入执行策略路由",
      signals: {
        files,
        risk: estimateRisk(input),
        matched: [],
      },
    }
  }

  const multi = scorePatterns(text, MULTI_AGENT_SIGNALS)
  const single = scorePatterns(text, SINGLE_AGENT_SIGNALS)
  const risk = estimateRisk(input)
  let score = multi.score - single.score

  if (files.length >= 3) {
    score += 2
    multi.matched.push("提到 3 个以上文件")
  } else if (files.length === 1) {
    score -= 1
    single.matched.push("只提到 1 个文件")
  }

  if (risk === "high") {
    score += 2
    multi.matched.push("高风险任务需要 Reviewer / Verifier")
  } else if (risk === "medium") {
    score += 1
    multi.matched.push("中风险任务建议拆分验证")
  }

  const override = input.agentStrategy === "single-agent" || input.agentStrategy === "multi-agent"
    ? input.agentStrategy
    : null
  const executionStrategy = override || (score >= 2 ? "multi-agent" : "single-agent")
  const matched = executionStrategy === "multi-agent" ? multi.matched : single.matched
  const fallbackReason = executionStrategy === "multi-agent"
    ? "任务复杂度较高，适合拆分为规划、实现和验证协作"
    : "任务范围较小，单 Agent 执行更直接"

  return {
    visibleMode,
    executionStrategy,
    reason: override
      ? `高级设置强制使用 ${override}`
      : (matched[0] || fallbackReason),
    signals: {
      files,
      fileCount: files.length,
      risk,
      score,
      matched,
      overridden: Boolean(override),
    },
  }
}

module.exports = {
  chooseAgentStrategy,
  extractMentionedPaths,
}
