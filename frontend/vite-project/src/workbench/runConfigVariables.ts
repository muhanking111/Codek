import type { RunConfig } from "../components/debugState"

export interface RunConfigVariableContext {
  workspaceFolder?: string | null
  activeFile?: string | null
  inputs?: Record<string, string>
  env?: Record<string, string | undefined>
}

export interface RunConfigResolverEvidence {
  source: "configurationResolverService"
  vscodeServiceId: "IConfigurationResolverService"
  stateSource: "runConfigVariables"
  configId: string
  configName: string
  configType: RunConfig["type"]
  variableKinds: Array<"env" | "file" | "input" | "relativeFile" | "workspaceFolder">
  resolved: {
    commandLength: number
    workingDir: string
    envKeys: string[]
  }
  constraints: {
    noSecondRunConfigState: true
    redactsVariableValues: true
    vscodeStyleVariableResolution: true
  }
}

export function resolveRunConfigVariables(
  config: RunConfig,
  context: RunConfigVariableContext,
): RunConfig {
  return {
    ...config,
    command: resolveTemplate(config.command, context),
    workingDir: resolveTemplate(config.workingDir, context),
    env: resolveEnv(config.env, context),
  }
}

export function createRunConfigResolverEvidence(
  config: RunConfig,
  context: RunConfigVariableContext,
): RunConfigResolverEvidence {
  const resolved = resolveRunConfigVariables(config, context)
  return {
    source: "configurationResolverService",
    vscodeServiceId: "IConfigurationResolverService",
    stateSource: "runConfigVariables",
    configId: config.id,
    configName: config.name,
    configType: config.type,
    variableKinds: collectVariableKinds(config),
    resolved: {
      commandLength: resolved.command.length,
      workingDir: resolved.workingDir,
      envKeys: Object.keys(resolved.env || {}).sort(),
    },
    constraints: {
      noSecondRunConfigState: true,
      redactsVariableValues: true,
      vscodeStyleVariableResolution: true,
    },
  }
}

function resolveTemplate(value: string, context: RunConfigVariableContext): string {
  const workspaceFolder = normalizePath(context.workspaceFolder || "")
  const file = toAbsoluteFilePath(context.activeFile || "", workspaceFolder)
  const relativeFile = toRelativeFilePath(file, workspaceFolder)
  const fileBasename = basename(file)
  const fileBasenameNoExtension = stripExtension(fileBasename)
  const fileDirname = dirname(file)
  const relativeFileDirname = dirname(relativeFile)

  return resolveInputVariables(String(value || ""), context)
    .replace(/\$\{env:([^}]+)\}/g, (_match, name: string) => resolveEnvValue(name, context))
    .replaceAll("${workspaceFolder}", workspaceFolder)
    .replaceAll("${relativeFileDirname}", relativeFileDirname)
    .replaceAll("${relativeFile}", relativeFile)
    .replaceAll("${fileBasenameNoExtension}", fileBasenameNoExtension)
    .replaceAll("${fileBasename}", fileBasename)
    .replaceAll("${fileDirname}", fileDirname)
    .replaceAll("${file}", file)
}

function collectVariableKinds(config: RunConfig): RunConfigResolverEvidence["variableKinds"] {
  const values = [
    config.command,
    config.workingDir,
    ...Object.values(config.env || {}),
  ].join("\n")
  const kinds = new Set<RunConfigResolverEvidence["variableKinds"][number]>()
  if (/\$\{env:[^}]+\}/.test(values)) kinds.add("env")
  if (values.includes("${file}") || values.includes("${fileBasename}") || values.includes("${fileBasenameNoExtension}") || values.includes("${fileDirname}")) kinds.add("file")
  if (/\$\{input:[^}]+\}/.test(values)) kinds.add("input")
  if (values.includes("${relativeFile}") || values.includes("${relativeFileDirname}")) kinds.add("relativeFile")
  if (values.includes("${workspaceFolder}")) kinds.add("workspaceFolder")
  return [...kinds].sort()
}

function resolveEnv(env: RunConfig["env"], context: RunConfigVariableContext): RunConfig["env"] {
  if (!env || Object.keys(env).length === 0) return env
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = resolveTemplate(String(value ?? ""), context)
  }
  return resolved
}

function resolveInputVariables(value: string, context: RunConfigVariableContext): string {
  const inputs = context.inputs || {}
  return value.replace(/\$\{input:([^}]+)\}/g, (_match, id: string) => inputs[id] ?? "")
}

function resolveEnvValue(name: string, context: RunConfigVariableContext): string {
  const trimmed = String(name || "").trim()
  if (!trimmed) return ""
  const explicit = context.env?.[trimmed]
  if (explicit !== undefined) return normalizePath(explicit)
  const processEnv = typeof process !== "undefined" ? process.env?.[trimmed] : undefined
  return normalizePath(processEnv || "")
}

function toAbsoluteFilePath(activeFile: string, workspaceFolder: string): string {
  const normalized = normalizePath(activeFile)
  if (!normalized) return ""
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("/")) return normalized
  return workspaceFolder ? `${workspaceFolder}/${normalized.replace(/^\/+/, "")}` : normalized
}

function normalizePath(value: string): string {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "")
}

function toRelativeFilePath(file: string, workspaceFolder: string): string {
  const normalizedFile = normalizePath(file)
  const normalizedWorkspace = normalizePath(workspaceFolder)
  if (!normalizedFile) return ""
  if (!normalizedWorkspace) return normalizedFile
  const prefix = `${normalizedWorkspace}/`
  return normalizedFile.toLowerCase().startsWith(prefix.toLowerCase())
    ? normalizedFile.slice(prefix.length)
    : normalizedFile
}

function basename(value: string): string {
  const normalized = normalizePath(value)
  const slashIndex = normalized.lastIndexOf("/")
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
}

function dirname(value: string): string {
  const normalized = normalizePath(value)
  const slashIndex = normalized.lastIndexOf("/")
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : ""
}

function stripExtension(value: string): string {
  const dotIndex = value.lastIndexOf(".")
  return dotIndex > 0 ? value.slice(0, dotIndex) : value
}
