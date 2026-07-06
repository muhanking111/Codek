// @ts-nocheck
import { detectLanguageForPath } from "../languageRegistry"
import type { LspServerConfig as LspServerRuntimeConfig } from "./manager"

export type InstallStatus =
  | "unknown"
  | "installed"
  | "not-installed"
  | "checking"
  | "installing"
  | "error"

export interface LspServerConfig {
  id: string
  name: string
  languages: string[]
  command: string
  args: string[]
  installCommand: string
  installCheck: string
  initializationOptions?: Record<string, unknown>
  settings?: Record<string, unknown>
  filePatterns?: string[]
}

export const LSP_SERVER_CONFIGS: LspServerConfig[] = [
  {
    id: "typescript",
    name: "TypeScript Language Server",
    languages: ["typescript", "javascript", "typescriptreact", "javascriptreact"],
    command: "typescript-language-server",
    args: ["--stdio"],
    installCommand: "npm install -g typescript-language-server typescript",
    installCheck: "typescript-language-server --version",
    initializationOptions: {
      provideFormatter: true,
      tsserverPath: "tsserver",
    },
    filePatterns: [
      "**/*.ts",
      "**/*.tsx",
      "**/*.js",
      "**/*.jsx",
    ],
  },
  {
    id: "python",
    name: "Python LSP Server (pylsp)",
    languages: ["python"],
    command: "pylsp",
    args: [],
    installCommand: "pip install python-lsp-server[all]",
    installCheck: "pylsp --version",
    filePatterns: ["**/*.py"],
  },
  {
    id: "go",
    name: "Go Language Server (gopls)",
    languages: ["go"],
    command: "gopls",
    args: ["-mode=stdio"],
    installCommand: "go install golang.org/x/tools/gopls@latest",
    installCheck: "gopls version",
    filePatterns: ["**/*.go"],
  },
  {
    id: "rust",
    name: "Rust Analyzer",
    languages: ["rust"],
    command: "rust-analyzer",
    args: [],
    installCommand: "rustup component add rust-analyzer",
    installCheck: "rust-analyzer --version",
    filePatterns: ["**/*.rs"],
  },
  {
    id: "java",
    name: "Eclipse JDT Language Server",
    languages: ["java"],
    command: "jdtls",
    args: [],
    installCommand: "See: https://github.com/eclipse-jdtls/eclipse.jdt.ls",
    installCheck: "jdtls --version",
    initializationOptions: {
      settings: { java: { autobuild: { enabled: true } } },
    },
    filePatterns: ["**/*.java"],
  },
  {
    id: "css",
    name: "CSS Language Server",
    languages: ["css", "scss", "less"],
    command: "vscode-css-language-server",
    args: ["--stdio"],
    installCommand: "npm install -g vscode-langservers-extracted",
    installCheck: "vscode-css-language-server --version",
    filePatterns: [
      "**/*.css",
      "**/*.scss",
      "**/*.less",
    ],
  },
  {
    id: "html",
    name: "HTML Language Server",
    languages: ["html", "vue"],
    command: "vscode-html-language-server",
    args: ["--stdio"],
    installCommand: "npm install -g vscode-langservers-extracted",
    installCheck: "vscode-html-language-server --version",
    filePatterns: [
      "**/*.html",
      "**/*.htm",
      "**/*.vue",
    ],
  },
  {
    id: "json",
    name: "JSON Language Server",
    languages: ["json", "jsonc"],
    command: "vscode-json-language-server",
    args: ["--stdio"],
    installCommand: "npm install -g vscode-langservers-extracted",
    installCheck: "vscode-json-language-server --version",
    initializationOptions: {
      provideFormatter: true,
    },
    filePatterns: ["**/*.json"],
  },
]

export function getServerConfigForLanguage(languageId: string): LspServerConfig | undefined {
  return LSP_SERVER_CONFIGS.find((config) => config.languages.includes(languageId))
}

export function getServerConfigById(id: string): LspServerConfig | undefined {
  return LSP_SERVER_CONFIGS.find((config) => config.id === id)
}

export function getServerConfigForFile(filePath: string): LspServerConfig | undefined {
  const languageId = detectLanguageForPath(filePath)
  const config = getServerConfigForLanguage(languageId)
  if (config) return config
  return findByFilePattern(filePath)
}

export function getAllServerConfigs(): LspServerConfig[] {
  return [...LSP_SERVER_CONFIGS]
}

export function toLspServerRuntimeConfig(config: LspServerConfig): LspServerRuntimeConfig {
  return {
    id: config.id,
    command: config.command,
    args: [...config.args],
    languages: [...config.languages],
    filePatterns: config.filePatterns?.length ? [...config.filePatterns] : undefined,
    initializationOptions: config.initializationOptions,
  }
}

export async function checkServerInstalled(config: LspServerConfig): Promise<boolean> {
  if (!window.codek?.runCommand) return false
  try {
    const result = await window.codek.runCommand(config.installCheck)
    return result.exitCode === 0
  } catch {
    return false
  }
}

export async function installServer(config: LspServerConfig): Promise<boolean> {
  if (!window.codek?.runCommand) return false
  if (!config.installCommand) return false
  try {
    const result = await window.codek.runCommand(config.installCommand)
    return result.exitCode === 0
  } catch {
    return false
  }
}

function findByFilePattern(filePath: string): LspServerConfig | undefined {
  const normalized = filePath.replace(/\\/g, "/")
  return LSP_SERVER_CONFIGS.find((config) =>
    config.filePatterns?.some((pattern) => matchGlob(normalized, pattern)),
  )
}

function matchGlob(filePath: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
  try {
    return new RegExp(`^${regexStr}$`).test(filePath)
  } catch {
    return false
  }
}
