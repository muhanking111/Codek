import { afterEach, describe, expect, it, vi } from "vitest"
import { clearFileOperations, recordFileOperation } from "../workspace/fileOperations"
import {
  installFileOperationEventBridge,
  shouldEmitAgentFileEvents,
  toWorkspaceFileOperationPayload,
} from "./fileOperationEventBridge"

const emitted: unknown[] = []

vi.mock("../agent/agentEvents", () => ({
  emitAgentEvent: vi.fn((event: unknown) => {
    emitted.push(event)
  }),
}))

afterEach(() => {
  emitted.length = 0
  clearFileOperations()
})

describe("fileOperationEventBridge", () => {
  it("maps operation metadata to a workbench event payload", () => {
    const operation = recordFileOperation({
      id: "op-1",
      type: "rename_move",
      source: "agent",
      agentId: "agent-a",
      runId: "run-a",
      pathBefore: "src/old.ts",
      pathAfter: "src/new.ts",
      reason: "agent move",
    })!

    expect(toWorkspaceFileOperationPayload(operation)).toMatchObject({
      operationId: "op-1",
      type: "rename_move",
      source: "agent",
      explorerOwner: "ExplorerService",
      fileServiceOwner: "IFileService",
      operationSource: "workspace.fileOperations.agent",
      resourceUriKind: "workspace-relative",
      readonlyGuard: "not-evaluated",
      destructiveGuard: "operation-log-required",
      remainingUiOwnerGap: "service-evidence-only",
      agentId: "agent-a",
      runId: "run-a",
      path: "src/new.ts",
      pathBefore: "src/old.ts",
      pathAfter: "src/new.ts",
      action: "rename",
      status: "applied",
      reason: "agent move",
    })
  })

  it("preserves explicit owner evidence from the operation log", () => {
    const operation = recordFileOperation({
      id: "op-explicit",
      type: "delete_file",
      source: "user",
      pathBefore: "src/remove.ts",
      explorerOwner: "FileTree",
      fileServiceOwner: "workspaceManager.deleteFile",
      operationSource: "explorer.context.delete",
      resourceUriKind: "workspace-relative",
      readonlyGuard: "writable",
      destructiveGuard: "confirmed",
      remainingUiOwnerGap: "partial-ui-owner",
    })!

    expect(toWorkspaceFileOperationPayload(operation)).toMatchObject({
      explorerOwner: "FileTree",
      fileServiceOwner: "workspaceManager.deleteFile",
      operationSource: "explorer.context.delete",
      resourceUriKind: "workspace-relative",
      readonlyGuard: "writable",
      destructiveGuard: "confirmed",
      remainingUiOwnerGap: "partial-ui-owner",
    })
  })

  it("emits generic workspace operation events for every file operation", () => {
    const detach = installFileOperationEventBridge()

    recordFileOperation({
      type: "update_file",
      source: "user",
      pathBefore: "src/main.ts",
      pathAfter: "src/main.ts",
      beforeContent: "before",
      afterContent: "after",
    })

    detach()

    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      type: "workspace-file-operation",
      payload: {
        source: "user",
        action: "write",
        path: "src/main.ts",
      },
    })
  })

  it("emits existing file-changed and diff events for agent mutations", () => {
    const detach = installFileOperationEventBridge()

    recordFileOperation({
      type: "update_file",
      source: "agent",
      pathBefore: "src/main.ts",
      pathAfter: "src/main.ts",
      beforeContent: "before",
      afterContent: "after",
    })

    detach()

    expect(emitted.map((event) => (event as { type: string }).type)).toEqual([
      "workspace-file-operation",
      "file-changed",
      "diff-available",
    ])
  })

  it("does not treat user operations as agent file events", () => {
    const agentOperation = recordFileOperation({
      type: "update_file",
      source: "agent",
      pathAfter: "src/agent.ts",
    })!
    const userOperation = recordFileOperation({
      type: "update_file",
      source: "user",
      pathAfter: "src/user.ts",
    })!

    expect(shouldEmitAgentFileEvents({ type: "recorded", operation: agentOperation })).toBe(true)
    expect(shouldEmitAgentFileEvents({ type: "recorded", operation: userOperation })).toBe(false)
    expect(shouldEmitAgentFileEvents({ type: "status", operation: agentOperation })).toBe(false)
  })
})
