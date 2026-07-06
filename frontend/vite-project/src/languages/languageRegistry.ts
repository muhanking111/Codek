import { ref } from "vue"

export interface Disposable {
  dispose(): void
}

export interface LanguageContribution {
  id: string
  aliases?: string[]
  extensions?: string[]
  filenames?: string[]
  firstLine?: string
  mimetypes?: string[]
  configuration?: string
  source?: "builtin" | "extension"
  extensionId?: string
}

export interface LanguageDescriptor extends LanguageContribution {
  aliases: string[]
  extensions: string[]
  filenames: string[]
  mimetypes: string[]
  source: "builtin" | "extension"
}

const BUILTIN_LANGUAGES: LanguageContribution[] = [
  { id: "plaintext", aliases: ["Plain Text"], extensions: [".txt", ".log"] },
  { id: "javascript", aliases: ["JavaScript", "js"], extensions: [".js", ".mjs", ".cjs", ".es6", ".pac"], filenames: ["jakefile"] },
  { id: "typescript", aliases: ["TypeScript", "ts"], extensions: [".ts", ".mts", ".cts"] },
  { id: "javascriptreact", aliases: ["JavaScript JSX", "jsx"], extensions: [".jsx"] },
  { id: "typescriptreact", aliases: ["TypeScript JSX", "tsx"], extensions: [".tsx"] },
  { id: "html", aliases: ["HTML"], extensions: [".html", ".htm", ".vue", ".svelte"] },
  { id: "css", aliases: ["CSS"], extensions: [".css"] },
  { id: "scss", aliases: ["SCSS"], extensions: [".scss"] },
  { id: "less", aliases: ["LESS"], extensions: [".less"] },
  { id: "json", aliases: ["JSON"], extensions: [".json"] },
  { id: "jsonc", aliases: ["JSON with Comments"], extensions: [".jsonc"] },
  { id: "markdown", aliases: ["Markdown", "md"], extensions: [".md", ".mdx", ".markdown"] },
  { id: "python", aliases: ["Python", "py"], extensions: [".py", ".pyi", ".pyw", ".pyx", ".rpy", ".gyp", ".gypi"] },
  { id: "java", aliases: ["Java"], extensions: [".java"] },
  { id: "c", aliases: ["C"], extensions: [".c", ".h"] },
  { id: "cpp", aliases: ["C++"], extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hxx"] },
  { id: "csharp", aliases: ["C#"], extensions: [".cs"] },
  { id: "go", aliases: ["Go"], extensions: [".go"] },
  { id: "rust", aliases: ["Rust"], extensions: [".rs"] },
  { id: "ruby", aliases: ["Ruby"], extensions: [".rb"], filenames: ["gemfile", "rakefile", "vagrantfile"] },
  { id: "php", aliases: ["PHP"], extensions: [".php"] },
  { id: "swift", aliases: ["Swift"], extensions: [".swift"] },
  { id: "kotlin", aliases: ["Kotlin"], extensions: [".kt", ".kts"] },
  { id: "dart", aliases: ["Dart"], extensions: [".dart"] },
  { id: "lua", aliases: ["Lua"], extensions: [".lua"] },
  { id: "r", aliases: ["R"], extensions: [".r"] },
  { id: "perl", aliases: ["Perl"], extensions: [".pl", ".pm"] },
  { id: "shell", aliases: ["Shell"], extensions: [".sh", ".bash", ".zsh", ".fish"] },
  { id: "powershell", aliases: ["PowerShell"], extensions: [".ps1", ".psm1"] },
  { id: "bat", aliases: ["Batch"], extensions: [".bat", ".cmd"] },
  { id: "sql", aliases: ["SQL"], extensions: [".sql"] },
  { id: "xml", aliases: ["XML"], extensions: [".xml", ".svg"] },
  { id: "yaml", aliases: ["YAML"], extensions: [".yaml", ".yml"] },
  { id: "ini", aliases: ["INI"], extensions: [".ini", ".cfg", ".conf", ".env", ".properties", ".toml"], filenames: [".gitignore", ".gitattributes"] },
  { id: "dockerfile", aliases: ["Dockerfile"], filenames: ["dockerfile"] },
  { id: "makefile", aliases: ["Makefile"], filenames: ["makefile"] },
  { id: "graphql", aliases: ["GraphQL"], extensions: [".graphql", ".gql"] },
  { id: "elixir", aliases: ["Elixir"], extensions: [".ex", ".exs"] },
  { id: "erlang", aliases: ["Erlang"], extensions: [".erl", ".hrl"] },
  { id: "fsharp", aliases: ["F#"], extensions: [".fs", ".fsx"] },
  { id: "objective-c", aliases: ["Objective-C"], extensions: [".m", ".mm"] },
  { id: "groovy", aliases: ["Groovy"], extensions: [".groovy", ".gradle"] },
  { id: "protobuf", aliases: ["Protocol Buffers"], extensions: [".proto"] },
  { id: "hcl", aliases: ["HCL"], extensions: [".tf", ".tfvars", ".hcl"] },
  { id: "clojure", aliases: ["Clojure"], extensions: [".clj", ".cljs"] },
  { id: "scala", aliases: ["Scala"], extensions: [".scala", ".sbt"] },
  { id: "zig", aliases: ["Zig"], extensions: [".zig"] },
  { id: "nim", aliases: ["Nim"], extensions: [".nim"] },
  { id: "v", aliases: ["V"], extensions: [".v"] },
  { id: "solidity", aliases: ["Solidity"], extensions: [".sol"] },
  { id: "latex", aliases: ["LaTeX"], extensions: [".tex"] },
  { id: "cmake", aliases: ["CMake"], filenames: ["cmakelists.txt"] },
]

interface RegisteredLanguageEntry {
  readonly owner: symbol
  readonly contribution: LanguageContribution
}

const descriptors = new Map<string, LanguageDescriptor>()
const languageEntries = new Map<string, RegisteredLanguageEntry[]>()
export const languageRegistryVersion = ref(0)

resetLanguageRegistry()

export function resetLanguageRegistry(): void {
  languageEntries.clear()
  descriptors.clear()
  registerLanguages(BUILTIN_LANGUAGES.map((language) => ({ ...language, source: "builtin" })))
}

export function registerLanguages(languages: LanguageContribution[] = []): number {
  let registered = 0
  for (const language of languages) {
    if (!language || typeof language.id !== "string" || !language.id.trim()) continue
    const id = language.id.trim()
    const owner = Symbol(id)
    pushLanguageEntry(id, { owner, contribution: language })
    registered += 1
  }
  if (registered > 0) {
    rebuildLanguageDescriptors()
    languageRegistryVersion.value += 1
  }
  return registered
}

export function unregisterLanguages(id: string, owner?: symbol): void {
  const key = String(id || "").trim()
  if (!key) return
  const stack = languageEntries.get(key)
  if (!stack?.length) return
  if (!owner) {
    stack.pop()
  } else {
    const index = stack.findIndex((entry) => entry.owner === owner)
    if (index === -1) return
    stack.splice(index, 1)
  }
  if (stack.length === 0) languageEntries.delete(key)
  rebuildLanguageDescriptors()
  languageRegistryVersion.value += 1
}

export function getLanguageDescriptors(): LanguageDescriptor[] {
  return Array.from(descriptors.values()).sort((left, right) => left.id.localeCompare(right.id))
}

export function getLanguageIds(): string[] {
  return getLanguageDescriptors().map((language) => language.id)
}

export function getLanguageDescriptor(id: string): LanguageDescriptor | undefined {
  return descriptors.get(id)
}

export function detectLanguageForPath(pathValue: string, firstLine = ""): string {
  const base = basename(pathValue).toLowerCase()
  if (!base) return "plaintext"

  for (const language of descriptors.values()) {
    if (language.filenames.some((filename) => filename.toLowerCase() === base)) return language.id
  }

  for (const extension of extensionCandidates(base)) {
    for (const language of descriptors.values()) {
      if (language.extensions.some((candidate) => normalizeExtension(candidate) === extension)) return language.id
    }
  }

  if (base.startsWith(".env.") && descriptors.has("ini")) return "ini"

  if (firstLine) {
    for (const language of descriptors.values()) {
      if (!language.firstLine) continue
      try {
        if (new RegExp(language.firstLine).test(firstLine)) return language.id
      } catch {
        // Ignore invalid extension-provided firstLine regex.
      }
    }
  }

  return "plaintext"
}

function normalizeLanguageDescriptor(language: LanguageContribution): LanguageDescriptor {
  return {
    id: String(language.id || "").trim(),
    aliases: normalizeList(language.aliases),
    extensions: normalizeList(language.extensions).map(normalizeExtension),
    filenames: normalizeList(language.filenames).map((filename) => filename.toLowerCase()),
    firstLine: typeof language.firstLine === "string" ? language.firstLine : undefined,
    mimetypes: normalizeList(language.mimetypes),
    configuration: typeof language.configuration === "string" ? language.configuration : undefined,
    source: language.source || "extension",
    extensionId: language.extensionId,
  }
}

export function registerLanguageSet(languages: LanguageContribution[] = []): Disposable {
  const ids: Array<{ id: string; owner: symbol }> = []
  for (const language of languages) {
    if (!language || typeof language.id !== "string" || !language.id.trim()) continue
    const id = language.id.trim()
    const owner = Symbol(id)
    pushLanguageEntry(id, { owner, contribution: language })
    ids.push({ id, owner })
  }
  if (ids.length > 0) {
    rebuildLanguageDescriptors()
    languageRegistryVersion.value += 1
  }
  return {
    dispose() {
      let changed = false
      for (const { id, owner } of ids) {
        const stack = languageEntries.get(id)
        if (!stack?.length) continue
        const index = stack.findIndex((entry) => entry.owner === owner)
        if (index === -1) continue
        stack.splice(index, 1)
        if (stack.length === 0) languageEntries.delete(id)
        changed = true
      }
      if (changed) {
        rebuildLanguageDescriptors()
        languageRegistryVersion.value += 1
      }
    },
  }
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
}

function mergeList(left: unknown, right: unknown): string[] {
  return [...new Set([...normalizeList(left), ...normalizeList(right)])]
}

function normalizeExtension(value: string): string {
  const normalized = String(value || "").trim().toLowerCase()
  return normalized.startsWith(".") ? normalized.slice(1) : normalized
}

function extensionCandidates(filename: string): string[] {
  const parts = filename.split(".").filter(Boolean)
  if (parts.length <= 1) return [filename]
  const candidates: string[] = []
  for (let index = 1; index < parts.length; index += 1) {
    candidates.push(parts.slice(index).join("."))
  }
  candidates.push(parts[parts.length - 1])
  return [...new Set(candidates)]
}

function basename(value: string): string {
  return String(value || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || String(value || "")
}

function pushLanguageEntry(id: string, entry: RegisteredLanguageEntry): void {
  const stack = languageEntries.get(id) ?? []
  stack.push(entry)
  languageEntries.set(id, stack)
}

function rebuildLanguageDescriptors(): void {
  descriptors.clear()
  for (const [id, stack] of languageEntries) {
    if (stack.length === 0) continue
    const combined = stack.reduce<LanguageContribution>((acc, entry) => ({
      ...acc,
      ...entry.contribution,
      aliases: mergeList(acc.aliases, entry.contribution.aliases),
      extensions: mergeList(acc.extensions, entry.contribution.extensions),
      filenames: mergeList(acc.filenames, entry.contribution.filenames),
      mimetypes: mergeList(acc.mimetypes, entry.contribution.mimetypes),
      source: entry.contribution.source || acc.source || "extension",
    }), { id })
    descriptors.set(id, normalizeLanguageDescriptor(combined))
  }
}
