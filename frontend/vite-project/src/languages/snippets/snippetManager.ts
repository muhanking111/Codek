export interface SnippetDefinition {
  name: string
  prefix: string | string[]
  body: string
  description: string
  scope?: string[]
  prefixes?: string[]
  source?: "vscode" | "workspace" | "user"
}

export interface SnippetVariable {
  name: string
  value: string
}

export interface ResolveContext {
  fileName?: string
  lineNumber?: number
  columnNumber?: number
  selectedText?: string
  clipboard?: string
  workspaceName?: string
  variables?: Record<string, string>
}

const SYSTEM_VARIABLES: Readonly<Record<string, (ctx: ResolveContext) => string>> = {
  TM_FILENAME: (ctx) => ctx.fileName ?? "untitled",
  TM_FILENAME_BASE: (ctx) => {
    const name = ctx.fileName ?? "untitled"
    const dotIndex = name.lastIndexOf(".")
    return dotIndex > 0 ? name.slice(0, dotIndex) : name
  },
  TM_DIRECTORY: (ctx) => {
    const sep = "/"
    const parts = (ctx.fileName ?? "").split(sep)
    return parts.length > 1 ? parts.slice(0, -1).join(sep) : ""
  },
  TM_LINE_NUMBER: (ctx) => String(ctx.lineNumber ?? 1),
  TM_CURRENT_WORD: (ctx) => ctx.selectedText ?? "",
  TM_SELECTED_TEXT: (ctx) => ctx.selectedText ?? "",
  CLIPBOARD: (ctx) => ctx.clipboard ?? "",
  WORKSPACE_NAME: (ctx) => ctx.workspaceName ?? "",
  CURRENT_YEAR: () => String(new Date().getFullYear()),
  CURRENT_MONTH: () => String(new Date().getMonth() + 1).padStart(2, "0"),
  CURRENT_DATE: () => String(new Date().getDate()).padStart(2, "0"),
  CURRENT_HOUR: () => String(new Date().getHours()).padStart(2, "0"),
  CURRENT_MINUTE: () => String(new Date().getMinutes()).padStart(2, "0"),
  CURRENT_SECOND: () => String(new Date().getSeconds()).padStart(2, "0"),
  CURRENT_DAY_NAME: () => {
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    return DAYS[new Date().getDay()]
  },
  CURRENT_DAY_NAME_SHORT: () => {
    const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    return DAYS[new Date().getDay()]
  },
  RANDOM: () => String(Math.random()).slice(2, 8),
  RANDOM_HEX: () => Math.random().toString(16).slice(2, 8),
}

type TabStopMap = Map<number, { default: string; occurrences: number }>

function parseTabStops(body: string): { result: string; tabStops: TabStopMap } {
  const tabStops: TabStopMap = new Map()
  let result = body

  const complexPattern = /\$\{(\d+):([^}]*)\}/g
  result = result.replace(complexPattern, (_match, numStr: string, defaultValue: string) => {
    const num = parseInt(numStr, 10)
    const existing = tabStops.get(num)
    if (existing) {
      existing.occurrences += 1
    } else {
      tabStops.set(num, { default: defaultValue, occurrences: 1 })
    }
    return `\${${num}:${defaultValue}}`
  })

  const simplePattern = /\$(\d+)/g
  result = result.replace(simplePattern, (_match, numStr: string) => {
    const num = parseInt(numStr, 10)
    if (num === 0) return "$0"
    const existing = tabStops.get(num)
    if (existing) {
      existing.occurrences += 1
    } else {
      tabStops.set(num, { default: "", occurrences: 1 })
    }
    return `$${num}`
  })

  return { result, tabStops }
}

function resolveVariables(text: string, ctx: ResolveContext): string {
  let result = text

  result = result.replace(/\$\{([A-Z_][A-Z0-9_]*):\$\{\d+:([^}]*)\}\}/g, (_match, varName: string, defaultValue: string) => {
    return resolveVariableValue(varName, ctx) || defaultValue
  })

  result = result.replace(/\$\{([A-Z_][A-Z0-9_]*):([^}]*)\}/g, (_match, varName: string, defaultValue: string) => {
    const value = resolveVariableValue(varName, ctx)
    return value || defaultValue.replace(/\$(\d+)/g, "")
  })

  for (const [varName, resolver] of Object.entries(SYSTEM_VARIABLES)) {
    const pattern = new RegExp(`\\$\\{${varName}\\}`, "g")
    result = result.replace(pattern, resolver(ctx))
  }

  if (ctx.variables) {
    for (const [key, value] of Object.entries(ctx.variables)) {
      const pattern = new RegExp(`\\$\\{${key}\\}`, "g")
      result = result.replace(pattern, value)
    }
  }

  result = result.replace(/\$\{(\w+)\}/g, (_match, varName: string) => resolveVariableValue(varName, ctx))

  return result
}

function resolveVariableValue(varName: string, ctx: ResolveContext): string {
  const systemResolver = SYSTEM_VARIABLES[varName]
  if (systemResolver) return systemResolver(ctx)
  return ctx.variables?.[varName] ?? ""
}

function normalizePrefixes(prefix: string | string[] | undefined, fallback: string): string[] {
  if (Array.isArray(prefix)) {
    const result = prefix.map((item) => String(item || "").trim()).filter(Boolean)
    return result.length > 0 ? result : [fallback]
  }
  const normalized = String(prefix || "").trim()
  return normalized ? [normalized] : [fallback]
}

function normalizeSnippet(snippet: SnippetDefinition): SnippetDefinition {
  const prefixes = normalizePrefixes(snippet.prefix, snippet.name)
  return {
    ...snippet,
    prefix: prefixes.length === 1 ? prefixes[0] : prefixes,
    prefixes,
    source: snippet.source || "user",
  }
}

export class SnippetManager {
  private readonly snippets: Map<string, SnippetDefinition> = new Map()

  registerSnippet(snippet: SnippetDefinition): void {
    this.snippets.set(snippet.name, normalizeSnippet(snippet))
  }

  unregisterSnippet(name: string): boolean {
    return this.snippets.delete(name)
  }

  getSnippetsForLanguage(languageId: string): SnippetDefinition[] {
    const result: SnippetDefinition[] = []
    for (const snippet of this.snippets.values()) {
      if (!snippet.scope || snippet.scope.length === 0 || snippet.scope.includes(languageId)) {
        result.push(snippet)
      }
    }
    return result
  }

  resolveSnippet(snippet: SnippetDefinition, context: ResolveContext): string {
    const { result } = parseTabStops(snippet.body)
    return resolveVariables(result, context)
  }

  async loadFromWorkspace(workspaceRoot: string): Promise<number> {
    try {
      const snippetPath = `${workspaceRoot.replace(/\\/g, "/")}/.codek/snippets.json`
      const content = await window.codek?.readFile(snippetPath)
      if (!content) return 0
      const data = JSON.parse(content) as Record<string, VSCodeSnippetEntry>
      let count = 0
      for (const [name, entry] of Object.entries(data)) {
        const body = Array.isArray(entry.body) ? entry.body.join("\n") : (entry.body ?? "")
        this.registerSnippet({
          name,
          prefix: entry.prefix ?? name,
          body,
          description: entry.description ?? "",
          scope: entry.scope ? entry.scope.split(",").map((s) => s.trim()) : undefined,
          source: "workspace",
        })
        count++
      }
      return count
    } catch {
      return 0
    }
  }

  async saveToWorkspace(workspaceRoot: string): Promise<void> {
    try {
      const dir = `${workspaceRoot.replace(/\\/g, "/")}/.codek`
      await window.codek?.createDir(dir)
      const data: Record<string, VSCodeSnippetEntry> = {}
      for (const [name, snippet] of this.snippets) {
        data[name] = {
          prefix: snippet.prefixes && snippet.prefixes.length > 1 ? snippet.prefixes : snippet.prefixes?.[0] ?? snippet.prefix,
          body: snippet.body.split("\n"),
          description: snippet.description,
          scope: snippet.scope?.join(","),
        }
      }
      const snippetPath = `${dir}/snippets.json`
      await window.codek?.writeFile(snippetPath, JSON.stringify(data, null, 2))
    } catch {
      throw new Error("Failed to save snippets to workspace")
    }
  }

  importFromVSCode(json: Record<string, VSCodeSnippetEntry>): number {
    let count = 0
    for (const [name, entry] of Object.entries(json)) {
      const body = Array.isArray(entry.body) ? entry.body.join("\n") : (entry.body ?? "")
      this.registerSnippet({
        name,
        prefix: entry.prefix ?? name,
        body,
        description: entry.description ?? "",
        scope: entry.scope ? entry.scope.split(",").map((s) => s.trim()) : undefined,
        source: "vscode",
      })
      count++
    }
    return count
  }

  exportToJSON(): Record<string, VSCodeSnippetEntry> {
    const result: Record<string, VSCodeSnippetEntry> = {}
    for (const [name, snippet] of this.snippets) {
      result[name] = {
        prefix: snippet.prefix,
        body: snippet.body.split("\n"),
        description: snippet.description,
        scope: snippet.scope?.join(","),
      }
    }
    return result
  }

  getAllSnippets(): SnippetDefinition[] {
    return Array.from(this.snippets.values())
  }

  getSnippet(name: string): SnippetDefinition | undefined {
    return this.snippets.get(name)
  }

  getRegistrySnapshot(): SnippetRegistrySnapshot {
    const snippets = this.getAllSnippets().map((snippet) => ({
      name: snippet.name,
      prefixes: snippet.prefixes || normalizePrefixes(snippet.prefix, snippet.name),
      scope: snippet.scope || [],
      source: snippet.source || "user",
    }))
    const languages = [...new Set(snippets.flatMap((snippet) => snippet.scope))].sort()
    return {
      source: "snippetManager",
      serviceId: "snippetService",
      vscodeServiceIds: ["ISnippetsService", "ILanguageFeaturesService"],
      total: snippets.length,
      languages,
      snippets,
      constraints: {
        singleRegistry: true,
        providerUsesRegistry: true,
        vscodeSnippetShape: true,
      },
    }
  }

  clear(): void {
    this.snippets.clear()
  }
}

interface VSCodeSnippetEntry {
  prefix?: string | string[]
  body?: string | string[]
  description?: string
  scope?: string
}

export interface SnippetRegistrySnapshot {
  source: "snippetManager"
  serviceId: "snippetService"
  vscodeServiceIds: ["ISnippetsService", "ILanguageFeaturesService"]
  total: number
  languages: string[]
  snippets: Array<{
    name: string
    prefixes: string[]
    scope: string[]
    source: "vscode" | "workspace" | "user"
  }>
  constraints: {
    singleRegistry: true
    providerUsesRegistry: true
    vscodeSnippetShape: true
  }
}

export const snippetManager = new SnippetManager()
