import { debugState, type ConsoleEntry } from "./debugState"
import { workspace } from "../workspace/manager.js"
import { resolveRunConfigVariables } from "../workbench/runConfigVariables"
import { getDebugManager } from "../debug/debugManager"

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function appendConsole(type: ConsoleEntry["type"], text: string): void {
  debugState.consoleOutput.value.push({
    id: makeId("console"),
    type,
    text,
    timestamp: Date.now(),
  })
}

export async function startDebug(): Promise<void> {
  const rawConfig = debugState.activeConfig.value
  const config = rawConfig
    ? resolveRunConfigVariables(rawConfig, {
        workspaceFolder: workspace.workspaceRoots[0] || workspace.projectRoot || "",
        activeFile: workspace.activeFile,
      })
    : undefined
  if (!config || debugState.isRunning.value) return

  try {
    debugState.consoleOutput.value = []
    await getDebugManager().startSession(config)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "启动调试会话失败"
    appendConsole("error", `启动调试会话失败: ${msg}`)
  }
}

export async function stopDebug(): Promise<void> {
  try {
    await getDebugManager().stopSession()
  } catch (err) {
    const msg = err instanceof Error ? err.message : "停止调试会话失败"
    appendConsole("error", `停止调试会话失败: ${msg}`)
  }
}

export async function restartDebug(): Promise<void> {
  await stopDebug()
  await startDebug()
}

export async function continueDebug(): Promise<void> {
  try {
    await getDebugManager().continue()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    appendConsole("error", `Continue failed: ${msg}`)
  }
}

export async function stepOverDebug(): Promise<void> {
  try {
    await getDebugManager().stepOver()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    appendConsole("error", `Step over failed: ${msg}`)
  }
}

export async function stepInDebug(): Promise<void> {
  try {
    await getDebugManager().stepIn()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    appendConsole("error", `Step in failed: ${msg}`)
  }
}

export async function stepOutDebug(): Promise<void> {
  try {
    await getDebugManager().stepOut()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    appendConsole("error", `Step out failed: ${msg}`)
  }
}

export async function sendInput(text: string): Promise<void> {
  if (!text.trim()) return

  if (!debugState.isRunning.value) {
    appendConsole("input", text)
    return
  }

  try {
    await getDebugManager().evaluate(text, debugState.currentFrameId.value ?? undefined)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to evaluate expression"
    appendConsole("error", msg)
  }
}
