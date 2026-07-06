import { evaluateWhenClause, type ContextKeyState } from "../../../../workbench/contextKeys"

// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\workbench\common\views.ts
// - D:\SourceMirror\vscode\src\vs\workbench\services\views\common\viewContainerModel.ts
//
// Codek keeps its lightweight registry, but visibility and ordering should be
// derived through one VS Code-style adapter instead of each caller filtering and
// sorting views independently.

export interface CodekViewDescriptorLike {
  id: string
  name: string
  containerId: string
  order?: number
  when?: string
}

export interface CodekViewContainerDescriptorLike {
  id: string
  name: string
  location: string
  order?: number
}

export function getVisibleViews<T extends CodekViewDescriptorLike>(
  views: Iterable<T>,
  containerId: string | undefined,
  context: ContextKeyState,
): T[] {
  return Array.from(views)
    .filter((view) => (!containerId || view.containerId === containerId) && evaluateWhenClause(view.when, context))
    .sort(compareViewOrder)
}

export function getVisibleViewContainers<T extends CodekViewContainerDescriptorLike>(
  containers: Iterable<T>,
  visibleViews: Iterable<CodekViewDescriptorLike>,
  location?: string,
): T[] {
  const visibleContainerIds = new Set(Array.from(visibleViews).map((view) => view.containerId))
  return Array.from(containers)
    .filter((container) => (!location || container.location === location) && visibleContainerIds.has(container.id))
    .sort(compareViewOrder)
}

function compareViewOrder(left: { order?: number; name: string; id: string }, right: { order?: number; name: string; id: string }): number {
  return (left.order || 0) - (right.order || 0)
    || left.name.localeCompare(right.name)
    || left.id.localeCompare(right.id)
}
