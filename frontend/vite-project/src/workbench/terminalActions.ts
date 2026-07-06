import type { RunConfig } from "../components/debugState"
import { resolveRunConfigVariables } from "./runConfigVariables"
import { applyTaskProblemDiagnostics, type TaskProblemStateLike } from "./taskProblems"
import { buildTaskRunEvidence, createTaskRunPlan, runTaskPlan, type TaskRunEvidence, type TaskRunPlan } from "./taskRunner"

interface TerminalPanelLike {
  runCommand?: (command: string) => void
}

interface RunCommandResult {
  stdout?: string
  stderr?: string
  error?: string
  exitCode?: number
  timedOut?: boolean
}

interface CodekTerminalApi {
  runCommand?: (command: string, options?: { cwd?: string; env?: Record<string, string> }) => Promise<RunCommandResult | null | undefined>
}

export interface TerminalEntry {
  id: string
  command: string
  running: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  error: boolean
}

export interface TerminalActionContext {
  getActiveFile: () => string | null | undefined
  getSelectedText: () => string
  getTerminalPanel: () => TerminalPanelLike | null | undefined
  getTerminalBusy: () => boolean
  getEntries: () => TerminalEntry[]
  setEntries: (entries: TerminalEntry[]) => void
  setTerminalOpen: (open: boolean) => void
  setTerminalBusy: (busy: boolean) => void
  openSettingsSection: (section: string) => void
  nextTick: () => Promise<void>
  codek?: CodekTerminalApi | null
  getRunConfigForCommand?: (command: string) => RunConfig | null | undefined
  getRunConfigs?: () => RunConfig[]
  getWorkspaceFolder?: () => string | null | undefined
  problemState?: TaskProblemStateLike | null
  onTaskRunPlan?: (plan: TaskRunPlan) => void
  onTaskRunEvidence?: (evidence: TaskRunEvidence) => void
}

export async function runActiveFileInTerminal(context: TerminalActionContext): Promise<void> {
  const activeFile = context.getActiveFile()
  if (!activeFile) return

  context.setTerminalOpen(true)
  const command = buildRunCommandForFile(activeFile)
  await context.nextTick()

  if (command && context.getTerminalPanel()?.runCommand) {
    context.getTerminalPanel()?.runCommand?.(command)
  } else {
    context.openSettingsSection("terminal")
  }
}

export async function runSelectedTextInTerminal(context: TerminalActionContext): Promise<void> {
  const selected = context.getSelectedText().trim()
  if (!selected) return

  context.setTerminalOpen(true)
  await context.nextTick()
  context.getTerminalPanel()?.runCommand?.(selected)
}

export function appendAgentCommandEvent(payload: unknown, context: TerminalActionContext): void {
  const eventPayload = (payload || {}) as Record<string, unknown>
  const exitCode = typeof eventPayload.exitCode === "number" ? eventPayload.exitCode : 0
  context.setEntries([
    ...context.getEntries(),
    {
      id: makeId("agent"),
      command: String(eventPayload.command || ""),
      running: false,
      stdout: String(eventPayload.stdout || ""),
      stderr: String(eventPayload.stderr || ""),
      exitCode,
      timedOut: false,
      error: exitCode !== 0,
    },
  ])
  context.setTerminalOpen(true)
}

export async function runCommand(command: string, context: TerminalActionContext): Promise<void> {
  if (!context.codek?.runCommand || context.getTerminalBusy()) return

  const runConfig = context.getRunConfigForCommand?.(command)
  if (runConfig?.dependsOn?.length && context.getRunConfigs) {
    await runTaskConfig(runConfig, context)
    return
  }

  context.setTerminalOpen(true)
  context.setTerminalBusy(true)

  const id = makeId("cmd")
  context.setEntries([
    ...context.getEntries(),
    {
      id,
      command,
      running: true,
      stdout: "",
      stderr: "",
      exitCode: null,
      timedOut: false,
      error: false,
    },
  ])

  try {
    const result = await runConfig
      ? await runTerminalConfig(runConfig, context)
      : await context.codek.runCommand(command)
    const output = `${result?.stdout || ""}\n${result?.stderr || result?.error || ""}`
    if (runConfig?.problemMatchers?.length && context.problemState) {
      applyTaskProblemDiagnostics(output, runConfig.problemMatchers, context.problemState)
    }
    context.setEntries(
      context.getEntries().map((entry) =>
        entry.id !== id
          ? entry
          : {
              ...entry,
              running: false,
              stdout: result?.stdout || "",
              stderr: result?.stderr || result?.error || "",
              exitCode: typeof result?.exitCode === "number" ? result.exitCode : -1,
              timedOut: Boolean(result?.timedOut),
              error: Boolean(result?.error) || (typeof result?.exitCode === "number" && result.exitCode !== 0),
            },
      ),
    )
  } finally {
    context.setTerminalBusy(false)
  }
}

async function runTaskConfig(runConfig: RunConfig, context: TerminalActionContext): Promise<void> {
  if (!context.codek?.runCommand || context.getTerminalBusy()) return

  context.setTerminalOpen(true)
  context.setTerminalBusy(true)
  const plan = createTaskRunPlan(context.getRunConfigs?.() || [runConfig], runConfig)
  context.onTaskRunPlan?.(plan)

  try {
    await runTaskPlan(plan, {
      workspaceFolder: context.getWorkspaceFolder?.() || "",
      activeFile: context.getActiveFile() || "",
      runCommand: async (config) => {
        const id = makeId("task")
        context.setEntries([
          ...context.getEntries(),
          {
            id,
            command: config.command,
            running: true,
            stdout: "",
            stderr: "",
            exitCode: null,
            timedOut: false,
            error: false,
          },
        ])
        const result = await runTerminalConfig(config, context)
        const output = `${result?.stdout || ""}\n${result?.stderr || result?.error || ""}`
        if (config.problemMatchers?.length && context.problemState) {
          applyTaskProblemDiagnostics(output, config.problemMatchers, context.problemState)
        }
        context.setEntries(
          context.getEntries().map((entry) =>
            entry.id !== id
              ? entry
              : {
                  ...entry,
                  running: false,
                  stdout: result?.stdout || "",
                  stderr: result?.stderr || result?.error || "",
                  exitCode: typeof result?.exitCode === "number" ? result.exitCode : -1,
                  timedOut: Boolean(result?.timedOut),
                  error: Boolean(result?.error) || (typeof result?.exitCode === "number" && result.exitCode !== 0),
                },
          ),
        )
        context.onTaskRunPlan?.(plan)
        return result
      },
    })
  } finally {
    context.onTaskRunPlan?.(plan)
    context.onTaskRunEvidence?.(buildTaskRunEvidence(plan))
    context.setTerminalBusy(false)
  }
}

function runTerminalConfig(config: RunConfig, context: TerminalActionContext): Promise<RunCommandResult | null | undefined> {
  const resolved = resolveRunConfigVariables(config, {
    workspaceFolder: context.getWorkspaceFolder?.() || "",
    activeFile: context.getActiveFile() || "",
    inputs: config.inputs,
  })
  return context.codek?.runCommand?.(resolved.command, {
    cwd: resolved.workingDir,
    env: resolved.env,
  }) ?? Promise.resolve(null)
}

export function clearTerminal(context: TerminalActionContext): void {
  context.setEntries([])
}

export function closeTerminal(context: TerminalActionContext): void {
  context.setTerminalOpen(false)
}

function buildRunCommandForFile(path: string): string {
  const normalized = String(path || "").replace(/\\/g, "/")
  const ext = normalized.split(".").pop()?.toLowerCase()
  const quoted = `"${normalized}"`
  if (ext === "js" || ext === "mjs" || ext === "cjs") return `node ${quoted}`
  if (ext === "ts") return `npx tsx ${quoted}`
  if (ext === "py") return `python ${quoted}`
  if (ext === "java") return `javac ${quoted} && java ${basename(normalized).replace(/\.java$/i, "")}`
  if (ext === "sh") return `bash ${quoted}`
  if (ext === "ps1") return `powershell -ExecutionPolicy Bypass -File ${quoted}`
  return ""
}

function basename(path: string): string {
  return String(path || "").replace(/^.*[\\/]/, "")
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
