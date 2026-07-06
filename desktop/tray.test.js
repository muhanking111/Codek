const test = require("node:test")
const assert = require("node:assert/strict")

const { buildTrayMenuTemplate, showMainWindow } = require("./tray")

test("buildTrayMenuTemplate exposes running goals and limits task rows", () => {
  const opened = []
  const goals = Array.from({ length: 10 }, (_, index) => ({
    id: `goal_${index}`,
    title: `任务 ${index}`,
    progress: index * 10,
  }))

  const menu = buildTrayMenuTemplate(
    { runningGoals: 10, paused: false, goals },
    { openGoal: (id) => opened.push(id) },
  )
  const taskItems = menu.filter((item) => typeof item.click === "function" && item.label?.startsWith("任务 "))

  assert.equal(menu[0].label, "运行中: 10 个任务")
  assert.equal(taskItems.length, 8)
  taskItems[0].click()
  assert.deepEqual(opened, ["goal_0"])
})

test("buildTrayMenuTemplate toggles pause and resume handlers", () => {
  const calls = []
  const pausedMenu = buildTrayMenuTemplate(
    { runningGoals: 1, paused: true, goals: [] },
    { resumeAll: () => calls.push("resume") },
  )
  const runningMenu = buildTrayMenuTemplate(
    { runningGoals: 1, paused: false, goals: [] },
    { pauseAll: () => calls.push("pause") },
  )

  pausedMenu.find((item) => item.label === "恢复所有任务").click()
  runningMenu.find((item) => item.label === "暂停所有任务").click()

  assert.deepEqual(calls, ["resume", "pause"])
})

test("showMainWindow restores hidden windows without touching destroyed windows", () => {
  const calls = []
  const win = {
    isDestroyed: () => false,
    isVisible: () => false,
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
  }
  const destroyed = {
    isDestroyed: () => true,
    show: () => calls.push("bad-show"),
    focus: () => calls.push("bad-focus"),
  }

  showMainWindow(win)
  showMainWindow(destroyed)

  assert.deepEqual(calls, ["show", "focus"])
})
