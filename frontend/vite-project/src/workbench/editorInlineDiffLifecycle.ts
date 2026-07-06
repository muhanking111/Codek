import type { CodekTextModel } from "../vscode-adapter/editor/common/model/textModelService"

export interface EditorInlineDiffFeatures {
  attachInlineDiffOverlay?: (editor: unknown, monaco: unknown) => (() => void) | null | undefined
  refreshInlineDiff?: (filePath: string | null) => void
}

export interface AgentEventLike {
  type?: string
  path?: string | null
}

export interface EditorInlineDiffModelInput {
  original: CodekTextModel | { getValue: () => string }
  modified: CodekTextModel | { getValue: () => string }
}

export function installEditorInlineDiffOverlay(
  editor: unknown,
  monaco: unknown,
  features: EditorInlineDiffFeatures,
): (() => void) | null {
  return features.attachInlineDiffOverlay?.(editor, monaco) || null
}

export function readInlineDiffModelValues(input: EditorInlineDiffModelInput): { before: string; after: string } {
  return {
    before: input.original.getValue(),
    after: input.modified.getValue(),
  }
}

export function shouldRefreshInlineDiffForAgentEvent(event: AgentEventLike): boolean {
  return event.type === "file-changed" || event.type === "diff-available"
}

export function installInlineDiffAgentRefresh(context: {
  onAgentEvent: (listener: (event: AgentEventLike) => void) => () => void
  refreshInlineDiff: (filePath: string | null) => void
  getActiveFile: () => string | null | undefined
}): () => void {
  return context.onAgentEvent((event) => {
    if (!shouldRefreshInlineDiffForAgentEvent(event)) return
    context.refreshInlineDiff(event.path || context.getActiveFile() || null)
  })
}
