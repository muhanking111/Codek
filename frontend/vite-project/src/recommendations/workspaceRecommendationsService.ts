import { Emitter, type Event } from "../vscode-adapter/base/common/event"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { settingsStore, type SettingsStore } from "../settings/settingsStore"

export type RecommendationReasonId =
  | "workspace"
  | "file"
  | "executable"
  | "workspaceConfig"
  | "dynamicWorkspace"
  | "experimental"
  | "application"

export interface WorkspaceExtensionConfig {
  recommendations?: string[]
  unwantedRecommendations?: string[]
}

export interface WorkspaceRecommendationFolderInput {
  uri: string
  name?: string
  extensionsConfig?: WorkspaceExtensionConfig
  installedExtensions?: string[]
}

export interface WorkspaceRecommendationFileInput {
  path: string
  languageId?: string
  content?: string
}

export interface ContentRecommendationSignal {
  id: string
  extensionId: string
  reasonText: string
  source?: string
}

export interface WorkspaceRecommendationInput {
  workspaceRoot?: string | null
  workspaceFolders?: WorkspaceRecommendationFolderInput[]
  files?: WorkspaceRecommendationFileInput[]
  executables?: string[]
  contentSignals?: ContentRecommendationSignal[]
  installedExtensionIds?: string[]
}

export interface RecommendationReason {
  reasonId: RecommendationReasonId
  reasonText: string
  source?: string
}

export interface WorkspaceExtensionRecommendation {
  extensionId: string
  reason: RecommendationReason
  important: boolean
  installed: boolean
}

export interface InvalidWorkspaceRecommendation {
  value: string
  source: string
  message: string
}

export interface RecommendationEvidence {
  kind: "workspace" | "file" | "executable" | "content" | "privacy" | "policy"
  extensionId?: string
  source?: string
  detail: string
  timestamp: number
}

export interface RecommendationActionDescriptor {
  id: string
  action: "install" | "ignore" | "openSettings"
  extensionId?: string
  label: string
  requiresApproval: boolean
  evidenceKind?: RecommendationEvidence["kind"]
}

export interface RecommendationPrivacyBoundary {
  mode: "standard" | "privacy"
  contentSignalsEnabled: boolean
  reason: string
}

export interface WorkspaceRecommendationsSnapshot {
  source: "workspaceRecommendationsService"
  enabled: boolean
  workspaceRoot: string
  generatedAt: number
  recommendations: WorkspaceExtensionRecommendation[]
  reasonByExtensionId: Record<string, RecommendationReason>
  ignoredRecommendations: string[]
  invalidRecommendations: InvalidWorkspaceRecommendation[]
  localEvidence: RecommendationEvidence[]
  actionDescriptors: RecommendationActionDescriptor[]
  privacy: RecommendationPrivacyBoundary
}

export interface WorkspaceRecommendationsServiceOptions {
  settingsStore?: SettingsStore
  now?: () => number
}

interface Candidate {
  extensionId: string
  reason: RecommendationReason
  important?: boolean
  evidenceKind: RecommendationEvidence["kind"]
  evidenceSource?: string
}

const EXTENSION_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/i

const EMPTY_SNAPSHOT: WorkspaceRecommendationsSnapshot = {
  source: "workspaceRecommendationsService",
  enabled: true,
  workspaceRoot: "",
  generatedAt: 0,
  recommendations: [],
  reasonByExtensionId: {},
  ignoredRecommendations: [],
  invalidRecommendations: [],
  localEvidence: [],
  actionDescriptors: [],
  privacy: {
    mode: "standard",
    contentSignalsEnabled: true,
    reason: "使用本地工作区配置、文件名、可执行信息和显式内容信号。",
  },
}

export interface IWorkspaceRecommendationsService {
  readonly _serviceBrand: undefined
  readonly onDidChangeRecommendations: Event<WorkspaceRecommendationsSnapshot>
  refresh(input: WorkspaceRecommendationInput): Promise<WorkspaceRecommendationsSnapshot>
  getSnapshot(): WorkspaceRecommendationsSnapshot
  getAllRecommendationsWithReason(): Record<string, RecommendationReason>
  getWorkspaceRecommendations(): Promise<string[]>
  getFileBasedRecommendations(): string[]
  getExeBasedRecommendations(exe?: string): Promise<{ important: string[]; others: string[] }>
  getImportantRecommendations(): Promise<string[]>
  getOtherRecommendations(): Promise<string[]>
  getLocalEvidence(): RecommendationEvidence[]
  getActionDescriptors(): RecommendationActionDescriptor[]
}

export const IWorkspaceRecommendationsService = createDecorator<IWorkspaceRecommendationsService>("workspaceRecommendationsService")

export class CodekWorkspaceRecommendationsService implements IWorkspaceRecommendationsService {
  declare readonly _serviceBrand: undefined
  private readonly settingsStore: SettingsStore
  private readonly now: () => number
  private readonly onDidChangeRecommendationsEmitter = new Emitter<WorkspaceRecommendationsSnapshot>()
  private snapshot: WorkspaceRecommendationsSnapshot = { ...EMPTY_SNAPSHOT }

  readonly onDidChangeRecommendations = this.onDidChangeRecommendationsEmitter.event

  constructor(options: WorkspaceRecommendationsServiceOptions = {}) {
    this.settingsStore = options.settingsStore ?? settingsStore
    this.now = options.now ?? Date.now
  }

  async refresh(input: WorkspaceRecommendationInput): Promise<WorkspaceRecommendationsSnapshot> {
    const generatedAt = this.now()
    const workspaceRoot = input.workspaceRoot || input.workspaceFolders?.[0]?.uri || ""
    const privacy = this.createPrivacyBoundary()
    if (this.settingsStore.get<boolean>("codek.recommendations.enabled", true) === false) {
      this.snapshot = {
        ...EMPTY_SNAPSHOT,
        enabled: false,
        workspaceRoot,
        generatedAt,
        privacy,
        localEvidence: [{
          kind: "policy",
          detail: "工作区扩展推荐已由本地设置关闭。",
          timestamp: generatedAt,
        }],
      }
      this.onDidChangeRecommendationsEmitter.fire(this.snapshot)
      return this.snapshot
    }

    const invalidRecommendations: InvalidWorkspaceRecommendation[] = []
    const ignored = new Set<string>()
    const candidates: Candidate[] = []

    for (const folder of input.workspaceFolders ?? []) {
      for (const extensionId of folder.extensionsConfig?.unwantedRecommendations ?? []) {
        const normalized = normalizeExtensionId(extensionId)
        if (!isValidExtensionId(normalized)) {
          invalidRecommendations.push(createInvalidRecommendation(extensionId, "unwantedRecommendations"))
          continue
        }
        ignored.add(normalized)
      }
      for (const extensionId of folder.extensionsConfig?.recommendations ?? []) {
        const normalized = normalizeExtensionId(extensionId)
        if (!isValidExtensionId(normalized)) {
          invalidRecommendations.push(createInvalidRecommendation(extensionId, "extensions.json"))
          continue
        }
        candidates.push({
          extensionId: normalized,
          reason: {
            reasonId: "workspace",
            reasonText: "当前工作区推荐此扩展。",
            source: folder.name || folder.uri,
          },
          important: true,
          evidenceKind: "workspace",
          evidenceSource: "extensions.json",
        })
      }
      for (const extensionId of folder.installedExtensions ?? []) {
        const normalized = normalizeExtensionId(extensionId)
        if (!isValidExtensionId(normalized)) continue
        candidates.push({
          extensionId: normalized,
          reason: {
            reasonId: "workspace",
            reasonText: "当前工作区 .vscode/extensions 目录包含此扩展。",
            source: folder.name || folder.uri,
          },
          important: true,
          evidenceKind: "workspace",
          evidenceSource: ".vscode/extensions",
        })
      }
    }

    const { fileCandidates, fileEvidence } = this.createFileBasedRecommendations(input.files ?? [], generatedAt)
    candidates.push(...fileCandidates)
    const { exeCandidates, exeEvidence } = this.createExecutableRecommendations(input.executables ?? [], generatedAt)
    candidates.push(...exeCandidates)
    const { contentCandidates, contentEvidence } = this.createContentRecommendations(
      privacy.contentSignalsEnabled ? input.contentSignals ?? [] : [],
      generatedAt,
    )
    candidates.push(...contentCandidates)

    const userIgnored = this.getStringArraySetting("codek.recommendations.ignored")
    for (const extensionId of userIgnored) {
      const normalized = normalizeExtensionId(extensionId)
      if (isValidExtensionId(normalized)) ignored.add(normalized)
    }

    const installedIds = new Set((input.installedExtensionIds ?? []).map(normalizeExtensionId))
    const { recommendations, reasonByExtensionId, localEvidence } = this.dedupeCandidates(
      candidates,
      ignored,
      installedIds,
      generatedAt,
    )
    localEvidence.push(...fileEvidence, ...exeEvidence, ...contentEvidence)
    if (!privacy.contentSignalsEnabled && (input.contentSignals?.length ?? 0) > 0) {
      localEvidence.push({
        kind: "privacy",
        detail: "隐私模式开启，内容推荐信号已跳过。",
        timestamp: generatedAt,
      })
    }
    for (const file of input.files ?? []) {
      if (isSensitiveRecommendationPath(file.path)) {
        localEvidence.push({
          kind: "file",
          source: file.path,
          detail: "敏感文件路径已跳过。",
          timestamp: generatedAt,
        })
      }
    }

    this.snapshot = {
      source: "workspaceRecommendationsService",
      enabled: true,
      workspaceRoot,
      generatedAt,
      recommendations,
      reasonByExtensionId,
      ignoredRecommendations: [...ignored].sort(),
      invalidRecommendations,
      localEvidence,
      actionDescriptors: createActionDescriptors(recommendations),
      privacy,
    }
    this.onDidChangeRecommendationsEmitter.fire(this.snapshot)
    return this.snapshot
  }

  getSnapshot(): WorkspaceRecommendationsSnapshot {
    return this.snapshot
  }

  getAllRecommendationsWithReason(): Record<string, RecommendationReason> {
    return { ...this.snapshot.reasonByExtensionId }
  }

  async getWorkspaceRecommendations(): Promise<string[]> {
    return this.snapshot.recommendations
      .filter((item) => item.reason.reasonId === "workspace")
      .map((item) => item.extensionId)
  }

  getFileBasedRecommendations(): string[] {
    return this.snapshot.recommendations
      .filter((item) => item.reason.reasonId === "file")
      .map((item) => item.extensionId)
  }

  async getExeBasedRecommendations(exe?: string): Promise<{ important: string[]; others: string[] }> {
    const byExe = this.snapshot.recommendations.filter((item) => item.reason.reasonId === "executable")
    const filtered = exe ? byExe.filter((item) => item.reason.source?.toLowerCase() === exe.toLowerCase()) : byExe
    return splitImportant(filtered)
  }

  async getImportantRecommendations(): Promise<string[]> {
    return this.snapshot.recommendations.filter((item) => item.important).map((item) => item.extensionId)
  }

  async getOtherRecommendations(): Promise<string[]> {
    return this.snapshot.recommendations.filter((item) => !item.important).map((item) => item.extensionId)
  }

  getLocalEvidence(): RecommendationEvidence[] {
    return [...this.snapshot.localEvidence]
  }

  getActionDescriptors(): RecommendationActionDescriptor[] {
    return [...this.snapshot.actionDescriptors]
  }

  private createPrivacyBoundary(): RecommendationPrivacyBoundary {
    const privacyEnabled = this.settingsStore.get<boolean>("codek.privacy.enabled", false) === true
    if (privacyEnabled) {
      return {
        mode: "privacy",
        contentSignalsEnabled: false,
        reason: "隐私模式开启，仅使用工作区配置、文件名和本地可执行信息。",
      }
    }
    return {
      mode: "standard",
      contentSignalsEnabled: true,
      reason: "使用本地工作区配置、文件名、可执行信息和显式内容信号。",
    }
  }

  private getStringArraySetting(key: string): string[] {
    const value = this.settingsStore.get<unknown>(key, [])
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  }

  private createFileBasedRecommendations(files: WorkspaceRecommendationFileInput[], timestamp: number): {
    fileCandidates: Candidate[]
    fileEvidence: RecommendationEvidence[]
  } {
    const fileCandidates: Candidate[] = []
    const fileEvidence: RecommendationEvidence[] = []
    const seen = new Set<string>()
    for (const file of files) {
      if (isSensitiveRecommendationPath(file.path)) continue
      const lower = file.path.toLowerCase()
      const language = file.languageId?.toLowerCase() || ""
      if (lower.endsWith(".editorconfig")) addFileCandidate("editorconfig.editorconfig", ".editorconfig", file.path)
      if (lower.endsWith("package.json")) addFileCandidate("github.vscode-github-actions", "package.json", file.path)
      if (lower.endsWith("requirements.txt") || language === "python" || language === "pip-requirements") {
        addFileCandidate("ms-python.python", "Python 工作区文件", file.path)
      }
      if (lower.endsWith(".vue") || language === "vue") addFileCandidate("vue.volar", "Vue 文件", file.path)
    }
    return { fileCandidates, fileEvidence }

    function addFileCandidate(extensionId: string, label: string, source: string): void {
      if (seen.has(extensionId)) return
      seen.add(extensionId)
      fileCandidates.push({
        extensionId,
        reason: {
          reasonId: "file",
          reasonText: `检测到 ${label}，建议安装相关扩展。`,
          source,
        },
        evidenceKind: "file",
        evidenceSource: source,
      })
      fileEvidence.push({
        kind: "file",
        extensionId,
        source,
        detail: `基于文件名 ${source} 生成推荐。`,
        timestamp,
      })
    }
  }

  private createExecutableRecommendations(executables: string[], timestamp: number): {
    exeCandidates: Candidate[]
    exeEvidence: RecommendationEvidence[]
  } {
    const exeCandidates: Candidate[] = []
    const exeEvidence: RecommendationEvidence[] = []
    const map: Record<string, string> = {
      git: "github.vscode-github-actions",
      node: "dbaeumer.vscode-eslint",
      python: "ms-python.python",
    }
    for (const exe of [...new Set(executables.map((item) => item.toLowerCase()))]) {
      const extensionId = map[exe]
      if (!extensionId) continue
      exeCandidates.push({
        extensionId,
        reason: {
          reasonId: "executable",
          reasonText: `检测到本地可执行文件 ${exe}。`,
          source: exe,
        },
        evidenceKind: "executable",
        evidenceSource: exe,
      })
      exeEvidence.push({
        kind: "executable",
        extensionId,
        source: exe,
        detail: `基于本地可执行文件 ${exe} 生成推荐。`,
        timestamp,
      })
    }
    return { exeCandidates, exeEvidence }
  }

  private createContentRecommendations(signals: ContentRecommendationSignal[], timestamp: number): {
    contentCandidates: Candidate[]
    contentEvidence: RecommendationEvidence[]
  } {
    const contentCandidates: Candidate[] = []
    const contentEvidence: RecommendationEvidence[] = []
    for (const signal of signals) {
      const extensionId = normalizeExtensionId(signal.extensionId)
      if (!isValidExtensionId(extensionId)) continue
      contentCandidates.push({
        extensionId,
        reason: {
          reasonId: "dynamicWorkspace",
          reasonText: signal.reasonText,
          source: signal.source || signal.id,
        },
        evidenceKind: "content",
        evidenceSource: signal.source || signal.id,
      })
      contentEvidence.push({
        kind: "content",
        extensionId,
        source: signal.source || signal.id,
        detail: signal.reasonText,
        timestamp,
      })
    }
    return { contentCandidates, contentEvidence }
  }

  private dedupeCandidates(
    candidates: Candidate[],
    ignored: Set<string>,
    installedIds: Set<string>,
    timestamp: number,
  ): {
    recommendations: WorkspaceExtensionRecommendation[]
    reasonByExtensionId: Record<string, RecommendationReason>
    localEvidence: RecommendationEvidence[]
  } {
    const recommendations: WorkspaceExtensionRecommendation[] = []
    const reasonByExtensionId: Record<string, RecommendationReason> = {}
    const localEvidence: RecommendationEvidence[] = []
    const seen = new Set<string>()
    for (const candidate of candidates) {
      const extensionId = normalizeExtensionId(candidate.extensionId)
      if (!isValidExtensionId(extensionId) || ignored.has(extensionId) || seen.has(extensionId)) continue
      seen.add(extensionId)
      const item = {
        extensionId,
        reason: candidate.reason,
        important: candidate.important === true,
        installed: installedIds.has(extensionId),
      }
      recommendations.push(item)
      reasonByExtensionId[extensionId] = item.reason
      localEvidence.push({
        kind: candidate.evidenceKind,
        extensionId,
        source: candidate.evidenceSource || candidate.reason.source,
        detail: candidate.reason.reasonText,
        timestamp,
      })
    }
    return { recommendations, reasonByExtensionId, localEvidence }
  }
}

export function createWorkspaceRecommendationsService(
  options: WorkspaceRecommendationsServiceOptions = {},
): CodekWorkspaceRecommendationsService {
  return new CodekWorkspaceRecommendationsService(options)
}

function normalizeExtensionId(value: string): string {
  return String(value || "").trim().toLowerCase()
}

function isValidExtensionId(value: string): boolean {
  return EXTENSION_IDENTIFIER_PATTERN.test(value)
}

function createInvalidRecommendation(value: string, source: string): InvalidWorkspaceRecommendation {
  return {
    value,
    source,
    message: `扩展推荐格式无效，期望 <publisher>.<name>：${value}`,
  }
}

function isSensitiveRecommendationPath(pathValue: string): boolean {
  const normalized = pathValue.replace(/\\/g, "/").toLowerCase()
  const basename = normalized.split("/").pop() || normalized
  return basename === ".env" || basename.includes("secret") || basename.includes("token") || basename.endsWith(".pem")
}

function createActionDescriptors(recommendations: WorkspaceExtensionRecommendation[]): RecommendationActionDescriptor[] {
  const actions: RecommendationActionDescriptor[] = []
  for (const item of recommendations) {
    actions.push({
      id: `recommendations.install.${item.extensionId}`,
      action: "install",
      extensionId: item.extensionId,
      label: `安装 ${item.extensionId}`,
      requiresApproval: true,
      evidenceKind: reasonToEvidenceKind(item.reason.reasonId),
    })
    actions.push({
      id: `recommendations.ignore.${item.extensionId}`,
      action: "ignore",
      extensionId: item.extensionId,
      label: `忽略 ${item.extensionId}`,
      requiresApproval: false,
      evidenceKind: reasonToEvidenceKind(item.reason.reasonId),
    })
  }
  actions.push({
    id: "recommendations.openSettings",
    action: "openSettings",
    label: "打开推荐设置",
    requiresApproval: false,
  })
  return actions
}

function reasonToEvidenceKind(reasonId: RecommendationReasonId): RecommendationEvidence["kind"] {
  if (reasonId === "file") return "file"
  if (reasonId === "executable") return "executable"
  if (reasonId === "dynamicWorkspace") return "content"
  return "workspace"
}

function splitImportant(items: WorkspaceExtensionRecommendation[]): { important: string[]; others: string[] } {
  return {
    important: items.filter((item) => item.important).map((item) => item.extensionId),
    others: items.filter((item) => !item.important).map((item) => item.extensionId),
  }
}

export const globalWorkspaceRecommendationsService = new CodekWorkspaceRecommendationsService()
registerSingleton(IWorkspaceRecommendationsService, globalWorkspaceRecommendationsService, InstantiationType.Delayed)
