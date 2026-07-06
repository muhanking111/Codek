import { settingsStore } from "../settings/settingsStore"

export type RufloAdapterMode = "disabled" | "external-cli"

export interface RufloAdapterStatus {
  enabled: boolean
  mode: RufloAdapterMode
  available: boolean
  reason: string
}

export interface RufloAdapter {
  readonly kind: "ruflo"
  status(): RufloAdapterStatus
  planExternalRun(goal: string): Promise<never>
}

export class DisabledRufloAdapter implements RufloAdapter {
  readonly kind = "ruflo" as const

  status(): RufloAdapterStatus {
    return {
      enabled: settingsStore.get<boolean>("codek.orchestration.ruflo.enabled", false) === true,
      mode: normalizeMode(settingsStore.get<string>("codek.orchestration.ruflo.mode", "disabled")),
      available: false,
      reason: "Ruflo adapter is reserved for v2 and does not execute external CLI calls in v1.",
    }
  }

  async planExternalRun(): Promise<never> {
    throw new Error("Ruflo adapter is disabled in v1; Codek native orchestration remains the active path.")
  }
}

export function createRufloAdapter(): RufloAdapter {
  return new DisabledRufloAdapter()
}

function normalizeMode(value: string): RufloAdapterMode {
  return value === "external-cli" ? "external-cli" : "disabled"
}
