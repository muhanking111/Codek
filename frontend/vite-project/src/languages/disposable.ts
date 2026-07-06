export interface DisposableLike {
  dispose(): void
}

export const NOOP_DISPOSABLE: DisposableLike = {
  dispose() {},
}

export function isDisposableLike(value: unknown): value is DisposableLike {
  return Boolean(value) && typeof (value as DisposableLike).dispose === "function"
}

export function toDisposable(value: unknown): DisposableLike {
  return isDisposableLike(value) ? value : NOOP_DISPOSABLE
}

export function combineDisposables(...values: Array<DisposableLike | null | undefined | false>): DisposableLike {
  const disposables = values.filter((value): value is DisposableLike => isDisposableLike(value))
  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      for (const disposable of [...disposables].reverse()) {
        try {
          disposable.dispose()
        } catch {
          // Keep teardown best-effort so one bad provider cannot leak the rest.
        }
      }
    },
  }
}
