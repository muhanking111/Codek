export type SoundType = "complete" | "error" | "alert"

const SOUND_PATHS: Record<SoundType, string> = {
  complete: "/sounds/complete.wav",
  error: "/sounds/error.wav",
  alert: "/sounds/alert.wav",
}

const STORAGE_KEY = "codek.sound.settings"

interface SoundSettings {
  enabled: boolean
  volume: number
}

function loadSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SoundSettings>
      return {
        enabled: parsed.enabled !== false,
        volume: typeof parsed.volume === "number" ? Math.max(0, Math.min(1, parsed.volume)) : 0.5,
      }
    }
  } catch { /* use defaults */ }
  return { enabled: true, volume: 0.5 }
}

function persistSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, volume }))
  } catch { /* ignore */ }
}

let { enabled, volume } = loadSettings()

const audioCache = new Map<SoundType, HTMLAudioElement>()

export function playSound(type: SoundType): void {
  if (!enabled) return
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return

  let audio = audioCache.get(type)
  if (!audio) {
    audio = new Audio(SOUND_PATHS[type])
    audioCache.set(type, audio)
  }

  audio.volume = volume
  audio.currentTime = 0
  try {
    const result = audio.play()
    if (typeof result?.catch === "function") result.catch(() => {})
  } catch {
    // Browser autoplay policy and jsdom can reject or omit media playback support.
  }
}

export function setSoundEnabled(val: boolean): void {
  enabled = val
  persistSettings()
}

export function setSoundVolume(val: number): void {
  volume = Math.max(0, Math.min(1, val))
  persistSettings()
}

export function isSoundEnabled(): boolean {
  return enabled
}

export function getSoundVolume(): number {
  return volume
}
