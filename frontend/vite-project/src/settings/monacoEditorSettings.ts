export type SettingsRecord = Record<string, unknown>

export interface MonacoEditorSettingsOptions {
  fontSize: number
  fontFamily: string
  tabSize: number
  insertSpaces: boolean
  wordWrap: "off" | "on" | "wordWrapColumn" | "bounded"
  minimap: { enabled: boolean }
  lineNumbers: "on" | "off" | "relative" | "interval"
  renderWhitespace: "none" | "boundary" | "selection" | "trailing" | "all"
  bracketPairColorization: { enabled: boolean }
  unicodeHighlight: {
    ambiguousCharacters: boolean
    invisibleCharacters: boolean
    nonBasicASCII: boolean
  }
  formatOnPaste: boolean
}

export interface MonacoProductEditorOptions extends MonacoEditorSettingsOptions {
  scrollBeyondLastLine: boolean
  padding: { top: number; bottom: number }
  folding: boolean
  foldingStrategy: "auto" | "indentation"
  showFoldingControls: "always" | "mouseover"
  foldingHighlight: boolean
  guides: { bracketPairs: boolean; indentation: boolean }
  largeFileOptimizations: boolean
  renderLineHighlight: "none" | "gutter" | "line" | "all"
  smoothScrolling: boolean
  cursorBlinking: "blink" | "smooth" | "phase" | "expand" | "solid"
  cursorSmoothCaretAnimation: "off" | "explicit" | "on"
  glyphMargin: boolean
  lineDecorationsWidth: number
  lineNumbersMinChars: number
  overviewRulerLanes: number
  overviewRulerBorder: boolean
  stopRenderingLineAfter: number
  scrollbar: {
    verticalScrollbarSize: number
    horizontalScrollbarSize: number
    useShadows: boolean
    verticalHasArrows: boolean
    horizontalHasArrows: boolean
  }
}

export function getMonacoEditorSettingsOptions(
  settings: SettingsRecord,
): MonacoEditorSettingsOptions {
  return {
    fontSize: clampNumber(settings["editor.fontSize"], 14, 8, 40),
    fontFamily: stringValue(
      settings["editor.fontFamily"],
      "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    ),
    tabSize: clampNumber(settings["editor.tabSize"], 2, 1, 8),
    insertSpaces: booleanValue(settings["editor.insertSpaces"], true),
    wordWrap: enumValue(settings["editor.wordWrap"], "off", [
      "off",
      "on",
      "wordWrapColumn",
      "bounded",
    ]),
    minimap: { enabled: booleanValue(settings["editor.minimap.enabled"], true) },
    lineNumbers: enumValue(settings["editor.lineNumbers"], "on", [
      "on",
      "off",
      "relative",
      "interval",
    ]),
    renderWhitespace: enumValue(settings["editor.renderWhitespace"], "selection", [
      "none",
      "boundary",
      "selection",
      "trailing",
      "all",
    ]),
    bracketPairColorization: {
      enabled: booleanValue(settings["editor.bracketPairColorization.enabled"], true),
    },
    unicodeHighlight: {
      ambiguousCharacters: false,
      invisibleCharacters: false,
      nonBasicASCII: false,
    },
    formatOnPaste: booleanValue(settings["editor.formatOnPaste"], false),
  }
}

export function getProductGradeMonacoEditorOptions(
  settings: SettingsRecord,
): MonacoProductEditorOptions {
  const settingsOptions = getMonacoEditorSettingsOptions(settings)
  return {
    scrollBeyondLastLine: true,
    padding: { top: 8, bottom: 190 },
    folding: true,
    foldingStrategy: "indentation",
    showFoldingControls: "always",
    foldingHighlight: true,
    guides: { bracketPairs: true, indentation: true },
    largeFileOptimizations: true,
    renderLineHighlight: "all",
    smoothScrolling: true,
    cursorBlinking: "smooth",
    cursorSmoothCaretAnimation: "on",
    overviewRulerLanes: 3,
    overviewRulerBorder: false,
    stopRenderingLineAfter: 10000,
    scrollbar: {
      verticalScrollbarSize: 12,
      horizontalScrollbarSize: 12,
      useShadows: false,
      verticalHasArrows: false,
      horizontalHasArrows: false,
    },
    ...settingsOptions,
    glyphMargin: true,
    lineDecorationsWidth: 14,
    lineNumbersMinChars: 3,
  }
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  if (numberValue < min) return fallback
  return Math.min(max, Math.max(min, numberValue))
}

function enumValue<T extends string>(value: unknown, fallback: T, allowed: T[]): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback
}
