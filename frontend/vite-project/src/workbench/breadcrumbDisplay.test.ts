import { describe, expect, it } from "vitest"
import { buildBreadcrumbDisplayModel, symbolLabel } from "./breadcrumbDisplay"

describe("breadcrumbDisplay", () => {
  it("combines file path and outline symbols into VS Code-style breadcrumb elements", () => {
    const model = buildBreadcrumbDisplayModel({
      path: [
        { name: "src", kind: "folder", line: 1 },
        { name: "App.vue", kind: "file", line: 1 },
      ],
      symbols: [
        {
          name: "setup",
          kind: "function",
          icon: "f",
          range: { startLine: 12 },
          children: [{ name: "child", kind: "method", icon: "m", range: { startLine: 18 } }],
        },
      ],
      activeDropdown: 0,
    })

    expect(model.visible).toBe(true)
    expect(model.elements.map((item) => [item.type, item.label, item.targetLine, item.separator])).toEqual([
      ["path", "src", 1, "/"],
      ["path", "App.vue", 1, "|"],
      ["symbol", "setup()", 12, ""],
    ])
    expect(model.elements[2]).toMatchObject({
      dropdownOpen: true,
      children: [{ label: "child()", targetLine: 18, icon: "m", kind: "method" }],
    })
  })

  it("formats symbol labels without leaking raw function kind logic into templates", () => {
    expect(symbolLabel({ name: "run", kind: "function" })).toBe("run()")
    expect(symbolLabel({ name: "save", kind: "method" })).toBe("save()")
    expect(symbolLabel({ name: "User", kind: "class" })).toBe("User")
  })
})
