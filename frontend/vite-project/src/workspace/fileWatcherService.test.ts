import { describe, expect, it, vi } from "vitest"
import { Emitter } from "../vscode-adapter/base/common/event"
import {
  FileChangeType,
  FileChangesEvent,
  type IFileService,
  type IWatchOptions,
} from "../vscode-adapter/platform/files/common/files"
import { URI } from "../vscode-adapter/base/common/uri"
import {
  createWorkspaceFileWatcherService,
  projectWorkspaceFileEvent,
} from "./fileWatcherService"

describe("workspace file watcher service", () => {
  it("watches workspace roots recursively with include/exclude patterns", () => {
    const fileService = createMockFileService()
    const service = createWorkspaceFileWatcherService({
      fileService,
      workspaceFolders: [
        { uri: URI.file("D:/repo"), name: "repo" },
      ],
      configuration: {
        watcherExclude: {
          "**/node_modules/**": true,
          "**/.git/**": false,
          "dist/**": true,
        },
        watcherInclude: ["shared", "src/generated", "../outside"],
      },
    })

    expect(fileService.watch).toHaveBeenCalledTimes(3)
    expect(fileService.watch.mock.calls.map(([resource, options]) => [
      resource.fsPath.replace(/\\/g, "/"),
      options.recursive,
      options.excludes,
    ])).toEqual([
      ["d:/repo", true, ["**/node_modules/**", "dist/**"]],
      ["d:/repo/shared", true, ["**/node_modules/**", "dist/**"]],
      ["d:/repo/src/generated", true, ["**/node_modules/**", "dist/**"]],
    ])

    service.dispose()
    expect(fileService.disposedWatches).toHaveLength(3)
  })

  it("uses non-recursive watches when requested", () => {
    const fileService = createMockFileService()

    createWorkspaceFileWatcherService({
      fileService,
      workspaceFolders: [{ uri: URI.file("D:/repo"), name: "repo" }],
      recursive: false,
    })

    expect(fileService.watch.mock.calls[0]?.[1]).toMatchObject({
      recursive: false,
      excludes: [],
    })
  })

  it("projects file changes into workspace-relative evidence-safe events", () => {
    const event = new FileChangesEvent([
      { type: FileChangeType.ADDED, resource: URI.file("D:/repo/src/new.ts") },
      { type: FileChangeType.UPDATED, resource: URI.file("D:/repo/src/edit.ts") },
      { type: FileChangeType.DELETED, resource: URI.file("D:/repo/src/old.ts") },
      { type: FileChangeType.UPDATED, resource: URI.file("D:/outside/file.ts") },
    ], true)

    const projected = projectWorkspaceFileEvent(event, [
      { uri: URI.file("D:/repo"), name: "repo" },
    ])

    expect(projected).toEqual([
      {
        type: "create",
        resource: "file:///d:/repo/src/new.ts",
        workspaceFolder: "file:///d:/repo",
        workspaceFolderName: "repo",
        relativePath: "src/new.ts",
        evidenceSafe: true,
      },
      {
        type: "change",
        resource: "file:///d:/repo/src/edit.ts",
        workspaceFolder: "file:///d:/repo",
        workspaceFolderName: "repo",
        relativePath: "src/edit.ts",
        evidenceSafe: true,
      },
      {
        type: "delete",
        resource: "file:///d:/repo/src/old.ts",
        workspaceFolder: "file:///d:/repo",
        workspaceFolderName: "repo",
        relativePath: "src/old.ts",
        evidenceSafe: true,
      },
    ])
  })

  it("debounces and coalesces projected events without leaking outside-workspace paths", async () => {
    vi.useFakeTimers()
    try {
      const fileService = createMockFileService()
      const events: unknown[] = []
      const service = createWorkspaceFileWatcherService({
        fileService,
        workspaceFolders: [{ uri: URI.file("D:/repo"), name: "repo" }],
        debounceMs: 25,
      })
      service.onDidChange((event) => events.push(event))

      fileService.fire(new FileChangesEvent([
        { type: FileChangeType.ADDED, resource: URI.file("D:/repo/src/transient.ts") },
        { type: FileChangeType.UPDATED, resource: URI.file("D:/repo/src/transient.ts") },
      ], true))
      fileService.fire(new FileChangesEvent([
        { type: FileChangeType.DELETED, resource: URI.file("D:/repo/src/transient.ts") },
        { type: FileChangeType.UPDATED, resource: URI.file("D:/outside/secret.txt") },
      ], true))

      expect(events).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(25)

      expect(events).toEqual([{
        events: [{
          type: "delete",
          resource: "file:///d:/repo/src/transient.ts",
          workspaceFolder: "file:///d:/repo",
          workspaceFolderName: "repo",
          relativePath: "src/transient.ts",
          evidenceSafe: true,
        }],
      }])
      service.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps workspace-root events in the evidence projection", () => {
    const event = new FileChangesEvent([
      { type: FileChangeType.UPDATED, resource: URI.file("D:/repo") },
    ], true)

    expect(projectWorkspaceFileEvent(event, [{ uri: URI.file("D:/repo"), name: "repo" }])).toEqual([{
      type: "change",
      resource: "file:///d:/repo",
      workspaceFolder: "file:///d:/repo",
      workspaceFolderName: "repo",
      relativePath: "",
      evidenceSafe: true,
    }])
  })

  it("refreshes watchers when workspace folders change", () => {
    const fileService = createMockFileService()
    const service = createWorkspaceFileWatcherService({
      fileService,
      workspaceFolders: [{ uri: URI.file("D:/repo-a"), name: "a" }],
    })

    service.updateWorkspaceFolders([{ uri: URI.file("D:/repo-b"), name: "b" }])

    expect(fileService.disposedWatches).toHaveLength(1)
    expect(fileService.watch.mock.calls.map(([resource]) => resource.fsPath.replace(/\\/g, "/"))).toEqual([
      "d:/repo-a",
      "d:/repo-b",
    ])
  })
})

function createMockFileService(): IFileService & {
  watch: ReturnType<typeof vi.fn>
  fire(event: FileChangesEvent): void
  disposedWatches: string[]
} {
  const changeEmitter = new Emitter<FileChangesEvent>()
  const watch = vi.fn((resource: URI, _options: IWatchOptions) => ({
    dispose: () => disposedWatches.push(resource.toString()),
  }))
  const disposedWatches: string[] = []

  return {
    onDidFilesChange: changeEmitter.event,
    onDidWatchError: new Emitter<Error>().event,
    watch,
    fire: (event: FileChangesEvent) => changeEmitter.fire(event),
    disposedWatches,
  } as unknown as IFileService & {
    watch: ReturnType<typeof vi.fn>
    fire(event: FileChangesEvent): void
    disposedWatches: string[]
  }
}
