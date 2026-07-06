// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\platform\quickinput\common\quickAccess.ts
// - D:\SourceMirror\vscode\src\vs\platform\quickinput\browser\quickAccess.ts

import type { IDisposable } from "../../../base/common/lifecycle"
import { CancellationToken, CancellationTokenSource } from "../../../base/common/cancellation"
import { InstantiationType, registerSingleton } from "../../instantiation/common/extensions"
import { createDecorator } from "../../instantiation/common/instantiation"

export interface QuickAccessItem {
  id: string
  label: string
  description?: string
  detail?: string
  commandId?: string
  args?: unknown[]
  acceptInBackground?: boolean
  accept?: () => void | Promise<void>
  buttons?: QuickAccessItemButton[]
}

export interface QuickAccessItemButton {
  id: string
  label?: string
  tooltip?: string
  acceptInBackground?: boolean
  accept?: () => void | Promise<void>
}

export interface QuickAccessProviderRunOptions {
  from?: string
  placeholder?: string
  token?: CancellationToken
  signal?: AbortSignal
}

export interface QuickAccessProvider {
  defaultFilterValue?: string
  provide(filter: string, options?: QuickAccessProviderRunOptions): QuickAccessItem[] | Promise<QuickAccessItem[]>
}

export interface QuickAccessProviderHelp {
  prefix?: string
  description: string
  commandId?: string
  commandCenterLabel?: string
  commandCenterOrder?: number
}

export interface QuickAccessProviderDescriptor {
  prefix: string
  placeholder?: string
  helpEntries?: QuickAccessProviderHelp[]
  provider: QuickAccessProvider
}

export interface QuickAccessProviderMatch {
  descriptor: QuickAccessProviderDescriptor
  filter: string
}

export interface QuickAccessControllerProvideOptions extends QuickAccessProviderRunOptions {
  token?: CancellationToken
  signal?: AbortSignal
}

export interface QuickAccessControllerResult {
  descriptor?: QuickAccessProviderDescriptor
  filter: string
  items: QuickAccessItem[]
}

export interface QuickAccessControllerLastProvideEvidence extends QuickAccessControllerResult {
  from: string
}

export interface QuickAccessController {
  readonly _serviceBrand: undefined
  registerQuickAccessProvider(descriptor: QuickAccessProviderDescriptor): IDisposable
  getQuickAccessProviders(): QuickAccessProviderDescriptor[]
  matchProvider(value: string): QuickAccessProviderMatch | undefined
  provide(value: string, options?: QuickAccessControllerProvideOptions): Promise<QuickAccessControllerResult>
  getLastProvideEvidence(): QuickAccessControllerLastProvideEvidence | undefined
  clear(): void
}

export interface QuickAccessOwnerEvidenceSnapshot {
  owner: "IQuickAccessController/quickAccessController"
  stateSource: "quickAccessRegistry+quickAccessController"
  connected: true
  noSecondStateSource: true
  readonlyEvidence: true
  providerPrefixes: string[]
  matchedPrefix?: string
  matchedFilter?: string
  commandRoutingOwner: {
    owner: "QuickAccessItem.commandId"
    stateSource: "quickAccessController.provide"
    connected: boolean
    readonlyEvidence: true
    routedCommandIds: string[]
    itemButtonIds: string[]
  }
  remainingUiOwnerGap: {
    owner: "CommandPalette/F1 quick access UI owner"
    state: "partial"
    connected: false
    blockedBy: "components/CommandPalette.vue/App.vue own the physical picker and F1 palette ref"
    nextOwnerFiles: readonly ["App.vue", "components/CommandPalette.vue", "generic workbench shell"]
  }
}

class QuickAccessRegistry {
  private readonly descriptors: QuickAccessProviderDescriptor[] = []
  private readonly defaultDescriptors: QuickAccessProviderDescriptor[] = []

  registerQuickAccessProvider(descriptor: QuickAccessProviderDescriptor): IDisposable {
    if (descriptor.prefix === "") {
      this.defaultDescriptors.unshift(descriptor)
    } else {
      this.descriptors.unshift(descriptor)
      this.descriptors.sort((left, right) => right.prefix.length - left.prefix.length)
    }
    return {
      dispose: () => {
        removeDescriptor(this.descriptors, descriptor)
        removeDescriptor(this.defaultDescriptors, descriptor)
      },
    }
  }

  getQuickAccessProviders(): QuickAccessProviderDescriptor[] {
    return [
      ...(this.defaultDescriptors[0] ? [this.defaultDescriptors[0]] : []),
      ...this.descriptors,
    ]
  }

  matchProvider(value: string): QuickAccessProviderMatch | undefined {
    const input = String(value || "")
    const descriptor = this.descriptors.find((candidate) => input.startsWith(candidate.prefix)) || this.defaultDescriptors[0]
    if (!descriptor) return undefined
    return {
      descriptor,
      filter: input.slice(descriptor.prefix.length),
    }
  }

  clear(): void {
    this.descriptors.splice(0)
    this.defaultDescriptors.splice(0)
  }
}

export const quickAccessRegistry = new QuickAccessRegistry()
export const IQuickAccessController = createDecorator<QuickAccessController>("quickAccessController")

class WorkbenchQuickAccessController implements QuickAccessController {
  declare readonly _serviceBrand: undefined

  private generation = 0
  private lastProvideEvidence: QuickAccessControllerLastProvideEvidence | undefined

  constructor(private readonly registry: QuickAccessRegistry = quickAccessRegistry) {}

  registerQuickAccessProvider(descriptor: QuickAccessProviderDescriptor): IDisposable {
    return this.registry.registerQuickAccessProvider(descriptor)
  }

  getQuickAccessProviders(): QuickAccessProviderDescriptor[] {
    return this.registry.getQuickAccessProviders()
  }

  matchProvider(value: string): QuickAccessProviderMatch | undefined {
    return this.registry.matchProvider(value)
  }

  async provide(value: string, options: QuickAccessControllerProvideOptions = {}): Promise<QuickAccessControllerResult> {
    const input = String(value || "")
    const match = this.matchProvider(input)
    if (!match) {
      return this.setLastProvideEvidence({ from: input, filter: input, items: [] })
    }

    const requestId = ++this.generation
    const cts = new CancellationTokenSource(options.token)
    const signalDisposable = bridgeAbortSignal(options.signal, () => cts.cancel())
    try {
      if (options.token?.isCancellationRequested || options.signal?.aborted) {
        return this.setLastProvideEvidence({ from: input, descriptor: match.descriptor, filter: match.filter, items: [] })
      }
      const items = await Promise.resolve(match.descriptor.provider.provide(match.filter, {
        from: options.from ?? input,
        placeholder: options.placeholder ?? match.descriptor.placeholder,
        token: cts.token,
        signal: options.signal,
      }))
      if (requestId !== this.generation || cts.token.isCancellationRequested || options.signal?.aborted) {
        return this.setLastProvideEvidence({ from: input, descriptor: match.descriptor, filter: match.filter, items: [] })
      }
      return this.setLastProvideEvidence({
        from: input,
        descriptor: match.descriptor,
        filter: match.filter,
        items,
      })
    } catch {
      return this.setLastProvideEvidence({ from: input, descriptor: match.descriptor, filter: match.filter, items: [] })
    } finally {
      signalDisposable.dispose()
      cts.dispose()
    }
  }

  getLastProvideEvidence(): QuickAccessControllerLastProvideEvidence | undefined {
    return this.lastProvideEvidence
  }

  clear(): void {
    this.generation += 1
    this.lastProvideEvidence = undefined
    this.registry.clear()
  }

  private setLastProvideEvidence(result: QuickAccessControllerLastProvideEvidence): QuickAccessControllerResult {
    this.lastProvideEvidence = {
      ...result,
      items: [...result.items],
    }
    return {
      descriptor: result.descriptor,
      filter: result.filter,
      items: result.items,
    }
  }
}

export const quickAccessController: QuickAccessController = new WorkbenchQuickAccessController()
registerSingleton(IQuickAccessController, quickAccessController, InstantiationType.Delayed)

export function registerQuickAccessProvider(descriptor: QuickAccessProviderDescriptor): IDisposable {
  return quickAccessController.registerQuickAccessProvider(descriptor)
}

export function getQuickAccessProviders(): QuickAccessProviderDescriptor[] {
  return quickAccessController.getQuickAccessProviders()
}

export function matchQuickAccessProvider(value: string): QuickAccessProviderMatch | undefined {
  return quickAccessController.matchProvider(value)
}

export function clearQuickAccessProviders(): void {
  quickAccessController.clear()
}

export function getQuickAccessOwnerEvidenceSnapshot(value = ""): QuickAccessOwnerEvidenceSnapshot {
  const providers = quickAccessController.getQuickAccessProviders()
  const match = quickAccessController.matchProvider(value)
  const lastProvide = quickAccessController.getLastProvideEvidence()
  const items = lastProvide && lastProvide.from === value ? lastProvide.items : []
  const routedCommandIds = uniqueSorted([
    ...items
      .map((item) => item.commandId)
      .filter((commandId): commandId is string => !!commandId),
    ...(match?.descriptor.helpEntries || [])
      .map((entry) => entry.commandId)
      .filter((commandId): commandId is string => !!commandId),
  ])
  const itemButtonIds = uniqueSorted(items
    .flatMap((item) => item.buttons || [])
    .map((button) => button.id)
    .filter(Boolean))

  return {
    owner: "IQuickAccessController/quickAccessController",
    stateSource: "quickAccessRegistry+quickAccessController",
    connected: true,
    noSecondStateSource: true,
    readonlyEvidence: true,
    providerPrefixes: providers.map((provider) => provider.prefix),
    matchedPrefix: match?.descriptor.prefix,
    matchedFilter: match?.filter,
    commandRoutingOwner: {
      owner: "QuickAccessItem.commandId",
      stateSource: "quickAccessController.provide",
      connected: routedCommandIds.length > 0,
      readonlyEvidence: true,
      routedCommandIds,
      itemButtonIds,
    },
    remainingUiOwnerGap: {
      owner: "CommandPalette/F1 quick access UI owner",
      state: "partial",
      connected: false,
      blockedBy: "components/CommandPalette.vue/App.vue own the physical picker and F1 palette ref",
      nextOwnerFiles: ["App.vue", "components/CommandPalette.vue", "generic workbench shell"],
    },
  }
}

function bridgeAbortSignal(signal: AbortSignal | undefined, cancel: () => void): IDisposable {
  if (!signal) return { dispose() {} }
  if (signal.aborted) {
    cancel()
    return { dispose() {} }
  }
  const listener = () => cancel()
  signal.addEventListener("abort", listener, { once: true })
  return { dispose: () => signal.removeEventListener("abort", listener) }
}

function removeDescriptor(descriptors: QuickAccessProviderDescriptor[], descriptor: QuickAccessProviderDescriptor): void {
  const index = descriptors.indexOf(descriptor)
  if (index !== -1) descriptors.splice(index, 1)
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}
