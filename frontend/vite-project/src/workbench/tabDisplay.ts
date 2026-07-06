import {
  buildEditorTitleModel,
  buildEditorLabelModels,
  shortReadableLabel,
  type EditorLabelInput,
} from "../vscode-adapter/workbench/browser/parts/editor/editorLabels"

export interface TabDisplayModel {
  path: string
  basename: string
  shortLabel: string
  tooltip: string
  duplicate: boolean
  description: string
  ariaLabel: string
  stateLabel: string
  stateClass: string
  dirty: boolean
  pinned: boolean
  active: boolean
}

export interface TabDisplayState {
  activeFile?: string | null
  dirtyFiles?: Record<string, unknown> | Set<string> | readonly string[] | null
  pinnedTabs?: Set<string> | readonly string[] | null
}

export interface ActiveEditorTitleInput extends TabDisplayState {
  path?: string | null
  projectName?: string | null
  fallbackRootLabel?: string | null
  largeFile?: boolean
}

export interface ActiveEditorTitleModel {
  name: string
  rootLabel: string
  relativePath: string
  dirty: boolean
  pinned: boolean
  largeFile: boolean
  tooltip: string
  ariaLabel: string
  stateLabel: string
  stateClass: string
}

export function buildTabDisplayModels(paths: string[], state: TabDisplayState = {}): Record<string, TabDisplayModel> {
  const inputs: EditorLabelInput[] = paths.map((path) => ({
    path,
    active: state.activeFile === path,
    dirty: hasPath(state.dirtyFiles, path),
    pinned: hasPath(state.pinnedTabs, path),
  }))
  const labels = buildEditorLabelModels(inputs)
  const models: Record<string, TabDisplayModel> = {}
  for (const path of paths) {
    const label = labels[path]
    if (!label) continue
    models[path] = {
      path,
      basename: label.name,
      shortLabel: label.shortLabel,
      tooltip: label.title,
      duplicate: label.duplicate,
      description: label.description,
      ariaLabel: label.ariaLabel,
      stateLabel: label.stateLabel,
      stateClass: label.stateClass,
      dirty: label.dirty,
      pinned: label.pinned,
      active: label.active,
    }
  }
  return models
}

export { shortReadableLabel }

export function buildActiveEditorTitleModel(input: ActiveEditorTitleInput = {}): ActiveEditorTitleModel {
  const path = input.path || ""
  const label = path ? buildEditorTitleModel({
    path,
    active: true,
    dirty: hasPath(input.dirtyFiles, path),
    pinned: hasPath(input.pinnedTabs, path),
  }) : null

  return {
    name: label?.name || "",
    rootLabel: input.projectName || input.fallbackRootLabel || "",
    relativePath: path,
    dirty: label?.dirty || false,
    pinned: label?.pinned || false,
    largeFile: Boolean(input.largeFile),
    tooltip: label?.title || path,
    ariaLabel: label?.ariaLabel || "",
    stateLabel: label?.stateLabel || "",
    stateClass: label?.stateClass || "",
  }
}

function hasPath(collection: TabDisplayState["dirtyFiles"] | TabDisplayState["pinnedTabs"], path: string): boolean {
  if (!collection) return false
  if (collection instanceof Set) return collection.has(path)
  if (Array.isArray(collection)) return collection.includes(path)
  return Boolean((collection as Record<string, unknown>)[path])
}
