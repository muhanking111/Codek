import { describe, expect, it, vi } from "vitest"
import { VscodeCommandsRegistry } from "./commandsRegistry"

interface TestCommand {
  id: string
  title: string
  handler?: (...args: unknown[]) => void
  metadata?: import("./commandsRegistry").CommandMetadata
}

describe("VscodeCommandsRegistry", () => {
  it("keeps the newest command registration active and restores the previous one on dispose", () => {
    const registry = new VscodeCommandsRegistry<TestCommand>()
    const first = { id: "workbench.action.test", title: "First" }
    const second = { id: "workbench.action.test", title: "Second" }

    const firstDisposable = registry.registerCommand(first)
    const secondDisposable = registry.registerCommand(second)

    expect(registry.getCommand("workbench.action.test")).toBe(second)

    secondDisposable.dispose()
    expect(registry.getCommand("workbench.action.test")).toBe(first)

    firstDisposable.dispose()
    expect(registry.getCommand("workbench.action.test")).toBeNull()
  })

  it("emits register/unregister events for active command changes", () => {
    const registry = new VscodeCommandsRegistry<TestCommand>()
    const listener = vi.fn()
    registry.onDidChange(listener)

    const disposable = registry.registerCommand({ id: "workbench.action.test", title: "Test" })
    disposable.dispose()

    expect(listener).toHaveBeenNthCalledWith(1, {
      type: "register",
      id: "workbench.action.test",
      command: expect.objectContaining({ title: "Test" }),
    })
    expect(listener).toHaveBeenNthCalledWith(2, {
      type: "unregister",
      id: "workbench.action.test",
      command: null,
    })
  })

  it("supports alias registrations through the same stack semantics", () => {
    const registry = new VscodeCommandsRegistry<TestCommand>()
    registry.registerCommand({ id: "new.command", title: "New" })

    const alias = registry.registerCommandAlias("old.command", "new.command", (oldId, newId) => ({
      id: oldId,
      title: `Alias to ${newId}`,
    }))

    expect(registry.getCommand("old.command")?.title).toBe("Alias to new.command")

    alias.dispose()
    expect(registry.getCommand("old.command")).toBeNull()
  })

  it("validates command arguments from VS Code-style metadata", () => {
    const handler = vi.fn()
    const registry = new VscodeCommandsRegistry<TestCommand>()
    registry.registerCommand({
      id: "workbench.action.openEvidence",
      title: "Open Evidence",
      handler,
      metadata: {
        description: "Open evidence view",
        args: [{ name: "taskId", constraint: "string" }],
      },
    })

    expect(() => registry.getCommand("workbench.action.openEvidence")?.handler?.(42)).toThrow(
      "Invalid argument 'taskId'",
    )
    registry.getCommand("workbench.action.openEvidence")?.handler?.("task-1")
    expect(handler).toHaveBeenCalledWith("task-1")
  })

  it("exposes duplicate diagnostics for command overwrite decisions", () => {
    const registry = new VscodeCommandsRegistry<TestCommand>()
    const first = registry.registerCommand({ id: "agent.evidence.open", title: "First" })
    registry.registerCommand({ id: "agent.evidence.open", title: "Second" })

    expect(registry.getDiagnostics("agent.evidence.open")).toEqual({
      id: "agent.evidence.open",
      active: expect.objectContaining({ title: "Second" }),
      stackDepth: 2,
      duplicateCount: 1,
    })

    first.dispose()
    expect(registry.getDiagnostics("agent.evidence.open").stackDepth).toBe(1)
  })
})
