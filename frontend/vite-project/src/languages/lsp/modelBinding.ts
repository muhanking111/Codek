import type { editor } from "monaco-editor"

interface BoundLspModelDocument {
  readonly filePath: string
  readonly documentUri: string
}

const modelBindings = new WeakMap<object, BoundLspModelDocument>()
const modelUriBindings = new Map<string, BoundLspModelDocument>()

function getModelUriKey(model: editor.ITextModel | null | undefined): string | null {
  const uri = (model as { uri?: { toString(): string } } | null | undefined)?.uri
  return uri && typeof uri.toString === "function" ? uri.toString() : null
}

export function bindLspModelDocument(
  model: editor.ITextModel | null | undefined,
  binding: BoundLspModelDocument,
): void {
  if (!model) return
  modelBindings.set(model as object, binding)
  const key = getModelUriKey(model)
  if (key) modelUriBindings.set(key, binding)
}

export function clearLspModelDocumentBinding(model: editor.ITextModel | null | undefined): void {
  if (!model) return
  const existing = modelBindings.get(model as object)
  modelBindings.delete(model as object)
  const key = getModelUriKey(model)
  if (key && existing && modelUriBindings.get(key) === existing) {
    modelUriBindings.delete(key)
  }
}

export function getBoundLspModelDocument(model: editor.ITextModel | null | undefined): BoundLspModelDocument | null {
  if (!model) return null
  return modelBindings.get(model as object) ?? null
}

export function getBoundLspModelDocumentByModelUri(modelUri: string | null | undefined): BoundLspModelDocument | null {
  if (!modelUri) return null
  return modelUriBindings.get(modelUri) ?? null
}
