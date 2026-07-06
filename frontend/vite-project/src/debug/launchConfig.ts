import type { RunConfig } from "../components/debugState"

export function buildDapLaunchConfig(config: RunConfig): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: config.type,
    noDebug: false,
    cwd: config.workingDir,
  }
  if (config.env && Object.keys(config.env).length > 0) {
    base.env = config.env
  }

  switch (config.type) {
    case "node":
      return buildNodeLaunchConfig(config, base)
    case "python":
      return buildPythonLaunchConfig(config, base)
    case "java":
      return { ...base, mainClass: firstCommandToken(config.command) || config.command }
    default:
      return { ...base, program: config.command }
  }
}

function buildNodeLaunchConfig(config: RunConfig, base: Record<string, unknown>): Record<string, unknown> {
  const parts = splitCommand(config.command)
  if (parts[0] === "node") {
    return {
      ...base,
      runtimeExecutable: "node",
      program: parts[1] || "",
      args: parts.slice(2),
    }
  }
  return {
    ...base,
    runtimeExecutable: "node",
    program: config.command,
  }
}

function buildPythonLaunchConfig(config: RunConfig, base: Record<string, unknown>): Record<string, unknown> {
  const parts = splitCommand(config.command)
  if (parts[0] === "python" || parts[0] === "python3" || parts[0] === "py") {
    return {
      ...base,
      python: parts[0],
      program: parts[1] || "",
      args: parts.slice(2),
    }
  }
  return {
    ...base,
    python: "python",
    program: config.command,
  }
}

function firstCommandToken(value: string): string {
  return splitCommand(value)[0] || ""
}

function splitCommand(value: string): string[] {
  const result: string[] = []
  const re = /"([^"]*)"|'([^']*)'|([^\s]+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(String(value || ""))) !== null) {
    result.push(match[1] ?? match[2] ?? match[3] ?? "")
  }
  return result.filter(Boolean)
}
