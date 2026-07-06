type AnsiColorClass =
  | "ansi-black"
  | "ansi-red"
  | "ansi-green"
  | "ansi-yellow"
  | "ansi-blue"
  | "ansi-magenta"
  | "ansi-cyan"
  | "ansi-white"
  | "ansi-bright-black"
  | "ansi-bright-red"
  | "ansi-bright-green"
  | "ansi-bright-yellow"
  | "ansi-bright-blue"
  | "ansi-bright-magenta"
  | "ansi-bright-cyan"
  | "ansi-bright-white"

type AnsiBgClass =
  | "ansi-bg-black"
  | "ansi-bg-red"
  | "ansi-bg-green"
  | "ansi-bg-yellow"
  | "ansi-bg-blue"
  | "ansi-bg-magenta"
  | "ansi-bg-cyan"
  | "ansi-bg-white"
  | "ansi-bg-bright-black"
  | "ansi-bg-bright-red"
  | "ansi-bg-bright-green"
  | "ansi-bg-bright-yellow"
  | "ansi-bg-bright-blue"
  | "ansi-bg-bright-magenta"
  | "ansi-bg-bright-cyan"
  | "ansi-bg-bright-white"

interface AnsiSegment {
  text: string
  fgClass: AnsiColorClass | null
  bgClass: AnsiBgClass | null
  bold: boolean
  underline: boolean
}

const ANSI_FG_MAP: Record<number, AnsiColorClass> = {
  30: "ansi-black",
  31: "ansi-red",
  32: "ansi-green",
  33: "ansi-yellow",
  34: "ansi-blue",
  35: "ansi-magenta",
  36: "ansi-cyan",
  37: "ansi-white",
  90: "ansi-bright-black",
  91: "ansi-bright-red",
  92: "ansi-bright-green",
  93: "ansi-bright-yellow",
  94: "ansi-bright-blue",
  95: "ansi-bright-magenta",
  96: "ansi-bright-cyan",
  97: "ansi-bright-white",
}

const ANSI_BG_MAP: Record<number, AnsiBgClass> = {
  40: "ansi-bg-black",
  41: "ansi-bg-red",
  42: "ansi-bg-green",
  43: "ansi-bg-yellow",
  44: "ansi-bg-blue",
  45: "ansi-bg-magenta",
  46: "ansi-bg-cyan",
  47: "ansi-bg-white",
  100: "ansi-bg-bright-black",
  101: "ansi-bg-bright-red",
  102: "ansi-bg-bright-green",
  103: "ansi-bg-bright-yellow",
  104: "ansi-bg-bright-blue",
  105: "ansi-bg-bright-magenta",
  106: "ansi-bg-bright-cyan",
  107: "ansi-bg-bright-white",
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\u001b\[([0-9;]*)m/g

export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  let currentFg: AnsiColorClass | null = null
  let currentBg: AnsiBgClass | null = null
  let isBold = false
  let isUnderline = false
  let lastIndex = 0
  let currentText = ""

  const flushText = () => {
    if (currentText.length === 0) return
    segments.push({
      text: currentText,
      fgClass: currentFg,
      bgClass: currentBg,
      bold: isBold,
      underline: isUnderline,
    })
    currentText = ""
  }

  let match: RegExpExecArray | null
  while ((match = ANSI_ESCAPE_RE.exec(input)) !== null) {
    const beforeText = input.slice(lastIndex, match.index)
    currentText += beforeText

    const codes = match[1].split(";").map(Number)

    for (const code of codes) {
      if (code === 0) {
        flushText()
        currentFg = null
        currentBg = null
        isBold = false
        isUnderline = false
      } else if (code === 1) {
        isBold = true
      } else if (code === 4) {
        isUnderline = true
      } else if (code === 22) {
        isBold = false
      } else if (code === 24) {
        isUnderline = false
      } else if (ANSI_FG_MAP[code]) {
        flushText()
        currentFg = ANSI_FG_MAP[code]
      } else if (ANSI_BG_MAP[code]) {
        flushText()
        currentBg = ANSI_BG_MAP[code]
      } else if (code === 39) {
        flushText()
        currentFg = null
      } else if (code === 49) {
        flushText()
        currentBg = null
      }
    }

    lastIndex = ANSI_ESCAPE_RE.lastIndex
  }

  currentText += input.slice(lastIndex)
  flushText()

  return segments
}

export function ansiToHtml(input: string): string {
  const segments = parseAnsi(input)

  return segments
    .map((seg) => {
      const classes: string[] = []
      if (seg.fgClass) classes.push(seg.fgClass)
      if (seg.bgClass) classes.push(seg.bgClass)
      if (seg.bold) classes.push("ansi-bold")
      if (seg.underline) classes.push("ansi-underline")

      const escaped = seg.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")

      if (classes.length === 0) return escaped
      return `<span class="${classes.join(" ")}">${escaped}</span>`
    })
    .join("")
}

export function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_RE, "")
}
