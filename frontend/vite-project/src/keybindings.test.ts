import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearKeybindings,
  findConflictingKeybindings,
  getKeybindingOwnerEvidenceSnapshot,
  getKeybindingForCommand,
  globalKeybindingService,
  handleKeyEvent,
  IKeybindingService,
  overrideKeybinding,
  registerCommandKeybinding,
  registerKeybinding,
  resetAllKeybindings,
  setKeybindingContext,
} from "./keybindings"
import { clearCommands, registerCommand } from "./workbench/commandRegistry"
import { getSingletonServiceDescriptors } from "./vscode-adapter/platform/instantiation/common/extensions"
import { ServiceCollection } from "./vscode-adapter/platform/instantiation/common/serviceCollection"

function keyEvent(key: string, init: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    metaKey: init.metaKey ?? false,
    bubbles: true,
    cancelable: true,
  })
}

describe("keybindings runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    resetAllKeybindings()
    clearKeybindings()
    clearCommands()
  })

  it("runs single-stroke keybindings", () => {
    const action = vi.fn()
    registerKeybinding({
      id: "workbench.action.files.save",
      key: "s",
      ctrl: true,
      shift: false,
      alt: false,
      description: "保存",
      action,
    })

    expect(handleKeyEvent(keyEvent("s", { ctrlKey: true }))).toBe(true)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it("runs VS Code style chord keybindings", () => {
    const action = vi.fn()
    registerKeybinding({
      id: "workbench.action.openGlobalKeybindings",
      key: "s",
      ctrl: true,
      shift: false,
      alt: false,
      description: "打开快捷键",
      action,
    })
    overrideKeybinding("workbench.action.openGlobalKeybindings", {
      sequence: [
        { key: "k", ctrl: true, shift: false, alt: false },
        { key: "s", ctrl: true, shift: false, alt: false },
      ],
    })

    expect(handleKeyEvent(keyEvent("k", { ctrlKey: true }))).toBe(true)
    expect(action).not.toHaveBeenCalled()
    expect(handleKeyEvent(keyEvent("s", { ctrlKey: true }))).toBe(true)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it("clears a pending chord after timeout or wrong second stroke", () => {
    const chordAction = vi.fn()
    const saveAction = vi.fn()
    registerKeybinding({
      id: "workbench.action.openGlobalKeybindings",
      key: "s",
      ctrl: true,
      shift: false,
      alt: false,
      description: "打开快捷键",
      action: chordAction,
    })
    registerKeybinding({
      id: "workbench.action.files.save",
      key: "s",
      ctrl: true,
      shift: false,
      alt: false,
      description: "保存",
      action: saveAction,
    })
    overrideKeybinding("workbench.action.openGlobalKeybindings", {
      sequence: [
        { key: "k", ctrl: true, shift: false, alt: false },
        { key: "s", ctrl: true, shift: false, alt: false },
      ],
    })

    expect(handleKeyEvent(keyEvent("k", { ctrlKey: true }))).toBe(true)
    vi.advanceTimersByTime(3001)
    expect(handleKeyEvent(keyEvent("s", { ctrlKey: true }))).toBe(true)
    expect(chordAction).not.toHaveBeenCalled()
    expect(saveAction).toHaveBeenCalledTimes(1)

    expect(handleKeyEvent(keyEvent("k", { ctrlKey: true }))).toBe(true)
    expect(handleKeyEvent(keyEvent("p", { ctrlKey: true }))).toBe(false)
    expect(chordAction).not.toHaveBeenCalled()
  })

  it("honors simple when clauses", () => {
    const action = vi.fn()
    registerKeybinding({
      id: "workbench.action.files.save",
      key: "s",
      ctrl: true,
      shift: false,
      alt: false,
      description: "保存",
      action,
      when: "editorTextFocus && !inputFocus",
    })

    setKeybindingContext({ editorTextFocus: true, inputFocus: true })
    expect(handleKeyEvent(keyEvent("s", { ctrlKey: true }))).toBe(false)
    expect(action).not.toHaveBeenCalled()

    setKeybindingContext({ inputFocus: false })
    expect(handleKeyEvent(keyEvent("s", { ctrlKey: true }))).toBe(true)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it("uses VS Code resolver ordering where later matching rules win", () => {
    const firstAction = vi.fn()
    const secondAction = vi.fn()
    registerKeybinding({
      id: "first.command",
      key: "s",
      ctrl: true,
      shift: false,
      alt: false,
      description: "first",
      action: firstAction,
    })
    registerKeybinding({
      id: "second.command",
      key: "s",
      ctrl: true,
      shift: false,
      alt: false,
      description: "second",
      action: secondAction,
    })

    expect(handleKeyEvent(keyEvent("s", { ctrlKey: true }))).toBe(true)
    expect(firstAction).not.toHaveBeenCalled()
    expect(secondAction).toHaveBeenCalledTimes(1)
  })

  it("does not let an older chord prefix swallow a later single-stroke binding", () => {
    const chordAction = vi.fn()
    const singleAction = vi.fn()
    registerKeybinding({
      id: "workbench.action.openGlobalKeybindings",
      key: "s",
      ctrl: true,
      shift: false,
      alt: false,
      description: "打开快捷键",
      action: chordAction,
      sequence: [
        { key: "k", ctrl: true, shift: false, alt: false },
        { key: "s", ctrl: true, shift: false, alt: false },
      ],
    })
    registerKeybinding({
      id: "single.command",
      key: "k",
      ctrl: true,
      shift: false,
      alt: false,
      description: "single",
      action: singleAction,
    })

    expect(handleKeyEvent(keyEvent("k", { ctrlKey: true }))).toBe(true)
    expect(singleAction).toHaveBeenCalledTimes(1)
    expect(chordAction).not.toHaveBeenCalled()

    expect(handleKeyEvent(keyEvent("s", { ctrlKey: true }))).toBe(false)
    expect(chordAction).not.toHaveBeenCalled()
  })

  it("uses when clauses to select the active conflicting keybinding", () => {
    const fallbackAction = vi.fn()
    const editorAction = vi.fn()
    registerKeybinding({
      id: "fallback.command",
      key: "s",
      ctrl: true,
      shift: false,
      alt: false,
      description: "fallback",
      action: fallbackAction,
    })
    registerKeybinding({
      id: "editor.command",
      key: "s",
      ctrl: true,
      shift: false,
      alt: false,
      description: "editor",
      action: editorAction,
      when: "editorTextFocus && !inputFocus",
    })

    setKeybindingContext({ editorTextFocus: false, inputFocus: false })
    expect(handleKeyEvent(keyEvent("s", { ctrlKey: true }))).toBe(true)
    expect(fallbackAction).toHaveBeenCalledTimes(1)
    expect(editorAction).not.toHaveBeenCalled()

    setKeybindingContext({ editorTextFocus: true })
    expect(handleKeyEvent(keyEvent("s", { ctrlKey: true }))).toBe(true)
    expect(fallbackAction).toHaveBeenCalledTimes(1)
    expect(editorAction).toHaveBeenCalledTimes(1)
  })

  it("runs command keybinding contributions through the shared command registry and context enablement", async () => {
    const handler = vi.fn()
    registerCommand({
      id: "agent.evidence.openTimeline",
      title: "打开智能体证据时间线",
      precondition: "agentEvidenceAvailable",
      handler,
    })
    registerCommandKeybinding("agent.evidence.openTimeline", {
      key: "e",
      ctrl: true,
      shift: true,
      alt: false,
      when: "agentEvidenceAvailable",
      weight: 250,
    })

    setKeybindingContext({ agentEvidenceAvailable: false })
    expect(handleKeyEvent(keyEvent("e", { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(handler).not.toHaveBeenCalled()

    setKeybindingContext({ agentEvidenceAvailable: true })
    expect(handleKeyEvent(keyEvent("e", { ctrlKey: true, shiftKey: true }))).toBe(true)
    await vi.dynamicImportSettled()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("resolves command keybinding conflicts by weight and active when context", async () => {
    const defaultHandler = vi.fn()
    const editorHandler = vi.fn()
    registerCommand({ id: "workbench.action.defaultSave", title: "Default Save", handler: defaultHandler })
    registerCommand({ id: "workbench.action.editorSave", title: "Editor Save", handler: editorHandler })
    registerCommandKeybinding("workbench.action.defaultSave", {
      key: "s",
      ctrl: true,
      shift: false,
      alt: false,
      weight: 200,
    })
    registerCommandKeybinding("workbench.action.editorSave", {
      key: "s",
      ctrl: true,
      shift: false,
      alt: false,
      when: "editorTextFocus && !inputFocus",
      weight: 300,
    })

    setKeybindingContext({ editorTextFocus: false, inputFocus: false })
    expect(handleKeyEvent(keyEvent("s", { ctrlKey: true }))).toBe(true)
    await vi.dynamicImportSettled()
    expect(defaultHandler).toHaveBeenCalledTimes(1)
    expect(editorHandler).not.toHaveBeenCalled()

    setKeybindingContext({ editorTextFocus: true })
    expect(handleKeyEvent(keyEvent("s", { ctrlKey: true }))).toBe(true)
    await vi.dynamicImportSettled()
    expect(defaultHandler).toHaveBeenCalledTimes(1)
    expect(editorHandler).toHaveBeenCalledTimes(1)
  })

  it("keeps command keybinding contributions addressable through the old command id entry point", () => {
    registerCommandKeybinding("workbench.action.showCommands", {
      key: "p",
      ctrl: true,
      shift: true,
      alt: false,
      when: "workspaceTrust",
    })

    expect(getKeybindingForCommand("workbench.action.showCommands")).toMatchObject({
      key: "p",
      ctrl: true,
      shift: true,
      alt: false,
      when: "workspaceTrust",
    })

    overrideKeybinding("workbench.action.showCommands", {
      key: "k",
      ctrl: true,
      shift: true,
      alt: false,
      when: "agentEvidenceAvailable",
    })

    expect(getKeybindingForCommand("workbench.action.showCommands")).toMatchObject({
      key: "k",
      ctrl: true,
      shift: true,
      alt: false,
      when: "agentEvidenceAvailable",
    })
  })

  it("does not report the command's own generated keybinding id as a conflict", () => {
    registerCommandKeybinding("workbench.action.showCommands", {
      key: "p",
      ctrl: true,
      shift: true,
      alt: false,
    })
    registerCommandKeybinding("workbench.action.quickOpen", {
      key: "p",
      ctrl: true,
      shift: true,
      alt: false,
      weight: 300,
    })

    expect(findConflictingKeybindings("workbench.action.showCommands", {
      key: "p",
      ctrl: true,
      shift: true,
      alt: false,
    }).map((binding) => binding.commandId ?? binding.id)).toEqual(["workbench.action.quickOpen"])
  })

  it("exposes the shared keybinding runtime through a VS Code-style IKeybindingService", () => {
    const action = vi.fn()
    const disposable = globalKeybindingService.registerKeybinding({
      id: "workbench.action.files.save",
      key: "s",
      ctrl: true,
      shift: false,
      alt: false,
      description: "保存",
      action,
    })

    const collection = new ServiceCollection([IKeybindingService, globalKeybindingService])
    const resolved = collection.get(IKeybindingService)

    expect(resolved).toBe(globalKeybindingService)
    expect(resolved?._serviceBrand).toBeUndefined()
    expect(resolved?.getKeybindings().map((binding) => binding.id)).toContain("workbench.action.files.save")
    expect(resolved?.dispatch(keyEvent("s", { ctrlKey: true }))).toBe(true)
    expect(action).toHaveBeenCalledTimes(1)
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === IKeybindingService && instance === globalKeybindingService)).toBe(true)

    disposable.dispose()
    expect(resolved?.getKeybindings().map((binding) => binding.id)).not.toContain("workbench.action.files.save")
  })

  it("projects owner evidence from the existing keybinding resolver and command registry without a second state source", () => {
    registerCommand({
      id: "workbench.action.showCommands",
      title: "Show Commands",
      source: "vscode",
      handler: vi.fn(),
    })
    registerCommandKeybinding("workbench.action.showCommands", {
      key: "p",
      ctrl: true,
      shift: true,
      alt: false,
      when: "workspaceTrust",
      weight: 300,
    })

    const evidence = getKeybindingOwnerEvidenceSnapshot()

    expect(evidence.stateSource).toBe("keybindings.registry+commandRegistry")
    expect(evidence.keybindingServiceOwner).toMatchObject({
      owner: "IKeybindingService/globalKeybindingService",
      stateSource: "keybindings.registry",
      connected: true,
      noSecondStateSource: true,
      readonlyEvidence: true,
      writesUserKeybindingsFile: false,
    })
    expect(evidence.keybindingServiceOwner.commandKeybindingCommandIds).toEqual(["workbench.action.showCommands"])
    expect(evidence.resolverOwner).toMatchObject({
      owner: "CodekKeybindingResolver",
      stateSource: "keybindings.registry -> CodekKeybindingResolver",
      connected: true,
      supportsWhenClauses: true,
      supportsWeights: true,
      supportsUserOverrides: true,
      readonlyEvidence: true,
    })
    expect(evidence.commandRoutingOwner).toMatchObject({
      owner: "ICommandService/globalCommandService",
      stateSource: "commandRegistry",
      connected: true,
      sharedCommandRegistry: true,
      readonlyEvidence: true,
    })
    expect(evidence.commandRoutingOwner.routedCommandIds).toEqual(["workbench.action.showCommands"])
    expect(evidence.remainingUiOwnerGap).toMatchObject({
      owner: "CommandPalette/F1 UI owner",
      state: "partial",
      connected: false,
    })
  })
})
