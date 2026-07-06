import { reactive, watch } from "vue"
import { settingsStore } from "../settings/settingsStore"

const STORAGE_KEY = "codek-privacy-mode"

export const privacyState = reactive({
  enabled: loadInitial(),
})

function loadInitial(): boolean {
  const settingsValue = settingsStore.get("codek.privacy.enabled")
  if (typeof settingsValue === "boolean") return settingsValue
  try {
    return localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

watch(
  () => privacyState.enabled,
  (val) => {
    try {
      localStorage.setItem(STORAGE_KEY, val ? "1" : "0")
    } catch {
      // storage unavailable
    }
    settingsStore.set("codek.privacy.enabled", val)
  },
)

settingsStore.subscribe((settings) => {
  const enabled = settings["codek.privacy.enabled"]
  if (typeof enabled === "boolean" && privacyState.enabled !== enabled) {
    privacyState.enabled = enabled
  }
})

export function setPrivacyMode(enabled: boolean): void {
  privacyState.enabled = enabled
  settingsStore.set("codek.privacy.enabled", enabled)
}

export function togglePrivacyMode(): boolean {
  setPrivacyMode(!privacyState.enabled)
  return privacyState.enabled
}

export interface ProviderInfo {
  id: string
  cloud: boolean
}

export function isProviderAllowed(provider: ProviderInfo): boolean {
  if (!privacyState.enabled) return true
  return !provider.cloud
}

const CLOUD_PROVIDER_IDS = new Set([
  "openai",
  "anthropic",
  "claude",
])

export function isCloudProviderId(providerId: string): boolean {
  return CLOUD_PROVIDER_IDS.has(providerId.toLowerCase())
}

export function isLogRedactionEnabled(): boolean {
  return settingsStore.get<boolean>("codek.privacy.redactLogs", true) !== false
}

export function redactSensitiveText(text: string): string {
  if (!isLogRedactionEnabled()) return text

  return text
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, "[REDACTED_API_KEY]")
    .replace(/(xox[baprs]-[A-Za-z0-9-]{12,})/g, "[REDACTED_TOKEN]")
    .replace(/([A-Za-z0-9._%+-]+)[:=]([A-Za-z0-9_./+=-]{24,})/g, "$1=[REDACTED_SECRET]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s,;]+/gi, "$1=[REDACTED_SECRET]")
}

export function getSensitiveFilePatterns(): string[] {
  const value = settingsStore.get<unknown>("codek.privacy.sensitiveFilePatterns", [])
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

export function isSensitiveFilePath(pathValue: string): boolean {
  const normalized = pathValue.replace(/\\/g, "/").replace(/^\.?\//, "")
  const basename = normalized.split("/").pop() || normalized
  return getSensitiveFilePatterns().some((pattern) => matchesGlob(normalized, basename, pattern))
}

function matchesGlob(pathValue: string, basename: string, pattern: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, "/").replace(/^\.?\//, "")
  const target = normalizedPattern.includes("/") ? pathValue : basename
  const regex = new RegExp(`^${escapeGlob(normalizedPattern)}$`, "i")
  return regex.test(target)
}

function escapeGlob(pattern: string): string {
  return pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*")
    .replace(/\?/g, "[^/]")
}

export function assertProviderAllowed(providerId: string): void {
  if (privacyState.enabled && isCloudProviderId(providerId)) {
    throw new Error(`隐私模式已开启，已阻止云端模型 ${providerId} 的请求`)
  }
}
