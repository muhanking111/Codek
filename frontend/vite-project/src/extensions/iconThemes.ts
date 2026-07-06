import { ref } from "vue"
import { api } from "../lib/api"

export interface FileIconThemeIcon {
  id: string
  fontCharacter?: string
  fontColor?: string
  fontSize?: string
  fontId?: string
  fontFamily?: string
  iconPath?: string
}

export interface FileIconThemeData {
  definitions?: Record<string, FileIconThemeIcon>
  fonts?: Array<{
    id: string
    weight?: string
    style?: string
    size?: string
    src?: Array<{ path: string; format?: string }>
  }>
  file?: FileIconThemeIcon | null
  folder?: FileIconThemeIcon | null
  folderExpanded?: FileIconThemeIcon | null
  rootFolder?: FileIconThemeIcon | null
  rootFolderExpanded?: FileIconThemeIcon | null
  fileExtensions?: Record<string, FileIconThemeIcon>
  fileNames?: Record<string, FileIconThemeIcon>
  folderNames?: Record<string, FileIconThemeIcon>
  folderNamesExpanded?: Record<string, FileIconThemeIcon>
  rootFolderNames?: Record<string, FileIconThemeIcon>
  rootFolderNamesExpanded?: Record<string, FileIconThemeIcon>
  languageIds?: Record<string, FileIconThemeIcon>
  light?: FileIconThemeVariant | null
  highContrast?: FileIconThemeVariant | null
  showLanguageModeIcons?: boolean
  hidesExplorerArrows?: boolean
}

export type FileIconThemeVariant = Partial<Omit<FileIconThemeData, "definitions" | "fonts" | "light" | "highContrast" | "hidesExplorerArrows" | "showLanguageModeIcons">>

export interface LoadedFileIconTheme {
  found: boolean
  themeId: string
  label?: string
  icons: FileIconThemeData
  error?: string
}

interface ApiClient {
  get<T = unknown>(path: string): Promise<T>
}

const BUILTIN_FALLBACK_THEMES = new Set(["codek-default", "minimal", "monochrome"])
const FAILED_THEME_RETRY_MS = 800
const MAX_FAILED_THEME_AUTO_RETRIES = 15
const ICON_FONT_LOAD_SAMPLE_TEXT = "\ue001"

const cache = new Map<string, LoadedFileIconTheme>()
const inflight = new Map<string, Promise<LoadedFileIconTheme>>()
const failedCache = new Map<string, { at: number; value: LoadedFileIconTheme }>()
const retryCounts = new Map<string, number>()

export const activeFileIconTheme = ref<LoadedFileIconTheme | null>(null)
export const fileIconThemeFontLoadVersion = ref(0)
const installedFontStyleIds = new Set<string>()
const fontLoadStates = new Map<string, "loading" | "ready" | "error">()

export async function ensureFileIconTheme(themeId: string, client: ApiClient = api): Promise<LoadedFileIconTheme | null> {
  const normalizedThemeId = String(themeId || "").trim()
  if (!normalizedThemeId || BUILTIN_FALLBACK_THEMES.has(normalizedThemeId)) {
    activeFileIconTheme.value = null
    return null
  }

  const cached = cache.get(normalizedThemeId)
  if (cached) {
    activeFileIconTheme.value = cached
    return cached
  }

  const failed = failedCache.get(normalizedThemeId)
  if (failed && Date.now() - failed.at < FAILED_THEME_RETRY_MS) {
    activeFileIconTheme.value = null
    return failed.value
  }

  let request = inflight.get(normalizedThemeId)
  if (!request) {
    request = client
      .get<LoadedFileIconTheme>(`/extensions-host/icon-themes/${encodeURIComponent(normalizedThemeId)}`)
      .then((theme) => normalizeLoadedTheme(theme, normalizedThemeId))
      .catch((error) => ({
        found: false,
        themeId: normalizedThemeId,
        error: error instanceof Error ? error.message : String(error),
        icons: {},
      }))
      .finally(() => {
        inflight.delete(normalizedThemeId)
      })
    inflight.set(normalizedThemeId, request)
  }

  const loaded = await request
  if (loaded.found) {
    cache.set(normalizedThemeId, loaded)
    failedCache.delete(normalizedThemeId)
    retryCounts.delete(normalizedThemeId)
    activeFileIconTheme.value = loaded
  } else {
    failedCache.set(normalizedThemeId, { at: Date.now(), value: loaded })
    activeFileIconTheme.value = null
    if (client === api) scheduleFileIconThemeRetry(normalizedThemeId, client)
  }
  return loaded
}

export function resolveFileIconThemeIcon(
  theme: LoadedFileIconTheme | null,
  name: string,
  isDir: boolean,
  isOpen = false,
  options: { isRoot?: boolean; languageId?: string; colorThemeKind?: "dark" | "light" | "highContrast" } = {},
): FileIconThemeIcon | null {
  const icons = applyThemeVariant(theme?.icons, options.colorThemeKind)
  if (!icons) return null

  const base = basename(name).toLowerCase()
  const normalizedPath = normalizeLookupPath(name)
  if (!base) return null

  if (isDir) {
    const expandedNames = options.isRoot ? icons.rootFolderNamesExpanded : icons.folderNamesExpanded
    const names = options.isRoot ? icons.rootFolderNames : icons.folderNames
    const defaultExpanded = options.isRoot ? icons.rootFolderExpanded : icons.folderExpanded
    const defaultClosed = options.isRoot ? icons.rootFolder : icons.folder
    const exact = (isOpen ? lookupIcon(expandedNames, normalizedPath, base) : null)
      || lookupIcon(names, normalizedPath, base)
      || (isOpen ? defaultExpanded : null)
      || defaultClosed
      || (isOpen ? icons.folderExpanded : null)
      || icons.folder
    return exact || null
  }

  const nameMatch = lookupIcon(icons.fileNames, normalizedPath, base)
  if (nameMatch) return nameMatch

  const extensionKeys = extensionCandidates(normalizedPath, base)
  for (const ext of extensionKeys) {
    const match = icons.fileExtensions?.[ext]
    if (match) return match
  }

  const languageIcon = options.languageId ? icons.languageIds?.[options.languageId.toLowerCase()] : null
  if (languageIcon) return languageIcon

  return icons.file || null
}

export function getRenderableFileIconThemeSource(icon: FileIconThemeIcon | null | undefined): "image" | "glyph" | null {
  if (!icon) return null
  if (normalizeThemeIconSrc(icon.iconPath)) return "image"
  if (decodeThemeFontCharacter(icon.fontCharacter)) return "glyph"
  return null
}

export function getVisibleFileIconThemeSource(theme: LoadedFileIconTheme | null, icon: FileIconThemeIcon | null | undefined): "image" | "glyph" | null {
  const source = getRenderableFileIconThemeSource(icon)
  if (source !== "glyph") return source
  if (isFileIconThemeFontReady(theme, icon)) return "glyph"
  return null
}

export function isFileIconThemeFontReady(theme: LoadedFileIconTheme | null, icon: FileIconThemeIcon | null | undefined): boolean {
  if (!theme?.found || !icon) return false
  const fontId = getThemeIconFontId(theme, icon)
  if (!fontId) return true

  const font = theme.icons?.fonts?.find((entry) => entry.id === fontId)
  if (!font) return false
  if (typeof document === "undefined" || !("fonts" in document)) return true

  const key = fontLoadStateKey(theme.themeId, fontId)
  const probe = fontProbe(fontId, font.size)
  const sampleText = decodeThemeFontCharacter(icon.fontCharacter) || ICON_FONT_LOAD_SAMPLE_TEXT
  const fontSet = document.fonts as FontFaceSet
  if (fontSet.check?.(probe, sampleText)) {
    markFontLoadState(key, "ready")
    return true
  }
  if (fontLoadStates.get(key) !== "loading") {
    ensureThemeFontLoaded(theme.themeId, font, sampleText)
  }
  return fontLoadStates.get(key) === "ready"
}

export function triggerFileIconThemeFontLoad(theme: LoadedFileIconTheme | null, icon: FileIconThemeIcon | null | undefined): void {
  if (!theme?.found || !icon) return
  const fontId = getThemeIconFontId(theme, icon)
  if (!fontId) return
  const font = theme.icons?.fonts?.find((entry) => entry.id === fontId)
  if (!font) return
  const sampleText = decodeThemeFontCharacter(icon.fontCharacter) || ICON_FONT_LOAD_SAMPLE_TEXT
  ensureThemeFontLoaded(theme.themeId, font, sampleText)
}

export function installFileIconThemeFonts(theme: LoadedFileIconTheme | null): void {
  if (typeof document === "undefined" || !theme?.found) return
  const fonts = Array.isArray(theme.icons?.fonts) ? theme.icons.fonts : []
  for (const font of fonts) {
    if (!font.id || !Array.isArray(font.src) || font.src.length === 0) continue
    const src = font.src
      .filter((source) => source.path)
      .map((source) => {
        const format = source.format ? ` format("${cssEscapeString(source.format)}")` : ""
        return `url("${cssEscapeString(source.path)}")${format}`
      })
      .join(", ")
    if (!src) continue
    const styleId = `codek-file-icon-font-${theme.themeId}-${font.id}`.replace(/[^a-z0-9_-]/gi, "-")
    if (!installedFontStyleIds.has(styleId) && !document.getElementById(styleId)) {
      const style = document.createElement("style")
      style.id = styleId
      style.textContent = [
        "@font-face {",
        `  font-family: "${cssEscapeString(font.id)}";`,
        `  src: ${src};`,
        `  font-weight: ${font.weight || "normal"};`,
        `  font-style: ${font.style || "normal"};`,
        "  font-display: block;",
        "}",
      ].join("\n")
      document.head.appendChild(style)
    }
    installedFontStyleIds.add(styleId)
    ensureThemeFontLoaded(theme.themeId, font)
  }
}

export function getFileIconThemeFontLoadVersion(): number {
  return fileIconThemeFontLoadVersion.value
}

export function getFileIconThemeFontSize(theme: LoadedFileIconTheme | null, icon: FileIconThemeIcon | null | undefined): string {
  if (!icon) return ""
  const iconFontSize = normalizeRenderableFontSize(icon.fontSize)
  if (iconFontSize) return iconFontSize

  const fontId = getThemeIconFontId(theme, icon)
  const font = fontId ? theme?.icons?.fonts?.find((entry) => entry.id === fontId) : null
  return normalizeRenderableFontSize(font?.size)
}

if (typeof window !== "undefined") {
  ;(window as unknown as { __codekIconThemeDebug?: () => unknown }).__codekIconThemeDebug = () => ({
    activeTheme: activeFileIconTheme.value
      ? {
          found: activeFileIconTheme.value.found,
          themeId: activeFileIconTheme.value.themeId,
          label: activeFileIconTheme.value.label,
          error: activeFileIconTheme.value.error,
          fonts: activeFileIconTheme.value.icons?.fonts || [],
        }
      : null,
    fontLoadVersion: fileIconThemeFontLoadVersion.value,
    fontLoadStates: Object.fromEntries(fontLoadStates),
    cachedThemeIds: [...cache.keys()],
    failedThemeIds: [...failedCache.keys()],
  })
}

function applyThemeVariant(icons: FileIconThemeData | undefined, kind?: "dark" | "light" | "highContrast"): FileIconThemeData | undefined {
  if (!icons) return undefined
  const variant = kind === "light" ? icons.light : kind === "highContrast" ? icons.highContrast : null
  if (!variant) return icons
  return {
    ...icons,
    ...Object.fromEntries(Object.entries(variant).filter(([, value]) => value !== null && value !== undefined)),
    fileExtensions: { ...(icons.fileExtensions || {}), ...(variant.fileExtensions || {}) },
    fileNames: { ...(icons.fileNames || {}), ...(variant.fileNames || {}) },
    folderNames: { ...(icons.folderNames || {}), ...(variant.folderNames || {}) },
    folderNamesExpanded: { ...(icons.folderNamesExpanded || {}), ...(variant.folderNamesExpanded || {}) },
    rootFolderNames: { ...(icons.rootFolderNames || {}), ...(variant.rootFolderNames || {}) },
    rootFolderNamesExpanded: { ...(icons.rootFolderNamesExpanded || {}), ...(variant.rootFolderNamesExpanded || {}) },
    languageIds: { ...(icons.languageIds || {}), ...(variant.languageIds || {}) },
  }
}

function lookupIcon(map: Record<string, FileIconThemeIcon> | undefined, normalizedPath: string, base: string): FileIconThemeIcon | null {
  if (!map) return null
  return map[normalizedPath] || map[base] || null
}

function normalizeThemeIconSrc(src: string | undefined): string {
  if (!src) return ""
  if (src.startsWith("codek-extension-resource://")) return src
  if (src.startsWith("data:image/")) return src
  if (/^https?:\/\//i.test(src)) return src
  return ""
}

function decodeThemeFontCharacter(value: string | undefined): string {
  if (!value) return ""
  if (!value.startsWith("\\")) return value
  const codePoint = Number.parseInt(value.replace(/^\\[uU]?/, ""), 16)
  return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ""
}

function normalizeLoadedTheme(theme: LoadedFileIconTheme | null | undefined, fallbackId: string): LoadedFileIconTheme {
  return {
    found: !!theme?.found,
    themeId: theme?.themeId || fallbackId,
    label: theme?.label,
    icons: theme?.icons && typeof theme.icons === "object" ? theme.icons : {},
    error: theme?.error,
  }
}

function extensionCandidates(normalizedPath: string, base: string): string[] {
  const pathParts = normalizedPath.split("/")
  const candidates: string[] = []
  for (let start = 0; start < pathParts.length; start += 1) {
    const scoped = pathParts.slice(start).join("/")
    const scopedParts = scoped.split(".").filter(Boolean)
    if (scopedParts.length <= 1) continue
    for (let index = 0; index < scopedParts.length; index += 1) {
      candidates.push(scopedParts.slice(index).join("."))
    }
  }

  const parts = base.split(".").filter(Boolean)
  if (parts.length <= 1) return [base]
  for (let index = 1; index < parts.length; index += 1) {
    candidates.push(parts.slice(index).join("."))
  }
  candidates.push(parts[parts.length - 1])
  return [...new Set(candidates)]
}

function basename(value: string): string {
  return String(value || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || String(value || "")
}

function normalizeLookupPath(value: string): string {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase()
}

function cssEscapeString(value: string): string {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function getThemeIconFontId(theme: LoadedFileIconTheme | null, icon: FileIconThemeIcon | null | undefined): string {
  return icon?.fontId || icon?.fontFamily || theme?.icons?.fonts?.[0]?.id || ""
}

function ensureThemeFontLoaded(themeId: string, font: NonNullable<FileIconThemeData["fonts"]>[number], sampleText = ICON_FONT_LOAD_SAMPLE_TEXT): void {
  if (typeof document === "undefined" || !("fonts" in document)) return
  const key = fontLoadStateKey(themeId, font.id)
  const current = fontLoadStates.get(key)
  if (current === "ready" || current === "loading") return

  const fontSet = document.fonts as FontFaceSet
  const probe = fontProbe(font.id, font.size)
  if (fontSet.check?.(probe, sampleText)) {
    markFontLoadState(key, "ready")
    return
  }

  markFontLoadState(key, "loading")
  void fontSet.load(probe, sampleText)
    .then((faces) => {
      const ready = faces.length > 0 || Boolean(fontSet.check?.(probe, sampleText))
      markFontLoadState(key, ready ? "ready" : "error")
    })
    .catch(() => markFontLoadState(key, "error"))
}

function scheduleFileIconThemeRetry(themeId: string, client: ApiClient): void {
  if (typeof window === "undefined") return
  const retryCount = retryCounts.get(themeId) || 0
  if (retryCount >= MAX_FAILED_THEME_AUTO_RETRIES) return
  retryCounts.set(themeId, retryCount + 1)
  window.setTimeout(() => {
    const cached = cache.get(themeId)
    if (cached?.found) return
    void ensureFileIconTheme(themeId, client).then((theme) => installFileIconThemeFonts(theme))
  }, FAILED_THEME_RETRY_MS)
}

function markFontLoadState(key: string, state: "loading" | "ready" | "error"): void {
  if (fontLoadStates.get(key) === state) return
  fontLoadStates.set(key, state)
  fileIconThemeFontLoadVersion.value += 1
}

function fontLoadStateKey(themeId: string, fontId: string): string {
  return `${themeId}\0${fontId}`
}

function fontProbe(fontId: string, size?: string): string {
  return `${normalizeFontLoadProbeSize(size)} ${quoteCssFontFamily(fontId)}`
}

function normalizeFontLoadProbeSize(size?: string): string {
  const value = String(size || "").trim()
  return value && /^[0-9.]+px$/.test(value) ? value : "16px"
}

function normalizeRenderableFontSize(size?: string): string {
  const value = String(size || "").trim()
  if (!value) return ""
  if (/^[0-9.]+px$/.test(value)) {
    const px = Number.parseFloat(value)
    return Number.isFinite(px) ? `${Math.round((px / 13) * 100)}%` : ""
  }
  return /^[0-9.]+(em|rem|%)$/.test(value) ? value : ""
}

function quoteCssFontFamily(fontId: string): string {
  return `"${cssEscapeString(fontId)}"`
}
