export interface FormatterConfig {
  id: string
  label: string
  command: string
  args: string[]
  fileTypes: string[]
  languageIds: string[]
  canFormatRange: boolean
  canFormatOnType: boolean
}

export interface FormatResult {
  success: boolean
  formatted: string
  error?: string
}

export interface FormatRange {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

type IpcInvoker = (channel: string, ...args: unknown[]) => Promise<unknown>

const DEFAULT_FORMATTERS: ReadonlyArray<FormatterConfig> = [
  {
    id: "prettier",
    label: "Prettier",
    command: "npx",
    args: ["prettier", "--stdin-filepath", "${filePath}"],
    fileTypes: [".js", ".ts", ".jsx", ".tsx", ".vue", ".css", ".scss", ".less", ".json", ".md", ".yaml", ".yml", ".html"],
    languageIds: ["javascript", "typescript", "javascriptreact", "typescriptreact", "vue", "css", "scss", "less", "json", "markdown", "yaml", "html"],
    canFormatRange: true,
    canFormatOnType: false,
  },
  {
    id: "black",
    label: "Black",
    command: "black",
    args: ["-", "--stdin-filename", "${filePath}"],
    fileTypes: [".py"],
    languageIds: ["python"],
    canFormatRange: false,
    canFormatOnType: false,
  },
  {
    id: "gofmt",
    label: "gofmt",
    command: "gofmt",
    args: [],
    fileTypes: [".go"],
    languageIds: ["go"],
    canFormatRange: false,
    canFormatOnType: false,
  },
  {
    id: "rustfmt",
    label: "rustfmt",
    command: "rustfmt",
    args: ["--emit", "stdout"],
    fileTypes: [".rs"],
    languageIds: ["rust"],
    canFormatRange: false,
    canFormatOnType: false,
  },
  {
    id: "clang-format",
    label: "clang-format",
    command: "clang-format",
    args: ["--assume-filename", "${filePath}"],
    fileTypes: [".c", ".cpp", ".h", ".hpp", ".cc", ".cxx"],
    languageIds: ["c", "cpp"],
    canFormatRange: true,
    canFormatOnType: false,
  },
]

function getFileExtension(filePath: string): string {
  const dotIndex = filePath.lastIndexOf(".")
  return dotIndex >= 0 ? filePath.slice(dotIndex) : ""
}

function resolveArgs(args: string[], filePath: string): string[] {
  return args.map((arg) => arg.replace("${filePath}", filePath))
}

export class FormatManager {
  private readonly formatters: Map<string, FormatterConfig> = new Map()
  private ipcInvoker: IpcInvoker | null = null
  public formatOnSave = false

  constructor() {
    for (const formatter of DEFAULT_FORMATTERS) {
      this.formatters.set(formatter.id, formatter)
    }
  }

  setIpcInvoker(invoker: IpcInvoker): void {
    this.ipcInvoker = invoker
  }

  registerFormatter(config: FormatterConfig): void {
    this.formatters.set(config.id, config)
  }

  unregisterFormatter(id: string): boolean {
    return this.formatters.delete(id)
  }

  getFormatterForFile(filePath: string): FormatterConfig | undefined {
    const ext = getFileExtension(filePath)
    for (const formatter of this.formatters.values()) {
      if (formatter.fileTypes.includes(ext)) {
        return formatter
      }
    }
    return undefined
  }

  getFormatterForLanguage(languageId: string): FormatterConfig | undefined {
    for (const formatter of this.formatters.values()) {
      if (formatter.languageIds.includes(languageId)) {
        return formatter
      }
    }
    return undefined
  }

  getFormatter(id: string): FormatterConfig | undefined {
    return this.formatters.get(id)
  }

  getAllFormatters(): FormatterConfig[] {
    return Array.from(this.formatters.values())
  }

  async formatFile(filePath: string, content: string): Promise<FormatResult> {
    const formatter = this.getFormatterForFile(filePath)
    if (!formatter) {
      return { success: false, formatted: content, error: "No formatter found for this file type" }
    }

    if (!this.ipcInvoker) {
      return { success: false, formatted: content, error: "IPC invoker not configured" }
    }

    try {
      const args = resolveArgs(formatter.args, filePath)
      const result = await this.ipcInvoker("format:run", {
        command: formatter.command,
        args,
        input: content,
      }) as { stdout: string; stderr: string; exitCode: number }

      if (result.exitCode !== 0) {
        return {
          success: false,
          formatted: content,
          error: result.stderr || `Formatter exited with code ${result.exitCode}`,
        }
      }

      return { success: true, formatted: result.stdout }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown formatting error"
      return { success: false, formatted: content, error: message }
    }
  }

  async formatRange(
    filePath: string,
    content: string,
    range: FormatRange,
  ): Promise<FormatResult> {
    const formatter = this.getFormatterForFile(filePath)
    if (!formatter) {
      return { success: false, formatted: content, error: "No formatter found for this file type" }
    }

    if (!formatter.canFormatRange) {
      return { success: false, formatted: content, error: "Formatter does not support range formatting" }
    }

    if (!this.ipcInvoker) {
      return { success: false, formatted: content, error: "IPC invoker not configured" }
    }

    try {
      const args = resolveArgs(formatter.args, filePath)
      args.push(
        "--range-start", String(range.startColumn),
        "--range-end", String(range.endColumn),
      )

      const result = await this.ipcInvoker("format:run", {
        command: formatter.command,
        args,
        input: content,
      }) as { stdout: string; stderr: string; exitCode: number }

      if (result.exitCode !== 0) {
        return {
          success: false,
          formatted: content,
          error: result.stderr || `Formatter exited with code ${result.exitCode}`,
        }
      }

      return { success: true, formatted: result.stdout }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown formatting error"
      return { success: false, formatted: content, error: message }
    }
  }
}

export const formatManager = new FormatManager()
