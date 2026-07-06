export {
  getTelemetryLevel,
  isTelemetryEventAllowed,
  type TelemetryLevel,
} from "../telemetry/telemetryPolicy"

import type { TelemetryLevel } from "../telemetry/telemetryPolicy"
import { globalOutputLogTelemetryService } from "../workbench/outputLogTelemetryService"

export function recordTelemetryEvent(
  eventType: TelemetryLevel,
  name: string,
  payload: Record<string, unknown> = {},
): boolean {
  return globalOutputLogTelemetryService.recordTelemetryEvent(eventType, name, payload)
}
