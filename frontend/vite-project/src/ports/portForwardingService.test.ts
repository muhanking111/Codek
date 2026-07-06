import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  CodekPortForwardingService,
  ProvidedOnAutoForward,
  TunnelPrivacyId,
  TunnelProtocol,
  createPortForwardingEvidence,
  privacyLabel,
  type RemoteTunnel,
} from "./portForwardingService"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"

describe("CodekPortForwardingService", () => {
  let disposeCalls: string[]
  let service: CodekPortForwardingService

  beforeEach(() => {
    disposeCalls = []
    service = new CodekPortForwardingService({
      now: () => 1000,
      createId: (prefix, host, port) => `${prefix}:${host}:${port}`,
    })
  })

  it("registers a VS Code-style tunnel provider and reuses the single forwarded state source", async () => {
    const provider = {
      forwardPort: vi.fn(async (options): Promise<RemoteTunnel> => ({
        tunnelRemoteHost: options.remoteAddress.host,
        tunnelRemotePort: options.remoteAddress.port,
        tunnelLocalPort: options.localAddressPort ?? options.remoteAddress.port,
        localAddress: `127.0.0.1:${options.localAddressPort ?? options.remoteAddress.port}`,
        privacy: options.privacy || TunnelPrivacyId.Private,
        protocol: options.protocol || TunnelProtocol.Http,
        dispose: async () => {
          disposeCalls.push(`${options.remoteAddress.host}:${options.remoteAddress.port}`)
        },
      })),
    }

    service.setTunnelProvider(provider)
    service.setTunnelFeatures({
      elevation: true,
      privacyOptions: [
        { id: TunnelPrivacyId.Private, themeIcon: "lock", label: "Private" },
        { id: TunnelPrivacyId.Public, themeIcon: "globe", label: "Public" },
      ],
      protocol: true,
    })

    const opened = await service.openTunnel(undefined, "localhost", 3000, "127.0.0.1", 3300, true, TunnelPrivacyId.Public, TunnelProtocol.Https)
    const reused = await service.openTunnel(undefined, "127.0.0.1", 3000)

    expect(provider.forwardPort).toHaveBeenCalledTimes(1)
    expect(opened).toMatchObject({
      tunnelRemoteHost: "localhost",
      tunnelRemotePort: 3000,
      tunnelLocalPort: 3300,
      privacy: TunnelPrivacyId.Public,
      protocol: TunnelProtocol.Https,
    })
    expect(reused).toEqual(opened)
    expect(service.getForwardedPorts()).toMatchObject([
      {
        remoteHost: "localhost",
        remotePort: 3000,
        localAddress: "127.0.0.1:3300",
        localPort: 3300,
        privacy: TunnelPrivacyId.Public,
        privacyLabel: "Public",
        protocol: TunnelProtocol.Https,
        source: { source: "user", description: "User Forwarded" },
      },
    ])
    expect(service.getProjection().evidence).toMatchObject({
      stateSource: "CodekPortForwardingService",
      workspaceMutation: "none",
      preservesAgentEvidence: true,
    })
  })

  it("updates candidate ports and merges config/provider port attributes without a second state source", async () => {
    service.setPortAttributes({
      "3000": {
        label: "Vite dev server",
        onAutoForward: "openBrowser",
        protocol: TunnelProtocol.Http,
        requireLocalPort: true,
      },
      "4000-4010": {
        label: "API range",
        onAutoForward: "notify",
      },
      "worker.*server": {
        label: "Worker",
        onAutoForward: "silent",
      },
    })
    service.addPortAttributesProvider({
      providePortAttributes: async (ports) => ports.map((port) => ({
        port,
        autoForwardAction: ProvidedOnAutoForward.OpenPreview,
      })),
    })

    await service.setCandidates([
      { host: "localhost", port: 3000, detail: "vite --host", pid: 11 },
      { host: "localhost", port: 4002, detail: "node api", pid: 12 },
      { host: "localhost", port: 5050, detail: "worker alpha server", pid: 13 },
      { host: "localhost", port: 6060, detail: "unknown", pid: 14 },
    ])

    expect(await service.getAttributes([
      { host: "localhost", port: 3000 },
      { host: "localhost", port: 4002 },
      { host: "localhost", port: 5050 },
      { host: "localhost", port: 6060 },
    ])).toEqual(new Map([
      [3000, expect.objectContaining({ label: "Vite dev server", onAutoForward: "openBrowser", protocol: "http" })],
      [4002, expect.objectContaining({ label: "API range", onAutoForward: "notify" })],
      [5050, expect.objectContaining({ label: "Worker", onAutoForward: "silent" })],
      [6060, expect.objectContaining({ onAutoForward: "openPreview" })],
    ]))
    expect(service.getProjection().candidates.map((candidate) => `${candidate.port}:${candidate.attributeLabel}:${candidate.autoForwardAction}`)).toEqual([
      "3000:Vite dev server:openBrowser",
      "4002:API range:notify",
      "5050:Worker:silent",
      "6060::openPreview",
    ])
  })

  it("closes and reopens forwarded ports when privacy or protocol changes", async () => {
    service.setTunnelProvider({
      forwardPort: async (options): Promise<RemoteTunnel> => ({
        tunnelRemoteHost: options.remoteAddress.host,
        tunnelRemotePort: options.remoteAddress.port,
        tunnelLocalPort: options.localAddressPort ?? options.remoteAddress.port,
        localAddress: `127.0.0.1:${options.localAddressPort ?? options.remoteAddress.port}`,
        privacy: options.privacy || TunnelPrivacyId.Private,
        protocol: options.protocol || TunnelProtocol.Http,
        dispose: async () => {
          disposeCalls.push(`${options.remoteAddress.host}:${options.remoteAddress.port}:${options.privacy}:${options.protocol}`)
        },
      }),
    })

    await service.forward({
      remote: { host: "localhost", port: 5173 },
      local: 5173,
      privacy: TunnelPrivacyId.Private,
      protocol: TunnelProtocol.Http,
    })
    await service.reopenForwardedPort("localhost", 5173, {
      privacy: TunnelPrivacyId.Public,
      protocol: TunnelProtocol.Https,
    })

    expect(disposeCalls).toEqual(["localhost:5173:private:http"])
    expect(service.getForwardedPorts()).toMatchObject([
      {
        remotePort: 5173,
        privacy: TunnelPrivacyId.Public,
        privacyLabel: "Public",
        protocol: TunnelProtocol.Https,
      },
    ])
  })

  it("projects evidence-safe actions for open, close, and reopen without executing them", async () => {
    await service.setCandidates([{ host: "localhost", port: 8080, detail: "node server", pid: 42 }])
    service.setEnvironmentTunnel("localhost", 9090, "127.0.0.1:9090", TunnelPrivacyId.ConstantPrivate, TunnelProtocol.Http)

    const projection = service.getProjection()

    expect(projection.actions.map((action) => `${action.id}:${action.kind}:${action.workspaceMutation}`)).toEqual([
      "ports.forward.open:open:none",
      "ports.forward.openBrowser:open:none",
      "ports.forward.close:close:none",
      "ports.forward.reopen:reopen:none",
    ])
    expect(projection.detected).toMatchObject([
      {
        remotePort: 9090,
        privacy: TunnelPrivacyId.ConstantPrivate,
        privacyLabel: "Private (managed)",
        closeable: false,
      },
    ])
    expect(createPortForwardingEvidence("close")).toEqual({
      serviceId: "portForwardingService",
      stateSource: "CodekPortForwardingService",
      workspaceMutation: "none",
      preservesAgentEvidence: true,
      safetyBoundary: "Port forwarding actions only mutate the tunnel provider lifecycle; Git index and workspace files are untouched.",
      actionKind: "close",
    })
  })
})

describe("port forwarding helpers", () => {
  it("normalizes privacy labels with VS Code-compatible ids and Codek Chinese fallback", () => {
    expect(privacyLabel(TunnelPrivacyId.Private)).toBe("Private")
    expect(privacyLabel(TunnelPrivacyId.Public)).toBe("Public")
    expect(privacyLabel(TunnelPrivacyId.ConstantPrivate)).toBe("Private (managed)")
    expect(privacyLabel("organization", [{ id: "organization", label: "组织可见", themeIcon: "organization" }])).toBe("组织可见")
  })

  it("registers the global service through ServiceCollection", async () => {
    const module = await import("./portForwardingService")
    const collection = new ServiceCollection([module.IPortForwardingService, module.globalPortForwardingService])

    expect(collection.get(module.IPortForwardingService)).toBe(module.globalPortForwardingService)
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === module.IPortForwardingService && instance === module.globalPortForwardingService)).toBe(true)
  })
})
