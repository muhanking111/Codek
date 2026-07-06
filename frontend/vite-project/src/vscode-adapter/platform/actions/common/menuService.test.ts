import { beforeEach, describe, expect, it } from "vitest"
import { clearCommands, registerCommand } from "../../../../workbench/commandRegistry"
import { ContextKeyService } from "../../contextkey/common/contextkey"
import { getSingletonServiceDescriptors } from "../../instantiation/common/extensions"
import { ServiceCollection } from "../../instantiation/common/serviceCollection"
import { IMenuService, globalMenuService, getMenuContextOwnerEvidence } from "./menuService"
import { MenuId, MenuRegistry } from "./menuRegistry"

describe("MenuService", () => {
  beforeEach(() => {
    MenuRegistry.clear()
    clearCommands()
  })

  it("registers a VS Code-style menu service identifier and singleton", () => {
    const collection = new ServiceCollection([IMenuService, globalMenuService])
    const resolved = collection.get(IMenuService)

    expect(String(IMenuService)).toBe("menuService")
    expect(resolved).toBe(globalMenuService)
    expect(resolved?._serviceBrand).toBeUndefined()
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === IMenuService && instance === globalMenuService)).toBe(true)
  })

  it("groups menu actions through the shared registry and context key service", () => {
    MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
      command: {
        id: "workbench.action.toggleSidebarVisibility",
        title: "切换侧边栏可见性",
        precondition: "sidebarEnabled",
      },
      group: "navigation",
      order: 10,
      when: "hasWorkspace",
    })
    MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
      command: {
        id: "workbench.view.search",
        title: "打开搜索",
      },
      group: "1_views",
      order: 20,
      when: "hasWorkspace",
    })

    const contextKeyService = new ContextKeyService({ hasWorkspace: true, sidebarEnabled: false })
    const groups = globalMenuService.getMenuActions(MenuId.MenubarViewMenu, contextKeyService)

    expect(groups).toEqual([
      ["navigation", [expect.objectContaining({
        commandId: "workbench.action.toggleSidebarVisibility",
        disabled: true,
      })]],
      ["1_views", [expect.objectContaining({
        commandId: "workbench.view.search",
        disabled: false,
      })]],
    ])
  })

  it("fires menu change events for relevant registry and context changes", () => {
    MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
      command: {
        id: "workbench.action.toggleSidebarVisibility",
        title: "切换侧边栏可见性",
        precondition: "sidebarEnabled",
      },
      group: "navigation",
      order: 10,
      when: "hasWorkspace",
    })

    const contextKeyService = new ContextKeyService({ hasWorkspace: true, sidebarEnabled: false })
    const menu = globalMenuService.createMenu(MenuId.MenubarViewMenu, contextKeyService)
    const events: Array<"menu" | "context"> = []

    menu.onDidChange((event) => {
      events.push(event.reason)
    })

    contextKeyService.updateContext({ unrelated: true })
    contextKeyService.updateContext({ sidebarEnabled: true })
    MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
      command: {
        id: "workbench.view.search",
        title: "打开搜索",
      },
      group: "1_views",
      order: 20,
      when: "hasWorkspace",
    })

    expect(events).toEqual(["context", "menu"])
    menu.dispose()
  })

  it("collects context keys from menu items, toggled rules and submenus", () => {
    const Submenu = MenuId.for("CodekTestSubmenu")
    MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
      submenu: Submenu,
      title: "测试子菜单",
      when: "viewMenuVisible",
      group: "1_views",
      order: 10,
    })
    MenuRegistry.appendMenuItem(Submenu, {
      command: {
        id: "workbench.action.toggleSidebarVisibility",
        title: "切换侧边栏可见性",
        precondition: "sidebarEnabled",
        toggled: "sidebarVisible",
      },
      when: "resourceLangId == typescript",
      group: "navigation",
      order: 10,
    })

    expect(globalMenuService.getMenuContexts(MenuId.MenubarViewMenu)).toEqual(new Set([
      "viewMenuVisible",
      "resourceLangId",
      "sidebarEnabled",
      "sidebarVisible",
    ]))
  })

  it("evaluates Testing Explorer ViewTitle and TestItem continuous-run menu metadata from context keys", () => {
    MenuRegistry.appendMenuItem(MenuId.ViewTitle, {
      command: {
        id: "testing.startContinuousRun",
        title: "Start Continuous Run",
      },
      group: "navigation",
      order: 10,
      when: "view == workbench.view.testing.testExplorer && testing.supportsContinuousRun && testing.isContinuousModeOn == false",
    })
    MenuRegistry.appendMenuItem(MenuId.ViewTitle, {
      command: {
        id: "testing.stopContinuousRun",
        title: "Stop Continuous Run",
      },
      group: "navigation",
      order: 10,
      when: "view == workbench.view.testing.testExplorer && testing.supportsContinuousRun && testing.isContinuousModeOn == true",
    })
    MenuRegistry.appendMenuItem(MenuId.TestItem, {
      command: {
        id: "testing.toggleContinuousRunForTest",
        title: "Turn on Continuous Run",
        toggled: "testing.isContinuousModeOn",
      },
      group: "inline",
      order: 20,
      when: "testing.supportsContinuousRun && (testing.isContinuousModeOn == true || testing.isParentRunningContinuously == false)",
    })

    const viewTitleContext = new ContextKeyService({
      view: "workbench.view.testing.testExplorer",
      "testing.supportsContinuousRun": true,
      "testing.isContinuousModeOn": false,
    })
    expect(globalMenuService.getMenuActions(MenuId.ViewTitle, viewTitleContext)).toEqual([
      ["navigation", [expect.objectContaining({
        commandId: "testing.startContinuousRun",
        disabled: false,
      })]],
    ])

    viewTitleContext.updateContext({ "testing.isContinuousModeOn": true })
    expect(globalMenuService.getMenuActions(MenuId.ViewTitle, viewTitleContext)).toEqual([
      ["navigation", [expect.objectContaining({
        commandId: "testing.stopContinuousRun",
        disabled: false,
      })]],
    ])

    const testItemContext = new ContextKeyService({
      "testing.supportsContinuousRun": true,
      "testing.isContinuousModeOn": false,
      "testing.isParentRunningContinuously": false,
    })
    expect(globalMenuService.getMenuActions(MenuId.TestItem, testItemContext)).toEqual([
      ["inline", [expect.objectContaining({
        commandId: "testing.toggleContinuousRunForTest",
        toggled: false,
      })]],
    ])

    testItemContext.updateContext({
      "testing.isContinuousModeOn": false,
      "testing.isParentRunningContinuously": true,
    })
    expect(globalMenuService.getMenuActions(MenuId.TestItem, testItemContext)).toEqual([])

    expect(globalMenuService.getMenuContexts(MenuId.TestItem)).toEqual(new Set([
      "testing.supportsContinuousRun",
      "testing.isContinuousModeOn",
      "testing.isParentRunningContinuously",
    ]))
  })

  it("projects menu, context key and command routing owner evidence without executing command handlers", () => {
    let executed = 0
    registerCommand({
      id: "editor.action.mockContextMenu",
      title: "Mock Context Menu",
      source: "vscode",
      handler: () => { executed += 1 },
    })
    MenuRegistry.appendMenuItem(MenuId.EditorContext, {
      command: {
        id: "editor.action.mockContextMenu",
        title: "Mock Context Menu",
        precondition: "editorTextFocus",
      },
      group: "navigation",
      order: 1,
      when: "resourceLangId == typescript",
    })

    const contextKeyService = new ContextKeyService({
      editorTextFocus: true,
      resourceLangId: "typescript",
    })
    const evidence = getMenuContextOwnerEvidence(MenuId.EditorContext, contextKeyService)

    expect(executed).toBe(0)
    expect(evidence.contextKeyServiceOwner).toMatchObject({
      owner: "IContextKeyService/ContextKeyService",
      stateSource: "ContextKeyService.context",
      activeContextSource: "IContextKeyService.getContext()",
      noSecondStateSource: true,
    })
    expect(evidence.menuRegistryOwner).toMatchObject({
      owner: "MenuRegistry",
      stateSource: "MenuRegistry.commands+menuItems",
      noSecondStateSource: true,
      menuIds: ["EditorContext"],
      menuItemCount: 1,
    })
    expect(evidence.menuServiceOwner).toMatchObject({
      owner: "IMenuService/MenuService",
      stateSource: "MenuRegistry+IContextKeyService",
      activeContextSource: "IContextKeyService.getContext()",
      connected: true,
      noSecondStateSource: true,
      menuId: "EditorContext",
      actionGroupCount: 1,
    })
    expect(evidence.menuServiceOwner.contextKeys).toEqual(["editorTextFocus", "resourceLangId"])
    expect(evidence.commandRoutingOwner).toEqual({
      owner: "MenuRegistry command ids + commandRegistry handlers",
      stateSource: "MenuService.getMenuActions",
      connected: true,
      readonlyEvidence: true,
      routedCommandIds: ["editor.action.mockContextMenu"],
      registeredCommandIds: ["editor.action.mockContextMenu"],
    })
    expect(evidence.contextMenuOwner).toMatchObject({
      owner: "MenuId.EditorContext/editor context menu UI owner",
      state: "partial",
      connected: false,
    })
    expect(evidence.remainingMenuUiOwnerGap).toMatchObject({
      state: "partial",
      connected: false,
      nextOwnerFiles: ["App.vue", "MenuBar.vue", "generic editor shell"],
    })
    expect(evidence.activeContextSource).toBe("IContextKeyService.getContext()")
  })
})
