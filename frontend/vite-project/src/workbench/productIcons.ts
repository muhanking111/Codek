export interface ProductIcon {
  id: string
  codicon: string
  fallback: string
  label: string
  paths: readonly string[]
  fontCharacter?: string
}

export interface ProductIconContribution {
  readonly id: string
  readonly description?: string
  readonly defaults: { readonly fontCharacter: string } | { readonly id: string }
}

export interface ProductIconDefinition {
  readonly fontCharacter: string
}

export interface ProductIconRegistration extends Partial<ProductIcon> {
  codicon: string
  fontCharacter?: string
}

export interface Disposable {
  dispose(): void
}

const PRODUCT_ICONS: Record<string, ProductIcon> = {
  files: { id: "files", codicon: "codicon-files", fallback: "files", label: "资源管理器", paths: ["M3.5 6.5h5l2 2h10v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z", "M3.5 8.5h17"] },
  search: { id: "search", codicon: "codicon-search", fallback: "search", label: "搜索", paths: ["M10.8 17a6.2 6.2 0 1 1 0-12.4 6.2 6.2 0 0 1 0 12.4z", "M15.2 15.2 20 20"] },
  "source-control": { id: "source-control", codicon: "codicon-source-control", fallback: "source-control", label: "源代码管理", paths: ["M8 6.5a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 8 6.5z", "M18.5 8a2.5 2.5 0 1 1-2.5 2.5A2.5 2.5 0 0 1 18.5 8z", "M8 17.5a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 8 17.5z", "M8 6.5h3.5a4.5 4.5 0 0 1 4.5 4.5", "M8 17.5h3.5a4.5 4.5 0 0 0 4.5-4.5v-2"] },
  debug: { id: "debug", codicon: "codicon-debug-alt", fallback: "debug", label: "运行和调试", paths: ["M8 5h8l2 3v5a6 6 0 0 1-12 0V8z", "M12 2v3", "M4 10h3", "M17 10h3", "M7 18l-2 2", "M17 18l2 2"] },
  extensions: { id: "extensions", codicon: "codicon-extensions", fallback: "extensions", label: "扩展", paths: ["M9 3h3a2 2 0 1 0 4 0h3v6h-3a2 2 0 1 1 0 4h3v6h-6v-3a2 2 0 1 0-4 0v3H3v-6h3a2 2 0 1 0 0-4H3V3h6z"] },
  symbols: { id: "symbols", codicon: "codicon-symbol-class", fallback: "symbols", label: "符号", paths: ["M8 4c-2 0-3 1-3 3v2c0 1-.5 2-1.5 2.5C4.5 12 5 13 5 14v3c0 2 1 3 3 3", "M16 4c2 0 3 1 3 3v2c0 1 .5 2 1.5 2.5C19.5 12 19 13 19 14v3c0 2-1 3-3 3", "M10 8h4", "M10 16h4"] },
  "assistant-panel": { id: "assistant-panel", codicon: "codicon-comment-discussion", fallback: "assistant-panel", label: "智能助手", paths: ["M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-6l-4 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M8 10h.01", "M12 10h.01", "M16 10h.01", "M17 2l.6 1.4L19 4l-1.4.6L17 6l-.6-1.4L15 4l1.4-.6z"] },
  agent: { id: "agent", codicon: "codicon-sparkle", fallback: "agent", label: "智能体", paths: ["M12 5V3", "M7 8h10a3 3 0 0 1 3 3v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-5a3 3 0 0 1 3-3z", "M9 13h.01", "M15 13h.01", "M9 17h6"] },
  "agent-evidence": { id: "agent-evidence", codicon: "codicon-timeline-view-icon", fallback: "agent-evidence", label: "智能体证据", paths: ["M9 4h6", "M8 4a2 2 0 0 0-2 2v14h12V6a2 2 0 0 0-2-2", "M9 12l2 2 4-4", "M9 17h6"] },
  automation: { id: "automation", codicon: "codicon-run-all", fallback: "automation", label: "自动化", paths: ["M6 6h4v4H6z", "M14 14h4v4h-4z", "M10 8h2a4 4 0 0 1 4 4v2", "M14 16h-2a4 4 0 0 1-4-4v-2"] },
  plug: { id: "plug", codicon: "codicon-plug", fallback: "plug", label: "MCP", paths: ["M9 3v5", "M15 3v5", "M7 8h10v3a5 5 0 0 1-10 0z", "M12 16v5", "M9 21h6"] },
  shield: { id: "shield", codicon: "codicon-shield", fallback: "shield", label: "信任与认证", paths: ["M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z", "M9.5 12.5l1.7 1.7 3.8-4", "M15.5 15.5l2.5 2.5"] },
  remote: { id: "remote", codicon: "codicon-remote", fallback: "remote", label: "远程", paths: ["M6 18h11a4 4 0 0 0 .5-8A6 6 0 0 0 6 8a5 5 0 0 0 0 10z", "M9 14h6", "M12 11v6"] },
  terminal: { id: "terminal", codicon: "codicon-terminal", fallback: "terminal", label: "终端", paths: ["M4 17l6-6-6-6", "M12 19h8"] },
  testing: { id: "testing", codicon: "codicon-beaker", fallback: "testing", label: "测试", paths: ["M9 3h6", "M10 3v6l-4 8a3 3 0 0 0 2.7 4h6.6a3 3 0 0 0 2.7-4l-4-8V3"] },
  warning: { id: "warning", codicon: "codicon-warning", fallback: "warning", label: "问题", paths: ["M12 3l10 18H2z", "M12 9v4", "M12 17h.01"] },
  tasklist: { id: "tasklist", codicon: "codicon-list-tree", fallback: "tasklist", label: "任务", paths: ["M8 6h12", "M8 12h12", "M8 18h12", "M4 6h.01", "M4 12h.01", "M4 18h.01"] },
  output: { id: "output", codicon: "codicon-output", fallback: "output", label: "输出", paths: ["M4 5h16v14H4z", "M7 9l3 3-3 3", "M12 15h5"] },
  settings: { id: "settings", codicon: "codicon-settings-gear", fallback: "settings", label: "设置", paths: ["M4 6h16", "M4 12h16", "M4 18h16", "M8 4v4", "M14 10v4", "M18 16v4"] },
  refresh: { id: "refresh", codicon: "codicon-refresh", fallback: "refresh", label: "刷新", paths: ["M21 12a9 9 0 0 1-15.5 6.2", "M3 12A9 9 0 0 1 18.5 5.8", "M18.5 2.5v3.3h-3.3", "M5.5 21.5v-3.3h3.3"] },
  "new-file": { id: "new-file", codicon: "codicon-new-file", fallback: "new-file", label: "新建文件", paths: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M12 12v6", "M9 15h6"] },
  "new-folder": { id: "new-folder", codicon: "codicon-new-folder", fallback: "new-folder", label: "新建文件夹", paths: ["M3.5 6.5h5l2 2h10v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z", "M12 13v5", "M9.5 15.5h5"] },
  unknown: { id: "unknown", codicon: "codicon-window", fallback: "unknown", label: "视图", paths: ["M12 8v4", "M12 16h.01", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"] },
}

const productIcons = new Map<string, ProductIcon>(Object.entries(PRODUCT_ICONS))

export function registerProductIcon(id: string, icon: ProductIconRegistration): Disposable {
  const key = normalizeProductIconId(id)
  const previous = productIcons.get(key)
  productIcons.set(key, {
    id: key,
    codicon: icon.codicon,
    fallback: icon.fallback || key,
    label: icon.label || previous?.label || key,
    paths: icon.paths?.length ? [...icon.paths] : previous?.paths || PRODUCT_ICONS.unknown.paths,
    fontCharacter: icon.fontCharacter,
  })
  return {
    dispose() {
      if (previous) productIcons.set(key, previous)
      else productIcons.delete(key)
    },
  }
}

export function resolveProductIcon(id: string | undefined): ProductIcon {
  const key = normalizeProductIconId(id)
  return productIcons.get(key) || productIcons.get("unknown") || PRODUCT_ICONS.unknown
}

export function getProductIconClass(id: string | undefined): string {
  return resolveProductIcon(id).codicon
}

export function getProductIconPaths(id: string | undefined): readonly string[] {
  return resolveProductIcon(id).paths
}

export function resolveProductIconDefinition(contribution: ProductIconContribution): ProductIconDefinition | undefined {
  const themed = resolveProductIcon(contribution.id).fontCharacter
  if (themed) return { fontCharacter: themed }

  const defaults = contribution.defaults
  if ("fontCharacter" in defaults) {
    return defaults.fontCharacter ? { fontCharacter: defaults.fontCharacter } : undefined
  }
  return resolveProductIconDefinition({
    id: defaults.id,
    description: contribution.description,
    defaults: { fontCharacter: "" },
  })
}

export function getRegisteredProductIcons(): ProductIcon[] {
  return [...productIcons.values()]
}

function normalizeProductIconId(id: string | undefined): string {
  return String(id || "").trim()
}
