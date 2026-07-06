const assert = require("node:assert/strict")
const test = require("node:test")

const {
  isWorkbenchPanelSnapshotVisible,
} = require("./realProjectUiSmokeAcceptance")

function makePanelSnapshot(patch = {}) {
  return {
    workbenchPanelVisible: true,
    workbenchPanelId: "tasks",
    workbenchPanelHeight: 240,
    workbenchStatusActivePanelId: "tasks",
    workbenchLayoutServiceSizes: {
      panel: { height: 240 },
    },
    ...patch,
  }
}

test("workbench panel snapshot accepts any visible active panel with observable layout state", () => {
  assert.equal(isWorkbenchPanelSnapshotVisible(makePanelSnapshot({ workbenchPanelId: "tasks", workbenchStatusActivePanelId: "tasks" })), true)
  assert.equal(isWorkbenchPanelSnapshotVisible(makePanelSnapshot({ workbenchPanelId: "output", workbenchStatusActivePanelId: "output" })), true)
})

test("workbench panel snapshot rejects hidden or unobservable panel state", () => {
  assert.equal(isWorkbenchPanelSnapshotVisible(makePanelSnapshot({ workbenchPanelVisible: false })), false)
  assert.equal(isWorkbenchPanelSnapshotVisible(makePanelSnapshot({ workbenchPanelId: "" })), false)
  assert.equal(isWorkbenchPanelSnapshotVisible(makePanelSnapshot({ workbenchPanelHeight: 0, workbenchLayoutServiceSizes: { panel: { height: 0 } } })), false)
})

test("workbench panel snapshot rejects stale status or layout mismatch", () => {
  assert.equal(isWorkbenchPanelSnapshotVisible(makePanelSnapshot({ workbenchStatusActivePanelId: "output" })), false)
  assert.equal(isWorkbenchPanelSnapshotVisible(makePanelSnapshot({ workbenchLayoutServiceSizes: { panel: { height: 180 } } })), false)
})
