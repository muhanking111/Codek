import { beforeEach, describe, expect, it, vi } from "vitest"
import { createRufloAdapter, DisabledRufloAdapter } from "./rufloAdapter"
import { settingsStore } from "../settings/settingsStore"

describe("ruflo adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    settingsStore.reset()
  })

  it("is disabled and unavailable by default", () => {
    const adapter = createRufloAdapter()

    expect(adapter).toBeInstanceOf(DisabledRufloAdapter)
    expect(adapter.status()).toEqual({
      enabled: false,
      mode: "disabled",
      available: false,
      reason: expect.stringContaining("reserved for v2"),
    })
  })

  it("reports external-cli settings without making Ruflo available in v1", () => {
    settingsStore.update({
      "codek.orchestration.ruflo.enabled": true,
      "codek.orchestration.ruflo.mode": "external-cli",
    })

    expect(createRufloAdapter().status()).toEqual({
      enabled: true,
      mode: "external-cli",
      available: false,
      reason: expect.stringContaining("does not execute external CLI calls in v1"),
    })
  })

  it("rejects external planning instead of invoking a command", async () => {
    await expect(createRufloAdapter().planExternalRun("run swarm")).rejects.toThrow(
      "Ruflo adapter is disabled in v1",
    )
  })
})
