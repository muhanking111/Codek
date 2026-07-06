import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  addNotification,
  clearNotifications,
  dismissNotification,
  getNotificationFacadeOwnerEvidence,
  getNotificationOwnerEvidence,
  getNotifications,
  notify,
  subscribe,
} from "./notifications"

describe("legacy notification utility facade", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearNotifications()
  })

  it("proxies enqueue, subscribe, and dismiss to the workbench notification service", () => {
    const snapshots: string[][] = []
    const unsubscribe = subscribe((items) => snapshots.push(items.map((item) => `${item.type}:${item.message}`)))

    const id = addNotification("info", "索引开始", 0)
    notify("success", "索引完成", 0)

    expect(getNotifications().map((item) => item.message)).toEqual(["索引完成", "索引开始"])
    dismissNotification(id)
    expect(getNotifications().map((item) => item.message)).toEqual(["索引完成"])

    unsubscribe()
    clearNotifications()
    expect(snapshots).toEqual([[], ["info:索引开始"], ["success:索引完成", "info:索引开始"], ["success:索引完成"]])
  })

  it("exposes the legacy facade as a connected proxy without a second notification state", () => {
    addNotification("warning", "需要确认", 0)

    expect(getNotificationFacadeOwnerEvidence()).toEqual({
      owner: "utils/notifications",
      status: "connected",
      stateSource: "globalWorkbenchNotificationService",
      noSecondState: true,
      queueSource: "workbenchStatusNotificationProgressService.notifications",
      visibleSource: "workbenchStatusNotificationProgressService.getNotifications",
    })
    expect(getNotificationOwnerEvidence()).toEqual(expect.objectContaining({
      stateSource: "workbenchStatusNotificationProgressService",
      noSecondNotificationState: true,
      queueCount: 1,
      visibleCount: 1,
    }))
  })
})
