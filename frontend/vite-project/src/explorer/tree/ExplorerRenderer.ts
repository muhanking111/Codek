import type { ExplorerItem } from "../model/ExplorerModel"
import type { LoadedFileIconTheme } from "../../extensions/iconThemes"
import { getFileIconThemeFontSize, getVisibleFileIconThemeSource, resolveFileIconThemeIcon } from "../../extensions/iconThemes"
import { resolveFallbackFileIcon } from "../../workbench/fileIconResolver"
import { applyTreeLayoutTraits, resolveTreeLayoutTraits } from "../../vscode-adapter/base/browser/ui/tree/treeLayout"

export interface ExplorerRendererDecoration {
  label?: string
  status?: string
  tooltip?: string
}

export interface ExplorerRendererOptions {
  activeUri?: string
  selectedUri?: string
  focusedUri?: string
  decorations?: Record<string, ExplorerRendererDecoration | string>
  iconTheme?: LoadedFileIconTheme | null
  iconThemeId?: string
  iconThemeVersion?: number
}

export class ExplorerRenderer {
  private options: ExplorerRendererOptions
  private templateVersion = 1
  private iconCache = new Map<string, ResolvedExplorerIcon>()

  constructor(options: ExplorerRendererOptions = {}) {
    this.options = options
  }

  updateOptions(options: ExplorerRendererOptions): void {
    if (options.iconTheme && options.iconTheme !== this.options.iconTheme) {
      this.iconCache.clear()
    }
    this.options = { ...this.options, ...options }
  }

  createRow(): HTMLElement {
    const row = document.createElement("div")
    row.className = "codek-explorer-row"
    row.setAttribute("role", "treeitem")
    this.ensureTemplate(row)
    return row
  }

  renderElement(item: ExplorerItem, row: HTMLElement, index: number): void {
    this.ensureTemplate(row)
    const selectedUri = this.options.selectedUri || this.options.activeUri || ""
    const selected = item.uri === selectedUri
    const editableData = item.editable
    const layoutTraits = resolveTreeLayoutTraits({
      depth: item.depth,
      isDirectory: item.isDirectory,
      expanded: item.expanded,
      ignored: item.ignored,
      selected,
    })
    row.dataset.uri = item.uri
    row.dataset.index = String(index)
    row.dataset.isDirectory = String(item.isDirectory)
    row.id = explorerRowDomId(item)
    row.draggable = true
    row.className = [
      "codek-explorer-row",
      item.isDirectory ? "dir" : "file",
      item.expanded ? "expanded" : "",
      selected ? "selected" : "",
      item.ignored ? "ignored" : "",
      item.loading ? "loading" : "",
      item.error ? "error" : "",
      editableData ? "editable" : "",
    ].filter(Boolean).join(" ")
    row.draggable = !editableData
    applyTreeLayoutTraits(row, layoutTraits)

    const twistie = row.querySelector(".codek-explorer-twistie") as HTMLElement | null
    if (twistie) {
      twistie.textContent = layoutTraits.twistieText
      twistie.dataset.state = layoutTraits.twistieState
    }

    const icon = row.querySelector(".codek-explorer-icon") as HTMLElement | null
    if (icon) {
      const resolvedIcon = layoutTraits.showIcon ? this.resolveIcon(item) : noExplorerIcon()
      if (icon.dataset.iconSignature !== resolvedIcon.signature) {
        icon.className = resolvedIcon.className
        icon.title = resolvedIcon.title
        icon.style.color = resolvedIcon.color
        icon.style.fontFamily = resolvedIcon.fontFamily
        icon.style.fontWeight = resolvedIcon.fontWeight
        icon.style.fontStyle = resolvedIcon.fontStyle
        icon.style.fontSize = resolvedIcon.fontSize
        renderThemeIcon(icon, resolvedIcon.themeIcon, resolvedIcon.themeSource, resolvedIcon.fontSize, resolvedIcon.fallbackGlyph)
        icon.dataset.iconSignature = resolvedIcon.signature
      }
      icon.dataset.fileIconThemeId = resolvedIcon.themeId
      icon.dataset.fileIconThemeService = "workbenchThemeService"
      icon.dataset.fileIconSource = resolvedIcon.themeSource || (resolvedIcon.fallbackGlyph ? "fallback" : "none")
      icon.dataset.fileIconId = resolvedIcon.themeIcon?.id || (resolvedIcon.fallbackGlyph ? "fallback-seti" : "")
    }

    const label = row.querySelector(".codek-explorer-label") as HTMLElement | null
    const input = row.querySelector(".codek-explorer-input") as HTMLInputElement | null
    if (editableData) {
      if (label) {
        label.textContent = ""
        label.style.display = "none"
      }
      if (input) this.renderInputBox(item, input, editableData)
    } else {
      if (label) {
        label.style.display = ""
        label.textContent = item.name
      }
      if (input) {
        input.style.display = "none"
        input.value = ""
        input.title = ""
        input.dataset.editableUri = ""
        input.dataset.finishCalled = ""
      }
    }

    const decoration = row.querySelector(".codek-explorer-decoration") as HTMLElement | null
    if (decoration) {
      const value = this.options.decorations?.[item.uri] || this.options.decorations?.[relativeKey(item.uri)]
      const labelText = typeof value === "string" ? value : value?.label || value?.status || ""
      decoration.textContent = item.loading ? "loading" : item.error ? "error" : labelText
      decoration.title = typeof value === "string" ? value : value?.tooltip || labelText
    }
  }

  private resolveIcon(item: ExplorerItem): ResolvedExplorerIcon {
    const theme = this.options.iconTheme || null
    const cacheKey = [
      theme?.themeId || "fallback",
      String(this.options.iconThemeVersion || 0),
      item.uri || item.name,
      item.isDirectory ? "dir" : "file",
      item.expanded ? "open" : "closed",
      item.isRoot ? "root" : "child",
      this.options.iconThemeId || "",
    ].join("\0")
    const cached = this.iconCache.get(cacheKey)
    if (cached) return cached

    if (item.isDirectory) return noExplorerIcon()

    const fallbackIcon = resolveFallbackFileIcon(item.name, item.isDirectory, item.expanded)
    const themeIcon = resolveFileIconThemeIcon(
      theme,
      item.uri || item.name,
      item.isDirectory,
      item.expanded,
      { isRoot: item.isRoot },
    )
    const visibleThemeIcon = !item.isDirectory && themeIcon === theme?.icons?.file ? null : themeIcon
    const themeSource = getVisibleFileIconThemeSource(theme, visibleThemeIcon)
    const themeRenderable = themeSource !== null
    const fallbackGlyphRenderable = !themeRenderable && Boolean(fallbackIcon.glyph)
    const hasRenderableIcon = themeRenderable || fallbackGlyphRenderable
    const className = [
      "codek-explorer-icon",
      item.isDirectory ? "folder" : "file",
      item.expanded ? "open" : "",
      fallbackIcon.className,
      hasRenderableIcon ? "" : "no-icon",
      themeRenderable ? "theme-icon" : "",
      themeRenderable ? "theme-icon-renderable" : "",
      themeRenderable ? `theme-icon-${cssToken(visibleThemeIcon?.id)}` : "",
      fallbackGlyphRenderable ? "fallback-seti-icon" : "",

    ].filter(Boolean).join(" ")
    const color = visibleThemeIcon?.fontColor || fallbackIcon.color
    const fontFamily = themeRenderable ? themeFontFamily(visibleThemeIcon) : fallbackIcon.fontFamily
    const fontWeight = themeRenderable ? themeFontWeight(theme, visibleThemeIcon) : "normal"
    const fontStyle = themeRenderable ? themeFontStyle(theme, visibleThemeIcon) : "normal"
    const fontSize = themeRenderable ? getFileIconThemeFontSize(theme, visibleThemeIcon) : fallbackIcon.fontSize
    const resolved = {
      className,
      title: item.isDirectory ? "folder" : "file",
      color,
      fontFamily,
      fontWeight,
      fontStyle,
      fontSize,
      themeIcon: visibleThemeIcon,
      themeSource,
      fallbackGlyph: fallbackGlyphRenderable ? fallbackIcon.glyph : "",
      themeId: this.options.iconThemeId || theme?.themeId || "fallback",
      signature: [
        className,
        color,
        fontFamily,
        fontWeight,
        fontStyle,
        fontSize,
        visibleThemeIcon?.iconPath || "",
        themeRenderable ? visibleThemeIcon?.fontCharacter || "" : "",
        themeSource || "",
        fallbackGlyphRenderable ? fallbackIcon.glyph : "",

      ].join("\0"),
    }
    this.iconCache.set(cacheKey, resolved)
    return resolved
  }

  private ensureTemplate(row: HTMLElement): void {
    if (row.dataset.explorerTemplateVersion === String(this.templateVersion) && row.querySelector(".codek-explorer-label")) return
    row.dataset.explorerTemplateVersion = String(this.templateVersion)
    row.innerHTML = [
      '<span class="codek-explorer-twistie" aria-hidden="true"></span>',
      '<span class="codek-explorer-icon" aria-hidden="true">',
      '<img class="codek-explorer-theme-image" alt="" draggable="false" />',
      '<span class="codek-explorer-theme-glyph"></span>',
      '<span class="codek-explorer-fallback-token"></span>',
      '</span>',
      '<span class="codek-explorer-label"></span>',
      '<input class="codek-explorer-input inline-create-input" data-codek-smoke="explorer-inline-create-input" type="text" />',
      '<span class="codek-explorer-decoration"></span>',
    ].join("")
  }

  private renderInputBox(item: ExplorerItem, input: HTMLInputElement, editableData: NonNullable<ExplorerItem["editable"]>): void {
    const editableUri = `${item.uri}\0${editableData.kind}`
    input.style.display = ""
    input.dataset.editableUri = editableUri
    input.dataset.finishCalled = ""
    input.title = item.parent?.uri || item.uri
    input.placeholder = editableData.placeholder || ""
    if (input.value !== editableData.value) input.value = editableData.value
    const finish = (success: boolean) => {
      if (input.dataset.finishCalled === "true") return
      const message = getEditableValidationMessage(editableData, input.value)
      if (success && message?.severity === "error") {
        input.setAttribute("aria-invalid", "true")
        input.title = message.content
        input.focus({ preventScroll: true })
        return
      }
      input.dataset.finishCalled = "true"
      input.setAttribute("aria-invalid", "false")
      void editableData.onFinish?.(input.value, success)
    }
    input.onpointerdown = (event) => {
      event.stopPropagation()
      input.focus({ preventScroll: true })
    }
    input.onclick = (event) => event.stopPropagation()
    input.onkeydown = (event) => {
      event.stopPropagation()
      if (event.key === "Enter") {
        event.preventDefault()
        finish(true)
      } else if (event.key === "Escape") {
        event.preventDefault()
        finish(false)
      }
    }
    input.oninput = () => {
      const message = getEditableValidationMessage(editableData, input.value)
      input.setAttribute("aria-invalid", message?.severity === "error" ? "true" : "false")
      input.title = message?.content || item.parent?.uri || item.uri
    }
    input.onblur = () => {
      const value = input.value
      if (!value.trim()) {
        queueMicrotask(() => {
          if (item.editable && input.dataset.finishCalled !== "true") input.focus({ preventScroll: true })
        })
        return
      }
      finish(Boolean(value.trim()))
    }
    queueMicrotask(() => {
      if (!item.editable || input.dataset.editableUri !== editableUri) return
      input.focus({ preventScroll: true })
      const lastDot = input.value.lastIndexOf(".")
      const end = lastDot > 0 && !item.isDirectory ? lastDot : input.value.length
      input.setSelectionRange(0, end)
    })
  }
}

export function explorerRowDomId(item: Pick<ExplorerItem, "id" | "uri">): string {
  return `codek-explorer-row-${cssToken(item.id || item.uri)}`
}

type ResolvedExplorerIcon = {
  className: string
  title: string
  color: string
  fontFamily: string
  fontWeight: string
  fontStyle: string
  fontSize: string
  themeIcon: ReturnType<typeof resolveFileIconThemeIcon>
  themeSource: ReturnType<typeof getVisibleFileIconThemeSource>
  fallbackGlyph: string
  themeId: string
  signature: string
}

function noExplorerIcon(): ResolvedExplorerIcon {
  return {
    className: "codek-explorer-icon no-icon",
    title: "",
    color: "",
    fontFamily: "",
    fontWeight: "normal",
    fontStyle: "normal",
    fontSize: "",
    themeIcon: null,
    themeSource: null,
    fallbackGlyph: "",
    themeId: "none",
    signature: "no-icon",
  }
}

function renderThemeIcon(container: HTMLElement, icon: ReturnType<typeof resolveFileIconThemeIcon>, renderable: ReturnType<typeof getVisibleFileIconThemeSource>, fontSize = "", fallbackGlyph = ""): void {
  const image = container.querySelector(".codek-explorer-theme-image") as HTMLImageElement | null
  const glyph = container.querySelector(".codek-explorer-theme-glyph") as HTMLElement | null
  const token = container.querySelector(".codek-explorer-fallback-token") as HTMLElement | null
  if (image) {
    const src = renderable === "image" ? normalizeThemeIconSrc(icon?.iconPath) : ""
    image.src = src
    image.style.display = src ? "block" : "none"
  }
  if (glyph) {
    const value = renderable === "glyph" && icon?.fontCharacter ? decodeFontCharacter(icon.fontCharacter) : fallbackGlyph
    glyph.textContent = value
    glyph.style.display = value ? "inline-flex" : "none"
    glyph.style.fontSize = value ? (fontSize || "16px") : ""
  }
  if (token) {
    token.textContent = ""
    token.style.display = "none"
  }
}

function normalizeThemeIconSrc(src: string | undefined): string {
  if (!src) return ""
  if (src.startsWith("codek-extension-resource://")) return src
  if (src.startsWith("data:image/")) return src
  if (/^https?:\/\//i.test(src)) return src
  return ""
}

function decodeFontCharacter(value: string): string {
  if (!value) return ""
  if (!value.startsWith("\\")) return value
  const codePoint = Number.parseInt(value.replace(/^\\[uU]?/, ""), 16)
  return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ""
}

function themeFontWeight(theme: LoadedFileIconTheme | null, icon: ReturnType<typeof resolveFileIconThemeIcon>): string {
  const font = findThemeFont(theme, icon)
  return font?.weight || "normal"
}

function themeFontStyle(theme: LoadedFileIconTheme | null, icon: ReturnType<typeof resolveFileIconThemeIcon>): string {
  const font = findThemeFont(theme, icon)
  return font?.style || "normal"
}

function themeFontFamily(icon: ReturnType<typeof resolveFileIconThemeIcon>): string {
  const family = icon?.fontFamily || icon?.fontId || ""
  return family ? `${family}, codicon, ui-monospace, monospace` : "codicon, ui-monospace, monospace"
}

function findThemeFont(theme: LoadedFileIconTheme | null, icon: ReturnType<typeof resolveFileIconThemeIcon>) {
  const fontId = icon?.fontId || icon?.fontFamily || ""
  return theme?.icons?.fonts?.find((font) => font.id === fontId) || null
}

function relativeKey(uri: string): string {
  return String(uri || "").replace(/\\/g, "/").split("/").slice(-3).join("/")
}

function cssToken(value: string | undefined): string {
  return String(value || "file").replace(/^_+/, "").replace(/[^a-z0-9_-]/gi, "-").toLowerCase() || "file"
}

function getEditableValidationMessage(editableData: NonNullable<ExplorerItem["editable"]>, value: string) {
  const result = editableData.validationMessage?.(value)
  if (!result) return null
  if (typeof result === "string") return { content: result, severity: "error" as const }
  return {
    content: result.content,
    severity: result.severity || "error",
  }
}
