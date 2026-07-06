import { beforeEach, describe, expect, it } from "vitest"
import { MenuId, MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import {
  buildMenubarProjection,
  flattenMenuActions,
  getPreparedMenuDefinitionEntries,
  getPreparedMenuEntries,
  isMenuEntryEnabled,
  menuDefinitions,
  type MenuSubmenu,
} from "./menuModel"

describe("menuModel", () => {
  beforeEach(() => {
    MenuRegistry.clear()
  })

  it("exposes the Cursor-style top-level menu groups", () => {
    expect(menuDefinitions.map((menu) => menu.label)).toEqual([
      "文件(F)",
      "编辑(E)",
      "选择(S)",
      "视图(V)",
      "转到(G)",
      "帮助(H)",
    ])
  })

  it("uses 设置 as the file settings submenu and includes VS Code-compatible settings", () => {
    const fileMenu = menuDefinitions.find((menu) => menu.id === "file")
    const settingsMenu = fileMenu?.items.find((entry) => entry.type === "submenu" && entry.id === "settings") as MenuSubmenu | undefined

    expect(settingsMenu?.label).toBe("设置")
    expect(settingsMenu?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "item", label: "Codek 设置", action: "openCodekSettings" }),
        expect.objectContaining({ type: "item", label: "VS Code 兼容设置", action: "openVsCodeSettings" }),
        expect.objectContaining({ type: "item", label: "设置 JSON", action: "openSettingsJson" }),
        expect.objectContaining({ type: "item", label: "快捷键 JSON", action: "openKeybindingsJson" }),
      ]),
    )
  })

  it("keeps unavailable editor actions disabled when no editor is active", () => {
    const editMenu = menuDefinitions.find((menu) => menu.id === "edit")
    const undo = flattenMenuActions(editMenu?.items ?? []).find((item) => item.action === "undo")

    expect(undo).toBeTruthy()
    expect(isMenuEntryEnabled(undo!, { hasEditor: false })).toBe(false)
    expect(isMenuEntryEnabled(undo!, { hasEditor: true })).toBe(true)
  })

  it("prepares menu entries with VS Code-style hidden filtering without hiding disabled commands", () => {
    const prepared = getPreparedMenuEntries(
      [
        { type: "separator" },
        { type: "item", id: "disabled", label: "Disabled", action: "undo", enabled: () => false },
        { type: "separator" },
        { type: "item", id: "hidden", label: "Hidden", action: "redo", visible: () => false },
        { type: "separator" },
      ],
      {},
    )

    expect(prepared).toEqual([expect.objectContaining({ id: "disabled" })])
    expect(isMenuEntryEnabled(prepared[0], {})).toBe(false)
  })

  it("merges VS Code-style menu contributions into the matching Codek menubar model", () => {
    MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
      command: {
        id: "agent.evidence.openTimeline",
        title: "打开智能体证据时间线",
        precondition: "agentEvidenceAvailable",
      },
      group: "navigation",
      order: -1,
      when: "hasWorkspace",
    })

    const viewMenu = menuDefinitions.find((menu) => menu.id === "view")!
    const entries = getPreparedMenuDefinitionEntries(viewMenu, {
      hasWorkspace: true,
      agentEvidenceAvailable: false,
    })

    const contributed = entries.find((entry) => entry.type === "item" && entry.id === "agent.evidence.openTimeline")

    expect(contributed).toEqual(expect.objectContaining({
      id: "agent.evidence.openTimeline",
      label: "打开智能体证据时间线",
    }))
    expect(isMenuEntryEnabled(contributed!, {})).toBe(false)
  })

  it("projects contributed menu when clauses through the Codek menubar context", () => {
    MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
      command: {
        id: "agent.evidence.openTimeline",
        title: "打开智能体证据时间线",
      },
      group: "navigation",
      order: -1,
      when: "agentEvidenceAvailable && resourceLangId == typescript",
    })

    const goMenu = menuDefinitions.find((menu) => menu.id === "go")!

    expect(getPreparedMenuDefinitionEntries(goMenu, {
      agentEvidenceAvailable: true,
      resourceLangId: "plaintext",
    }).some((entry) => entry.type === "item" && entry.id === "agent.evidence.openTimeline")).toBe(false)
    expect(getPreparedMenuDefinitionEntries(goMenu, {
      agentEvidenceAvailable: true,
      resourceLangId: "typescript",
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "item",
        id: "agent.evidence.openTimeline",
        action: "agent.evidence.openTimeline",
      }),
    ]))
  })

  it("builds a single menubar projection from Codek definitions and VS Code-style contributions", () => {
    MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
      command: {
        id: "agent.evidence.openDetail",
        title: "打开智能体证据详情",
        precondition: "agentEvidenceAvailable",
      },
      group: "navigation",
      order: -10,
      when: "hasWorkspace",
    })

    const projection = buildMenubarProjection({
      hasWorkspace: true,
      agentEvidenceAvailable: false,
    })
    const help = projection.menus.find((menu) => menu.id === "help")

    expect(projection).toEqual(expect.objectContaining({
      schemaVersion: 1,
      source: "menuModel",
      noSecondMenuState: true,
    }))
    expect(projection.menuIds).toEqual(["file", "edit", "selection", "view", "go", "help"])
    expect(projection.actionIds).toContain("agent.evidence.openDetail")
    expect(help).toEqual(expect.objectContaining({
      id: "help",
      vscodeMenuId: "MenubarHelpMenu",
      actionIds: expect.arrayContaining(["agent.evidence.openDetail"]),
    }))
    expect(help?.entries.find((entry) => entry.id === "agent.evidence.openDetail")).toEqual(expect.objectContaining({
      id: "agent.evidence.openDetail",
      action: "agent.evidence.openDetail",
      enabled: false,
      source: "vscode",
    }))
  })
})
