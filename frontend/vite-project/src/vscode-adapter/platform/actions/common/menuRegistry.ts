// VS Code source adapter.
// Source reference:
// - D:\SourceMirror\vscode\src\vs\platform\actions\common\actions.ts
//
// Codek still owns the menubar labels and action handlers. This adapter ports
// VS Code menu item semantics that matter for rendering: contributed items carry
// group/order metadata, visibility is evaluated before rendering, and separators
// are normalized after unavailable entries are removed.

import { registerCommand, type CommandDescriptor } from "../../../../workbench/commandRegistry"
import { evaluateWhenClause, type ContextKeyState } from "../../../../workbench/contextKeys"
import { registerCommandKeybinding, type KeybindingContribution } from "../../../../keybindings"
import type { Disposable } from "../../commands/common/commandsRegistry"

export type VscodeMenuEntryKind = "item" | "submenu" | "separator"

export interface VscodeMenuEntryLike<TContext> {
  type: VscodeMenuEntryKind
  id?: string
  group?: "navigation" | string
  order?: number
  when?: string
  visible?: (context: TContext) => boolean
  enabled?: (context: TContext) => boolean
  items?: VscodeMenuEntryLike<TContext>[]
}

export interface VscodeCommandAction {
  id: string
  title: string | { value: string; original?: string }
  shortTitle?: string | { value: string; original?: string }
  category?: string | { value: string; original?: string }
  tooltip?: string | { value: string; original?: string }
  icon?: string
  precondition?: string
  toggled?: string | {
    condition: string
    title?: string | { value: string; original?: string }
    tooltip?: string | { value: string; original?: string }
    icon?: string
  }
  metadata?: CommandDescriptor["metadata"]
}

export interface VscodeMenuItem {
  command: VscodeCommandAction
  alt?: VscodeCommandAction
  when?: string
  group?: "navigation" | string
  order?: number
  precondition?: string | null
}

export interface VscodeSubmenuItem {
  submenu: MenuId
  title: string | { value: string; original?: string }
  icon?: string
  when?: string
  group?: "navigation" | string
  order?: number
}

export interface VscodePreparedMenuItem extends VscodeMenuEntryLike<ContextKeyState> {
  type: "item"
  id: string
  commandId: string
  label: string
  category?: string
  tooltip?: string
  icon?: string
  alt?: VscodePreparedMenuItem
  toggled?: boolean
  disabled?: boolean
}

export interface VscodePreparedSubmenu extends VscodeMenuEntryLike<ContextKeyState> {
  type: "submenu"
  id: string
  label: string
  icon?: string
  items: VscodePreparedMenuEntry[]
}

export interface VscodePreparedSeparator extends VscodeMenuEntryLike<ContextKeyState> {
  type: "separator"
}

export type VscodePreparedMenuEntry = VscodePreparedMenuItem | VscodePreparedSubmenu | VscodePreparedSeparator

export interface MenuRegistryOwnerEvidence {
  owner: "MenuRegistry"
  stateSource: "MenuRegistry.commands+menuItems"
  connected: true
  noSecondStateSource: true
  readonlyEvidence: true
  commandIds: string[]
  menuIds: string[]
  menuItemCount: number
}

export class MenuId {
  private static readonly instances = new Map<string, MenuId>()

  static readonly CommandPalette = MenuId.for("CommandPalette")
  static readonly MenubarFileMenu = MenuId.for("MenubarFileMenu")
  static readonly MenubarEditMenu = MenuId.for("MenubarEditMenu")
  static readonly MenubarSelectionMenu = MenuId.for("MenubarSelectionMenu")
  static readonly MenubarViewMenu = MenuId.for("MenubarViewMenu")
  static readonly MenubarGoMenu = MenuId.for("MenubarGoMenu")
  static readonly MenubarHelpMenu = MenuId.for("MenubarHelpMenu")
  static readonly ViewTitle = MenuId.for("ViewTitle")
  static readonly ExplorerContext = MenuId.for("ExplorerContext")
  static readonly EditorContext = MenuId.for("EditorContext")
  static readonly EditorTitle = MenuId.for("EditorTitle")
  static readonly EditorTitleContext = MenuId.for("EditorTitleContext")
  static readonly SCMTitle = MenuId.for("SCMTitle")
  static readonly SCMResourceContext = MenuId.for("SCMResourceContext")
  static readonly TestItem = MenuId.for("TestItem")
  static readonly AgentEvidenceTimeline = MenuId.for("AgentEvidenceTimeline")
  static readonly AccessibleView = MenuId.for("AccessibleView")

  static for(identifier: string): MenuId {
    const existing = MenuId.instances.get(identifier)
    if (existing) return existing
    return new MenuId(identifier)
  }

  private constructor(readonly id: string) {
    MenuId.instances.set(id, this)
  }
}

type MenuRegistryItem = VscodeMenuItem | VscodeSubmenuItem

function isMenuItem(item: MenuRegistryItem): item is VscodeMenuItem {
  return Object.prototype.hasOwnProperty.call(item, "command")
}

class VscodeMenuRegistry {
  private readonly commands = new Map<string, VscodeCommandAction>()
  private readonly menuItems = new Map<string, MenuRegistryItem[]>()
  private readonly listeners = new Set<(menuId: MenuId) => void>()

  onDidChangeMenu(listener: (menuId: MenuId) => void): Disposable {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  addCommand(command: VscodeCommandAction): Disposable {
    this.commands.set(command.id, command)
    this.emit(MenuId.CommandPalette)
    return {
      dispose: () => {
        if (this.commands.delete(command.id)) this.emit(MenuId.CommandPalette)
      },
    }
  }

  getCommand(id: string): VscodeCommandAction | undefined {
    return this.commands.get(id)
  }

  getCommands(): Map<string, VscodeCommandAction> {
    return new Map(this.commands)
  }

  appendMenuItem(menu: MenuId, item: MenuRegistryItem): Disposable {
    const list = this.menuItems.get(menu.id) ?? []
    list.push(item)
    this.menuItems.set(menu.id, list)
    this.emit(menu)

    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        const current = this.menuItems.get(menu.id)
        if (!current) return
        const index = current.indexOf(item)
        if (index !== -1) current.splice(index, 1)
        this.emit(menu)
      },
    }
  }

  appendMenuItems(items: Iterable<{ id: MenuId; item: MenuRegistryItem }>): Disposable {
    const disposables = Array.from(items, ({ id, item }) => this.appendMenuItem(id, item))
    return { dispose: () => disposables.forEach((disposable) => disposable.dispose()) }
  }

  getMenuItems(menu: MenuId): MenuRegistryItem[] {
    const result = [...(this.menuItems.get(menu.id) ?? [])]
    if (menu === MenuId.CommandPalette) {
      const contributed = new Set(result.flatMap((item) => isMenuItem(item) ? [item.command.id, item.alt?.id].filter(Boolean) : []))
      for (const command of this.commands.values()) {
        if (!contributed.has(command.id)) result.push({ command })
      }
    }
    return result
  }

  getMenuEntries(menu: MenuId, context: ContextKeyState = {}): VscodePreparedMenuEntry[] {
    return prepareMenuEntries(this.getMenuItems(menu).map((item) => this.toPreparedEntry(item, context)), context)
  }

  getOwnerEvidenceSnapshot(): MenuRegistryOwnerEvidence {
    const menuIds = [...this.menuItems.keys()].sort()
    return {
      owner: "MenuRegistry",
      stateSource: "MenuRegistry.commands+menuItems",
      connected: true,
      noSecondStateSource: true,
      readonlyEvidence: true,
      commandIds: [...this.commands.keys()].sort(),
      menuIds,
      menuItemCount: menuIds.reduce((total, menuId) => total + (this.menuItems.get(menuId)?.length ?? 0), 0),
    }
  }

  clear(): void {
    this.commands.clear()
    this.menuItems.clear()
  }

  private toPreparedEntry(item: MenuRegistryItem, context: ContextKeyState): VscodePreparedMenuEntry {
    if (!isMenuItem(item)) {
      return {
        type: "submenu",
        id: item.submenu.id,
        label: localizeTitle(item.title),
        group: item.group,
        order: item.order,
        when: item.when,
        icon: item.icon,
        items: this.getMenuEntries(item.submenu, context),
      }
    }

    const command = item.command
    const enabledWhen = item.precondition === null ? undefined : (item.precondition || command.precondition)
    return {
      type: "item",
      id: command.id,
      commandId: command.id,
      label: localizeTitle(command.shortTitle || command.title),
      category: command.category ? localizeTitle(command.category) : undefined,
      tooltip: command.tooltip ? localizeTitle(command.tooltip) : undefined,
      icon: command.icon,
      group: item.group,
      order: item.order,
      when: item.when,
      disabled: enabledWhen ? !evaluateWhenClause(enabledWhen, context) : false,
      toggled: isToggled(command, context),
      alt: item.alt ? this.toPreparedAlt(item.alt, context) : undefined,
    }
  }

  private toPreparedAlt(command: VscodeCommandAction, context: ContextKeyState): VscodePreparedMenuItem {
    return {
      type: "item",
      id: command.id,
      commandId: command.id,
      label: localizeTitle(command.shortTitle || command.title),
      category: command.category ? localizeTitle(command.category) : undefined,
      tooltip: command.tooltip ? localizeTitle(command.tooltip) : undefined,
      icon: command.icon,
      disabled: command.precondition ? !evaluateWhenClause(command.precondition, context) : false,
      toggled: isToggled(command, context),
    }
  }

  private emit(menuId: MenuId): void {
    for (const listener of this.listeners) listener(menuId)
  }
}

export const MenuRegistry = new VscodeMenuRegistry()

export function prepareMenuEntries<TEntry extends VscodeMenuEntryLike<TContext>, TContext>(
  entries: readonly TEntry[],
  context: TContext,
): TEntry[] {
  const visible = entries
    .filter((entry) => entry.type === "separator" || isEntryVisible(entry, context))
    .map((entry) => cloneWithPreparedChildren(entry, context))

  return normalizeSeparators(sortMenuEntries(visible))
}

export function sortMenuEntries<TEntry extends VscodeMenuEntryLike<unknown>>(entries: readonly TEntry[]): TEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const group = compareMenuGroup(left.entry.group, right.entry.group)
      if (group !== 0) return group
      const order = (left.entry.order ?? 0) - (right.entry.order ?? 0)
      if (order !== 0) return order
      return left.index - right.index
    })
    .map(({ entry }) => entry)
}

function cloneWithPreparedChildren<TEntry extends VscodeMenuEntryLike<TContext>, TContext>(entry: TEntry, context: TContext): TEntry {
  if (entry.type !== "submenu" || !entry.items) return entry
  return { ...entry, items: prepareMenuEntries(entry.items, context) } as TEntry
}

function compareMenuGroup(left?: string, right?: string): number {
  const leftRank = menuGroupRank(left)
  const rightRank = menuGroupRank(right)
  if (leftRank !== rightRank) return leftRank - rightRank
  return (left || "").localeCompare(right || "")
}

function menuGroupRank(group?: string): number {
  if (!group || group === "navigation") return 0
  if (group.startsWith("inline")) return 1
  return 2
}

function normalizeSeparators<TEntry extends VscodeMenuEntryLike<unknown>>(entries: readonly TEntry[]): TEntry[] {
  const result: TEntry[] = []
  for (const entry of entries) {
    if (entry.type === "separator") {
      if (result.length === 0 || result[result.length - 1]?.type === "separator") continue
    }
    result.push(entry)
  }
  while (result[result.length - 1]?.type === "separator") result.pop()
  return result
}

function isEntryVisible<TContext>(entry: VscodeMenuEntryLike<TContext>, context: TContext): boolean {
  if (entry.visible && !entry.visible(context)) return false
  if (entry.when && !evaluateWhenClause(entry.when, context as ContextKeyState)) return false
  return true
}

function localizeTitle(title: string | { value: string; original?: string }): string {
  return typeof title === "string" ? title : title.value
}

function isToggled(command: VscodeCommandAction, context: ContextKeyState): boolean {
  if (!command.toggled) return false
  if (typeof command.toggled === "string") return evaluateWhenClause(command.toggled, context)
  return evaluateWhenClause(command.toggled.condition, context)
}

export interface Action2Descriptor extends VscodeCommandAction {
  f1?: boolean
  source?: CommandDescriptor["source"]
  menu?: { id: MenuId; group?: "navigation" | string; order?: number; when?: string; precondition?: string | null; alt?: VscodeCommandAction } | Array<{ id: MenuId; group?: "navigation" | string; order?: number; when?: string; precondition?: string | null; alt?: VscodeCommandAction }>
  keybinding?: KeybindingContribution | KeybindingContribution[]
}

export abstract class Action2 {
  constructor(readonly desc: Readonly<Action2Descriptor>) {}
  abstract run(accessor: unknown, ...args: unknown[]): void | Promise<void>
}

export function registerAction2(ctor: { new(): Action2 }): Disposable {
  const action = new ctor()
  const disposables: Disposable[] = []
  const command = action.desc
  const title = localizeTitle(command.title)
  const category = command.category ? localizeTitle(command.category) : undefined

  disposables.push(registerCommand({
    id: command.id,
    title,
    category,
    source: command.source || "vscode",
    precondition: command.precondition,
    metadata: command.metadata ?? { description: title },
    handler: (...args: unknown[]) => action.run(undefined, ...args),
  }))

  const menuItems = Array.isArray(command.menu) ? command.menu : command.menu ? [command.menu] : []
  for (const menu of menuItems) {
    disposables.push(MenuRegistry.appendMenuItem(menu.id, {
      command,
      alt: menu.alt,
      when: menu.when,
      group: menu.group,
      order: menu.order,
      precondition: menu.precondition,
    }))
  }

  if (command.f1) {
    disposables.push(MenuRegistry.addCommand(command))
    disposables.push(MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
      command,
      when: command.precondition,
      group: "navigation",
    }))
  }

  const keybindings = Array.isArray(command.keybinding) ? command.keybinding : command.keybinding ? [command.keybinding] : []
  for (const keybinding of keybindings) {
    disposables.push(registerCommandKeybinding(command.id, {
      ...keybinding,
      when: combineWhen(command.precondition, keybinding.when),
      weight: keybinding.weight ?? 200,
    }))
  }

  return { dispose: () => disposables.forEach((disposable) => disposable.dispose()) }
}

function combineWhen(left?: string, right?: string): string | undefined {
  if (left && right) return `(${left}) && (${right})`
  return left || right
}
