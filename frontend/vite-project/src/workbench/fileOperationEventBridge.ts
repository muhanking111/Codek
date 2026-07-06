import { emitAgentEvent } from "../agent/agentEvents"
import { subscribeFileOperations, type FileOperation, type FileOperationEvent } from "../workspace/fileOperations"

function operationPath(operation: FileOperation): string | null {
  return operation.pathAfter || operation.pathBefore || null
}

function actionFromOperation(operation: FileOperation): string {
  if (operation.type === "create_file" || operation.type === "create_folder") return "create"
  if (operation.type === "update_file") return "write"
  if (operation.type === "delete_file") return "delete"
  if (operation.type === "rename_move") return "rename"
  return operation.type
}

function isDestructiveOperation(operation: FileOperation): boolean {
  return operation.type === "delete_file" || operation.type === "rename_move"
}

export function toWorkspaceFileOperationPayload(operation: FileOperation): Record<string, unknown> {
  return {
    operationId: operation.id,
    type: operation.type,
    source: operation.source,
    explorerOwner: operation.explorerOwner || "ExplorerService",
    fileServiceOwner: operation.fileServiceOwner || "IFileService",
    operationSource: operation.operationSource || `workspace.fileOperations.${operation.source || "user"}`,
    resourceUriKind: operation.resourceUriKind || "workspace-relative",
    readonlyGuard: operation.readonlyGuard || "not-evaluated",
    destructiveGuard: operation.destructiveGuard || (isDestructiveOperation(operation) ? "operation-log-required" : "not-destructive"),
    remainingUiOwnerGap: operation.remainingUiOwnerGap || "service-evidence-only",
    agentId: operation.agentId,
    runId: operation.runId,
    path: operationPath(operation),
    pathBefore: operation.pathBefore,
    pathAfter: operation.pathAfter,
    action: actionFromOperation(operation),
    status: operation.applyStatus,
    riskLevel: operation.riskLevel,
    reason: operation.reason,
    timestamp: operation.timestamp,
  }
}

export function shouldEmitAgentFileEvents(event: FileOperationEvent): boolean {
  return (
    event.operation.source === "agent"
    && (event.type === "recorded" || event.type === "rolled_back")
  )
}

export function installFileOperationEventBridge(): () => boolean {
  return subscribeFileOperations((event) => {
    const payload = toWorkspaceFileOperationPayload(event.operation)
    emitAgentEvent({
      type: "workspace-file-operation",
      payload: {
        ...payload,
        eventType: event.type,
      },
    })

    if (!shouldEmitAgentFileEvents(event)) return

    emitAgentEvent({
      type: "file-changed",
      payload: {
        ...payload,
        eventType: event.type,
      },
    })

    if (event.operation.type === "update_file" || event.operation.type === "create_file") {
      emitAgentEvent({
        type: "diff-available",
        payload: {
          ...payload,
          eventType: event.type,
        },
      })
    }
  })
}
