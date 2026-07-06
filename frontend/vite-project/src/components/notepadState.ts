import { reactive } from 'vue'

export interface Notepad {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'codek.notepads.v1'

export const notepadState = reactive<{ notepads: Notepad[] }>({
  notepads: [],
})

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function persistNotepads(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notepadState.notepads))
  } catch {
    // localStorage may be full or unavailable
  }
}

export function loadNotepads(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        notepadState.notepads = parsed
      }
    }
  } catch {
    // ignore corrupt data
  }
}

export function createNotepad(title: string): Notepad {
  const now = Date.now()
  const np: Notepad = {
    id: generateId(),
    title: title || '未命名',
    content: '',
    createdAt: now,
    updatedAt: now,
  }
  notepadState.notepads.unshift(np)
  persistNotepads()
  return np
}

export function updateNotepad(id: string, data: Partial<Notepad>): void {
  const idx = notepadState.notepads.findIndex((n) => n.id === id)
  if (idx === -1) return
  notepadState.notepads[idx] = {
    ...notepadState.notepads[idx],
    ...data,
    updatedAt: Date.now(),
  }
  persistNotepads()
}

export function deleteNotepad(id: string): void {
  notepadState.notepads = notepadState.notepads.filter((n) => n.id !== id)
  persistNotepads()
}

export function searchNotepads(query: string): Notepad[] {
  if (!query.trim()) return notepadState.notepads
  const lower = query.toLowerCase()
  return notepadState.notepads.filter(
    (np) =>
      np.title.toLowerCase().includes(lower) ||
      np.content.toLowerCase().includes(lower),
  )
}
