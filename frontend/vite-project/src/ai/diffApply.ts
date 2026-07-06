import * as ws from "../workspace/manager.js"

type CodeBlock = {
  language: string
  content: string
  filepath?: string
  startLine?: number
  endLine?: number
}

type ApplyResult = {
  success: boolean
  filepath: string
  oldContent?: string
  newContent: string
  error?: string
}

const COMMAND_LANGUAGES = new Set([
  "bash",
  "bat",
  "cmd",
  "console",
  "fish",
  "powershell",
  "ps1",
  "pwsh",
  "shell",
  "sh",
  "terminal",
  "zsh",
])
const FILE_HINT_RE = /(\/\/|#|<!--)\s*[Ff]ile:\s*(.+)$/m
const LANG_PATH_RE = /^(\w+):(.+)$/
const FILE_EXTENSION_BY_LANGUAGE: Record<string, string[]> = {
  css: [".css"],
  html: [".html"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  js: [".js", ".jsx", ".mjs", ".cjs"],
  json: [".json"],
  jsx: [".jsx", ".js"],
  markdown: [".md", ".markdown"],
  md: [".md", ".markdown"],
  python: [".py"],
  py: [".py"],
  ts: [".ts", ".tsx"],
  tsx: [".tsx", ".ts"],
  typescript: [".ts", ".tsx"],
  vue: [".vue"],
  yaml: [".yaml", ".yml"],
  yml: [".yml", ".yaml"],
}

function normalizeLanguage(language?: string): string {
  return String(language || "")
    .trim()
    .toLowerCase()
}

function parseCodeBlocks(text: string): CodeBlock[] {
  if (!text) return []

  const blocks: CodeBlock[] = []
  const codeBlockRe = /```(\S*)\s*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null

  while ((match = codeBlockRe.exec(text)) !== null) {
    const rawLang = match[1] || ""
    const content = match[2]
    const block: CodeBlock = { language: rawLang, content }

    const langPathMatch = rawLang.match(LANG_PATH_RE)
    if (langPathMatch) {
      block.language = langPathMatch[1]
      block.filepath = langPathMatch[2]
    } else if (rawLang && rawLang.includes("/") && !rawLang.includes(" ")) {
      block.filepath = rawLang
      block.language = ""
    }

    const hint = getFilepathHint(content)
    if (hint && !block.filepath) {
      block.filepath = hint
    }

    blocks.push(block)
  }

  return blocks
}

export interface FilepathHintOptions {
  /** Currently open files in the editor (full relative paths). */
  openFiles?: string[]
  /** Files recently read or modified in the conversation (relative paths). */
  recentFiles?: string[]
}

// Common project directory patterns for inference
const COMMON_DIR_PATTERNS: Array<{ re: RegExp; dir: string }> = [
  { re: /\.(vue|ts|tsx|js|jsx)$/i, dir: "src/" },
  { re: /\.(css|scss|less)$/i, dir: "src/styles/" },
  { re: /\.(test|spec)\.(ts|js|tsx)$/i, dir: "tests/" },
  { re: /\.(py)$/i, dir: "src/" },
  { re: /\.(java)$/i, dir: "src/" },
  { re: /\.(json)$/i, dir: "" },
  { re: /\.(md)$/i, dir: "" },
  { re: /\.(yaml|yml)$/i, dir: "" },
  { re: /^Dockerfile/i, dir: "" },
  { re: /^docker-compose/i, dir: "" },
  { re: /\.(go)$/i, dir: "" },
  { re: /\.(rs)$/i, dir: "src/" },
]

function inferFilepathFromContent(content: string): string | null {
  const lines = content.split("\n")
  // Look for import/require patterns to infer module path
  for (const line of lines.slice(0, 5)) {
    // Vue SFC
    if (
      line.includes("<template>") ||
      (content.includes("export default {") && content.includes("components:"))
    ) {
      return null // too generic, let context decide
    }
  }

  // Guess filename from content patterns
  const firstLine = lines[0]?.trim() || ""
  if (
    firstLine.startsWith("import") ||
    firstLine.startsWith("const ") ||
    firstLine.startsWith("function ") ||
    firstLine.startsWith("export ")
  ) {
    // Could be any .ts/.js file — need context to decide
    return null
  }

  return null
}

function getFilepathHint(content: string, options?: FilepathHintOptions): string | null {
  // Strategy 1: Check for explicit filepath annotations in the code block
  const match = content.match(FILE_HINT_RE)
  if (match) {
    return match[2].trim()
  }

  const lines = content.split("\n")
  for (const line of lines.slice(0, 3)) {
    const trimmed = line.trim()
    if (
      trimmed.startsWith("// File:") ||
      trimmed.startsWith("# File:") ||
      trimmed.startsWith("<!-- File:")
    ) {
      const extracted = trimmed
        .replace(/^(\/\/|#|<!--)\s*File:\s*/, "")
        .replace(/\s*-->$/, "")
        .trim()
      if (extracted) return extracted
    }
  }

  // Strategy 2: Match against open files
  // Check if the content looks like an update to a currently open file
  if (options?.openFiles?.length) {
    const normalizedOpenFiles = options.openFiles.filter(Boolean)
    if (normalizedOpenFiles.length === 1) {
      return normalizedOpenFiles[0]
    }

    // Score open files by content similarity (first line match, language match)
    const langHint = lines[0]?.trim() || ""
    for (const openFile of normalizedOpenFiles) {
      const fileName = openFile.split("/").pop() || openFile.split("\\").pop() || ""
      // If the content has a class/function/component name from the file
      const baseName = fileName.replace(/\.\w+$/, "")
      if (baseName && baseName.length > 2 && langHint.includes(baseName)) {
        return openFile
      }
    }
  }

  // Strategy 3: Check recent files from conversation context
  if (options?.recentFiles?.length) {
    // Return the most recently modified file that matches the language
    return options.recentFiles[0]
  }

  // Strategy 4: Try to match filename in content against common project directories
  const inferred = inferFilepathFromContent(content)
  if (inferred) return inferred

  return null
}

function getFilepathHintForBlock(block: CodeBlock, options?: FilepathHintOptions): string | null {
  if (block.filepath) return block.filepath

  const explicit = getFilepathHint(block.content, options)
  if (explicit) return explicit

  const extensions = FILE_EXTENSION_BY_LANGUAGE[normalizeLanguage(block.language)] || []
  const openFiles = options?.openFiles?.filter(Boolean) || []
  if (extensions.length && openFiles.length) {
    const matches = openFiles.filter((file) =>
      extensions.some((ext) => file.toLowerCase().endsWith(ext)),
    )
    if (matches.length === 1) return matches[0]
  }

  return null
}

function isApplicableCodeBlock(
  block: Pick<CodeBlock, "language" | "content" | "filepath">,
): boolean {
  const language = normalizeLanguage(block.language)
  if (block.filepath) return true
  if (COMMAND_LANGUAGES.has(language)) return false

  const content = String(block.content || "").trim()
  if (!content) return false
  if (/^(cat|cd|cp|curl|del|dir|echo|git|ls|mkdir|mv|npm|pnpm|rm|yarn)\b/im.test(content)) {
    return false
  }

  return true
}

function resolveTargetPath(block: CodeBlock, projectRoot: string): string | null {
  if (block.filepath) {
    if (block.filepath.startsWith("/") || /^[A-Za-z]:/.test(block.filepath)) {
      return block.filepath
    }
    const root = (projectRoot || "").replace(/\\/g, "/").replace(/\/+$/, "")
    return root ? `${root}/${block.filepath.replace(/^\/+/, "")}` : block.filepath
  }
  return null
}

async function applyCodeBlock(block: CodeBlock, projectRoot: string): Promise<ApplyResult> {
  const targetRelPath = block.filepath || ""
  const targetAbsPath = resolveTargetPath(block, projectRoot)

  if (!targetAbsPath) {
    return {
      success: false,
      filepath: "",
      newContent: block.content,
      error:
        "No target file path found. Add a filepath hint like ```language:path/file or // File: path/file.",
    }
  }

  const relativePath = ws.getRelativePath(targetAbsPath)
  const existingContent = ws.getFile(relativePath)

  const newContent = stripTrailingNewline(block.content)

  try {
    if (typeof existingContent !== "string") {
      await ws.createFile(relativePath, newContent)
      return { success: true, filepath: targetRelPath, oldContent: undefined, newContent }
    }

    const merged = simpleMerge(existingContent, newContent)
    ws.updateFile(relativePath, merged, { dirty: true, external: false })
    return {
      success: true,
      filepath: targetRelPath,
      oldContent: existingContent,
      newContent: merged,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, filepath: targetRelPath, newContent, error: message }
  }
}

function stripTrailingNewline(content: string): string {
  return content.replace(/\n+$/, "")
}

function simpleMerge(existing: string, replacement: string): string {
  const existingLines = existing.split("\n")
  const replacementLines = replacement.split("\n")

  if (replacementLines.length <= 1) {
    return replacement
  }

  const firstLine = replacementLines[0].trim()
  const lastLine = replacementLines[replacementLines.length - 1].trim()

  let startIdx = -1
  for (let i = 0; i < existingLines.length; i++) {
    if (existingLines[i].trim() === firstLine) {
      startIdx = i
      break
    }
  }

  if (startIdx < 0) {
    return replacement
  }

  let endIdx = startIdx + replacementLines.length
  if (endIdx <= existingLines.length) {
    const matchEnd = existingLines[endIdx - 1]?.trim() === lastLine
    if (!matchEnd) {
      for (let i = endIdx; i < existingLines.length; i++) {
        if (existingLines[i].trim() === lastLine) {
          endIdx = i + 1
          break
        }
      }
    }
  } else {
    endIdx = existingLines.length
  }

  const before = existingLines.slice(0, startIdx)
  const after = existingLines.slice(endIdx)
  return [...before, ...replacementLines, ...after].join("\n")
}

async function applyAllCodeBlocks(
  blocks: CodeBlock[],
  projectRoot: string,
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = []
  for (const block of blocks) {
    const result = await applyCodeBlock(block, projectRoot)
    results.push(result)
  }
  return results
}

async function undoApply(result: ApplyResult): Promise<boolean> {
  if (!result.success || typeof result.oldContent !== "string") {
    return false
  }

  const relativePath = ws.getRelativePath(result.filepath)
  const current = ws.getFile(relativePath)

  if (typeof current !== "string") {
    return false
  }

  ws.updateFile(relativePath, result.oldContent, { dirty: true, external: false })
  return true
}

export type { CodeBlock, ApplyResult }
export {
  parseCodeBlocks,
  applyCodeBlock,
  applyAllCodeBlocks,
  undoApply,
  getFilepathHint,
  getFilepathHintForBlock,
  isApplicableCodeBlock,
}
