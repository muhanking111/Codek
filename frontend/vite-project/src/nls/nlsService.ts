export type CodekLocale = "en" | "zh" | "zhTw"
export type NlsSeverity = "info" | "warning" | "error"
export type LocalizeArg = string | number | boolean | undefined | null

export interface NlsLanguagePackExtension {
  readonly extensionIdentifier: { readonly id: string; readonly uuid?: string }
  readonly version: string
}

export interface NlsLanguagePack {
  readonly hash: string
  readonly label?: string
  readonly extensions: readonly NlsLanguagePackExtension[]
  readonly translations: Record<string, string | undefined>
}

export type NlsLanguagePacks = Record<string, NlsLanguagePack | undefined>
export type NlsMessageBundle = Record<string, string>
export type NlsBundleCatalog = Record<string, Partial<Record<CodekLocale, NlsMessageBundle>>>

export interface NlsLanguagePackProjection {
  readonly id: string
  readonly hash: string
  readonly label?: string
  readonly extensions: readonly NlsLanguagePackExtension[]
  readonly translationsConfigFile?: string
}

export interface NlsLocaleInput {
  readonly userLocale?: string | null
  readonly osLocale?: string | null
  readonly availableLocales?: readonly CodekLocale[]
  readonly languagePacks?: NlsLanguagePacks
}

export interface NlsLocaleResolution {
  readonly userLocale: string
  readonly osLocale: string
  readonly resolvedLanguage: string
  readonly codekLocale: CodekLocale
  readonly fallbackChain: readonly string[]
  readonly languagePack?: NlsLanguagePackProjection
}

export interface NlsMissingKeyDiagnostic {
  readonly id: "nls.missingKey"
  readonly severity: NlsSeverity
  readonly bundle: string
  readonly key: string
  readonly locale: string
  readonly fallbackLocale?: string
  readonly message: string
  readonly evidence: LocalizationActionEvidence
}

export interface LocalizationActionEvidence {
  readonly surface: "localization"
  readonly action: "inspect"
  readonly bundle: string
  readonly key: string
  readonly locale: string
  readonly source: "registry" | "fallback"
}

export interface LocalizationAction {
  readonly id: "nls.inspectMissingKey"
  readonly label: string
  readonly diagnosticId: NlsMissingKeyDiagnostic["id"]
  readonly evidence: LocalizationActionEvidence
}

export interface NlsServiceOptions {
  readonly locale?: NlsLocaleInput
  readonly bundles?: NlsBundleCatalog
}

export interface NlsService {
  readonly resolution: NlsLocaleResolution
  localize(bundle: string, key: string, fallback: string, ...args: LocalizeArg[]): string
  registerBundle(bundle: string, locale: CodekLocale | string, messages: NlsMessageBundle): void
  setLocale(input: NlsLocaleInput): void
  getDiagnostics(): NlsMissingKeyDiagnostic[]
  getActions(): LocalizationAction[]
  clearDiagnostics(): void
}

const defaultLocaleInput: Required<Pick<NlsLocaleInput, "userLocale" | "osLocale">> = {
  userLocale: "zh-CN",
  osLocale: "zh-CN",
}

export function normalizeCodekLocale(value: unknown): CodekLocale | null {
  const normalized = normalizeLocaleTag(value)
  if (!normalized) return null
  if (normalized === "zh" || normalized === "zh-cn" || normalized === "zh-hans" || normalized.startsWith("zh-hans-")) return "zh"
  if (
    normalized === "zhtw"
    || normalized === "zh_tw"
    || normalized === "zh-tw"
    || normalized === "zh-hant"
    || normalized === "zh-hk"
    || normalized === "zh-mo"
    || normalized.startsWith("zh-hant-")
  ) return "zhTw"
  if (normalized === "en" || normalized.startsWith("en-")) return "en"
  return null
}

export function toResolvedLanguage(locale: CodekLocale): string {
  if (locale === "zh") return "zh-cn"
  if (locale === "zhTw") return "zh-tw"
  return "en"
}

export function normalizeLocaleTag(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().replace(/_/g, "-").toLowerCase()
  return normalized || null
}

export function resolveLocale(input: NlsLocaleInput = {}): NlsLocaleResolution {
  const userLocale = normalizeLocaleTag(input.userLocale) || defaultLocaleInput.userLocale.toLowerCase()
  const osLocale = normalizeLocaleTag(input.osLocale) || normalizeLocaleTag(input.userLocale) || defaultLocaleInput.osLocale.toLowerCase()
  const available = new Set<CodekLocale>(input.availableLocales?.length ? input.availableLocales : ["en", "zh", "zhTw"])
  const languagePack = findLanguagePack(userLocale, input.languagePacks)
  const requested = normalizeCodekLocale(languagePack?.id) || normalizeCodekLocale(userLocale) || normalizeCodekLocale(osLocale) || "en"
  const codekLocale = languagePack
    ? requested
    : available.has(requested) ? requested : (available.has("zh") ? "zh" : "en")
  const resolvedLanguage = languagePack?.id || toResolvedLanguage(codekLocale)
  const fallbackChain = createFallbackChain(userLocale, resolvedLanguage, codekLocale)
  return {
    userLocale,
    osLocale,
    resolvedLanguage,
    codekLocale,
    fallbackChain,
    languagePack,
  }
}

export function formatNlsMessage(message: string, args: readonly LocalizeArg[]): string {
  if (!args.length) return message
  return message.replace(/\{(\d+)\}/g, (match, indexText) => {
    const value = args[Number(indexText)]
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean" || value === undefined || value === null) return String(value)
    return match
  })
}

export function createLocalizationActionEvidence(input: {
  bundle: string
  key: string
  locale: string
  source: LocalizationActionEvidence["source"]
}): LocalizationActionEvidence {
  return {
    surface: "localization",
    action: "inspect",
    bundle: input.bundle,
    key: input.key,
    locale: input.locale,
    source: input.source,
  }
}

export function createNlsService(options: NlsServiceOptions = {}): NlsService {
  const registry = new LocalizedStringRegistry(options.bundles)
  if (options.locale) registry.setLocale(options.locale)
  return registry
}

class LocalizedStringRegistry implements NlsService {
  private readonly bundles: NlsBundleCatalog = {}
  private diagnostics = new Map<string, NlsMissingKeyDiagnostic>()
  resolution: NlsLocaleResolution = resolveLocale()

  constructor(initialBundles: NlsBundleCatalog = {}) {
    for (const [bundle, locales] of Object.entries(initialBundles)) {
      for (const [locale, messages] of Object.entries(locales)) {
        if (messages) this.registerBundle(bundle, locale, messages)
      }
    }
  }

  registerBundle(bundle: string, locale: CodekLocale | string, messages: NlsMessageBundle): void {
    const codekLocale = normalizeCodekLocale(locale)
    if (!bundle || !codekLocale) return
    const existing = this.bundles[bundle]?.[codekLocale] || {}
    this.bundles[bundle] = {
      ...(this.bundles[bundle] || {}),
      [codekLocale]: { ...existing, ...messages },
    }
  }

  setLocale(input: NlsLocaleInput): void {
    this.resolution = resolveLocale(input)
  }

  localize(bundle: string, key: string, fallback: string, ...args: LocalizeArg[]): string {
    const resolved = this.lookup(bundle, key)
    if (resolved) return formatNlsMessage(resolved.message, args)
    this.rememberMissingKey(bundle, key, "fallback")
    return formatNlsMessage(fallback, args)
  }

  getDiagnostics(): NlsMissingKeyDiagnostic[] {
    return Array.from(this.diagnostics.values())
  }

  getActions(): LocalizationAction[] {
    return this.getDiagnostics().map((diagnostic) => ({
      id: "nls.inspectMissingKey",
      label: "Inspect missing localization key",
      diagnosticId: diagnostic.id,
      evidence: diagnostic.evidence,
    }))
  }

  clearDiagnostics(): void {
    this.diagnostics.clear()
  }

  clear(): void {
    for (const key of Object.keys(this.bundles)) delete this.bundles[key]
    this.clearDiagnostics()
    this.resolution = resolveLocale()
  }

  private lookup(bundle: string, key: string): { message: string; locale: string } | null {
    const byLocale = this.bundles[bundle]
    if (!byLocale) return null
    for (const locale of this.resolution.fallbackChain) {
      const codekLocale = normalizeCodekLocale(locale)
      const message = codekLocale ? byLocale[codekLocale]?.[key] : undefined
      if (typeof message === "string") return { message, locale }
    }
    return null
  }

  private rememberMissingKey(bundle: string, key: string, fallbackLocale?: string): void {
    const diagnosticKey = `${bundle}:${key}:${this.resolution.resolvedLanguage}`
    if (this.diagnostics.has(diagnosticKey)) return
    const evidence = createLocalizationActionEvidence({
      bundle,
      key,
      locale: this.resolution.resolvedLanguage,
      source: "fallback",
    })
    this.diagnostics.set(diagnosticKey, {
      id: "nls.missingKey",
      severity: "warning",
      bundle,
      key,
      locale: this.resolution.resolvedLanguage,
      fallbackLocale,
      message: `Missing localized string "${key}" in bundle "${bundle}" for locale "${this.resolution.resolvedLanguage}".`,
      evidence,
    })
  }
}

const globalLocalizedStringRegistry = new LocalizedStringRegistry()

export function getLocalizedStringRegistry(): LocalizedStringRegistry {
  return globalLocalizedStringRegistry
}

function createFallbackChain(userLocale: string, resolvedLanguage: string, codekLocale: CodekLocale): string[] {
  const chain = [
    resolvedLanguage,
    userLocale,
    toResolvedLanguage(codekLocale),
    codekLocale === "zhTw" ? "zh" : undefined,
    "en",
  ].filter(Boolean) as string[]
  return Array.from(new Set(chain))
}

function findLanguagePack(userLocale: string, languagePacks?: NlsLanguagePacks): NlsLanguagePackProjection | undefined {
  if (!languagePacks) return undefined
  const candidates = Array.from(new Set([
    userLocale,
    normalizeCodekLocale(userLocale) ? toResolvedLanguage(normalizeCodekLocale(userLocale) as CodekLocale) : undefined,
    userLocale.split("-")[0],
  ].filter(Boolean) as string[]))
  for (const candidate of candidates) {
    const pack = languagePacks[candidate]
    if (!pack) continue
    return {
      id: candidate,
      hash: pack.hash,
      label: pack.label,
      extensions: pack.extensions,
      translationsConfigFile: pack.translations.vscode || Object.values(pack.translations).find((value): value is string => typeof value === "string"),
    }
  }
  return undefined
}
