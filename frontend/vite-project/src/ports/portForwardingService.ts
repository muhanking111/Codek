import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"

export const enum TunnelProtocol {
  Http = "http",
  Https = "https",
}

export const enum TunnelPrivacyId {
  ConstantPrivate = "constantPrivate",
  Private = "private",
  Public = "public",
}

export const enum ProvidedOnAutoForward {
  Notify = 1,
  OpenBrowser = 2,
  OpenPreview = 3,
  Silent = 4,
  Ignore = 5,
  OpenBrowserOnce = 6,
}

export type OnPortForward = "notify" | "openBrowser" | "openBrowserOnce" | "openPreview" | "silent" | "ignore"
export type TunnelSourceKind = "user" | "auto" | "extension" | "environment"
export type PortForwardingActionKind = "open" | "close" | "reopen"

export interface WorkbenchDisposable {
  dispose(): void
}

export interface TunnelPrivacyOption {
  readonly id: string
  readonly label: string
  readonly themeIcon?: string
}

export interface RemoteTunnel {
  readonly tunnelRemotePort: number
  readonly tunnelRemoteHost: string
  readonly tunnelLocalPort?: number
  readonly localAddress: string
  readonly privacy: string
  readonly protocol?: string
  dispose(silent?: boolean): Promise<void> | void
}

export interface TunnelOptions {
  readonly remoteAddress: { readonly host: string; readonly port: number }
  readonly localAddressPort?: number
  readonly label?: string
  readonly public?: boolean
  readonly privacy?: string
  readonly protocol?: string
}

export interface TunnelCreationOptions {
  readonly elevationRequired?: boolean
}

export interface TunnelProvider {
  forwardPort(options: TunnelOptions, creationOptions: TunnelCreationOptions): Promise<RemoteTunnel | string | undefined> | undefined
}

export interface TunnelProviderFeatures {
  readonly elevation: boolean
  readonly privacyOptions: readonly TunnelPrivacyOption[]
  readonly protocol: boolean
}

export interface CandidatePort {
  readonly host: string
  readonly port: number
  readonly detail?: string
  readonly pid?: number
}

export interface ProvidedPortAttributes {
  readonly port: number
  readonly autoForwardAction: ProvidedOnAutoForward
}

export interface PortAttributesProvider {
  providePortAttributes(
    ports: readonly number[],
    pid: number | undefined,
    commandLine: string | undefined,
    token: PortForwardingCancellationToken,
  ): Promise<readonly ProvidedPortAttributes[]>
}

export interface PortForwardingCancellationToken {
  readonly isCancellationRequested: boolean
}

export interface PortForwardingAttributes {
  readonly label?: string
  readonly onAutoForward?: OnPortForward
  readonly elevateIfNeeded?: boolean
  readonly requireLocalPort?: boolean
  readonly protocol?: TunnelProtocol | `${TunnelProtocol}`
}

export interface TunnelProperties {
  readonly remote: { readonly host: string; readonly port: number }
  readonly local?: number
  readonly name?: string
  readonly source?: TunnelSource
  readonly elevateIfNeeded?: boolean
  readonly privacy?: string
  readonly protocol?: TunnelProtocol | `${TunnelProtocol}`
}

export interface TunnelSource {
  readonly source: TunnelSourceKind
  readonly description: string
}

export interface ForwardedPort {
  readonly id: string
  readonly remoteHost: string
  readonly remotePort: number
  readonly localAddress: string
  readonly localPort?: number
  readonly localUri: string
  readonly name?: string
  readonly closeable: boolean
  readonly privacy: string
  readonly privacyLabel: string
  readonly protocol: TunnelProtocol | `${TunnelProtocol}`
  readonly runningProcess?: string
  readonly hasRunningProcess: boolean
  readonly pid?: number
  readonly source: TunnelSource
  readonly createdAt: number
  readonly updatedAt: number
}

export interface CandidatePortProjection extends CandidatePort {
  readonly id: string
  readonly attributeLabel: string
  readonly autoForwardAction: OnPortForward | ""
  readonly protocol: TunnelProtocol | `${TunnelProtocol}` | ""
}

export interface PortForwardingActionProjection {
  readonly id: string
  readonly label: string
  readonly kind: PortForwardingActionKind
  readonly commandId: string
  readonly workspaceMutation: "none"
  readonly evidence: PortForwardingEvidence
}

export interface PortForwardingEvidence {
  readonly serviceId: "portForwardingService"
  readonly stateSource: "CodekPortForwardingService"
  readonly workspaceMutation: "none"
  readonly preservesAgentEvidence: true
  readonly safetyBoundary: string
  readonly actionKind?: PortForwardingActionKind
}

export interface PortForwardingProjection {
  readonly source: "portForwardingService"
  readonly forwarded: readonly ForwardedPort[]
  readonly detected: readonly ForwardedPort[]
  readonly candidates: readonly CandidatePortProjection[]
  readonly actions: readonly PortForwardingActionProjection[]
  readonly features: {
    readonly hasTunnelProvider: boolean
    readonly canElevate: boolean
    readonly canChangePrivacy: boolean
    readonly canChangeProtocol: boolean
    readonly privacyOptions: readonly TunnelPrivacyOption[]
  }
  readonly evidence: PortForwardingEvidence
}

export interface IPortForwardingService {
  readonly _serviceBrand: undefined
  readonly hasTunnelProvider: boolean
  readonly canElevate: boolean
  readonly canChangePrivacy: boolean
  readonly canChangeProtocol: boolean
  readonly privacyOptions: readonly TunnelPrivacyOption[]
  setTunnelProvider(provider: TunnelProvider | undefined): WorkbenchDisposable
  setTunnelFeatures(features: TunnelProviderFeatures): void
  openTunnel(
    addressProvider: unknown,
    remoteHost: string | undefined,
    remotePort: number,
    localHost?: string,
    localPort?: number,
    elevateIfNeeded?: boolean,
    privacy?: string,
    protocol?: string,
  ): Promise<RemoteTunnel | string | undefined> | undefined
  closeTunnel(remoteHost: string, remotePort: number): Promise<void>
  getExistingTunnel(remoteHost: string, remotePort: number): Promise<RemoteTunnel | string | undefined>
  setEnvironmentTunnel(remoteHost: string, remotePort: number, localAddress: string, privacy: string, protocol: string): void
  forward(tunnelProperties: TunnelProperties, attributes?: PortForwardingAttributes | null): Promise<RemoteTunnel | string | undefined>
  close(host: string, port: number): Promise<void>
  reopenForwardedPort(host: string, port: number, update?: Partial<TunnelProperties>): Promise<RemoteTunnel | string | undefined>
  setCandidates(candidates: readonly CandidatePort[]): Promise<void>
  getAttributes(forwardedPorts: readonly { host: string; port: number }[], checkProviders?: boolean): Promise<Map<number, PortForwardingAttributes>>
  setPortAttributes(attributes: PortAttributesSetting): void
  addPortAttributesProvider(provider: PortAttributesProvider): WorkbenchDisposable
  getForwardedPorts(): ForwardedPort[]
  getDetectedPorts(): ForwardedPort[]
  getProjection(): PortForwardingProjection
}

export type PortAttributesSetting = Record<string, PortForwardingAttributes>

interface RuntimeHooks {
  now?: () => number
  createId?: (prefix: string, host: string, port: number) => string
  isPortPrivileged?: (port: number) => boolean
}

interface TunnelRecord {
  refcount: number
  value: Promise<RemoteTunnel | string | undefined>
}

interface ParsedPortAttribute {
  readonly key: number | PortRange | RegExp | HostAndPort
  readonly attributes: PortForwardingAttributes
  readonly order: number
}

interface PortRange {
  readonly start: number
  readonly end: number
}

interface HostAndPort {
  readonly host: string
  readonly port: number
}

const LOCALHOST_ADDRESSES = ["localhost", "127.0.0.1", "0:0:0:0:0:0:0:1", "::1"]
const ALL_INTERFACES_ADDRESSES = ["0.0.0.0", "0:0:0:0:0:0:0:0", "::"]
const USER_TUNNEL_SOURCE: TunnelSource = { source: "user", description: "User Forwarded" }
const ENVIRONMENT_TUNNEL_SOURCE: TunnelSource = { source: "environment", description: "Statically Forwarded" }
const NONE_TOKEN: PortForwardingCancellationToken = { isCancellationRequested: false }

export const IPortForwardingService = createDecorator<IPortForwardingService>("portForwardingService")

export class CodekPortForwardingService implements IPortForwardingService {
  declare readonly _serviceBrand: undefined

  private readonly tunnels = new Map<string, TunnelRecord>()
  private readonly forwarded = new Map<string, ForwardedPort>()
  private readonly detected = new Map<string, ForwardedPort>()
  private readonly candidates = new Map<string, CandidatePort>()
  private readonly candidateAttributes = new Map<number, PortForwardingAttributes>()
  private readonly portAttributesProviders: PortAttributesProvider[] = []
  private tunnelProvider: TunnelProvider | undefined
  private canElevateValue = false
  private canChangeProtocolValue = true
  private privacyOptionsValue: readonly TunnelPrivacyOption[] = []
  private parsedAttributes: ParsedPortAttribute[] = []
  private attributeSetting: PortAttributesSetting = {}

  constructor(private readonly hooks: RuntimeHooks = {}) {}

  get hasTunnelProvider(): boolean {
    return Boolean(this.tunnelProvider)
  }

  get canElevate(): boolean {
    return this.canElevateValue
  }

  get canChangePrivacy(): boolean {
    return this.privacyOptionsValue.length > 0
  }

  get canChangeProtocol(): boolean {
    return this.canChangeProtocolValue
  }

  get privacyOptions(): readonly TunnelPrivacyOption[] {
    return this.privacyOptionsValue
  }

  setTunnelProvider(provider: TunnelProvider | undefined): WorkbenchDisposable {
    this.tunnelProvider = provider
    if (!provider) {
      this.canElevateValue = false
      this.privacyOptionsValue = []
    }
    return {
      dispose: () => {
        if (this.tunnelProvider === provider) {
          this.tunnelProvider = undefined
          this.canElevateValue = false
          this.privacyOptionsValue = []
        }
      },
    }
  }

  setTunnelFeatures(features: TunnelProviderFeatures): void {
    this.canElevateValue = features.elevation
    this.canChangeProtocolValue = features.protocol
    this.privacyOptionsValue = [...features.privacyOptions]
  }

  async openTunnel(
    _addressProvider: unknown,
    remoteHost: string | undefined,
    remotePort: number,
    localHost = "127.0.0.1",
    localPort?: number,
    elevateIfNeeded = false,
    privacy?: string,
    protocol?: string,
  ): Promise<RemoteTunnel | string | undefined> {
    const host = normalizeHost(remoteHost)
    const existing = this.getTunnelRecord(host, remotePort)
    if (existing) {
      existing.refcount += 1
      return existing.value
    }
    if (!this.tunnelProvider) return undefined

    const preferredLocalPort = localPort ?? remotePort
    const creationOptions = {
      elevationRequired: elevateIfNeeded && this.isPortPrivileged(preferredLocalPort),
    }
    const tunnel = this.tunnelProvider.forwardPort({
      remoteAddress: { host, port: remotePort },
      localAddressPort: localPort,
      privacy,
      public: privacy ? privacy !== TunnelPrivacyId.Private : undefined,
      protocol,
    }, creationOptions)
    if (!tunnel) return undefined

    const record: TunnelRecord = { refcount: 1, value: Promise.resolve(tunnel) }
    this.tunnels.set(makeAddress(host, remotePort), record)
    const resolved = await record.value
    if (!resolved || typeof resolved === "string") {
      this.tunnels.delete(makeAddress(host, remotePort))
      return resolved
    }
    this.forwarded.set(makeAddress(host, remotePort), this.toForwardedPort(resolved, {
      local: localPort,
      source: USER_TUNNEL_SOURCE,
      protocol: narrowProtocol(protocol),
      privacy,
    }))
    return resolved
  }

  async getExistingTunnel(remoteHost: string, remotePort: number): Promise<RemoteTunnel | string | undefined> {
    const record = this.getTunnelRecord(normalizeHost(remoteHost), remotePort)
    if (!record) return undefined
    record.refcount += 1
    return record.value
  }

  async closeTunnel(remoteHost: string, remotePort: number): Promise<void> {
    const host = normalizeHost(remoteHost)
    const key = makeAddress(host, remotePort)
    const record = this.getTunnelRecord(host, remotePort)
    if (!record) return
    record.refcount = 0
    const tunnel = await record.value
    if (tunnel && typeof tunnel !== "string") {
      await tunnel.dispose(true)
    }
    this.tunnels.delete(key)
    this.forwarded.delete(key)
  }

  setEnvironmentTunnel(remoteHost: string, remotePort: number, localAddress: string, privacy: string, protocol: string): void {
    const host = normalizeHost(remoteHost)
    const remoteTunnel: RemoteTunnel = {
      tunnelRemoteHost: host,
      tunnelRemotePort: remotePort,
      tunnelLocalPort: parseLocalPort(localAddress),
      localAddress,
      privacy,
      protocol,
      dispose: async () => {},
    }
    this.detected.set(makeAddress(host, remotePort), this.toForwardedPort(remoteTunnel, {
      source: ENVIRONMENT_TUNNEL_SOURCE,
      closeable: false,
      privacy,
      protocol: narrowProtocol(protocol),
    }))
    this.tunnels.set(makeAddress(host, remotePort), { refcount: 1, value: Promise.resolve(remoteTunnel) })
  }

  async forward(tunnelProperties: TunnelProperties, attributes?: PortForwardingAttributes | null): Promise<RemoteTunnel | string | undefined> {
    const attrs = attributes ?? (await this.getAttributes([tunnelProperties.remote])).get(tunnelProperties.remote.port)
    const existing = findAddress(this.forwarded, tunnelProperties.remote.host, tunnelProperties.remote.port)
    if (existing) {
      if (shouldReopen(existing, tunnelProperties, attrs)) {
        return this.reopenForwardedPort(existing.remoteHost, existing.remotePort, tunnelProperties)
      }
      this.forwarded.set(makeAddress(existing.remoteHost, existing.remotePort), {
        ...existing,
        name: attrs?.label ?? tunnelProperties.name ?? existing.name,
        updatedAt: this.now(),
      })
      return findAddress(this.tunnels, existing.remoteHost, existing.remotePort)?.value
    }
    return this.openTunnel(
      undefined,
      tunnelProperties.remote.host,
      tunnelProperties.remote.port,
      undefined,
      tunnelProperties.local ?? tunnelProperties.remote.port,
      tunnelProperties.elevateIfNeeded ?? attrs?.elevateIfNeeded,
      tunnelProperties.privacy,
      tunnelProperties.protocol ?? attrs?.protocol,
    )
  }

  async close(host: string, port: number): Promise<void> {
    return this.closeTunnel(host, port)
  }

  async reopenForwardedPort(host: string, port: number, update: Partial<TunnelProperties> = {}): Promise<RemoteTunnel | string | undefined> {
    const existing = findAddress(this.forwarded, host, port)
    const local = update.local ?? existing?.localPort ?? port
    const source = update.source ?? existing?.source ?? USER_TUNNEL_SOURCE
    await this.closeTunnel(existing?.remoteHost ?? host, existing?.remotePort ?? port)
    const result = await this.openTunnel(
      undefined,
      update.remote?.host ?? existing?.remoteHost ?? host,
      update.remote?.port ?? existing?.remotePort ?? port,
      undefined,
      local,
      update.elevateIfNeeded,
      update.privacy ?? existing?.privacy,
      update.protocol ?? existing?.protocol,
    )
    const reopened = findAddress(this.forwarded, update.remote?.host ?? host, update.remote?.port ?? port)
    if (reopened) {
      this.forwarded.set(makeAddress(reopened.remoteHost, reopened.remotePort), {
        ...reopened,
        source,
        name: update.name ?? existing?.name,
        updatedAt: this.now(),
      })
    }
    return result
  }

  async setCandidates(candidates: readonly CandidatePort[]): Promise<void> {
    this.candidates.clear()
    this.candidateAttributes.clear()
    for (const candidate of candidates) {
      const normalized = { ...candidate, host: normalizeHost(candidate.host) }
      this.candidates.set(makeAddress(normalized.host, normalized.port), normalized)
      const forwarded = findAddress(this.forwarded, normalized.host, normalized.port)
      if (forwarded) {
        this.forwarded.set(makeAddress(forwarded.remoteHost, forwarded.remotePort), {
          ...forwarded,
          runningProcess: normalized.detail,
          hasRunningProcess: true,
          pid: normalized.pid,
          updatedAt: this.now(),
        })
      }
    }
    const attributes = await this.getAttributes([...this.candidates.values()])
    attributes.forEach((value, key) => this.candidateAttributes.set(key, value))
  }

  async getAttributes(
    forwardedPorts: readonly { host: string; port: number }[],
    checkProviders = true,
  ): Promise<Map<number, PortForwardingAttributes>> {
    const attributes = new Map<number, PortForwardingAttributes>()
    const candidateByPort = new Map<number, CandidatePort>()
    for (const forwardedPort of forwardedPorts) {
      const candidate = findAddress(this.candidates, forwardedPort.host, forwardedPort.port)
      if (candidate) candidateByPort.set(forwardedPort.port, candidate)
      const config = this.getConfigAttributes(forwardedPort.port, forwardedPort.host, candidate?.detail)
      if (config) attributes.set(forwardedPort.port, config)
    }

    if (!checkProviders || this.portAttributesProviders.length === 0) return attributes

    const grouped = new Map<number | undefined, number[]>()
    for (const forwardedPort of forwardedPorts) {
      const candidate = candidateByPort.get(forwardedPort.port)
      const pid = candidate?.pid
      grouped.set(pid, [...(grouped.get(pid) || []), forwardedPort.port])
    }

    for (const provider of this.portAttributesProviders) {
      for (const [pid, ports] of grouped) {
        const firstCandidate = ports.map((port) => candidateByPort.get(port)).find(Boolean)
        const provided = await provider.providePortAttributes(ports, pid, firstCandidate?.detail, NONE_TOKEN)
        for (const item of provided) {
          const existing = attributes.get(item.port) || {}
          attributes.set(item.port, {
            ...existing,
            onAutoForward: existing.onAutoForward ?? providedActionToAction(item.autoForwardAction),
          })
        }
      }
    }

    return attributes
  }

  setPortAttributes(attributes: PortAttributesSetting): void {
    this.attributeSetting = { ...attributes }
    this.parsedAttributes = parsePortAttributes(this.attributeSetting)
  }

  addPortAttributesProvider(provider: PortAttributesProvider): WorkbenchDisposable {
    this.portAttributesProviders.push(provider)
    return {
      dispose: () => {
        const index = this.portAttributesProviders.indexOf(provider)
        if (index >= 0) this.portAttributesProviders.splice(index, 1)
      },
    }
  }

  getForwardedPorts(): ForwardedPort[] {
    return sortedPorts([...this.forwarded.values()])
  }

  getDetectedPorts(): ForwardedPort[] {
    return sortedPorts([...this.detected.values()])
  }

  getProjection(): PortForwardingProjection {
    return {
      source: "portForwardingService",
      forwarded: this.getForwardedPorts(),
      detected: this.getDetectedPorts(),
      candidates: this.getCandidateProjection(),
      actions: createActionProjection(),
      features: {
        hasTunnelProvider: this.hasTunnelProvider,
        canElevate: this.canElevate,
        canChangePrivacy: this.canChangePrivacy,
        canChangeProtocol: this.canChangeProtocol,
        privacyOptions: [...this.privacyOptions],
      },
      evidence: createPortForwardingEvidence(),
    }
  }

  private getTunnelRecord(remoteHost: string, remotePort: number): TunnelRecord | undefined {
    return findAddress(this.tunnels, remoteHost, remotePort)
  }

  private toForwardedPort(tunnel: RemoteTunnel, options: Partial<TunnelProperties> & { closeable?: boolean } = {}): ForwardedPort {
    const host = normalizeHost(tunnel.tunnelRemoteHost)
    const port = tunnel.tunnelRemotePort
    const candidate = findAddress(this.candidates, host, port)
    const protocol = normalizeProtocol(options.protocol ?? tunnel.protocol)
    const privacy = options.privacy ?? tunnel.privacy
    const now = this.now()
    return {
      id: this.createId("port", host, port),
      remoteHost: host,
      remotePort: port,
      localAddress: tunnel.localAddress,
      localPort: tunnel.tunnelLocalPort ?? parseLocalPort(tunnel.localAddress) ?? options.local,
      localUri: `${protocol}://${tunnel.localAddress}`,
      name: options.name,
      closeable: options.closeable ?? true,
      privacy,
      privacyLabel: privacyLabel(privacy, this.privacyOptionsValue),
      protocol,
      runningProcess: candidate?.detail,
      hasRunningProcess: Boolean(candidate),
      pid: candidate?.pid,
      source: options.source ?? USER_TUNNEL_SOURCE,
      createdAt: now,
      updatedAt: now,
    }
  }

  private getConfigAttributes(port: number, host: string, commandLine: string | undefined): PortForwardingAttributes | undefined {
    let result: PortForwardingAttributes = {}
    let matched = false
    for (const item of this.parsedAttributes) {
      if (!matchesAttribute(item.key, port, normalizeHost(host), commandLine)) continue
      matched = true
      result = {
        label: result.label ?? item.attributes.label,
        onAutoForward: result.onAutoForward ?? item.attributes.onAutoForward,
        elevateIfNeeded: result.elevateIfNeeded ?? item.attributes.elevateIfNeeded,
        requireLocalPort: result.requireLocalPort ?? item.attributes.requireLocalPort,
        protocol: result.protocol ?? item.attributes.protocol,
      }
    }
    return matched ? result : undefined
  }

  private getCandidateProjection(): CandidatePortProjection[] {
    return sortedCandidates([...this.candidates.values()]).map((candidate) => {
      const attr = this.candidateAttributes.get(candidate.port)
      return {
        ...candidate,
        id: this.createId("candidate", candidate.host, candidate.port),
        attributeLabel: attr?.label || "",
        autoForwardAction: attr?.onAutoForward || "",
        protocol: attr?.protocol || "",
      }
    })
  }

  private isPortPrivileged(port: number): boolean {
    return this.hooks.isPortPrivileged?.(port) ?? port < 1024
  }

  private now(): number {
    return this.hooks.now?.() ?? Date.now()
  }

  private createId(prefix: string, host: string, port: number): string {
    return this.hooks.createId?.(prefix, host, port) ?? `${prefix}:${host}:${port}`
  }
}

export const globalPortForwardingService = new CodekPortForwardingService()
registerSingleton(IPortForwardingService, globalPortForwardingService, InstantiationType.Delayed)

export function createPortForwardingEvidence(actionKind?: PortForwardingActionKind): PortForwardingEvidence {
  return {
    serviceId: "portForwardingService",
    stateSource: "CodekPortForwardingService",
    workspaceMutation: "none",
    preservesAgentEvidence: true,
    safetyBoundary: "Port forwarding actions only mutate the tunnel provider lifecycle; Git index and workspace files are untouched.",
    actionKind,
  }
}

export function privacyLabel(privacy: string | undefined, options: readonly TunnelPrivacyOption[] = []): string {
  const match = options.find((option) => option.id === privacy)
  if (match) return match.label
  switch (privacy) {
    case TunnelPrivacyId.Public:
      return "Public"
    case TunnelPrivacyId.ConstantPrivate:
      return "Private (managed)"
    case TunnelPrivacyId.Private:
    default:
      return "Private"
  }
}

export function providedActionToAction(action: ProvidedOnAutoForward | undefined): OnPortForward | undefined {
  switch (action) {
    case ProvidedOnAutoForward.Notify:
      return "notify"
    case ProvidedOnAutoForward.OpenBrowser:
      return "openBrowser"
    case ProvidedOnAutoForward.OpenBrowserOnce:
      return "openBrowserOnce"
    case ProvidedOnAutoForward.OpenPreview:
      return "openPreview"
    case ProvidedOnAutoForward.Silent:
      return "silent"
    case ProvidedOnAutoForward.Ignore:
      return "ignore"
    default:
      return undefined
  }
}

function createActionProjection(): PortForwardingActionProjection[] {
  const actions: Array<Omit<PortForwardingActionProjection, "workspaceMutation" | "evidence">> = [
    { id: "ports.forward.open", label: "Forward Port", kind: "open", commandId: "ports.forward.open" },
    { id: "ports.forward.openBrowser", label: "Open in Browser", kind: "open", commandId: "ports.forward.openBrowser" },
    { id: "ports.forward.close", label: "Close Forwarded Port", kind: "close", commandId: "ports.forward.close" },
    { id: "ports.forward.reopen", label: "Reopen Forwarded Port", kind: "reopen", commandId: "ports.forward.reopen" },
  ]
  return actions.map((action) => ({
    ...action,
    workspaceMutation: "none" as const,
    evidence: createPortForwardingEvidence(action.kind),
  }))
}

function parsePortAttributes(setting: PortAttributesSetting): ParsedPortAttribute[] {
  return Object.entries(setting)
    .map(([key, attributes], order): ParsedPortAttribute | null => {
      const parsed = parseAttributeKey(key)
      return parsed ? { key: parsed, attributes: { ...attributes }, order } : null
    })
    .filter((item): item is ParsedPortAttribute => Boolean(item))
    .sort((left, right) => attributeSortValue(left.key) - attributeSortValue(right.key) || left.order - right.order)
}

function parseAttributeKey(key: string): number | PortRange | RegExp | HostAndPort | undefined {
  if (/^\d+$/.test(key)) return Number(key)
  const range = /^(\d+)-(\d+)$/.exec(key)
  if (range) return { start: Number(range[1]), end: Number(range[2]) }
  const hostAndPort = /^([a-zA-Z0-9_.-]+):(\d{1,5})$/.exec(key)
  if (hostAndPort) return { host: normalizeHost(hostAndPort[1]), port: Number(hostAndPort[2]) }
  try {
    return new RegExp(key)
  } catch {
    return undefined
  }
}

function matchesAttribute(key: number | PortRange | RegExp | HostAndPort, port: number, host: string, commandLine: string | undefined): boolean {
  if (typeof key === "number") return !shouldUseHost(host) && key === port
  if (key instanceof RegExp) return commandLine ? key.test(commandLine) : false
  if ("start" in key) return !shouldUseHost(host) && port >= key.start && port <= key.end
  return key.host === host && key.port === port
}

function attributeSortValue(key: number | PortRange | RegExp | HostAndPort): number {
  if (typeof key === "number") return key
  if (key instanceof RegExp) return Number.MAX_VALUE
  if ("start" in key) return key.start
  return key.port
}

function shouldReopen(existing: ForwardedPort, properties: TunnelProperties, attributes: PortForwardingAttributes | undefined): boolean {
  const protocol = normalizeProtocol(properties.protocol ?? attributes?.protocol ?? existing.protocol)
  return Boolean(
    (properties.privacy && properties.privacy !== existing.privacy) ||
    (protocol && protocol !== existing.protocol),
  )
}

function findAddress<T>(map: Map<string, T>, host: string, port: number): T | undefined {
  const normalizedHost = normalizeHost(host)
  const direct = map.get(makeAddress(normalizedHost, port))
  if (direct) return direct
  const hosts = isLocalhost(normalizedHost)
    ? [...LOCALHOST_ADDRESSES, ...ALL_INTERFACES_ADDRESSES]
    : isAllInterfaces(normalizedHost)
      ? ALL_INTERFACES_ADDRESSES
      : [normalizedHost]
  for (const candidate of hosts) {
    const value = map.get(makeAddress(candidate, port))
    if (value) return value
  }
  return undefined
}

function makeAddress(host: string, port: number): string {
  return `${normalizeHost(host)}:${port}`
}

function normalizeHost(host: string | undefined): string {
  return host && host.trim() ? host.trim() : "localhost"
}

function isLocalhost(host: string): boolean {
  return LOCALHOST_ADDRESSES.includes(host)
}

function isAllInterfaces(host: string): boolean {
  return ALL_INTERFACES_ADDRESSES.includes(host)
}

function shouldUseHost(host: string): boolean {
  return !isLocalhost(host) && !isAllInterfaces(host)
}

function parseLocalPort(localAddress: string): number | undefined {
  const match = /:(\d+)$/.exec(localAddress)
  return match ? Number(match[1]) : undefined
}

function normalizeProtocol(protocol: string | undefined): TunnelProtocol | `${TunnelProtocol}` {
  return protocol === TunnelProtocol.Https ? TunnelProtocol.Https : TunnelProtocol.Http
}

function narrowProtocol(protocol: string | undefined): TunnelProtocol | `${TunnelProtocol}` | undefined {
  if (protocol === TunnelProtocol.Https) return TunnelProtocol.Https
  if (protocol === TunnelProtocol.Http) return TunnelProtocol.Http
  return undefined
}

function sortedPorts(ports: ForwardedPort[]): ForwardedPort[] {
  return [...ports].sort((left, right) => left.remotePort - right.remotePort || left.remoteHost.localeCompare(right.remoteHost))
}

function sortedCandidates(candidates: CandidatePort[]): CandidatePort[] {
  return [...candidates].sort((left, right) => left.port - right.port || left.host.localeCompare(right.host))
}
