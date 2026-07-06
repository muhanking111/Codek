import { reactive } from "vue"
import { settingsStore } from "../settings/settingsStore"

export interface RuleFile {
  path: string
  title: string
  glob: string | null
  content: string
  priority: number
  source?: "codek" | "cursor" | "runtime"
  directory?: string
  scopeDepth?: number
}

interface RuleCache {
  files: RuleFile[]
  loadedAt: number
  projectRoot: string
}

interface RuleFileSystemApi {
  readFile: (path: string) => Promise<string>
  listDir: (path: string) => Promise<Array<{ name?: string; isDirectory?: boolean; isDir?: boolean }>>
}

const CACHE_TTL = 30_000
const cachedRules: RuleCache = {
  files: [],
  loadedAt: 0,
  projectRoot: "",
}

export const ruleState = reactive<{
  rules: RuleFile[]
  loaded: boolean
}>({
  rules: [],
  loaded: false,
})

export function getRuleFiles(): RuleFile[] {
  return ruleState.rules
}

function sourceFromPath(path: string): "codek" | "cursor" | "runtime" {
  if (path.startsWith(".cursor/")) return "cursor"
  if (path.startsWith(".codek/")) return "codek"
  return "runtime"
}

function directoryScopeFromPath(path: string): string {
  const normalized = normalizePath(path)
  const match = normalized.match(/^\.([a-z]+)\/rules\/(.+)$/i)
  if (!match) return ""
  const parts = match[2].split("/")
  parts.pop()
  return parts.join("/")
}

function parseRuleFile(raw: string, path: string, priority: number): RuleFile {
  const lines = raw.split("\n")
  let title = path.split("/").pop()?.replace(/\.md$/, "") || "Untitled"
  let glob: string | null = null
  let contentStart = 0

  if (lines.length > 0 && lines[0].startsWith("# ")) {
    title = lines[0].slice(2).trim()
    contentStart = 1
  }

  if (lines.length > contentStart && lines[contentStart].startsWith("glob:")) {
    glob = lines[contentStart].slice(5).trim()
    contentStart += 1
  }

  if (lines.length > contentStart && lines[contentStart].trim() === "---") {
    contentStart += 1
  }

  const bodyLines = lines.slice(contentStart).join("\n").trim()
  const directory = directoryScopeFromPath(path)
  const scopeDepth = directory ? directory.split("/").filter(Boolean).length : 0
  const source = sourceFromPath(path)
  return {
    path,
    title,
    glob,
    content: bodyLines,
    priority,
    source,
    directory,
    scopeDepth,
  }
}

function minimatch(pattern: string, filename: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  const regex = new RegExp(`^${regexStr}$`, "i")
  return regex.test(filename)
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/")
}

export function getMatchingRules(filename: string): string[] {
  if (!areRulesEnabled()) return []

  const normalized = normalizePath(filename)
  const fileName = normalized.split("/").pop() || normalized

  return ruleState.rules
    .filter((rule) => {
      const directory = normalizePath(rule.directory || "").replace(/^\/+|\/+$/g, "")
      const matchesDirectory = !directory
        || normalized === directory
        || normalized.startsWith(`${directory}/`)
      if (!matchesDirectory) return false
      if (!rule.glob) return true
      return minimatch(rule.glob, fileName) || minimatch(rule.glob, normalized)
    })
    .sort(compareRules)
    .map((rule) => rule.content)
}

export function getAllRuleContext(): string {
  if (!areRulesEnabled()) return ""
  if (ruleState.rules.length === 0) return ""

  const globalRules = ruleState.rules
    .filter((r) => !r.glob)
    .sort(compareRules)

  const contextRules = ruleState.rules
    .filter((r) => r.glob)
    .sort(compareRules)

  const parts: string[] = []

  if (globalRules.length > 0) {
    const body = globalRules.map((r) => r.content).join("\n\n")
    parts.push(`## Team Rules\n${body}`)
  }

  if (contextRules.length > 0) {
    const body = contextRules
      .map((r) => `[applies to: ${r.glob}]\n${r.content}`)
      .join("\n\n")
    parts.push(`## Context Rules\n${body}`)
  }

  return `\n${parts.join("\n\n")}\n`
}

function sourceRank(source: RuleFile["source"]): number {
  if (source === "runtime") return 3
  if (source === "codek") return 2
  if (source === "cursor") return 1
  return 0
}

function compareRules(a: RuleFile, b: RuleFile): number {
  const bySource = sourceRank(b.source) - sourceRank(a.source)
  if (bySource !== 0) return bySource
  const byDepth = (b.scopeDepth || 0) - (a.scopeDepth || 0)
  if (byDepth !== 0) return byDepth
  const byGlob = Number(Boolean(b.glob)) - Number(Boolean(a.glob))
  if (byGlob !== 0) return byGlob
  const byPriority = b.priority - a.priority
  if (byPriority !== 0) return byPriority
  return a.path.localeCompare(b.path)
}

async function readRuleFiles(projectRoot: string): Promise<RuleFile[]> {
  const files: RuleFile[] = []
  const fs = getRuleFileSystemApi()
  if (!fs) return files

  const normalizedRoot = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "")
  await readRulesFromRoot(fs, `${normalizedRoot}/.codek`, ".codek", files, 100, 50)
  if (isCursorRulesCompatEnabled()) {
    await readRulesFromRoot(fs, `${normalizedRoot}/.cursor`, ".cursor", files, 90, 45)
  }

  return files
}

async function readRulesFromRoot(
  fs: RuleFileSystemApi,
  absoluteRoot: string,
  relativeRoot: string,
  files: RuleFile[],
  globalPriority: number,
  directoryPriority: number,
): Promise<void> {
  try {
    const globalContent = await fs.readFile(`${absoluteRoot}/rules.md`)
    if (globalContent && typeof globalContent === "string") {
      files.push(parseRuleFile(globalContent, `${relativeRoot}/rules.md`, globalPriority))
    }
  } catch {
    // global rules file may not exist
  }

  try {
    const ruleDirPath = `${absoluteRoot}/rules`
    await readRulesFromDirectory(fs, ruleDirPath, `${relativeRoot}/rules`, files, directoryPriority)
  } catch {
    // rules directory may not exist
  }
}

async function readRulesFromDirectory(
  fs: RuleFileSystemApi,
  absoluteDir: string,
  relativeDir: string,
  files: RuleFile[],
  priority: number,
): Promise<void> {
  let entries: Array<{ name?: string; isDirectory?: boolean; isDir?: boolean }> = []
  try {
    entries = await fs.listDir(absoluteDir)
  } catch {
    return
  }
  if (!Array.isArray(entries)) return

  for (const entry of entries) {
    const name = entry.name
    if (!name || name === "." || name === "..") continue
    const absolutePath = `${absoluteDir}/${name}`
    const relativePath = `${relativeDir}/${name}`
    if (entry.isDirectory === true || entry.isDir === true) {
      await readRulesFromDirectory(fs, absolutePath, relativePath, files, priority)
      continue
    }
    if (!name.endsWith(".md")) continue
    try {
      const content = await fs.readFile(absolutePath)
      if (content && typeof content === "string") {
        files.push(parseRuleFile(content, relativePath, priority))
      }
    } catch {
      // skip unreadable rule file
    }
  }
}

function getRuleFileSystemApi(): RuleFileSystemApi | null {
  const codek = typeof window !== "undefined" ? (window.codek as unknown) : null
  if (!codek || typeof codek !== "object") return null
  const api = codek as Partial<RuleFileSystemApi>
  if (typeof api.readFile !== "function" || typeof api.listDir !== "function") return null
  return {
    readFile: api.readFile,
    listDir: api.listDir,
  }
}

export function loadAllRules(projectRoot: string): void {
  if (!projectRoot || !areRulesEnabled()) {
    ruleState.rules = []
    ruleState.loaded = false
    cachedRules.files = []
    cachedRules.loadedAt = 0
    cachedRules.projectRoot = ""
    return
  }

  const normalized = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "")

  if (
    cachedRules.projectRoot === normalized &&
    cachedRules.loadedAt > 0 &&
    Date.now() - cachedRules.loadedAt < CACHE_TTL
  ) {
    ruleState.rules = cachedRules.files
    ruleState.loaded = true
    return
  }

  readRuleFiles(normalized)
    .then((files) => {
      cachedRules.files = files
      cachedRules.loadedAt = Date.now()
      cachedRules.projectRoot = normalized
      ruleState.rules = files
      ruleState.loaded = true
    })
    .catch((err) => {
      console.warn("Failed to load team rules:", err)
      ruleState.rules = []
      ruleState.loaded = false
    })
}

export function reloadRules(): void {
  if (!cachedRules.projectRoot) {
    ruleState.rules = []
    ruleState.loaded = false
    return
  }

  readRuleFiles(cachedRules.projectRoot)
    .then((files) => {
      cachedRules.files = files
      cachedRules.loadedAt = Date.now()
      ruleState.rules = files
      ruleState.loaded = true
    })
    .catch((err) => {
      console.warn("Failed to reload team rules:", err)
    })
}

export function invalidateRulesCache(): void {
  cachedRules.files = []
  cachedRules.loadedAt = 0
  cachedRules.projectRoot = ""
  ruleState.rules = []
  ruleState.loaded = false
}

export async function loadTeamRules(projectRoot: string): Promise<string | null> {
  if (!areRulesEnabled()) return null
  loadAllRules(projectRoot)
  const context = getAllRuleContext()
  return context || null
}

export function getTeamRulesContext(): string {
  return getAllRuleContext()
}

function areRulesEnabled(): boolean {
  return settingsStore.get<boolean>("codek.rules.enabled", true) !== false
}

function isCursorRulesCompatEnabled(): boolean {
  return settingsStore.get<boolean>("codek.rules.cursorCompat", false) === true
}

settingsStore.subscribe((settings) => {
  if (settings["codek.rules.enabled"] === false || typeof settings["codek.rules.cursorCompat"] === "boolean") {
    invalidateRulesCache()
  }
})
