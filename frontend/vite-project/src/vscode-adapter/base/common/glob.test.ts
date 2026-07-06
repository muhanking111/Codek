import { describe, expect, it } from "vitest"
import { match, parse, splitGlobAware } from "./glob"

describe("VS Code glob adapter", () => {
  it("splits comma patterns without breaking braces or brackets", () => {
    expect(splitGlobAware("src/**/*.{ts,tsx},README.md,assets/[a,b].png", ",")).toEqual([
      "src/**/*.{ts,tsx}",
      "README.md",
      "assets/[a,b].png",
    ])
  })

  it("matches VS Code-style globstar and brace patterns", () => {
    const matcher = parse("src/**/*.{ts,tsx}")
    expect(matcher("src/settings/searchSettings.ts")).toBe(true)
    expect(matcher("src/components/App.tsx")).toBe(true)
    expect(matcher("src/components/App.vue")).toBe(false)
  })

  it("matches basename patterns anywhere in a path", () => {
    expect(match("*.md", "docs/PLAN.md")).toBe(true)
    expect(match("README.md", "packages/app/README.md")).toBe(true)
    expect(match("README.md", "packages/app/README.txt")).toBe(false)
  })

  it("supports character ranges and negated ranges", () => {
    expect(match("test-[0-9].ts", "test-1.ts")).toBe(true)
    expect(match("test-[0-9].ts", "test-a.ts")).toBe(false)
    expect(match("test-[!0-9].ts", "test-a.ts")).toBe(true)
  })

  it("matches expression objects like VS Code glob expressions", () => {
    const matcher = parse({ "**/*.ts": true, "**/*.tsx": true, "**/*.vue": false })
    expect(matcher("src/main.ts")).toBe(true)
    expect(matcher("src/App.tsx")).toBe(true)
    expect(matcher("src/App.vue")).toBe(false)
  })
})
