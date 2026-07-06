import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import type { SoundType } from "../utils/soundNotifier"
import { playSound } from "../utils/soundNotifier"
import { executeCommand } from "./commandRegistry"

export type WorkbenchNotificationSeverity = "info" | "success" | "warning" | "error"
export type WorkbenchStatusbarEntryKind = "standard" | "warning" | "error" | "prominent" | "remote" | "offline"
export type WorkbenchNotificationPriority = "default" | "optional" | "silent" | "urgent"
export type WorkbenchNotificationsFilter = "off" | "error"

export const enum WorkbenchStatusbarAlignment {
  LEFT = 0,
  RIGHT = 1,
}

export const enum ProgressLocation {
  Explorer = 1,
  Scm = 3,
  Extensions = 5,
  Window = 10,
  Notification = 15,
  Dialog = 20,
}

export interface WorkbenchDisposable {
  dispose(): void
}

export interface WorkbenchStatusbarEntry {
  readonly name: string
  readonly text: string
  readonly ariaLabel: string
  readonly role?: string
  readonly tooltip?: string
  readonly command?: string
  readonly showProgress?: boolean | "loading" | "syncing"
  readonly kind?: WorkbenchStatusbarEntryKind
  readonly source?: string
  readonly visible?: boolean
  readonly alignment?: WorkbenchStatusbarAlignment
  readonly priority?: number
}

export interface WorkbenchStatusbarItem extends WorkbenchStatusbarEntry {
  readonly id: string
  readonly alignment: WorkbenchStatusbarAlignment
  readonly priority: number
  readonly visible: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

export interface WorkbenchStatusbarEntryAccessor extends WorkbenchDisposable {
  update(entry: Partial<WorkbenchStatusbarEntry>): void
}

export interface WorkbenchNotificationOptions {
  readonly id?: string
  readonly severity: WorkbenchNotificationSeverity
  readonly message: string
  readonly duration?: number
  readonly source?: string
  readonly dedupeKey?: string
  readonly focusTarget?: string
  readonly dismissCommandId?: string
  readonly priority?: WorkbenchNotificationPriority
  readonly actions?: WorkbenchNotificationActions
  readonly progress?: WorkbenchNotificationProgressInput
}

export interface WorkbenchNotificationAction {
  readonly id: string
  readonly label: string
  readonly keepOpen?: boolean
  readonly run?: () => void | Promise<void>
  readonly command?: string
  readonly args?: readonly unknown[]
}

export interface WorkbenchNotificationActions {
  readonly primary?: WorkbenchNotificationAction[]
  readonly secondary?: WorkbenchNotificationAction[]
}

export interface WorkbenchNotificationActionProjection {
  readonly id: string
  readonly label: string
  readonly isSecondary: boolean
  readonly command?: string
  readonly keepOpen: boolean
}

export interface WorkbenchNotificationProgressInput {
  readonly infinite?: boolean
  readonly total?: number
  readonly worked?: number
}

export interface WorkbenchNotificationProgressState {
  readonly infinite: boolean
  readonly total: number
  readonly worked: number
  readonly done: boolean
}

export interface WorkbenchNotificationProgressHandle {
  infinite(): void
  total(value: number): void
  worked(amount: number): void
  done(): void
}

export interface WorkbenchNotificationItem {
  readonly id: string
  readonly severity: WorkbenchNotificationSeverity
  readonly type: WorkbenchNotificationSeverity
  readonly message: string
  readonly duration: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly visible: boolean
  readonly source: string
  readonly dedupeKey: string
  readonly focusTarget: string
  readonly dismissCommandId: string
  readonly priority: WorkbenchNotificationPriority
  readonly filter: WorkbenchNotificationsFilter
  readonly actions: {
    readonly primary: WorkbenchNotificationActionProjection[]
    readonly secondary: WorkbenchNotificationActionProjection[]
  }
  readonly progress: WorkbenchNotificationProgressState
}

export interface WorkbenchNotificationHandle extends WorkbenchDisposable {
  readonly id: string
  readonly progress: WorkbenchNotificationProgressHandle
  updateSeverity(severity: WorkbenchNotificationSeverity): void
  updateMessage(message: string): void
  updateActions(actions?: WorkbenchNotificationActions): void
  close(): void
}

export type WorkbenchNotificationDismissReason = "api" | "handle" | "dispose" | "timeout" | "clear" | "primaryAction"

export interface WorkbenchNotificationDismissLifecycleEntry {
  readonly id: string
  readonly reason: WorkbenchNotificationDismissReason
  readonly source: string
  readonly severity: WorkbenchNotificationSeverity
  readonly message: string
  readonly dismissedAt: number
}

export interface WorkbenchProgressStep {
  readonly message?: string
  readonly increment?: number
  readonly total?: number
}

export interface WorkbenchProgressReporter {
  report(step: WorkbenchProgressStep): void
}

export interface WorkbenchCancellationToken {
  readonly isCancellationRequested: boolean
}

export interface WorkbenchProgressOptions {
  readonly location: ProgressLocation | string
  readonly title?: string
  readonly source?: string
  readonly total?: number
  readonly cancellable?: boolean | string
  readonly buttons?: string[]
  readonly primaryActions?: WorkbenchNotificationAction[]
  readonly secondaryActions?: WorkbenchNotificationAction[]
  readonly command?: string
  readonly type?: "loading" | "syncing"
  readonly notificationSeverity?: WorkbenchNotificationSeverity
}

export interface WorkbenchProgressTask {
  readonly id: string
  readonly location: ProgressLocation | string
  readonly title: string
  readonly source: string
  readonly message: string
  readonly total: number
  readonly worked: number
  readonly status: "active" | "completed" | "cancelled" | "failed"
  readonly cancellable: boolean
  readonly command: string
  readonly cancelCommandId: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface WorkbenchNotificationOwnerEvidence {
  readonly stateSource: "workbenchStatusNotificationProgressService"
  readonly queueSource: "workbenchStatusNotificationProgressService.notifications"
  readonly visibleSource: "workbenchStatusNotificationProgressService.getNotifications"
  readonly actionRegistrySource: "workbenchStatusNotificationProgressService.notificationActions"
  readonly progressSource: "workbenchStatusNotificationProgressService.progressTasks"
  readonly noSecondNotificationState: true
  readonly queueCount: number
  readonly visibleCount: number
  readonly hiddenCount: number
  readonly severityCounts: Record<WorkbenchNotificationSeverity, number>
  readonly sources: Array<{ readonly source: string; readonly queueCount: number; readonly visibleCount: number }>
  readonly actionRegistry: Array<{
    readonly notificationId: string
    readonly actionId: string
    readonly label: string
    readonly command: string
    readonly isSecondary: boolean
    readonly keepOpen: boolean
  }>
  readonly progressHandles: Array<{
    readonly id: string
    readonly notificationId: string
    readonly title: string
    readonly source: string
    readonly location: ProgressLocation | string
    readonly status: WorkbenchProgressTask["status"]
    readonly cancellable: boolean
    readonly cancelCommandId: string
    readonly worked: number
    readonly total: number
  }>
  readonly dismissLifecycle: WorkbenchNotificationDismissLifecycleEntry[]
  readonly remainingUiGaps: readonly string[]
}

export type WorkbenchOwnerEvidenceStatus = "connected" | "partial" | "blocked"

export interface WorkbenchOwnerEvidenceProjection {
  readonly owner: string
  readonly status: WorkbenchOwnerEvidenceStatus
  readonly stateSource: string
  readonly lifecycle: string
  readonly noSecondState: true
  readonly vscodeSource: string
  readonly entryCount?: number
  readonly queueCount?: number
  readonly visibleCount?: number
  readonly activeCount?: number
}

export interface WorkbenchToastStateOwnerEvidence {
  readonly owner: "NotificationToast"
  readonly status: "partial"
  readonly connected: false
  readonly stateSource: "utils/notifications.subscribe -> workbenchStatusNotificationProgressService.onDidChangeNotifications"
  readonly noSecondState: true
  readonly reason: string
}

export interface WorkbenchMainThreadBridgeOwnerEvidence {
  readonly owner: "desktop/services/extensions-host/mainThread"
  readonly status: "partial"
  readonly connected: true
  readonly stateSource: "ext-host renderer events -> workbenchStatusNotificationProgressService"
  readonly noSecondState: true
  readonly rendererEventChannels: readonly string[]
  readonly sourceFiles: readonly string[]
}

export interface WorkbenchStatusNotificationProgressOwnerEvidence {
  readonly statusBarServiceOwner: WorkbenchOwnerEvidenceProjection
  readonly notificationServiceOwner: WorkbenchOwnerEvidenceProjection
  readonly progressServiceOwner: WorkbenchOwnerEvidenceProjection
  readonly toastStateOwner: WorkbenchToastStateOwnerEvidence
  readonly mainThreadBridgeOwner: WorkbenchMainThreadBridgeOwnerEvidence
  readonly notificationQueueEvidence: WorkbenchNotificationOwnerEvidence
  readonly remainingStatusUiOwnerGap: string
}

export interface IWorkbenchStatusbarService {
  readonly _serviceBrand: undefined
  addEntry(
    entry: WorkbenchStatusbarEntry,
    id: string,
    alignment: WorkbenchStatusbarAlignment,
    priority: number,
  ): WorkbenchStatusbarEntryAccessor
  getStatusbarEntries(): WorkbenchStatusbarItem[]
  onDidChangeStatusbar(listener: (items: WorkbenchStatusbarItem[]) => void): WorkbenchDisposable
}

export interface IWorkbenchNotificationService {
  readonly _serviceBrand: undefined
  notify(notification: WorkbenchNotificationOptions): WorkbenchNotificationHandle
  info(message: string): void
  warn(message: string): void
  error(message: string): void
  dismissNotification(id: string): void
  clearNotifications(): void
  getNotifications(): WorkbenchNotificationItem[]
  getNotificationQueue(): WorkbenchNotificationItem[]
  getNotificationSeverityCounts(): Record<WorkbenchNotificationSeverity, number>
  getNotificationActions(id: string): WorkbenchNotificationActionProjection[]
  getNotificationOwnerEvidence(): WorkbenchNotificationOwnerEvidence
  setNotificationsFilter(filter: WorkbenchNotificationsFilter): void
  invokeNotificationAction(id: string, actionId: string): Promise<boolean>
  onDidChangeNotifications(listener: (items: WorkbenchNotificationItem[]) => void): WorkbenchDisposable
}

export interface IWorkbenchProgressService {
  readonly _serviceBrand: undefined
  withProgress<R>(
    options: WorkbenchProgressOptions,
    task: (progress: WorkbenchProgressReporter, token: WorkbenchCancellationToken) => Promise<R>,
    onDidCancel?: (choice?: unknown) => void,
  ): Promise<R>
  cancelProgress(id: string, choice?: unknown): boolean
  getProgressTasks(): WorkbenchProgressTask[]
  onDidChangeProgress(listener: (items: WorkbenchProgressTask[]) => void): WorkbenchDisposable
}

export interface IWorkbenchStatusNotificationProgressService
  extends IWorkbenchStatusbarService,
    IWorkbenchNotificationService,
    IWorkbenchProgressService {
  getOwnerEvidence(): WorkbenchStatusNotificationProgressOwnerEvidence
}

interface RuntimeHooks {
  now?: () => number
  createId?: (prefix: string) => string
  playSound?: (type: SoundType) => void
}

const DEFAULT_DURATIONS: Record<WorkbenchNotificationSeverity, number> = {
  info: 3000,
  success: 3000,
  warning: 5000,
  error: 5000,
}
const MAX_NOTIFICATIONS = 5
const STATUS_PROGRESS_ID = "status.progress"
const PROGRESS_CANCEL_COMMAND_ID = "workbench.progress.cancel"
const NOTIFICATION_OWNER_REMAINING_UI_GAPS = [
  "完整 VS Code Notification Center 视觉队列仍需 central workbench shell owner；本阶段只暴露 service queue/action/progress evidence。",
  "Activity Bar 或 window-level progress indicator 的真实 UI owner 仍需 App.vue/central shell 接入；本阶段保留 statusbar/notification projection。",
] as const
const REMAINING_STATUS_UI_OWNER_GAP = "完整 status bar / notification toast DOM owner 仍需 App.vue/central workbench shell 接入；本阶段只暴露 service contract 与 renderer event evidence。"
const MAIN_THREAD_BRIDGE_CHANNELS = [
  "ext-host:statusbar-entry",
  "ext-host:statusbar-dispose",
  "ext-host:progress-start",
  "ext-host:progress-report",
  "ext-host:progress-end",
] as const
const MAIN_THREAD_BRIDGE_SOURCE_FILES = [
  "desktop/services/extensions-host/mainThread/mainThreadStatusBar.js",
  "desktop/services/extensions-host/mainThread/mainThreadProgress.js",
  "frontend/vite-project/src/extensions/extensionHostRuntimeBridge.ts",
] as const

export const IWorkbenchStatusNotificationProgressService = createDecorator<IWorkbenchStatusNotificationProgressService>(
  "workbenchStatusNotificationProgressService",
)
export const IWorkbenchStatusbarService = createDecorator<IWorkbenchStatusbarService>("statusbarService")
export const IWorkbenchNotificationService = createDecorator<IWorkbenchNotificationService>("workbenchNotificationService")
export const IWorkbenchProgressService = createDecorator<IWorkbenchProgressService>("workbenchProgressService")

export class WorkbenchNotificationProgressService implements IWorkbenchStatusNotificationProgressService {
  declare readonly _serviceBrand: undefined

  private readonly statusbarListeners = new Set<(items: WorkbenchStatusbarItem[]) => void>()
  private readonly notificationListeners = new Set<(items: WorkbenchNotificationItem[]) => void>()
  private readonly progressListeners = new Set<(items: WorkbenchProgressTask[]) => void>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly progressCancelHandlers = new Map<string, (choice?: unknown) => void>()
  private readonly notificationActions = new Map<string, Map<string, WorkbenchNotificationAction>>()
  private notificationDismissLifecycle: WorkbenchNotificationDismissLifecycleEntry[] = []
  private statusbarItems: WorkbenchStatusbarItem[] = []
  private notifications: WorkbenchNotificationItem[] = []
  private progressTasks: WorkbenchProgressTask[] = []
  private notificationsFilter: WorkbenchNotificationsFilter = "off"

  constructor(private readonly hooks: RuntimeHooks = {}) {}

  addEntry(
    entry: WorkbenchStatusbarEntry,
    id: string,
    alignment: WorkbenchStatusbarAlignment,
    priority: number,
  ): WorkbenchStatusbarEntryAccessor {
    const now = this.now()
    const next = this.toStatusbarItem(id, entry, entry.alignment ?? alignment, entry.priority ?? priority, entry.visible ?? true, now, now)
    this.statusbarItems = this.sortStatusbarItems([
      ...this.statusbarItems.filter((item) => item.id !== id),
      next,
    ])
    this.emitStatusbar()

    return {
      update: (update) => {
        const current = this.statusbarItems.find((item) => item.id === id)
        if (!current) return
        const nextAlignment = update.alignment ?? current.alignment
        const nextPriority = update.priority ?? current.priority
        const nextVisible = update.visible ?? current.visible
        this.statusbarItems = this.sortStatusbarItems(
          this.statusbarItems.map((item) => item.id === id
            ? this.toStatusbarItem(id, { ...current, ...update }, nextAlignment, nextPriority, nextVisible, current.createdAt, this.now())
            : item),
        )
        this.emitStatusbar()
      },
      dispose: () => {
        const before = this.statusbarItems.length
        this.statusbarItems = this.statusbarItems.filter((item) => item.id !== id)
        if (this.statusbarItems.length !== before) this.emitStatusbar()
      },
    }
  }

  getStatusbarEntries(): WorkbenchStatusbarItem[] {
    return this.statusbarItems.map((item) => ({ ...item }))
  }

  onDidChangeStatusbar(listener: (items: WorkbenchStatusbarItem[]) => void): WorkbenchDisposable {
    this.statusbarListeners.add(listener)
    listener(this.getStatusbarEntries())
    return { dispose: () => this.statusbarListeners.delete(listener) }
  }

  notify(options: WorkbenchNotificationOptions): WorkbenchNotificationHandle {
    const now = this.now()
    const duration = options.duration ?? DEFAULT_DURATIONS[options.severity]
    const dedupeKey = options.dedupeKey || ""
    const existing = dedupeKey ? this.notifications.find((item) => item.dedupeKey === dedupeKey) : undefined
    const id = existing?.id || options.id || this.createId("notification")
    const item = this.toNotificationItem({ ...options, id, duration }, existing?.createdAt ?? now, now)

    this.notifications = [item, ...this.notifications.filter((candidate) => candidate.id !== id)].slice(0, MAX_NOTIFICATIONS)
    this.scheduleNotificationDismiss(item)
    this.emitNotifications()
    this.playNotificationSound(item.severity)

    return {
      id,
      progress: {
        infinite: () => this.updateNotificationProgress(id, 0, false, { infinite: true }),
        total: (value) => this.updateNotificationProgress(id, 0, false, { total: sanitizeNumber(value) }),
        worked: (amount) => this.updateNotificationProgress(id, amount, false),
        done: () => this.updateNotificationProgress(id, 0, true),
      },
      updateSeverity: (severity) => this.updateNotification(id, { severity }),
      updateMessage: (message) => this.updateNotification(id, { message }),
      updateActions: (actions) => {
        const normalized = normalizeNotificationActions(actions)
        this.notificationActions.set(id, normalized.registry)
        this.updateNotification(id, { actions: normalized.projection })
      },
      close: () => this.dismissNotification(id, "handle"),
      dispose: () => this.dismissNotification(id, "dispose"),
    }
  }

  info(message: string): void {
    this.notify({ severity: "info", message })
  }

  warn(message: string): void {
    this.notify({ severity: "warning", message })
  }

  error(message: string): void {
    this.notify({ severity: "error", message })
  }

  dismissNotification(id: string, reason: WorkbenchNotificationDismissReason = "api"): void {
    const before = this.notifications.length
    const dismissed = this.notifications.find((item) => item.id === id)
    this.clearNotificationTimer(id)
    this.notificationActions.delete(id)
    this.notifications = this.notifications.filter((item) => item.id !== id)
    if (this.notifications.length !== before) {
      if (dismissed) this.recordNotificationDismiss(dismissed, reason)
      this.emitNotifications()
    }
  }

  clearNotifications(): void {
    this.timers.forEach((timer) => clearTimeout(timer))
    this.timers.clear()
    this.notifications.forEach((item) => this.recordNotificationDismiss(item, "clear"))
    this.notificationActions.clear()
    this.notifications = []
    this.emitNotifications()
  }

  getNotifications(): WorkbenchNotificationItem[] {
    return this.getNotificationQueue()
      .filter((item) => item.visible)
      .map((item) => ({ ...item }))
  }

  getNotificationQueue(): WorkbenchNotificationItem[] {
    return this.notifications.map((item) => ({ ...item }))
  }

  getNotificationSeverityCounts(): Record<WorkbenchNotificationSeverity, number> {
    return this.notifications.reduce<Record<WorkbenchNotificationSeverity, number>>((counts, item) => {
      counts[item.severity] += 1
      return counts
    }, createEmptySeverityCounts())
  }

  getNotificationActions(id: string): WorkbenchNotificationActionProjection[] {
    const item = this.notifications.find((notification) => notification.id === id)
    if (!item) return []
    return [...item.actions.primary, ...item.actions.secondary].map((action) => ({ ...action }))
  }

  getNotificationOwnerEvidence(): WorkbenchNotificationOwnerEvidence {
    const visible = this.getNotifications()
    const sourceMap = new Map<string, { source: string; queueCount: number; visibleCount: number }>()
    this.notifications.forEach((item) => {
      const source = item.source || "unknown"
      const current = sourceMap.get(source) || { source, queueCount: 0, visibleCount: 0 }
      current.queueCount += 1
      if (item.visible) current.visibleCount += 1
      sourceMap.set(source, current)
    })

    return {
      stateSource: "workbenchStatusNotificationProgressService",
      queueSource: "workbenchStatusNotificationProgressService.notifications",
      visibleSource: "workbenchStatusNotificationProgressService.getNotifications",
      actionRegistrySource: "workbenchStatusNotificationProgressService.notificationActions",
      progressSource: "workbenchStatusNotificationProgressService.progressTasks",
      noSecondNotificationState: true,
      queueCount: this.notifications.length,
      visibleCount: visible.length,
      hiddenCount: this.notifications.length - visible.length,
      severityCounts: this.getNotificationSeverityCounts(),
      sources: [...sourceMap.values()].sort((a, b) => a.source.localeCompare(b.source)),
      actionRegistry: this.notifications.flatMap((item) => this.getNotificationActions(item.id).map((action) => ({
        notificationId: item.id,
        actionId: action.id,
        label: action.label,
        command: action.command || "",
        isSecondary: action.isSecondary,
        keepOpen: action.keepOpen,
      }))),
      progressHandles: this.progressTasks.map((task) => ({
        id: task.id,
        notificationId: `notification.${task.id}`,
        title: task.title,
        source: task.source,
        location: task.location,
        status: task.status,
        cancellable: task.cancellable,
        cancelCommandId: task.cancelCommandId,
        worked: task.worked,
        total: task.total,
      })),
      dismissLifecycle: this.notificationDismissLifecycle.map((entry) => ({ ...entry })),
      remainingUiGaps: NOTIFICATION_OWNER_REMAINING_UI_GAPS,
    }
  }

  getOwnerEvidence(): WorkbenchStatusNotificationProgressOwnerEvidence {
    const notificationQueueEvidence = this.getNotificationOwnerEvidence()
    return {
      statusBarServiceOwner: {
        owner: "WorkbenchNotificationProgressService",
        status: "connected",
        stateSource: "workbenchStatusNotificationProgressService.statusbarItems",
        lifecycle: "addEntry/update/dispose/onDidChangeStatusbar",
        noSecondState: true,
        entryCount: this.statusbarItems.length,
        vscodeSource: "src/vs/workbench/services/statusbar/browser/statusbar.ts",
      },
      notificationServiceOwner: {
        owner: "WorkbenchNotificationProgressService",
        status: "connected",
        stateSource: "workbenchStatusNotificationProgressService.notifications",
        lifecycle: "notify/update/close/filter/onDidChangeNotifications",
        noSecondState: true,
        queueCount: notificationQueueEvidence.queueCount,
        visibleCount: notificationQueueEvidence.visibleCount,
        vscodeSource: "src/vs/platform/notification/common/notification.ts",
      },
      progressServiceOwner: {
        owner: "WorkbenchNotificationProgressService",
        status: "connected",
        stateSource: "workbenchStatusNotificationProgressService.progressTasks",
        lifecycle: "withProgress/report/cancel/complete/onDidChangeProgress",
        noSecondState: true,
        activeCount: this.progressTasks.length,
        vscodeSource: "src/vs/platform/progress/common/progress.ts",
      },
      toastStateOwner: {
        owner: "NotificationToast",
        status: "partial",
        connected: false,
        stateSource: "utils/notifications.subscribe -> workbenchStatusNotificationProgressService.onDidChangeNotifications",
        noSecondState: true,
        reason: "NotificationToast renders the current toast projection from the single service, but full toast/window DOM ownership remains a partial UI owner until the central workbench shell owns placement and lifecycle.",
      },
      mainThreadBridgeOwner: {
        owner: "desktop/services/extensions-host/mainThread",
        status: "partial",
        connected: true,
        stateSource: "ext-host renderer events -> workbenchStatusNotificationProgressService",
        noSecondState: true,
        rendererEventChannels: MAIN_THREAD_BRIDGE_CHANNELS,
        sourceFiles: MAIN_THREAD_BRIDGE_SOURCE_FILES,
      },
      notificationQueueEvidence,
      remainingStatusUiOwnerGap: REMAINING_STATUS_UI_OWNER_GAP,
    }
  }

  setNotificationsFilter(filter: WorkbenchNotificationsFilter): void {
    this.notificationsFilter = filter
    this.notifications = this.notifications.map((item) => ({
      ...item,
      filter,
      visible: this.isNotificationVisible(item.severity, item.priority),
    }))
    this.emitNotifications()
  }

  async invokeNotificationAction(id: string, actionId: string): Promise<boolean> {
    const action = this.notificationActions.get(id)?.get(actionId)
    if (!action) return false
    await action.run?.()
    if (action.command) {
      const didExecute = await executeCommand(action.command, [...(action.args || [])])
      if (!didExecute) return false
    }
    if (this.notifications.some((item) => item.id === id) && !action.keepOpen && !this.isSecondaryNotificationAction(id, actionId)) {
      this.dismissNotification(id, "primaryAction")
    }
    return true
  }

  onDidChangeNotifications(listener: (items: WorkbenchNotificationItem[]) => void): WorkbenchDisposable {
    this.notificationListeners.add(listener)
    listener(this.getNotifications())
    return { dispose: () => this.notificationListeners.delete(listener) }
  }

  async withProgress<R>(
    options: WorkbenchProgressOptions,
    task: (progress: WorkbenchProgressReporter, token: WorkbenchCancellationToken) => Promise<R>,
    onDidCancel?: (choice?: unknown) => void,
  ): Promise<R> {
    const id = this.createId("progress")
    const now = this.now()
    let cancelled = false
    const cancel = (choice?: unknown) => {
      if (cancelled) return
      cancelled = true
      onDidCancel?.(choice)
      this.updateProgress(id, { status: "cancelled" })
    }
    const notificationHandle = options.location === ProgressLocation.Notification
      ? this.notify({
        id: `notification.${id}`,
        severity: options.notificationSeverity || "info",
        message: options.title || "",
        duration: 0,
        source: options.source || "",
        dedupeKey: `progress:${id}`,
        actions: this.toProgressNotificationActions(options, cancel),
        progress: {
          infinite: !options.total,
          total: options.total,
          worked: 0,
        },
      })
      : undefined
    const token: WorkbenchCancellationToken = {
      get isCancellationRequested() {
        return cancelled
      },
    }
    this.progressCancelHandlers.set(id, cancel)
    this.progressTasks = [
      ...this.progressTasks,
      {
        id,
        location: options.location,
        title: options.title || "",
        source: options.source || "",
        message: "",
        total: sanitizeNumber(options.total),
        worked: 0,
        status: "active",
        cancellable: Boolean(options.cancellable),
        command: options.command || "",
        cancelCommandId: options.cancellable ? PROGRESS_CANCEL_COMMAND_ID : "",
        createdAt: now,
        updatedAt: now,
      },
    ]
    this.emitProgress()
    this.updateProgressProjection()

    try {
      const result = await task({ report: (step) => this.reportProgress(id, step) }, token)
      this.updateProgress(id, { status: cancelled ? "cancelled" : "completed" })
      notificationHandle?.progress.done()
      return result
    } catch (error) {
      this.updateProgress(id, { status: "failed" })
      notificationHandle?.updateSeverity("error")
      notificationHandle?.progress.done()
      throw error
    } finally {
      notificationHandle?.dispose()
      this.progressCancelHandlers.delete(id)
      this.progressTasks = this.progressTasks.filter((item) => item.id !== id)
      this.emitProgress()
      this.updateProgressProjection()
    }
  }

  cancelProgress(id: string, choice?: unknown): boolean {
    const cancel = this.progressCancelHandlers.get(id)
    if (!cancel) return false
    cancel(choice)
    return true
  }

  getProgressTasks(): WorkbenchProgressTask[] {
    return this.progressTasks.map((item) => ({ ...item }))
  }

  onDidChangeProgress(listener: (items: WorkbenchProgressTask[]) => void): WorkbenchDisposable {
    this.progressListeners.add(listener)
    listener(this.getProgressTasks())
    return { dispose: () => this.progressListeners.delete(listener) }
  }

  private updateNotification(
    id: string,
    update: Partial<Pick<WorkbenchNotificationItem, "message" | "severity" | "actions" | "progress">>,
  ): void {
    let changed = false
    this.notifications = this.notifications.map((item) => {
      if (item.id !== id) return item
      changed = true
      const severity = update.severity ?? item.severity
      return {
        ...item,
        ...update,
        type: severity,
        severity,
        visible: this.isNotificationVisible(severity, item.priority),
        updatedAt: this.now(),
      }
    })
    if (changed) this.emitNotifications()
  }

  private updateNotificationProgress(id: string, worked: number, done: boolean, update: Partial<WorkbenchNotificationProgressState> = {}): void {
    let changed = false
    this.notifications = this.notifications.map((item) => {
      if (item.id !== id) return item
      changed = true
      return {
        ...item,
        progress: {
          ...item.progress,
          ...update,
          worked: item.progress.worked + sanitizeNumber(worked),
          done: done || item.progress.done,
        },
        updatedAt: this.now(),
      }
    })
    if (changed) this.emitNotifications()
  }

  private reportProgress(id: string, step: WorkbenchProgressStep): void {
    const current = this.progressTasks.find((item) => item.id === id)
    if (!current) return
    const nextTotal = typeof step.total === "number" ? sanitizeNumber(step.total) : current.total
    const increment = sanitizeNumber(step.increment)
    this.updateProgress(id, {
      message: step.message ?? current.message,
      total: nextTotal,
      worked: current.worked + increment,
    })
    this.updateNotificationProgress(`notification.${id}`, increment, false, {
      total: nextTotal,
      infinite: nextTotal === 0,
    })
  }

  private updateProgress(id: string, update: Partial<WorkbenchProgressTask>): void {
    let changed = false
    this.progressTasks = this.progressTasks.map((item) => {
      if (item.id !== id) return item
      changed = true
      return { ...item, ...update, updatedAt: this.now() }
    })
    if (changed) {
      this.emitProgress()
      this.updateProgressProjection()
    }
  }

  private updateProgressProjection(): void {
    const active = [...this.progressTasks].reverse().find((item) => item.status === "active")
    const existing = this.statusbarItems.find((item) => item.id === STATUS_PROGRESS_ID)
    if (!active) {
      if (existing) {
        this.statusbarItems = this.statusbarItems.filter((item) => item.id !== STATUS_PROGRESS_ID)
        this.emitStatusbar()
      }
      return
    }

    const text = active.title && active.message ? `${active.title}: ${active.message}` : active.title || active.message
    const entry: WorkbenchStatusbarEntry = {
      name: "Progress Message",
      text,
      ariaLabel: text,
      tooltip: active.source ? `[${active.source}] ${text}` : text,
      command: active.command || undefined,
      showProgress: true,
      kind: "standard",
      source: active.source,
    }
    const now = this.now()
    const next = this.toStatusbarItem(STATUS_PROGRESS_ID, entry, WorkbenchStatusbarAlignment.LEFT, -Number.MAX_VALUE, true, existing?.createdAt ?? now, now)
    this.statusbarItems = this.sortStatusbarItems([
      ...this.statusbarItems.filter((item) => item.id !== STATUS_PROGRESS_ID),
      next,
    ])
    this.emitStatusbar()
  }

  private toProgressNotificationActions(
    options: WorkbenchProgressOptions,
    cancel: (choice?: unknown) => void,
  ): WorkbenchNotificationActions | undefined {
    if (options.location !== ProgressLocation.Notification) return undefined
    const primary: WorkbenchNotificationAction[] = [...(options.primaryActions || [])]
    const secondary: WorkbenchNotificationAction[] = [...(options.secondaryActions || [])]
    ;(options.buttons || []).forEach((label, index) => {
      const text = String(label || "").trim()
      if (!text) return
      primary.push({
        id: `progress.button.${index}`,
        label: text,
        run: () => cancel(index),
      })
    })
    if (options.cancellable) {
      primary.push({
        id: "progress.cancel",
        label: typeof options.cancellable === "string" ? options.cancellable : "Cancel",
        run: () => cancel(),
      })
    }
    if (primary.length === 0 && secondary.length === 0) return undefined
    return { primary, secondary }
  }

  private scheduleNotificationDismiss(item: WorkbenchNotificationItem): void {
    this.clearNotificationTimer(item.id)
    if (item.duration <= 0) return
    this.timers.set(item.id, setTimeout(() => this.dismissNotification(item.id, "timeout"), item.duration))
  }

  private clearNotificationTimer(id: string): void {
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
  }

  private emitStatusbar(): void {
    const snapshot = this.getStatusbarEntries()
    this.statusbarListeners.forEach((listener) => listener(snapshot))
  }

  private emitNotifications(): void {
    const snapshot = this.getNotifications()
    this.notificationListeners.forEach((listener) => listener(snapshot))
  }

  private emitProgress(): void {
    const snapshot = this.getProgressTasks()
    this.progressListeners.forEach((listener) => listener(snapshot))
  }

  private toStatusbarItem(
    id: string,
    entry: WorkbenchStatusbarEntry,
    alignment: WorkbenchStatusbarAlignment,
    priority: number,
    visible: boolean,
    createdAt: number,
    updatedAt: number,
  ): WorkbenchStatusbarItem {
    return {
      id,
      name: entry.name,
      text: entry.text,
      ariaLabel: entry.ariaLabel,
      role: entry.role,
      tooltip: entry.tooltip,
      command: entry.command,
      showProgress: entry.showProgress,
      kind: entry.kind || "standard",
      source: entry.source || "",
      alignment,
      priority,
      visible,
      createdAt,
      updatedAt,
    }
  }

  private toNotificationItem(options: WorkbenchNotificationOptions & { id: string; duration: number }, createdAt: number, updatedAt: number): WorkbenchNotificationItem {
    const actions = normalizeNotificationActions(options.actions)
    this.notificationActions.set(options.id, actions.registry)
    return {
      id: options.id,
      severity: options.severity,
      type: options.severity,
      message: options.message,
      duration: options.duration,
      createdAt,
      updatedAt,
      visible: this.isNotificationVisible(options.severity, options.priority || "default"),
      source: options.source || "",
      dedupeKey: options.dedupeKey || "",
      focusTarget: options.focusTarget || "",
      dismissCommandId: options.dismissCommandId || "workbench.notifications.dismiss",
      priority: options.priority || "default",
      filter: this.notificationsFilter,
      actions: actions.projection,
      progress: normalizeNotificationProgress(options.progress),
    }
  }

  private sortStatusbarItems(items: WorkbenchStatusbarItem[]): WorkbenchStatusbarItem[] {
    return [...items].sort((a, b) => a.alignment - b.alignment || a.priority - b.priority || a.id.localeCompare(b.id))
  }

  private playNotificationSound(severity: WorkbenchNotificationSeverity): void {
    const sound = severity === "success" ? "complete" : severity === "error" ? "error" : severity === "warning" ? "alert" : null
    if (sound) (this.hooks.playSound || playSound)(sound)
  }

  private recordNotificationDismiss(item: WorkbenchNotificationItem, reason: WorkbenchNotificationDismissReason): void {
    this.notificationDismissLifecycle = [
      ...this.notificationDismissLifecycle,
      {
        id: item.id,
        reason,
        source: item.source,
        severity: item.severity,
        message: item.message,
        dismissedAt: this.now(),
      },
    ].slice(-20)
  }

  private now(): number {
    return this.hooks.now?.() ?? Date.now()
  }

  private createId(prefix: string): string {
    return this.hooks.createId?.(prefix) ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  }

  private isNotificationVisible(severity: WorkbenchNotificationSeverity, priority: WorkbenchNotificationPriority): boolean {
    if (priority === "silent") return false
    if (this.notificationsFilter === "off") return true
    if (priority === "urgent") return true
    return severity === this.notificationsFilter
  }

  private isSecondaryNotificationAction(id: string, actionId: string): boolean {
    const item = this.notifications.find((notification) => notification.id === id)
    return Boolean(item?.actions.secondary.some((action) => action.id === actionId))
  }
}

function sanitizeNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

function normalizeNotificationProgress(progress: WorkbenchNotificationProgressInput | undefined): WorkbenchNotificationProgressState {
  return {
    infinite: Boolean(progress?.infinite),
    total: sanitizeNumber(progress?.total),
    worked: sanitizeNumber(progress?.worked),
    done: false,
  }
}

function normalizeNotificationActions(actions: WorkbenchNotificationActions | undefined): {
  projection: WorkbenchNotificationItem["actions"]
  registry: Map<string, WorkbenchNotificationAction>
} {
  const registry = new Map<string, WorkbenchNotificationAction>()
  const primary = normalizeNotificationActionGroup(actions?.primary, false, registry)
  const secondary = normalizeNotificationActionGroup(actions?.secondary, true, registry)
  return { projection: { primary, secondary }, registry }
}

function normalizeNotificationActionGroup(
  actions: readonly WorkbenchNotificationAction[] | undefined,
  isSecondary: boolean,
  registry: Map<string, WorkbenchNotificationAction>,
): WorkbenchNotificationActionProjection[] {
  return (actions || [])
    .filter((action) => action.id && action.label)
    .map((action) => {
      registry.set(action.id, action)
      return {
        id: action.id,
        label: action.label,
        isSecondary,
        command: action.command,
        keepOpen: Boolean(action.keepOpen),
      }
    })
}

function createEmptySeverityCounts(): Record<WorkbenchNotificationSeverity, number> {
  return {
    info: 0,
    success: 0,
    warning: 0,
    error: 0,
  }
}

export const globalWorkbenchStatusNotificationProgressService = new WorkbenchNotificationProgressService()
export const globalWorkbenchStatusbarService = globalWorkbenchStatusNotificationProgressService
export const globalWorkbenchNotificationService = globalWorkbenchStatusNotificationProgressService
export const globalWorkbenchProgressService = globalWorkbenchStatusNotificationProgressService

registerSingleton(
  IWorkbenchStatusNotificationProgressService,
  globalWorkbenchStatusNotificationProgressService,
  InstantiationType.Delayed,
)
registerSingleton(IWorkbenchStatusbarService, globalWorkbenchStatusbarService, InstantiationType.Delayed)
registerSingleton(IWorkbenchNotificationService, globalWorkbenchNotificationService, InstantiationType.Delayed)
registerSingleton(IWorkbenchProgressService, globalWorkbenchProgressService, InstantiationType.Delayed)
