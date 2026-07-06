import { settingsStore } from "./settingsStore"

export type SideBarLocation = "left" | "right"
export type PanelLocation = "bottom" | "right" | "left"

export interface WorkbenchSettings {
  iconTheme: string
  activityBarVisible: boolean
  statusBarVisible: boolean
  sideBarLocation: SideBarLocation
  panelDefaultLocation: PanelLocation
}

export function getWorkbenchSettings(settings = settingsStore.getAll()): WorkbenchSettings {
  return {
    iconTheme: iconThemeValue(settings["workbench.iconTheme"]),
    activityBarVisible: booleanValue(settings["workbench.activityBar.visible"], true),
    statusBarVisible: booleanValue(settings["workbench.statusBar.visible"], true),
    sideBarLocation: enumValue(settings["workbench.sideBar.location"], "left", ["left", "right"]),
    panelDefaultLocation: enumValue(settings["workbench.panel.defaultLocation"], "bottom", [
      "bottom",
      "right",
      "left",
    ]),
  }
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback
}

function iconThemeValue(value: unknown): string {
  const theme = stringValue(value, "vs-seti")
  // Older Codek builds persisted the hand-drawn fallback as the default.
  // Product-grade parity should default to VS Code's Seti file icon theme.
  return theme === "codek-default" ? "vs-seti" : theme
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function enumValue<T extends string>(value: unknown, fallback: T, allowed: T[]): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback
}
