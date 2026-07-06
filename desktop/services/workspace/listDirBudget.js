const DEFAULT_LIST_DIR_ENTRY_BUDGET = 600

function resolveListDirEntryBudget({
  totalEntries,
  options = {},
  meta = null,
  profileEntryBudget,
  defaultEntryBudget = DEFAULT_LIST_DIR_ENTRY_BUDGET,
} = {}) {
  const total = Math.max(0, Math.floor(Number(totalEntries || 0)))
  const source = String(meta?.source || options?.source || "renderer")
  const profileBudget = positiveIntegerOr(profileEntryBudget, defaultEntryBudget)
  const budget = Math.max(1, profileBudget === Infinity ? total : profileBudget)
  const hasExplicitMax = Object.prototype.hasOwnProperty.call(options, "maxEntries") && options.maxEntries != null

  if (isRendererExplorerSource(source)) {
    return {
      source,
      maxEntries: total,
      truncated: false,
      appendLimitSentinel: false,
    }
  }

  const requestedBudget = hasExplicitMax
    ? Math.min(positiveIntegerOr(options.maxEntries, budget), budget)
    : budget
  const maxEntries = Math.min(total, Math.max(0, requestedBudget))
  const truncated = total > maxEntries
  return {
    source,
    maxEntries,
    truncated,
    appendLimitSentinel: truncated && !isRendererExplorerSource(source),
  }
}

function isRendererExplorerSource(source) {
  return source === "renderer" || source === "explorer" || source === "ui"
}

function positiveIntegerOr(value, fallback) {
  if (value === Infinity) return Infinity
  const numeric = Math.floor(Number(value))
  if (Number.isFinite(numeric) && numeric > 0) return numeric
  return fallback
}

module.exports = {
  DEFAULT_LIST_DIR_ENTRY_BUDGET,
  resolveListDirEntryBudget,
}
