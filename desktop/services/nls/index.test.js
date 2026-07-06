const assert = require("node:assert/strict")
const path = require("node:path")
const test = require("node:test")

const {
  createBuiltInBundleCandidates,
  createLocalizationActionEvidence,
  formatNlsMessage,
  normalizeCodekLocale,
  resolveLocale,
} = require("./index")

test("desktop NLS normalizes locale aliases and projects language pack metadata", () => {
  assert.equal(normalizeCodekLocale("zh-Hant"), "zhTw")
  assert.equal(normalizeCodekLocale("en-US"), "en")

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

  assert.deepEqual(resolution.fallbackChain, ["zh-tw", "zh-hk", "zh", "en"])
  assert.equal(resolution.codekLocale, "zhTw")
  assert.equal(resolution.languagePack.translationsConfigFile, "translations/main.i18n.json")
})

test("desktop NLS builds VS Code-style built-in bundle lookup candidates", () => {
  const root = "D:\\Workspace"
  const candidates = createBuiltInBundleCandidates(root, "vscode.git", "zh-TW")

  assert.deepEqual(candidates, [
    path.join(root, "extensions", "vscode.git", "l10n", "bundle.l10n.zh-tw.json"),
    path.join(root, "extensions", "vscode.git", "l10n", "bundle.l10n.zh.json"),
    path.join(root, "extensions", "vscode.git", "package.nls.zh-tw.json"),
    path.join(root, "extensions", "vscode.git", "package.nls.zh.json"),
    path.join(root, "extensions", "vscode.git", "package.nls.json"),
  ])
})

test("desktop NLS formats messages and creates evidence-safe actions", () => {
  assert.equal(formatNlsMessage("Saved {0}", ["file.ts"]), "Saved file.ts")
  assert.deepEqual(createLocalizationActionEvidence({
    bundle: "workbench",
    key: "save",
    locale: "zh-cn",
  }), {
    surface: "localization",
    action: "inspect",
    bundle: "workbench",
    key: "save",
    locale: "zh-cn",
    source: "fallback",
  })
})
