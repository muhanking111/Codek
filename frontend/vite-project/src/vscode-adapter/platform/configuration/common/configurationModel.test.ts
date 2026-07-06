import { describe, expect, it } from "vitest"
import {
  createConfigurationModel,
  inspectConfigurationRecords,
  isOverrideSection,
  keyFromOverrideIdentifiers,
  mergeConfigurationRecords,
  overrideIdentifiersFromKey,
} from "./configurationModel"

describe("configuration model adapter", () => {
  it("merges settings with later records taking precedence", () => {
    expect(
      mergeConfigurationRecords(
        { "editor.fontSize": 14, "files.autoSave": "off" },
        { "editor.fontSize": 16 },
        { "files.autoSave": "afterDelay" },
      ),
    ).toEqual({ "editor.fontSize": 16, "files.autoSave": "afterDelay" })
  })

  it("merges language override sections across scopes", () => {
    expect(
      mergeConfigurationRecords(
        { "[typescript]": { "editor.tabSize": 2, "editor.insertSpaces": true } },
        { "[typescript]": { "editor.tabSize": 4 } },
      ),
    ).toEqual({ "[typescript]": { "editor.tabSize": 4, "editor.insertSpaces": true } })
  })

  it("detects VS Code override section keys", () => {
    expect(isOverrideSection("[typescript]")).toBe(true)
    expect(isOverrideSection("[typescript][javascript]")).toBe(true)
    expect(isOverrideSection("editor.fontSize")).toBe(false)
    expect(overrideIdentifiersFromKey("[typescript][javascript]")).toEqual(["typescript", "javascript"])
    expect(keyFromOverrideIdentifiers(["typescript", "javascript"])).toBe("[typescript][javascript]")
  })

  it("builds a VS Code style value tree and reads nested sections", () => {
    const model = createConfigurationModel({
      "editor.fontSize": 14,
      "editor.guides.indentation": true,
      "files.autoSave": "off",
    })

    expect(model.getValue("editor.fontSize")).toBe(14)
    expect(model.getValue("editor.guides")).toEqual({ indentation: true })
    expect(model.getValue("files.autoSave")).toBe("off")
    expect(model.keys).toEqual(["editor.fontSize", "editor.guides.indentation", "files.autoSave"])
  })

  it("applies language override identifiers over merged configuration", () => {
    const model = createConfigurationModel({
      "editor.tabSize": 2,
      "editor.insertSpaces": true,
      "[typescript][javascript]": {
        "editor.tabSize": 3,
      },
      "[typescript]": {
        "editor.insertSpaces": false,
      },
    })

    expect(model.override("typescript").getValue("editor.tabSize")).toBe(3)
    expect(model.override("typescript").getValue("editor.insertSpaces")).toBe(false)
    expect(model.override("javascript").getValue("editor.tabSize")).toBe(3)
    expect(model.override("javascript").getValue("editor.insertSpaces")).toBe(true)
    expect(model.getKeysForOverrideIdentifier("typescript")).toEqual([
      "editor.tabSize",
      "editor.insertSpaces",
    ])
    expect(model.getAllOverrideIdentifiers()).toEqual(["typescript", "javascript"])
  })

  it("inspects raw, override-only and merged values", () => {
    const inspected = inspectConfigurationRecords<number>(
      "editor.tabSize",
      "typescript",
      { "editor.tabSize": 2, "[typescript]": { "editor.tabSize": 3 } },
      { "[typescript]": { "editor.tabSize": 4 } },
    )

    expect(inspected.value).toBe(2)
    expect(inspected.override).toBe(4)
    expect(inspected.merged).toBe(4)
    expect(inspected.overrides).toEqual([
      { identifiers: ["typescript"], value: 4 },
    ])
  })
})
