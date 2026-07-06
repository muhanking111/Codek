/*---------------------------------------------------------------------------------------------
 * VS Code source adapter inspired by src/vs/workbench/browser/parts/editor/breadcrumbsModel.ts.
 * Codek keeps renderer-specific path and outline data, but renders them through one breadcrumb
 * element model instead of assembling labels and separators in App.vue.
 *--------------------------------------------------------------------------------------------*/

export interface BreadcrumbPathInput {
  readonly name?: string
  readonly kind?: string
  readonly line?: number
}

export interface BreadcrumbSymbolInput {
  readonly name?: string
  readonly kind?: string
  readonly icon?: string
  readonly range?: { readonly startLine?: number }
  readonly children?: readonly BreadcrumbSymbolInput[]
}

export interface BreadcrumbDisplayInput {
  readonly path?: readonly BreadcrumbPathInput[] | null
  readonly symbols?: readonly BreadcrumbSymbolInput[] | null
  readonly activeDropdown?: number | null
}

export interface BreadcrumbDisplayChild {
  readonly label: string
  readonly icon: string
  readonly kind: string
  readonly targetLine: number
}

export interface BreadcrumbDisplayElement {
  readonly id: string
  readonly type: "path" | "symbol"
  readonly label: string
  readonly icon: string
  readonly kind: string
  readonly targetLine: number
  readonly separator: "/" | "|" | ""
  readonly dropdownOpen: boolean
  readonly children: readonly BreadcrumbDisplayChild[]
}

export interface BreadcrumbDisplayModel {
  readonly visible: boolean
  readonly elements: readonly BreadcrumbDisplayElement[]
}

export function buildBreadcrumbDisplayModel(input: BreadcrumbDisplayInput = {}): BreadcrumbDisplayModel {
  const path = Array.isArray(input.path) ? input.path : []
  const symbols = Array.isArray(input.symbols) ? input.symbols : []
  const elements: BreadcrumbDisplayElement[] = []

  path.forEach((crumb, index) => {
    const label = String(crumb?.name || "")
    if (!label) return
    elements.push({
      id: `path-${index}-${label}`,
      type: "path",
      label,
      icon: String(crumb?.kind || ""),
      kind: String(crumb?.kind || ""),
      targetLine: toLine(crumb?.line),
      separator: index < path.length - 1 ? "/" : symbols.length > 0 ? "|" : "",
      dropdownOpen: false,
      children: [],
    })
  })

  symbols.forEach((symbol, index) => {
    const label = symbolLabel(symbol)
    if (!label) return
    const children = Array.isArray(symbol.children) ? symbol.children.map(toChild).filter(Boolean) as BreadcrumbDisplayChild[] : []
    elements.push({
      id: `symbol-${index}-${label}`,
      type: "symbol",
      label,
      icon: String(symbol?.icon || ""),
      kind: String(symbol?.kind || ""),
      targetLine: toLine(symbol?.range?.startLine),
      separator: index < symbols.length - 1 ? "/" : "",
      dropdownOpen: input.activeDropdown === index && children.length > 0,
      children,
    })
  })

  return {
    visible: elements.length > 0,
    elements,
  }
}

export function symbolLabel(symbol: Pick<BreadcrumbSymbolInput, "name" | "kind"> | null | undefined): string {
  const name = String(symbol?.name || "")
  if (!name) return ""
  const kind = String(symbol?.kind || "")
  return kind === "function" || kind === "method" ? `${name}()` : name
}

function toChild(symbol: BreadcrumbSymbolInput): BreadcrumbDisplayChild | null {
  const label = symbolLabel(symbol)
  if (!label) return null
  return {
    label,
    icon: String(symbol?.icon || ""),
    kind: String(symbol?.kind || ""),
    targetLine: toLine(symbol?.range?.startLine),
  }
}

function toLine(value: unknown): number {
  const line = Number(value || 1)
  return Number.isFinite(line) && line > 0 ? Math.floor(line) : 1
}
