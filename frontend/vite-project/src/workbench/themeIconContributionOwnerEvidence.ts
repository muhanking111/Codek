import { workbenchThemeService, type IWorkbenchThemeService } from "../vscode-adapter/platform/theme/common/themeService"
import { getRegisteredProductIcons } from "./productIcons"
import {
  type WorkbenchContributionRegistry,
  getWorkbenchContributionRegistryProjection,
} from "./workbenchContributionRegistry"

export interface ThemeIconContributionOwnerEvidence {
  schemaVersion: 1
  themeServiceOwner: "workbenchThemeService"
  iconRegistryOwner: "productIconsRegistry"
  contributionRegistryOwner: "workbenchContributionRegistry"
  themeSource: "vscode-adapter/platform/theme/common/themeService.ts"
  iconSource: "workbench/productIcons.ts"
  contributionSource: "workbench/workbenchContributionRegistry.ts"
  activationPhaseOwner: "workbenchContributionRegistry.start"
  ownerConnectionStatus: "partial"
  remainingUiOwnerGap: string[]
  runtimeReferences: {
    sourceMirrorRuntimeReference: false
    networkResourceFetch: false
    externalRuntimeDependency: false
  }
  theme: {
    stateSource: "workbenchThemeService"
    colorTheme: string | null
    fileIconTheme: string | null
    productIconTheme: string | null
    serviceIds: readonly ["IThemeService", "IWorkbenchThemeService"]
  }
  icons: {
    stateSource: "productIconsRegistry"
    registeredProductIconCount: number
    networkResourceFetch: false
  }
  contributions: {
    stateSource: "workbenchContributionRegistry"
    lifecyclePhase: string
    registeredContributionIds: string[]
    startedContributionIds: string[]
    failedContributionIds: string[]
  }
}

export interface ThemeIconContributionOwnerEvidenceOptions {
  themeService?: IWorkbenchThemeService
  contributionRegistry?: WorkbenchContributionRegistry
}

export function getThemeIconContributionOwnerEvidence(
  options: ThemeIconContributionOwnerEvidenceOptions = {},
): ThemeIconContributionOwnerEvidence {
  const themeService = options.themeService ?? workbenchThemeService
  const contributionProjection = options.contributionRegistry
    ? options.contributionRegistry.getProjection()
    : getWorkbenchContributionRegistryProjection()

  const contributions = contributionProjection.contributions

  return {
    schemaVersion: 1,
    themeServiceOwner: "workbenchThemeService",
    iconRegistryOwner: "productIconsRegistry",
    contributionRegistryOwner: "workbenchContributionRegistry",
    themeSource: "vscode-adapter/platform/theme/common/themeService.ts",
    iconSource: "workbench/productIcons.ts",
    contributionSource: "workbench/workbenchContributionRegistry.ts",
    activationPhaseOwner: "workbenchContributionRegistry.start",
    ownerConnectionStatus: "partial",
    remainingUiOwnerGap: [
      "Workbench contribution UI owner 仍需 App.vue/generic shell 接入，本 contract 只证明 registry/service owner。",
    ],
    runtimeReferences: {
      sourceMirrorRuntimeReference: false,
      networkResourceFetch: false,
      externalRuntimeDependency: false,
    },
    theme: {
      stateSource: "workbenchThemeService",
      colorTheme: themeService.getColorTheme().settingsId,
      fileIconTheme: themeService.getFileIconTheme().settingsId,
      productIconTheme: themeService.getProductIconTheme().settingsId,
      serviceIds: ["IThemeService", "IWorkbenchThemeService"],
    },
    icons: {
      stateSource: "productIconsRegistry",
      registeredProductIconCount: getRegisteredProductIcons().length,
      networkResourceFetch: false,
    },
    contributions: {
      stateSource: "workbenchContributionRegistry",
      lifecyclePhase: contributionProjection.lifecycle.phase,
      registeredContributionIds: contributions.map((contribution) => contribution.id),
      startedContributionIds: contributions
        .filter((contribution) => contribution.state === "started")
        .map((contribution) => contribution.id),
      failedContributionIds: contributions
        .filter((contribution) => contribution.state === "failed")
        .map((contribution) => contribution.id),
    },
  }
}
