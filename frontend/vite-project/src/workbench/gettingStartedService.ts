// VS Code source adapter.
// Source reference:
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\welcomeGettingStarted\browser\gettingStartedService.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\welcomeGettingStarted\common\gettingStartedContent.ts
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\welcomeGettingStarted\browser\gettingStartedExtensionPoint.ts
//
// Codek keeps the runtime self-contained and projects the VS Code Getting
// Started service concepts into one local facade: start entries, walkthrough
// descriptors, when/context filtering, step completion, and evidence-safe
// onboarding actions.

import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { Action2, MenuId, MenuRegistry, registerAction2 } from "../vscode-adapter/platform/actions/common/menuRegistry"
import type { Disposable } from "../vscode-adapter/platform/commands/common/commandsRegistry"
import { evaluateWhenClause, type ContextKeyState } from "./contextKeys"

export { MenuId, MenuRegistry }

export const GETTING_STARTED_COMMAND_IDS = {
  OpenFolder: "workbench.action.files.openFolder",
  NewFile: "welcome.showNewFileEntries",
  CommandPalette: "workbench.action.showCommands",
  OpenChat: "workbench.action.chat.open",
  Remote: "workbench.action.remote.showMenu",
} as const

export type GettingStartedCommandId = typeof GETTING_STARTED_COMMAND_IDS[keyof typeof GETTING_STARTED_COMMAND_IDS]
export type GettingStartedSource = "builtin" | "extension" | "codek"
export type GettingStartedActionEvent = "openProject" | "newProject" | "openCommandPalette" | "openChat" | "openLink"

export interface GettingStartedMedia {
  readonly type: "image" | "svg" | "markdown" | "video"
  readonly path?: string | Record<string, string>
  readonly altText?: string
}

export interface GettingStartedStepDescriptor {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly when?: string
  readonly completionEvents?: readonly string[]
  readonly media: GettingStartedMedia
  readonly order?: number
}

export interface GettingStartedWalkthroughDescriptor {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly source?: GettingStartedSource
  readonly when?: string
  readonly order?: number
  readonly isFeatured?: boolean
  readonly next?: string
  readonly icon?: string
  readonly walkthroughPageTitle?: string
  readonly steps: readonly GettingStartedStepDescriptor[]
}

export interface GettingStartedResolvedStep extends GettingStartedStepDescriptor {
  readonly done: boolean
  readonly order: number
}

export interface GettingStartedResolvedWalkthrough extends Omit<GettingStartedWalkthroughDescriptor, "steps"> {
  readonly source: GettingStartedSource
  readonly order: number
  readonly isFeatured: boolean
  readonly walkthroughPageTitle: string
  readonly steps: readonly GettingStartedResolvedStep[]
  readonly totalSteps: number
  readonly completedSteps: number
  readonly progress: number
}

export interface GettingStartedStartEntry {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly commandId: GettingStartedCommandId
  readonly when?: string
  readonly order: number
  readonly icon?: string
  readonly event: GettingStartedActionEvent
  readonly target?: string
  readonly shortcut?: string
}

export interface WelcomeQuickAction {
  readonly id: string
  readonly label: string
  readonly shortcut?: string
  readonly event: GettingStartedActionEvent
  readonly target?: string
  readonly commandId: GettingStartedCommandId
}

export interface WelcomePageProjection {
  readonly primaryActions: readonly WelcomeQuickAction[]
  readonly startEntries: readonly GettingStartedStartEntry[]
  readonly categories: readonly GettingStartedResolvedWalkthrough[]
  readonly source: "IGettingStartedService"
}

export interface EvidenceSafeOnboardingAction {
  readonly id: GettingStartedCommandId
  readonly label: string
  readonly surface: "welcome" | "walkthrough" | "gettingStarted"
  readonly writesGitIndex: false
  readonly requiresApproval: boolean
}

export interface GettingStartedContributionSummary {
  readonly serviceIds: readonly string[]
  readonly sourceReferences: readonly string[]
  readonly commandIds: readonly GettingStartedCommandId[]
  readonly startEntryIds: readonly string[]
  readonly walkthroughIds: readonly string[]
  readonly menuIds: readonly string[]
  readonly stateSource: "IGettingStartedService"
  readonly evidenceSafeActions: readonly EvidenceSafeOnboardingAction[]
  readonly noSecondStateSource: true
}

export interface GettingStartedActionHandlers {
  readonly openFolder?: () => void | Promise<void>
  readonly newFile?: () => void | Promise<void>
  readonly openCommandPalette?: () => void | Promise<void>
  readonly openChat?: () => void | Promise<void>
  readonly openRemote?: () => void | Promise<void>
}

export interface IGettingStartedService {
  readonly _serviceBrand: undefined
  readonly onDidChangeWalkthrough: (listener: (walkthrough: GettingStartedResolvedWalkthrough) => void) => Disposable
  registerWalkthrough(descriptor: GettingStartedWalkthroughDescriptor): Disposable
  clearWalkthroughs(): void
  getStartEntries(context?: ContextKeyState): GettingStartedStartEntry[]
  getWalkthroughs(context?: ContextKeyState): GettingStartedResolvedWalkthrough[]
  getWalkthrough(id: string, context?: ContextKeyState): GettingStartedResolvedWalkthrough | null
  progressByEvent(eventName: string): void
  progressStep(id: string): void
  deprogressStep(id: string): void
  clearProgress(): void
  getWelcomePageProjection(context?: ContextKeyState): WelcomePageProjection
  getContributionSummary(): GettingStartedContributionSummary
}

export const IGettingStartedService = createDecorator<IGettingStartedService>("gettingStartedService")

const SOURCE_REFERENCES = [
  "src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStartedService.ts",
  "src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts",
  "src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStartedExtensionPoint.ts",
] as const

const START_ENTRIES: GettingStartedStartEntry[] = [
  {
    id: "topLevelOpenFolder",
    title: "打开项目",
    description: "打开文件夹开始工作",
    commandId: GETTING_STARTED_COMMAND_IDS.OpenFolder,
    when: undefined,
    order: 10,
    icon: "folder-opened",
    event: "openProject",
    shortcut: "Ctrl O",
  },
  {
    id: "welcome.showNewFileEntries",
    title: "新建文件",
    description: "创建新文件开始编码",
    commandId: GETTING_STARTED_COMMAND_IDS.NewFile,
    order: 20,
    icon: "new-file",
    event: "newProject",
    shortcut: "Ctrl N",
  },
  {
    id: "topLevelCommandPalette",
    title: "命令面板",
    description: "打开命令面板执行工作台命令",
    commandId: GETTING_STARTED_COMMAND_IDS.CommandPalette,
    order: 30,
    icon: "command-palette",
    event: "openCommandPalette",
    shortcut: "Ctrl Shift P",
  },
  {
    id: "topLevelCodekChat",
    title: "打开聊天",
    description: "打开 Codek 智能体协作入口",
    commandId: GETTING_STARTED_COMMAND_IDS.OpenChat,
    order: 40,
    icon: "chat-sparkle",
    event: "openChat",
    shortcut: "Ctrl K",
  },
  {
    id: "topLevelRemoteOpen",
    title: "连接远程 / SSH",
    description: "连接远程开发工作区",
    commandId: GETTING_STARTED_COMMAND_IDS.Remote,
    when: "!isWeb",
    order: 50,
    icon: "remote",
    event: "openLink",
    target: "remote",
  },
]

const BUILTIN_WALKTHROUGHS: GettingStartedWalkthroughDescriptor[] = [
  {
    id: "codek.setup",
    title: "开始使用 Codek",
    description: "打开项目、创建文件、使用命令面板和远程入口。",
    source: "builtin",
    order: 100,
    isFeatured: true,
    icon: "getting-started-setup",
    walkthroughPageTitle: "Codek 入门",
    steps: [
      step("codek.setup.openFolder", "打开项目", "打开一个文件夹进入工作台。", GETTING_STARTED_COMMAND_IDS.OpenFolder, "image", "media/openFolder.svg"),
      step("codek.setup.newFile", "新建文件", "创建一个新文件开始编辑。", GETTING_STARTED_COMMAND_IDS.NewFile, "svg", "media/newFile.svg"),
      step("codek.setup.commandPalette", "使用命令面板", "通过命令面板运行工作台命令。", GETTING_STARTED_COMMAND_IDS.CommandPalette, "markdown", "media/commandPalette.md"),
      step("codek.setup.remote", "连接远程", "连接远程或 SSH 工作区。", GETTING_STARTED_COMMAND_IDS.Remote, "svg", "media/remote.svg"),
    ],
  },
  {
    id: "codek.agentEvidence",
    title: "智能体证据链",
    description: "使用 Codek 智能体、进度证据和安全审批完成可追责任务。",
    source: "codek",
    order: 90,
    isFeatured: true,
    icon: "codek-agent",
    walkthroughPageTitle: "智能体证据链入门",
    steps: [
      step("codek.agent.openChat", "打开智能聊天", "从欢迎页进入智能体协作。", GETTING_STARTED_COMMAND_IDS.OpenChat, "svg", "media/agent.svg"),
      {
        id: "codek.agent.progress",
        title: "查看进度证据",
        description: "通过进度和通知证据跟踪任务闭环。",
        completionEvents: ["onView:codek.agentEvidence.progress", "onCommand:agent.evidence.openProgress"],
        media: { type: "markdown", path: "media/progress.md" },
      },
      {
        id: "codek.agent.approval",
        title: "确认安全审批",
        description: "需要写入或执行敏感操作时保留审批边界。",
        completionEvents: ["onContext:agent.approval.confirmed"],
        media: { type: "markdown", path: "media/approval.md" },
      },
    ],
  },
]

function step(
  id: string,
  title: string,
  description: string,
  commandId: GettingStartedCommandId,
  type: GettingStartedMedia["type"],
  path: string,
): GettingStartedStepDescriptor {
  return {
    id,
    title,
    description,
    completionEvents: [`onCommand:${commandId}`],
    media: { type, path, altText: title },
  }
}

class GettingStartedService implements IGettingStartedService {
  declare readonly _serviceBrand: undefined

  private readonly listeners = new Set<(walkthrough: GettingStartedResolvedWalkthrough) => void>()
  private readonly walkthroughs = new Map<string, GettingStartedWalkthroughDescriptor>()
  private readonly completedSteps = new Set<string>()

  constructor() {
    for (const walkthrough of BUILTIN_WALKTHROUGHS) this.walkthroughs.set(walkthrough.id, walkthrough)
  }

  onDidChangeWalkthrough(listener: (walkthrough: GettingStartedResolvedWalkthrough) => void): Disposable {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  registerWalkthrough(descriptor: GettingStartedWalkthroughDescriptor): Disposable {
    const normalized = normalizeWalkthrough(descriptor)
    this.walkthroughs.set(normalized.id, normalized)
    this.emit(normalized.id)
    return {
      dispose: () => {
        if (this.walkthroughs.delete(normalized.id)) this.emit(normalized.id)
      },
    }
  }

  clearWalkthroughs(): void {
    this.walkthroughs.clear()
    for (const walkthrough of BUILTIN_WALKTHROUGHS) this.walkthroughs.set(walkthrough.id, walkthrough)
  }

  getStartEntries(context: ContextKeyState = defaultGettingStartedContext()): GettingStartedStartEntry[] {
    return START_ENTRIES
      .filter((entry) => evaluateWhenClause(entry.when, context))
      .sort((left, right) => left.order - right.order)
      .map((entry) => ({ ...entry }))
  }

  getWalkthroughs(context: ContextKeyState = defaultGettingStartedContext()): GettingStartedResolvedWalkthrough[] {
    return [...this.walkthroughs.values()]
      .filter((walkthrough) => evaluateWhenClause(walkthrough.when, context))
      .map((walkthrough) => this.resolveWalkthrough(walkthrough, context))
      .filter((walkthrough) => walkthrough.steps.length > 0)
      .sort((left, right) => right.order - left.order || left.title.localeCompare(right.title))
  }

  getWalkthrough(id: string, context: ContextKeyState = defaultGettingStartedContext()): GettingStartedResolvedWalkthrough | null {
    const descriptor = this.walkthroughs.get(id)
    if (!descriptor || !evaluateWhenClause(descriptor.when, context)) return null
    const resolved = this.resolveWalkthrough(descriptor, context)
    return resolved.steps.length > 0 ? resolved : null
  }

  progressByEvent(eventName: string): void {
    for (const walkthrough of this.walkthroughs.values()) {
      let changed = false
      for (const step of walkthrough.steps) {
        if (step.completionEvents?.includes(eventName) && !this.completedSteps.has(step.id)) {
          this.completedSteps.add(step.id)
          changed = true
        }
      }
      if (changed) this.emit(walkthrough.id)
    }
  }

  progressStep(id: string): void {
    if (this.completedSteps.has(id)) return
    this.completedSteps.add(id)
    this.emitByStep(id)
  }

  deprogressStep(id: string): void {
    if (!this.completedSteps.delete(id)) return
    this.emitByStep(id)
  }

  clearProgress(): void {
    this.completedSteps.clear()
  }

  getWelcomePageProjection(context: ContextKeyState = defaultGettingStartedContext()): WelcomePageProjection {
    const startEntries = this.getStartEntries(context)
    return {
      source: "IGettingStartedService",
      startEntries,
      primaryActions: startEntries.map((entry) => ({
        id: welcomeActionId(entry),
        label: entry.title,
        shortcut: entry.shortcut,
        event: entry.event,
        target: entry.target,
        commandId: entry.commandId,
      })),
      categories: this.getWalkthroughs(context),
    }
  }

  getContributionSummary(): GettingStartedContributionSummary {
    return {
      serviceIds: ["gettingStartedService", "walkthroughsService"],
      sourceReferences: SOURCE_REFERENCES,
      commandIds: Object.values(GETTING_STARTED_COMMAND_IDS),
      startEntryIds: START_ENTRIES.map((entry) => entry.id),
      walkthroughIds: [...this.walkthroughs.keys()],
      menuIds: [MenuId.CommandPalette.id],
      stateSource: "IGettingStartedService",
      noSecondStateSource: true,
      evidenceSafeActions: START_ENTRIES.map((entry) => ({
        id: entry.commandId,
        label: entry.title,
        surface: entry.commandId === GETTING_STARTED_COMMAND_IDS.OpenChat ? "walkthrough" : "welcome",
        writesGitIndex: false,
        requiresApproval: false,
      })),
    }
  }

  private resolveWalkthrough(
    descriptor: GettingStartedWalkthroughDescriptor,
    context: ContextKeyState,
  ): GettingStartedResolvedWalkthrough {
    const steps = descriptor.steps
      .map((stepDescriptor, index) => ({
        ...stepDescriptor,
        order: stepDescriptor.order ?? index,
        done: this.completedSteps.has(stepDescriptor.id),
      }))
      .filter((stepDescriptor) => evaluateWhenClause(stepDescriptor.when, context))
      .sort((left, right) => left.order - right.order)
    const completedSteps = steps.filter((item) => item.done).length
    return {
      ...descriptor,
      source: descriptor.source || "extension",
      order: descriptor.order ?? 0,
      isFeatured: descriptor.isFeatured === true,
      walkthroughPageTitle: descriptor.walkthroughPageTitle || descriptor.title,
      steps,
      totalSteps: steps.length,
      completedSteps,
      progress: steps.length ? completedSteps / steps.length : 0,
    }
  }

  private emitByStep(stepId: string): void {
    for (const walkthrough of this.walkthroughs.values()) {
      if (walkthrough.steps.some((stepDescriptor) => stepDescriptor.id === stepId)) this.emit(walkthrough.id)
    }
  }

  private emit(walkthroughId: string): void {
    const walkthrough = this.getWalkthrough(walkthroughId)
    if (!walkthrough) return
    for (const listener of this.listeners) listener(walkthrough)
  }
}

export const globalGettingStartedService = new GettingStartedService()
registerSingleton(IGettingStartedService, globalGettingStartedService, InstantiationType.Delayed)

export function registerGettingStartedWalkthrough(descriptor: GettingStartedWalkthroughDescriptor): Disposable {
  return globalGettingStartedService.registerWalkthrough(descriptor)
}

export function clearGettingStartedProgress(): void {
  globalGettingStartedService.clearProgress()
}

export function getWelcomePageProjection(context?: ContextKeyState): WelcomePageProjection {
  return globalGettingStartedService.getWelcomePageProjection(context)
}

export function getGettingStartedContributionSummary(): GettingStartedContributionSummary {
  return globalGettingStartedService.getContributionSummary()
}

export function registerGettingStartedContributions(handlers: GettingStartedActionHandlers = {}): Disposable {
  const commands: Array<{
    readonly entry: GettingStartedStartEntry
    readonly run: () => void | Promise<void>
  }> = [
    { entry: START_ENTRIES[0], run: () => handlers.openFolder?.() },
    { entry: START_ENTRIES[1], run: () => handlers.newFile?.() },
    { entry: START_ENTRIES[2], run: () => handlers.openCommandPalette?.() },
    { entry: START_ENTRIES[3], run: () => handlers.openChat?.() },
    { entry: START_ENTRIES[4], run: () => handlers.openRemote?.() },
  ]

  return {
    dispose: collectDisposables(commands.map(({ entry, run }) => registerStartEntryAction(entry, run))).dispose,
  }
}

function registerStartEntryAction(entry: GettingStartedStartEntry, run: () => void | Promise<void>): Disposable {
  return registerAction2(class extends Action2 {
    constructor() {
      super({
        id: entry.commandId,
        title: entry.title,
        category: "Getting Started",
        source: "vscode",
        f1: true,
        precondition: entry.when,
        menu: { id: MenuId.CommandPalette, group: "navigation", order: entry.order, when: entry.when },
        metadata: {
          description: `${entry.description}; evidence-safe onboarding action; writesGitIndex=false`,
        },
      })
    }

    run(): void | Promise<void> {
      globalGettingStartedService.progressByEvent(`onCommand:${entry.commandId}`)
      return run()
    }
  })
}

function collectDisposables(disposables: Disposable[]): Disposable {
  return { dispose: () => disposables.forEach((disposable) => disposable.dispose()) }
}

function normalizeWalkthrough(descriptor: GettingStartedWalkthroughDescriptor): GettingStartedWalkthroughDescriptor {
  return {
    ...descriptor,
    source: descriptor.source || "extension",
    order: descriptor.order ?? 0,
    isFeatured: descriptor.isFeatured === true,
    walkthroughPageTitle: descriptor.walkthroughPageTitle || descriptor.title,
    steps: descriptor.steps.map((stepDescriptor, index) => ({
      ...stepDescriptor,
      order: stepDescriptor.order ?? index,
      completionEvents: stepDescriptor.completionEvents ?? [],
    })),
  }
}

function defaultGettingStartedContext(): ContextKeyState {
  return {
    isWeb: false,
    isMac: false,
    "workspace.hasRoot": false,
    "agent.approval.confirmed": false,
  }
}

function welcomeActionId(entry: GettingStartedStartEntry): string {
  if (entry.commandId === GETTING_STARTED_COMMAND_IDS.OpenFolder) return "openFolder"
  if (entry.commandId === GETTING_STARTED_COMMAND_IDS.NewFile) return "newFile"
  if (entry.commandId === GETTING_STARTED_COMMAND_IDS.CommandPalette) return "commandPalette"
  if (entry.commandId === GETTING_STARTED_COMMAND_IDS.OpenChat) return "openChat"
  return "remote"
}
