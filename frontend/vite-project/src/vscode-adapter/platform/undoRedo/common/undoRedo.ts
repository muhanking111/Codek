/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code undo/redo service shape:
 * - src/vs/platform/undoRedo/common/undoRedo.ts
 * - src/vs/platform/undoRedo/common/undoRedoService.ts
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from "../../../base/common/lifecycle"
import { isDisposable } from "../../../base/common/lifecycle"
import { URI } from "../../../base/common/uri"
import { InstantiationType, registerSingleton } from "../../instantiation/common/extensions"
import { createDecorator } from "../../instantiation/common/instantiation"

export const IUndoRedoService = createDecorator<IUndoRedoService>("undoRedoService")

export const enum UndoRedoElementType {
  Resource,
  Workspace,
}

export interface IResourceUndoRedoElement {
  readonly type: UndoRedoElementType.Resource
  readonly resource: URI
  readonly label: string
  readonly code: string
  readonly confirmBeforeUndo?: boolean
  undo(): Promise<void> | void
  redo(): Promise<void> | void
}

export interface IWorkspaceUndoRedoElement {
  readonly type: UndoRedoElementType.Workspace
  readonly resources: readonly URI[]
  readonly label: string
  readonly code: string
  readonly confirmBeforeUndo?: boolean
  undo(): Promise<void> | void
  redo(): Promise<void> | void
  split?(): IResourceUndoRedoElement[]
  prepareUndoRedo?(): Promise<IDisposable> | IDisposable | void
}

export type IUndoRedoElement = IResourceUndoRedoElement | IWorkspaceUndoRedoElement

export interface IPastFutureElements {
  readonly past: IUndoRedoElement[]
  readonly future: IUndoRedoElement[]
}

export interface UriComparisonKeyComputer {
  getComparisonKey(uri: URI): string
}

export class ResourceEditStackSnapshot {
  constructor(
    public readonly resource: URI,
    public readonly elements: number[],
  ) {}
}

export class UndoRedoGroup {
  private static idPool = 0

  public readonly id: number
  private order = 1

  constructor() {
    this.id = UndoRedoGroup.idPool++
  }

  nextOrder(): number {
    if (this.id === 0) return 0
    return this.order++
  }

  static readonly None = new UndoRedoGroup()
}

export class UndoRedoSource {
  private static idPool = 0

  public readonly id: number
  private order = 1

  constructor() {
    this.id = UndoRedoSource.idPool++
  }

  nextOrder(): number {
    if (this.id === 0) return 0
    return this.order++
  }

  static readonly None = new UndoRedoSource()
}

export interface IUndoRedoService {
  readonly _serviceBrand: undefined
  registerUriComparisonKeyComputer(scheme: string, uriComparisonKeyComputer: UriComparisonKeyComputer): IDisposable
  getUriComparisonKey(resource: URI): string
  pushElement(element: IUndoRedoElement, group?: UndoRedoGroup, source?: UndoRedoSource): void
  getLastElement(resource: URI | string): IUndoRedoElement | null
  getElements(resource: URI | string): IPastFutureElements
  setElementsValidFlag(resource: URI | string, isValid: boolean, filter: (element: IUndoRedoElement) => boolean): void
  removeElements(resource: URI | string): void
  createSnapshot(resource: URI | string): ResourceEditStackSnapshot
  restoreSnapshot(snapshot: ResourceEditStackSnapshot): void
  canUndo(resourceOrSource: URI | string | UndoRedoSource): boolean
  undo(resourceOrSource: URI | string | UndoRedoSource): Promise<void> | void
  canRedo(resourceOrSource: URI | string | UndoRedoSource): boolean
  redo(resourceOrSource: URI | string | UndoRedoSource): Promise<void> | void
}

interface StackElement {
  readonly id: number
  readonly actual: IUndoRedoElement
  readonly type: UndoRedoElementType
  readonly strResources: string[]
  readonly resourceLabels: string[]
  readonly groupId: number
  readonly groupOrder: number
  readonly sourceId: number
  readonly sourceOrder: number
  isValid: boolean
}

interface ResourceStack {
  readonly label: string
  readonly past: StackElement[]
  readonly future: StackElement[]
}

let stackElementIdPool = 1

export class CodekUndoRedoService implements IUndoRedoService {
  declare readonly _serviceBrand: undefined

  private readonly editStacks = new Map<string, ResourceStack>()
  private readonly comparisonKeyComputers: [string, UriComparisonKeyComputer][] = []

  registerUriComparisonKeyComputer(scheme: string, uriComparisonKeyComputer: UriComparisonKeyComputer): IDisposable {
    this.comparisonKeyComputers.push([scheme, uriComparisonKeyComputer])
    return {
      dispose: () => {
        const index = this.comparisonKeyComputers.findIndex((item) => item[0] === scheme && item[1] === uriComparisonKeyComputer)
        if (index >= 0) this.comparisonKeyComputers.splice(index, 1)
      },
    }
  }

  getUriComparisonKey(resource: URI): string {
    const computer = this.comparisonKeyComputers.find((entry) => entry[0] === resource.scheme)?.[1]
    return computer?.getComparisonKey(resource) ?? resource.toString()
  }

  pushElement(
    actual: IUndoRedoElement,
    group: UndoRedoGroup = UndoRedoGroup.None,
    source: UndoRedoSource = UndoRedoSource.None,
  ): void {
    const resources = actual.type === UndoRedoElementType.Resource ? [actual.resource] : actual.resources
    const seen = new Set<string>()
    const strResources: string[] = []
    const resourceLabels: string[] = []
    for (const resource of resources) {
      const key = this.getUriComparisonKey(resource)
      if (seen.has(key)) continue
      seen.add(key)
      strResources.push(key)
      resourceLabels.push(resourceLabel(resource))
    }
    if (!strResources.length) return

    const element: StackElement = {
      id: stackElementIdPool++,
      actual,
      type: strResources.length === 1 ? UndoRedoElementType.Resource : actual.type,
      strResources,
      resourceLabels,
      groupId: group.id,
      groupOrder: group.nextOrder(),
      sourceId: source.id,
      sourceOrder: source.nextOrder(),
      isValid: true,
    }

    for (let index = 0; index < strResources.length; index += 1) {
      const key = strResources[index]
      const stack = this.getOrCreateStack(key, resourceLabels[index])
      stack.future.splice(0)
      stack.past.push(element)
    }
  }

  getLastElement(resource: URI | string): IUndoRedoElement | null {
    const stack = this.getStack(resource)
    if (!stack || stack.future.length) return null
    return stack.past[stack.past.length - 1]?.actual ?? null
  }

  getElements(resource: URI | string): IPastFutureElements {
    const stack = this.getStack(resource)
    return {
      past: stack?.past.map((element) => element.actual) ?? [],
      future: stack?.future.map((element) => element.actual) ?? [],
    }
  }

  setElementsValidFlag(resource: URI | string, isValid: boolean, filter: (element: IUndoRedoElement) => boolean): void {
    const stack = this.getStack(resource)
    if (!stack) return
    for (const element of [...stack.past, ...stack.future]) {
      if (filter(element.actual)) element.isValid = isValid
    }
  }

  removeElements(resource: URI | string): void {
    this.editStacks.delete(this.toComparisonKey(resource))
  }

  createSnapshot(resource: URI | string): ResourceEditStackSnapshot {
    const uri = toResourceUri(resource)
    const stack = this.getStack(uri)
    return new ResourceEditStackSnapshot(uri, stack?.past.map((element) => element.id) ?? [])
  }

  restoreSnapshot(snapshot: ResourceEditStackSnapshot): void {
    const key = this.getUriComparisonKey(snapshot.resource)
    const stack = this.editStacks.get(key)
    if (!stack) return
    const allowed = new Set(snapshot.elements)
    stack.past.splice(0, stack.past.length, ...stack.past.filter((element) => allowed.has(element.id)))
    stack.future.splice(0)
    if (!stack.past.length) this.editStacks.delete(key)
  }

  canUndo(resourceOrSource: URI | string | UndoRedoSource): boolean {
    return Boolean(this.findUndoElement(resourceOrSource))
  }

  undo(resourceOrSource: URI | string | UndoRedoSource): Promise<void> | void {
    const element = this.findUndoElement(resourceOrSource)
    if (!element) return undefined
    const grouped = this.findClosestUndoElementInGroup(element.groupId) ?? element
    return this.invokeUndo(grouped)
  }

  canRedo(resourceOrSource: URI | string | UndoRedoSource): boolean {
    return Boolean(this.findRedoElement(resourceOrSource))
  }

  redo(resourceOrSource: URI | string | UndoRedoSource): Promise<void> | void {
    const element = this.findRedoElement(resourceOrSource)
    if (!element) return undefined
    const grouped = this.findClosestRedoElementInGroup(element.groupId) ?? element
    return this.invokeRedo(grouped)
  }

  private async invokeUndo(element: StackElement): Promise<void> {
    if (!element.isValid) {
      this.removeStackElement(element)
      return
    }
    const cleanup = await this.prepare(element)
    try {
      this.moveBackward(element)
      await element.actual.undo()
    } finally {
      cleanup?.dispose()
    }
    const next = this.findClosestUndoElementInGroup(element.groupId)
    if (next) await this.invokeUndo(next)
  }

  private async invokeRedo(element: StackElement): Promise<void> {
    if (!element.isValid) {
      this.removeStackElement(element)
      return
    }
    const cleanup = await this.prepare(element)
    try {
      this.moveForward(element)
      await element.actual.redo()
    } finally {
      cleanup?.dispose()
    }
    const next = this.findClosestRedoElementInGroup(element.groupId)
    if (next) await this.invokeRedo(next)
  }

  private async prepare(element: StackElement): Promise<IDisposable | undefined> {
    if (element.actual.type !== UndoRedoElementType.Workspace || !element.actual.prepareUndoRedo) return undefined
    const cleanup = await element.actual.prepareUndoRedo()
    return isDisposable(cleanup) ? cleanup : undefined
  }

  private moveBackward(element: StackElement): void {
    for (const key of element.strResources) {
      const stack = this.editStacks.get(key)
      if (!stack) continue
      removeElement(stack.past, element)
      if (!stack.future.includes(element)) stack.future.push(element)
    }
  }

  private moveForward(element: StackElement): void {
    for (const key of element.strResources) {
      const stack = this.editStacks.get(key)
      if (!stack) continue
      removeElement(stack.future, element)
      if (!stack.past.includes(element)) stack.past.push(element)
    }
  }

  private removeStackElement(element: StackElement): void {
    for (const key of element.strResources) {
      const stack = this.editStacks.get(key)
      if (!stack) continue
      removeElement(stack.past, element)
      removeElement(stack.future, element)
      if (!stack.past.length && !stack.future.length) this.editStacks.delete(key)
    }
  }

  private findUndoElement(resourceOrSource: URI | string | UndoRedoSource): StackElement | null {
    if (resourceOrSource instanceof UndoRedoSource) {
      return this.findClosestUndoElementWithSource(resourceOrSource.id)
    }
    return this.getStack(resourceOrSource)?.past.at(-1) ?? null
  }

  private findRedoElement(resourceOrSource: URI | string | UndoRedoSource): StackElement | null {
    if (resourceOrSource instanceof UndoRedoSource) {
      return this.findClosestRedoElementWithSource(resourceOrSource.id)
    }
    return this.getStack(resourceOrSource)?.future.at(-1) ?? null
  }

  private findClosestUndoElementWithSource(sourceId: number): StackElement | null {
    if (!sourceId) return null
    let matched: StackElement | null = null
    for (const stack of this.editStacks.values()) {
      const candidate = stack.past.at(-1)
      if (!candidate || candidate.sourceId !== sourceId) continue
      if (!matched || candidate.sourceOrder > matched.sourceOrder) matched = candidate
    }
    return matched
  }

  private findClosestRedoElementWithSource(sourceId: number): StackElement | null {
    if (!sourceId) return null
    let matched: StackElement | null = null
    for (const stack of this.editStacks.values()) {
      const candidate = stack.future.at(-1)
      if (!candidate || candidate.sourceId !== sourceId) continue
      if (!matched || candidate.sourceOrder < matched.sourceOrder) matched = candidate
    }
    return matched
  }

  private findClosestUndoElementInGroup(groupId: number): StackElement | null {
    if (!groupId) return null
    let matched: StackElement | null = null
    for (const stack of this.editStacks.values()) {
      const candidate = stack.past.at(-1)
      if (!candidate || candidate.groupId !== groupId) continue
      if (!matched || candidate.groupOrder > matched.groupOrder) matched = candidate
    }
    return matched
  }

  private findClosestRedoElementInGroup(groupId: number): StackElement | null {
    if (!groupId) return null
    let matched: StackElement | null = null
    for (const stack of this.editStacks.values()) {
      const candidate = stack.future.at(-1)
      if (!candidate || candidate.groupId !== groupId) continue
      if (!matched || candidate.groupOrder < matched.groupOrder) matched = candidate
    }
    return matched
  }

  private getStack(resource: URI | string): ResourceStack | undefined {
    return this.editStacks.get(this.toComparisonKey(resource))
  }

  private getOrCreateStack(key: string, label: string): ResourceStack {
    const existing = this.editStacks.get(key)
    if (existing) return existing
    const created = { label, past: [], future: [] }
    this.editStacks.set(key, created)
    return created
  }

  private toComparisonKey(resource: URI | string): string {
    return this.getUriComparisonKey(toResourceUri(resource))
  }
}

export const globalUndoRedoService = new CodekUndoRedoService()
registerSingleton(IUndoRedoService, globalUndoRedoService, InstantiationType.Delayed)

function toResourceUri(resource: URI | string): URI {
  if (URI.isUri(resource)) return resource
  const raw = normalizeResourcePath(resource)
  return /^\w[\w\d+.-]*:/.test(raw) ? URI.parse(raw) : URI.file(raw)
}

function normalizeResourcePath(value: string): string {
  return String(value || "").replace(/\\/g, "/").replace(/^file:\/\//, "").replace(/^\/([a-zA-Z]:\/)/, "$1")
}

function resourceLabel(resource: URI): string {
  return resource.fsPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() || resource.toString()
}

function removeElement(elements: StackElement[], element: StackElement): void {
  const index = elements.lastIndexOf(element)
  if (index >= 0) elements.splice(index, 1)
}
