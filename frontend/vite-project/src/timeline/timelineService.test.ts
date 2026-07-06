import { beforeEach, describe, expect, it, vi } from "vitest"
import { Emitter } from "../vscode-adapter/base/common/event"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import { InstantiationService } from "../vscode-adapter/platform/instantiation/common/instantiationService"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import {
  createLocalChangesTimelineProvider,
  createLocalHistoryTimelineProvider,
  globalTimelineService,
  ITimelineService,
  TimelineService,
} from "./timelineService"

describe("timelineService", () => {
  beforeEach(() => globalTimelineService.reset())

  it("registers timeline providers and projects sorted items for a resource", async () => {
    const service = new TimelineService()
    service.registerTimelineProvider({
      id: "git-history",
      label: "Git History",
      scheme: "file",
      provideTimeline: () => ({
        source: "git-history",
        items: [
          { handle: "old", source: "", label: "old commit", timestamp: 1 },
          { handle: "new", source: "", label: "new commit", timestamp: 3, command: { id: "timeline.open", title: "Open", arguments: ["new"] } },
        ],
      }),
    })
    service.registerTimelineProvider({
      id: "agent-evidence",
      label: "Agent Evidence",
      scheme: "*",
      provideTimeline: () => ({
        source: "agent-evidence",
        items: [{ handle: "agent", source: "", label: "agent event", timestamp: 2, resource: { uri: ".codek/report.md", source: "agent" } }],
      }),
    })

    expect(service.getSources()).toEqual([
      { id: "agent-evidence", label: "Agent Evidence" },
      { id: "git-history", label: "Git History" },
    ])
    await expect(service.getTimelineItems("file:///D:/Workspace/src/app.ts")).resolves.toEqual([
      expect.objectContaining({ handle: "new", source: "git-history" }),
      expect.objectContaining({ handle: "agent", source: "agent-evidence" }),
      expect.objectContaining({ handle: "old", source: "git-history" }),
    ])
    await expect(service.getProjection("file:///D:/Workspace/src/app.ts", { limit: 2 })).resolves.toEqual(expect.objectContaining({
      items: [
        expect.objectContaining({ handle: "new" }),
        expect.objectContaining({ handle: "agent" }),
      ],
    }))
  })

  it("cleans provider registrations and ignores unsupported schemes", async () => {
    const service = new TimelineService()
    const disposeProvider = vi.fn()
    const registration = service.registerTimelineProvider({
      id: "file-only",
      label: "File Only",
      scheme: "file",
      dispose: disposeProvider,
      provideTimeline: () => ({
        source: "file-only",
        items: [{ handle: "file", source: "", label: "file", timestamp: 1 }],
      }),
    })

    await expect(service.getTimeline("file-only", "untitled:///scratch")).resolves.toBeUndefined()
    registration.dispose()
    expect(disposeProvider).toHaveBeenCalledTimes(1)
    expect(service.getSources()).toEqual([])
  })

  it("emits VS Code-style provider uri and coalesced timeline change events", async () => {
    const service = new TimelineService()
    const providerChanges: unknown[] = []
    const timelineChanges: unknown[] = []
    const uriChanges: string[] = []
    const onDidChange = new Emitter<{ id: string; uri?: string; reset: boolean }>()

    service.onDidChangeProviders((event) => providerChanges.push(event))
    service.onDidChangeTimeline((event) => timelineChanges.push(event))
    service.onDidChangeUri((uri) => uriChanges.push(uri))
    service.registerTimelineProvider({
      id: "local-history",
      label: "Local History",
      scheme: "file",
      onDidChange: onDidChange.event,
      provideTimeline: () => ({ source: "local-history", items: [] }),
    })

    service.setUri("file:///D:/Workspace/src/app.ts")
    onDidChange.fire({ id: "local-history", uri: "file:///D:/Workspace/src/app.ts", reset: false })
    onDidChange.fire({ id: "local-history", uri: "file:///D:/Workspace/src/app.ts", reset: true })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(providerChanges).toEqual([{ added: ["local-history"] }])
    expect(uriChanges).toEqual(["file:///D:/Workspace/src/app.ts"])
    expect(timelineChanges).toEqual([{ id: "local-history", uri: "file:///D:/Workspace/src/app.ts", reset: true }])
  })

  it("keeps provider registration disposal scoped to the provider instance", async () => {
    const service = new TimelineService()
    const first = service.registerTimelineProvider({
      id: "history",
      label: "History",
      scheme: "file",
      provideTimeline: () => ({ source: "history", items: [{ handle: "first", source: "", label: "first", timestamp: 1 }] }),
    })
    service.registerTimelineProvider({
      id: "history",
      label: "History",
      scheme: "file",
      provideTimeline: () => ({ source: "history", items: [{ handle: "second", source: "", label: "second", timestamp: 2 }] }),
    })

    first.dispose()

    await expect(service.getTimelineItems("file:///D:/Workspace/src/app.ts")).resolves.toEqual([
      expect.objectContaining({ handle: "second" }),
    ])
  })

  it("cancels in-flight timeline requests and avoids projecting stale items", async () => {
    const service = new TimelineService()
    service.registerTimelineProvider({
      id: "slow-history",
      label: "Slow History",
      scheme: "file",
      provideTimeline: async (_uri, _options, token) => {
        await Promise.resolve()
        return {
          source: "slow-history",
          items: token?.isCancellationRequested
            ? [{ handle: "stale", source: "", label: "stale", timestamp: 2 }]
            : [{ handle: "fresh", source: "", label: "fresh", timestamp: 3 }],
        }
      },
    })

    const request = service.getTimelineRequest("slow-history", "file:///D:/Workspace/src/app.ts")
    expect(request).toBeDefined()
    request?.tokenSource.cancel()

    await expect(request?.result).resolves.toBeUndefined()
  })

  it("projects local history entries with evidence-safe action boundaries", async () => {
    const provider = createLocalHistoryTimelineProvider({
      getEntries: async () => [
        {
          id: "entry-1",
          resource: "file:///D:/Workspace/src/app.ts",
          location: "codek-local-history:///entry-1",
          name: "app.ts",
          timestamp: 10,
          source: "save",
          sourceDescription: "manual save",
          contentHash: "abc",
        },
      ],
    })
    const service = new TimelineService()
    service.registerTimelineProvider(provider)

    await expect(service.getProjection("file:///D:/Workspace/src/app.ts")).resolves.toEqual(expect.objectContaining({
      sources: [{ id: "timeline.localHistory", label: "Local History" }],
      items: [
        expect.objectContaining({
          handle: "entry-1",
          source: "timeline.localHistory",
          contextValue: "codek.localHistory.entry",
          resource: { uri: "file:///D:/Workspace/src/app.ts", source: "localHistory" },
          command: {
            id: "timeline.localHistory.diffEntry",
            title: "Compare with Local History",
            arguments: [
              expect.objectContaining({
                entryId: "entry-1",
                resource: "file:///D:/Workspace/src/app.ts",
                location: "codek-local-history:///entry-1",
                mutatesWorkspace: false,
                readonlyEvidence: true,
              }),
            ],
          },
          actions: expect.arrayContaining([
            expect.objectContaining({ id: "timeline.localHistory.openEntry", mutatesWorkspace: false, requiresApproval: false }),
            expect.objectContaining({ id: "timeline.localHistory.restoreEntry", mutatesWorkspace: true, requiresApproval: true }),
            expect.objectContaining({ id: "timeline.localHistory.revertResource", mutatesWorkspace: true, requiresApproval: true }),
          ]),
        }),
      ],
    }))
  })

  it("projects working tree local changes without mutating git or workspace state", async () => {
    const provider = createLocalChangesTimelineProvider({
      getChanges: async () => [
        {
          id: "change-1",
          resource: "file:///D:/Workspace/src/app.ts",
          status: "modified",
          timestamp: 20,
          source: "workingTree",
          evidenceRefs: [".codek/reports/latest.md"],
          hasDiff: true,
        },
      ],
    })
    const service = new TimelineService()
    service.registerTimelineProvider(provider)
    service.setUri("file:///D:/Workspace/src/app.ts")

    await expect(service.getResourceTimelineModel(undefined, { limit: 5 })).resolves.toEqual(expect.objectContaining({
      uri: "file:///D:/Workspace/src/app.ts",
      stateSource: "timelineService",
      noSecondTimelineState: true,
      sources: [{ id: "timeline.localChanges", label: "Local Changes" }],
      items: [
        expect.objectContaining({
          handle: "change-1",
          source: "timeline.localChanges",
          contextValue: "codek.localChanges.modified",
          resource: { uri: "file:///D:/Workspace/src/app.ts", source: "localChanges" },
          evidenceRefs: [".codek/reports/latest.md"],
          command: {
            id: "timeline.localChanges.diffResource",
            title: "Compare Local Change",
            arguments: [
              expect.objectContaining({
                changeId: "change-1",
                resource: "file:///D:/Workspace/src/app.ts",
                readonlyEvidence: true,
                gitIndexMutation: false,
              }),
            ],
          },
          actions: expect.arrayContaining([
            expect.objectContaining({ id: "timeline.localChanges.openResource", mutatesWorkspace: false, requiresApproval: false }),
            expect.objectContaining({ id: "timeline.localChanges.diffResource", mutatesWorkspace: false, requiresApproval: false }),
            expect.objectContaining({ id: "timeline.localChanges.revertResource", mutatesWorkspace: true, requiresApproval: true }),
          ]),
        }),
      ],
    }))
  })

  it("resolves through the VS Code timeline service identifier", () => {
    const service = new TimelineService()
    const collection = new ServiceCollection([ITimelineService, service])
    const instantiationService = new InstantiationService(collection)

    expect(String(ITimelineService)).toBe("timelineService")
    expect(instantiationService.invokeFunction((accessor) => accessor.get(ITimelineService))).toBe(service)
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === ITimelineService && instance === globalTimelineService)).toBe(true)
  })
})
