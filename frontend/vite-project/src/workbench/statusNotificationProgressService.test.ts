import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearCommands, registerCommand } from "./commandRegistry"
import {
  ProgressLocation,
  WorkbenchNotificationProgressService,
  WorkbenchStatusbarAlignment,
} from "./statusNotificationProgressService"

describe("WorkbenchNotificationProgressService", () => {
  let sounds: string[]
  let service: WorkbenchNotificationProgressService

  beforeEach(() => {
    vi.useFakeTimers()
    clearCommands()
    let idCounter = 0
    sounds = []
    service = new WorkbenchNotificationProgressService({
      now: () => Date.now(),
      createId: (prefix) => `${prefix}-${idCounter++}`,
      playSound: (type) => sounds.push(type),
    })
  })

  it("enqueues, updates, and dismisses notifications through a VS Code-style handle", () => {
    const snapshots: string[][] = []
    service.onDidChangeNotifications((items) => snapshots.push(items.map((item) => `${item.id}:${item.message}`)))

    const handle = service.notify({ severity: "warning", message: "等待审批", duration: 0, source: "agent.approval" })
    expect(service.getNotifications()).toMatchObject([
      { id: "notification-0", severity: "warning", message: "等待审批", source: "agent.approval", visible: true },
    ])

    handle.updateMessage("审批已阻断")
    handle.updateSeverity("error")
    expect(service.getNotifications()[0]).toMatchObject({
      id: "notification-0",
      severity: "error",
      message: "审批已阻断",
    })

    handle.close()
    expect(service.getNotifications()).toEqual([])
    expect(snapshots).toEqual([[], ["notification-0:等待审批"], ["notification-0:审批已阻断"], ["notification-0:审批已阻断"], []])
    expect(sounds).toEqual(["alert"])
  })

  it("auto dismisses timed notifications and keeps legacy duration semantics", () => {
    service.notify({ severity: "success", message: "任务完成", duration: 500 })

    expect(service.getNotifications()).toHaveLength(1)
    vi.advanceTimersByTime(499)
    expect(service.getNotifications()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(service.getNotifications()).toHaveLength(0)
    expect(sounds).toEqual(["complete"])
  })

  it("tracks progress lifecycle, updates window status, and supports cancellation", async () => {
    const cancelled: unknown[] = []
    const result = service.withProgress(
      {
        location: ProgressLocation.Window,
        title: "运行质量门",
        total: 4,
        cancellable: true,
        command: "workbench.progress.focus",
        source: "quality-gate",
      },
      async (progress, token) => {
        progress.report({ message: "typecheck", increment: 1 })
        const [task] = service.getProgressTasks()
        expect(service.getStatusbarEntries()).toMatchObject([
          {
            id: "status.progress",
            text: "运行质量门: typecheck",
            showProgress: true,
            command: "workbench.progress.focus",
          },
        ])

        expect(service.cancelProgress(task.id, "user")).toBe(true)
        expect(token.isCancellationRequested).toBe(true)
        progress.report({ message: "cancelled" })
        return "stopped"
      },
      (choice) => cancelled.push(choice),
    )

    await expect(result).resolves.toBe("stopped")
    expect(cancelled).toEqual(["user"])
    expect(service.getProgressTasks()).toEqual([])
    expect(service.getStatusbarEntries()).toEqual([])
  })

  it("projects notification progress through the same notification queue", async () => {
    const pending = service.withProgress(
      {
        location: ProgressLocation.Notification,
        title: "扩展激活",
        source: "extensionHost",
        total: 4,
      },
      async (progress) => {
        progress.report({ message: "加载", increment: 1 })
        expect(service.getNotificationQueue()).toEqual([
          expect.objectContaining({
            id: "notification.progress-0",
            severity: "info",
            message: "扩展激活",
            source: "extensionHost",
            progress: {
              infinite: false,
              total: 4,
              worked: 1,
              done: false,
            },
          }),
        ])
        progress.report({ increment: 2, total: 5 })
        expect(service.getNotificationQueue()[0].progress).toEqual({
          infinite: false,
          total: 5,
          worked: 3,
          done: false,
        })
        return "done"
      },
    )

    await expect(pending).resolves.toBe("done")
    expect(service.getNotificationQueue()).toEqual([])
    expect(service.getProgressTasks()).toEqual([])
  })

  it("maps notification progress buttons and cancel action back to the progress cancellation callback", async () => {
    const cancellations: unknown[] = []
    const managedExtensions: unknown[][] = []
    registerCommand({
      id: "workbench.extensions.manage",
      title: "Manage Extension",
      handler: (...args) => { managedExtensions.push(args) },
    })
    let finish: (() => void) | undefined
    const pending = service.withProgress(
      {
        location: ProgressLocation.Notification,
        title: "扩展登录",
        source: "ms.auth",
        cancellable: "停止",
        buttons: ["使用浏览器"],
        secondaryActions: [{
          id: "workbench.extensions.manage",
          label: "管理扩展",
          command: "workbench.extensions.manage",
          args: ["ms.auth"],
          keepOpen: true,
        }],
      },
      async (_progress, token) => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        expect(token.isCancellationRequested).toBe(true)
      },
      (choice) => cancellations.push(choice),
    )

    const notification = service.getNotificationQueue()[0]
    expect(notification.actions).toEqual({
      primary: [
        { id: "progress.button.0", label: "使用浏览器", isSecondary: false, command: undefined, keepOpen: false },
        { id: "progress.cancel", label: "停止", isSecondary: false, command: undefined, keepOpen: false },
      ],
      secondary: [
        { id: "workbench.extensions.manage", label: "管理扩展", isSecondary: true, command: "workbench.extensions.manage", keepOpen: true },
      ],
    })

    await expect(service.invokeNotificationAction(notification.id, "workbench.extensions.manage")).resolves.toBe(true)
    expect(managedExtensions).toEqual([["ms.auth"]])
    expect(service.getNotificationQueue()).toHaveLength(1)
    await expect(service.invokeNotificationAction(notification.id, "progress.button.0")).resolves.toBe(true)
    expect(cancellations).toEqual([0])

    finish?.()
    await expect(pending).resolves.toBeUndefined()
    expect(service.getNotificationQueue()).toEqual([])

    finish = undefined
    const cancelPending = service.withProgress(
      {
        location: ProgressLocation.Notification,
        title: "扩展取消",
        source: "ms.auth",
        cancellable: "停止",
      },
      async (_progress, token) => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        expect(token.isCancellationRequested).toBe(true)
      },
      (choice) => cancellations.push(choice),
    )

    const cancelNotification = service.getNotificationQueue()[0]
    expect(cancelNotification.actions.primary).toEqual([
      { id: "progress.cancel", label: "停止", isSecondary: false, command: undefined, keepOpen: false },
    ])
    await expect(service.invokeNotificationAction(cancelNotification.id, "progress.cancel")).resolves.toBe(true)
    expect(cancellations).toEqual([0, undefined])

    finish?.()
    await expect(cancelPending).resolves.toBeUndefined()
    expect(service.getNotificationQueue()).toEqual([])
  })

  it("executes command-backed notification actions and preserves VS Code primary and secondary close semantics", async () => {
    const invoked: unknown[][] = []
    registerCommand({
      id: "workbench.extensions.manage",
      title: "Manage Extension",
      handler: (...args) => { invoked.push(args) },
    })

    const handle = service.notify({
      severity: "info",
      message: "扩展正在后台工作",
      duration: 0,
      actions: {
        primary: [{ id: "openDetails", label: "打开详情", command: "workbench.extensions.manage", args: ["publisher.extension", { source: "notification" }] }],
        secondary: [{ id: "manage", label: "管理扩展", command: "workbench.extensions.manage", args: ["publisher.extension"], keepOpen: true }],
      },
    })

    await expect(service.invokeNotificationAction(handle.id, "manage")).resolves.toBe(true)
    expect(invoked).toEqual([["publisher.extension"]])
    expect(service.getNotificationQueue()).toHaveLength(1)

    await expect(service.invokeNotificationAction(handle.id, "openDetails")).resolves.toBe(true)
    expect(invoked).toEqual([
      ["publisher.extension"],
      ["publisher.extension", { source: "notification" }],
    ])
    expect(service.getNotificationQueue()).toEqual([])
  })

  it("keeps command-backed notification actions open when command lookup fails", async () => {
    const handle = service.notify({
      severity: "info",
      message: "缺少命令",
      duration: 0,
      actions: {
        primary: [{ id: "missing", label: "缺少命令", command: "missing.command" }],
      },
    })

    await expect(service.invokeNotificationAction(handle.id, "missing")).resolves.toBe(false)
    expect(service.getNotificationQueue()).toHaveLength(1)
  })

  it("projects status items with priority ordering and disposable accessors", () => {
    const branch = service.addEntry(
      {
        name: "Git Branch",
        text: "main",
        ariaLabel: "当前 Git 分支 main",
        kind: "remote",
        source: "scm",
      },
      "status.git.branch",
      WorkbenchStatusbarAlignment.LEFT,
      10,
    )
    service.addEntry(
      {
        name: "Diagnostics",
        text: "0 errors",
        ariaLabel: "没有诊断错误",
        kind: "standard",
        source: "problems",
      },
      "status.diagnostics",
      WorkbenchStatusbarAlignment.RIGHT,
      1,
    )

    expect(service.getStatusbarEntries().map((entry) => entry.id)).toEqual(["status.git.branch", "status.diagnostics"])
    branch.update({ text: "feature", ariaLabel: "当前 Git 分支 feature" })
    expect(service.getStatusbarEntries()[0]).toMatchObject({ text: "feature", alignment: WorkbenchStatusbarAlignment.LEFT })

    branch.dispose()
    expect(service.getStatusbarEntries().map((entry) => entry.id)).toEqual(["status.diagnostics"])
  })

  it("updates status visibility, alignment, and priority through the same accessor lifecycle", () => {
    const snapshots: string[][] = []
    service.onDidChangeStatusbar((items) => snapshots.push(items.map((entry) => `${entry.id}:${entry.alignment}:${entry.priority}:${entry.visible}`)))
    const entry = service.addEntry(
      {
        name: "Agent Approval",
        text: "等待审批",
        ariaLabel: "Agent 等待审批",
        command: "agent.approval.focus",
        source: "agent",
      },
      "status.agent.approval",
      WorkbenchStatusbarAlignment.LEFT,
      5,
    )

    entry.update({ visible: false })
    expect(service.getStatusbarEntries()).toMatchObject([
      { id: "status.agent.approval", visible: false, alignment: WorkbenchStatusbarAlignment.LEFT, priority: 5 },
    ])

    entry.update({ visible: true, alignment: WorkbenchStatusbarAlignment.RIGHT, priority: -10 })
    expect(service.getStatusbarEntries()).toMatchObject([
      { id: "status.agent.approval", visible: true, alignment: WorkbenchStatusbarAlignment.RIGHT, priority: -10 },
    ])

    entry.dispose()
    expect(service.getStatusbarEntries()).toEqual([])
    expect(snapshots).toEqual([
      [],
      ["status.agent.approval:0:5:true"],
      ["status.agent.approval:0:5:false"],
      ["status.agent.approval:1:-10:true"],
      [],
    ])
  })

  it("keeps a VS Code-style notification queue with actions, progress, and silent/DND projection", async () => {
    const actions: string[] = []
    const handle = service.notify({
      severity: "warning",
      message: "需要审批",
      duration: 0,
      source: "agent.approval",
      priority: "default",
      actions: {
        primary: [{ id: "approve", label: "允许", run: () => { actions.push("approve") } }],
        secondary: [{ id: "details", label: "查看证据", run: () => { actions.push("details") } }],
      },
      progress: { total: 4, worked: 1 },
    })

    expect(service.getNotificationQueue()).toMatchObject([
      {
        id: "notification-0",
        visible: true,
        priority: "default",
        actions: {
          primary: [{ id: "approve", label: "允许", isSecondary: false, command: undefined, keepOpen: false }],
          secondary: [{ id: "details", label: "查看证据", isSecondary: true, command: undefined, keepOpen: false }],
        },
        progress: { infinite: false, total: 4, worked: 1, done: false },
      },
    ])

    handle.progress.worked(2)
    handle.progress.done()
    expect(service.getNotificationQueue()[0].progress).toMatchObject({ total: 4, worked: 3, done: true })

    expect(await service.invokeNotificationAction(handle.id, "details")).toBe(true)
    expect(service.getNotificationQueue()).toHaveLength(1)
    expect(await service.invokeNotificationAction(handle.id, "approve")).toBe(true)
    expect(service.getNotificationQueue()).toEqual([])
    expect(actions).toEqual(["details", "approve"])

    service.notify({ severity: "info", message: "静默提示", duration: 0, source: "index", priority: "silent" })
    expect(service.getNotifications().map((item) => item.message)).toEqual([])
    expect(service.getNotificationQueue().map((item) => `${item.message}:${item.visible}:${item.priority}:${item.filter}`)).toEqual([
      "静默提示:false:silent:off",
    ])
    service.clearNotifications()

    service.setNotificationsFilter("error")
    service.notify({ severity: "info", message: "后台索引", duration: 0, source: "index", priority: "silent" })
    service.notify({ severity: "error", message: "失败", duration: 0, source: "index", priority: "urgent" })

    expect(service.getNotifications().map((item) => item.message)).toEqual(["失败"])
    expect(service.getNotificationQueue().map((item) => `${item.message}:${item.visible}:${item.priority}:${item.filter}`)).toEqual([
      "失败:true:urgent:error",
      "后台索引:false:silent:error",
    ])
  })

  it("exposes VS Code-style owner evidence for queue source, actions, severity, dismiss, progress, and no-second-state", async () => {
    const handle = service.notify({
      severity: "error",
      message: "安装失败",
      duration: 0,
      source: "extensions",
      dedupeKey: "ext:install",
      focusTarget: "workbench.view.extensions",
      actions: {
        primary: [{
          id: "retry",
          label: "重试",
          keepOpen: true,
          run: () => undefined,
        }],
        secondary: [{
          id: "openLogs",
          label: "打开日志",
          command: "workbench.action.output.toggleOutput",
          keepOpen: true,
        }],
      },
      progress: { total: 10, worked: 3 },
    })
    service.notify({ severity: "info", message: "后台索引", duration: 0, source: "search", priority: "silent" })

    let finish: (() => void) | undefined
    const pending = service.withProgress(
      {
        location: ProgressLocation.Notification,
        title: "扩展激活",
        source: "extensionHost",
        total: 5,
        cancellable: true,
      },
      async (progress) => {
        progress.report({ message: "resolve", increment: 2 })
        await new Promise<void>((resolve) => {
          finish = resolve
        })
      },
    )

    const evidence = service.getNotificationOwnerEvidence()
    expect(evidence).toMatchObject({
      stateSource: "workbenchStatusNotificationProgressService",
      queueSource: "workbenchStatusNotificationProgressService.notifications",
      visibleSource: "workbenchStatusNotificationProgressService.getNotifications",
      actionRegistrySource: "workbenchStatusNotificationProgressService.notificationActions",
      progressSource: "workbenchStatusNotificationProgressService.progressTasks",
      noSecondNotificationState: true,
      queueCount: 3,
      visibleCount: 2,
      hiddenCount: 1,
      severityCounts: { info: 2, success: 0, warning: 0, error: 1 },
      sources: [
        { source: "extensionHost", queueCount: 1, visibleCount: 1 },
        { source: "extensions", queueCount: 1, visibleCount: 1 },
        { source: "search", queueCount: 1, visibleCount: 0 },
      ],
      remainingUiGaps: expect.arrayContaining([
        expect.stringContaining("完整 VS Code Notification Center"),
        expect.stringContaining("Activity Bar"),
      ]),
    })
    expect(service.getNotificationActions(handle.id)).toEqual([
      { id: "retry", label: "重试", isSecondary: false, command: undefined, keepOpen: true },
      { id: "openLogs", label: "打开日志", isSecondary: true, command: "workbench.action.output.toggleOutput", keepOpen: true },
    ])
    expect(evidence.actionRegistry).toEqual(expect.arrayContaining([
      expect.objectContaining({ notificationId: handle.id, actionId: "retry", isSecondary: false, keepOpen: true }),
      expect.objectContaining({ notificationId: handle.id, actionId: "openLogs", command: "workbench.action.output.toggleOutput", isSecondary: true }),
      expect.objectContaining({ actionId: "progress.cancel", label: "Cancel", keepOpen: false }),
    ]))
    expect(evidence.progressHandles).toEqual([
      expect.objectContaining({
        title: "扩展激活",
        source: "extensionHost",
        cancellable: true,
        cancelCommandId: "workbench.progress.cancel",
        worked: 2,
        total: 5,
      }),
    ])

    service.dismissNotification(handle.id)
    expect(service.getNotificationOwnerEvidence().dismissLifecycle).toEqual([
      expect.objectContaining({
        id: handle.id,
        reason: "api",
        source: "extensions",
        severity: "error",
        message: "安装失败",
      }),
    ])

    finish?.()
    await expect(pending).resolves.toBeUndefined()
  })

  it("exposes statusbar, notification, progress, toast, and mainThread bridge owner evidence without claiming full UI ownership", async () => {
    const statusEntry = service.addEntry(
      {
        name: "Language Mode",
        text: "TypeScript",
        ariaLabel: "当前语言 TypeScript",
        source: "editor",
      },
      "status.editor.language",
      WorkbenchStatusbarAlignment.RIGHT,
      100,
    )
    service.notify({ severity: "info", message: "扩展已激活", duration: 0, source: "extensionHost" })

    let finish: (() => void) | undefined
    const pending = service.withProgress(
      {
        location: ProgressLocation.Window,
        title: "索引",
        source: "search",
        total: 2,
      },
      async (progress) => {
        progress.report({ message: "扫描", increment: 1 })
        await new Promise<void>((resolve) => {
          finish = resolve
        })
      },
    )

    const evidence = service.getOwnerEvidence()
    expect(evidence).toMatchObject({
      statusBarServiceOwner: {
        owner: "WorkbenchNotificationProgressService",
        status: "connected",
        stateSource: "workbenchStatusNotificationProgressService.statusbarItems",
        lifecycle: "addEntry/update/dispose/onDidChangeStatusbar",
        noSecondState: true,
        entryCount: 2,
        vscodeSource: "src/vs/workbench/services/statusbar/browser/statusbar.ts",
      },
      notificationServiceOwner: {
        owner: "WorkbenchNotificationProgressService",
        status: "connected",
        stateSource: "workbenchStatusNotificationProgressService.notifications",
        lifecycle: "notify/update/close/filter/onDidChangeNotifications",
        noSecondState: true,
        queueCount: 1,
        visibleCount: 1,
        vscodeSource: "src/vs/platform/notification/common/notification.ts",
      },
      progressServiceOwner: {
        owner: "WorkbenchNotificationProgressService",
        status: "connected",
        stateSource: "workbenchStatusNotificationProgressService.progressTasks",
        lifecycle: "withProgress/report/cancel/complete/onDidChangeProgress",
        noSecondState: true,
        activeCount: 1,
        vscodeSource: "src/vs/platform/progress/common/progress.ts",
      },
      toastStateOwner: {
        owner: "NotificationToast",
        status: "partial",
        connected: false,
        stateSource: "utils/notifications.subscribe -> workbenchStatusNotificationProgressService.onDidChangeNotifications",
        noSecondState: true,
      },
      mainThreadBridgeOwner: {
        owner: "desktop/services/extensions-host/mainThread",
        status: "partial",
        connected: true,
        stateSource: "ext-host renderer events -> workbenchStatusNotificationProgressService",
        noSecondState: true,
        rendererEventChannels: [
          "ext-host:statusbar-entry",
          "ext-host:statusbar-dispose",
          "ext-host:progress-start",
          "ext-host:progress-report",
          "ext-host:progress-end",
        ],
      },
      remainingStatusUiOwnerGap: expect.stringContaining("App.vue/central workbench shell"),
    })
    expect(JSON.stringify(evidence)).not.toContain("SourceMirror")
    expect(evidence.toastStateOwner.reason).toContain("partial UI owner")
    expect(evidence.notificationQueueEvidence.stateSource).toBe("workbenchStatusNotificationProgressService")

    finish?.()
    await expect(pending).resolves.toBeUndefined()
    statusEntry.dispose()
  })
})
