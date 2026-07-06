import { describe, expect, it, vi } from "vitest"
import { URI } from "../../../../base/common/uri"
import { FileOperation } from "../../../../platform/files/common/files"
import { getSingletonServiceDescriptors } from "../../../../platform/instantiation/common/extensions"
import { InstantiationService } from "../../../../platform/instantiation/common/instantiationService"
import { ServiceCollection } from "../../../../platform/instantiation/common/serviceCollection"
import {
  IWorkingCopyFileService,
  WorkingCopyFileService,
  globalWorkingCopyFileService,
  type IWorkingCopy,
} from "./workingCopyFileService"

describe("VS Code WorkingCopyFileService adapter", () => {
  it("registers a VS Code-style IWorkingCopyFileService identifier and singleton", () => {
    const service = new WorkingCopyFileService()
    const collection = new ServiceCollection([IWorkingCopyFileService, service])
    const instantiationService = new InstantiationService(collection)

    const resolved = instantiationService.invokeFunction((accessor) => accessor.get(IWorkingCopyFileService))

    expect(String(IWorkingCopyFileService)).toBe("workingCopyFileService")
    expect(resolved).toBe(service)
    expect(resolved._serviceBrand).toBeUndefined()
    expect(globalWorkingCopyFileService._serviceBrand).toBeUndefined()
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === IWorkingCopyFileService && instance === globalWorkingCopyFileService)).toBe(true)
  })

  it("fires will and did events around file operations with a stable correlation id", async () => {
    const service = new WorkingCopyFileService()
    const source = URI.file("D:/repo/src/main.ts")
    const target = URI.file("D:/repo/src/app.ts")
    const events: string[] = []

    service.onWillRunWorkingCopyFileOperation((event) => {
      event.waitUntil(Promise.resolve().then(() => events.push(`will-wait:${event.correlationId}`)))
      events.push(`will:${event.operation}:${event.files[0]?.source?.path}->${event.files[0]?.target.path}:${event.correlationId}`)
    })
    service.onDidRunWorkingCopyFileOperation((event) => {
      events.push(`did:${event.operation}:${event.correlationId}`)
    })

    const result = await service.move([{ source, target }], async () => {
      events.push("execute")
      return "ok"
    })

    expect(result).toBe("ok")
    expect(events).toEqual([
      "will:2:/D:/repo/src/main.ts->/D:/repo/src/app.ts:0",
      "will-wait:0",
      "execute",
      "did:2:0",
    ])
  })

  it("reverts dirty source and target working copies before move execution", async () => {
    const service = new WorkingCopyFileService()
    const source = URI.file("D:/repo/src/main.ts")
    const child = URI.file("D:/repo/src/main.ts")
    const target = URI.file("D:/repo/src/app.ts")
    const targetCopy = URI.file("D:/repo/src/app.ts")
    const reverts: string[] = []
    const workingCopies: IWorkingCopy[] = [
      {
        resource: child,
        isDirty: () => true,
        revert: vi.fn(async () => { reverts.push("source") }),
      },
      {
        resource: targetCopy,
        isDirty: () => true,
        revert: vi.fn(async () => { reverts.push("target") }),
      },
    ]
    service.registerWorkingCopyProvider((resource) => workingCopies.filter((workingCopy) => (
      workingCopy.resource.toString() === resource.toString()
    )))

    await service.move([{ source, target }], async () => {
      reverts.push("execute")
    })

    expect(reverts).toEqual(["source", "target", "execute"])
  })

  it("fires fail event when the operation body throws", async () => {
    const service = new WorkingCopyFileService()
    const target = URI.file("D:/repo/src/main.ts")
    const events: string[] = []
    service.onWillRunWorkingCopyFileOperation((event) => events.push(`will:${event.correlationId}`))
    service.onDidFailWorkingCopyFileOperation((event) => events.push(`fail:${event.correlationId}`))
    service.onDidRunWorkingCopyFileOperation((event) => events.push(`did:${event.correlationId}`))

    await expect(service.delete([{ target }], async () => {
      throw new Error("delete failed")
    })).rejects.toThrow("delete failed")

    expect(events).toEqual(["will:0", "fail:0"])
  })

  it("runs stored file save participants in ordinal order and bubbles failures", async () => {
    const service = new WorkingCopyFileService()
    const workingCopy = {
      model: {
        stackElementCount: 0,
        pushStackElement() {
          this.stackElementCount += 1
        },
      },
    }
    const events: string[] = []
    service.addSaveParticipant({
      ordinal: 20,
      participate() {
        events.push("second")
      },
    })
    service.addSaveParticipant({
      ordinal: 10,
      participate() {
        events.push("first")
      },
    })

    await service.runSaveParticipants(workingCopy as never, { reason: 1 })

    expect(events).toEqual(["first", "second"])
    expect(workingCopy.model.stackElementCount).toBe(2)
    expect(service.getLastSaveParticipantResult()).toEqual(expect.objectContaining({
      participantCount: 2,
      failed: false,
      cancelled: false,
      steps: [
        { ordinal: 10, index: 0, status: "ran" },
        { ordinal: 20, index: 1, status: "ran" },
      ],
    }))

    service.addSaveParticipant({
      ordinal: 30,
      participate() {
        throw new Error("save participant failed")
      },
    })
    await expect(service.runSaveParticipants(workingCopy as never, { reason: 1 })).rejects.toThrow("save participant failed")
    expect(service.getLastSaveParticipantResult()).toEqual(expect.objectContaining({
      participantCount: 3,
      failed: true,
      cancelled: false,
      error: "save participant failed",
      steps: [
        { ordinal: 10, index: 0, status: "ran" },
        { ordinal: 20, index: 1, status: "ran" },
        { ordinal: 30, index: 2, status: "failed", error: "save participant failed" },
      ],
    }))
  })

  it("records cancelled save participant runs without executing later participants", async () => {
    const service = new WorkingCopyFileService()
    const workingCopy = {
      resource: URI.file("D:/repo/src/main.ts"),
      model: {
        stackElementCount: 0,
        pushStackElement() {
          this.stackElementCount += 1
        },
      },
    }
    const events: string[] = []
    service.addSaveParticipant({
      ordinal: 10,
      participate() {
        events.push("should-not-run")
      },
    })

    await service.runSaveParticipants(workingCopy as never, { reason: 1, source: "test" }, undefined, { isCancellationRequested: true })

    expect(events).toEqual([])
    expect(workingCopy.model.stackElementCount).toBe(2)
    const result = service.getLastSaveParticipantResult(URI.file("D:/repo/src/main.ts"))
    expect(result?.resource.toString()).toBe(URI.file("D:/repo/src/main.ts").toString())
    expect(result).toEqual(expect.objectContaining({
      reason: 1,
      source: "test",
      participantCount: 1,
      failed: false,
      cancelled: true,
      steps: [{ ordinal: 10, index: 0, status: "skipped" }],
    }))
  })
})
