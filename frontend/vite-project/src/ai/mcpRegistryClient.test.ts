import { beforeEach, describe, expect, it, vi } from "vitest"
import { api } from "../lib/api"
import {
  clearAllSavedMcpInputs,
  clearSavedMcpInput,
  canInstallMcpGalleryServer,
  completeMcpResourceTemplate,
  getConfiguredMcpServers,
  getMcpGalleryReadme,
  getMcpGalleryServers,
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
  setSavedMcpInputs,
  startMcpServer,
  stopMcpServer,
  subscribeMcpResource,
  uninstallMcpGalleryServer,
  updateMcpGalleryServerMetadata,
} from "./mcpRegistryClient"

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    request: vi.fn(),
  },
}))

describe("mcpRegistryClient", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete window.codek
  })

  it("reads saved MCP inputs with VS Code profile scope query", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ inputs: { root: { value: "D:/work" } } })

    await expect(getSavedMcpInputs("profile a")).resolves.toEqual({ root: { value: "D:/work" } })

    expect(api.get).toHaveBeenCalledWith("/extensions-host/mcp-registry/inputs?profileId=profile%20a")
  })

  it("reads VS Code-style MCP registry snapshots for Workbench commands", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      collections: [{ id: "profile", serverNames: ["profileServer"] }],
      servers: [{
        serverName: "profileServer",
        initialized: false,
        allowed: false,
        disabledReason: "OAuth authorization required",
        config: {
          gateway: true,
          authRequired: true,
          authState: "unauthorized",
          authorizationUrl: "https://gateway.example.test/oauth/authorize",
          authActionHint: "Sign in to Gateway",
        },
        transportState: {
          retryMode: "manual",
          retryAttempt: 2,
          retryBudget: 3,
          lastError: "MCP backchannel unavailable: 404 Not Found",
          nextRetryAt: 123456,
          lastEventId: "42",
          retryAfter: "1500",
          lastBackchannelError: "MCP backchannel unavailable: 404 Not Found",
        },
      }],
      delegates: [{ priority: 10 }],
    })

    await expect(getMcpRegistrySnapshot()).resolves.toEqual({
      collections: [{ id: "profile", serverNames: ["profileServer"] }],
      servers: [{
        serverName: "profileServer",
        initialized: false,
        allowed: false,
        disabledReason: "OAuth authorization required",
        config: {
          gateway: true,
          authRequired: true,
          authState: "unauthorized",
          authorizationUrl: "https://gateway.example.test/oauth/authorize",
        authActionHint: "Sign in to Gateway",
        },
        authSession: {
          status: "missing",
          label: "Missing authentication session",
          detail: "No OAuth session is available for this MCP server.",
          promptLabel: "Authorize Gateway",
          promptDetail: "Sign in to Gateway - https://gateway.example.test/oauth/authorize",
          canPrompt: true,
          authorizationUrl: "https://gateway.example.test/oauth/authorize",
        },
        transportState: {
          retryMode: "manual",
          retryAttempt: 2,
          retryBudget: 3,
          lastError: "MCP backchannel unavailable: 404 Not Found",
          nextRetryAt: 123456,
          lastEventId: "42",
          retryAfter: "1500",
          lastBackchannelError: "MCP backchannel unavailable: 404 Not Found",
        },
      }],
      delegates: [{ priority: 10 }],
    })

    expect(api.get).toHaveBeenCalledWith("/extensions-host/mcp-registry")
  })

  it("normalizes VS Code-style MCP OAuth authentication session states", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      servers: [
        { serverName: "missing", config: { gateway: true, authRequired: true, authState: "unauthorized", authorizationUrl: "https://auth/missing" } },
        { serverName: "pending", config: { gateway: true, authSession: { status: "pending" }, authorizationUrl: "https://auth/pending" } },
        { serverName: "authorized", config: { gateway: true, authSession: { status: "authorized", providerId: "github", sessionId: "s1", accountLabel: "octo" } } },
        { serverName: "expired", config: { gateway: true, authState: "refresh_failed", authorizationUrl: "https://auth/expired" } },
        { serverName: "revoked", config: { gateway: true, authSession: { status: "revoked" }, authorizationUrl: "https://auth/revoked" } },
        { serverName: "error", disabledReason: "provider failed", config: { gateway: true, authSession: { status: "failed", error: "refresh failed" }, authorizationUrl: "https://auth/error" } },
      ],
    })

    const servers = await getConfiguredMcpServers()

    expect(servers.map((server) => [server.serverName, server.authSession?.status])).toEqual([
      ["missing", "missing"],
      ["pending", "pending"],
      ["authorized", "authorized"],
      ["expired", "expired"],
      ["revoked", "revoked"],
      ["error", "error"],
    ])
    expect(servers.find((server) => server.serverName === "authorized")?.authSession).toMatchObject({
      label: "Authorized",
      detail: "Signed in as octo.",
      canPrompt: false,
      providerId: "github",
      sessionId: "s1",
      accountLabel: "octo",
    })
    expect(servers.find((server) => server.serverName === "expired")?.authSession).toMatchObject({
      label: "Authentication expired",
      canPrompt: true,
      authorizationUrl: "https://auth/expired",
    })
    expect(servers.find((server) => server.serverName === "error")?.authSession).toMatchObject({
      label: "Authentication error",
      detail: "refresh failed",
      error: "refresh failed",
    })
  })

  it("runs MCP server lifecycle actions through registry routes", async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, server: { serverName: "profileServer" } })

    await startMcpServer("profileServer")
    await stopMcpServer("profileServer")
    await restartMcpServer("profileServer")

    expect(api.post).toHaveBeenNthCalledWith(1, "/extensions-host/mcp-registry/servers/profileServer/start")
    expect(api.post).toHaveBeenNthCalledWith(2, "/extensions-host/mcp-registry/servers/profileServer/stop")
    expect(api.post).toHaveBeenNthCalledWith(3, "/extensions-host/mcp-registry/servers/profileServer/restart")
  })

  it("reads configured and installed MCP servers from shared registry surfaces", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ servers: [{ serverName: "configured" }] })
      .mockResolvedValueOnce({ status: "available", servers: [{ name: " installed " }, { serverName: " local.server " }, { id: " gallery-id " }, { name: " " }] })

    await expect(getConfiguredMcpServers()).resolves.toEqual([{ serverName: "configured" }])
    await expect(getInstalledMcpGalleryServers()).resolves.toEqual({
      status: "available",
      servers: [{ name: "installed" }, { serverName: "local.server" }, { id: "gallery-id" }],
    })

    expect(api.get).toHaveBeenNthCalledWith(1, "/extensions-host/mcp-registry")
    expect(api.get).toHaveBeenNthCalledWith(2, "/extensions-host/mcp-gallery/installed")
  })

  it("uses VS Code MCP gallery routes for search, resolution, readme, and install permission", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      status: "available",
      servers: [{ name: "io.modelcontextprotocol.filesystem", displayName: "Filesystem" }],
      hasMore: true,
      page: 2,
    })
    vi.mocked(api.post)
      .mockResolvedValueOnce({ servers: [{ name: "io.modelcontextprotocol.github" }] })
      .mockResolvedValueOnce({ readme: "# GitHub" })
      .mockResolvedValueOnce({ canInstall: false, reason: "blocked" })

    await expect(searchMcpGalleryServers("file", 2, 2)).resolves.toEqual({
      status: "available",
      servers: [{ name: "io.modelcontextprotocol.filesystem", displayName: "Filesystem" }],
      hasMore: true,
      page: 2,
    })
    await expect(getMcpGalleryServers([{ name: "io.modelcontextprotocol.github" }])).resolves.toEqual([
      { name: "io.modelcontextprotocol.github" },
    ])
    await expect(getMcpGalleryReadme({ name: "io.modelcontextprotocol.github" })).resolves.toBe("# GitHub")
    await expect(canInstallMcpGalleryServer({ name: "io.modelcontextprotocol.github" })).resolves.toEqual({
      canInstall: false,
      reason: "blocked",
      details: undefined,
    })

    expect(api.get).toHaveBeenCalledWith("/extensions-host/mcp-gallery/search?q=file&pageSize=2&page=2")
    expect(api.post).toHaveBeenNthCalledWith(1, "/extensions-host/mcp-gallery/servers", {
      servers: [{ name: "io.modelcontextprotocol.github" }],
    })
    expect(api.post).toHaveBeenNthCalledWith(2, "/extensions-host/mcp-gallery/readme", {
      server: { name: "io.modelcontextprotocol.github" },
    })
    expect(api.post).toHaveBeenNthCalledWith(3, "/extensions-host/mcp-gallery/can-install", {
      server: { name: "io.modelcontextprotocol.github" },
    })
  })

  it("installs, updates, and uninstalls MCP gallery servers with profile-scoped inputs", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ success: true, server: { name: "io.modelcontextprotocol.filesystem" } })
      .mockResolvedValueOnce({ success: true, server: { name: "io.modelcontextprotocol.filesystem", version: "2.0.0" } })
      .mockResolvedValueOnce({ success: true, uninstalled: true })

    await installMcpGalleryServer({ name: "io.modelcontextprotocol.filesystem" }, {
      profileId: "work",
      workspace: "D:/Project",
      values: { root: { value: "D:/Project" } },
      secrets: { token: { value: "secret" } },
    })
    await updateMcpGalleryServerMetadata({ name: "io.modelcontextprotocol.filesystem" }, { name: "local.filesystem" })
    await uninstallMcpGalleryServer("io.modelcontextprotocol.filesystem", { profileId: "work" })

    expect(api.post).toHaveBeenNthCalledWith(1, "/extensions-host/mcp-gallery/install", {
      server: { name: "io.modelcontextprotocol.filesystem" },
      packageType: undefined,
      profileId: "work",
      mcpTarget: undefined,
      workspace: "D:/Project",
      workspaceFile: undefined,
      values: { root: { value: "D:/Project" } },
      secrets: { token: { value: "secret" } },
    })
    expect(api.post).toHaveBeenNthCalledWith(2, "/extensions-host/mcp-gallery/update-metadata", {
      server: { name: "io.modelcontextprotocol.filesystem" },
      packageType: undefined,
      profileId: undefined,
      mcpTarget: undefined,
      workspace: undefined,
      workspaceFile: undefined,
      values: undefined,
      secrets: undefined,
      name: "local.filesystem",
      serverName: undefined,
    })
    expect(api.post).toHaveBeenNthCalledWith(3, "/extensions-host/mcp-gallery/uninstall", {
      server: undefined,
      name: "io.modelcontextprotocol.filesystem",
      packageType: undefined,
      profileId: "work",
      mcpTarget: undefined,
      workspace: undefined,
      workspaceFile: undefined,
      values: undefined,
      secrets: undefined,
    })
  })

  it("reads MCP resources, templates, completions, and resource contents through registry routes", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ resources: [{ uri: "file:///readme.md", name: "readme.md" }] })
      .mockResolvedValueOnce({ resourceTemplates: [{ uriTemplate: "file:///{path}", name: "file" }] })
    vi.mocked(api.post)
      .mockResolvedValueOnce({ contents: [{ uri: "file:///readme.md", text: "# README" }] })
      .mockResolvedValueOnce({ completion: { values: ["src/main.ts", 42, "src/App.vue"], total: 3, hasMore: true } })

    await expect(listMcpResources("profile server")).resolves.toEqual([{ uri: "file:///readme.md", name: "readme.md" }])
    await expect(listMcpResourceTemplates("profile server")).resolves.toEqual([{ uriTemplate: "file:///{path}", name: "file" }])
    await expect(readMcpResource("profile server", "file:///readme.md")).resolves.toEqual({
      contents: [{ uri: "file:///readme.md", text: "# README" }],
    })
    await expect(completeMcpResourceTemplate("profile server", {
      uriTemplate: "file:///{path}",
      variable: "path",
      value: "src",
      context: { root: "workspace" },
    })).resolves.toEqual({
      values: ["src/main.ts", "src/App.vue"],
      total: 3,
      hasMore: true,
    })

    expect(api.get).toHaveBeenNthCalledWith(1, "/extensions-host/mcp-registry/servers/profile%20server/resources")
    expect(api.get).toHaveBeenNthCalledWith(2, "/extensions-host/mcp-registry/servers/profile%20server/resource-templates")
    expect(api.post).toHaveBeenNthCalledWith(1,
      "/extensions-host/mcp-registry/servers/profile%20server/read-resource",
      { uri: "file:///readme.md" },
    )
    expect(api.post).toHaveBeenNthCalledWith(2,
      "/extensions-host/mcp-registry/servers/profile%20server/resource-template-completions",
      {
        uriTemplate: "file:///{path}",
        variable: "path",
        value: "src",
        context: { root: "workspace" },
      },
    )
  })

  it("passes AbortSignal through MCP resource template completion requests", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ completion: { values: ["src/main.ts"] } })
    const controller = new AbortController()

    await expect(completeMcpResourceTemplate("profile server", {
      uriTemplate: "file:///{path}",
      variable: "path",
      value: "src",
      context: {},
    }, { signal: controller.signal })).resolves.toEqual({
      values: ["src/main.ts"],
      total: undefined,
      hasMore: false,
    })

    expect(api.post).toHaveBeenCalledWith(
      "/extensions-host/mcp-registry/servers/profile%20server/resource-template-completions",
      {
        uriTemplate: "file:///{path}",
        variable: "path",
        value: "src",
        context: {},
      },
      { signal: controller.signal },
    )
  })

  it("subscribes MCP resources through the Electron event bridge and disposes the watcher", async () => {
    const dispose = vi.fn()
    let bridgeListener: ((event: { serverName?: string; uri?: string }) => void) | undefined
    window.codek = {
      subscribeMcpResource: vi.fn(async (_serverName, _uri, listener) => {
        bridgeListener = listener
        return { dispose }
      }),
    } as unknown as CodekAPI
    const listener = vi.fn()

    const subscription = await subscribeMcpResource("profile server", "file:///workspace/readme.md", listener)
    bridgeListener?.({ serverName: "profile server", uri: "file:///workspace/other.md" })
    bridgeListener?.({ serverName: "profile server", uri: "file:///workspace/readme.md" })
    await subscription.dispose()

    expect(window.codek.subscribeMcpResource).toHaveBeenCalledWith(
      "profile server",
      "file:///workspace/readme.md",
      expect.any(Function),
    )
    expect(listener).toHaveBeenCalledWith({ serverName: "profile server", uri: "file:///workspace/readme.md" })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(subscription.ready).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it("preserves MCP resource subscribe unavailable state instead of pretending it is ready", async () => {
    const dispose = vi.fn()
    window.codek = {
      subscribeMcpResource: vi.fn(async () => ({
        ready: false,
        reason: "MCP server does not advertise resources.subscribe capability.",
        retryMode: "manual",
        retryAfter: "1500",
        lastEventId: "42",
        channelStatus: "error",
        reconnectRequested: true,
        userActionRequired: true,
        noAutoRetry: true,
        dispose,
      })),
    } as unknown as CodekAPI
    const listener = vi.fn()

    const subscription = await subscribeMcpResource("profile server", "file:///workspace/readme.md", listener)
    await subscription.dispose()

    expect(subscription.ready).toBe(false)
    expect(subscription.reason).toMatch(/resources\.subscribe/)
    expect(subscription.retryMode).toBe("manual")
    expect(subscription.retryAfter).toBe("1500")
    expect(subscription.lastEventId).toBe("42")
    expect(subscription.channelStatus).toBe("error")
    expect(subscription.reconnectRequested).toBe(true)
    expect(subscription.userActionRequired).toBe(true)
    expect(subscription.noAutoRetry).toBe(true)
    expect(listener).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it("returns a no-op MCP resource subscription outside Electron", async () => {
    const listener = vi.fn()

    const subscription = await subscribeMcpResource("profile server", "file:///workspace/readme.md", listener)
    await subscription.dispose()

    expect(subscription.ready).toBe(false)
    expect(subscription.reason).toMatch(/outside Electron/)
    expect(listener).not.toHaveBeenCalled()
  })

  it("writes plain and secret MCP inputs through the shared registry route", async () => {
    vi.mocked(api.request).mockResolvedValue({ inputs: {} })

    await setSavedMcpInput({ id: "root", password: false }, "D:/work", { profileId: "p1" })
    await setSavedMcpInput({ id: "API_TOKEN", password: true }, { value: "secret" }, { profileId: "p1" })

    expect(api.request).toHaveBeenNthCalledWith(1, "PUT", "/extensions-host/mcp-registry/inputs", {
      profileId: "p1",
      values: { root: { value: "D:/work" } },
    })
    expect(api.request).toHaveBeenNthCalledWith(2, "PUT", "/extensions-host/mcp-registry/inputs", {
      profileId: "p1",
      secrets: { API_TOKEN: { value: "secret" } },
    })
  })

  it("batches mixed MCP inputs without leaking secret values into plain values", async () => {
    vi.mocked(api.request).mockResolvedValue({ inputs: {} })

    await setSavedMcpInputs([
      { metadata: { id: "root" }, value: "D:/work" },
      { metadata: { id: "API_TOKEN", password: true }, value: "secret" },
    ])

    expect(api.request).toHaveBeenCalledWith("PUT", "/extensions-host/mcp-registry/inputs", {
      profileId: undefined,
      values: { root: { value: "D:/work" } },
      secrets: { API_TOKEN: { value: "secret" } },
    })
  })

  it("clears one or all saved MCP inputs through VS Code-style registry methods", async () => {
    vi.mocked(api.request).mockResolvedValue({ success: true })

    await clearSavedMcpInput("API_TOKEN", { profileId: "p1" })
    await clearAllSavedMcpInputs({ profileId: "p1" })

    expect(api.request).toHaveBeenNthCalledWith(1, "DELETE", "/extensions-host/mcp-registry/inputs/API_TOKEN", {
      profileId: "p1",
    })
    expect(api.request).toHaveBeenNthCalledWith(2, "DELETE", "/extensions-host/mcp-registry/inputs", {
      profileId: "p1",
    })
  })
})
