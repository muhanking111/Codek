import { describe, expect, it } from "vitest"
import { resolveFallbackFileIcon } from "./fileIconResolver"

describe("fileIconResolver", () => {
  it("resolves common file fallback icons without text badges", () => {
    expect(resolveFallbackFileIcon("package.json").type).toBe("json")
    expect(resolveFallbackFileIcon("package.json").className).toBe("icon-json")
    expect(resolveFallbackFileIcon("package.json").color).toBe("#cbcb41")
    expect(resolveFallbackFileIcon("package.json").glyph).toBeTruthy()
    expect(resolveFallbackFileIcon("package.json").label).toBe("")
    expect(resolveFallbackFileIcon("src/App.vue").type).toBe("vue")
    expect(resolveFallbackFileIcon("src/App.vue").glyph).toBeTruthy()
    expect(resolveFallbackFileIcon("src/App.vue").label).toBe("")
    expect(resolveFallbackFileIcon("unknown.codek").type).toBe("default")
    expect(resolveFallbackFileIcon("unknown.codek").glyph).toBeTruthy()
    expect(resolveFallbackFileIcon("unknown.codek").label).toBe("")
  })

  it("does not provide self-made folder fallback icons", () => {
    expect(resolveFallbackFileIcon("src", true, false)).toEqual({
      type: "folder",
      color: "",
      className: "",
      glyph: "",
      label: "",
      fontFamily: "",
      fontSize: "",
    })
    expect(resolveFallbackFileIcon("misc", true, true)).toEqual({
      type: "folder",
      color: "",
      className: "",
      glyph: "",
      label: "",
      fontFamily: "",
      fontSize: "",
    })
  })

  it("recognizes VS Code source and workspace compound fallback icons", () => {
    expect(resolveFallbackFileIcon("syntaxes/typescript.tmLanguage.json").type).toBe("json")
    expect(resolveFallbackFileIcon("product.code-workspace").type).toBe("json")
    expect(resolveFallbackFileIcon("configuration.schema.json").type).toBe("json")
    expect(resolveFallbackFileIcon("extensions/.npmrc").type).toBe("npm-1")
  })

  it("uses the complete VS Code Seti table for dotfiles and unknown project metadata", () => {
    expect(resolveFallbackFileIcon(".eslintignore")).toMatchObject({
      type: "eslint-1",
      color: "#4d5a5e",
      label: "",
    })
    expect(resolveFallbackFileIcon(".eslintignore").glyph).toBeTruthy()
    expect(resolveFallbackFileIcon(".npmrc")).toMatchObject({
      type: "npm-1",
      color: "#cc3e44",
      label: "",
    })
    expect(resolveFallbackFileIcon("shared.code-snippets").type).toBe("json")
    expect(resolveFallbackFileIcon("CODEOWNERS").type).toBe("default")
    expect(resolveFallbackFileIcon("CODEOWNERS").glyph).toBeTruthy()
    expect(resolveFallbackFileIcon("CODENOTIFY").type).toBe("default")
    expect(resolveFallbackFileIcon("CODENOTIFY").glyph).toBeTruthy()
  })
})
