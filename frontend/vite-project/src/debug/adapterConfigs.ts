import type { InstallStatus } from "../languages/lsp/serverConfigs"

export interface DapAdapterPreset {
  id: string
  name: string
  adapterType: string
  languages: string[]
  installCommand: string
  installCheck: string
  defaultLaunchConfig: Record<string, unknown>
}

export interface LaunchConfigOptions {
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  noDebug?: boolean
}

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  jsx: "javascriptreact",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
}

export const DAP_ADAPTER_CONFIGS: DapAdapterPreset[] = [
  {
    id: "node-debug",
    name: "Node.js Debug",
    adapterType: "node",
    languages: ["javascript", "typescript"],
    installCommand: "",
    installCheck: "node --version",
    defaultLaunchConfig: {
      type: "node",
      request: "launch",
      program: "${file}",
    },
  },
  {
    id: "python-debugpy",
    name: "Python (debugpy)",
    adapterType: "python",
    languages: ["python"],
    installCommand: "pip install debugpy",
    installCheck: 'python -c "import debugpy"',
    defaultLaunchConfig: {
      type: "python",
      request: "launch",
      program: "${file}",
    },
  },
  {
    id: "java-debug",
    name: "Java Debug",
    adapterType: "java",
    languages: ["java"],
    installCommand: "",
    installCheck: "java -version",
    defaultLaunchConfig: {
      type: "java",
      request: "launch",
      mainClass: "${mainClass}",
    },
  },
]

export function getAdapterConfigForLanguage(languageId: string): DapAdapterPreset | undefined {
  return DAP_ADAPTER_CONFIGS.find((config) => config.languages.includes(languageId))
}

export function getAdapterConfigForFile(filePath: string): DapAdapterPreset | undefined {
  const extension = extractExtension(filePath)
  const languageId = EXTENSION_TO_LANGUAGE[extension]
  if (languageId) {
    const config = getAdapterConfigForLanguage(languageId)
    if (config) return config
  }
  return undefined
}

export function buildLaunchConfig(
  adapterConfig: DapAdapterPreset,
  filePath: string,
  options?: LaunchConfigOptions,
): Record<string, unknown> {
  const config: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(adapterConfig.defaultLaunchConfig)) {
    if (typeof value === "string") {
      config[key] = resolveTemplateVars(value, filePath)
    } else {
      config[key] = value
    }
  }

  if (options?.args) config.args = [...options.args]
  if (options?.env) config.env = { ...options.env }
  if (options?.cwd) config.cwd = options.cwd
  if (options?.noDebug !== undefined) config.noDebug = options.noDebug

  return config
}

export async function checkAdapterInstalled(config: DapAdapterPreset): Promise<boolean> {
  if (!window.codek?.runCommand) return false
  try {
    const result = await window.codek.runCommand(config.installCheck)
    return result.exitCode === 0
  } catch {
    return false
  }
}

export async function installAdapter(config: DapAdapterPreset): Promise<boolean> {
  if (!window.codek?.runCommand) return false
  if (!config.installCommand) return false
  try {
    const result = await window.codek.runCommand(config.installCommand)
    return result.exitCode === 0
  } catch {
    return false
  }
}

function extractExtension(filePath: string): string {
  const dotIndex = filePath.lastIndexOf(".")
  if (dotIndex < 0) return ""
  return filePath.slice(dotIndex + 1).toLowerCase()
}

function resolveTemplateVars(value: string, filePath: string): string {
  return value
    .replace("${file}", filePath)
    .replace("${fileBasenameNoExtension}", extractBasenameNoExt(filePath))
}

function extractBasenameNoExt(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  const slashIndex = normalized.lastIndexOf("/")
  const basename = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
  const dotIndex = basename.lastIndexOf(".")
  return dotIndex >= 0 ? basename.slice(0, dotIndex) : basename
}
