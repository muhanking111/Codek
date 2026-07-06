import { describe, expect, it } from "vitest"
import { ServiceCollection } from "../../instantiation/common/serviceCollection"
import { getSingletonServiceDescriptors } from "../../instantiation/common/extensions"
import {
  globalListService,
  IListService,
  ListService,
  WORKBENCH_LIST_OWNER_VSCODE_SOURCE_PATHS,
} from "./listService"

describe("ListService", () => {
  it("registers the VS Code-style listService identifier and singleton", () => {
    const collection = new ServiceCollection([IListService, globalListService])
    const resolved = collection.get(IListService)

    expect(String(IListService)).toBe("listService")
    expect(resolved).toBe(globalListService)
    expect(resolved?._serviceBrand).toBeUndefined()
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === IListService && instance === globalListService)).toBe(true)
  })

  it("creates reusable WorkbenchObjectTree owner evidence without a second state source", () => {
    const service = new ListService()
    const snapshot = service.createWorkbenchObjectTreeOwnerSnapshot({
      ownerId: "secondaryWorkbenchTree",
      widgetKind: "objectTree",
      codekSourcePaths: ["frontend/vite-project/src/workbench/secondaryTree.ts"],
      factoryEvidence: "other workbench tree can call IListService.createWorkbenchObjectTreeOwnerSnapshot",
      stateSource: "caller tree model focus/selection",
    })

    expect(snapshot).toMatchObject({
      serviceId: "listService",
      ownerId: "secondaryWorkbenchTree",
      widgetKind: "objectTree",
      reusableByWorkbenchTrees: true,
      modelBacked: true,
      noSecondState: true,
      factoryEvidence: "other workbench tree can call IListService.createWorkbenchObjectTreeOwnerSnapshot",
    })
    expect(snapshot.vscodeSourcePaths).toEqual(WORKBENCH_LIST_OWNER_VSCODE_SOURCE_PATHS)
    expect(snapshot.capabilities.selection).toMatchObject({
      modelBacked: true,
      noSecondState: true,
      stateSource: "caller tree model focus/selection",
    })
    expect(snapshot.capabilities.keyboard.navigationCommands).toEqual(expect.arrayContaining([
      "list.focusDown",
      "list.expand",
      "list.toggleExpand",
    ]))
    expect(snapshot.capabilities.typeNavigation.commandIds).toEqual(expect.arrayContaining([
      "list.triggerTypeNavigation",
      "list.toggleFindMode",
    ]))
    expect(snapshot.capabilities.disposal.registeredWithListService).toBe(true)
  })
})
