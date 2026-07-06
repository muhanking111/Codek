import { describe, expect, it } from "vitest"
import {
  getSearchSettings,
  matchesSearchSettings,
  parseSearchPatternInput,
} from "./searchSettings"

describe("searchSettings", () => {
  it("normalizes include and exclude settings", () => {
    expect(
      getSearchSettings({
        "search.include": ["src/**/*.ts", "README.md"],
        "search.exclude": ["node_modules", ".git"],
      }),
    ).toEqual({
      include: ["src/**/*.ts", "README.md"],
      exclude: ["node_modules", ".git"],
    })
  })

  it("parses comma separated search input", () => {
    expect(parseSearchPatternInput("src/**/*.ts, README.md")).toEqual(["src/**/*.ts", "README.md"])
    expect(parseSearchPatternInput(["src/**/*.ts", "", " README.md "])).toEqual([
      "src/**/*.ts",
      "README.md",
    ])
  })

  it("matches simple glob-like include and exclude rules", () => {
    const settings = {
      include: ["src/**/*.ts", "README.md"],
      exclude: ["node_modules", ".git", "dist"],
    }

    expect(matchesSearchSettings("src/settings/searchSettings.ts", settings)).toBe(true)
    expect(matchesSearchSettings("README.md", settings)).toBe(true)
    expect(matchesSearchSettings("src/settings/searchSettings.test.ts", settings)).toBe(true)
    expect(matchesSearchSettings("docs/plan.md", settings)).toBe(false)
    expect(matchesSearchSettings("src/node_modules/pkg/index.ts", settings)).toBe(false)
    expect(matchesSearchSettings(".git/config", settings)).toBe(false)
  })

  it("treats empty include as all files", () => {
    expect(
      matchesSearchSettings("docs/plan.md", {
        include: [],
        exclude: ["node_modules"],
      }),
    ).toBe(true)
  })
})
