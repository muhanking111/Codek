import type { Diagnostic } from "../../components/problemState"
import { problemState } from "../../components/problemState"

export interface LinterConfig {
  id: string
  label: string
  command: string
  args: string[]
  fileTypes: string[]
  languageIds: string[]
  outputParser: "eslint" | "ruff" | "golangci-lint" | "custom"
  customParser?: (output: string) => RawLintDiagnostic[]
}

export interface RawLintDiagnostic {
  file: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
  severity: "error" | "warning" | "info"
  message: string
  ruleId?: string
}

type IpcInvoker = (channel: string, ...args: unknown[]) => Promise<unknown>

function getFileExtension(filePath: string): string {
  const dotIndex = filePath.lastIndexOf(".")
  return dotIndex >= 0 ? filePath.slice(dotIndex) : ""
}

function parseEslintOutput(output: string): RawLintDiagnostic[] {
  const results: RawLintDiagnostic[] = []
  try {
    const data = JSON.parse(output) as { files?: Array<{
      filePath: string
      messages: Array<{
        line: number
        column: number
        endLine?: number
        endColumn?: number
        severity: number
        message: string
        ruleId?: string
      }>
    }> }
    const files = data.files ?? []
    for (const file of files) {
      for (const msg of file.messages) {
        results.push({
          file: file.filePath,
          line: msg.line,
          column: msg.column,
          endLine: msg.endLine,
          endColumn: msg.endColumn,
          severity: msg.severity === 2 ? "error" : "warning",
          message: msg.message,
          ruleId: msg.ruleId ?? undefined,
        })
      }
    }
  } catch {
    const linePattern = /^\s*(.+?):(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s+(\S+))?\s*$/gm
    let match: RegExpExecArray | null
    while ((match = linePattern.exec(output)) !== null) {
      results.push({
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        severity: match[4] as "error" | "warning",
        message: match[5],
        ruleId: match[6] ?? undefined,
      })
    }
  }
  return results
}

function parseRuffOutput(output: string): RawLintDiagnostic[] {
  const results: RawLintDiagnostic[] = []
  try {
    const data = JSON.parse(output) as Array<{
      filename: string
      location: { row: number; column: number }
      end_location?: { row: number; column: number }
      severity?: string
      message: string
      code?: string
    }>
    for (const item of data) {
      results.push({
        file: item.filename,
        line: item.location.row,
        column: item.location.column,
        endLine: item.end_location?.row,
        endColumn: item.end_location?.column,
        severity: (item.severity as "error" | "warning") ?? "warning",
        message: item.message,
        ruleId: item.code,
      })
    }
  } catch {
    const linePattern = /^(.+?):(\d+):(\d+):\s+(\w+)\s+(.+?)\s+\[(.+?)\]$/gm
    let match: RegExpExecArray | null
    while ((match = linePattern.exec(output)) !== null) {
      results.push({
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        severity: match[4] === "E" ? "error" : "warning",
        message: match[5],
        ruleId: match[6],
      })
    }
  }
  return results
}

function parseGolangciLintOutput(output: string): RawLintDiagnostic[] {
  const results: RawLintDiagnostic[] = []
  try {
    const data = JSON.parse(output) as {
      Issues?: Array<{
        Pos: { Filename: string; Line: number; Column: number }
        Severity?: string
        Text: string
        FromLinter: string
      }>
    }
    const issues = data.Issues ?? []
    for (const issue of issues) {
      results.push({
        file: issue.Pos.Filename,
        line: issue.Pos.Line,
        column: issue.Pos.Column,
        severity: (issue.Severity as "error" | "warning") ?? "warning",
        message: issue.Text,
        ruleId: issue.FromLinter,
      })
    }
  } catch {
    const linePattern = /^(.+?):(\d+):(\d+):\s+(.+?)\s+\((\w+)\)$/gm
    let match: RegExpExecArray | null
    while ((match = linePattern.exec(output)) !== null) {
      results.push({
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        severity: "warning",
        message: match[4],
        ruleId: match[5],
      })
    }
  }
  return results
}

const DEFAULT_LINTERS: ReadonlyArray<LinterConfig> = [
  {
    id: "eslint",
    label: "ESLint",
    command: "npx",
    args: ["eslint", "--format", "json", "--stdin", "--stdin-filename", "${filePath}"],
    fileTypes: [".js", ".ts", ".jsx", ".tsx", ".vue"],
    languageIds: ["javascript", "typescript", "javascriptreact", "typescriptreact", "vue"],
    outputParser: "eslint",
  },
  {
    id: "ruff",
    label: "Ruff",
    command: "ruff",
    args: ["check", "--output-format", "json", "--stdin-filename", "${filePath}", "-"],
    fileTypes: [".py"],
    languageIds: ["python"],
    outputParser: "ruff",
  },
  {
    id: "golangci-lint",
    label: "golangci-lint",
    command: "golangci-lint",
    args: ["run", "--out-format", "json"],
    fileTypes: [".go"],
    languageIds: ["go"],
    outputParser: "golangci-lint",
  },
]

function resolveArgs(args: string[], filePath: string): string[] {
  return args.map((arg) => arg.replace("${filePath}", filePath))
}

export class LintManager {
  private readonly linters: Map<string, LinterConfig> = new Map()
  private ipcInvoker: IpcInvoker | null = null

  constructor() {
    for (const linter of DEFAULT_LINTERS) {
      this.linters.set(linter.id, linter)
    }
  }

  setIpcInvoker(invoker: IpcInvoker): void {
    this.ipcInvoker = invoker
  }

  registerLinter(config: LinterConfig): void {
    this.linters.set(config.id, config)
  }

  unregisterLinter(id: string): boolean {
    return this.linters.delete(id)
  }

  getLinterForFile(filePath: string): LinterConfig | undefined {
    const ext = getFileExtension(filePath)
    for (const linter of this.linters.values()) {
      if (linter.fileTypes.includes(ext)) {
        return linter
      }
    }
    return undefined
  }

  getLinterForLanguage(languageId: string): LinterConfig | undefined {
    for (const linter of this.linters.values()) {
      if (linter.languageIds.includes(languageId)) {
        return linter
      }
    }
    return undefined
  }

  getLinter(id: string): LinterConfig | undefined {
    return this.linters.get(id)
  }

  getAllLinters(): LinterConfig[] {
    return Array.from(this.linters.values())
  }

  parseLinterOutput(output: string, linterId: string): RawLintDiagnostic[] {
    const linter = this.linters.get(linterId)
    if (!linter) return []

    switch (linter.outputParser) {
      case "eslint":
        return parseEslintOutput(output)
      case "ruff":
        return parseRuffOutput(output)
      case "golangci-lint":
        return parseGolangciLintOutput(output)
      case "custom":
        return linter.customParser ? linter.customParser(output) : []
      default:
        return []
    }
  }

  async lintFile(filePath: string, content: string): Promise<RawLintDiagnostic[]> {
    const linter = this.getLinterForFile(filePath)
    if (!linter) return []

    if (!this.ipcInvoker) return []

    try {
      const args = resolveArgs(linter.args, filePath)
      const result = await this.ipcInvoker("lint:run", {
        command: linter.command,
        args,
        input: content,
      }) as { stdout: string; stderr: string; exitCode: number }

      const output = result.stdout || result.stderr
      if (!output) return []

      const diagnostics = this.parseLinterOutput(output, linter.id)
      this.syncToProblemState(filePath, diagnostics)
      return diagnostics
    } catch {
      return []
    }
  }

  private syncToProblemState(filePath: string, rawDiags: RawLintDiagnostic[]): void {
    const diags: Diagnostic[] = rawDiags.map((raw) => ({
      file: filePath,
      line: raw.line,
      column: raw.column,
      message: raw.ruleId ? `[${raw.ruleId}] ${raw.message}` : raw.message,
      severity: raw.severity,
      source: "linter",
      diagnosticSource: "lint" as const,
    }))

    problemState.addLintDiagnostics(filePath, diags)
  }
}

export const lintManager = new LintManager()
