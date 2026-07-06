import type { RunConfig } from "../components/debugState"
import { resolveProblemMatchers, type ProblemMatcherRef } from "./problemMatcher"

export interface DiscoveredTaskConfig extends Omit<RunConfig, "id"> {
  id: string
  source: "workspace"
}

interface TaskInputDefinition {
  id?: unknown
  type?: unknown
  default?: unknown
  value?: unknown
}

function safeJsonParse(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function shellJoin(parts: string[]): string {
  return parts.filter(Boolean).join(" ")
}

function normalizeCommand(value: unknown): string {
  if (typeof value === "string") return value.trim()
  return ""
}

function normalizeArgs(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : []
}

function optionCwd(record: Record<string, unknown>): string {
  const options = record.options && typeof record.options === "object" ? record.options as Record<string, unknown> : null
  return normalizeCommand(options?.cwd)
}

function optionEnv(record: Record<string, unknown>): Record<string, string> | undefined {
  const options = record.options && typeof record.options === "object" ? record.options as Record<string, unknown> : null
  const env = options?.env && typeof options.env === "object" ? options.env as Record<string, unknown> : null
  if (!env) return undefined
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    result[key] = String(value ?? "")
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function normalizeDependsOn(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (!Array.isArray(value)) return []
  return value.map(normalizeTaskReference).filter(Boolean)
}

function normalizeTaskReference(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return normalizeCommand(record.task) || normalizeCommand(record.label) || normalizeCommand(record.identifier)
  }
  return ""
}

function normalizeGroup(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return normalizeCommand(record.kind) || normalizeCommand(record.group)
  }
  return undefined
}

function normalizeProblemMatcherRef(value: unknown): ProblemMatcherRef | undefined {
  if (!value) return undefined
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value as ProblemMatcherRef
  if (typeof value === "object") return value as ProblemMatcherRef
  return undefined
}

function normalizeDependsOrder(value: unknown): "sequence" | "parallel" | undefined {
  return value === "sequence" || value === "parallel" ? value : undefined
}

function normalizeInputs(value: unknown): Record<string, string> | undefined {
  const inputs = asArray(value)
  const result: Record<string, string> = {}
  for (const input of inputs) {
    if (!input || typeof input !== "object") continue
    const record = input as TaskInputDefinition
    const id = typeof record.id === "string" ? record.id.trim() : ""
    if (!id) continue
    const fallback = record.default ?? record.value ?? ""
    result[id] = String(fallback ?? "")
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function makeId(prefix: string, name: string): string {
  return `${prefix}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "task"}`
}

export function parseVsCodeTasks(content: string): DiscoveredTaskConfig[] {
  const parsed = safeJsonParse(content)
  const tasks = asArray(parsed?.tasks)
  const inputs = normalizeInputs(parsed?.inputs)
  return tasks.flatMap((task, index) => {
    if (!task || typeof task !== "object") return []
    const record = task as Record<string, unknown>
    const label = String(record.label || record.taskName || record.script || `Task ${index + 1}`)
    const taskType = String(record.type || "").toLowerCase()
    const script = typeof record.script === "string" ? record.script.trim() : ""
    const baseCommand = taskType === "npm" && script ? `npm run ${script}` : normalizeCommand(record.command)
    const args = normalizeArgs(record.args)
    const command = shellJoin([baseCommand, ...args])
    if (!command) return []
    const metadata = buildTaskMetadata(record, optionCwd(record) || "${workspaceFolder}", inputs)
    return [{
      id: makeId("task", label),
      name: `Task: ${label}`,
      type: "custom",
      command,
      workingDir: optionCwd(record) || "${workspaceFolder}",
      source: "workspace",
      ...metadata,
    }]
  })
}

export function parseVsCodeProfileTasksResource(content: string | undefined | null): DiscoveredTaskConfig[] {
  if (!content) return []
  const parsed = safeJsonParse(content)
  return typeof parsed?.tasks === "string" ? parseVsCodeTasks(parsed.tasks) : []
}

function buildTaskMetadata(
  record: Record<string, unknown>,
  cwd: string,
  inputs?: Record<string, string>,
): Partial<DiscoveredTaskConfig> {
  const metadata: Partial<DiscoveredTaskConfig> = {}
  const group = normalizeGroup(record.group)
  const dependsOn = normalizeDependsOn(record.dependsOn)
  const dependsOrder = normalizeDependsOrder(record.dependsOrder)
  const env = optionEnv(record)
  const problemMatchers = resolveProblemMatchers(normalizeProblemMatcherRef(record.problemMatcher), cwd)
  if (group) metadata.group = group
  if (dependsOn.length > 0) metadata.dependsOn = dependsOn
  if (dependsOrder) metadata.dependsOrder = dependsOrder
  if (record.isBackground === true) metadata.isBackground = true
  if (problemMatchers.length > 0) metadata.problemMatchers = problemMatchers
  if (env) metadata.env = env
  if (inputs) metadata.inputs = inputs
  return metadata
}

export function parseLaunchConfigs(content: string): DiscoveredTaskConfig[] {
  const parsed = safeJsonParse(content)
  const configs = asArray(parsed?.configurations)
  return configs.flatMap((config, index) => {
    if (!config || typeof config !== "object") return []
    const record = config as Record<string, unknown>
    const name = String(record.name || `Launch ${index + 1}`)
    const type = String(record.type || "custom").toLowerCase()
    const request = String(record.request || "launch")
    const program = normalizeCommand(record.program)
    const runtimeExecutable = normalizeCommand(record.runtimeExecutable)
    const runtimeArgs = normalizeArgs(record.runtimeArgs)
    const args = normalizeArgs(record.args)
    const command = runtimeExecutable
      ? shellJoin([runtimeExecutable, ...runtimeArgs, program, ...args])
      : type === "node" && program
        ? shellJoin(["node", program, ...args])
        : type === "python" && program
          ? shellJoin(["python", program, ...args])
          : normalizeCommand(record.command)
    if (!command) return []
    return [{
      id: makeId("launch", name),
      name: `${request === "attach" ? "Attach" : "Launch"}: ${name}`,
      type: type === "node" || type === "python" || type === "java" ? type : "custom",
      command,
      workingDir: normalizeCommand(record.cwd) || "${workspaceFolder}",
      source: "workspace",
    }]
  })
}

export function parsePackageScripts(content: string, packageManager = "npm"): DiscoveredTaskConfig[] {
  const parsed = safeJsonParse(content)
  const scripts = parsed?.scripts && typeof parsed.scripts === "object" ? parsed.scripts as Record<string, unknown> : {}
  const runner = packageManager === "yarn" ? "yarn" : `${packageManager} run`
  return Object.keys(scripts).sort().map((script) => ({
    id: makeId(packageManager, script),
    name: `${packageManager}: ${script}`,
    type: "custom",
    command: packageManager === "yarn" ? `yarn ${script}` : `${runner} ${script}`,
    workingDir: "${workspaceFolder}",
    source: "workspace",
  }))
}

export function parseGradleProject(content: string): DiscoveredTaskConfig[] {
  if (!/(plugins|dependencies|tasks)\s*\{|\bapply\s+plugin\b/.test(content)) return []
  return [
    {
      id: "gradle-test",
      name: "Gradle: test",
      type: "custom",
      command: "./gradlew test",
      workingDir: "${workspaceFolder}",
      source: "workspace",
    },
    {
      id: "gradle-build",
      name: "Gradle: build",
      type: "custom",
      command: "./gradlew build",
      workingDir: "${workspaceFolder}",
      source: "workspace",
    },
  ]
}

export function parseCargoProject(content: string): DiscoveredTaskConfig[] {
  if (!/\[package\]/.test(content)) return []
  return [
    {
      id: "cargo-test",
      name: "Cargo: test",
      type: "custom",
      command: "cargo test",
      workingDir: "${workspaceFolder}",
      source: "workspace",
      problemMatchers: resolveProblemMatchers("$rustc"),
    },
    {
      id: "cargo-build",
      name: "Cargo: build",
      type: "custom",
      command: "cargo build",
      workingDir: "${workspaceFolder}",
      source: "workspace",
      problemMatchers: resolveProblemMatchers("$rustc"),
    },
  ]
}

export function parseGoProject(content: string): DiscoveredTaskConfig[] {
  if (!/^module\s+\S+/m.test(content)) return []
  return [
    {
      id: "go-test",
      name: "Go: test",
      type: "custom",
      command: "go test ./...",
      workingDir: "${workspaceFolder}",
      source: "workspace",
      problemMatchers: resolveProblemMatchers("$go"),
    },
    {
      id: "go-build",
      name: "Go: build",
      type: "custom",
      command: "go build ./...",
      workingDir: "${workspaceFolder}",
      source: "workspace",
      problemMatchers: resolveProblemMatchers("$go"),
    },
  ]
}

function hasXmlTag(content: string, tagName: string): boolean {
  return new RegExp(`<${tagName}(\\s|>)`, "i").test(content)
}

export function parseMavenProject(content: string): DiscoveredTaskConfig[] {
  if (!hasXmlTag(content, "project")) return []
  return [
    {
      id: "maven-test",
      name: "Maven: test",
      type: "custom",
      command: "mvn test",
      workingDir: "${workspaceFolder}",
      source: "workspace",
    },
    {
      id: "maven-package",
      name: "Maven: package",
      type: "custom",
      command: "mvn package",
      workingDir: "${workspaceFolder}",
      source: "workspace",
    },
  ]
}

export function parsePythonProject(content: string): DiscoveredTaskConfig[] {
  const tasks: DiscoveredTaskConfig[] = []
  const usesPytest = /\bpytest\b/.test(content) || /\[tool\.pytest/i.test(content)
  const usesRuff = /\[tool\.ruff/i.test(content)
  const usesPoetry = /\[tool\.poetry/i.test(content)
  tasks.push({
    id: "python-test",
    name: "Python: test",
    type: "custom",
    command: usesPoetry ? "poetry run pytest" : usesPytest ? "python -m pytest" : "python -m unittest",
    workingDir: "${workspaceFolder}",
    source: "workspace",
  })
  if (usesRuff) {
    tasks.push({
      id: "python-lint",
      name: "Python: lint",
      type: "custom",
      command: usesPoetry ? "poetry run ruff check ." : "ruff check .",
      workingDir: "${workspaceFolder}",
      source: "workspace",
    })
  }
  return tasks
}

export async function discoverRunConfigsFromFiles(
  readFile: (path: string) => Promise<string | null | undefined>,
): Promise<DiscoveredTaskConfig[]> {
  const [
    tasksJson,
    launchJson,
    packageJson,
    pnpmLock,
    yarnLock,
    pomXml,
    buildGradle,
    buildGradleKts,
    pyprojectToml,
    cargoToml,
    goMod,
  ] = await Promise.all([
    readFile(".vscode/tasks.json").catch(() => null),
    readFile(".vscode/launch.json").catch(() => null),
    readFile("package.json").catch(() => null),
    readFile("pnpm-lock.yaml").catch(() => null),
    readFile("yarn.lock").catch(() => null),
    readFile("pom.xml").catch(() => null),
    readFile("build.gradle").catch(() => null),
    readFile("build.gradle.kts").catch(() => null),
    readFile("pyproject.toml").catch(() => null),
    readFile("Cargo.toml").catch(() => null),
    readFile("go.mod").catch(() => null),
  ])

  const packageManager = pnpmLock ? "pnpm" : yarnLock ? "yarn" : "npm"

  const configs = [
    ...(tasksJson ? parseVsCodeTasks(tasksJson) : []),
    ...(launchJson ? parseLaunchConfigs(launchJson) : []),
    ...(packageJson ? parsePackageScripts(packageJson, packageManager) : []),
    ...(pomXml ? parseMavenProject(pomXml) : []),
    ...(buildGradle ? parseGradleProject(buildGradle) : []),
    ...(buildGradleKts ? parseGradleProject(buildGradleKts) : []),
    ...(pyprojectToml ? parsePythonProject(pyprojectToml) : []),
    ...(cargoToml ? parseCargoProject(cargoToml) : []),
    ...(goMod ? parseGoProject(goMod) : []),
  ]
  const seen = new Set<string>()
  return configs.filter((config) => {
    if (seen.has(config.id)) return false
    seen.add(config.id)
    return true
  })
}
