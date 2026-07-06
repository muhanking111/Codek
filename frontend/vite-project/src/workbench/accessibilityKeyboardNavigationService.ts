import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { globalContextKeyService, type ContextKeyState, type IContextKeyService } from "./contextKeys"

export const enum AccessibilitySupport {
  Unknown = 0,
  Disabled = 1,
  Enabled = 2,
}

export type AccessibilitySupportConfiguration = "auto" | "off" | "on"
export type FocusDirection = "next" | "previous" | "first" | "last"
export type FocusScopeOrientation = "horizontal" | "vertical" | "both"

export interface WorkbenchDisposable {
  dispose(): void
}

export interface AccessibilityKeyboardNavigationRuntimeHooks {
  now?: () => number
  createId?: (prefix: string, index: number) => string
}

export interface AccessibilityConfiguration {
  accessibilitySupport?: AccessibilitySupportConfiguration
  reduceMotion?: "auto" | "off" | "on"
  reduceTransparency?: "auto" | "off" | "on"
}

export interface AccessibilityContextKeys {
  readonly accessibilityModeEnabled: boolean
  readonly screenReaderOptimized: boolean
  readonly keyboardNavigationActive: boolean
  readonly activeFocusScope: string
  readonly activeFocusItem: string
  readonly reducedMotion: boolean
  readonly reducedTransparency: boolean
}

export interface AccessibilityStatusProjection {
  readonly id: string
  readonly visible: boolean
  readonly name: string
  readonly text: string
  readonly ariaLabel: string
  readonly command: string
  readonly kind: "prominent"
  readonly alignment: "right"
  readonly priority: number
}

export interface AriaLiveRegionProjection {
  readonly id: string
  readonly role?: "alert"
  readonly ariaLive?: "polite"
  readonly ariaAtomic: boolean
  readonly text: string
}

export interface AriaProjection {
  readonly alertRegions: readonly AriaLiveRegionProjection[]
  readonly statusRegions: readonly AriaLiveRegionProjection[]
}

export interface FocusScopeItem {
  readonly id: string
  readonly label: string
  readonly role?: string
  readonly disabled?: boolean
  readonly commandId?: string
}

export interface FocusScopeRegistration {
  readonly id: string
  readonly label: string
  readonly items: readonly FocusScopeItem[]
  readonly trapFocus?: boolean
  readonly orientation?: FocusScopeOrientation
  readonly activeItemId?: string
}

export interface KeyboardNavigationItemProjection extends FocusScopeItem {
  readonly tabIndex: 0 | -1
  readonly ariaSelected: boolean
  readonly ariaDisabled: boolean
}

export interface KeyboardNavigationModel {
  readonly id: string
  readonly label: string
  readonly orientation: FocusScopeOrientation
  readonly trapped: boolean
  readonly activeItemId: string
  readonly items: readonly KeyboardNavigationItemProjection[]
}

export interface AccessibilityActionRegistration {
  readonly id: string
  readonly label: string
  readonly commandId: string
  readonly keybinding?: string
  readonly source?: string
  readonly run?: () => void | Promise<void>
}

export interface CommandKeyboardAffordance {
  readonly commandId: string
  readonly label: string
  readonly keybinding: string
  readonly ariaLabel: string
  readonly source: string
}

export interface AccessibilityActionEvidence {
  readonly id: string
  readonly actionId: string
  readonly commandId: string
  readonly label: string
  readonly source: string
  readonly target: string
  readonly metadata: Record<string, unknown>
  readonly createdAt: number
}

export interface AccessibilityKeyboardNavigationSnapshot {
  readonly accessibilitySupport: AccessibilitySupport
  readonly configuration: Required<AccessibilityConfiguration>
  readonly screenReaderOptimized: boolean
  readonly context: AccessibilityContextKeys
  readonly status: AccessibilityStatusProjection
  readonly aria: AriaProjection
  readonly keyboardNavigation: readonly KeyboardNavigationModel[]
  readonly affordances: readonly CommandKeyboardAffordance[]
  readonly evidenceActions: readonly AccessibilityActionEvidence[]
}

export interface IAccessibilityKeyboardNavigationService {
  readonly _serviceBrand: undefined
  readonly onDidChangeScreenReaderOptimized: (listener: (snapshot: AccessibilityKeyboardNavigationSnapshot) => void) => WorkbenchDisposable
  configure(configuration: AccessibilityConfiguration): void
  setAccessibilitySupport(accessibilitySupport: AccessibilitySupport, reason?: string): void
  getAccessibilitySupport(): AccessibilitySupport
  isScreenReaderOptimized(): boolean
  getContextKeys(): AccessibilityContextKeys
  alert(message: string): void
  status(message: string): void
  getAriaProjection(): AriaProjection
  getStatusProjection(): AccessibilityStatusProjection
  registerFocusScope(scope: FocusScopeRegistration): WorkbenchDisposable
  moveFocus(scopeId: string, direction: FocusDirection): string
  getKeyboardNavigationModel(scopeId?: string): KeyboardNavigationModel | null
  registerAccessibilityAction(action: AccessibilityActionRegistration): WorkbenchDisposable
  invokeAccessibilityAction(actionId: string, metadata?: Record<string, unknown>): boolean
  getCommandAffordances(): CommandKeyboardAffordance[]
  getEvidenceActions(): AccessibilityActionEvidence[]
  getSnapshot(): AccessibilityKeyboardNavigationSnapshot
}

export const IAccessibilityKeyboardNavigationService = createDecorator<IAccessibilityKeyboardNavigationService>(
  "accessibilityKeyboardNavigationService",
)

interface MutableFocusScope {
  id: string
  label: string
  items: FocusScopeItem[]
  trapFocus: boolean
  orientation: FocusScopeOrientation
  activeItemId: string
}

const MAX_MESSAGE_LENGTH = 20000
const SCREEN_READER_STATUS_ID = "status.editor.screenReaderMode"
const SCREEN_READER_STATUS_COMMAND = "showEditorScreenReaderNotification"

export class AccessibilityKeyboardNavigationService implements IAccessibilityKeyboardNavigationService {
  declare readonly _serviceBrand: undefined

  private readonly listeners = new Set<(snapshot: AccessibilityKeyboardNavigationSnapshot) => void>()
  private readonly focusScopes = new Map<string, MutableFocusScope>()
  private readonly actions = new Map<string, AccessibilityActionRegistration>()
  private readonly evidenceActions: AccessibilityActionEvidence[] = []
  private readonly ariaProjection: {
    alertRegions: [AriaLiveRegionProjection, AriaLiveRegionProjection]
    statusRegions: [AriaLiveRegionProjection, AriaLiveRegionProjection]
  } = {
    alertRegions: [
      { id: "alert-1", role: "alert", ariaAtomic: true, text: "" },
      { id: "alert-2", role: "alert", ariaAtomic: true, text: "" },
    ],
    statusRegions: [
      { id: "status-1", ariaLive: "polite", ariaAtomic: true, text: "" },
      { id: "status-2", ariaLive: "polite", ariaAtomic: true, text: "" },
    ],
  }
  private accessibilitySupport = AccessibilitySupport.Unknown
  private configuration: Required<AccessibilityConfiguration> = {
    accessibilitySupport: "auto",
    reduceMotion: "auto",
    reduceTransparency: "auto",
  }
  private actionCounter = 0

  constructor(
    private readonly hooks: AccessibilityKeyboardNavigationRuntimeHooks = {},
    private readonly contextKeyService: IContextKeyService = globalContextKeyService,
  ) {
    this.syncContextKeys()
  }

  readonly onDidChangeScreenReaderOptimized = (listener: (snapshot: AccessibilityKeyboardNavigationSnapshot) => void): WorkbenchDisposable => {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  configure(configuration: AccessibilityConfiguration): void {
    const before = this.isScreenReaderOptimized()
    this.configuration = { ...this.configuration, ...configuration }
    this.syncContextKeys()
    this.emitScreenReaderChangeIfNeeded(before)
  }

  setAccessibilitySupport(accessibilitySupport: AccessibilitySupport, _reason?: string): void {
    const before = this.isScreenReaderOptimized()
    if (this.accessibilitySupport === accessibilitySupport) return
    this.accessibilitySupport = accessibilitySupport
    this.syncContextKeys()
    this.emitScreenReaderChangeIfNeeded(before)
  }

  getAccessibilitySupport(): AccessibilitySupport {
    return this.accessibilitySupport
  }

  isScreenReaderOptimized(): boolean {
    const config = this.configuration.accessibilitySupport
    return config === "on" || (config === "auto" && this.accessibilitySupport === AccessibilitySupport.Enabled)
  }

  getContextKeys(): AccessibilityContextKeys {
    const activeScope = this.getActiveFocusScope()
    const screenReaderOptimized = this.isScreenReaderOptimized()
    return {
      accessibilityModeEnabled: screenReaderOptimized,
      screenReaderOptimized,
      keyboardNavigationActive: Boolean(activeScope),
      activeFocusScope: activeScope?.id || "",
      activeFocusItem: activeScope?.activeItemId || "",
      reducedMotion: this.configuration.reduceMotion === "on",
      reducedTransparency: this.configuration.reduceTransparency === "on",
    }
  }

  alert(message: string): void {
    this.writeLiveRegion(this.ariaProjection.alertRegions, message)
  }

  status(message: string): void {
    this.writeLiveRegion(this.ariaProjection.statusRegions, message)
  }

  getAriaProjection(): AriaProjection {
    return {
      alertRegions: this.ariaProjection.alertRegions.map((region) => ({ ...region })),
      statusRegions: this.ariaProjection.statusRegions.map((region) => ({ ...region })),
    }
  }

  getStatusProjection(): AccessibilityStatusProjection {
    const visible = this.isScreenReaderOptimized()
    const text = visible ? "Screen Reader Optimized" : ""
    return {
      id: SCREEN_READER_STATUS_ID,
      visible,
      name: "Screen Reader Mode",
      text,
      ariaLabel: text,
      command: SCREEN_READER_STATUS_COMMAND,
      kind: "prominent",
      alignment: "right",
      priority: 100.6,
    }
  }

  registerFocusScope(scope: FocusScopeRegistration): WorkbenchDisposable {
    const items = scope.items.map((item) => ({ ...item }))
    const activeItemId = this.resolveInitialActiveItem(items, scope.activeItemId)
    const next: MutableFocusScope = {
      id: scope.id,
      label: scope.label,
      items,
      trapFocus: Boolean(scope.trapFocus),
      orientation: scope.orientation || "vertical",
      activeItemId,
    }
    this.focusScopes.set(scope.id, next)
    this.syncContextKeys()
    return {
      dispose: () => {
        this.focusScopes.delete(scope.id)
        this.syncContextKeys()
      },
    }
  }

  moveFocus(scopeId: string, direction: FocusDirection): string {
    const scope = this.focusScopes.get(scopeId)
    if (!scope) return ""
    const enabled = scope.items.filter((item) => !item.disabled)
    if (!enabled.length) {
      scope.activeItemId = ""
      this.syncContextKeys()
      return ""
    }

    const currentIndex = Math.max(0, enabled.findIndex((item) => item.id === scope.activeItemId))
    let nextIndex = currentIndex
    if (direction === "first") nextIndex = 0
    else if (direction === "last") nextIndex = enabled.length - 1
    else if (direction === "next") nextIndex = scope.trapFocus ? (currentIndex + 1) % enabled.length : Math.min(currentIndex + 1, enabled.length - 1)
    else nextIndex = scope.trapFocus ? (currentIndex - 1 + enabled.length) % enabled.length : Math.max(currentIndex - 1, 0)

    scope.activeItemId = enabled[nextIndex]?.id || ""
    this.syncContextKeys()
    return scope.activeItemId
  }

  getKeyboardNavigationModel(scopeId?: string): KeyboardNavigationModel | null {
    if (scopeId) return this.toKeyboardNavigationModel(this.focusScopes.get(scopeId))
    return this.toKeyboardNavigationModel(this.getActiveFocusScope())
  }

  registerAccessibilityAction(action: AccessibilityActionRegistration): WorkbenchDisposable {
    this.actions.set(action.id, { ...action })
    return {
      dispose: () => {
        this.actions.delete(action.id)
      },
    }
  }

  invokeAccessibilityAction(actionId: string, metadata: Record<string, unknown> = {}): boolean {
    const action = this.actions.get(actionId)
    if (!action) return false
    void action.run?.()
    this.evidenceActions.push({
      id: this.createId("action"),
      actionId: action.id,
      commandId: action.commandId,
      label: action.label,
      source: action.source || "",
      target: typeof metadata.target === "string" ? metadata.target : "",
      metadata: sanitizeEvidenceMetadata(metadata),
      createdAt: this.now(),
    })
    return true
  }

  getCommandAffordances(): CommandKeyboardAffordance[] {
    return [...this.actions.values()]
      .filter((action) => action.keybinding)
      .map((action) => ({
        commandId: action.commandId,
        label: action.label,
        keybinding: action.keybinding || "",
        ariaLabel: `${action.label}, ${action.keybinding}`,
        source: action.source || "",
      }))
  }

  getEvidenceActions(): AccessibilityActionEvidence[] {
    return this.evidenceActions.map((action) => ({
      ...action,
      metadata: { ...action.metadata },
    }))
  }

  getSnapshot(): AccessibilityKeyboardNavigationSnapshot {
    return {
      accessibilitySupport: this.accessibilitySupport,
      configuration: { ...this.configuration },
      screenReaderOptimized: this.isScreenReaderOptimized(),
      context: this.getContextKeys(),
      status: this.getStatusProjection(),
      aria: this.getAriaProjection(),
      keyboardNavigation: [...this.focusScopes.values()].map((scope) => this.toKeyboardNavigationModel(scope)).filter(isKeyboardNavigationModel),
      affordances: this.getCommandAffordances(),
      evidenceActions: this.getEvidenceActions(),
    }
  }

  private emitScreenReaderChangeIfNeeded(before: boolean): void {
    if (before === this.isScreenReaderOptimized()) return
    const snapshot = this.getSnapshot()
    this.listeners.forEach((listener) => listener(snapshot))
  }

  private writeLiveRegion(
    regions: [AriaLiveRegionProjection, AriaLiveRegionProjection],
    message: string,
  ): void {
    const text = String(message || "").slice(0, MAX_MESSAGE_LENGTH)
    const [first, second] = regions
    if (first.text !== text) {
      regions[1] = { ...second, text: "" }
      regions[0] = { ...first, text }
    } else {
      regions[0] = { ...first, text: "" }
      regions[1] = { ...second, text }
    }
  }

  private resolveInitialActiveItem(items: FocusScopeItem[], activeItemId: string | undefined): string {
    if (activeItemId && items.some((item) => item.id === activeItemId && !item.disabled)) return activeItemId
    return items.find((item) => !item.disabled)?.id || ""
  }

  private toKeyboardNavigationModel(scope: MutableFocusScope | undefined): KeyboardNavigationModel | null {
    if (!scope) return null
    return {
      id: scope.id,
      label: scope.label,
      orientation: scope.orientation,
      trapped: scope.trapFocus,
      activeItemId: scope.activeItemId,
      items: scope.items.map((item) => ({
        ...item,
        tabIndex: item.id === scope.activeItemId && !item.disabled ? 0 : -1,
        ariaSelected: item.id === scope.activeItemId && !item.disabled,
        ariaDisabled: Boolean(item.disabled),
      })),
    }
  }

  private getActiveFocusScope(): MutableFocusScope | undefined {
    return [...this.focusScopes.values()].find((scope) => scope.activeItemId)
  }

  private syncContextKeys(): void {
    const context = this.getContextKeys()
    const contextState: ContextKeyState = {
      accessibilityModeEnabled: context.accessibilityModeEnabled,
      screenReaderOptimized: context.screenReaderOptimized,
      keyboardNavigationActive: context.keyboardNavigationActive,
      activeFocusScope: context.activeFocusScope,
      activeFocusItem: context.activeFocusItem,
      reducedMotion: context.reducedMotion,
      reducedTransparency: context.reducedTransparency,
    }
    this.contextKeyService.updateContext(contextState)
  }

  private createId(prefix: string): string {
    const id = this.hooks.createId?.(prefix, this.actionCounter) || `${prefix}-${this.actionCounter}`
    this.actionCounter += 1
    return id
  }

  private now(): number {
    return this.hooks.now?.() ?? Date.now()
  }
}

function isKeyboardNavigationModel(model: KeyboardNavigationModel | null): model is KeyboardNavigationModel {
  return Boolean(model)
}

function sanitizeEvidenceMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase()
    if (lowerKey.includes("secret") || lowerKey.includes("token") || lowerKey.includes("password") || lowerKey.includes("path")) continue
    if (key === "target") continue
    safe[key] = value
  }
  return safe
}

export const globalAccessibilityKeyboardNavigationService = new AccessibilityKeyboardNavigationService()

registerSingleton(
  IAccessibilityKeyboardNavigationService,
  globalAccessibilityKeyboardNavigationService,
  InstantiationType.Delayed,
)
