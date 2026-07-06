import { chatSync } from "./llmClient"
import { getActiveProvider, getActiveModel } from "./aiProviders"
import { modelSettings } from "./models.js"
import { rewriteState, type RewriteCategory, type RewriteSeverity, type RewriteSuggestion } from "./smartRewriteState"

const MAX_SUGGESTIONS_PER_FILE = 3
const ANALYSIS_DEBOUNCE_MS = 500

const SMART_REWRITE_PROMPT = `You are a senior code reviewer. Analyze the given code and suggest up to ${MAX_SUGGESTIONS_PER_FILE} specific improvements.

Return ONLY a JSON array of objects with these exact fields:
- "startLine": number (1-based line number in the original code where the change starts)
- "endLine": number (1-based line number where the change ends)
- "suggestedCode": string (the improved replacement code)
- "description": string (brief explanation of the improvement)
- "category": one of "performance", "readability", "safety", "modern", "bug"
- "severity": one of "info", "warning", "critical"

Focus on:
- "performance": redundant loops, inefficient operations, missing memoization
- "readability": unclear variable names, overly complex expressions, missing destructuring
- "safety": potential null references, unsafe type assertions, SQL injection patterns
- "modern": outdated API usage replaced with modern equivalents (e.g., var→const, for→forEach)
- "bug": potential off-by-one, incorrect comparisons, unhandled edge cases

Respond with ONLY the JSON array, no markdown, no explanation outside the JSON.`

const analysisQueue: Array<{ content: string; language: string; filename: string }> = []
const dismissedIds = new Set<string>()
let analysisTimer: ReturnType<typeof setTimeout> | null = null

function makeId(): string {
  return `rw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function extractLineRange(content: string, startLine: number, endLine: number): string {
  const lines = content.split("\n")
  return lines.slice(Math.max(0, startLine - 1), endLine).join("\n")
}

function parseAiResponse(raw: string): Array<Partial<RewriteSuggestion>> {
  const trimmed = raw.trim()
  if (!trimmed) return []

  const jsonMatch = trimmed.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []

  try {
    const parsed = JSON.parse(jsonMatch[0])
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

export async function analyzeForRewrites(
  fileContent: string,
  language: string,
  filename: string,
): Promise<RewriteSuggestion[]> {
  if (!modelSettings.resolvedModel && modelSettings.provider !== "openai") return []

  const codeHead = fileContent.slice(0, 6000)

  try {
    const response = await chatSync({
      provider: getActiveProvider(),
      model: getActiveModel(),
      messages: [
        { role: "system", content: SMART_REWRITE_PROMPT },
        {
          role: "user",
          content: `Language: ${language}\nFile: ${filename}\n\nCode:\n\`\`\`${language}\n${codeHead}\n\`\`\``,
        },
      ],
      stream: false,
    })

    const parsed = parseAiResponse(response)

    return parsed
      .filter(
        (item): item is RewriteSuggestion =>
          typeof item.startLine === "number" &&
          typeof item.endLine === "number" &&
          typeof item.suggestedCode === "string" &&
          item.suggestedCode.trim().length > 0 &&
          typeof item.description === "string" &&
          typeof item.category === "string" &&
          typeof item.severity === "string",
      )
      .slice(0, MAX_SUGGESTIONS_PER_FILE)
      .map((item) => {
        const startLine = Math.max(1, item.startLine)
        const endLine = Math.max(startLine, item.endLine)
        return {
          id: makeId(),
          file: filename,
          startLine,
          endLine,
          originalCode: extractLineRange(fileContent, startLine, endLine),
          suggestedCode: item.suggestedCode.trim(),
          description: item.description,
          category: item.category as RewriteCategory,
          severity: item.severity as RewriteSeverity,
        }
      })
      .filter((item) => item.originalCode !== item.suggestedCode)
  } catch {
    return []
  }
}

export function scanForRewrites(fileContent: string, language: string, filename: string): void {
  analysisQueue.push({ content: fileContent, language, filename })
  rewriteState.queueSize = analysisQueue.length

  if (analysisTimer) clearTimeout(analysisTimer)
  analysisTimer = setTimeout(() => {
    void processQueue()
  }, ANALYSIS_DEBOUNCE_MS)
}

async function processQueue(): Promise<void> {
  if (rewriteState.isScanning || analysisQueue.length === 0) return

  rewriteState.isScanning = true

  while (analysisQueue.length > 0) {
    const item = analysisQueue.shift()
    if (!item) break

    rewriteState.queueSize = analysisQueue.length

    const suggestions = await analyzeForRewrites(item.content, item.language, item.filename)

    for (const suggestion of suggestions) {
      if (dismissedIds.has(suggestion.id)) continue
      const existingIdx = rewriteState.suggestions.findIndex(
        (s) =>
          s.file === suggestion.file &&
          s.startLine === suggestion.startLine &&
          s.endLine === suggestion.endLine,
      )
      if (existingIdx >= 0) {
        rewriteState.suggestions[existingIdx] = suggestion
      } else {
        rewriteState.suggestions.unshift(suggestion)
      }
    }

    if (rewriteState.suggestions.length > 20) {
      rewriteState.suggestions.length = 20
    }
  }

  rewriteState.isScanning = false
  rewriteState.queueSize = 0
}

export function applyRewrite(
  suggestion: RewriteSuggestion,
  editorValue: string,
): string {
  const lines = editorValue.split("\n")
  const startIdx = Math.max(0, suggestion.startLine - 1)
  const endIdx = Math.min(lines.length, suggestion.endLine)
  const beforeLines = lines.slice(0, startIdx)
  const afterLines = lines.slice(endIdx)
  const suggestionLines = suggestion.suggestedCode.split("\n")

  return [...beforeLines, ...suggestionLines, ...afterLines].join("\n")
}

export function dismissRewrite(id: string): void {
  dismissedIds.add(id)
  const idx = rewriteState.suggestions.findIndex((s) => s.id === id)
  if (idx >= 0) {
    rewriteState.suggestions.splice(idx, 1)
  }
}

export function clearAllRewrites(): void {
  rewriteState.suggestions.length = 0
}

export function clearRewritesForFile(filename: string): void {
  let i = rewriteState.suggestions.length
  while (i-- > 0) {
    if (rewriteState.suggestions[i].file === filename) {
      rewriteState.suggestions.splice(i, 1)
    }
  }
}
