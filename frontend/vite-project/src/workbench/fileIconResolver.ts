/*
 * Fallback icon resolution follows VS Code's file icon theme data model.
 * The data source is Codek's bundled copy of the VS Code Seti theme:
 * D:\Workspace\extensions\theme-seti\icons\vs-seti-icon-theme.json.
 */

import setiIconTheme from "../../../../extensions/theme-seti/icons/vs-seti-icon-theme.json?raw"

export interface FallbackFileIcon {
  type: string
  color: string
  className: string
  glyph: string
  label: string
  fontFamily: string
  fontSize: string
}

interface SetiIconDefinition {
  fontCharacter?: string
  fontColor?: string
}

interface SetiFontDefinition {
  id: string
  size?: string
}

interface SetiRawIconTheme {
  file?: string
  fonts?: SetiFontDefinition[]
  iconDefinitions?: Record<string, SetiIconDefinition>
  fileExtensions?: Record<string, string>
  fileNames?: Record<string, string>
  languageIds?: Record<string, string>
}

type SetiResolvedTheme = Required<Pick<
  SetiRawIconTheme,
  "file" | "fonts" | "iconDefinitions" | "fileExtensions" | "fileNames" | "languageIds"
>>

const SETI_FALLBACK_THEME = parseSetiTheme(setiIconTheme)
const DEFAULT_COLOR = "#8b949e"
const FALLBACK_FONT_ID = "seti"
const FALLBACK_FONT_SIZE = "150%"
const EMPTY_DIRECTORY_ICON: FallbackFileIcon = {
  type: "folder",
  color: "",
  className: "",
  glyph: "",
  label: "",
  fontFamily: "",
  fontSize: "",
}
const LEGACY_CLASS_ALIASES: Record<string, string> = {
  javascript: "js",
  typescript: "ts",
  markdown: "md",
  python: "py",
  shell: "sh",
  "objective-c": "objc",
  "c-sharp": "csharp",
}
const VSCODE_JSON_EXTENSION_ALIASES = new Set(["code-workspace", "codeworkspace", "code-snippets", "codeprofile"])

export function resolveFallbackFileIcon(name: string, isDir = false, _isOpen = false): FallbackFileIcon {
  if (isDir) return { ...EMPTY_DIRECTORY_ICON }

  const base = basename(name).toLowerCase()
  const iconId = resolveFileIconId(name, base)
  const fallbackId = SETI_FALLBACK_THEME.file
  const icon = SETI_FALLBACK_THEME.iconDefinitions[iconId] || SETI_FALLBACK_THEME.iconDefinitions[fallbackId]
  const type = normalizeType(iconId || fallbackId)
  const font = SETI_FALLBACK_THEME.fonts[0] || { id: FALLBACK_FONT_ID, size: FALLBACK_FONT_SIZE }
  return {
    type,
    color: icon?.fontColor || DEFAULT_COLOR,
    className: iconClassName(type),
    glyph: decodeFontCharacter(icon?.fontCharacter),
    label: "",
    fontFamily: `${font.id || FALLBACK_FONT_ID}, codicon, ui-monospace, monospace`,
    fontSize: font.size || FALLBACK_FONT_SIZE,
  }
}

function parseSetiTheme(raw: string): SetiResolvedTheme {
  const parsed = JSON.parse(raw) as SetiRawIconTheme
  return {
    file: parsed.file || "_default",
    fonts: Array.isArray(parsed.fonts) && parsed.fonts.length ? parsed.fonts : [{ id: FALLBACK_FONT_ID, size: FALLBACK_FONT_SIZE }],
    iconDefinitions: parsed.iconDefinitions || {},
    fileExtensions: normalizeIconMap(parsed.fileExtensions),
    fileNames: normalizeIconMap(parsed.fileNames),
    languageIds: normalizeIconMap(parsed.languageIds),
  }
}

function normalizeIconMap(map: Record<string, string> | undefined): Record<string, string> {
  if (!map) return {}
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(map)) normalized[key.toLowerCase()] = value
  return normalized
}

function iconClassName(type: string): string {
  const alias = LEGACY_CLASS_ALIASES[type]
  return [
    `icon-${type}`,
    alias ? `icon-${alias}` : "",
  ].filter(Boolean).join(" ")
}

function resolveFileIconId(name: string, base: string): string {
  const normalizedPath = normalizeLookupPath(name)
  const nameMatch = SETI_FALLBACK_THEME.fileNames[normalizedPath] || SETI_FALLBACK_THEME.fileNames[base]
  if (nameMatch) return nameMatch

  for (const extension of extensionCandidates(normalizedPath, base)) {
    if (VSCODE_JSON_EXTENSION_ALIASES.has(extension)) return "_json"
    const match = SETI_FALLBACK_THEME.fileExtensions[extension] || SETI_FALLBACK_THEME.languageIds[languageIdCandidate(extension)]
    if (match) return match
  }
  return SETI_FALLBACK_THEME.file
}

function extensionCandidates(normalizedPath: string, base: string): string[] {
  const candidates: string[] = []
  const cleanBase = base.replace(/^\.+/, "")
  if (cleanBase && cleanBase !== base) candidates.push(cleanBase)
  const pathParts = normalizedPath.split("/").filter(Boolean)
  for (let start = 0; start < pathParts.length; start += 1) {
    const scoped = pathParts.slice(start).join("/")
    const scopedParts = scoped.replace(/^\.+/, "").split(".").filter(Boolean)
    for (let index = Math.min(1, scopedParts.length - 1); index < scopedParts.length; index += 1) {
      candidates.push(scopedParts.slice(index).join("."))
    }
  }

  const parts = cleanBase.split(".").filter(Boolean)
  if (parts.length <= 1) candidates.push(cleanBase || base)
  else {
    for (let index = 1; index < parts.length; index += 1) {
      candidates.push(parts.slice(index).join("."))
    }
    candidates.push(parts[parts.length - 1])
  }
  return [...new Set(candidates.filter(Boolean))]
}

function languageIdCandidate(extension: string): string {
  const lower = String(extension || "").toLowerCase()
  if (lower === "ts") return "typescript"
  if (lower === "tsx") return "typescriptreact"
  if (lower === "js" || lower === "mjs" || lower === "cjs" || lower === "jsx") return "javascript"
  if (lower === "md" || lower === "mdx") return "markdown"
  if (lower === "yml") return "yaml"
  if (lower === "ps1") return "powershell"
  return lower
}

function normalizeType(iconId: string): string {
  return String(iconId || "default").replace(/^_/, "").replace(/_/g, "-").replace(/[^a-z0-9-]/gi, "-").toLowerCase()
}

function normalizeLookupPath(value: string): string {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase()
}

function decodeFontCharacter(value: string | undefined): string {
  if (!value) return ""
  if (!value.startsWith("\\")) return value
  const codePoint = Number.parseInt(value.replace(/^\\[uU]?/, ""), 16)
  return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ""
}

export function basename(value: string): string {
  return String(value || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || String(value || "")
}
