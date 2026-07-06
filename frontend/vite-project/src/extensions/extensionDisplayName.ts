import type { VsixMetadata } from "./ehClient"

type ExtensionVisibleTextInput = Partial<Pick<VsixMetadata, "id" | "displayName" | "publisher" | "description" | "categories" | "builtin" | "installed">>

const KNOWN_EXTENSION_DISPLAY_NAMES: Record<string, string> = {
  "Configuration Editing": "配置文件编辑",
  "Docker Language Basics": "Docker 语言基础",
  "GitHub Authentication": "GitHub 认证",
  "GitHub Pull Requests and Issues": "GitHub 拉取请求与议题",
  "Grunt support for VS Code": "Grunt 支持",
  "Gulp support for VS Code": "Gulp 支持",
  "Image preview": "图片预览",
  "JSON Language Features": "JSON 语言功能",
  "Makefile Tools": "Makefile 工具",
  "Markdown Language Features": "Markdown 语言功能",
  "Markdown Preview Github Styling": "Markdown 预览 GitHub 样式",
  "Merge Conflict": "合并冲突处理",
  "Microsoft Authentication": "Microsoft 认证",
  "Node Debug Auto-attach": "Node 调试自动附加",
  "Node Debug": "Node 调试",
  "NPM support for VS Code": "NPM 支持",
  "PHP Language Features": "PHP 语言功能",
  "Reference Search View": "引用搜索视图",
  "Search Result": "搜索结果",
  "Simple Browser": "简易浏览器",
  "TypeScript and JavaScript Language Features": "TypeScript 与 JavaScript 语言功能",
}

const LANGUAGE_NAME_MAP: Record<string, string> = {
  "Bat": "Bat",
  "C#": "C#",
  "C/C++": "C/C++",
  "Clojure": "Clojure",
  "CoffeeScript": "CoffeeScript",
  "CSS": "CSS",
  "Dart": "Dart",
  "Diff": "Diff",
  "Docker": "Docker",
  "F#": "F#",
  "Git": "Git",
  "Go": "Go",
  "Groovy": "Groovy",
  "Handlebars": "Handlebars",
  "HLSL": "HLSL",
  "HTML": "HTML",
  "Ini": "INI",
  "Java": "Java",
  "JavaScript": "JavaScript",
  "JSON": "JSON",
  "JSONC": "JSONC",
  "Julia": "Julia",
  "LaTeX": "LaTeX",
  "Less": "Less",
  "Log": "日志",
  "Lua": "Lua",
  "Makefile": "Makefile",
  "Markdown": "Markdown",
  "Objective-C": "Objective-C",
  "Perl": "Perl",
  "PHP": "PHP",
  "PowerShell": "PowerShell",
  "Properties": "Properties",
  "Pug": "Pug",
  "Python": "Python",
  "R": "R",
  "Razor": "Razor",
  "Ruby": "Ruby",
  "Rust": "Rust",
  "SCSS": "SCSS",
  "Search Result": "搜索结果",
  "ShaderLab": "ShaderLab",
  "Shell Script": "Shell 脚本",
  "SQL": "SQL",
  "Swift": "Swift",
  "TypeScript": "TypeScript",
  "VB": "VB",
  "Vue": "Vue",
  "Windows Bat": "Windows 批处理",
  "XML": "XML",
  "YAML": "YAML",
}

function normalizeDisplayName(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim()
}

function hasCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

function hasUserVisibleAssistantEnglish(value: string): boolean {
  return /\b(ai|gpt|llm|chat|assistant|copilot|cody|codeium|continue)\b/i.test(value)
}

function getSearchText(extension: ExtensionVisibleTextInput | null | undefined): string {
  return [
    extension?.displayName,
    extension?.description,
    extension?.id,
    extension?.publisher,
    ...(extension?.categories || []),
  ].map((value) => normalizeDisplayName(value)).filter(Boolean).join(" ")
}

function inferExtensionKind(extension: ExtensionVisibleTextInput | null | undefined): string {
  const text = getSearchText(extension)
  if (/\b(ai|gpt|llm|chat|assistant|copilot|cody|completion|codeium|continue)\b/i.test(text)) return "智能辅助扩展"
  if (/\b(python|java|javascript|typescript|go|rust|php|ruby|csharp|c#|language|syntax|lsp|intellisense)\b/i.test(text)) return "语言开发扩展"
  if (/\b(docker|container|kubernetes|devcontainer|remote|ssh|wsl)\b/i.test(text)) return "远程与环境扩展"
  if (/\b(git|github|gitlab|pull request|issue|review)\b/i.test(text)) return "代码协作扩展"
  if (/\b(test|jest|vitest|playwright|coverage)\b/i.test(text)) return "测试扩展"
  if (/\b(debug|debugger|breakpoint)\b/i.test(text)) return "调试扩展"
  if (/\b(format|formatter|lint|linter|eslint|prettier)\b/i.test(text)) return "格式化与检查扩展"
  if (/\b(sql|database|postgres|mysql|redis|mongo)\b/i.test(text)) return "数据库扩展"
  if (/\b(theme|icon|color|material|appearance)\b/i.test(text)) return "界面主题扩展"
  if (extension?.builtin) return "内置工作台扩展"
  if (extension?.installed) return "已安装扩展"
  return "扩展市场条目"
}

function localizeLanguageName(languageName: string): string {
  const normalized = normalizeDisplayName(languageName)
  return LANGUAGE_NAME_MAP[normalized] || normalized
}

export function localizeExtensionDisplayName(extension: ExtensionVisibleTextInput | null | undefined): string {
  const rawName = normalizeDisplayName(extension?.displayName)
    || normalizeDisplayName(extension?.id)
    || normalizeDisplayName(extension?.publisher)
  if (!rawName) return "未命名扩展"

  const exact = KNOWN_EXTENSION_DISPLAY_NAMES[rawName]
  if (exact) return exact

  const languageBasics = rawName.match(/^(.+?) Language Basics$/i)
  if (languageBasics?.[1]) return `${localizeLanguageName(languageBasics[1])} 语言基础`

  const languageFeatures = rawName.match(/^(.+?) Language Features$/i)
  if (languageFeatures?.[1]) return `${localizeLanguageName(languageFeatures[1])} 语言功能`

  if (!hasCjk(rawName) || hasUserVisibleAssistantEnglish(rawName)) return inferExtensionKind(extension)

  return rawName
}

export function localizeExtensionDescription(extension: ExtensionVisibleTextInput | null | undefined): string {
  const kind = inferExtensionKind(extension)
  if (extension?.builtin) {
    return "内置扩展，提供语言、配置或工作台能力，状态由 Codek 扩展宿主同步。"
  }
  if (extension?.installed) {
    return `已安装的${kind}，启用状态、激活结果和贡献点会在 Codek 扩展宿主中继续同步。`
  }
  if (kind === "智能辅助扩展") {
    return "来自扩展市场的智能辅助扩展。安装前会展示来源、版本、权限和贡献点，安装后同步启用与激活证据。"
  }
  if (kind === "扩展市场条目") {
    return "来自扩展市场的扩展条目。安装前会核对来源、版本、权限和贡献点，安装后在已安装列表中展示可用性。"
  }
  return `来自扩展市场的${kind}。安装前会核对来源、版本、权限和贡献点，安装后展示启用与激活证据。`
}

export function localizeExtensionReadmePreview(
  extension: ExtensionVisibleTextInput | null | undefined,
  readmeText: string,
): string {
  if (!normalizeDisplayName(readmeText)) return ""
  const kind = inferExtensionKind(extension)
  return `说明文档已读取。该条目属于${kind}，当前摘要保留安装计划、兼容性、贡献点和回滚证据，外部原文不直接显示在中文工作台中。`
}

export function getLocalizedExtensionIconText(extension: ExtensionVisibleTextInput | null | undefined): string {
  const label = localizeExtensionDisplayName(extension)
  const cjkChars = Array.from(label.replace(/\s+/g, "")).filter((char) => /[\u3400-\u9fff]/.test(char))
  if (cjkChars.length >= 2) return cjkChars.slice(0, 2).join("")
  if (cjkChars.length === 1) return cjkChars[0]

  const parts = label
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9#+]+/)
    .filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  const compact = (parts[0] || label).replace(/[^a-zA-Z0-9]/g, "")
  return (compact.slice(0, 2) || "扩").toUpperCase()
}
