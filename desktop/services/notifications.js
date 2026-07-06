/**
 * Native OS notifications for goal lifecycle events.
 *
 * Tests can inject a notification factory so click behavior is verifiable
 * without relying on the host operating system notification center.
 */

let mode = "all"
let mainWindowRef = null
let notificationFactory = null

const OWNER_EVIDENCE = Object.freeze({
  owner: "desktop/services/notifications",
  status: "connected",
  stateSource: "in-memory notificationFactory/mode",
  lifecycle: "notify/createNotification/show/click",
  noSecondWorkbenchNotificationState: true,
  realSystemNotification: "factory-or-electron-guarded",
})

function setMode(nextMode) {
  if (["off", "failures-only", "all"].includes(nextMode)) mode = nextMode
}

function getMode() {
  return mode
}

function setMainWindow(win) {
  mainWindowRef = win
}

function setNotificationFactory(factory) {
  notificationFactory = typeof factory === "function" ? factory : null
}

function resetForTest() {
  mode = "all"
  mainWindowRef = null
  notificationFactory = null
}

function shouldNotify(kind) {
  if (mode === "off") return false
  if (mode === "failures-only") return kind === "failure" || kind === "needs-decision"
  return true
}

function showAndFocusGoal(goalId) {
  try {
    if (!mainWindowRef || mainWindowRef.isDestroyed?.()) return
    if (!mainWindowRef.isVisible?.()) mainWindowRef.show?.()
    mainWindowRef.focus?.()
    if (goalId) mainWindowRef.webContents?.send?.("open-goal", goalId)
  } catch {}
}

function createNotification(options) {
  if (notificationFactory) return notificationFactory(options)
  const { Notification } = require("electron")
  if (!Notification.isSupported()) return null
  return new Notification(options)
}

function notify({ title, body, kind, goalId }) {
  if (!shouldNotify(kind)) return null
  try {
    const notification = createNotification({
      title,
      body: body || "",
      silent: false,
    })
    if (!notification) return null
    notification.on?.("click", () => showAndFocusGoal(goalId))
    notification.show?.()
    return notification
  } catch {
    return null
  }
}

function getOwnerEvidence() {
  return {
    ...OWNER_EVIDENCE,
    mode,
    hasNotificationFactory: typeof notificationFactory === "function",
    hasMainWindow: Boolean(mainWindowRef),
  }
}

function notifyGoalDone(goal) {
  return notify({
    title: "Codek 任务完成",
    body: `${goal.description || goal.title || goal.id}\n${goal.summary || ""}`.slice(0, 200),
    kind: "success",
    goalId: goal.id,
  })
}

function notifyGoalFailed(goal) {
  return notify({
    title: "Codek 任务失败",
    body: `${goal.description || goal.title || goal.id}\n${goal.error || ""}`.slice(0, 200),
    kind: "failure",
    goalId: goal.id,
  })
}

function notifyNeedsDecision(goal) {
  return notify({
    title: "Codek 需要你的决定",
    body: `${goal.description || goal.title || goal.id}\n${goal.reason || ""}`.slice(0, 200),
    kind: "needs-decision",
    goalId: goal.id,
  })
}

module.exports = {
  setMode,
  getMode,
  setMainWindow,
  setNotificationFactory,
  resetForTest,
  shouldNotify,
  notify,
  notifyGoalDone,
  notifyGoalFailed,
  notifyNeedsDecision,
  getOwnerEvidence,
}
