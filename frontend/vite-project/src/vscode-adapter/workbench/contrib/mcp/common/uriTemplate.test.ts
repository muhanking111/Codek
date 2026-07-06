import { describe, expect, it } from "vitest"
import { UriTemplate } from "./uriTemplate"

describe("VS Code MCP UriTemplate adapter", () => {
  it("resolves simple and prefixed RFC 6570 variables", () => {
    const template = UriTemplate.parse("file:///workspace/{name:4}.txt")

    expect(template.resolve({ name: "readme" })).toBe("file:///workspace/read.txt")
  })

  it("resolves exploded path variables using VS Code semantics", () => {
    const template = UriTemplate.parse("file:///workspace{/path*}")

    expect(template.resolve({ path: ["src", "main.ts"] })).toBe("file:///workspace/src/main.ts")
  })

  it("resolves form query variables without hand-rolled string replacement", () => {
    const template = UriTemplate.parse("https://example.test/search{?q,limit}")

    expect(template.resolve({ q: "mcp server", limit: 20 })).toBe("https://example.test/search?q=mcp%20server&limit=20")
  })
})
