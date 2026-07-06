// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\base\common\filters.ts
// - D:\SourceMirror\vscode\src\vs\platform\commands\common\commands.ts
//
// Codek keeps its command registry and localized titles. This adapter replaces
// the old local subsequence scorer with VS Code-style command palette matching:
// exact/prefix hits first, then word-boundary/acronym/fuzzy hits.

export interface CommandScoringInput {
  id: string
  title: string
  category?: string
}

export interface CommandScoringResult {
  score: number
  titleIndices: number[]
}

export function scoreCommandPaletteMatch(command: CommandScoringInput, query: string): number {
  return scoreCommandPaletteMatchWithHighlights(command, query).score
}

export function scoreCommandPaletteMatchWithHighlights(command: CommandScoringInput, query: string): CommandScoringResult {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return { score: 0, titleIndices: [] }

  const id = command.id.toLowerCase()
  const title = command.title.toLowerCase()
  const category = (command.category || "").toLowerCase()
  const target = `${command.title} ${command.id} ${command.category || ""}`

  if (title === normalizedQuery) return { score: 1000, titleIndices: range(0, command.title.length) }
  if (id === normalizedQuery) return { score: 1000, titleIndices: [] }
  if (title.startsWith(normalizedQuery)) return { score: 850, titleIndices: range(0, normalizedQuery.length) }
  if (id.startsWith(normalizedQuery)) return { score: 850, titleIndices: [] }
  if (category === normalizedQuery) return { score: 700, titleIndices: [] }

  const wordScore = scoreWordBoundaryMatch(normalizedQuery, target)
  if (wordScore > 0) return { score: wordScore, titleIndices: collectSubsequenceIndices(title, normalizedQuery) }
  const fuzzyScore = scoreFuzzySubsequence(normalizedQuery, target)
  return { score: fuzzyScore, titleIndices: collectSubsequenceIndices(title, normalizedQuery) }
}

function scoreWordBoundaryMatch(query: string, target: string): number {
  const words = splitWords(target)
  if (!words.length) return 0
  const acronym = words.map((word) => word[0] || "").join("").toLowerCase()
  if (acronym.startsWith(query)) return 650 + query.length * 8

  const compact = words.join(" ").toLowerCase()
  if (compact.includes(query)) return 560 + query.length * 4

  let queryIndex = 0
  for (const word of words) {
    if (queryIndex >= query.length) break
    if (word.toLowerCase().startsWith(query[queryIndex])) queryIndex += 1
  }
  return queryIndex === query.length ? 520 + query.length * 3 : 0
}

function scoreFuzzySubsequence(query: string, target: string): number {
  const source = target.toLowerCase()
  let queryIndex = 0
  let first = -1
  let consecutive = 0
  let bestConsecutive = 0
  let boundaryHits = 0
  for (let index = 0; index < source.length && queryIndex < query.length; index += 1) {
    if (source[index] === query[queryIndex]) {
      if (first === -1) first = index
      if (isSeparator(source[index - 1]) || index === 0) boundaryHits += 1
      consecutive += 1
      bestConsecutive = Math.max(bestConsecutive, consecutive)
      queryIndex += 1
    } else {
      consecutive = 0
    }
  }
  if (queryIndex < query.length) return 0
  return 400 + bestConsecutive * 20 + boundaryHits * 10 - Math.max(first, 0)
}

function splitWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s._:/$\\\-()[\]{}<>"']+/)
    .map((word) => word.trim())
    .filter(Boolean)
}

function isSeparator(value: string | undefined): boolean {
  return !value || /[\s._:/$\\\-()[\]{}<>"']/.test(value)
}

function collectSubsequenceIndices(target: string, query: string): number[] {
  const indices: number[] = []
  let queryIndex = 0
  for (let index = 0; index < target.length && queryIndex < query.length; index += 1) {
    if (target[index].toLowerCase() === query[queryIndex]) {
      indices.push(index)
      queryIndex += 1
    }
  }
  return queryIndex === query.length ? indices : []
}

function range(start: number, end: number): number[] {
  const result: number[] = []
  for (let index = start; index < end; index += 1) result.push(index)
  return result
}
