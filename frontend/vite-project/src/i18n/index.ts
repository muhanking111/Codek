import { inject, ref } from "vue"
import en from "./en"
import zh from "./zh"
import zhTw from "./zhTw"
import { settingsStore } from "../settings/settingsStore"
import { normalizeCodekLocale, type CodekLocale } from "../nls/nlsService"

const LOCALE_KEY = "codek.locale.v1"
const SETTINGS_LOCALE_KEY = "codek.locale"
const I18N_KEY: symbol = Symbol("i18n")

interface I18nMessages {
  [key: string]: string | I18nMessages
}

type Locale = CodekLocale

interface I18n {
  locale: ReturnType<typeof ref<Locale>>
  t: (key: string, replacements?: Record<string, string | number>) => string
  setLocale: (value: Locale) => void
}

const messages: Record<Locale, I18nMessages> = { en, zh, zhTw }

function resolveMessage(obj: I18nMessages, path: string): string | undefined {
  const result = path.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object") return (value as Record<string, unknown>)[key]
    return undefined
  }, obj)
  return typeof result === "string" ? result : undefined
}

export function createI18n(): I18n {
  const storedLegacyLocale = (() => {
    try {
      return localStorage.getItem(LOCALE_KEY)
    } catch {
      return null
    }
  })()

  const storedSettingsLocale = settingsStore.get<string>(SETTINGS_LOCALE_KEY)
  const initialLocale = normalizeLocale(storedSettingsLocale) ?? normalizeLocale(storedLegacyLocale) ?? "zh"
  const locale = ref<Locale>(initialLocale)
  if (storedSettingsLocale !== initialLocale) {
    settingsStore.set(SETTINGS_LOCALE_KEY, initialLocale)
  }

  const t = (key: string, replacements?: Record<string, string | number>): string => {
    const message = resolveMessage(messages[locale.value], key)
    if (typeof message !== "string") return key

    if (!replacements) return message
    return Object.entries(replacements).reduce(
      (text, [rk, rv]) => text.replace(`{${rk}}`, String(rv)),
      message,
    )
  }

  function setLocale(value: Locale): void {
    const nextLocale = normalizeLocale(value)
    if (!nextLocale) return
    applyLocale(nextLocale)
    if (settingsStore.get<string>(SETTINGS_LOCALE_KEY) !== nextLocale) {
      settingsStore.set(SETTINGS_LOCALE_KEY, nextLocale)
    }
  }

  function applyLocale(value: Locale): void {
    locale.value = value
    try {
      localStorage.setItem(LOCALE_KEY, value)
    } catch {
      // ignore
    }
  }

  settingsStore.subscribe((settings) => {
    const nextLocale = normalizeLocale(settings[SETTINGS_LOCALE_KEY])
    if (nextLocale && nextLocale !== locale.value) {
      applyLocale(nextLocale)
    }
  })

  return { locale, t, setLocale }
}

function normalizeLocale(value: unknown): Locale | null {
  return normalizeCodekLocale(value)
}

export function provideI18n(app: { provide: (key: symbol | string, value: unknown) => void }): I18n {
  const i18n = createI18n()
  app.provide(I18N_KEY, i18n)
  return i18n
}

export function useI18n(): I18n {
  const i18n = inject<I18n>(I18N_KEY)
  if (!i18n) throw new Error("useI18n() must be used inside a component tree where provideI18n() was called.")
  return i18n
}
