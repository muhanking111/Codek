import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearCommands,
  executeCommand,
  getCommand,
  getCommandExecutionErrors,
  getCommandRegistrationDiagnostics,
  getCommands,
  globalCommandService,
  ICommandService,
  registerCommand,
  registerCommandAlias,
  searchCommands,
} from "./commandRegistry"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"

describe("VS Code style command registry", () => {
  beforeEach(() => clearCommands())

  it("registers, filters and executes commands with when clauses", async () => {
    const handler = vi.fn()
    registerCommand({
      id: "workbench.action.files.save",
      title: "保存",
      category: "File",
      when: "editorTextFocus && !readonly",
      handler,
    })

    expect(getCommands({ editorTextFocus: true, readonly: true })).toHaveLength(0)
    expect(getCommands({ editorTextFocus: true, readonly: false })).toHaveLength(1)
    expect(await executeCommand("workbench.action.files.save", [], { editorTextFocus: true, readonly: false })).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("scores exact command ids and titles first", () => {
    registerCommand({ id: "workbench.action.openSettings", title: "打开设置", category: "Preferences" })
    registerCommand({ id: "workbench.action.openKeyboardShortcuts", title: "打开键盘快捷方式", category: "Preferences" })

    expect(searchCommands("workbench.action.openSettings")[0]?.id).toBe("workbench.action.openSettings")
    expect(searchCommands("打开设置")[0]?.id).toBe("workbench.action.openSettings")
  })

  it("uses VS Code-style word and acronym matching for command palette search", () => {
    registerCommand({ id: "workbench.action.openKeyboardShortcuts", title: "Open Keyboard Shortcuts", category: "Preferences" })

    expect(searchCommands("oks")[0]?.id).toBe("workbench.action.openKeyboardShortcuts")
    expect(searchCommands("keyboard shortcuts")[0]?.id).toBe("workbench.action.openKeyboardShortcuts")
  })

  it("uses VS Code-style stacked registrations for the same command id", async () => {
    const first = vi.fn()
    const second = vi.fn()
    const firstDisposable = registerCommand({ id: "workbench.action.save", title: "Save", handler: first })
    const secondDisposable = registerCommand({ id: "workbench.action.save", title: "Save Override", handler: second })

    expect(getCommand("workbench.action.save")?.title).toBe("Save Override")
    expect(await executeCommand("workbench.action.save")).toBe(true)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()

    secondDisposable.dispose()
    expect(getCommand("workbench.action.save")?.title).toBe("Save")
    expect(await executeCommand("workbench.action.save")).toBe(true)
    expect(first).toHaveBeenCalledTimes(1)

    firstDisposable.dispose()
    expect(getCommand("workbench.action.save")).toBeNull()
  })

  it("registers command aliases through the VS Code adapter", async () => {
    const handler = vi.fn()
    registerCommand({ id: "workbench.action.openSettings", title: "Open Settings", handler })
    const alias = registerCommandAlias("workbench.action.openGlobalSettings", "workbench.action.openSettings")

    expect(await executeCommand("workbench.action.openGlobalSettings")).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)

    alias.dispose()
    expect(await executeCommand("workbench.action.openGlobalSettings")).toBe(false)
  })

  it("forwards command arguments through aliases without nesting them", async () => {
    const handler = vi.fn()
    registerCommand({ id: "workbench.action.openRecent", title: "Open Recent", handler })
    registerCommandAlias("openRecent", "workbench.action.openRecent")

    expect(await executeCommand("openRecent", ["D:/Workspace"])).toBe(true)

    expect(handler).toHaveBeenCalledWith("D:/Workspace")
  })

  it("keeps enablement separate from command palette visibility", async () => {
    const handler = vi.fn()
    registerCommand({
      id: "agent.evidence.openTimeline",
      title: "打开智能体证据时间线",
      category: "Agent",
      when: "workspaceTrust",
      precondition: "agentEvidenceAvailable",
      handler,
    })

    expect(getCommands({ workspaceTrust: true, agentEvidenceAvailable: false }).map((command) => command.id)).toEqual([
      "agent.evidence.openTimeline",
    ])
    expect(await executeCommand("agent.evidence.openTimeline", [], {
      workspaceTrust: true,
      agentEvidenceAvailable: false,
    })).toBe(false)
    expect(handler).not.toHaveBeenCalled()

    expect(await executeCommand("agent.evidence.openTimeline", [], {
      workspaceTrust: true,
      agentEvidenceAvailable: true,
    })).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("records command execution errors without swallowing failures", async () => {
    registerCommand({
      id: "agent.evidence.fail",
      title: "Fail",
      handler: () => {
        throw new Error("boom")
      },
    })

    await expect(executeCommand("agent.evidence.fail")).rejects.toThrow("boom")

    expect(getCommandExecutionErrors()).toEqual([
      expect.objectContaining({ id: "agent.evidence.fail", message: "boom" }),
    ])
  })

  it("exposes registration diagnostics for duplicate command ids", () => {
    registerCommand({ id: "agent.evidence.openTimeline", title: "First" })
    registerCommand({ id: "agent.evidence.openTimeline", title: "Second" })

    expect(getCommandRegistrationDiagnostics("agent.evidence.openTimeline")).toEqual({
      id: "agent.evidence.openTimeline",
      active: expect.objectContaining({ title: "Second" }),
      stackDepth: 2,
      duplicateCount: 1,
    })
  })

  it("exposes the shared command registry through a VS Code-style ICommandService", async () => {
    const handler = vi.fn()
    registerCommand({
      id: "workbench.action.openSettings",
      title: "打开设置",
      category: "Preferences",
      handler,
    })

    const collection = new ServiceCollection([ICommandService, globalCommandService])
    const resolved = collection.get(ICommandService)

    expect(resolved).toBe(globalCommandService)
    expect(resolved?._serviceBrand).toBeUndefined()
    expect(resolved?.getCommand("workbench.action.openSettings")?.title).toBe("打开设置")
    expect(resolved?.getCommands().map((command) => command.id)).toContain("workbench.action.openSettings")
    await expect(resolved?.executeCommand("workbench.action.openSettings")).resolves.toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === ICommandService && instance === globalCommandService)).toBe(true)
  })

  it("forwards ICommandService varargs to the same runtime execute path", async () => {
    const handler = vi.fn()
    registerCommand({
      id: "workbench.action.openFile",
      title: "Open File",
      handler,
    })

    await expect(globalCommandService.executeCommand("workbench.action.openFile", "src/main.ts", { preview: false })).resolves.toBe(true)

    expect(handler).toHaveBeenCalledWith("src/main.ts", { preview: false })
  })

  it("executes through ICommandService with the same context precondition contract", async () => {
    const handler = vi.fn()
    registerCommand({
      id: "agent.evidence.openDetail",
      title: "Open Agent Evidence Detail",
      when: "workspaceTrust",
      precondition: "agentEvidenceAvailable",
      handler,
    })

    await expect(globalCommandService.executeCommandWithContext(
      "agent.evidence.openDetail",
      { workspaceTrust: true, agentEvidenceAvailable: false },
      "task-1",
    )).resolves.toBe(false)
    expect(handler).not.toHaveBeenCalled()

    await expect(globalCommandService.executeCommandWithContext(
      "agent.evidence.openDetail",
      { workspaceTrust: true, agentEvidenceAvailable: true },
      "task-1",
    )).resolves.toBe(true)
    expect(handler).toHaveBeenCalledWith("task-1")
  })
})
