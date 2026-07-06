import { beforeEach, describe, expect, it, vi } from "vitest"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import {
  CodekDiagnosticsService,
  IDiagnosticsService,
  createDiagnosticsService,
  globalDiagnosticsService,
} from "./diagnosticsService"

describe("diagnosticsService", () => {
  beforeEach(() => {
    vi.setSystemTime(1000)
    globalDiagnosticsService.reset()
  })

  it("registers a VS Code-style diagnostics service identifier", () => {
    const collection = new ServiceCollection([IDiagnosticsService, globalDiagnosticsService])

    expect(String(IDiagnosticsService)).toBe("diagnosticsService")
    expect(collection.get(IDiagnosticsService)).toBe(globalDiagnosticsService)
    expect(getSingletonServiceDescriptors()).toEqual(expect.arrayContaining([
      [IDiagnosticsService, globalDiagnosticsService],
    ]))
  })

  it("builds a redacted diagnostics snapshot from process, environment, extensions and workspace inputs", () => {
    const service = createDiagnosticsService({ now: () => 1000 })
    service.setEnvironment({
      NODE_ENV: "test",
      CODEK_TOKEN: "secret-token",
      PATH: "C:\\Users\\alice\\bin;D:\\Workspace\\node_modules\\.bin",
    })
    service.setExtensions([
      { id: "publisher.theme", name: "Theme", publisher: "publisher", version: "1.0.0", kind: "theme", enabled: true },
      { id: "acme.tool", name: "Tool", publisher: "acme", version: "2.0.0", kind: "workspace", enabled: true, activationEvents: ["onCommand:token"] },
      { id: "acme.disabled", name: "Disabled", publisher: "acme", version: "3.0.0", enabled: false },
    ])

    const snapshot = service.captureSnapshot({
      process: {
        app: {
          name: "Codek",
          version: "1.0.0",
          pid: 1234,
          platform: "win32",
          arch: "x64",
          memory: { rss: 2048, heapUsed: 1024 },
        },
        windows: [{ id: 1, title: "D:\\Workspace\\secret-project", rendererPid: 2222, focused: true, visible: true }],
        pty: {
          ptyAvailable: true,
          sessions: [{ id: "pty-1", pid: 3333, shellType: "powershell", cwd: "C:\\Users\\alice\\project", mode: "pty" }],
        },
        lsp: [{ id: "typescript", pid: 4444 }],
        dap: [{ id: "debug", pid: 5555, adapterType: "node" }],
      },
      workspace: {
        roots: ["D:\\Workspace", "C:\\Users\\alice\\private"],
        dirtyFiles: ["D:\\Workspace\\src\\main.ts"],
      },
      approval: {
        pending: 1,
        blocked: 2,
        latestReason: "requires token sk-secret",
      },
      agentEvidence: {
        reports: [".codek/reports/release-evidence-latest.json"],
        ready: false,
        summary: "blocked by secret sk-secret",
      },
    })

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      serviceId: "diagnosticsService",
      stateSource: "diagnosticsService",
      generatedAt: 1000,
      summary: {
        appName: "Codek",
        appVersion: "1.0.0",
        platform: "win32 x64",
        terminalSessions: 1,
        windows: 1,
        lspProcesses: 1,
        debugAdapters: 1,
        enabledExtensions: 2,
        workspaceRoots: 2,
        dirtyFiles: 1,
      },
      extensions: {
        total: 3,
        enabled: 2,
        disabled: 1,
        theme: 1,
        nonTheme: 2,
      },
      workspace: {
        dirtyFileCount: 1,
        rootsRedacted: true,
      },
      approval: {
        pending: 1,
        blocked: 2,
      },
      constraints: {
        noSecondDiagnosticsState: true,
        evidenceSafeActionsOnly: true,
        runtimeSelfContained: true,
      },
    })
    expect(snapshot.environment.keys).toEqual(expect.arrayContaining(["NODE_ENV", "CODEK_TOKEN", "PATH"]))
    expect(snapshot.environment.valuesRedacted).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain("secret-token")
    expect(JSON.stringify(snapshot)).not.toContain("sk-secret")
    expect(JSON.stringify(snapshot)).not.toContain("alice")
    expect(JSON.stringify(snapshot)).not.toContain("secret-project")
  })

  it("exports diagnostics text and evidence-safe action descriptors without mutating workspace state", () => {
    const service = new CodekDiagnosticsService({ now: () => 2000 })
    service.captureSnapshot({
      process: {
        app: { name: "Codek", version: "1.0.0", pid: 1, platform: "win32", arch: "x64" },
      },
    })

    const exportDescriptor = service.createExportDescriptor("json")
    const copyDescriptor = service.createCopyDescriptor()
    const text = service.getDiagnosticsText()

    expect(exportDescriptor).toMatchObject({
      commandId: "workbench.action.diagnostics.export",
      format: "json",
      targetPath: ".codek/reports/diagnostics-latest.json",
      readonlyEvidence: true,
      gitIndexMutation: false,
      shellExecution: false,
      redacted: true,
    })
    expect(copyDescriptor).toMatchObject({
      commandId: "workbench.action.diagnostics.copy",
      readonlyEvidence: true,
      gitIndexMutation: false,
    })
    expect(JSON.parse(text)).toMatchObject({
      serviceId: "diagnosticsService",
      generatedAt: 2000,
      privacy: { redacted: true },
    })
  })
})
