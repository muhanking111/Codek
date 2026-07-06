import { beforeEach, describe, expect, it, vi } from "vitest"
import { MenuId, MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import { clearCommands, executeCommand, getCommand } from "./commandRegistry"
import { clearViews, getViewContainers, getViews } from "./viewRegistry"
import {
  ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS,
  ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS,
  clearIssueReporterDiagnosticsWorkbenchEvidence,
  getIssueReporterDiagnosticsWorkbenchSnapshot,
  globalIssueReporterDiagnosticsWorkbenchService,
  registerIssueReporterDiagnosticsWorkbenchContributions,
} from "./issueReporterDiagnosticsWorkbench"

describe("Issue Reporter / Diagnostics workbench contribution", () => {
  beforeEach(() => {
    vi.setSystemTime(6000)
    clearCommands()
    clearViews()
    MenuRegistry.clear()
    clearIssueReporterDiagnosticsWorkbenchEvidence()
  })

  it("registers diagnostics and issue reporter views, commands and menus", () => {
    registerIssueReporterDiagnosticsWorkbenchContributions()

    expect(getViewContainers("activityBar").map((container) => container.id)).toContain(
      ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.Container,
    )
    expect(getViews(ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.Container).map((view) => view.id)).toEqual(expect.arrayContaining([
      ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.IssueReporter,
      ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.Diagnostics,
    ]))

    const commandIds = Object.values(ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS)
    expect(commandIds.map((id) => getCommand(id)?.id)).toEqual(commandIds)

    const paletteIds = MenuRegistry.getMenuEntries(MenuId.CommandPalette).map((entry) => entry.type === "item" ? entry.commandId : entry.id)
    expect(paletteIds).toEqual(expect.arrayContaining(commandIds))

    const diagnosticsTitleIds = MenuRegistry.getMenuEntries(MenuId.ViewTitle, {
      view: ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.Diagnostics,
    }).map((entry) => entry.type === "item" ? entry.commandId : entry.id)
    expect(diagnosticsTitleIds).toEqual(expect.arrayContaining([
      ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS.CopyDiagnostics,
      ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS.ExportDiagnostics,
    ]))
  })

  it("executes actions as evidence-safe local descriptors from a single facade", async () => {
    registerIssueReporterDiagnosticsWorkbenchContributions()

    await executeCommand(ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS.CreateIssueDraft, [{
      issueType: "bug",
      title: "本地报告",
      description: "local draft",
      process: { app: { name: "Codek", version: "1.0.0", pid: 1, platform: "win32", arch: "x64" } },
    }])
    await executeCommand(ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS.ExportDiagnostics, [])

    const snapshot = getIssueReporterDiagnosticsWorkbenchSnapshot()

    expect(snapshot).toMatchObject({
      source: "issueReporterDiagnosticsWorkbenchService",
      serviceIds: {
        issueReporter: "issueReporterService",
        diagnostics: "diagnosticsService",
      },
      stateSource: "facade",
      constraints: {
        noSecondIssueReporterState: true,
        noSecondDiagnosticsState: true,
        preservesAgentEvidence: true,
        evidenceSafeActionsOnly: true,
      },
    })
    expect(snapshot.actions.map((action) => action.commandId)).toEqual(expect.arrayContaining([
      ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS.CreateIssueDraft,
      ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS.ExportDiagnostics,
    ]))
    expect(snapshot.latestAction).toMatchObject({
      commandId: ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS.ExportDiagnostics,
      readonlyEvidence: true,
      gitIndexMutation: false,
    })
    expect(globalIssueReporterDiagnosticsWorkbenchService.getActionHistory()).toHaveLength(2)
  })
})
