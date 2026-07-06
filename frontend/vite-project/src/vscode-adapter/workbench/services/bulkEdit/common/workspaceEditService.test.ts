import { describe, expect, it, vi } from "vitest"
import { URI } from "../../../../base/common/uri"
import { Range } from "../../../../editor/common/core/range"
import { CodekUndoRedoService } from "../../../../platform/undoRedo/common/undoRedo"
import { ServiceCollection } from "../../../../platform/instantiation/common/serviceCollection"
import { InstantiationService } from "../../../../platform/instantiation/common/instantiationService"
import {
  CodekWorkspaceEditService,
  IWorkspaceEditService,
} from "./workspaceEditService"

describe("CodekWorkspaceEditService", () => {
  it("registers a VS Code-style workspace edit service identifier", () => {
    const service = new CodekWorkspaceEditService({ readFile: async () => "", saveFile: async () => true })
    const collection = new ServiceCollection([IWorkspaceEditService, service])
    const instantiationService = new InstantiationService(collection)

    const resolved = instantiationService.invokeFunction((accessor) => accessor.get(IWorkspaceEditService))

    expect(String(IWorkspaceEditService)).toBe("workspaceEditService")
    expect(resolved).toBe(service)
    expect(resolved._serviceBrand).toBeUndefined()
  })

  it("dry-runs workspace edits with rollback projection and no writes", async () => {
    const saveFile = vi.fn(async () => true)
    const service = new CodekWorkspaceEditService({
      readFile: async (path) => path === "src/a.ts" ? "const a = 'needle'\n" : "const b = 'needle'\n",
      saveFile,
    })

    const result = await service.apply({
      edits: [
        { resource: "src/a.ts", range: new Range(1, 12, 1, 18), text: "haystack", metadata: { match: "needle" } },
        { resource: "src/b.ts", range: new Range(1, 12, 1, 18), text: "haystack", metadata: { match: "needle" } },
      ],
    }, { dryRun: true, label: "agent workspace edit", source: "agent", reason: "approved edit" })

    expect(result.applied).toBe(false)
    expect(saveFile).not.toHaveBeenCalled()
    expect(result.projection).toEqual({
      source: "workspaceEditService",
      bulkEditServiceOwner: "CodekBulkEditService",
      workspaceEditOwner: "CodekWorkspaceEditService",
      resourceEditSource: "WorkspaceEdit.edits",
      textFileBridgeOwner: "BulkEditWorkspaceAccess.readFile/saveFile",
      undoRedoOwner: "CodekUndoRedoService",
      remainingEditorUiOwnerGap: "editor-ui-owner-gap",
      label: "agent workspace edit",
      dryRun: true,
      resources: [
        expect.objectContaining({
          resource: "src/a.ts",
          state: "changed",
          beforePreview: "const a = 'needle'",
          afterPreview: "const a = 'haystack'",
          rollbackAvailable: true,
          evidence: expect.objectContaining({ source: "agent", reason: "approved edit", match: "needle" }),
        }),
        expect.objectContaining({
          resource: "src/b.ts",
          state: "changed",
          beforePreview: "const b = 'needle'",
          afterPreview: "const b = 'haystack'",
          rollbackAvailable: true,
        }),
      ],
      changedResources: ["src/a.ts", "src/b.ts"],
      skippedResources: [],
      failedResources: [],
      rollbackRisk: "none",
    })
  })

  it("keeps owner evidence on the existing workspace edit projection without a second state source", async () => {
    const saved: Array<{ path: string; content: string; options?: Record<string, unknown> }> = []
    const service = new CodekWorkspaceEditService({
      readFile: async () => "needle\n",
      saveFile: async (path, content, options) => {
        saved.push({ path, content, options })
        return true
      },
    })

    const result = await service.apply({
      edits: [{
        resource: "src/only.ts",
        range: new Range(1, 1, 1, 7),
        text: "haystack",
        metadata: { source: "rename-provider", match: "needle" },
      }],
    }, { label: "rename", source: "extension-host", reason: "workspace rename" })

    expect(result.projection.source).toBe("workspaceEditService")
    expect(result.projection.bulkEditServiceOwner).toBe("CodekBulkEditService")
    expect(result.projection.workspaceEditOwner).toBe("CodekWorkspaceEditService")
    expect(result.projection.resourceEditSource).toBe("WorkspaceEdit.edits")
    expect(result.projection.textFileBridgeOwner).toBe("BulkEditWorkspaceAccess.readFile/saveFile")
    expect(result.projection.undoRedoOwner).toBe("CodekUndoRedoService")
    expect(result.projection.remainingEditorUiOwnerGap).toBe("editor-ui-owner-gap")
    expect(result.projection.remainingEditorUiOwnerGap).not.toContain("connected")
    expect(result.projection.resources[0].evidence).toEqual(expect.objectContaining({
      source: "extension-host",
      reason: "workspace rename",
      match: "needle",
    }))
    expect(saved).toEqual([{
      path: "src/only.ts",
      content: "haystack\n",
      options: { source: "extension-host", reason: "workspace rename" },
    }])
  })

  it("applies workspace edits through one service and pushes a grouped undo/redo element", async () => {
    const files: Record<string, string> = {
      "src/a.ts": "alpha needle\n",
      "src/b.ts": "beta needle\n",
    }
    const saveFile = vi.fn(async (path: string, content: string) => {
      files[path] = content
      return true
    })
    const undoRedoService = new CodekUndoRedoService()
    const service = new CodekWorkspaceEditService({
      readFile: async (path) => files[path],
      saveFile,
    }, { undoRedoService })

    const result = await service.apply({
      edits: [
        { resource: "src/a.ts", range: new Range(1, 7, 1, 13), text: "haystack" },
        { resource: "src/b.ts", range: new Range(1, 6, 1, 12), text: "haystack" },
      ],
    }, { label: "search replace", source: "user", reason: "search replace" })

    expect(result.applied).toBe(true)
    expect(result.undoRedo?.groupId).toBeGreaterThan(0)
    expect(result.undoRedo?.sourceId).toBeGreaterThan(0)
    expect(files).toEqual({
      "src/a.ts": "alpha haystack\n",
      "src/b.ts": "beta haystack\n",
    })

    await undoRedoService.undo(result.undoRedo!.source)

    expect(files).toEqual({
      "src/a.ts": "alpha needle\n",
      "src/b.ts": "beta needle\n",
    })

    await undoRedoService.redo(result.undoRedo!.source)

    expect(files).toEqual({
      "src/a.ts": "alpha haystack\n",
      "src/b.ts": "beta haystack\n",
    })
  })

  it("reports rollback risk for partial writes without pushing undo/redo", async () => {
    const undoRedoService = new CodekUndoRedoService()
    const service = new CodekWorkspaceEditService({
      readFile: async () => "needle\n",
      saveFile: async (path) => path !== "src/fail.ts",
    }, { undoRedoService })

    const result = await service.apply({
      edits: [
        { resource: "src/ok.ts", range: new Range(1, 1, 1, 7), text: "haystack" },
        { resource: "src/fail.ts", range: new Range(1, 1, 1, 7), text: "haystack" },
      ],
    }, { label: "agent edit", source: "agent" })

    expect(result.applied).toBe(false)
    expect(result.projection.rollbackRisk).toBe("partial-write")
    expect(result.projection.changedResources).toEqual(["src/ok.ts"])
    expect(result.projection.failedResources).toEqual(["src/fail.ts"])
    expect(result.undoRedo).toBeUndefined()
    expect(undoRedoService.canUndo(URI.file("src/ok.ts"))).toBe(false)
  })
})
