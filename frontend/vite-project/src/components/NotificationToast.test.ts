import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import NotificationToast from "./NotificationToast.vue"
import { clearCommands, registerCommand } from "../workbench/commandRegistry"
import { ProgressLocation, globalWorkbenchNotificationService } from "../workbench/statusNotificationProgressService"

describe("NotificationToast", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearCommands()
    globalWorkbenchNotificationService.clearNotifications()
  })

  it("renders notification primary and secondary actions and invokes the service action hook", async () => {
    const invoked: unknown[][] = []
    registerCommand({
      id: "workbench.extensions.manage",
      title: "Manage Extension",
      handler: (...args) => {
        invoked.push(args)
      },
    })

    const wrapper = mount(NotificationToast)
    const handle = globalWorkbenchNotificationService.notify({
      severity: "info",
      message: "扩展正在后台工作",
      duration: 0,
      actions: {
        primary: [
          {
            id: "openDetails",
            label: "打开详情",
            command: "workbench.extensions.manage",
            args: ["publisher.extension", { source: "notification" }],
          },
        ],
        secondary: [
          {
            id: "manage",
            label: "管理扩展",
            command: "workbench.extensions.manage",
            args: ["publisher.extension"],
            keepOpen: true,
          },
        ],
      },
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-codek-smoke="notification-toast-container"]').attributes("data-notification-state-source")).toBe("workbenchStatusNotificationProgressService")
    const toast = wrapper.find('[data-codek-smoke="notification-toast"]')
    expect(toast.attributes("data-notification-owner")).toBe("NotificationToast")
    expect(toast.attributes("data-notification-service-source")).toBe("workbenchStatusNotificationProgressService")
    expect(toast.attributes("data-notification-id")).toBe(handle.id)
    expect(toast.attributes("data-notification-dismiss-command")).toBe("workbench.notifications.dismiss")
    expect(wrapper.find('[data-notification-action-ids="openDetails,manage"]').exists()).toBe(true)
    expect(wrapper.find('[data-notification-action-id="openDetails"]').attributes("data-notification-action-owner")).toBe("workbenchStatusNotificationProgressService.invokeNotificationAction")
    expect(wrapper.find('[data-notification-action-id="openDetails"]').attributes("data-notification-action-command")).toBe("workbench.extensions.manage")
    expect(wrapper.find('[data-notification-action-id="openDetails"]').attributes("data-notification-action-keep-open")).toBe("false")
    expect(wrapper.find('[data-notification-action-id="manage"]').attributes("data-notification-action-keep-open")).toBe("true")
    expect(wrapper.find('[data-codek-smoke="notification-dismiss"]').attributes("aria-label")).toBe("关闭通知")
    await wrapper.find('[data-notification-action-id="manage"]').trigger("click")
    expect(invoked).toEqual([["publisher.extension"]])
    expect(globalWorkbenchNotificationService.getNotificationQueue()).toHaveLength(1)

    await wrapper.find('[data-notification-action-id="openDetails"]').trigger("click")
    expect(invoked).toEqual([
      ["publisher.extension"],
      ["publisher.extension", { source: "notification" }],
    ])
    expect(globalWorkbenchNotificationService.getNotificationQueue()).toEqual([])

    handle.dispose()
    wrapper.unmount()
  })

  it("renders progress buttons, secondary commands, and cancel action through the visible toast UI", async () => {
    const cancellations: unknown[] = []
    const managedExtensions: unknown[][] = []
    registerCommand({
      id: "workbench.extensions.manage",
      title: "Manage Extension",
      handler: (...args) => {
        managedExtensions.push(args)
      },
    })
    let finish: (() => void) | undefined
    const wrapper = mount(NotificationToast)
    const pending = globalWorkbenchNotificationService.withProgress(
      {
        location: ProgressLocation.Notification,
        title: "扩展登录",
        total: 4,
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
      async (progress, token) => {
        progress.report({ message: "等待登录", increment: 2 })
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        expect(token.isCancellationRequested).toBe(true)
      },
      (choice) => cancellations.push(choice),
    )
    await wrapper.vm.$nextTick()

    const progress = wrapper.find('[role="progressbar"]')
    expect(progress.exists()).toBe(true)
    expect(progress.attributes("data-notification-progress-infinite")).toBe("false")
    expect(progress.attributes("data-notification-progress-total")).toBe("4")
    expect(progress.attributes("data-notification-progress-worked")).toBe("2")
    expect(progress.attributes("data-notification-progress-done")).toBe("false")
    expect(progress.attributes("aria-valuenow")).toBe("2")
    expect(wrapper.find('[data-notification-action-ids="progress.button.0,progress.cancel,workbench.extensions.manage"]').exists()).toBe(true)
    await wrapper.find('[data-notification-action-id="workbench.extensions.manage"]').trigger("click")
    expect(managedExtensions).toEqual([["ms.auth"]])
    expect(globalWorkbenchNotificationService.getNotificationQueue()).toHaveLength(1)

    await wrapper.find('[data-notification-action-id="progress.button.0"]').trigger("click")
    expect(cancellations).toEqual([0])

    finish?.()
    await expect(pending).resolves.toBeUndefined()
    expect(globalWorkbenchNotificationService.getNotificationQueue()).toEqual([])

    finish = undefined
    const cancelPending = globalWorkbenchNotificationService.withProgress(
      {
        location: ProgressLocation.Notification,
        title: "扩展登录",
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
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[role="progressbar"]').attributes("data-notification-progress-infinite")).toBe("true")
    expect(wrapper.find('[data-notification-action-id="progress.cancel"]').exists()).toBe(true)
    await wrapper.find('[data-notification-action-id="progress.cancel"]').trigger("click")
    expect(cancellations).toEqual([0, undefined])

    finish?.()
    await expect(cancelPending).resolves.toBeUndefined()
    expect(globalWorkbenchNotificationService.getNotificationQueue()).toEqual([])

    wrapper.unmount()
  })

  it("renders VS Code Manage Extension progress action with a command-backed identity", async () => {
    const managedExtensions: unknown[][] = []
    registerCommand({
      id: "workbench.extensions.manage",
      title: "Manage Extension",
      handler: (...args) => {
        managedExtensions.push(args)
      },
    })
    let finish: (() => void) | undefined
    const wrapper = mount(NotificationToast)
    const pending = globalWorkbenchNotificationService.withProgress(
      {
        location: ProgressLocation.Notification,
        title: "扩展认证",
        secondaryActions: [{
          id: "workbench.extensions.manage",
          label: "Manage Extension",
          command: "workbench.extensions.manage",
          args: ["ms.auth"],
          keepOpen: true,
        }],
      },
      async (_progress, token) => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        expect(token.isCancellationRequested).toBe(false)
      },
    )
    await wrapper.vm.$nextTick()

    const manage = wrapper.find('[data-notification-action-id="workbench.extensions.manage"]')
    expect(manage.exists()).toBe(true)
    expect(manage.attributes("data-notification-action-secondary")).toBe("true")
    await manage.trigger("click")
    expect(managedExtensions).toEqual([["ms.auth"]])
    expect(globalWorkbenchNotificationService.getNotificationQueue()).toHaveLength(1)

    finish?.()
    await expect(pending).resolves.toBeUndefined()
    expect(globalWorkbenchNotificationService.getNotificationQueue()).toEqual([])
    wrapper.unmount()
  })
})
