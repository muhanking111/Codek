interface ErrorEntry {
  id: string
  timestamp: string
  source: string
  message: string
  stack?: string
  extra: Record<string, unknown>
}

const MAX_LOG_ENTRIES = 200
const LOG_FILE_KEY = "codek.errorLog.entries"

let entries: ErrorEntry[] = []

function loadEntries(): void {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(LOG_FILE_KEY)
      if (raw) entries = JSON.parse(raw)
    }
  } catch {
    entries = []
  }
}

function saveEntries(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LOG_FILE_KEY, JSON.stringify(entries.slice(0, MAX_LOG_ENTRIES)))
    }
  } catch {
    // ignore
  }
}

loadEntries()

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error instanceof Event) {
    const target = error.target instanceof HTMLElement
      ? `${error.target.tagName.toLowerCase()}${error.target.id ? `#${error.target.id}` : ""}`
      : error.target && "constructor" in error.target
        ? error.target.constructor.name
        : "unknown"
    return `${error.type || "event"} event from ${target}`
  }
  return String(error)
}

export function captureError(source: string, error: unknown, extra: Record<string, unknown> = {}): void {
  const entry: ErrorEntry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    source,
    message: errorMessage(error),
    stack: error instanceof Error ? error.stack : undefined,
    extra,
  }

  entries.unshift(entry)
  if (entries.length > MAX_LOG_ENTRIES) {
    entries = entries.slice(0, MAX_LOG_ENTRIES)
  }
  saveEntries()

  console.error(`[${source}]`, entry.message, error)
}

export function getErrorLog(): ErrorEntry[] {
  return [...entries]
}

export function clearErrorLog(): void {
  entries = []
  saveEntries()
}

export function exportErrorLog(): string {
  return entries
    .map(
      (e: ErrorEntry) =>
        `[${e.timestamp}] [${e.source}] ${e.message}\n${e.stack || ""}\n${JSON.stringify(e.extra)}\n`,
    )
    .join("---\n")
}

export function setupGlobalErrorHandlers(): void {
  if (typeof window === "undefined") return

  window.addEventListener("error", (event: ErrorEvent) => {
    const error = event.error || event.message || event
    captureError("global:window", error, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      type: event.type,
    })
  })

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    captureError("global:promise", event.reason, {})
  })
}
