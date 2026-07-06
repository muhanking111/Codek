import { describe, expect, it } from "vitest"
import { expandAbbreviation, isEmmetLanguageEnabled, normalizeEmmetConfig } from "./emmetProvider"

describe("emmetProvider", () => {
  it("expands mapped syntaxes through a VS Code-style includeLanguages config", () => {
    const config = normalizeEmmetConfig({
      includeLanguages: { javascript: "html" },
      preferences: { "bem.enabled": true },
    })

    expect(isEmmetLanguageEnabled("javascript", config)).toBe(true)
    expect(expandAbbreviation("button.primary", "javascript", config)).toBe('<button class="primary"></button>')
  })

  it("honors excluded languages and disabled preview expansion", () => {
    const config = normalizeEmmetConfig({
      excludeLanguages: ["markdown"],
      showExpandedAbbreviation: "never",
    })

    expect(isEmmetLanguageEnabled("markdown", config)).toBe(false)
    expect(expandAbbreviation("ul>li", "html", config)).toBe("ul>li")
  })
})
