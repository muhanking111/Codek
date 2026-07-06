import { describe, expect, it } from "vitest"
import {
  createLocalizationActionEvidence,
  createNlsService,
  getLocalizedStringRegistry,
  normalizeCodekLocale,
  resolveLocale,
} from "./nlsService"

describe("NLS service closure", () => {
  it("normalizes VS Code locale forms into the Codek locale contract", () => {
    expect(normalizeCodekLocale("zh-CN")).toBe("zh")
    expect(normalizeCodekLocale("zh_Hant")).toBe("zhTw")
    expect(normalizeCodekLocale("en-US")).toBe("en")
    expect(normalizeCodekLocale("fr-CA")).toBeNull()
  })

  it("resolves locale fallback chains with language pack metadata projection", () => {
    const resolution = resolveLocale({
      userLocale: "zh-HK",
      osLocale: "en-US",
      availableLocales: ["en", "zh"],
      languagePacks: {
        "zh-tw": {
          hash: "pack-hash",
          label: "Traditional Chinese",
          extensions: [{ extensionIdentifier: { id: "publisher.language-pack-zh-tw" }, version: "1.0.0" }],
          translations: { vscode: "translations/main.i18n.json" },
        },
      },
    })

    expect(resolution).toMatchObject({
      userLocale: "zh-hk",
      osLocale: "en-us",
      resolvedLanguage: "zh-tw",
      codekLocale: "zhTw",
      fallbackChain: ["zh-tw", "zh-hk", "zh", "en"],
      languagePack: {
        id: "zh-tw",
        hash: "pack-hash",
        label: "Traditional Chinese",
        translationsConfigFile: "translations/main.i18n.json",
      },
    })
  })

  it("looks up bundles by locale chain and records missing-key diagnostics", () => {
    const service = createNlsService({
      locale: { userLocale: "zh-TW", osLocale: "en-US", availableLocales: ["en", "zh", "zhTw"] },
      bundles: {
        workbench: {
          en: { save: "Save {0}", close: "Close" },
          zh: { close: "关闭" },
        },
      },
    })

    expect(service.localize("workbench", "close", "Close")).toBe("关闭")
    expect(service.localize("workbench", "save", "Save {0}", "file.ts")).toBe("Save file.ts")
    expect(service.localize("workbench", "missing", "Fallback")).toBe("Fallback")
    expect(service.getDiagnostics()).toEqual([
      expect.objectContaining({
        id: "nls.missingKey",
        bundle: "workbench",
        key: "missing",
        locale: "zh-tw",
        fallbackLocale: "fallback",
      }),
    ])
  })

  it("projects evidence-safe localization actions without file-system writes", () => {
    const service = createNlsService({
      locale: { userLocale: "zh-CN", osLocale: "zh-CN" },
      bundles: {},
    })
    service.localize("commandPalette", "open", "Open")

    expect(service.getActions()).toEqual([
      {
        id: "nls.inspectMissingKey",
        label: "Inspect missing localization key",
        diagnosticId: "nls.missingKey",
        evidence: createLocalizationActionEvidence({
          bundle: "commandPalette",
          key: "open",
          locale: "zh-cn",
          source: "fallback",
        }),
      },
    ])
  })

  it("keeps a single localized string registry for adapter and UI callers", () => {
    const registry = getLocalizedStringRegistry()
    registry.clear()
    registry.registerBundle("adapter", "zh", { greet: "你好 {0}" })
    registry.setLocale({ userLocale: "zh-CN", osLocale: "en-US" })

    expect(registry.localize("adapter", "greet", "Hello {0}", "Codek")).toBe("你好 Codek")
    expect(registry.localize("adapter", "unknown", "Fallback")).toBe("Fallback")
    expect(registry.getDiagnostics()).toHaveLength(1)
  })
})
