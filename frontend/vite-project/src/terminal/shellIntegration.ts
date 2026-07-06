export type Osc633EventType =
  | "promptStart"
  | "commandStart"
  | "commandExecuted"
  | "commandFinished"
  | "commandLine"
  | "property"

export interface Osc633Event {
  type: Osc633EventType
  exitCode?: number
  commandLine?: string
  nonce?: string
  key?: string
  value?: string
}

export interface Osc633ParseResult {
  cleanedData: string
  events: Osc633Event[]
}

export interface TerminalCommandRecord {
  id: string
  terminalId: string
  commandLine: string
  cwd: string
  startedAt: number
  executedAt: number | null
  finishedAt: number | null
  durationMs: number | null
  exitCode: number | null
  output: string
  status: "running" | "finished"
}

export type InstrumentedShellType = "bash" | "powershell" | "cmd" | "gitbash" | "wsl" | "zsh"

export type TerminalShellIntegrationEventType =
  | "available"
  | "cwdChanged"
  | "commandStarted"
  | "commandExecuted"
  | "commandFinished"

export interface TerminalShellIntegrationEvent {
  terminalId: string
  type: TerminalShellIntegrationEventType
  command?: TerminalCommandRecord
  cwd?: string
  exitCode?: number | null
  timestamp: number
  source: "osc633"
}

export type TerminalShellIntegrationEventListener = (event: TerminalShellIntegrationEvent) => void

const ESC = "\x1b"
const OSC_START = `${ESC}]`
const BEL = "\x07"
const ST = `${ESC}\\`
const MAX_OUTPUT_LENGTH = 12000

export class Osc633Parser {
  private pendingOsc = ""
  private inOsc = false
  private pendingEscInOsc = false

  parse(data: string): Osc633ParseResult {
    const events: Osc633Event[] = []
    if (!this.inOsc && data.indexOf(OSC_START) === -1) {
      return { cleanedData: data, events }
    }

    let cleaned = ""
    let i = 0

    while (i < data.length) {
      if (this.inOsc) {
        if (this.pendingEscInOsc) {
          this.pendingEscInOsc = false
          if (data[i] === "\\") {
            i += 1
            this.finishOsc(events)
            continue
          }
          this.finishOsc(events)
          continue
        }

        const result = this.consumeOscBody(data, i)
        i = result.nextIndex
        if (result.complete) {
          this.finishOsc(events, result.terminator)
        } else if (result.pendingEsc) {
          this.pendingEscInOsc = true
        }
        continue
      }

      const escIndex = data.indexOf(OSC_START, i)
      if (escIndex === -1) {
        cleaned += data.slice(i)
        break
      }

      cleaned += data.slice(i, escIndex)
      i = escIndex + OSC_START.length
      this.pendingOsc = ""
      this.inOsc = true
      const result = this.consumeOscBody(data, i)
      i = result.nextIndex
      if (result.complete) {
        const restored = this.finishOsc(events, result.terminator)
        if (restored) cleaned += restored
      } else if (result.pendingEsc) {
        this.pendingEscInOsc = true
      }
    }

    return { cleanedData: cleaned, events }
  }

  private consumeOscBody(data: string, startIndex: number): { nextIndex: number; complete: boolean; pendingEsc?: boolean; terminator?: string } {
    const belIndex = data.indexOf(BEL, startIndex)
    const escIndex = data.indexOf(ESC, startIndex)

    if (belIndex !== -1 && (escIndex === -1 || belIndex < escIndex)) {
      this.pendingOsc += data.slice(startIndex, belIndex)
      return { nextIndex: belIndex + 1, complete: true, terminator: BEL }
    }

    if (escIndex !== -1) {
      if (escIndex + 1 >= data.length) {
        this.pendingOsc += data.slice(startIndex, escIndex)
        return { nextIndex: data.length, complete: false, pendingEsc: true }
      }
      this.pendingOsc += data.slice(startIndex, escIndex)
      if (data[escIndex + 1] === "\\") {
        return { nextIndex: escIndex + 2, complete: true, terminator: ST }
      }
      return { nextIndex: escIndex, complete: true }
    }

    this.pendingOsc += data.slice(startIndex)
    return { nextIndex: data.length, complete: false }
  }

  private finishOsc(events: Osc633Event[], terminator = BEL): string {
    this.inOsc = false
    const payload = this.pendingOsc
    this.pendingOsc = ""
    if (payload.startsWith("633;")) {
      const event = parseOsc633Payload(payload.slice(4))
      if (event) events.push(event)
      return ""
    }
    return `${OSC_START}${payload}${terminator}`
  }
}

export class TerminalShellIntegrationTracker {
  private parser = new Osc633Parser()
  private activeCommand: TerminalCommandRecord | null = null
  private commands: TerminalCommandRecord[] = []
  private commandCounter = 0
  private cwd: string
  private available = false
  private listeners: TerminalShellIntegrationEventListener[] = []

  constructor(
    private readonly terminalId: string,
    initialCwd = "",
  ) {
    this.cwd = initialCwd
  }

  get currentCwd(): string {
    return this.cwd
  }

  get activeCommandRecord(): TerminalCommandRecord | null {
    return this.activeCommand ? { ...this.activeCommand } : null
  }

  get isAvailable(): boolean {
    return this.available
  }

  onDidChangeShellIntegration(listener: TerminalShellIntegrationEventListener): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }

  parse(data: string, now = Date.now()): Osc633ParseResult {
    const result = this.parser.parse(data)
    let outputAppended = false
    if (result.cleanedData && this.activeCommand) {
      this.activeCommand.output = trimCommandOutput(this.activeCommand.output + result.cleanedData)
      outputAppended = true
    }
    for (const event of result.events) {
      this.applyEvent(event, now)
    }
    if (result.cleanedData && this.activeCommand && !outputAppended) {
      this.activeCommand.output = trimCommandOutput(this.activeCommand.output + result.cleanedData)
    }
    return result
  }

  startCommand(commandLine: string, now = Date.now()): TerminalCommandRecord {
    this.markAvailable(now)
    const record: TerminalCommandRecord = {
      id: `${this.terminalId}-cmd-${++this.commandCounter}`,
      terminalId: this.terminalId,
      commandLine,
      cwd: this.cwd,
      startedAt: now,
      executedAt: now,
      finishedAt: null,
      durationMs: null,
      exitCode: null,
      output: "",
      status: "running",
    }
    this.activeCommand = record
    this.commands.push(record)
    const snapshot = { ...record }
    this.emit("commandStarted", { command: snapshot }, now)
    return snapshot
  }

  getCommands(): TerminalCommandRecord[] {
    return this.commands.map((command) => ({ ...command }))
  }

  private applyEvent(event: Osc633Event, now: number): void {
    this.markAvailable(now)
    if (event.type === "property" && event.key === "Cwd") {
      const nextCwd = event.value || this.cwd
      if (nextCwd !== this.cwd) {
        this.cwd = nextCwd
        this.emit("cwdChanged", { cwd: this.cwd }, now)
      }
      return
    }
    if (event.type === "commandLine" && event.commandLine) {
      if (!this.activeCommand) {
        this.startCommand(event.commandLine, now)
      } else {
        this.activeCommand.commandLine = event.commandLine
      }
      return
    }
    if (event.type === "commandExecuted") {
      if (!this.activeCommand) this.startCommand("", now)
      if (this.activeCommand) this.activeCommand.executedAt = now
      this.emit("commandExecuted", { command: this.activeCommand ? { ...this.activeCommand } : undefined }, now)
      return
    }
    if (event.type === "commandFinished" && this.activeCommand) {
      this.activeCommand.finishedAt = now
      this.activeCommand.durationMs = Math.max(0, now - this.activeCommand.startedAt)
      this.activeCommand.exitCode = typeof event.exitCode === "number" ? event.exitCode : null
      this.activeCommand.status = "finished"
      const command = { ...this.activeCommand }
      this.activeCommand = null
      this.emit("commandFinished", { command, exitCode: command.exitCode }, now)
    }
  }

  private markAvailable(now: number): void {
    if (this.available) return
    this.available = true
    this.emit("available", { cwd: this.cwd }, now)
  }

  private emit(
    type: TerminalShellIntegrationEventType,
    payload: Partial<Omit<TerminalShellIntegrationEvent, "terminalId" | "type" | "timestamp" | "source">>,
    timestamp: number,
  ): void {
    const event: TerminalShellIntegrationEvent = {
      terminalId: this.terminalId,
      type,
      timestamp,
      source: "osc633",
      ...payload,
    }
    for (const listener of this.listeners) listener(event)
  }
}

export function buildInstrumentedCommand(command: string, shellType: InstrumentedShellType): string {
  const trimmed = String(command || "").trim()
  if (!trimmed) return ""
  if (shellType === "bash" || shellType === "gitbash" || shellType === "wsl" || shellType === "zsh") {
    return buildBashInstrumentedCommand(trimmed)
  }
  if (shellType === "cmd") return buildCmdInstrumentedCommand(trimmed)
  return buildPowerShellInstrumentedCommand(trimmed)
}

export function buildShellIntegrationBootstrap(shellType: InstrumentedShellType): string {
  if (shellType === "bash" || shellType === "gitbash" || shellType === "wsl" || shellType === "zsh") {
    return [
      "__codek_osc633() { printf '\\033]633;%s\\007' \"$1\"; }",
      "PROMPT_COMMAND='__codek_osc633 A; printf \"\\033]633;P;Cwd=%s\\007\" \"$PWD\"'",
    ].join("\n")
  }
  if (shellType === "cmd") {
    return "PROMPT $E]633;A$G$P$G"
  }
  return [
    "function global:CodekWrite-Osc633([string]$Payload) { [Console]::Out.Write(\"$([char]27)]633;\" + $Payload + \"$([char]7)\") }",
    "function global:prompt { CodekWrite-Osc633 'A'; CodekWrite-Osc633 ('P;Cwd=' + (Get-Location).Path); return 'PS ' + (Get-Location) + '> ' }",
  ].join("; ")
}

function parseOsc633Payload(payload: string): Osc633Event | null {
  const semiIndex = payload.indexOf(";")
  if ((semiIndex === -1 ? payload.length : semiIndex) !== 1) return null
  const command = payload[0]
  const argsRaw = semiIndex === -1 ? "" : payload.slice(semiIndex + 1)

  if (command === "A") return { type: "promptStart" }
  if (command === "B") return { type: "commandStart" }
  if (command === "C") return { type: "commandExecuted" }
  if (command === "D") {
    const exitCode = argsRaw ? Number.parseInt(argsRaw, 10) : undefined
    return { type: "commandFinished", exitCode: Number.isFinite(exitCode) ? exitCode : undefined }
  }
  if (command === "E") {
    const nonceIndex = argsRaw.indexOf(";")
    return {
      type: "commandLine",
      commandLine: deserializeOscMessage(nonceIndex === -1 ? argsRaw : argsRaw.slice(0, nonceIndex)),
      nonce: nonceIndex === -1 ? undefined : argsRaw.slice(nonceIndex + 1),
    }
  }
  if (command === "P") {
    const deserialized = deserializeOscMessage(argsRaw)
    const equalsIndex = deserialized.indexOf("=")
    if (equalsIndex === -1) return null
    return {
      type: "property",
      key: deserialized.slice(0, equalsIndex),
      value: deserialized.slice(equalsIndex + 1),
    }
  }
  return null
}

function deserializeOscMessage(message: string): string {
  if (!message.includes("\\")) return message
  return message.replace(/\\(\\|x([0-9a-f]{2}))/gi, (_match, op: string, hex?: string) =>
    hex ? String.fromCharCode(Number.parseInt(hex, 16)) : op,
  )
}

function serializeOscMessage(message: string): string {
  return String(message || "").replace(/\\/g, "\\\\").replace(/[^\x20-\x7e]/g, (char) =>
    `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
  ).replace(/ /g, "\\x20").replace(/;/g, "\\x3b")
}

function buildBashInstrumentedCommand(command: string): string {
  const encoded = shellSingleQuote(serializeOscMessage(command))
  return [
    `printf '\\033]633;E;%s\\007' ${encoded}`,
    "printf '\\033]633;C\\007'",
    command,
    "__codek_exit=$?",
    "printf '\\033]633;D;%s\\007' \"$__codek_exit\"",
    "printf '\\033]633;P;Cwd=%s\\007' \"$PWD\"",
  ].join("; ")
}

function buildPowerShellInstrumentedCommand(command: string): string {
  const encoded = psSingleQuote(serializeOscMessage(command))
  const commandLiteral = psSingleQuote(command)
  return [
    `[Console]::Out.Write("$([char]27)]633;E;" + ${encoded} + "$([char]7)")`,
    `[Console]::Out.Write("$([char]27)]633;C$([char]7)")`,
    `Invoke-Expression ${commandLiteral}`,
    `$__codek_exit = if ($null -ne $global:LASTEXITCODE) { $global:LASTEXITCODE } elseif ($?) { 0 } else { 1 }`,
    `[Console]::Out.Write("$([char]27)]633;D;" + $__codek_exit + "$([char]7)")`,
    `[Console]::Out.Write("$([char]27)]633;P;Cwd=" + (Get-Location).Path + "$([char]7)")`,
  ].join("; ")
}

function buildCmdInstrumentedCommand(command: string): string {
  const psCommand = [
    `$cmd=${psSingleQuote(command)}`,
    `[Console]::Out.Write("$([char]27)]633;E;" + ${psSingleQuote(serializeOscMessage(command))} + "$([char]7)")`,
    `[Console]::Out.Write("$([char]27)]633;C$([char]7)")`,
    `cmd.exe /d /s /c $cmd`,
    `$exit=$LASTEXITCODE`,
    `[Console]::Out.Write("$([char]27)]633;D;" + $exit + "$([char]7)")`,
    `[Console]::Out.Write("$([char]27)]633;P;Cwd=" + (Get-Location).Path + "$([char]7)")`,
    `exit $exit`,
  ].join("; ")
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ${cmdQuote(psCommand)}`
}

function shellSingleQuote(value: string): string {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

function psSingleQuote(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`
}

function cmdQuote(value: string): string {
  return `"${String(value).replace(/"/g, '\\"')}"`
}

function trimCommandOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) return output
  return output.slice(output.length - MAX_OUTPUT_LENGTH)
}
