const test = require("node:test")
const assert = require("node:assert/strict")

const notifications = require("./notifications")

function fakeFactory(created) {
  return (options) => {
    const handlers = {}
    const notification = {
      options,
      on: (event, handler) => { handlers[event] = handler },
      show: () => { notification.shown = true },
      click: () => handlers.click?.(),
      shown: false,
    }
    created.push(notification)
    return notification
  }
}

test("notification modes filter lifecycle events", () => {
  notifications.resetForTest()

  assert.equal(notifications.shouldNotify("success"), true)
  notifications.setMode("failures-only")
  assert.equal(notifications.shouldNotify("success"), false)
  assert.equal(notifications.shouldNotify("failure"), true)
  assert.equal(notifications.shouldNotify("needs-decision"), true)
  notifications.setMode("off")
  assert.equal(notifications.shouldNotify("failure"), false)
})

test("notification click restores the window and opens the goal", () => {
  notifications.resetForTest()
  const created = []
  const calls = []
  notifications.setNotificationFactory(fakeFactory(created))
  notifications.setMainWindow({
    isDestroyed: () => false,
    isVisible: () => false,
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
    webContents: {
      send: (channel, goalId) => calls.push(`${channel}:${goalId}`),
    },
  })

  const notification = notifications.notifyGoalFailed({
    id: "goal_1",
    description: "失败任务",
    error: "boom",
  })
  notification.click()

  assert.equal(created.length, 1)
  assert.equal(created[0].shown, true)
  assert.equal(created[0].options.title, "Codek 任务失败")
  assert.deepEqual(calls, ["show", "focus", "open-goal:goal_1"])
})

test("failures-only mode skips success notifications", () => {
  notifications.resetForTest()
  const created = []
  notifications.setNotificationFactory(fakeFactory(created))
  notifications.setMode("failures-only")

  const result = notifications.notifyGoalDone({ id: "goal_2", description: "完成任务" })

  assert.equal(result, null)
  assert.equal(created.length, 0)
})

test("notification owner evidence stays in-memory under test and does not create a workbench notification state", () => {
  notifications.resetForTest()
  const created = []
  notifications.setNotificationFactory(fakeFactory(created))
  notifications.setMode("failures-only")

  assert.deepEqual(notifications.getOwnerEvidence(), {
    owner: "desktop/services/notifications",
    status: "connected",
    stateSource: "in-memory notificationFactory/mode",
    lifecycle: "notify/createNotification/show/click",
    noSecondWorkbenchNotificationState: true,
    realSystemNotification: "factory-or-electron-guarded",
    mode: "failures-only",
    hasNotificationFactory: true,
    hasMainWindow: false,
  })
  assert.equal(created.length, 0)
})
