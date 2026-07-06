import { beforeEach, describe, expect, it } from "vitest"
import { clearCommands, executeCommand, getCommand } from "../workbench/commandRegistry"
import { acceptQuickPick, clearQuickPicks, quickInputState } from "../workbench/quickInput"
import { ContextKeyService } from "../vscode-adapter/platform/contextkey/common/contextkey"
import { MenuId, MenuRegistry } from "../vscode-adapter/platform/actions/common/menuRegistry"
import { globalMenuService } from "../vscode-adapter/platform/actions/common/menuService"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import { AccessibilityKeyboardNavigationService, AccessibilitySupport } from "../workbench/accessibilityKeyboardNavigationService"
import { createBottomPanelState } from "../workbench/bottomPanelState"
import { createEditorGroupState } from "../workbench/editorGroups"
import { WorkbenchLayoutService } from "../vscode-adapter/workbench/services/layout/browser/layoutService"
import {
  ACCESSIBILITY_SIGNAL_UI_ACTION_IDS,
  ACCESSIBLE_VIEW_ACTION_IDS,
  ACCESSIBLE_VIEW_CONTEXT_KEYS,
  AccessibleViewService,
  IAccessibleViewService,
  createAccessibilitySignalUiActionOwnerProjection,
  createAccessibilitySignalUiOwnerReadinessProjection,
  createAccessibleViewEditorShellFocusRestoreProjection,
  createAccessibleViewEditorContextFocusOwnerMatrix,
  createAccessibleViewDomShellReadinessProjection,
  createAccessibleViewPlacementOwnerProjection,
  createAccessibilitySignalRoutingContract,
  createAccessibleViewOwnerFeasibilityProjection,
  createAccessibleViewRendererProjection,
  createAccessibleViewUiSurfaceAuditProjection,
  createAccessibleViewToolbarQuickPickFocusInvocationProjection,
  globalAccessibleViewService,
  registerAccessibleViewCommandContributions,
  renderAccessibleViewDomShell,
} from "./accessibleViewService"

describe("AccessibleViewService contract facade", () => {
  beforeEach(() => {
    MenuRegistry.clear()
    clearCommands()
    clearQuickPicks()
  })

  it("registers a VS Code-style service identifier without claiming full Accessible View widget support", () => {
    const collection = new ServiceCollection([IAccessibleViewService, globalAccessibleViewService])
    const resolved = collection.get(IAccessibleViewService)

    expect(resolved).toBe(globalAccessibleViewService)
    expect(getSingletonServiceDescriptors().some(([id, instance]) => (
      id === IAccessibleViewService && instance === globalAccessibleViewService
    ))).toBe(true)
    expect(resolved?.getContractProjection()).toMatchObject({
      source: "codek.accessibleViewService.contract",
      stateSources: {
        accessibleView: "partial",
        providerRegistry: "partial",
        commandMenuContext: "partial",
        accessibilitySignalUi: "partial",
        listTreeAria: "available",
      },
      commandMenuContract: {
        menuId: "AccessibleView",
        contextKeys: ACCESSIBLE_VIEW_CONTEXT_KEYS,
      },
      widgetContribution: {
        owner: "missing",
        state: "blocked",
        requiredOwner: "workbench.contrib.accessibility.AccessibleView",
        vscodeOwnerPath: "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts",
      },
      ownerFeasibility: {
        source: "codek.accessibleView.ownerFeasibility",
        owner: "missing",
        state: "blocked",
        vscodeOwner: {
          accessibleViewClassPath: "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts",
          codeEditorWidgetPath: "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts",
          contextViewPath: "src/vs/base/browser/ui/contextview/contextview.ts",
          layoutServicePath: "src/vs/workbench/services/layout/browser/layoutService.ts",
        },
        availableEvidence: {
          providerLifecycleProjection: false,
          commandMenuProjection: true,
          domShellProjection: true,
        },
        minimumSafeNextStep: "wire-workbench-placement-owner",
      },
      rendererProjection: {
        source: "codek.accessibleView.rendererProjection",
        owner: "headless-service-adapter",
        state: "partial",
        role: "dialog",
        hidden: true,
        editor: {
          owner: "missing",
          renderedBy: "dom-shell-projection",
          codeEditorWidgetBacked: false,
        },
        placement: {
          owner: "missing",
          state: "blocked",
          requiredOwner: "IContextViewService/ILayoutService",
        },
        editorContextFocusOwnerMatrix: {
          source: "codek.accessibleView.editorContextFocusOwnerMatrix",
          state: "blocked",
          noSecondAccessibilityState: true,
          codeEditorWidget: {
            requiredOwner: "CodeEditorWidget",
            codeEditorWidgetBacked: false,
            textModelBacked: false,
          },
          contextView: {
            requiredOwner: "IContextViewService/ILayoutService",
            contextViewDelegateOwner: "missing",
            layoutPlacementOwner: "missing",
          },
          focusRestoreInvocation: {
            requiredOwner: "IEditorService/CodeEditorWidget.focus",
            focusRestoreInvocationOwner: "missing",
          },
          reusableShellEvidence: {
            domShellProjection: "partial",
            completeAccessibleViewUiOwner: false,
          },
        },
        domShellReadiness: {
          source: "codek.accessibleView.domShellReadiness",
          owner: "headless-service-adapter",
          state: "partial",
          noSecondAccessibilityState: true,
          readiness: {
            rootSelector: true,
            readonlyContentSelector: true,
            toolbarSelector: true,
            actionRegistryProjection: true,
          },
          focus: {
            contentFocusable: true,
            focusRestoreTargetOwner: "missing",
            focusRestoreInvocationOwner: "missing",
            codeEditorWidgetBacked: false,
          },
          blockedOwners: expect.arrayContaining([
            "CodeEditorWidget-backed AccessibleView content owner",
            "IContextViewService/ILayoutService context view owner",
            "AccessibleView WorkbenchToolBar rendering owner",
            "AccessibleViewSymbolQuickPick owner backed by IQuickInputService.createQuickPick",
            "IEditorService/CodeEditorWidget.focus invocation owner",
          ]),
        },
      },
      domShellReadiness: {
        source: "codek.accessibleView.domShellReadiness",
        owner: "headless-service-adapter",
        state: "partial",
        noSecondAccessibilityState: true,
      },
      toolbarQuickPickFocusInvocation: {
        source: "codek.accessibleView.toolbarQuickPickFocusInvocationProjection",
        owner: "menu-service-projection",
        state: "blocked",
        noSecondActionState: true,
        toolbar: {
          requiredOwner: "WorkbenchToolBar + MenuId.AccessibleView",
          actionRegistryBacked: true,
          workbenchToolbarWidgetBacked: false,
        },
        quickPick: {
          requiredOwner: "IQuickInputService.createQuickPick",
          symbolQuickPickOwner: "missing",
          goToSymbolActionRegistered: true,
          genericQuickInputSurface: {
            state: "available",
            reusableInfrastructure: true,
            accessibleViewSymbolQuickPickOwner: false,
          },
        },
        focusInvocation: {
          requiredOwner: "IEditorService/CodeEditorWidget.focus",
          focusRestoreInvocationOwner: "missing",
          codeEditorWidgetBacked: false,
        },
      },
      editorContextFocusOwnerMatrix: {
        source: "codek.accessibleView.editorContextFocusOwnerMatrix",
        state: "blocked",
        noSecondAccessibilityState: true,
        reusableShellEvidence: {
          domShellProjection: "partial",
          completeAccessibleViewUiOwner: false,
        },
      },
      providerLifecycleContract: {
        registryMetadata: "partial",
        providerFactoryInvocation: "partial",
        providerDisposalOnWidgetClose: "partial",
        lastProviderNavigation: "partial",
      },
      contextKeyUpdateContract: {
        staticContextKeyNames: ACCESSIBLE_VIEW_CONTEXT_KEYS,
        menuContextProjection: "partial",
        showHideContextBinding: "partial",
        currentProviderContextBinding: "partial",
      },
      listTreeAriaContract: {
        widgetRoleFromListView: true,
        activeDescendantFromModelFocus: true,
        rowIdsFromRenderer: true,
        focusableTreeWidget: true,
      },
      signalContract: {
        liveRegionProjectionFromAccessibilityKeyboardNavigationService: true,
        statusProjectionFromAccessibilityKeyboardNavigationService: true,
        soundPlayback: "blocked",
        progressSignalScheduler: "blocked",
        configurationUi: "blocked",
      },
      signalRouting: {
        source: "codek.accessibilitySignal.routingContract",
        state: "partial",
        owner: "AccessibilityKeyboardNavigationService",
        stateSource: "AccessibilityKeyboardNavigationService",
        noSecondSignalState: true,
        availableEvidence: {
          statusProjection: true,
          liveRegionProjection: true,
          screenReaderStatusItem: true,
        },
      },
      accessibilitySignalUiProjection: {
        source: "codek.accessibilitySignal.uiProjection",
        owner: "AccessibilityKeyboardNavigationService",
        state: "partial",
        routing: {
          source: "codek.accessibilitySignal.routingContract",
          state: "partial",
          owner: "AccessibilityKeyboardNavigationService",
          noSecondSignalState: true,
        },
        capabilities: {
          screenReaderStatusItem: "available",
          liveRegionAnnouncements: "available",
          soundPlayback: "blocked",
          progressSignalScheduler: "blocked",
          signalConfigurationUi: "blocked",
        },
      },
    })
    expect(resolved?.getContractProjection().rendererProjection.ownerFeasibility).toEqual(
      resolved?.getContractProjection().ownerFeasibility,
    )
    const contract = resolved?.getContractProjection()
    expect(contract?.domShellReadiness).toEqual(contract?.rendererProjection.domShellReadiness)
    expect(contract?.editorContextFocusOwnerMatrix).toEqual(contract?.rendererProjection.editorContextFocusOwnerMatrix)
    expect(contract?.rendererProjection.editorContextFocusOwnerMatrix.reusableShellEvidence.completeAccessibleViewUiOwner).toBe(false)
  })

  it("keeps VS Code command ids, source paths and blocked widget gaps visible as evidence", () => {
    const projection = globalAccessibleViewService.getContractProjection()

    expect(projection.actionIds).toEqual(ACCESSIBLE_VIEW_ACTION_IDS)
    expect(projection.actionIds.openAccessibleView).toBe("editor.action.accessibleView")
    expect(projection.actionIds.openAccessibilityHelp).toBe("editor.action.accessibilityHelp")
    expect(projection.vscodeContractPaths).toContain("src/vs/platform/accessibility/browser/accessibleViewRegistry.ts")
    expect(projection.vscodeContractPaths).toContain("src/vs/workbench/contrib/accessibility/browser/accessibleView.ts")
    expect(projection.vscodeContractPaths).toContain("src/vs/workbench/contrib/accessibility/browser/accessibleViewActions.ts")
    expect(projection.vscodeContractPaths).toContain("src/vs/platform/quickinput/browser/quickInputService.ts")
    expect(projection.vscodeContractPaths).toContain("src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts")
    expect(projection.vscodeContractPaths).toContain("src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts")
    expect(projection.vscodeContractPaths).toContain("src/vs/platform/accessibilitySignal/browser/progressAccessibilitySignalScheduler.ts")
    expect(projection.vscodeContractPaths).toContain("src/vs/base/browser/ui/list/listWidget.ts")
    expect(projection.vscodeContractPaths).toContain("src/vs/base/browser/ui/list/listView.ts")
    expect(projection.vscodeContractPaths).toContain("src/vs/base/browser/ui/tree/abstractTree.ts")
    expect(projection.rendererProjection.vscodeParallels).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts show() creates an IContextViewDelegate and renders provider content",
      "src/vs/base/browser/ui/contextview/contextview.ts positions a rendered context view through an owner container",
      "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts owns the read-only editor widget used by AccessibleView",
    ]))
    expect(projection.accessibilitySignalUiProjection.vscodeParallels).toContain("src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts playSignal announcement/audio split")
    expect(projection.accessibilitySignalUiProjection.vscodeParallels).toContain("src/vs/platform/accessibilitySignal/browser/progressAccessibilitySignalScheduler.ts playSignalLoop(AccessibilitySignal.progress)")
    expect(projection.toolbarQuickPickFocusInvocation.toolbar.vscodeParallels).toEqual(expect.arrayContaining([
      "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts constructs WorkbenchToolBar for Accessible View",
      "src/vs/workbench/contrib/accessibility/browser/accessibleViewActions.ts contributes actions to MenuId.AccessibleView",
    ]))
    expect(projection.toolbarQuickPickFocusInvocation.quickPick.vscodeParallels).toContain("src/vs/platform/quickinput/browser/quickInputService.ts createQuickPick() owns the picker lifecycle")
    expect(projection.toolbarQuickPickFocusInvocation.focusInvocation.vscodeParallels).toContain("src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts focus() owns text editor focus invocation")
    expect(projection.codekContractPaths).toContain("frontend/vite-project/src/vscode-adapter/platform/actions/common/menuRegistry.ts")
    expect(projection.codekContractPaths).toContain("frontend/vite-project/src/vscode-adapter/platform/contextkey/common/contextkey.ts")
    expect(projection.codekContractPaths).toContain("frontend/vite-project/src/explorer/tree/CodekListView.ts")
    expect(projection.blockedGaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "accessibleView.ui",
        state: "blocked",
        requiredSurfaces: expect.arrayContaining([
          "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts AccessibleView class",
          "CodeEditorWidget-backed Accessible View content renderer",
          "IContextViewService/ILayoutService owner for show/hide lifecycle",
          "real editor/workbench focus handoff after close",
        ]),
      }),
      expect.objectContaining({
        id: "accessibleView.widgetOwner",
        state: "blocked",
        requiredSurfaces: expect.arrayContaining([
          "CodeEditorWidget-backed Accessible View content renderer",
          "Workbench toolbar and quick-pick affordances",
        ]),
      }),
      expect.objectContaining({
        id: "accessibilitySignal.ui",
        state: "blocked",
        requiredSurfaces: expect.arrayContaining([
          "IAccessibilitySignalService audio/announcement enablement",
          "AccessibilityProgressSignalScheduler",
          "settings UI and command affordances for signals",
        ]),
      }),
    ]))
    expect(globalAccessibleViewService.getOpenAriaHint("accessibility.verbosity.editor")).toBeNull()
  })

  it("audits existing Codek UI surfaces without treating generic quick input as the Accessible View owner", () => {
    const projection = globalAccessibleViewService.getContractProjection()
    const directAudit = createAccessibleViewUiSurfaceAuditProjection()

    expect(projection.uiSurfaceAudit).toEqual(directAudit)
    expect(projection.uiSurfaceAudit).toMatchObject({
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
        blockedReason: expect.stringContaining("do not own AccessibleView provider rendering"),
        vscodeParallels: expect.arrayContaining([
          "src/vs/base/browser/ui/list/listWidget.ts updates aria-activedescendant from focused model rows",
          "src/vs/base/browser/ui/list/listView.ts owns row roles and stable element DOM ids",
          "src/vs/base/browser/ui/tree/abstractTree.ts owns treeitem role and aria-label projection",
        ]),
      },
      minimumSafeNextStep: "wire-real-accessible-view-workbench-owner",
      blockedReason: expect.stringContaining("generic QuickInput/Dialog"),
      vscodeParallels: expect.arrayContaining([
        "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts owns CodeEditorWidget, WorkbenchToolBar, context view placement, symbol quick pick, and focus restore together",
      ]),
    })
    expect(projection.uiSurfaceAudit.codekSurfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "frontend/vite-project/src/accessibility/accessibleViewService.ts",
        role: "provider-lifecycle-and-dom-shell-projection",
        ownerState: "partial",
        reusableForAccessibleViewOwner: false,
      }),
      expect.objectContaining({
        path: "frontend/vite-project/src/components/QuickPickDialog.vue",
        role: "generic-quick-input-dialog",
        ownerState: "available",
        reusableForAccessibleViewOwner: false,
      }),
      expect.objectContaining({
        path: "frontend/vite-project/src/workbench/quickInput.ts",
        role: "generic-quick-input-service",
        ownerState: "available",
        reusableForAccessibleViewOwner: false,
      }),
      expect.objectContaining({
        path: "frontend/vite-project/src/components/FileTree.vue",
        role: "explorer-container-delegating-to-tree-host",
        ownerState: "available",
        reusableForAccessibleViewOwner: false,
        reason: expect.stringContaining("not touched or treated as the AccessibleView workbench owner"),
      }),
      expect.objectContaining({
        path: "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
        role: "explorer-tree-host-keyboard-and-active-descendant-owner",
        ownerState: "available",
        reusableForAccessibleViewOwner: false,
      }),
      expect.objectContaining({
        path: "frontend/vite-project/src/explorer/tree/CodekListView.ts",
        role: "virtualized-list-tree-aria-owner",
        ownerState: "available",
        reusableForAccessibleViewOwner: false,
        reason: expect.stringContaining("does not provide a CodeEditorWidget-backed AccessibleView"),
      }),
    ]))
    expect(projection.uiSurfaceAudit.listTreeAriaEvidence.capabilities).toEqual(projection.listTreeAriaContract)
    expect(projection.uiSurfaceAudit.missingOwners).toEqual(expect.arrayContaining([
      "AccessibleView class or component that owns CodeEditorWidget-backed content rendering",
      "AccessibleView-specific WorkbenchToolBar bound to MenuId.AccessibleView",
      "AccessibleViewSymbolQuickPick owner that invokes IQuickInputService.createQuickPick from the AccessibleView widget lifecycle",
      "IContextViewService/ILayoutService owner that places and hides the AccessibleView context view",
      "IEditorService/CodeEditorWidget.focus invocation owner for focus restore",
    ]))
    expect(projection.trueOwnerFollowUp).toMatchObject({
      source: "codek.accessibleView.trueOwnerFollowUp",
      state: "blocked",
      noSecondAccessibilityState: true,
      attemptedMinimalOwnerDecision: {
        decision: "blocked-contract",
        avoidedSurfaces: expect.arrayContaining([
          "frontend/vite-project/src/components/FileTree.vue",
          "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
          "frontend/vite-project/src/App.vue",
          "generic editor shell / Monaco CodeEditorWidget focus bridge",
        ]),
        reason: expect.stringContaining("requires the generic editor shell/App.vue owner"),
      },
      commandMenuSignalFocusEvidence: {
        commandMenuProjection: {
          menuId: "AccessibleView",
          menuActionIds: expect.arrayContaining([
            ACCESSIBLE_VIEW_ACTION_IDS.showNext,
            ACCESSIBLE_VIEW_ACTION_IDS.goToSymbol,
            ACCESSIBLE_VIEW_ACTION_IDS.acceptInlineCompletion,
          ]),
          actionRegistryBacked: true,
          workbenchToolbarWidgetBacked: false,
        },
        signalProjection: {
          stateSource: "AccessibilityKeyboardNavigationService",
          liveRegionProjection: true,
          soundPlayback: "blocked",
          progressSignalScheduler: "blocked",
        },
        focusProjection: {
          focusRestoreTargetOwner: "missing",
          focusRestoreInvocationOwner: "missing",
          codeEditorWidgetBacked: false,
        },
      },
      requiredTrueOwners: expect.arrayContaining([
        expect.objectContaining({
          owner: "CodeEditorWidget",
          state: "blocked",
          codekEvidence: "dom-shell-readonly-content-only",
        }),
        expect.objectContaining({
          owner: "IContextViewService/ILayoutService",
          state: "blocked",
          codekEvidence: "workbench-layout-placement-projection-only",
        }),
        expect.objectContaining({
          owner: "WorkbenchToolBar + MenuId.AccessibleView",
          state: "blocked",
          codekEvidence: "menu-action-registry-only",
        }),
        expect.objectContaining({
          owner: "IQuickInputService.createQuickPick",
          state: "blocked",
          codekEvidence: "generic-quick-input-surface-only",
        }),
        expect.objectContaining({
          owner: "IEditorService/CodeEditorWidget.focus",
          state: "blocked",
          codekEvidence: "focus-target-projection-only",
        }),
      ]),
      blockedIntegrationContract: {
        owner: "AccessibleView workbench/editor shell owner",
        state: "blocked",
        requiredInterfaces: expect.arrayContaining([
          "IAccessibleViewService.show(provider, position) must create or reuse one AccessibleView workbench widget owner",
          "IContextViewService.showContextView/hideContextView must own placement and close lifecycle",
          "CodeEditorWidget plus accessible-view text model must own readonly provider rendering",
          "WorkbenchToolBar must render MenuId.AccessibleView actions from the AccessibleView widget lifecycle",
          "IQuickInputService.createQuickPick must be invoked by an AccessibleViewSymbolQuickPick owner",
          "IEditorService/CodeEditorWidget.focus must restore focus after close and editor-affecting actions",
        ]),
        requiredCodekEntryPoints: expect.arrayContaining([
          expect.objectContaining({
            path: "frontend/vite-project/src/accessibility/accessibleViewService.ts",
            state: "candidate",
            reason: expect.stringContaining("cannot own DOM placement or editor focus invocation by itself"),
          }),
          expect.objectContaining({
            path: "frontend/vite-project/src/vscode-adapter/workbench/services/layout/browser/layoutService.ts",
            state: "candidate",
            reason: expect.stringContaining("needs an IContextViewService-style owner"),
          }),
          expect.objectContaining({
            path: "frontend/vite-project/src/App.vue",
            state: "blocked",
            reason: expect.stringContaining("active shell work"),
          }),
          expect.objectContaining({
            path: "generic editor shell / Monaco editor owner",
            state: "blocked",
            reason: expect.stringContaining("rather than a dataset or DOM-shell projection"),
          }),
        ]),
        nonReusableEvidenceSurfaces: expect.arrayContaining([
          expect.objectContaining({
            path: "frontend/vite-project/src/components/FileTree.vue",
            reason: expect.stringContaining("does not own provider rendering"),
          }),
          expect.objectContaining({
            path: "frontend/vite-project/src/explorer/tree/ExplorerTreeHost.ts",
            reason: expect.stringContaining("false ownership"),
          }),
          expect.objectContaining({
            path: "frontend/vite-project/src/explorer/tree/CodekListView.ts",
            reason: expect.stringContaining("not a CodeEditorWidget"),
          }),
          expect.objectContaining({
            path: "frontend/vite-project/src/components/QuickPickDialog.vue",
            reason: expect.stringContaining("not an AccessibleViewSymbolQuickPick lifecycle owner"),
          }),
        ]),
        acceptanceEvidence: expect.arrayContaining([
          "Focused tests prove command/menu/signal/focus projection remains single-source and blocked until the true owner exists",
          "A future implementation must show a real context-view surface without adding a second AccessibleView state source",
          "A future implementation must prove WorkbenchToolBar actions, AccessibleViewSymbolQuickPick, and CodeEditorWidget.focus are invoked by the same owner lifecycle",
        ]),
        blockedReason: expect.stringContaining("generic editor shell focus boundaries"),
      },
      minimumSafeNextStep: "wire-real-accessible-view-workbench-owner",
      blockedReason: expect.stringContaining("true AccessibleView owner must own these surfaces together"),
    })
  })

  it("projects accessibility signal routing without claiming VS Code signal service ownership", () => {
    const keyboardNavigation = new AccessibilityKeyboardNavigationService()
    keyboardNavigation.setAccessibilitySupport(AccessibilitySupport.Enabled)
    keyboardNavigation.status("Indexing workspace")
    keyboardNavigation.alert("Problem marker")

    const service = new AccessibleViewService()
    const projection = service.getAccessibilitySignalUiProjection(keyboardNavigation)
    const contract = service.getContractProjection()
    const directRouting = createAccessibilitySignalRoutingContract()

    expect(projection).toMatchObject({
      source: "codek.accessibilitySignal.uiProjection",
      owner: "AccessibilityKeyboardNavigationService",
      state: "partial",
      status: {
        id: "status.editor.screenReaderMode",
        visible: true,
        command: "showEditorScreenReaderNotification",
      },
      capabilities: {
        screenReaderStatusItem: "available",
        liveRegionAnnouncements: "available",
        signalActionEvidence: "available",
        soundPlayback: "blocked",
        progressSignalScheduler: "blocked",
        signalConfigurationUi: "blocked",
      },
      routing: {
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
        missingOwners: expect.arrayContaining([
          "IAccessibilitySignalService playSignal/playSignalLoop owner with sound and announcement enablement",
          "AccessibilitySignal audio asset registry and telemetry owner",
          "AccessibilityProgressSignalScheduler for long-running progress cues",
          "accessibility.signals configuration schema and settings UI owner",
        ]),
        blockedReason: expect.stringContaining("no IAccessibilitySignalService owner"),
      },
    })
    expect(projection.aria.statusRegions[0].text).toBe("Indexing workspace")
    expect(projection.aria.alertRegions[0].text).toBe("Problem marker")
    expect(projection.evidence).toMatchObject({
      source: "codek.accessibilitySignal.uiEvidence",
      owner: "AccessibilityKeyboardNavigationService",
      state: "partial",
      noSecondSignalState: true,
      serviceBackedEvidence: {
        screenReaderStatusItem: {
          visible: true,
          command: "showEditorScreenReaderNotification",
        },
        alertLiveRegionCount: 2,
        statusLiveRegionCount: 2,
        invokedActionIds: [],
      },
      uiEvidence: {
        actionRegistration: true,
        statusProjection: true,
        alertLiveRegionProjection: true,
        statusLiveRegionProjection: true,
        actionInvocationEvidence: false,
      },
      blockedOwners: expect.arrayContaining([
        expect.objectContaining({
          owner: "IAccessibilitySignalService",
          state: "blocked",
          codekEvidence: "status-alert-live-region-only",
        }),
        expect.objectContaining({
          owner: "AccessibilitySignal audio assets",
          state: "blocked",
          codekEvidence: "no-audio-asset-owner",
        }),
        expect.objectContaining({
          owner: "AccessibilityProgressSignalScheduler",
          state: "blocked",
          codekEvidence: "no-progress-signal-loop-owner",
        }),
        expect.objectContaining({
          owner: "accessibility.signals configuration UI",
          state: "blocked",
          codekEvidence: "no-signal-settings-ui-owner",
        }),
      ]),
      blockedReason: expect.stringContaining("screen-reader status/live-region signal bridge only"),
    })
    expect(projection.vscodeParallels).toEqual(expect.arrayContaining([
      "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts playSignal announcement/audio split",
      "src/vs/platform/accessibilitySignal/browser/progressAccessibilitySignalScheduler.ts playSignalLoop(AccessibilitySignal.progress)",
      "src/vs/workbench/contrib/accessibility/browser/accessibilityConfiguration.ts accessibility.signals settings schema",
    ]))
    expect(contract.signalRouting).toEqual(directRouting)
    expect(contract.accessibilitySignalUiProjection.routing).toEqual(directRouting)
    expect(contract.accessibilitySignalUiProjection.evidence.blockedOwners).toEqual(expect.arrayContaining([
      expect.objectContaining({ owner: "IAccessibilitySignalService" }),
      expect.objectContaining({ owner: "AccessibilityProgressSignalScheduler" }),
    ]))
    expect(contract.blockedGaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "accessibilitySignal.ui",
        reason: expect.stringContaining("progress signal scheduling"),
        requiredSurfaces: expect.arrayContaining([
          "IAccessibilitySignalService audio/announcement enablement",
          "AccessibilityProgressSignalScheduler",
          "settings UI and command affordances for signals",
        ]),
      }),
    ]))
  })

  it("keeps real widget/editor contribution gaps separate from provider registry evidence", () => {
    const service = new AccessibleViewService()
    service.registerProvider({
      type: "view",
      priority: 1,
      name: "Inline Completions",
      providerId: "inlineCompletions",
    })

    const projection = service.getContractProjection()

    expect(projection.providerRegistry.implementations).toEqual([
      expect.objectContaining({ providerId: "inlineCompletions" }),
    ])
    expect(projection.widgetContribution).toMatchObject({
      owner: "missing",
      state: "blocked",
      requiredOwner: "workbench.contrib.accessibility.AccessibleView",
      missingSurfaces: expect.arrayContaining([
        "AccessibleViewService.show/showLastProvider/next/previous dispatch",
        "focus restore/onClose handoff to the previous editor or widget",
      ]),
    })
    expect(projection.providerLifecycleContract).toEqual({
      registryMetadata: "partial",
      providerFactoryInvocation: "partial",
      providerDisposalOnWidgetClose: "partial",
      lastProviderNavigation: "partial",
      requiredOwner: "AccessibleView workbench widget/editor contribution",
    })
    expect(projection.contextKeyUpdateContract).toEqual({
      staticContextKeyNames: ACCESSIBLE_VIEW_CONTEXT_KEYS,
      menuContextProjection: "partial",
      showHideContextBinding: "partial",
      currentProviderContextBinding: "partial",
      requiredOwner: "AccessibleView show/hide widget lifecycle",
    })
  })

  it("audits CodeEditorWidget and placement owner feasibility without inventing a widget owner", () => {
    const service = new AccessibleViewService()
    service.registerProvider({
      type: "view",
      priority: 10,
      name: "Terminal",
      providerId: "terminal",
      createProvider: () => ({
        providerId: "terminal",
        type: "view",
        provideContent: () => "Terminal output",
      }),
    })

    service.show("terminal")
    service.hide({ focusTargetId: "editor:active" })

    const feasibility = service.getOwnerFeasibilityProjection()

    expect(feasibility).toMatchObject({
      source: "codek.accessibleView.ownerFeasibility",
      owner: "missing",
      state: "blocked",
      vscodeOwner: {
        accessibleViewClassPath: "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts",
        codeEditorWidgetPath: "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts",
        contextViewPath: "src/vs/base/browser/ui/contextview/contextview.ts",
        layoutServicePath: "src/vs/workbench/services/layout/browser/layoutService.ts",
      },
      availableEvidence: {
        providerLifecycleProjection: true,
        commandMenuProjection: true,
        domShellProjection: true,
        projectedFocusTargetId: "editor:active",
      },
      missingOwners: expect.arrayContaining([
        "CodeEditorWidget construction and text model ownership",
        "IContextViewService.showContextView delegate and owner container",
        "ILayoutService active container dimensions and quick-pick top placement",
        "real editor focus restore target after context view hide",
      ]),
      minimumSafeNextStep: "wire-workbench-placement-owner",
      blockedReason: expect.stringContaining("workbench placement/editor shell owner"),
    })
    expect(service.getContractProjection().ownerFeasibility).toEqual(feasibility)
    expect(service.getRendererProjection().ownerFeasibility).toEqual(feasibility)
    expect(service.getRendererProjection().editorContextFocusOwnerMatrix).toMatchObject({
      source: "codek.accessibleView.editorContextFocusOwnerMatrix",
      state: "blocked",
      noSecondAccessibilityState: true,
      codeEditorWidget: {
        codeEditorWidgetBacked: false,
        textModelBacked: false,
        availableEvidence: {
          providerLifecycleProjection: true,
          domShellReadonlyContentProjection: true,
        },
        blockedReason: expect.stringContaining("does not construct the VS Code AccessibleView CodeEditorWidget"),
      },
      contextView: {
        contextViewDelegateOwner: "missing",
        layoutPlacementOwner: "missing",
        blockedReason: expect.stringContaining("local DOM shell evidence is not a context view owner"),
      },
      focusRestoreInvocation: {
        focusRestoreTargetOwner: "missing",
        focusRestoreInvocationOwner: "missing",
        projectedFocusTargetId: "editor:active",
        availableEvidence: {
          editorShellFocusTargetProjection: false,
          focusTargetMatchesActiveEditor: false,
        },
      },
      reusableShellEvidence: {
        domShellProjection: "partial",
        workbenchLayoutProjection: "blocked",
        editorShellFocusRestoreProjection: "blocked",
        completeAccessibleViewUiOwner: false,
      },
      missingOwners: expect.arrayContaining([
        "AccessibleView CodeEditorWidget construction and text model owner",
        "IContextViewService.showContextView delegate and layout placement owner",
        "editor focus restore target owner",
        "IEditorService/CodeEditorWidget.focus invocation owner",
      ]),
      blockedReason: expect.stringContaining("must stay evidence/partial"),
    })
  })

  it("tracks provider registry implementations without claiming a rendered widget", () => {
    const service = new AccessibleViewService()

    const first = service.registerProvider({
      type: "help",
      priority: 10,
      name: "Editor Help",
      providerId: "editor",
      when: "editorTextFocus",
    })
    const second = service.registerProvider({
      type: "view",
      priority: 100,
      name: "Terminal",
      providerId: "terminal",
    })

    expect(service.getProviderRegistrySnapshot()).toEqual({
      source: "codek.accessibleView.providerRegistry",
      implementations: [
        expect.objectContaining({ providerId: "terminal", priority: 100 }),
        expect.objectContaining({ providerId: "editor", priority: 10, when: "editorTextFocus" }),
      ],
    })
    expect(service.getContractProjection().stateSources.accessibleView).toBe("partial")

    second.dispose()
    expect(service.getProviderRegistrySnapshot().implementations.map((provider) => provider.providerId)).toEqual(["editor"])
    first.dispose()
    expect(service.getProviderRegistrySnapshot().implementations).toEqual([])
  })

  it("invokes provider factories and updates show/hide context projection without a second focus source", () => {
    const service = new AccessibleViewService()
    const contextKeyService = new ContextKeyService()
    const events: string[] = []
    service.bindContextKeyService(contextKeyService)
    service.registerProvider({
      type: "view",
      priority: 100,
      name: "Inline Completions",
      providerId: "inlineCompletions",
      createProvider: () => ({
        providerId: "inlineCompletions",
        type: "view",
        provideContent: () => "Inline completion content",
        provideNextContent: () => "Next inline completion content",
        onOpen: () => events.push("open"),
        onClose: () => events.push("close"),
        dispose: () => events.push("dispose"),
      }),
    })

    expect(service.show("inlineCompletions")).toMatchObject({
      shown: true,
      providerId: "inlineCompletions",
      content: "Inline completion content",
    })
    expect(events).toEqual(["open"])
    expect(contextKeyService.getContext()).toMatchObject({
      accessibleViewIsShown: true,
      accessibilityHelpIsShown: false,
      accessibleViewCurrentProviderId: "inlineCompletions",
      accessibleViewSupportsNavigation: true,
    })
    expect(service.getWidgetLifecycleProjection()).toMatchObject({
      source: "codek.accessibleView.lifecycleProjection",
      owner: "headless-service-adapter",
      state: "partial",
      isShown: true,
      currentProviderId: "inlineCompletions",
      context: {
        accessibleViewIsShown: true,
        currentProviderId: "inlineCompletions",
        supportsNavigation: true,
        goToSymbolSupported: false,
      },
      evidence: {
        providerFactoryInvoked: true,
        providerOnOpenCalled: true,
        providerOnCloseCalled: false,
        providerDisposeCalled: false,
      },
    })
    expect(service.getRendererProjection()).toMatchObject({
      source: "codek.accessibleView.rendererProjection",
      owner: "headless-service-adapter",
      state: "partial",
      hidden: false,
      title: "Accessible View",
      providerId: "inlineCompletions",
      providerType: "view",
      content: "Inline completion content",
      lineCount: 1,
      context: {
        accessibleViewIsShown: true,
        currentProviderId: "inlineCompletions",
        supportsNavigation: true,
        goToSymbolSupported: false,
      },
      toolbar: {
        menuId: "AccessibleView",
        actionIds: expect.arrayContaining([
          ACCESSIBLE_VIEW_ACTION_IDS.showNext,
          ACCESSIBLE_VIEW_ACTION_IDS.showPrevious,
          ACCESSIBLE_VIEW_ACTION_IDS.acceptInlineCompletion,
        ]),
      },
      toolbarQuickPickFocusInvocation: {
        owner: "menu-service-projection",
        state: "blocked",
        quickPick: {
          goToSymbolActionRegistered: true,
          symbolQuickPickOwner: "missing",
        },
        focusInvocation: {
          focusRestoreInvocationOwner: "missing",
          codeEditorWidgetBacked: false,
        },
      },
      ownerFeasibility: {
        source: "codek.accessibleView.ownerFeasibility",
        state: "blocked",
        availableEvidence: {
          providerLifecycleProjection: true,
          commandMenuProjection: true,
          domShellProjection: true,
        },
      },
      editor: {
        owner: "missing",
        renderedBy: "dom-shell-projection",
        codeEditorWidgetBacked: false,
      },
    })

    expect(service.hide({ focusTargetId: "editor:active" })).toMatchObject({
      hidden: true,
      providerId: "inlineCompletions",
      focusTargetId: "editor:active",
    })
    expect(events).toEqual(["open", "close", "dispose"])
    expect(contextKeyService.getContext()).toMatchObject({
      accessibleViewIsShown: false,
      accessibilityHelpIsShown: false,
    })
    expect(contextKeyService.getContext().accessibleViewCurrentProviderId).toBeUndefined()
    expect(service.getWidgetLifecycleProjection()).toMatchObject({
      isShown: false,
      currentProviderId: undefined,
      lastProviderId: "inlineCompletions",
      focusHandoff: {
        requested: true,
        targetId: "editor:active",
        state: "projected",
      },
      evidence: {
        providerOnCloseCalled: true,
        providerDisposeCalled: true,
      },
    })
    expect(service.getRendererProjection()).toMatchObject({
      hidden: true,
      providerId: undefined,
      content: "",
      lineCount: 0,
      ownerFeasibility: {
        availableEvidence: {
          providerLifecycleProjection: true,
          projectedFocusTargetId: "editor:active",
        },
      },
      focusHandoff: {
        requested: true,
        targetId: "editor:active",
        state: "projected",
      },
    })
  })

  it("renders a DOM shell smoke projection without taking CodeEditorWidget ownership", () => {
    const lifecycle = {
      source: "codek.accessibleView.lifecycleProjection",
      owner: "headless-service-adapter",
      state: "partial",
      isShown: true,
      currentProviderId: "terminal",
      lastProviderId: "terminal",
      currentContent: "Terminal output\nNext line",
      context: {
        accessibilityHelpIsShown: false,
        accessibleViewIsShown: true,
        currentProviderId: "terminal",
        supportsNavigation: false,
        goToSymbolSupported: false,
      },
      focusHandoff: { requested: true, targetId: "editor:active", state: "projected" },
      evidence: {
        providerFactoryInvoked: true,
        providerOnOpenCalled: true,
        providerOnCloseCalled: false,
        providerDisposeCalled: false,
        lastProviderReplayAvailable: true,
        lastProviderReplayed: false,
      },
      remainingBlockedSurfaces: [
        "AccessibleView class with CodeEditorWidget-backed rendering",
        "IContextViewService and ILayoutService placement owner",
      ],
    } as const

    const projection = createAccessibleViewRendererProjection(lifecycle)
    const element = renderAccessibleViewDomShell(projection, document)

    expect(projection).toMatchObject({
      source: "codek.accessibleView.rendererProjection",
      hidden: false,
      title: "Accessible View",
      providerId: "terminal",
      providerType: "view",
      content: "Terminal output\nNext line",
      lineCount: 2,
      readonlyContent: true,
      placement: {
        owner: "missing",
        state: "blocked",
      },
      ownerFeasibility: {
        state: "blocked",
        missingOwners: expect.arrayContaining([
          "CodeEditorWidget construction and text model ownership",
          "IContextViewService.showContextView delegate and owner container",
        ]),
      },
      editor: {
        owner: "missing",
        renderedBy: "dom-shell-projection",
        codeEditorWidgetBacked: false,
      },
      editorContextFocusOwnerMatrix: {
        state: "blocked",
        codeEditorWidget: {
          codeEditorWidgetBacked: false,
          textModelBacked: false,
        },
        reusableShellEvidence: {
          completeAccessibleViewUiOwner: false,
        },
      },
    })
    expect(element.dataset.accessibleViewDomShell).toBe("true")
    expect(element.dataset.providerId).toBe("terminal")
    expect(element.dataset.ownerFeasibility).toBe("blocked")
    expect(element.dataset.codeEditorWidgetBacked).toBe("false")
    expect(element.dataset.placementOwner).toBe("missing")
    expect(element.getAttribute("role")).toBe("dialog")
    expect(element.getAttribute("aria-modal")).toBe("true")
    expect(element.hasAttribute("hidden")).toBe(false)
    expect(element.querySelector<HTMLElement>("[data-accessible-view-title]")?.textContent).toBe("Accessible View")
    expect(element.querySelector<HTMLTextAreaElement>("[data-accessible-view-content]")?.value).toBe("Terminal output\nNext line")
    expect(element.querySelector<HTMLTextAreaElement>("[data-accessible-view-content]")?.readOnly).toBe(true)
    expect(element.querySelector<HTMLElement>("[data-accessible-view-toolbar]")?.dataset.menuId).toBe("AccessibleView")
    expect(element.querySelector<HTMLElement>("[data-accessible-view-toolbar]")?.dataset.actionIds).toContain(ACCESSIBLE_VIEW_ACTION_IDS.showNext)
    expect(element.dataset.toolbarQuickPickFocusInvocationOwner).toBe("menu-service-projection")
    expect(element.dataset.toolbarQuickPickFocusInvocationState).toBe("blocked")
    expect(element.dataset.quickPickOwner).toBe("missing")
    expect(element.dataset.genericQuickInputReusable).toBe("true")
    expect(element.dataset.genericQuickInputAccessibleViewOwner).toBe("false")
    expect(element.dataset.focusInvocationOwner).toBe("missing")
  })

  it("keeps CodeEditorWidget, context view and focus invocation owner matrix blocked with only partial shell evidence", () => {
    const layoutService = new WorkbenchLayoutService()
    const shell = layoutService.createShellProjection({
      activeSidebarView: "files",
      sidebarVisible: true,
      sidebarWidth: 300,
      bottomPanel: createBottomPanelState("terminal"),
      bottomPanelHeight: 220,
      editorGroups: createEditorGroupState({
        editors: [{ path: "src/ownerMatrix.ts", permanent: true }],
        activeEditor: "src/ownerMatrix.ts",
      }),
    })
    const lifecycle = {
      source: "codek.accessibleView.lifecycleProjection",
      owner: "headless-service-adapter",
      state: "partial",
      isShown: false,
      lastProviderId: "terminal",
      context: {
        accessibilityHelpIsShown: false,
        accessibleViewIsShown: false,
        supportsNavigation: false,
        goToSymbolSupported: false,
      },
      focusHandoff: { requested: true, targetId: "editor:active", state: "projected" },
      evidence: {
        providerFactoryInvoked: true,
        providerOnOpenCalled: true,
        providerOnCloseCalled: true,
        providerDisposeCalled: true,
        lastProviderReplayAvailable: true,
        lastProviderReplayed: false,
      },
      remainingBlockedSurfaces: [
        "AccessibleView class with CodeEditorWidget-backed rendering",
        "IContextViewService and ILayoutService placement owner",
      ],
    } as const

    const placement = createAccessibleViewPlacementOwnerProjection(shell)
    const editorShellFocusRestore = createAccessibleViewEditorShellFocusRestoreProjection(lifecycle, placement)
    const matrix = createAccessibleViewEditorContextFocusOwnerMatrix(lifecycle, placement, editorShellFocusRestore)
    const renderer = createAccessibleViewRendererProjection(lifecycle, placement)

    expect(matrix).toMatchObject({
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
          providerLifecycleProjection: true,
          domShellReadonlyContentProjection: true,
        },
        blockedReason: expect.stringContaining("readonly DOM-shell content evidence only"),
      },
      contextView: {
        requiredOwner: "IContextViewService/ILayoutService",
        contextViewPath: "src/vs/platform/contextview/browser/contextView.ts",
        baseContextViewPath: "src/vs/base/browser/ui/contextview/contextview.ts",
        layoutServicePath: "src/vs/workbench/services/layout/browser/layoutService.ts",
        contextViewDelegateOwner: "projected",
        layoutPlacementOwner: "projected",
        availableEvidence: {
          workbenchPlacementProjection: true,
          projectedActiveContainer: {
            editor: "src/ownerMatrix.ts",
            panelId: "terminal",
            viewContainerId: null,
          },
        },
        blockedReason: expect.stringContaining("no IContextViewService.showContextView delegate owns Accessible View show/hide"),
      },
      focusRestoreInvocation: {
        requiredOwner: "IEditorService/CodeEditorWidget.focus",
        focusRestoreTargetOwner: "projected",
        focusRestoreInvocationOwner: "missing",
        activeEditor: "src/ownerMatrix.ts",
        projectedFocusTargetId: "editor:active",
        availableEvidence: {
          editorShellFocusTargetProjection: true,
          focusTargetMatchesActiveEditor: true,
        },
        blockedReason: expect.stringContaining("invoking focus still requires the real IEditorService/CodeEditorWidget owner"),
      },
      reusableShellEvidence: {
        domShellProjection: "partial",
        workbenchLayoutProjection: "partial",
        editorShellFocusRestoreProjection: "partial",
        completeAccessibleViewUiOwner: false,
      },
      missingOwners: expect.arrayContaining([
        "AccessibleView CodeEditorWidget construction and text model owner",
        "IEditorService/CodeEditorWidget.focus invocation owner",
      ]),
      blockedReason: expect.stringContaining("must stay evidence/partial"),
      vscodeParallels: expect.arrayContaining([
        "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts creates CodeEditorWidget in the AccessibleView owner",
        "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts show() calls IContextViewService.showContextView(delegate)",
        "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts focus() owns the actual editor focus invocation",
      ]),
    })
    expect(matrix.missingOwners).toEqual(expect.not.arrayContaining([
      "IContextViewService.showContextView delegate and layout placement owner",
      "editor focus restore target owner",
    ]))
    expect(renderer.editorContextFocusOwnerMatrix).toEqual(matrix)
    expect(renderer.editorContextFocusOwnerMatrix.reusableShellEvidence.completeAccessibleViewUiOwner).toBe(false)
    expect(renderer.editor.codeEditorWidgetBacked).toBe(false)
    expect(renderer.placement.contextViewDelegateOwner).toBe("projected")
    expect(renderer.editorShellFocusRestore.focusRestoreInvocationOwner).toBe("missing")
  })

  it("projects DOM shell selector, focus and readiness evidence while real UI owners stay blocked", () => {
    const layoutService = new WorkbenchLayoutService()
    const shell = layoutService.createShellProjection({
      activeSidebarView: "files",
      sidebarVisible: true,
      sidebarWidth: 300,
      bottomPanel: createBottomPanelState("output"),
      bottomPanelHeight: 220,
      editorGroups: createEditorGroupState({
        editors: [{ path: "src/domShellReadiness.ts", permanent: true }],
        activeEditor: "src/domShellReadiness.ts",
      }),
    })
    const lifecycle = {
      source: "codek.accessibleView.lifecycleProjection",
      owner: "headless-service-adapter",
      state: "partial",
      isShown: true,
      currentProviderId: "terminal",
      lastProviderId: "terminal",
      currentContent: "Readable terminal output",
      context: {
        accessibilityHelpIsShown: false,
        accessibleViewIsShown: true,
        currentProviderId: "terminal",
        supportsNavigation: false,
        goToSymbolSupported: false,
      },
      focusHandoff: { requested: true, targetId: "editor:active", state: "projected" },
      evidence: {
        providerFactoryInvoked: true,
        providerOnOpenCalled: true,
        providerOnCloseCalled: false,
        providerDisposeCalled: false,
        lastProviderReplayAvailable: true,
        lastProviderReplayed: false,
      },
      remainingBlockedSurfaces: [
        "AccessibleView class with CodeEditorWidget-backed rendering",
        "Workbench toolbar and quick-pick affordances",
      ],
    } as const

    const placement = createAccessibleViewPlacementOwnerProjection(shell)
    const focusRestore = createAccessibleViewEditorShellFocusRestoreProjection(lifecycle, placement)
    const readiness = createAccessibleViewDomShellReadinessProjection(lifecycle, placement, focusRestore)
    const projection = createAccessibleViewRendererProjection(lifecycle, placement)
    const element = renderAccessibleViewDomShell(projection, document)

    expect(projection.domShellReadiness).toEqual(readiness)
    expect(readiness).toMatchObject({
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
        focusRestoreTargetOwner: "projected",
        focusRestoreInvocationOwner: "missing",
        projectedFocusTargetId: "editor:active",
        activeEditor: "src/domShellReadiness.ts",
        codeEditorWidgetBacked: false,
      },
      readiness: {
        rootSelector: true,
        titleSelector: true,
        readonlyContentSelector: true,
        toolbarSelector: true,
        providerLifecycleProjection: true,
        workbenchPlacementProjection: true,
        editorShellFocusTargetProjection: true,
        actionRegistryProjection: true,
      },
      blockedOwners: expect.arrayContaining([
        "CodeEditorWidget-backed AccessibleView content owner",
        "AccessibleView WorkbenchToolBar rendering owner",
        "AccessibleViewSymbolQuickPick owner backed by IQuickInputService.createQuickPick",
        "IEditorService/CodeEditorWidget.focus invocation owner",
      ]),
      blockedReason: expect.stringContaining("stable selectors"),
    })
    expect(readiness.blockedOwners).toEqual(expect.not.arrayContaining([
      "IContextViewService/ILayoutService context view owner",
    ]))
    expect(element.matches(readiness.selectors.root)).toBe(true)
    expect(element.querySelector(readiness.selectors.title)?.textContent).toBe("Accessible View")
    expect(element.querySelector<HTMLTextAreaElement>(readiness.selectors.content)?.readOnly).toBe(true)
    expect(element.querySelector<HTMLElement>(readiness.selectors.toolbar)?.dataset.menuId).toBe("AccessibleView")
    expect(element.dataset.domShellReadinessOwner).toBe("headless-service-adapter")
    expect(element.dataset.domShellReadinessState).toBe("partial")
    expect(element.dataset.domShellRootSelectorReady).toBe("true")
    expect(element.dataset.domShellReadonlyContentSelectorReady).toBe("true")
    expect(element.dataset.domShellToolbarSelectorReady).toBe("true")
    expect(element.dataset.domShellFocusRestoreTargetOwner).toBe("projected")
    expect(element.dataset.domShellFocusInvocationOwner).toBe("missing")
    expect(element.dataset.domShellProviderLifecycleProjection).toBe("true")
    expect(element.dataset.domShellWorkbenchPlacementProjection).toBe("true")
    expect(element.dataset.domShellEditorFocusTargetProjection).toBe("true")
    expect(element.dataset.domShellBlockedOwners).toContain("CodeEditorWidget-backed AccessibleView content owner")
  })

  it("allows an App-owned visible DOM shell without upgrading blocked VS Code owners", () => {
    const service = new AccessibleViewService()
    service.registerProvider({
      type: "view",
      priority: 10,
      name: "Visible DOM Shell",
      providerId: "visible-dom-shell",
      createProvider: () => ({
        providerId: "visible-dom-shell",
        type: "view",
        provideContent: () => "Visible shell content\nfrom provider",
      }),
    })

    const showResult = service.show("visible-dom-shell")
    const projection = service.getRendererProjection()
    const element = renderAccessibleViewDomShell(projection, document)

    expect(showResult).toMatchObject({
      shown: true,
      providerId: "visible-dom-shell",
      content: "Visible shell content\nfrom provider",
    })
    expect(projection).toMatchObject({
      owner: "headless-service-adapter",
      state: "partial",
      hidden: false,
      providerId: "visible-dom-shell",
      domShellReadiness: {
        owner: "headless-service-adapter",
        state: "partial",
      },
      editor: {
        owner: "missing",
        renderedBy: "dom-shell-projection",
        codeEditorWidgetBacked: false,
      },
      editorContextFocusOwnerMatrix: {
        state: "blocked",
        contextView: {
          contextViewDelegateOwner: "missing",
        },
        focusRestoreInvocation: {
          focusRestoreInvocationOwner: "missing",
        },
      },
      toolbarQuickPickFocusInvocation: {
        state: "blocked",
        toolbar: {
          workbenchToolbarWidgetBacked: false,
        },
        quickPick: {
          genericQuickInputSurface: {
            reusableInfrastructure: true,
            accessibleViewSymbolQuickPickOwner: false,
          },
          symbolQuickPickOwner: "missing",
        },
        focusInvocation: {
          focusRestoreInvocationOwner: "missing",
          codeEditorWidgetBacked: false,
        },
      },
    })
    expect(element.hasAttribute("hidden")).toBe(false)
    expect(element.dataset.providerId).toBe("visible-dom-shell")
    expect(element.dataset.rendererOwner).toBe("headless-service-adapter")
    expect(element.dataset.quickPickOwner).toBe("missing")
    expect(element.dataset.genericQuickInputReusable).toBe("true")
    expect(element.dataset.genericQuickInputAccessibleViewOwner).toBe("false")
    expect(element.dataset.focusInvocationOwner).toBe("missing")
    expect(element.querySelector<HTMLTextAreaElement>("[data-accessible-view-content]")?.value).toBe("Visible shell content\nfrom provider")
  })

  it("records App-owned editor focus restore while keeping CodeEditorWidget ownership blocked", () => {
    const service = new AccessibleViewService()
    service.registerProvider({
      type: "view",
      priority: 10,
      name: "Focus Restore",
      providerId: "focus-restore",
      createProvider: () => ({
        providerId: "focus-restore",
        type: "view",
        provideContent: () => "Focus restore content",
      }),
    })

    expect(service.show("focus-restore")).toMatchObject({ shown: true })
    expect(service.hide({ focusTargetId: "editor:active" })).toMatchObject({
      hidden: true,
      focusTargetId: "editor:active",
    })
    expect(service.recordFocusRestoreInvocation({
      targetId: "editor:active",
      activeEditor: "src/App.vue",
      invoked: true,
    })).toMatchObject({
      source: "codek.accessibleView.focusRestoreInvocation",
      owner: "App.vue editor.focus",
      state: "partial",
      targetId: "editor:active",
      activeEditor: "src/App.vue",
      invoked: true,
      focusRestoreInvocationOwner: "App.vue editor.focus",
      codeEditorWidgetBacked: false,
      noSecondFocusState: true,
    })

    const projection = service.getRendererProjection()
    expect(projection.focusHandoff).toEqual({ requested: true, targetId: "editor:active", state: "projected" })
    expect(projection.editorShellFocusRestore).toMatchObject({
      focusRestoreInvocationOwner: "App.vue editor.focus",
      codeEditorWidgetBacked: false,
      textModelBacked: false,
    })
    expect(projection.toolbarQuickPickFocusInvocation.focusInvocation).toMatchObject({
      focusRestoreInvocationOwner: "App.vue editor.focus",
      activeEditor: "src/App.vue",
      codeEditorWidgetBacked: false,
      blockedReason: expect.stringContaining("full parity remains blocked"),
    })
    expect(projection.editorContextFocusOwnerMatrix.focusRestoreInvocation).toMatchObject({
      focusRestoreInvocationOwner: "App.vue editor.focus",
      activeEditor: "src/App.vue",
      blockedReason: expect.stringContaining("full parity remains blocked"),
    })
    expect(projection.domShellReadiness.focus).toMatchObject({
      focusRestoreInvocationOwner: "App.vue editor.focus",
      activeEditor: "src/App.vue",
      codeEditorWidgetBacked: false,
    })
    expect(projection.editor.codeEditorWidgetBacked).toBe(false)
    expect(projection.toolbarQuickPickFocusInvocation.toolbar.workbenchToolbarWidgetBacked).toBe(false)
    expect(projection.domShellReadiness.blockedOwners).toEqual(expect.arrayContaining([
      "CodeEditorWidget-backed AccessibleView content owner",
      "AccessibleView WorkbenchToolBar rendering owner",
    ]))
    expect(projection.domShellReadiness.blockedOwners).not.toContain("IEditorService/CodeEditorWidget.focus invocation owner")
  })

  it("replays the last provider through a fresh factory and records the saved cursor position", () => {
    const service = new AccessibleViewService()
    const events: string[] = []
    let factoryCalls = 0
    service.registerProvider({
      type: "help",
      priority: 1,
      name: "Editor Help",
      providerId: "editorHelp",
      createProvider: () => {
        factoryCalls += 1
        return {
          providerId: "editorHelp",
          type: "help",
          provideContent: () => `Help content ${factoryCalls}`,
          onOpen: () => events.push(`open:${factoryCalls}`),
          onClose: () => events.push(`close:${factoryCalls}`),
          dispose: () => events.push(`dispose:${factoryCalls}`),
        }
      },
    })

    service.show("editorHelp", { position: { lineNumber: 3, column: 5 } })
    service.hide()

    expect(service.showLastProvider()).toMatchObject({
      shown: true,
      providerId: "editorHelp",
      content: "Help content 2",
      restoredPosition: { lineNumber: 3, column: 5 },
    })
    expect(factoryCalls).toBe(2)
    expect(events).toEqual(["open:1", "close:1", "dispose:1", "open:2"])
    expect(service.getWidgetLifecycleProjection()).toMatchObject({
      isShown: true,
      currentProviderId: "editorHelp",
      lastProviderId: "editorHelp",
      context: {
        accessibilityHelpIsShown: true,
        accessibleViewIsShown: false,
        currentProviderId: "editorHelp",
      },
      evidence: {
        lastProviderReplayAvailable: true,
        lastProviderReplayed: true,
      },
    })
  })

  it("keeps real CodeEditorWidget owner gaps blocked after the service-level lifecycle projection", () => {
    const service = new AccessibleViewService()
    const projection = service.getContractProjection()

    expect(projection.widgetContribution).toMatchObject({
      owner: "missing",
      state: "blocked",
      missingSurfaces: expect.arrayContaining([
        "AccessibleView class with CodeEditorWidget-backed rendering",
        "IContextViewService and ILayoutService placement owner",
        "Workbench toolbar and quick-pick affordances",
      ]),
    })
    expect(projection.blockedGaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "accessibleView.widgetOwner",
        reason: expect.stringContaining("CodeEditorWidget-backed"),
      }),
    ]))
  })

  it("keeps CB/CE lifecycle, context and DOM shell contracts from regressing while owner remains blocked", () => {
    const lifecycle = {
      source: "codek.accessibleView.lifecycleProjection",
      owner: "headless-service-adapter",
      state: "partial",
      isShown: false,
      lastProviderId: "inlineCompletions",
      context: {
        accessibilityHelpIsShown: false,
        accessibleViewIsShown: false,
        supportsNavigation: false,
        goToSymbolSupported: false,
      },
      focusHandoff: { requested: true, targetId: "editor:active", state: "projected" },
      evidence: {
        providerFactoryInvoked: true,
        providerOnOpenCalled: true,
        providerOnCloseCalled: true,
        providerDisposeCalled: true,
        lastProviderReplayAvailable: true,
        lastProviderReplayed: false,
      },
      remainingBlockedSurfaces: [
        "AccessibleView class with CodeEditorWidget-backed rendering",
        "IContextViewService and ILayoutService placement owner",
      ],
    } as const

    const feasibility = createAccessibleViewOwnerFeasibilityProjection(lifecycle)
    const projection = createAccessibleViewRendererProjection(lifecycle)
    const element = renderAccessibleViewDomShell(projection, document)

    expect(feasibility.availableEvidence).toMatchObject({
      providerLifecycleProjection: true,
      commandMenuProjection: true,
      domShellProjection: true,
      projectedFocusTargetId: "editor:active",
    })
    expect(projection).toMatchObject({
      owner: "headless-service-adapter",
      hidden: true,
      readonlyContent: true,
      focusHandoff: {
        requested: true,
        targetId: "editor:active",
        state: "projected",
      },
      editor: {
        owner: "missing",
        codeEditorWidgetBacked: false,
      },
      placement: {
        owner: "missing",
        state: "blocked",
        requiredOwner: "IContextViewService/ILayoutService",
      },
      ownerFeasibility: feasibility,
    })
    expect(element.hasAttribute("hidden")).toBe(true)
    expect(element.dataset.rendererOwner).toBe("headless-service-adapter")
    expect(element.dataset.ownerFeasibility).toBe("blocked")
  })

  it("can derive workbench placement owner evidence from the existing layout shell without claiming editor ownership", () => {
    const layoutService = new WorkbenchLayoutService()
    const shell = layoutService.createShellProjection({
      activeSidebarView: "files",
      sidebarVisible: true,
      sidebarWidth: 300,
      bottomPanel: createBottomPanelState("output"),
      bottomPanelHeight: 240,
      editorGroups: createEditorGroupState({
        editors: [{ path: "src/accessibility.ts", permanent: true }],
        activeEditor: "src/accessibility.ts",
      }),
    })
    const lifecycle = {
      source: "codek.accessibleView.lifecycleProjection",
      owner: "headless-service-adapter",
      state: "partial",
      isShown: true,
      currentProviderId: "terminal",
      currentContent: "Terminal output",
      context: {
        accessibilityHelpIsShown: false,
        accessibleViewIsShown: true,
        currentProviderId: "terminal",
        supportsNavigation: false,
        goToSymbolSupported: false,
      },
      focusHandoff: { requested: false, state: "none" },
      evidence: {
        providerFactoryInvoked: true,
        providerOnOpenCalled: true,
        providerOnCloseCalled: false,
        providerDisposeCalled: false,
        lastProviderReplayAvailable: true,
        lastProviderReplayed: false,
      },
      remainingBlockedSurfaces: [
        "AccessibleView class with CodeEditorWidget-backed rendering",
        "IContextViewService and ILayoutService placement owner",
      ],
    } as const

    const placement = createAccessibleViewPlacementOwnerProjection(shell)
    const feasibility = createAccessibleViewOwnerFeasibilityProjection(lifecycle, placement)
    const projection = createAccessibleViewRendererProjection(lifecycle, placement)
    const element = renderAccessibleViewDomShell(projection, document)

    expect(placement).toMatchObject({
      source: "codek.accessibleView.placementOwnerProjection",
      owner: "workbenchLayoutService",
      state: "partial",
      stateSource: "workbenchLayoutService",
      noSecondLayoutState: true,
      requiredOwner: "IContextViewService/ILayoutService",
      contextViewDelegateOwner: "projected",
      layoutPlacementOwner: "projected",
      activeContainer: {
        editor: "src/accessibility.ts",
        panelId: "output",
        viewContainerId: null,
      },
      vscodeParallels: expect.arrayContaining([
        "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts show() builds an IContextViewDelegate",
        "src/vs/workbench/services/layout/browser/layoutService.ts provides active container placement evidence",
      ]),
    })
    expect(feasibility).toMatchObject({
      owner: "workbench-placement-adapter",
      state: "blocked",
      availableEvidence: {
        providerLifecycleProjection: true,
        commandMenuProjection: true,
        domShellProjection: true,
        workbenchPlacementProjection: true,
      },
      missingOwners: expect.not.arrayContaining([
        "IContextViewService.showContextView delegate and owner container",
        "ILayoutService active container dimensions and quick-pick top placement",
      ]),
      minimumSafeNextStep: "wire-editor-shell-owner",
      blockedReason: expect.stringContaining("CodeEditorWidget/text model owner"),
    })
    expect(projection.placement).toEqual(placement)
    expect(projection.editor).toMatchObject({
      owner: "missing",
      codeEditorWidgetBacked: false,
    })
    expect(element.dataset.placementOwner).toBe("workbenchLayoutService")
    expect(element.dataset.placementState).toBe("partial")
    expect(element.dataset.ownerFeasibility).toBe("blocked")
  })

  it("projects editor shell focus restore target evidence without claiming CodeEditorWidget focus ownership", () => {
    const layoutService = new WorkbenchLayoutService()
    const shell = layoutService.createShellProjection({
      activeSidebarView: "files",
      sidebarVisible: true,
      sidebarWidth: 300,
      bottomPanel: createBottomPanelState("terminal"),
      bottomPanelHeight: 220,
      editorGroups: createEditorGroupState({
        editors: [{ path: "src/focusRestore.ts", permanent: true }],
        activeEditor: "src/focusRestore.ts",
      }),
    })
    const lifecycle = {
      source: "codek.accessibleView.lifecycleProjection",
      owner: "headless-service-adapter",
      state: "partial",
      isShown: false,
      lastProviderId: "terminal",
      context: {
        accessibilityHelpIsShown: false,
        accessibleViewIsShown: false,
        supportsNavigation: false,
        goToSymbolSupported: false,
      },
      focusHandoff: { requested: true, targetId: "editor:active", state: "projected" },
      evidence: {
        providerFactoryInvoked: true,
        providerOnOpenCalled: true,
        providerOnCloseCalled: true,
        providerDisposeCalled: true,
        lastProviderReplayAvailable: true,
        lastProviderReplayed: false,
      },
      remainingBlockedSurfaces: [
        "AccessibleView class with CodeEditorWidget-backed rendering",
        "Workbench toolbar and quick-pick affordances",
      ],
    } as const

    const placement = createAccessibleViewPlacementOwnerProjection(shell)
    const editorShellFocusRestore = createAccessibleViewEditorShellFocusRestoreProjection(lifecycle, placement)
    const feasibility = createAccessibleViewOwnerFeasibilityProjection(lifecycle, placement, editorShellFocusRestore)
    const projection = createAccessibleViewRendererProjection(lifecycle, placement)
    const element = renderAccessibleViewDomShell(projection, document)

    expect(editorShellFocusRestore).toMatchObject({
      source: "codek.accessibleView.editorShellFocusRestoreProjection",
      owner: "workbenchLayoutService",
      state: "partial",
      stateSource: "workbenchLayoutService",
      noSecondFocusState: true,
      activeEditor: "src/focusRestore.ts",
      projectedFocusTargetId: "editor:active",
      focusRestoreTargetOwner: "projected",
      focusRestoreInvocationOwner: "missing",
      focusTargetMatchesActiveEditor: true,
      codeEditorWidgetBacked: false,
      textModelBacked: false,
      blockedReason: expect.stringContaining("does not own the real CodeEditorWidget/IEditorService focus invocation"),
      vscodeParallels: expect.arrayContaining([
        "src/vs/workbench/services/editor/common/editorService.ts exposes activeEditor/activeTextEditorControl for real editor focus owners",
        "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts focus() owns the actual text editor focus invocation",
      ]),
    })
    expect(feasibility).toMatchObject({
      owner: "editor-shell-focus-restore-adapter",
      state: "blocked",
      vscodeOwner: {
        editorServicePath: "src/vs/workbench/services/editor/common/editorService.ts",
      },
      availableEvidence: {
        providerLifecycleProjection: true,
        commandMenuProjection: true,
        domShellProjection: true,
        workbenchPlacementProjection: true,
        editorShellFocusRestoreProjection: true,
        projectedActiveEditor: "src/focusRestore.ts",
        projectedFocusTargetId: "editor:active",
      },
      missingOwners: expect.arrayContaining([
        "CodeEditorWidget construction and text model ownership",
        "Workbench toolbar/quick-pick action owner",
        "real CodeEditorWidget.focus()/IEditorService focus invocation after context view hide",
      ]),
      blockedReason: expect.stringContaining("actual IEditorService/CodeEditorWidget focus invocation"),
    })
    expect(feasibility.missingOwners).toEqual(expect.not.arrayContaining([
      "real editor focus restore target after context view hide",
      "IContextViewService.showContextView delegate and owner container",
    ]))
    expect(projection.editorShellFocusRestore).toEqual(editorShellFocusRestore)
    expect(projection.ownerFeasibility).toEqual(feasibility)
    expect(projection.editor).toMatchObject({
      owner: "missing",
      codeEditorWidgetBacked: false,
    })
    expect(element.dataset.editorShellFocusRestoreOwner).toBe("workbenchLayoutService")
    expect(element.dataset.editorShellFocusRestoreState).toBe("partial")
    expect(element.dataset.editorShellActiveEditor).toBe("src/focusRestore.ts")
    expect(element.dataset.toolbarQuickPickFocusInvocationOwner).toBe("menu-service-projection")
    expect(element.dataset.quickPickOwner).toBe("missing")
    expect(element.dataset.focusInvocationOwner).toBe("missing")
    expect(element.dataset.codeEditorWidgetBacked).toBe("false")
    expect(element.dataset.ownerFeasibility).toBe("blocked")
  })

  it("keeps toolbar, quick-pick and focus invocation owners blocked with VS Code evidence", () => {
    const layoutService = new WorkbenchLayoutService()
    const shell = layoutService.createShellProjection({
      activeSidebarView: "files",
      sidebarVisible: true,
      sidebarWidth: 300,
      bottomPanel: createBottomPanelState("terminal"),
      bottomPanelHeight: 220,
      editorGroups: createEditorGroupState({
        editors: [{ path: "src/invocation.ts", permanent: true }],
        activeEditor: "src/invocation.ts",
      }),
    })
    const lifecycle = {
      source: "codek.accessibleView.lifecycleProjection",
      owner: "headless-service-adapter",
      state: "partial",
      isShown: false,
      lastProviderId: "inlineCompletions",
      context: {
        accessibilityHelpIsShown: false,
        accessibleViewIsShown: false,
        supportsNavigation: false,
        goToSymbolSupported: false,
      },
      focusHandoff: { requested: true, targetId: "editor:active", state: "projected" },
      evidence: {
        providerFactoryInvoked: true,
        providerOnOpenCalled: true,
        providerOnCloseCalled: true,
        providerDisposeCalled: true,
        lastProviderReplayAvailable: true,
        lastProviderReplayed: false,
      },
      remainingBlockedSurfaces: [
        "AccessibleView class with CodeEditorWidget-backed rendering",
        "Workbench toolbar and quick-pick affordances",
      ],
    } as const

    const placement = createAccessibleViewPlacementOwnerProjection(shell)
    const editorShellFocusRestore = createAccessibleViewEditorShellFocusRestoreProjection(lifecycle, placement)
    const projection = createAccessibleViewToolbarQuickPickFocusInvocationProjection(lifecycle, editorShellFocusRestore)

    expect(projection).toMatchObject({
      source: "codek.accessibleView.toolbarQuickPickFocusInvocationProjection",
      owner: "menu-service-projection",
      state: "blocked",
      noSecondActionState: true,
      toolbar: {
        requiredOwner: "WorkbenchToolBar + MenuId.AccessibleView",
        menuId: "AccessibleView",
        menuActionIds: expect.arrayContaining([
          ACCESSIBLE_VIEW_ACTION_IDS.showNext,
          ACCESSIBLE_VIEW_ACTION_IDS.goToSymbol,
          ACCESSIBLE_VIEW_ACTION_IDS.acceptInlineCompletion,
        ]),
        actionRegistryBacked: true,
        workbenchToolbarWidgetBacked: false,
        blockedReason: expect.stringContaining("no AccessibleView widget owns a WorkbenchToolBar"),
        vscodeParallels: expect.arrayContaining([
          "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts constructs WorkbenchToolBar for Accessible View",
          "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts _updateToolbar() reads MenuId.AccessibleView actions",
        ]),
      },
      quickPick: {
        requiredOwner: "IQuickInputService.createQuickPick",
        quickInputServicePath: "src/vs/platform/quickinput/browser/quickInputService.ts",
        symbolQuickPickOwner: "missing",
        goToSymbolActionRegistered: true,
        genericQuickInputSurface: {
          paths: [
            "frontend/vite-project/src/workbench/quickInput.ts",
            "frontend/vite-project/src/components/QuickPickDialog.vue",
          ],
          state: "available",
          reusableInfrastructure: true,
          accessibleViewSymbolQuickPickOwner: false,
          blockedReason: expect.stringContaining("generic QuickInput"),
        },
        blockedReason: expect.stringContaining("no AccessibleViewSymbolQuickPick owner"),
        vscodeParallels: expect.arrayContaining([
          "src/vs/workbench/contrib/accessibility/browser/accessibleView.ts AccessibleViewSymbolQuickPick.show() creates a quick pick",
          "src/vs/platform/quickinput/browser/quickInputService.ts createQuickPick() owns the picker lifecycle",
        ]),
      },
      focusInvocation: {
        requiredOwner: "IEditorService/CodeEditorWidget.focus",
        editorServicePath: "src/vs/workbench/services/editor/common/editorService.ts",
        codeEditorWidgetPath: "src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts",
        focusRestoreTargetOwner: "projected",
        focusRestoreInvocationOwner: "missing",
        activeEditor: "src/invocation.ts",
        projectedFocusTargetId: "editor:active",
        codeEditorWidgetBacked: false,
        blockedReason: expect.stringContaining("requires the generic editor shell/App.vue"),
        vscodeParallels: expect.arrayContaining([
          "src/vs/workbench/contrib/accessibility/browser/accessibleViewActions.ts resolves active/focused editor before inline completion accept",
          "src/vs/workbench/contrib/accessibility/browser/accessibleViewActions.ts calls editor.focus() after accepting inline completion",
        ]),
      },
      remainingBlockedSurfaces: expect.arrayContaining([
        "AccessibleView WorkbenchToolBar instance and action rendering owner",
        "AccessibleViewSymbolQuickPick backed by IQuickInputService.createQuickPick",
        "IEditorService/CodeEditorWidget.focus invocation after Accessible View close/action",
      ]),
    })
  })

  it("projects accessibility signal UI evidence from keyboard navigation status and live regions", () => {
    const service = new AccessibleViewService()
    const keyboardNavigation = new AccessibilityKeyboardNavigationService()

    keyboardNavigation.configure({ accessibilitySupport: "on" })
    keyboardNavigation.setAccessibilitySupport(AccessibilitySupport.Enabled)
    keyboardNavigation.alert("Explorer row expanded")
    keyboardNavigation.status("Screen reader ready")

    const projection = service.getAccessibilitySignalUiProjection(keyboardNavigation)

    expect(projection).toMatchObject({
      source: "codek.accessibilitySignal.uiProjection",
      owner: "AccessibilityKeyboardNavigationService",
      state: "partial",
      status: {
        id: "status.editor.screenReaderMode",
        visible: true,
        text: "Screen Reader Optimized",
        ariaLabel: "Screen Reader Optimized",
      },
      capabilities: {
        screenReaderStatusItem: "available",
        liveRegionAnnouncements: "available",
        signalActionEvidence: "available",
        soundPlayback: "blocked",
        progressSignalScheduler: "blocked",
        signalConfigurationUi: "blocked",
      },
    })
    expect(projection.actionOwner).toMatchObject({
      source: "codek.accessibilitySignal.uiActionOwner",
      owner: "AccessibilityKeyboardNavigationService",
      state: "partial",
      registeredActionIds: [
        ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceProgress,
        ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceClear,
      ],
      availableEvidence: {
        actionRegistration: true,
        actionInvocationEvidence: false,
        announcementStatusBridge: true,
        liveRegionProjection: true,
      },
      blockedCapabilities: expect.arrayContaining([
        "audio asset playback",
        "accessibility.signals configuration UI",
        "AccessibilityProgressSignalScheduler loop owner",
      ]),
    })
    expect(projection.evidence).toMatchObject({
      source: "codek.accessibilitySignal.uiEvidence",
      owner: "AccessibilityKeyboardNavigationService",
      state: "partial",
      noSecondSignalState: true,
      serviceBackedEvidence: {
        screenReaderStatusItem: {
          visible: true,
          text: "Screen Reader Optimized",
          command: "showEditorScreenReaderNotification",
        },
        alertLiveRegionCount: 2,
        statusLiveRegionCount: 2,
        invokedActionIds: [],
      },
      uiEvidence: {
        actionRegistration: true,
        statusProjection: true,
        alertLiveRegionProjection: true,
        statusLiveRegionProjection: true,
        actionInvocationEvidence: false,
      },
      blockedOwners: expect.arrayContaining([
        expect.objectContaining({
          owner: "IAccessibilitySignalService",
          codekEvidence: "status-alert-live-region-only",
        }),
        expect.objectContaining({
          owner: "AccessibilitySignal audio assets",
          codekEvidence: "no-audio-asset-owner",
        }),
        expect.objectContaining({
          owner: "AccessibilityProgressSignalScheduler",
          codekEvidence: "no-progress-signal-loop-owner",
        }),
        expect.objectContaining({
          owner: "accessibility.signals configuration UI",
          codekEvidence: "no-signal-settings-ui-owner",
        }),
      ]),
      blockedReason: expect.stringContaining("screen-reader status/live-region signal bridge only"),
    })
    expect(projection.ownerReadiness).toMatchObject({
      source: "codek.accessibilitySignal.uiOwnerReadiness",
      state: "blocked",
      noSecondSignalState: true,
      minimalBridge: {
        owner: "AccessibilityKeyboardNavigationService",
        state: "available",
        actionRegistration: true,
        actionInvocationEvidence: false,
        statusProjection: true,
        liveRegionProjection: true,
        codekPath: "frontend/vite-project/src/workbench/accessibilityKeyboardNavigationService.ts",
      },
      fullSignalOwner: {
        owner: "IAccessibilitySignalService",
        state: "blocked",
        requiredSurfaces: expect.arrayContaining([
          "IAccessibilitySignalService playSignal/playSignals/playSignalLoop implementation",
          "AccessibilitySignal audio media asset loading and playback",
          "AccessibilityProgressSignalScheduler wiring for long-running progress UI",
          "accessibility.signals settings schema and command UI",
          "telemetry-backed signal enablement and user-gesture policy",
        ]),
        blockedReason: expect.stringContaining("not VS Code's full signal service owner"),
        vscodeParallels: expect.arrayContaining([
          "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts AccessibilitySignalService",
          "src/vs/workbench/contrib/accessibilitySignals/browser/accessibilitySignal.contribution.ts registers IAccessibilitySignalService and signal help commands",
        ]),
      },
      blockedIntegrationBoundary: {
        canImplementInThisThread: false,
        requiredCodekEntryPoints: expect.arrayContaining([
          expect.objectContaining({
            path: "frontend/vite-project/src/accessibility/accessibleViewService.ts",
            state: "candidate",
          }),
          expect.objectContaining({
            path: "frontend/vite-project/src/workbench/accessibilityKeyboardNavigationService.ts",
            state: "candidate",
          }),
          expect.objectContaining({
            path: "frontend/vite-project/src/App.vue",
            state: "blocked",
          }),
        ]),
        avoidedSurfaces: expect.arrayContaining([
          "frontend/vite-project/src/App.vue",
          "generic workbench shell contribution wiring",
          "runtime imports from the external VS Code reference checkout",
        ]),
        acceptanceEvidence: expect.arrayContaining([
          "Minimal signal UI actions register and invoke through AccessibilityKeyboardNavigationService",
          "Full VS Code signal parity stays blocked until IAccessibilitySignalService, progress scheduler, audio assets, telemetry, and settings UI share one owner",
        ]),
        blockedReason: expect.stringContaining("should not wire App.vue"),
      },
    })
    expect(projection.aria.alertRegions.some((region) => region.text === "Explorer row expanded")).toBe(true)
    expect(projection.aria.statusRegions.some((region) => region.text === "Screen reader ready")).toBe(true)
    expect(projection.vscodeParallels).toEqual(expect.arrayContaining([
      "src/vs/platform/accessibility/browser/accessibilityService.ts status()/alert() live-region bridge",
      "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts playSignal announcement/audio split",
      "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts playSignals() batches status announcements",
      "src/vs/workbench/contrib/accessibility/browser/accessibilityConfiguration.ts accessibility.signals settings schema",
    ]))
  })

  it("registers and invokes accessibility signal UI actions through the keyboard navigation owner", () => {
    const service = new AccessibleViewService()
    const keyboardNavigation = new AccessibilityKeyboardNavigationService({
      now: () => 2000,
      createId: (prefix, index) => `${prefix}-${index}`,
    })

    const disposable = service.registerAccessibilitySignalUiActions(keyboardNavigation)

    expect(keyboardNavigation.invokeAccessibilityAction(ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceProgress, {
      target: "status-bar",
      signal: "progress",
      rawPath: "D:/Workspace/private/file.ts",
    })).toBe(true)
    expect(keyboardNavigation.invokeAccessibilityAction(ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceClear, {
      target: "accessible-view",
      signal: "clear",
      rawPath: "D:/Workspace/private/clear.ts",
    })).toBe(true)

    const projection = service.getAccessibilitySignalUiProjection(keyboardNavigation)

    expect(projection.aria.statusRegions.some((region) => region.text === "Progress")).toBe(true)
    expect(projection.aria.alertRegions.some((region) => region.text === "Clear")).toBe(true)
    expect(projection.actionOwner.availableEvidence).toMatchObject({
      actionRegistration: true,
      actionInvocationEvidence: true,
      announcementStatusBridge: true,
      liveRegionProjection: true,
    })
    expect(projection.actionOwner.invokedEvidence).toEqual([
      expect.objectContaining({
        id: "action-0",
        actionId: ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceProgress,
        commandId: ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceProgress,
        label: "Announce Progress Signal",
        source: "accessibility.signal",
        target: "status-bar",
        metadata: { signal: "progress" },
        createdAt: 2000,
      }),
      expect.objectContaining({
        id: "action-1",
        actionId: ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceClear,
        commandId: ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceClear,
        label: "Announce Clear Signal",
        source: "accessibility.signal",
        target: "accessible-view",
        metadata: { signal: "clear" },
        createdAt: 2000,
      }),
    ])
    expect(projection.actionOwner.blockedCapabilities).toEqual(expect.arrayContaining([
      "audio asset playback",
      "accessibility.signals configuration UI",
      "AccessibilityProgressSignalScheduler loop owner",
      "telemetry-backed signal enablement",
    ]))
    expect(projection.evidence.serviceBackedEvidence.invokedActionIds).toEqual([
      ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceProgress,
      ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceClear,
    ])
    expect(projection.evidence.uiEvidence).toMatchObject({
      actionRegistration: true,
      actionInvocationEvidence: true,
      statusLiveRegionProjection: true,
      alertLiveRegionProjection: true,
    })
    expect(projection.evidence.blockedOwners).toEqual(expect.arrayContaining([
      expect.objectContaining({
        owner: "IAccessibilitySignalService",
        codekEvidence: "status-alert-live-region-only",
      }),
      expect.objectContaining({
        owner: "accessibility.signals configuration UI",
        codekEvidence: "no-signal-settings-ui-owner",
      }),
    ]))
    expect(projection.actionOwner.vscodeParallels).toEqual(expect.arrayContaining([
      "src/vs/platform/accessibilitySignal/browser/accessibilitySignalService.ts playSignal() forwards announcements to accessibilityService.status()",
      "src/vs/platform/accessibilitySignal/browser/progressAccessibilitySignalScheduler.ts owns delayed progress signal loops",
    ]))
    expect(projection.ownerReadiness.minimalBridge).toMatchObject({
      state: "available",
      actionRegistration: true,
      actionInvocationEvidence: true,
      statusProjection: true,
      liveRegionProjection: true,
    })
    expect(projection.ownerReadiness.fullSignalOwner).toMatchObject({
      owner: "IAccessibilitySignalService",
      state: "blocked",
      requiredSurfaces: expect.arrayContaining([
        "IAccessibilitySignalService playSignal/playSignals/playSignalLoop implementation",
        "accessibility.signals settings schema and command UI",
      ]),
    })

    disposable.dispose()
    expect(keyboardNavigation.invokeAccessibilityAction(ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceProgress)).toBe(false)
  })

  it("separates the available minimal signal UI bridge from the blocked full VS Code signal owner", () => {
    const keyboardNavigation = new AccessibilityKeyboardNavigationService()
    keyboardNavigation.setAccessibilitySupport(AccessibilitySupport.Enabled)
    keyboardNavigation.status("Workspace indexing")
    keyboardNavigation.alert("Signal action ready")
    keyboardNavigation.registerAccessibilityAction({
      id: ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceProgress,
      label: "Announce Progress Signal",
      commandId: ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceProgress,
      source: "accessibility.signal",
      run: () => keyboardNavigation.status("Progress"),
    })
    expect(keyboardNavigation.invokeAccessibilityAction(ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceProgress, {
      signal: "progress",
    })).toBe(true)

    const projection = createAccessibilitySignalUiOwnerReadinessProjection(
      keyboardNavigation.getStatusProjection(),
      keyboardNavigation.getAriaProjection(),
      createAccessibilitySignalUiActionOwnerProjection(keyboardNavigation.getEvidenceActions()),
    )

    expect(projection).toMatchObject({
      source: "codek.accessibilitySignal.uiOwnerReadiness",
      state: "blocked",
      noSecondSignalState: true,
      minimalBridge: {
        owner: "AccessibilityKeyboardNavigationService",
        state: "available",
        actionRegistration: true,
        actionInvocationEvidence: true,
        statusProjection: true,
        liveRegionProjection: true,
      },
      fullSignalOwner: {
        owner: "IAccessibilitySignalService",
        state: "blocked",
        requiredSurfaces: expect.arrayContaining([
          "IAccessibilitySignalService playSignal/playSignals/playSignalLoop implementation",
          "AccessibilitySignal audio media asset loading and playback",
          "AccessibilityProgressSignalScheduler wiring for long-running progress UI",
          "accessibility.signals settings schema and command UI",
          "telemetry-backed signal enablement and user-gesture policy",
        ]),
        blockedReason: expect.stringContaining("not VS Code's full signal service owner"),
      },
      blockedIntegrationBoundary: {
        canImplementInThisThread: false,
        avoidedSurfaces: expect.arrayContaining([
          "frontend/vite-project/src/App.vue",
          "generic workbench shell contribution wiring",
          "runtime imports from the external VS Code reference checkout",
        ]),
      },
    })
  })

  it("keeps signal action owner projection partial without invoked evidence before actions run", () => {
    const projection = createAccessibilitySignalUiActionOwnerProjection()

    expect(projection).toMatchObject({
      source: "codek.accessibilitySignal.uiActionOwner",
      owner: "AccessibilityKeyboardNavigationService",
      state: "partial",
      noSecondSignalState: true,
      registeredActionIds: [
        ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceProgress,
        ACCESSIBILITY_SIGNAL_UI_ACTION_IDS.announceClear,
      ],
      invokedEvidence: [],
      availableEvidence: {
        actionRegistration: true,
        actionInvocationEvidence: false,
        announcementStatusBridge: true,
        liveRegionProjection: true,
      },
      blockedReason: expect.stringContaining("does not own VS Code's audio playback"),
    })
  })

  it("registers Accessible View command palette and menu actions through the VS Code action/menu contract", async () => {
    const disposable = registerAccessibleViewCommandContributions()

    expect(getCommand(ACCESSIBLE_VIEW_ACTION_IDS.openAccessibleView)).toMatchObject({
      id: ACCESSIBLE_VIEW_ACTION_IDS.openAccessibleView,
      source: "vscode",
      category: "Accessibility",
    })
    expect(MenuRegistry.getMenuEntries(MenuId.CommandPalette, {}).map((entry) => entry.id)).toEqual(expect.arrayContaining([
      ACCESSIBLE_VIEW_ACTION_IDS.openAccessibleView,
      ACCESSIBLE_VIEW_ACTION_IDS.openAccessibilityHelp,
      ACCESSIBLE_VIEW_ACTION_IDS.showNext,
      ACCESSIBLE_VIEW_ACTION_IDS.showPrevious,
      ACCESSIBLE_VIEW_ACTION_IDS.goToSymbol,
      ACCESSIBLE_VIEW_ACTION_IDS.disableVerbosityHint,
      ACCESSIBLE_VIEW_ACTION_IDS.acceptInlineCompletion,
    ]))

    const hiddenActions = MenuRegistry.getMenuEntries(MenuId.AccessibleView, {
      accessibleViewIsShown: false,
      accessibilityHelpIsShown: false,
    })
    expect(hiddenActions).toEqual([])

    const visibleActions = MenuRegistry.getMenuEntries(MenuId.AccessibleView, {
      accessibleViewIsShown: true,
      accessibleViewSupportsNavigation: true,
      accessibleViewGoToSymbolSupported: true,
      accessibleViewVerbosityEnabled: true,
      accessibleViewContainsCodeBlocks: true,
      accessibleViewCurrentProviderId: "inlineCompletions",
    })
    expect(visibleActions.map((entry) => entry.id)).toEqual([
      ACCESSIBLE_VIEW_ACTION_IDS.acceptInlineCompletion,
      ACCESSIBLE_VIEW_ACTION_IDS.showNext,
      ACCESSIBLE_VIEW_ACTION_IDS.showPrevious,
      ACCESSIBLE_VIEW_ACTION_IDS.goToSymbol,
      ACCESSIBLE_VIEW_ACTION_IDS.disableVerbosityHint,
      ACCESSIBLE_VIEW_ACTION_IDS.nextCodeBlock,
      ACCESSIBLE_VIEW_ACTION_IDS.previousCodeBlock,
    ])
    expect(visibleActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ACCESSIBLE_VIEW_ACTION_IDS.showNext, disabled: false }),
      expect.objectContaining({ id: ACCESSIBLE_VIEW_ACTION_IDS.acceptInlineCompletion, disabled: false }),
    ]))

    expect(await executeCommand(ACCESSIBLE_VIEW_ACTION_IDS.showNext, [], {
      accessibleViewIsShown: true,
      accessibleViewSupportsNavigation: true,
    })).toBe(true)
    expect(await executeCommand(ACCESSIBLE_VIEW_ACTION_IDS.showNext, [], {
      accessibleViewIsShown: true,
      accessibleViewSupportsNavigation: false,
    })).toBe(false)

    disposable.dispose()
    expect(getCommand(ACCESSIBLE_VIEW_ACTION_IDS.openAccessibleView)).toBeNull()
  })

  it("dispatches command actions into the same AccessibleViewService lifecycle without a second state source", async () => {
    const service = new AccessibleViewService()
    const events: string[] = []
    service.registerProvider({
      type: "view",
      priority: 10,
      name: "Command Owner",
      providerId: "command-owner",
      createProvider: () => ({
        providerId: "command-owner",
        type: "view",
        provideContent: () => "Initial command content",
        provideNextContent: () => "Next command content",
        providePreviousContent: () => "Previous command content",
        onOpen: () => events.push("open"),
      }),
    })
    service.registerProvider({
      type: "help",
      priority: 1,
      name: "Command Help",
      providerId: "command-help",
      createProvider: () => ({
        providerId: "command-help",
        type: "help",
        provideContent: () => "Help command content",
      }),
    })
    const disposable = registerAccessibleViewCommandContributions(service)

    expect(await executeCommand(ACCESSIBLE_VIEW_ACTION_IDS.openAccessibleView, ["command-owner"])).toBe(true)
    expect(service.getWidgetLifecycleProjection()).toMatchObject({
      owner: "headless-service-adapter",
      isShown: true,
      currentProviderId: "command-owner",
      currentContent: "Initial command content",
      evidence: {
        providerFactoryInvoked: true,
        providerOnOpenCalled: true,
      },
    })

    expect(await executeCommand(ACCESSIBLE_VIEW_ACTION_IDS.showNext, [], {
      accessibleViewIsShown: true,
      accessibleViewSupportsNavigation: true,
    })).toBe(true)
    expect(service.getWidgetLifecycleProjection().currentContent).toBe("Next command content")

    expect(await executeCommand(ACCESSIBLE_VIEW_ACTION_IDS.showPrevious, [], {
      accessibleViewIsShown: true,
      accessibleViewSupportsNavigation: true,
    })).toBe(true)
    expect(service.getWidgetLifecycleProjection().currentContent).toBe("Previous command content")

    expect(await executeCommand(ACCESSIBLE_VIEW_ACTION_IDS.openAccessibilityHelp)).toBe(true)
    expect(service.getWidgetLifecycleProjection()).toMatchObject({
      isShown: true,
      currentProviderId: "command-help",
      currentContent: "Help command content",
      context: {
        accessibilityHelpIsShown: true,
        accessibleViewIsShown: false,
      },
    })
    expect(service.getContractProjection().trueOwnerFollowUp.noSecondAccessibilityState).toBe(true)
    expect(events).toEqual(["open"])

    disposable.dispose()
  })

  it("opens Accessible View symbols through the existing QuickInputService and restores the selected provider position", async () => {
    const service = new AccessibleViewService()
    service.registerProvider({
      type: "view",
      priority: 10,
      name: "Symbol Owner",
      providerId: "symbol-owner",
      createProvider: () => ({
        providerId: "symbol-owner",
        type: "view",
        provideContent: () => "# Heading One\n\n## Heading Two",
        getSymbols: () => [
          { label: "Heading One", ariaLabel: "Heading One, line 1", lineNumber: 1, column: 1 },
          { label: "Heading Two", ariaLabel: "Heading Two, line 3", lineNumber: 3, column: 4 },
        ],
      }),
    })

    expect(service.show("symbol-owner")).toMatchObject({
      shown: true,
      providerId: "symbol-owner",
    })
    expect(service.getWidgetLifecycleProjection().context.goToSymbolSupported).toBe(true)

    const pickResult = service.goToSymbol()
    expect(quickInputState.queue).toHaveLength(1)
    expect(quickInputState.queue[0]).toMatchObject({
      type: "quickPick",
      options: {
        title: "Go to Symbol Accessible View",
        placeHolder: "Type to search symbols",
      },
      items: [
        expect.objectContaining({ label: "Heading One", description: "line 1" }),
        expect.objectContaining({ label: "Heading Two", description: "line 3" }),
      ],
    })
    expect(service.getRendererProjection().toolbarQuickPickFocusInvocation.quickPick).toMatchObject({
      symbolQuickPickOwner: "QuickInputService.createQuickPick",
      genericQuickInputSurface: {
        accessibleViewSymbolQuickPickOwner: true,
      },
    })

    acceptQuickPick(quickInputState.queue[0].id, {
      label: "Heading Two",
      description: "line 3",
      value: { label: "Heading Two", ariaLabel: "Heading Two, line 3", lineNumber: 3, column: 4 },
    })
    await expect(pickResult).resolves.toMatchObject({
      shown: true,
      providerId: "symbol-owner",
      restoredPosition: { lineNumber: 3, column: 4 },
      selectedSymbol: { label: "Heading Two", lineNumber: 3, column: 4 },
    })
    expect(service.showLastProvider()).toMatchObject({
      shown: true,
      providerId: "symbol-owner",
      restoredPosition: { lineNumber: 3, column: 4 },
    })
    expect(service.getContractProjection().trueOwnerFollowUp).toMatchObject({
      state: "blocked",
      commandMenuSignalFocusEvidence: {
        commandMenuProjection: {
          workbenchToolbarWidgetBacked: false,
        },
        focusProjection: {
          codeEditorWidgetBacked: false,
        },
      },
      requiredTrueOwners: expect.arrayContaining([
        expect.objectContaining({
          owner: "IQuickInputService.createQuickPick",
          state: "blocked",
          codekEvidence: "generic-quick-input-surface-only",
        }),
        expect.objectContaining({
          owner: "WorkbenchToolBar + MenuId.AccessibleView",
          state: "blocked",
        }),
        expect.objectContaining({
          owner: "CodeEditorWidget",
          state: "blocked",
        }),
      ]),
      blockedReason: expect.stringContaining("true AccessibleView owner must own these surfaces together"),
    })
  })

  it("exposes Accessible View menu context dependencies through MenuService", () => {
    const disposable = registerAccessibleViewCommandContributions()

    expect(globalMenuService.getMenuContexts(MenuId.AccessibleView)).toEqual(new Set([
      "accessibleViewIsShown",
      "accessibleViewSupportsNavigation",
      "accessibilityHelpIsShown",
      "accessibleViewGoToSymbolSupported",
      "accessibleViewVerbosityEnabled",
      "accessibleViewContainsCodeBlocks",
      "accessibleViewHasUnassignedKeybindings",
      "accessibleViewHasAssignedKeybindings",
      "accessibleViewCurrentProviderId",
    ]))

    const contextKeyService = new ContextKeyService({
      accessibleViewIsShown: true,
      accessibleViewSupportsNavigation: true,
    })
    const groups = globalMenuService.getMenuActions(MenuId.AccessibleView, contextKeyService)

    expect(groups).toEqual([
      ["navigation", [
        expect.objectContaining({ commandId: ACCESSIBLE_VIEW_ACTION_IDS.showNext }),
        expect.objectContaining({ commandId: ACCESSIBLE_VIEW_ACTION_IDS.showPrevious }),
      ]],
    ])

    disposable.dispose()
  })
})
