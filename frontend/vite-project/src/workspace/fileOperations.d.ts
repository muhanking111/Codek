export type FileOperationType =
  | "create_file"
  | "create_folder"
  | "update_file"
  | "delete_file"
  | "rename_move"
  | "copy_entry"

export type FileOperationRisk = "safe" | "medium" | "high"
export type FileOperationStatus = "pending" | "applied" | "failed" | "rolled_back" | "rollback_blocked"
export type FileOperationResourceUriKind = "workspace-relative" | "file-uri" | "unknown"

export interface FileOperation {
  id: string
  type: FileOperationType
  source: string
  explorerOwner: string
  fileServiceOwner: string
  operationSource: string
  resourceUriKind: FileOperationResourceUriKind
  readonlyGuard: string
  destructiveGuard: string
  remainingUiOwnerGap: string
  agentId: string | null
  runId: string | null
  pathBefore: string | null
  pathAfter: string | null
  beforeContent: string | null
  afterContent: string | null
  diff: string | null
  reason: string
  riskLevel: FileOperationRisk
  timestamp: number
  applyStatus: FileOperationStatus
  failureCause: string | null
  serviceOperation: string | null
  serviceOperationResult: number | string | null
  rollbackRisk: "none" | "unknown" | "partial-write" | null
  rollbackError: string | null
  rollbackAt: number | null
}

export interface FileOperationState {
  operations: FileOperation[]
}

export interface FileOperationInput {
  id?: string
  type: FileOperationType
  source?: string
  explorerOwner?: string | null
  fileServiceOwner?: string | null
  operationSource?: string | null
  resourceUriKind?: FileOperationResourceUriKind | string | null
  readonlyGuard?: string | null
  destructiveGuard?: string | null
  remainingUiOwnerGap?: string | null
  agentId?: string | null
  runId?: string | null
  pathBefore?: string | null
  pathAfter?: string | null
  beforeContent?: string | null
  afterContent?: string | null
  diff?: string | null
  reason?: string
  riskLevel?: FileOperationRisk
  timestamp?: number
  applyStatus?: FileOperationStatus
  failureCause?: string | null
  serviceOperation?: string | null
  serviceOperationResult?: number | string | null
  rollbackRisk?: "none" | "unknown" | "partial-write" | null
}

export interface FileOperationFilter {
  source?: string
  agentId?: string
  runId?: string
  path?: string
}

export interface FileOperationEvent {
  type: "recorded" | "status" | "rolled_back"
  operation: FileOperation
}

export interface FileOperationApplier {
  readFile?: (path: string) => Promise<string | null>
  writeFile?: (path: string, content: string, options?: Record<string, unknown>) => Promise<boolean>
  deleteFile?: (path: string, options?: Record<string, unknown>) => Promise<boolean>
  renameEntry?: (oldPath: string, newPath: string, options?: Record<string, unknown>) => Promise<boolean>
}

export const fileOperationState: FileOperationState
export function subscribeFileOperations(listener: (event: FileOperationEvent) => void): () => boolean
export function clearFileOperations(): void
export function getFileOperations(filter?: FileOperationFilter): FileOperation[]
export function recordFileOperation(input: FileOperationInput): FileOperation | null
export function updateFileOperationStatus(
  operationId: string,
  applyStatus: FileOperationStatus,
  patch?: Partial<FileOperation>,
): FileOperation | null
export function rollbackFileOperation(
  operationId: string,
  applier: FileOperationApplier,
  options?: { protectUserChanges?: boolean },
): Promise<{ ok: boolean; reason?: string; operation?: FileOperation }>
