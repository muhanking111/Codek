import { describe, expect, it } from "vitest"
import { getWorkbenchSettings } from "./workbenchSettings"

describe("workbenchSettings", () => {
  it("maps VS Code workbench settings to runtime layout flags", () => {
    expect(
      getWorkbenchSettings({
        "workbench.iconTheme": "material-icon-theme",
        "workbench.activityBar.visible": false,
        "workbench.statusBar.visible": false,
        "workbench.sideBar.location": "right",
        "workbench.panel.defaultLocation": "left",
      }),
    ).toEqual({
      iconTheme: "material-icon-theme",
      activityBarVisible: false,
      statusBarVisible: false,
      sideBarLocation: "right",
      panelDefaultLocation: "left",
    })
  })

  it("falls back to supported defaults for invalid values", () => {
    expect(
      getWorkbenchSettings({
        "workbench.iconTheme": "",
        "workbench.activityBar.visible": "false",
        "workbench.statusBar.visible": "true",
        "workbench.sideBar.location": "top",
        "workbench.panel.defaultLocation": "center",
      }),
    ).toEqual({
      iconTheme: "vs-seti",
      activityBarVisible: true,
      statusBarVisible: true,
      sideBarLocation: "left",
      panelDefaultLocation: "bottom",
    })
  })

  it("migrates the old hand-drawn Codek default to VS Code Seti icons", () => {
    expect(
      getWorkbenchSettings({
        "workbench.iconTheme": "codek-default",
      }).iconTheme,
    ).toBe("vs-seti")
  })
})
