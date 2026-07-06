export interface DapAdapterConfig {
  id: string
  name: string
  adapterType: string
  languages: string[]
  command: string
  args: string[]
  installCommand: string
  installCheck: string
  defaultLaunchConfig: Record<string, unknown>
}

export const DAP_ADAPTER_CONFIGS: DapAdapterConfig[] = [
  {
    id: "node",
    name: "Node.js Debug Adapter",
    adapterType: "node",
    languages: ["javascript", "typescript"],
    command: "node",
    args: ["${codekPath}/adapters/js-debug/src/dapDebugServer.js"],
    installCommand: "Built-in with Codek",
    installCheck: "node --version",
    defaultLaunchConfig: {
      type: "node",
      request: "launch",
      program: "${workspaceFolder}/index.js",
      console: "integratedTerminal",
    },
  },
  {
    id: "python",
    name: "Python Debug Adapter (debugpy)",
    adapterType: "python",
    languages: ["python"],
    command: "python",
    args: ["-m", "debugpy.adapter"],
    installCommand: "pip install debugpy",
    installCheck: "python -m debugpy --version",
    defaultLaunchConfig: {
      type: "python",
      request: "launch",
      program: "${workspaceFolder}/main.py",
      console: "integratedTerminal",
    },
  },
  {
    id: "java",
    name: "Java Debug Adapter",
    adapterType: "java",
    languages: ["java"],
    command: "java",
    args: ["-jar", "${codekPath}/adapters/java-debug/com.microsoft.java.debug.plugin.jar"],
    installCommand: "See: https://github.com/microsoft/java-debug",
    installCheck: "java -version",
    defaultLaunchConfig: {
      type: "java",
      request: "launch",
      mainClass: "${workspaceFolder}/Main.java",
    },
  },
]

export function getAdapterConfigForLanguage(languageId: string): DapAdapterConfig | undefined {
  return DAP_ADAPTER_CONFIGS.find((config) => config.languages.includes(languageId))
}

export function getAdapterConfigById(id: string): DapAdapterConfig | undefined {
  return DAP_ADAPTER_CONFIGS.find((config) => config.id === id)
}

export function getAllAdapterConfigs(): DapAdapterConfig[] {
  return [...DAP_ADAPTER_CONFIGS]
}

export async function checkDapInstalled(config: DapAdapterConfig): Promise<boolean> {
  if (!window.codek?.runCommand) return false
  try {
    const result = await window.codek.runCommand(config.installCheck)
    return result.exitCode === 0
  } catch {
    return false
  }
}

export async function installDapAdapter(config: DapAdapterConfig): Promise<boolean> {
  if (!window.codek?.runCommand) return false
  if (!config.installCommand || config.installCommand.startsWith("See:")) return false
  try {
    const result = await window.codek.runCommand(config.installCommand)
    return result.exitCode === 0
  } catch {
    return false
  }
}

export function buildLaunchConfigFromAdapter(
  config: DapAdapterConfig,
  programPath: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(config.defaultLaunchConfig)) {
    if (typeof value === "string") {
      result[key] = resolveTemplateVars(value, programPath)
    } else {
      result[key] = value
    }
  }

  result.program = programPath
  return result
}

function resolveTemplateVars(value: string, filePath: string): string {
  return value
    .replace("${workspaceFolder}", extractWorkspaceFolder(filePath))
    .replace("${file}", filePath)
    .replace("${fileBasenameNoExtension}", extractBasenameNoExt(filePath))
}

function extractWorkspaceFolder(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  const srcIndex = normalized.lastIndexOf("/src/")
  if (srcIndex >= 0) return normalized.slice(0, srcIndex)
  const slashIndex = normalized.lastIndexOf("/")
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : normalized
}

function extractBasenameNoExt(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  const slashIndex = normalized.lastIndexOf("/")
  const basename = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
  const dotIndex = basename.lastIndexOf(".")
  return dotIndex >= 0 ? basename.slice(0, dotIndex) : basename
}
