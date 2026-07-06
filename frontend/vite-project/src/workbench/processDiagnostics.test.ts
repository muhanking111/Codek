import { describe, expect, it } from "vitest"
import {
  buildProcessDiagnosticsText,
  buildProcessPerformanceModel,
  buildProcessTreeSnapshot,
  createProcessActionDescriptor,
  redactProcessSnapshot,
  type ProcessSnapshot,
} from "./processDiagnostics"

describe("processDiagnostics", () => {
  const sampleSnapshot: ProcessSnapshot = {
    app: {
      name: "Codek",
      version: "1.0.0",
      pid: 1234,
      platform: "win32",
      arch: "x64",
      memory: { rss: 1024 * 1024 * 512, heapUsed: 1024 * 1024 * 256 },
      load: 41,
    },
    windows: [{ id: 1, title: "Codek - D:/Workspace/workspace/secret.ts", rendererPid: 2345, focused: true, visible: true }],
    pty: {
      ptyAvailable: true,
      sessions: [{ id: "pty-1", pid: 3456, shellType: "powershell", cwd: "D:/Workspace/private", mode: "pty", uptimeMs: 1000 }],
    },
    lsp: [{ id: "typescript", pid: 4567, load: 95, memory: { rss: 1024 * 1024 * 700 } }],
    dap: [{ id: "dap-1", pid: 5678, adapterType: "node" }],
    mcp: [{ id: "github", pid: 6789, command: "node server.js --token=secret-token" }],
  }

  it("builds a copyable diagnostics payload from the current process snapshot", () => {
    const text = buildProcessDiagnosticsText(sampleSnapshot)
    const parsed = JSON.parse(text)

    expect(parsed.summary.app).toBe("Codek")
    expect(parsed.summary.terminalSessions).toBe(1)
    expect(parsed.summary.lsp).toBe(1)
    expect(parsed.summary.projectedProcesses).toBeGreaterThanOrEqual(6)
    expect(parsed.process.pty.sessions[0].cwd).toBe("D:/Workspace/[workspace-path-redacted]")
    expect(parsed.performance.evidence.privacy.redacted).toBe(true)
  })

  it("projects Electron and service processes into a VS Code-style process tree", () => {
    const tree = buildProcessTreeSnapshot(sampleSnapshot, { generatedAt: 100 })

    expect(tree.source).toBe("processDiagnostics")
    expect(tree.roots).toHaveLength(1)
    expect(tree.roots[0].kind).toBe("main")
    expect(tree.roots[0].children.map((child) => child.kind)).toEqual([
      "renderer",
      "pty",
      "lsp",
      "dap",
      "mcp",
    ])
    expect(tree.roots[0].children[0].name).toContain("[workspace-path-redacted]")
    expect(tree.summary.totalProcesses).toBe(6)
    expect(tree.constraints.noSecondProcessState).toBe(true)
  })

  it("builds a sampling model and flags performance evidence without leaking commands", () => {
    const performance = buildProcessPerformanceModel(sampleSnapshot, { generatedAt: 200 })

    expect(performance.samplingModel.cpu.sources).toContain("app.load")
    expect(performance.samplingModel.memory.totalRss).toBeGreaterThan(0)
    expect(performance.evidence.issues.some((issue) => issue.kind === "highCpu")).toBe(true)
    expect(JSON.stringify(performance)).not.toContain("secret-token")
    expect(performance.constraints.evidenceSafeActionsOnly).toBe(true)
  })

  it("creates evidence-safe action descriptors for kill, copy, and export", () => {
    expect(createProcessActionDescriptor("kill", { pid: 4567, processKind: "lsp" })).toMatchObject({
      commandId: "workbench.action.processExplorer.kill",
      requiresApproval: true,
      gitIndexMutation: false,
      shellExecution: false,
      readonlyEvidence: false,
    })
    expect(createProcessActionDescriptor("copy")).toMatchObject({
      targetPath: "clipboard://process-explorer",
      readonlyEvidence: true,
    })
    expect(createProcessActionDescriptor("export")).toMatchObject({
      targetPath: ".codek/reports/process-performance-latest.json",
      externalPost: false,
    })
  })

  it("redacts workspace paths and sensitive command tokens at the process boundary", () => {
    const redacted = redactProcessSnapshot(sampleSnapshot)

    expect(JSON.stringify(redacted)).not.toContain("secret-token")
    expect(redacted.pty?.sessions?.[0].cwd).toBe("D:/Workspace/[workspace-path-redacted]")
    expect(redacted.mcp?.[0].command).toContain("token=[redacted]")
  })
})
