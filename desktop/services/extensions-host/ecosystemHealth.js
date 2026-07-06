const fs = require("node:fs")
const path = require("node:path")
const { defaultReadinessReportDir } = require("../agentLoop/readiness")

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, "")
}

function getExtensionId(ext = {}) {
  return String(ext.id || (ext.publisher && ext.name ? `${ext.publisher}.${ext.name}` : ext.name || "")).trim()
}

function getDisplayName(ext = {}) {
  return String(ext.displayName || ext.name || getExtensionId(ext) || "未知扩展").trim()
}

function rankMarketplaceResults(results = [], query = "") {
  const q = normalizeText(query)
  const qc = compactText(query)
  return results.slice().sort((a, b) => {
    const scoreA = scoreResult(a, q, qc)
    const scoreB = scoreResult(b, q, qc)
    if (scoreB !== scoreA) return scoreB - scoreA
    return Number(b.downloadCount || b.installCount || b.downloads || 0) - Number(a.downloadCount || a.installCount || a.downloads || 0)
  })
}

function scoreResult(ext = {}, normalizedQuery = "", compactQuery = "") {
  if (!normalizedQuery) return Math.log10(Number(ext.downloadCount || ext.installCount || ext.downloads || 0) + 1)
  const id = normalizeText(getExtensionId(ext))
  const idCompact = compactText(getExtensionId(ext))
  const name = normalizeText(ext.name)
  const nameCompact = compactText(ext.name)
  const display = normalizeText(getDisplayName(ext))
  const displayCompact = compactText(getDisplayName(ext))
  const publisher = normalizeText(ext.publisher || ext.namespace)
  const tags = Array.isArray(ext.tags) ? ext.tags.map(normalizeText) : []
  let score = 0
  if (id === normalizedQuery || idCompact === compactQuery) score += 10000
  if (name === normalizedQuery || nameCompact === compactQuery) score += 9000
  if (display === normalizedQuery || displayCompact === compactQuery) score += 8000
  if (id.includes(normalizedQuery) || idCompact.includes(compactQuery)) score += 4000
  if (name.includes(normalizedQuery) || nameCompact.includes(compactQuery)) score += 3500
  if (display.includes(normalizedQuery) || displayCompact.includes(compactQuery)) score += 3000
  if (publisher && normalizedQuery.includes(publisher)) score += 400
  if (tags.some((tag) => tag === normalizedQuery)) score += 800
  if (tags.some((tag) => tag.includes(normalizedQuery))) score += 300
  score += Math.log10(Number(ext.downloadCount || ext.installCount || ext.downloads || 0) + 1) * 20
  score += Number(ext.averageRating || ext.rating || 0) * 5
  return score
}

function buildExtensionEcosystemHealth(input = {}) {
  const installed = Array.isArray(input.installed) ? input.installed : []
  const searchResults = Array.isArray(input.searchResults) ? input.searchResults : []
  const query = String(input.query || "")
  const iconCache = input.iconCache || {}
  const activationReport = input.activationReport || null
  const installResults = Array.isArray(input.installResults) ? input.installResults : []
  const ranked = rankMarketplaceResults(searchResults, query)
  const iconEvidence = buildIconEvidence(ranked, iconCache)
  const compatibilityMatrix = buildContributionCompatibilityMatrix(installed, ranked, input.topN)
  const checks = [
    checkNames(installed, ranked),
    checkSearchRanking(ranked, query),
    checkIconCache(iconEvidence),
    checkInstallResults(installResults),
    checkActivation(activationReport),
    checkConflictIsolation(installed),
    checkTopNCompatibilityMatrix(compatibilityMatrix),
  ]
  const summary = summarizeChecks(checks)
  const status = summary.failed > 0 ? "blocked" : summary.warning > 0 ? "degraded" : "ready"
  return {
    reportKind: "extension-ecosystem-health",
    createdAt: Number(input.createdAt || Date.now()),
    status,
    statusLabel: status === "ready" ? "扩展生态可用" : status === "degraded" ? "扩展生态需补证据" : "扩展生态阻断",
    ready: status === "ready",
    query,
    summary,
    checks,
    iconEvidence,
    compatibilityMatrix,
    warningPolicy: checks
      .filter((check) => check.status === "warning")
      .map((check) => ({
        id: check.id,
        category: check.warningCategory || "product-risk",
        severity: "warning",
        blocking: { quick: false, full: false, strict: check.id !== "icon_cache" },
        nextAction: check.nextAction,
      })),
    rankedResults: ranked.slice(0, 10).map((ext, index) => ({
      rank: index + 1,
      id: getExtensionId(ext),
      displayName: getDisplayName(ext),
      publisher: ext.publisher || ext.namespace || "",
      downloadCount: Number(ext.downloadCount || ext.installCount || ext.downloads || 0),
      iconCached: Boolean(iconCache[getExtensionId(ext)] || iconCache[ext.iconCacheUrl] || iconCache[ext.iconUrl]),
    })),
  }
}

function buildIconEvidence(ranked, iconCache = {}) {
  const withIcon = ranked.filter((ext) => ext.iconUrl || ext.iconCacheUrl)
  const cached = withIcon.filter((ext) => iconCache[getExtensionId(ext)] || iconCache[ext.iconCacheUrl] || iconCache[ext.iconUrl])
  return {
    totalResults: ranked.length,
    withIcon: withIcon.length,
    cached: cached.length,
    missingIconSamples: Math.max(0, ranked.length - withIcon.length),
    cacheHitRatio: withIcon.length ? Number((cached.length / withIcon.length).toFixed(2)) : 0,
    placeholderStrategy: "stable-initials",
    dataUrlFallback: cached.some((ext) => String(iconCache[getExtensionId(ext)] || iconCache[ext.iconCacheUrl] || iconCache[ext.iconUrl] || "").startsWith("data:")),
  }
}

const CONTRIBUTION_SUPPORT = {
  commands: "supported",
  configuration: "supported",
  configurationDefaults: "supported",
  iconThemes: "supported",
  keybindings: "supported",
  languages: "supported",
  views: "supported",
  viewsContainers: "supported",
  debuggers: "partial",
  grammars: "partial",
  menus: "partial",
  snippets: "partial",
  themes: "unsupported",
}

function buildContributionCompatibilityMatrix(installed = [], ranked = [], topN = 10) {
  const installedById = new Map()
  for (const extension of Array.isArray(installed) ? installed : []) {
    const id = getExtensionId(extension)
    if (id) installedById.set(id, extension)
  }

  const seen = new Set()
  const candidates = []
  for (const extension of [...(Array.isArray(ranked) ? ranked : []), ...(Array.isArray(installed) ? installed : [])]) {
    const id = getExtensionId(extension)
    if (!id || seen.has(id)) continue
    seen.add(id)
    candidates.push(installedById.get(id) || extension)
  }

  const sampleSize = Math.max(1, Number(topN) || 10)
  const extensions = candidates.slice(0, sampleSize).map((extension, index) => {
    const contributionPoints = summarizeContributionPoints(extension.contributes)
    const supportedContributionPoints = contributionPoints.filter((item) => item.support === "supported").map((item) => item.point)
    const partialContributionPoints = contributionPoints.filter((item) => item.support === "partial").map((item) => item.point)
    const unsupportedContributionPoints = contributionPoints.filter((item) => item.support === "unsupported").map((item) => item.point)
    const supportLevel = unsupportedContributionPoints.length
      ? "limited"
      : partialContributionPoints.length
        ? "partial"
        : "supported"
    return {
      rank: index + 1,
      id: getExtensionId(extension),
      displayName: getDisplayName(extension),
      publisher: extension.publisher || extension.namespace || "",
      supportLevel,
      contributionPoints,
      supportedContributionPoints,
      partialContributionPoints,
      unsupportedContributionPoints,
    }
  })

  return {
    topN: sampleSize,
    supportPolicy: CONTRIBUTION_SUPPORT,
    summary: {
      sampledExtensions: extensions.length,
      supportedContributionPoints: sumContributionPoints(extensions, "supported"),
      partialContributionPoints: sumContributionPoints(extensions, "partial"),
      unsupportedContributionPoints: sumContributionPoints(extensions, "unsupported"),
      totalContributionPoints: extensions.reduce((total, extension) => total + extension.contributionPoints.length, 0),
    },
    extensions,
  }
}

function summarizeContributionPoints(contributes = {}) {
  if (!contributes || typeof contributes !== "object" || Array.isArray(contributes)) return []
  return Object.entries(contributes)
    .filter(([, value]) => hasContributionValue(value))
    .map(([point, value]) => ({
      point,
      count: countContributionValue(value),
      support: CONTRIBUTION_SUPPORT[point] || "unsupported",
    }))
    .sort((a, b) => a.point.localeCompare(b.point))
}

function hasContributionValue(value) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === "object") return Object.keys(value).length > 0
  return Boolean(value)
}

function countContributionValue(value) {
  if (Array.isArray(value)) return value.length
  if (value && typeof value === "object") return Object.keys(value).length
  return value ? 1 : 0
}

function sumContributionPoints(extensions, support) {
  return extensions.reduce((total, extension) =>
    total + extension.contributionPoints.filter((item) => item.support === support).length,
  0)
}

function checkNames(installed, ranked) {
  const missing = [...installed, ...ranked]
    .filter((ext) => !getExtensionId(ext) || !getDisplayName(ext))
    .map((ext) => getExtensionId(ext) || ext.name || "unknown")
  return makeCheck({
    id: "extension_names",
    title: "扩展名称显示",
    status: missing.length ? "failed" : "passed",
    detail: missing.length ? `存在 ${missing.length} 个扩展缺少 id 或显示名。` : "扩展列表具备稳定 id 和显示名。",
    nextAction: "补齐 extension id/displayName 归一化，避免 UI 只显示空白或 publisher。",
  })
}

function checkSearchRanking(ranked, query) {
  if (!query.trim()) {
    return makeCheck({
      id: "search_ranking",
      title: "搜索排序",
      status: ranked.length ? "passed" : "warning",
      detail: ranked.length ? "无查询时按热度回退排序。" : "暂无搜索结果样本。",
      nextAction: "提供真实 OpenVSX 搜索样本后重新生成健康报告。",
    })
  }
  const first = ranked[0]
  const q = compactText(query)
  const exact = first && [getExtensionId(first), first.name, getDisplayName(first)].some((value) => compactText(value) === q)
  return makeCheck({
    id: "search_ranking",
    title: "搜索排序",
    status: exact ? "passed" : "warning",
    detail: exact ? "精确匹配结果位于首位。" : "首位结果不是精确匹配，可能需要人工复核 OpenVSX 返回质量。",
    nextAction: "保持 VS Code 风格的文本相关性优先，再用下载量和评分做 tie-breaker。",
  })
}

function checkIconCache(iconEvidence) {
  if (iconEvidence.withIcon === 0) {
    return makeCheck({
      id: "icon_cache",
      title: "扩展图标缓存",
      status: "warning",
      detail: "搜索结果没有图标样本。",
      nextAction: "用真实 OpenVSX 图标样本验证缓存命中和 data URL 回退。",
      warningCategory: "product-risk",
    })
  }
  return makeCheck({
    id: "icon_cache",
    title: "扩展图标缓存",
    status: iconEvidence.cacheHitRatio >= 0.5 ? "passed" : "warning",
    detail: `图标缓存命中 ${iconEvidence.cached}/${iconEvidence.withIcon}。`,
    nextAction: "预热首屏结果图标并持久化 data URL，加载失败时使用稳定首字母占位。",
    warningCategory: "product-risk",
  })
}

function checkInstallResults(results) {
  if (!results.length) {
    return makeCheck({
      id: "install_lifecycle",
      title: "安装/卸载链路",
      status: "warning",
      detail: "暂无安装/卸载样本。",
      nextAction: "执行一次受控 .vsix 或 OpenVSX 安装/卸载 smoke。",
    })
  }
  const failed = results.filter((item) => item && item.success === false)
  return makeCheck({
    id: "install_lifecycle",
    title: "安装/卸载链路",
    status: failed.length ? "failed" : "passed",
    detail: failed.length ? `${failed.length} 个安装/卸载样本失败。` : "安装/卸载样本均成功。",
    nextAction: "安装失败时保留中文错误、进度阶段和可重试状态，不让侧边栏消失。",
  })
}

function checkActivation(report) {
  if (!report) {
    return makeCheck({
      id: "activation_report",
      title: "Activation 报告",
      status: "warning",
      detail: "暂无 activation 报告。",
      nextAction: "生成或读取 extensions/_activation_report.json。",
    })
  }
  const runtimeErrors = Array.isArray(report.runtimeErrors) ? report.runtimeErrors.length : Number(report.runtimeErrors || 0)
  return makeCheck({
    id: "activation_report",
    title: "Activation 报告",
    status: runtimeErrors > 0 ? "failed" : "passed",
    detail: runtimeErrors > 0 ? `存在 ${runtimeErrors} 个运行时错误。` : "Activation 报告无运行时错误。",
    nextAction: "先修复 activation runtimeErrors，再允许进入 full release gate。",
  })
}

function checkConflictIsolation(installed) {
  const ids = new Set()
  const duplicates = []
  for (const ext of installed) {
    const id = getExtensionId(ext)
    if (!id) continue
    if (ids.has(id)) duplicates.push(id)
    ids.add(id)
  }
  return makeCheck({
    id: "conflict_isolation",
    title: "冲突扩展隔离",
    status: duplicates.length ? "warning" : "passed",
    detail: duplicates.length ? `发现重复扩展 id: ${duplicates.slice(0, 3).join(", ")}` : "未发现重复扩展 id。",
    nextAction: "重复或冲突扩展应阻断安装并保留现有侧边栏状态。",
  })
}

function checkTopNCompatibilityMatrix(matrix) {
  const unsupported = Number(matrix?.summary?.unsupportedContributionPoints || 0)
  const sampled = Number(matrix?.summary?.sampledExtensions || 0)
  return makeCheck({
    id: "top_n_compatibility_matrix",
    title: "Top N 扩展兼容矩阵",
    status: sampled > 0 ? "passed" : "warning",
    detail: sampled
      ? `已生成 ${sampled}/${Number(matrix.topN || 0)} 个扩展的 contribution point 兼容矩阵；unsupported ${unsupported}。`
      : "暂无可抽样扩展，无法证明 Top N 兼容面。",
    nextAction: unsupported > 0
      ? "继续补齐 unsupported contribution points，或在发布说明里明确限制范围。"
      : "保持矩阵进入 release gate，防止扩展兼容声明退化为空口径。",
    warningCategory: unsupported > 0 ? "compatibility" : "",
  })
}

function makeCheck(input) {
  return {
    id: input.id,
    title: input.title,
    status: input.status,
    detail: input.detail,
    nextAction: input.nextAction,
    warningCategory: input.warningCategory || "",
  }
}

function summarizeChecks(checks) {
  return {
    total: checks.length,
    passed: checks.filter((check) => check.status === "passed").length,
    warning: checks.filter((check) => check.status === "warning").length,
    failed: checks.filter((check) => check.status === "failed").length,
  }
}

function extensionEcosystemHealthPaths(reportDir = defaultReadinessReportDir()) {
  const resolved = reportDir || defaultReadinessReportDir()
  return {
    reportDir: resolved,
    latestJsonPath: path.join(resolved, "extension-ecosystem-health-latest.json"),
    latestMarkdownPath: path.join(resolved, "extension-ecosystem-health-latest.md"),
  }
}

function saveExtensionEcosystemHealth(report, options = {}) {
  const paths = extensionEcosystemHealthPaths(options.reportDir)
  fs.mkdirSync(paths.reportDir, { recursive: true })
  fs.writeFileSync(paths.latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  fs.writeFileSync(paths.latestMarkdownPath, `${toExtensionEcosystemHealthMarkdown(report)}\n`, "utf8")
  return { ...paths, report }
}

function readLatestExtensionEcosystemHealth(options = {}) {
  const paths = extensionEcosystemHealthPaths(options.reportDir)
  if (!fs.existsSync(paths.latestJsonPath)) return { report: null, ...paths }
  return { report: JSON.parse(fs.readFileSync(paths.latestJsonPath, "utf8")), ...paths }
}

function toExtensionEcosystemHealthMarkdown(report) {
  const rows = (report.checks || []).map((check) =>
    `| ${check.title} | ${check.status} | ${String(check.detail || "").replace(/\|/g, "\\|")} | ${String(check.nextAction || "").replace(/\|/g, "\\|")} |`,
  )
  const matrixRows = (report.compatibilityMatrix?.extensions || []).map((extension) =>
    `| ${extension.rank} | ${extension.id} | ${extension.supportLevel} | ${extension.supportedContributionPoints.join(", ") || "-"} | ${extension.partialContributionPoints.join(", ") || "-"} | ${extension.unsupportedContributionPoints.join(", ") || "-"} |`,
  )
  return [
    "# 扩展生态健康报告",
    "",
    `- 状态: ${report.statusLabel || report.status}`,
    `- Ready: ${report.ready ? "YES" : "NO"}`,
    `- 搜索样本: ${report.query || "-"}`,
    "",
    "| 检查项 | 状态 | 详情 | 下一步 |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## Top N Contribution Compatibility Matrix",
    "",
    "| Rank | Extension | Support | Supported | Partial | Unsupported |",
    "| --- | --- | --- | --- | --- | --- |",
    ...matrixRows,
  ].join("\n")
}

module.exports = {
  buildExtensionEcosystemHealth,
  buildContributionCompatibilityMatrix,
  buildIconEvidence,
  extensionEcosystemHealthPaths,
  getDisplayName,
  getExtensionId,
  rankMarketplaceResults,
  readLatestExtensionEcosystemHealth,
  saveExtensionEcosystemHealth,
  toExtensionEcosystemHealthMarkdown,
}
