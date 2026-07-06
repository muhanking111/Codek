import { afterEach, describe, expect, it } from "vitest"
import { changeHistory, clearChanges, recordChange, revertChange } from "./changeHistory"
import { clearFileOperations, fileOperationState } from "./fileOperations"
import { resetTextFileStates, workspace } from "./manager"

function resetWorkspace() {
  workspace.files = {}
  workspace.openFiles = []
  workspace.activeFile = null
  workspace.projectRoot = null
  resetTextFileStates()
}

afterEach(() => {
  clearChanges()
  clearFileOperations()
  resetWorkspace()
})

describe("workspace change history operation rollback", () => {
  it("stores an operation id for applied agent changes", () => {
    const entry = recordChange({
      path: "src/main.ts",
      beforeContent: "before",
      afterContent: "after",
      source: "agent",
      action: "write",
    })

    expect(entry?.operationId).toBe(fileOperationState.operations[0]?.id)
    expect(fileOperationState.operations[0]).toMatchObject({
      type: "update_file",
      source: "agent",
      pathBefore: "src/main.ts",
      pathAfter: "src/main.ts",
    })
  })

  it("rolls back an unchanged agent edit through the operation log", async () => {
    workspace.files = { "src/main.ts": "after" }
    const entry = recordChange({
      path: "src/main.ts",
      beforeContent: "before",
      afterContent: "after",
      source: "agent",
      action: "write",
    })

    await expect(revertChange(entry!.id)).resolves.toBe(true)

    expect(workspace.files["src/main.ts"]).toBe("before\n")
    expect(changeHistory.entries).toHaveLength(0)
    expect(fileOperationState.operations[0]).toMatchObject({ applyStatus: "rolled_back" })
  })

  it("does not overwrite user edits made after an agent change", async () => {
    workspace.files = { "src/main.ts": "manual user edit" }
    const entry = recordChange({
      path: "src/main.ts",
      beforeContent: "before",
      afterContent: "after",
      source: "agent",
      action: "write",
    })

    await expect(revertChange(entry!.id)).resolves.toBe(false)

    expect(workspace.files["src/main.ts"]).toBe("manual user edit")
    expect(changeHistory.entries).toHaveLength(1)
    expect(changeHistory.entries[0]).toMatchObject({
      applyStatus: "rollback_blocked",
      rollbackError: "manual-change-detected",
    })
    expect(fileOperationState.operations[0]).toMatchObject({
      applyStatus: "rollback_blocked",
      rollbackError: "manual-change-detected",
    })
  })
})
