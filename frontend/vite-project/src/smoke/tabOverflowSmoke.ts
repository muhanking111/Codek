export interface TabOverflowSmokeOpenOptions {
  paths: string[]
  openFile: (path: string) => Promise<unknown>
  recoverOpenFile?: (path: string, error: unknown) => Promise<unknown>
  isOpen: (path: string) => boolean
  minOpenCount?: number
  perFileTimeoutMs?: number
  setStage?: (stage: string, detail?: Record<string, unknown>) => void
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`tab overflow smoke timeout: ${label}`)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export async function openTabOverflowSmokeFiles(options: TabOverflowSmokeOpenOptions): Promise<string[]> {
  const paths = options.paths.filter(Boolean)
  const minOpenCount = Math.min(Number(options.minOpenCount || 20), paths.length)
  const perFileTimeoutMs = Math.max(1000, Number(options.perFileTimeoutMs || 6000))
  const opened: string[] = []

  options.setStage?.("open-files:start", { fileCount: paths.length, minOpenCount, perFileTimeoutMs })

  for (const path of paths) {
    options.setStage?.("open-file:start", { path, openedCount: opened.length })
    try {
      await withTimeout(Promise.resolve(options.openFile(path)), perFileTimeoutMs, `open ${path}`)
    } catch (error) {
      if (!options.recoverOpenFile) throw error
      options.setStage?.("open-file:recover", {
        path,
        openedCount: opened.length,
        error: error instanceof Error ? error.message : String(error),
      })
      await withTimeout(Promise.resolve(options.recoverOpenFile(path, error)), perFileTimeoutMs, `recover open ${path}`)
    }
    if (options.isOpen(path)) opened.push(path)
    options.setStage?.("open-file:done", { path, openedCount: opened.length })

    if (opened.length >= minOpenCount) {
      options.setStage?.("open-files:min-reached", { openedCount: opened.length })
    }

    await delay(0)
  }

  options.setStage?.("open-files:done", { openedCount: opened.length })
  return opened
}

export const __tabOverflowSmokeTest = {
  withTimeout,
}
