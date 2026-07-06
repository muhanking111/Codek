import { afterEach, describe, expect, it, vi } from "vitest"
import {
  clearFileOperations,
  fileOperationState,
  getFileOperations,
  recordFileOperation,
  rollbackFileOperation,
  subscribeFileOperations,
} from "./fileOperations"

afterEach(() => {
  clearFileOperations()
})

describe("workspace file operation pipeline", () => {
  it("records auditable file operations and publishes events", () => {
    const events: unknown[] = []
    const unsubscribe = subscribeFileOperations((event) => events.push(event))

    const operation = recordFileOperation({
      type: "update_file",
      source: "agent",
      agentId: "agent-a",
      runId: "run-1",
      pathBefore: "src/main.ts",
      pathAfter: "src/main.ts",
      beforeContent: "export const value = 1",
      afterContent: "export const value = 2",
      reason: "apply agent edit",
    })

    unsubscribe()

    expect(operation).toMatchObject({
      type: "update_file",
      source: "agent",
      agentId: "agent-a",
      runId: "run-1",
      pathBefore: "src/main.ts",
      pathAfter: "src/main.ts",
      riskLevel: "medium",
      applyStatus: "applied",
    })
    expect(fileOperationState.operations).toHaveLength(1)
    expect(events).toHaveLength(1)
    expect(getFileOperations({ source: "agent", path: "src/main.ts" })).toHaveLength(1)
  })

  it("keeps Explorer and FileService owner evidence on the existing operation entry", () => {
    const operation = recordFileOperation({
      type: "delete_file",
      source: "user",
      pathBefore: "src/remove.ts",
      explorerOwner: "ExplorerService",
      fileServiceOwner: "IFileService",
      operationSource: "explorer.context.delete",
      resourceUriKind: "workspace-relative",
      readonlyGuard: "writable",
      destructiveGuard: "confirmation-required",
      remainingUiOwnerGap: "partial-service-evidence-only",
    })

    expect(fileOperationState.operations).toHaveLength(1)
    expect(operation).toMatchObject({
      explorerOwner: "ExplorerService",
      fileServiceOwner: "IFileService",
      operationSource: "explorer.context.delete",
      resourceUriKind: "workspace-relative",
      readonlyGuard: "writable",
      destructiveGuard: "confirmation-required",
      remainingUiOwnerGap: "partial-service-evidence-only",
    })
  })

  it("rolls back an agent update only when the current file still matches the operation afterContent", async () => {
    let current = "agent result"
    const operation = recordFileOperation({
      type: "update_file",
      source: "agent",
      pathBefore: "src/main.ts",
      pathAfter: "src/main.ts",
      beforeContent: "before",
      afterContent: "agent result",
    })
    const applier = {
      readFile: vi.fn(async () => current),
      writeFile: vi.fn(async (_path: string, content: string) => {
        current = content
        return true
      }),
    }

    await expect(rollbackFileOperation(operation!.id, applier)).resolves.toMatchObject({ ok: true })

    expect(current).toBe("before")
    expect(applier.writeFile).toHaveBeenCalledWith("src/main.ts", "before", { recordOperation: false })
    expect(fileOperationState.operations[0]).toMatchObject({ applyStatus: "rolled_back" })
  })

  it("blocks rollback when the user changed the file after the agent operation", async () => {
    const operation = recordFileOperation({
      type: "update_file",
      source: "agent",
      pathBefore: "src/main.ts",
      pathAfter: "src/main.ts",
      beforeContent: "before",
      afterContent: "agent result",
    })
    const applier = {
      readFile: vi.fn(async () => "manual user edit"),
      writeFile: vi.fn(async () => true),
    }

    await expect(rollbackFileOperation(operation!.id, applier)).resolves.toMatchObject({
      ok: false,
      reason: "manual-change-detected",
    })

    expect(applier.writeFile).not.toHaveBeenCalled()
    expect(fileOperationState.operations[0]).toMatchObject({
      applyStatus: "rollback_blocked",
      rollbackError: "manual-change-detected",
    })
  })

  it("restores deleted files from operation log without git reset", async () => {
    const operation = recordFileOperation({
      type: "delete_file",
      source: "agent",
      pathBefore: "src/old.ts",
      beforeContent: "deleted content",
      riskLevel: "high",
    })
    const writeFile = vi.fn(async () => true)

    await expect(rollbackFileOperation(operation!.id, { writeFile })).resolves.toMatchObject({ ok: true })

    expect(writeFile).toHaveBeenCalledWith("src/old.ts", "deleted content", { recordOperation: false })
  })

  it("does not execute a destructive delete during rollback when the caller supplies no delete applier", async () => {
    const operation = recordFileOperation({
      type: "create_file",
      source: "user",
      pathAfter: "src/new.ts",
      afterContent: "created",
      destructiveGuard: "mock-applier-required",
    })

    await expect(rollbackFileOperation(operation!.id, { readFile: vi.fn(async () => "created") })).resolves.toMatchObject({
      ok: false,
      reason: "missing-delete-applier",
    })
  })

  it("rolls back rename and move operations through the supplied applier", async () => {
    const operation = recordFileOperation({
      type: "rename_move",
      source: "agent",
      pathBefore: "src/old.ts",
      pathAfter: "src/new.ts",
      riskLevel: "high",
    })
    const renameEntry = vi.fn(async () => true)

    await expect(rollbackFileOperation(operation!.id, { renameEntry })).resolves.toMatchObject({ ok: true })

    expect(renameEntry).toHaveBeenCalledWith("src/new.ts", "src/old.ts", { recordOperation: false })
  })
})
