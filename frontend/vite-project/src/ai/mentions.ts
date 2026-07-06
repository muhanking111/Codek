import { reactive } from "vue"
import { workspace, readProjectFile, normalizeRelativePath } from "../workspace/manager.js"
import { discoverWorkspaceFiles, knownWorkspaceFiles } from "../workspace/fileDiscovery"
import { gitState } from "../components/gitState"
import { problemState } from "../components/problemState"
import { debugState } from "../components/debugState"
import { getProjectSymbols } from "../workspace/analysisState"
import { getAllTerminals } from "../terminal/terminalManager"
import { searchWeb } from "./webSearch"

type MentionType =
  | "file"
  | "folder"
  | "code"
  | "git"
  | "web"
  | "docs"
  | "notepad"
  | "symbol"
  | "problem"
  | "task"
  | "terminal"
  | "workspace"

const DOC_SITES = [
  "vuejs.org", "react.dev", "developer.mozilla.org",
  "typescriptlang.org", "docs.python.org", "doc.rust-lang.org",
  "docs.rs", "pkg.go.dev", "nodejs.org",
]

export interface Mention {
  id: string
  type: MentionType
  label: string
  detail?: string
  icon?: string
}

interface MentionRegistry {
  mentions: Mention[]
}

const ICON_MAP: Record<MentionType, string> = {
  file: "\u{1F4C4}",
  folder: "\u{1F4C1}",
  code: "\u{1F4DD}",
  git: "\u{1F500}",
  web: "\u{1F310}",
  docs: "\u{1F4DA}",
  notepad: "\u{1F4CB}",
  symbol: "S",
  problem: "!",
  task: ">",
  terminal: "$",
  workspace: "W",
}

const MENTION_RE = /@([^\s@]*)/g
const MAX_MENTION_RESULTS = 20
const FILE_CONTENT_LIMIT = 8000

function fuzzyScore(text: string, query: string): number {
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()

  if (lowerText === lowerQuery) return 1000
  if (lowerText.startsWith(lowerQuery)) return 800
  if (lowerText.includes(lowerQuery)) return 500

  let qi = 0
  let consecutive = 0
  let maxConsecutive = 0
  let firstMatchPos = -1

  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti += 1) {
    if (lowerText[ti] === lowerQuery[qi]) {
      if (firstMatchPos === -1) firstMatchPos = ti
      consecutive += 1
      if (consecutive > maxConsecutive) maxConsecutive = consecutive
      qi += 1
    } else {
      consecutive = 0
    }
  }

  if (qi < lowerQuery.length) return 0
  const positionPenalty = firstMatchPos * 2
  return 400 + maxConsecutive * 15 - positionPenalty
}

function clip(text: unknown, limit = 1200): string {
  const value = String(text ?? "")
  return value.length > limit ? `${value.slice(0, limit)}\n// ... (truncated)` : value
}

function redactCommand(value: unknown): string {
  return String(value ?? "")
    .replace(/(api[_-]?key|token|password|secret)=("[^"]*"|'[^']*'|\S+)/gi, "$1=<redacted>")
    .replace(/(sk-[a-zA-Z0-9_-]{16,})/g, "<redacted-token>")
}

function getWorkspaceRoots(): string[] {
  if (workspace.workspaceRoots?.length) return workspace.workspaceRoots
  return workspace.projectRoot ? [workspace.projectRoot] : []
}

function matchQuery(value: string, query: string): boolean {
  if (!query) return true
  return fuzzyScore(value, query) > 0 || value.toLowerCase().includes(query.toLowerCase())
}

export const mentionRegistry = reactive<MentionRegistry>({
  mentions: [],
})

export async function resolveMentionLink(mention: Mention): Promise<string> {
  switch (mention.type) {
    case "file": {
      const relativePath = normalizeRelativePath(mention.id)
      const content = await readProjectFile(relativePath)
      const contentStr = typeof content === "string" ? content : ""
      const truncated = contentStr.slice(0, FILE_CONTENT_LIMIT)
      const suffix = contentStr.length > FILE_CONTENT_LIMIT ? "\n// ... (truncated)" : ""
      return `// File: ${relativePath}\n${truncated}${suffix}`
    }

    case "folder": {
      const relativePath = normalizeRelativePath(mention.id)
      const allFiles = await discoverWorkspaceFiles({ query: relativePath, limit: 200 })
      const folderFiles = allFiles
        .map((pathValue) => ({ path: pathValue }))
        .filter((f) => {
          const normalized = normalizeRelativePath(f.path)
          return normalized.startsWith(relativePath) && normalized !== relativePath
        })
      const fileList = folderFiles
        .slice(0, 50)
        .map((f) => `- ${normalizeRelativePath(f.path)}`)
        .join("\n")
      const suffix = folderFiles.length > 50 ? `\n// ... and ${folderFiles.length - 50} more files` : ""
      return `// Folder: ${relativePath}\n${fileList}${suffix}`
    }

    case "code": {
      const relativePath = normalizeRelativePath(mention.id)
      const content = await readProjectFile(relativePath)
      const contentStr = typeof content === "string" ? content : ""
      const query = mention.detail || mention.label
      const lines = contentStr.split("\n")
      const symbolLine = lines.findIndex((line) => line.toLowerCase().includes(query.toLowerCase()))
      if (symbolLine >= 0) {
        const start = Math.max(0, symbolLine - 5)
        const end = Math.min(lines.length, symbolLine + 15)
        const snippet = lines.slice(start, end).join("\n")
        return `// Code: ${relativePath} (lines ${start + 1}-${end})\n${snippet}`
      }
      return `// Code: ${relativePath}\n${contentStr.slice(0, FILE_CONTENT_LIMIT)}`
    }

    case "git": {
      const status = gitState.status.value
      if (!status) return `// Git: no repository found`
      const branch = gitState.currentBranch.value || "unknown"
      const changedFiles = (status.changes || []).slice(0, 20)
      const fileList = changedFiles.length > 0
        ? changedFiles.map((f) => `  ${f.status} ${f.path}`).join("\n")
        : "  (no changes)"
      return `// Git: branch=${branch}, ${changedFiles.length} changed files\n${fileList}`
    }

    case "symbol": {
      const symbols = getProjectSymbols(mention.detail || mention.label)
      const symbol = symbols.find((item: any) => mention.id === `${item.path}#${item.name}:${item.line}`) || symbols[0]
      if (!symbol) return `// Symbol: ${mention.label}\n(no symbol found)`
      const content = await readProjectFile(symbol.path)
      const lines = typeof content === "string" ? content.split("\n") : []
      const start = Math.max(0, Number(symbol.line || 1) - 8)
      const end = Math.min(lines.length, Number(symbol.line || 1) + 18)
      const snippet = lines.slice(start, end).join("\n")
      return `// Symbol: ${symbol.kind} ${symbol.name} @ ${symbol.path}:${symbol.line}\n${clip(snippet, FILE_CONTENT_LIMIT)}`
    }

    case "problem": {
      const diagnostics = problemState.diagnostics
        .filter((diagnostic: any) => matchQuery(`${diagnostic.file} ${diagnostic.message} ${diagnostic.severity}`, mention.detail || mention.label))
        .slice(0, 30)
      const rows = diagnostics.map((diagnostic: any) =>
        `${diagnostic.severity} ${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`,
      )
      return `// Problems: ${mention.detail || mention.label}\n${rows.length ? rows.join("\n") : "(no matching problems)"}`
    }

    case "task": {
      const tasks = debugState.runConfigs
        .filter((task: any) => matchQuery(`${task.name} ${task.command} ${task.group || ""}`, mention.detail || mention.label))
        .slice(0, 20)
      const rows = tasks.map((task: any) =>
        `- ${task.name} [${task.source || "user"}] ${redactCommand(task.command)} cwd=${task.workingDir || "${workspaceFolder}"}`,
      )
      return `// Tasks: ${mention.detail || mention.label}\n${rows.length ? rows.join("\n") : "(no matching tasks)"}`
    }

    case "terminal": {
      const terminals = getAllTerminals()
      const rows: string[] = []
      for (const terminal of terminals.slice(0, 5)) {
        const commands = terminal.recentCommands.slice(-3)
        rows.push(`// Terminal ${terminal.name} cwd=${terminal.cwd || "-"}`)
        for (const command of commands) {
          rows.push(`$ ${redactCommand(command.commandLine)}\nexit=${command.exitCode ?? "-"}\n${clip(command.output || "", 2000)}`)
        }
      }
      return `// Terminal Output\n${rows.length ? rows.join("\n\n") : "(no terminal command output)"}`
    }

    case "workspace": {
      const roots = getWorkspaceRoots()
      const labels = workspace.workspaceRootLabels || {}
      const rootRows = roots.map((root) => `- ${labels[root] || root.split(/[\\/]/).pop() || root}: ${root}`)
      return `// Workspace Roots\n${rootRows.length ? rootRows.join("\n") : "(no workspace selected)"}`
    }

    case "web": {
      const q = mention.detail || mention.label
      const results = await searchWeb(q)
      if (!results.length) return `// Web search: ${q}\n(no results - check searxng/serpapi/bing config)`
      const block = results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join("\n\n")
      return `// Web search: ${q}\n${block}`
    }

    case "docs": {
      const q = mention.detail || mention.label
      const siteFilter = DOC_SITES.map((s) => `site:${s}`).join(" OR ")
      const results = await searchWeb(`${q} (${siteFilter})`)
      if (!results.length) return `// Docs search: ${q}\n(no results)`
      const block = results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join("\n\n")
      return `// Docs search: ${q}\n${block}`
    }

    case "notepad": {
      const relativePath = normalizeRelativePath(mention.id)
      const content = await readProjectFile(relativePath)
      const contentStr = typeof content === "string" ? content : ""
      return `// Notepad: ${relativePath}\n${contentStr.slice(0, FILE_CONTENT_LIMIT)}`
    }

    default:
      return `// ${mention.type}: ${mention.label}`
  }
}

export async function searchMentions(query: string, projectRoot: string): Promise<Mention[]> {
  const results: Mention[] = []
  const trimmedQuery = query.trim()

  const webPrefix = trimmedQuery.match(/^(web|docs):\s*(.+)$/i)
  if (webPrefix) {
    const kind = webPrefix[1].toLowerCase() as "web" | "docs"
    const q = webPrefix[2].trim()
    results.push({
      id: `${kind}-${q}`,
      type: kind,
      label: `${kind === "web" ? "Web" : "Docs"}: ${q}`,
      detail: q,
      icon: ICON_MAP[kind],
    })
    return results
  }

  if (!projectRoot) return results

  if (/^workspace:?/i.test(trimmedQuery) || trimmedQuery === "") {
    results.push({
      id: "workspace-roots",
      type: "workspace",
      label: "Workspace Roots",
      detail: getWorkspaceRoots().length ? `${getWorkspaceRoots().length} roots` : "No workspace",
      icon: ICON_MAP.workspace,
    })
  }

  const discoveredFiles = trimmedQuery
    ? await discoverWorkspaceFiles({ query: trimmedQuery, limit: 200 })
    : knownWorkspaceFiles(200)
  const allFiles = discoveredFiles.map((pathValue) => ({
    name: normalizeRelativePath(pathValue).split("/").pop() || normalizeRelativePath(pathValue),
    path: normalizeRelativePath(pathValue),
    isDir: false,
  }))

  const symbolQuery = trimmedQuery.replace(/^symbol:\s*/i, "")
  if (symbolQuery.length >= 1) {
    for (const symbol of getProjectSymbols(symbolQuery).slice(0, 8) as any[]) {
      results.push({
        id: `${symbol.path}#${symbol.name}:${symbol.line}`,
        type: "symbol",
        label: symbol.name,
        detail: `${symbol.kind} @ ${symbol.path}:${symbol.line}`,
        icon: ICON_MAP.symbol,
      })
    }
  }

  const problemQuery = trimmedQuery.replace(/^(problem|problems):\s*/i, "")
  const diagnostics = problemState.diagnostics
    .filter((diagnostic: any) => matchQuery(`${diagnostic.file} ${diagnostic.message} ${diagnostic.severity}`, problemQuery))
    .slice(0, 6)
  for (const diagnostic of diagnostics as any[]) {
    results.push({
      id: `problem-${diagnostic.file}-${diagnostic.line}-${diagnostic.column}-${diagnostic.message.slice(0, 24)}`,
      type: "problem",
      label: `${diagnostic.severity}: ${diagnostic.file}`,
      detail: `${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`,
      icon: ICON_MAP.problem,
    })
  }

  const taskQuery = trimmedQuery.replace(/^task:\s*/i, "")
  const taskMatches = debugState.runConfigs
    .filter((task: any) => matchQuery(`${task.name} ${task.command} ${task.group || ""}`, taskQuery))
    .slice(0, 6)
  for (const task of taskMatches as any[]) {
    results.push({
      id: `task-${task.id}`,
      type: "task",
      label: task.name,
      detail: redactCommand(task.command),
      icon: ICON_MAP.task,
    })
  }

  const terminalQuery = trimmedQuery.replace(/^terminal:\s*/i, "")
  const terminals = getAllTerminals().filter((terminal) =>
    matchQuery(`${terminal.name} ${terminal.cwd} ${terminal.recentCommands.map((command) => command.commandLine).join(" ")}`, terminalQuery),
  )
  for (const terminal of terminals.slice(0, 4)) {
    results.push({
      id: `terminal-${terminal.id}`,
      type: "terminal",
      label: terminal.name,
      detail: `${terminal.recentCommands.length} commands - ${terminal.cwd || "cwd unknown"}`,
      icon: ICON_MAP.terminal,
    })
  }

  const fuzzyMatches = allFiles
    .filter((f) => !f.isDir)
    .map((f) => ({
      entry: f,
      score: fuzzyScore(normalizeRelativePath(f.path), trimmedQuery),
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)

  const semanticBoost = new Map<string, number>()
  if (trimmedQuery.length >= 3) {
    try {
      const retrieverMod = await import("./retriever.js")
      const semantic = await retrieverMod.retrieveRelevantFiles(trimmedQuery, {
        projectRoot,
        maxResults: 8,
        rerank: true,
      })
      if (Array.isArray(semantic)) {
        for (const r of semantic) {
          const norm = normalizeRelativePath(r.path)
          semanticBoost.set(norm, (r.score || 0) * 600)
        }
      }
    } catch {
      // retriever unavailable; fall back to fuzzy only
    }
  }

  const combined = fuzzyMatches.map((m) => {
    const norm = normalizeRelativePath(m.entry.path)
    const boost = semanticBoost.get(norm) || 0
    return { ...m, score: m.score + boost }
  })

  for (const [path, boost] of semanticBoost) {
    if (boost > 0 && !combined.some((c) => normalizeRelativePath(c.entry.path) === path)) {
      const found = allFiles.find((f) => normalizeRelativePath(f.path) === path && !f.isDir)
      if (found) combined.push({ entry: found, score: boost })
    }
  }
  combined.sort((a, b) => b.score - a.score)

  for (const match of combined.slice(0, MAX_MENTION_RESULTS)) {
    const relativePath = normalizeRelativePath(match.entry.path)
    results.push({
      id: match.entry.path,
      type: "file",
      label: match.entry.name,
      detail: relativePath,
      icon: ICON_MAP.file,
    })
  }

  const folderMatches = allFiles
    .filter((f) => f.isDir)
    .map((f) => ({
      entry: f,
      score: fuzzyScore(normalizeRelativePath(f.path), trimmedQuery),
    }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  for (const match of folderMatches) {
    const relativePath = normalizeRelativePath(match.entry.path)
    results.push({
      id: match.entry.path,
      type: "folder",
      label: match.entry.name,
      detail: relativePath,
      icon: ICON_MAP.folder,
    })
  }

  if (trimmedQuery && trimmedQuery.length >= 2) {
    results.push({
      id: `search-${trimmedQuery}`,
      type: "code",
      label: trimmedQuery,
      detail: `Search for "${trimmedQuery}"`,
      icon: ICON_MAP.code,
    })
  }

  if (gitState.hasRepo.value) {
    results.push({
      id: "git-status",
      type: "git",
      label: "Git Status",
      detail: `Branch: ${gitState.currentBranch.value}`,
      icon: ICON_MAP.git,
    })
  }

  const seen = new Set<string>()
  return results.filter((mention) => {
    const key = `${mention.type}:${mention.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, MAX_MENTION_RESULTS)
}

export async function getGitContext(): Promise<string> {
  const status = gitState.status.value
  if (!status) return "// Git: no repository"

  const branch = gitState.currentBranch.value || "unknown"
  const changed = (status.changes || []).map((f) => `  ${f.status} ${f.path}`).join("\n")
  const staged = (status.staged || []).map((f) => `  ${f.status} ${f.path}`).join("\n")

  return [
    `// Git: ${status.repoName || "repo"} (${branch})`,
    `// Ahead: ${status.ahead ?? 0}, Behind: ${status.behind ?? 0}`,
    staged ? `// Staged:\n${staged}` : "// No staged changes",
    changed ? `// Unstaged:\n${changed}` : "// No unstaged changes",
  ].join("\n")
}

export async function buildMentionsPrompt(mentions: Mention[]): Promise<string> {
  if (mentions.length === 0) return ""

  const resolved = await Promise.all(mentions.map((m) => resolveMentionLink(m)))
  return `\n\n--- BEGIN REFERENCED CONTEXT ---\n${resolved.join("\n\n")}\n--- END REFERENCED CONTEXT ---\n`
}

export async function processMentions(
  inputText: string,
): Promise<{ cleanText: string; contextBlock: string; mentions: Mention[] }> {
  const mentions: Mention[] = []
  let cleanText = inputText

  const matches = inputText.matchAll(MENTION_RE)
  for (const match of matches) {
    const fullMatch = match[0]
    const mentionRef = match[1]

    const registyMatch = mentionRegistry.mentions.find(
      (m) => m.label === mentionRef || m.id === mentionRef,
    )
    if (registyMatch) {
      mentions.push(registyMatch)
      cleanText = cleanText.replace(fullMatch, "")
    }
  }

  cleanText = cleanText.replace(/\s+/g, " ").trim()
  const contextBlock = await buildMentionsPrompt(mentions)

  return { cleanText, contextBlock, mentions }
}
