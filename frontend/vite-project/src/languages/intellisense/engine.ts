import type { languages, editor, Position } from "monaco-editor"
import type {
  PluginManifest,
  PluginEngineClass,
  PluginEngineMethod,
} from "../../plugins/types"
import { javaPluginManifest } from "../../plugins/builtin/java-plugin.json"
import { pythonPluginManifest } from "../../plugins/builtin/python-plugin.json"
import { goPluginManifest } from "../../plugins/builtin/go-plugin.json"
import { cppPluginManifest } from "../../plugins/builtin/cpp-plugin.json"
import { rustPluginManifest } from "../../plugins/builtin/rust-plugin.json"
import { getEnabledPlugins, getPlugin, isPluginEnabled } from "../../plugins/registry"
import { langSettings, loadLangSettings } from "../../ai/models.js"
import { editorLanguageFeatureService } from "../../editor/editorLanguageFeatureService"
import { combineDisposables, NOOP_DISPOSABLE, type DisposableLike } from "../disposable"

type Monaco = typeof import("monaco-editor")

/** 未完成项：在回调出口由 withCompletionItemRanges 补上 range */
type CompletionDraft = Omit<languages.CompletionItem, "range"> & {
  range?: languages.CompletionItem["range"]
}

function completionRangeAtPosition(
  position: Position,
  model?: editor.ITextModel,
): languages.CompletionItem["range"] {
  // Cover the word currently being typed so Monaco filters items by the typed
  // prefix. Without this, Monaco sees an empty replacement range and either
  // shows everything or nothing — defeating IDEA-style prefix matching.
  if (model) {
    const word = model.getWordUntilPosition(position)
    return {
      startLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    }
  }
  return {
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  }
}

function withCompletionItemRanges(
  items: CompletionDraft[],
  position: Position,
  model?: editor.ITextModel,
): languages.CompletionItem[] {
  const r = completionRangeAtPosition(position, model)
  return items.map((item) => ({ ...item, range: item.range ?? r }))
}

const BUILTIN_MANIFESTS: PluginManifest[] = [
  javaPluginManifest,
  pythonPluginManifest,
  goPluginManifest,
  cppPluginManifest,
  rustPluginManifest,
]

export function getActiveManifests(): PluginManifest[] {
  loadLangSettings()
  const enabled = getEnabledPlugins()
  const enabledIds = new Set(enabled.map((p) => p.manifest.id))
  const result: PluginManifest[] = []
  for (const bm of BUILTIN_MANIFESTS) {
    if (isPluginInstalledCheck(bm.id, enabledIds)) {
      result.push(bm)
    }
  }
  return result
}

function isPluginInstalledCheck(id: string, enabledIds: Set<string>): boolean {
  if (enabledIds.has(id)) return true
  if (isPluginEnabled(id)) return true
  // Built-in plugins live only as manifest constants — they are never installed
  // into the registry, so isPluginEnabled() returns false. Treat them as
  // enabled-by-default unless the user has explicitly installed+disabled them.
  const installed = getPlugin(id)
  return !installed
}

function getJdkVersionNumber(): number {
  const v = langSettings.jdkVersion || "17"
  return parseInt(v, 10) || 17
}

function isSinceAvailable(since: string | undefined): boolean {
  if (!since) return true
  const match = since.match(/\d+/)
  if (!match) return true
  const requiredVersion = parseInt(match[0], 10)
  return getJdkVersionNumber() >= requiredVersion
}

function kindMap(monaco: Monaco): Record<string, languages.CompletionItemKind> {
  return {
    keyword: monaco.languages.CompletionItemKind.Keyword,
    class: monaco.languages.CompletionItemKind.Class,
    method: monaco.languages.CompletionItemKind.Method,
    field: monaco.languages.CompletionItemKind.Field,
    snippet: monaco.languages.CompletionItemKind.Snippet,
    property: monaco.languages.CompletionItemKind.Property,
    interface: monaco.languages.CompletionItemKind.Interface,
    enum: monaco.languages.CompletionItemKind.Enum,
    variable: monaco.languages.CompletionItemKind.Variable,
    type: monaco.languages.CompletionItemKind.TypeParameter,
    module: monaco.languages.CompletionItemKind.Module,
  }
}

function filterClassMethods(
  cls: PluginEngineClass,
  monaco: Monaco,
): { staticMethods: CompletionDraft[]; instanceMethods: CompletionDraft[] } {
  const staticMethods: CompletionDraft[] = []
  const instanceMethods: CompletionDraft[] = []

  if (cls.staticFields) {
    for (const sf of cls.staticFields) {
      if (!isSinceAvailable(sf.since)) continue
      staticMethods.push({
        label: sf.name,
        kind: monaco.languages.CompletionItemKind.Field,
        insertText: sf.name,
        detail: `${sf.type} — ${sf.detail}`,
        sortText: "0",
      })
    }
  }

  if (cls.methods) {
    for (const m of cls.methods) {
      if (!isSinceAvailable(m.since)) continue
      const isStatic = m.returnType.startsWith("static")
      const item: CompletionDraft = {
        label: m.name,
        kind: monaco.languages.CompletionItemKind.Method,
        insertText: `${m.name}(${m.params === "()" ? ")" : ""})`,
        detail: `${m.returnType} — ${m.detail}`,
        sortText: isStatic ? "0" : "1",
        documentation: m.since ? `Available since ${m.since}` : undefined,
      }
      if (isStatic) {
        staticMethods.push(item)
      } else {
        instanceMethods.push(item)
      }
    }
  }

  return { staticMethods, instanceMethods }
}

function collectTopLevelItems(
  cfg: PluginManifest["engineConfig"],
  monaco: Monaco,
  items: CompletionDraft[],
): void {
  const km = kindMap(monaco)

  if (cfg?.keywords) {
    for (const kw of cfg.keywords) {
      items.push({
        label: kw,
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: kw,
        detail: "keyword",
        sortText: "4",
      })
    }
  }

  if (cfg?.types) {
    for (const t of cfg.types) {
      items.push({
        label: t,
        kind: monaco.languages.CompletionItemKind.TypeParameter,
        insertText: t,
        detail: "type",
        sortText: "4",
      })
    }
  }

  if (cfg?.topLevels) {
    for (const tl of cfg.topLevels) {
      if (!isSinceAvailable(tl.since)) continue
      const item: CompletionDraft = {
        label: tl.label,
        kind: km[tl.kind] || monaco.languages.CompletionItemKind.Text,
        insertText: tl.insertText,
        detail: tl.detail,
        sortText: tl.kind === "snippet" ? "0" : "2",
      }
      if (tl.since) {
        item.documentation = `Available since ${tl.since}`
      }
      items.push(item)
    }
  }
}

function resolveDotCompletion(
  lineUntilCursor: string,
  cfg: PluginManifest["engineConfig"],
  monaco: Monaco,
): CompletionDraft[] | null {
  if (!cfg?.classes) return null

  const dotMatch = lineUntilCursor.match(/\.\s*(\w*)$/)
  if (!dotMatch) return null

  const dotIndex = lineUntilCursor.lastIndexOf(".")
  const beforeDot = lineUntilCursor.slice(0, dotIndex).trim()

  const items = resolveChainForToken(beforeDot, cfg, monaco)
  return items.length > 0 ? items : null
}

function resolveChainForToken(
  chainExpr: string,
  cfg: PluginManifest["engineConfig"],
  monaco: Monaco,
): CompletionDraft[] {
  if (!cfg?.classes) return []

  const parts = splitChain(chainExpr)
  if (parts.length === 0) return []

  let currentClassName: string | null = null
  let currentIsStatic = false

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim()
    if (!part) continue

    if (currentClassName === null) {
      const rootClass = cfg.classes[part]
      if (rootClass) {
        currentClassName = part
        currentIsStatic = true
        continue
      }
      return []
    }

    if (part.endsWith(")")) {
      const methodName = part.slice(0, part.indexOf("(")).trim()
      if (!methodName) continue
      const ownerCls: PluginEngineClass | undefined = cfg.classes[currentClassName]
      if (!ownerCls) return []
      const method: PluginEngineMethod | undefined = ownerCls.methods?.find((m: PluginEngineMethod) => m.name === methodName)
      if (!method) return []
      if (method.returnClass) {
        currentClassName = method.returnClass
        currentIsStatic = method.returnType.startsWith("static")
      }
    }
  }

  if (!currentClassName) return []

  const targetCls = cfg.classes[currentClassName]
  if (!targetCls) return []

  const items: CompletionDraft[] = []
  const { staticMethods, instanceMethods } = filterClassMethods(targetCls, monaco)

  if (currentIsStatic) {
    for (const item of staticMethods) items.push(item)
  }
  for (const item of instanceMethods) items.push(item)

  return items
}

function splitChain(expr: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ""
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (ch === "(") { depth++; current += ch }
    else if (ch === ")") { depth--; current += ch }
    else if (ch === "." && depth === 0) {
      if (current) parts.push(current)
      current = ""
    } else {
      current += ch
    }
  }
  if (current) parts.push(current)
  return parts
}

function resolveImportCompletion(
  lineUntilCursor: string,
  cfg: PluginManifest["engineConfig"],
  monaco: Monaco,
): CompletionDraft[] | null {
  if (!cfg?.imports) return null

  const trimmed = lineUntilCursor.trim()
  const importPrefixes = ["import", "from", "using", "#include", "package"]

  let importLine = ""
  for (const prefix of importPrefixes) {
    if (trimmed.startsWith(prefix + " ")) {
      importLine = trimmed.slice(prefix.length).trim()
      break
    }
  }

  if (!importLine) return null

  const matching = cfg.imports
    .filter((imp) => imp.label.toLowerCase().includes(importLine.toLowerCase()))
    .map((imp) => ({
      label: imp.label,
      kind: monaco.languages.CompletionItemKind.Module,
      insertText: imp.insertText,
      detail: imp.detail,
      sortText: "0",
    }))

  return matching.length > 0 ? matching : null
}

function resolvePostfixCompletion(
  lineUntilCursor: string,
  _model: editor.ITextModel,
  position: Position,
  cfg: PluginManifest["engineConfig"],
  monaco: Monaco,
): CompletionDraft[] | null {
  const postfixTemplates = cfg?.postfixTemplates
  if (!postfixTemplates || postfixTemplates.length === 0) return null

  const postfixMatch = lineUntilCursor.match(/\.\s*(\w+)$/)
  if (!postfixMatch) return null

  const key = postfixMatch[1].toLowerCase()
  const dotIdx = lineUntilCursor.lastIndexOf(".")

  const template = postfixTemplates.find((t) => t.key.toLowerCase() === key)
  if (!template) return null

  const exprStart = dotIdx > 0 ? lineUntilCursor.slice(0, dotIdx).trim() : ""
  const snippetWithExpr = template.snippet.replace(/\$\{1:expr\}/g, exprStart || "$1")

  return [{
    label: `.${template.key} → ${template.label}`,
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: "",
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    detail: template.description,
    sortText: "0",
    filterText: `.${template.key}`,
    additionalTextEdits: [{
      range: {
        startLineNumber: position.lineNumber,
        startColumn: exprStart ? lineUntilCursor.indexOf(exprStart) + 1 : 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      },
      text: exprStart ? snippetWithExpr : template.snippet,
    }],
  }]
}

function resolveSmartTypeCompletion(
  lineUntilCursor: string,
  cfg: PluginManifest["engineConfig"],
  monaco: Monaco,
): CompletionDraft[] | null {
  if (!cfg?.classes) return null

  const trimmed = lineUntilCursor.trim()

  const newMatch = trimmed.match(/new\s+(\w*)$/)
  if (newMatch) {
    return resolveNewInstanceCompletion(cfg, monaco)
  }

  const returnMatch = trimmed.match(/return\s+(\w*)$/)
  if (returnMatch) {
    return resolveReturnCompletion(lineUntilCursor, cfg, monaco)
  }

  const assignMatch = trimmed.match(/^\s*(\w+(?:<[^>]+>)?)\s+(\w+)\s*=\s*(\w*)$/)
  if (assignMatch) {
    const typeName = assignMatch[1]
    return resolveTypeMatchCompletion(typeName, cfg, monaco)
  }

  return null
}

function resolveNewInstanceCompletion(
  cfg: PluginManifest["engineConfig"],
  monaco: Monaco,
): CompletionDraft[] | null {
  if (!cfg?.classes) return null

  const items: CompletionDraft[] = []
  for (const [className, cls] of Object.entries(cfg.classes)) {
    if (!isSinceAvailable(cls.since)) continue
    if (!cls.methods?.some((m) => m.name === className || m.returnType.includes("<init>"))) {
      const hasConstructor = cls.methods?.some((m) => m.name === className.split(".").pop() || m.name === "create" || m.name === "of")
      if (!hasConstructor && className !== "String" && className !== "Integer") continue
    }
    items.push({
      label: className,
      kind: monaco.languages.CompletionItemKind.Class,
      insertText: `${className}($1)`,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: cls.detail,
      sortText: "0",
    })
  }

  const { defaultImports } = getImportMap(cfg)
  for (const [simpleName, fullPath] of Object.entries(defaultImports)) {
    if (items.some((i) => i.label === simpleName)) continue
    items.push({
      label: simpleName,
      kind: monaco.languages.CompletionItemKind.Class,
      insertText: `${simpleName}($1)`,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: fullPath,
      sortText: "1",
    })
  }

  return items.length > 0 ? items : null
}

function resolveReturnCompletion(
  _lineUntilCursor: string,
  cfg: PluginManifest["engineConfig"],
  monaco: Monaco,
): CompletionDraft[] | null {
  const items: CompletionDraft[] = []

  if (cfg?.classes) {
    for (const [className, cls] of Object.entries(cfg.classes)) {
      if (!isSinceAvailable(cls.since)) continue
      const staticMethods = (cls.methods || []).filter((m) => m.returnType.startsWith("static"))
      for (const m of staticMethods) {
        items.push({
          label: `${className}.${m.name}`,
          kind: monaco.languages.CompletionItemKind.Method,
          insertText: `${className}.${m.name}(${m.params === "()" ? ")" : ""})`,
          detail: `${m.returnType} — ${m.detail}`,
          sortText: "0",
        })
      }
    }
  }

  return items.length > 0 ? items : null
}

function resolveTypeMatchCompletion(
  expectedType: string,
  cfg: PluginManifest["engineConfig"],
  monaco: Monaco,
): CompletionDraft[] | null {
  if (!cfg?.classes) return null

  const cleanType = expectedType.replace(/<[^>]+>/g, "").trim()
  const items: CompletionDraft[] = []

  for (const [className, cls] of Object.entries(cfg.classes)) {
    if (!isSinceAvailable(cls.since)) continue
    if (className === cleanType) continue
    if (cls.implements?.includes(cleanType) || className.toLowerCase().includes(cleanType.toLowerCase())) {
      items.push({
        label: className,
        kind: monaco.languages.CompletionItemKind.Class,
        insertText: `new ${className}<>($1)`,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        detail: cls.detail,
        sortText: "0",
      })
    }
  }

  return items.length > 0 ? items : null
}

function getImportMap(cfg: PluginManifest["engineConfig"]): {
  defaultImports: Record<string, string>
  cfgImports: Record<string, string>
} {
  const defaultImports: Record<string, string> = {
    ArrayList: "java.util.ArrayList",
    LinkedList: "java.util.LinkedList",
    HashMap: "java.util.HashMap",
    HashSet: "java.util.HashSet",
    TreeMap: "java.util.TreeMap",
    TreeSet: "java.util.TreeSet",
    LinkedHashMap: "java.util.LinkedHashMap",
    LinkedHashSet: "java.util.LinkedHashSet",
    PriorityQueue: "java.util.PriorityQueue",
    ArrayDeque: "java.util.ArrayDeque",
    Stack: "java.util.Stack",
    Vector: "java.util.Vector",
    Hashtable: "java.util.Hashtable",
    Collections: "java.util.Collections",
    Arrays: "java.util.Arrays",
    Comparator: "java.util.Comparator",
    Iterator: "java.util.Iterator",
    ListIterator: "java.util.ListIterator",
    Spliterator: "java.util.Spliterator",
    Random: "java.util.Random",
    Scanner: "java.util.Scanner",
    Date: "java.util.Date",
    Calendar: "java.util.Calendar",
    LocalDate: "java.time.LocalDate",
    LocalTime: "java.time.LocalTime",
    LocalDateTime: "java.time.LocalDateTime",
    ZonedDateTime: "java.time.ZonedDateTime",
    Instant: "java.time.Instant",
    Duration: "java.time.Duration",
    Period: "java.time.Period",
    DateTimeFormatter: "java.time.format.DateTimeFormatter",
    BigDecimal: "java.math.BigDecimal",
    BigInteger: "java.math.BigInteger",
  }

  const cfgImports: Record<string, string> = {}
  if (cfg?.imports) {
    for (const imp of cfg.imports) {
      const parts = imp.label.split(".")
      const simpleName = parts[parts.length - 1]
      cfgImports[simpleName] = imp.label
      cfgImports[imp.label] = imp.label
    }
  }

  return { defaultImports, cfgImports }
}

function resolveAutoImportCompletion(
  lineUntilCursor: string,
  model: editor.ITextModel,
  _position: Position,
  cfg: PluginManifest["engineConfig"],
  monaco: Monaco,
): CompletionDraft[] | null {
  if (!cfg) return null

  const trimmed = lineUntilCursor.trim()
  const wordMatch = trimmed.match(/^(\w+)$/)
  if (!wordMatch) return null

  const { defaultImports, cfgImports } = getImportMap(cfg)
  const items: CompletionDraft[] = []

  for (const [simpleName, fullPath] of Object.entries(defaultImports)) {
    if (simpleName.toLowerCase().includes(wordMatch[1].toLowerCase())) {
      items.push(createAutoImportItem(simpleName, fullPath, model, monaco))
    }
  }

  for (const [simpleName, fullPath] of Object.entries(cfgImports)) {
    if (items.some((i) => i.label === simpleName)) continue
    if (simpleName === fullPath) continue
    if (simpleName.toLowerCase().includes(wordMatch[1].toLowerCase())) {
      items.push(createAutoImportItem(simpleName, fullPath, model, monaco))
    }
  }

  return items.length > 0 ? items : null
}

function createAutoImportItem(
  simpleName: string,
  fullPath: string,
  model: editor.ITextModel,
  monaco: Monaco,
): CompletionDraft {
  const importLine = `import ${fullPath};`

  const existingImports = model.getValue()
  const alreadyImported = existingImports.includes(importLine)

  const item: CompletionDraft = {
    label: simpleName,
    kind: monaco.languages.CompletionItemKind.Class,
    insertText: simpleName,
    detail: fullPath,
    sortText: "03",
  }

  if (!alreadyImported) {
    const lastImportLine = findLastImportLine(model)
    item.additionalTextEdits = [{
      range: {
        startLineNumber: lastImportLine + 1,
        startColumn: 1,
        endLineNumber: lastImportLine + 1,
        endColumn: 1,
      },
      text: `${importLine}\n`,
    }]
    item.detail = `${fullPath} (auto-import)`
  }

  return item
}

function findLastImportLine(model: editor.ITextModel): number {
  const lineCount = model.getLineCount()
  let lastImportLine = 0
  for (let i = 1; i <= Math.min(lineCount, 50); i++) {
    const line = model.getLineContent(i).trim()
    if (line.startsWith("import ") || line.startsWith("package ") || line.startsWith("//") || line === "") {
      lastImportLine = i
    } else if (line) {
      break
    }
  }
  return lastImportLine || 1
}

let registeredLanguages = new Set<string>()

function registerFromManifest(monaco: Monaco, manifest: PluginManifest): DisposableLike {
  const cfg = manifest.engineConfig
  if (!cfg) return NOOP_DISPOSABLE

  const languages = manifest.languages || (manifest.language ? [manifest.language] : [])
  if (languages.length === 0) return NOOP_DISPOSABLE

  const disposables: DisposableLike[] = []

  for (const lang of languages) {
    if (registeredLanguages.has(lang)) continue
    registeredLanguages.add(lang)

    disposables.push(editorLanguageFeatureService.registerCompletionItemProvider(lang, {
      triggerCharacters: [".", " ", "(", "@", "#", "\"", "<"],
      provideCompletionItems(model, position) {
        const lineUntilCursor = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        })

        const items: CompletionDraft[] = []

        const postfixItems = resolvePostfixCompletion(lineUntilCursor, model, position, cfg, monaco)
        if (postfixItems) return { suggestions: withCompletionItemRanges(postfixItems, position, model) }

        const dotItems = resolveDotCompletion(lineUntilCursor, cfg, monaco)
        if (dotItems) return { suggestions: withCompletionItemRanges(dotItems, position, model) }

        const smartItems = resolveSmartTypeCompletion(lineUntilCursor, cfg, monaco)
        if (smartItems) return { suggestions: withCompletionItemRanges(smartItems, position, model) }

        const importItems = resolveImportCompletion(lineUntilCursor, cfg, monaco)
        if (importItems) {
          const autoItems = resolveAutoImportCompletion(lineUntilCursor, model, position, cfg, monaco)
          const allItems = autoItems ? [...importItems, ...autoItems] : importItems
          return { suggestions: withCompletionItemRanges(allItems, position, model) }
        }

        const autoItems = resolveAutoImportCompletion(lineUntilCursor, model, position, cfg, monaco)
        if (autoItems) return { suggestions: withCompletionItemRanges(autoItems, position, model) }

        collectTopLevelItems(cfg, monaco, items)

        if (manifest.snippets && manifest.snippets.length > 0) {
          for (const s of manifest.snippets) {
            items.push({
              label: s.label,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: s.insertText,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              detail: s.detail,
              sortText: "0",
            })
          }
        }

        return { suggestions: withCompletionItemRanges(items, position, model) }
      },
    }, monaco, {
      id: `manifest-completion:${manifest.id}:${lang}`,
      source: "intellisense",
    }))
  }

  return combineDisposables(...disposables)
}

export function registerAllIntellisense(monaco: Monaco): DisposableLike {
  registeredLanguages = new Set()
  const manifests = getActiveManifests()
  const disposables: DisposableLike[] = []
  for (const manifest of manifests) {
    disposables.push(registerFromManifest(monaco, manifest))
  }
  return combineDisposables(...disposables)
}

export function reloadIntellisense(monaco: Monaco): DisposableLike {
  registeredLanguages = new Set()
  return registerAllIntellisense(monaco)
}
