import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { CancellationToken, CancellationTokenSource } from "../vscode-adapter/base/common/cancellation"
import { Emitter, type Event } from "../vscode-adapter/base/common/event"
import type { IDisposable } from "../vscode-adapter/base/common/lifecycle"

export interface TimelineCommand {
  id: string
  title: string
  arguments?: unknown[]
}

export interface TimelineAction {
  id: string
  title: string
  arguments?: unknown[]
  mutatesWorkspace: boolean
  requiresApproval: boolean
  readonlyEvidence: boolean
}

export interface TimelineItem {
  handle: string
  source: string
  label: string
  timestamp: number
  description?: string
  contextValue?: string
  evidenceRefs?: string[]
  command?: TimelineCommand
  actions?: TimelineAction[]
  resource?: {
    uri: string
    source?: string
  } | null
}

export interface Timeline {
  source: string
  items: TimelineItem[]
  paging?: {
    cursor?: string
  }
}

export interface TimelineOptions {
  limit?: number
  cursor?: string
  resetCache?: boolean
  cacheResults?: boolean
}

export interface TimelineChangeEvent {
  id: string
  uri?: string
  reset: boolean
}

export interface TimelineProvidersChangeEvent {
  added?: string[]
  removed?: string[]
}

export interface TimelineProvider {
  id: string
  label: string
  scheme: string | string[]
  onDidChange?: Event<TimelineChangeEvent>
  provideTimeline(uri: string, options?: TimelineOptions, token?: CancellationToken): Timeline | Promise<Timeline | undefined> | undefined
  dispose?: () => void
}

export interface TimelineProviderRegistration {
  dispose(): void
}

export interface TimelineProjection {
  sources: Array<{ id: string; label: string }>
  items: TimelineItem[]
  stateSource: "timelineService"
  noSecondTimelineState: true
}

export interface ResourceTimelineModel extends TimelineProjection {
  uri: string
}

export interface TimelineRequest {
  result: Promise<Timeline | undefined>
  options: TimelineOptions
  source: string
  tokenSource: CancellationTokenSource
  uri: string
}

export interface LocalHistoryEntry {
  id: string
  resource: string
  location: string
  name: string
  timestamp: number
  source: string
  sourceDescription?: string
  contentHash?: string
}

export interface LocalHistoryStore {
  getEntries(resource: string, token?: CancellationToken): Promise<LocalHistoryEntry[]> | LocalHistoryEntry[]
}

export interface LocalChangeEntry {
  id: string
  resource: string
  status: "added" | "modified" | "deleted" | "renamed" | "conflict" | string
  timestamp: number
  source: "workingTree" | "agentEvidence" | "localChanges" | string
  evidenceRefs?: string[]
  hasDiff?: boolean
}

export interface LocalChangesStore {
  getChanges(resource: string, token?: CancellationToken): Promise<LocalChangeEntry[]> | LocalChangeEntry[]
}

export interface ITimelineService {
  readonly _serviceBrand: undefined
  readonly onDidChangeProviders: Event<TimelineProvidersChangeEvent>
  readonly onDidChangeTimeline: Event<TimelineChangeEvent>
  readonly onDidChangeUri: Event<string>
  registerTimelineProvider(provider: TimelineProvider): TimelineProviderRegistration
  unregisterTimelineProvider(id: string): void
  getSources(): Array<{ id: string; label: string }>
  getTimelineRequest(id: string, uri: string, options?: TimelineOptions, tokenSource?: CancellationTokenSource): TimelineRequest | undefined
  getTimeline(id: string, uri: string, options?: TimelineOptions): Promise<Timeline | undefined>
  getTimelineItems(uri: string, options?: TimelineOptions): Promise<TimelineItem[]>
  getProjection(uri: string, options?: TimelineOptions): Promise<TimelineProjection>
  getResourceTimelineModel(uri?: string, options?: TimelineOptions): Promise<ResourceTimelineModel>
  setUri(uri: string): void
  getUri(): string
  reset(): void
}

export const ITimelineService = createDecorator<ITimelineService>("timelineService")

export class TimelineService implements ITimelineService {
  declare readonly _serviceBrand: undefined

  private readonly onDidChangeProvidersEmitter = new Emitter<TimelineProvidersChangeEvent>()
  readonly onDidChangeProviders = this.onDidChangeProvidersEmitter.event

  private readonly onDidChangeTimelineEmitter = new Emitter<TimelineChangeEvent>()
  readonly onDidChangeTimeline = this.onDidChangeTimelineEmitter.event

  private readonly onDidChangeUriEmitter = new Emitter<string>()
  readonly onDidChangeUri = this.onDidChangeUriEmitter.event

  private readonly providers = new Map<string, TimelineProvider>()
  private readonly providerDisposables = new Map<string, IDisposable>()
  private readonly pendingTimelineChanges = new Map<string, TimelineChangeEvent>()
  private timelineChangeFlush: ReturnType<typeof setTimeout> | null = null
  private currentUri = ""

  registerTimelineProvider(provider: TimelineProvider): TimelineProviderRegistration {
    const existing = this.providers.get(provider.id)
    if (existing) this.unregisterTimelineProvider(provider.id)
    this.providers.set(provider.id, provider)
    if (provider.onDidChange) {
      this.providerDisposables.set(provider.id, provider.onDidChange((event) => this.queueTimelineChange({
        id: event.id || provider.id,
        uri: event.uri,
        reset: event.reset,
      })))
    }
    this.onDidChangeProvidersEmitter.fire({ added: [provider.id] })
    return {
      dispose: () => {
        if (this.providers.get(provider.id) === provider) this.unregisterTimelineProvider(provider.id)
      },
    }
  }

  unregisterTimelineProvider(id: string): void {
    const existing = this.providers.get(id)
    if (!existing) return
    this.providerDisposables.get(id)?.dispose()
    this.providerDisposables.delete(id)
    existing?.dispose?.()
    this.providers.delete(id)
    this.onDidChangeProvidersEmitter.fire({ removed: [id] })
  }

  getSources(): Array<{ id: string; label: string }> {
    return [...this.providers.values()]
      .map((provider) => ({ id: provider.id, label: provider.label }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
  }

  getTimelineRequest(
    id: string,
    uri: string,
    options: TimelineOptions = {},
    tokenSource = new CancellationTokenSource(),
  ): TimelineRequest | undefined {
    const provider = this.providers.get(id)
    if (!provider || !providerMatchesUri(provider, uri)) return undefined
    return {
      result: Promise.resolve(provider.provideTimeline(uri, options, tokenSource.token)).then((timeline) => {
        if (!timeline || tokenSource.token.isCancellationRequested) return undefined
        return normalizeTimeline(provider.id, timeline, options)
      }),
      options,
      source: provider.id,
      tokenSource,
      uri,
    }
  }

  async getTimeline(id: string, uri: string, options: TimelineOptions = {}): Promise<Timeline | undefined> {
    return this.getTimelineRequest(id, uri, options)?.result
  }

  async getTimelineItems(uri: string, options: TimelineOptions = {}): Promise<TimelineItem[]> {
    const timelines = await Promise.all(this.getSources().map((source) => this.getTimeline(source.id, uri, options)))
    return timelines
      .flatMap((timeline) => timeline?.items || [])
      .sort(sortTimelineItems)
      .slice(0, options.limit || undefined)
  }

  async getProjection(uri: string, options: TimelineOptions = {}): Promise<TimelineProjection> {
    return {
      sources: this.getSources(),
      items: await this.getTimelineItems(uri, options),
      stateSource: "timelineService",
      noSecondTimelineState: true,
    }
  }

  async getResourceTimelineModel(uri = this.currentUri, options: TimelineOptions = {}): Promise<ResourceTimelineModel> {
    return {
      uri,
      ...(await this.getProjection(uri, options)),
    }
  }

  setUri(uri: string): void {
    this.currentUri = uri
    this.onDidChangeUriEmitter.fire(uri)
  }

  getUri(): string {
    return this.currentUri
  }

  reset(): void {
    for (const id of Array.from(this.providers.keys())) this.unregisterTimelineProvider(id)
    if (this.timelineChangeFlush) clearTimeout(this.timelineChangeFlush)
    this.timelineChangeFlush = null
    this.pendingTimelineChanges.clear()
    this.providers.clear()
    this.currentUri = ""
  }

  private queueTimelineChange(event: TimelineChangeEvent): void {
    const key = `${event.id}\n${event.uri || ""}`
    const existing = this.pendingTimelineChanges.get(key)
    this.pendingTimelineChanges.set(key, {
      id: event.id,
      uri: event.uri,
      reset: Boolean(event.reset || existing?.reset),
    })
    if (this.timelineChangeFlush) return
    this.timelineChangeFlush = setTimeout(() => {
      this.timelineChangeFlush = null
      const events = Array.from(this.pendingTimelineChanges.values())
      this.pendingTimelineChanges.clear()
      for (const item of events) this.onDidChangeTimelineEmitter.fire(item)
    }, 0)
  }
}

export const globalTimelineService = new TimelineService()
registerSingleton(ITimelineService, globalTimelineService, InstantiationType.Delayed)

function providerMatchesUri(provider: TimelineProvider, uri: string): boolean {
  const schemes = Array.isArray(provider.scheme) ? provider.scheme : [provider.scheme]
  if (schemes.includes("*")) return true
  const scheme = String(uri || "").match(/^([a-z][a-z0-9+.-]*):/i)?.[1] || "file"
  return schemes.includes(scheme)
}

function sortTimelineItems(a: TimelineItem, b: TimelineItem): number {
  return (b.timestamp - a.timestamp) || b.source.localeCompare(a.source, undefined, { numeric: true, sensitivity: "base" })
}

function normalizeTimeline(source: string, timeline: Timeline, options: TimelineOptions): Timeline {
  return {
    ...timeline,
    source,
    items: [...timeline.items]
      .map((item) => ({ ...item, source }))
      .sort(sortTimelineItems)
      .slice(0, options.limit || undefined),
  }
}

export function createLocalHistoryTimelineProvider(store: LocalHistoryStore): TimelineProvider {
  return {
    id: "timeline.localHistory",
    label: "Local History",
    scheme: "*",
    async provideTimeline(uri, _options, token) {
      const resource = normalizeLocalHistoryResource(uri)
      if (!resource || token?.isCancellationRequested) return { source: "timeline.localHistory", items: [] }
      const entries = await store.getEntries(resource, token)
      if (token?.isCancellationRequested) return undefined
      return {
        source: "timeline.localHistory",
        items: entries.map((entry) => localHistoryEntryToTimelineItem(entry)),
      }
    },
  }
}

export function createLocalChangesTimelineProvider(store: LocalChangesStore): TimelineProvider {
  return {
    id: "timeline.localChanges",
    label: "Local Changes",
    scheme: "*",
    async provideTimeline(uri, _options, token) {
      if (!uri || token?.isCancellationRequested) return { source: "timeline.localChanges", items: [] }
      const changes = await store.getChanges(uri, token)
      if (token?.isCancellationRequested) return undefined
      return {
        source: "timeline.localChanges",
        items: changes.map((entry) => localChangeEntryToTimelineItem(entry)),
      }
    },
  }
}

function normalizeLocalHistoryResource(uri: string): string {
  const value = String(uri || "")
  if (value.startsWith("codek-local-history://")) {
    const associated = new URL(value).searchParams.get("resource")
    return associated || ""
  }
  return value
}

function localHistoryEntryToTimelineItem(entry: LocalHistoryEntry): TimelineItem {
  const payload = {
    entryId: entry.id,
    resource: entry.resource,
    location: entry.location,
    timestamp: entry.timestamp,
    contentHash: entry.contentHash || "",
    readonlyEvidence: true,
    mutatesWorkspace: false,
  }
  return {
    handle: entry.id,
    source: "timeline.localHistory",
    label: localHistorySourceLabel(entry.source),
    description: entry.sourceDescription || entry.name,
    timestamp: entry.timestamp,
    contextValue: "codek.localHistory.entry",
    command: {
      id: "timeline.localHistory.diffEntry",
      title: "Compare with Local History",
      arguments: [payload],
    },
    resource: {
      uri: entry.resource,
      source: "localHistory",
    },
    actions: [
      {
        id: "timeline.localHistory.openEntry",
        title: "Open Local History Entry",
        arguments: [{ ...payload, action: "open" }],
        mutatesWorkspace: false,
        requiresApproval: false,
        readonlyEvidence: true,
      },
      {
        id: "timeline.localHistory.diffEntry",
        title: "Compare with Local History",
        arguments: [{ ...payload, action: "diff" }],
        mutatesWorkspace: false,
        requiresApproval: false,
        readonlyEvidence: true,
      },
      {
        id: "timeline.localHistory.restoreEntry",
        title: "Restore from Local History",
        arguments: [{ ...payload, action: "restore", mutatesWorkspace: true }],
        mutatesWorkspace: true,
        requiresApproval: true,
        readonlyEvidence: true,
      },
      {
        id: "timeline.localHistory.revertResource",
        title: "Revert Current Resource",
        arguments: [{ ...payload, action: "revert", mutatesWorkspace: true }],
        mutatesWorkspace: true,
        requiresApproval: true,
        readonlyEvidence: true,
      },
    ],
  }
}

function localHistorySourceLabel(source: string): string {
  switch (source) {
    case "save":
      return "Saved"
    case "restore":
      return "Restored"
    case "revert":
      return "Reverted"
    default:
      return source || "Local History"
  }
}

function localChangeEntryToTimelineItem(entry: LocalChangeEntry): TimelineItem {
  const status = String(entry.status || "modified")
  const payload = {
    changeId: entry.id,
    resource: entry.resource,
    status,
    source: entry.source,
    evidenceRefs: entry.evidenceRefs || [],
    readonlyEvidence: true,
    mutatesWorkspace: false,
    gitIndexMutation: false,
  }
  return {
    handle: entry.id,
    source: "timeline.localChanges",
    label: localChangeStatusLabel(status),
    description: `${entry.source}${entry.hasDiff === false ? " - no diff" : ""}`,
    timestamp: entry.timestamp,
    contextValue: `codek.localChanges.${status}`,
    evidenceRefs: entry.evidenceRefs || [],
    command: {
      id: "timeline.localChanges.diffResource",
      title: "Compare Local Change",
      arguments: [payload],
    },
    resource: {
      uri: entry.resource,
      source: "localChanges",
    },
    actions: [
      {
        id: "timeline.localChanges.openResource",
        title: "Open Resource",
        arguments: [{ ...payload, action: "open" }],
        mutatesWorkspace: false,
        requiresApproval: false,
        readonlyEvidence: true,
      },
      {
        id: "timeline.localChanges.diffResource",
        title: "Compare Local Change",
        arguments: [{ ...payload, action: "diff" }],
        mutatesWorkspace: false,
        requiresApproval: false,
        readonlyEvidence: true,
      },
      {
        id: "timeline.localChanges.revertResource",
        title: "Revert Local Change",
        arguments: [{ ...payload, action: "revert", mutatesWorkspace: true }],
        mutatesWorkspace: true,
        requiresApproval: true,
        readonlyEvidence: true,
      },
    ],
  }
}

function localChangeStatusLabel(status: string): string {
  switch (status) {
    case "added":
      return "Added"
    case "deleted":
      return "Deleted"
    case "renamed":
      return "Renamed"
    case "conflict":
      return "Conflict"
    case "modified":
      return "Modified"
    default:
      return status || "Local Change"
  }
}
