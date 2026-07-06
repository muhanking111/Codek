import { reactive, ref } from "vue"
import type * as MonacoNS from "monaco-editor"
import { editorLanguageFeatureService } from "../editor/editorLanguageFeatureService"

type Monaco = typeof import("monaco-editor")

const MAX_HISTORY = 50

export interface NavigationLocation {
  file: string
  line: number
  column: number
}

export interface SymbolInfo {
  name: string
  kind: string
  file: string
  line: number
  column: number
}

interface ReferenceResult {
  uri: string
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
}

interface WorkspaceSymbol {
  name: string
  kind: string
  file: string
  line: number
}

interface BreadcrumbEntry {
  name: string
  kind: string
  line: number
}

const DEFINITION_PATTERNS: RegExp[] = [
  /\b(function|class|const|let|var|interface|type|enum)\s+(\w+)/,
  /\bdef\s+(\w+)/,
  /\bfn\s+(\w+)/,
  /\bfunc\s+(\w+)/,
]

const SYMBOL_PATTERNS: Array<{ regex: RegExp; kind: string }> = [
  { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, kind: "function" },
  { regex: /^(?:export\s+)?class\s+(\w+)/, kind: "class" },
  { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)/, kind: "variable" },
  { regex: /^(?:export\s+)?interface\s+(\w+)/, kind: "interface" },
  { regex: /^(?:export\s+)?type\s+(\w+)/, kind: "type" },
  { regex: /^(?:export\s+)?enum\s+(\w+)/, kind: "enum" },
  { regex: /^def\s+(\w+)/, kind: "function" },
  { regex: /^fn\s+(\w+)/, kind: "function" },
  { regex: /^func\s+(\w+)/, kind: "function" },
  {
    regex: /^(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?(\w+)\s*\(/,
    kind: "method",
  },
]

export const referenceResults = ref<ReferenceResult[]>([])

const historyState = reactive({
  entries: [] as NavigationLocation[],
  currentIndex: -1,
  canGoBack: false,
  canGoForward: false,
})

export const navHistory = historyState

function updateHistoryFlags(): void {
  historyState.canGoBack = historyState.currentIndex > 0
  historyState.canGoForward = historyState.currentIndex < historyState.entries.length - 1
}

export function pushNavigationHistory(location: NavigationLocation): void {
  const entries = historyState.entries
  const idx = historyState.currentIndex

  if (idx < entries.length - 1) {
    entries.splice(idx + 1, entries.length - idx - 1)
  }

  if (
    entries.length > 0 &&
    entries[entries.length - 1].file === location.file &&
    entries[entries.length - 1].line === location.line
  ) {
    return
  }

  entries.push({ ...location })

  if (entries.length > MAX_HISTORY) {
    entries.shift()
  }

  historyState.currentIndex = entries.length - 1
  updateHistoryFlags()
}

export function navigateBack(editor: MonacoNS.editor.IStandaloneCodeEditor): void {
  if (historyState.currentIndex <= 0) return

  historyState.currentIndex -= 1
  updateHistoryFlags()

  const loc = historyState.entries[historyState.currentIndex]
  if (!loc) return

  editor.setPosition({ lineNumber: loc.line, column: loc.column })
  editor.revealLineInCenter(loc.line)
  editor.focus()
}

export function navigateForward(editor: MonacoNS.editor.IStandaloneCodeEditor): void {
  if (historyState.currentIndex >= historyState.entries.length - 1) return

  historyState.currentIndex += 1
  updateHistoryFlags()

  const loc = historyState.entries[historyState.currentIndex]
  if (!loc) return

  editor.setPosition({ lineNumber: loc.line, column: loc.column })
  editor.revealLineInCenter(loc.line)
  editor.focus()
}

export function goToDefinition(editor: MonacoNS.editor.IStandaloneCodeEditor, _monaco: Monaco): void {
  void _monaco

  try {
    const action = editor.getAction("editor.action.revealDefinition")
    if (action) {
      action.run()
      recordCurrentPosition(editor)
      return
    }
  } catch {
    /* action not available */
  }

  try {
    const action = editor.getAction("editor.action.peekDefinition")
    if (action) {
      action.run()
      recordCurrentPosition(editor)
      return
    }
  } catch {
    /* action not available */
  }

  fallbackDefinitionSearch(editor)
}

function fallbackDefinitionSearch(editor: MonacoNS.editor.IStandaloneCodeEditor): void {
  const model = editor.getModel()
  const position = editor.getPosition()
  if (!model || !position) return

  const word = model.getWordAtPosition(position)
  if (!word) return

  const fullText = model.getValue()
  const searchWord = word.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

  for (const pattern of DEFINITION_PATTERNS) {
    const fullPattern = new RegExp(pattern.source.replace("(\\w+)", searchWord))
    const match = fullPattern.exec(fullText)
    if (match) {
      const beforeMatch = fullText.slice(0, match.index)
      const line = beforeMatch.split("\n").length
      editor.setPosition({ lineNumber: line, column: 1 })
      editor.revealLineInCenter(line)
      editor.focus()
      recordCurrentPosition(editor)
      return
    }
  }
}

function recordCurrentPosition(editor: MonacoNS.editor.IStandaloneCodeEditor): void {
  const model = editor.getModel()
  if (!model) return

  pushNavigationHistory({
    file: model.uri.toString(),
    line: editor.getPosition()?.lineNumber ?? 1,
    column: editor.getPosition()?.column ?? 1,
  })
}

export function findReferences(editor: MonacoNS.editor.IStandaloneCodeEditor, monaco: Monaco): void {
  referenceResults.value = []

  const model = editor.getModel()
  const position = editor.getPosition()
  if (!model || !position) return

  try {
    const action = editor.getAction("editor.action.referenceSearch.trigger")
    if (action) {
      action.run()
      return
    }
  } catch {
    /* action not available */
  }

  void resolveReferencesInternal(model, position, monaco)
}

async function resolveReferencesInternal(
  model: MonacoNS.editor.ITextModel,
  position: MonacoNS.Position,
  _monaco: Monaco,
): Promise<void> {
  void _monaco

  const providerResults = await editorLanguageFeatureService.provideReferences(model, position, { includeDeclaration: true })
  if (providerResults.length > 0) {
    referenceResults.value = providerResults.map((location) => ({
      uri: location.uri.toString(),
      range: location.range,
    })).slice(0, 100)
    return
  }

  const word = model.getWordAtPosition(position)
  if (!word || word.word.length < 2) return

  const text = model.getValue()
  const searchWord = word.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`\\b${searchWord}\\b`, "g")
  const results: ReferenceResult[] = []
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    const before = text.slice(0, match.index)
    const line = before.split("\n").length
    const lastNewline = before.lastIndexOf("\n")
    const col = match.index - lastNewline
    results.push({
      uri: model.uri.toString(),
      range: {
        startLineNumber: line,
        startColumn: col + 1,
        endLineNumber: line,
        endColumn: col + 1 + word.word.length,
      },
    })
  }

  referenceResults.value = results.slice(0, 100)
}

export function goToLine(editor: MonacoNS.editor.IStandaloneCodeEditor): void {
  const model = editor.getModel()
  if (!model) return

  const maxLine = model.getLineCount()
  const input = window.prompt(`Go to line (1-${maxLine}):`)

  if (!input) return

  const line = parseInt(input, 10)
  if (isNaN(line) || line < 1 || line > maxLine) return

  editor.setPosition({ lineNumber: line, column: 1 })
  editor.revealLineInCenter(line)
  editor.focus()

  recordCurrentPosition(editor)
}

export function goToSymbolInFile(
  editor: MonacoNS.editor.IStandaloneCodeEditor,
  _monaco: Monaco,
): void {
  void _monaco

  const model = editor.getModel()
  if (!model) return

  const symbols = extractFileSymbols(model)

  if (symbols.length === 0) return

  if (symbols.length === 1) {
    const sym = symbols[0]
    editor.setPosition({ lineNumber: sym.line, column: 1 })
    editor.revealLineInCenter(sym.line)
    editor.focus()
    recordCurrentPosition(editor)
    return
  }

  const list = symbols
    .map((s, idx) => `${idx + 1}. [${s.kind}] ${s.name} (line ${s.line})`)
    .join("\n")
  const selection = window.prompt(`Symbols in file:\n${list}\n\nEnter number:`)

  if (!selection) return

  const idx = parseInt(selection, 10) - 1
  if (idx < 0 || idx >= symbols.length) return

  const sym = symbols[idx]
  editor.setPosition({ lineNumber: sym.line, column: 1 })
  editor.revealLineInCenter(sym.line)
  editor.focus()

  recordCurrentPosition(editor)
}

function extractFileSymbols(
  model: MonacoNS.editor.ITextModel,
): Array<{ name: string; kind: string; line: number }> {
  const text = model.getValue()
  const lines = text.split("\n")
  const results: Array<{ name: string; kind: string; line: number }> = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    for (const { regex, kind } of SYMBOL_PATTERNS) {
      const match = regex.exec(line)
      if (match) {
        results.push({ name: match[1], kind, line: i + 1 })
        break
      }
    }
  }

  return results
}

export function goToSymbolInWorkspace(
  symbols: WorkspaceSymbol[],
  onSelect: (sym: WorkspaceSymbol) => void,
): void {
  if (symbols.length === 0) return

  const query = (window.prompt("Search symbols by name:") || "").toLowerCase().trim()

  if (!query) {
    showSymbolList(symbols.slice(0, 10), onSelect, "Top symbols:")
    return
  }

  const filtered = symbols
    .filter((s) => s.name.toLowerCase().includes(query) || s.kind.toLowerCase().includes(query))
    .slice(0, 15)

  if (filtered.length === 0) return

  if (filtered.length === 1) {
    onSelect(filtered[0])
    return
  }

  showSymbolList(filtered, onSelect, `Matches for "${query}":`)
}

function showSymbolList(
  symbols: WorkspaceSymbol[],
  onSelect: (sym: WorkspaceSymbol) => void,
  title: string,
): void {
  const list = symbols
    .map((s, idx) => `${idx + 1}. [${s.kind}] ${s.name} (${s.file}:${s.line})`)
    .join("\n")

  const selection = window.prompt(`${title}\n${list}\n\nEnter number:`)
  if (!selection) return

  const idx = parseInt(selection, 10) - 1
  if (idx < 0 || idx >= symbols.length) return

  onSelect(symbols[idx])
}

export function getBreadcrumbPath(
  editor: MonacoNS.editor.IStandaloneCodeEditor,
  _monaco: Monaco,
): BreadcrumbEntry[] {
  void _monaco

  const model = editor.getModel()
  const position = editor.getPosition()
  if (!model || !position) return []

  const text = model.getValue()
  const lines = text.split("\n")
  const currentLine = position.lineNumber
  const path: BreadcrumbEntry[] = []
  const scopePatterns: Array<{ regex: RegExp; kind: string }> = [
    { regex: /^\s*(?:export\s+)?class\s+(\w+)/, kind: "class" },
    { regex: /^\s*(?:export\s+)?interface\s+(\w+)/, kind: "interface" },
    { regex: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/, kind: "function" },
    { regex: /^\s*(?:export\s+)?type\s+(\w+)/, kind: "type" },
    { regex: /^\s*(?:export\s+)?enum\s+(\w+)/, kind: "enum" },
    { regex: /^class\s+(\w+)/, kind: "class" },
    { regex: /^def\s+(\w+)/, kind: "function" },
  ]

  for (let i = currentLine - 1; i >= 0 && path.length < 5; i--) {
    const line = lines[i]
    for (const { regex, kind } of scopePatterns) {
      const match = regex.exec(line)
      if (match) {
        path.unshift({ name: match[1], kind, line: i + 1 })
        break
      }
    }
  }

  return path
}

export function setupNavigationProvider(
  editor: MonacoNS.editor.IStandaloneCodeEditor,
  monaco: Monaco,
): void {
  void editor

  const languageSelector = { scheme: "*" } as MonacoNS.languages.LanguageSelector

  try {
    monaco.languages.registerDefinitionProvider(languageSelector, {
      provideDefinition(model, position) {
        const word = model.getWordAtPosition(position)
        if (!word) return null

        const text = model.getValue()
        const searchWord = word.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

        for (const pattern of DEFINITION_PATTERNS) {
          const fullPattern = new RegExp(pattern.source.replace("(\\w+)", searchWord))
          const match = fullPattern.exec(text)
          if (match) {
            const before = text.slice(0, match.index)
            const line = before.split("\n").length
            const lastNewline = before.lastIndexOf("\n")
            const start = match.index - lastNewline

            return {
              uri: model.uri,
              range: {
                startLineNumber: line,
                startColumn: start + 1,
                endLineNumber: line,
                endColumn: start + 1 + word.word.length,
              },
            }
          }
        }

        return null
      },
    })
  } catch {
    /* provider registration failed */
  }

  try {
    editorLanguageFeatureService.registerReferenceProvider(languageSelector, {
      provideReferences(model, position, _context) {
        void _context

        const word = model.getWordAtPosition(position)
        if (!word || word.word.length < 2) return []

        const text = model.getValue()
        const searchWord = word.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const re = new RegExp(`\\b${searchWord}\\b`, "g")
        const locations: MonacoNS.languages.Location[] = []
        let match: RegExpExecArray | null

        while ((match = re.exec(text)) !== null) {
          const before = text.slice(0, match.index)
          const line = before.split("\n").length
          const lastNewline = before.lastIndexOf("\n")
          const col = match.index - lastNewline
          locations.push({
            uri: model.uri,
            range: {
              startLineNumber: line,
              startColumn: col + 1,
              endLineNumber: line,
              endColumn: col + 1 + word.word.length,
            },
          })
        }

        return locations.slice(0, 100)
      },
    }, monaco)
  } catch {
    /* provider registration failed */
  }

  editor.onDidChangeCursorPosition((e: MonacoNS.editor.ICursorPositionChangedEvent) => {
    const model = editor.getModel()
    if (!model) return
    pushNavigationHistory({
      file: model.uri.toString(),
      line: e.position.lineNumber,
      column: e.position.column,
    })
  })
}
