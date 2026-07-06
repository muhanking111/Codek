export function redactTelemetryPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return redactTelemetryValue(payload) as Record<string, unknown>
}

export function redactTelemetryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactTelemetryValue)
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        output[key] = "[REDACTED]"
      } else {
        output[key] = redactTelemetryValue(item)
      }
    }
    return output
  }
  if (typeof value === "string") return redactTelemetryText(value)
  return value
}

export function redactTelemetryText(value: string): string {
  return value
    .replace(/\b(?:sk|pk)-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi, "[REDACTED]")
    .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+/g, "[USER_PATH]")
    .replace(/\/home\/[^/]+/g, "[USER_PATH]")
}

function isSensitiveKey(key: string): boolean {
  return /token|authorization|password|secret|api[_-]?key|credential/i.test(key)
}
