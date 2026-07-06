import { describe, expect, it, vi } from "vitest"
import { CancellationTokenSource } from "../../../../base/common/cancellation"
import { Range } from "../../../../editor/common/core/range"
import { ServiceCollection } from "../../../../platform/instantiation/common/serviceCollection"
import { InstantiationService } from "../../../../platform/instantiation/common/instantiationService"
import { CodekBulkEditService, IBulkEditService } from "./bulkEditService"

describe("CodekBulkEditService", () => {
  it("registers a VS Code-style service identifier and resolves through ServiceCollection", () => {
    const service = new CodekBulkEditService({ readFile: async () => "", saveFile: async () => true })
    const collection = new ServiceCollection([IBulkEditService, service])
    const instantiationService = new InstantiationService(collection)

    const resolved = instantiationService.invokeFunction((accessor) => accessor.get(IBulkEditService))

    expect(String(IBulkEditService)).toBe("bulkEditService")
    expect(resolved).toBe(service)
    expect(resolved._serviceBrand).toBeUndefined()
  })

  it("dry-runs text edits and returns a risk summary without saving files", async () => {
    const saveFile = vi.fn(async () => true)
    const service = new CodekBulkEditService({
      readFile: async (path) => path === "src/a.ts" ? "first needle\nsecond needle\n" : "other needle\n",
      saveFile,
    })

    const result = await service.apply({
      edits: [
        { resource: "src/a.ts", range: new Range(1, 7, 1, 13), text: "haystack" },
        { resource: "src/b.ts", range: new Range(1, 7, 1, 13), text: "haystack" },
      ],
    }, { dryRun: true, label: "search replace" })

    expect(result.applied).toBe(false)
    expect(result.dryRun).toBe(true)
    expect(saveFile).not.toHaveBeenCalled()
    expect(result.summary).toEqual(expect.objectContaining({
      fileCount: 2,
      editCount: 2,
      changedFileCount: 2,
      skippedFileCount: 0,
      failureCount: 0,
      riskLevel: "medium",
      rollbackDescription: expect.stringContaining("重新运行相反补丁"),
    }))
  })

  it("applies grouped text edits through the provided workspace save path", async () => {
    const saveFile = vi.fn(async () => true)
    const service = new CodekBulkEditService({
      readFile: async () => "alpha needle\nbeta needle\n",
      saveFile,
    })

    const result = await service.apply({
      edits: [
        { resource: "src/a.ts", range: new Range(2, 6, 2, 12), text: "haystack" },
        { resource: "src/a.ts", range: new Range(1, 7, 1, 13), text: "haystack" },
      ],
    }, {
      label: "search replace",
      saveOptions: { source: "user", reason: "search replace" },
    })

    expect(result.applied).toBe(true)
    expect(result.projection).toEqual(expect.objectContaining({
      source: "workspaceEditService",
      bulkEditServiceOwner: "CodekBulkEditService",
      workspaceEditOwner: "CodekWorkspaceEditService",
      resourceEditSource: "WorkspaceEdit.edits",
      textFileBridgeOwner: "BulkEditWorkspaceAccess.readFile/saveFile",
      undoRedoOwner: "CodekUndoRedoService",
      remainingEditorUiOwnerGap: "editor-ui-owner-gap",
      label: "search replace",
      changedResources: ["src/a.ts"],
      rollbackRisk: "none",
    }))
    expect(result.undoRedo).toEqual(expect.objectContaining({
      resources: ["src/a.ts"],
      sourceId: expect.any(Number),
      groupId: expect.any(Number),
    }))
    expect(saveFile).toHaveBeenCalledWith(
      "src/a.ts",
      "alpha haystack\nbeta haystack\n",
      { source: "user", reason: "search replace" },
    )
    expect(result.summary.changedFiles).toEqual(["src/a.ts"])
  })

  it("exposes workspace edit owner evidence from the single workspace edit projection", async () => {
    const service = new CodekBulkEditService({
      readFile: async () => "needle\n",
      saveFile: async () => true,
    })

    const result = await service.apply({
      edits: [{ resource: "src/a.ts", range: new Range(1, 1, 1, 7), text: "haystack" }],
    }, { label: "bulk rename", source: "extension-host", reason: "workspace edit" })

    expect(result.projection).toEqual(expect.objectContaining({
      source: "workspaceEditService",
      bulkEditServiceOwner: "CodekBulkEditService",
      workspaceEditOwner: "CodekWorkspaceEditService",
      resourceEditSource: "WorkspaceEdit.edits",
      textFileBridgeOwner: "BulkEditWorkspaceAccess.readFile/saveFile",
      undoRedoOwner: "CodekUndoRedoService",
      remainingEditorUiOwnerGap: "editor-ui-owner-gap",
    }))
    expect(result.projection?.resources[0].evidence).toEqual(expect.objectContaining({
      source: "extension-host",
      reason: "workspace edit",
    }))
  })

  it("skips unchanged edits and records failures without throwing by default", async () => {
    const service = new CodekBulkEditService({
      readFile: async (path) => path === "src/missing.ts" ? null : "needle\n",
      saveFile: async () => true,
    })

    const result = await service.apply({
      edits: [
        { resource: "src/unchanged.ts", range: new Range(1, 1, 1, 7), text: "needle" },
        { resource: "src/missing.ts", range: new Range(1, 1, 1, 7), text: "haystack" },
      ],
    })

    expect(result.applied).toBe(false)
    expect(result.summary.skippedFiles).toEqual(["src/unchanged.ts"])
    expect(result.summary.failures).toEqual([expect.objectContaining({
      resource: "src/missing.ts",
      message: expect.stringContaining("Cannot read"),
    })])
  })

  it("does not mark files changed when the workspace save path rejects the edit", async () => {
    const service = new CodekBulkEditService({
      readFile: async () => "needle\n",
      saveFile: async () => false,
    })

    const result = await service.apply({
      edits: [{ resource: "src/rejected.ts", range: new Range(1, 1, 1, 7), text: "haystack" }],
    }, { label: "search replace" })

    expect(result.applied).toBe(false)
    expect(result.summary.changedFiles).toEqual([])
    expect(result.summary.failureCount).toBe(1)
    expect(result.summary.failures[0]).toEqual(expect.objectContaining({
      resource: "src/rejected.ts",
      message: expect.stringContaining("Save rejected"),
      operation: "save",
      reason: "save-rejected",
      rollbackRisk: "none",
    }))
    expect(result.summary.rollbackDescription).toContain("无需回滚")
  })

  it("reports partial failure rollback risk with changed and failed resources", async () => {
    const saveFile = vi.fn(async (path: string) => path !== "src/fail.ts")
    const service = new CodekBulkEditService({
      readFile: async () => "needle\n",
      saveFile,
    })

    const result = await service.apply({
      edits: [
        { resource: "src/ok.ts", range: new Range(1, 1, 1, 7), text: "haystack" },
        { resource: "src/fail.ts", range: new Range(1, 1, 1, 7), text: "haystack" },
      ],
    }, { label: "search replace" })

    expect(result.applied).toBe(false)
    expect(result.summary.changedFiles).toEqual(["src/ok.ts"])
    expect(result.projection).toEqual(expect.objectContaining({
      source: "workspaceEditService",
      changedResources: ["src/ok.ts"],
      failedResources: ["src/fail.ts"],
      rollbackRisk: "partial-write",
    }))
    expect(result.undoRedo).toBeUndefined()
    expect(result.summary.failures).toEqual([expect.objectContaining({
      resource: "src/fail.ts",
      operation: "save",
      reason: "save-rejected",
      rollbackRisk: "partial-write",
      range: expect.objectContaining({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 }),
    })])
    expect(result.summary.riskLevel).toBe("high")
    expect(result.summary.rollbackDescription).toContain("部分文件已经写入")
    expect(result.summary.rollbackDescription).toContain("src/ok.ts")
    expect(result.summary.rollbackDescription).toContain("src/fail.ts")
  })

  it("records read failure evidence with resource, range, operation, reason and match", async () => {
    const service = new CodekBulkEditService({
      readFile: async () => {
        throw new Error("permission denied")
      },
      saveFile: async () => true,
    })

    const result = await service.apply({
      edits: [{
        resource: "src/private.ts",
        range: new Range(3, 5, 3, 11),
        text: "haystack",
        metadata: { match: "needle" },
      }],
    }, { label: "search replace" })

    expect(result.applied).toBe(false)
    expect(result.summary.failures).toEqual([expect.objectContaining({
      resource: "src/private.ts",
      message: "permission denied",
      operation: "read",
      reason: "read-error",
      rollbackRisk: "none",
      match: "needle",
      range: expect.objectContaining({ startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 11 }),
    })])
  })

  it("honors CancellationToken before applying writes", async () => {
    const source = new CancellationTokenSource()
    source.cancel()
    const saveFile = vi.fn(async () => true)
    const service = new CodekBulkEditService({
      readFile: async () => "needle\n",
      saveFile,
    })

    await expect(service.apply({
      edits: [{ resource: "src/a.ts", range: new Range(1, 1, 1, 7), text: "haystack" }],
    }, {}, source.token)).rejects.toMatchObject({ name: "AbortError" })

    expect(saveFile).not.toHaveBeenCalled()
  })
})
