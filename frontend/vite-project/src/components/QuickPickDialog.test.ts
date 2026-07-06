import { mount } from "@vue/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { nextTick } from "vue"
import { clearQuickPicks, createQuickPickController, input, pick, quickInputState } from "../workbench/quickInput"
import QuickPickDialog from "./QuickPickDialog.vue"

describe("QuickPickDialog", () => {
  beforeEach(() => {
    clearQuickPicks()
    document.body.innerHTML = ""
  })

  it("filters and accepts quick pick items with listbox semantics", async () => {
    const result = pick([
      { type: "separator", label: "Status" },
      { label: "Start Server", value: "start" },
      { label: "Stop Server", value: "stop" },
    ], { title: "MCP", placeHolder: "Select action" })

    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    const input = document.body.querySelector(".quick-pick-input") as HTMLInputElement
    expect(input.getAttribute("role")).toBe("combobox")
    expect(document.body.querySelector(".quick-pick-list")?.getAttribute("role")).toBe("listbox")

    input.value = "stop"
    input.dispatchEvent(new Event("input"))
    await nextTick()

    const options = Array.from(document.body.querySelectorAll(".quick-pick-item")) as HTMLButtonElement[]
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toContain("Stop Server")
    options[0].click()

    await expect(result).resolves.toMatchObject({ value: "stop" })
    wrapper.unmount()
  })

  it("exposes a stable smoke contract for real QuickInput UI evidence", async () => {
    const pickResult = pick([{ label: "Open MCP Resource", value: "mcp" }])
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    const quickPick = document.body.querySelector('[data-codek-smoke="quick-input-workbench"]')
    expect(quickPick?.getAttribute("data-quick-input-kind")).toBe("quickPick")
    ;(document.body.querySelector(".quick-pick-item") as HTMLButtonElement).click()
    await expect(pickResult).resolves.toMatchObject({ value: "mcp" })

    const inputResult = input({ title: "Smoke", value: "cancel-me" })
    await nextTick()
    const inputBox = document.body.querySelector('[data-codek-smoke="quick-input-workbench"]')
    expect(inputBox?.getAttribute("data-quick-input-kind")).toBe("inputBox")
    ;(document.body.querySelector(".quick-pick-input") as HTMLInputElement)
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(inputResult).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it("cancels the active quick pick on Escape", async () => {
    const result = pick([{ label: "Start Server", value: "start" }])
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    const input = document.body.querySelector(".quick-pick-input") as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))

    await expect(result).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it("supports VS Code-style multi-select quick picks", async () => {
    const result = pick([
      { label: "GPT-5", value: "gpt-5", picked: true },
      { label: "Claude", value: "claude" },
    ], { title: "Models", canPickMany: true })
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    const checkboxes = Array.from(document.body.querySelectorAll(".quick-pick-checkbox")) as HTMLInputElement[]
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0].checked).toBe(true)
    expect(checkboxes[1].checked).toBe(false)

    checkboxes[1].click()
    await nextTick()
    ;(document.body.querySelector(".quick-pick-ok") as HTMLButtonElement).click()

    await expect(result).resolves.toEqual([
      { label: "GPT-5", value: "gpt-5", picked: true },
      { label: "Claude", value: "claude" },
    ])
    wrapper.unmount()
  })

  it("syncs keyboard focus and checked items back to the VS Code-style QuickTree state", async () => {
    const controller = createQuickPickController([
      { label: "Alpha", value: "alpha" },
      { label: "Beta", value: "beta" },
    ], { title: "Models", canPickMany: true })
    const result = controller.show()
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    const input = document.body.querySelector(".quick-pick-input") as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }))
    await nextTick()

    expect(controller.activeItems.map((item) => item.label)).toEqual(["Beta"])
    expect(quickInputState.queue[0].activeItems?.map((item) => item.label)).toEqual(["Beta"])

    const checkboxes = Array.from(document.body.querySelectorAll(".quick-pick-checkbox")) as HTMLInputElement[]
    checkboxes[1].click()
    await nextTick()

    expect(controller.selectedItems.map((item) => item.label)).toEqual(["Beta"])
    expect(quickInputState.queue[0].selectedItems?.map((item) => item.label)).toEqual(["Beta"])

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(result).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it("keeps separator labels out of active selection and exposes grouped aria text", async () => {
    const controller = createQuickPickController([
      { type: "separator", label: "Group A" },
      { label: "Alpha", value: "alpha" },
      { type: "separator", label: "Group B" },
      { label: "Beta", value: "beta" },
    ], { title: "Grouped" })
    const selectionEvents: string[][] = []
    controller.onDidChangeSelection((items) => selectionEvents.push(items.map((item) => item.label)))
    const result = controller.show()
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    const separators = Array.from(document.body.querySelectorAll(".quick-pick-separator")) as HTMLElement[]
    const options = Array.from(document.body.querySelectorAll(".quick-pick-item")) as HTMLButtonElement[]
    expect(separators.map((separator) => separator.textContent?.trim())).toEqual(["Group A", "Group B"])
    expect(separators[0].getAttribute("role")).toBe("presentation")
    expect(options[0].getAttribute("aria-label")).toContain("Alpha, Group A")
    expect(options[1].getAttribute("aria-label")).toContain("Beta, Group B")

    separators[0].click()
    await nextTick()
    expect(controller.selectedItems).toEqual([])
    expect(selectionEvents).toEqual([])

    options[1].click()
    await expect(result).resolves.toMatchObject({ label: "Beta" })
    wrapper.unmount()
  })

  it("renders separator buttons without making the separator selectable", async () => {
    const separator = {
      type: "separator" as const,
      label: "Servers",
      buttons: [
        { id: "refresh", tooltip: "Refresh" },
        { id: "disabled", tooltip: "Disabled", disabled: true },
      ],
    }
    const events: unknown[] = []
    const controller = createQuickPickController([
      separator,
      { label: "Alpha", value: "alpha" },
    ], {}, {
      onDidTriggerSeparatorButton: (event) => events.push(event),
    })
    const result = controller.show()
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    const separatorElement = document.body.querySelector(".quick-pick-separator") as HTMLElement
    const buttons = Array.from(document.body.querySelectorAll(".quick-pick-separator-button")) as HTMLButtonElement[]
    expect(separatorElement.getAttribute("role")).toBe("presentation")
    expect(buttons).toHaveLength(2)
    expect(buttons[0].disabled).toBe(false)
    expect(buttons[1].disabled).toBe(true)

    separatorElement.click()
    buttons[1].click()
    buttons[0].click()
    await nextTick()

    expect(events).toEqual([{ separator, button: { id: "refresh", tooltip: "Refresh" } }])
    expect(controller.activeItems.map((item) => item.label)).toEqual(["Alpha"])
    expect(controller.selectedItems).toEqual([])
    document.body.querySelector(".quick-pick-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(result).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it("syncs mouse hover and focus back to the VS Code-style QuickTree state", async () => {
    const controller = createQuickPickController([
      { label: "Alpha", value: "alpha" },
      { label: "Beta", value: "beta" },
    ], { title: "Models" })
    const activeEvents: string[][] = []
    controller.onDidChangeActive((items) => activeEvents.push(items.map((item) => item.label)))
    const result = controller.show()
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    const options = Array.from(document.body.querySelectorAll(".quick-pick-item")) as HTMLButtonElement[]
    options[1].dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
    await nextTick()

    expect(controller.activeItems.map((item) => item.label)).toEqual(["Beta"])
    expect(options[1].classList.contains("active")).toBe(true)
    expect(options[1].getAttribute("aria-selected")).toBe("true")

    options[0].dispatchEvent(new FocusEvent("focus", { bubbles: true }))
    await nextTick()

    expect(controller.activeItems.map((item) => item.label)).toEqual(["Alpha"])
    expect(quickInputState.queue[0].activeItems?.map((item) => item.label)).toEqual(["Alpha"])
    expect(activeEvents).toEqual([["Alpha"], ["Beta"], ["Alpha"]])

    document.body.querySelector(".quick-pick-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(result).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it("renders busy enabled validation and selection state as QuickInput DOM state", async () => {
    const controller = createQuickPickController([
      { label: "Alpha", value: "alpha", picked: true },
      { label: "Beta", value: "beta" },
    ], {
      title: "Models",
      canPickMany: true,
      busy: true,
      enabled: false,
      validationMessage: "Loading models",
      severity: "info",
      buttons: [{ id: "back", tooltip: "Back" }],
    })
    const result = controller.show()
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    const root = document.body.querySelector(".quick-pick") as HTMLElement
    expect(root.getAttribute("aria-busy")).toBe("true")
    expect(root.dataset.busy).toBe("true")
    expect(root.dataset.enabled).toBe("false")
    expect(document.body.querySelector(".quick-input-progress")?.getAttribute("aria-hidden")).toBe("false")
    expect(document.body.querySelector(".quick-input-validation")?.classList.contains("severity-info")).toBe(true)

    const titleButton = document.body.querySelector(".quick-pick-title-button") as HTMLButtonElement
    const itemButton = document.body.querySelector(".quick-pick-item") as HTMLButtonElement
    const okButton = document.body.querySelector(".quick-pick-ok") as HTMLButtonElement
    expect(titleButton.disabled).toBe(true)
    expect(itemButton.disabled).toBe(true)
    expect(itemButton.getAttribute("aria-checked")).toBe("true")
    expect(okButton.disabled).toBe(true)

    controller.setBusy(false)
    controller.setEnabled(true)
    controller.setValidationMessage("Select a model", "warning")
    await nextTick()

    expect(root.getAttribute("aria-busy")).toBe("false")
    expect(root.dataset.enabled).toBe("true")
    expect(document.body.querySelector(".quick-input-progress")?.getAttribute("aria-hidden")).toBe("true")
    expect(document.body.querySelector(".quick-input-validation")?.classList.contains("severity-warning")).toBe(true)
    expect(titleButton.disabled).toBe(false)
    expect((document.body.querySelector(".quick-pick-item") as HTMLButtonElement).disabled).toBe(false)
    expect((document.body.querySelector(".quick-pick-ok") as HTMLButtonElement).disabled).toBe(false)

    document.body.querySelector(".quick-pick-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(result).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it("exposes input/list focus and aria-live boundaries", async () => {
    const controller = createQuickPickController([
      { label: "Alpha", value: "alpha" },
      { label: "Beta", value: "beta" },
    ], { title: "Models", canPickMany: true })
    const result = controller.show()
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    const input = document.body.querySelector(".quick-pick-input") as HTMLInputElement
    const list = document.body.querySelector(".quick-pick-list") as HTMLElement
    expect(document.activeElement).toBe(input)
    expect(input.getAttribute("aria-controls")).toBe(list.id)
    expect(input.getAttribute("aria-activedescendant")).toBe("quick-pick-option-0")
    expect(list.getAttribute("aria-live")).toBe("polite")
    expect(list.dataset.focusTarget).toBe("input")

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }))
    await nextTick()
    expect(input.getAttribute("aria-activedescendant")).toBe("quick-pick-option-1")
    expect(list.dataset.focusTarget).toBe("list")

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(result).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it("supports VS Code-style input boxes", async () => {
    const result = input({ title: "MCP", prompt: "Value for ROOT", value: "D:/Workspace" })
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    expect(document.body.querySelector(".quick-input-prompt")?.textContent).toContain("Value for ROOT")
    const textInput = document.body.querySelector(".quick-pick-input") as HTMLInputElement
    expect(textInput.value).toBe("D:/Workspace")
    textInput.value = "D:/Project"
    textInput.dispatchEvent(new Event("input"))
    await nextTick()
    ;(document.body.querySelector(".quick-pick-ok") as HTMLButtonElement).click()

    await expect(result).resolves.toBe("D:/Project")
    wrapper.unmount()
  })

  it("renders VS Code-style step labels for quick picks and input boxes", async () => {
    const quickPickResult = pick([{ label: "One", value: "one" }], { title: "MCP", step: 1, totalSteps: 2 })
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    expect(document.body.querySelector(".quick-pick-step")?.textContent).toBe("1/2")
    document.body.querySelector(".quick-pick-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(quickPickResult).resolves.toBeUndefined()

    const inputResult = input({ title: "MCP", prompt: "Value for path", step: 2, totalSteps: 2 })
    await nextTick()
    expect(document.body.querySelector(".quick-pick-step")?.textContent).toBe("2/2")
    document.body.querySelector(".quick-pick-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(inputResult).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it("renders VS Code-style description and validation messages", async () => {
    const quickPickResult = pick([{ label: "One", value: "one" }], {
      title: "MCP",
      description: "Choose one item",
      validationMessage: "Pick is temporarily unavailable",
      severity: "warning",
    })
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    expect(document.body.querySelector(".quick-input-description")?.textContent).toBe("Choose one item")
    expect(document.body.querySelector(".quick-input-validation")?.textContent).toBe("Pick is temporarily unavailable")
    expect(document.body.querySelector(".quick-input-validation")?.classList.contains("severity-warning")).toBe(true)
    document.body.querySelector(".quick-pick-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(quickPickResult).resolves.toBeUndefined()

    const inputResult = input({
      title: "MCP",
      prompt: "Value for path",
      description: "Enter a path",
      validationMessage: "Path is required",
      severity: "error",
    })
    await nextTick()
    expect(document.body.querySelector(".quick-input-description")?.textContent).toBe("Enter a path")
    expect(document.body.querySelector(".quick-input-validation")?.textContent).toBe("Path is required")
    expect(document.body.querySelector(".quick-input-validation")?.classList.contains("severity-error")).toBe(true)
    document.body.querySelector(".quick-pick-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(inputResult).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it("renders codicon tokens through safe text nodes without raw HTML injection", async () => {
    const result = pick([{
      label: "$(zap) Run <img src=x onerror=alert(1)>",
      description: "$(folder) src/<script>alert(1)</script>",
      detail: "$(warning) 中文详情 <b>unsafe</b>",
      value: "run",
    }], {
      title: "$(command) Command <em>unsafe</em>",
      placeHolder: "$(search) 搜索 <strong>unsafe</strong>",
      validationMessage: "$(warning) 请选择 <strong>命令</strong>",
      severity: "warning",
    })
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    const root = document.body.querySelector(".quick-pick") as HTMLElement
    expect(root.querySelector(".codicon-zap")).not.toBeNull()
    expect(root.querySelector(".codicon-folder")).not.toBeNull()
    expect(root.querySelector(".codicon-warning")).not.toBeNull()
    expect(root.querySelector("img")).toBeNull()
    expect(root.querySelector("script")).toBeNull()
    expect(root.querySelector("strong")).toBeNull()
    expect(root.textContent).toContain("<strong>命令</strong>")

    document.body.querySelector(".quick-pick-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(result).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it("keeps disabled quick inputs visible but prevents accepting", async () => {
    const quickPickResult = pick([{ label: "One", value: "one" }], { enabled: false })
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    const quickPickInput = document.body.querySelector(".quick-pick-input") as HTMLInputElement
    expect(quickPickInput.disabled).toBe(true)
    ;(document.body.querySelector(".quick-pick-item") as HTMLButtonElement).click()
    quickPickInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
    await nextTick()
    expect(document.body.querySelector(".quick-pick-item")).not.toBeNull()
    quickPickInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(quickPickResult).resolves.toBeUndefined()

    const inputResult = input({ enabled: false, value: "locked" })
    await nextTick()
    const inputBox = document.body.querySelector(".quick-pick-input") as HTMLInputElement
    expect(inputBox.disabled).toBe(true)
    ;(document.body.querySelector(".quick-pick-ok") as HTMLButtonElement).click()
    await nextTick()
    expect(document.body.querySelector(".quick-pick-ok")).not.toBeNull()
    inputBox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(inputResult).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it("renders validateInput feedback and only accepts non-error results", async () => {
    const result = input({
      value: "bad",
      validateInput: (value) => value === "bad"
        ? "Path is invalid"
        : { content: "Path is unusual", severity: "warning" },
    })
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    ;(document.body.querySelector(".quick-pick-ok") as HTMLButtonElement).click()
    await nextTick()
    await vi.waitFor(() => expect(document.body.querySelector(".quick-input-validation")?.textContent).toBe("Path is invalid"))
    expect(document.body.querySelector(".quick-input-validation")?.classList.contains("severity-error")).toBe(true)

    const textInput = document.body.querySelector(".quick-pick-input") as HTMLInputElement
    textInput.value = "warn"
    textInput.dispatchEvent(new Event("input"))
    await nextTick()
    ;(document.body.querySelector(".quick-pick-ok") as HTMLButtonElement).click()

    await expect(result).resolves.toBe("warn")
    wrapper.unmount()
  })

  it("ignores late input validation results after hide and clears DOM state", async () => {
    let finishValidation: ((value: string | undefined) => void) | undefined
    const result = input({
      value: "pending",
      validateInput: () => new Promise<string | undefined>((resolve) => {
        finishValidation = resolve
      }),
    })
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    ;(document.body.querySelector(".quick-pick-ok") as HTMLButtonElement).click()
    await nextTick()
    document.body.querySelector(".quick-pick-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(result).resolves.toBeUndefined()

    finishValidation?.(undefined)
    await nextTick()

    expect(quickInputState.inputQueue).toHaveLength(0)
    expect(document.body.querySelector(".quick-pick")).toBeNull()
    wrapper.unmount()
  })

  it("renders VS Code-style item buttons without accepting the item", async () => {
    const events: unknown[] = []
    const result = pick([
      { label: "README", value: "readme", buttons: [{ id: "attach", tooltip: "Attach to chat" }] },
    ], {}, {
      onDidTriggerItemButton: (event) => events.push(event),
    })
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    ;(document.body.querySelector(".quick-pick-button") as HTMLButtonElement).click()
    await nextTick()

    expect(events).toEqual([{
      item: { label: "README", value: "readme", buttons: [{ id: "attach", tooltip: "Attach to chat" }] },
      button: { id: "attach", tooltip: "Attach to chat" },
    }])
    expect(document.body.querySelector(".quick-pick-item")).not.toBeNull()

    document.body.querySelector(".quick-pick-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(result).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it("renders VS Code-style titlebar buttons without closing the quick pick", async () => {
    const controller = createQuickPickController([{ label: "README", value: "readme" }], {
      title: "Files",
      buttons: [{ id: "back", tooltip: "Back" }],
    })
    const events: unknown[] = []
    controller.onDidTriggerButton((button) => events.push(button))
    const result = controller.show()
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    ;(document.body.querySelector(".quick-pick-title-button") as HTMLButtonElement).click()
    await nextTick()

    expect(events).toEqual([{ id: "back", tooltip: "Back" }])
    expect(document.body.querySelector(".quick-pick-item")).not.toBeNull()
    document.body.querySelector(".quick-pick-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(result).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it("propagates quick pick input changes back to the controller", async () => {
    const controller = createQuickPickController([{ label: "Initial", value: "initial" }], { title: "Files" })
    const values: string[] = []
    controller.onDidChangeValue((value) => values.push(value))
    const result = controller.show()
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    const input = document.body.querySelector(".quick-pick-input") as HTMLInputElement
    input.value = "src/"
    input.dispatchEvent(new Event("input"))
    await nextTick()

    expect(values).toEqual(["src/"])

    document.body.querySelector(".quick-pick-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(result).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it("keeps large quick pick rendering bounded while the active item moves", async () => {
    const items = Array.from({ length: 120 }, (_, index) => ({ label: `Item ${index}`, value: index }))
    const controller = createQuickPickController(items, { title: "Large", renderLimit: 30, renderOverscan: 3 })
    const result = controller.show()
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    expect(document.body.querySelectorAll(".quick-pick-item").length).toBeLessThanOrEqual(30)
    expect(document.body.querySelector(".quick-pick-list")?.getAttribute("data-render-window")).toBe("0:30")

    const input = document.body.querySelector(".quick-pick-input") as HTMLInputElement
    for (let index = 0; index < 80; index += 1) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }))
    }
    await nextTick()

    const renderedText = Array.from(document.body.querySelectorAll(".quick-pick-item"))
      .map((item) => item.textContent || "")
      .join("\n")
    expect(document.body.querySelectorAll(".quick-pick-item").length).toBeLessThanOrEqual(30)
    expect(renderedText).toContain("Item 80")
    expect(renderedText).not.toContain("Item 0")
    expect(controller.activeItems.map((item) => item.label)).toEqual(["Item 80"])

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(result).resolves.toBeUndefined()
    wrapper.unmount()
  })

  it("keeps a stable virtual window from list scroll and preserves it across hover, buttons, and checked state", async () => {
    const events: unknown[] = []
    const separator = {
      type: "separator" as const,
      label: "Group 4",
      buttons: [
        { id: "refresh", tooltip: "Refresh" },
        { id: "disabled", tooltip: "Disabled", disabled: true },
      ],
    }
    const items = [
      { type: "separator" as const, label: "Group 0", buttons: [{ id: "top", tooltip: "Top" }] },
      ...Array.from({ length: 38 }, (_, index) => ({ label: `Item ${index}`, value: index })),
      separator,
      { label: "Boundary 0", value: "boundary-0" },
      { label: "Boundary 1", value: "boundary-1" },
      ...Array.from({ length: 80 }, (_, index) => ({ label: `Tail ${index}`, value: `tail-${index}` })),
    ]
    const controller = createQuickPickController<number | string>(items, {
      title: "Virtual",
      canPickMany: true,
      renderLimit: 12,
      renderOverscan: 1,
      rowHeight: 10,
      viewportHeight: 40,
    }, {
      onDidTriggerSeparatorButton: (event) => events.push(event),
    })
    const result = controller.show()
    const wrapper = mount(QuickPickDialog, { attachTo: document.body })
    await nextTick()

    const list = document.body.querySelector(".quick-pick-list") as HTMLElement
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 40 })
    Object.defineProperty(list, "scrollTop", { configurable: true, value: 380, writable: true })
    list.dispatchEvent(new Event("scroll"))
    await nextTick()

    expect(list.getAttribute("data-render-window")).toBe("37:43")
    expect(document.body.textContent).toContain("Group 4")
    expect(document.body.textContent).toContain("Boundary 0")

    const windowBefore = list.getAttribute("data-render-window")
    ;(document.body.querySelector(".quick-pick-separator-button") as HTMLButtonElement).click()
    ;(document.body.querySelectorAll(".quick-pick-separator-button")[1] as HTMLButtonElement).click()
    ;(document.body.querySelector(".quick-pick-item") as HTMLButtonElement).dispatchEvent(new MouseEvent("mouseenter"))
    const boundaryOption = Array.from(document.body.querySelectorAll(".quick-pick-item"))
      .find((item) => item.textContent?.includes("Boundary 0")) as HTMLButtonElement
    ;(boundaryOption.querySelector(".quick-pick-checkbox") as HTMLInputElement).click()
    await nextTick()

    expect(events).toEqual([{ separator, button: { id: "refresh", tooltip: "Refresh" } }])
    expect(list.getAttribute("data-render-window")).toBe(windowBefore)
    expect(controller.selectedItems.map((item) => item.label)).toEqual(["Boundary 0"])

    const input = document.body.querySelector(".quick-pick-input") as HTMLInputElement
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }))
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }))
    await nextTick()
    expect(controller.activeItems.map((item) => item.label)).not.toContain("Group 4")

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await expect(result).resolves.toBeUndefined()
    wrapper.unmount()
  })
})
