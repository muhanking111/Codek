import { buildIndex, searchWithBackend } from "./indexer"
import { rerank } from "./reranker.ts"

async function applyRerank(query, results, options) {
  if (!options.rerank || !results.length || !query.trim()) return results
  const candidates = results.map((r) => ({
    id: r.path,
    content: r.snippet || "",
    score: r.score || 0,
    metadata: {
      path: r.path,
      functions: Array.isArray(r.symbols) ? r.symbols.join(",") : "",
    },
  }))
  try {
    const reranked = await rerank(query, candidates, {
      topN: options.maxResults || 4,
      activeFile: options.activeFile,
      llmScorer: options.llmScorer,
    })
    const byPath = new Map(results.map((r) => [r.path, r]))
    return reranked
      .map((rr) => {
        const orig = byPath.get(rr.id)
        if (!orig) return null
        return { ...orig, score: rr.rerankScore, signals: rr.signals }
      })
      .filter(Boolean)
  } catch {
    return results
  }
}

function tokenize(query) {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/i)
    .map((term) => term.trim())
    .filter(Boolean)
}

function scoreEntry(entry, terms, activeFile) {
  let score = entry.path === activeFile ? 8 : 0
  const lowerPath = entry.path.toLowerCase()
  const functions = Array.isArray(entry.functions) ? entry.functions : []
  const variables = Array.isArray(entry.variables) ? entry.variables : []
  const imports = Array.isArray(entry.imports) ? entry.imports : []
  const lowerFunctions = functions.join(" ").toLowerCase()
  const lowerVariables = variables.join(" ").toLowerCase()
  const lowerImports = imports.join(" ").toLowerCase()
  const lowerContent = entry.content.toLowerCase()

  for (const term of terms) {
    if (lowerPath.includes(term)) score += 6
    if (lowerFunctions.includes(term)) score += 5
    if (lowerVariables.includes(term)) score += 2
    if (lowerImports.includes(term)) score += 2
    if (lowerContent.includes(term)) score += 3
  }

  return score
}

function buildSnippet(entry, terms) {
  const lowerContent = entry.content.toLowerCase()

  for (const term of terms) {
    const index = lowerContent.indexOf(term)
    if (index >= 0) {
      const start = Math.max(0, index - 120)
      const end = Math.min(entry.content.length, index + term.length + 200)
      return entry.content.slice(start, end).replace(/\s+/g, " ").trim()
    }
  }

  return entry.preview.replace(/\s+/g, " ").trim()
}

async function searchWithLocalIndex(query, options) {
  const index = options.index || (await buildIndex(options))
  const terms = tokenize(query)
  const maxResults = options.maxResults || 4

  if (!index.length) return []

  if (!terms.length) {
    return index
      .filter((entry) => entry.path === options.activeFile)
      .slice(0, maxResults)
      .map((entry) => ({
        path: entry.path,
        score: 1,
        snippet: buildSnippet(entry, []),
        symbols: (Array.isArray(entry.functions) ? entry.functions : []).slice(0, 6),
      }))
  }

  return index
    .map((entry) => ({
      path: entry.path,
      score: scoreEntry(entry, terms, options.activeFile),
      snippet: buildSnippet(entry, terms),
      symbols: (Array.isArray(entry.functions) ? entry.functions : []).slice(0, 6),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults)
}

export async function retrieveRelevantFiles(query, options = {}) {
  const projectRoot = options.projectRoot || ""
  const maxResults = options.maxResults || 4

  const fetchCount = options.rerank ? Math.max(maxResults * 5, 20) : maxResults

  if (projectRoot && query.trim()) {
    try {
      const backendResults = await searchWithBackend(query, projectRoot, fetchCount)
      if (backendResults && backendResults.length > 0) {
        const mapped = backendResults.map((r) => ({
          path: r.filePath || r.path,
          score: typeof r.rank === "number" ? 1 / (1 + Math.abs(r.rank)) : 1,
          snippet: (r.contentPreview || "").slice(0, 320),
          symbols: (r.functions || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6),
        }))
        return applyRerank(query, mapped, options)
      }
    } catch {
      // fall back to local index
    }
  }

  const localResults = await searchWithLocalIndex(
    query,
    options.rerank ? { ...options, maxResults: fetchCount } : options,
  )
  return applyRerank(query, localResults, options)
}
