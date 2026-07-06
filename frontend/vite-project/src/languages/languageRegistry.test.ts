import { beforeEach, describe, expect, it } from "vitest"
import {
  detectLanguageForPath,
  getLanguageDescriptor,
  getLanguageIds,
  registerLanguages,
  resetLanguageRegistry,
} from "./languageRegistry"

describe("languageRegistry", () => {
  beforeEach(() => {
    resetLanguageRegistry()
  })

  it("detects built-in languages from filenames and extensions", () => {
    expect(detectLanguageForPath("src/main.ts")).toBe("typescript")
    expect(detectLanguageForPath("src/App.vue")).toBe("html")
    expect(detectLanguageForPath("Dockerfile")).toBe("dockerfile")
    expect(detectLanguageForPath("CMakeLists.txt")).toBe("cmake")
    expect(detectLanguageForPath(".env.local")).toBe("ini")
  })

  it("registers VS Code contributes.languages descriptors", () => {
    const count = registerLanguages([
      {
        id: "astro",
        aliases: ["Astro"],
        extensions: [".astro"],
        filenames: ["astro.config.mjs"],
        firstLine: "^---",
        source: "extension",
        extensionId: "astro-build.astro-vscode",
      },
    ])

    expect(count).toBe(1)
    expect(getLanguageIds()).toContain("astro")
    expect(detectLanguageForPath("src/page.astro")).toBe("astro")
    expect(detectLanguageForPath("astro.config.mjs")).toBe("astro")
    expect(getLanguageDescriptor("astro")).toMatchObject({
      source: "extension",
      extensionId: "astro-build.astro-vscode",
    })
  })

  it("merges duplicate language contributions without dropping existing extensions", () => {
    registerLanguages([{ id: "javascript", extensions: [".js-custom"], aliases: ["Custom JS"] }])

    expect(detectLanguageForPath("src/file.js")).toBe("javascript")
    expect(detectLanguageForPath("src/file.js-custom")).toBe("javascript")
    expect(getLanguageDescriptor("javascript")?.aliases).toContain("Custom JS")
  })
})
