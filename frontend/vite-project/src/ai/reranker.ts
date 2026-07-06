import type { SearchResult } from "./vectorDB"

export interface RerankCandidate {
  id: string
  content: string
  score: number
  metadata?: Record<string, string>
}

export interface RerankedResult extends RerankCandidate {
  rerankScore: number
  signals: {
    vector: number
    lexical: number
    pathMatch: number
    symbolMatch: number
    llm?: number
  }
}

export interface RerankOptions {
  topN?: number
  weights?: Partial<RerankWeights>
  activeFile?: string
  llmScorer?: LlmScorer
}

export interface RerankWeights {
  vector: number
  lexical: number
  pathMatch: number
  symbolMatch: number
  llm: number
}

export type LlmScorer = (
  query: string,
  candidates: Array<{ id: string; content: string }>,
) => Promise<Map<string, number>>

const DEFAULT_WEIGHTS: RerankWeights = {
  vector: 0.4,
  lexical: 0.25,
  pathMatch: 0.1,
  symbolMatch: 0.1,
  llm: 0.15,
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "is", "are",
  "with", "on", "at", "by", "from", "as", "this", "that", "it", "be",
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w./-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
}

function jaccardOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const tok of setA) {
    if (setB.has(tok)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

function pathMatchScore(query: string, candidate: RerankCandidate, activeFile?: string): number {
  const filePath = candidate.metadata?.path || candidate.metadata?.filePath || candidate.id
  if (!filePath) return 0
  let score = 0
  const lowered = filePath.toLowerCase()
  const qTokens = tokenize(query)
  for (const tok of qTokens) {
    if (lowered.includes(tok)) score += 0.3
  }
  if (activeFile && filePath === activeFile) score += 0.5
  return Math.min(score, 1)
}

function symbolMatchScore(query: string, candidate: RerankCandidate): number {
  const symbols = candidate.metadata?.functions || candidate.metadata?.symbols || ""
  if (!symbols) return 0
  const symTokens = tokenize(symbols)
  if (!symTokens.length) return 0
  return jaccardOverlap(tokenize(query), symTokens)
}

function normalize(values: number[]): number[] {
  if (!values.length) return values
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  if (range < 1e-9) return values.map(() => 0)
  return values.map((v) => (v - min) / range)
}

export async function rerank(
  query: string,
  candidates: RerankCandidate[],
  options: RerankOptions = {},
): Promise<RerankedResult[]> {
  if (!candidates.length || !query.trim()) {
    return candidates.map((c) => ({
      ...c,
      rerankScore: c.score,
      signals: { vector: c.score, lexical: 0, pathMatch: 0, symbolMatch: 0 },
    }))
  }

  const weights: RerankWeights = { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) }
  const queryTokens = tokenize(query)

  const vectorScores = candidates.map((c) => c.score)
  const lexicalScores = candidates.map((c) => jaccardOverlap(queryTokens, tokenize(c.content)))
  const pathScores = candidates.map((c) => pathMatchScore(query, c, options.activeFile))
  const symbolScores = candidates.map((c) => symbolMatchScore(query, c))

  let llmScores: number[] = new Array(candidates.length).fill(0)
  if (options.llmScorer) {
    try {
      const scoreMap = await options.llmScorer(
        query,
        candidates.map((c) => ({ id: c.id, content: c.content.slice(0, 1200) })),
      )
      llmScores = candidates.map((c) => scoreMap.get(c.id) ?? 0)
    } catch {
      llmScores = new Array(candidates.length).fill(0)
    }
  }

  const v = normalize(vectorScores)
  const l = normalize(lexicalScores)
  const p = normalize(pathScores)
  const s = normalize(symbolScores)
  const m = normalize(llmScores)

  const merged: RerankedResult[] = candidates.map((c, i) => {
    const combined =
      weights.vector * v[i] +
      weights.lexical * l[i] +
      weights.pathMatch * p[i] +
      weights.symbolMatch * s[i] +
      weights.llm * m[i]
    return {
      ...c,
      rerankScore: combined,
      signals: {
        vector: v[i],
        lexical: l[i],
        pathMatch: p[i],
        symbolMatch: s[i],
        ...(options.llmScorer ? { llm: m[i] } : {}),
      },
    }
  })

  const topN = options.topN ?? 5
  return merged.sort((a, b) => b.rerankScore - a.rerankScore).slice(0, topN)
}

export function fromVectorResults(results: SearchResult[]): RerankCandidate[] {
  return results.map((r) => ({
    id: r.id,
    content: r.content,
    score: r.score,
    metadata: r.metadata,
  }))
}

/**
 * Build an LLM-backed cross-encoder scorer using a chat completion function.
 * The chat fn is expected to return raw text containing one score per line
 * (id\tscore, 0..1). Unknown/malformed lines are scored 0.
 */
export function buildLlmScorer(
  chat: (prompt: string) => Promise<string>,
): LlmScorer {
  return async (query, candidates) => {
    const numbered = candidates
      .map((c, i) => `[${i}] id=${c.id}\n${c.content}\n---`)
      .join("\n")
    const prompt = [
      "Rate how relevant each passage is to the query on a 0..1 scale.",
      "Reply with exactly one line per passage in the form: <id>\\t<score>.",
      "No prose, no extra text.",
      "",
      `Query: ${query}`,
      "",
      "Passages:",
      numbered,
    ].join("\n")

    const raw = await chat(prompt)
    const scores = new Map<string, number>()
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^([^\t]+)\t([0-9.]+)/)
      if (!match) continue
      const id = match[1].trim()
      const score = Number(match[2])
      if (Number.isFinite(score)) scores.set(id, Math.max(0, Math.min(1, score)))
    }
    return scores
  }
}
