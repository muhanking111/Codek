import { describe, expect, it } from "vitest"
import { workbenchThemeService } from "../vscode-adapter/platform/theme/common/themeService"
import { registerProductIcon } from "./productIcons"
import { createWorkbenchContributionRegistry } from "./workbenchContributionRegistry"
import { getThemeIconContributionOwnerEvidence } from "./themeIconContributionOwnerEvidence"

describe("Theme/Icon/Workbench contribution owner evidence", () => {
  it("projects stable owner/source evidence from the existing registries only", () => {
    const registry = createWorkbenchContributionRegistry()
    registry.register({
      id: "theme-icon-owner-smoke",
      phase: "ready",
      source: "vscode",
      serviceIds: ["IThemeService"],
      commandIds: ["workbench.action.selectTheme"],
      evidence: {
        source: "contract-test",
        data: { owner: "WorkbenchContributionsRegistry" },
      },
      start: () => undefined,
    })
    registry.start({}, { throughPhase: "ready", now: () => 100 })

    const evidence = getThemeIconContributionOwnerEvidence({
      themeService: workbenchThemeService,
      contributionRegistry: registry,
    })

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      themeServiceOwner: "workbenchThemeService",
      iconRegistryOwner: "productIconsRegistry",
      contributionRegistryOwner: "workbenchContributionRegistry",
      themeSource: "vscode-adapter/platform/theme/common/themeService.ts",
      iconSource: "workbench/productIcons.ts",
      contributionSource: "workbench/workbenchContributionRegistry.ts",
      activationPhaseOwner: "workbenchContributionRegistry.start",
      ownerConnectionStatus: "partial",
      runtimeReferences: {
        sourceMirrorRuntimeReference: false,
        networkResourceFetch: false,
        externalRuntimeDependency: false,
      },
    })
    expect(evidence.remainingUiOwnerGap).toContain(
      "Workbench contribution UI owner 仍需 App.vue/generic shell 接入，本 contract 只证明 registry/service owner。",
    )
    expect(evidence.theme.stateSource).toBe("workbenchThemeService")
    expect(evidence.icons.stateSource).toBe("productIconsRegistry")
    expect(evidence.contributions.stateSource).toBe("workbenchContributionRegistry")
    expect(evidence.contributions.registeredContributionIds).toEqual(["theme-icon-owner-smoke"])
    expect(evidence.runtimeReferences.sourceMirrorRuntimeReference).toBe(false)
    expect(evidence.runtimeReferences.externalRuntimeDependency).toBe(false)
  })

  it("does not use network fetches or a second icon state source for registry evidence", () => {
    const before = getThemeIconContributionOwnerEvidence().icons.registeredProductIconCount
    const disposable = registerProductIcon("owner-evidence-test", {
      codicon: "codicon-symbol-key",
      fontCharacter: "\\ea93",
    })

    try {
      const evidence = getThemeIconContributionOwnerEvidence()

      expect(evidence.icons.registeredProductIconCount).toBe(before + 1)
      expect(evidence.icons.networkResourceFetch).toBe(false)
      expect(evidence.icons.stateSource).toBe("productIconsRegistry")
      expect(evidence.iconRegistryOwner).toBe("productIconsRegistry")
    } finally {
      disposable.dispose()
    }

    expect(getThemeIconContributionOwnerEvidence().icons.registeredProductIconCount).toBe(before)
  })
})
