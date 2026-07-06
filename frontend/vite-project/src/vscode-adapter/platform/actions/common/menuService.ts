/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code menu service contracts:
 * - src/vs/platform/actions/common/actions.ts
 * - src/vs/platform/actions/common/menuService.ts
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from "../../../base/common/event"
import { DisposableStore, type IDisposable } from "../../../base/common/lifecycle"
import {
  getContextKeyNames,
  getContextKeyServiceOwnerEvidence,
  globalContextKeyService,
  type ContextKeyState,
  type IContextKeyService,
} from "../../contextkey/common/contextkey"
import { getCommand } from "../../../../workbench/commandRegistry"
import { InstantiationType, registerSingleton } from "../../instantiation/common/extensions"
import { createDecorator } from "../../instantiation/common/instantiation"
import {
  MenuId,
  MenuRegistry,
  type MenuRegistryOwnerEvidence,
  type VscodeCommandAction,
  type VscodeMenuItem,
  type VscodePreparedMenuEntry,
  type VscodePreparedMenuItem,
  type VscodePreparedSubmenu,
  type VscodeSubmenuItem,
} from "./menuRegistry"

export type PreparedMenuAction = VscodePreparedMenuItem | VscodePreparedSubmenu
export type MenuActionGroups = [string, PreparedMenuAction[]][]

export interface MenuContextOwnerEvidence {
  contextKeyServiceOwner: ReturnType<typeof getContextKeyServiceOwnerEvidence>
  menuRegistryOwner: MenuRegistryOwnerEvidence
  menuServiceOwner: {
    owner: "IMenuService/MenuService"
    stateSource: "MenuRegistry+IContextKeyService"
    activeContextSource: "IContextKeyService.getContext()"
    connected: true
    noSecondStateSource: true
    readonlyEvidence: true
    menuId: string
    actionGroupCount: number
    contextKeys: string[]
  }
  contextMenuOwner: {
    owner: "MenuId.EditorContext/editor context menu UI owner"
    state: "partial"
    connected: false
    readonlyEvidence: true
    currentOwner: "editorContextMenuLifecycle feature hook"
    missingOwner: "CodeEditorWidget/MenuId.EditorContext DOM context menu owner"
  }
  commandRoutingOwner: {
    owner: "MenuRegistry command ids + commandRegistry handlers"
    stateSource: "MenuService.getMenuActions"
    connected: boolean
    readonlyEvidence: true
    routedCommandIds: string[]
    registeredCommandIds: string[]
  }
  activeContextSource: "IContextKeyService.getContext()"
  remainingMenuUiOwnerGap: {
    owner: "MenuBar/App.vue/generic editor context menu DOM owner"
    state: "partial"
    connected: false
    blockedBy: "完整 MenuBar/DOM context menu owner 需要 App.vue、MenuBar.vue 或 generic editor shell 接线"
    nextOwnerFiles: readonly ["App.vue", "MenuBar.vue", "generic editor shell"]
  }
}

export interface IMenuChangeEvent {
  readonly menuId: MenuId
  readonly reason: "menu" | "context"
}

export interface IMenu extends IDisposable {
  readonly onDidChange: Event<IMenuChangeEvent>
  getActions(): MenuActionGroups
}

export interface IMenuCreateOptions {
  emitEventsForSubmenuChanges?: boolean
}

export interface IMenuService {
  readonly _serviceBrand: undefined
  createMenu(id: MenuId, contextKeyService: IContextKeyService, options?: IMenuCreateOptions): IMenu
  getMenuActions(id: MenuId, contextKeyService: IContextKeyService, options?: IMenuCreateOptions): MenuActionGroups
  getMenuContexts(id: MenuId): ReadonlySet<string>
  resetHiddenStates(menuIds?: readonly MenuId[]): void
}

export const IMenuService = createDecorator<IMenuService>("menuService")

interface MenuMetadata {
  readonly menuIds: ReadonlySet<MenuId>
  readonly contextKeys: ReadonlySet<string>
}

class MenuImpl implements IMenu {
  private readonly store = new DisposableStore()
  private readonly onDidChangeEmitter = new Emitter<IMenuChangeEvent>()
  private metadata: MenuMetadata

  readonly onDidChange = this.onDidChangeEmitter.event

  constructor(
    private readonly id: MenuId,
    private readonly contextKeyService: IContextKeyService,
    private readonly options: IMenuCreateOptions = {},
  ) {
    this.metadata = collectMenuMetadata(id)

    this.store.add(MenuRegistry.onDidChangeMenu((changedMenuId) => {
      if (
        changedMenuId !== this.id
        && (!this.options.emitEventsForSubmenuChanges || !this.metadata.menuIds.has(changedMenuId))
      ) {
        return
      }

      this.metadata = collectMenuMetadata(this.id)
      this.onDidChangeEmitter.fire({ menuId: this.id, reason: "menu" })
    }))

    this.store.add(this.contextKeyService.onDidChangeContext((event) => {
      if (!this.metadata.contextKeys.size || !event.affectsSome(this.metadata.contextKeys)) return
      this.metadata = collectMenuMetadata(this.id)
      this.onDidChangeEmitter.fire({ menuId: this.id, reason: "context" })
    }))
  }

  getActions(): MenuActionGroups {
    return buildMenuActionGroups(this.id, this.contextKeyService.getContext())
  }

  dispose(): void {
    this.store.dispose()
    this.onDidChangeEmitter.dispose()
  }
}

export class MenuService implements IMenuService {
  declare readonly _serviceBrand: undefined

  createMenu(id: MenuId, contextKeyService: IContextKeyService, options: IMenuCreateOptions = {}): IMenu {
    return new MenuImpl(id, contextKeyService, options)
  }

  getMenuActions(id: MenuId, contextKeyService: IContextKeyService, options: IMenuCreateOptions = {}): MenuActionGroups {
    const menu = this.createMenu(id, contextKeyService, options)
    try {
      return menu.getActions()
    } finally {
      menu.dispose()
    }
  }

  getMenuContexts(id: MenuId): ReadonlySet<string> {
    return collectMenuMetadata(id).contextKeys
  }

  resetHiddenStates(_menuIds?: readonly MenuId[]): void {
    // Hidden-state persistence is not implemented in Codek yet.
  }
}

export const globalMenuService = new MenuService()
registerSingleton(IMenuService, globalMenuService, InstantiationType.Delayed)

export function getMenuContextOwnerEvidence(
  menuId: MenuId = MenuId.EditorContext,
  contextKeyService: IContextKeyService = globalContextKeyService,
  menuService: IMenuService = globalMenuService,
): MenuContextOwnerEvidence {
  const groups = menuService.getMenuActions(menuId, contextKeyService)
  const routedCommandIds = uniqueSorted(flattenMenuActionGroups(groups)
    .filter((entry): entry is VscodePreparedMenuItem => "commandId" in entry)
    .map((entry) => entry.commandId))
  const registeredCommandIds = routedCommandIds.filter((commandId) => Boolean(getCommand(commandId)))
  const contextKeys = [...menuService.getMenuContexts(menuId)].sort()

  return {
    contextKeyServiceOwner: getContextKeyServiceOwnerEvidence(contextKeyService),
    menuRegistryOwner: MenuRegistry.getOwnerEvidenceSnapshot(),
    menuServiceOwner: {
      owner: "IMenuService/MenuService",
      stateSource: "MenuRegistry+IContextKeyService",
      activeContextSource: "IContextKeyService.getContext()",
      connected: true,
      noSecondStateSource: true,
      readonlyEvidence: true,
      menuId: menuId.id,
      actionGroupCount: groups.length,
      contextKeys,
    },
    contextMenuOwner: {
      owner: "MenuId.EditorContext/editor context menu UI owner",
      state: "partial",
      connected: false,
      readonlyEvidence: true,
      currentOwner: "editorContextMenuLifecycle feature hook",
      missingOwner: "CodeEditorWidget/MenuId.EditorContext DOM context menu owner",
    },
    commandRoutingOwner: {
      owner: "MenuRegistry command ids + commandRegistry handlers",
      stateSource: "MenuService.getMenuActions",
      connected: routedCommandIds.length > 0,
      readonlyEvidence: true,
      routedCommandIds,
      registeredCommandIds,
    },
    activeContextSource: "IContextKeyService.getContext()",
    remainingMenuUiOwnerGap: {
      owner: "MenuBar/App.vue/generic editor context menu DOM owner",
      state: "partial",
      connected: false,
      blockedBy: "完整 MenuBar/DOM context menu owner 需要 App.vue、MenuBar.vue 或 generic editor shell 接线",
      nextOwnerFiles: ["App.vue", "MenuBar.vue", "generic editor shell"],
    },
  }
}

function buildMenuActionGroups(menuId: MenuId, context: ContextKeyState): MenuActionGroups {
  const groups: MenuActionGroups = []

  for (const entry of MenuRegistry.getMenuEntries(menuId, context)) {
    if (entry.type === "separator") continue
    const groupId = entry.group || ""
    const currentGroup = groups[groups.length - 1]
    if (!currentGroup || currentGroup[0] !== groupId) {
      groups.push([groupId, [entry]])
      continue
    }
    currentGroup[1].push(entry)
  }

  return groups.map(([group, actions]) => [group, [...actions]])
}

function collectMenuMetadata(menuId: MenuId): MenuMetadata {
  const menuIds = new Set<MenuId>()
  const contextKeys = new Set<string>()
  collectMenuMetadataRecursive(menuId, menuIds, contextKeys, new Set<MenuId>())
  return { menuIds, contextKeys }
}

function collectMenuMetadataRecursive(
  menuId: MenuId,
  menuIds: Set<MenuId>,
  contextKeys: Set<string>,
  visited: Set<MenuId>,
): void {
  if (visited.has(menuId)) return
  visited.add(menuId)
  menuIds.add(menuId)

  for (const item of MenuRegistry.getMenuItems(menuId)) {
    if (isPreparedMenuItemSource(item)) {
      collectWhenContextKeys(item.when, contextKeys)
      collectWhenContextKeys(item.precondition === null ? undefined : (item.precondition || item.command.precondition), contextKeys)
      collectCommandContextKeys(item.command, contextKeys)
      if (item.alt) collectCommandContextKeys(item.alt, contextKeys)
      continue
    }

    collectWhenContextKeys(item.when, contextKeys)
    collectMenuMetadataRecursive(item.submenu, menuIds, contextKeys, visited)
  }
}

function collectCommandContextKeys(command: VscodeCommandAction, contextKeys: Set<string>): void {
  collectWhenContextKeys(command.precondition, contextKeys)
  if (typeof command.toggled === "string") {
    collectWhenContextKeys(command.toggled, contextKeys)
  } else {
    collectWhenContextKeys(command.toggled?.condition, contextKeys)
  }
}

function collectWhenContextKeys(when: string | undefined, contextKeys: Set<string>): void {
  for (const key of getContextKeyNames(when)) contextKeys.add(key)
}

function isPreparedMenuItemSource(item: VscodeMenuItem | VscodeSubmenuItem): item is VscodeMenuItem {
  return Object.prototype.hasOwnProperty.call(item, "command")
}

export function flattenMenuActionGroups(groups: MenuActionGroups): PreparedMenuAction[] {
  return groups.flatMap(([, actions]) => actions)
}

export function isPreparedMenuAction(entry: VscodePreparedMenuEntry): entry is PreparedMenuAction {
  return entry.type !== "separator"
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}
