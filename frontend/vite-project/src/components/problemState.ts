import { computed, reactive } from "vue"
import {
  globalProblemsDiagnosticsService,
  makeProblemMarkerKey,
  sortDiagnostics,
  type Diagnostic,
  type DiagnosticSource,
  type ProblemsOwnerEvidenceSnapshot,
} from "../workbench/problemsDiagnosticsService"
import {
  globalMarkerService,
} from "../vscode-adapter/platform/markers/common/markers"

export type { Diagnostic, DiagnosticSource }

type DiagnosticInput = Omit<Diagnostic, "file" | "line" | "column" | "message" | "severity" | "diagnosticSource"> & {
  file?: string
  line?: number
  column?: number
  message?: string
  severity?: string
  diagnosticSource?: string
}

interface SourceDiagnostics {
  lint: Map<string, Diagnostic[]>
  lsp: Map<string, Diagnostic[]>
  compiler: Map<string, Diagnostic[]>
}

const state = reactive<{ diagnostics: Diagnostic[] }>({
  diagnostics: [],
})

const sourceDiags: SourceDiagnostics = {
  lint: reactive(new Map<string, Diagnostic[]>()) as Map<string, Diagnostic[]>,
  lsp: reactive(new Map<string, Diagnostic[]>()) as Map<string, Diagnostic[]>,
  compiler: reactive(new Map<string, Diagnostic[]>()) as Map<string, Diagnostic[]>,
}

const diagnosticSources = reactive<Map<string, DiagnosticSource>>(new Map())

const errorCount = computed(() => state.diagnostics.filter((d) => d.severity === "error").length)
const warningCount = computed(() => state.diagnostics.filter((d) => d.severity === "warning").length)
const infoCount = computed(() => state.diagnostics.filter((d) => d.severity === "info").length)
const aiCount = computed(() => state.diagnostics.filter((d) => d.severity === "ai").length)

const lintDiagnostics = computed(() => {
  const result: Diagnostic[] = []
  for (const diags of sourceDiags.lint.values()) {
    result.push(...diags)
  }
  return result
})

const lspDiagnostics = computed(() => {
  const result: Diagnostic[] = []
  for (const diags of sourceDiags.lsp.values()) {
    result.push(...diags)
  }
  return result
})

const compilerDiagnostics = computed(() => {
  const result: Diagnostic[] = []
  for (const diags of sourceDiags.compiler.values()) {
    result.push(...diags)
  }
  return result
})

interface FileDiagnosticGroup {
  file: string
  items: Diagnostic[]
}

const allDiagnostics = computed<FileDiagnosticGroup[]>(() => {
  const map = new Map<string, Diagnostic[]>()
  for (const diag of sortDiagnostics(state.diagnostics)) {
    const group = map.get(diag.file)
    if (group) {
      group.push(diag)
    } else {
      map.set(diag.file, [diag])
    }
  }
  return [...map.entries()].map(([file, items]) => ({ file, items }))
})

function addDiagnostics(diags: DiagnosticInput[]): void {
  globalProblemsDiagnosticsService.addDiagnostics(diags.map(normalizeDiagnosticInput))
  refreshFromMarkerService()
}

function clear(): void {
  globalProblemsDiagnosticsService.clear()
  refreshFromMarkerService()
}

function clearForFile(file: string): void {
  globalProblemsDiagnosticsService.clearForFile(file)
  refreshFromMarkerService()
}

function clearAiForFile(file: string): void {
  globalProblemsDiagnosticsService.clearAiForFile(file)
  refreshFromMarkerService()
}

function addLintDiagnostics(filePath: string, diags: DiagnosticInput[]): void {
  replaceSourceDiagnosticsForFile(filePath, "lint", diags)
}

function addLspDiagnostics(filePath: string, diags: DiagnosticInput[]): void {
  replaceSourceDiagnosticsForFile(filePath, "lsp", diags)
}

function addCompilerDiagnostics(filePath: string, diags: DiagnosticInput[]): void {
  replaceSourceDiagnosticsForFile(filePath, "compiler", diags)
}

function setDiagnostics(diags: Diagnostic[]): void {
  const sorted = sortDiagnostics(diags)
  state.diagnostics.splice(0, state.diagnostics.length, ...sorted)
}

function clearSourceDiagnostics(source: DiagnosticSource): void {
  globalProblemsDiagnosticsService.clearSourceDiagnostics(source)
  refreshFromMarkerService()
}

function createOwnerEvidenceSnapshot(): ProblemsOwnerEvidenceSnapshot {
  return globalProblemsDiagnosticsService.createOwnerEvidenceSnapshot({}, state.diagnostics)
}

function replaceSourceDiagnosticsForFile(filePath: string, source: DiagnosticSource, diags: DiagnosticInput[]): void {
  globalProblemsDiagnosticsService.replaceSourceDiagnosticsForFile(filePath, source, diags.map((diag) => normalizeDiagnosticInput({
    ...diag,
    file: filePath,
    diagnosticSource: source,
  })))
  refreshFromMarkerService()
}

function refreshFromMarkerService(): void {
  setDiagnostics(globalProblemsDiagnosticsService.getDiagnostics())
  rebuildCompatibilityIndexes(state.diagnostics)
}

function rebuildCompatibilityIndexes(diagnostics: readonly Diagnostic[]): void {
  diagnosticSources.clear()
  sourceDiags.lint.clear()
  sourceDiags.lsp.clear()
  sourceDiags.compiler.clear()

  for (const diag of diagnostics) {
    if (!diag.diagnosticSource) continue
    if (diag.diagnosticSource === "lint" || diag.diagnosticSource === "lsp" || diag.diagnosticSource === "compiler") {
      const sourceMap = sourceDiags[diag.diagnosticSource]
      const existing = sourceMap.get(diag.file) || []
      existing.push(diag)
      sourceMap.set(diag.file, existing)
    }
    diagnosticSources.set(makeProblemMarkerKey(diag), diag.diagnosticSource)
  }
}

function normalizeDiagnosticInput(diag: DiagnosticInput): Diagnostic {
  return {
    ...diag,
    file: String(diag.file || ""),
    line: Math.max(1, Number.isFinite(diag.line) ? Math.trunc(diag.line || 1) : 1),
    column: Math.max(1, Number.isFinite(diag.column) ? Math.trunc(diag.column || 1) : 1),
    message: String(diag.message || ""),
    severity: normalizeDiagnosticSeverity(diag.severity),
    diagnosticSource: normalizeDiagnosticSource(diag.diagnosticSource),
  }
}

function normalizeDiagnosticSeverity(severity: string | undefined): Diagnostic["severity"] {
  if (severity === "warning") return "warning"
  if (severity === "info") return "info"
  if (severity === "ai") return "ai"
  return "error"
}

function normalizeDiagnosticSource(source: string | undefined): DiagnosticSource | undefined {
  if (source === "monaco" || source === "lsp" || source === "lint" || source === "compiler") return source
  return undefined
}

const summary = computed(() => {
  const parts: string[] = []
  if (errorCount.value > 0) parts.push(`${errorCount.value} 个错误`)
  if (warningCount.value > 0) parts.push(`${warningCount.value} 个警告`)
  if (infoCount.value > 0) parts.push(`${infoCount.value} 条信息`)
  if (aiCount.value > 0) parts.push(`${aiCount.value} 个智能提示`)
  return parts.join(", ") || "未检测到问题"
})

function runAiScan(file: string, content: string): Diagnostic[] {
  const results: Diagnostic[] = []
  if (!content) return results

  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNumber = i + 1

    const trimmed = line.trim()

    if (/\bconsole\.log\b/.test(trimmed)) {
      results.push({
        file,
        line: lineNumber,
        column: 1,
        message: "生产代码中应避免 console.log",
        severity: "ai",
        source: "智能扫描",
      })
    }

    if (/['"`](sk-[a-zA-Z0-9]{20,})['"`]/.test(trimmed)) {
      results.push({
        file,
        line: lineNumber,
        column: 1,
        message: "检测到硬编码 API 密钥，请改用环境变量",
        severity: "ai",
        source: "智能扫描",
      })
    }

    if (/password\s*[=:]\s*['"`][^'"`]+['"`]/i.test(trimmed)) {
      results.push({
        file,
        line: lineNumber,
        column: 1,
        message: "检测到硬编码密码，请改用环境变量",
        severity: "ai",
        source: "智能扫描",
      })
    }

    if (/\bcatch\b\s*\([^)]*\)\s*\{\s*\}/.test(trimmed)) {
      results.push({
        file,
        line: lineNumber,
        column: 1,
        message: "空 catch 块会静默吞掉错误",
        severity: "ai",
        source: "智能扫描",
      })
    }

    if (/TODO|FIXME|HACK|XXX/.test(line) && !/^\s*\/\//.test(trimmed)) {
      results.push({
        file,
        line: lineNumber,
        column: 1,
        message: `未注释的任务标记：${trimmed.slice(0, 60)}`,
        severity: "ai",
        source: "智能扫描",
      })
    }

    if (/['"`]\w{32,}['"`]/.test(trimmed) && !/\bimport\b/.test(trimmed)) {
      results.push({
        file,
        line: lineNumber,
        column: 1,
        message: "可疑的长字符串字面量，可能是硬编码 token",
        severity: "ai",
        source: "智能扫描",
      })
    }

    if (/eval\s*\(/.test(line)) {
      results.push({
        file,
        line: lineNumber,
        column: 1,
        message: "避免使用 eval()，存在安全和性能风险",
        severity: "ai",
        source: "智能扫描",
      })
    }
  }

  if (lines.length > 800) {
    results.push({
      file,
      line: 1,
      column: 1,
      message: `文件超过 800 行（${lines.length} 行），建议拆分`,
      severity: "ai",
      source: "智能扫描",
    })
  }

  const longFunctions = findLongFunctions(lines)
  for (const func of longFunctions) {
    results.push({
      file,
      line: func.startLine,
      column: 1,
      message: `函数超过 50 行（${func.length} 行），建议抽取`,
      severity: "ai",
      source: "智能扫描",
    })
  }

  const deepNesting = findDeepNesting(lines)
  for (const nest of deepNesting) {
    results.push({
      file,
      line: nest.line,
      column: nest.depth * 2 + 1,
      message: `嵌套深度超过 3 层（当前 ${nest.depth} 层），建议使用提前返回`,
      severity: "ai",
      source: "智能扫描",
    })
  }

  return results
}

function findLongFunctions(lines: string[]): Array<{ startLine: number; length: number }> {
  const results: Array<{ startLine: number; length: number }> = []
  let funcStart = -1
  let braceDepth = 0
  let inFunction = false

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const hasOpen = (trimmed.match(/{/g) || []).length
    const hasClose = (trimmed.match(/}/g) || []).length

    if (
      /\b(function|=>|->)\b/.test(trimmed) &&
      !inFunction
    ) {
      funcStart = i
      inFunction = true
      braceDepth = 0
    }

    if (inFunction) {
      braceDepth += hasOpen - hasClose
      if (braceDepth <= 0 && i > funcStart) {
        const length = i - funcStart + 1
        if (length > 50) {
          results.push({ startLine: funcStart + 1, length })
        }
        inFunction = false
      }
    }
  }

  return results
}

function findDeepNesting(lines: string[]): Array<{ line: number; depth: number }> {
  const results: Array<{ line: number; depth: number }> = []
  let currentDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const openBrace = (trimmed.match(/\{\s*$/g) || []).length
    const closeBrace = (trimmed.match(/^\s*\}/g) || []).length

    if (closeBrace > 0) {
      currentDepth = Math.max(0, currentDepth - closeBrace)
    }

    if (currentDepth > 3) {
      results.push({ line: i + 1, depth: currentDepth })
    }

    if (openBrace > 0) {
      currentDepth += openBrace
      if (currentDepth > 3) {
        results.push({ line: i + 1, depth: currentDepth })
      }
    }
  }

  return results
}

globalMarkerService.onMarkerChanged(() => {
  refreshFromMarkerService()
})

refreshFromMarkerService()

export const problemState = {
  diagnostics: state.diagnostics,
  addDiagnostics,
  clear,
  clearForFile,
  clearAiForFile,
  runAiScan,
  errorCount,
  warningCount,
  infoCount,
  aiCount,
  summary,
  lintDiagnostics,
  lspDiagnostics,
  compilerDiagnostics,
  allDiagnostics,
  diagnosticSources,
  addLintDiagnostics,
  addLspDiagnostics,
  addCompilerDiagnostics,
  clearSourceDiagnostics,
  createOwnerEvidenceSnapshot,
}
