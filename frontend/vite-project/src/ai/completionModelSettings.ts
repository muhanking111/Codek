import { settingsStore } from "../settings/settingsStore"

const LEGACY_COMPLETION_MODEL_KEY = "codek-completion-model"
const COMPLETION_MODEL_SETTING_KEY = "codek.ai.completionModel"

export function getCompletionModelOverride(): string {
  const stored = settingsStore.get<string>(COMPLETION_MODEL_SETTING_KEY, "")
  if (typeof stored === "string" && stored) return stored

  const legacy = readLegacyCompletionModel()
  if (legacy) {
    settingsStore.set(COMPLETION_MODEL_SETTING_KEY, legacy)
    return legacy
  }
  return ""
}

export function setCompletionModelOverride(model: string): void {
  const normalized = model.trim()
  settingsStore.set(COMPLETION_MODEL_SETTING_KEY, normalized)
  try {
    if (normalized) localStorage.setItem(LEGACY_COMPLETION_MODEL_KEY, normalized)
    else localStorage.removeItem(LEGACY_COMPLETION_MODEL_KEY)
  } catch {
    // storage unavailable
  }
}

function readLegacyCompletionModel(): string {
  try {
    return localStorage.getItem(LEGACY_COMPLETION_MODEL_KEY) || ""
  } catch {
    return ""
  }
}
