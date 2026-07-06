import { beforeEach, describe, expect, it } from "vitest"
import { CancellationTokenSource } from "../../../base/common/cancellation"
import { getSingletonServiceDescriptors } from "../../../platform/instantiation/common/extensions"
import { ServiceCollection } from "../../../platform/instantiation/common/serviceCollection"
import {
  clearQuickAccessProviders,
  getQuickAccessOwnerEvidenceSnapshot,
  IQuickAccessController,
  quickAccessController,
  getQuickAccessProviders,
  matchQuickAccessProvider,
  registerQuickAccessProvider,
} from "./quickAccess"

describe("VS Code QuickAccess registry adapter", () => {
  beforeEach(() => {
    clearQuickAccessProviders()
  })

  it("registers and disposes provider descriptors", () => {
    const disposable = registerQuickAccessProvider({
      prefix: "mcp:",
      provider: { provide: () => [] },
      helpEntries: [{ description: "MCP Resources" }],
    })

    expect(getQuickAccessProviders()).toHaveLength(1)
    expect(matchQuickAccessProvider("mcp:files")).toMatchObject({
      filter: "files",
      descriptor: { prefix: "mcp:" },
    })

    disposable.dispose()

    expect(getQuickAccessProviders()).toHaveLength(0)
    expect(matchQuickAccessProvider("mcp:files")).toBeUndefined()
  })

  it("prefers the longest matching provider prefix", () => {
    registerQuickAccessProvider({ prefix: "m", provider: { provide: () => [] } })
    registerQuickAccessProvider({ prefix: "mcp:", provider: { provide: () => [] } })

    expect(matchQuickAccessProvider("mcp:resources")?.descriptor.prefix).toBe("mcp:")
  })

  it("registers and resolves the VS Code-style IQuickAccessController identifier", async () => {
    const collection = new ServiceCollection([IQuickAccessController, quickAccessController])
    const resolved = collection.get(IQuickAccessController)
    const singleton = getSingletonServiceDescriptors().find(([id]) => id === IQuickAccessController)

    registerQuickAccessProvider({
      prefix: "mcp:",
      provider: { provide: (filter) => [{ id: "mcp.resources", label: `Resources ${filter}` }] },
    })

    expect(String(IQuickAccessController)).toBe("quickAccessController")
    expect(resolved).toBe(quickAccessController)
    expect(singleton?.[1]).toBe(quickAccessController)
    await expect(resolved?.provide("mcp:tools")).resolves.toEqual({
      descriptor: expect.objectContaining({ prefix: "mcp:" }),
      filter: "tools",
      items: [{ id: "mcp.resources", label: "Resources tools" }],
    })
  })

  it("supports default providers and no-provider fallback through the controller surface", async () => {
    await expect(quickAccessController.provide("missing")).resolves.toEqual({
      descriptor: undefined,
      filter: "missing",
      items: [],
    })

    registerQuickAccessProvider({
      prefix: "",
      provider: { provide: (filter) => [{ id: "default", label: `Default ${filter}` }] },
    })

    expect(matchQuickAccessProvider("plain text")).toMatchObject({
      filter: "plain text",
      descriptor: { prefix: "" },
    })
    await expect(quickAccessController.provide("plain text")).resolves.toEqual({
      descriptor: expect.objectContaining({ prefix: "" }),
      filter: "plain text",
      items: [{ id: "default", label: "Default plain text" }],
    })
  })

  it("restores the previous default provider when a later default contribution is disposed", async () => {
    const first = registerQuickAccessProvider({
      prefix: "",
      provider: { provide: (filter) => [{ id: "first", label: `First ${filter}` }] },
    })
    const second = registerQuickAccessProvider({
      prefix: "",
      provider: { provide: (filter) => [{ id: "second", label: `Second ${filter}` }] },
    })

    await expect(quickAccessController.provide("plain")).resolves.toMatchObject({
      items: [{ id: "second", label: "Second plain" }],
    })

    second.dispose()
    await expect(quickAccessController.provide("plain")).resolves.toMatchObject({
      items: [{ id: "first", label: "First plain" }],
    })

    first.dispose()
    await expect(quickAccessController.provide("plain")).resolves.toMatchObject({ items: [] })
  })

  it("discards stale and cancelled provider results", async () => {
    let resolveSlow: ((items: { id: string; label: string }[]) => void) | undefined
    registerQuickAccessProvider({
      prefix: "mcp:",
      provider: {
        provide: (filter) => filter === "slow"
          ? new Promise((resolve) => { resolveSlow = resolve })
          : [{ id: "fast", label: `Fast ${filter}` }],
      },
    })

    const slow = quickAccessController.provide("mcp:slow")
    const fast = quickAccessController.provide("mcp:fast")
    resolveSlow?.([{ id: "slow", label: "Slow" }])

    await expect(fast).resolves.toMatchObject({ items: [{ id: "fast", label: "Fast fast" }] })
    await expect(slow).resolves.toMatchObject({ items: [] })

    const cts = new CancellationTokenSource()
    const cancelled = quickAccessController.provide("mcp:slow", { token: cts.token })
    cts.cancel()
    resolveSlow?.([{ id: "cancelled", label: "Cancelled" }])
    await expect(cancelled).resolves.toMatchObject({ items: [] })
  })

  it("passes AbortSignal cancellation into providers through the QuickAccess controller contract", async () => {
    const abort = new AbortController()
    let providerSignal: AbortSignal | undefined
    registerQuickAccessProvider({
      prefix: "ext ",
      provider: {
        provide: (_filter, options) => {
          providerSignal = options?.signal
          return [{ id: "extension", label: "Extension" }]
        },
      },
    })

    await expect(quickAccessController.provide("ext sample", { signal: abort.signal })).resolves.toMatchObject({
      items: [{ id: "extension", label: "Extension" }],
    })

    expect(providerSignal).toBe(abort.signal)
  })

  it("projects QuickAccess owner evidence from provider descriptors and routed command items", async () => {
    registerQuickAccessProvider({
      prefix: ">",
      placeholder: "Type a command",
      helpEntries: [{ description: "Commands", commandId: "workbench.action.showCommands" }],
      provider: {
        provide: (filter) => [{
          id: "workbench.action.showCommands",
          label: `Show Commands ${filter}`,
          commandId: "workbench.action.showCommands",
          args: ["from-quick-access"],
          buttons: [{ id: "configure", tooltip: "Configure Keybinding" }],
        }],
      },
    })

    await expect(quickAccessController.provide(">show")).resolves.toMatchObject({
      filter: "show",
      items: [{ commandId: "workbench.action.showCommands" }],
    })
    const evidence = getQuickAccessOwnerEvidenceSnapshot(">show")

    expect(evidence).toMatchObject({
      owner: "IQuickAccessController/quickAccessController",
      stateSource: "quickAccessRegistry+quickAccessController",
      connected: true,
      noSecondStateSource: true,
      readonlyEvidence: true,
      providerPrefixes: [">"],
      matchedPrefix: ">",
      matchedFilter: "show",
      commandRoutingOwner: {
        owner: "QuickAccessItem.commandId",
        stateSource: "quickAccessController.provide",
        connected: true,
        readonlyEvidence: true,
      },
      remainingUiOwnerGap: {
        owner: "CommandPalette/F1 quick access UI owner",
        state: "partial",
        connected: false,
      },
    })
    expect(evidence.commandRoutingOwner.routedCommandIds).toEqual(["workbench.action.showCommands"])
    expect(evidence.commandRoutingOwner.itemButtonIds).toEqual(["configure"])
  })
})
