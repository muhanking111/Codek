export type ThemeId = "dark" | "light"

export interface ThemeMeta {
  id: ThemeId
  name: string
  monacoTheme: string
  typeSelector: "vs" | "vs-dark"
  colors: Record<string, string>
}

export const THEMES: ThemeMeta[] = [
  {
    id: "dark",
    name: "Dark",
    monacoTheme: "codek-cursor-dark",
    typeSelector: "vs-dark",
    colors: {
      foreground: "#cccccc",
      "descriptionForeground": "#9d9d9d",
      "focusBorder": "#007fd4",
      "contrastBorder": "#00000000",
      "editor.background": "#1e1e1e",
      "editor.foreground": "#d4d4d4",
      "panel.border": "#3c3c3c",
      "progressBar.background": "#0e70c0",
    },
  },
  {
    id: "light",
    name: "Light",
    monacoTheme: "vs",
    typeSelector: "vs",
    colors: {
      foreground: "#1f2328",
      "descriptionForeground": "#57606a",
      "focusBorder": "#0969da",
      "contrastBorder": "#00000000",
      "editor.background": "#ffffff",
      "editor.foreground": "#24292f",
      "panel.border": "#d0d7de",
      "progressBar.background": "#0969da",
    },
  },
]

function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value)
}

export function normalizeColorTheme(value: unknown): ThemeId | null {
  if (isThemeId(value)) return value
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  if (!normalized) return null
  if (
    normalized === "high-contrast"
    || normalized.includes("high contrast")
    || normalized.includes("hc ")
    || normalized.includes("hc-black")
  ) return "dark"
  if (normalized.includes("light")) return "light"
  if (normalized.includes("dark") || normalized.includes("black") || normalized.includes("cursor")) return "dark"
  return null
}

export function getMonacoTheme(themeId: ThemeId): string {
  const meta = THEMES.find((t) => t.id === themeId)
  return meta ? meta.monacoTheme : "codek-cursor-dark"
}

export function themeColorFromId(id: string): { id: string } {
  return { id }
}

export function getThemeTypeSelector(themeId: ThemeId): "vs" | "vs-dark" {
  return getThemeMeta(themeId).typeSelector
}

export function getThemeColor(themeId: ThemeId, colorId: string, useDefault = true): string | undefined {
  const meta = getThemeMeta(themeId)
  const color = meta.colors[colorId]
  if (color || !useDefault) return color
  return themeId === "light" ? "#000000" : "#ffffff"
}

export function getThemeColors(themeId: ThemeId): Record<string, string> {
  return { ...getThemeMeta(themeId).colors }
}

function getThemeMeta(themeId: ThemeId): ThemeMeta {
  return THEMES.find((theme) => theme.id === themeId) ?? THEMES[0]
}
