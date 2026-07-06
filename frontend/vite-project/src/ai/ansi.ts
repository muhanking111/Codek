/*---------------------------------------------------------------------------------------------
 *  Minimal ANSI SGR → HTML renderer for shell tool output.
 *
 *  Handles the subset shipped by common CLIs (ls --color, npm, git, jest, etc):
 *    - 30–37 / 90–97 fg, 40–47 / 100–107 bg
 *    - bold (1), dim (2), underline (4)
 *    - 38;5;N / 48;5;N 256-color
 *    - 38;2;R;G;B / 48;2;R;G;B truecolor
 *    - 0 / 22 / 24 / 39 / 49 resets
 *
 *  Always HTML-escapes input before injecting style spans, so output is safe
 *  to drop into `v-html`.
 *--------------------------------------------------------------------------------------------*/

const BASIC_FG: Record<number, string> = {
  30: "#000000", 31: "#cd3131", 32: "#0dbc79", 33: "#e5e510",
  34: "#2472c8", 35: "#bc3fbc", 36: "#11a8cd", 37: "#e5e5e5",
  90: "#666666", 91: "#f14c4c", 92: "#23d18b", 93: "#f5f543",
  94: "#3b8eea", 95: "#d670d6", 96: "#29b8db", 97: "#ffffff",
}
const BASIC_BG: Record<number, string> = {
  40: "#000000", 41: "#cd3131", 42: "#0dbc79", 43: "#e5e510",
  44: "#2472c8", 45: "#bc3fbc", 46: "#11a8cd", 47: "#e5e5e5",
  100: "#666666", 101: "#f14c4c", 102: "#23d18b", 103: "#f5f543",
  104: "#3b8eea", 105: "#d670d6", 106: "#29b8db", 107: "#ffffff",
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => {
    switch (c) {
      case "&": return "&amp;"
      case "<": return "&lt;"
      case ">": return "&gt;"
      case "\"": return "&quot;"
      default: return c
    }
  })
}

function color256(n: number): string | null {
  if (n < 0 || n > 255) return null
  if (n < 16) {
    const map = [30, 31, 32, 33, 34, 35, 36, 37, 90, 91, 92, 93, 94, 95, 96, 97]
    return BASIC_FG[map[n]] || null
  }
  if (n < 232) {
    const i = n - 16
    const r = Math.floor(i / 36)
    const g = Math.floor((i % 36) / 6)
    const b = i % 6
    const conv = (v: number) => (v === 0 ? 0 : 55 + v * 40)
    return `rgb(${conv(r)},${conv(g)},${conv(b)})`
  }
  const v = 8 + (n - 232) * 10
  return `rgb(${v},${v},${v})`
}

interface Style {
  fg: string | null
  bg: string | null
  bold: boolean
  dim: boolean
  underline: boolean
}

function emptyStyle(): Style {
  return { fg: null, bg: null, bold: false, dim: false, underline: false }
}

function styleToCss(s: Style): string {
  const parts: string[] = []
  if (s.fg) parts.push(`color:${s.fg}`)
  if (s.bg) parts.push(`background-color:${s.bg}`)
  if (s.bold) parts.push("font-weight:600")
  if (s.dim) parts.push("opacity:0.7")
  if (s.underline) parts.push("text-decoration:underline")
  return parts.join(";")
}

function styleEmpty(s: Style): boolean {
  return !s.fg && !s.bg && !s.bold && !s.dim && !s.underline
}

function applyCodes(codes: number[], style: Style): Style {
  const out = { ...style }
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]
    if (c === 0) {
      out.fg = null; out.bg = null
      out.bold = false; out.dim = false; out.underline = false
    } else if (c === 1) out.bold = true
    else if (c === 2) out.dim = true
    else if (c === 4) out.underline = true
    else if (c === 22) { out.bold = false; out.dim = false }
    else if (c === 24) out.underline = false
    else if (c === 39) out.fg = null
    else if (c === 49) out.bg = null
    else if (c in BASIC_FG) out.fg = BASIC_FG[c]
    else if (c in BASIC_BG) out.bg = BASIC_BG[c]
    else if (c === 38 || c === 48) {
      const mode = codes[i + 1]
      if (mode === 5) {
        const idx = codes[i + 2]
        const col = color256(idx)
        if (c === 38) out.fg = col; else out.bg = col
        i += 2
      } else if (mode === 2) {
        const r = codes[i + 2], g = codes[i + 3], b = codes[i + 4]
        const col = `rgb(${r},${g},${b})`
        if (c === 38) out.fg = col; else out.bg = col
        i += 4
      }
    }
  }
  return out
}

// eslint-disable-next-line no-control-regex
const SGR_RE = /\x1b\[([0-9;]*)m/g
// eslint-disable-next-line no-control-regex
const ANY_ESC_RE = /\x1b\[[0-9;?]*[A-Za-z]/g

export function ansiToHtml(input: string): string {
  if (!input) return ""
  // Strip non-SGR escape sequences (cursor moves, clear screen, etc).
  const cleaned = input.replace(ANY_ESC_RE, (m) => (m.endsWith("m") ? m : ""))
  let style = emptyStyle()
  let lastIndex = 0
  let out = ""
  let openSpan = false
  const flushText = (text: string) => {
    if (!text) return
    const esc = escapeHtml(text)
    if (styleEmpty(style)) {
      out += esc
      return
    }
    if (!openSpan) {
      out += `<span style="${styleToCss(style)}">`
      openSpan = true
    }
    out += esc
  }
  const closeIfOpen = () => {
    if (openSpan) {
      out += "</span>"
      openSpan = false
    }
  }

  for (const m of cleaned.matchAll(SGR_RE)) {
    const idx = m.index ?? 0
    if (idx > lastIndex) flushText(cleaned.slice(lastIndex, idx))
    closeIfOpen()
    const codes = m[1]
      ? m[1].split(";").map((p) => (p === "" ? 0 : Number(p))).filter((n) => !Number.isNaN(n))
      : [0]
    style = applyCodes(codes, style)
    lastIndex = idx + m[0].length
  }
  if (lastIndex < cleaned.length) flushText(cleaned.slice(lastIndex))
  closeIfOpen()
  return out
}

/** True if `text` contains any ANSI escape sequence. */
export function hasAnsi(text: string): boolean {
  return /\x1b\[/.test(text)
}
