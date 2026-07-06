import { describe, expect, it, vi } from "vitest"
import { URI } from "../../../base/common/uri"
import { ServiceCollection } from "../../instantiation/common/serviceCollection"
import { InstantiationService } from "../../instantiation/common/instantiationService"
import {
  CodekUndoRedoService,
  IUndoRedoService,
  UndoRedoElementType,
  UndoRedoGroup,
  UndoRedoSource,
} from "./undoRedo"

describe("CodekUndoRedoService", () => {
  it("registers a VS Code-style service identifier and resolves through ServiceCollection", () => {
    const service = new CodekUndoRedoService()
    const collection = new ServiceCollection([IUndoRedoService, service])
    const instantiationService = new InstantiationService(collection)

    const resolved = instantiationService.invokeFunction((accessor) => accessor.get(IUndoRedoService))

    expect(String(IUndoRedoService)).toBe("undoRedoService")
    expect(resolved).toBe(service)
    expect(resolved._serviceBrand).toBeUndefined()
  })

  it("undoes and redoes all resources in a grouped workspace element", async () => {
    const calls: string[] = []
    const service = new CodekUndoRedoService()
    const source = new UndoRedoSource()
    const group = new UndoRedoGroup()
    service.pushElement({
      type: UndoRedoElementType.Workspace,
      resources: [URI.file("D:/repo/src/a.ts"), URI.file("D:/repo/src/b.ts")],
      label: "bulk replace",
      code: "bulkEdit",
      undo: vi.fn(async () => { calls.push("undo") }),
      redo: vi.fn(async () => { calls.push("redo") }),
    }, group, source)

    expect(service.canUndo(source)).toBe(true)
    expect(service.canUndo(URI.file("D:/repo/src/a.ts"))).toBe(true)

    await service.undo(source)

    expect(calls).toEqual(["undo"])
    expect(service.canUndo(source)).toBe(false)
    expect(service.canRedo(source)).toBe(true)

    await service.redo(source)

    expect(calls).toEqual(["undo", "redo"])
    expect(service.canRedo(URI.file("D:/repo/src/b.ts"))).toBe(false)
    expect(service.canUndo(URI.file("D:/repo/src/b.ts"))).toBe(true)
  })

  it("keeps resource snapshots restorable for rollback projection", async () => {
    const service = new CodekUndoRedoService()
    const resource = URI.file("D:/repo/src/a.ts")
    const first = {
      type: UndoRedoElementType.Resource,
      resource,
      label: "first",
      code: "edit",
      undo: vi.fn(),
      redo: vi.fn(),
    } as const
    const second = {
      type: UndoRedoElementType.Resource,
      resource,
      label: "second",
      code: "edit",
      undo: vi.fn(),
      redo: vi.fn(),
    } as const

    service.pushElement(first)
    const snapshot = service.createSnapshot(resource)
    service.pushElement(second)

    expect(service.getElements(resource).past.map((element) => element.label)).toEqual(["first", "second"])

    service.restoreSnapshot(snapshot)

    expect(service.getElements(resource).past.map((element) => element.label)).toEqual(["first"])
    expect(service.getLastElement(resource)).toBe(first)
  })
})
