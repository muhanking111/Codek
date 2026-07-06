import { afterEach, describe, expect, it } from "vitest"
import { workspace } from "../workspace/manager"
import { analysisState } from "../workspace/analysisState"
import { problemState } from "../components/problemState"
import { debugState } from "../components/debugState"
import { createTerminal, resetAll, updateShellIntegration } from "../terminal/terminalManager"
import { resolveMentionLink, searchMentions } from "./mentions"

function resetState(): void {
  workspace.projectRoot = "D:/Workspace"
  workspace.workspaceRoots = ["D:/Workspace", "D:/Workspace/packages/demo"]
  workspace.workspaceRootLabels = {
    "D:/Workspace": "Codek",
    "D:/Workspace/packages/demo": "demo",
  }
  workspace.fileTree = []
  analysisState.projectSymbols = []
  problemState.diagnostics.splice(0, problemState.diagnostics.length)
  debugState.runConfigs.splice(0, debugState.runConfigs.length)
  resetAll()
}

afterEach(() => {
  resetState()
})

describe("mentions", () => {
  it("searches Cursor-style symbol, problem, task, terminal, and workspace mentions", async () => {
    resetState()
    analysisState.projectSymbols = [
      { name: "buildContextWithEvidence", kind: "function", path: "src/ai/context.js", line: 42, column: 1 },
    ]
    problemState.addDiagnostics([
      {
        file: "src/App.vue",
        line: 10,
        column: 2,
        message: "Unexpected token",
        severity: "error",
        source: "vitest",
      },
    ])
    debugState.runConfigs.push({
      id: "task-typecheck",
      name: "npm: typecheck",
      type: "custom",
      command: "npm run typecheck -- token=secret-value-1234567890abcdef",
      workingDir: "${workspaceFolder}",
      source: "workspace",
    })
    const terminal = createTerminal("powershell", "D:/Workspace")
    updateShellIntegration(terminal.id, {
      recentCommands: [
        {
          id: "cmd-1",
          terminalId: terminal.id,
          commandLine: "npm test",
          cwd: "D:/Workspace",
          startedAt: 1,
          executedAt: 1,
          finishedAt: 2,
          durationMs: 1,
          exitCode: 0,
          output: "ok",
          status: "finished",
        },
      ],
    })

    const symbolMentions = await searchMentions("build", "D:/Workspace")
    const problemMentions = await searchMentions("Unexpected", "D:/Workspace")
    const taskMentions = await searchMentions("typecheck", "D:/Workspace")
    const terminalMentions = await searchMentions("npm", "D:/Workspace")
    expect(symbolMentions.some((mention) => mention.type === "symbol")).toBe(true)
    expect(problemMentions.some((mention) => mention.type === "problem")).toBe(true)
    expect(taskMentions.some((mention) => mention.type === "task")).toBe(true)
    expect(terminalMentions.some((mention) => mention.type === "terminal")).toBe(true)

    const workspaceMentions = await searchMentions("workspace", "D:/Workspace")
    expect(workspaceMentions[0]).toMatchObject({ type: "workspace", label: "Workspace Roots" })

    const taskMention = taskMentions.find((mention) => mention.type === "task")
    expect(taskMention?.detail).toContain("token=<redacted>")
    expect(taskMention?.detail).not.toContain("secret-value-1234567890abcdef")

    const taskContext = await resolveMentionLink(taskMention!)
    expect(taskContext).toContain("token=<redacted>")
    expect(taskContext).not.toContain("secret-value-1234567890abcdef")
  })
})
