import { afterEach, describe, expect, it } from "vitest"
import {
  applyPendingBatch,
  applyPendingFile,
  applyPendingHunk,
  clearPendingBatches,
  pendingChangeState,
  queuePendingBatch,
  rejectPendingFile,
} from "./changeQueue"
import { changeHistory, clearChanges } from "./changeHistory"
import { clearFileOperations } from "./fileOperations"
import { resetTextFileStates, workspace } from "./manager"
import { computeHunks } from "../editor/lineDiff"

function resetWorkspace() {
  workspace.files = {}
  workspace.openFiles = []
  workspace.activeFile = null
  workspace.projectRoot = null
  resetTextFileStates()
}

afterEach(() => {
  clearPendingBatches()
  clearChanges()
  clearFileOperations()
  resetWorkspace()
})

describe("pending agent change queue stale guards", () => {
  it("does not apply a pending batch over user edits made after queueing", async () => {
    workspace.files = { "src/app.ts": "manual user edit" }
    const batch = queuePendingBatch({
      source: "agent",
      action: "patch",
      changes: [{
        path: "src/app.ts",
        beforeContent: "original",
        afterContent: "agent patch",
      }],
    })

    await expect(applyPendingBatch(batch!.id)).resolves.toBe(false)

    expect(workspace.files["src/app.ts"]).toBe("manual user edit")
    expect(pendingChangeState.batches).toHaveLength(1)
    expect(pendingChangeState.batches[0]).toMatchObject({
      applyStatus: "blocked",
      blockReason: "manual-change-detected",
    })
    expect(changeHistory.entries).toHaveLength(0)
  })

  it("does not apply a pending hunk when the file drifted from the queued beforeContent", async () => {
    workspace.files = { "src/app.ts": "manual user edit" }
    const batch = queuePendingBatch({
      source: "agent",
      action: "patch",
      changes: [{
        path: "src/app.ts",
        beforeContent: "const a = 1\nconst b = 2",
        afterContent: "const a = 10\nconst b = 2",
      }],
    })

    const [hunk] = computeHunks("const a = 1\nconst b = 2", "const a = 10\nconst b = 2")

    await expect(applyPendingHunk(batch!.id, "src/app.ts", hunk.id)).resolves.toBe(false)

    expect(workspace.files["src/app.ts"]).toBe("manual user edit")
    expect(pendingChangeState.batches[0]).toMatchObject({
      applyStatus: "blocked",
      blockReason: "manual-change-detected",
    })
    expect(changeHistory.entries).toHaveLength(0)
  })

  it("applies a single pending file without applying the rest of the batch", async () => {
    workspace.files = {
      "src/app.ts": "const app = 1",
      "src/other.ts": "const other = 1",
    }
    const batch = queuePendingBatch({
      source: "agent",
      action: "patch",
      changes: [
        {
          path: "src/app.ts",
          beforeContent: "const app = 1",
          afterContent: "const app = 2",
        },
        {
          path: "src/other.ts",
          beforeContent: "const other = 1",
          afterContent: "const other = 2",
        },
      ],
    })

    await expect(applyPendingFile(batch!.id, "src/app.ts")).resolves.toBe(true)

    expect(workspace.files["src/app.ts"]).toBe("const app = 2\n")
    expect(workspace.files["src/other.ts"]).toBe("const other = 1")
    expect(pendingChangeState.batches).toHaveLength(1)
    expect(pendingChangeState.batches[0].changes).toHaveLength(1)
    expect(pendingChangeState.batches[0].changes[0].path).toBe("src/other.ts")
    expect(changeHistory.entries).toHaveLength(1)
  })

  it("rejects a single pending file and keeps other pending files", () => {
    const batch = queuePendingBatch({
      source: "agent",
      action: "patch",
      changes: [
        {
          path: "src/app.ts",
          beforeContent: "const app = 1",
          afterContent: "const app = 2",
        },
        {
          path: "src/other.ts",
          beforeContent: "const other = 1",
          afterContent: "const other = 2",
        },
      ],
    })

    expect(rejectPendingFile(batch!.id, "src/app.ts")).toBe(true)

    expect(pendingChangeState.batches).toHaveLength(1)
    expect(pendingChangeState.batches[0].changes).toHaveLength(1)
    expect(pendingChangeState.batches[0].changes[0].path).toBe("src/other.ts")
  })
})
