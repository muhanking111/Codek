import { beforeEach, describe, expect, it, vi } from "vitest"
import { CancellationTokenSource } from "../vscode-adapter/base/common/cancellation"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import { globalContextKeyService } from "./contextKeys"
import {
  acceptInputBox,
  acceptQuickPick,
  acceptQuickPickMany,
  cancelInputBox,
  cancelQuickPick,
  clearQuickPicks,
  createQuickPickController,
  currentQuickInputContextKey,
  getQuickInputOwnerEvidenceSnapshot,
  IQuickInputService,
  inQuickInputContextKey,
  input,
  pick,
  quickInputContext,
  quickInputHasFocusContextKey,
  quickInputInputFocusContextKey,
  quickInputListFocusContextKey,
  quickInputService,
  quickInputState,
  quickInputTypeContextKey,
  quickInputVisibleContextKey,
  setQuickInputFocusTarget,
  triggerQuickPickItemButton,
  triggerQuickPickSeparatorButton,
  triggerQuickInputButton,
} from "./quickInput"
import { ContextKeyService } from "./contextKeys"

describe("quickInput", () => {
  beforeEach(() => {
    clearQuickPicks()
    globalContextKeyService.updateContext({
      inQuickInput: false,
      quickInputType: undefined,
      currentQuickInput: undefined,
    })
  })

  it("queues VS Code-style quick pick requests and resolves selected items", async () => {
    const result = pick([{ label: "Start Server", value: "start" }], {
      placeHolder: "Select action",
      step: 1,
      totalSteps: 2,
      description: "Choose the next action",
      enabled: false,
      validationMessage: "Select action is temporarily disabled",
      severity: "warning",
    })

    expect(quickInputState.queue).toHaveLength(1)
    expect(quickInputState.queue[0].options.placeHolder).toBe("Select action")
    expect(quickInputState.queue[0].options.step).toBe(1)
    expect(quickInputState.queue[0].options.totalSteps).toBe(2)
    expect(quickInputState.queue[0].options.description).toBe("Choose the next action")
    expect(quickInputState.queue[0].options.enabled).toBe(false)
    expect(quickInputState.queue[0].options.validationMessage).toBe("Select action is temporarily disabled")
    expect(quickInputState.queue[0].options.severity).toBe("warning")

    acceptQuickPick(quickInputState.queue[0].id, { label: "Start Server", value: "start" })
    await expect(result).resolves.toEqual({ label: "Start Server", value: "start" })
    expect(quickInputState.queue).toHaveLength(0)
  })

  it("exposes a VS Code-style QuickInputService facade for pick input and controller creation", async () => {
    const pickResult = quickInputService.pick([{ label: "Open Resource", value: "open" }], { title: "MCP" })
    expect(quickInputState.queue).toHaveLength(1)
    expect(quickInputService.currentQuickInput?.type).toBe("quickPick")
    acceptQuickPick(quickInputState.queue[0].id, { label: "Open Resource", value: "open" })
    await expect(pickResult).resolves.toEqual({ label: "Open Resource", value: "open" })

    const inputController = quickInputService.createInputBox({ prompt: "Value" })
    const inputResult = inputController.show()
    expect(quickInputState.inputQueue[0].id).toBe(inputController.id)
    expect(quickInputService.currentQuickInput?.type).toBe("inputBox")
    acceptInputBox(inputController.id, "done")
    await expect(inputResult).resolves.toBe("done")
  })

  it("exposes showQuickPick and showInputBox aliases backed by the same service state", async () => {
    const pickResult = quickInputService.showQuickPick([{ label: "Open Resource", value: "open" }], { title: "MCP" })
    expect(quickInputState.queue).toHaveLength(1)
    expect(quickInputService.currentQuickInput?.type).toBe("quickPick")
    acceptQuickPick(quickInputState.queue[0].id, { label: "Open Resource", value: "open" })
    await expect(pickResult).resolves.toEqual({ label: "Open Resource", value: "open" })

    const inputResult = quickInputService.showInputBox({ prompt: "Value" })
    expect(quickInputState.inputQueue).toHaveLength(1)
    expect(quickInputService.currentQuickInput?.type).toBe("inputBox")
    acceptInputBox(quickInputState.inputQueue[0].id, "done")
    await expect(inputResult).resolves.toBe("done")
  })

  it("can host AccessibleView-shaped symbol items without claiming the AccessibleViewSymbolQuickPick owner", async () => {
    const result = quickInputService.showQuickPick([
      { label: "Heading One", description: "line 1", value: { lineNumber: 1, column: 1 } },
      { label: "Heading Two", description: "line 8", value: { lineNumber: 8, column: 3 } },
    ], {
      title: "Go to Symbol Accessible View",
      placeHolder: "Type to search symbols",
    })

    expect(quickInputState.queue[0]).toMatchObject({
      type: "quickPick",
      options: {
        title: "Go to Symbol Accessible View",
        placeHolder: "Type to search symbols",
      },
    })
    expect(quickInputService.currentQuickInput?.type).toBe("quickPick")
    expect(quickInputState.queue[0]).not.toHaveProperty("accessibleViewSymbolQuickPickOwner")

    acceptQuickPick(quickInputState.queue[0].id, {
      label: "Heading Two",
      description: "line 8",
      value: { lineNumber: 8, column: 3 },
    })

    await expect(result).resolves.toMatchObject({
      label: "Heading Two",
      value: { lineNumber: 8, column: 3 },
    })
  })

  it("bridges AbortSignal cancellation into showQuickPick and showInputBox", async () => {
    const pickAbort = new AbortController()
    const pickResult = quickInputService.showQuickPick([{ label: "Open Resource", value: "open" }], {}, {}, pickAbort.signal)
    expect(quickInputState.queue).toHaveLength(1)
    pickAbort.abort()

    await expect(pickResult).resolves.toBeUndefined()
    expect(quickInputState.queue).toHaveLength(0)

    const inputAbort = new AbortController()
    const inputResult = quickInputService.showInputBox({ prompt: "Value" }, inputAbort.signal)
    expect(quickInputState.inputQueue).toHaveLength(1)
    inputAbort.abort()

    await expect(inputResult).resolves.toBeUndefined()
    expect(quickInputState.inputQueue).toHaveLength(0)
  })

  it("registers and resolves the VS Code-style IQuickInputService identifier from a service collection", async () => {
    const collection = new ServiceCollection([IQuickInputService, quickInputService])
    const resolved = collection.get(IQuickInputService)
    const singleton = getSingletonServiceDescriptors().find(([id]) => id === IQuickInputService)

    expect(String(IQuickInputService)).toBe("quickInputService")
    expect(resolved).toBe(quickInputService)
    expect(singleton?.[1]).toBe(quickInputService)

    const result = resolved?.pick([{ label: "Injected", value: "injected" }])
    expect(quickInputState.queue).toHaveLength(1)
    expect(resolved?.currentQuickInput?.type).toBe("quickPick")
    acceptQuickPick(quickInputState.queue[0].id, { label: "Injected", value: "injected" })
    await expect(result).resolves.toEqual({ label: "Injected", value: "injected" })
  })

  it("keeps legacy quickInput facade functions as proxies to the registered service", async () => {
    const collection = new ServiceCollection([IQuickInputService, quickInputService])
    const service = collection.get(IQuickInputService)

    const result = pick([{ label: "Legacy proxy", value: "legacy" }])

    expect(service?.currentQuickInput?.id).toBe(quickInputService.currentQuickInput?.id)
    expect(service?.currentQuickInput?.type).toBe("quickPick")
    acceptQuickPick(quickInputState.queue[0].id, { label: "Legacy proxy", value: "legacy" })
    await expect(result).resolves.toEqual({ label: "Legacy proxy", value: "legacy" })
  })

  it("resolves undefined when a quick pick is cancelled", async () => {
    const result = pick([{ label: "Start Server", value: "start" }])
    cancelQuickPick(quickInputState.queue[0].id)

    await expect(result).resolves.toBeUndefined()
  })

  it("queues VS Code-style multi-select quick pick requests", async () => {
    const result = pick([
      { label: "GPT-5", value: "gpt-5", picked: true },
      { label: "Claude", value: "claude" },
    ], { canPickMany: true })

    expect(quickInputState.queue[0].options.canPickMany).toBe(true)
    acceptQuickPickMany(quickInputState.queue[0].id, [
      { label: "GPT-5", value: "gpt-5" },
      { label: "Claude", value: "claude" },
    ])

    await expect(result).resolves.toEqual([
      { label: "GPT-5", value: "gpt-5" },
      { label: "Claude", value: "claude" },
    ])
  })

  it("queues VS Code-style input box requests", async () => {
    const result = input({
      prompt: "Value for ROOT",
      value: "D:/Workspace",
      step: 2,
      totalSteps: 3,
      description: "Enter a workspace root",
      enabled: false,
      validationMessage: "Root is locked",
      severity: "error",
    })

    expect(quickInputState.inputQueue).toHaveLength(1)
    expect(quickInputState.inputQueue[0].options.prompt).toBe("Value for ROOT")
    expect(quickInputState.inputQueue[0].options.step).toBe(2)
    expect(quickInputState.inputQueue[0].options.totalSteps).toBe(3)
    expect(quickInputState.inputQueue[0].options.description).toBe("Enter a workspace root")
    expect(quickInputState.inputQueue[0].options.enabled).toBe(false)
    expect(quickInputState.inputQueue[0].options.validationMessage).toBe("Root is locked")
    expect(quickInputState.inputQueue[0].options.severity).toBe("error")
    acceptInputBox(quickInputState.inputQueue[0].id, "D:/Project")

    await expect(result).resolves.toBe("D:/Project")
  })

  it("resolves undefined when an input box is cancelled", async () => {
    const result = input({ prompt: "Value for ROOT" })
    cancelInputBox(quickInputState.inputQueue[0].id)

    await expect(result).resolves.toBeUndefined()
  })

  it("uses VS Code-style validateInput results before accepting input boxes", async () => {
    const result = input({
      prompt: "Value for ROOT",
      validateInput: (value) => value === "bad"
        ? "Path is invalid"
        : value === "warn"
          ? { content: "Path is unusual", severity: "warning" }
          : undefined,
    })

    expect(quickInputState.inputQueue).toHaveLength(1)
    await acceptInputBox(quickInputState.inputQueue[0].id, "bad")
    expect(quickInputState.inputQueue).toHaveLength(1)
    expect(quickInputState.inputQueue[0].options.validationMessage).toBe("Path is invalid")
    expect(quickInputState.inputQueue[0].options.severity).toBe("error")

    await acceptInputBox(quickInputState.inputQueue[0].id, "warn")
    await expect(result).resolves.toBe("warn")
  })

  it("ignores late input validation after cancellation and clears request state", async () => {
    let finishValidation: ((value: string | undefined) => void) | undefined
    const result = input({
      prompt: "Value for ROOT",
      validateInput: () => new Promise<string | undefined>((resolve) => {
        finishValidation = resolve
      }),
    })

    const id = quickInputState.inputQueue[0].id
    const pending = acceptInputBox(id, "pending")
    cancelInputBox(id)
    finishValidation?.("Too late")
    await pending

    await expect(result).resolves.toBeUndefined()
    expect(quickInputState.inputQueue).toHaveLength(0)
    expect(quickInputContext.inQuickInput).toBe(false)
  })

  it("debounces live validation and discards stale input results", async () => {
    const resolvers = new Map<string, (value: string | undefined) => void>()
    input({
      value: "",
      validateInput: (value) => new Promise<string | undefined>((resolve) => {
        resolvers.set(value, resolve)
      }),
    })
    const request = quickInputState.inputQueue[0]

    request.changeValue?.("old")
    expect(request.validation?.generation).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(resolvers.has("old")).toBe(false)

    request.changeValue?.("new")
    await vi.waitFor(() => expect(resolvers.has("new")).toBe(true), { timeout: 1200 })
    expect(resolvers.has("old")).toBe(false)

    resolvers.get("new")?.(undefined)
    await Promise.resolve()

    expect(request.options.validationMessage).toBeUndefined()
    expect(request.options.severity).toBe("ignore")
    cancelInputBox(request.id)
  })

  it("discards stale live validation promises after a newer request starts", async () => {
    const resolvers = new Map<string, (value: string | undefined) => void>()
    input({
      value: "",
      validateInput: (value) => new Promise<string | undefined>((resolve) => {
        resolvers.set(value, resolve)
      }),
    })
    const request = quickInputState.inputQueue[0]

    request.changeValue?.("old")
    await vi.waitFor(() => expect(resolvers.has("old")).toBe(true), { timeout: 1200 })

    request.changeValue?.("new")
    await vi.waitFor(() => expect(resolvers.has("new")).toBe(true), { timeout: 1200 })

    resolvers.get("new")?.(undefined)
    await Promise.resolve()
    resolvers.get("old")?.("Old error")
    await Promise.resolve()

    expect(request.options.validationMessage).toBeUndefined()
    expect(request.options.severity).toBe("ignore")
    cancelInputBox(request.id)
  })

  it("cancels pending live validation after hide or dispose", async () => {
    vi.useFakeTimers()
    try {
      let resolveValidation: ((value: string | undefined) => void) | undefined
      const controller = quickInputService.createInputBox({
        validateInput: () => new Promise<string | undefined>((resolve) => {
          resolveValidation = resolve
        }),
      })
      const result = controller.show()
      const request = quickInputState.inputQueue[0]

      request.changeValue?.("pending")
      await vi.advanceTimersByTimeAsync(300)
      controller.dispose()
      resolveValidation?.("Too late")
      await Promise.resolve()

      await expect(result).resolves.toBeUndefined()
      expect(quickInputState.inputQueue).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("emits VS Code-style item button events without accepting the pick", async () => {
    const events: unknown[] = []
    const result = pick([
      { label: "README", value: "readme", buttons: [{ id: "attach", tooltip: "Attach to chat" }] },
    ], {}, {
      onDidTriggerItemButton: (event) => events.push(event),
    })

    triggerQuickPickItemButton(
      quickInputState.queue[0].id,
      { label: "README", value: "readme" },
      { id: "attach", tooltip: "Attach to chat" },
    )

    expect(events).toEqual([{
      item: { label: "README", value: "readme", buttons: [{ id: "attach", tooltip: "Attach to chat" }] },
      button: { id: "attach", tooltip: "Attach to chat" },
    }])
    expect(quickInputState.queue).toHaveLength(1)
    cancelQuickPick(quickInputState.queue[0].id)
    await expect(result).resolves.toBeUndefined()
  })

  it("emits VS Code-style separator button events without selecting separators", async () => {
    const separator = { type: "separator" as const, label: "Servers", buttons: [{ id: "refresh", tooltip: "Refresh" }] }
    const events: unknown[] = []
    const controller = createQuickPickController([
      separator,
      { label: "Alpha", value: "alpha" },
    ], {}, {
      onDidTriggerSeparatorButton: (event) => events.push(event),
    })
    const result = controller.show()

    triggerQuickPickSeparatorButton(controller.id, separator, { id: "refresh", tooltip: "Refresh" })

    expect(events).toEqual([{ separator, button: { id: "refresh", tooltip: "Refresh" } }])
    expect(controller.activeItems).toEqual([])
    expect(controller.selectedItems).toEqual([])
    expect(quickInputState.queue).toHaveLength(1)
    cancelQuickPick(controller.id)
    await expect(result).resolves.toBeUndefined()
  })

  it("cancels quick picks when a VS Code cancellation token fires", async () => {
    const cts = new CancellationTokenSource()
    const result = pick([{ label: "Start Server", value: "start" }], {}, {}, cts.token)

    expect(quickInputState.queue).toHaveLength(1)
    cts.cancel()

    await expect(result).resolves.toBeUndefined()
    expect(quickInputState.queue).toHaveLength(0)
  })

  it("exposes VS Code-style quick pick hide and dispose lifecycle events", async () => {
    const controller = createQuickPickController([{ label: "README", value: "readme" }], { title: "Files" })
    const events: string[] = []
    controller.onWillHide((event) => events.push(`will:${event.reason}`))
    controller.onDidHide((event) => events.push(`did:${event.reason}`))
    controller.onDispose(() => events.push("dispose"))

    const result = controller.show()
    expect(quickInputState.queue).toHaveLength(1)

    controller.hide("blur")
    await expect(result).resolves.toBeUndefined()
    expect(events).toEqual(["will:blur", "did:blur"])

    controller.dispose()
    expect(events).toEqual(["will:blur", "did:blur", "dispose"])
  })

  it("orders accept selection before willHide and clears context before didHide", async () => {
    const controller = createQuickPickController([{ label: "README", value: "readme" }], { title: "Files" })
    const events: string[] = []
    controller.onDidChangeSelection((items) => events.push(`selection:${items.map((item) => item.label).join(",")}`))
    controller.onWillHide((event) => events.push(`will:${event.reason}:${quickInputContext.inQuickInput}`))
    controller.onDidHide((event) => events.push(`did:${event.reason}:${quickInputContext.inQuickInput}`))

    const result = controller.show()
    acceptQuickPick(controller.id, { label: "README", value: "readme" })

    await expect(result).resolves.toEqual({ label: "README", value: "readme" })
    expect(events).toEqual([
      "selection:README",
      "will:accept:true",
      "did:accept:false",
    ])
    expect(quickInputContext.inQuickInput).toBe(false)
    expect(inQuickInputContextKey.getValue(globalContextKeyService)).toBe(false)
  })

  it("accepts and clears VS Code-style quick navigate state once", async () => {
    const controller = createQuickPickController([
      { label: "Alpha", value: "alpha" },
      { label: "Beta", value: "beta" },
    ], { quickNavigate: true })
    const events: string[] = []
    controller.onDidChangeSelection((items) => events.push(`selection:${items.map((item) => item.label).join(",")}`))
    controller.onWillHide((event) => events.push(`will:${event.reason}`))

    const result = controller.show()
    controller.navigate(true, true)

    expect(controller.activeItems.map((item) => item.label)).toEqual(["Beta"])
    expect(quickInputState.queue[0].quickNavigateActive).toBe(true)

    controller.acceptQuickNavigate()

    await expect(result).resolves.toEqual({ label: "Beta", value: "beta" })
    expect(events).toEqual(["selection:Beta", "will:accept"])
    expect(quickInputState.queue).toHaveLength(0)

    const second = createQuickPickController([{ label: "Gamma", value: "gamma" }], { quickNavigate: true })
    const secondResult = second.show()
    second.navigate(true, true)
    second.hide("cancel")
    await expect(secondResult).resolves.toBeUndefined()
    expect(second.quickNavigateActive).toBe(false)
  })

  it("supports VS Code-style quick pick value, busy and item updates", async () => {
    const controller = createQuickPickController([{ label: "Initial", value: "initial" }], { value: "" })
    const changedValues: string[] = []
    controller.onDidChangeValue((value) => changedValues.push(value))

    const result = controller.show()
    expect(quickInputState.queue[0].value).toBe("")

    controller.setValue("src/")
    expect(changedValues).toEqual(["src/"])
    expect(quickInputState.queue[0].value).toBe("src/")

    controller.setBusy(true)
    expect(quickInputState.queue[0].options.busy).toBe(true)

    controller.setItems([{ label: "src/main.ts", value: "src/main.ts" }])
    expect(quickInputState.queue[0].items).toEqual([{ label: "src/main.ts", value: "src/main.ts" }])

    acceptQuickPick(quickInputState.queue[0].id, { label: "src/main.ts", value: "src/main.ts" })
    await expect(result).resolves.toEqual({ label: "src/main.ts", value: "src/main.ts" })
  })

  it("tracks VS Code-style quick tree active and selected items through the controller", async () => {
    const controller = createQuickPickController([
      { label: "Initial", value: "initial" },
      { label: "Second", value: "second" },
    ], { canPickMany: true })
    const activeEvents: string[][] = []
    const selectionEvents: string[][] = []
    controller.onDidChangeActive((items) => activeEvents.push(items.map((item) => item.label)))
    controller.onDidChangeSelection((items) => selectionEvents.push(items.map((item) => item.label)))

    const result = controller.show()
    controller.setActiveItems([{ label: "Second", value: "second" }])
    controller.setSelectedItems([
      { label: "Initial", value: "initial" },
      { label: "Second", value: "second" },
    ])

    expect(controller.activeItems.map((item) => item.label)).toEqual(["Second"])
    expect(controller.selectedItems.map((item) => item.label)).toEqual(["Initial", "Second"])
    expect(quickInputState.queue[0].activeItems?.map((item) => item.label)).toEqual(["Second"])
    expect(quickInputState.queue[0].selectedItems?.map((item) => item.label)).toEqual(["Initial", "Second"])
    expect(activeEvents).toEqual([["Second"]])
    expect(selectionEvents).toEqual([["Initial", "Second"]])

    acceptQuickPickMany(controller.id, quickInputState.queue[0].selectedItems || [])
    await expect(result).resolves.toEqual([
      { label: "Initial", value: "initial" },
      { label: "Second", value: "second" },
    ])
  })

  it("emits VS Code-style titlebar button events for quick picks", async () => {
    const controller = createQuickPickController([{ label: "README", value: "readme" }], {
      buttons: [{ id: "back", tooltip: "Back" }],
    })
    const events: unknown[] = []
    controller.onDidTriggerButton((button) => events.push(button))
    const result = controller.show()

    triggerQuickInputButton(controller.id, { id: "back", tooltip: "Back" })

    expect(events).toEqual([{ id: "back", tooltip: "Back" }])
    expect(quickInputState.queue).toHaveLength(1)
    cancelQuickPick(controller.id)
    await expect(result).resolves.toBeUndefined()
  })

  it("ignores titlebar button events that are not declared on the active quick input", async () => {
    const controller = createQuickPickController([{ label: "README", value: "readme" }], {
      buttons: [{ id: "back", tooltip: "Back" }],
    })
    const events: unknown[] = []
    controller.onDidTriggerButton((button) => events.push(button))
    const result = controller.show()

    triggerQuickInputButton(controller.id, { id: "refresh", tooltip: "Refresh" })

    expect(events).toEqual([])
    expect(quickInputState.queue).toHaveLength(1)
    cancelQuickPick(controller.id)
    await expect(result).resolves.toBeUndefined()
  })

  it("tracks VS Code-style currentQuickInput and context keys for quick picks", async () => {
    const controller = createQuickPickController([{ label: "README", value: "readme" }], { title: "Files" })
    const result = controller.show()

    expect(quickInputContext.inQuickInput).toBe(true)
    expect(quickInputContext.quickInputType).toBe("quickPick")
    expect(quickInputContext.currentQuickInput?.id).toBe(controller.id)
    expect(quickInputContext.currentQuickInput?.type).toBe("quickPick")
    expect(inQuickInputContextKey.getValue(globalContextKeyService)).toBe(true)
    expect(quickInputTypeContextKey.getValue(globalContextKeyService)).toBe("quickPick")
    expect(currentQuickInputContextKey.getValue(globalContextKeyService)).toBe(controller.id)
    expect(quickInputVisibleContextKey.getValue(globalContextKeyService)).toBe(true)
    expect(quickInputHasFocusContextKey.getValue(globalContextKeyService)).toBe(true)
    expect(quickInputInputFocusContextKey.getValue(globalContextKeyService)).toBe(true)
    expect(quickInputListFocusContextKey.getValue(globalContextKeyService)).toBe(false)
    expect(globalContextKeyService.contextMatchesRules("inQuickInput && quickInputType == quickPick")).toBe(true)

    setQuickInputFocusTarget(controller.id, "list")
    expect(quickInputInputFocusContextKey.getValue(globalContextKeyService)).toBe(false)
    expect(quickInputListFocusContextKey.getValue(globalContextKeyService)).toBe(true)

    cancelQuickPick(quickInputState.queue[0].id)
    await expect(result).resolves.toBeUndefined()
    expect(quickInputContext.inQuickInput).toBe(false)
    expect(quickInputContext.quickInputType).toBeUndefined()
    expect(quickInputContext.currentQuickInput).toBeUndefined()
    expect(inQuickInputContextKey.getValue(globalContextKeyService)).toBe(false)
    expect(quickInputVisibleContextKey.getValue(globalContextKeyService)).toBe(false)
    expect(quickInputHasFocusContextKey.getValue(globalContextKeyService)).toBe(false)
    expect(quickInputInputFocusContextKey.getValue(globalContextKeyService)).toBe(false)
    expect(quickInputListFocusContextKey.getValue(globalContextKeyService)).toBe(false)
    expect(quickInputTypeContextKey.getValue(globalContextKeyService)).toBeUndefined()
    expect(currentQuickInputContextKey.getValue(globalContextKeyService)).toBeUndefined()
  })

  it("tracks VS Code-style currentQuickInput and context keys for input boxes", async () => {
    const result = input({ prompt: "Value for ROOT" })

    expect(quickInputContext.inQuickInput).toBe(true)
    expect(quickInputContext.quickInputType).toBe("inputBox")
    expect(quickInputContext.currentQuickInput?.type).toBe("inputBox")
    expect(globalContextKeyService.contextMatchesRules("inQuickInput && quickInputType == inputBox")).toBe(true)

    cancelInputBox(quickInputState.inputQueue[0].id)
    await expect(result).resolves.toBeUndefined()
    expect(quickInputContext.inQuickInput).toBe(false)
    expect(quickInputContext.quickInputType).toBeUndefined()
    expect(quickInputContext.currentQuickInput).toBeUndefined()
  })

  it("updates QuickInput context keys in a scoped context without mutating the global service", async () => {
    const scopedContextKeyService = globalContextKeyService.createScoped()
    const service = quickInputService.createScoped(scopedContextKeyService)
    const result = service.pick([{ label: "Scoped", value: "scoped" }])

    expect(service.currentQuickInput?.type).toBe("quickPick")
    expect(inQuickInputContextKey.getValue(scopedContextKeyService)).toBe(true)
    expect(quickInputTypeContextKey.getValue(scopedContextKeyService)).toBe("quickPick")
    expect(currentQuickInputContextKey.getValue(scopedContextKeyService)).toBe(service.currentQuickInput?.id)
    expect(inQuickInputContextKey.getValue(globalContextKeyService)).toBe(false)

    cancelQuickPick(quickInputState.queue[0].id)
    await expect(result).resolves.toBeUndefined()
    expect(inQuickInputContextKey.getValue(scopedContextKeyService)).toBe(false)
    scopedContextKeyService.dispose()
  })

  it("resolves scoped QuickInput services through IQuickInputService without sharing context state", async () => {
    const scopedContextKeyService = globalContextKeyService.createScoped()
    const scopedService = quickInputService.createScoped(scopedContextKeyService)
    const collection = new ServiceCollection([IQuickInputService, scopedService])

    const result = collection.get(IQuickInputService)?.createInputBox({ prompt: "Scoped value" }).show()

    expect(scopedService.currentQuickInput?.type).toBe("inputBox")
    expect(quickInputService.currentQuickInput).toBeUndefined()
    expect(inQuickInputContextKey.getValue(scopedContextKeyService)).toBe(true)
    expect(inQuickInputContextKey.getValue(globalContextKeyService)).toBe(false)

    acceptInputBox(quickInputState.inputQueue[0].id, "done")
    await expect(result).resolves.toBe("done")
    expect(inQuickInputContextKey.getValue(scopedContextKeyService)).toBe(false)
    expect(inQuickInputContextKey.getValue(globalContextKeyService)).toBe(false)
    scopedContextKeyService.dispose()
  })

  it("can create an isolated QuickInput service backed by an explicit scoped context service", async () => {
    const parent = new ContextKeyService({ resourceLangId: "typescript" })
    const scoped = parent.createScoped()
    const service = quickInputService.createScoped(scoped)
    const result = service.input({ prompt: "Value" })

    expect(scoped.contextMatchesRules("resourceLangId == typescript && inQuickInput && quickInputType == inputBox")).toBe(true)
    expect(parent.getContextKeyValue("inQuickInput")).toBeUndefined()

    cancelInputBox(quickInputState.inputQueue[0].id)
    await expect(result).resolves.toBeUndefined()
    expect(scoped.contextMatchesRules("!inQuickInput")).toBe(true)
    scoped.dispose()
  })

  it("projects QuickInput owner evidence from the service queue without marking the blocked shell UI owner connected", async () => {
    const controller = createQuickPickController([
      { label: "Open README", value: "readme", buttons: [{ id: "open-side", tooltip: "Open to side" }] },
    ], {
      title: "Files",
      buttons: [{ id: "back", tooltip: "Back" }],
      renderLimit: 20,
    })
    const result = controller.show()
    controller.setActiveItems([{ label: "Open README", value: "readme", buttons: [{ id: "open-side", tooltip: "Open to side" }] }])

    const evidence = getQuickInputOwnerEvidenceSnapshot()

    expect(evidence.stateSource).toBe("quickInputService.queue+QuickWidget")
    expect(evidence.quickInputOwner).toMatchObject({
      owner: "IQuickInputService/WorkbenchQuickInputService",
      stateSource: "quickInputService.queue",
      connected: true,
      noSecondStateSource: true,
      readonlyEvidence: true,
    })
    expect(evidence.quickInputOwner.currentQuickInput).toEqual({ id: controller.id, type: "quickPick" })
    expect(evidence.quickInputOwner.activeRequestIds).toEqual([controller.id])
    expect(evidence.quickInputOwner.writesUserSettingsFile).toBe(false)
    expect(evidence.quickWidgetOwner).toMatchObject({
      owner: "QuickWidget",
      stateSource: "QuickWidget.tree+options",
      connected: true,
      readonlyEvidence: true,
    })
    expect(evidence.quickWidgetOwner.activeItemLabels).toEqual(["Open README"])
    expect(evidence.quickWidgetOwner.titlebarButtonIds).toEqual(["back"])
    expect(evidence.quickWidgetOwner.itemButtonIds).toEqual(["open-side"])
    expect(evidence.remainingUiOwnerGap).toMatchObject({
      owner: "Workbench CommandPalette/F1 shell",
      state: "blocked",
      connected: false,
      nextOwnerFiles: ["App.vue", "components/CommandPalette.vue", "generic workbench shell"],
    })

    cancelQuickPick(controller.id)
    await expect(result).resolves.toBeUndefined()
  })
})
