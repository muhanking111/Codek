import {
  clearAllSavedMcpInputs,
  clearSavedMcpInput,
  canInstallMcpGalleryServer,
  completeMcpResourceTemplate,
  getConfiguredMcpServers,
  getMcpGalleryReadme,
  getInstalledMcpGalleryServers,
  getMcpRegistrySnapshot,
  getSavedMcpInputs,
  installMcpGalleryServer,
  listMcpResources,
  listMcpResourceTemplates,
  readMcpResource,
  restartMcpServer,
  searchMcpGalleryServers,
  setSavedMcpInput,
  startMcpServer,
  stopMcpServer,
  subscribeMcpResource,
  uninstallMcpGalleryServer,
  updateMcpGalleryServerMetadata,
  type McpResourceTemplateCompletionResult,
  type McpGalleryServer,
  type McpRegistryServer,
  type McpAuthenticationSessionViewModel,
  type McpRegistryInputMetadata,
  type McpRegistryInputWriteOptions,
} from "../ai/mcpRegistryClient"
import { requestMcpInputs } from "../ai/mcpInputPrompt"
import { registerCommand, type CommandDescriptor } from "./commandRegistry"
import { MCP_COMMAND_IDS } from "./mcpCommandIds"
import { createQuickPickController, input, pick, quickInputState, type QuickPickEntry, type QuickPickItem } from "./quickInput"
import { attachMcpResourceToChat, createMcpVirtualResourceFromFileService, getMcpResourceAccessEvidenceSummary, openMcpResourceFromFileService, type McpVirtualResourceMetadata } from "./mcpResourceAccess"
import type { Disposable } from "../vscode-adapter/platform/commands/common/commandsRegistry"
import { MenuId, MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import { registerQuickAccessProvider, type QuickAccessItem, type QuickAccessProviderDescriptor } from "../vscode-adapter/platform/quickinput/common/quickAccess"
import { UriTemplate, type IUriTemplateVariable } from "../vscode-adapter/workbench/contrib/mcp/common/uriTemplate"
import { registerView, registerViewContainer } from "./viewRegistry"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import {
  createMcpResourceProviderBackedFileService,
  ensureDirectoryUri,
  isMcpResourceDirectoryStat,
  type McpResourceFileService,
} from "../vscode-adapter/platform/files/common/mcpResourceFileService"

// Source reference:
// - D:\SourceMirror\vscode\src\vs\workbench\contrib\mcp\browser\mcpCommands.ts
export interface McpInputCommandOptions {
  profileId?: string | null
}

export interface McpEditStoredInputRequest extends McpInputCommandOptions {
  input?: McpRegistryInputMetadata | string
  inputId?: string
  value?: unknown
  password?: boolean
}

export type McpServerOptionAction = "start" | "stop" | "restart" | "showOutput" | "resources" | "authorize"
export type McpResourceAction = "open" | "attach"
type McpGalleryPickValue =
  | { kind: "server"; server: McpGalleryServer }
  | { kind: "more" }
type McpResourcePickValue =
  | { kind: "resource"; uri: string }
  | { kind: "template"; uri: string }
  | { kind: "directory"; uri: string }
  | { kind: "back" }
type ResolvedTemplateValue = { value: string; completed: boolean }
type TemplateCompletionPick = ResolvedTemplateValue | { value: "__manual__"; completed: false }
type McpResourceList = Awaited<ReturnType<typeof listMcpResources>>
type McpResourceTemplateList = Awaited<ReturnType<typeof listMcpResourceTemplates>>
interface McpResourceQuickAccessDirectoryState {
  currentDirectory: string
  directoryStack: string[]
}

export interface McpBrowseGalleryOptions extends McpInputCommandOptions {
  query?: string
  pageSize?: number
  packageType?: string
  mcpTarget?: string
  workspace?: string
  workspaceFile?: string
}

export type McpGalleryDetailAction = "install" | "update" | "uninstall" | "back"
export type McpGalleryDetailInstallState =
  | "installable"
  | "installed"
  | "updateAvailable"
  | "notInstallable"
  | "pending"
  | "error"

export interface McpGalleryDetailViewAction {
  id: Exclude<McpGalleryDetailAction, "back">
  label: string
  enabled: boolean
  pending?: boolean
  detail?: string
}

export interface McpGalleryDetailViewModel {
  id: string
  title: string
  name: string
  description: string
  publisher: string
  source: string
  version: string
  packageMetadata: string
  readmeSummary: string
  manifestSummary: string
  installState: McpGalleryDetailInstallState
  statusLabel: string
  statusDetail: string
  authSession?: McpAuthenticationSessionViewModel
  metadata: Array<{ label: string; value: string }>
  actions: McpGalleryDetailViewAction[]
}

export interface McpWorkbenchSurfaceSnapshot {
  source: "mcpWorkbenchService"
  serviceId: string
  containerId: typeof MCP_WORKBENCH_VIEW_IDS.Container
  viewIds: string[]
  commandIds: string[]
  quickAccessPrefixes: string[]
  stateSource: "service"
  latestGalleryDetail?: ReturnType<typeof getMcpGalleryDetailEvidenceSummary>
  resourceAccess: ReturnType<typeof getMcpResourceAccessEvidenceSummary>
  openedCount: number
  attachmentCount: number
  readonlyProviderPath: boolean
  latestOpened?: ReturnType<typeof getMcpResourceAccessEvidenceSummary>["latestOpened"]
  latestAttachment?: ReturnType<typeof getMcpResourceAccessEvidenceSummary>["latestAttachment"]
  constraints: {
    providerBackedFileService: true
    preservesAgentApproval: true
    noSecondMcpState: true
    viewActionMenuDriven: true
  }
}

export type McpWorkbenchCommandContribution = CommandDescriptor & {
  category: "MCP"
  source: "vscode"
}

export type McpWorkbenchQuickAccessContribution = QuickAccessProviderDescriptor

export interface McpGalleryServiceAction {
  id: Exclude<McpGalleryDetailAction, "back">
  label: string
  run(options?: McpGalleryDetailActionOptions): Promise<void>
}

export interface McpWorkbenchService {
  readonly _serviceBrand: undefined
  setLatestGalleryDetail(model: McpGalleryDetailViewModel): void
  getLatestGalleryDetail(): McpGalleryDetailViewModel | undefined
  getCommandContributions(): McpWorkbenchCommandContribution[]
  getQuickAccessContributions(): McpWorkbenchQuickAccessContribution[]
  getGalleryActions(server: McpGalleryServer): McpGalleryServiceAction[]
  getSurfaceSnapshot(): McpWorkbenchSurfaceSnapshot
  clearState(): void
}

interface McpGalleryDetailBuildOptions {
  readme?: string
  permission: Awaited<ReturnType<typeof canInstallMcpGalleryServer>>
  installed?: Record<string, unknown> | null
  actionState?: McpGalleryDetailActionState
  authSession?: McpAuthenticationSessionViewModel
}

interface McpGalleryDetailActionState {
  status: "pending" | "error"
  action: Exclude<McpGalleryDetailAction, "back">
  message?: string
}

interface McpGalleryDetailActionOptions extends McpBrowseGalleryOptions {
  serverName?: string
  name?: string
}

let registrations: Disposable[] = []
const mcpResourceQuickAccessDirectoryState = new Map<string, McpResourceQuickAccessDirectoryState>()
const mcpGalleryDetailActionState = new Map<string, McpGalleryDetailActionState>()

export const MCP_WORKBENCH_VIEW_IDS = {
  Container: "workbench.view.mcp",
  Servers: "workbench.mcp.servers",
  Resources: "workbench.mcp.resources",
  Gallery: "workbench.mcp.gallery",
} as const

export const IMcpWorkbenchService = createDecorator<McpWorkbenchService>("mcpWorkbenchService")

class McpWorkbenchSurfaceService implements McpWorkbenchService {
  declare readonly _serviceBrand: undefined

  private latestGalleryDetail?: McpGalleryDetailViewModel
  private readonly commandContributions = createMcpCommandContributions()
  private readonly quickAccessContributions = createMcpQuickAccessContributions()

  setLatestGalleryDetail(model: McpGalleryDetailViewModel): void {
    this.latestGalleryDetail = model
  }

  getLatestGalleryDetail(): McpGalleryDetailViewModel | undefined {
    return this.latestGalleryDetail
  }

  getCommandContributions(): McpWorkbenchCommandContribution[] {
    return [...this.commandContributions]
  }

  getQuickAccessContributions(): McpWorkbenchQuickAccessContribution[] {
    return [...this.quickAccessContributions]
  }

  getGalleryActions(server: McpGalleryServer): McpGalleryServiceAction[] {
    return createMcpGalleryServiceActions(server)
  }

  getSurfaceSnapshot(): McpWorkbenchSurfaceSnapshot {
    const resourceAccess = getMcpResourceAccessEvidenceSummary()
    return {
      source: "mcpWorkbenchService",
      serviceId: String(IMcpWorkbenchService),
      containerId: MCP_WORKBENCH_VIEW_IDS.Container,
      viewIds: [
        MCP_WORKBENCH_VIEW_IDS.Servers,
        MCP_WORKBENCH_VIEW_IDS.Resources,
        MCP_WORKBENCH_VIEW_IDS.Gallery,
      ],
      commandIds: [
        MCP_COMMAND_IDS.Browse,
        MCP_COMMAND_IDS.OpenGalleryServer,
        MCP_COMMAND_IDS.ShowInstalled,
        MCP_COMMAND_IDS.ListServer,
        MCP_COMMAND_IDS.ServerOptions,
        MCP_COMMAND_IDS.BrowseResources,
      ],
      quickAccessPrefixes: ["mcp:", "mcpr "],
      stateSource: "service",
      resourceAccess,
      openedCount: resourceAccess.openedCount,
      attachmentCount: resourceAccess.attachmentCount,
      readonlyProviderPath: resourceAccess.readonlyProviderPath,
      latestOpened: resourceAccess.latestOpened,
      latestAttachment: resourceAccess.latestAttachment,
      ...(this.latestGalleryDetail ? { latestGalleryDetail: getMcpGalleryDetailEvidenceSummary(this.latestGalleryDetail) } : {}),
      constraints: {
        providerBackedFileService: true,
        preservesAgentApproval: true,
        noSecondMcpState: true,
        viewActionMenuDriven: true,
      },
    }
  }

  clearState(): void {
    this.latestGalleryDetail = undefined
  }
}

export const globalMcpWorkbenchService: McpWorkbenchService = new McpWorkbenchSurfaceService()
registerSingleton(IMcpWorkbenchService, globalMcpWorkbenchService, InstantiationType.Delayed)

export function getMcpWorkbenchSurfaceSnapshot(
  service: McpWorkbenchService = globalMcpWorkbenchService,
): McpWorkbenchSurfaceSnapshot {
  return service.getSurfaceSnapshot()
}

export function setMcpWorkbenchGalleryDetailForEvidence(model: McpGalleryDetailViewModel): void {
  globalMcpWorkbenchService.setLatestGalleryDetail(model)
}

export function registerMcpInputCommands(): Disposable {
  disposeMcpInputCommands()
  registerMcpWorkbenchViews()
  registrations = [
    ...globalMcpWorkbenchService.getCommandContributions().map((command) => registerMcpCommand(command)),
    ...globalMcpWorkbenchService.getQuickAccessContributions().map((descriptor) => registerQuickAccessProvider(descriptor)),
    registerMcpWorkbenchMenus(),
  ]

  return { dispose: disposeMcpInputCommands }
}

function registerMcpWorkbenchViews(): void {
  registerViewContainer({
    id: MCP_WORKBENCH_VIEW_IDS.Container,
    name: "MCP",
    location: "activityBar",
    icon: "plug",
    source: "vscode",
    order: 58,
  })
  registerView({
    id: MCP_WORKBENCH_VIEW_IDS.Servers,
    name: "MCP 服务器",
    containerId: MCP_WORKBENCH_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 10,
  })
  registerView({
    id: MCP_WORKBENCH_VIEW_IDS.Resources,
    name: "MCP 资源",
    containerId: MCP_WORKBENCH_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 20,
  })
  registerView({
    id: MCP_WORKBENCH_VIEW_IDS.Gallery,
    name: "MCP 资源库",
    containerId: MCP_WORKBENCH_VIEW_IDS.Container,
    location: "sideBar",
    source: "vscode",
    order: 30,
  })
}

function registerMcpWorkbenchMenus(): Disposable {
  return MenuRegistry.appendMenuItems([
    {
      id: MenuId.ViewTitle,
      item: {
        command: { id: MCP_COMMAND_IDS.Browse, title: "MCP: 浏览服务器", category: "MCP" },
        group: "navigation",
        order: 10,
        when: `view == ${MCP_WORKBENCH_VIEW_IDS.Gallery}`,
      },
    },
    {
      id: MenuId.ViewTitle,
      item: {
        command: { id: MCP_COMMAND_IDS.BrowseResources, title: "MCP: 浏览资源", category: "MCP" },
        group: "navigation",
        order: 20,
        when: `view == ${MCP_WORKBENCH_VIEW_IDS.Resources}`,
      },
    },
    {
      id: MenuId.ViewTitle,
      item: {
        command: { id: MCP_COMMAND_IDS.ShowInstalled, title: "MCP: 查看已安装服务器", category: "MCP" },
        group: "navigation",
        order: 30,
        when: `view == ${MCP_WORKBENCH_VIEW_IDS.Servers}`,
      },
    },
    {
      id: MenuId.CommandPalette,
      item: {
        command: { id: MCP_COMMAND_IDS.OpenGalleryServer, title: "MCP: 打开资源库服务器", category: "MCP" },
        group: "navigation",
      },
    },
  ])
}

function createMcpCommandContributions(): McpWorkbenchCommandContribution[] {
  return [
    {
      id: MCP_COMMAND_IDS.Browse,
      title: "MCP: 浏览服务器",
      category: "MCP",
      source: "vscode",
      handler: async (...args: unknown[]) => {
        await browseGalleryServers(normalizeBrowseGalleryOptions(args[0]))
      },
    },
    {
      id: MCP_COMMAND_IDS.OpenGalleryServer,
      title: "MCP: 打开资源库服务器",
      category: "MCP",
      source: "vscode",
      handler: async (...args: unknown[]) => {
        const { server, options } = normalizeOpenGalleryServerArgs(args)
        await showMcpGalleryServerDetail(server, options)
      },
    },
    {
      id: MCP_COMMAND_IDS.ShowInstalled,
      title: "MCP: 查看已安装服务器",
      category: "MCP",
      source: "vscode",
      handler: async () => {
        await getConfiguredMcpServers()
      },
    },
    {
      id: MCP_COMMAND_IDS.ListServer,
      title: "MCP: 列出服务器",
      category: "MCP",
      source: "vscode",
      handler: async () => {
        await pickMcpServer()
      },
    },
    {
      id: MCP_COMMAND_IDS.ServerOptions,
      title: "MCP: 服务器选项",
      category: "MCP",
      source: "vscode",
      handler: async (...args: unknown[]) => {
        const { serverName, action } = normalizeServerOptionsArgs(args)
        if (!serverName) {
          await pickMcpServer()
          return
        }
        await runServerOption(serverName, action)
      },
    },
    {
      id: MCP_COMMAND_IDS.StartServer,
      title: "MCP: 启动服务器",
      category: "MCP",
      source: "vscode",
      handler: async (...args: unknown[]) => {
        await startMcpServer(requireServerName(args[0]))
      },
    },
    {
      id: MCP_COMMAND_IDS.StopServer,
      title: "MCP: 停止服务器",
      category: "MCP",
      source: "vscode",
      handler: async (...args: unknown[]) => {
        await stopMcpServer(requireServerName(args[0]))
      },
    },
    {
      id: MCP_COMMAND_IDS.RestartServer,
      title: "MCP: 重启服务器",
      category: "MCP",
      source: "vscode",
      handler: async (...args: unknown[]) => {
        await restartMcpServer(requireServerName(args[0]))
      },
    },
    {
      id: MCP_COMMAND_IDS.ShowOutput,
      title: "MCP: 显示输出",
      category: "MCP",
      source: "vscode",
      handler: async (...args: unknown[]) => {
        await getConfiguredMcpServers()
        requireServerName(args[0])
      },
    },
    {
      id: MCP_COMMAND_IDS.BrowseResources,
      title: "MCP: 浏览资源",
      category: "MCP",
      source: "vscode",
      handler: async (...args: unknown[]) => {
        await browseMcpResources(args[0] === undefined ? undefined : requireServerName(args[0]))
      },
    },
    {
      id: MCP_COMMAND_IDS.GetSavedInputs,
      title: "获取已保存的 MCP 输入",
      category: "MCP",
      source: "vscode",
      handler: async (profileId?: string | null) => {
        await getSavedMcpInputs(profileId)
      },
    },
    {
      id: MCP_COMMAND_IDS.EditStoredInput,
      title: "编辑已保存的 MCP 输入",
      category: "MCP",
      source: "vscode",
      handler: async (...args: unknown[]) => {
        const { input, value, options } = normalizeEditStoredInputArgs(args)
        await setSavedMcpInput(input, value, options)
      },
    },
    {
      id: MCP_COMMAND_IDS.RemoveStoredInput,
      title: "删除已保存的 MCP 输入",
      category: "MCP",
      source: "vscode",
      handler: async (...args: unknown[]) => {
        const { inputId, options } = normalizeRemoveStoredInputArgs(args)
        if (inputId) {
          await clearSavedMcpInput(inputId, options)
          return
        }
        await clearAllSavedMcpInputs(options)
      },
    },
  ]
}

function createMcpQuickAccessContributions(): McpWorkbenchQuickAccessContribution[] {
  return [
    {
      prefix: "mcp:",
      placeholder: "MCP",
      helpEntries: [{ description: "MCP 资源" }],
      provider: {
        provide: (filter) => getMcpQuickAccessItems(filter),
      },
    },
    {
      prefix: "mcpr ",
      placeholder: "搜索 MCP 资源",
      helpEntries: [{
        prefix: "mcpr ",
        description: "MCP 资源",
        commandId: MCP_COMMAND_IDS.BrowseResources,
      }],
      provider: {
        provide: (filter) => getMcpResourceQuickAccessItems(filter),
      },
    },
  ]
}

function createMcpGalleryServiceActions(server: McpGalleryServer): McpGalleryServiceAction[] {
  return (["install", "update", "uninstall"] as const).map((action) => ({
    id: action,
    label: galleryActionChineseLabel(action),
    run: async (options: McpGalleryDetailActionOptions = {}) => {
      await runMcpGalleryDetailAction(action, server, options)
    },
  }))
}

function getMcpQuickAccessItems(filter = ""): QuickAccessItem[] {
  const normalized = filter.trim().toLowerCase()
  const items: QuickAccessItem[] = [
    {
      id: "mcp.resources",
      label: "浏览 MCP 资源",
      description: "MCP",
      commandId: MCP_COMMAND_IDS.BrowseResources,
    },
    {
      id: "mcp.servers.browse",
      label: "浏览 MCP 服务器",
      description: "MCP",
      commandId: MCP_COMMAND_IDS.Browse,
    },
    {
      id: "mcp.gallery.open",
      label: "打开 MCP 资源库服务器详情",
      description: "MCP",
      detail: "从 Gallery 搜索结果打开服务器详情",
      commandId: MCP_COMMAND_IDS.Browse,
    },
    {
      id: "mcp.servers.list",
      label: "列出 MCP 服务器",
      description: "MCP",
      commandId: MCP_COMMAND_IDS.ListServer,
    },
    {
      id: "mcp.servers.installed",
      label: "查看已安装 MCP 服务器",
      description: "MCP",
      commandId: MCP_COMMAND_IDS.ShowInstalled,
    },
  ]
  if (!normalized) return items
  return items.filter((item) => {
    const haystack = `${item.label} ${item.description || ""} ${item.commandId || ""}`.toLowerCase()
    return haystack.includes(normalized)
  })
}

async function getMcpResourceQuickAccessItems(filter = ""): Promise<QuickAccessItem[]> {
  const servers = (await getConfiguredMcpServers()).filter((server) => server.allowed !== false)
  const output: QuickAccessItem[] = []
  for (const server of servers) {
    const serverName = server.serverName
    const [resources, templates] = await Promise.all([
      listMcpResources(serverName).catch(() => []),
      listMcpResourceTemplates(serverName).catch(() => []),
    ])
    const state = getMcpResourceQuickAccessState(serverName)
    const fileService = createProviderBackedMcpResourceFileService(serverName, resources, templates)
    for (const entry of await buildMcpResourcePickEntries(
      resources,
      templates,
      state.currentDirectory,
      state.directoryStack.length > 0,
      fileService,
    )) {
      if (entry.type === "separator" || !entry.value) continue
      output.push(toMcpResourceQuickAccessItem(serverName, entry, state, fileService, resources))
    }
  }
  return output.some((item) => item.id.startsWith("mcpr-back:"))
    ? output
    : filterQuickAccessItems(output, filter)
}

function getMcpResourceQuickAccessState(serverName: string): McpResourceQuickAccessDirectoryState {
  let state = mcpResourceQuickAccessDirectoryState.get(serverName)
  if (!state) {
    state = { currentDirectory: "", directoryStack: [] }
    mcpResourceQuickAccessDirectoryState.set(serverName, state)
  }
  return state
}

function toMcpResourceQuickAccessItem(
  serverName: string,
  entry: QuickPickItem<McpResourcePickValue>,
  state: McpResourceQuickAccessDirectoryState = getMcpResourceQuickAccessState(serverName),
  fileService: McpResourceFileService = createMcpResourceProviderBackedFileService(),
  resources: McpResourceList = [],
): QuickAccessItem {
  const description = [serverName, entry.description].filter(Boolean).join(" - ")
  const value = entry.value
  if (value?.kind === "resource") {
    return {
      id: `mcpr:${serverName}:${value.uri}`,
      label: entry.label,
      description,
      detail: entry.detail,
      buttons: [{
        id: "attach",
        label: "+",
        tooltip: "附加到智能助手",
        acceptInBackground: true,
        accept: async () => {
          await readAndAttachResource(serverName, value.uri, fileService, resourceMetadataForUri(resources, value.uri))
        },
      }],
      accept: async () => {
        await openMcpResourceUri(serverName, value.uri, fileService, resourceMetadataForUri(resources, value.uri))
      },
    }
  }
  if (value?.kind === "template") {
    return {
      id: `mcpr-template:${serverName}:${value.uri}`,
      label: entry.label,
      description,
      detail: entry.detail,
      accept: async () => {
        const resolvedUri = await resolveResourceTemplate(serverName, value.uri, fileService)
        if (resolvedUri) await openMcpResourceUri(serverName, resolvedUri, fileService, resourceMetadataForUri(resources, resolvedUri))
      },
    }
  }
  if (value?.kind === "directory") {
    return {
      id: `mcpr-directory:${serverName}:${value.uri}`,
      label: entry.label,
      description,
      detail: entry.detail,
      acceptInBackground: true,
      accept: () => {
        state.directoryStack.push(state.currentDirectory)
        state.currentDirectory = ensureDirectoryUri(value.uri)
      },
    }
  }
  if (value?.kind === "back") {
    return {
      id: `mcpr-back:${serverName}:${state.currentDirectory || "root"}`,
      label: entry.label,
      description,
      detail: entry.detail,
      acceptInBackground: true,
      accept: () => {
        state.currentDirectory = state.directoryStack.pop() || ""
      },
    }
  }
  return {
    id: `mcpr:${serverName}:${entry.id || entry.label}`,
    label: entry.label,
    description,
    detail: entry.detail,
    commandId: MCP_COMMAND_IDS.BrowseResources,
    args: [serverName],
  }
}

function filterQuickAccessItems(items: QuickAccessItem[], filter = ""): QuickAccessItem[] {
  const normalized = filter.trim().toLowerCase()
  if (!normalized) return items
  return items.filter((item) => {
    const haystack = `${item.label} ${item.description || ""} ${item.detail || ""} ${item.commandId || ""}`.toLowerCase()
    return haystack.includes(normalized)
  })
}

export function disposeMcpInputCommands(): void {
  for (const registration of registrations.splice(0)) registration.dispose()
  mcpResourceQuickAccessDirectoryState.clear()
}

async function browseGalleryServers(options: McpBrowseGalleryOptions = {}): Promise<void> {
  const query = options.query || ""
  const pageSize = options.pageSize || 50
  let page = 1
  let status = "available"
  let hasMore = false
  const servers: McpGalleryServer[] = []
  do {
    const gallery = await searchMcpGalleryServers(query, pageSize, page)
    status = gallery.status || status
    hasMore = gallery.hasMore
    servers.push(...gallery.servers)
    const selected = asSinglePick(await pick(buildMcpGallerySearchEntries(servers, status, hasMore), {
      title: "MCP 服务器",
      placeHolder: "选择要安装的 MCP 服务器",
      matchOnDescription: true,
      matchOnDetail: true,
    }))
    if (!selected?.value) return
    if (selected.value.kind === "more") {
      page += 1
      continue
    }

    await showMcpGalleryServerDetail(selected.value.server, options)
    return
  } while (hasMore)
}

function buildMcpGallerySearchEntries(
  servers: McpGalleryServer[],
  status: string | undefined,
  hasMore: boolean,
): QuickPickEntry<McpGalleryPickValue>[] {
  const available = status === "available"
  const entries: QuickPickEntry<McpGalleryPickValue>[] = [
    { type: "separator", label: available ? "MCP 资源库" : "MCP 资源库不可用" },
    ...servers.map((server) => ({
      id: server.name,
      label: server.displayName || server.name,
      description: server.publisher || server.version || "",
      detail: server.description || server.repositoryUrl || server.name,
      value: { kind: "server" as const, server },
      disabled: !available,
    })),
  ]
  if (hasMore) {
    entries.push({
      id: "__mcp_gallery_more__",
      label: "加载更多",
      description: `${servers.length} servers loaded`,
      value: { kind: "more" },
      disabled: !available,
    })
  }
  return entries
}

export function buildMcpGalleryDetailViewModel(
  server: McpGalleryServer,
  options: McpGalleryDetailBuildOptions,
): McpGalleryDetailViewModel {
  const installed = options.installed || null
  const actionState = options.actionState
  const serverVersion = stringValue(server.version)
  const installedVersion = stringValue(installed?.version)
  const installState = resolveGalleryInstallState(serverVersion, installedVersion, options.permission, actionState)
  const status = galleryStatusForInstallState(installState, actionState, options.permission)
  const readmeSummary = trimQuickPickDetail(options.readme || stringValue(server.readme))
  const manifestSummary = trimQuickPickDetail(galleryManifestSummary(server))
  const source = stringValue(server.repositoryUrl) || stringValue(server.readmeUrl) || stringValue(server.url) || stringValue(server.galleryUrl)
  const packageMetadata = [
    stringValue(server.packageType),
    stringValue(server.mcpTarget),
    stringValue(server.registryType),
  ].filter(Boolean).join(" / ")
  const metadata = [
    { label: "发布者", value: stringValue(server.publisher) },
    { label: "版本", value: serverVersion },
    { label: "来源", value: source },
    { label: "包类型", value: packageMetadata || stringValue(server.packageName) },
  ].filter((entry) => entry.value)
  return {
    id: galleryServerKey(server),
    title: server.displayName || server.name,
    name: server.name,
    description: stringValue(server.description),
    publisher: stringValue(server.publisher),
    source,
    version: serverVersion,
    packageMetadata,
    readmeSummary,
    manifestSummary,
    installState,
    statusLabel: status.label,
    statusDetail: status.detail,
    authSession: options.authSession,
    metadata,
    actions: buildMcpGalleryDetailActions(installState, status.detail, actionState),
  }
}

export function getMcpGalleryDetailViewState(name: string): McpGalleryDetailActionState | undefined {
  return mcpGalleryDetailActionState.get(normalizeGalleryServerName(name))
}

export function clearMcpGalleryDetailViewState(): void {
  mcpGalleryDetailActionState.clear()
  globalMcpWorkbenchService.clearState()
}

export function getMcpGalleryDetailEvidenceSummary(model: McpGalleryDetailViewModel) {
  return {
    source: "mcpGalleryDetail",
    serverName: model.name,
    title: model.title,
    installState: model.installState,
    statusLabel: model.statusLabel,
    statusDetail: model.statusDetail,
    actions: model.actions.map((action) => ({
      id: action.id,
      enabled: action.enabled,
      pending: Boolean(action.pending),
    })),
    evidence: {
      hasReadme: Boolean(model.readmeSummary),
      hasManifest: Boolean(model.manifestSummary),
      hasAuthSession: Boolean(model.authSession),
      metadataCount: model.metadata.length,
    },
    constraints: {
      goesThroughRegistryClient: true,
      preservesAgentApproval: true,
      noSecondMcpState: true,
    },
  }
}

async function showMcpGalleryServerDetail(server: McpGalleryServer, options: McpBrowseGalleryOptions): Promise<void> {
  const [permission, readme, installedSnapshot, configuredServers] = await Promise.all([
    canInstallMcpGalleryServer(server),
    getMcpGalleryReadme(server),
    Promise.resolve(getInstalledMcpGalleryServers()).catch(() => ({ servers: [] })),
    Promise.resolve(getConfiguredMcpServers()).catch(() => []),
  ])
  const installed = findInstalledMcpGalleryServer(server, installedSnapshot.servers)
  const authSession = findMcpAuthenticationSessionForGalleryServer(server, installed, configuredServers)
  const serverWithReadme = readme && !server.readme && !server.readmeUrl ? { ...server, readme } : server
  const model = buildMcpGalleryDetailViewModel(serverWithReadme, {
    readme,
    permission,
    installed,
    actionState: getMcpGalleryDetailViewState(server.name),
    authSession,
  })
  globalMcpWorkbenchService.setLatestGalleryDetail(model)
  const selected = asSinglePick(await pick(buildMcpGalleryDetailEntries(model), {
    title: server.displayName || server.name,
    placeHolder: "查看详情并选择操作",
    matchOnDescription: true,
    matchOnDetail: true,
  }))
  if (!selected?.value) return
  if (selected.value === "back") {
    await browseGalleryServers(options)
    return
  }
  if (selected.value !== "install" && selected.value !== "update" && selected.value !== "uninstall") return

  const action = model.actions.find((candidate) => candidate.id === selected.value)
  if (action && !action.enabled) {
    throw new Error(action.detail || model.statusDetail || `MCP gallery action is not available: ${selected.value}`)
  }
  if (selected.value === "install" && !permission.canInstall) {
    throw new Error(permission.reason || "MCP gallery server install is not allowed")
  }

  await runMcpGalleryDetailAction(selected.value, serverWithReadme, {
    ...options,
    serverName: typeof installed?.serverName === "string" ? installed.serverName : undefined,
    name: typeof installed?.name === "string" ? installed.name : undefined,
  })
}

function buildMcpGalleryDetailActions(
  installState: McpGalleryDetailInstallState,
  statusDetail: string,
  actionState?: McpGalleryDetailActionState,
): McpGalleryDetailViewAction[] {
  if (installState === "installed") {
    return [{ id: "uninstall", label: "卸载", enabled: true, detail: "从当前 MCP 配置中移除" }]
  }
  if (installState === "updateAvailable") {
    return [
      { id: "update", label: "更新", enabled: true, detail: "更新 Gallery metadata 并保留现有安全路径" },
      { id: "uninstall", label: "卸载", enabled: true, detail: "从当前 MCP 配置中移除" },
    ]
  }
  if (installState === "notInstallable") {
    return [{ id: "install", label: "安装", enabled: false, detail: statusDetail || "当前策略不允许安装" }]
  }
  if (installState === "pending" && actionState) {
    return [{ id: actionState.action, label: galleryActionChineseLabel(actionState.action), enabled: false, pending: true, detail: statusDetail }]
  }
  return [{ id: "install", label: "安装", enabled: true, detail: statusDetail || "通过 MCP registry client 安装" }]
}

function resolveGalleryInstallState(
  serverVersion: string,
  installedVersion: string,
  permission: Awaited<ReturnType<typeof canInstallMcpGalleryServer>>,
  actionState?: McpGalleryDetailActionState,
): McpGalleryDetailInstallState {
  if (actionState?.status === "pending") return "pending"
  if (actionState?.status === "error") return "error"
  if (installedVersion) return serverVersion && installedVersion !== serverVersion ? "updateAvailable" : "installed"
  if (!permission.canInstall) return "notInstallable"
  return "installable"
}

function galleryStatusForInstallState(
  installState: McpGalleryDetailInstallState,
  actionState: McpGalleryDetailActionState | undefined,
  permission: Awaited<ReturnType<typeof canInstallMcpGalleryServer>>,
): { label: string; detail: string } {
  if (installState === "pending") {
    return { label: `正在${galleryActionChineseLabel(actionState?.action || "install")}`, detail: "等待 MCP 资源库、智能体审批和网关安全边界返回" }
  }
  if (installState === "error") {
    return { label: "操作失败", detail: userFacingMcpStatusDetail(actionState?.message) || "MCP 资源库操作失败" }
  }
  if (installState === "installed") return { label: "已安装", detail: "已在当前 MCP 配置中可见" }
  if (installState === "updateAvailable") return { label: "可更新", detail: "Gallery metadata 版本高于已安装版本" }
  if (installState === "notInstallable") return { label: "不可安装", detail: userFacingMcpStatusDetail(permission.reason) || "当前策略不允许安装" }
  return { label: "可安装", detail: "安装将继续走 MCP 资源库客户端、安全审批和智能体证据链" }
}

function userFacingMcpStatusDetail(value: string | undefined): string {
  const detail = stringValue(value).trim()
  if (!detail) return ""
  const normalized = detail.toLowerCase()
  if (normalized.includes("agent approval denied") || normalized.includes("approval denied")) return "智能体审批已拒绝"
  if (normalized.includes("blocked by policy")) return "当前策略已阻止安装"
  if (normalized.includes("not allowed")) return "当前策略不允许安装"
  return detail
}

function galleryActionChineseLabel(action: Exclude<McpGalleryDetailAction, "back">): string {
  if (action === "update") return "更新"
  if (action === "uninstall") return "卸载"
  return "安装"
}

function mcpGalleryQuickPickActionLabel(action: Exclude<McpGalleryDetailAction, "back">): string {
  if (action === "update") return "更新"
  if (action === "uninstall") return "卸载"
  return "安装"
}

function galleryManifestSummary(server: McpGalleryServer): string {
  if (server.configuration) return JSON.stringify(server.configuration)
  const manifest = server.manifest || server.package || server.packages || server.remotes
  return manifest ? JSON.stringify(manifest) : ""
}

function findInstalledMcpGalleryServer(server: McpGalleryServer, installedServers: Array<Record<string, unknown>>): Record<string, unknown> | null {
  const name = normalizeGalleryServerName(server.name)
  const id = normalizeGalleryServerName(server.id || "")
  return installedServers.find((candidate) => {
    const candidateNames = [
      candidate.name,
      candidate.serverName,
      candidate.id,
      candidate.galleryName,
      candidate.displayName,
    ].map((value) => normalizeGalleryServerName(value))
    return candidateNames.includes(name) || Boolean(id && candidateNames.includes(id))
  }) || null
}

function findMcpAuthenticationSessionForGalleryServer(
  server: McpGalleryServer,
  installed: Record<string, unknown> | null,
  configuredServers: McpRegistryServer[],
): McpAuthenticationSessionViewModel | undefined {
  const names = [
    server.name,
    server.id,
    server.displayName,
    installed?.name,
    installed?.serverName,
    installed?.id,
    installed?.galleryName,
  ].map((value) => normalizeGalleryServerName(value)).filter(Boolean)
  const match = configuredServers.find((candidate) => {
    const candidateNames = [
      candidate.serverName,
      candidate.config?.name,
      candidate.config?.gallery,
      candidate.config?.source,
    ].map((value) => normalizeGalleryServerName(value)).filter(Boolean)
    return candidateNames.some((name) => names.includes(name))
  })
  return match?.authSession
}

function galleryServerKey(server: Pick<McpGalleryServer, "name">): string {
  return normalizeGalleryServerName(server.name)
}

function normalizeGalleryServerName(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function buildMcpGalleryDetailEntries(model: McpGalleryDetailViewModel): QuickPickEntry<McpGalleryDetailAction>[] {
  const entries: QuickPickEntry<McpGalleryDetailAction>[] = [
    {
      type: "separator",
      label: model.title,
    },
    ...model.actions.map((action) => ({
      id: `${model.name}:${action.id}`,
      label: mcpGalleryQuickPickActionLabel(action.id),
      description: action.pending ? "待处理" : model.statusLabel,
      detail: action.detail || model.statusDetail || model.description || action.label,
      value: action.id,
      disabled: !action.enabled,
    })),
    {
      id: `${model.name}:details`,
      label: "详情",
      description: model.name,
      detail: model.description || model.source || "No description available",
      disabled: true,
    },
  ]
  if (model.readmeSummary) {
    entries.push({
      id: `${model.name}:readme`,
      label: "README",
      detail: model.readmeSummary,
      disabled: true,
    })
  }
  if (model.manifestSummary) {
    entries.push({
      id: `${model.name}:configuration`,
      label: "配置",
      detail: model.manifestSummary,
      disabled: true,
    })
  }
  if (model.authSession) {
    entries.push({
      id: `${model.name}:auth-session`,
      label: "认证",
      description: model.authSession.label,
      detail: model.authSession.canPrompt ? model.authSession.promptDetail : model.authSession.detail,
      disabled: true,
    })
  }
  entries.push({
    id: `${model.name}:back`,
    label: "返回",
    value: "back",
  })
  return entries
}

export async function runMcpGalleryDetailAction(
  action: Exclude<McpGalleryDetailAction, "back">,
  server: McpGalleryServer,
  options: McpGalleryDetailActionOptions = {},
): Promise<void> {
  const key = galleryServerKey(server)
  mcpGalleryDetailActionState.set(key, { status: "pending", action })
  try {
    if (action === "install") {
      await installSelectedMcpGalleryServer(server, options)
    } else if (action === "update") {
      await updateSelectedMcpGalleryServer(server, options)
    } else if (action === "uninstall") {
      await uninstallSelectedMcpGalleryServer(server, options)
    } else {
      throw new Error(`Unsupported MCP gallery action: ${String(action)}`)
    }
    mcpGalleryDetailActionState.delete(key)
  } catch (error) {
    mcpGalleryDetailActionState.set(key, {
      status: "error",
      action,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function installSelectedMcpGalleryServer(server: McpGalleryServer, options: McpBrowseGalleryOptions): Promise<void> {
  const installResult = await installMcpGalleryServer(
    server,
    {
      profileId: options.profileId,
      packageType: options.packageType,
      mcpTarget: options.mcpTarget,
      workspace: options.workspace,
      workspaceFile: options.workspaceFile,
    },
  )
  if (!installResult.success) {
    throw new Error(installResult.error || `Failed to install MCP gallery server: ${server.name}`)
  }

  const installed = installResult.server || {}
  const inputs = Array.isArray(installed.inputs)
    ? installed.inputs.filter((input): input is McpRegistryInputMetadata => isObject(input) && typeof input.id === "string")
    : []
  if (inputs.length) {
    requestMcpInputs({
      code: "MCP_INPUT_REQUIRED",
      serverName: typeof installed.name === "string" ? installed.name : server.name,
      profileId: options.profileId,
      missingInputs: inputs,
    })
  }
}

async function updateSelectedMcpGalleryServer(server: McpGalleryServer, options: McpGalleryDetailActionOptions): Promise<void> {
  const updateResult = await updateMcpGalleryServerMetadata(
    server,
    {
      profileId: options.profileId,
      packageType: options.packageType,
      mcpTarget: options.mcpTarget,
      workspace: options.workspace,
      workspaceFile: options.workspaceFile,
      name: options.name,
      serverName: options.serverName,
    },
  )
  if (!updateResult.success) {
    throw new Error(updateResult.error || `Failed to update MCP gallery server: ${server.name}`)
  }
}

async function uninstallSelectedMcpGalleryServer(server: McpGalleryServer, options: McpGalleryDetailActionOptions): Promise<void> {
  const uninstallResult = await uninstallMcpGalleryServer(
    server,
    {
      profileId: options.profileId,
      packageType: options.packageType,
      mcpTarget: options.mcpTarget,
      workspace: options.workspace,
      workspaceFile: options.workspaceFile,
    },
  )
  if (!uninstallResult.success) {
    throw new Error(uninstallResult.error || `Failed to uninstall MCP gallery server: ${server.name}`)
  }
}

async function runServerOption(serverName: string, action?: McpServerOptionAction): Promise<void> {
  const selectedAction = action || await pickServerOption(serverName)
  switch (selectedAction) {
    case "start":
      await startMcpServer(serverName)
      break
    case "stop":
      await stopMcpServer(serverName)
      break
    case "restart":
      await restartMcpServer(serverName)
      break
    case "authorize":
      await authorizeMcpServer(serverName)
      break
    case "showOutput":
    case "resources":
      await browseMcpResources(serverName)
      break
    case undefined:
      break
    default:
      throw new Error(`Unsupported MCP server option: ${String(selectedAction)}`)
  }
}

async function browseMcpResources(serverName?: string): Promise<void> {
  const targetServer = serverName || await pickResourceServer()
  if (!targetServer) return
  const [resources, templates] = await Promise.all([
    listMcpResources(targetServer),
    listMcpResourceTemplates(targetServer),
  ])
  const directoryStack: string[] = []
  let currentDirectory = ""
  const fileService = createProviderBackedMcpResourceFileService(targetServer, resources, templates)

  while (true) {
    const entries = await buildMcpResourcePickEntries(resources, templates, currentDirectory, directoryStack.length > 0, fileService)
    const selected = asSinglePick(await pick(entries, {
      title: "MCP 资源",
      placeHolder: currentDirectory ? `选择 ${resourceBasename(currentDirectory)} 中的资源` : `选择 ${targetServer} 提供的资源`,
      matchOnDescription: true,
      matchOnDetail: true,
    }, {
      onDidTriggerItemButton: async (event) => {
        if (event.button.id === "attach" && event.item.value?.kind === "resource") {
          await readAndAttachResource(targetServer, event.item.value.uri, fileService, resourceMetadataForUri(resources, event.item.value.uri))
        }
      },
    }))
    const value = selected?.value
    if (!value) return
    if (value.kind === "back") {
      currentDirectory = directoryStack.pop() || ""
      continue
    }
    if (value.kind === "directory") {
      directoryStack.push(currentDirectory)
      currentDirectory = ensureDirectoryUri(value.uri)
      continue
    }
    if (value.kind === "resource") {
      await runResourceAction(targetServer, value.uri, fileService, resourceMetadataForUri(resources, value.uri))
      return
    }
    if (value.kind === "template") {
      const resolvedUri = await resolveResourceTemplate(targetServer, value.uri, fileService)
      if (resolvedUri) await runResourceAction(targetServer, resolvedUri, fileService, resourceMetadataForUri(resources, resolvedUri))
      return
    }
  }
}

function createProviderBackedMcpResourceFileService(
  serverName: string,
  resources: McpResourceList,
  templates: McpResourceTemplateList = [],
): McpResourceFileService {
  return createMcpResourceProviderBackedFileService(resources, {
    scheme: inferMcpResourceScheme(resources, templates),
    readResource: (uri) => readMcpResource(serverName, uri),
    subscribeResource: (uri, listener) => subscribeMcpResource(serverName, uri, () => listener()),
  })
}

function inferMcpResourceScheme(resources: McpResourceList, templates: McpResourceTemplateList): string | undefined {
  for (const uri of [
    ...resources.map((resource) => String(resource.uri || "")),
    ...templates.map((template) => String(template.uriTemplate || "")),
  ]) {
    try {
      const scheme = new URL(uri.replace(/\{[^}]*\}/g, "placeholder")).protocol.replace(/:$/g, "")
      if (scheme) return scheme
    } catch {
      // Keep looking for the next concrete URI or template with a parseable scheme.
    }
  }
  return undefined
}

function resourceMetadataForUri(resources: McpResourceList, uri: string): McpVirtualResourceMetadata {
  const resource = resources.find((entry) => String(entry.uri || "") === uri)
  return resource
    ? { name: resource.name, title: resource.title, mimeType: resource.mimeType }
    : {}
}

async function buildMcpResourcePickEntries(
  resources: McpResourceList,
  templates: Awaited<ReturnType<typeof listMcpResourceTemplates>>,
  currentDirectory = "",
  canGoBack = false,
  fileService: McpResourceFileService = createMcpResourceProviderBackedFileService(resources),
): Promise<QuickPickEntry<McpResourcePickValue>[]> {
  const entries: QuickPickEntry<McpResourcePickValue>[] = []
  const directResources = resources
    .map((resource) => ({ resource, uri: String(resource.uri || "") }))
    .filter((entry) => entry.uri && isResourceVisibleInDirectory(entry.uri, currentDirectory))
  const synthesizedDirectories = await synthesizeChildDirectories(fileService, resources, currentDirectory)
  if (directResources.length || synthesizedDirectories.length) {
    entries.push({ type: "separator", label: "资源" })
    for (const directory of synthesizedDirectories) {
      entries.push({
        id: directory.uri,
        label: directory.label,
        description: "目录",
        detail: directory.uri,
        value: { kind: "directory", uri: directory.uri },
      })
    }
    for (const { resource, uri } of directResources) {
      const directory = await isMcpDirectoryResource(fileService, uri)
      entries.push({
        id: uri,
        label: resource.title || resource.name || resourceBasename(uri),
        description: directory ? "目录" : resource.mimeType || "",
        detail: resource.description || uri,
        value: { kind: directory ? "directory" : "resource", uri },
        buttons: directory ? [] : [{ id: "attach", tooltip: "附加到智能助手" }],
      })
    }
  }
  if (!currentDirectory && templates.length) {
    entries.push({ type: "separator", label: "资源模板" })
    for (const template of templates) {
      const uri = template.uriTemplate || template.template || ""
      if (!uri) continue
      entries.push({
        id: uri,
        label: template.title || template.name || resourceBasename(uri),
        description: "模板",
        detail: template.description || uri,
        value: { kind: "template", uri },
      })
    }
  }
  if (canGoBack) {
    entries.push({ type: "separator", label: "导航" })
    entries.push({
      id: "_goback_",
      label: "返回上一级",
      value: { kind: "back" },
    })
  }
  return entries
}

async function isMcpDirectoryResource(fileService: McpResourceFileService, uri: string): Promise<boolean> {
  try {
    return isMcpResourceDirectoryStat(await fileService.stat(uri))
  } catch {
    return false
  }
}

function isResourceVisibleInDirectory(uri: string, currentDirectory: string): boolean {
  if (!currentDirectory) return true
  const prefix = ensureDirectoryUri(currentDirectory)
  if (uri === prefix || !uri.startsWith(prefix)) return false
  return !remainingResourcePath(uri, prefix).replace(/\/+$/g, "").includes("/")
}

async function synthesizeChildDirectories(
  fileService: McpResourceFileService,
  resources: Awaited<ReturnType<typeof listMcpResources>>,
  currentDirectory: string,
): Promise<Array<{ uri: string; label: string }>> {
  if (!currentDirectory) return []
  const prefix = ensureDirectoryUri(currentDirectory)
  const explicit = new Set<string>()
  for (const resource of resources) {
    const uri = String(resource.uri || "")
    if (uri && await isMcpDirectoryResource(fileService, uri)) {
      explicit.add(ensureDirectoryUri(uri))
    }
  }
  const directories = new Map<string, string>()
  for (const resource of resources) {
    const uri = String(resource.uri || "")
    if (!uri.startsWith(prefix) || uri === prefix) continue
    const remaining = remainingResourcePath(uri, prefix).replace(/^\/+/, "")
    const [segment, ...rest] = remaining.split("/").filter(Boolean)
    if (!segment || rest.length === 0) continue
    const childUri = `${prefix}${segment}/`
    if (explicit.has(childUri)) continue
    directories.set(childUri, segment)
  }
  return Array.from(directories, ([uri, label]) => ({ uri, label }))
}

function remainingResourcePath(uri: string, prefix: string): string {
  return uri.slice(prefix.length)
}

function resourceBasename(uri: string): string {
  const text = String(uri || "").replace(/[?#].*$/g, "").replace(/\/+$/g, "")
  const parts = text.split(/[\\/]/).filter(Boolean)
  return decodeURIComponent(parts[parts.length - 1] || text || "资源")
}

async function runResourceAction(
  serverName: string,
  uri: string,
  fileService: McpResourceFileService,
  metadata: McpVirtualResourceMetadata = {},
): Promise<void> {
  const action = asSinglePick(await pick<McpResourceAction>([
    { label: "打开资源", description: "作为虚拟 MCP 文本资源打开", value: "open" },
    { label: "附加到智能助手", description: "把资源内容附加到智能助手上下文", value: "attach" },
  ], {
    title: "MCP 资源",
    placeHolder: "选择资源操作",
    matchOnDescription: true,
  }))
  if (!action?.value) return
  const resource = await openMcpResourceFromFileService(serverName, uri, fileService, metadata)
  if (action.value === "attach") {
    attachMcpResourceToChat(resource)
  }
}

async function readAndAttachResource(
  serverName: string,
  uri: string,
  fileService: McpResourceFileService,
  metadata: McpVirtualResourceMetadata = {},
): Promise<void> {
  attachMcpResourceToChat(await createMcpVirtualResourceFromFileService(serverName, uri, fileService, metadata))
}

async function openMcpResourceUri(
  serverName: string,
  uri: string,
  fileService: McpResourceFileService,
  metadata: McpVirtualResourceMetadata = {},
): Promise<void> {
  await openMcpResourceFromFileService(serverName, uri, fileService, metadata)
}

async function resolveResourceTemplate(
  serverName: string,
  template: string,
  fileService = createMcpResourceProviderBackedFileService(),
): Promise<string | undefined> {
  const parsed = UriTemplate.parse(template)
  const variables = uniqueTemplateVariables(parsed.components.flatMap((component) => typeof component === "string" ? [] : component.variables))
  if (!variables.length) return verifyResolvedMcpResourceUri(template, fileService)
  const values: Record<string, string | string[]> = {}
  let needsVerification = false
  for (let index = 0; index < variables.length; index++) {
    const variable = variables[index]
    const resolved = await promptResourceTemplateValue(serverName, template, parsed, variable, values, index + 1, variables.length)
    if (resolved === undefined) return undefined
    needsVerification ||= !resolved.completed
    values[variable.name] = variable.repeatable ? resolved.value.split("/").filter(Boolean) : resolved.value
  }
  const resolvedUri = parsed.resolve(values)
  return needsVerification ? verifyResolvedMcpResourceUri(resolvedUri, fileService) : resolvedUri
}

async function verifyResolvedMcpResourceUri(uri: string, fileService: McpResourceFileService): Promise<string | undefined> {
  if (!fileService.canVerifyResource) return uri
  return await fileService.exists(uri) ? uri : undefined
}

async function promptResourceTemplateValue(
  serverName: string,
  template: string,
  parsed: UriTemplate,
  variable: IUriTemplateVariable,
  values: Record<string, string | string[]>,
  step: number,
  totalSteps: number,
): Promise<ResolvedTemplateValue | undefined> {
  const placeHolder = templatePlaceholder(parsed, variable, values)
  const context = snapshotTemplateValues(values)
  const initialCompletion = await loadTemplateCompletion(serverName, template, variable.name, "", context)
  const initialValues = normalizeTemplateCompletionValues(initialCompletion)
  if (initialValues.length || variable.optional) {
    const completions = new Map<string, Promise<McpResourceTemplateCompletionResult>>()
    completions.set("", Promise.resolve(initialCompletion))
    let latestCompleted = initialValues
    const controller = createQuickPickController<TemplateCompletionPick>(
      templateCompletionEntries(initialCompletion, initialValues, "", variable.optional),
      {
        title: "MCP 资源",
        step,
        totalSteps,
        placeHolder,
        matchOnDescription: true,
        ignoreFocusOut: true,
        value: "",
      },
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    let requestId = 0
    let completionAbortController: AbortController | undefined
    controller.onDidChangeValue((value) => {
      if (timer) clearTimeout(timer)
      completionAbortController?.abort()
      completionAbortController = typeof AbortController !== "undefined" ? new AbortController() : undefined
      const completionSignal = completionAbortController?.signal
      const currentRequest = ++requestId
      controller.setItems(templateCompletionEntries({ hasMore: false }, [], value, variable.optional))
      const updateFromCompletion = async () => {
        controller.setBusy(true)
        try {
          const completion = await getCachedTemplateCompletion(completions, serverName, template, variable.name, value, context, completionSignal)
          if (currentRequest !== requestId) return
          latestCompleted = normalizeTemplateCompletionValues(completion)
          controller.setItems(templateCompletionEntries(completion, latestCompleted, value, variable.optional))
        } finally {
          if (currentRequest === requestId) controller.setBusy(false)
        }
      }
      if (completions.has(value)) void updateFromCompletion()
      else timer = setTimeout(() => { void updateFromCompletion() }, 300)
    })
    controller.onDidHide(() => {
      requestId++
      if (timer) clearTimeout(timer)
      completionAbortController?.abort()
    })
    controller.onDidAcceptItem((event) => {
      const item = event.item
      const selected = normalizeTemplateCompletionSelection(item, latestCompleted)
      if (!selected || !variable.explodable || !selected.completed || !selected.value.endsWith("/")) return
      const currentValue = findQuickPickRequestValue(controller.id)
      if (selected.value === currentValue) return
      event.preventDefault()
      controller.setValue(selected.value)
    })
    const selected = asSinglePick(await controller.show())
    if (!selected?.value) return undefined
    const resolved = normalizeTemplateCompletionSelection(selected, latestCompleted)
    if (resolved?.value !== "__manual__") return resolved
  }
  const manual = await input({
    title: "MCP 资源",
    step,
    totalSteps,
    prompt: `填写 ${variable.name}${variable.optional ? "（可选）" : ""}`,
    placeHolder,
    ignoreFocusOut: true,
  })
  return manual === undefined ? undefined : { value: manual, completed: false }
}

function normalizeTemplateCompletionSelection(
  selected: QuickPickItem<TemplateCompletionPick>,
  completed: string[],
): ResolvedTemplateValue | { value: "__manual__"; completed: false } | undefined {
  if (typeof selected.value === "object" && selected.value && "value" in selected.value) {
    return selected.value
  }
  const value = typeof selected.value === "string" ? selected.value : selected.label
  if (!value) return undefined
  if (value === "__manual__" || value === "Enter manually") return { value: "__manual__", completed: false }
  return { value, completed: completed.includes(value) }
}

function getCachedTemplateCompletion(
  cache: Map<string, Promise<McpResourceTemplateCompletionResult>>,
  serverName: string,
  template: string,
  variable: string,
  value: string,
  context: Record<string, string | string[]>,
  signal?: AbortSignal,
): Promise<McpResourceTemplateCompletionResult> {
  let completion = cache.get(value)
  if (!completion) {
    completion = loadTemplateCompletion(serverName, template, variable, value, context, signal)
    cache.set(value, completion)
  }
  return completion.catch((error) => {
    cache.delete(value)
    throw error
  })
}

async function loadTemplateCompletion(
  serverName: string,
  template: string,
  variable: string,
  value: string,
  context: Record<string, string | string[]>,
  signal?: AbortSignal,
): Promise<McpResourceTemplateCompletionResult> {
  const request = {
    uriTemplate: template,
    variable,
    value,
    context,
  }
  const completion = signal
    ? completeMcpResourceTemplate(serverName, request, { signal })
    : completeMcpResourceTemplate(serverName, request)
  return completion.catch((error): McpResourceTemplateCompletionResult => {
    if (signal?.aborted) throw error
    return { values: [], hasMore: false }
  })
}

function templateCompletionEntries(
  completion: Pick<McpResourceTemplateCompletionResult, "hasMore" | "total">,
  completed: string[],
  inputValue: string,
  optional = false,
): QuickPickEntry<TemplateCompletionPick>[] {
  const entries: QuickPickEntry<TemplateCompletionPick>[] = []
  const trimmedInput = inputValue.trim()
  if (trimmedInput && !completed.includes(trimmedInput)) {
    entries.push({
      id: "__current_input__",
      label: trimmedInput,
      value: { value: trimmedInput, completed: false },
    })
  } else if (!trimmedInput && optional) {
    entries.push({
      id: "__empty__",
      label: "<空>",
      value: { value: "", completed: false },
    })
  }
  entries.push(...completed.map((value) => ({
    id: value,
    label: value,
    value: { value, completed: true },
  })))
  entries.push(...templateCompletionMetaEntries<TemplateCompletionPick>(completion, completed.length))
  entries.push(
    { type: "separator", label: "手动输入" },
    { id: "__manual__", label: "手动输入...", value: { value: "__manual__", completed: false } },
  )
  return entries
}

function normalizeTemplateCompletionValues(completion: Pick<McpResourceTemplateCompletionResult, "values">): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const rawValue of Array.isArray(completion.values) ? completion.values : []) {
    const value = typeof rawValue === "string" ? rawValue.trim() : ""
    if (!value || seen.has(value)) continue
    seen.add(value)
    output.push(value)
  }
  return output
}

function templateCompletionMetaEntries<TValue = string>(
  completion: Pick<McpResourceTemplateCompletionResult, "hasMore" | "total">,
  visibleCount: number,
): QuickPickEntry<TValue>[] {
  const total = typeof completion.total === "number" && Number.isFinite(completion.total) ? completion.total : undefined
  if (!completion.hasMore && (total === undefined || total <= visibleCount)) return []
  const totalLabel = total === undefined ? "更多结果" : `${total} 个结果`
  return [{
    id: "__completion_more__",
    label: `已显示 ${visibleCount} / ${totalLabel}`,
    description: "继续输入以缩小补全范围",
    disabled: true,
  } as QuickPickItem<TValue>]
}

function findQuickPickRequestValue(id: string): string {
  const request = quickInputState.queue.find((candidate) => candidate.id === id)
  return request?.value || ""
}

function snapshotTemplateValues(values: Record<string, string | string[]>): Record<string, string | string[]> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    Array.isArray(value) ? [...value] : value,
  ]))
}

function uniqueTemplateVariables(variables: IUriTemplateVariable[]): IUriTemplateVariable[] {
  const seen = new Set<string>()
  const output: IUriTemplateVariable[] = []
  for (const variable of variables) {
    if (!variable.name || seen.has(variable.name)) continue
    seen.add(variable.name)
    output.push(variable)
  }
  return output
}

function templatePlaceholder(
  template: UriTemplate,
  variable: IUriTemplateVariable,
  values: Record<string, string | string[]>,
): string {
  const placeholders: Record<string, unknown> = { ...values }
  for (const component of template.components) {
    if (typeof component === "string") continue
    for (const item of component.variables) {
      if (!Object.prototype.hasOwnProperty.call(placeholders, item.name)) {
        placeholders[item.name] = `$${item.name.toUpperCase()}`
      }
    }
  }
  return `填写 ${template.resolve(placeholders).replaceAll("%24", "$")} 中的 ${variable.name.toUpperCase()}`
}

async function pickResourceServer(): Promise<string | undefined> {
  const servers = (await getConfiguredMcpServers()).filter((server) => server.allowed !== false)
  const entries: QuickPickEntry<string>[] = servers.map((server) => ({
    id: server.serverName,
    label: server.serverName,
    description: server.initialized ? "运行中" : "已停止",
    detail: summarizeServerConfig(server),
    value: server.serverName,
  }))
  return asSinglePick(await pick(entries, {
    title: "MCP 资源",
    placeHolder: "选择 MCP 服务器",
    matchOnDescription: true,
    matchOnDetail: true,
  }))?.value
}

async function pickMcpServer(): Promise<void> {
  const snapshot = await getMcpRegistrySnapshot()
  const collectionByServer = new Map<string, string>()
  for (const collection of snapshot.collections) {
    for (const serverName of collection.serverNames || []) {
      collectionByServer.set(serverName, collection.label || collection.id)
    }
  }
  const grouped = new Map<string, McpRegistryServer[]>()
  for (const server of snapshot.servers) {
    const group = collectionByServer.get(server.serverName) || serverScopeLabel(server)
    if (!grouped.has(group)) grouped.set(group, [])
    grouped.get(group)!.push(server)
  }
  const entries: QuickPickEntry<string>[] = []
  for (const [group, servers] of grouped) {
    entries.push({ type: "separator", label: group })
    for (const server of servers.sort((left, right) => left.serverName.localeCompare(right.serverName))) {
      entries.push({
        id: server.serverName,
        label: server.serverName,
        description: server.initialized ? "运行中" : server.allowed === false ? "已禁用" : "已停止",
        detail: server.disabledReason || summarizeServerConfig(server),
        value: server.serverName,
        disabled: server.allowed === false,
      })
    }
  }
  const selected = asSinglePick(await pick(entries, {
    title: "MCP",
    placeHolder: "选择 MCP 服务器",
    matchOnDescription: true,
    matchOnDetail: true,
  }))
  if (selected?.value) await runServerOption(selected.value)
}

async function pickServerOption(serverName: string): Promise<McpServerOptionAction | undefined> {
  const server = (await getConfiguredMcpServers()).find((candidate) => candidate.serverName === serverName)
  const entries: QuickPickEntry<McpServerOptionAction>[] = [{ type: "separator", label: "状态" }]
  const authEntry = gatewayAuthorizationEntry(server)
  const reconnectEntry = remoteReconnectEntry(server)
  if (server?.allowed === false) {
    entries.push({
      label: "已禁用",
      description: "服务器被 MCP 访问设置阻止",
      detail: server.disabledReason,
      value: "showOutput",
      disabled: true,
    })
    if (authEntry) entries.push(authEntry)
    if (reconnectEntry) entries.push(reconnectEntry)
  } else if (server?.initialized) {
    entries.push(
      { label: "停止服务器", value: "stop" },
      { label: "重启服务器", value: "restart" },
    )
    if (reconnectEntry) entries.push(reconnectEntry)
  } else {
    entries.push({ label: "启动服务器", value: "start" })
    if (authEntry) entries.push(authEntry)
    if (reconnectEntry) entries.push(reconnectEntry)
  }
  entries.push(
    { label: "显示输出", value: "showOutput" },
    { type: "separator", label: "资源" },
    { label: "浏览资源", description: "资源服务可用时打开 MCP 资源浏览器", value: "resources" },
  )
  return asSinglePick(await pick(entries, {
    title: "MCP",
    placeHolder: `选择 ${serverName} 的操作`,
    matchOnDescription: true,
  }))?.value
}

async function authorizeMcpServer(serverName: string): Promise<void> {
  const server = (await getConfiguredMcpServers()).find((candidate) => candidate.serverName === serverName)
  const url = authorizationUrlForServer(server)
  if (!url) throw new Error(`MCP server '${serverName}' does not provide an authorization URL`)
  const openExternal = window.codek?.openExternal
  if (typeof openExternal !== "function") throw new Error("Open external URL bridge is not available")
  await openExternal(url)
}

function gatewayAuthorizationEntry(server?: McpRegistryServer): QuickPickEntry<McpServerOptionAction> | null {
  const url = authorizationUrlForServer(server)
  const session = server?.authSession
  if (!url && !session?.canPrompt) return null
  return {
    label: "授权网关",
    description: session?.status || "需要授权",
    detail: session?.promptDetail || url,
    value: "authorize",
    disabled: session ? !session.canPrompt : false,
  }
}

function remoteReconnectEntry(server?: McpRegistryServer): QuickPickEntry<McpServerOptionAction> | null {
  const transportState = server?.transportState
  if (!transportState || (transportState.retryMode !== "manual" && transportState.retryMode !== "failed" && transportState.retryMode !== "reconnecting")) return null
  return {
    label: transportState.retryMode === "reconnecting" ? "远程通道正在重连" : "重新连接远程通道",
    description: [
      transportState.lastEventId ? `最后事件 ${transportState.lastEventId}` : "",
      transportState.retryAfter ? `重试 ${transportState.retryAfter}` : "",
      typeof transportState.retryAttempt === "number" ? `尝试 ${transportState.retryAttempt}/${transportState.retryBudget ?? "?"}` : "",
      typeof transportState.nextRetryAt === "number" ? `下次 ${new Date(transportState.nextRetryAt).toISOString()}` : "",
    ].filter(Boolean).join("; ") || "需要用户操作",
    detail: transportState.lastError || transportState.lastBackchannelError || "MCP 远程通道需要重新连接",
    value: "restart",
    disabled: transportState.retryMode === "reconnecting",
  }
}

function authorizationUrlForServer(server?: McpRegistryServer): string {
  const config = server?.config || {}
  if (config.gateway !== true && config.authRequired !== true) return ""
  const authState = typeof config.authState === "string" ? config.authState : ""
  if (authState === "authorized") return ""
  return typeof config.authorizationUrl === "string" ? config.authorizationUrl.trim() : ""
}

function serverScopeLabel(server: McpRegistryServer): string {
  if (server.workspaceScoped) return "工作区"
  if (server.profileScoped) return "配置文件"
  if (server.installedScoped) return "已安装"
  if (server.extensionScoped) return "扩展"
  return "MCP 服务器"
}

function summarizeServerConfig(server: McpRegistryServer): string {
  const config = server.config || {}
  const command = typeof config.command === "string" ? config.command : ""
  const url = typeof config.url === "string" ? config.url : ""
  const authState = typeof config.authState === "string" ? config.authState : ""
  const authHint = typeof config.authActionHint === "string" ? config.authActionHint : ""
  const authorizationUrl = typeof config.authorizationUrl === "string" ? config.authorizationUrl : ""
  if (config.gateway === true || config.authRequired === true) {
    if (server.authSession) return `${server.authSession.label} - ${server.authSession.detail}`
    return [
      "网关",
      authState ? `OAuth: ${authState}` : "",
      authHint || authorizationUrl,
    ].filter(Boolean).join(" - ")
  }
  const transportState = server.transportState
  if (transportState?.retryMode === "manual") {
    return transportState.lastBackchannelError || "MCP 流需要手动重连"
  }
  return command || url || ""
}

function normalizeServerOptionsArgs(args: unknown[]): { serverName: string | null; action?: McpServerOptionAction } {
  const [first, second] = args
  if (isObject(first)) {
    const request = first as { serverName?: unknown; id?: unknown; action?: unknown }
    const serverName = normalizeServerName(request.serverName ?? request.id)
    const action = normalizeServerAction(request.action ?? second)
    return { serverName, action }
  }
  return {
    serverName: normalizeServerName(first),
    action: normalizeServerAction(second),
  }
}

function normalizeOpenGalleryServerArgs(args: unknown[]): { server: McpGalleryServer; options: McpBrowseGalleryOptions } {
  const [first, second] = args
  if (isObject(first) && typeof first.name === "string") {
    return { server: normalizeGalleryServer(first), options: normalizeBrowseGalleryOptions(second) }
  }
  if (typeof first === "string" && first.trim()) {
    return { server: { name: first.trim() }, options: normalizeBrowseGalleryOptions(second) }
  }
  throw new Error("MCP gallery server name is required")
}

function normalizeGalleryServer(value: Record<string, unknown>): McpGalleryServer {
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) throw new Error("MCP gallery server name is required")
  return { ...value, name } as McpGalleryServer
}

function normalizeServerAction(value: unknown): McpServerOptionAction | undefined {
  return typeof value === "string" && value ? value as McpServerOptionAction : undefined
}

function requireServerName(value: unknown): string {
  const name = normalizeServerName(value)
  if (!name) throw new Error("MCP server name is required")
  return name
}

function normalizeServerName(value: unknown): string | null {
  if (isObject(value)) {
    return normalizeServerName((value as Partial<McpRegistryServer>).serverName ?? (value as { id?: unknown }).id)
  }
  const name = typeof value === "string" ? value.trim() : ""
  return name || null
}

function registerMcpCommand(command: Pick<CommandDescriptor, "id" | "title" | "handler">): Disposable {
  return registerCommand({
    ...command,
    category: "MCP",
    source: "vscode",
  })
}

function normalizeEditStoredInputArgs(args: unknown[]): {
  input: McpRegistryInputMetadata
  value: unknown
  options: McpRegistryInputWriteOptions
} {
  const [first, second, third] = args

  if (isObject(first) && ("input" in first || "inputId" in first || "value" in first)) {
    const request = first as McpEditStoredInputRequest
    const input = normalizeInputMetadata(request.input ?? request.inputId ?? "", { password: request.password })
    if (!("value" in request)) throw new Error("MCP input value is required")
    return {
      input,
      value: request.value,
      options: { profileId: request.profileId },
    }
  }

  return {
    input: normalizeInputMetadata(first),
    value: second,
    options: normalizeOptions(third),
  }
}

function normalizeRemoveStoredInputArgs(args: unknown[]): { inputId: string | null; options: McpRegistryInputWriteOptions } {
  const [first, second, third] = args

  if (isObject(first) && ("inputId" in first || "id" in first || "profileId" in first)) {
    const request = first as { inputId?: unknown; id?: unknown; profileId?: string | null }
    return {
      inputId: normalizeInputId(request.inputId ?? request.id),
      options: { profileId: request.profileId },
    }
  }

  if (typeof second === "string") {
    return {
      inputId: normalizeInputId(second),
      options: normalizeOptions(third),
    }
  }

  return {
    inputId: normalizeInputId(first),
    options: normalizeOptions(second),
  }
}

function normalizeInputMetadata(input: unknown, fallback: Partial<McpRegistryInputMetadata> = {}): McpRegistryInputMetadata {
  if (isObject(input)) {
    const id = normalizeInputId((input as { id?: unknown }).id)
    if (!id) throw new Error("MCP input id is required")
    const metadata = input as Partial<McpRegistryInputMetadata>
    return {
      ...fallback,
      ...metadata,
      id,
    }
  }

  const id = normalizeInputId(input)
  if (!id) throw new Error("MCP input id is required")
  return {
    ...fallback,
    id,
  }
}

function normalizeInputId(value: unknown): string | null {
  const id = typeof value === "string" ? value.trim() : ""
  return id || null
}

function trimQuickPickDetail(value: string, maxLength = 320): string {
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text
}

function normalizeOptions(value: unknown): McpRegistryInputWriteOptions {
  return isObject(value) ? { profileId: (value as McpInputCommandOptions).profileId } : {}
}

function asSinglePick<TValue>(value: QuickPickItem<TValue> | QuickPickItem<TValue>[] | undefined): QuickPickItem<TValue> | undefined {
  return Array.isArray(value) ? value[0] : value
}

function normalizeBrowseGalleryOptions(value: unknown): McpBrowseGalleryOptions {
  if (!isObject(value)) return {}
  return {
    profileId: normalizeNullableString(value.profileId),
    query: normalizeNullableString(value.query) || undefined,
    pageSize: typeof value.pageSize === "number" && Number.isFinite(value.pageSize) ? value.pageSize : undefined,
    packageType: normalizeNullableString(value.packageType) || undefined,
    mcpTarget: normalizeNullableString(value.mcpTarget) || undefined,
    workspace: normalizeNullableString(value.workspace) || undefined,
    workspaceFile: normalizeNullableString(value.workspaceFile) || undefined,
  }
}

function normalizeNullableString(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : ""
  return text || null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}
