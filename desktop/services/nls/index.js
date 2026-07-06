const path = require("path")

const codekLocales = new Set(["en", "zh", "zhTw"])

function normalizeLocaleTag(value) {
  if (typeof value !== "string") return null
  const normalized = value.trim().replace(/_/g, "-").toLowerCase()
  return normalized || null
}

function normalizeCodekLocale(value) {
  const normalized = normalizeLocaleTag(value)
  if (!normalized) return null
  if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans" || normalized.startsWith("zh-hans-")) return "zh"
  if (
    normalized === "zhtw"
    || normalized === "zh-tw"
    || normalized === "zh-hant"
    || normalized === "zh-hk"
    || normalized === "zh-mo"
    || normalized.startsWith("zh-hant-")
  ) return "zhTw"
  if (normalized === "en" || normalized.startsWith("en-")) return "en"
  return null
}

function toResolvedLanguage(locale) {
  if (locale === "zh") return "zh-cn"
  if (locale === "zhTw") return "zh-tw"
  return "en"
}

function resolveLocale(input = {}) {
  const userLocale = normalizeLocaleTag(input.userLocale) || "zh-cn"
  const osLocale = normalizeLocaleTag(input.osLocale) || userLocale
  const languagePack = findLanguagePack(userLocale, input.languagePacks)
  const requested = normalizeCodekLocale(languagePack?.id) || normalizeCodekLocale(userLocale) || normalizeCodekLocale(osLocale) || "en"
  const available = new Set(Array.isArray(input.availableLocales) && input.availableLocales.length ? input.availableLocales : Array.from(codekLocales))
  const codekLocale = languagePack ? requested : (available.has(requested) ? requested : (available.has("zh") ? "zh" : "en"))
  const resolvedLanguage = languagePack?.id || toResolvedLanguage(codekLocale)
  const fallbackChain = Array.from(new Set([
    resolvedLanguage,
    userLocale,
    toResolvedLanguage(codekLocale),
    codekLocale === "zhTw" ? "zh" : undefined,
    "en",
  ].filter(Boolean)))

  return {
    userLocale,
    osLocale,
    resolvedLanguage,
    codekLocale,
    fallbackChain,
    languagePack,
  }
}

function createBuiltInBundleCandidates(rootDir, extensionId, locale) {
  if (!rootDir || !extensionId || !locale) return []
  const resolution = resolveLocale({ userLocale: locale })
  const localeNames = resolution.fallbackChain.filter((name) => name !== "en")
  const extensionRoot = path.join(rootDir, "extensions", extensionId)
  return [
    ...localeNames.map((name) => path.join(extensionRoot, "l10n", `bundle.l10n.${name}.json`)),
    ...localeNames.map((name) => path.join(extensionRoot, `package.nls.${name}.json`)),
    path.join(extensionRoot, "package.nls.json"),
  ]
}

function formatNlsMessage(message, args = []) {
  return String(message || "").replace(/\{(\d+)\}/g, (match, indexText) => {
    const value = args[Number(indexText)]
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean" || value === undefined || value === null) return String(value)
    return match
  })
}

function createLocalizationActionEvidence(input) {
  return {
    surface: "localization",
    action: "inspect",
    bundle: input.bundle,
    key: input.key,
    locale: input.locale,
    source: input.source || "fallback",
  }
}

function findLanguagePack(userLocale, languagePacks) {
  if (!languagePacks || typeof languagePacks !== "object") return undefined
  const codekLocale = normalizeCodekLocale(userLocale)
  const candidates = Array.from(new Set([
    userLocale,
    codekLocale ? toResolvedLanguage(codekLocale) : undefined,
    String(userLocale || "").split("-")[0],
  ].filter(Boolean)))
  for (const candidate of candidates) {
    const pack = languagePacks[candidate]
    if (!pack) continue
    const translationsConfigFile = pack.translations?.vscode || Object.values(pack.translations || {}).find((value) => typeof value === "string")
    return {
      id: candidate,
      hash: pack.hash,
      label: pack.label,
      extensions: Array.isArray(pack.extensions) ? pack.extensions : [],
      translationsConfigFile,
    }
  }
  return undefined
}

module.exports = {
  createBuiltInBundleCandidates,
  createLocalizationActionEvidence,
  formatNlsMessage,
  normalizeCodekLocale,
  normalizeLocaleTag,
  resolveLocale,
  toResolvedLanguage,
}
