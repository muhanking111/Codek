/**
 * Memory — loads project-level rules (.codek/rules/*.md) and learned memory
 * (.codek/memory.json) plus global rules (~/.codek/global-rules.md).
 */

const fs = require("fs")
const path = require("path")
const os = require("os")

const GLOBAL_DIR = path.join(os.homedir(), ".codek")
const GLOBAL_RULES = path.join(GLOBAL_DIR, "global-rules.md")
const PROJECT_DIR = ".codek"

function safeRead(p) {
  try { return fs.readFileSync(p, "utf8") } catch { return "" }
}

function loadProjectRules(projectRoot) {
  if (!projectRoot) return ""
  const dir = path.join(projectRoot, PROJECT_DIR, "rules")
  let out = ""
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".md")) continue
      const full = path.join(dir, name)
      const text = safeRead(full)
      if (text) out += `\n# ${name}\n${text}\n`
    }
  } catch {}
  return out.trim()
}

function loadGlobalRules() {
  return safeRead(GLOBAL_RULES).trim()
}

function memoryPath(projectRoot) {
  return path.join(projectRoot || ".", PROJECT_DIR, "memory.json")
}

function loadMemory(projectRoot) {
  const p = memoryPath(projectRoot)
  try {
    const obj = JSON.parse(safeRead(p) || "{}")
    return obj && typeof obj === "object" ? obj : {}
  } catch {
    return {}
  }
}

function saveMemory(projectRoot, mem) {
  const p = memoryPath(projectRoot)
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(mem || {}, null, 2), "utf8")
    return true
  } catch {
    return false
  }
}

function appendLesson(projectRoot, lesson) {
  if (!lesson || typeof lesson !== "string") return false
  const mem = loadMemory(projectRoot)
  if (!Array.isArray(mem.lessons)) mem.lessons = []
  if (mem.lessons.length >= 100) mem.lessons.shift()
  if (!mem.lessons.includes(lesson)) {
    mem.lessons.push(lesson)
    saveMemory(projectRoot, mem)
    return true
  }
  return false
}

function buildContextBlock(projectRoot) {
  const parts = []
  const globalRules = loadGlobalRules()
  if (globalRules) parts.push(`## Global rules\n${globalRules}`)
  const projRules = loadProjectRules(projectRoot)
  if (projRules) parts.push(`## Project rules\n${projRules}`)
  const mem = loadMemory(projectRoot)
  if (mem.lessons && mem.lessons.length) {
    parts.push(`## Lessons learned\n${mem.lessons.map((l) => `- ${l}`).join("\n")}`)
  }
  return parts.join("\n\n")
}

module.exports = {
  loadProjectRules,
  loadGlobalRules,
  loadMemory,
  saveMemory,
  appendLesson,
  buildContextBlock,
  memoryPath,
}
