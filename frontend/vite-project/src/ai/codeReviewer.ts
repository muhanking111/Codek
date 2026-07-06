import { reactive } from "vue"
import { chatSync } from "./llmClient"
import { getActiveProvider, getActiveModel } from "./aiProviders"
import { modelSettings } from "./models.js"

export type ReviewSeverity = "error" | "warning" | "info"
export type ReviewCategory = "security" | "performance" | "bug" | "style" | "architecture"

export interface ReviewIssue {
  id: string
  file: string
  line: number
  column: number
  message: string
  severity: ReviewSeverity
  category: ReviewCategory
  suggestion: string
}

const MAX_ISSUES_PER_FILE = 10

const REVIEW_CODE_PROMPT = `You are a senior code reviewer. Review the following code for security vulnerabilities, performance issues, bugs, code style problems, and architecture concerns.

Return ONLY a JSON array of objects with these exact fields:
- "line": number (1-based line number where the issue is found)
- "column": number (column number, use 1 if unknown)
- "message": string (concise description of the issue)
- "severity": one of "error", "warning", "info"
- "category": one of "security", "performance", "bug", "style", "architecture"
- "suggestion": string (specific fix recommendation)

Prioritize: security vulnerabilities first, then bugs, then performance. Include at most ${MAX_ISSUES_PER_FILE} issues.

Respond with ONLY the JSON array. No markdown, no explanation outside the JSON.`

const REVIEW_DIFF_PROMPT = `You are a senior code reviewer. Review the following git diff for security vulnerabilities, performance issues, bugs, code style problems, and architecture concerns.

Return ONLY a JSON array of objects with these exact fields:
- "line": number (line number within the diff context)
- "column": number (use 1 if unknown)
- "message": string (concise description)
- "severity": one of "error", "warning", "info"
- "category": one of "security", "performance", "bug", "style", "architecture"
- "suggestion": string (specific fix recommendation)

Focus on the changed lines. Include at most ${MAX_ISSUES_PER_FILE} issues.

Respond with ONLY the JSON array. No markdown, no explanation outside the JSON.`

interface ReviewState {
  issues: ReviewIssue[]
  isReviewing: boolean
  lastReviewAt: Date | null
}

export const reviewState = reactive<ReviewState>({
  issues: [],
  isReviewing: false,
  lastReviewAt: null,
})

function makeId(): string {
  return `rv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseAIResponse(raw: string): Array<Partial<ReviewIssue>> {
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

function hasActiveModel(): boolean {
  return Boolean(modelSettings.resolvedModel) || modelSettings.provider === "openai"
}

export async function reviewFile(
  fileContent: string,
  language: string,
  filename: string,
): Promise<ReviewIssue[]> {
  if (!hasActiveModel()) return []

  const codeHead = fileContent.slice(0, 8000)

  try {
    const response = await chatSync({
      provider: getActiveProvider(),
      model: getActiveModel(),
      messages: [
        { role: "system", content: REVIEW_CODE_PROMPT },
        {
          role: "user",
          content: `Language: ${language}\nFile: ${filename}\n\nCode:\n\`\`\`${language}\n${codeHead}\n\`\`\``,
        },
      ],
      stream: false,
    })

    const parsed = parseAIResponse(response)

    return parsed
      .filter(
        (item): item is ReviewIssue =>
          typeof item.line === "number" &&
          typeof item.message === "string" &&
          item.message.trim().length > 0,
      )
      .slice(0, MAX_ISSUES_PER_FILE)
      .map((item) => ({
        id: makeId(),
        file: filename,
        line: Math.max(1, item.line || 1),
        column: Math.max(1, item.column || 1),
        message: (item.message || "").trim(),
        severity: (["error", "warning", "info"].includes(item.severity || "")
          ? item.severity
          : "warning") as ReviewSeverity,
        category: (
          ["security", "performance", "bug", "style", "architecture"].includes(
            item.category || "",
          )
            ? item.category
            : "style"
        ) as ReviewCategory,
        suggestion: (item.suggestion || "").trim(),
      }))
  } catch {
    return []
  }
}

export async function reviewDiff(diff: string, filename = ""): Promise<ReviewIssue[]> {
  if (!hasActiveModel() || !diff.trim()) return []

  const diffHead = diff.slice(0, 8000)

  try {
    const response = await chatSync({
      provider: getActiveProvider(),
      model: getActiveModel(),
      messages: [
        { role: "system", content: REVIEW_DIFF_PROMPT },
        {
          role: "user",
          content: filename
            ? `File: ${filename}\n\nDiff:\n\`\`\`diff\n${diffHead}\n\`\`\``
            : `Diff:\n\`\`\`diff\n${diffHead}\n\`\`\``,
        },
      ],
      stream: false,
    })

    const parsed = parseAIResponse(response)

    return parsed
      .filter(
        (item): item is ReviewIssue =>
          typeof item.message === "string" && item.message.trim().length > 0,
      )
      .slice(0, MAX_ISSUES_PER_FILE)
      .map((item) => ({
        id: makeId(),
        file: filename,
        line: Math.max(1, item.line || 1),
        column: Math.max(1, item.column || 1),
        message: (item.message || "").trim(),
        severity: (["error", "warning", "info"].includes(item.severity || "")
          ? item.severity
          : "warning") as ReviewSeverity,
        category: (
          ["security", "performance", "bug", "style", "architecture"].includes(
            item.category || "",
          )
            ? item.category
            : "style"
        ) as ReviewCategory,
        suggestion: (item.suggestion || "").trim(),
      }))
  } catch {
    return []
  }
}

export async function runReview(
  source: { content: string; language: string; filename: string },
): Promise<ReviewIssue[]> {
  if (reviewState.isReviewing) return []

  reviewState.isReviewing = true

  try {
    const issues = await reviewFile(source.content, source.language, source.filename)

    reviewState.issues = [...issues, ...reviewState.issues].slice(0, 50)
    reviewState.lastReviewAt = new Date()

    return issues
  } finally {
    reviewState.isReviewing = false
  }
}

export function clearReviewIssues(): void {
  reviewState.issues.length = 0
}

export function clearReviewIssuesForFile(filename: string): void {
  let i = reviewState.issues.length
  while (i-- > 0) {
    if (reviewState.issues[i].file === filename) {
      reviewState.issues.splice(i, 1)
    }
  }
}
