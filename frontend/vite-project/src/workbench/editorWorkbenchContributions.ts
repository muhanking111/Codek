// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\services\editor\common\editorService.ts
// - D:\SourceMirror\vscode\src\vs\workbench\services\outline\browser\outlineService.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\breadcrumbs\browser\breadcrumbs.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\outline\browser\outline.contribution.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\markers\browser\markers.contribution.ts
//
// Codek keeps its existing editor, breadcrumbs, outline, and marker-backed
// Problems models as the state sources. This module contributes VS Code-style
// service ids, command ids, menus, and legacy entry proxies around those models.

import { Action2, MenuId, MenuRegistry, registerAction2 } from "../vscode-adapter/platform/actions/common/menuRegistry"
import type { Disposable } from "../vscode-adapter/platform/commands/common/commandsRegistry"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { IMarkerService } from "../vscode-adapter/platform/markers/common/markers"
import {
  globalWorkbenchExplorerEditorService,
  type BreadcrumbsModel,
  type IWorkbenchExplorerEditorService as EditorWorkbenchService,
} from "./workbenchExplorerEditorService"
import {
  globalSymbolNavigationWorkbenchService,
  type CodekOutlineModel,
  type ISymbolNavigationWorkbenchService as OutlineWorkbenchService,
} from "./symbolNavigationService"
import { globalProblemsDiagnosticsService, type ProblemsVisibleProjection } from "./problemsDiagnosticsService"
import { executeCommand, getCommand } from "./commandRegistry"

export const IEditorService = createDecorator<EditorWorkbenchService>("editorService")
export const IOutlineService = createDecorator<OutlineWorkbenchService>("outlineService")

export const EDITOR_WORKBENCH_VIEW_IDS = {
  Breadcrumbs: "workbench.parts.editor.breadcrumbs",
  Outline: "workbench.view.outline",
  ProblemsContainer: "workbench.panel.markers",
  Problems: "workbench.panel.markers.view",
} as const

export const EDITOR_WORKBENCH_COMMAND_IDS = {
  WorkspaceSymbols: "workbench.action.showAllSymbols",
  LegacyWorkspaceSymbols: "workbench.action.gotoSymbol",
  EditorSymbols: "workbench.action.gotoSymbolInEditor",
  FocusOutline: "outline.focus",
  ToggleProblems: "workbench.actions.view.toggleProblems",
  LegacyProblems: "workbench.actions.view.problems",
  FocusProblems: "workbench.action.problems.focus",
  NextProblem: "editor.action.marker.next",
  PreviousProblem: "editor.action.marker.prev",
} as const

export interface EditorWorkbenchContributionContext {
  editorService?: EditorWorkbenchService
  outlineService?: OutlineWorkbenchService
  problemsService?: {
    createVisibleProjection(): ProblemsVisibleProjection
  }
  getActiveFile?: () => string | null | undefined
  getEditor?: () => unknown
  openFile?: (path: string) => Promise<unknown>
  openSidebarView?: (view: string) => void
  setSymbolQuery?: (query: string) => void
  setProblemsVisible?: (visible: boolean) => void
  openNextProblem?: (direction: 1 | -1) => void
  nextTick?: (callback?: () => void) => Promise<void> | void
}

export interface EditorWorkbenchContributionSurface {
  source: "vscode-adapted"
  services: Array<{ id: string; source: "vscode"; stateSource: string }>
  viewsByArea: Record<"breadcrumbs" | "outline" | "problems", string[]>
  commandsByArea: Record<"outline" | "problems", string[]>
  commands: Array<{
    id: string
    category: "Navigation" | "View"
    serviceId: string
    menus: Array<{ id: string; group?: string; order?: number; when?: string }>
  }>
  stateSources: {
    editor: "workbenchExplorerEditorService"
    breadcrumbs: "workbenchExplorerEditorService"
    outline: "symbolNavigationWorkbenchService"
    problems: "problemsDiagnosticsService(globalMarkerService)"
  }
  constraints: {
    noSecondEditorState: true
    noSecondOutlineState: true
    noSecondProblemsState: true
    selfContainedRuntime: true
  }
}

export interface EditorWorkbenchSnapshot {
  serviceId: string
  stateSource: "workbenchExplorerEditorService"
  breadcrumbs: BreadcrumbsModel
  outline: CodekOutlineModel | null
  problems: ProblemsVisibleProjection
  contributionSurface: EditorWorkbenchContributionSurface
}

let contributionDisposables: Disposable[] = []
let contributionContext: Required<Pick<EditorWorkbenchContributionContext, "editorService" | "outlineService" | "problemsService">>
  & EditorWorkbenchContributionContext = createDefaultContributionContext()

registerSingleton(IEditorService, globalWorkbenchExplorerEditorService, InstantiationType.Delayed)
registerSingleton(IOutlineService, globalSymbolNavigationWorkbenchService, InstantiationType.Delayed)

export function registerEditorWorkbenchContributions(context: EditorWorkbenchContributionContext = {}): Disposable {
  disposeEditorWorkbenchContributions()
  contributionContext = {
    ...createDefaultContributionContext(),
    ...context,
    editorService: context.editorService || globalWorkbenchExplorerEditorService,
    outlineService: context.outlineService || globalSymbolNavigationWorkbenchService,
    problemsService: context.problemsService || globalProblemsDiagnosticsService,
  }

  contributionDisposables = createEditorWorkbenchActionDisposables()
  return { dispose: disposeEditorWorkbenchContributions }
}

export function disposeEditorWorkbenchContributions(): void {
  for (const disposable of contributionDisposables.splice(0)) disposable.dispose()
  contributionContext = createDefaultContributionContext()
}

export async function buildEditorWorkbenchSnapshot(activeFile = contributionContext.getActiveFile?.() || ""): Promise<EditorWorkbenchSnapshot> {
  const file = String(activeFile || "")
  return {
    serviceId: String(IEditorService),
    stateSource: "workbenchExplorerEditorService",
    breadcrumbs: contributionContext.editorService.getBreadcrumbs(),
    outline: file ? await contributionContext.outlineService.getOutlineModel(file) : null,
    problems: contributionContext.problemsService.createVisibleProjection(),
    contributionSurface: buildEditorWorkbenchContributionSurface(),
  }
}

export function buildEditorWorkbenchContributionSurface(): EditorWorkbenchContributionSurface {
  const commandsByArea: EditorWorkbenchContributionSurface["commandsByArea"] = {
    outline: [
      EDITOR_WORKBENCH_COMMAND_IDS.WorkspaceSymbols,
      EDITOR_WORKBENCH_COMMAND_IDS.LegacyWorkspaceSymbols,
      EDITOR_WORKBENCH_COMMAND_IDS.EditorSymbols,
      EDITOR_WORKBENCH_COMMAND_IDS.FocusOutline,
    ],
    problems: [
      EDITOR_WORKBENCH_COMMAND_IDS.ToggleProblems,
      EDITOR_WORKBENCH_COMMAND_IDS.LegacyProblems,
      EDITOR_WORKBENCH_COMMAND_IDS.FocusProblems,
      EDITOR_WORKBENCH_COMMAND_IDS.NextProblem,
      EDITOR_WORKBENCH_COMMAND_IDS.PreviousProblem,
    ],
  }

  return {
    source: "vscode-adapted",
    services: [
      { id: String(IEditorService), source: "vscode", stateSource: "workbenchExplorerEditorService" },
      { id: String(IOutlineService), source: "vscode", stateSource: "symbolNavigationWorkbenchService" },
      { id: String(IMarkerService), source: "vscode", stateSource: "problemsDiagnosticsService(globalMarkerService)" },
    ],
    viewsByArea: {
      breadcrumbs: [EDITOR_WORKBENCH_VIEW_IDS.Breadcrumbs],
      outline: [EDITOR_WORKBENCH_VIEW_IDS.Outline],
      problems: [EDITOR_WORKBENCH_VIEW_IDS.ProblemsContainer, EDITOR_WORKBENCH_VIEW_IDS.Problems],
    },
    commandsByArea,
    commands: Object.entries(commandsByArea).flatMap(([area, ids]) =>
      ids.map((id) => ({
        id,
        category: area === "outline" ? "Navigation" : "View",
        serviceId: area === "outline" ? String(IOutlineService) : String(IMarkerService),
        menus: commandMenus(id).map((menu) => ({
          id: menu.id.id,
          group: menu.group,
          order: menu.order,
          when: menu.when,
        })),
      })),
    ),
    stateSources: {
      editor: "workbenchExplorerEditorService",
      breadcrumbs: "workbenchExplorerEditorService",
      outline: "symbolNavigationWorkbenchService",
      problems: "problemsDiagnosticsService(globalMarkerService)",
    },
    constraints: {
      noSecondEditorState: true,
      noSecondOutlineState: true,
      noSecondProblemsState: true,
      selfContainedRuntime: true,
    },
  }
}

function createEditorWorkbenchActionDisposables(): Disposable[] {
  return [
    registerAction2(class WorkspaceSymbolsAction extends Action2 {
      constructor() {
        super({
          id: EDITOR_WORKBENCH_COMMAND_IDS.WorkspaceSymbols,
          title: "Go to Symbol in Workspace",
          category: "Navigation",
          f1: true,
          menu: commandMenus(EDITOR_WORKBENCH_COMMAND_IDS.WorkspaceSymbols),
          source: "vscode",
        })
      }

      run(_accessor: unknown, query = ""): void {
        openWorkspaceSymbols(String(query || ""))
      }
    }),
    registerAction2(class LegacyWorkspaceSymbolsAction extends Action2 {
      constructor() {
        super({
          id: EDITOR_WORKBENCH_COMMAND_IDS.LegacyWorkspaceSymbols,
          title: "Go to Symbol in Workspace",
          category: "Navigation",
          f1: false,
          source: "vscode",
        })
      }

      run(_accessor: unknown, query = ""): void {
        openWorkspaceSymbols(String(query || ""))
      }
    }),
    registerAction2(class EditorSymbolsAction extends Action2 {
      constructor() {
        super({
          id: EDITOR_WORKBENCH_COMMAND_IDS.EditorSymbols,
          title: "Go to Symbol in Editor",
          category: "Navigation",
          f1: true,
          menu: commandMenus(EDITOR_WORKBENCH_COMMAND_IDS.EditorSymbols),
          source: "vscode",
          precondition: "editorTextFocus",
        })
      }

      run(): void {
        openEditorSymbols()
      }
    }),
    registerAction2(class FocusOutlineAction extends Action2 {
      constructor() {
        super({
          id: EDITOR_WORKBENCH_COMMAND_IDS.FocusOutline,
          title: "Focus Outline",
          category: "View",
          f1: true,
          menu: commandMenus(EDITOR_WORKBENCH_COMMAND_IDS.FocusOutline),
          source: "vscode",
        })
      }

      run(): void {
        contributionContext.openSidebarView?.("symbols")
      }
    }),
    registerAction2(class ToggleProblemsAction extends Action2 {
      constructor() {
        super({
          id: EDITOR_WORKBENCH_COMMAND_IDS.ToggleProblems,
          title: "Problems: Toggle Problems",
          category: "View",
          f1: !getCommand(EDITOR_WORKBENCH_COMMAND_IDS.ToggleProblems),
          menu: getCommand(EDITOR_WORKBENCH_COMMAND_IDS.ToggleProblems)
            ? []
            : commandMenus(EDITOR_WORKBENCH_COMMAND_IDS.ToggleProblems),
          source: "vscode",
        })
      }

      async run(): Promise<void> {
        if (await executeExisting(EDITOR_WORKBENCH_COMMAND_IDS.ToggleProblems)) return
        contributionContext.setProblemsVisible?.(true)
      }
    }),
    registerAction2(class LegacyProblemsAction extends Action2 {
      constructor() {
        super({
          id: EDITOR_WORKBENCH_COMMAND_IDS.LegacyProblems,
          title: "Problems",
          category: "View",
          f1: false,
          source: "vscode",
        })
      }

      async run(): Promise<void> {
        if (await executeExisting(EDITOR_WORKBENCH_COMMAND_IDS.ToggleProblems)) return
        contributionContext.setProblemsVisible?.(true)
      }
    }),
    registerAction2(class FocusProblemsAction extends Action2 {
      constructor() {
        super({
          id: EDITOR_WORKBENCH_COMMAND_IDS.FocusProblems,
          title: "Problems: Focus on Problems View",
          category: "View",
          f1: !getCommand(EDITOR_WORKBENCH_COMMAND_IDS.FocusProblems),
          menu: getCommand(EDITOR_WORKBENCH_COMMAND_IDS.FocusProblems)
            ? []
            : commandMenus(EDITOR_WORKBENCH_COMMAND_IDS.FocusProblems),
          source: "vscode",
        })
      }

      async run(): Promise<void> {
        if (await executeExisting(EDITOR_WORKBENCH_COMMAND_IDS.FocusProblems)) return
        contributionContext.setProblemsVisible?.(true)
      }
    }),
    registerAction2(class NextProblemAction extends Action2 {
      constructor() {
        super({
          id: EDITOR_WORKBENCH_COMMAND_IDS.NextProblem,
          title: "Go to Next Problem",
          category: "Navigation",
          f1: true,
          menu: commandMenus(EDITOR_WORKBENCH_COMMAND_IDS.NextProblem),
          source: "vscode",
        })
      }

      run(): void {
        contributionContext.openNextProblem?.(1)
      }
    }),
    registerAction2(class PreviousProblemAction extends Action2 {
      constructor() {
        super({
          id: EDITOR_WORKBENCH_COMMAND_IDS.PreviousProblem,
          title: "Go to Previous Problem",
          category: "Navigation",
          f1: true,
          menu: commandMenus(EDITOR_WORKBENCH_COMMAND_IDS.PreviousProblem),
          source: "vscode",
        })
      }

      run(): void {
        contributionContext.openNextProblem?.(-1)
      }
    }),
  ]
}

function openWorkspaceSymbols(query: string): void {
  contributionContext.openSidebarView?.("symbols")
  runNextTick(() => contributionContext.setSymbolQuery?.(query))
}

function openEditorSymbols(): void {
  contributionContext.openSidebarView?.("symbols")
  runNextTick(() => contributionContext.setSymbolQuery?.("@"))
}

function runNextTick(callback: () => void): void {
  if (!contributionContext.nextTick) {
    callback()
    return
  }
  contributionContext.nextTick(callback)
}

async function executeExisting(commandId: string): Promise<boolean> {
  const existing = getCommand(commandId)
  if (!existing || existing.source === "vscode") return false
  return executeCommand(commandId)
}

function commandMenus(commandId: string): Array<{ id: MenuId; group?: "navigation" | string; order?: number; when?: string }> {
  switch (commandId) {
    case EDITOR_WORKBENCH_COMMAND_IDS.WorkspaceSymbols:
      return [
        { id: MenuId.CommandPalette, group: "navigation", order: 10 },
        { id: MenuId.MenubarGoMenu, group: "navigation", order: 20 },
      ]
    case EDITOR_WORKBENCH_COMMAND_IDS.EditorSymbols:
      return [
        { id: MenuId.CommandPalette, group: "navigation", order: 11, when: "editorTextFocus" },
        { id: MenuId.MenubarGoMenu, group: "navigation", order: 21, when: "editorTextFocus" },
        { id: MenuId.EditorTitle, group: "navigation", order: 30, when: "editorTextFocus" },
      ]
    case EDITOR_WORKBENCH_COMMAND_IDS.FocusOutline:
      return [
        { id: MenuId.CommandPalette, group: "navigation", order: 12 },
        { id: MenuId.MenubarViewMenu, group: "navigation", order: 30 },
      ]
    case EDITOR_WORKBENCH_COMMAND_IDS.ToggleProblems:
      return [
        { id: MenuId.CommandPalette, group: "navigation", order: 40 },
        { id: MenuId.MenubarViewMenu, group: "navigation", order: 41 },
      ]
    case EDITOR_WORKBENCH_COMMAND_IDS.FocusProblems:
      return [
        { id: MenuId.CommandPalette, group: "navigation", order: 42 },
      ]
    case EDITOR_WORKBENCH_COMMAND_IDS.NextProblem:
      return [
        { id: MenuId.CommandPalette, group: "navigation", order: 50 },
        { id: MenuId.MenubarGoMenu, group: "navigation", order: 50 },
      ]
    case EDITOR_WORKBENCH_COMMAND_IDS.PreviousProblem:
      return [
        { id: MenuId.CommandPalette, group: "navigation", order: 51 },
        { id: MenuId.MenubarGoMenu, group: "navigation", order: 51 },
      ]
    default:
      return []
  }
}

function createDefaultContributionContext(): Required<Pick<EditorWorkbenchContributionContext, "editorService" | "outlineService" | "problemsService">>
  & EditorWorkbenchContributionContext {
  return {
    editorService: globalWorkbenchExplorerEditorService,
    outlineService: globalSymbolNavigationWorkbenchService,
    problemsService: globalProblemsDiagnosticsService,
  }
}
