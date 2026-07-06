import { ref } from "vue"
import { settingsStore } from "./settings/settingsStore"
import { workbenchThemeService } from "./vscode-adapter/platform/theme/common/themeService"
import { THEMES, getMonacoTheme, getThemeColors, normalizeColorTheme, type ThemeId } from "./themeRegistry"

const THEME_KEY = "codek.theme.v1"

export { THEMES, getMonacoTheme, normalizeColorTheme, type ThemeId } from "./themeRegistry"

function readStored(): ThemeId {
  const settingsTheme = settingsStore.get("workbench.colorTheme")
  const normalizedSettingsTheme = normalizeColorTheme(settingsTheme)
  if (normalizedSettingsTheme) return normalizedSettingsTheme
  try {
    const raw = localStorage.getItem(THEME_KEY)
    const normalizedStoredTheme = normalizeColorTheme(raw)
    if (normalizedStoredTheme) return normalizedStoredTheme
  } catch {
    // ignore
  }
  return "dark"
}

export const activeTheme = ref<ThemeId>(readStored())

export function setTheme(themeId: ThemeId): void {
  void workbenchThemeService.setColorTheme(themeId)
}

export function setThemeFromWorkbenchValue(value: unknown): ThemeId | null {
  const themeId = normalizeColorTheme(value)
  if (!themeId) return null
  void workbenchThemeService.setColorTheme(themeId)
  return themeId
}

function applyNormalizedTheme(themeId: ThemeId, persistSettings: boolean): void {
  try {
    localStorage.setItem(THEME_KEY, themeId)
  } catch {
    // ignore
  }
  activeTheme.value = themeId
  if (persistSettings) settingsStore.set("workbench.colorTheme", themeId)
  applyThemeClass(themeId)
}

function syncNormalizedSettingsTheme(value: unknown): void {
  const themeId = normalizeColorTheme(value)
  if (!themeId) return
  applyNormalizedTheme(themeId, false)
  if (value !== themeId) {
    void workbenchThemeService.setColorTheme(themeId)
  }
}

export function applyThemeClass(themeId: ThemeId): void {
  const root = document.documentElement
  root.classList.remove("theme-light", "theme-high-contrast")

  if (themeId === "light") {
    root.classList.add("theme-light")
  }
  applyThemeCssVariables(themeId)
}

export function initTheme(): void {
  applyThemeClass(activeTheme.value)
}

export function getThemeCssVariables(themeId: ThemeId): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const [token, color] of Object.entries(getThemeColors(themeId))) {
    variables[`--vscode-${token.replace(/\./g, "-")}`] = color
  }
  return variables
}

function applyThemeCssVariables(themeId: ThemeId): void {
  const rootStyle = document.documentElement.style
  for (const [name, value] of Object.entries(getThemeCssVariables(themeId))) {
    rootStyle.setProperty(name, value)
  }
}

export function defineMonacoWorkbenchThemes(monaco: {
  editor?: {
    defineTheme?: (themeName: string, themeData: unknown) => void
  }
}): void {
  monaco.editor?.defineTheme?.("codek-cursor-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "D4D4D4", background: "1E1E1E" },
      { token: "comment", foreground: "6A9955", fontStyle: "italic" },
      { token: "string", foreground: "CE9178" },
      { token: "number", foreground: "B5CEA8" },
      { token: "keyword", foreground: "C586C0" },
      { token: "type", foreground: "4EC9B0" },
      { token: "identifier", foreground: "DCDCAA" },
    ],
    colors: {
      "editor.background": "#1E1E1E",
      "editor.foreground": "#D4D4D4",
      "editorGutter.background": "#1E1E1E",
      "editorLineNumber.foreground": "#6E7681",
      "editorLineNumber.activeForeground": "#C9D1D9",
      "editor.lineHighlightBackground": "#2A2D2E66",
      "editor.lineHighlightBorder": "#00000000",
      "editorCursor.foreground": "#AEAFAD",
      "editor.selectionBackground": "#264F78",
      "editor.inactiveSelectionBackground": "#3A3D4166",
      "editor.selectionHighlightBackground": "#ADD6FF26",
      "editorIndentGuide.background1": "#404040",
      "editorIndentGuide.activeBackground1": "#707070",
      "editorBracketMatch.background": "#0064001A",
      "editorBracketMatch.border": "#888888",
      "editorOverviewRuler.border": "#00000000",
      "editorOverviewRuler.findMatchForeground": "#D1861677",
      "editorOverviewRuler.errorForeground": "#F8514977",
      "editorOverviewRuler.warningForeground": "#D2992277",
      "scrollbarSlider.background": "#79797966",
      "scrollbarSlider.hoverBackground": "#646464B3",
      "scrollbarSlider.activeBackground": "#BFBFBF66",
      "minimap.background": "#1E1E1E",
      "minimapSlider.background": "#79797933",
      "minimapSlider.hoverBackground": "#64646459",
      "minimapSlider.activeBackground": "#BFBFBF40",
    },
  })
}

workbenchThemeService.onDidColorThemeChange((theme) => {
  if (activeTheme.value === theme.type) return
  applyNormalizedTheme(theme.type, false)
})

settingsStore.onDidChangeConfiguration((event) => {
  if (event.affectsConfiguration("workbench.colorTheme")) {
    syncNormalizedSettingsTheme(settingsStore.get("workbench.colorTheme"))
  }
})
