import type { GitStatusSummary } from "../components/gitState"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator, refineServiceDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"

export interface ScmCommand {
  commandId: string
  title: string
  arguments: string[]
  enabled: boolean
}

export interface ScmOwnerEvidence {
  kind: "provider" | "resourceGroup" | "resource" | "command"
  owner: string
  codekStateSource: string
  vscodeSourcePaths: string[]
  readonlyEvidence: boolean
  gitIndexMutation: boolean
  connected: boolean
  commandId?: string
  remainingUiOwnerGap: string[]
}

export interface ScmResourceAction extends ScmCommand {
  readonlyEvidence: boolean
  gitIndexMutation: boolean
  ownerEvidence?: ScmOwnerEvidence
}

export interface ScmResourceActions {
  open: ScmResourceAction
  diff: ScmResourceAction
  stage: ScmResourceAction
  unstage: ScmResourceAction
  discard: ScmResourceAction
  attach?: ScmResourceAction
}

export interface ScmRepositoryInput {
  value: string
  placeholder: string
  enabled: boolean
  visible: boolean
  validationMessage?: string | null
  validationType?: number | null
}

export interface ScmResource {
  path: string
  status: string
  staged: boolean
  oldPath?: string
  providerId?: string
  rootUri?: string
  groupId?: string
  resourceUri?: string
  sourceUri?: string
  label?: string
  tooltip?: string
  contextValue?: string
  command?: ScmCommand | null
  actions?: Partial<ScmResourceActions>
  multiDiffEditorOriginalUri?: string
  multiDiffEditorModifiedUri?: string
  readonlyEvidence?: boolean
  gitIndexMutation?: boolean
  ownerEvidence?: ScmOwnerEvidence
}

export interface ScmResourceGroup {
  id: "staged" | "changes" | "conflicts" | string
  label: string
  resources: ScmResource[]
  hideWhenEmpty?: boolean
  contextValue?: string
  providerId?: string
  rootUri?: string
  multiDiffEditorEnableViewChanges?: boolean
  ownerEvidence?: ScmOwnerEvidence
}

export interface ScmProviderSnapshot {
  id: string
  providerId: string
  label: string
  rootUri: string
  branch: string
  ahead: number
  behind: number
  groups: ScmResourceGroup[]
  count: number
  parentId?: string
  contextValue?: string
  isHidden?: boolean
  input?: Partial<ScmRepositoryInput>
  commitTemplate?: string
  acceptInputCommand?: ScmCommand | null
  actionButton?: ScmCommand | null
  statusBarCommands?: ScmCommand[]
  ownerEvidence?: ScmOwnerEvidence
}

export interface ScmRepository {
  id: string
  provider: ScmProviderSnapshot
  resourceGroups: ScmResourceGroup[]
  input: ScmRepositoryInput
  actionButton: ScmCommand | null
  readonly: boolean
  dispose(): void
}

export interface ScmProviderRegistration {
  repository: ScmRepository
  dispose(): void
}

export interface IScmRegistryService {
  readonly _serviceBrand: undefined
  readonly repositoryCount: number
  registerOrUpdateProvider(snapshot: ScmProviderSnapshot): ScmRepository
  registerOrUpdateGitProvider(rootUri: string, status: GitStatusSummary | null): ScmRepository | null
  unregisterProvider(id: string): void
  registerSCMProvider(snapshot: ScmProviderSnapshot): ScmProviderRegistration
  getRepositories(): ScmRepository[]
  getRepository(id: string): ScmRepository | undefined
  getProviders(): ScmProviderSnapshot[]
  getProviderTree(): Array<ScmProviderSnapshot & { groups: ScmResourceGroup[] }>
  getProviderSnapshot(providerId: string, rootUri?: string): (ScmProviderSnapshot & { groups: ScmResourceGroup[] }) | null
  getResourceGroup(providerId: string, rootUri: string, groupId: string): ScmResourceGroup
  getResource(path: string, rootUri?: string): ScmResource | null
  getResourceActions(path: string, rootUri?: string): ScmResourceActions | null
  getQuickDiffResource(path: string, rootUri?: string): ScmResource | null
  reset(): void
}

export interface IScmService extends IScmRegistryService {}

export const IScmRegistryService = createDecorator<IScmRegistryService>("scmRegistryService")
export const IScmService = refineServiceDecorator<IScmRegistryService, IScmService>(IScmRegistryService)

export class ScmRegistryService implements IScmRegistryService {
  declare readonly _serviceBrand: undefined

  private readonly providers = new Map<string, ScmProviderSnapshot>()

  get repositoryCount(): number {
    return this.providers.size
  }

  registerOrUpdateProvider(snapshot: ScmProviderSnapshot): ScmRepository {
    const normalized = normalizeProviderSnapshot(snapshot)
    this.providers.set(normalized.id, normalized)
    return this.toRepository(this.providers.get(normalized.id)!)
  }

  registerOrUpdateGitProvider(rootUri: string, status: GitStatusSummary | null): ScmRepository | null {
    if (!rootUri || !status) return null
    return this.registerOrUpdateProvider(createGitProviderSnapshot(rootUri, status))
  }

  unregisterProvider(id: string): void {
    this.providers.delete(id)
  }

  registerSCMProvider(snapshot: ScmProviderSnapshot): ScmProviderRegistration {
    const repository = this.registerOrUpdateProvider(snapshot)
    return {
      repository,
      dispose: () => this.unregisterProvider(snapshot.id),
    }
  }

  getRepositories(): ScmRepository[] {
    return this.getProviderTree().map((provider) => this.toRepository(provider))
  }

  getRepository(id: string): ScmRepository | undefined {
    const provider = this.providers.get(id)
    return provider ? this.toRepository(provider) : undefined
  }

  getProviders(): ScmProviderSnapshot[] {
    return [...this.providers.values()].map(cloneProviderSnapshot)
  }

  getProviderTree(): Array<ScmProviderSnapshot & { groups: ScmResourceGroup[] }> {
    return this.getProviders()
      .sort((a, b) => a.label.localeCompare(b.label) || a.rootUri.localeCompare(b.rootUri) || a.id.localeCompare(b.id))
      .map((provider) => enrichProviderSnapshot(provider))
  }

  getProviderSnapshot(providerId: string, rootUri = ""): (ScmProviderSnapshot & { groups: ScmResourceGroup[] }) | null {
    const normalizedRoot = normalizePath(rootUri)
    return this.getProviderTree().find((provider) => {
      if (provider.providerId !== providerId) return false
      return !normalizedRoot || normalizePath(provider.rootUri) === normalizedRoot
    }) || null
  }

  getResourceGroup(providerId: string, rootUri: string, groupId: string): ScmResourceGroup {
    const provider = this.getProviderSnapshot(providerId, rootUri)
    return provider?.groups.find((group) => group.id === groupId) || {
      id: groupId,
      label: groupId,
      resources: [],
      providerId,
      rootUri: normalizePath(rootUri),
    }
  }

  getResource(path: string, rootUri = ""): ScmResource | null {
    return this.findResource(path, rootUri, { includeStaged: true, includeConflicts: true })
  }

  getResourceActions(path: string, rootUri = ""): ScmResourceActions | null {
    const resource = this.getResource(path, rootUri)
    return resource?.actions ? cloneResolvedResourceActions(resource.actions) : null
  }

  getQuickDiffResource(path: string, rootUri = ""): ScmResource | null {
    return this.findResource(path, rootUri, { includeStaged: false, includeConflicts: false })
  }

  reset(): void {
    this.providers.clear()
  }

  private findResource(
    path: string,
    rootUri = "",
    options: { includeStaged: boolean; includeConflicts: boolean },
  ): ScmResource | null {
    const normalizedPath = normalizePath(path)
    const normalizedRoot = normalizePath(rootUri)
    for (const provider of this.getProviderTree()) {
      if (normalizedRoot && normalizePath(provider.rootUri) !== normalizedRoot) continue
      for (const group of provider.groups) {
        if (!options.includeStaged && group.id === "staged") continue
        if (!options.includeConflicts && group.id === "conflicts") continue
        const match = group.resources.find((resource) => matchesResourcePath(resource, normalizedPath))
        if (match) return cloneResource(match)
      }
    }
    return null
  }

  private toRepository(provider: ScmProviderSnapshot & { groups?: ScmResourceGroup[] }): ScmRepository {
    const snapshot = enrichProviderSnapshot(provider)
    return {
      id: snapshot.id,
      provider: snapshot,
      resourceGroups: snapshot.groups,
      input: toRepositoryInput(snapshot),
      actionButton: cloneCommand(snapshot.actionButton),
      readonly: snapshot.groups.every((group) => group.resources.every((resource) => resource.readonlyEvidence === true)),
      dispose: () => this.unregisterProvider(snapshot.id),
    }
  }
}

export const globalScmRegistryService = new ScmRegistryService()
registerSingleton(IScmRegistryService, globalScmRegistryService, InstantiationType.Delayed)

export function registerOrUpdateScmProvider(snapshot: ScmProviderSnapshot): ScmProviderSnapshot {
  return globalScmRegistryService.registerOrUpdateProvider(snapshot).provider
}

export function registerOrUpdateGitProvider(rootUri: string, status: GitStatusSummary | null): ScmProviderSnapshot | null {
  if (!rootUri || !status) return null
  const snapshot = createGitProviderSnapshot(rootUri, status)
  return globalScmRegistryService.registerOrUpdateProvider(snapshot).provider
}

export function unregisterScmProvider(id: string): void {
  globalScmRegistryService.unregisterProvider(id)
}

export function getScmProviders(): ScmProviderSnapshot[] {
  return globalScmRegistryService.getProviders()
}

export function getScmRepositories(): ScmRepository[] {
  return globalScmRegistryService.getRepositories()
}

export function getScmProviderTree(): Array<ScmProviderSnapshot & { groups: ScmResourceGroup[] }> {
  return globalScmRegistryService.getProviderTree()
}

export function getScmProviderSnapshot(providerId: string, rootUri = ""): (ScmProviderSnapshot & { groups: ScmResourceGroup[] }) | null {
  return globalScmRegistryService.getProviderSnapshot(providerId, rootUri)
}

export function getScmResourceGroup(providerId: string, rootUri: string, groupId: string): ScmResourceGroup {
  return globalScmRegistryService.getResourceGroup(providerId, rootUri, groupId)
}

export function getScmResource(path: string, rootUri = ""): ScmResource | null {
  return globalScmRegistryService.getResource(path, rootUri)
}

export function getScmResourceActions(path: string, rootUri = ""): ScmResourceActions | null {
  return globalScmRegistryService.getResourceActions(path, rootUri)
}

export function getQuickDiffResource(path: string, rootUri = ""): ScmResource | null {
  return globalScmRegistryService.getQuickDiffResource(path, rootUri)
}

export function resetScmRegistry(): void {
  globalScmRegistryService.reset()
}

export function createGitProviderSnapshot(rootUri: string, status: GitStatusSummary): ScmProviderSnapshot {
  const normalizedRoot = normalizePath(rootUri)
  const conflicts = status.conflicts || []
  const staged = status.staged || []
  const changes = (status.changes || []).filter((item) => !conflicts.some((conflict) => conflict.path === item.path))
  const groups: ScmResourceGroup[] = [
    { id: "staged", label: "暂存的更改", resources: staged.map(toScmResource) },
    { id: "changes", label: "更改", resources: changes.map(toScmResource) },
    { id: "conflicts", label: "冲突", resources: conflicts.map(toScmResource), contextValue: "gitConflictResource" },
  ]
  return {
    id: `git:${normalizedRoot}`,
    providerId: "git",
    label: status.repoName || "Git",
    rootUri: normalizedRoot,
    branch: status.branch,
    ahead: status.ahead,
    behind: status.behind,
    groups,
    count: groups.reduce((sum, group) => sum + group.resources.length, 0),
    input: {
      value: "",
      placeholder: `${status.repoName || "Git"} commit message`,
      enabled: true,
      visible: true,
    },
  }
}

function toScmResource(resource: ScmResource): ScmResource {
  return {
    path: normalizePath(resource.path),
    status: resource.status,
    staged: resource.staged,
    oldPath: resource.oldPath ? normalizePath(resource.oldPath) : undefined,
    label: resource.label,
    tooltip: resource.tooltip,
    contextValue: resource.contextValue,
    readonlyEvidence: resource.readonlyEvidence === true,
    gitIndexMutation: resource.gitIndexMutation === true,
    command: cloneCommand(resource.command),
    actions: resource.actions ? cloneResourceActions(resource.actions) : undefined,
    multiDiffEditorOriginalUri: resource.multiDiffEditorOriginalUri ? normalizePath(resource.multiDiffEditorOriginalUri) : undefined,
    multiDiffEditorModifiedUri: resource.multiDiffEditorModifiedUri ? normalizePath(resource.multiDiffEditorModifiedUri) : undefined,
  }
}

function normalizeProviderSnapshot(snapshot: ScmProviderSnapshot): ScmProviderSnapshot {
  const normalizedRoot = normalizePath(snapshot.rootUri)
  const groups = (snapshot.groups || []).map((group) => normalizeGroup(snapshot.providerId, normalizedRoot, group))
  return {
    id: String(snapshot.id || `${snapshot.providerId}:${normalizedRoot}`),
    providerId: String(snapshot.providerId || "unknown"),
    label: String(snapshot.label || snapshot.providerId || "SCM"),
    rootUri: normalizedRoot,
    branch: String(snapshot.branch || ""),
    ahead: finiteNumber(snapshot.ahead),
    behind: finiteNumber(snapshot.behind),
    groups,
    count: finiteNumber(snapshot.count, groups.reduce((sum, group) => sum + group.resources.length, 0)),
    parentId: snapshot.parentId ? String(snapshot.parentId) : undefined,
    contextValue: snapshot.contextValue ? String(snapshot.contextValue) : undefined,
    isHidden: snapshot.isHidden === true,
    input: snapshot.input ? normalizeInput(snapshot.input) : undefined,
    commitTemplate: snapshot.commitTemplate ? String(snapshot.commitTemplate) : undefined,
    acceptInputCommand: cloneCommand(snapshot.acceptInputCommand),
    actionButton: cloneCommand(snapshot.actionButton),
    statusBarCommands: normalizeCommands(snapshot.statusBarCommands),
    ownerEvidence: normalizeOwnerEvidence(snapshot.ownerEvidence, {
      kind: "provider",
      owner: `${snapshot.providerId || "unknown"}:${normalizedRoot}`,
      readonlyEvidence: groups.every((group) => group.resources.every((resource) => resource.readonlyEvidence === true)),
      gitIndexMutation: false,
      connected: true,
    }),
  }
}

function normalizeGroup(providerId: string, rootUri: string, group: ScmResourceGroup): ScmResourceGroup {
  const groupId = String(group.id || "changes")
  return {
    id: groupId,
    label: String(group.label || group.id || "Changes"),
    hideWhenEmpty: group.hideWhenEmpty === true,
    contextValue: group.contextValue ? String(group.contextValue) : undefined,
    providerId,
    rootUri,
    multiDiffEditorEnableViewChanges: group.multiDiffEditorEnableViewChanges === true,
    ownerEvidence: normalizeOwnerEvidence(group.ownerEvidence, {
      kind: "resourceGroup",
      owner: `${providerId}:${groupId}`,
      readonlyEvidence: (group.resources || []).every((resource) => resource.readonlyEvidence === true),
      gitIndexMutation: false,
      connected: true,
    }),
    resources: (group.resources || []).map((resource) => normalizeResource(providerId, rootUri, groupId, resource)),
  }
}

function normalizeResource(providerId: string, rootUri: string, groupId: string, resource: ScmResource): ScmResource {
  const relativePath = normalizePath(resource.path)
  const resourceUri = normalizePath(resource.resourceUri || toResourceUri(rootUri, relativePath))
  return {
    path: relativePath,
    status: String(resource.status || "M"),
    staged: resource.staged === true,
    oldPath: resource.oldPath ? normalizePath(resource.oldPath) : undefined,
    providerId,
    rootUri,
    groupId,
    resourceUri,
    sourceUri: resource.sourceUri ? normalizePath(resource.sourceUri) : resourceUri,
    label: resource.label ? String(resource.label) : String(resource.status || "M"),
    tooltip: resource.tooltip ? String(resource.tooltip) : undefined,
    contextValue: resource.contextValue ? String(resource.contextValue) : undefined,
    command: cloneCommand(resource.command),
    actions: resource.actions ? cloneResourceActions(resource.actions) : undefined,
    multiDiffEditorOriginalUri: resource.multiDiffEditorOriginalUri ? normalizePath(resource.multiDiffEditorOriginalUri) : undefined,
    multiDiffEditorModifiedUri: resource.multiDiffEditorModifiedUri ? normalizePath(resource.multiDiffEditorModifiedUri) : undefined,
    readonlyEvidence: resource.readonlyEvidence === true,
    gitIndexMutation: resource.gitIndexMutation === true,
    ownerEvidence: normalizeOwnerEvidence(resource.ownerEvidence, {
      kind: "resource",
      owner: `${providerId}:${groupId}:${relativePath}`,
      readonlyEvidence: resource.readonlyEvidence === true,
      gitIndexMutation: resource.gitIndexMutation === true,
      connected: true,
    }),
  }
}

function enrichProviderSnapshot(provider: ScmProviderSnapshot): ScmProviderSnapshot & { groups: ScmResourceGroup[] } {
  const snapshot = normalizeProviderSnapshot(provider)
  return {
    ...snapshot,
    groups: snapshot.groups
      .map((group) => ({
        ...group,
        resources: group.resources
          .map((resource) => enrichResource(snapshot, group, resource))
          .sort((a, b) => a.path.localeCompare(b.path)),
      }))
      .filter((group) => group.resources.length > 0 || group.hideWhenEmpty === false),
  }
}

function enrichResource(provider: ScmProviderSnapshot, group: ScmResourceGroup, resource: ScmResource): ScmResource {
  const resourceUri = normalizePath(resource.resourceUri || toResourceUri(provider.rootUri, resource.path))
  const readonlyEvidence = resource.readonlyEvidence === true
  const actions = resolveResourceActions(provider, group, { ...resource, resourceUri, readonlyEvidence })
  return {
    ...resource,
    providerId: provider.providerId,
    rootUri: provider.rootUri,
    groupId: group.id,
    resourceUri,
    sourceUri: normalizePath(resource.sourceUri || resourceUri),
    label: String(resource.label || resource.status || "M"),
    tooltip: resource.tooltip || `${provider.label}: ${statusLabel(resource.status)} (${group.label})`,
    readonlyEvidence,
    gitIndexMutation: resource.gitIndexMutation === true,
    ownerEvidence: normalizeOwnerEvidence(resource.ownerEvidence, {
      kind: "resource",
      owner: `${provider.providerId}:${group.id}:${resource.path}`,
      readonlyEvidence,
      gitIndexMutation: resource.gitIndexMutation === true,
      connected: true,
    }),
    command: cloneCommand(resource.command),
    actions,
  }
}

function resolveResourceActions(provider: ScmProviderSnapshot, group: ScmResourceGroup, resource: ScmResource): ScmResourceActions {
  const defaults = buildDefaultResourceActions(provider, group, resource)
  const overrides = resource.actions || {}
  return {
    open: normalizeResourceAction(overrides.open, defaults.open),
    diff: normalizeResourceAction(overrides.diff, defaults.diff),
    stage: normalizeResourceAction(overrides.stage, defaults.stage),
    unstage: normalizeResourceAction(overrides.unstage, defaults.unstage),
    discard: normalizeResourceAction(overrides.discard, defaults.discard),
    attach: normalizeResourceAction(overrides.attach, defaults.attach || defaults.diff),
  }
}

function buildDefaultResourceActions(provider: ScmProviderSnapshot, group: ScmResourceGroup, resource: ScmResource): ScmResourceActions {
  const resourceUri = String(resource.resourceUri || "")
  const readonlyEvidence = resource.readonlyEvidence === true
  const canMutateGitIndex = provider.providerId === "git" && readonlyEvidence !== true
  const canStage = canMutateGitIndex && group.id !== "staged" && group.id !== "conflicts"
  const canUnstage = canMutateGitIndex && group.id === "staged"
  return {
    open: {
      commandId: "scm.openResource",
      title: "打开资源",
      arguments: [resourceUri],
      enabled: Boolean(resourceUri),
      readonlyEvidence,
      gitIndexMutation: false,
      ownerEvidence: buildCommandOwnerEvidence(provider, group, resource, "open", "scm.openResource", readonlyEvidence, false, Boolean(resourceUri)),
    },
    diff: {
      commandId: "scm.diffResource",
      title: resource.oldPath ? "查看重命名差异" : "查看差异",
      arguments: [resourceUri],
      enabled: Boolean(resourceUri),
      readonlyEvidence,
      gitIndexMutation: false,
      ownerEvidence: buildCommandOwnerEvidence(provider, group, resource, "diff", "scm.diffResource", readonlyEvidence, false, Boolean(resourceUri)),
    },
    stage: {
      commandId: "scm.stageResource",
      title: readonlyEvidence ? "只读 evidence，不写 Git index" : "暂存更改",
      arguments: [resourceUri],
      enabled: canStage,
      readonlyEvidence,
      gitIndexMutation: canStage,
      ownerEvidence: buildCommandOwnerEvidence(provider, group, resource, "stage", "scm.stageResource", readonlyEvidence, canStage, canStage),
    },
    unstage: {
      commandId: "scm.unstageResource",
      title: readonlyEvidence ? "只读 evidence，不写 Git index" : "取消暂存",
      arguments: [resourceUri],
      enabled: canUnstage,
      readonlyEvidence,
      gitIndexMutation: canUnstage,
      ownerEvidence: buildCommandOwnerEvidence(provider, group, resource, "unstage", "scm.unstageResource", readonlyEvidence, canUnstage, canUnstage),
    },
    discard: {
      commandId: "scm.discardResource",
      title: readonlyEvidence ? "只读 evidence，不丢弃工作区内容" : "丢弃更改",
      arguments: [resourceUri],
      enabled: false,
      readonlyEvidence: true,
      gitIndexMutation: false,
      ownerEvidence: buildCommandOwnerEvidence(provider, group, resource, "discard", "scm.discardResource", true, false, false),
    },
    attach: {
      commandId: "scm.attachResourceEvidence",
      title: "附加到证据链",
      arguments: [resourceUri],
      enabled: Boolean(resourceUri),
      readonlyEvidence: true,
      gitIndexMutation: false,
      ownerEvidence: buildCommandOwnerEvidence(provider, group, resource, "attach", "scm.attachResourceEvidence", true, false, true),
    },
  }
}

function normalizeInput(input: Partial<ScmRepositoryInput> | undefined): ScmRepositoryInput {
  return {
    value: String(input?.value || ""),
    placeholder: String(input?.placeholder || ""),
    enabled: input?.enabled !== false,
    visible: input?.visible !== false,
    validationMessage: input?.validationMessage ? String(input.validationMessage) : null,
    validationType: typeof input?.validationType === "number" ? input.validationType : null,
  }
}

function toRepositoryInput(provider: ScmProviderSnapshot): ScmRepositoryInput {
  const input = normalizeInput(provider.input)
  return {
    ...input,
    placeholder: input.placeholder || `${provider.label} commit message`,
    enabled: provider.providerId === "git" ? input.enabled : false,
  }
}

function normalizeCommands(commands: readonly ScmCommand[] | undefined | null): ScmCommand[] | undefined {
  if (!commands?.length) return undefined
  return commands.map((command) => normalizeCommand(command))
}

function normalizeCommand(command: Partial<ScmCommand> | null | undefined): ScmCommand {
  return {
    commandId: String(command?.commandId || "scm.command"),
    title: String(command?.title || command?.commandId || "SCM Command"),
    arguments: Array.isArray(command?.arguments) ? command.arguments.map((value) => String(value)) : [],
    enabled: command?.enabled !== false,
  }
}

function normalizeResourceAction(action: Partial<ScmResourceAction> | undefined, fallback: ScmResourceAction): ScmResourceAction {
  if (!action) return cloneResourceAction(fallback)
  const readonlyEvidence = action.readonlyEvidence === true || fallback.readonlyEvidence === true
  const enabled = action.enabled !== false && fallback.enabled !== false
  const gitIndexMutation = readonlyEvidence ? false : action.gitIndexMutation === true || (enabled && fallback.gitIndexMutation === true)
  return {
    commandId: String(action.commandId || fallback.commandId),
    title: String(action.title || fallback.title),
    arguments: Array.isArray(action.arguments) ? action.arguments.map((value) => String(value)) : [...fallback.arguments],
    enabled,
    readonlyEvidence,
    gitIndexMutation,
    ownerEvidence: normalizeOwnerEvidence(action.ownerEvidence || fallback.ownerEvidence, {
      kind: "command",
      owner: fallback.ownerEvidence?.owner || String(action.commandId || fallback.commandId),
      commandId: String(action.commandId || fallback.commandId),
      readonlyEvidence,
      gitIndexMutation,
      connected: enabled,
    }),
  }
}

function cloneProviderSnapshot(snapshot: ScmProviderSnapshot): ScmProviderSnapshot {
  const normalized = normalizeProviderSnapshot(snapshot)
  return {
    ...normalized,
    ownerEvidence: cloneOwnerEvidence(normalized.ownerEvidence),
    input: normalized.input ? { ...normalized.input } : undefined,
    acceptInputCommand: cloneCommand(normalized.acceptInputCommand),
    actionButton: cloneCommand(normalized.actionButton),
    statusBarCommands: normalizeCommands(normalized.statusBarCommands),
    groups: normalized.groups.map((group) => ({
      ...group,
      ownerEvidence: cloneOwnerEvidence(group.ownerEvidence),
      resources: group.resources.map((resource) => cloneResource(resource)),
    })),
  }
}

function cloneResource(resource: ScmResource): ScmResource {
  return {
    ...resource,
    ownerEvidence: cloneOwnerEvidence(resource.ownerEvidence),
    command: cloneCommand(resource.command),
    actions: resource.actions ? cloneResourceActions(resource.actions) : undefined,
  }
}

function cloneCommand(command: ScmCommand | null | undefined): ScmCommand | null {
  return command ? { ...normalizeCommand(command) } : null
}

function cloneResourceAction(action: ScmResourceAction | null | undefined): ScmResourceAction {
  return {
    commandId: String(action?.commandId || "scm.command"),
    title: String(action?.title || "SCM Command"),
    arguments: Array.isArray(action?.arguments) ? action.arguments.map((value) => String(value)) : [],
    enabled: action?.enabled !== false,
    readonlyEvidence: action?.readonlyEvidence === true,
    gitIndexMutation: action?.readonlyEvidence === true ? false : action?.gitIndexMutation === true,
    ownerEvidence: cloneOwnerEvidence(action?.ownerEvidence),
  }
}

function cloneResourceActions(actions: Partial<ScmResourceActions> | undefined): Partial<ScmResourceActions> {
  if (!actions) return {}
  return {
    open: actions.open ? cloneResourceAction(actions.open) : undefined,
    diff: actions.diff ? cloneResourceAction(actions.diff) : undefined,
    stage: actions.stage ? cloneResourceAction(actions.stage) : undefined,
    unstage: actions.unstage ? cloneResourceAction(actions.unstage) : undefined,
    discard: actions.discard ? cloneResourceAction(actions.discard) : undefined,
    attach: actions.attach ? cloneResourceAction(actions.attach) : undefined,
  }
}

function cloneResolvedResourceActions(actions: Partial<ScmResourceActions> | undefined): ScmResourceActions | null {
  if (!actions?.open || !actions.diff || !actions.stage || !actions.unstage || !actions.discard) return null
  return {
    open: cloneResourceAction(actions.open),
    diff: cloneResourceAction(actions.diff),
    stage: cloneResourceAction(actions.stage),
    unstage: cloneResourceAction(actions.unstage),
    discard: cloneResourceAction(actions.discard),
    attach: actions.attach ? cloneResourceAction(actions.attach) : undefined,
  }
}

function buildCommandOwnerEvidence(
  provider: ScmProviderSnapshot,
  group: ScmResourceGroup,
  resource: ScmResource,
  action: string,
  commandId: string,
  readonlyEvidence: boolean,
  gitIndexMutation: boolean,
  connected: boolean,
): ScmOwnerEvidence {
  return normalizeOwnerEvidence(undefined, {
    kind: "command",
    owner: `${provider.providerId}:${group.id}:${action}:${resource.path}`,
    commandId,
    readonlyEvidence,
    gitIndexMutation,
    connected,
  })
}

function normalizeOwnerEvidence(
  value: Partial<ScmOwnerEvidence> | undefined,
  fallback: Pick<ScmOwnerEvidence, "kind" | "owner" | "readonlyEvidence" | "gitIndexMutation" | "connected"> & { commandId?: string },
): ScmOwnerEvidence {
  return {
    kind: value?.kind || fallback.kind,
    owner: String(value?.owner || fallback.owner),
    codekStateSource: String(value?.codekStateSource || "scmRegistryService"),
    vscodeSourcePaths: Array.isArray(value?.vscodeSourcePaths) && value.vscodeSourcePaths.length > 0
      ? value.vscodeSourcePaths.map(String)
      : [
        "src/vs/workbench/contrib/scm/common/scm.ts",
        "src/vs/workbench/contrib/scm/browser/scmViewPane.ts",
        "src/vs/workbench/api/browser/mainThreadSCM.ts",
      ],
    readonlyEvidence: value?.readonlyEvidence === true || fallback.readonlyEvidence === true,
    gitIndexMutation: value?.readonlyEvidence === true ? false : value?.gitIndexMutation === true || fallback.gitIndexMutation === true,
    connected: value?.connected === true || fallback.connected === true,
    commandId: value?.commandId || fallback.commandId,
    remainingUiOwnerGap: Array.isArray(value?.remainingUiOwnerGap) && value.remainingUiOwnerGap.length > 0
      ? value.remainingUiOwnerGap.map(String)
      : ["App.vue/generic SCM shell owner 未在本后台线程接入"],
  }
}

function cloneOwnerEvidence(value: ScmOwnerEvidence | undefined): ScmOwnerEvidence | undefined {
  return value ? {
    ...value,
    vscodeSourcePaths: [...value.vscodeSourcePaths],
    remainingUiOwnerGap: [...value.remainingUiOwnerGap],
  } : undefined
}

function matchesResourcePath(resource: ScmResource, normalizedPath: string): boolean {
  return normalizePath(resource.path) === normalizedPath
    || normalizePath(resource.resourceUri || "") === normalizedPath
    || normalizePath(resource.sourceUri || "") === normalizedPath
    || normalizePath(`${resource.rootUri || ""}/${resource.path}`) === normalizedPath
}

function toResourceUri(rootUri: string, resourcePath: string): string {
  const normalizedRoot = normalizePath(rootUri)
  const normalizedPath = normalizePath(resourcePath)
  if (!normalizedRoot) return normalizedPath
  if (!normalizedPath) return normalizedRoot
  if (normalizedPath.startsWith(normalizedRoot)) return normalizedPath
  return normalizePath(`${normalizedRoot}/${normalizedPath}`)
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function statusLabel(status: string): string {
  if (status === "??") return "未跟踪"
  if (status === "A") return "新增"
  if (status === "D") return "删除"
  if (status === "R") return "重命名"
  if (status === "U") return "冲突"
  return "修改"
}

function normalizePath(value: string): string {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "")
}
