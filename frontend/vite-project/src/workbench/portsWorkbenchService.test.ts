import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  CodekPortsWorkbenchService,
  IPortsWorkbenchService,
  globalPortsWorkbenchService,
} from "./portsWorkbenchService"
import {
  CodekPortForwardingService,
  TunnelPrivacyId,
  TunnelProtocol,
  type RemoteTunnel,
} from "../ports/portForwardingService"
import { clearCommands, executeCommand, getCommands } from "./commandRegistry"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"

describe("CodekPortsWorkbenchService", () => {
  let portService: CodekPortForwardingService
  let workbench: CodekPortsWorkbenchService

  beforeEach(() => {
    clearCommands()
    portService = new CodekPortForwardingService({
      now: () => 2000,
      createId: (prefix, host, port) => `${prefix}:${host}:${port}`,
    })
    portService.setTunnelProvider({
      forwardPort: async (options): Promise<RemoteTunnel> => ({
        tunnelRemoteHost: options.remoteAddress.host,
        tunnelRemotePort: options.remoteAddress.port,
        tunnelLocalPort: options.localAddressPort ?? options.remoteAddress.port,
        localAddress: `127.0.0.1:${options.localAddressPort ?? options.remoteAddress.port}`,
        privacy: options.privacy || TunnelPrivacyId.Private,
        protocol: options.protocol || TunnelProtocol.Http,
        dispose: vi.fn(),
      }),
    })
    workbench = new CodekPortsWorkbenchService({ portService })
  })

  it("registers open, close, and reopen commands against the same port forwarding service", async () => {
    workbench.registerWorkbenchContributions()

    expect(getCommands().map((command) => command.id)).toEqual([
      "ports.forward.open",
      "ports.forward.openBrowser",
      "ports.forward.close",
      "ports.forward.reopen",
    ])

    await expect(executeCommand("ports.forward.open", [{ host: "localhost", port: 3000, localPort: 3300 }])).resolves.toBe(true)
    expect(workbench.getProjection().portForwarding.forwarded).toMatchObject([{ remotePort: 3000, localPort: 3300 }])

    await expect(executeCommand("ports.forward.reopen", [{ host: "localhost", port: 3000, privacy: TunnelPrivacyId.Public }])).resolves.toBe(true)
    expect(workbench.getProjection().portForwarding.forwarded).toMatchObject([{ remotePort: 3000, privacy: TunnelPrivacyId.Public }])

    await expect(executeCommand("ports.forward.close", [{ host: "localhost", port: 3000 }])).resolves.toBe(true)
    expect(workbench.getProjection().portForwarding.forwarded).toEqual([])
  })

  it("projects evidence-safe workbench actions without duplicating port state", async () => {
    await portService.setCandidates([{ host: "localhost", port: 5173, detail: "vite", pid: 7 }])

    const projection = workbench.getProjection()

    expect(projection.source).toBe("portsWorkbenchService")
    expect(projection.portForwarding.source).toBe("portForwardingService")
    expect(projection.actionIds).toEqual([
      "ports.forward.open",
      "ports.forward.openBrowser",
      "ports.forward.close",
      "ports.forward.reopen",
    ])
    expect(projection.evidence).toMatchObject({
      serviceId: "portsWorkbenchService",
      stateSource: "IPortForwardingService.getProjection",
      workspaceMutation: "none",
      preservesAgentEvidence: true,
    })
    expect(projection.portForwarding.candidates).toMatchObject([{ host: "localhost", port: 5173 }])
  })

  it("exposes the global workbench service through ServiceCollection", () => {
    const collection = new ServiceCollection([IPortsWorkbenchService, globalPortsWorkbenchService])

    expect(collection.get(IPortsWorkbenchService)).toBe(globalPortsWorkbenchService)
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === IPortsWorkbenchService && instance === globalPortsWorkbenchService)).toBe(true)
  })
})
