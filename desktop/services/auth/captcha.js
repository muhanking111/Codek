const crypto = require("crypto")

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const CODE_LENGTH = 4
const EXPIRE_MS = 5 * 60 * 1000

const store = new Map()

function cleanup() {
  const now = Date.now()
  for (const [id, entry] of store.entries()) {
    if (entry.expiresAt < now) store.delete(id)
  }
}

function randomChar() {
  return CHARS[crypto.randomInt(0, CHARS.length)]
}

function buildSvg(code) {
  const width = 140
  const height = 50
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  svg += `<rect width="100%" height="100%" fill="#fafafa"/>`
  // 干扰线
  for (let i = 0; i < 4; i++) {
    const x1 = crypto.randomInt(0, width)
    const y1 = crypto.randomInt(0, height)
    const x2 = crypto.randomInt(0, width)
    const y2 = crypto.randomInt(0, height)
    const c = ["#bbb", "#ccc", "#aaa"][crypto.randomInt(0, 3)]
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="1"/>`
  }
  // 字符
  const step = width / (code.length + 1)
  for (let i = 0; i < code.length; i++) {
    const x = step * (i + 1)
    const y = 35 + crypto.randomInt(-4, 5)
    const rot = crypto.randomInt(-20, 21)
    const color = `hsl(${crypto.randomInt(0, 360)},70%,40%)`
    svg += `<text x="${x}" y="${y}" font-family="Arial" font-size="28" font-weight="bold" fill="${color}" text-anchor="middle" transform="rotate(${rot} ${x} ${y})">${code[i]}</text>`
  }
  // 干扰点
  for (let i = 0; i < 30; i++) {
    const x = crypto.randomInt(0, width)
    const y = crypto.randomInt(0, height)
    svg += `<circle cx="${x}" cy="${y}" r="1" fill="#999"/>`
  }
  svg += `</svg>`
  return svg
}

function generate() {
  cleanup()
  let code = ""
  for (let i = 0; i < CODE_LENGTH; i++) code += randomChar()
  const captchaId = crypto.randomUUID()
  store.set(captchaId, { answer: code, expiresAt: Date.now() + EXPIRE_MS })
  const svg = buildSvg(code)
  const image = "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64")
  return { captchaId, image }
}

function verify(captchaId, input) {
  cleanup()
  if (!captchaId) return false
  const entry = store.get(captchaId)
  if (!entry) return false
  store.delete(captchaId)
  if (entry.expiresAt < Date.now()) return false
  return (input || "").trim().toUpperCase() === entry.answer
}

module.exports = { generate, verify }
