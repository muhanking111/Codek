import { beforeEach, describe, expect, it, vi } from "vitest"
import { CodekDiagnosticsService } from "../diagnostics/diagnosticsService"
import {
  CodekIssueReporterService,
  createIssueReporterService,
  globalIssueReporterService,
} from "./issueReporterService"

describe("issueReporterService", () => {
  beforeEach(() => {
    vi.setSystemTime(3000)
    globalIssueReporterService.reset()
  })

  it("collects issue reporter data from diagnostics without creating another diagnostics state source", () => {
    const diagnostics = new CodekDiagnosticsService({ now: () => 3000 })
    diagnostics.setExtensions([
      { id: "theme", name: "Theme", publisher: "codek", version: "1.0.0", kind: "theme", enabled: true },
      { id: "tool", name: "Tool", publisher: "codek", version: "2.0.0", enabled: true },
    ])
    const service = createIssueReporterService({ diagnosticsService: diagnostics, now: () => 3000 })

    const data = service.collectData({
      issueType: "performance",
      title: "启动慢",
      description: "Renderer became slow after opening D:\\Workspace\\secret",
      includeProcessInfo: true,
      includeWorkspaceInfo: true,
      includeExtensions: true,
      process: {
        app: { name: "Codek", version: "1.0.0", pid: 1, platform: "win32", arch: "x64" },
        pty: { ptyAvailable: true, sessions: [] },
      },
      workspace: { roots: ["D:\\Workspace\\secret"], dirtyFiles: ["D:\\Workspace\\secret\\a.ts"] },
    })

    expect(data).toMatchObject({
      issueType: "performance",
      title: "启动慢",
      includeProcessInfo: true,
      includeWorkspaceInfo: true,
      includeExtensions: true,
      source: "issueReporterService",
      diagnosticsStateSource: "diagnosticsService",
      diagnostics: {
        serviceId: "diagnosticsService",
        summary: {
          appName: "Codek",
          enabledExtensions: 2,
          workspaceRoots: 1,
          dirtyFiles: 1,
        },
      },
      constraints: {
        noSecondIssueReporterState: true,
        noSecondDiagnosticsState: true,
        localDraftOnly: true,
        evidenceSafeActionsOnly: true,
      },
    })
    expect(data.extensions.enabledNonTheme).toHaveLength(1)
    expect(JSON.stringify(data)).not.toContain("D:\\Workspace\\secret")
  })

  it("serializes a local redacted markdown draft with process workspace extensions and evidence sections", () => {
    const service = createIssueReporterService({
      diagnosticsService: new CodekDiagnosticsService({ now: () => 4000 }),
      now: () => 4000,
    })
    const draft = service.createDraft({
      issueType: "bug",
      title: "问题报告",
      description: "Token sk-secret should not leak",
      includeProcessInfo: true,
      includeWorkspaceInfo: true,
      includeExtensions: true,
      includeAgentEvidence: true,
      process: {
        app: { name: "Codek", version: "1.0.0", pid: 1, platform: "win32", arch: "x64" },
      },
      agentEvidence: {
        reports: [".codek/reports/release-evidence-latest.json"],
        ready: false,
        summary: "needs approval",
      },
    })

    expect(draft).toMatchObject({
      commandId: "workbench.action.issueReporter.createLocalDraft",
      targetPath: ".codek/reports/issue-report-draft-latest.md",
      format: "markdown",
      readonlyEvidence: true,
      gitIndexMutation: false,
      shellExecution: false,
      redacted: true,
    })
    expect(draft.body).toContain("Type: Bug")
    expect(draft.body).toContain("<summary>Process Info</summary>")
    expect(draft.body).toContain("<summary>Workspace Info</summary>")
    expect(draft.body).toContain("<summary>Extensions")
    expect(draft.body).toContain("<summary>Agent Evidence</summary>")
    expect(draft.body).not.toContain("sk-secret")
  })

  it("describes export actions as local evidence-safe descriptors instead of posting externally", () => {
    const service = new CodekIssueReporterService({
      diagnosticsService: new CodekDiagnosticsService({ now: () => 5000 }),
      now: () => 5000,
    })

    const descriptor = service.createExportDescriptor({
      issueType: "feature",
      title: "Add diagnostics",
      description: "local only",
    })

    expect(descriptor).toMatchObject({
      commandId: "workbench.action.issueReporter.exportLocalDraft",
      targetPath: ".codek/reports/issue-report-draft-latest.md",
      format: "markdown",
      readonlyEvidence: true,
      externalPost: false,
      gitIndexMutation: false,
      redacted: true,
    })
  })
})
