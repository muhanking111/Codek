import { beforeEach, describe, expect, it, vi } from "vitest"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import {
  AccessibilityKeyboardNavigationService,
  AccessibilitySupport,
  IAccessibilityKeyboardNavigationService,
  globalAccessibilityKeyboardNavigationService,
} from "./accessibilityKeyboardNavigationService"
import { ContextKeyService } from "./contextKeys"

describe("AccessibilityKeyboardNavigationService", () => {
  let service: AccessibilityKeyboardNavigationService
  let contextKeyService: ContextKeyService

  beforeEach(() => {
    contextKeyService = new ContextKeyService()
    service = new AccessibilityKeyboardNavigationService({
      now: () => 1000,
      createId: (prefix, index) => `${prefix}-${index}`,
    }, contextKeyService)
  })

  it("registers a VS Code-style service identifier and resolves the singleton through ServiceCollection", () => {
    const collection = new ServiceCollection([IAccessibilityKeyboardNavigationService, globalAccessibilityKeyboardNavigationService])
    const resolved = collection.get(IAccessibilityKeyboardNavigationService)

    expect(resolved).toBe(globalAccessibilityKeyboardNavigationService)
    expect(resolved?._serviceBrand).toBeUndefined()
    expect(getSingletonServiceDescriptors().some(([id, instance]) => (
      id === IAccessibilityKeyboardNavigationService && instance === globalAccessibilityKeyboardNavigationService
    ))).toBe(true)
  })

  it("keeps screen reader optimized mode, context keys, and status projection on one state source", () => {
    const changes: string[] = []
    service.onDidChangeScreenReaderOptimized((snapshot) => changes.push(`${snapshot.screenReaderOptimized}:${snapshot.context.accessibilityModeEnabled}`))

    expect(service.getSnapshot()).toMatchObject({
      accessibilitySupport: AccessibilitySupport.Unknown,
      screenReaderOptimized: false,
      context: { accessibilityModeEnabled: false, keyboardNavigationActive: false },
      status: { visible: false },
    })

    service.setAccessibilitySupport(AccessibilitySupport.Enabled, "screen-reader-detected")
    expect(service.isScreenReaderOptimized()).toBe(true)
    expect(service.getContextKeys()).toMatchObject({
      accessibilityModeEnabled: true,
      screenReaderOptimized: true,
    })
    expect(contextKeyService.getContext()).toMatchObject({
      accessibilityModeEnabled: true,
      screenReaderOptimized: true,
      keyboardNavigationActive: false,
    })
    expect(service.getStatusProjection()).toMatchObject({
      id: "status.editor.screenReaderMode",
      visible: true,
      text: "Screen Reader Optimized",
      ariaLabel: "Screen Reader Optimized",
      command: "showEditorScreenReaderNotification",
      kind: "prominent",
    })

    service.configure({ accessibilitySupport: "off" })
    expect(service.isScreenReaderOptimized()).toBe(false)
    expect(service.getStatusProjection()).toMatchObject({ visible: false })
    expect(contextKeyService.contextMatchesRules("!accessibilityModeEnabled && !screenReaderOptimized")).toBe(true)
    expect(changes).toEqual(["true:true", "false:false"])
  })

  it("projects ARIA alert and status messages through alternating live regions with length limits", () => {
    service.alert("需要审批")
    service.alert("需要审批")
    service.status("后台索引完成")
    service.status("后台索引完成")
    service.status("x".repeat(20005))

    expect(service.getAriaProjection()).toMatchObject({
      alertRegions: [
        { id: "alert-1", role: "alert", ariaAtomic: true, text: "" },
        { id: "alert-2", role: "alert", ariaAtomic: true, text: "需要审批" },
      ],
      statusRegions: [
        { id: "status-1", ariaLive: "polite", ariaAtomic: true, text: "x".repeat(20000) },
        { id: "status-2", ariaLive: "polite", ariaAtomic: true, text: "" },
      ],
    })
  })

  it("manages roving tab index and focus trap order without a second keyboard navigation state", () => {
    service.registerFocusScope({
      id: "quick-access",
      label: "Quick Access",
      trapFocus: true,
      orientation: "vertical",
      items: [
        { id: "open-file", label: "Open File" },
        { id: "commands", label: "Commands" },
        { id: "settings", label: "Settings", disabled: true },
      ],
    })

    expect(service.getKeyboardNavigationModel("quick-access")).toMatchObject({
      id: "quick-access",
      activeItemId: "open-file",
      trapped: true,
      items: [
        { id: "open-file", tabIndex: 0, ariaSelected: true },
        { id: "commands", tabIndex: -1, ariaSelected: false },
        { id: "settings", tabIndex: -1, ariaDisabled: true },
      ],
    })

    expect(service.moveFocus("quick-access", "next")).toBe("commands")
    expect(service.moveFocus("quick-access", "next")).toBe("open-file")
    expect(service.moveFocus("quick-access", "previous")).toBe("commands")

    const model = service.getKeyboardNavigationModel("quick-access")
    expect(model).toMatchObject({ activeItemId: "commands" })
    expect(model?.items.find((item) => item.id === "open-file")).toMatchObject({ tabIndex: -1, ariaSelected: false })
    expect(model?.items.find((item) => item.id === "commands")).toMatchObject({ tabIndex: 0, ariaSelected: true })
    expect(service.getContextKeys()).toMatchObject({
      keyboardNavigationActive: true,
      activeFocusScope: "quick-access",
      activeFocusItem: "commands",
    })
    expect(contextKeyService.contextMatchesRules("keyboardNavigationActive && activeFocusScope == quick-access && activeFocusItem == commands")).toBe(true)
  })

  it("clears keyboard navigation context when a focus scope is disposed", () => {
    const disposable = service.registerFocusScope({
      id: "explorer",
      label: "Explorer",
      items: [
        { id: "src", label: "src" },
      ],
    })

    expect(contextKeyService.getContext()).toMatchObject({
      keyboardNavigationActive: true,
      activeFocusScope: "explorer",
      activeFocusItem: "src",
    })

    disposable.dispose()

    expect(contextKeyService.getContext()).toMatchObject({
      keyboardNavigationActive: false,
      activeFocusScope: "",
      activeFocusItem: "",
    })
  })

  it("clears keyboard navigation context when focus moves in a disabled-only scope", () => {
    service.registerFocusScope({
      id: "empty-actions",
      label: "Empty Actions",
      items: [
        { id: "disabled", label: "Disabled", disabled: true },
      ],
    })

    expect(service.moveFocus("empty-actions", "next")).toBe("")
    expect(contextKeyService.getContext()).toMatchObject({
      keyboardNavigationActive: false,
      activeFocusScope: "",
      activeFocusItem: "",
    })
  })

  it("exposes command keyboard affordances and evidence-safe accessibility actions", () => {
    const ran = vi.fn()
    service.registerAccessibilityAction({
      id: "agent.accessibility.focusEvidence",
      label: "聚焦证据",
      commandId: "agent.evidence.openDetail",
      keybinding: "Ctrl+Alt+E",
      source: "agent",
      run: ran,
    })

    expect(service.getCommandAffordances()).toEqual([
      {
        commandId: "agent.evidence.openDetail",
        label: "聚焦证据",
        keybinding: "Ctrl+Alt+E",
        ariaLabel: "聚焦证据, Ctrl+Alt+E",
        source: "agent",
      },
    ])

    expect(service.invokeAccessibilityAction("agent.accessibility.focusEvidence", {
      target: "evidence-detail",
      rawPath: "D:/Workspace/private/file.ts",
      secret: "token-value",
      line: 42,
    })).toBe(true)
    expect(ran).toHaveBeenCalledTimes(1)
    expect(service.getEvidenceActions()).toEqual([
      {
        id: "action-0",
        actionId: "agent.accessibility.focusEvidence",
        commandId: "agent.evidence.openDetail",
        label: "聚焦证据",
        source: "agent",
        target: "evidence-detail",
        metadata: { line: 42 },
        createdAt: 1000,
      },
    ])
  })
})
