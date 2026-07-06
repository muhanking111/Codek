import { Emitter, type Event } from "../../../base/common/event"
import type { IDisposable } from "../../../base/common/lifecycle"
import { InstantiationType, registerSingleton } from "../../instantiation/common/extensions"
import { createDecorator } from "../../instantiation/common/instantiation"

export type WorkbenchListOwnerKind = "list" | "objectTree" | "dataTree" | "asyncDataTree" | "table"

export interface WorkbenchListOwnerCapabilities {
  readonly focus: {
    readonly domFocus: boolean
    readonly lastFocusedList: boolean
    readonly ariaActiveDescendant: boolean
  }
  readonly selection: {
    readonly modelBacked: boolean
    readonly noSecondState: boolean
    readonly stateSource: string
  }
  readonly keyboard: {
    readonly navigationCommands: readonly string[]
    readonly handledBy: string
  }
  readonly style: {
    readonly classNames: readonly string[]
    readonly defaultStyleOwner: string
  }
  readonly typeNavigation: {
    readonly commandIds: readonly string[]
    readonly contextKeys: readonly string[]
  }
  readonly disposal: {
    readonly registeredWithListService: boolean
    readonly disposed: boolean
  }
}

export interface WorkbenchListOwnerSnapshot {
  readonly serviceId: "listService"
  readonly ownerId: string
  readonly widgetKind: WorkbenchListOwnerKind
  readonly vscodeSourcePaths: readonly string[]
  readonly codekSourcePaths: readonly string[]
  readonly factoryEvidence: string
  readonly reusableByWorkbenchTrees: boolean
  readonly modelBacked: boolean
  readonly noSecondState: boolean
  readonly focused: boolean
  readonly disposed: boolean
  readonly capabilities: WorkbenchListOwnerCapabilities
}

export interface WorkbenchListOwnerSnapshotInput {
  readonly ownerId: string
  readonly widgetKind: WorkbenchListOwnerKind
  readonly codekSourcePaths?: readonly string[]
  readonly factoryEvidence?: string
  readonly modelBacked?: boolean
  readonly stateSource?: string
  readonly focused?: boolean
  readonly disposed?: boolean
  readonly classNames?: readonly string[]
}

export interface WorkbenchListOwnerWidget {
  readonly ownerId: string
  readonly widgetKind: WorkbenchListOwnerKind
  readonly onDidFocus: Event<void>
  readonly onDidDispose: Event<void>
  getHTMLElement(): HTMLElement
  getOwnerSnapshot(): WorkbenchListOwnerSnapshot
}

export interface IListService {
  readonly _serviceBrand: undefined
  readonly lastFocusedList: WorkbenchListOwnerWidget | undefined
  register(widget: WorkbenchListOwnerWidget): IDisposable
  getOwnerSnapshots(): WorkbenchListOwnerSnapshot[]
  getOwnerSnapshot(ownerId: string): WorkbenchListOwnerSnapshot | undefined
  createWorkbenchObjectTreeOwnerSnapshot(input: WorkbenchListOwnerSnapshotInput): WorkbenchListOwnerSnapshot
}

export const IListService = createDecorator<IListService>("listService")

export const WORKBENCH_LIST_OWNER_VSCODE_SOURCE_PATHS = Object.freeze([
  "src/vs/platform/list/browser/listService.ts",
  "src/vs/workbench/browser/actions/listCommands.ts",
  "src/vs/base/browser/ui/tree/objectTree.ts",
])

const DEFAULT_KEYBOARD_COMMANDS = Object.freeze([
  "list.focusDown",
  "list.focusUp",
  "list.focusFirst",
  "list.focusLast",
  "list.focusPageDown",
  "list.focusPageUp",
  "list.collapse",
  "list.expand",
  "list.select",
  "list.toggleExpand",
])

const DEFAULT_TYPE_NAVIGATION_COMMANDS = Object.freeze([
  "list.triggerTypeNavigation",
  "list.toggleFindMode",
  "list.toggleFindMatchType",
])

const DEFAULT_TYPE_NAVIGATION_CONTEXT_KEYS = Object.freeze([
  "listTypeNavigationMode",
  "listAutomaticKeyboardNavigation",
  "treeFindOpen",
  "listSupportsFind",
])

export function createWorkbenchListOwnerSnapshot(input: WorkbenchListOwnerSnapshotInput): WorkbenchListOwnerSnapshot {
  const modelBacked = input.modelBacked !== false
  const classNames = input.classNames?.length ? input.classNames : ["codek-list-view"]
  return {
    serviceId: "listService",
    ownerId: input.ownerId,
    widgetKind: input.widgetKind,
    vscodeSourcePaths: WORKBENCH_LIST_OWNER_VSCODE_SOURCE_PATHS,
    codekSourcePaths: input.codekSourcePaths?.length
      ? input.codekSourcePaths
      : ["frontend/vite-project/src/explorer/tree/CodekListView.ts"],
    factoryEvidence: input.factoryEvidence || "IListService.register(widget) + createWorkbenchObjectTreeOwnerSnapshot(input)",
    reusableByWorkbenchTrees: true,
    modelBacked,
    noSecondState: true,
    focused: Boolean(input.focused),
    disposed: Boolean(input.disposed),
    capabilities: {
      focus: {
        domFocus: true,
        lastFocusedList: true,
        ariaActiveDescendant: true,
      },
      selection: {
        modelBacked,
        noSecondState: true,
        stateSource: input.stateSource || "caller model focus/selection",
      },
      keyboard: {
        navigationCommands: DEFAULT_KEYBOARD_COMMANDS,
        handledBy: "VS Code-style list command contract with Codek host navigation bridge",
      },
      style: {
        classNames,
        defaultStyleOwner: "WorkbenchList/WorkbenchObjectTree default list style contract",
      },
      typeNavigation: {
        commandIds: DEFAULT_TYPE_NAVIGATION_COMMANDS,
        contextKeys: DEFAULT_TYPE_NAVIGATION_CONTEXT_KEYS,
      },
      disposal: {
        registeredWithListService: true,
        disposed: Boolean(input.disposed),
      },
    },
  }
}

export class ListService implements IListService {
  declare readonly _serviceBrand: undefined

  private readonly widgets = new Set<WorkbenchListOwnerWidget>()
  private readonly onDidChangeLastFocusedWidgetEmitter = new Emitter<WorkbenchListOwnerWidget | undefined>()
  private _lastFocusedList: WorkbenchListOwnerWidget | undefined

  readonly onDidChangeLastFocusedWidget = this.onDidChangeLastFocusedWidgetEmitter.event

  get lastFocusedList(): WorkbenchListOwnerWidget | undefined {
    return this._lastFocusedList
  }

  register(widget: WorkbenchListOwnerWidget): IDisposable {
    if (this.widgets.has(widget)) throw new Error("Cannot register the same list owner widget multiple times")
    this.widgets.add(widget)
    const element = widget.getHTMLElement()
    element.dataset.workbenchListOwner = widget.ownerId
    element.dataset.workbenchListServiceId = "listService"
    element.dataset.workbenchListNoSecondState = "true"

    const focusDisposable = widget.onDidFocus(() => this.setLastFocusedList(widget))
    const disposeDisposable = widget.onDidDispose(() => {
      this.widgets.delete(widget)
      if (this._lastFocusedList === widget) this.setLastFocusedList(undefined)
    })

    const activeElement = element.ownerDocument?.activeElement
    if (activeElement === element || (activeElement ? element.contains(activeElement) : false)) {
      this.setLastFocusedList(widget)
    }

    return {
      dispose: () => {
        focusDisposable.dispose()
        disposeDisposable.dispose()
        this.widgets.delete(widget)
        if (this._lastFocusedList === widget) this.setLastFocusedList(undefined)
      },
    }
  }

  getOwnerSnapshots(): WorkbenchListOwnerSnapshot[] {
    return Array.from(this.widgets, (widget) => widget.getOwnerSnapshot())
  }

  getOwnerSnapshot(ownerId: string): WorkbenchListOwnerSnapshot | undefined {
    return this.getOwnerSnapshots().find((snapshot) => snapshot.ownerId === ownerId)
  }

  createWorkbenchObjectTreeOwnerSnapshot(input: WorkbenchListOwnerSnapshotInput): WorkbenchListOwnerSnapshot {
    return createWorkbenchListOwnerSnapshot({
      ...input,
      widgetKind: input.widgetKind || "objectTree",
    })
  }

  private setLastFocusedList(widget: WorkbenchListOwnerWidget | undefined): void {
    if (widget === this._lastFocusedList) return
    this._lastFocusedList?.getHTMLElement().classList.remove("last-focused")
    this._lastFocusedList = widget
    this._lastFocusedList?.getHTMLElement().classList.add("last-focused")
    this.onDidChangeLastFocusedWidgetEmitter.fire(widget)
  }
}

export const globalListService = new ListService()
export const globalWorkbenchListService = globalListService

registerSingleton(IListService, globalListService, InstantiationType.Delayed)
