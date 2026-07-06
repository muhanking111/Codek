import { settingsStore } from "../settings/settingsStore"

export type TelemetryLevel = "off" | "error" | "crash" | "all"

export function getTelemetryLevel(settings = settingsStore.getAll()): TelemetryLevel {
  const value = settings["telemetry.telemetryLevel"]
  return value === "error" || value === "crash" || value === "all" ? value : "off"
}

export function isTelemetryEventAllowed(level: TelemetryLevel, eventType: TelemetryLevel): boolean {
  if (level === "all") return true
  if (level === "error") return eventType === "error" || eventType === "crash"
  if (level === "crash") return eventType === "crash"
  return false
}
