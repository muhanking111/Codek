export interface PluginContributes {
  languages?: PluginLanguageContribution[]
  snippets?: Record<string, PluginSnippet[]>
  commands?: PluginCommand[]
  keybindings?: PluginKeybinding[]
  menus?: PluginMenu[]
  configuration?: Record<string, PluginConfigProperty>
  themes?: PluginTheme[]
}

export interface PluginLanguageContribution {
  id: string
  aliases: string[]
  extensions: string[]
  filenamePatterns?: string[]
  mimetypes?: string[]
}

export interface PluginCommand {
  id: string
  title: string
  category?: string
  when?: string
}

export interface PluginKeybinding {
  command: string
  key: string
  mac?: string
  when?: string
}

export interface PluginMenu {
  id: string
  command: string
  group?: string
  when?: string
}

export interface PluginConfigProperty {
  type: "string" | "number" | "boolean" | "array" | "object"
  default: unknown
  description: string
  enum?: string[]
  minimum?: number
  maximum?: number
}

export interface PluginTheme {
  id: string
  label: string
  uiTheme: "vs" | "vs-dark" | "hc-black" | "hc-light"
  path: string
}

export interface PluginSnippet {
  label: string
  insertText: string
  detail: string
  language?: string
}

export interface PluginEngineMethod {
  name: string
  params: string
  returnType: string
  returnClass?: string
  detail: string
  since?: string
  postfix?: string
}

export interface PluginEngineField {
  name: string
  type: string
  detail: string
  since?: string
}

export interface PluginEngineClass {
  name: string
  detail: string
  since?: string
  implements?: string[]
  staticFields?: PluginEngineField[]
  methods?: PluginEngineMethod[]
}

export interface PluginPostfixTemplate {
  key: string
  label: string
  description: string
  applicable?: string[]
  snippet: string
}

export interface PluginEngineTopLevel {
  label: string
  insertText: string
  detail: string
  kind: "keyword" | "class" | "method" | "field" | "snippet" | "property" | "interface" | "enum" | "variable" | "type" | "module"
  since?: string
}

export interface PluginEngineConfig {
  keywords?: string[]
  types?: string[]
  topLevels?: PluginEngineTopLevel[]
  imports?: PluginEngineTopLevel[]
  classes?: Record<string, PluginEngineClass>
  postfixTemplates?: PluginPostfixTemplate[]
  symbols?: string[]
}

export interface PluginManifest {
  id: string
  name: string
  displayName: string
  version: string
  publisher: string
  description: string
  icon: string
  iconPath?: string
  license: string
  homepage?: string
  repository?: string
  bugs?: string
  keywords: string[]
  categories: ("languages" | "snippets" | "linters" | "themes" | "formatters" | "debuggers" | "frameworks" | "tools" | "other")[]
  language?: string
  languages?: string[]
  jdkVersionMin?: string
  engines: {
    codek: string
  }
  activationEvents: string[]
  extensionDependencies: string[]
  contributes: PluginContributes
  engineConfig: PluginEngineConfig
  snippets: PluginSnippet[]
  main?: string
  preview: boolean
  size: number
}

export interface InstalledPlugin {
  manifest: PluginManifest
  installedAt: number
  updatedAt: number
  installPath: string
  installSource: "marketplace" | "local" | "builtin"
  enabled: boolean
  pinned: boolean
}

export interface MarketplaceEntry {
  id: string
  name: string
  displayName: string
  version: string
  publisher: string
  description: string
  icon: string
  keywords: string[]
  categories: PluginManifest["categories"]
  language?: string
  languages?: string[]
  jdkVersionMin?: string
  rating: number
  ratingCount: number
  downloads: number
  trendingDaily: number
  size: number
  sizeLabel: string
  updatedAt: string
  preview: boolean
  verified: boolean
  downloadUrl: string
  repository?: string
  license: string
}

export interface MarketplaceFilter {
  search?: string
  category?: string
  language?: string
  sortBy: "relevance" | "downloads" | "rating" | "trending" | "updated"
  sortOrder: "asc" | "desc"
}

export type PluginEventType = "install" | "uninstall" | "enable" | "disable" | "update" | "error"

export interface PluginEvent {
  type: PluginEventType
  pluginId: string
  timestamp: number
  error?: string
}

export type PluginEventListener = (event: PluginEvent) => void