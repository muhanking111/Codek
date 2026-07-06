import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getTelemetryLevel,
  isTelemetryEventAllowed,
  recordTelemetryEvent,
} from "./telemetrySettings"
import { settingsStore } from "./settingsStore"
import { globalOutputLogTelemetryService } from "../workbench/outputLogTelemetryService"

describe("telemetrySettings", () => {
  beforeEach(() => {
    localStorage.clear()
    settingsStore.reset()
    globalOutputLogTelemetryService.reset()
    vi.useRealTimers()
  })

  it("maps telemetry level and event permissions", () => {
    expect(getTelemetryLevel({ "telemetry.telemetryLevel": "all" })).toBe("all")
    expect(getTelemetryLevel({ "telemetry.telemetryLevel": "unknown" })).toBe("off")
    expect(isTelemetryEventAllowed("off", "error")).toBe(false)
    expect(isTelemetryEventAllowed("error", "error")).toBe(true)
    expect(isTelemetryEventAllowed("error", "crash")).toBe(true)
    expect(isTelemetryEventAllowed("crash", "error")).toBe(false)
    expect(isTelemetryEventAllowed("crash", "all")).toBe(false)
    expect(isTelemetryEventAllowed("all", "all")).toBe(true)
  })

  it("records allowed telemetry events through the unified local evidence service", () => {
    vi.setSystemTime(1234)
    settingsStore.set("telemetry.telemetryLevel", "error")

    expect(recordTelemetryEvent("all", "usage.skipped")).toBe(false)
    expect(recordTelemetryEvent("crash", "renderer.crashed")).toBe(true)
    expect(recordTelemetryEvent("error", "editor.failed", {
      message: "boom",
      token: "sk-secret",
      nested: { Authorization: "Bearer abc" },
      path: "C:/Users/alice/project/file.ts",
    })).toBe(true)

    expect(localStorage.getItem("codek.telemetry.events.v1")).toBeNull()
    expect(globalOutputLogTelemetryService.getTelemetryEvidence()).toEqual([
      expect.objectContaining({
        type: "crash",
        name: "renderer.crashed",
        transport: "localEvidenceOnly",
      }),
      expect.objectContaining({
        type: "error",
        name: "editor.failed",
        payload: {
          message: "boom",
          token: "[REDACTED]",
          nested: { Authorization: "[REDACTED]" },
          path: "[USER_PATH]/project/file.ts",
        },
        timestamp: 1234,
        transport: "localEvidenceOnly",
      }),
    ])
    const evidence = JSON.stringify(globalOutputLogTelemetryService.getTelemetryEvidence())
    expect(evidence).not.toContain("sk-secret")
    expect(evidence).not.toContain("Bearer abc")
    expect(evidence).not.toContain("alice")
  })
})
