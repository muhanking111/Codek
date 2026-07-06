// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\base\common\filters.ts
// - D:\SourceMirror\vscode\src\vs\base\common\fuzzyScorer.ts
// - D:\SourceMirror\vscode\src\vs\workbench\browser\parts\editor\editorQuickAccess.ts

export interface FileQuickAccessItem {
  path: string
  name?: string
}

export interface FileQuickAccessMatch<TFile extends FileQuickAccessItem> {
  file: TFile
  score: number
  indices: number[]
}

export function scoreFileQuickAccess(path: string, query: string): { score: number; indices: number[] } {
  const target = normalizePath(path)
  const normalizedQuery = normalizePath(query).trim()
  if (!normalizedQuery) return { score: 0, indices: [] }

  const lowerTarget = target.toLowerCase()
  const lowerQuery = normalizedQuery.toLowerCase()
  const basenameStart = Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\")) + 1
  const lowerBasename = lowerTarget.slice(basenameStart)

  if (lowerTarget === lowerQuery) return { score: 1200, indices: range(0, target.length) }
  if (lowerBasename === lowerQuery) return { score: 1100, indices: range(basenameStart, target.length) }
  if (lowerBasename.startsWith(lowerQuery)) return { score: 950, indices: range(basenameStart, basenameStart + lowerQuery.length) }
  if (lowerTarget.startsWith(lowerQuery)) return { score: 850, indices: range(0, lowerQuery.length) }

  const result = fuzzySubsequence(lowerTarget, lowerQuery)
  if (!result.indices.length) return { score: 0, indices: [] }

  const basenameHits = result.indices.filter((index) => index >= basenameStart).length
  const boundaryHits = result.indices.filter((index) => index === 0 || isPathBoundary(lowerTarget[index - 1])).length
  return {
    score: 500 + result.bestConsecutive * 25 + basenameHits * 12 + boundaryHits * 18 - result.firstIndex,
    indices: result.indices,
  }
}

export function filterFileQuickAccess<TFile extends FileQuickAccessItem>(
  files: readonly TFile[],
  query: string,
  limit = 100,
): Array<FileQuickAccessMatch<TFile>> {
  return files
    .map((file) => ({ file, ...scoreFileQuickAccess(file.path, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.file.path.localeCompare(right.file.path))
    .slice(0, limit)
}

function fuzzySubsequence(target: string, query: string): { indices: number[]; bestConsecutive: number; firstIndex: number } {
  let queryIndex = 0
  let consecutive = 0
  let bestConsecutive = 0
  let firstIndex = -1
  const indices: number[] = []
  for (let index = 0; index < target.length && queryIndex < query.length; index += 1) {
    if (target[index] === query[queryIndex]) {
      if (firstIndex === -1) firstIndex = index
      consecutive += 1
      bestConsecutive = Math.max(bestConsecutive, consecutive)
      indices.push(index)
      queryIndex += 1
    } else {
      consecutive = 0
    }
  }
  return queryIndex === query.length ? { indices, bestConsecutive, firstIndex: Math.max(0, firstIndex) } : { indices: [], bestConsecutive: 0, firstIndex: 0 }
}

function normalizePath(path: string): string {
  return String(path || "").replace(/\\/g, "/")
}

function isPathBoundary(char: string | undefined): boolean {
  return !char || /[\s._\-/$\\]/.test(char)
}

function range(start: number, end: number): number[] {
  const result: number[] = []
  for (let index = start; index < end; index += 1) result.push(index)
  return result
}
