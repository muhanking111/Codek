function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function isWorkbenchPanelSnapshotVisible(result) {
  const panelId = String(result?.workbenchPanelId || "")
  return Boolean(result?.workbenchPanelVisible)
    && isNonEmptyString(panelId)
    && Number(result?.workbenchPanelHeight || 0) > 0
    && result?.workbenchStatusActivePanelId === panelId
    && result?.workbenchLayoutServiceSizes?.panel?.height === Number(result?.workbenchPanelHeight || 0)
}

module.exports = {
  isWorkbenchPanelSnapshotVisible,
}
