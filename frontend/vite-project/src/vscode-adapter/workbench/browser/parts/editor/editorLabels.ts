/*---------------------------------------------------------------------------------------------
 * VS Code source adapter inspired by src/vs/workbench/browser/parts/editor/editorTabsControl.ts
 * and editor input label semantics. Keeps Codek tab/title rendering on a single
 * label model instead of duplicating basename/tooltip/dirty logic in App.vue.
 *--------------------------------------------------------------------------------------------*/

export interface EditorLabelInput {
  readonly path: string
  readonly active?: boolean
  readonly dirty?: boolean
  readonly pinned?: boolean
}

export interface EditorLabelModel {
  readonly path: string
  readonly name: string
  readonly description: string
  readonly shortLabel: string
  readonly title: string
  readonly ariaLabel: string
  readonly stateLabel: string
  readonly stateClass: string
  readonly duplicate: boolean
  readonly active: boolean
  readonly dirty: boolean
  readonly pinned: boolean
}

export function buildEditorLabelModels(inputs: readonly (string | EditorLabelInput)[]): Record<string, EditorLabelModel> {
  const normalized = inputs
    .map((input) => typeof input === "string" ? { path: input } : input)
    .filter((input) => Boolean(input?.path))

  const basenameCounts = new Map<string, number>()
  for (const input of normalized) {
    const name = basename(input.path)
    basenameCounts.set(name.toLowerCase(), (basenameCounts.get(name.toLowerCase()) || 0) + 1)
  }

  const models: Record<string, EditorLabelModel> = {}
  for (const input of normalized) {
    const name = basename(input.path)
    const duplicate = (basenameCounts.get(name.toLowerCase()) || 0) > 1
    const description = duplicate ? dirname(input.path) : ""
    const title = description ? `${name} - ${description}` : input.path
    const stateParts = [input.dirty ? "unsaved" : "", input.pinned ? "pinned" : ""].filter(Boolean)
    const state = stateParts.join(", ")
    models[input.path] = {
      path: input.path,
      name,
      description,
      shortLabel: shortReadableLabel(name),
      title,
      ariaLabel: state ? `${name}, ${state}` : name,
      stateLabel: state,
      stateClass: stateParts.join(" "),
      duplicate,
      active: Boolean(input.active),
      dirty: Boolean(input.dirty),
      pinned: Boolean(input.pinned),
    }
  }
  return models
}

export function buildEditorTitleModel(input: EditorLabelInput | null | undefined): EditorLabelModel | null {
  if (!input?.path) return null
  return buildEditorLabelModels([input])[input.path] || null
}

export function shortReadableLabel(name: string): string {
  const value = String(name || "").trim()
  if (!value) return "?"
  if (value.length <= 4) return value
  const dot = value.lastIndexOf(".")
  const stem = dot > 0 ? value.slice(0, dot) : value
  if (stem.length >= 2) return stem.slice(0, Math.min(4, stem.length))
  return value.slice(0, 4)
}

function basename(path: string): string {
  return normalizePath(path).split("/").filter(Boolean).pop() || String(path || "")
}

function dirname(path: string): string {
  const parts = normalizePath(path).split("/").filter(Boolean)
  parts.pop()
  return parts.join("/")
}

function normalizePath(path: string): string {
  return String(path || "").replace(/\\/g, "/")
}
