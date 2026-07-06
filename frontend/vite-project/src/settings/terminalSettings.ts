import type { ShellType } from "../terminal/terminalManager"

export type SettingsRecord = Record<string, unknown>

export interface TerminalSettingsOptions {
  fontFamily: string
  fontSize: number
  scrollback: number
}

export function getTerminalSettingsOptions(settings: SettingsRecord): TerminalSettingsOptions {
  return {
    fontFamily: stringValue(settings["terminal.integrated.fontFamily"], "Consolas, monospace"),
    fontSize: clampNumber(settings["terminal.integrated.fontSize"], 13, 8, 40),
    scrollback: clampNumber(settings["terminal.integrated.scrollback"], 1000, 0, 100000),
  }
}

export function getShellTypeFromProfile(profile: unknown): ShellType {
  const normalized = typeof profile === "string" ? profile.trim().toLowerCase() : ""
  if (normalized === "command prompt" || normalized === "cmd") return "cmd"
  if (normalized === "git bash") return "gitbash"
  if (normalized === "bash") return "bash"
  if (normalized === "wsl") return "wsl"
  if (normalized === "zsh") return "zsh"
  return "powershell"
}

export function getProfileFromShellType(shellType: ShellType): string {
  const profiles: Record<ShellType, string> = {
    powershell: "PowerShell",
    cmd: "Command Prompt",
    bash: "Bash",
    gitbash: "Git Bash",
    wsl: "WSL",
    zsh: "Zsh",
  }
  return profiles[shellType]
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  if (numberValue < min) return fallback
  return Math.min(max, numberValue)
}
