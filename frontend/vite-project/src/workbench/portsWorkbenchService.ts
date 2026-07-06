import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import {
  createPortForwardingEvidence,
  globalPortForwardingService,
  type IPortForwardingService,
  type PortForwardingProjection,
  type TunnelProperties,
} from "../ports/portForwardingService"
import { registerCommand, type CommandDescriptor } from "./commandRegistry"

export interface PortsWorkbenchEvidence {
  readonly serviceId: "portsWorkbenchService"
  readonly stateSource: "IPortForwardingService.getProjection"
  readonly workspaceMutation: "none"
  readonly preservesAgentEvidence: true
  readonly safetyBoundary: string
}

export interface PortsWorkbenchProjection {
  readonly source: "portsWorkbenchService"
  readonly viewId: "~remote.forwardedPorts"
  readonly containerId: "~remote.forwardedPortsContainer"
  readonly commandCategory: "Ports"
  readonly actionIds: readonly string[]
  readonly portForwarding: PortForwardingProjection
  readonly evidence: PortsWorkbenchEvidence
}

export interface IPortsWorkbenchService {
  readonly _serviceBrand: undefined
  registerWorkbenchContributions(): void
  getProjection(): PortsWorkbenchProjection
}

interface RuntimeOptions {
  readonly portService?: IPortForwardingService
}

interface OpenPortCommandArgs {
  readonly host?: string
  readonly port?: number
  readonly localPort?: number
  readonly privacy?: string
  readonly protocol?: string
  readonly name?: string
}

export const IPortsWorkbenchService = createDecorator<IPortsWorkbenchService>("portsWorkbenchService")

export class CodekPortsWorkbenchService implements IPortsWorkbenchService {
  declare readonly _serviceBrand: undefined

  private registered = false

  constructor(private readonly options: RuntimeOptions = {}) {}

  registerWorkbenchContributions(): void {
    if (this.registered) return
    for (const command of this.createCommands()) {
      registerCommand(command)
    }
    this.registered = true
  }

  getProjection(): PortsWorkbenchProjection {
    const portForwarding = this.portService.getProjection()
    return {
      source: "portsWorkbenchService",
      viewId: "~remote.forwardedPorts",
      containerId: "~remote.forwardedPortsContainer",
      commandCategory: "Ports",
      actionIds: portForwarding.actions.map((action) => action.commandId),
      portForwarding,
      evidence: createPortsWorkbenchEvidence(),
    }
  }

  private createCommands(): CommandDescriptor[] {
    return [
      {
        id: "ports.forward.open",
        title: "Forward Port",
        category: "Ports",
        source: "vscode",
        handler: async (input?: unknown) => {
          const args = asOpenPortCommandArgs(input)
          const port = normalizePort(args?.port)
          if (!port) return
          await this.portService.forward(toTunnelProperties(args, port))
        },
      },
      {
        id: "ports.forward.openBrowser",
        title: "Open Forwarded Port in Browser",
        category: "Ports",
        source: "vscode",
        handler: async (input?: unknown) => {
          const args = asOpenPortCommandArgs(input)
          const port = normalizePort(args?.port)
          if (!port) return
          await this.portService.forward(toTunnelProperties(args, port))
        },
      },
      {
        id: "ports.forward.close",
        title: "Close Forwarded Port",
        category: "Ports",
        source: "vscode",
        handler: async (input?: unknown) => {
          const args = asOpenPortCommandArgs(input)
          const port = normalizePort(args?.port)
          if (!port) return
          await this.portService.close(args?.host || "localhost", port)
        },
      },
      {
        id: "ports.forward.reopen",
        title: "Reopen Forwarded Port",
        category: "Ports",
        source: "vscode",
        handler: async (input?: unknown) => {
          const args = asOpenPortCommandArgs(input)
          const port = normalizePort(args?.port)
          if (!port) return
          await this.portService.reopenForwardedPort(args?.host || "localhost", port, toTunnelProperties(args, port))
        },
      },
    ]
  }

  private get portService(): IPortForwardingService {
    return this.options.portService || globalPortForwardingService
  }
}

export const globalPortsWorkbenchService = new CodekPortsWorkbenchService()
registerSingleton(IPortsWorkbenchService, globalPortsWorkbenchService, InstantiationType.Delayed)

export function createPortsWorkbenchEvidence(): PortsWorkbenchEvidence {
  return {
    serviceId: "portsWorkbenchService",
    stateSource: "IPortForwardingService.getProjection",
    workspaceMutation: "none",
    preservesAgentEvidence: true,
    safetyBoundary: createPortForwardingEvidence().safetyBoundary,
  }
}

function asOpenPortCommandArgs(input: unknown): OpenPortCommandArgs | undefined {
  return input && typeof input === "object" ? input as OpenPortCommandArgs : undefined
}

function toTunnelProperties(input: OpenPortCommandArgs | undefined, port: number): TunnelProperties {
  return {
    remote: { host: input?.host || "localhost", port },
    local: input?.localPort,
    name: input?.name,
    privacy: input?.privacy,
    protocol: narrowProtocol(input?.protocol),
  }
}

function narrowProtocol(protocol: string | undefined): TunnelProperties["protocol"] {
  return protocol === "https" || protocol === "http" ? protocol : undefined
}

function normalizePort(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}
