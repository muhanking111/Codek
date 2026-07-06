import {
  globalDiagnosticsService,
  IDiagnosticsService,
  type DiagnosticsAgentEvidenceInput,
  type DiagnosticsSnapshot,
  type DiagnosticsSnapshotInput,
  type DiagnosticsWorkspaceInput,
  type IDiagnosticsService as DiagnosticsService,
  redactSensitiveString,
} from "../diagnostics/diagnosticsService"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import type { ProcessSnapshot } from "../workbench/processDiagnostics"

export type IssueReporterType = "bug" | "performance" | "feature"

export interface IssueReporterCollectOptions {
  issueType?: IssueReporterType
  title?: string
  description?: string
  includeProcessInfo?: boolean
  includeWorkspaceInfo?: boolean
  includeExtensions?: boolean
  includeAgentEvidence?: boolean
  process?: ProcessSnapshot
  workspace?: DiagnosticsWorkspaceInput
  agentEvidence?: DiagnosticsAgentEvidenceInput
}

export interface IssueReporterData {
  source: "issueReporterService"
  diagnosticsStateSource: "diagnosticsService"
  generatedAt: number
  issueType: IssueReporterType
  title: string
  description: string
  includeProcessInfo: boolean
  includeWorkspaceInfo: boolean
  includeExtensions: boolean
  includeAgentEvidence: boolean
  diagnostics: DiagnosticsSnapshot
  extensions: {
    enabledNonTheme: DiagnosticsSnapshot["extensions"]["items"]
    themeCount: number
    disabledCount: number
  }
  constraints: {
    noSecondIssueReporterState: true
    noSecondDiagnosticsState: true
    localDraftOnly: true
    evidenceSafeActionsOnly: true
  }
}

export interface IssueReporterDraftDescriptor {
  commandId: string
  title: string
  targetPath: ".codek/reports/issue-report-draft-latest.md"
  format: "markdown"
  body: string
  readonlyEvidence: true
  externalPost: false
  gitIndexMutation: false
  shellExecution: false
  redacted: true
}

export interface IIssueReporterService {
  readonly _serviceBrand: undefined
  collectData(options?: IssueReporterCollectOptions): IssueReporterData
  createDraft(options?: IssueReporterCollectOptions): IssueReporterDraftDescriptor
  createExportDescriptor(options?: IssueReporterCollectOptions): IssueReporterDraftDescriptor
  getLatestData(): IssueReporterData | null
  getLatestDraft(): IssueReporterDraftDescriptor | null
  reset(): void
}

export interface IssueReporterServiceOptions {
  diagnosticsService?: DiagnosticsService
  now?: () => number
}

export const IIssueReporterService = createDecorator<IIssueReporterService>("issueReporterService")

export class CodekIssueReporterService implements IIssueReporterService {
  declare readonly _serviceBrand: undefined
  private readonly diagnosticsService: DiagnosticsService
  private readonly now: () => number
  private latestData: IssueReporterData | null = null
  private latestDraft: IssueReporterDraftDescriptor | null = null

  constructor(options: IssueReporterServiceOptions = {}) {
    this.diagnosticsService = options.diagnosticsService || globalDiagnosticsService
    this.now = options.now ?? (() => Date.now())
  }

  collectData(options: IssueReporterCollectOptions = {}): IssueReporterData {
    const diagnostics = this.diagnosticsService.captureSnapshot(toDiagnosticsInput(options))
    const data: IssueReporterData = {
      source: "issueReporterService",
      diagnosticsStateSource: "diagnosticsService",
      generatedAt: this.now(),
      issueType: normalizeIssueType(options.issueType),
      title: redactSensitiveString(options.title || ""),
      description: redactSensitiveString(options.description || ""),
      includeProcessInfo: options.includeProcessInfo !== false,
      includeWorkspaceInfo: options.includeWorkspaceInfo !== false,
      includeExtensions: options.includeExtensions !== false,
      includeAgentEvidence: options.includeAgentEvidence === true,
      diagnostics,
      extensions: {
        enabledNonTheme: diagnostics.extensions.items.filter((extension) => extension.enabled !== false && extension.kind !== "theme"),
        themeCount: diagnostics.extensions.theme,
        disabledCount: diagnostics.extensions.disabled,
      },
      constraints: {
        noSecondIssueReporterState: true,
        noSecondDiagnosticsState: true,
        localDraftOnly: true,
        evidenceSafeActionsOnly: true,
      },
    }
    this.latestData = data
    return data
  }

  createDraft(options: IssueReporterCollectOptions = {}): IssueReporterDraftDescriptor {
    const data = this.collectData(options)
    const draft = this.toDraftDescriptor(data, "workbench.action.issueReporter.createLocalDraft", "Issue Reporter: Create Local Draft")
    this.latestDraft = draft
    return draft
  }

  createExportDescriptor(options: IssueReporterCollectOptions = {}): IssueReporterDraftDescriptor {
    const data = this.collectData(options)
    const draft = this.toDraftDescriptor(data, "workbench.action.issueReporter.exportLocalDraft", "Issue Reporter: Export Local Draft")
    this.latestDraft = draft
    return draft
  }

  getLatestData(): IssueReporterData | null {
    return this.latestData
  }

  getLatestDraft(): IssueReporterDraftDescriptor | null {
    return this.latestDraft
  }

  reset(): void {
    this.latestData = null
    this.latestDraft = null
  }

  private toDraftDescriptor(data: IssueReporterData, commandId: string, title: string): IssueReporterDraftDescriptor {
    return {
      commandId,
      title,
      targetPath: ".codek/reports/issue-report-draft-latest.md",
      format: "markdown",
      body: serializeIssueReporterData(data),
      readonlyEvidence: true,
      externalPost: false,
      gitIndexMutation: false,
      shellExecution: false,
      redacted: true,
    }
  }
}

export function createIssueReporterService(options?: IssueReporterServiceOptions): CodekIssueReporterService {
  return new CodekIssueReporterService(options)
}

export const globalIssueReporterService = new CodekIssueReporterService({ diagnosticsService: globalDiagnosticsService })
registerSingleton(IIssueReporterService, globalIssueReporterService, InstantiationType.Delayed)

function toDiagnosticsInput(options: IssueReporterCollectOptions): DiagnosticsSnapshotInput {
  return {
    process: options.process,
    workspace: options.workspace,
    agentEvidence: options.agentEvidence,
  }
}

function serializeIssueReporterData(data: IssueReporterData): string {
  const lines = [
    `Type: ${issueTypeTitle(data.issueType)}`,
    `Title: ${data.title}`,
    "",
    data.description,
    "",
  ]
  if (data.includeProcessInfo) {
    lines.push(detailsBlock("Process Info", JSON.stringify(data.diagnostics.process, null, 2)))
  }
  if (data.includeWorkspaceInfo) {
    lines.push(detailsBlock("Workspace Info", JSON.stringify(data.diagnostics.workspace, null, 2)))
  }
  if (data.includeExtensions) {
    const table = [
      "Extension|Publisher|Version",
      "---|---|---",
      ...data.extensions.enabledNonTheme.map((extension) =>
        `${extension.name || extension.id}|${extension.publisher || ""}|${extension.version || ""}`,
      ),
    ].join("\n")
    lines.push(`<details><summary>Extensions (${data.extensions.enabledNonTheme.length})</summary>\n\n${table}\n\n</details>`)
  }
  if (data.includeAgentEvidence) {
    lines.push(detailsBlock("Agent Evidence", JSON.stringify(data.diagnostics.agentEvidence, null, 2)))
  }
  lines.push("<!-- generated by Codek issue reporter -->")
  return redactSensitiveString(lines.join("\n"))
}

function detailsBlock(summary: string, body: string): string {
  return `<details>\n<summary>${summary}</summary>\n\n\`\`\`json\n${body}\n\`\`\`\n\n</details>`
}

function issueTypeTitle(type: IssueReporterType): string {
  if (type === "performance") return "Performance Issue"
  if (type === "feature") return "Feature Request"
  return "Bug"
}

function normalizeIssueType(value: IssueReporterType | undefined): IssueReporterType {
  return value === "performance" || value === "feature" || value === "bug" ? value : "bug"
}

void IDiagnosticsService
