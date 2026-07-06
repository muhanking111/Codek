import { globalDiagnosticsService, IDiagnosticsService } from "../diagnostics/diagnosticsService"
import { globalIssueReporterService, IIssueReporterService, type IssueReporterCollectOptions } from "../issueReporter/issueReporterService"
import { Action2, MenuId, registerAction2 } from "../vscode-adapter/platform/actions/common/menuRegistry"
import type { Disposable } from "../vscode-adapter/platform/commands/common/commandsRegistry"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { registerView, registerViewContainer } from "./viewRegistry"

export const ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS = {
  Container: "codek.view.issueReporterDiagnostics",
  IssueReporter: "codek.issueReporter.surface",
  Diagnostics: "codek.diagnostics.surface",
} as const

export const ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS = {
  OpenIssueReporter: "workbench.action.issueReporter.open",
  CreateIssueDraft: "workbench.action.issueReporter.createLocalDraft",
  ExportIssueDraft: "workbench.action.issueReporter.exportLocalDraft",
  CopyDiagnostics: "workbench.action.diagnostics.copy",
  ExportDiagnostics: "workbench.action.diagnostics.export",
} as const

export interface IssueReporterDiagnosticsActionEvidence {
  commandId: string
  title: string
  targetPath: string
  format: string
  readonlyEvidence: true
  gitIndexMutation: false
  shellExecution: false
  redacted: true
}

export interface IssueReporterDiagnosticsWorkbenchSnapshot {
  source: "issueReporterDiagnosticsWorkbenchService"
  containerId: typeof ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.Container
  viewIds: string[]
  commandIds: string[]
  serviceIds: {
    issueReporter: "issueReporterService"
    diagnostics: "diagnosticsService"
  }
  stateSource: "facade"
  diagnostics: ReturnType<typeof globalDiagnosticsService.getSnapshot>
  issueReporter: ReturnType<typeof globalIssueReporterService.getLatestData>
  latestAction: IssueReporterDiagnosticsActionEvidence | null
  actions: IssueReporterDiagnosticsActionEvidence[]
  constraints: {
    noSecondIssueReporterState: true
    noSecondDiagnosticsState: true
    preservesAgentEvidence: true
    evidenceSafeActionsOnly: true
  }
}

export interface IIssueReporterDiagnosticsWorkbenchService {
  readonly _serviceBrand: undefined
  openIssueReporter(options?: IssueReporterCollectOptions): IssueReporterDiagnosticsActionEvidence
  createIssueDraft(options?: IssueReporterCollectOptions): IssueReporterDiagnosticsActionEvidence
  exportIssueDraft(options?: IssueReporterCollectOptions): IssueReporterDiagnosticsActionEvidence
  copyDiagnostics(): IssueReporterDiagnosticsActionEvidence
  exportDiagnostics(): IssueReporterDiagnosticsActionEvidence
  getSnapshot(): IssueReporterDiagnosticsWorkbenchSnapshot
  getActionHistory(): IssueReporterDiagnosticsActionEvidence[]
  clearEvidence(): void
}

export const IIssueReporterDiagnosticsWorkbenchService = createDecorator<IIssueReporterDiagnosticsWorkbenchService>("issueReporterDiagnosticsWorkbenchService")

export class IssueReporterDiagnosticsWorkbenchService implements IIssueReporterDiagnosticsWorkbenchService {
  declare readonly _serviceBrand: undefined
  private readonly actions: IssueReporterDiagnosticsActionEvidence[] = []

  openIssueReporter(options: IssueReporterCollectOptions = {}): IssueReporterDiagnosticsActionEvidence {
    globalIssueReporterService.collectData(options)
    return this.recordAction({
      commandId: ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS.OpenIssueReporter,
      title: "Issue Reporter: Open",
      targetPath: "codek://issue-reporter",
      format: "view",
      readonlyEvidence: true,
      gitIndexMutation: false,
      shellExecution: false,
      redacted: true,
    })
  }

  createIssueDraft(options: IssueReporterCollectOptions = {}): IssueReporterDiagnosticsActionEvidence {
    const draft = globalIssueReporterService.createDraft(options)
    return this.recordAction(toActionEvidence(draft))
  }

  exportIssueDraft(options: IssueReporterCollectOptions = {}): IssueReporterDiagnosticsActionEvidence {
    const draft = globalIssueReporterService.createExportDescriptor(options)
    return this.recordAction(toActionEvidence(draft))
  }

  copyDiagnostics(): IssueReporterDiagnosticsActionEvidence {
    globalDiagnosticsService.captureSnapshot()
    return this.recordAction(toActionEvidence(globalDiagnosticsService.createCopyDescriptor()))
  }

  exportDiagnostics(): IssueReporterDiagnosticsActionEvidence {
    globalDiagnosticsService.captureSnapshot()
    return this.recordAction(toActionEvidence(globalDiagnosticsService.createExportDescriptor("json")))
  }

  getSnapshot(): IssueReporterDiagnosticsWorkbenchSnapshot {
    return {
      source: "issueReporterDiagnosticsWorkbenchService",
      containerId: ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.Container,
      viewIds: [
        ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.IssueReporter,
        ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.Diagnostics,
      ],
      commandIds: Object.values(ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS),
      serviceIds: {
        issueReporter: String(IIssueReporterService) as "issueReporterService",
        diagnostics: String(IDiagnosticsService) as "diagnosticsService",
      },
      stateSource: "facade",
      diagnostics: globalDiagnosticsService.getSnapshot(),
      issueReporter: globalIssueReporterService.getLatestData(),
      latestAction: this.actions.at(-1) || null,
      actions: this.getActionHistory(),
      constraints: {
        noSecondIssueReporterState: true,
        noSecondDiagnosticsState: true,
        preservesAgentEvidence: true,
        evidenceSafeActionsOnly: true,
      },
    }
  }

  getActionHistory(): IssueReporterDiagnosticsActionEvidence[] {
    return this.actions.map((action) => ({ ...action }))
  }

  clearEvidence(): void {
    this.actions.length = 0
  }

  private recordAction(action: IssueReporterDiagnosticsActionEvidence): IssueReporterDiagnosticsActionEvidence {
    this.actions.push(action)
    return action
  }
}

export const globalIssueReporterDiagnosticsWorkbenchService = new IssueReporterDiagnosticsWorkbenchService()
registerSingleton(IIssueReporterDiagnosticsWorkbenchService, globalIssueReporterDiagnosticsWorkbenchService, InstantiationType.Delayed)

let registrations: Disposable[] = []

export function registerIssueReporterDiagnosticsWorkbenchContributions(): Disposable {
  disposeIssueReporterDiagnosticsWorkbenchContributions()
  registerIssueReporterDiagnosticsViews()
  registrations = [
    registerOpenIssueReporterAction(),
    registerCreateIssueDraftAction(),
    registerExportIssueDraftAction(),
    registerCopyDiagnosticsAction(),
    registerExportDiagnosticsAction(),
  ]
  return { dispose: disposeIssueReporterDiagnosticsWorkbenchContributions }
}

export function disposeIssueReporterDiagnosticsWorkbenchContributions(): void {
  for (const disposable of registrations.splice(0)) disposable.dispose()
}

export function clearIssueReporterDiagnosticsWorkbenchEvidence(): void {
  globalIssueReporterDiagnosticsWorkbenchService.clearEvidence()
  globalIssueReporterService.reset()
  globalDiagnosticsService.reset()
}

export function getIssueReporterDiagnosticsWorkbenchSnapshot(): IssueReporterDiagnosticsWorkbenchSnapshot {
  return globalIssueReporterDiagnosticsWorkbenchService.getSnapshot()
}

function registerIssueReporterDiagnosticsViews(): void {
  registerViewContainer({
    id: ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.Container,
    name: "Issue Reporter / Diagnostics",
    location: "activityBar",
    icon: "report",
    source: "vscode",
    order: 58,
  })
  registerView({
    id: ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.IssueReporter,
    name: "Issue Reporter",
    containerId: ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 10,
  })
  registerView({
    id: ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.Diagnostics,
    name: "Diagnostics",
    containerId: ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 20,
  })
}

function registerOpenIssueReporterAction(): Disposable {
  return registerAction2(class OpenIssueReporterAction extends Action2 {
    constructor() {
      super({
        id: ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS.OpenIssueReporter,
        title: "Issue Reporter: Open",
        category: "Issue Reporter",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.MenubarHelpMenu, group: "navigation", order: 60 },
      })
    }

    run(_accessor: unknown, options?: IssueReporterCollectOptions): void {
      globalIssueReporterDiagnosticsWorkbenchService.openIssueReporter(options)
    }
  })
}

function registerCreateIssueDraftAction(): Disposable {
  return registerAction2(class CreateIssueDraftAction extends Action2 {
    constructor() {
      super({
        id: ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS.CreateIssueDraft,
        title: "Issue Reporter: Create Local Draft",
        category: "Issue Reporter",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.ViewTitle, when: `view == ${ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.IssueReporter}`, group: "navigation", order: 10 },
      })
    }

    run(_accessor: unknown, options?: IssueReporterCollectOptions): void {
      globalIssueReporterDiagnosticsWorkbenchService.createIssueDraft(options)
    }
  })
}

function registerExportIssueDraftAction(): Disposable {
  return registerAction2(class ExportIssueDraftAction extends Action2 {
    constructor() {
      super({
        id: ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS.ExportIssueDraft,
        title: "Issue Reporter: Export Local Draft",
        category: "Issue Reporter",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.ViewTitle, when: `view == ${ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.IssueReporter}`, group: "navigation", order: 20 },
      })
    }

    run(_accessor: unknown, options?: IssueReporterCollectOptions): void {
      globalIssueReporterDiagnosticsWorkbenchService.exportIssueDraft(options)
    }
  })
}

function registerCopyDiagnosticsAction(): Disposable {
  return registerAction2(class CopyDiagnosticsAction extends Action2 {
    constructor() {
      super({
        id: ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS.CopyDiagnostics,
        title: "Diagnostics: Copy Redacted Snapshot",
        category: "Diagnostics",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.ViewTitle, when: `view == ${ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.Diagnostics}`, group: "navigation", order: 10 },
      })
    }

    run(): void {
      globalIssueReporterDiagnosticsWorkbenchService.copyDiagnostics()
    }
  })
}

function registerExportDiagnosticsAction(): Disposable {
  return registerAction2(class ExportDiagnosticsAction extends Action2 {
    constructor() {
      super({
        id: ISSUE_REPORTER_DIAGNOSTICS_COMMAND_IDS.ExportDiagnostics,
        title: "Diagnostics: Export Local Report",
        category: "Diagnostics",
        f1: true,
        source: "vscode",
        menu: { id: MenuId.ViewTitle, when: `view == ${ISSUE_REPORTER_DIAGNOSTICS_VIEW_IDS.Diagnostics}`, group: "navigation", order: 20 },
      })
    }

    run(): void {
      globalIssueReporterDiagnosticsWorkbenchService.exportDiagnostics()
    }
  })
}

function toActionEvidence(value: { commandId: string; title: string; targetPath: string; format: string; readonlyEvidence: true; gitIndexMutation: false; shellExecution: false; redacted: true }): IssueReporterDiagnosticsActionEvidence {
  return {
    commandId: value.commandId,
    title: value.title,
    targetPath: value.targetPath,
    format: value.format,
    readonlyEvidence: true,
    gitIndexMutation: false,
    shellExecution: false,
    redacted: true,
  }
}
