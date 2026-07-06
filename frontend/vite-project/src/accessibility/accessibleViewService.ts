import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { Action2, MenuId, registerAction2, type Action2Descriptor } from "../vscode-adapter/platform/actions/common/menuRegistry"
import type { Disposable } from "../vscode-adapter/platform/commands/common/commandsRegistry"
import type { IContextKey, IContextKeyService } from "../vscode-adapter/platform/contextkey/common/contextkey"
import type {
  AccessibilityActionEvidence,
  AccessibilityStatusProjection,
  AriaProjection,
  IAccessibilityKeyboardNavigationService,
} from "../workbench/accessibilityKeyboardNavigationService"
import type {
  WorkbenchShellLayoutProjection,
} from "../vscode-adapter/workbench/services/layout/browser/layoutService"
import { quickInputService, type QuickInputService } from "../workbench/quickInput"

export const ACCESSIBLE_VIEW_ACTION_IDS = {
  openAccessibleView: "editor.action.accessibleView",
  openAccessibilityHelp: "editor.action.accessibilityHelp",
  disableVerbosityHint: "editor.action.accessibleViewDisableHint",
  goToSymbol: "editor.action.accessibleViewGoToSymbol",
  showNext: "editor.action.accessibleViewNext",
  showPrevious: "editor.action.accessibleViewPrevious",
  acceptInlineCompletion: "editor.action.accessibleViewAcceptInlineCompletion",
  nextCodeBlock: "editor.action.accessibleViewNextCodeBlock",
  previousCodeBlock: "editor.action.accessibleViewPreviousCodeBlock",
  configureUnassignedKeybindings: "editor.action.accessibilityHelpConfigureKeybindings",
  configureAssignedKeybindings: "editor.action.accessibilityHelpConfigureAssignedKeybindings",
  openHelpLink: "editor.action.accessibilityHelpOpenHelpLink",
} as const

export const ACCESSIBLE_VIEW_CONTEXT_KEYS = {
  accessibilityHelpIsShown: "accessibilityHelpIsShown",
  accessibleViewIsShown: "accessibleViewIsShown",
  accessibleViewSupportsNavigation: "accessibleViewSupportsNavigation",
  accessibleViewVerbosityEnabled: "accessibleViewVerbosityEnabled",
  accessibleViewGoToSymbolSupported: "accessibleViewGoToSymbolSupported",
  accessibleViewOnLastLine: "accessibleViewOnLastLine",
  accessibleViewCurrentProviderId: "accessibleViewCurrentProviderId",
  accessibleViewInCodeBlock: "accessibleViewInCodeBlock",
  accessibleViewContainsCodeBlocks: "accessibleViewContainsCodeBlocks",
  accessibleViewHasUnassignedKeybindings: "accessibleViewHasUnassignedKeybindings",
  accessibleViewHasAssignedKeybindings: "accessibleViewHasAssignedKeybindings",
} as const

export type AccessibleViewCapabilityState = "available" | "partial" | "facade" | "blocked"

export type AccessibleViewProviderType = "help" | "view"

export interface AccessibleViewProviderImplementation {
  readonly type: AccessibleViewProviderType
  readonly priority: number
  readonly name: string
  readonly providerId: string
  readonly when?: string
  readonly createProvider?: AccessibleViewProviderFactory
}

export interface AccessibleViewProviderRegistrySnapshot {
  readonly source: "codek.accessibleView.providerRegistry"
  readonly implementations: readonly AccessibleViewProviderImplementation[]
}

export interface AccessibleViewCommandMenuContract {
  readonly menuId: "AccessibleView"
  readonly commandPaletteActionIds: readonly string[]
  readonly accessibleViewMenuActionIds: readonly string[]
  readonly contextKeys: typeof ACCESSIBLE_VIEW_CONTEXT_KEYS
}

export interface AccessibleViewWidgetContributionContract {
  readonly owner: "missing"
  readonly state: "blocked"
  readonly requiredOwner: "workbench.contrib.accessibility.AccessibleView"
  readonly vscodeOwnerPath: "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts"
  readonly missingSurfaces: readonly string[]
}

export interface AccessibleViewOwnerFeasibilityProjection {
  readonly source: "codek.accessibleView.ownerFeasibility"
  readonly owner: "missing" | "workbench-placement-adapter" | "editor-shell-focus-restore-adapter"
  readonly state: "blocked"
  readonly vscodeOwner: {
    readonly accessibleViewClassPath: "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts"
    readonly codeEditorWidgetPath: "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts"
    readonly editorServicePath: "src/vs/workbench/services/editor/common/editorService.ts"
    readonly contextViewPath: "src/vs/base/browser/ui/contextview/contextview.ts"
    readonly layoutServicePath: "src/vs/workbench/services/layout/browser/layoutService.ts"
  }
  readonly availableEvidence: {
    readonly providerLifecycleProjection: boolean
    readonly commandMenuProjection: boolean
    readonly domShellProjection: boolean
    readonly workbenchPlacementProjection?: boolean
    readonly editorShellFocusRestoreProjection?: boolean
    readonly projectedActiveEditor?: string
    readonly projectedFocusTargetId?: string
  }
  readonly missingOwners: readonly string[]
  readonly minimumSafeNextStep: "wire-workbench-placement-owner" | "wire-editor-shell-owner"
  readonly blockedReason: string
}

export interface AccessibleViewProviderLifecycleContract {
  readonly registryMetadata: AccessibleViewCapabilityState
  readonly providerFactoryInvocation: AccessibleViewCapabilityState
  readonly providerDisposalOnWidgetClose: AccessibleViewCapabilityState
  readonly lastProviderNavigation: AccessibleViewCapabilityState
  readonly requiredOwner: "AccessibleView workbench widget/editor contribution"
}

export interface AccessibleViewContextKeyUpdateContract {
  readonly staticContextKeyNames: typeof ACCESSIBLE_VIEW_CONTEXT_KEYS
  readonly menuContextProjection: AccessibleViewCapabilityState
  readonly showHideContextBinding: AccessibleViewCapabilityState
  readonly currentProviderContextBinding: AccessibleViewCapabilityState
  readonly requiredOwner: "AccessibleView show/hide widget lifecycle"
}

export interface AccessibleViewBlockedGap {
  readonly id: string
  readonly state: "blocked"
  readonly reason: string
  readonly requiredSurfaces: readonly string[]
}

export interface AccessibleViewTrueOwnerFollowUpProjection {
  readonly source: "codek.accessibleView.trueOwnerFollowUp"
  readonly state: "blocked"
  readonly noSecondAccessibilityState: true
  readonly attemptedMinimalOwnerDecision: {
    readonly decision: "blocked-contract"
    readonly reason: string
    readonly avoidedSurfaces: readonly string[]
  }
  readonly commandMenuSignalFocusEvidence: {
    readonly commandMenuProjection: {
      readonly menuId: "AccessibleView"
      readonly menuActionIds: readonly string[]
      readonly actionRegistryBacked: true
      readonly workbenchToolbarWidgetBacked: false
    }
    readonly signalProjection: {
      readonly stateSource: "AccessibilityKeyboardNavigationService"
      readonly liveRegionProjection: boolean
      readonly soundPlayback: AccessibleViewCapabilityState
      readonly progressSignalScheduler: AccessibleViewCapabilityState
    }
    readonly focusProjection: {
      readonly focusRestoreTargetOwner: AccessibleViewEditorShellFocusRestoreProjection["focusRestoreTargetOwner"]
      readonly focusRestoreInvocationOwner: AccessibleViewFocusRestoreInvocationProjection["focusRestoreInvocationOwner"]
      readonly activeEditor?: string | null
      readonly projectedFocusTargetId?: string
      readonly codeEditorWidgetBacked: false
    }
  }
  readonly requiredTrueOwners: readonly {
    readonly owner:
      | "CodeEditorWidget"
      | "IContextViewService/ILayoutService"
      | "WorkbenchToolBar + MenuId.AccessibleView"
      | "IQuickInputService.createQuickPick"
      | "IEditorService/CodeEditorWidget.focus"
    readonly state: "blocked"
    readonly vscodePath: string
    readonly codekEvidence:
      | "dom-shell-readonly-content-only"
      | "workbench-layout-placement-projection-only"
      | "menu-action-registry-only"
      | "generic-quick-input-surface-only"
      | "focus-target-projection-only"
    readonly blockedReason: string
  }[]
  readonly blockedIntegrationContract: {
    readonly owner: "AccessibleView workbench/editor shell owner"
    readonly state: "blocked"
    readonly requiredInterfaces: readonly string[]
    readonly requiredCodekEntryPoints: readonly {
      readonly path: string
      readonly state: "candidate" | "blocked"
      readonly reason: string
    }[]
    readonly nonReusableEvidenceSurfaces: readonly {
      readonly path: string
      readonly reason: string
    }[]
    readonly acceptanceEvidence: readonly string[]
    readonly blockedReason: string
  }
  readonly minimumSafeNextStep: "wire-real-accessible-view-workbench-owner"
  readonly blockedReason: string
  readonly vscodeParallels: readonly string[]
}

export interface AccessibleViewUiSurfaceAuditProjection {
  readonly source: "codek.accessibleView.uiSurfaceAudit"
  readonly state: "blocked"
  readonly noSecondAccessibilityState: true
  readonly foundAccessibleViewWorkbenchOwner: false
  readonly foundGenericQuickInputSurface: boolean
  readonly foundDomShellProjection: boolean
  readonly foundExplorerTreeAriaSurface: boolean
  readonly listTreeAriaEvidence: {
    readonly owner: "ExplorerTreeHost + CodekListView"
    readonly state: "available"
    readonly noSecondAccessibilityState: true
    readonly capabilities: {
      readonly widgetRoleFromListView: true
      readonly activeDescendantFromModelFocus: true
      readonly rowIdsFromRenderer: true
      readonly focusableTreeWidget: true
    }
    readonly reusableForAccessibleViewOwner: false
    readonly blockedReason: string
    readonly vscodeParallels: readonly string[]
  }
  readonly codekSurfaces: readonly {
    readonly path: string
    readonly role: string
    readonly ownerState: AccessibleViewCapabilityState
    readonly reusableForAccessibleViewOwner: false
    readonly reason: string
  }[]
  readonly missingOwners: readonly string[]
  readonly minimumSafeNextStep: "wire-real-accessible-view-workbench-owner"
  readonly blockedReason: string
  readonly vscodeParallels: readonly string[]
}

export interface AccessibleViewDomShellReadinessProjection {
  readonly source: "codek.accessibleView.domShellReadiness"
  readonly owner: "headless-service-adapter"
  readonly state: "partial"
  readonly noSecondAccessibilityState: true
  readonly selectors: {
    readonly root: "[data-accessible-view-dom-shell='true']"
    readonly title: "[data-accessible-view-title='true']"
    readonly content: "[data-accessible-view-content='true']"
    readonly toolbar: "[data-accessible-view-toolbar='true']"
  }
  readonly focus: {
    readonly contentFocusable: true
    readonly focusRestoreTargetOwner: AccessibleViewEditorShellFocusRestoreProjection["focusRestoreTargetOwner"]
    readonly focusRestoreInvocationOwner: AccessibleViewFocusRestoreInvocationProjection["focusRestoreInvocationOwner"]
    readonly projectedFocusTargetId?: string
    readonly activeEditor?: string | null
    readonly codeEditorWidgetBacked: false
  }
  readonly readiness: {
    readonly rootSelector: true
    readonly titleSelector: true
    readonly readonlyContentSelector: true
    readonly toolbarSelector: true
    readonly providerLifecycleProjection: boolean
    readonly workbenchPlacementProjection: boolean
    readonly editorShellFocusTargetProjection: boolean
    readonly actionRegistryProjection: true
  }
  readonly blockedOwners: readonly string[]
  readonly blockedReason: string
}

export interface AccessibilitySignalRoutingContract {
  readonly source: "codek.accessibilitySignal.routingContract"
  readonly state: "partial"
  readonly owner: "AccessibilityKeyboardNavigationService"
  readonly stateSource: "AccessibilityKeyboardNavigationService"
  readonly noSecondSignalState: true
  readonly vscodeOwner: {
    readonly signalServicePath: "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts"
    readonly progressSchedulerPath: "src/vs/platform/accessibilitySignal/browser/progressAccessibilitySignalScheduler.ts"
    readonly accessibleViewPath: "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts"
    readonly accessibilityConfigurationPath: "src/vs/workbench/contrib/accessibility/browser/accessibilityConfiguration.ts"
  }
  readonly availableEvidence: {
    readonly statusProjection: boolean
    readonly liveRegionProjection: boolean
    readonly screenReaderStatusItem: boolean
  }
  readonly missingOwners: readonly string[]
  readonly blockedReason: string
}

export interface AccessibilitySignalUiActionOwnerProjection {
  readonly source: "codek.accessibilitySignal.uiActionOwner"
  readonly owner: "AccessibilityKeyboardNavigationService"
  readonly state: "partial"
  readonly noSecondSignalState: true
  readonly registeredActionIds: readonly string[]
  readonly invokedEvidence: readonly AccessibilityActionEvidence[]
  readonly availableEvidence: {
    readonly actionRegistration: boolean
    readonly actionInvocationEvidence: boolean
    readonly announcementStatusBridge: boolean
    readonly liveRegionProjection: boolean
  }
  readonly blockedCapabilities: readonly string[]
  readonly blockedReason: string
  readonly vscodeParallels: readonly string[]
}

export interface AccessibilitySignalUiEvidenceProjection {
  readonly source: "codek.accessibilitySignal.uiEvidence"
  readonly owner: "AccessibilityKeyboardNavigationService"
  readonly state: "partial"
  readonly noSecondSignalState: true
  readonly serviceBackedEvidence: {
    readonly screenReaderStatusItem: AccessibilityStatusProjection
    readonly alertLiveRegionCount: number
    readonly statusLiveRegionCount: number
    readonly invokedActionIds: readonly string[]
  }
  readonly uiEvidence: {
    readonly actionRegistration: boolean
    readonly statusProjection: boolean
    readonly alertLiveRegionProjection: boolean
    readonly statusLiveRegionProjection: boolean
    readonly actionInvocationEvidence: boolean
  }
  readonly blockedOwners: readonly {
    readonly owner:
      | "IAccessibilitySignalService"
      | "AccessibilitySignal audio assets"
      | "AccessibilityProgressSignalScheduler"
      | "accessibility.signals configuration UI"
    readonly state: "blocked"
    readonly vscodePath: string
    readonly codekEvidence:
      | "status-alert-live-region-only"
      | "no-audio-asset-owner"
      | "no-progress-signal-loop-owner"
      | "no-signal-settings-ui-owner"
    readonly blockedReason: string
  }[]
  readonly blockedReason: string
  readonly vscodeParallels: readonly string[]
}

export interface AccessibilitySignalUiOwnerReadinessProjection {
  readonly source: "codek.accessibilitySignal.uiOwnerReadiness"
  readonly state: "blocked"
  readonly noSecondSignalState: true
  readonly minimalBridge: {
    readonly owner: "AccessibilityKeyboardNavigationService"
    readonly state: "available"
    readonly actionRegistration: boolean
    readonly actionInvocationEvidence: boolean
    readonly statusProjection: boolean
    readonly liveRegionProjection: boolean
    readonly codekPath: "frontend/vite-project/src/workbench/accessibilityKeyboardNavigationService.ts"
  }
  readonly fullSignalOwner: {
    readonly owner: "IAccessibilitySignalService"
    readonly state: "blocked"
    readonly requiredSurfaces: readonly string[]
    readonly blockedReason: string
    readonly vscodeParallels: readonly string[]
  }
  readonly blockedIntegrationBoundary: {
    readonly canImplementInThisThread: false
    readonly requiredCodekEntryPoints: readonly {
      readonly path: string
      readonly state: "candidate" | "blocked"
      readonly reason: string
    }[]
    readonly avoidedSurfaces: readonly string[]
    readonly acceptanceEvidence: readonly string[]
    readonly blockedReason: string
  }
}

export interface AccessibleViewPosition {
  readonly lineNumber: number
  readonly column: number
}

export interface AccessibleViewSymbol {
  readonly label: string
  readonly ariaLabel?: string
  readonly firstListItem?: boolean
  readonly lineNumber: number
  readonly column?: number
  readonly endLineNumber?: number
  readonly markdownToParse?: string
}

export interface AccessibleViewContentProvider {
  readonly providerId: string
  readonly type: AccessibleViewProviderType
  provideContent(): string
  provideNextContent?(): string | null | undefined
  providePreviousContent?(): string | null | undefined
  getSymbols?(): readonly AccessibleViewSymbol[] | null | undefined
  onOpen?(): void
  onClose?(): void
  dispose?(): void
  onDidRequestClearLastProvider?(listener: (providerId: string) => void): Disposable
}

export type AccessibleViewProviderFactory = () => AccessibleViewContentProvider

export interface AccessibleViewShowOptions {
  readonly position?: AccessibleViewPosition
}

export interface AccessibleViewHideOptions {
  readonly focusTargetId?: string
}

export interface AccessibleViewShowResult {
  readonly shown: boolean
  readonly providerId?: string
  readonly content?: string
  readonly restoredPosition?: AccessibleViewPosition
  readonly selectedSymbol?: AccessibleViewSymbol
  readonly reason?: string
}

export interface AccessibleViewHideResult {
  readonly hidden: boolean
  readonly providerId?: string
  readonly focusTargetId?: string
  readonly reason?: string
}

export interface AccessibleViewLifecycleProjection {
  readonly source: "codek.accessibleView.lifecycleProjection"
  readonly owner: "headless-service-adapter"
  readonly state: "partial"
  readonly isShown: boolean
  readonly currentProviderId?: string
  readonly lastProviderId?: string
  readonly currentContent?: string
  readonly context: {
    readonly accessibilityHelpIsShown: boolean
    readonly accessibleViewIsShown: boolean
    readonly currentProviderId?: string
    readonly supportsNavigation: boolean
    readonly goToSymbolSupported: boolean
  }
  readonly focusHandoff: {
    readonly requested: boolean
    readonly targetId?: string
    readonly state: "none" | "projected"
  }
  readonly focusRestoreInvocation?: AccessibleViewFocusRestoreInvocationProjection
  readonly evidence: {
    readonly providerFactoryInvoked: boolean
    readonly providerOnOpenCalled: boolean
    readonly providerOnCloseCalled: boolean
    readonly providerDisposeCalled: boolean
    readonly lastProviderReplayAvailable: boolean
    readonly lastProviderReplayed: boolean
  }
  readonly remainingBlockedSurfaces: readonly string[]
}

export interface AccessibleViewFocusRestoreInvocationProjection {
  readonly source: "codek.accessibleView.focusRestoreInvocation"
  readonly owner: "missing" | "App.vue editor.focus"
  readonly state: "blocked" | "partial"
  readonly targetId?: string
  readonly activeEditor?: string | null
  readonly invoked: boolean
  readonly focusRestoreInvocationOwner: "missing" | "App.vue editor.focus"
  readonly codeEditorWidgetBacked: false
  readonly noSecondFocusState: true
  readonly blockedReason: string
  readonly vscodeParallels: readonly string[]
}

export interface AccessibleViewFocusRestoreInvocationEvidence {
  readonly targetId: string
  readonly activeEditor?: string | null
  readonly invoked: boolean
}

export interface AccessibleViewRendererProjection {
  readonly source: "codek.accessibleView.rendererProjection"
  readonly owner: "headless-service-adapter"
  readonly state: "partial"
  readonly role: "dialog"
  readonly ariaModal: true
  readonly hidden: boolean
  readonly title: "Accessible View" | "Accessibility Help"
  readonly providerId?: string
  readonly providerType?: AccessibleViewProviderType
  readonly content: string
  readonly lineCount: number
  readonly readonlyContent: true
  readonly context: AccessibleViewLifecycleProjection["context"]
  readonly toolbar: {
    readonly menuId: "AccessibleView"
    readonly actionIds: readonly string[]
    readonly contextKeyNames: typeof ACCESSIBLE_VIEW_CONTEXT_KEYS
  }
  readonly toolbarQuickPickFocusInvocation: AccessibleViewToolbarQuickPickFocusInvocationProjection
  readonly domShellReadiness: AccessibleViewDomShellReadinessProjection
  readonly ownerFeasibility: AccessibleViewOwnerFeasibilityProjection
  readonly editorShellFocusRestore: AccessibleViewEditorShellFocusRestoreProjection
  readonly editorContextFocusOwnerMatrix: AccessibleViewEditorContextFocusOwnerMatrix
  readonly editor: {
    readonly owner: "missing"
    readonly renderedBy: "dom-shell-projection"
    readonly codeEditorWidgetBacked: false
    readonly reason: string
  }
  readonly placement: AccessibleViewPlacementOwnerProjection
  readonly focusHandoff: AccessibleViewLifecycleProjection["focusHandoff"]
  readonly vscodeParallels: readonly string[]
  readonly remainingBlockedSurfaces: readonly string[]
}

export interface AccessibleViewEditorContextFocusOwnerMatrix {
  readonly source: "codek.accessibleView.editorContextFocusOwnerMatrix"
  readonly state: "blocked"
  readonly noSecondAccessibilityState: true
  readonly codeEditorWidget: {
    readonly requiredOwner: "CodeEditorWidget"
    readonly vscodePath: "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts"
    readonly accessibleViewOwnerPath: "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts"
    readonly codeEditorWidgetBacked: false
    readonly textModelBacked: false
    readonly availableEvidence: {
      readonly providerLifecycleProjection: boolean
      readonly domShellReadonlyContentProjection: true
    }
    readonly blockedReason: string
  }
  readonly contextView: {
    readonly requiredOwner: "IContextViewService/ILayoutService"
    readonly contextViewPath: "src/vs/platform/contextview/browser/contextView.ts"
    readonly baseContextViewPath: "src/vs/base/browser/ui/contextview/contextview.ts"
    readonly layoutServicePath: "src/vs/workbench/services/layout/browser/layoutService.ts"
    readonly contextViewDelegateOwner: AccessibleViewPlacementOwnerProjection["contextViewDelegateOwner"]
    readonly layoutPlacementOwner: AccessibleViewPlacementOwnerProjection["layoutPlacementOwner"]
    readonly availableEvidence: {
      readonly workbenchPlacementProjection: boolean
      readonly projectedActiveContainer?: AccessibleViewPlacementOwnerProjection["activeContainer"]
    }
    readonly blockedReason: string
  }
  readonly focusRestoreInvocation: {
    readonly requiredOwner: "IEditorService/CodeEditorWidget.focus"
    readonly editorServicePath: "src/vs/workbench/services/editor/common/editorService.ts"
    readonly codeEditorWidgetPath: "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts"
    readonly focusRestoreTargetOwner: AccessibleViewEditorShellFocusRestoreProjection["focusRestoreTargetOwner"]
    readonly focusRestoreInvocationOwner: AccessibleViewFocusRestoreInvocationProjection["focusRestoreInvocationOwner"]
    readonly activeEditor?: string | null
    readonly projectedFocusTargetId?: string
    readonly availableEvidence: {
      readonly editorShellFocusTargetProjection: boolean
      readonly focusTargetMatchesActiveEditor: boolean
    }
    readonly blockedReason: string
  }
  readonly reusableShellEvidence: {
    readonly domShellProjection: "partial"
    readonly workbenchLayoutProjection: AccessibleViewPlacementOwnerProjection["state"]
    readonly editorShellFocusRestoreProjection: AccessibleViewEditorShellFocusRestoreProjection["state"]
    readonly completeAccessibleViewUiOwner: false
  }
  readonly missingOwners: readonly string[]
  readonly blockedReason: string
  readonly vscodeParallels: readonly string[]
}

export interface AccessibleViewToolbarQuickPickFocusInvocationProjection {
  readonly source: "codek.accessibleView.toolbarQuickPickFocusInvocationProjection"
  readonly owner: "menu-service-projection"
  readonly state: "blocked"
  readonly noSecondActionState: true
  readonly toolbar: {
    readonly requiredOwner: "WorkbenchToolBar + MenuId.AccessibleView"
    readonly menuId: "AccessibleView"
    readonly menuActionIds: readonly string[]
    readonly actionRegistryBacked: true
    readonly workbenchToolbarWidgetBacked: false
    readonly blockedReason: string
    readonly vscodeParallels: readonly string[]
  }
  readonly quickPick: {
    readonly requiredOwner: "IQuickInputService.createQuickPick"
    readonly quickInputServicePath: "src/vs/platform/quickinput/browser/quickInputService.ts"
    readonly symbolQuickPickOwner: "missing" | "QuickInputService.createQuickPick"
    readonly goToSymbolActionRegistered: boolean
    readonly genericQuickInputSurface: {
      readonly paths: readonly [
        "frontend/vite-project/src/workbench/quickInput.ts",
        "frontend/vite-project/src/components/QuickPickDialog.vue",
      ]
      readonly state: "available"
      readonly reusableInfrastructure: true
      readonly accessibleViewSymbolQuickPickOwner: boolean
      readonly blockedReason: string
    }
    readonly blockedReason: string
    readonly vscodeParallels: readonly string[]
  }
  readonly focusInvocation: {
    readonly requiredOwner: "IEditorService/CodeEditorWidget.focus"
    readonly editorServicePath: "src/vs/workbench/services/editor/common/editorService.ts"
    readonly codeEditorWidgetPath: "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts"
    readonly focusRestoreTargetOwner: AccessibleViewEditorShellFocusRestoreProjection["focusRestoreTargetOwner"]
    readonly focusRestoreInvocationOwner: AccessibleViewFocusRestoreInvocationProjection["focusRestoreInvocationOwner"]
    readonly activeEditor?: string | null
    readonly projectedFocusTargetId?: string
    readonly codeEditorWidgetBacked: false
    readonly blockedReason: string
    readonly vscodeParallels: readonly string[]
  }
  readonly remainingBlockedSurfaces: readonly string[]
}

export interface AccessibleViewEditorShellFocusRestoreProjection {
  readonly source: "codek.accessibleView.editorShellFocusRestoreProjection"
  readonly owner: "missing" | "workbenchLayoutService"
  readonly state: "blocked" | "partial"
  readonly stateSource?: "workbenchLayoutService"
  readonly noSecondFocusState?: true
  readonly activeEditor?: string | null
  readonly projectedFocusTargetId?: string
  readonly focusRestoreTargetOwner: "missing" | "projected"
  readonly focusRestoreInvocationOwner: AccessibleViewFocusRestoreInvocationProjection["focusRestoreInvocationOwner"]
  readonly focusTargetMatchesActiveEditor: boolean
  readonly codeEditorWidgetBacked: false
  readonly textModelBacked: false
  readonly blockedReason: string
  readonly vscodeParallels: readonly string[]
}

export interface AccessibleViewPlacementOwnerProjection {
  readonly source: "codek.accessibleView.placementOwnerProjection"
  readonly owner: "missing" | "workbenchLayoutService"
  readonly state: "blocked" | "partial"
  readonly stateSource?: "workbenchLayoutService"
  readonly noSecondLayoutState?: true
  readonly requiredOwner: "IContextViewService/ILayoutService"
  readonly contextViewDelegateOwner: "missing" | "projected"
  readonly layoutPlacementOwner: "missing" | "projected"
  readonly activeContainer?: {
    readonly viewContainerId: string | null
    readonly panelId: string | null
    readonly editor: string | null
  }
  readonly blockedReason?: string
  readonly vscodeParallels: readonly string[]
}

export interface AccessibleViewContractProjection {
  readonly source: "codek.accessibleViewService.contract"
  readonly vscodeContractPaths: readonly string[]
  readonly codekContractPaths: readonly string[]
  readonly stateSources: {
    readonly accessibleView: AccessibleViewCapabilityState
    readonly providerRegistry: AccessibleViewCapabilityState
    readonly commandMenuContext: AccessibleViewCapabilityState
    readonly accessibilitySignalUi: AccessibleViewCapabilityState
    readonly listTreeAria: AccessibleViewCapabilityState
  }
  readonly actionIds: typeof ACCESSIBLE_VIEW_ACTION_IDS
  readonly providerRegistry: AccessibleViewProviderRegistrySnapshot
  readonly commandMenuContract: AccessibleViewCommandMenuContract
  readonly widgetContribution: AccessibleViewWidgetContributionContract
  readonly ownerFeasibility: AccessibleViewOwnerFeasibilityProjection
  readonly rendererProjection: AccessibleViewRendererProjection
  readonly domShellReadiness: AccessibleViewDomShellReadinessProjection
  readonly toolbarQuickPickFocusInvocation: AccessibleViewToolbarQuickPickFocusInvocationProjection
  readonly editorContextFocusOwnerMatrix: AccessibleViewEditorContextFocusOwnerMatrix
  readonly providerLifecycleContract: AccessibleViewProviderLifecycleContract
  readonly contextKeyUpdateContract: AccessibleViewContextKeyUpdateContract
  readonly listTreeAriaContract: {
    readonly widgetRoleFromListView: boolean
    readonly activeDescendantFromModelFocus: boolean
    readonly rowIdsFromRenderer: boolean
    readonly focusableTreeWidget: boolean
  }
  readonly signalContract: {
    readonly liveRegionProjectionFromAccessibilityKeyboardNavigationService: boolean
    readonly statusProjectionFromAccessibilityKeyboardNavigationService: boolean
    readonly signalActionEvidenceFromAccessibilityKeyboardNavigationService: boolean
    readonly soundPlayback: AccessibleViewCapabilityState
    readonly progressSignalScheduler: AccessibleViewCapabilityState
    readonly configurationUi: AccessibleViewCapabilityState
  }
  readonly signalRouting: AccessibilitySignalRoutingContract
  readonly accessibilitySignalUiProjection: AccessibilitySignalUiProjection
  readonly uiSurfaceAudit: AccessibleViewUiSurfaceAuditProjection
  readonly trueOwnerFollowUp: AccessibleViewTrueOwnerFollowUpProjection
  readonly blockedGaps: readonly AccessibleViewBlockedGap[]
}

export interface AccessibilitySignalUiProjection {
  readonly source: "codek.accessibilitySignal.uiProjection"
  readonly owner: "AccessibilityKeyboardNavigationService"
  readonly state: "partial"
  readonly routing: AccessibilitySignalRoutingContract
  readonly actionOwner: AccessibilitySignalUiActionOwnerProjection
  readonly evidence: AccessibilitySignalUiEvidenceProjection
  readonly ownerReadiness: AccessibilitySignalUiOwnerReadinessProjection
  readonly status: AccessibilityStatusProjection
  readonly aria: AriaProjection
  readonly capabilities: {
    readonly screenReaderStatusItem: "available"
    readonly liveRegionAnnouncements: "available"
    readonly signalActionEvidence: "available"
    readonly soundPlayback: "blocked"
    readonly progressSignalScheduler: "blocked"
    readonly signalConfigurationUi: "blocked"
  }
  readonly vscodeParallels: readonly string[]
}

export interface IAccessibleViewService {
  readonly _serviceBrand: undefined
  getContractProjection(): AccessibleViewContractProjection
  getOpenAriaHint(verbositySettingKey: string): string | null
  registerAccessibilitySignalUiActions(
    accessibilityKeyboardNavigationService: Pick<IAccessibilityKeyboardNavigationService, "registerAccessibilityAction" | "status" | "alert">,
  ): Disposable
  registerProvider(implementation: AccessibleViewProviderImplementation): Disposable
  getProviderRegistrySnapshot(): AccessibleViewProviderRegistrySnapshot
  bindContextKeyService(contextKeyService: IContextKeyService): Disposable
  show(providerId?: string, options?: AccessibleViewShowOptions): AccessibleViewShowResult
  hide(options?: AccessibleViewHideOptions): AccessibleViewHideResult
  next(): AccessibleViewShowResult
  previous(): AccessibleViewShowResult
  showAccessibilityHelp(): AccessibleViewShowResult
  goToSymbol(): Promise<AccessibleViewShowResult>
  recordFocusRestoreInvocation(evidence: AccessibleViewFocusRestoreInvocationEvidence): AccessibleViewFocusRestoreInvocationProjection
  showLastProvider(): AccessibleViewShowResult
  getWidgetLifecycleProjection(): AccessibleViewLifecycleProjection
  getRendererProjection(): AccessibleViewRendererProjection
  getOwnerFeasibilityProjection(): AccessibleViewOwnerFeasibilityProjection
  getAccessibilitySignalUiProjection(
    accessibilityKeyboardNavigationService?: Pick<IAccessibilityKeyboardNavigationService, "getStatusProjection" | "getAriaProjection" | "getEvidenceActions">,
  ): AccessibilitySignalUiProjection
}

export const IAccessibleViewService = createDecorator<IAccessibleViewService>("accessibleViewService")

const VSCODE_CONTRACT_PATHS = [
  "src/vs/platform/accessibility/browser/accessibleView.ts",
  "src/vs/platform/accessibility/browser/accessibleViewRegistry.ts",
  "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts",
  "src/vs/workbench/contrib/accessibility/browser/accessibleViewActions.ts",
  "src/vs/platform/quickinput/browser/quickInputService.ts",
  "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts",
  "src/vs/workbench/contrib/accessibility/browser/accessibilityConfiguration.ts",
  "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts",
  "src/vs/platform/accessibilitySignal/browser/progressAccessibilitySignalScheduler.ts",
  "src/vs/base/browser/ui/list/listWidget.ts",
  "src/vs/base/browser/ui/list/listView.ts",
  "src/vs/base/browser/ui/tree/abstractTree.ts",
] as const

const CODEK_CONTRACT_PATHS = [
  "frontend/vite-project/src/accessibility/accessibleViewService.ts",
  "frontend/vite-project/src/vscode-adapter/platform/actions/common/menuRegistry.ts",
  "frontend/vite-project/src/vscode-adapter/platform/actions/common/menuService.ts",
  "frontend/vite-project/src/vscode-adapter/platform/contextkey/common/contextkey.ts",
  "frontend/vite-project/src/workbench/accessibilityKeyboardNavigationService.ts",
  "frontend/vite-project/src/explorer/tree/CodekListView.ts",
  "frontend/vite-project/src/explorer/tree/ExplorerRenderer.ts",
  "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
  "frontend/vite-project/src/components/FileTree.vue",
] as const

const BLOCKED_GAPS: readonly AccessibleViewBlockedGap[] = [
  {
    id: "accessibleView.ui",
    state: "blocked",
    reason: "Codek now has provider registry metadata, menu/context projection, a headless service-level provider lifecycle adapter, and a DOM-shell renderer projection; it still has no VS Code workbench AccessibleView owner that can render provider content in a backing CodeEditorWidget/context view.",
    requiredSurfaces: [
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts AccessibleView class",
      "CodeEditorWidget-backed Accessible View content renderer",
      "IContextViewService/ILayoutService owner for show/hide lifecycle",
      "Workbench toolbar and quick-pick affordances",
      "real editor/workbench focus handoff after close",
    ],
  },
  {
    id: "accessibleView.widgetOwner",
    state: "blocked",
    reason: "The service-level lifecycle projection can feed a DOM shell, but it is not a CodeEditorWidget-backed AccessibleView widget and cannot own context-view placement, Workbench toolbar actions, model cursor state, or real focus restoration.",
    requiredSurfaces: [
      "CodeEditorWidget-backed Accessible View content renderer",
      "IContextViewService/ILayoutService owner for show/hide lifecycle",
      "Workbench toolbar and quick-pick affordances",
      "real editor/workbench focus handoff after close",
    ],
  },
  {
    id: "accessibilitySignal.ui",
    state: "blocked",
    reason: "Codek now projects screen-reader status and live-region announcement UI through AccessibilityKeyboardNavigationService, but does not own VS Code-style signal configuration, audio assets, telemetry, or progress signal scheduling.",
    requiredSurfaces: [
      "accessibility.signals configuration schema",
      "IAccessibilitySignalService audio/announcement enablement",
      "AccessibilityProgressSignalScheduler",
      "settings UI and command affordances for signals",
    ],
  },
]

export class AccessibleViewService implements IAccessibleViewService {
  declare readonly _serviceBrand: undefined
  private readonly providers: AccessibleViewProviderImplementation[] = []
  private readonly quickInput: QuickInputService
  private contextKeyService: IContextKeyService | undefined
  private contextKeys: BoundAccessibleViewContextKeys | undefined
  private currentProvider: AccessibleViewContentProvider | undefined
  private currentProviderDisposables: Disposable[] = []
  private currentContent: string | undefined
  private lastProviderId: string | undefined
  private readonly lastProviderPosition = new Map<string, AccessibleViewPosition>()
  private focusHandoff: AccessibleViewLifecycleProjection["focusHandoff"] = { requested: false, state: "none" }
  private providerFactoryInvoked = false
  private providerOnOpenCalled = false
  private providerOnCloseCalled = false
  private providerDisposeCalled = false
  private lastProviderReplayed = false
  private symbolQuickPickOwner: AccessibleViewToolbarQuickPickFocusInvocationProjection["quickPick"]["symbolQuickPickOwner"] = "missing"
  private focusRestoreInvocation: AccessibleViewFocusRestoreInvocationProjection = createAccessibleViewFocusRestoreInvocationProjection()

  constructor(quickInput: QuickInputService = quickInputService) {
    this.quickInput = quickInput
  }

  getContractProjection(): AccessibleViewContractProjection {
    const rendererProjection = this.getRendererProjection()
    return {
      source: "codek.accessibleViewService.contract",
      vscodeContractPaths: VSCODE_CONTRACT_PATHS,
      codekContractPaths: CODEK_CONTRACT_PATHS,
      stateSources: {
        accessibleView: "partial",
        providerRegistry: "partial",
        commandMenuContext: "partial",
        accessibilitySignalUi: "partial",
        listTreeAria: "available",
      },
      actionIds: ACCESSIBLE_VIEW_ACTION_IDS,
      providerRegistry: this.getProviderRegistrySnapshot(),
      commandMenuContract: ACCESSIBLE_VIEW_COMMAND_MENU_CONTRACT,
      widgetContribution: ACCESSIBLE_VIEW_WIDGET_CONTRIBUTION_CONTRACT,
      ownerFeasibility: this.getOwnerFeasibilityProjection(),
      rendererProjection,
      domShellReadiness: rendererProjection.domShellReadiness,
      toolbarQuickPickFocusInvocation: rendererProjection.toolbarQuickPickFocusInvocation,
      editorContextFocusOwnerMatrix: rendererProjection.editorContextFocusOwnerMatrix,
      providerLifecycleContract: ACCESSIBLE_VIEW_PROVIDER_LIFECYCLE_CONTRACT,
      contextKeyUpdateContract: ACCESSIBLE_VIEW_CONTEXT_KEY_UPDATE_CONTRACT,
      listTreeAriaContract: {
        widgetRoleFromListView: true,
        activeDescendantFromModelFocus: true,
        rowIdsFromRenderer: true,
        focusableTreeWidget: true,
      },
      signalContract: {
        liveRegionProjectionFromAccessibilityKeyboardNavigationService: true,
        statusProjectionFromAccessibilityKeyboardNavigationService: true,
        signalActionEvidenceFromAccessibilityKeyboardNavigationService: true,
        soundPlayback: "blocked",
        progressSignalScheduler: "blocked",
        configurationUi: "blocked",
      },
      signalRouting: createAccessibilitySignalRoutingContract(),
      accessibilitySignalUiProjection: this.getAccessibilitySignalUiProjection(),
      uiSurfaceAudit: createAccessibleViewUiSurfaceAuditProjection(),
      trueOwnerFollowUp: createAccessibleViewTrueOwnerFollowUpProjection(rendererProjection),
      blockedGaps: BLOCKED_GAPS,
    }
  }

  getOpenAriaHint(_verbositySettingKey: string): string | null {
    return null
  }

  registerAccessibilitySignalUiActions(
    accessibilityKeyboardNavigationService: Pick<IAccessibilityKeyboardNavigationService, "registerAccessibilityAction" | "status" | "alert">,
  ): Disposable {
    return registerAccessibilitySignalUiActions(accessibilityKeyboardNavigationService)
  }

  registerProvider(implementation: AccessibleViewProviderImplementation): Disposable {
    const provider = normalizeProviderImplementation(implementation)
    this.providers.push(provider)

    return {
      dispose: () => {
        const index = this.providers.indexOf(provider)
        if (index !== -1) this.providers.splice(index, 1)
      },
    }
  }

  getProviderRegistrySnapshot(): AccessibleViewProviderRegistrySnapshot {
    return {
      source: "codek.accessibleView.providerRegistry",
      implementations: [...this.providers].sort((left, right) => (
        right.priority - left.priority || left.name.localeCompare(right.name)
      )),
    }
  }

  bindContextKeyService(contextKeyService: IContextKeyService): Disposable {
    this.contextKeyService = contextKeyService
    this.contextKeys = {
      accessibilityHelpIsShown: contextKeyService.createKey(ACCESSIBLE_VIEW_CONTEXT_KEYS.accessibilityHelpIsShown, false),
      accessibleViewIsShown: contextKeyService.createKey(ACCESSIBLE_VIEW_CONTEXT_KEYS.accessibleViewIsShown, false),
      accessibleViewSupportsNavigation: contextKeyService.createKey(ACCESSIBLE_VIEW_CONTEXT_KEYS.accessibleViewSupportsNavigation, false),
      accessibleViewVerbosityEnabled: contextKeyService.createKey(ACCESSIBLE_VIEW_CONTEXT_KEYS.accessibleViewVerbosityEnabled, false),
      accessibleViewGoToSymbolSupported: contextKeyService.createKey(ACCESSIBLE_VIEW_CONTEXT_KEYS.accessibleViewGoToSymbolSupported, false),
      accessibleViewCurrentProviderId: contextKeyService.createKey(ACCESSIBLE_VIEW_CONTEXT_KEYS.accessibleViewCurrentProviderId, undefined),
      accessibleViewInCodeBlock: contextKeyService.createKey(ACCESSIBLE_VIEW_CONTEXT_KEYS.accessibleViewInCodeBlock, false),
      accessibleViewContainsCodeBlocks: contextKeyService.createKey(ACCESSIBLE_VIEW_CONTEXT_KEYS.accessibleViewContainsCodeBlocks, false),
      accessibleViewHasUnassignedKeybindings: contextKeyService.createKey(ACCESSIBLE_VIEW_CONTEXT_KEYS.accessibleViewHasUnassignedKeybindings, false),
      accessibleViewHasAssignedKeybindings: contextKeyService.createKey(ACCESSIBLE_VIEW_CONTEXT_KEYS.accessibleViewHasAssignedKeybindings, false),
    }

    return {
      dispose: () => {
        this.resetContextKeys()
        if (this.contextKeyService === contextKeyService) {
          this.contextKeyService = undefined
          this.contextKeys = undefined
        }
      },
    }
  }

  show(providerId?: string, options: AccessibleViewShowOptions = {}): AccessibleViewShowResult {
    const implementation = this.resolveProviderImplementation(providerId)
    if (!implementation) {
      return { shown: false, reason: providerId ? "provider-not-registered" : "provider-required" }
    }
    if (!implementation.createProvider) {
      return { shown: false, providerId: implementation.providerId, reason: "provider-factory-missing" }
    }

    this.closeCurrentProvider({ callOnClose: false, dispose: true })
    const provider = implementation.createProvider()
    this.providerFactoryInvoked = true
    this.currentProvider = provider
    this.lastProviderId = provider.providerId
    this.focusHandoff = { requested: false, state: "none" }
    this.currentProviderDisposables = []
    if (provider.onDidRequestClearLastProvider) {
      this.currentProviderDisposables.push(provider.onDidRequestClearLastProvider((id) => this.clearLastProvider(id)))
    }

    provider.onOpen?.()
    this.providerOnOpenCalled = true
    this.currentContent = provider.provideContent()
    if (options.position) {
      this.lastProviderPosition.set(provider.providerId, options.position)
    }
    this.updateContextKeys(provider, true)

    return {
      shown: true,
      providerId: provider.providerId,
      content: this.currentContent,
      restoredPosition: this.lastProviderPosition.get(provider.providerId),
    }
  }

  hide(options: AccessibleViewHideOptions = {}): AccessibleViewHideResult {
    if (!this.currentProvider) return { hidden: false, reason: "not-shown" }

    const providerId = this.currentProvider.providerId
    this.focusHandoff = options.focusTargetId
      ? { requested: true, targetId: options.focusTargetId, state: "projected" }
      : { requested: false, state: "none" }
    this.focusRestoreInvocation = createAccessibleViewFocusRestoreInvocationProjection(this.focusHandoff)
    this.closeCurrentProvider({ callOnClose: true, dispose: true })
    this.resetContextKeys()
    this.currentContent = undefined

    return {
      hidden: true,
      providerId,
      focusTargetId: options.focusTargetId,
    }
  }

  next(): AccessibleViewShowResult {
    return this.navigateProviderContent("next")
  }

  previous(): AccessibleViewShowResult {
    return this.navigateProviderContent("previous")
  }

  showAccessibilityHelp(): AccessibleViewShowResult {
    const implementation = this.getProviderRegistrySnapshot().implementations.find((provider) => provider.type === "help")
    return implementation ? this.show(implementation.providerId) : { shown: false, reason: "help-provider-not-registered" }
  }

  async goToSymbol(): Promise<AccessibleViewShowResult> {
    const provider = this.currentProvider
    if (!provider) return { shown: false, reason: "not-shown" }

    const symbols = provider.getSymbols?.()?.filter(isAccessibleViewSymbol) ?? []
    if (!symbols.length) {
      return {
        shown: false,
        providerId: provider.providerId,
        reason: "symbols-missing",
      }
    }

    this.symbolQuickPickOwner = "QuickInputService.createQuickPick"
    const selected = await this.quickInput.pick<AccessibleViewSymbol>(
      symbols.map((symbol) => ({
        id: `${symbol.lineNumber}:${symbol.column ?? 1}:${symbol.label}`,
        label: symbol.label,
        description: `line ${symbol.lineNumber}`,
        detail: symbol.ariaLabel || symbol.markdownToParse,
        value: symbol,
      })),
      {
        title: "Go to Symbol Accessible View",
        placeHolder: "Type to search symbols",
      },
    )
    const selectedItem = Array.isArray(selected) ? selected[0] : selected
    const selectedSymbol = selectedItem?.value
    if (!selectedSymbol) {
      return {
        shown: false,
        providerId: provider.providerId,
        reason: "symbol-quick-pick-cancelled",
      }
    }

    const position = { lineNumber: selectedSymbol.lineNumber, column: selectedSymbol.column ?? 1 }
    this.lastProviderPosition.set(provider.providerId, position)
    return {
      shown: true,
      providerId: provider.providerId,
      content: this.currentContent,
      restoredPosition: position,
      selectedSymbol,
    }
  }

  recordFocusRestoreInvocation(evidence: AccessibleViewFocusRestoreInvocationEvidence): AccessibleViewFocusRestoreInvocationProjection {
    this.focusRestoreInvocation = createAccessibleViewFocusRestoreInvocationProjection(this.focusHandoff, evidence)
    return this.focusRestoreInvocation
  }

  showLastProvider(): AccessibleViewShowResult {
    if (!this.lastProviderId) return { shown: false, reason: "last-provider-missing" }
    this.lastProviderReplayed = true
    const position = this.lastProviderPosition.get(this.lastProviderId)
    return this.show(this.lastProviderId, { position })
  }

  getWidgetLifecycleProjection(): AccessibleViewLifecycleProjection {
    return {
      source: "codek.accessibleView.lifecycleProjection",
      owner: "headless-service-adapter",
      state: "partial",
      isShown: Boolean(this.currentProvider),
      currentProviderId: this.currentProvider?.providerId,
      lastProviderId: this.lastProviderId,
      currentContent: this.currentContent,
      context: {
        accessibilityHelpIsShown: this.currentProvider?.type === "help",
        accessibleViewIsShown: this.currentProvider?.type === "view",
        currentProviderId: this.currentProvider?.providerId,
        supportsNavigation: Boolean(this.currentProvider?.provideNextContent || this.currentProvider?.providePreviousContent),
        goToSymbolSupported: Boolean(this.currentProvider?.getSymbols?.()?.length),
      },
      focusHandoff: this.focusHandoff,
      focusRestoreInvocation: this.focusRestoreInvocation,
      evidence: {
        providerFactoryInvoked: this.providerFactoryInvoked,
        providerOnOpenCalled: this.providerOnOpenCalled,
        providerOnCloseCalled: this.providerOnCloseCalled,
        providerDisposeCalled: this.providerDisposeCalled,
        lastProviderReplayAvailable: Boolean(this.lastProviderId),
        lastProviderReplayed: this.lastProviderReplayed,
      },
      remainingBlockedSurfaces: ACCESSIBLE_VIEW_WIDGET_CONTRIBUTION_CONTRACT.missingSurfaces,
    }
  }

  getRendererProjection(): AccessibleViewRendererProjection {
    return createAccessibleViewRendererProjection(this.getWidgetLifecycleProjection(), undefined, this.symbolQuickPickOwner)
  }

  getOwnerFeasibilityProjection(): AccessibleViewOwnerFeasibilityProjection {
    return createAccessibleViewOwnerFeasibilityProjection(this.getWidgetLifecycleProjection())
  }

  getAccessibilitySignalUiProjection(
    accessibilityKeyboardNavigationService?: Pick<IAccessibilityKeyboardNavigationService, "getStatusProjection" | "getAriaProjection" | "getEvidenceActions">,
  ): AccessibilitySignalUiProjection {
    const status = accessibilityKeyboardNavigationService?.getStatusProjection?.() || EMPTY_SIGNAL_STATUS
    const aria = accessibilityKeyboardNavigationService?.getAriaProjection?.() || EMPTY_SIGNAL_ARIA
    const evidence = accessibilityKeyboardNavigationService?.getEvidenceActions?.() || []
    const actionOwner = createAccessibilitySignalUiActionOwnerProjection(evidence)
    return {
      source: "codek.accessibilitySignal.uiProjection",
      owner: "AccessibilityKeyboardNavigationService",
      state: "partial",
      routing: createAccessibilitySignalRoutingContract(),
      actionOwner,
    evidence: createAccessibilitySignalUiEvidenceProjection(status, aria, actionOwner),
      ownerReadiness: createAccessibilitySignalUiOwnerReadinessProjection(status, aria, actionOwner),
      status,
      aria,
      capabilities: {
        screenReaderStatusItem: "available",
        liveRegionAnnouncements: "available",
        signalActionEvidence: "available",
        soundPlayback: "blocked",
        progressSignalScheduler: "blocked",
        signalConfigurationUi: "blocked",
      },
      vscodeParallels: [
        "src/vs/platform/accessibility/browser/accessibilityService.ts status()/alert() live-region bridge",
        "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts playSignal announcement/audio split",
        "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts playSignals() batches status announcements",
        "src/vs/platform/accessibilitySignal/browser/progressAccessibilitySignalScheduler.ts playSignalLoop(AccessibilitySignal.progress)",
        "src/vs/workbench/contrib/accessibility/browser/accessibilityConfiguration.ts accessibility.signals settings schema",
      ],
    }
  }

  private resolveProviderImplementation(providerId: string | undefined): AccessibleViewProviderImplementation | undefined {
    const providers = this.getProviderRegistrySnapshot().implementations
    return providerId
      ? providers.find((provider) => provider.providerId === providerId)
      : providers[0]
  }

  private updateContextKeys(provider: AccessibleViewContentProvider, shown: boolean): void {
    const contextKeys = this.contextKeys
    if (!contextKeys) return
    contextKeys.accessibilityHelpIsShown.set(provider.type === "help" && shown)
    contextKeys.accessibleViewIsShown.set(provider.type === "view" && shown)
    contextKeys.accessibleViewSupportsNavigation.set(Boolean(provider.provideNextContent || provider.providePreviousContent))
    contextKeys.accessibleViewCurrentProviderId.set(provider.providerId)
    contextKeys.accessibleViewVerbosityEnabled.set(false)
    contextKeys.accessibleViewGoToSymbolSupported.set(Boolean(provider.getSymbols?.()?.length))
    contextKeys.accessibleViewInCodeBlock.set(false)
    contextKeys.accessibleViewContainsCodeBlocks.set(false)
    contextKeys.accessibleViewHasUnassignedKeybindings.set(false)
    contextKeys.accessibleViewHasAssignedKeybindings.set(false)
  }

  private resetContextKeys(): void {
    this.contextKeys?.accessibilityHelpIsShown.set(false)
    this.contextKeys?.accessibleViewIsShown.set(false)
    this.contextKeys?.accessibleViewSupportsNavigation.set(false)
    this.contextKeys?.accessibleViewVerbosityEnabled.set(false)
    this.contextKeys?.accessibleViewGoToSymbolSupported.set(false)
    this.contextKeys?.accessibleViewCurrentProviderId.reset()
    this.contextKeys?.accessibleViewInCodeBlock.set(false)
    this.contextKeys?.accessibleViewContainsCodeBlocks.set(false)
    this.contextKeys?.accessibleViewHasUnassignedKeybindings.set(false)
    this.contextKeys?.accessibleViewHasAssignedKeybindings.set(false)
  }

  private closeCurrentProvider(options: { callOnClose: boolean; dispose: boolean }): void {
    if (!this.currentProvider) return
    if (options.callOnClose) {
      this.currentProvider.onClose?.()
      this.providerOnCloseCalled = true
    }
    for (const disposable of this.currentProviderDisposables.splice(0)) {
      disposable.dispose()
    }
    if (options.dispose) {
      this.currentProvider.dispose?.()
      this.providerDisposeCalled = true
    }
    this.currentProvider = undefined
  }

  private clearLastProvider(providerId: string): void {
    if (this.lastProviderId === providerId) this.lastProviderId = undefined
    this.lastProviderPosition.delete(providerId)
  }

  private navigateProviderContent(direction: "next" | "previous"): AccessibleViewShowResult {
    const provider = this.currentProvider
    if (!provider) return { shown: false, reason: "not-shown" }

    const nextContent = direction === "next"
      ? provider.provideNextContent?.()
      : provider.providePreviousContent?.()
    if (nextContent == null) {
      return {
        shown: false,
        providerId: provider.providerId,
        reason: `${direction}-provider-content-missing`,
      }
    }

    this.currentContent = nextContent
    return {
      shown: true,
      providerId: provider.providerId,
      content: this.currentContent,
      restoredPosition: this.lastProviderPosition.get(provider.providerId),
    }
  }
}

export function createAccessibleViewRendererProjection(
  lifecycle: AccessibleViewLifecycleProjection,
  placement: AccessibleViewPlacementOwnerProjection = createAccessibleViewPlacementOwnerProjection(),
  symbolQuickPickOwner: AccessibleViewToolbarQuickPickFocusInvocationProjection["quickPick"]["symbolQuickPickOwner"] = "missing",
): AccessibleViewRendererProjection {
  const lifecycleWithFocusInvocation: AccessibleViewLifecycleProjection = {
    ...lifecycle,
    focusRestoreInvocation: lifecycle.focusRestoreInvocation ?? createAccessibleViewFocusRestoreInvocationProjection(lifecycle.focusHandoff),
  }
  const providerType = lifecycleWithFocusInvocation.context.accessibilityHelpIsShown ? "help" : lifecycleWithFocusInvocation.context.accessibleViewIsShown ? "view" : undefined
  const content = lifecycleWithFocusInvocation.currentContent ?? ""
  const editorShellFocusRestore = createAccessibleViewEditorShellFocusRestoreProjection(lifecycleWithFocusInvocation, placement)
  const ownerFeasibility = createAccessibleViewOwnerFeasibilityProjection(lifecycleWithFocusInvocation, placement, editorShellFocusRestore)
  const toolbarQuickPickFocusInvocation = createAccessibleViewToolbarQuickPickFocusInvocationProjection(lifecycleWithFocusInvocation, editorShellFocusRestore, symbolQuickPickOwner)
  const domShellReadiness = createAccessibleViewDomShellReadinessProjection(lifecycleWithFocusInvocation, placement, editorShellFocusRestore)

  return {
    source: "codek.accessibleView.rendererProjection",
    owner: "headless-service-adapter",
    state: "partial",
    role: "dialog",
    ariaModal: true,
    hidden: !lifecycleWithFocusInvocation.isShown,
    title: providerType === "help" ? "Accessibility Help" : "Accessible View",
    providerId: lifecycleWithFocusInvocation.currentProviderId,
    providerType,
    content,
    lineCount: content ? content.split(/\r\n|\r|\n/).length : 0,
    readonlyContent: true,
    context: lifecycleWithFocusInvocation.context,
    toolbar: {
      menuId: ACCESSIBLE_VIEW_COMMAND_MENU_CONTRACT.menuId,
      actionIds: ACCESSIBLE_VIEW_COMMAND_MENU_CONTRACT.accessibleViewMenuActionIds,
      contextKeyNames: ACCESSIBLE_VIEW_CONTEXT_KEYS,
    },
    toolbarQuickPickFocusInvocation,
    domShellReadiness,
    ownerFeasibility,
    editorShellFocusRestore,
    editorContextFocusOwnerMatrix: createAccessibleViewEditorContextFocusOwnerMatrix(lifecycleWithFocusInvocation, placement, editorShellFocusRestore),
    editor: {
      owner: "missing",
      renderedBy: "dom-shell-projection",
      codeEditorWidgetBacked: false,
      reason: "Renderer projection is a DOM-shell contract only; VS Code CodeEditorWidget ownership is still blocked.",
    },
    placement,
    focusHandoff: lifecycleWithFocusInvocation.focusHandoff,
    vscodeParallels: [
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts show() creates an IContextViewDelegate and renders provider content",
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts _updateToolbar() derives toolbar actions from MenuId.AccessibleView",
      "src/vs/base/browser/ui/contextview/contextview.ts positions a rendered context view through an owner container",
      "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts owns the read-only editor widget used by AccessibleView",
    ],
    remainingBlockedSurfaces: lifecycleWithFocusInvocation.remainingBlockedSurfaces,
  }
}

export const ACCESSIBILITY_SIGNAL_UI_ACTION_IDS = {
  announceProgress: "accessibility.signal.progress.announce",
  announceClear: "accessibility.signal.clear.announce",
} as const

export function registerAccessibilitySignalUiActions(
  accessibilityKeyboardNavigationService: Pick<IAccessibilityKeyboardNavigationService, "registerAccessibilityAction" | "status" | "alert">,
): Disposable {
  const disposables = [
    accessibilityKeyboardNavigationService.registerAccessibilityAction({
      id: ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceProgress,
      label: "Announce Progress Signal",
      commandId: ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceProgress,
      source: "accessibility.signal",
      run: () => {
        accessibilityKeyboardNavigationService.status("Progress")
      },
    }),
    accessibilityKeyboardNavigationService.registerAccessibilityAction({
      id: ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceClear,
      label: "Announce Clear Signal",
      commandId: ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceClear,
      source: "accessibility.signal",
      run: () => {
        accessibilityKeyboardNavigationService.alert("Clear")
      },
    }),
  ]

  return {
    dispose: () => {
      for (const disposable of disposables.splice(0)) {
        disposable.dispose()
      }
    },
  }
}

export function createAccessibilitySignalUiOwnerReadinessProjection(
  status: AccessibilityStatusProjection = EMPTY_SIGNAL_STATUS,
  aria: AriaProjection = EMPTY_SIGNAL_ARIA,
  actionOwner: AccessibilitySignalUiActionOwnerProjection = createAccessibilitySignalUiActionOwnerProjection(),
): AccessibilitySignalUiOwnerReadinessProjection {
  return {
    source: "codek.accessibilitySignal.uiOwnerReadiness",
    state: "blocked",
    noSecondSignalState: true,
    minimalBridge: {
      owner: "AccessibilityKeyboardNavigationService",
      state: "available",
      actionRegistration: actionOwner.availableEvidence.actionRegistration,
      actionInvocationEvidence: actionOwner.availableEvidence.actionInvocationEvidence,
      statusProjection: Boolean(status.id),
      liveRegionProjection: aria.alertRegions.length > 0 || aria.statusRegions.length > 0,
      codekPath: "frontend/vite-project/src/workbench/accessibilityKeyboardNavigationService.ts",
    },
    fullSignalOwner: {
      owner: "IAccessibilitySignalService",
      state: "blocked",
      requiredSurfaces: [
        "IAccessibilitySignalService playSignal/playSignals/playSignalLoop implementation",
        "AccessibilitySignal audio media asset loading and playback",
        "AccessibilityProgressSignalScheduler wiring for long-running progress UI",
        "accessibility.signals settings schema and command UI",
        "telemetry-backed signal enablement and user-gesture policy",
      ],
      blockedReason: "The existing keyboard-navigation bridge is a real status/alert live-region owner, but it is not VS Code's full signal service owner for audio, progress loops, configuration, telemetry, or enablement policy.",
      vscodeParallels: [
        "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts AccessibilitySignalService",
        "src/vs/platform/accessibilitySignal/browser/progressAccessibilitySignalScheduler.ts AccessibilityProgressSignalScheduler",
        "src/vs/workbench/contrib/accessibilitySignals/browser/accessibilitySignal.contribution.ts registers IAccessibilitySignalService and signal help commands",
        "src/vs/workbench/contrib/accessibility/browser/accessibilityConfiguration.ts registers accessibility.signalOptions/accessibility.signals settings",
      ],
    },
    blockedIntegrationBoundary: {
      canImplementInThisThread: false,
      requiredCodekEntryPoints: [
        {
          path: "frontend/vite-project/src/accessibility/accessibleViewService.ts",
          state: "candidate",
          reason: "Can continue projecting signal readiness and registering minimal status/alert actions through the existing service facade.",
        },
        {
          path: "frontend/vite-project/src/workbench/accessibilityKeyboardNavigationService.ts",
          state: "candidate",
          reason: "Owns the existing screen-reader status, alert/status live regions, and signal action evidence without a second signal state source.",
        },
        {
          path: "frontend/vite-project/src/App.vue",
          state: "blocked",
          reason: "Full signal UI help/settings affordances and global workbench contribution wiring cross the current App/generic shell boundary.",
        },
        {
          path: "generic workbench progress/status/signal contribution owner",
          state: "blocked",
          reason: "Progress signal loops and signal configuration need a real workbench contribution owner, not a projection on AccessibleViewService.",
        },
      ],
      avoidedSurfaces: [
        "frontend/vite-project/src/App.vue",
        "generic workbench shell contribution wiring",
        "runtime imports from the external VS Code reference checkout",
      ],
      acceptanceEvidence: [
        "Minimal signal UI actions register and invoke through AccessibilityKeyboardNavigationService",
        "Projection exposes status/alert live-region evidence from the existing owner",
        "Full VS Code signal parity stays blocked until IAccessibilitySignalService, progress scheduler, audio assets, telemetry, and settings UI share one owner",
      ],
      blockedReason: "A stronger signal UI owner requires a real workbench contribution and settings/progress/audio ownership boundary. This thread can safely strengthen the contract, but should not wire App.vue or a new generic shell owner.",
    },
  }
}

export function createAccessibilitySignalUiActionOwnerProjection(
  evidenceActions: readonly AccessibilityActionEvidence[] = [],
): AccessibilitySignalUiActionOwnerProjection {
  const registeredActionIds = Object.values(ACCESSIBILITY_SIGNAL_UI_ACTION_IDS)
  const registeredActionIdSet: readonly string[] = registeredActionIds
  const invokedEvidence = evidenceActions.filter((action) => registeredActionIdSet.includes(action.actionId))
  return {
    source: "codek.accessibilitySignal.uiActionOwner",
    owner: "AccessibilityKeyboardNavigationService",
    state: "partial",
    noSecondSignalState: true,
    registeredActionIds,
    invokedEvidence,
    availableEvidence: {
      actionRegistration: true,
      actionInvocationEvidence: invokedEvidence.length > 0,
      announcementStatusBridge: true,
      liveRegionProjection: true,
    },
    blockedCapabilities: [
      "audio asset playback",
      "accessibility.signals configuration UI",
      "AccessibilityProgressSignalScheduler loop owner",
      "telemetry-backed signal enablement",
    ],
    blockedReason: "Codek can route signal UI actions through the existing AccessibilityKeyboardNavigationService status/alert live-region owner and evidence log, but it still does not own VS Code's audio playback, signal configuration, telemetry, or progress loop scheduler.",
    vscodeParallels: [
      "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts playSignal() forwards announcements to accessibilityService.status()",
      "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts playSignals() batches status announcements",
      "src/vs/platform/accessibilitySignal/browser/progressAccessibilitySignalScheduler.ts owns delayed progress signal loops",
    ],
  }
}

export function createAccessibilitySignalUiEvidenceProjection(
  status: AccessibilityStatusProjection = EMPTY_SIGNAL_STATUS,
  aria: AriaProjection = EMPTY_SIGNAL_ARIA,
  actionOwner: AccessibilitySignalUiActionOwnerProjection = createAccessibilitySignalUiActionOwnerProjection(),
): AccessibilitySignalUiEvidenceProjection {
  return {
    source: "codek.accessibilitySignal.uiEvidence",
    owner: "AccessibilityKeyboardNavigationService",
    state: "partial",
    noSecondSignalState: true,
    serviceBackedEvidence: {
      screenReaderStatusItem: { ...status },
      alertLiveRegionCount: aria.alertRegions.length,
      statusLiveRegionCount: aria.statusRegions.length,
      invokedActionIds: actionOwner.invokedEvidence.map((action) => action.actionId),
    },
    uiEvidence: {
      actionRegistration: actionOwner.availableEvidence.actionRegistration,
      statusProjection: Boolean(status.id),
      alertLiveRegionProjection: aria.alertRegions.length > 0,
      statusLiveRegionProjection: aria.statusRegions.length > 0,
      actionInvocationEvidence: actionOwner.availableEvidence.actionInvocationEvidence,
    },
    blockedOwners: [
      {
        owner: "IAccessibilitySignalService",
        state: "blocked",
        vscodePath: "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts",
        codekEvidence: "status-alert-live-region-only",
        blockedReason: "Codek can project status()/alert() style live-region announcements, but it does not own VS Code's playSignal/playSignals enablement split or signal lifecycle.",
      },
      {
        owner: "AccessibilitySignal audio assets",
        state: "blocked",
        vscodePath: "src/vs/platform/accessibilitySignal/browser/media",
        codekEvidence: "no-audio-asset-owner",
        blockedReason: "No Codek owner loads VS Code accessibility signal media files or plays signal sounds.",
      },
      {
        owner: "AccessibilityProgressSignalScheduler",
        state: "blocked",
        vscodePath: "src/vs/platform/accessibilitySignal/browser/progressAccessibilitySignalScheduler.ts",
        codekEvidence: "no-progress-signal-loop-owner",
        blockedReason: "Workbench progress bars are not wired to VS Code's delayed progress accessibility signal loop owner.",
      },
      {
        owner: "accessibility.signals configuration UI",
        state: "blocked",
        vscodePath: "src/vs/workbench/contrib/accessibility/browser/accessibilityConfiguration.ts",
        codekEvidence: "no-signal-settings-ui-owner",
        blockedReason: "Codek has no settings schema or UI affordance for per-signal sound and announcement configuration.",
      },
    ],
    blockedReason: "This is UI evidence for the existing screen-reader status/live-region signal bridge only; full VS Code accessibility signal UI still requires the real signal service, media, scheduler, telemetry, and settings owners.",
    vscodeParallels: [
      "src/vs/platform/accessibility/browser/accessibilityService.ts status()/alert() live-region bridge",
      "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts playSignal() splits announcement and audio paths",
      "src/vs/workbench/browser/workbench.ts installs AccessibilityProgressSignalScheduler for progress UI",
      "src/vs/workbench/contrib/accessibility/browser/accessibilityConfiguration.ts owns accessibility.signals settings",
    ],
  }
}

function withAccessibleViewFocusRestoreInvocation(
  lifecycle: AccessibleViewLifecycleProjection,
): AccessibleViewLifecycleProjection {
  return {
    ...lifecycle,
    focusRestoreInvocation: lifecycle.focusRestoreInvocation ?? createAccessibleViewFocusRestoreInvocationProjection(lifecycle.focusHandoff),
  }
}

export function createAccessibleViewEditorContextFocusOwnerMatrix(
  lifecycle: AccessibleViewLifecycleProjection,
  placement: AccessibleViewPlacementOwnerProjection = createAccessibleViewPlacementOwnerProjection(),
  editorShellFocusRestore: AccessibleViewEditorShellFocusRestoreProjection = createAccessibleViewEditorShellFocusRestoreProjection(lifecycle, placement),
): AccessibleViewEditorContextFocusOwnerMatrix {
  lifecycle = withAccessibleViewFocusRestoreInvocation(lifecycle)
  const workbenchPlacementProjection = placement.owner === "workbenchLayoutService" && placement.state === "partial"
  const editorShellFocusTargetProjection = editorShellFocusRestore.focusRestoreTargetOwner === "projected"
  return {
    source: "codek.accessibleView.editorContextFocusOwnerMatrix",
    state: "blocked",
    noSecondAccessibilityState: true,
    codeEditorWidget: {
      requiredOwner: "CodeEditorWidget",
      vscodePath: "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts",
      accessibleViewOwnerPath: "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts",
      codeEditorWidgetBacked: false,
      textModelBacked: false,
      availableEvidence: {
        providerLifecycleProjection: lifecycle.evidence.providerFactoryInvoked || lifecycle.evidence.lastProviderReplayAvailable,
        domShellReadonlyContentProjection: true,
      },
      blockedReason: "Codek has readonly DOM-shell content evidence only; it does not construct the VS Code AccessibleView CodeEditorWidget or own an accessible-view text model.",
    },
    contextView: {
      requiredOwner: "IContextViewService/ILayoutService",
      contextViewPath: "src/vs/platform/contextview/browser/contextView.ts",
      baseContextViewPath: "src/vs/base/browser/ui/contextview/contextview.ts",
      layoutServicePath: "src/vs/workbench/services/layout/browser/layoutService.ts",
      contextViewDelegateOwner: placement.contextViewDelegateOwner,
      layoutPlacementOwner: placement.layoutPlacementOwner,
      availableEvidence: {
        workbenchPlacementProjection,
        projectedActiveContainer: placement.activeContainer,
      },
      blockedReason: workbenchPlacementProjection
        ? "Workbench layout placement is projected from the existing shell, but no IContextViewService.showContextView delegate owns Accessible View show/hide."
        : "No Accessible View context-view delegate or layout placement owner is wired; local DOM shell evidence is not a context view owner.",
    },
    focusRestoreInvocation: {
      requiredOwner: "IEditorService/CodeEditorWidget.focus",
      editorServicePath: "src/vs/workbench/services/editor/common/editorService.ts",
      codeEditorWidgetPath: "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts",
      focusRestoreTargetOwner: editorShellFocusRestore.focusRestoreTargetOwner,
      focusRestoreInvocationOwner: lifecycle.focusRestoreInvocation.focusRestoreInvocationOwner,
      activeEditor: lifecycle.focusRestoreInvocation.activeEditor || editorShellFocusRestore.activeEditor,
      projectedFocusTargetId: lifecycle.focusHandoff.targetId,
      availableEvidence: {
        editorShellFocusTargetProjection,
        focusTargetMatchesActiveEditor: editorShellFocusRestore.focusTargetMatchesActiveEditor,
      },
      blockedReason: lifecycle.focusRestoreInvocation.invoked
        ? "App.vue invokes the existing Monaco editor.focus() during Accessible View DOM-shell close, but full parity remains blocked until a real IEditorService/CodeEditorWidget owner controls this lifecycle."
        : editorShellFocusTargetProjection
        ? "The existing layout shell identifies the editor focus target, but invoking focus still requires the real IEditorService/CodeEditorWidget owner."
        : "There is no projected editor focus target and no real IEditorService/CodeEditorWidget focus invocation owner.",
    },
    reusableShellEvidence: {
      domShellProjection: "partial",
      workbenchLayoutProjection: placement.state,
      editorShellFocusRestoreProjection: editorShellFocusRestore.state,
      completeAccessibleViewUiOwner: false,
    },
    missingOwners: [
      "AccessibleView CodeEditorWidget construction and text model owner",
      ...workbenchPlacementProjection ? [] : ["IContextViewService.showContextView delegate and layout placement owner"],
      ...editorShellFocusTargetProjection ? [] : ["editor focus restore target owner"],
      ...lifecycle.focusRestoreInvocation.invoked ? [] : ["IEditorService/CodeEditorWidget.focus invocation owner"],
    ],
    blockedReason: "Local shell evidence can document provider lifecycle, DOM selectors, workbench placement, and projected focus targets, but it must stay evidence/partial until a real AccessibleView workbench owner wires CodeEditorWidget, context view, and focus invocation together.",
    vscodeParallels: [
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts creates CodeEditorWidget in the AccessibleView owner",
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts show() calls IContextViewService.showContextView(delegate)",
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts close/hide flow calls IContextViewService.hideContextView()",
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts render path calls _editorWidget.focus()",
      "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts focus() owns the actual editor focus invocation",
    ],
  }
}

export function createAccessibleViewDomShellReadinessProjection(
  lifecycle: AccessibleViewLifecycleProjection,
  placement: AccessibleViewPlacementOwnerProjection = createAccessibleViewPlacementOwnerProjection(),
  editorShellFocusRestore: AccessibleViewEditorShellFocusRestoreProjection = createAccessibleViewEditorShellFocusRestoreProjection(lifecycle, placement),
): AccessibleViewDomShellReadinessProjection {
  lifecycle = withAccessibleViewFocusRestoreInvocation(lifecycle)
  const workbenchPlacementProjection = placement.owner === "workbenchLayoutService" && placement.state === "partial"
  const editorShellFocusTargetProjection = editorShellFocusRestore.focusRestoreTargetOwner === "projected"
  return {
    source: "codek.accessibleView.domShellReadiness",
    owner: "headless-service-adapter",
    state: "partial",
    noSecondAccessibilityState: true,
    selectors: {
      root: "[data-accessible-view-dom-shell='true']",
      title: "[data-accessible-view-title='true']",
      content: "[data-accessible-view-content='true']",
      toolbar: "[data-accessible-view-toolbar='true']",
    },
    focus: {
      contentFocusable: true,
      focusRestoreTargetOwner: editorShellFocusRestore.focusRestoreTargetOwner,
      focusRestoreInvocationOwner: lifecycle.focusRestoreInvocation.focusRestoreInvocationOwner,
      projectedFocusTargetId: lifecycle.focusHandoff.targetId,
      activeEditor: lifecycle.focusRestoreInvocation.activeEditor || editorShellFocusRestore.activeEditor,
      codeEditorWidgetBacked: false,
    },
    readiness: {
      rootSelector: true,
      titleSelector: true,
      readonlyContentSelector: true,
      toolbarSelector: true,
      providerLifecycleProjection: lifecycle.evidence.providerFactoryInvoked || lifecycle.evidence.lastProviderReplayAvailable,
      workbenchPlacementProjection,
      editorShellFocusTargetProjection,
      actionRegistryProjection: true,
    },
    blockedOwners: [
      "CodeEditorWidget-backed AccessibleView content owner",
      ...workbenchPlacementProjection ? [] : ["IContextViewService/ILayoutService context view owner"],
      "AccessibleView WorkbenchToolBar rendering owner",
      "AccessibleViewSymbolQuickPick owner backed by IQuickInputService.createQuickPick",
      ...lifecycle.focusRestoreInvocation.invoked ? [] : ["IEditorService/CodeEditorWidget.focus invocation owner"],
    ],
    blockedReason: editorShellFocusTargetProjection
      ? lifecycle.focusRestoreInvocation.invoked
        ? "The headless DOM shell exposes stable selectors, readonly content, toolbar metadata, and App-owned editor.focus() restore evidence; full readiness remains blocked until a real CodeEditorWidget/context view/toolbar/quick-pick owner is wired."
        : "The headless DOM shell exposes stable selectors, readonly content, toolbar metadata, and a projected focus target; full readiness remains blocked until a real CodeEditorWidget/context view/toolbar/quick-pick/focus invocation owner is wired."
      : "The headless DOM shell exposes stable selectors, readonly content, and toolbar metadata; full readiness remains blocked until a real CodeEditorWidget/context view/toolbar/quick-pick/editor focus owner is wired.",
  }
}

export function createAccessibleViewOwnerFeasibilityProjection(
  lifecycle: AccessibleViewLifecycleProjection,
  placement: AccessibleViewPlacementOwnerProjection = createAccessibleViewPlacementOwnerProjection(),
  editorShellFocusRestore: AccessibleViewEditorShellFocusRestoreProjection = createAccessibleViewEditorShellFocusRestoreProjection(lifecycle, placement),
): AccessibleViewOwnerFeasibilityProjection {
  lifecycle = withAccessibleViewFocusRestoreInvocation(lifecycle)
  const hasPlacementOwner = placement.owner === "workbenchLayoutService" && placement.state === "partial"
  const hasEditorShellFocusRestore = editorShellFocusRestore.owner === "workbenchLayoutService" && editorShellFocusRestore.state === "partial"
  return {
    source: "codek.accessibleView.ownerFeasibility",
    owner: hasEditorShellFocusRestore
      ? "editor-shell-focus-restore-adapter"
      : hasPlacementOwner ? "workbench-placement-adapter" : "missing",
    state: "blocked",
    vscodeOwner: {
      accessibleViewClassPath: "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts",
      codeEditorWidgetPath: "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts",
      editorServicePath: "src/vs/workbench/services/editor/common/editorService.ts",
      contextViewPath: "src/vs/base/browser/ui/contextview/contextview.ts",
      layoutServicePath: "src/vs/workbench/services/layout/browser/layoutService.ts",
    },
    availableEvidence: {
      providerLifecycleProjection: lifecycle.evidence.providerFactoryInvoked || lifecycle.evidence.lastProviderReplayAvailable,
      commandMenuProjection: true,
      domShellProjection: true,
      workbenchPlacementProjection: hasPlacementOwner || undefined,
      editorShellFocusRestoreProjection: hasEditorShellFocusRestore || undefined,
      projectedActiveEditor: editorShellFocusRestore.activeEditor || undefined,
      projectedFocusTargetId: lifecycle.focusHandoff.targetId,
    },
    missingOwners: [
      "CodeEditorWidget construction and text model ownership",
      ...hasPlacementOwner ? [] : [
        "IContextViewService.showContextView delegate and owner container",
        "ILayoutService active container dimensions and quick-pick top placement",
      ],
      "Workbench toolbar/quick-pick action owner",
      ...hasEditorShellFocusRestore ? [] : ["real editor focus restore target after context view hide"],
      "real CodeEditorWidget.focus()/IEditorService focus invocation after context view hide",
    ],
    minimumSafeNextStep: hasPlacementOwner ? "wire-editor-shell-owner" : "wire-workbench-placement-owner",
    blockedReason: hasEditorShellFocusRestore
      ? "Workbench placement and active-editor focus restore target evidence are now projected through the existing layout shell; full parity remains blocked on a real CodeEditorWidget/text model owner, toolbar/quick-pick owner, and actual IEditorService/CodeEditorWidget focus invocation."
      : hasPlacementOwner
        ? "Workbench placement owner evidence is now projected through the existing layout shell; full parity remains blocked on a real CodeEditorWidget/text model owner, toolbar/quick-pick owner, and editor focus restore."
      : "Current Codek accessible view state is a service-level projection only. Completing owner parity requires a workbench placement/editor shell owner outside this accessibility service boundary.",
  }
}

export function createAccessibleViewEditorShellFocusRestoreProjection(
  lifecycle: AccessibleViewLifecycleProjection,
  placement: AccessibleViewPlacementOwnerProjection = createAccessibleViewPlacementOwnerProjection(),
): AccessibleViewEditorShellFocusRestoreProjection {
  lifecycle = withAccessibleViewFocusRestoreInvocation(lifecycle)
  const activeEditor = placement.activeContainer?.editor
  const hasProjectedTarget = lifecycle.focusHandoff.state === "projected" && Boolean(lifecycle.focusHandoff.targetId)
  const focusTargetMatchesActiveEditor = hasProjectedTarget
    && lifecycle.focusHandoff.targetId === "editor:active"
    && Boolean(activeEditor)
  if (!focusTargetMatchesActiveEditor) {
    return {
      source: "codek.accessibleView.editorShellFocusRestoreProjection",
      owner: "missing",
      state: "blocked",
    activeEditor,
    projectedFocusTargetId: lifecycle.focusHandoff.targetId,
    focusRestoreTargetOwner: "missing",
    focusRestoreInvocationOwner: lifecycle.focusRestoreInvocation.focusRestoreInvocationOwner,
      focusTargetMatchesActiveEditor: false,
      codeEditorWidgetBacked: false,
      textModelBacked: false,
      blockedReason: activeEditor
        ? "The layout shell exposes an active editor, but Accessible View close did not request editor:active focus restore."
        : "No active editor is available from the workbench layout shell, so Accessible View cannot project an editor focus restore target.",
      vscodeParallels: [
        "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts hide() saves provider position and hides the context view",
        "src/vs/workbench/services/editor/common/editorService.ts exposes activeEditor/activeTextEditorControl for real editor focus owners",
        "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts focus() owns the actual text editor focus invocation",
      ],
    }
  }

  return {
    source: "codek.accessibleView.editorShellFocusRestoreProjection",
    owner: "workbenchLayoutService",
    state: "partial",
    stateSource: "workbenchLayoutService",
    noSecondFocusState: true,
    activeEditor,
    projectedFocusTargetId: lifecycle.focusHandoff.targetId,
    focusRestoreTargetOwner: "projected",
    focusRestoreInvocationOwner: lifecycle.focusRestoreInvocation.focusRestoreInvocationOwner,
    focusTargetMatchesActiveEditor: true,
    codeEditorWidgetBacked: false,
    textModelBacked: false,
    blockedReason: lifecycle.focusRestoreInvocation.invoked
      ? "Codek can project the editor focus restore target and App.vue invokes the existing Monaco editor.focus(); full VS Code parity remains blocked until a real IEditorService/CodeEditorWidget owner controls this lifecycle."
      : "Codek can project the editor focus restore target from the existing layout shell, but it still does not own the real CodeEditorWidget/IEditorService focus invocation.",
    vscodeParallels: [
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts hide() saves provider position and hides the context view",
      "src/vs/workbench/services/editor/common/editorService.ts exposes activeEditor/activeTextEditorControl for real editor focus owners",
      "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts focus() owns the actual text editor focus invocation",
    ],
  }
}

export function createAccessibleViewFocusRestoreInvocationProjection(
  focusHandoff: AccessibleViewLifecycleProjection["focusHandoff"] = { requested: false, state: "none" },
  evidence?: AccessibleViewFocusRestoreInvocationEvidence,
): AccessibleViewFocusRestoreInvocationProjection {
  const invoked = Boolean(
    evidence?.invoked
    && evidence.targetId === "editor:active"
    && focusHandoff.state === "projected"
    && focusHandoff.targetId === evidence.targetId,
  )
  return {
    source: "codek.accessibleView.focusRestoreInvocation",
    owner: invoked ? "App.vue editor.focus" : "missing",
    state: invoked ? "partial" : "blocked",
    targetId: evidence?.targetId || focusHandoff.targetId,
    activeEditor: evidence?.activeEditor,
    invoked,
    focusRestoreInvocationOwner: invoked ? "App.vue editor.focus" : "missing",
    codeEditorWidgetBacked: false,
    noSecondFocusState: true,
    blockedReason: invoked
      ? "App.vue closed the visible DOM shell and invoked the existing Monaco editor.focus() for editor:active; this is real UI focus restore evidence, but not a VS Code AccessibleView-owned CodeEditorWidget/IEditorService lifecycle."
      : "No App/editor-shell focus invocation evidence has been recorded for the current Accessible View focus handoff.",
    vscodeParallels: [
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts hide() returns focus through the AccessibleView owner lifecycle",
      "src/vs/workbench/contrib/accessibility/browser/accessibleViewActions.ts calls editor.focus() after editor-affecting Accessible View actions",
      "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts focus() owns the concrete text editor focus invocation",
    ],
  }
}

export function createAccessibleViewToolbarQuickPickFocusInvocationProjection(
  lifecycle: AccessibleViewLifecycleProjection,
  editorShellFocusRestore: AccessibleViewEditorShellFocusRestoreProjection = createAccessibleViewEditorShellFocusRestoreProjection(lifecycle),
  symbolQuickPickOwner: AccessibleViewToolbarQuickPickFocusInvocationProjection["quickPick"]["symbolQuickPickOwner"] = "missing",
): AccessibleViewToolbarQuickPickFocusInvocationProjection {
  lifecycle = withAccessibleViewFocusRestoreInvocation(lifecycle)
  const hasSymbolQuickPickOwner = symbolQuickPickOwner === "QuickInputService.createQuickPick"
  return {
    source: "codek.accessibleView.toolbarQuickPickFocusInvocationProjection",
    owner: "menu-service-projection",
    state: "blocked",
    noSecondActionState: true,
    toolbar: {
      requiredOwner: "WorkbenchToolBar + MenuId.AccessibleView",
      menuId: ACCESSIBLE_VIEW_COMMAND_MENU_CONTRACT.menuId,
      menuActionIds: ACCESSIBLE_VIEW_COMMAND_MENU_CONTRACT.accessibleViewMenuActionIds,
      actionRegistryBacked: true,
      workbenchToolbarWidgetBacked: false,
      blockedReason: "Codek registers Accessible View action/menu metadata, but no AccessibleView widget owns a WorkbenchToolBar instance or action rendering lifecycle.",
      vscodeParallels: [
        "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts constructs WorkbenchToolBar for Accessible View",
        "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts _updateToolbar() reads MenuId.AccessibleView actions",
        "src/vs/workbench/contrib/accessibility/browser/accessibleViewActions.ts contributes actions to MenuId.AccessibleView",
      ],
    },
    quickPick: {
      requiredOwner: "IQuickInputService.createQuickPick",
      quickInputServicePath: "src/vs/platform/quickinput/browser/quickInputService.ts",
      symbolQuickPickOwner,
      goToSymbolActionRegistered: ACCESSIBLE_VIEW_COMMAND_MENU_CONTRACT.accessibleViewMenuActionIds.includes(ACCESSIBLE_VIEW_ACTION_IDS.goToSymbol),
      genericQuickInputSurface: {
        paths: [
          "frontend/vite-project/src/workbench/quickInput.ts",
          "frontend/vite-project/src/components/QuickPickDialog.vue",
        ],
        state: "available",
        reusableInfrastructure: true,
        accessibleViewSymbolQuickPickOwner: hasSymbolQuickPickOwner,
        blockedReason: hasSymbolQuickPickOwner
          ? "Codek's generic QuickInput service is invoked by AccessibleViewService.goToSymbol for provider symbols; the remaining gap is the VS Code widget-owned AccessibleViewSymbolQuickPick lifecycle."
          : "Codek's generic QuickInput service and dialog are reusable infrastructure, but they are not an AccessibleViewSymbolQuickPick owner bound to the AccessibleView widget lifecycle.",
      },
      blockedReason: hasSymbolQuickPickOwner
        ? "Go To Symbol opens the existing QuickInputService.createQuickPick-backed surface and updates Accessible View provider position; full parity remains partial until a real AccessibleView widget owns the picker lifecycle."
        : "The Go To Symbol action id and context keys are projected, but Codek has no AccessibleViewSymbolQuickPick owner wired to IQuickInputService.createQuickPick.",
      vscodeParallels: [
        "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts AccessibleViewSymbolQuickPick.show() creates a quick pick",
        "src/vs/platform/quickinput/browser/quickInputService.ts createQuickPick() owns the picker lifecycle",
      ],
    },
    focusInvocation: {
      requiredOwner: "IEditorService/CodeEditorWidget.focus",
      editorServicePath: "src/vs/workbench/services/editor/common/editorService.ts",
      codeEditorWidgetPath: "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts",
      focusRestoreTargetOwner: editorShellFocusRestore.focusRestoreTargetOwner,
      focusRestoreInvocationOwner: lifecycle.focusRestoreInvocation.focusRestoreInvocationOwner,
      activeEditor: lifecycle.focusRestoreInvocation.activeEditor || editorShellFocusRestore.activeEditor,
      projectedFocusTargetId: lifecycle.focusHandoff.targetId,
      codeEditorWidgetBacked: false,
      blockedReason: lifecycle.focusRestoreInvocation.invoked
        ? "App.vue invokes the existing Monaco editor.focus() after Accessible View DOM-shell close; full parity remains blocked until IEditorService/CodeEditorWidget owns the Accessible View focus lifecycle."
        : editorShellFocusRestore.focusRestoreTargetOwner === "projected"
        ? "The existing layout shell can project the editor focus target, but actual focus invocation still requires the generic editor shell/App.vue CodeEditorWidget or IEditorService owner."
        : "No projected editor focus target is available, and actual focus invocation still requires the generic editor shell/App.vue CodeEditorWidget or IEditorService owner.",
      vscodeParallels: [
        "src/vs/workbench/contrib/accessibility/browser/accessibleViewActions.ts resolves active/focused editor before inline completion accept",
        "src/vs/workbench/contrib/accessibility/browser/accessibleViewActions.ts calls editor.focus() after accepting inline completion",
        "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts focus() owns text editor focus invocation",
      ],
    },
    remainingBlockedSurfaces: [
      "AccessibleView WorkbenchToolBar instance and action rendering owner",
      hasSymbolQuickPickOwner
        ? "AccessibleViewSymbolQuickPick owned by the real AccessibleView widget lifecycle"
        : "AccessibleViewSymbolQuickPick backed by IQuickInputService.createQuickPick",
      ...lifecycle.focusRestoreInvocation.invoked
        ? ["IEditorService/CodeEditorWidget-owned focus lifecycle after Accessible View close/action"]
        : ["IEditorService/CodeEditorWidget.focus invocation after Accessible View close/action"],
    ],
  }
}

export function createAccessibleViewPlacementOwnerProjection(
  shell?: Pick<WorkbenchShellLayoutProjection, "stateSource" | "noSecondLayoutState" | "active">,
): AccessibleViewPlacementOwnerProjection {
  if (!shell) {
    return {
      source: "codek.accessibleView.placementOwnerProjection",
      owner: "missing",
      state: "blocked",
      requiredOwner: "IContextViewService/ILayoutService",
      contextViewDelegateOwner: "missing",
      layoutPlacementOwner: "missing",
      blockedReason: "No workbench layout shell projection was provided, so the Accessible View context-view placement owner remains missing.",
      vscodeParallels: [
        "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts show() builds an IContextViewDelegate",
        "src/vs/base/browser/ui/contextview/contextview.ts positions the delegate inside an owner container",
        "src/vs/workbench/services/layout/browser/layoutService.ts provides active container placement evidence",
      ],
    }
  }

  return {
    source: "codek.accessibleView.placementOwnerProjection",
    owner: "workbenchLayoutService",
    state: "partial",
    stateSource: shell.stateSource,
    noSecondLayoutState: shell.noSecondLayoutState,
    requiredOwner: "IContextViewService/ILayoutService",
    contextViewDelegateOwner: "projected",
    layoutPlacementOwner: "projected",
    activeContainer: {
      viewContainerId: shell.active.viewContainerId,
      panelId: shell.active.panelId,
      editor: shell.active.editor,
    },
    vscodeParallels: [
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts show() builds an IContextViewDelegate",
      "src/vs/base/browser/ui/contextview/contextview.ts positions the delegate inside an owner container",
      "src/vs/workbench/services/layout/browser/layoutService.ts provides active container placement evidence",
    ],
  }
}

export function createAccessibilitySignalRoutingContract(): AccessibilitySignalRoutingContract {
  return {
    source: "codek.accessibilitySignal.routingContract",
    state: "partial",
    owner: "AccessibilityKeyboardNavigationService",
    stateSource: "AccessibilityKeyboardNavigationService",
    noSecondSignalState: true,
    vscodeOwner: {
      signalServicePath: "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts",
      progressSchedulerPath: "src/vs/platform/accessibilitySignal/browser/progressAccessibilitySignalScheduler.ts",
      accessibleViewPath: "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts",
      accessibilityConfigurationPath: "src/vs/workbench/contrib/accessibility/browser/accessibilityConfiguration.ts",
    },
    availableEvidence: {
      statusProjection: true,
      liveRegionProjection: true,
      screenReaderStatusItem: true,
    },
    missingOwners: [
      "IAccessibilitySignalService playSignal/playSignalLoop owner with sound and announcement enablement",
      "AccessibilitySignal audio asset registry and telemetry owner",
      "AccessibilityProgressSignalScheduler for long-running progress cues",
      "accessibility.signals configuration schema and settings UI owner",
    ],
    blockedReason: "Codek routes status and live-region announcements through the existing AccessibilityKeyboardNavigationService. Full VS Code signal parity remains blocked because there is no IAccessibilitySignalService owner for playSignal/playSignalLoop, audio assets, telemetry, progress scheduling, or accessibility.signals configuration UI.",
  }
}

export function createAccessibleViewUiSurfaceAuditProjection(): AccessibleViewUiSurfaceAuditProjection {
  return {
    source: "codek.accessibleView.uiSurfaceAudit",
    state: "blocked",
    noSecondAccessibilityState: true,
    foundAccessibleViewWorkbenchOwner: false,
    foundGenericQuickInputSurface: true,
    foundDomShellProjection: true,
    foundExplorerTreeAriaSurface: true,
    listTreeAriaEvidence: {
      owner: "ExplorerTreeHost + CodekListView",
      state: "available",
      noSecondAccessibilityState: true,
      capabilities: {
        widgetRoleFromListView: true,
        activeDescendantFromModelFocus: true,
        rowIdsFromRenderer: true,
        focusableTreeWidget: true,
      },
      reusableForAccessibleViewOwner: false,
      blockedReason: "ExplorerTreeHost and CodekListView provide VS Code-style tree/list ARIA evidence for the Explorer, but they do not own AccessibleView provider rendering, context-view placement, toolbar actions, symbol quick-pick, or editor focus restore.",
      vscodeParallels: [
        "src/vs/base/browser/ui/list/listWidget.ts updates aria-activedescendant from focused model rows",
        "src/vs/base/browser/ui/list/listView.ts owns row roles and stable element DOM ids",
        "src/vs/base/browser/ui/tree/abstractTree.ts owns treeitem role and aria-label projection",
      ],
    },
    codekSurfaces: [
      {
        path: "frontend/vite-project/src/accessibility/accessibleViewService.ts",
        role: "provider-lifecycle-and-dom-shell-projection",
        ownerState: "partial",
        reusableForAccessibleViewOwner: false,
        reason: "This service owns provider metadata, lifecycle evidence, command/menu projection, and a DOM-shell renderer projection, but not a VS Code-style workbench widget.",
      },
      {
        path: "frontend/vite-project/src/components/QuickPickDialog.vue",
        role: "generic-quick-input-dialog",
        ownerState: "available",
        reusableForAccessibleViewOwner: false,
        reason: "The generic quick-pick dialog can render QuickInput requests, but it is not the AccessibleViewSymbolQuickPick owner and is not bound to the AccessibleView widget lifecycle.",
      },
      {
        path: "frontend/vite-project/src/workbench/quickInput.ts",
        role: "generic-quick-input-service",
        ownerState: "available",
        reusableForAccessibleViewOwner: false,
        reason: "The generic QuickInput service is reusable infrastructure only; AccessibleView still needs a widget-owned symbol quick-pick bridge.",
      },
      {
        path: "frontend/vite-project/src/vscode-adapter/platform/actions/common/menuRegistry.ts",
        role: "AccessibleView menu/action registry projection",
        ownerState: "partial",
        reusableForAccessibleViewOwner: false,
        reason: "MenuId.AccessibleView actions are registered and filterable by context keys, but no WorkbenchToolBar instance renders them for an AccessibleView owner.",
      },
      {
        path: "frontend/vite-project/src/vscode-adapter/workbench/services/layout/browser/layoutService.ts",
        role: "workbench-layout-placement-evidence",
        ownerState: "partial",
        reusableForAccessibleViewOwner: false,
        reason: "Layout state can project active container evidence, but it does not own IContextViewService.showContextView or CodeEditorWidget placement.",
      },
      {
        path: "frontend/vite-project/src/components/FileTree.vue",
        role: "explorer-container-delegating-to-tree-host",
        ownerState: "available",
        reusableForAccessibleViewOwner: false,
        reason: "FileTree is the Explorer container and delegates real filesystem rows to ExplorerTreeHost; it is intentionally not touched or treated as the AccessibleView workbench owner.",
      },
      {
        path: "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
        role: "explorer-tree-host-keyboard-and-active-descendant-owner",
        ownerState: "available",
        reusableForAccessibleViewOwner: false,
        reason: "ExplorerTreeHost owns Explorer tree keyboard navigation and active descendant sync through CodekListView, not AccessibleView provider UI or focus restoration.",
      },
      {
        path: "frontend/vite-project/src/explorer/tree/CodekListView.ts",
        role: "virtualized-list-tree-aria-owner",
        ownerState: "available",
        reusableForAccessibleViewOwner: false,
        reason: "CodekListView provides role, label, focusability, and aria-activedescendant for list/tree widgets; it does not provide a CodeEditorWidget-backed AccessibleView.",
      },
    ],
    missingOwners: [
      "AccessibleView class or component that owns CodeEditorWidget-backed content rendering",
      "AccessibleView-specific WorkbenchToolBar bound to MenuId.AccessibleView",
      "AccessibleViewSymbolQuickPick owner that invokes IQuickInputService.createQuickPick from the AccessibleView widget lifecycle",
      "IContextViewService/ILayoutService owner that places and hides the AccessibleView context view",
      "IEditorService/CodeEditorWidget.focus invocation owner for focus restore",
    ],
    minimumSafeNextStep: "wire-real-accessible-view-workbench-owner",
    blockedReason: "A repository scan found generic QuickInput/Dialog and DOM-shell projection surfaces, but no AccessibleView-specific workbench owner. Treating those generic surfaces as the full VS Code AccessibleView UI would create fake ownership and a second accessibility state path.",
    vscodeParallels: [
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts owns CodeEditorWidget, WorkbenchToolBar, context view placement, symbol quick pick, and focus restore together",
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts AccessibleViewSymbolQuickPick.show() creates the symbol quick pick from inside the AccessibleView lifecycle",
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts _updateToolbar() renders MenuId.AccessibleView actions through WorkbenchToolBar",
    ],
  }
}

export function createAccessibleViewTrueOwnerFollowUpProjection(
  rendererProjection: AccessibleViewRendererProjection = createAccessibleViewRendererProjection({
    source: "codek.accessibleView.lifecycleProjection",
    owner: "headless-service-adapter",
    state: "partial",
    isShown: false,
      context: {
        accessibilityHelpIsShown: false,
        accessibleViewIsShown: false,
        supportsNavigation: false,
        goToSymbolSupported: false,
      },
    focusHandoff: { requested: false, state: "none" },
    evidence: {
      providerFactoryInvoked: false,
      providerOnOpenCalled: false,
      providerOnCloseCalled: false,
      providerDisposeCalled: false,
      lastProviderReplayAvailable: false,
      lastProviderReplayed: false,
    },
    remainingBlockedSurfaces: ACCESSIBLE_VIEW_WIDGET_CONTRIBUTION_CONTRACT.missingSurfaces,
  }),
): AccessibleViewTrueOwnerFollowUpProjection {
  return {
    source: "codek.accessibleView.trueOwnerFollowUp",
    state: "blocked",
    noSecondAccessibilityState: true,
    attemptedMinimalOwnerDecision: {
      decision: "blocked-contract",
      reason: "A minimal AccessibleView UI owner cannot be safely attached to ExplorerTreeHost/FileTree because those surfaces own Explorer tree ARIA only; attaching the missing editor focus path requires the generic editor shell/App.vue owner, which is outside this thread's safe edit boundary.",
      avoidedSurfaces: [
        "frontend/vite-project/src/components/FileTree.vue",
        "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
        "frontend/vite-project/src/App.vue",
        "generic editor shell / Monaco CodeEditorWidget focus bridge",
      ],
    },
    commandMenuSignalFocusEvidence: {
      commandMenuProjection: {
        menuId: rendererProjection.toolbar.menuId,
        menuActionIds: rendererProjection.toolbar.actionIds,
        actionRegistryBacked: true,
        workbenchToolbarWidgetBacked: rendererProjection.toolbarQuickPickFocusInvocation.toolbar.workbenchToolbarWidgetBacked,
      },
      signalProjection: {
        stateSource: "AccessibilityKeyboardNavigationService",
        liveRegionProjection: true,
        soundPlayback: "blocked",
        progressSignalScheduler: "blocked",
      },
      focusProjection: {
        focusRestoreTargetOwner: rendererProjection.editorShellFocusRestore.focusRestoreTargetOwner,
        focusRestoreInvocationOwner: rendererProjection.editorShellFocusRestore.focusRestoreInvocationOwner,
        activeEditor: rendererProjection.editorShellFocusRestore.activeEditor,
        projectedFocusTargetId: rendererProjection.focusHandoff.targetId,
        codeEditorWidgetBacked: false,
      },
    },
    requiredTrueOwners: [
      {
        owner: "CodeEditorWidget",
        state: "blocked",
        vscodePath: "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts",
        codekEvidence: "dom-shell-readonly-content-only",
        blockedReason: "Codek exposes readonly DOM-shell content evidence, but does not construct the AccessibleView CodeEditorWidget or accessible-view text model.",
      },
      {
        owner: "IContextViewService/ILayoutService",
        state: "blocked",
        vscodePath: "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts show() + src/vs/workbench/services/layout/browser/layoutService.ts",
        codekEvidence: "workbench-layout-placement-projection-only",
        blockedReason: "Workbench layout state can project placement evidence, but no AccessibleView-owned IContextViewDelegate shows or hides a context view.",
      },
      {
        owner: "WorkbenchToolBar + MenuId.AccessibleView",
        state: "blocked",
        vscodePath: "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts _updateToolbar()",
        codekEvidence: "menu-action-registry-only",
        blockedReason: "Accessible View menu actions are registered, but no AccessibleView widget owns a WorkbenchToolBar render lifecycle.",
      },
      {
        owner: "IQuickInputService.createQuickPick",
        state: "blocked",
        vscodePath: "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts AccessibleViewSymbolQuickPick",
        codekEvidence: "generic-quick-input-surface-only",
        blockedReason: "Generic QuickInput infrastructure exists, but there is no AccessibleViewSymbolQuickPick owner tied to provider navigation.",
      },
      {
        owner: "IEditorService/CodeEditorWidget.focus",
        state: "blocked",
        vscodePath: "src/vs/workbench/services/editor/common/editorService.ts + src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts",
        codekEvidence: "focus-target-projection-only",
        blockedReason: "The layout shell can project a focus target in some cases, but no real editor service or CodeEditorWidget focus invocation owner is wired.",
      },
    ],
    blockedIntegrationContract: {
      owner: "AccessibleView workbench/editor shell owner",
      state: "blocked",
      requiredInterfaces: [
        "IAccessibleViewService.show(provider, position) must create or reuse one AccessibleView workbench widget owner",
        "IContextViewService.showContextView/hideContextView must own placement and close lifecycle",
        "CodeEditorWidget plus accessible-view text model must own readonly provider rendering",
        "WorkbenchToolBar must render MenuId.AccessibleView actions from the AccessibleView widget lifecycle",
        "IQuickInputService.createQuickPick must be invoked by an AccessibleViewSymbolQuickPick owner",
        "IEditorService/CodeEditorWidget.focus must restore focus after close and editor-affecting actions",
      ],
      requiredCodekEntryPoints: [
        {
          path: "frontend/vite-project/src/accessibility/accessibleViewService.ts",
          state: "candidate",
          reason: "Service facade can remain the provider registry, command/menu, context-key, and lifecycle state source, but it cannot own DOM placement or editor focus invocation by itself.",
        },
        {
          path: "frontend/vite-project/src/vscode-adapter/workbench/services/layout/browser/layoutService.ts",
          state: "candidate",
          reason: "Layout projection can supply active container and active editor evidence for placement, but needs an IContextViewService-style owner to show and hide the AccessibleView surface.",
        },
        {
          path: "frontend/vite-project/src/App.vue",
          state: "blocked",
          reason: "The current editor shell and Monaco focus bridge live behind the app/generic editor shell boundary; wiring focus invocation here risks colliding with active shell work.",
        },
        {
          path: "generic editor shell / Monaco editor owner",
          state: "blocked",
          reason: "A real CodeEditorWidget-backed AccessibleView needs a concrete text-model and focus invocation owner rather than a dataset or DOM-shell projection.",
        },
      ],
      nonReusableEvidenceSurfaces: [
        {
          path: "frontend/vite-project/src/components/FileTree.vue",
          reason: "FileTree delegates Explorer rows and does not own provider rendering, context-view placement, toolbar actions, symbol quick-pick, or editor focus restore.",
        },
        {
          path: "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
          reason: "ExplorerTreeHost owns tree keyboard navigation and aria-activedescendant for Explorer rows only; reusing it as AccessibleView owner would create false ownership.",
        },
        {
          path: "frontend/vite-project/src/explorer/tree/CodekListView.ts",
          reason: "CodekListView is a virtualized list/tree DOM owner, not a CodeEditorWidget or AccessibleView provider text model owner.",
        },
        {
          path: "frontend/vite-project/src/components/QuickPickDialog.vue",
          reason: "The generic QuickPick dialog is reusable UI infrastructure but not an AccessibleViewSymbolQuickPick lifecycle owner.",
        },
      ],
      acceptanceEvidence: [
        "Focused tests prove command/menu/signal/focus projection remains single-source and blocked until the true owner exists",
        "A future implementation must show a real context-view surface without adding a second AccessibleView state source",
        "A future implementation must prove WorkbenchToolBar actions, AccessibleViewSymbolQuickPick, and CodeEditorWidget.focus are invoked by the same owner lifecycle",
      ],
      blockedReason: "The safe follow-up is a precise blocked contract: the required owner crosses workbench placement and generic editor shell focus boundaries that this thread should not modify without coordination.",
    },
    minimumSafeNextStep: "wire-real-accessible-view-workbench-owner",
    blockedReason: "Codek has command/menu, signal, DOM-shell, Explorer aria, and optional focus-target evidence, but the true AccessibleView owner must own these surfaces together before parity can be claimed.",
    vscodeParallels: [
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts owns CodeEditorWidget, context view placement, WorkbenchToolBar, symbol quick pick, and focus handoff in one lifecycle",
      "src/vs/workbench/contrib/accessibility/browser/accessibleViewActions.ts contributes MenuId.AccessibleView actions and editor focus actions",
      "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts owns signal playback/announcement state",
    ],
  }
}

export function renderAccessibleViewDomShell(
  projection: AccessibleViewRendererProjection,
  documentRef: Pick<Document, "createElement"> = document,
): HTMLElement {
  const container = documentRef.createElement("section")
  container.dataset.accessibleViewDomShell = "true"
  container.dataset.rendererOwner = projection.owner
  container.dataset.rendererState = projection.state
  if (projection.providerId) container.dataset.providerId = projection.providerId
  if (projection.providerType) container.dataset.providerType = projection.providerType
  container.setAttribute("role", projection.role)
  container.setAttribute("aria-modal", String(projection.ariaModal))
  container.setAttribute("aria-label", projection.title)
  if (projection.hidden) container.setAttribute("hidden", "")

  const title = documentRef.createElement("div")
  title.dataset.accessibleViewTitle = "true"
  title.textContent = projection.title
  container.appendChild(title)

  const content = documentRef.createElement("textarea")
  content.dataset.accessibleViewContent = "true"
  content.readOnly = projection.readonlyContent
  content.value = projection.content
  content.setAttribute("aria-label", projection.title)
  container.appendChild(content)

  const toolbar = documentRef.createElement("div")
  toolbar.dataset.accessibleViewToolbar = "true"
  toolbar.dataset.menuId = projection.toolbar.menuId
  toolbar.setAttribute("role", "toolbar")
  toolbar.setAttribute("aria-label", projection.title)
  toolbar.dataset.actionIds = projection.toolbar.actionIds.join(",")
  container.appendChild(toolbar)

  container.dataset.ownerFeasibility = projection.ownerFeasibility.state
  container.dataset.codeEditorWidgetBacked = String(projection.editor.codeEditorWidgetBacked)
  container.dataset.placementOwner = projection.placement.owner
  container.dataset.placementState = projection.placement.state
  container.dataset.editorShellFocusRestoreOwner = projection.editorShellFocusRestore.owner
    container.dataset.editorShellFocusRestoreState = projection.editorShellFocusRestore.state
    if (projection.editorShellFocusRestore.activeEditor) container.dataset.editorShellActiveEditor = projection.editorShellFocusRestore.activeEditor
  container.dataset.toolbarQuickPickFocusInvocationOwner = projection.toolbarQuickPickFocusInvocation.owner
  container.dataset.toolbarQuickPickFocusInvocationState = projection.toolbarQuickPickFocusInvocation.state
  container.dataset.quickPickOwner = projection.toolbarQuickPickFocusInvocation.quickPick.symbolQuickPickOwner
  container.dataset.genericQuickInputReusable = String(projection.toolbarQuickPickFocusInvocation.quickPick.genericQuickInputSurface.reusableInfrastructure)
  container.dataset.genericQuickInputAccessibleViewOwner = String(projection.toolbarQuickPickFocusInvocation.quickPick.genericQuickInputSurface.accessibleViewSymbolQuickPickOwner)
  container.dataset.focusInvocationOwner = projection.toolbarQuickPickFocusInvocation.focusInvocation.focusRestoreInvocationOwner
  container.dataset.domShellReadinessOwner = projection.domShellReadiness.owner
  container.dataset.domShellReadinessState = projection.domShellReadiness.state
  container.dataset.domShellRootSelectorReady = String(projection.domShellReadiness.readiness.rootSelector)
  container.dataset.domShellReadonlyContentSelectorReady = String(projection.domShellReadiness.readiness.readonlyContentSelector)
  container.dataset.domShellToolbarSelectorReady = String(projection.domShellReadiness.readiness.toolbarSelector)
  container.dataset.domShellFocusRestoreTargetOwner = projection.domShellReadiness.focus.focusRestoreTargetOwner
  container.dataset.domShellFocusInvocationOwner = projection.domShellReadiness.focus.focusRestoreInvocationOwner
  container.dataset.domShellProviderLifecycleProjection = String(projection.domShellReadiness.readiness.providerLifecycleProjection)
  container.dataset.domShellWorkbenchPlacementProjection = String(projection.domShellReadiness.readiness.workbenchPlacementProjection)
  container.dataset.domShellEditorFocusTargetProjection = String(projection.domShellReadiness.readiness.editorShellFocusTargetProjection)
  container.dataset.domShellBlockedOwners = projection.domShellReadiness.blockedOwners.join("|")

  return container
}

interface BoundAccessibleViewContextKeys {
  readonly accessibilityHelpIsShown: IContextKey<boolean>
  readonly accessibleViewIsShown: IContextKey<boolean>
  readonly accessibleViewSupportsNavigation: IContextKey<boolean>
  readonly accessibleViewVerbosityEnabled: IContextKey<boolean>
  readonly accessibleViewGoToSymbolSupported: IContextKey<boolean>
  readonly accessibleViewCurrentProviderId: IContextKey<string | undefined>
  readonly accessibleViewInCodeBlock: IContextKey<boolean>
  readonly accessibleViewContainsCodeBlocks: IContextKey<boolean>
  readonly accessibleViewHasUnassignedKeybindings: IContextKey<boolean>
  readonly accessibleViewHasAssignedKeybindings: IContextKey<boolean>
}

const EMPTY_SIGNAL_STATUS: AccessibilityStatusProjection = {
  id: "status.editor.screenReaderMode",
  visible: false,
  name: "Screen Reader Mode",
  text: "",
  ariaLabel: "",
  command: "showEditorScreenReaderNotification",
  kind: "prominent",
  alignment: "right",
  priority: 100.6,
}

const EMPTY_SIGNAL_ARIA: AriaProjection = {
  alertRegions: [
    { id: "alert-1", role: "alert", ariaAtomic: true, text: "" },
    { id: "alert-2", role: "alert", ariaAtomic: true, text: "" },
  ],
  statusRegions: [
    { id: "status-1", ariaLive: "polite", ariaAtomic: true, text: "" },
    { id: "status-2", ariaLive: "polite", ariaAtomic: true, text: "" },
  ],
}

const COMMAND_PALETTE_ACTION_IDS = [
  ACCESSIBLE_VIEW_ACTION_IDS.openAccessibleView,
  ACCESSIBLE_VIEW_ACTION_IDS.openAccessibilityHelp,
  ACCESSIBLE_VIEW_ACTION_IDS.showNext,
  ACCESSIBLE_VIEW_ACTION_IDS.showPrevious,
  ACCESSIBLE_VIEW_ACTION_IDS.goToSymbol,
  ACCESSIBLE_VIEW_ACTION_IDS.disableVerbosityHint,
  ACCESSIBLE_VIEW_ACTION_IDS.acceptInlineCompletion,
] as const

const ACCESSIBLE_VIEW_MENU_ACTION_IDS = [
  ACCESSIBLE_VIEW_ACTION_IDS.showNext,
  ACCESSIBLE_VIEW_ACTION_IDS.showPrevious,
  ACCESSIBLE_VIEW_ACTION_IDS.goToSymbol,
  ACCESSIBLE_VIEW_ACTION_IDS.disableVerbosityHint,
  ACCESSIBLE_VIEW_ACTION_IDS.nextCodeBlock,
  ACCESSIBLE_VIEW_ACTION_IDS.previousCodeBlock,
  ACCESSIBLE_VIEW_ACTION_IDS.configureUnassignedKeybindings,
  ACCESSIBLE_VIEW_ACTION_IDS.configureAssignedKeybindings,
  ACCESSIBLE_VIEW_ACTION_IDS.acceptInlineCompletion,
] as const

const ACCESSIBLE_VIEW_COMMAND_MENU_CONTRACT: AccessibleViewCommandMenuContract = {
  menuId: "AccessibleView",
  commandPaletteActionIds: COMMAND_PALETTE_ACTION_IDS,
  accessibleViewMenuActionIds: ACCESSIBLE_VIEW_MENU_ACTION_IDS,
  contextKeys: ACCESSIBLE_VIEW_CONTEXT_KEYS,
}

const ACCESSIBLE_VIEW_WIDGET_CONTRIBUTION_CONTRACT: AccessibleViewWidgetContributionContract = {
  owner: "missing",
  state: "blocked",
  requiredOwner: "workbench.contrib.accessibility.AccessibleView",
  vscodeOwnerPath: "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts",
  missingSurfaces: [
    "AccessibleView class with CodeEditorWidget-backed rendering",
    "AccessibleViewService.show/showLastProvider/next/previous dispatch",
    "IContextViewService and ILayoutService placement owner",
    "Workbench toolbar and quick-pick affordances",
    "focus restore/onClose handoff to the previous editor or widget",
  ],
}

const ACCESSIBLE_VIEW_PROVIDER_LIFECYCLE_CONTRACT: AccessibleViewProviderLifecycleContract = {
  registryMetadata: "partial",
  providerFactoryInvocation: "partial",
  providerDisposalOnWidgetClose: "partial",
  lastProviderNavigation: "partial",
  requiredOwner: "AccessibleView workbench widget/editor contribution",
}

const ACCESSIBLE_VIEW_CONTEXT_KEY_UPDATE_CONTRACT: AccessibleViewContextKeyUpdateContract = {
  staticContextKeyNames: ACCESSIBLE_VIEW_CONTEXT_KEYS,
  menuContextProjection: "partial",
  showHideContextBinding: "partial",
  currentProviderContextBinding: "partial",
  requiredOwner: "AccessibleView show/hide widget lifecycle",
}

function isAccessibleViewSymbol(value: AccessibleViewSymbol | null | undefined): value is AccessibleViewSymbol {
  return Boolean(value && typeof value.label === "string" && typeof value.lineNumber === "number")
}

export function registerAccessibleViewCommandContributions(
  service: IAccessibleViewService = globalAccessibleViewService,
): Disposable {
  const disposables = [
    accessibleViewAction(ACCESSIBLE_VIEW_ACTION_IDS.openAccessibleView, "Open Accessible View", {
      f1: true,
      menu: { id: MenuId.CommandPalette, group: "navigation", order: 1 },
    }, (...args) => {
      const providerId = typeof args[0] === "string" ? args[0] : undefined
      service.show(providerId)
    }),
    accessibleViewAction(ACCESSIBLE_VIEW_ACTION_IDS.openAccessibilityHelp, "Open Accessibility Help", {
      f1: true,
      menu: { id: MenuId.CommandPalette, group: "navigation", order: 2 },
    }, () => {
      service.showAccessibilityHelp()
    }),
    accessibleViewAction(ACCESSIBLE_VIEW_ACTION_IDS.showNext, "Show Next in Accessible View", {
      f1: true,
      precondition: "accessibleViewIsShown && accessibleViewSupportsNavigation",
      menu: [
        { id: MenuId.CommandPalette, group: "navigation", order: 10 },
        { id: MenuId.AccessibleView, group: "navigation", order: 10, when: "accessibleViewIsShown && accessibleViewSupportsNavigation" },
      ],
    }, () => {
      service.next()
    }),
    accessibleViewAction(ACCESSIBLE_VIEW_ACTION_IDS.showPrevious, "Show Previous in Accessible View", {
      f1: true,
      precondition: "accessibleViewIsShown && accessibleViewSupportsNavigation",
      menu: [
        { id: MenuId.CommandPalette, group: "navigation", order: 20 },
        { id: MenuId.AccessibleView, group: "navigation", order: 20, when: "accessibleViewIsShown && accessibleViewSupportsNavigation" },
      ],
    }, () => {
      service.previous()
    }),
    accessibleViewAction(ACCESSIBLE_VIEW_ACTION_IDS.goToSymbol, "Go To Symbol in Accessible View", {
      f1: true,
      precondition: "(accessibleViewIsShown || accessibilityHelpIsShown) && accessibleViewGoToSymbolSupported",
      menu: [
        { id: MenuId.CommandPalette, group: "navigation", order: 30 },
        { id: MenuId.AccessibleView, group: "navigation", order: 30, when: "(accessibleViewIsShown || accessibilityHelpIsShown) && accessibleViewGoToSymbolSupported" },
      ],
    }, async () => {
      await service.goToSymbol()
    }),
    accessibleViewAction(ACCESSIBLE_VIEW_ACTION_IDS.disableVerbosityHint, "Disable Accessible View Hint", {
      f1: true,
      precondition: "(accessibleViewIsShown || accessibilityHelpIsShown) && accessibleViewVerbosityEnabled",
      menu: [
        { id: MenuId.CommandPalette, group: "navigation", order: 40 },
        { id: MenuId.AccessibleView, group: "navigation", order: 40, when: "(accessibleViewIsShown || accessibilityHelpIsShown) && accessibleViewVerbosityEnabled" },
      ],
    }),
    accessibleViewAction(ACCESSIBLE_VIEW_ACTION_IDS.nextCodeBlock, "Accessible View: Next Code Block", {
      precondition: "accessibleViewContainsCodeBlocks",
      menu: { id: MenuId.AccessibleView, group: "navigation", order: 50, when: "accessibleViewIsShown && accessibleViewContainsCodeBlocks" },
    }),
    accessibleViewAction(ACCESSIBLE_VIEW_ACTION_IDS.previousCodeBlock, "Accessible View: Previous Code Block", {
      precondition: "accessibleViewContainsCodeBlocks",
      menu: { id: MenuId.AccessibleView, group: "navigation", order: 60, when: "accessibleViewIsShown && accessibleViewContainsCodeBlocks" },
    }),
    accessibleViewAction(ACCESSIBLE_VIEW_ACTION_IDS.configureUnassignedKeybindings, "Accessibility Help Configure Unassigned Keybindings", {
      precondition: "accessibilityHelpIsShown && accessibleViewHasUnassignedKeybindings",
      menu: { id: MenuId.AccessibleView, group: "navigation", order: 70, when: "accessibleViewHasUnassignedKeybindings" },
    }),
    accessibleViewAction(ACCESSIBLE_VIEW_ACTION_IDS.configureAssignedKeybindings, "Accessibility Help Configure Assigned Keybindings", {
      precondition: "accessibilityHelpIsShown && accessibleViewHasAssignedKeybindings",
      menu: { id: MenuId.AccessibleView, group: "navigation", order: 80, when: "accessibleViewHasAssignedKeybindings" },
    }),
    accessibleViewAction(ACCESSIBLE_VIEW_ACTION_IDS.openHelpLink, "Accessibility Help Open Help Link", {
      precondition: "accessibilityHelpIsShown",
    }),
    accessibleViewAction(ACCESSIBLE_VIEW_ACTION_IDS.acceptInlineCompletion, "Accept Inline Completion", {
      f1: true,
      precondition: "accessibleViewIsShown && accessibleViewCurrentProviderId == inlineCompletions",
      menu: [
        { id: MenuId.CommandPalette, group: "navigation", order: 90 },
        { id: MenuId.AccessibleView, group: "navigation", order: 0, when: "accessibleViewIsShown && accessibleViewCurrentProviderId == inlineCompletions" },
      ],
    }),
  ]

  return {
    dispose: () => {
      for (const disposable of disposables) disposable.dispose()
    },
  }
}

function accessibleViewAction(
  id: string,
  title: string,
  options: Omit<Action2Descriptor, "id" | "title" | "category" | "source">,
  run?: (...args: unknown[]) => void | Promise<void>,
): Disposable {
  return registerAction2(class extends Action2 {
    constructor() {
      super({
        id,
        title,
        category: "Accessibility",
        source: "vscode",
        metadata: { description: title },
        ...options,
      })
    }

    override run(_accessor: unknown, ...args: unknown[]): void | Promise<void> {
      return run?.(...args)
    }
  })
}

function normalizeProviderImplementation(implementation: AccessibleViewProviderImplementation): AccessibleViewProviderImplementation {
  return {
    type: implementation.type,
    priority: Number.isFinite(implementation.priority) ? implementation.priority : 0,
    name: implementation.name.trim(),
    providerId: implementation.providerId.trim(),
    when: implementation.when?.trim() || undefined,
    createProvider: implementation.createProvider,
  }
}

export const globalAccessibleViewService = new AccessibleViewService()

registerSingleton(IAccessibleViewService, globalAccessibleViewService, InstantiationType.Delayed)
