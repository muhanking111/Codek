import { ref, type Ref } from "vue"

interface PanelResizeOptions {
  min: number
  max: number
  storageKey: string
  defaultValue: number
  axis: "x" | "y"
  /** When axis === "y", set true if dragging upward should grow the panel (bottom panel pattern). */
  invert?: boolean
}

interface PanelResizeApi {
  size: Ref<number>
  startResize: (event: MouseEvent) => void
}

function loadFromStorage(key: string, min: number, max: number, fallback: number): number {
  try {
    const saved = localStorage.getItem(key)
    if (saved) {
      const n = parseInt(saved, 10)
      if (n >= min && n <= max) return n
    }
  } catch { /* ignore */ }
  return fallback
}

export function usePanelResize(options: PanelResizeOptions): PanelResizeApi {
  const { min, max, storageKey, defaultValue, axis, invert } = options
  const size = ref(loadFromStorage(storageKey, min, max, defaultValue))

  function startResize(event: MouseEvent): void {
    const start = axis === "x" ? event.clientX : event.clientY
    const startSize = size.value
    const cursor = axis === "x" ? "col-resize" : "row-resize"

    document.body.style.cursor = cursor
    document.body.style.userSelect = "none"

    const onMove = (ev: MouseEvent): void => {
      const current = axis === "x" ? ev.clientX : ev.clientY
      const delta = current - start
      const next = invert ? startSize - delta : startSize + delta
      size.value = Math.min(max, Math.max(min, next))
    }

    const onUp = (): void => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
      try { localStorage.setItem(storageKey, String(size.value)) } catch { /* ignore */ }
    }

    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  return { size, startResize }
}
