/**
 * Tray icon + context menu for background goal execution.
 * The menu template is pure so smoke tests can validate tray behavior without
 * depending on the operating system tray UI.
 */

const fs = require("fs")
const path = require("path")

let tray = null
let scheduler = null
let mainWindowRef = null
let onQuit = null

function getIconPath() {
  const candidates = [
    path.join(__dirname, "..", "assets", "tray-icon.png"),
    path.join(__dirname, "assets", "tray-icon.png"),
    path.join(__dirname, "..", "build", "icon.png"),
  ]
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate } catch {}
  }
  return null
}

function showMainWindow(win) {
  if (!win || win.isDestroyed?.()) return
  if (!win.isVisible?.()) win.show?.()
  win.focus?.()
}

function buildTrayMenuTemplate(state = {}, handlers = {}) {
  const goals = Array.isArray(state.goals) ? state.goals : []
  const runningGoals = Number(state.runningGoals || 0)
  const openWindow = handlers.openWindow || (() => {})
  const openGoal = handlers.openGoal || (() => {})
  const pauseAll = handlers.pauseAll || (() => {})
  const resumeAll = handlers.resumeAll || (() => {})
  const quit = handlers.quit || (() => {})

  return [
    { label: `运行中: ${runningGoals} 个任务`, enabled: false },
    { type: "separator" },
    ...goals.slice(0, 8).map((goal) => ({
      label: `${goal.title || goal.id} - ${goal.progress || 0}%`,
      click: () => openGoal(goal.id),
    })),
    { type: "separator" },
    { label: "打开 Codek", click: openWindow },
    {
      label: state.paused ? "恢复所有任务" : "暂停所有任务",
      click: () => state.paused ? resumeAll() : pauseAll(),
    },
    { type: "separator" },
    { label: "退出", click: quit },
  ]
}

function refreshMenu() {
  if (!tray || !scheduler) return
  try {
    const { Menu } = require("electron")
    const state = scheduler.getState()
    const items = buildTrayMenuTemplate(state, {
      openWindow: () => showMainWindow(mainWindowRef),
      openGoal: (id) => {
        showMainWindow(mainWindowRef)
        try { mainWindowRef?.webContents?.send?.("open-goal", id) } catch {}
      },
      pauseAll: () => scheduler.pauseAll(),
      resumeAll: () => scheduler.resumeAll(),
      quit: () => { if (typeof onQuit === "function") onQuit() },
    })
    tray.setContextMenu(Menu.buildFromTemplate(items))
    tray.setToolTip(`Codek - ${state.runningGoals || 0} 个任务运行中`)
  } catch {}
}

function init({ scheduler: sched, mainWindow, quit }) {
  if (tray) return tray
  try {
    const { Tray, nativeImage } = require("electron")
    scheduler = sched
    mainWindowRef = mainWindow
    onQuit = quit
    const iconPath = getIconPath()
    const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
    tray = new Tray(icon.isEmpty() ? nativeImage.createFromBuffer(Buffer.alloc(0)) : icon)
    tray.setToolTip("Codek")
    tray.on("click", () => {
      if (!mainWindowRef || mainWindowRef.isDestroyed?.()) return
      if (mainWindowRef.isVisible?.()) mainWindowRef.hide?.()
      else showMainWindow(mainWindowRef)
    })
    if (scheduler?.on) {
      scheduler.on("state", refreshMenu)
      scheduler.on("goalEnd", refreshMenu)
      scheduler.on("enqueued", refreshMenu)
    }
    refreshMenu()
    setInterval(refreshMenu, 5000).unref?.()
    return tray
  } catch {
    return null
  }
}

function destroy() {
  if (tray) {
    try { tray.destroy() } catch {}
    tray = null
  }
}

module.exports = {
  init,
  destroy,
  refreshMenu,
  buildTrayMenuTemplate,
  showMainWindow,
}
