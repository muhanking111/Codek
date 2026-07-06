import { Emitter, type Event } from "../vscode-adapter/base/common/event"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { settingsStore, type SettingsStore } from "../settings/settingsStore"

export interface ExperimentDefinition {
  id: string
  featureFlag: string
  rollout: number
  defaultEnabled: boolean
  description: string
}

export interface ExperimentAssignment {
  id: string
  featureFlag: string
  enabled: boolean
  bucket: number
  rollout: number
  source: "localStableHash" | "localOverride" | "disabled"
  transport: "localOnly"
  reason: string
}

export interface ExperimentEvidence {
  kind: "assignment" | "override" | "policy"
  experimentId?: string
  featureFlag?: string
  detail: string
  timestamp: number
}

export interface ExperimentsPrivacyBoundary {
  assignmentStore: "localSettingsOnly"
  remoteFetch: false
  telemetry: false
  reason: string
}

export interface ExperimentsSnapshot {
  source: "experimentsService"
  enabled: boolean
  generatedAt: number
  assignments: Record<string, ExperimentAssignment>
  flags: Record<string, boolean>
  localEvidence: ExperimentEvidence[]
  privacy: ExperimentsPrivacyBoundary
}

export interface ExperimentsServiceOptions {
  settingsStore?: SettingsStore
  definitions?: ExperimentDefinition[]
  stableId?: string
  now?: () => number
}

export interface IExperimentsService {
  readonly _serviceBrand: undefined
  readonly onDidChangeExperiments: Event<ExperimentsSnapshot>
  refresh(): ExperimentsSnapshot
  getSnapshot(): ExperimentsSnapshot
  isFeatureEnabled(featureFlag: string): boolean
  getAssignment(experimentId: string): ExperimentAssignment | undefined
}

export const IExperimentsService = createDecorator<IExperimentsService>("experimentsService")

const DEFAULT_DEFINITIONS: ExperimentDefinition[] = [
  {
    id: "workspaceRecommendations.richEvidence",
    featureFlag: "recommendations.richEvidence",
    rollout: 0,
    defaultEnabled: false,
    description: "工作区推荐证据描述增强",
  },
]

const PRIVACY_BOUNDARY: ExperimentsPrivacyBoundary = {
  assignmentStore: "localSettingsOnly",
  remoteFetch: false,
  telemetry: false,
  reason: "Codek 实验服务只读取本地设置和稳定哈希，不执行远端拉取或遥测上报。",
}

export class CodekExperimentsService implements IExperimentsService {
  declare readonly _serviceBrand: undefined
  private readonly settingsStore: SettingsStore
  private readonly definitions: ExperimentDefinition[]
  private readonly stableId: string
  private readonly now: () => number
  private readonly onDidChangeExperimentsEmitter = new Emitter<ExperimentsSnapshot>()
  private snapshot: ExperimentsSnapshot = {
    source: "experimentsService",
    enabled: true,
    generatedAt: 0,
    assignments: {},
    flags: {},
    localEvidence: [],
    privacy: PRIVACY_BOUNDARY,
  }

  readonly onDidChangeExperiments = this.onDidChangeExperimentsEmitter.event

  constructor(options: ExperimentsServiceOptions = {}) {
    this.settingsStore = options.settingsStore ?? settingsStore
    this.definitions = options.definitions ?? DEFAULT_DEFINITIONS
    this.stableId = options.stableId ?? "codek-local-workspace"
    this.now = options.now ?? Date.now
  }

  refresh(): ExperimentsSnapshot {
    const generatedAt = this.now()
    if (this.settingsStore.get<boolean>("codek.experiments.enabled", true) === false) {
      const flags = Object.fromEntries(this.definitions.map((definition) => [definition.featureFlag, false]))
      this.snapshot = {
        source: "experimentsService",
        enabled: false,
        generatedAt,
        assignments: Object.fromEntries(this.definitions.map((definition) => [
          definition.id,
          {
            id: definition.id,
            featureFlag: definition.featureFlag,
            enabled: false,
            bucket: 0,
            rollout: normalizeRollout(definition.rollout),
            source: "disabled",
            transport: "localOnly",
            reason: "实验服务已由本地设置关闭。",
          } satisfies ExperimentAssignment,
        ])),
        flags,
        localEvidence: [{
          kind: "policy",
          detail: "实验服务已由本地设置关闭。",
          timestamp: generatedAt,
        }],
        privacy: PRIVACY_BOUNDARY,
      }
      this.onDidChangeExperimentsEmitter.fire(this.snapshot)
      return this.snapshot
    }

    const overrides = this.getOverrides()
    const assignments: Record<string, ExperimentAssignment> = {}
    const flags: Record<string, boolean> = {}
    const localEvidence: ExperimentEvidence[] = []

    for (const definition of this.definitions) {
      const bucket = hashToBucket(`${this.stableId}:${definition.id}`)
      const rollout = normalizeRollout(definition.rollout)
      const overrideValue = overrides[definition.featureFlag]
      const hasOverride = typeof overrideValue === "boolean"
      const enabled = hasOverride ? overrideValue : bucket < rollout || (rollout === 0 && definition.defaultEnabled)
      const assignment: ExperimentAssignment = {
        id: definition.id,
        featureFlag: definition.featureFlag,
        enabled,
        bucket,
        rollout,
        source: hasOverride ? "localOverride" : "localStableHash",
        transport: "localOnly",
        reason: hasOverride
          ? "本地 feature flag override 生效。"
          : `${definition.description}，bucket ${bucket} / rollout ${rollout}。`,
      }
      assignments[definition.id] = assignment
      flags[definition.featureFlag] = enabled
      localEvidence.push({
        kind: hasOverride ? "override" : "assignment",
        experimentId: definition.id,
        featureFlag: definition.featureFlag,
        detail: assignment.reason,
        timestamp: generatedAt,
      })
    }

    this.snapshot = {
      source: "experimentsService",
      enabled: true,
      generatedAt,
      assignments,
      flags,
      localEvidence,
      privacy: PRIVACY_BOUNDARY,
    }
    this.onDidChangeExperimentsEmitter.fire(this.snapshot)
    return this.snapshot
  }

  getSnapshot(): ExperimentsSnapshot {
    return this.snapshot
  }

  isFeatureEnabled(featureFlag: string): boolean {
    if (!Object.prototype.hasOwnProperty.call(this.snapshot.flags, featureFlag)) this.refresh()
    return this.snapshot.flags[featureFlag] === true
  }

  getAssignment(experimentId: string): ExperimentAssignment | undefined {
    if (!Object.prototype.hasOwnProperty.call(this.snapshot.assignments, experimentId)) this.refresh()
    return this.snapshot.assignments[experimentId]
  }

  private getOverrides(): Record<string, boolean> {
    const raw = this.settingsStore.get<unknown>("codek.experiments.overrides", {})
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
    const overrides: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "boolean") overrides[key] = value
    }
    return overrides
  }
}

export function createExperimentsService(options: ExperimentsServiceOptions = {}): CodekExperimentsService {
  return new CodekExperimentsService(options)
}

function normalizeRollout(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function hashToBucket(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 0xffffffff
}

export const globalExperimentsService = new CodekExperimentsService()
registerSingleton(IExperimentsService, globalExperimentsService, InstantiationType.Delayed)
