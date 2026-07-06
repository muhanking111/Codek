import { describe, expect, it } from "vitest"
import { buildInstrumentedCommand, buildShellIntegrationBootstrap, Osc633Parser, TerminalShellIntegrationTracker } from "./shellIntegration"

function osc633(payload: string, terminator: "bel" | "st" = "bel"): string {
  return `\x1b]633;${payload}${terminator === "bel" ? "\x07" : "\x1b\\"}`
}

describe("Osc633Parser", () => {
  it("strips VS Code shell integration sequences and returns command events", () => {
    const parser = new Osc633Parser()
    const result = parser.parse(`$ ${osc633("E;npm\\x20test;nonce")}${osc633("C")}ok\n${osc633("D;0")}`)

    expect(result.cleanedData).toBe("$ ok\n")
    expect(result.events).toEqual([
      { type: "commandLine", commandLine: "npm test", nonce: "nonce" },
      { type: "commandExecuted" },
      { type: "commandFinished", exitCode: 0 },
    ])
  })

  it("handles OSC 633 sequences split across chunks", () => {
    const parser = new Osc633Parser()

    expect(parser.parse("before\x1b]633;D;4").events).toEqual([])
    const result = parser.parse("2\x1b\\after")

    expect(result.cleanedData).toBe("after")
    expect(result.events).toEqual([{ type: "commandFinished", exitCode: 42 }])
  })
})

describe("TerminalShellIntegrationTracker", () => {
  it("tracks cwd, command start, finish, exit code, duration, and output", () => {
    const tracker = new TerminalShellIntegrationTracker("term-1", "D:/Workspace")

    tracker.parse(osc633("P;Cwd=D:/Workspace/frontend"), 1000)
    tracker.parse(`${osc633("E;npm\\x20run\\x20build")}${osc633("C")}building\n`, 1200)
    tracker.parse(`done\n${osc633("D;0")}`, 1750)

    expect(tracker.currentCwd).toBe("D:/Workspace/frontend")
    expect(tracker.getCommands()).toEqual([{
      id: "term-1-cmd-1",
      terminalId: "term-1",
      commandLine: "npm run build",
      cwd: "D:/Workspace/frontend",
      startedAt: 1200,
      executedAt: 1200,
      finishedAt: 1750,
      durationMs: 550,
      exitCode: 0,
      output: "building\ndone\n",
      status: "finished",
    }])
  })

  it("emits VS Code style shell integration lifecycle events", () => {
    const tracker = new TerminalShellIntegrationTracker("term-1", "D:/demo")
    const events: string[] = []
    tracker.onDidChangeShellIntegration((event) => {
      events.push(`${event.type}:${event.command?.commandLine || event.cwd || event.exitCode || ""}`)
    })

    tracker.parse(`${osc633("E;npm\\x20test")}${osc633("C")}ok${osc633("D;0")}${osc633("P;Cwd=D:/demo/src")}`, 100)

    expect(events).toEqual([
      "available:D:/demo",
      "commandStarted:npm test",
      "commandExecuted:npm test",
      "commandFinished:npm test",
      "cwdChanged:D:/demo/src",
    ])
    expect(tracker.isAvailable).toBe(true)
  })
})

describe("buildInstrumentedCommand", () => {
  it("wraps bash commands with VS Code OSC 633 lifecycle markers", () => {
    const command = buildInstrumentedCommand("npm test", "bash")

    expect(command).toContain("633;E;")
    expect(command).toContain("633;C")
    expect(command).toContain("633;D;")
    expect(command).toContain("npm test")
  })

  it("wraps PowerShell commands without losing command line spaces", () => {
    const command = buildInstrumentedCommand("npm run build", "powershell")

    expect(command).toContain("633;E;")
    expect(command).toContain("npm\\x20run\\x20build")
    expect(command).toContain("Invoke-Expression 'npm run build'")
  })

  it("builds shell bootstrap snippets for interactive lifecycle markers", () => {
    expect(buildShellIntegrationBootstrap("powershell")).toContain("function global:prompt")
    expect(buildShellIntegrationBootstrap("powershell")).toContain("633;")
    expect(buildShellIntegrationBootstrap("cmd")).toContain("PROMPT")
    expect(buildShellIntegrationBootstrap("bash")).toContain("PROMPT_COMMAND")
  })
})
