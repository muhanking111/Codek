/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code raw search process boundary:
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\node\rawSearchService.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\services\search\node\fileSearch.ts
 *--------------------------------------------------------------------------------------------*/

const { pathHasIgnoredSegment } = require("../workspace/workspaceScaleProfile")
const { createSearchQueryPlan } = require("./searchQueryAdapter")
const { SearchProviderType } = require("./searchProviderRegistry")
const { runRipgrepFileSearch } = require("./ripgrepFileSearchAdapter")
const { runRipgrepSearch } = require("./ripgrepSearchAdapter")

const controllers = new Map()

process.on("message", async (message) => {
  if (!message || typeof message !== "object") return
  if (message.type === "cancel") {
    controllers.get(message.id)?.abort()
    return
  }
  if (message.type !== "search") return

  const controller = new AbortController()
  controllers.set(message.id, controller)
  try {
    const result = await runWorkerSearch(message.searchType, message.request || {}, controller.signal)
    process.send?.({ type: "result", id: message.id, result })
  } catch (error) {
    process.send?.({
      type: "error",
      id: message.id,
      error: {
        name: error?.name || "Error",
        message: error?.message || String(error || "Search failed"),
        stack: error?.stack,
      },
    })
  } finally {
    controllers.delete(message.id)
  }
})

async function runWorkerSearch(type, request, signal) {
  const queryOptions = request.queryOptions || {}
  const queryPlan = createSearchQueryPlan({
    query: queryOptions.query ?? request.query ?? request.filePattern ?? "",
    include: queryOptions.include,
    exclude: queryOptions.exclude,
    regex: queryOptions.regex === true,
    caseSensitive: queryOptions.caseSensitive === true,
    wholeWord: queryOptions.wholeWord === true,
    maxResults: queryOptions.maxResults ?? request.maxResults,
    maxVisitedFiles: queryOptions.maxVisitedFiles,
    compileTextPattern: type !== SearchProviderType.file,
  })
  if (queryPlan.error) throw queryPlan.error

  const workerRequest = {
    ...request,
    queryPlan,
    signal,
  }
  delete workerRequest.queryOptions
  delete workerRequest.shouldIncludePathMode

  if (request.shouldIncludePathMode === "defaultIgnoredSegments") {
    workerRequest.shouldIncludePath = (relativePath) => !pathHasIgnoredSegment(relativePath)
  }

  if (type === SearchProviderType.file) return runRipgrepFileSearch(workerRequest)
  if (type === SearchProviderType.text) return runRipgrepSearch(workerRequest)
  throw new Error(`Unknown SearchProviderType: ${type}`)
}
