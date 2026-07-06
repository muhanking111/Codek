import { beforeEach, describe, expect, it, vi } from "vitest"
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
} from "../ai/mcpRegistryClient"
import { clearMcpInputPromptQueue, mcpInputPromptState } from "../ai/mcpInputPrompt"
import { clearCommands, executeCommand, getCommand, searchCommands } from "./commandRegistry"
import { MCP_COMMAND_IDS } from "./mcpCommandIds"
import {
  MCP_WORKBENCH_VIEW_IDS,
  IMcpWorkbenchService,
  buildMcpGalleryDetailViewModel,
  clearMcpGalleryDetailViewState,
  disposeMcpInputCommands,
  getMcpGalleryDetailEvidenceSummary,
  getMcpGalleryDetailViewState,
  getMcpWorkbenchSurfaceSnapshot,
  globalMcpWorkbenchService,
  registerMcpInputCommands,
  runMcpGalleryDetailAction,
} from "./mcpCommands"
import { acceptInputBox, acceptQuickPick, cancelQuickPick, clearQuickPicks, quickInputState, triggerQuickPickItemButton } from "./quickInput"
import { clearMcpResourceAccessState, mcpResourceAccessState } from "./mcpResourceAccess"
import { clearQuickAccessProviders, matchQuickAccessProvider } from "../vscode-adapter/platform/quickinput/common/quickAccess"
import { clearViews, getViewContainers, getViews } from "./viewRegistry"
import { MenuId, MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"

vi.mock("../ai/mcpRegistryClient", () => ({
  clearAllSavedMcpInputs: vi.fn(),
  clearSavedMcpInput: vi.fn(),
  canInstallMcpGalleryServer: vi.fn(),
  completeMcpResourceTemplate: vi.fn(),
  getConfiguredMcpServers: vi.fn(),
  getMcpGalleryReadme: vi.fn(),
  getInstalledMcpGalleryServers: vi.fn(),
  getMcpRegistrySnapshot: vi.fn(),
  getSavedMcpInputs: vi.fn(),
  installMcpGalleryServer: vi.fn(),
  listMcpResources: vi.fn(),
  listMcpResourceTemplates: vi.fn(),
  readMcpResource: vi.fn(),
  restartMcpServer: vi.fn(),
  searchMcpGalleryServers: vi.fn(),
  setSavedMcpInput: vi.fn(),
  startMcpServer: vi.fn(),
  stopMcpServer: vi.fn(),
  subscribeMcpResource: vi.fn(),
  uninstallMcpGalleryServer: vi.fn(),
  updateMcpGalleryServerMetadata: vi.fn(),
}))

describe("VS Code MCP input commands", () => {
  beforeEach(() => {
    clearCommands()
    clearViews()
    MenuRegistry.clear()
    clearQuickPicks()
    clearQuickAccessProviders()
    clearMcpInputPromptQueue()
    clearMcpResourceAccessState()
    clearMcpGalleryDetailViewState()
    vi.clearAllMocks()
    vi.mocked(subscribeMcpResource).mockResolvedValue({ dispose: vi.fn() })
    vi.mocked(getInstalledMcpGalleryServers).mockResolvedValue({ servers: [] })
    vi.mocked(getConfiguredMcpServers).mockResolvedValue([])
  })

  it("registers VS Code MCP saved input command ids in the workbench registry", () => {
    registerMcpInputCommands()

    expect(getCommand(MCP_COMMAND_IDS.EditStoredInput)).toMatchObject({
      category: "MCP",
      source: "vscode",
      title: "编辑已保存的 MCP 输入",
    })
    expect(getCommand(MCP_COMMAND_IDS.RemoveStoredInput)).toMatchObject({
      category: "MCP",
      source: "vscode",
      title: "删除已保存的 MCP 输入",
    })
    expect(getCommand(MCP_COMMAND_IDS.ListServer)).toMatchObject({
      category: "MCP",
      source: "vscode",
      title: "MCP: 列出服务器",
    })
    expect(getCommand(MCP_COMMAND_IDS.ServerOptions)).toMatchObject({
      category: "MCP",
      source: "vscode",
      title: "MCP: 服务器选项",
    })
    expect(getCommand(MCP_COMMAND_IDS.OpenGalleryServer)).toMatchObject({
      category: "MCP",
      source: "vscode",
      title: "MCP: 打开资源库服务器",
    })
    expect(getViewContainers("activityBar").map((container) => container.id)).toContain(MCP_WORKBENCH_VIEW_IDS.Container)
    expect(getViews(MCP_WORKBENCH_VIEW_IDS.Container).map((view) => view.id)).toEqual([
      MCP_WORKBENCH_VIEW_IDS.Servers,
      MCP_WORKBENCH_VIEW_IDS.Resources,
      MCP_WORKBENCH_VIEW_IDS.Gallery,
    ])
    expect(MenuRegistry.getMenuEntries(MenuId.ViewTitle, { view: MCP_WORKBENCH_VIEW_IDS.Resources }).map((entry) => entry.type === "item" ? entry.commandId : entry.id)).toContain(MCP_COMMAND_IDS.BrowseResources)
    expect(MenuRegistry.getMenuEntries(MenuId.CommandPalette).map((entry) => entry.type === "item" ? entry.commandId : entry.id)).toContain(MCP_COMMAND_IDS.OpenGalleryServer)
    expect(searchCommands("MCP").map((command) => command.id)).toContain(MCP_COMMAND_IDS.EditStoredInput)
  })

  it("registers a VS Code-style MCP quick access provider without a custom MCP dialog", async () => {
    registerMcpInputCommands()

    const match = matchQuickAccessProvider("mcp:resources")
    expect(match).toMatchObject({
      filter: "resources",
      descriptor: { prefix: "mcp:" },
    })

    const items = await Promise.resolve(match?.descriptor.provider.provide(match.filter))
    expect(items).toEqual([{
      id: "mcp.resources",
      label: "浏览 MCP 资源",
      description: "MCP",
      commandId: MCP_COMMAND_IDS.BrowseResources,
    }])
  })

  it("resolves MCP workbench service through DI and projects the same resource/gallery surface", () => {
    const model = buildMcpGalleryDetailViewModel({
      name: "io.modelcontextprotocol.filesystem",
      displayName: "Filesystem MCP",
      description: "Filesystem tools",
      publisher: "MCP",
      version: "2.0.0",
      repositoryUrl: "https://github.com/modelcontextprotocol/servers",
      packageType: "npm",
      configuration: { command: "npx" },
    }, {
      readme: "# Filesystem",
      permission: { canInstall: true, reason: "" },
      installed: null,
    })
    mcpResourceAccessState.openedResources.push({
      id: "mcp-resource:server:mcp://server/readme",
      serverName: "server",
      uri: "mcp://server/readme",
      path: "/MCP Resources/server/readme",
      name: "readme",
      mimeType: "text/plain",
      content: "hello",
      openedAt: 123,
    })
    const collection = new ServiceCollection([IMcpWorkbenchService, globalMcpWorkbenchService])
    const singleton = getSingletonServiceDescriptors().find(([id]) => id === IMcpWorkbenchService)
    const resolved = collection.get(IMcpWorkbenchService)

    globalMcpWorkbenchService.setLatestGalleryDetail(model)
    const snapshot = getMcpWorkbenchSurfaceSnapshot()

    expect(String(IMcpWorkbenchService)).toBe("mcpWorkbenchService")
    expect(singleton?.[1]).toBe(globalMcpWorkbenchService)
    expect(resolved).toBe(globalMcpWorkbenchService)
    expect(snapshot).toMatchObject({
      source: "mcpWorkbenchService",
      serviceId: "mcpWorkbenchService",
      containerId: MCP_WORKBENCH_VIEW_IDS.Container,
      viewIds: [
        MCP_WORKBENCH_VIEW_IDS.Servers,
        MCP_WORKBENCH_VIEW_IDS.Resources,
        MCP_WORKBENCH_VIEW_IDS.Gallery,
      ],
      commandIds: expect.arrayContaining([
        MCP_COMMAND_IDS.BrowseResources,
        MCP_COMMAND_IDS.OpenGalleryServer,
        MCP_COMMAND_IDS.Browse,
      ]),
      quickAccessPrefixes: ["mcp:", "mcpr "],
      stateSource: "service",
      latestGalleryDetail: expect.objectContaining({
        source: "mcpGalleryDetail",
        serverName: "io.modelcontextprotocol.filesystem",
        installState: "installable",
      }),
      resourceAccess: expect.objectContaining({
        source: "mcpResourceAccess",
        openedCount: 1,
        readonlyProviderPath: true,
      }),
      constraints: {
        providerBackedFileService: true,
        preservesAgentApproval: true,
        noSecondMcpState: true,
        viewActionMenuDriven: true,
      },
    })
  })

  it("exposes MCP commands, QuickAccess providers, and Gallery actions from one workbench service contract", async () => {
    const server = { name: "io.modelcontextprotocol.filesystem", version: "2.0.0" }
    vi.mocked(installMcpGalleryServer).mockResolvedValue({ success: true, server })
    vi.mocked(getConfiguredMcpServers).mockResolvedValue([
      { serverName: "profileServer", initialized: true, allowed: true, config: { command: "node" } },
    ])
    vi.mocked(listMcpResources).mockResolvedValue([
      { uri: "file:///workspace/readme.md", name: "readme.md", title: "README", mimeType: "text/markdown" },
    ])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([])

    const commandSurface = globalMcpWorkbenchService.getCommandContributions()
    const quickAccessSurface = globalMcpWorkbenchService.getQuickAccessContributions()
    const galleryActions = globalMcpWorkbenchService.getGalleryActions(server)

    expect(commandSurface.map((command) => command.id)).toEqual(expect.arrayContaining([
      MCP_COMMAND_IDS.Browse,
      MCP_COMMAND_IDS.OpenGalleryServer,
      MCP_COMMAND_IDS.BrowseResources,
      MCP_COMMAND_IDS.StartServer,
      MCP_COMMAND_IDS.GetSavedInputs,
    ]))
    expect(commandSurface.find((command) => command.id === MCP_COMMAND_IDS.BrowseResources)).toMatchObject({
      source: "vscode",
      category: "MCP",
      title: "MCP: 浏览资源",
    })
    expect(quickAccessSurface.map((provider) => provider.prefix)).toEqual(["mcp:", "mcpr "])
    await expect(Promise.resolve(quickAccessSurface[0].provider.provide("resources"))).resolves.toEqual([{
      id: "mcp.resources",
      label: "浏览 MCP 资源",
      description: "MCP",
      commandId: MCP_COMMAND_IDS.BrowseResources,
    }])
    await expect(quickAccessSurface[1].provider.provide("readme")).resolves.toEqual([
      expect.objectContaining({
        id: "mcpr:profileServer:file:///workspace/readme.md",
        label: "README",
        description: "profileServer - text/markdown",
        detail: "file:///workspace/readme.md",
        buttons: [expect.objectContaining({ id: "attach", acceptInBackground: true })],
      }),
    ])

    expect(galleryActions.map((action) => action.id)).toEqual(["install", "update", "uninstall"])
    await galleryActions.find((action) => action.id === "install")?.run({ profileId: "work", workspace: "D:/Project" })
    expect(installMcpGalleryServer).toHaveBeenCalledWith(server, {
      profileId: "work",
      packageType: undefined,
      mcpTarget: undefined,
      workspace: "D:/Project",
      workspaceFile: undefined,
    })

    registerMcpInputCommands()
    expect(getCommand(MCP_COMMAND_IDS.BrowseResources)).toMatchObject({
      source: "vscode",
      category: "MCP",
      title: "MCP: 浏览资源",
    })
    expect(matchQuickAccessProvider("mcp:resources")?.descriptor.provider).toBe(quickAccessSurface[0].provider)
  })

  it("registers VS Code mcpr quick access for MCP resources and opens accepted resources", async () => {
    vi.mocked(getConfiguredMcpServers).mockResolvedValue([
      { serverName: "profileServer", initialized: true, allowed: true, config: { command: "node" } },
    ])
    vi.mocked(listMcpResources).mockResolvedValue([
      { uri: "file:///workspace/readme.md", name: "readme.md", title: "README", mimeType: "text/markdown" },
      { uri: "file:///workspace/logs/", name: "logs", title: "logs", mimeType: "inode/directory" },
    ])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace/{path}", name: "workspace-file" },
    ])
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/readme.md", text: "# README" }] })
    registerMcpInputCommands()

    const match = matchQuickAccessProvider("mcpr readme")
    expect(match).toMatchObject({
      filter: "readme",
      descriptor: { prefix: "mcpr " },
    })

    const items = await Promise.resolve(match?.descriptor.provider.provide(match.filter))
    expect(items).toHaveLength(1)
    expect(items?.[0]).toMatchObject({
      id: "mcpr:profileServer:file:///workspace/readme.md",
      label: "README",
      description: "profileServer - text/markdown",
      buttons: [expect.objectContaining({ id: "attach", tooltip: "附加到智能助手" })],
    })

    await items?.[0].accept?.()

    expect(listMcpResources).toHaveBeenCalledWith("profileServer")
    expect(listMcpResourceTemplates).toHaveBeenCalledWith("profileServer")
    expect(readMcpResource).toHaveBeenCalledWith("profileServer", "file:///workspace/readme.md")
    expect(mcpResourceAccessState.openedResources[0]).toMatchObject({
      serverName: "profileServer",
      uri: "file:///workspace/readme.md",
      content: "# README",
    })
  })

  it("attaches mcpr quick access resources through VS Code-style item buttons", async () => {
    vi.mocked(getConfiguredMcpServers).mockResolvedValue([
      { serverName: "profileServer", initialized: true, allowed: true, config: { command: "node" } },
    ])
    vi.mocked(listMcpResources).mockResolvedValue([
      { uri: "file:///workspace/readme.md", name: "readme.md", title: "README", mimeType: "text/markdown" },
    ])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([])
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/readme.md", text: "# README" }] })
    registerMcpInputCommands()

    const items = await Promise.resolve(matchQuickAccessProvider("mcpr readme")?.descriptor.provider.provide("readme"))
    await items?.[0].buttons?.[0].accept?.()

    expect(readMcpResource).toHaveBeenCalledWith("profileServer", "file:///workspace/readme.md")
    expect(mcpResourceAccessState.openedResources).toHaveLength(0)
    expect(mcpResourceAccessState.chatAttachments[0]).toMatchObject({
      id: "mcp-attachment:profileServer:file:///workspace/readme.md",
      content: "# README",
      kind: "text",
      status: "ready",
    })
  })

  it("navigates mcpr directory entries in place like VS Code QuickAccess", async () => {
    vi.mocked(getConfiguredMcpServers).mockResolvedValue([
      { serverName: "profileServer", initialized: true, allowed: true, config: { command: "node" } },
    ])
    vi.mocked(listMcpResources).mockResolvedValue([
      { uri: "file:///workspace/logs/", name: "logs", title: "logs", mimeType: "inode/directory" },
      { uri: "file:///workspace/logs/app.log", name: "app.log", title: "app.log", mimeType: "text/plain" },
    ])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([])
    registerMcpInputCommands()

    const items = await Promise.resolve(matchQuickAccessProvider("mcpr logs")?.descriptor.provider.provide("logs"))

    expect(items?.[0]).toMatchObject({
      id: "mcpr-directory:profileServer:file:///workspace/logs/",
      label: "logs",
      acceptInBackground: true,
    })

    await items?.[0].accept?.()
    const nested = await Promise.resolve(matchQuickAccessProvider("mcpr logs")?.descriptor.provider.provide("logs"))

    expect(nested?.map((item) => item.label)).toEqual(["app.log", "返回上一级"])
    expect(nested?.find((item) => item.label === "app.log")).toMatchObject({
      id: "mcpr:profileServer:file:///workspace/logs/app.log",
      description: "profileServer - text/plain",
    })
    expect(nested?.find((item) => item.label === "返回上一级")).toMatchObject({
      id: "mcpr-back:profileServer:file:///workspace/logs/",
      acceptInBackground: true,
    })

    await nested?.find((item) => item.label === "返回上一级")?.accept?.()
    const root = await Promise.resolve(matchQuickAccessProvider("mcpr logs")?.descriptor.provider.provide("logs"))

    expect(root?.[0]).toMatchObject({
      id: "mcpr-directory:profileServer:file:///workspace/logs/",
      label: "logs",
    })
  })

  it("disposes the MCP quick access provider with the MCP command registrations", () => {
    const registration = registerMcpInputCommands()

    expect(matchQuickAccessProvider("mcp:resources")).toBeDefined()
    expect(matchQuickAccessProvider("mcpr resources")).toBeDefined()
    registration.dispose()

    expect(matchQuickAccessProvider("mcp:resources")).toBeUndefined()
    expect(matchQuickAccessProvider("mcpr resources")).toBeUndefined()
    expect(MenuRegistry.getMenuEntries(MenuId.ViewTitle, { view: MCP_WORKBENCH_VIEW_IDS.Resources }).map((entry) => entry.type === "item" ? entry.commandId : entry.id)).not.toContain(MCP_COMMAND_IDS.BrowseResources)
  })

  it("maps VS Code MCP list and installed commands to shared registry clients", async () => {
    vi.mocked(getMcpRegistrySnapshot).mockResolvedValue({ collections: [], servers: [], delegates: [] })
    vi.mocked(getConfiguredMcpServers).mockResolvedValue([])
    registerMcpInputCommands()

    const listPromise = executeCommand(MCP_COMMAND_IDS.ListServer)
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    cancelQuickPick(quickInputState.queue[0].id)
    await listPromise
    await executeCommand(MCP_COMMAND_IDS.ShowInstalled)

    expect(getMcpRegistrySnapshot).toHaveBeenCalledTimes(1)
    expect(getConfiguredMcpServers).toHaveBeenCalledTimes(1)
  })

  it("browses MCP gallery servers through a VS Code-style detail action before installing", async () => {
    vi.mocked(searchMcpGalleryServers)
      .mockResolvedValueOnce({
        status: "available",
        hasMore: true,
        page: 1,
        servers: [{
          name: "io.modelcontextprotocol.memory",
          displayName: "Memory MCP",
          description: "Memory tools",
        }],
      })
      .mockResolvedValueOnce({
      status: "available",
      hasMore: false,
      page: 2,
      servers: [{
        name: "io.modelcontextprotocol.filesystem",
        displayName: "Filesystem MCP",
        description: "Filesystem tools",
        configuration: { command: "npx" },
      }],
    })
    vi.mocked(canInstallMcpGalleryServer).mockResolvedValue({ canInstall: true, reason: "" })
    vi.mocked(getMcpGalleryReadme).mockResolvedValue("# Filesystem")
    vi.mocked(installMcpGalleryServer).mockResolvedValue({
      success: true,
      server: {
        name: "io.modelcontextprotocol.filesystem",
        inputs: [{ id: "root", description: "Root path" }],
      },
    })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.Browse, [{ query: "file", profileId: "work", workspace: "D:/Project" }])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].items.map((item) => item.label)).toEqual([
      "MCP 资源库",
      "Memory MCP",
      "加载更多",
    ])
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "加载更多",
      value: { kind: "more" },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].items.map((item) => item.label)).toEqual([
      "MCP 资源库",
      "Memory MCP",
      "Filesystem MCP",
    ])
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "Filesystem MCP",
      value: {
        kind: "server",
        server: {
          name: "io.modelcontextprotocol.filesystem",
          displayName: "Filesystem MCP",
          description: "Filesystem tools",
          configuration: { command: "npx" },
        },
      },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(installMcpGalleryServer).not.toHaveBeenCalled()
    expect(quickInputState.queue[0].options).toMatchObject({
      title: "Filesystem MCP",
      placeHolder: "查看详情并选择操作",
    })
    expect(quickInputState.queue[0].items.map((item) => item.label)).toEqual([
      "Filesystem MCP",
      "安装",
      "详情",
      "README",
      "配置",
      "返回",
    ])
    expect(quickInputState.queue[0].items[3]).toMatchObject({
      label: "README",
      detail: "# Filesystem",
      disabled: true,
    })
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "安装",
      value: "install",
    })
    await browsePromise

    expect(searchMcpGalleryServers).toHaveBeenNthCalledWith(1, "file", 50, 1)
    expect(searchMcpGalleryServers).toHaveBeenNthCalledWith(2, "file", 50, 2)
    expect(canInstallMcpGalleryServer).toHaveBeenCalledWith({
      name: "io.modelcontextprotocol.filesystem",
      displayName: "Filesystem MCP",
      description: "Filesystem tools",
      configuration: { command: "npx" },
    })
    expect(getMcpGalleryReadme).toHaveBeenCalledWith({
      name: "io.modelcontextprotocol.filesystem",
      displayName: "Filesystem MCP",
      description: "Filesystem tools",
      configuration: { command: "npx" },
    })
    expect(installMcpGalleryServer).toHaveBeenCalledWith({
      name: "io.modelcontextprotocol.filesystem",
      displayName: "Filesystem MCP",
      description: "Filesystem tools",
      configuration: { command: "npx" },
      readme: "# Filesystem",
    }, {
      profileId: "work",
      packageType: undefined,
      mcpTarget: undefined,
      workspace: "D:/Project",
      workspaceFile: undefined,
    })
    expect(mcpInputPromptState.queue[0]).toMatchObject({
      serverName: "io.modelcontextprotocol.filesystem",
      profileId: "work",
      inputs: [{ id: "root", description: "Root path" }],
    })
  })

  it("builds a VS Code-style MCP Gallery detail editor model with metadata, manifest, and action states", () => {
    const server = {
      name: "io.modelcontextprotocol.filesystem",
      displayName: "Filesystem MCP",
      description: "Filesystem tools",
      publisher: "MCP",
      version: "2.0.0",
      repositoryUrl: "https://github.com/modelcontextprotocol/servers",
      packageType: "npm",
      configuration: { command: "npx", args: ["@modelcontextprotocol/server-filesystem"] },
    }

    const installable = buildMcpGalleryDetailViewModel(server, {
      readme: "# Filesystem\n\nRead local files.",
      permission: { canInstall: true, reason: "" },
      installed: null,
    })
    expect(installable).toMatchObject({
      id: "io.modelcontextprotocol.filesystem",
      title: "Filesystem MCP",
      name: "io.modelcontextprotocol.filesystem",
      description: "Filesystem tools",
      publisher: "MCP",
      source: "https://github.com/modelcontextprotocol/servers",
      version: "2.0.0",
      installState: "installable",
      statusLabel: "可安装",
      readmeSummary: "# Filesystem Read local files.",
      manifestSummary: "{\"command\":\"npx\",\"args\":[\"@modelcontextprotocol/server-filesystem\"]}",
      actions: [expect.objectContaining({ id: "install", label: "安装", enabled: true })],
    })
    expect(installable.metadata).toEqual(expect.arrayContaining([
      { label: "发布者", value: "MCP" },
      { label: "版本", value: "2.0.0" },
      { label: "来源", value: "https://github.com/modelcontextprotocol/servers" },
      { label: "包类型", value: "npm" },
    ]))

    expect(buildMcpGalleryDetailViewModel(server, {
      readme: "",
      permission: { canInstall: false, reason: "blocked by policy" },
      installed: null,
    })).toMatchObject({
      installState: "notInstallable",
      statusLabel: "不可安装",
      statusDetail: "当前策略已阻止安装",
      actions: [expect.objectContaining({ id: "install", enabled: false })],
    })

    expect(buildMcpGalleryDetailViewModel(server, {
      readme: "",
      permission: { canInstall: true, reason: "" },
      installed: { name: "io.modelcontextprotocol.filesystem", version: "1.0.0" },
    })).toMatchObject({
      installState: "updateAvailable",
      statusLabel: "可更新",
      actions: [
        expect.objectContaining({ id: "update", label: "更新", enabled: true }),
        expect.objectContaining({ id: "uninstall", label: "卸载", enabled: true }),
      ],
    })

    expect(buildMcpGalleryDetailViewModel(server, {
      readme: "",
      permission: { canInstall: true, reason: "" },
      installed: { name: "io.modelcontextprotocol.filesystem", version: "2.0.0" },
      actionState: { status: "pending", action: "uninstall" },
    })).toMatchObject({
      installState: "pending",
      statusLabel: "正在卸载",
      actions: [expect.objectContaining({ id: "uninstall", enabled: false, pending: true })],
    })

    expect(buildMcpGalleryDetailViewModel(server, {
      readme: "",
      permission: { canInstall: true, reason: "" },
      installed: null,
      actionState: { status: "error", action: "install", message: "approval denied" },
    })).toMatchObject({
      installState: "error",
      statusLabel: "操作失败",
      statusDetail: "智能体审批已拒绝",
    })

    expect(buildMcpGalleryDetailViewModel(server, {
      readme: "",
      permission: { canInstall: true, reason: "" },
      installed: null,
      authSession: {
        status: "expired",
        label: "Authentication expired",
        detail: "The OAuth session expired or refresh failed.",
        promptLabel: "Authorize Gateway",
        promptDetail: "Sign in to Gateway - https://gateway.example.test/oauth/authorize",
        canPrompt: true,
        authorizationUrl: "https://gateway.example.test/oauth/authorize",
      },
    })).toMatchObject({
      authSession: expect.objectContaining({
        status: "expired",
        canPrompt: true,
        promptDetail: "Sign in to Gateway - https://gateway.example.test/oauth/authorize",
      }),
    })
  })

  it("summarizes MCP Gallery detail evidence without introducing a second install state", () => {
    const model = buildMcpGalleryDetailViewModel({
      name: "io.modelcontextprotocol.filesystem",
      displayName: "Filesystem MCP",
      description: "Filesystem tools",
      publisher: "MCP",
      version: "2.0.0",
      repositoryUrl: "https://github.com/modelcontextprotocol/servers",
      packageType: "npm",
      configuration: { command: "npx" },
    }, {
      readme: "# Filesystem",
      permission: { canInstall: false, reason: "blocked by policy" },
      installed: null,
      actionState: { status: "error", action: "install", message: "Agent approval denied" },
    })

    expect(getMcpGalleryDetailEvidenceSummary(model)).toEqual({
      source: "mcpGalleryDetail",
      serverName: "io.modelcontextprotocol.filesystem",
      title: "Filesystem MCP",
      installState: "error",
      statusLabel: "操作失败",
      statusDetail: "智能体审批已拒绝",
      actions: [{ id: "install", enabled: true, pending: false }],
      evidence: {
        hasReadme: true,
        hasManifest: true,
        hasAuthSession: false,
        metadataCount: 4,
      },
      constraints: {
        goesThroughRegistryClient: true,
        preservesAgentApproval: true,
        noSecondMcpState: true,
      },
    })
  })

  it("runs MCP Gallery install, update, and uninstall through one registry-backed detail action path", async () => {
    const server = { name: "io.modelcontextprotocol.filesystem", version: "2.0.0" }
    vi.mocked(installMcpGalleryServer).mockResolvedValueOnce({ success: true, server: { name: server.name } })
    vi.mocked(updateMcpGalleryServerMetadata).mockResolvedValueOnce({ success: true, server: { name: server.name, version: "2.0.0" } })
    vi.mocked(uninstallMcpGalleryServer).mockResolvedValueOnce({ success: true })

    await runMcpGalleryDetailAction("install", server, { profileId: "work", workspace: "D:/Project" })
    await runMcpGalleryDetailAction("update", server, { profileId: "work", serverName: "local.filesystem" })
    await runMcpGalleryDetailAction("uninstall", server, { profileId: "work" })

    expect(installMcpGalleryServer).toHaveBeenCalledWith(server, {
      profileId: "work",
      packageType: undefined,
      mcpTarget: undefined,
      workspace: "D:/Project",
      workspaceFile: undefined,
    })
    expect(updateMcpGalleryServerMetadata).toHaveBeenCalledWith(server, {
      profileId: "work",
      packageType: undefined,
      mcpTarget: undefined,
      workspace: undefined,
      workspaceFile: undefined,
      serverName: "local.filesystem",
    })
    expect(uninstallMcpGalleryServer).toHaveBeenCalledWith(server, {
      profileId: "work",
      packageType: undefined,
      mcpTarget: undefined,
      workspace: undefined,
      workspaceFile: undefined,
    })
    expect(getMcpGalleryDetailViewState(server.name)).toBeUndefined()
  })

  it("keeps MCP Gallery detail action pending and error state observable without bypassing registry approval", async () => {
    let rejectInstall!: (error: Error) => void
    vi.mocked(installMcpGalleryServer).mockReturnValueOnce(new Promise((_, reject) => {
      rejectInstall = reject
    }))

    const installPromise = runMcpGalleryDetailAction("install", { name: "slow.server" }, { profileId: "work" })
    expect(getMcpGalleryDetailViewState("slow.server")).toEqual({ status: "pending", action: "install" })

    rejectInstall(new Error("Agent approval denied"))
    await expect(installPromise).rejects.toThrow("Agent approval denied")
    expect(getMcpGalleryDetailViewState("slow.server")).toEqual({
      status: "error",
      action: "install",
      message: "Agent approval denied",
    })
  })

  it("rejects MCP gallery installs blocked by access settings", async () => {
    vi.mocked(searchMcpGalleryServers).mockResolvedValue({
      status: "available",
      hasMore: false,
      servers: [{ name: "blocked.server" }],
    })
    vi.mocked(canInstallMcpGalleryServer).mockResolvedValue({ canInstall: false, reason: "blocked by settings" })
    vi.mocked(getMcpGalleryReadme).mockResolvedValue("Blocked README")
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.Browse)
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "blocked.server",
      value: { kind: "server", server: { name: "blocked.server" } },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].items.find((item) => item.label === "安装")).toMatchObject({
      disabled: true,
      detail: "blocked by settings",
    })
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "安装",
      value: "install",
    })

    await expect(browsePromise).rejects.toThrow(/blocked by settings/)
    expect(getMcpGalleryReadme).toHaveBeenCalledWith({ name: "blocked.server" })
    expect(installMcpGalleryServer).not.toHaveBeenCalled()
  })

  it("shows MCP Gallery OAuth session prompt metadata from the shared server command surface", async () => {
    vi.mocked(canInstallMcpGalleryServer).mockResolvedValue({ canInstall: true, reason: "" })
    vi.mocked(getMcpGalleryReadme).mockResolvedValue("Gateway README")
    vi.mocked(getInstalledMcpGalleryServers).mockResolvedValue({
      servers: [{ name: "gateway.server", serverName: "gateway.server" }],
    })
    vi.mocked(getConfiguredMcpServers).mockResolvedValue([{
      serverName: "gateway.server",
      initialized: false,
      allowed: false,
      config: { gallery: "gateway.server", gateway: true },
      authSession: {
        status: "expired",
        label: "Authentication expired",
        detail: "The OAuth session expired or refresh failed.",
        promptLabel: "Authorize Gateway",
        promptDetail: "Sign in to Gateway - https://gateway.example.test/oauth/authorize",
        canPrompt: true,
        authorizationUrl: "https://gateway.example.test/oauth/authorize",
      },
    }])
    registerMcpInputCommands()

    const openPromise = executeCommand(MCP_COMMAND_IDS.OpenGalleryServer, [{ name: "gateway.server", displayName: "Gateway Server" }])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))

    expect(quickInputState.queue[0].items.find((item) => item.label === "认证")).toMatchObject({
      description: "Authentication expired",
      detail: "Sign in to Gateway - https://gateway.example.test/oauth/authorize",
      disabled: true,
    })
    cancelQuickPick(quickInputState.queue[0].id)
    await openPromise
  })

  it("maps VS Code MCP server lifecycle commands to registry actions", async () => {
    vi.mocked(startMcpServer).mockResolvedValue({ success: true })
    vi.mocked(stopMcpServer).mockResolvedValue({ success: true })
    vi.mocked(restartMcpServer).mockResolvedValue({ success: true })
    registerMcpInputCommands()

    await executeCommand(MCP_COMMAND_IDS.StartServer, ["profileServer"])
    await executeCommand(MCP_COMMAND_IDS.StopServer, [{ serverName: "profileServer" }])
    await executeCommand(MCP_COMMAND_IDS.RestartServer, ["profileServer"])
    await executeCommand(MCP_COMMAND_IDS.ServerOptions, ["profileServer", "start"])
    await executeCommand(MCP_COMMAND_IDS.ServerOptions, [{ serverName: "profileServer", action: "restart" }])

    expect(startMcpServer).toHaveBeenCalledWith("profileServer")
    expect(stopMcpServer).toHaveBeenCalledWith("profileServer")
    expect(restartMcpServer).toHaveBeenCalledWith("profileServer")
    expect(startMcpServer).toHaveBeenCalledTimes(2)
    expect(restartMcpServer).toHaveBeenCalledTimes(2)
  })

  it("uses the VS Code-style quick pick adapter for ListServer and ServerOptions", async () => {
    vi.mocked(getMcpRegistrySnapshot).mockResolvedValue({
      collections: [{ id: "profile", label: "Profile MCP", serverNames: ["profileServer"] }],
      servers: [{ serverName: "profileServer", initialized: false, allowed: true, config: { command: "node" } }],
      delegates: [],
    })
    vi.mocked(getConfiguredMcpServers).mockResolvedValue([
      { serverName: "profileServer", initialized: false, allowed: true, config: { command: "node" } },
    ])
    vi.mocked(startMcpServer).mockResolvedValue({ success: true })
    registerMcpInputCommands()

    const listPromise = executeCommand(MCP_COMMAND_IDS.ListServer)
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].items.map((item) => item.label)).toEqual(["Profile MCP", "profileServer"])
    acceptQuickPick(quickInputState.queue[0].id, { label: "profileServer", value: "profileServer" })

    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].options.placeHolder).toBe("选择 profileServer 的操作")
    acceptQuickPick(quickInputState.queue[0].id, { label: "启动服务器", value: "start" })
    await listPromise

    expect(startMcpServer).toHaveBeenCalledWith("profileServer")
  })

  it("shows Gateway OAuth and manual reconnect state without offering a fake ready action", async () => {
    vi.mocked(getMcpRegistrySnapshot).mockResolvedValue({
      collections: [{ id: "profile", label: "Profile MCP", serverNames: ["gatewayRemote", "manualReconnect"] }],
      servers: [
        {
          serverName: "gatewayRemote",
          initialized: false,
          allowed: false,
          disabledReason: "MCP Gateway server requires OAuth authorization before it can start.",
          config: {
            gateway: true,
            authRequired: true,
            authState: "expired",
            authorizationUrl: "https://gateway.example.test/oauth/authorize",
            authActionHint: "Sign in to Gateway",
          },
          authSession: {
            status: "expired",
            label: "Authentication expired",
            detail: "The OAuth session expired or refresh failed.",
            promptLabel: "Authorize Gateway",
            promptDetail: "Sign in to Gateway - https://gateway.example.test/oauth/authorize",
            canPrompt: true,
            authorizationUrl: "https://gateway.example.test/oauth/authorize",
          },
        },
        {
          serverName: "manualReconnect",
          initialized: true,
          allowed: true,
          config: { url: "https://gateway.example.test/mcp" },
          transportState: {
            retryMode: "manual",
            retryAttempt: 2,
            retryBudget: 3,
            lastError: "MCP backchannel unavailable: 404 Not Found",
            nextRetryAt: Date.UTC(2026, 0, 1, 0, 0, 0),
            lastEventId: "42",
            retryAfter: "1500",
            lastBackchannelError: "MCP backchannel unavailable: 404 Not Found",
          },
        },
      ],
      delegates: [],
    })
    vi.mocked(getConfiguredMcpServers).mockResolvedValue([
      {
        serverName: "gatewayRemote",
        initialized: false,
        allowed: false,
        disabledReason: "MCP Gateway server requires OAuth authorization before it can start.",
        config: {
          gateway: true,
          authRequired: true,
          authState: "expired",
          authorizationUrl: "https://gateway.example.test/oauth/authorize",
          authActionHint: "Sign in to Gateway",
        },
        authSession: {
          status: "expired",
          label: "Authentication expired",
          detail: "The OAuth session expired or refresh failed.",
          promptLabel: "Authorize Gateway",
          promptDetail: "Sign in to Gateway - https://gateway.example.test/oauth/authorize",
          canPrompt: true,
          authorizationUrl: "https://gateway.example.test/oauth/authorize",
        },
      },
      {
        serverName: "manualReconnect",
        initialized: true,
        allowed: true,
        config: { url: "https://gateway.example.test/mcp" },
        transportState: {
          retryMode: "manual",
          retryAttempt: 2,
          retryBudget: 3,
          lastError: "MCP backchannel unavailable: 404 Not Found",
          nextRetryAt: Date.UTC(2026, 0, 1, 0, 0, 0),
          lastEventId: "42",
          retryAfter: "1500",
          lastBackchannelError: "MCP backchannel unavailable: 404 Not Found",
        },
      },
    ])
    window.codek = { openExternal: vi.fn() } as unknown as CodekAPI
    registerMcpInputCommands()

    const listPromise = executeCommand(MCP_COMMAND_IDS.ListServer)
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    const gatewayItem = quickInputState.queue[0].items.find((item) => item.label === "gatewayRemote")
    const reconnectItem = quickInputState.queue[0].items.find((item) => item.label === "manualReconnect")

    expect(gatewayItem).toMatchObject({
      disabled: true,
      description: "已禁用",
      detail: "MCP Gateway server requires OAuth authorization before it can start.",
    })
    expect(reconnectItem).toMatchObject({
      description: "运行中",
      detail: "MCP backchannel unavailable: 404 Not Found",
    })
    cancelQuickPick(quickInputState.queue[0].id)
    await listPromise

    const optionsPromise = executeCommand(MCP_COMMAND_IDS.ServerOptions, ["gatewayRemote"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].items.find((item) => item.label === "已禁用")).toMatchObject({
      disabled: true,
      detail: "MCP Gateway server requires OAuth authorization before it can start.",
    })
    expect(quickInputState.queue[0].items.find((item) => item.label === "授权网关")).toMatchObject({
      description: "expired",
      detail: "Sign in to Gateway - https://gateway.example.test/oauth/authorize",
      value: "authorize",
      disabled: false,
    })
    cancelQuickPick(quickInputState.queue[0].id)
    await optionsPromise

    const authorizePromise = executeCommand(MCP_COMMAND_IDS.ServerOptions, ["gatewayRemote"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, { label: "授权网关", value: "authorize" })
    await authorizePromise

    expect(window.codek?.openExternal).toHaveBeenCalledWith("https://gateway.example.test/oauth/authorize")
    expect(startMcpServer).not.toHaveBeenCalled()

    const reconnectPromise = executeCommand(MCP_COMMAND_IDS.ServerOptions, ["manualReconnect"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].items.find((item) => item.label === "重新连接远程通道")).toMatchObject({
      description: "最后事件 42; 重试 1500; 尝试 2/3; 下次 2026-01-01T00:00:00.000Z",
      detail: "MCP backchannel unavailable: 404 Not Found",
      value: "restart",
    })
    acceptQuickPick(quickInputState.queue[0].id, { label: "重新连接远程通道", value: "restart" })
    await reconnectPromise

    expect(restartMcpServer).toHaveBeenCalledWith("manualReconnect")
  })

  it("shows OAuth authentication session view model states through server options", async () => {
    const states = ["missing", "pending", "authorized", "expired", "revoked", "error"] as const
    vi.mocked(getConfiguredMcpServers).mockResolvedValue(states.map((status) => ({
      serverName: `gateway-${status}`,
      initialized: status === "authorized",
      allowed: status === "authorized",
      disabledReason: status === "authorized" ? "" : "MCP Gateway server requires OAuth authorization before it can start.",
      config: {
        gateway: true,
        authRequired: true,
        authorizationUrl: `https://gateway.example.test/oauth/${status}`,
      },
      authSession: {
        status,
        label: status === "authorized" ? "Authorized" : `Authentication ${status}`,
        detail: status === "authorized" ? "Signed in as octo." : `OAuth state ${status}`,
        promptLabel: "Authorize Gateway",
        promptDetail: `Authorize ${status} - https://gateway.example.test/oauth/${status}`,
        canPrompt: status !== "authorized",
        authorizationUrl: `https://gateway.example.test/oauth/${status}`,
      },
    })))
    window.codek = { openExternal: vi.fn() } as unknown as CodekAPI
    registerMcpInputCommands()

    const pendingPromise = executeCommand(MCP_COMMAND_IDS.ServerOptions, ["gateway-pending"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].items.find((item) => item.label === "已禁用")).toMatchObject({
      detail: "MCP Gateway server requires OAuth authorization before it can start.",
    })
    expect(quickInputState.queue[0].items.find((item) => item.label === "授权网关")).toMatchObject({
      description: "pending",
      detail: "Authorize pending - https://gateway.example.test/oauth/pending",
      disabled: false,
    })
    cancelQuickPick(quickInputState.queue[0].id)
    await pendingPromise

    const authorizedPromise = executeCommand(MCP_COMMAND_IDS.ServerOptions, ["gateway-authorized"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].items.find((item) => item.label === "授权网关")).toBeUndefined()
    cancelQuickPick(quickInputState.queue[0].id)
    await authorizedPromise

    const revokedPromise = executeCommand(MCP_COMMAND_IDS.ServerOptions, ["gateway-revoked"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, { label: "授权网关", value: "authorize" })
    await revokedPromise
    expect(window.codek?.openExternal).toHaveBeenCalledWith("https://gateway.example.test/oauth/revoked")
  })

  it("browses MCP resources through quick pick and opens selected resources", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([
      { uri: "file:///workspace/readme.md", name: "readme.md", title: "README", mimeType: "text/markdown" },
    ])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace/{path}", name: "workspace-file" },
    ])
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/readme.md", text: "# README" }] })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].items.map((item) => item.label)).toEqual([
      "资源",
      "README",
      "资源模板",
      "workspace-file",
    ])
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "README",
      value: { kind: "resource", uri: "file:///workspace/readme.md" },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].items.map((item) => item.label)).toEqual([
      "打开资源",
      "附加到智能助手",
    ])
    acceptQuickPick(quickInputState.queue[0].id, { label: "打开资源", value: "open" })
    await browsePromise

    expect(listMcpResources).toHaveBeenCalledWith("profileServer")
    expect(listMcpResourceTemplates).toHaveBeenCalledWith("profileServer")
    expect(readMcpResource).toHaveBeenCalledWith("profileServer", "file:///workspace/readme.md")
    expect(mcpResourceAccessState.openedResources[0]).toMatchObject({
      serverName: "profileServer",
      uri: "file:///workspace/readme.md",
      content: "# README",
    })
  })

  it("can attach selected MCP resources to chat context after reading them", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([
      { uri: "file:///workspace/readme.md", name: "readme.md", title: "README", mimeType: "text/markdown" },
    ])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([])
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/readme.md", text: "# README" }] })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "README",
      value: { kind: "resource", uri: "file:///workspace/readme.md" },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, { label: "附加到智能助手", value: "attach" })
    await browsePromise

    expect(mcpResourceAccessState.chatAttachments[0]).toMatchObject({
      id: "mcp-attachment:profileServer:file:///workspace/readme.md",
      name: "readme.md",
      kind: "text",
      status: "ready",
      content: "# README",
    })
  })

  it("attaches MCP resources through VS Code-style item button events", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([
      { uri: "file:///workspace/readme.md", name: "readme.md", title: "README", mimeType: "text/markdown" },
    ])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([])
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/readme.md", text: "# README" }] })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    const resourceItem = quickInputState.queue[0].items.find((item) => item.type !== "separator" && item.label === "README")
    expect(resourceItem && "buttons" in resourceItem ? resourceItem.buttons?.[0] : undefined).toEqual({ id: "attach", tooltip: "附加到智能助手" })

    triggerQuickPickItemButton(quickInputState.queue[0].id, resourceItem as any, { id: "attach", tooltip: "附加到智能助手" })
    await vi.waitFor(() => expect(mcpResourceAccessState.chatAttachments).toHaveLength(1))
    cancelQuickPick(quickInputState.queue[0].id)
    await browsePromise

    expect(readMcpResource).toHaveBeenCalledWith("profileServer", "file:///workspace/readme.md")
    expect(mcpResourceAccessState.chatAttachments[0]).toMatchObject({
      content: "# README",
      kind: "text",
      status: "ready",
    })
  })

  it("resolves MCP resource template variables through shared input box before reading", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace/{path}", name: "workspace-file" },
    ])
    vi.mocked(completeMcpResourceTemplate).mockResolvedValue({ values: [] })
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/src%2Fmain.ts", text: "main" }] })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "workspace-file",
      value: { kind: "template", uri: "file:///workspace/{path}" },
    })
    await vi.waitFor(() => expect(quickInputState.inputQueue).toHaveLength(1))
    expect(quickInputState.inputQueue[0].options.prompt).toBe("填写 path")
    acceptInputBox(quickInputState.inputQueue[0].id, "src/main.ts")
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, { label: "打开资源", value: "open" })
    await browsePromise

    expect(readMcpResource).toHaveBeenCalledWith("profileServer", "file:///workspace/src%2Fmain.ts")
    expect(completeMcpResourceTemplate).toHaveBeenCalledWith("profileServer", {
      uriTemplate: "file:///workspace/{path}",
      variable: "path",
      value: "",
      context: {},
    })
    expect(mcpResourceAccessState.openedResources[0]).toMatchObject({
      uri: "file:///workspace/src%2Fmain.ts",
      content: "main",
    })
  })

  it("uses MCP resource template completion candidates before reading", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace/{path}", name: "workspace-file" },
    ])
    vi.mocked(completeMcpResourceTemplate).mockResolvedValue({ values: ["src/main.ts", "src/App.vue"], total: 2 })
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/src%2Fmain.ts", text: "main" }] })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "workspace-file",
      value: { kind: "template", uri: "file:///workspace/{path}" },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].items.map((item) => item.label)).toEqual([
      "src/main.ts",
      "src/App.vue",
      "手动输入",
      "手动输入...",
    ])
    acceptQuickPick(quickInputState.queue[0].id, { label: "src/main.ts", value: "src/main.ts" })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, { label: "打开资源", value: "open" })
    await browsePromise

    expect(quickInputState.inputQueue).toHaveLength(0)
    expect(readMcpResource).toHaveBeenCalledWith("profileServer", "file:///workspace/src%2Fmain.ts")
    expect(mcpResourceAccessState.openedResources[0]).toMatchObject({
      uri: "file:///workspace/src%2Fmain.ts",
      content: "main",
    })
  })

  it("normalizes MCP resource template completions and surfaces truncated result state", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace/{path}", name: "workspace-file" },
    ])
    vi.mocked(completeMcpResourceTemplate).mockResolvedValue({
      values: ["src/main.ts", "", "src/main.ts", "src/App.vue"],
      total: 5,
      hasMore: true,
    })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "workspace-file",
      value: { kind: "template", uri: "file:///workspace/{path}" },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))

    expect(quickInputState.queue[0].items.map((item) => item.label)).toEqual([
      "src/main.ts",
      "src/App.vue",
      "已显示 2 / 5 个结果",
      "手动输入",
      "手动输入...",
    ])
    cancelQuickPick(quickInputState.queue[0].id)
    await browsePromise

    expect(readMcpResource).not.toHaveBeenCalled()
  })

  it("cancels MCP resource template completion picks without reading a resource", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace/{path}", name: "workspace-file" },
    ])
    vi.mocked(completeMcpResourceTemplate).mockResolvedValue({ values: ["src/main.ts"] })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "workspace-file",
      value: { kind: "template", uri: "file:///workspace/{path}" },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    cancelQuickPick(quickInputState.queue[0].id)
    await browsePromise

    expect(readMcpResource).not.toHaveBeenCalled()
    expect(mcpResourceAccessState.openedResources).toEqual([])
    expect(mcpResourceAccessState.chatAttachments).toEqual([])
  })

  it("refreshes MCP resource template completions when the quick pick input changes", async () => {
    vi.useFakeTimers()
    vi.mocked(listMcpResources).mockResolvedValue([])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace/{path}", name: "workspace-file" },
    ])
    vi.mocked(completeMcpResourceTemplate).mockImplementation(async (_serverName, request) => ({
      values: request.value === "src/" ? ["src/main.ts"] : ["README.md"],
    }))
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/src%2Fmain.ts", text: "main" }] })
    registerMcpInputCommands()

    try {
      const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
      await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
      acceptQuickPick(quickInputState.queue[0].id, {
        label: "workspace-file",
        value: { kind: "template", uri: "file:///workspace/{path}" },
      })
      await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
      quickInputState.queue[0].changeValue?.("src/")
      await vi.advanceTimersByTimeAsync(300)
      await vi.waitFor(() => expect(quickInputState.queue[0].items.map((item) => item.label)).toContain("src/main.ts"))
      acceptQuickPick(quickInputState.queue[0].id, { label: "src/main.ts", value: "src/main.ts" })
      await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
      acceptQuickPick(quickInputState.queue[0].id, { label: "打开资源", value: "open" })
      await browsePromise
    } finally {
      vi.useRealTimers()
    }

    expect(completeMcpResourceTemplate).toHaveBeenLastCalledWith("profileServer", {
      uriTemplate: "file:///workspace/{path}",
      variable: "path",
      value: "src/",
      context: {},
    }, { signal: expect.any(AbortSignal) })
    expect(readMcpResource).toHaveBeenCalledWith("profileServer", "file:///workspace/src%2Fmain.ts")
  })

  it("reuses cached MCP resource template completions for repeated quick pick input values", async () => {
    vi.useFakeTimers()
    vi.mocked(listMcpResources).mockResolvedValue([])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace/{path}", name: "workspace-file" },
    ])
    vi.mocked(completeMcpResourceTemplate).mockImplementation(async (_serverName, request) => ({
      values: request.value === "src/" ? ["src/main.ts"] : ["README.md"],
    }))
    registerMcpInputCommands()

    try {
      const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
      await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
      acceptQuickPick(quickInputState.queue[0].id, {
        label: "workspace-file",
        value: { kind: "template", uri: "file:///workspace/{path}" },
      })
      await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
      quickInputState.queue[0].changeValue?.("src/")
      await vi.advanceTimersByTimeAsync(300)
      await vi.waitFor(() => expect(quickInputState.queue[0].items.map((item) => item.label)).toContain("src/main.ts"))
      quickInputState.queue[0].changeValue?.("other/")
      await vi.advanceTimersByTimeAsync(300)
      await vi.waitFor(() => expect(quickInputState.queue[0].items.map((item) => item.label)).not.toContain("src/main.ts"))
      quickInputState.queue[0].changeValue?.("src/")
      await vi.waitFor(() => expect(quickInputState.queue[0].items.map((item) => item.label)).toContain("src/main.ts"))
      cancelQuickPick(quickInputState.queue[0].id)
      await browsePromise
    } finally {
      vi.useRealTimers()
    }

    expect(vi.mocked(completeMcpResourceTemplate).mock.calls.filter(([, request]) => request.value === "src/")).toHaveLength(1)
  })

  it("aborts stale MCP resource template completion requests when the quick pick input changes again", async () => {
    vi.useFakeTimers()
    vi.mocked(listMcpResources).mockResolvedValue([])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace/{path}", name: "workspace-file" },
    ])
    const abortedValues: string[] = []
    vi.mocked(completeMcpResourceTemplate).mockImplementation(async (_serverName, request, options) => {
      if (request.value === "") return { values: ["README.md"] }
      return new Promise((resolve) => {
        options?.signal?.addEventListener("abort", () => {
          abortedValues.push(request.value || "")
        }, { once: true })
        setTimeout(() => {
          resolve({ values: request.value === "src/" ? ["src/stale.ts"] : ["app/current.ts"] })
        }, request.value === "src/" ? 100 : 10)
      })
    })
    registerMcpInputCommands()

    try {
      const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
      await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
      acceptQuickPick(quickInputState.queue[0].id, {
        label: "workspace-file",
        value: { kind: "template", uri: "file:///workspace/{path}" },
      })
      await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
      quickInputState.queue[0].changeValue?.("src/")
      await vi.advanceTimersByTimeAsync(300)
      quickInputState.queue[0].changeValue?.("app/")
      await vi.advanceTimersByTimeAsync(300)
      await vi.advanceTimersByTimeAsync(100)
      await vi.waitFor(() => {
        const labels = quickInputState.queue[0].items.map((item) => item.label)
        expect(labels).toContain("app/current.ts")
        expect(labels).not.toContain("src/stale.ts")
      })
      cancelQuickPick(quickInputState.queue[0].id)
      await browsePromise
    } finally {
      vi.useRealTimers()
    }

    expect(abortedValues).toContain("src/")
  })

  it("uses the typed quick pick value as manual MCP template input when it is accepted directly", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([
      { uri: "file:///workspace/custom.md", name: "custom.md", mimeType: "text/markdown" },
    ])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace/{path}", name: "workspace-file" },
    ])
    vi.mocked(completeMcpResourceTemplate).mockResolvedValue({ values: ["README.md"] })
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/custom.md", text: "custom" }] })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "workspace-file",
      value: { kind: "template", uri: "file:///workspace/{path}" },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    quickInputState.queue[0].changeValue?.("custom.md")
    acceptQuickPick(quickInputState.queue[0].id, { label: "custom.md", value: "custom.md" })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, { label: "打开资源", value: "open" })
    await browsePromise

    expect(readMcpResource).toHaveBeenCalledWith("profileServer", "file:///workspace/custom.md")
    expect(mcpResourceAccessState.openedResources[0]).toMatchObject({
      uri: "file:///workspace/custom.md",
      content: "custom",
    })
  })

  it("keeps picking inside exploded MCP template path subdirectories when a directory completion is accepted", async () => {
    vi.useFakeTimers()
    vi.mocked(listMcpResources).mockResolvedValue([])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace{/path*}", name: "workspace-path" },
    ])
    vi.mocked(completeMcpResourceTemplate).mockImplementation(async (_serverName, request) => ({
      values: request.value === "src/" ? ["src/main.ts"] : ["src/"],
    }))
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/src/main.ts", text: "main" }] })
    registerMcpInputCommands()

    try {
      const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
      await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
      acceptQuickPick(quickInputState.queue[0].id, {
        label: "workspace-path",
        value: { kind: "template", uri: "file:///workspace{/path*}" },
      })
      await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
      const promptId = quickInputState.queue[0].id
      acceptQuickPick(promptId, { label: "src/", value: { value: "src/", completed: true } })
      expect(quickInputState.queue[0]?.id).toBe(promptId)
      expect(readMcpResource).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(300)
      await vi.waitFor(() => expect(quickInputState.queue[0].items.map((item) => item.label)).toContain("src/main.ts"))
      acceptQuickPick(promptId, { label: "src/main.ts", value: { value: "src/main.ts", completed: true } })
      await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
      acceptQuickPick(quickInputState.queue[0].id, { label: "打开资源", value: "open" })
      await browsePromise
    } finally {
      vi.useRealTimers()
    }

    expect(completeMcpResourceTemplate).toHaveBeenCalledWith("profileServer", {
      uriTemplate: "file:///workspace{/path*}",
      variable: "path",
      value: "src/",
      context: {},
    }, { signal: expect.any(AbortSignal) })
    expect(readMcpResource).toHaveBeenCalledWith("profileServer", "file:///workspace/src/main.ts")
  })

  it("falls back to manual input when requested from MCP resource template completions", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace/{path}", name: "workspace-file" },
    ])
    vi.mocked(completeMcpResourceTemplate).mockResolvedValue({ values: ["src/main.ts"] })
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/README.md", text: "readme" }] })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "workspace-file",
      value: { kind: "template", uri: "file:///workspace/{path}" },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, { label: "手动输入...", value: "__manual__" })
    await vi.waitFor(() => expect(quickInputState.inputQueue).toHaveLength(1))
    expect(quickInputState.inputQueue[0].options.prompt).toBe("填写 path")
    acceptInputBox(quickInputState.inputQueue[0].id, "README.md")
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, { label: "打开资源", value: "open" })
    await browsePromise

    expect(readMcpResource).toHaveBeenCalledWith("profileServer", "file:///workspace/README.md")
    expect(mcpResourceAccessState.openedResources[0]).toMatchObject({
      uri: "file:///workspace/README.md",
      content: "readme",
    })
  })

  it("offers VS Code-style <Empty> for optional MCP resource template variables", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([
      { uri: "file:///workspace/", name: "workspace", mimeType: "inode/directory" },
    ])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace/{path?}", name: "optional-workspace-path" },
    ])
    vi.mocked(completeMcpResourceTemplate).mockResolvedValue({ values: [] })
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/", text: "workspace root" }] })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "optional-workspace-path",
      value: { kind: "template", uri: "file:///workspace/{path?}" },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].items.map((item) => item.label)).toEqual([
      "<空>",
      "手动输入",
      "手动输入...",
    ])
    acceptQuickPick(quickInputState.queue[0].id, { label: "<空>", value: { value: "", completed: false } })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, { label: "打开资源", value: "open" })
    await browsePromise

    expect(quickInputState.inputQueue).toHaveLength(0)
    expect(readMcpResource).toHaveBeenCalledWith("profileServer", "file:///workspace/")
    expect(mcpResourceAccessState.openedResources[0]).toMatchObject({
      uri: "file:///workspace/",
      content: "workspace root",
    })
  })

  it("resolves VS Code MCP URI template path and query operators", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace{/path*}{?q}", name: "query-file" },
    ])
    vi.mocked(completeMcpResourceTemplate).mockResolvedValue({ values: [] })
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/src/main.ts?q=todo", text: "todo" }] })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "query-file",
      value: { kind: "template", uri: "file:///workspace{/path*}{?q}" },
    })
    await vi.waitFor(() => expect(quickInputState.inputQueue).toHaveLength(1))
    acceptInputBox(quickInputState.inputQueue[0].id, "src/main.ts")
    await vi.waitFor(() => expect(quickInputState.inputQueue).toHaveLength(1))
    acceptInputBox(quickInputState.inputQueue[0].id, "todo")
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, { label: "打开资源", value: "open" })
    await browsePromise

    expect(readMcpResource).toHaveBeenCalledWith("profileServer", "file:///workspace/src/main.ts?q=todo")
    expect(mcpResourceAccessState.openedResources[0]).toMatchObject({
      uri: "file:///workspace/src/main.ts?q=todo",
      content: "todo",
    })
  })

  it("passes VS Code-style step counts through multi-variable MCP resource templates", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace/{folder}/{file}", name: "two-step-file" },
    ])
    vi.mocked(completeMcpResourceTemplate)
      .mockResolvedValueOnce({ values: ["src"] })
      .mockResolvedValueOnce({ values: ["main.ts"] })
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/src/main.ts", text: "main" }] })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "two-step-file",
      value: { kind: "template", uri: "file:///workspace/{folder}/{file}" },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].options.step).toBe(1)
    expect(quickInputState.queue[0].options.totalSteps).toBe(2)
    acceptQuickPick(quickInputState.queue[0].id, { label: "src", value: "src" })

    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].options.step).toBe(2)
    expect(quickInputState.queue[0].options.totalSteps).toBe(2)
    acceptQuickPick(quickInputState.queue[0].id, { label: "main.ts", value: "main.ts" })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, { label: "打开资源", value: "open" })
    await browsePromise

    expect(readMcpResource).toHaveBeenCalledWith("profileServer", "file:///workspace/src/main.ts")
  })

  it("trusts server-provided MCP resource template completions even when the local resource index is incomplete", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([
      { uri: "file:///workspace/README.md", name: "README.md", mimeType: "text/markdown" },
    ])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace/{path}", name: "workspace-file" },
    ])
    vi.mocked(completeMcpResourceTemplate).mockResolvedValue({ values: ["missing.md"] })
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/missing.md", text: "missing" }] })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "workspace-file",
      value: { kind: "template", uri: "file:///workspace/{path}" },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, { label: "missing.md", value: "missing.md" })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, { label: "打开资源", value: "open" })
    await browsePromise

    expect(readMcpResource).toHaveBeenCalledWith("profileServer", "file:///workspace/missing.md")
    expect(mcpResourceAccessState.openedResources[0]).toMatchObject({
      uri: "file:///workspace/missing.md",
      content: "missing",
    })
  })

  it("verifies manually entered MCP resource template values through the VS Code-style file service index", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([
      { uri: "file:///workspace/README.md", name: "README.md", mimeType: "text/markdown" },
    ])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([
      { uriTemplate: "file:///workspace/{path}", name: "workspace-file" },
    ])
    vi.mocked(completeMcpResourceTemplate).mockResolvedValue({ values: [] })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "workspace-file",
      value: { kind: "template", uri: "file:///workspace/{path}" },
    })
    await vi.waitFor(() => expect(quickInputState.inputQueue).toHaveLength(1))
    acceptInputBox(quickInputState.inputQueue[0].id, "missing.md")
    await browsePromise

    expect(readMcpResource).not.toHaveBeenCalled()
    expect(mcpResourceAccessState.openedResources).toEqual([])
  })

  it("navigates MCP directory resources before opening a child resource", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([
      { uri: "file:///workspace/logs/", name: "logs", title: "logs", mimeType: "inode/directory" },
      { uri: "file:///workspace/logs/app.log", name: "app.log", title: "app.log", mimeType: "text/plain" },
    ])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([])
    vi.mocked(readMcpResource).mockResolvedValue({ contents: [{ uri: "file:///workspace/logs/app.log", text: "log line" }] })
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "logs",
      value: { kind: "directory", uri: "file:///workspace/logs/" },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].items.map((item) => item.label)).toEqual([
      "资源",
      "app.log",
      "导航",
      "返回上一级",
    ])
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "app.log",
      value: { kind: "resource", uri: "file:///workspace/logs/app.log" },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, { label: "打开资源", value: "open" })
    await browsePromise

    expect(readMcpResource).toHaveBeenCalledWith("profileServer", "file:///workspace/logs/app.log")
    expect(mcpResourceAccessState.openedResources[0]).toMatchObject({
      uri: "file:///workspace/logs/app.log",
      content: "log line",
    })
  })

  it("supports VS Code-style Go Back navigation in MCP resource picks", async () => {
    vi.mocked(listMcpResources).mockResolvedValue([
      { uri: "file:///workspace/logs/", name: "logs", title: "logs", mimeType: "inode/directory" },
      { uri: "file:///workspace/logs/app.log", name: "app.log", title: "app.log", mimeType: "text/plain" },
    ])
    vi.mocked(listMcpResourceTemplates).mockResolvedValue([])
    registerMcpInputCommands()

    const browsePromise = executeCommand(MCP_COMMAND_IDS.BrowseResources, ["profileServer"])
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, {
      label: "logs",
      value: { kind: "directory", uri: "file:///workspace/logs/" },
    })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    acceptQuickPick(quickInputState.queue[0].id, { label: "返回上一级", value: { kind: "back" } })
    await vi.waitFor(() => expect(quickInputState.queue).toHaveLength(1))
    expect(quickInputState.queue[0].items.map((item) => item.label)).toContain("logs")
    cancelQuickPick(quickInputState.queue[0].id)
    await browsePromise

    expect(readMcpResource).not.toHaveBeenCalled()
  })

  it("keeps unsupported MCP quick actions explicit until VS Code QuickInput is fully adapted", async () => {
    registerMcpInputCommands()

    await expect(executeCommand(MCP_COMMAND_IDS.ServerOptions, ["profileServer", "delete"])).rejects.toThrow(
      /Unsupported MCP server option/,
    )
  })

  it("writes a plain saved input through the shared MCP registry client", async () => {
    vi.mocked(setSavedMcpInput).mockResolvedValue({})
    registerMcpInputCommands()

    await expect(executeCommand(MCP_COMMAND_IDS.EditStoredInput, [
      { input: { id: "root" }, value: "D:/work", profileId: "p1" },
    ])).resolves.toBe(true)

    expect(setSavedMcpInput).toHaveBeenCalledWith({ id: "root" }, "D:/work", { profileId: "p1" })
  })

  it("preserves secret metadata when editing a saved input", async () => {
    vi.mocked(setSavedMcpInput).mockResolvedValue({})
    registerMcpInputCommands()

    await executeCommand(MCP_COMMAND_IDS.EditStoredInput, [
      { id: "API_TOKEN", password: true },
      "secret",
      { profileId: "p1" },
    ])

    expect(setSavedMcpInput).toHaveBeenCalledWith({ id: "API_TOKEN", password: true }, "secret", { profileId: "p1" })
  })

  it("clears one saved input or all saved inputs with VS Code RemoveStoredInput semantics", async () => {
    vi.mocked(clearSavedMcpInput).mockResolvedValue(undefined)
    vi.mocked(clearAllSavedMcpInputs).mockResolvedValue(undefined)
    registerMcpInputCommands()

    await executeCommand(MCP_COMMAND_IDS.RemoveStoredInput, ["API_TOKEN", { profileId: "p1" }])
    await executeCommand(MCP_COMMAND_IDS.RemoveStoredInput, [{ profileId: "p1" }])

    expect(clearSavedMcpInput).toHaveBeenCalledWith("API_TOKEN", { profileId: "p1" })
    expect(clearAllSavedMcpInputs).toHaveBeenCalledWith({ profileId: "p1" })
  })

  it("keeps registrations disposable so tests and hot reload do not stack duplicate handlers", async () => {
    vi.mocked(getSavedMcpInputs).mockResolvedValue({})
    const registration = registerMcpInputCommands()

    await expect(executeCommand(MCP_COMMAND_IDS.GetSavedInputs, ["p1"])).resolves.toBe(true)
    registration.dispose()
    await expect(executeCommand(MCP_COMMAND_IDS.GetSavedInputs, ["p1"])).resolves.toBe(false)

    expect(getSavedMcpInputs).toHaveBeenCalledWith("p1")
    disposeMcpInputCommands()
  })
})
