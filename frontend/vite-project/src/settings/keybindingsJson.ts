import {
  findConflictingKeybindings,
  getKeybindingForCommand,
  getRegisteredKeybindings,
  resetAllKeybindings,
  overrideKeybinding,
  type KeybindingOverride,
} from "../keybindings"

const UNKNOWN_STORAGE_KEY = "codek-unknown-keybindings-json"
const WHEN_STORAGE_KEY = "codek-keybindings-when-clauses"

export interface VsCodeKeybindingEntry {
  key: string
  command: string
  when?: string
}

export interface AppliedKeybindingImport {
  command: string
  key: string
  when?: string
  conflicts: string[]
}

export interface UnknownKeybindingImport extends VsCodeKeybindingEntry {
  reason: string
}

export interface InvalidKeybindingImport {
  index: number
  reason: string
  entry: unknown
}

export interface KeybindingsJsonImportResult {
  applied: AppliedKeybindingImport[]
  unknown: UnknownKeybindingImport[]
  invalid: InvalidKeybindingImport[]
}

type WhenClauses = Record<string, string>

export function parseKeybindingsJsonText(text: string): VsCodeKeybindingEntry[] {
  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error("keybindings.json 必须是数组格式。")
  }
  return parsed as VsCodeKeybindingEntry[]
}

export function importKeybindingsJson(input: string | unknown[]): KeybindingsJsonImportResult {
  const entries = typeof input === "string" ? parseKeybindingsJsonText(input) : input
  const result: KeybindingsJsonImportResult = {
    applied: [],
    unknown: [],
    invalid: [],
  }
  const registeredCommands = new Set(getRegisteredKeybindings().map((binding) => binding.commandId ?? binding.id))
  const unknownEntries = loadUnknownKeybindings()
  const whenClauses = loadWhenClauses()

  entries.forEach((entry, index) => {
    const validationError = validateEntry(entry)
    if (validationError) {
      result.invalid.push({ index, reason: validationError, entry })
      return
    }

    const normalizedEntry = normalizeEntry(entry as VsCodeKeybindingEntry)
    if (!registeredCommands.has(normalizedEntry.command)) {
      const unknown = { ...normalizedEntry, reason: "未接入命令" }
      result.unknown.push(unknown)
      upsertUnknownKeybinding(unknownEntries, normalizedEntry)
      return
    }

    const parsedKey = parseKeybindingString(normalizedEntry.key)
    if (!parsedKey) {
      result.invalid.push({ index, reason: "快捷键格式无法识别", entry })
      return
    }
    if (normalizedEntry.when) parsedKey.when = normalizedEntry.when

    const conflicts = findConflictingKeybindings(normalizedEntry.command, parsedKey).map(
      (binding) => binding.id,
    )
    overrideKeybinding(normalizedEntry.command, parsedKey)
    if (normalizedEntry.when) {
      whenClauses[normalizedEntry.command] = normalizedEntry.when
    } else {
      delete whenClauses[normalizedEntry.command]
    }
    result.applied.push({
      command: normalizedEntry.command,
      key: normalizedEntry.key,
      when: normalizedEntry.when,
      conflicts,
    })
  })

  saveUnknownKeybindings(unknownEntries)
  saveWhenClauses(whenClauses)
  return result
}

export function replaceKeybindingsJson(input: string | unknown[]): KeybindingsJsonImportResult {
  resetAllKeybindings()
  saveUnknownKeybindings([])
  saveWhenClauses({})
  return importKeybindingsJson(input)
}

export function exportKeybindingsJson(): VsCodeKeybindingEntry[] {
  const whenClauses = loadWhenClauses()
  const knownEntries = getRegisteredKeybindings()
    .map((binding) => {
      const command = binding.commandId ?? binding.id
      const current = getKeybindingForCommand(command)
      if (!current) return null
      const entry: VsCodeKeybindingEntry = {
        key: formatKeybindingForJson(current),
        command,
      }
      const when = whenClauses[command]
      if (when) entry.when = when
      return entry
    })
    .filter((entry): entry is VsCodeKeybindingEntry => entry !== null)

  return [...knownEntries, ...loadUnknownKeybindings()]
}

export function exportKeybindingsJsonText(): string {
  return JSON.stringify(exportKeybindingsJson(), null, 2)
}

export function parseKeybindingString(value: string): KeybindingOverride | null {
  const strokes = value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map(parseKeybindingStroke)
    .filter((stroke): stroke is KeybindingOverride => stroke !== null)

  if (strokes.length === 0) return null

  const last = strokes[strokes.length - 1]
  return {
    ...last,
    ...(strokes.length > 1 ? { sequence: strokes } : {}),
  }
}

function parseKeybindingStroke(value: string): KeybindingOverride | null {
  const parts = value
    .trim()
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return null

  const modifiers = new Set(["ctrl", "control", "cmd", "command", "meta", "shift", "alt", "option"])
  const keyParts = parts.filter((part) => !modifiers.has(part))
  if (keyParts.length !== 1) return null

  return {
    key: normalizeKeyName(keyParts[0]),
    ctrl: parts.some((part) => ["ctrl", "control", "cmd", "command", "meta"].includes(part)),
    shift: parts.includes("shift"),
    alt: parts.some((part) => ["alt", "option"].includes(part)),
  }
}

export function formatKeybindingForJson(keybinding: KeybindingOverride): string {
  if (keybinding.sequence && keybinding.sequence.length > 0) {
    return keybinding.sequence.map(formatKeybindingForJson).join(" ")
  }
  const parts: string[] = []
  if (keybinding.ctrl) parts.push("ctrl")
  if (keybinding.shift) parts.push("shift")
  if (keybinding.alt) parts.push("alt")
  parts.push(keybinding.key.toLowerCase())
  return parts.join("+")
}

export function getStoredWhenClauses(): WhenClauses {
  return loadWhenClauses()
}

export function getStoredUnknownKeybindings(): VsCodeKeybindingEntry[] {
  return loadUnknownKeybindings()
}

function validateEntry(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") return "条目必须是对象"
  const candidate = entry as Partial<VsCodeKeybindingEntry>
  if (typeof candidate.key !== "string" || candidate.key.trim().length === 0) {
    return "缺少 key"
  }
  if (typeof candidate.command !== "string" || candidate.command.trim().length === 0) {
    return "缺少 command"
  }
  if (candidate.when !== undefined && typeof candidate.when !== "string") {
    return "when 必须是字符串"
  }
  return null
}

function normalizeEntry(entry: VsCodeKeybindingEntry): VsCodeKeybindingEntry {
  const normalized: VsCodeKeybindingEntry = {
    key: entry.key.trim().toLowerCase(),
    command: entry.command.trim(),
  }
  const when = entry.when?.trim()
  if (when) normalized.when = when
  return normalized
}

function normalizeKeyName(key: string): string {
  const aliases: Record<string, string> = {
    escape: "Escape",
    esc: "Escape",
    enter: "Enter",
    return: "Enter",
    space: " ",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
    del: "Delete",
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
  }
  return aliases[key] ?? key
}

function loadUnknownKeybindings(): VsCodeKeybindingEntry[] {
  try {
    const raw = localStorage.getItem(UNKNOWN_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isVsCodeKeybindingEntry).map(normalizeEntry)
  } catch {
    return []
  }
}

function saveUnknownKeybindings(entries: VsCodeKeybindingEntry[]): void {
  localStorage.setItem(UNKNOWN_STORAGE_KEY, JSON.stringify(entries))
}

function loadWhenClauses(): WhenClauses {
  try {
    const raw = localStorage.getItem(WHEN_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    )
  } catch {
    return {}
  }
}

function saveWhenClauses(clauses: WhenClauses): void {
  localStorage.setItem(WHEN_STORAGE_KEY, JSON.stringify(clauses))
}

function isVsCodeKeybindingEntry(entry: unknown): entry is VsCodeKeybindingEntry {
  return validateEntry(entry) === null
}

function upsertUnknownKeybinding(
  entries: VsCodeKeybindingEntry[],
  nextEntry: VsCodeKeybindingEntry,
): void {
  const index = entries.findIndex((entry) => entry.command === nextEntry.command)
  if (index >= 0) {
    entries[index] = nextEntry
  } else {
    entries.push(nextEntry)
  }
}
