import { editorLanguageFeatureService } from "../../editor/editorLanguageFeatureService"
import { combineDisposables, type DisposableLike } from "../disposable"

type Monaco = typeof import("monaco-editor")

interface HtmlElement {
  tag: string
  id: string
  classes: string[]
  attributes: Array<{ name: string; value: string }>
  children: HtmlElement[]
  text: string
  repeatCount: number
  selfClosing: boolean
}

const SELF_CLOSING_TAGS = new Set([
  "br", "hr", "img", "input", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr",
])

const CSS_PROPERTY_MAP: Readonly<Record<string, string>> = {
  m: "margin",
  mt: "margin-top",
  mr: "margin-right",
  mb: "margin-bottom",
  ml: "margin-left",
  p: "padding",
  pt: "padding-top",
  pr: "padding-right",
  pb: "padding-bottom",
  pl: "padding-left",
  w: "width",
  h: "height",
  bg: "background",
  bgc: "background-color",
  c: "color",
  fs: "font-size",
  fw: "font-weight",
  ff: "font-family",
  fz: "font-size",
  lh: "line-height",
  ta: "text-align",
  td: "text-decoration",
  tt: "text-transform",
  ls: "letter-spacing",
  ws: "word-spacing",
  d: "display",
  pos: "position",
  t: "top",
  r: "right",
  b: "bottom",
  l: "left",
  z: "z-index",
  fl: "float",
  cl: "clear",
  ov: "overflow",
  cur: "cursor",
  bd: "border",
  bdr: "border-radius",
  bdc: "border-color",
  bdw: "border-width",
  bds: "border-style",
  op: "opacity",
  vis: "visibility",
  bxz: "box-sizing",
  bxsh: "box-shadow",
  lsty: "list-style",
  lsp: "list-style-position",
  lst: "list-style-type",
  cnt: "content",
  tbl: "table-layout",
  bdcl: "border-collapse",
  bdsp: "border-spacing",
  va: "vertical-align",
  ofx: "overflow-x",
  ofy: "overflow-y",
  wb: "word-break",
  ww: "word-wrap",
  to: "text-overflow",
  us: "user-select",
  pe: "pointer-events",
  tr: "transition",
  tf: "transform",
  ani: "animation",
  jc: "justify-content",
  ai: "align-items",
  ac: "align-content",
  as: "align-self",
  fx: "flex",
  fxd: "flex-direction",
  fxw: "flex-wrap",
  fxb: "flex-basis",
  fxg: "flex-grow",
  fxs: "flex-shrink",
  ord: "order",
  gp: "gap",
}

function parseHtmlAbbreviation(abbr: string): HtmlElement | null {
  let pos = 0

  function peek(): string {
    return pos < abbr.length ? abbr[pos] : ""
  }

  function advance(): string {
    return abbr[pos++]
  }

  function parseElement(): HtmlElement {
    const elem: HtmlElement = {
      tag: "div",
      id: "",
      classes: [],
      attributes: [],
      children: [],
      text: "",
      repeatCount: 1,
      selfClosing: false,
    }

    elem.tag = parseTagName()
    if (SELF_CLOSING_TAGS.has(elem.tag)) {
      elem.selfClosing = true
    }

    while (pos < abbr.length) {
      const ch = peek()
      if (ch === "#") {
        advance()
        elem.id = parseIdentifier()
      } else if (ch === ".") {
        advance()
        elem.classes.push(parseIdentifier())
      } else if (ch === "[") {
        advance()
        parseAttributes(elem)
      } else if (ch === "{") {
        advance()
        elem.text = parseTextContent()
      } else if (ch === "*") {
        advance()
        elem.repeatCount = parseNumber()
      } else if (ch === ">") {
        advance()
        elem.children.push(parseElement())
      } else if (ch === "+") {
        advance()
        break
      } else if (ch === "^") {
        advance()
        break
      } else {
        break
      }
    }

    return elem
  }

  function parseTagName(): string {
    let name = ""
    while (pos < abbr.length && /[a-zA-Z0-9-]/.test(peek())) {
      name += advance()
    }
    return name || "div"
  }

  function parseIdentifier(): string {
    let id = ""
    while (pos < abbr.length && /[a-zA-Z0-9-_]/.test(peek())) {
      id += advance()
    }
    return id
  }

  function parseAttributes(elem: HtmlElement): void {
    while (pos < abbr.length && peek() !== "]") {
      const name = parseAttrName()
      if (peek() === "=") {
        advance()
        const value = parseAttrValue()
        elem.attributes.push({ name, value })
      } else {
        elem.attributes.push({ name, value: "" })
      }
      if (peek() === " ") advance()
    }
    if (peek() === "]") advance()
  }

  function parseAttrName(): string {
    let name = ""
    while (pos < abbr.length && /[a-zA-Z0-9-_@:.]/.test(peek())) {
      name += advance()
    }
    return name
  }

  function parseAttrValue(): string {
    if (peek() === '"' || peek() === "'") {
      const quote = advance()
      let value = ""
      while (pos < abbr.length && peek() !== quote) {
        value += advance()
      }
      if (peek() === quote) advance()
      return value
    }
    let value = ""
    while (pos < abbr.length && /[a-zA-Z0-9-_/.#?&=%]/.test(peek())) {
      value += advance()
    }
    return value
  }

  function parseTextContent(): string {
    let text = ""
    let depth = 1
    while (pos < abbr.length && depth > 0) {
      const ch = peek()
      if (ch === "{") {
        depth++
        text += advance()
      } else if (ch === "}") {
        depth--
        if (depth === 0) {
          advance()
          break
        }
        text += advance()
      } else {
        text += advance()
      }
    }
    return text
  }

  function parseNumber(): number {
    let num = ""
    while (pos < abbr.length && /\d/.test(peek())) {
      num += advance()
    }
    return num ? parseInt(num, 10) : 1
  }

  const result = parseElement()

  const siblings: HtmlElement[] = [result]
  while (pos < abbr.length && peek() === "+") {
    advance()
    siblings.push(parseElement())
  }

  if (siblings.length > 1) {
    const wrapper: HtmlElement = {
      tag: "",
      id: "",
      classes: [],
      attributes: [],
      children: siblings,
      text: "",
      repeatCount: 1,
      selfClosing: false,
    }
    return wrapper
  }

  return result
}

function renderHtmlElement(elem: HtmlElement, indent: number, index: number): string {
  const pad = "  ".repeat(indent)
  const lines: string[] = []

  for (let i = 0; i < elem.repeatCount; i++) {
    const itemIndex = index + i
    const tag = elem.tag
    if (!tag) {
      for (const child of elem.children) {
        lines.push(renderHtmlElement(child, indent, itemIndex))
      }
      continue
    }

    let openTag = `<${tag}`
    if (elem.id) openTag += ` id="${elem.id}"`
    if (elem.classes.length > 0) openTag += ` class="${elem.classes.join(" ")}"`
    for (const attr of elem.attributes) {
      if (attr.value) {
        openTag += ` ${attr.name}="${attr.value}"`
      } else {
        openTag += ` ${attr.name}`
      }
    }
    openTag += ">"

    if (elem.selfClosing) {
      lines.push(`${pad}${openTag}`)
      continue
    }

    if (elem.text || elem.children.length === 0) {
      const content = elem.text.replace(/\$#/g, String(itemIndex + 1))
      lines.push(`${pad}${openTag}${content}</${tag}>`)
    } else if (elem.children.length > 0) {
      lines.push(`${pad}${openTag}`)
      let childIndex = 0
      for (const child of elem.children) {
        lines.push(renderHtmlElement(child, indent + 1, childIndex))
        childIndex += child.repeatCount
      }
      lines.push(`${pad}</${tag}>`)
    } else {
      lines.push(`${pad}${openTag}</${tag}>`)
    }
  }

  return lines.join("\n")
}

function expandHtmlAbbreviation(abbr: string): string {
  const elem = parseHtmlAbbreviation(abbr)
  if (!elem) return abbr
  return renderHtmlElement(elem, 0, 0)
}

function expandCssAbbreviation(abbr: string): string {
  const multiMatch = abbr.match(/^([a-z]+)([\dx\s]+)$/i)
  if (multiMatch) {
    const prop = CSS_PROPERTY_MAP[multiMatch[1]]
    if (!prop) return abbr
    const values = multiMatch[2].trim().split(/\s+/)
    const cssValues = values.map((v) => {
      if (/^\d+$/.test(v)) return v + "px"
      if (/^\d+x\d+$/.test(v)) return v.replace("x", "px ") + "px"
      return v
    })
    return `${prop}: ${cssValues.join(" ")};`
  }

  const importantMatch = abbr.match(/^([a-z]+)([\d.]+[a-z%]*)!$/i)
  if (importantMatch) {
    const prop = CSS_PROPERTY_MAP[importantMatch[1]]
    if (!prop) return abbr
    const value = importantMatch[2]
    return `${prop}: ${/^\d+$/.test(value) ? value + "px" : value} !important;`
  }

  const simpleMatch = abbr.match(/^([a-z]+)([\d.]+[a-z%]*)?$/i)
  if (simpleMatch) {
    const prop = CSS_PROPERTY_MAP[simpleMatch[1]]
    if (!prop) return abbr
    const value = simpleMatch[2]
    if (!value) return `${prop}: ;`
    return `${prop}: ${/^\d+$/.test(value) ? value + "px" : value};`
  }

  const colorMatch = abbr.match(/^c#([0-9a-f]{3,8})$/i)
  if (colorMatch) {
    return `color: #${colorMatch[1]};`
  }

  return abbr
}

export interface EmmetConfig {
  includeLanguages: Record<string, string>
  excludeLanguages: string[]
  showExpandedAbbreviation: "always" | "never"
  preferences: Record<string, unknown>
}

export function normalizeEmmetConfig(config: Partial<EmmetConfig> = {}): EmmetConfig {
  return {
    includeLanguages: { ...(config.includeLanguages || {}) },
    excludeLanguages: [...(config.excludeLanguages || [])],
    showExpandedAbbreviation: config.showExpandedAbbreviation || "always",
    preferences: { ...(config.preferences || {}) },
  }
}

function resolveEmmetSyntax(languageId: string, config: EmmetConfig): string {
  return config.includeLanguages[languageId] || languageId
}

export function isEmmetLanguageEnabled(languageId: string, config: EmmetConfig = normalizeEmmetConfig()): boolean {
  if (config.excludeLanguages.includes(languageId)) return false
  const syntax = resolveEmmetSyntax(languageId, config)
  return ["html", "css", "scss", "less", "xml", "vue"].includes(syntax)
}

export function expandAbbreviation(abbreviation: string, languageId: string, config: EmmetConfig = normalizeEmmetConfig()): string {
  const trimmed = abbreviation.trim()
  if (!trimmed) return ""
  if (!isEmmetLanguageEnabled(languageId, config) || config.showExpandedAbbreviation === "never") return trimmed

  const syntax = resolveEmmetSyntax(languageId, config)
  if (syntax === "css" || syntax === "scss" || syntax === "less") {
    return expandCssAbbreviation(trimmed)
  }

  return expandHtmlAbbreviation(trimmed)
}

function isEmmetTrigger(line: string, languageId: string): boolean {
  if (languageId === "css" || languageId === "scss" || languageId === "less") {
    return /^[a-z]+\d*$/i.test(line.trim())
  }
  const pattern = /^[a-zA-Z][a-zA-Z0-9\-_.#*[\]>{+^]*$/
  return pattern.test(line.trim())
}

export function registerEmmetProvider(monaco: Monaco): DisposableLike {
  const EMMET_LANGUAGES = ["html", "css", "scss", "less", "xml", "vue"]
  const disposables: DisposableLike[] = []

  for (const languageId of EMMET_LANGUAGES) {
    disposables.push(editorLanguageFeatureService.registerCompletionItemProvider(languageId, {
      triggerCharacters: [".", "#", ">", "*", "+", "["],
      provideCompletionItems(model, position) {
        const lineUntilCursor = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        })

        const trimmed = lineUntilCursor.trim()
        if (!trimmed || !isEmmetTrigger(trimmed, languageId)) {
          return { suggestions: [] }
        }

        const expanded = expandAbbreviation(trimmed, languageId)
        if (expanded === trimmed) return { suggestions: [] }

        const startColumn = lineUntilCursor.indexOf(trimmed) + 1

        return {
          suggestions: [{
            label: trimmed,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: expanded,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: "Emmet",
            documentation: expanded,
            sortText: "00",
            filterText: trimmed,
            range: {
              startLineNumber: position.lineNumber,
              startColumn,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            },
          }],
        }
      },
    }, monaco, {
      id: `emmet-completion:${languageId}`,
      source: "emmet",
    }))
  }
  return combineDisposables(...disposables)
}
