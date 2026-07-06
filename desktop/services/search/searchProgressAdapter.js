/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code search progress contracts:
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\common\search.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\node\textSearchAdapter.ts
 *--------------------------------------------------------------------------------------------*/

function createSearchProgressReporter(onProgress) {
  const emit = typeof onProgress === "function" ? onProgress : null
  const startedAt = Date.now()
  const seenStages = new Set()

  const report = (stage, detail = {}) => {
    if (!emit || !stage || seenStages.has(stage)) return
    seenStages.add(stage)
    emit({
      type: "message",
      message: searchProgressMessage(stage, detail),
      stage,
      detail,
      elapsedMs: Date.now() - startedAt,
    })
  }

  return {
    start(detail) { report("search:start", detail) },
    provider(detail) { report("search:provider", detail) },
    providerError(detail) { report("search:provider-error", detail) },
    fallback(detail) { report("search:fallback", detail) },
    contents(detail) { report("search:contents", detail) },
    skipped(detail) { report("search:skipped-large-files", detail) },
    resultBatch(detail = {}) {
      if (!emit) return
      emit({
        type: "result",
        stage: "search:result-batch",
        detail,
        matches: Array.isArray(detail.matches) ? detail.matches : [],
        count: Number(detail.count || 0),
        total: Number(detail.total || 0),
        elapsedMs: Date.now() - startedAt,
      })
    },
    done(detail) { report("search:done", detail) },
    cancelled(detail) { report("search:cancelled", detail) },
  }
}

function searchProgressMessage(stage, detail = {}) {
  switch (stage) {
    case "search:start":
      return "Searching workspace"
    case "search:provider":
      return detail.engine === "ripgrep" ? "Searching with ripgrep" : "Searching with file provider"
    case "search:provider-error":
      return "Search provider failed"
    case "search:fallback":
      return "Falling back to workspace file scan"
    case "search:contents":
      return "Preparing search previews"
    case "search:skipped-large-files":
      return "Counting skipped large files"
    case "search:done":
      return "Search complete"
    case "search:cancelled":
      return "Search cancelled"
    default:
      return String(stage || "Search")
  }
}

module.exports = {
  createSearchProgressReporter,
  searchProgressMessage,
}
