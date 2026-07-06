import { describe, expect, it } from "vitest"
import { evaluateWhenClause } from "./contextkey"

describe("VS Code context key adapter", () => {
  it("treats an empty when clause as enabled", () => {
    expect(evaluateWhenClause(undefined)).toBe(true)
    expect(evaluateWhenClause("  ")).toBe(true)
  })

  it("evaluates boolean keys, negation and precedence", () => {
    expect(evaluateWhenClause("editorTextFocus && !inputFocus", {
      editorTextFocus: true,
      inputFocus: false,
    })).toBe(true)
    expect(evaluateWhenClause("editorTextFocus && !inputFocus", {
      editorTextFocus: true,
      inputFocus: true,
    })).toBe(false)
    expect(evaluateWhenClause("a || b && c", { a: false, b: true, c: false })).toBe(false)
    expect(evaluateWhenClause("(a || b) && c", { a: false, b: true, c: true })).toBe(true)
  })

  it("evaluates equality, inequality and regex matches", () => {
    expect(evaluateWhenClause("resourceLangId == typescript", { resourceLangId: "typescript" })).toBe(true)
    expect(evaluateWhenClause("resourceLangId === typescript", { resourceLangId: "typescript" })).toBe(true)
    expect(evaluateWhenClause("resourceLangId != markdown", { resourceLangId: "typescript" })).toBe(true)
    expect(evaluateWhenClause("resourceLangId !== markdown", { resourceLangId: "typescript" })).toBe(true)
    expect(evaluateWhenClause("resourceFilename =~ /\\.test\\.ts$/", { resourceFilename: "keybindings.test.ts" })).toBe(true)
    expect(evaluateWhenClause("resourceFilename !~ /\\.md$/", { resourceFilename: "App.vue" })).toBe(true)
  })

  it("evaluates comparison and membership operators", () => {
    expect(evaluateWhenClause("workspaceFolderCount >= 2", { workspaceFolderCount: 3 })).toBe(true)
    expect(evaluateWhenClause("workspaceFolderCount < 2", { workspaceFolderCount: 3 })).toBe(false)
    expect(evaluateWhenClause("resourceExtname in supportedExtnames", {
      resourceExtname: ".ts",
      supportedExtnames: [".ts", ".vue"],
    })).toBe(true)
    expect(evaluateWhenClause("resourceExtname not in disabledExtnames", {
      resourceExtname: ".ts",
      disabledExtnames: { ".json": true },
    })).toBe(true)
  })

  it("fails closed for invalid expressions", () => {
    expect(evaluateWhenClause("editorTextFocus && && inputFocus", { editorTextFocus: true })).toBe(false)
  })
})
