import type { ContextKeyState } from "./contextKeys"
import { resolveProductIcon, type ProductIcon } from "./productIcons"
import { getVisibleViewContainers, getVisibleViews } from "../vscode-adapter/workbench/common/views/viewRegistry"
import type { IDisposable } from "../vscode-adapter/base/common/lifecycle"

export type ViewLocation = "activityBar" | "sideBar" | "panel" | "auxiliaryBar"
export type ViewSource = "codek" | "vscode" | "extension" | "agent"

export interface ViewDescriptor {
  id: string
  name: string
  containerId: string
  location?: ViewLocation
  source?: ViewSource
  order?: number
  icon?: string
  productIcon?: ProductIcon
  when?: string
  badge?: number | string
  progress?: boolean | "loading" | "syncing"
  userTitle?: string
  userDescription?: string
}

export interface ViewContainerDescriptor {
  id: string
  name: string
  location: ViewLocation
  source?: ViewSource
  order?: number
  icon?: string
  productIcon?: ProductIcon
  userTitle?: string
  userTooltip?: string
  emptyStateTitle?: string
  emptyStateDescription?: string
}

const containers = new Map<string, ViewContainerDescriptor>()
const views = new Map<string, ViewDescriptor>()
const containerEntries = new Map<string, RegisteredViewContainerEntry[]>()
const viewEntries = new Map<string, RegisteredViewEntry[]>()

interface RegisteredViewContainerEntry {
  readonly owner: symbol
  readonly descriptor: ViewContainerDescriptor
}

interface RegisteredViewEntry {
  readonly owner: symbol
  readonly descriptor: ViewDescriptor
}

export function registerViewContainer(container: ViewContainerDescriptor): IDisposable {
  if (!container.id.trim()) throw new Error("View container id is required")
  const owner = Symbol(container.id)
  const userTitle = sanitizeUserVisibleLabel(container.userTitle || container.name, container.id)
  const descriptor: ViewContainerDescriptor = {
    ...container,
    name: userTitle,
    userTitle,
    userTooltip: sanitizeUserVisibleLabel(container.userTooltip || userTitle, container.id),
    emptyStateTitle: sanitizeUserVisibleLabel(container.emptyStateTitle || userTitle, container.id),
    emptyStateDescription: sanitizeOptionalUserVisibleText(container.emptyStateDescription),
    source: container.source || "codek",
    productIcon: container.productIcon || resolveProductIcon(normalizeProductIconKey(container.icon)),
  }
  pushContainerEntry(container.id, { owner, descriptor })
  return { dispose: () => disposeViewContainerEntry(container.id, owner) }
}

export function registerView(view: ViewDescriptor): IDisposable {
  if (!view.id.trim()) throw new Error("View id is required")
  if (!containers.has(view.containerId)) {
    registerViewContainer({
      id: view.containerId,
      name: view.name || view.containerId,
      location: view.location || "sideBar",
      source: view.source || "codek",
    })
  }
  const owner = Symbol(view.id)
  const userTitle = sanitizeUserVisibleLabel(view.userTitle || view.name, view.id)
  const descriptor: ViewDescriptor = {
    ...view,
    name: userTitle,
    userTitle,
    userDescription: sanitizeOptionalUserVisibleText(view.userDescription),
    source: view.source || "codek",
    productIcon: view.productIcon || resolveProductIcon(normalizeProductIconKey(view.icon)),
  }
  pushViewEntry(view.id, { owner, descriptor })
  return { dispose: () => disposeViewEntry(view.id, owner) }
}

export function unregisterViewContainer(containerId: string): void {
  containerEntries.delete(containerId)
  containers.delete(containerId)
  for (const [viewId, view] of views) {
    if (view.containerId === containerId) unregisterView(viewId)
  }
}

function normalizeProductIconKey(icon: string | undefined): string | undefined {
  const value = String(icon || "").trim()
  if (!value) return undefined
  if (/[\\/]/.test(value) || /\.(svg|png|jpg|jpeg|webp|ico)$/i.test(value)) return undefined
  return value.replace(/^\$\((.+)\)$/, "$1")
}

function sanitizeUserVisibleLabel(value: string | undefined, fallbackId: string): string {
  const trimmed = String(value || "").trim()
  if (trimmed && !looksLikeInternalIdentifier(trimmed)) return trimmed
  return titleFromIdentifier(fallbackId)
}

function sanitizeOptionalUserVisibleText(value: string | undefined): string | undefined {
  const trimmed = String(value || "").trim()
  return trimmed && !looksLikeInternalIdentifier(trimmed) ? trimmed : undefined
}

function looksLikeInternalIdentifier(value: string): boolean {
  return /^[a-z]+(\.[a-z0-9-]+){2,}$/i.test(value)
    || /^[a-z0-9_-]+:[a-z0-9_.:-]+$/i.test(value)
    || /[\\/]/.test(value)
    || /\.(svg|png|jpg|jpeg|webp|ico)$/i.test(value)
}

function titleFromIdentifier(id: string): string {
  const parts = String(id || "")
    .replace(/^(workbench|codek|view|views)\./gi, "")
    .split(/[.\-_:]+/)
    .filter((part) => part && !["workbench", "codek", "view", "views", "default", "surface"].includes(part.toLowerCase()))
  const meaningful = parts.length ? parts : ["View"]
  return meaningful
    .map(formatTitlePart)
    .join(" ")
}

function formatTitlePart(part: string): string {
  if (part.length <= 3 && part.toUpperCase() === part) return part
  return `${part.charAt(0).toUpperCase()}${part.slice(1)}`
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
}

export function unregisterView(viewId: string): void {
  viewEntries.delete(viewId)
  views.delete(viewId)
}

export function clearViews(): void {
  containerEntries.clear()
  viewEntries.clear()
  containers.clear()
  views.clear()
}

export function getViewContainers(location?: ViewLocation, context: ContextKeyState = {}): ViewContainerDescriptor[] {
  return getVisibleViewContainers(containers.values(), getViews(undefined, context), location)
}

export function getViews(containerId?: string, context: ContextKeyState = {}): ViewDescriptor[] {
  return getVisibleViews(views.values(), containerId, context)
}

export function registerDefaultWorkbenchViews(): void {
  const defaults: ViewContainerDescriptor[] = [
    { id: "workbench.view.explorer", name: "资源管理器", location: "activityBar", icon: "files", order: 10, source: "vscode" },
    { id: "workbench.view.search", name: "搜索", location: "activityBar", icon: "search", order: 20, source: "vscode" },
    { id: "workbench.view.scm", name: "源代码管理", location: "activityBar", icon: "source-control", order: 30, source: "vscode" },
    { id: "workbench.view.extensions", name: "扩展", location: "activityBar", icon: "extensions", order: 50, source: "vscode" },
    { id: "codek.view.symbols", name: "符号", location: "activityBar", icon: "symbols", order: 55, source: "codek" },
    { id: "codek.view.agent", name: "智能体", location: "activityBar", icon: "agent", order: 60, source: "agent" },
    { id: "workbench.view.settings", name: "设置", location: "activityBar", icon: "settings", order: 90, source: "vscode" },
  ]
  for (const container of defaults) {
    if (!containers.has(container.id)) registerViewContainer(container)
  }
  for (const container of defaults) {
    const defaultViewId = `${container.id}.default`
    if (!views.has(defaultViewId)) {
      registerView({
        id: defaultViewId,
        name: container.name,
        containerId: container.id,
        location: container.location,
        source: container.source,
        order: 0,
      })
    }
  }
}

function pushContainerEntry(containerId: string, entry: RegisteredViewContainerEntry): void {
  const stack = containerEntries.get(containerId) || []
  stack.push(entry)
  containerEntries.set(containerId, stack)
  containers.set(containerId, entry.descriptor)
}

function pushViewEntry(viewId: string, entry: RegisteredViewEntry): void {
  const stack = viewEntries.get(viewId) || []
  stack.push(entry)
  viewEntries.set(viewId, stack)
  views.set(viewId, entry.descriptor)
}

function disposeViewContainerEntry(containerId: string, owner: symbol): void {
  const stack = containerEntries.get(containerId)
  if (!stack) return
  const index = stack.findIndex((entry) => entry.owner === owner)
  if (index === -1) return
  stack.splice(index, 1)
  if (stack.length) {
    containers.set(containerId, stack[stack.length - 1].descriptor)
    return
  }
  containerEntries.delete(containerId)
  unregisterViewContainer(containerId)
}

function disposeViewEntry(viewId: string, owner: symbol): void {
  const stack = viewEntries.get(viewId)
  if (!stack) return
  const index = stack.findIndex((entry) => entry.owner === owner)
  if (index === -1) return
  stack.splice(index, 1)
  if (stack.length) {
    views.set(viewId, stack[stack.length - 1].descriptor)
    return
  }
  viewEntries.delete(viewId)
  views.delete(viewId)
}
