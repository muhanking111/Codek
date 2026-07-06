import { computed, reactive } from "vue"
import { workspace } from "../workspace/manager"

type CheckpointOperation = "agent" | "inline-edit" | "tab-completion" | "apply-diff"

interface Checkpoint {
  id: string
  timestamp: number
  files: ReadonlyMap<string, string>
  description: string
  operation: CheckpointOperation
}

const MAX_CHECKPOINTS = 50
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000

const state = reactive<{
  checkpoints: Checkpoint[]
  canRestore: boolean
}>({
  checkpoints: [],
  canRestore: false,
})

export const checkpointState = {
  checkpoints: state.checkpoints as readonly Checkpoint[],
  canRestore: computed<boolean>(() => state.canRestore),
  lastCheckpoint: computed<Checkpoint | null>(() => {
    if (state.checkpoints.length === 0) return null
    return state.checkpoints[state.checkpoints.length - 1]
  }),
}

function generateId(): string {
  return `ckpt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function readFileContents(filePaths: string[]): Map<string, string> {
  const files = new Map<string, string>()

  for (const filePath of filePaths) {
    const content = workspace.files[filePath]
    if (typeof content === "string") {
      files.set(filePath, content)
    }
  }

  return files
}

export function createCheckpoint(
  files: string[],
  description: string,
  operation: CheckpointOperation,
): string {
  const id = generateId()
  const fileSnapshots = readFileContents(files)

  const checkpoint: Checkpoint = {
    id,
    timestamp: Date.now(),
    files: fileSnapshots,
    description,
    operation,
  }

  state.checkpoints.push(checkpoint)

  if (state.checkpoints.length > MAX_CHECKPOINTS) {
    state.checkpoints.splice(0, state.checkpoints.length - MAX_CHECKPOINTS)
  }

  state.canRestore = true
  return id
}

interface RestoreResult {
  success: boolean
  restored: string[]
  errors: string[]
}

export function restoreCheckpoint(id: string): RestoreResult {
  const index = state.checkpoints.findIndex((ck) => ck.id === id)
  if (index === -1) {
    return { success: false, restored: [], errors: ["未找到检查点"] }
  }

  const checkpoint = state.checkpoints[index]
  const restored: string[] = []
  const errors: string[] = []

  for (const [filePath, content] of checkpoint.files) {
    try {
      workspace.files[filePath] = content
      restored.push(filePath)
    } catch {
      errors.push(`恢复失败：${filePath}`)
    }
  }

  return { success: errors.length === 0, restored, errors }
}

export function listCheckpoints(): Checkpoint[] {
  return [...state.checkpoints].sort((a, b) => b.timestamp - a.timestamp)
}

export function clearOldCheckpoints(maxAge: number = DEFAULT_MAX_AGE_MS): void {
  const cutoff = Date.now() - maxAge
  state.checkpoints = state.checkpoints.filter((ck) => ck.timestamp >= cutoff)
  state.canRestore = state.checkpoints.length > 0
}

export function setupAutoCheckpoint(
  editor: Record<string, unknown>,
): void {
  if (!editor) return

  const autoCreate = (
    filePaths: string[],
    description: string,
    operation: CheckpointOperation,
  ): string => {
    return createCheckpoint(filePaths, description, operation)
  }

  const editorObj = editor as Record<string, unknown>
  const originalDispatch = editorObj._dispatch as
    | ((action: Record<string, unknown>) => void)
    | undefined

  if (originalDispatch) {
    editorObj._dispatch = function (
      this: Record<string, unknown>,
      action: Record<string, unknown>,
    ) {
      if (
        action.type === "ai-edit-start" ||
        action.type === "inline-edit-start" ||
        action.type === "apply-diff-start"
      ) {
        const affectedFiles = (action.files as string[]) || []
        if (affectedFiles.length > 0) {
          autoCreate(
            affectedFiles,
            `Auto checkpoint before ${action.type}`,
            action.type === "apply-diff-start"
              ? "apply-diff"
              : action.type === "inline-edit-start"
                ? "inline-edit"
                : "agent",
          )
        }
      }
      originalDispatch.call(this, action)
    } as (action: Record<string, unknown>) => void
  }
}

export function clearAllCheckpoints(): void {
  state.checkpoints = []
  state.canRestore = false
}
