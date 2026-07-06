import { getLargeFileState, normalizeRelativePath, readProjectFile, workspace } from "./manager"
import { discoverWorkspaceFiles, knownWorkspaceFiles } from "./fileDiscovery"
import {
  analysisCache,
  analysisState,
  getFileAnalysis,
  getFileDiagnostics,
  getFileOutline,
  getProjectSymbols,
  getSymbolReferences,
  setSelectedSymbol,
} from "./analysisState"

const MAX_ANALYZED_FILES = 180
const MAX_SYMBOLS_PER_FILE = 120
const MAX_REFERENCES_PER_FILE = 200

let typeScriptRuntimePromise = null

function loadTypeScriptRuntime() {
  if (!typeScriptRuntimePromise) {
    typeScriptRuntimePromise = import("typescript")
  }
  return typeScriptRuntimePromise
}

function walkNodes(ts, node, visit) {
  visit(node)
  ts.forEachChild(node, (child) => walkNodes(ts, child, visit))
}

function getScriptKind(ts, pathValue) {
  const extension = String(pathValue || "").split(".").pop().toLowerCase()
  const map = {
    ts: ts.ScriptKind.TS,
    tsx: ts.ScriptKind.TSX,
    js: ts.ScriptKind.JS,
    jsx: ts.ScriptKind.JSX,
    mjs: ts.ScriptKind.JS,
    cjs: ts.ScriptKind.JS,
    json: ts.ScriptKind.JSON,
    vue: ts.ScriptKind.TS,
  }
  return map[extension] || ts.ScriptKind.TS
}

function extractVueScripts(content) {
  const blocks = []
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi
  let match

  while ((match = scriptRe.exec(content)) !== null) {
    blocks.push(match[1])
  }

  return blocks.join("\n")
}

function getAnalysisSource(pathValue, content) {
  const extension = String(pathValue || "").split(".").pop().toLowerCase()
  if (extension === "vue") {
    return extractVueScripts(content)
  }

  return content
}

function positionOf(sourceFile, node) {
  const start = node.getStart(sourceFile)
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start)
  return {
    line: line + 1,
    column: character + 1,
  }
}

function addSymbol(symbols, sourceFile, node, name, kind, extra = {}) {
  if (!name || symbols.length >= MAX_SYMBOLS_PER_FILE) return

  const position = positionOf(sourceFile, node)
  symbols.push({
    name,
    kind,
    path: extra.path || sourceFile.fileName,
    line: position.line,
    column: position.column,
    detail: extra.detail || "",
  })
}

async function analyzeSource(pathValue, content) {
  const ts = await loadTypeScriptRuntime()
  const sourceText = getAnalysisSource(pathValue, content)
  const scriptKind = getScriptKind(ts, pathValue)
  const sourceFile = ts.createSourceFile(pathValue, sourceText, ts.ScriptTarget.Latest, true, scriptKind)
  const symbols = []
  const diagnostics = []
  const references = {}

  for (const diagnostic of sourceFile.parseDiagnostics || []) {
    const start = diagnostic.start || 0
    const location = sourceFile.getLineAndCharacterOfPosition(start)
    diagnostics.push({
      path: pathValue,
      line: location.line + 1,
      column: location.character + 1,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      severity: "error",
      code: diagnostic.code,
    })
  }

  walkNodes(ts, sourceFile, (node) => {
    if (ts.isIdentifier(node)) {
      references[node.text] = (references[node.text] || 0) + 1
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      addSymbol(symbols, sourceFile, node, node.name.text, "function")
      return
    }

    if (ts.isClassDeclaration(node) && node.name) {
      addSymbol(symbols, sourceFile, node, node.name.text, "class")
      return
    }

    if (ts.isInterfaceDeclaration(node)) {
      addSymbol(symbols, sourceFile, node, node.name.text, "interface")
      return
    }

    if (ts.isTypeAliasDeclaration(node)) {
      addSymbol(symbols, sourceFile, node, node.name.text, "type")
      return
    }

    if (ts.isEnumDeclaration(node)) {
      addSymbol(symbols, sourceFile, node, node.name.text, "enum")
      return
    }

    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      const parent = node.parent && ts.isClassLike(node.parent) ? node.parent.name?.text || "" : ""
      addSymbol(
        symbols,
        sourceFile,
        node,
        node.name.text,
        "method",
        { detail: parent ? `class ${parent}` : "" },
      )
      return
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue

        const name = declaration.name.text
        const initializer = declaration.initializer
        const kind = initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
          ? "function"
          : "variable"
        addSymbol(symbols, sourceFile, declaration, name, kind)
      }
      return
    }

    if (ts.isImportSpecifier(node)) {
      const name = node.propertyName?.text || node.name?.text
      if (name) addSymbol(symbols, sourceFile, node, name, "import")
      return
    }

    if (ts.isImportClause(node) && node.name) {
      addSymbol(symbols, sourceFile, node, node.name.text, "import")
    }
  })

  const sortedSymbols = symbols
    .sort((left, right) => (left.line - right.line) || (left.column - right.column))
    .slice(0, MAX_SYMBOLS_PER_FILE)

  const referenceEntries = Object.entries(references)
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_REFERENCES_PER_FILE)

  return {
    path: pathValue,
    content,
    symbols: sortedSymbols,
    diagnostics,
    references: Object.fromEntries(referenceEntries),
    sourceText,
  }
}

function rebuildProjectIndexes() {
  const symbols = []
  const referenceBuckets = {}

  for (const [pathValue, cachedEntry] of analysisCache.entries()) {
    const analysis = cachedEntry?.analysis || cachedEntry
    if (!analysis || typeof analysis !== "object") continue
    analysisState.files[pathValue] = analysis

    const fileSymbols = Array.isArray(analysis.symbols) ? analysis.symbols : []
    for (const symbol of fileSymbols) {
      symbols.push({
        ...symbol,
        path: pathValue,
      })
    }

    const references = analysis.references && typeof analysis.references === "object" ? analysis.references : {}
    for (const [name, count] of Object.entries(references)) {
      if (!referenceBuckets[name]) {
        referenceBuckets[name] = { total: 0, files: [] }
      }

      referenceBuckets[name].total += count
      referenceBuckets[name].files.push({
        path: pathValue,
        count,
      })
    }
  }

  analysisState.projectSymbols = symbols.sort((left, right) => {
    if (left.name !== right.name) return left.name.localeCompare(right.name)
    if (left.path !== right.path) return left.path.localeCompare(right.path)
    return left.line - right.line
  })
  analysisState.projectReferences = referenceBuckets
}

export function removeFileAnalysis(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath) return
  analysisCache.delete(relativePath)
  delete analysisState.files[relativePath]
  rebuildProjectIndexes()
}

export async function refreshFileAnalysis(pathValue) {
  const relativePath = normalizeRelativePath(pathValue)
  if (!relativePath) return null
  if (getLargeFileState(relativePath)?.mode === "range") {
    removeFileAnalysis(relativePath)
    return null
  }

  const content = await readProjectFile(relativePath)
  if (typeof content !== "string") {
    removeFileAnalysis(relativePath)
    return null
  }

  const cached = analysisCache.get(relativePath)
  if (cached && cached.content === content) {
    analysisState.files[relativePath] = cached.analysis
    return cached.analysis
  }

  const analysis = await analyzeSource(relativePath, content)
  analysisCache.set(relativePath, { content, analysis })
  analysisState.files[relativePath] = analysis
  rebuildProjectIndexes()
  return analysis
}

export async function refreshWorkspaceAnalysis(options = {}) {
  const maxAnalyzedFiles = await resolveAnalysisBudget()
  const pathSet = new Set(options.knownOnly
    ? knownWorkspaceFiles(maxAnalyzedFiles)
    : await discoverWorkspaceFiles({ limit: maxAnalyzedFiles }))
  for (const pathValue of analysisCache.keys()) {
    const relativePath = normalizeRelativePath(pathValue)
    if (relativePath) pathSet.add(relativePath)
  }
  for (const pathValue of workspace.openFiles || []) {
    const relativePath = normalizeRelativePath(pathValue)
    if (relativePath) pathSet.add(relativePath)
  }
  if (workspace.activeFile) {
    const relativePath = normalizeRelativePath(workspace.activeFile)
    if (relativePath) pathSet.add(relativePath)
  }

  const paths = Array.from(pathSet).slice(0, maxAnalyzedFiles)
  const seen = new Set(paths)

  for (const pathValue of Array.from(analysisCache.keys())) {
    if (!seen.has(pathValue)) {
      analysisCache.delete(pathValue)
      delete analysisState.files[pathValue]
    }
  }

  for (const pathValue of paths) {
    await refreshFileAnalysis(pathValue)
  }

  rebuildProjectIndexes()
}

async function resolveAnalysisBudget() {
  if (typeof window === "undefined" || typeof window.codek?.getWorkspaceScaleProfile !== "function") {
    return MAX_ANALYZED_FILES
  }
  try {
    const profile = await window.codek.getWorkspaceScaleProfile()
    return Number(profile?.budgets?.analysisMaxFiles || MAX_ANALYZED_FILES)
  } catch {
    return MAX_ANALYZED_FILES
  }
}

export {
  analysisState,
  getFileAnalysis,
  getFileOutline,
  getFileDiagnostics,
  getProjectSymbols,
  getSymbolReferences,
  setSelectedSymbol,
}
