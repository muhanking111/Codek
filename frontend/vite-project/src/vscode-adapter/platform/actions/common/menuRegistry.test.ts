import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearCommands, executeCommand, getCommand } from "../../../../workbench/commandRegistry"
import { clearKeybindings, handleKeyEvent, setKeybindingContext } from "../../../../keybindings"
import { Action2, MenuId, MenuRegistry, prepareMenuEntries, registerAction2 } from "./menuRegistry"

interface TestContext {
  active?: boolean
}

describe("prepareMenuEntries", () => {
  beforeEach(() => {
    MenuRegistry.clear()
    clearCommands()
    clearKeybindings()
  })

  it("sorts entries by VS Code-style group and order while preserving declaration order ties", () => {
    const entries = prepareMenuEntries(
      [
        { type: "item", id: "z", group: "9_other", order: 2 },
        { type: "item", id: "nav2", group: "navigation", order: 2 },
        { type: "item", id: "nav1", group: "navigation", order: 1 },
        { type: "item", id: "inline", group: "inline", order: 1 },
        { type: "item", id: "a", group: "9_other", order: 1 },
      ],
      {},
    )

    expect(entries.map((entry) => entry.id)).toEqual(["nav1", "nav2", "inline", "a", "z"])
  })

  it("filters hidden entries before removing redundant separators", () => {
    const entries = prepareMenuEntries(
      [
        { type: "separator" },
        { type: "item", id: "hidden", visible: (context) => Boolean(context.active) },
        { type: "separator" },
        { type: "separator" },
        { type: "item", id: "visible" },
        { type: "separator" },
      ],
      { active: false },
    )

    expect(entries.map((entry) => entry.type === "separator" ? "separator" : entry.id)).toEqual(["visible"])
  })

  it("prepares submenu children recursively", () => {
    const entries = prepareMenuEntries(
      [
        {
          type: "submenu",
          id: "submenu",
          items: [
            { type: "separator" },
            { type: "item", id: "enabled" },
            { type: "item", id: "hidden", visible: () => false },
            { type: "separator" },
          ],
        },
      ],
      {},
    )

    expect(entries[0].items?.map((entry) => entry.type === "separator" ? "separator" : entry.id)).toEqual(["enabled"])
  })

  it("registers Action2 commands, command palette entries, menu items and keybindings", async () => {
    const run = vi.fn()
    class OpenAgentEvidenceAction extends Action2 {
      constructor() {
        super({
          id: "agent.evidence.openTimeline",
          title: { value: "打开智能体证据时间线" },
          category: { value: "Agent" },
          f1: true,
          precondition: "agentEvidenceAvailable",
          menu: {
            id: MenuId.AgentEvidenceTimeline,
            group: "navigation",
            order: 1,
            when: "workspaceTrust",
          },
          keybinding: {
            key: "e",
            ctrl: true,
            shift: true,
            alt: false,
            weight: 250,
            when: "agentEvidenceAvailable",
          },
          metadata: {
            description: "Open Agent evidence timeline",
            args: [{ name: "taskId", isOptional: true, constraint: "string" }],
          },
        })
      }

      override run(_accessor: unknown, taskId?: unknown): void {
        run(taskId)
      }
    }

    const disposable = registerAction2(OpenAgentEvidenceAction)

    expect(getCommand("agent.evidence.openTimeline")?.title).toBe("打开智能体证据时间线")
    expect(run).not.toHaveBeenCalled()
    expect(MenuRegistry.getOwnerEvidenceSnapshot()).toEqual({
      owner: "MenuRegistry",
      stateSource: "MenuRegistry.commands+menuItems",
      connected: true,
      noSecondStateSource: true,
      readonlyEvidence: true,
      commandIds: ["agent.evidence.openTimeline"],
      menuIds: ["AgentEvidenceTimeline", "CommandPalette"],
      menuItemCount: 2,
    })
    expect(MenuRegistry.getMenuEntries(MenuId.CommandPalette, { agentEvidenceAvailable: true }).map((entry) => entry.id)).toContain(
      "agent.evidence.openTimeline",
    )
    expect(MenuRegistry.getMenuEntries(MenuId.AgentEvidenceTimeline, {
      workspaceTrust: true,
      agentEvidenceAvailable: true,
    })).toEqual([
      expect.objectContaining({
        id: "agent.evidence.openTimeline",
        label: "打开智能体证据时间线",
        disabled: false,
      }),
    ])
    expect(MenuRegistry.getMenuEntries(MenuId.AgentEvidenceTimeline, {
      workspaceTrust: true,
      agentEvidenceAvailable: false,
    })[0]).toEqual(expect.objectContaining({ disabled: true }))

    await executeCommand("agent.evidence.openTimeline", ["task-1"], { agentEvidenceAvailable: true })
    expect(run).toHaveBeenCalledWith("task-1")

    setKeybindingContext({ agentEvidenceAvailable: true })
    expect(handleKeyEvent(new KeyboardEvent("keydown", {
      key: "e",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }))).toBe(true)
    await vi.dynamicImportSettled()
    expect(run).toHaveBeenCalledWith(undefined)

    disposable.dispose()
    expect(getCommand("agent.evidence.openTimeline")).toBeNull()
  })
})
