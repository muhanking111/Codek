import { describe, expect, it, vi } from "vitest"
import { FileChangeType } from "../../../platform/files/common/files"
import {
  createWorkspaceOperationFileChangesEvent,
  getWorkspaceOperationFileChanges,
  getWorkspaceOperationRefreshPaths,
  isWorkspaceOperationPathAffected,
  normalizeWorkspaceOperationPath,
} from "./fileOperationRefreshModel"

describe("VS Code file operation refresh model adapter", () => {
  it("normalizes workspace operation paths through the caller normalizer", () => {
    const normalizePath = vi.fn((path: string) => path.replace(/\\/g, "/").replace(/^src\//, "app/"))

    expect(normalizeWorkspaceOperationPath("src\\main.ts", normalizePath)).toBe("app/main.ts")
    expect(normalizePath).toHaveBeenCalledWith("src\\main.ts")
  })

  it("deduplicates equivalent workspace resource paths case-insensitively", () => {
    expect(getWorkspaceOperationRefreshPaths({
      path: "SRC\\Main.ts",
      pathAfter: "src/main.ts",
    })).toEqual(["src/main.ts"])
  })

  it("maps rename payloads into VS Code FileChangesEvent entries", () => {
    const changes = getWorkspaceOperationFileChanges({
      type: "rename_move",
      pathBefore: "src/old.ts",
      pathAfter: "src/new.ts",
    })

    expect(changes.map((change) => ({ type: change.type, path: change.resource.path }))).toEqual([
      { type: FileChangeType.DELETED, path: "/src/old.ts" },
      { type: FileChangeType.ADDED, path: "/src/new.ts" },
    ])
    expect(createWorkspaceOperationFileChangesEvent({ type: "delete_file", path: "src" }).contains(
      changes[0].resource.with({ path: "/src/old.ts" }),
    )).toBe(true)
  })

  it("accepts owner evidence fields without changing file change derivation", () => {
    const payload = {
      type: "delete_file",
      action: "delete",
      pathBefore: "src/remove.ts",
      explorerOwner: "ExplorerService",
      fileServiceOwner: "IFileService",
      operationSource: "FileService.onDidRunOperation",
      resourceUriKind: "file-uri",
      readonlyGuard: "writable",
      destructiveGuard: "confirmed",
      remainingUiOwnerGap: "service-evidence-only",
    }

    expect(getWorkspaceOperationFileChanges(payload).map((change) => [change.type, change.resource.path])).toEqual([
      [FileChangeType.DELETED, "/src/remove.ts"],
    ])
    expect(getWorkspaceOperationRefreshPaths(payload)).toEqual(["src/remove.ts"])
  })

  it("uses FileChangesEvent parent matching for active child files", () => {
    expect(isWorkspaceOperationPathAffected({
      targetPath: "src/generated/page.ts",
      operationPaths: ["src/generated"],
      payload: { type: "delete_file", pathBefore: "src/generated" },
    })).toBe(true)
  })

  it("does not treat create_folder as active file content analysis", () => {
    expect(isWorkspaceOperationPathAffected({
      targetPath: "src/generated/page.ts",
      operationPaths: ["src/generated"],
      payload: { type: "create_folder", path: "src/generated" },
    })).toBe(false)
  })
})
