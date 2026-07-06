import { reactive } from "vue"
import { CancellationToken } from "../vscode-adapter/base/common/cancellation"
import { Emitter, type Event } from "../vscode-adapter/base/common/event"
import type { IDisposable } from "../vscode-adapter/base/common/lifecycle"
import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"
import { QuickWidget } from "../vscode-adapter/platform/quickinput/common/quickWidget"
import { globalContextKeyService, RawContextKey, type IContextKey, type IContextKeyService } from "./contextKeys"

export interface QuickPickItem<TValue = unknown> {
  id?: string
  label: string
  description?: string
  detail?: string
  value?: TValue
  type?: "item"
  disabled?: boolean
  picked?: boolean
  buttons?: QuickInputButton[]
}

export interface QuickPickSeparator {
  id?: string
  type: "separator"
  label?: string
  description?: string
  buttons?: QuickInputButton[]
}

export type QuickPickEntry<TValue = unknown> = QuickPickItem<TValue> | QuickPickSeparator
export type QuickInputSeverity = "ignore" | "info" | "warning" | "error"
export type QuickInputValidationResult =
  | string
  | null
  | undefined
  | { content: string; severity: QuickInputSeverity | 0 | 1 | 2 | 3 }

export interface QuickPickOptions {
  title?: string
  description?: string
  step?: number
  totalSteps?: number
  placeHolder?: string
  value?: string
  buttons?: QuickInputButton[]
  matchOnDescription?: boolean
  matchOnDetail?: boolean
  canPickMany?: boolean
  busy?: boolean
  enabled?: boolean
  ignoreFocusOut?: boolean
  validationMessage?: string
  severity?: QuickInputSeverity
  canAcceptInBackground?: boolean
  quickNavigate?: boolean | QuickNavigateConfiguration
  renderLimit?: number
  renderOverscan?: number
  rowHeight?: number
  viewportHeight?: number
}

export type QuickInputHideReason = "accept" | "cancel" | "blur" | "dispose"
export type QuickInputType = "quickPick" | "inputBox"

export interface QuickInputHideEvent {
  reason: QuickInputHideReason
}

export interface QuickInputButton {
  id?: string
  iconClass?: string
  tooltip?: string
  disabled?: boolean
}

export interface QuickNavigateConfiguration {
  keybindings?: readonly string[]
}

export interface InputBoxOptions {
  title?: string
  description?: string
  step?: number
  totalSteps?: number
  prompt?: string
  placeHolder?: string
  value?: string
  password?: boolean
  buttons?: QuickInputButton[]
  enabled?: boolean
  ignoreFocusOut?: boolean
  validationMessage?: string
  severity?: QuickInputSeverity
  validateInput?: (input: string) => Promise<QuickInputValidationResult> | QuickInputValidationResult
}

type QuickInputCancellation = CancellationToken | AbortSignal

export interface QuickPickRequest<TValue = unknown> {
  id: string
  type: "quickPick"
  items: QuickPickEntry<TValue>[]
  options: QuickPickOptions
  value: string
  activeItems?: QuickPickItem<TValue>[]
  selectedItems?: QuickPickItem<TValue>[]
  renderWindow?: { start: number; end: number }
  quickNavigateActive?: boolean
  resolve: (item: QuickPickItem<TValue> | QuickPickItem<TValue>[] | undefined) => void
  changeValue?: (value: string) => void
  acceptItem?: (item: QuickPickItem<TValue>) => boolean | void
  triggerButton?: (button: QuickInputButton) => void
  triggerItemButton?: (event: QuickPickItemButtonEvent<TValue>) => void
  triggerSeparatorButton?: (event: QuickPickSeparatorButtonEvent) => void
  willHide?: (event: QuickInputHideEvent) => void
  didHide?: (event: QuickInputHideEvent) => void
  dispose?: () => void
  cancellation?: IDisposable
  widget?: QuickPickWidgetLike<TValue>
  setActiveItems?: (items: QuickPickItem<TValue>[]) => void
  setSelectedItems?: (items: QuickPickItem<TValue>[]) => void
}

interface QuickPickWidgetLike<TValue = unknown> {
  readonly activeItems: QuickPickItem<TValue>[]
  readonly selectedItems: QuickPickItem<TValue>[]
  readonly renderWindow: { start: number; end: number }
  readonly scrollTop: number
  setActiveItems(items: readonly QuickPickItem<TValue>[]): void
  setSelectedItems(items: readonly QuickPickItem<TValue>[]): void
  setScrollTop(scrollTop: number): void
  setViewportHeight(viewportHeight: number | undefined): void
}

export interface QuickPickItemButtonEvent<TValue = unknown> {
  item: QuickPickItem<TValue>
  button: QuickInputButton
}

export interface QuickPickSeparatorButtonEvent {
  separator: QuickPickSeparator
  button: QuickInputButton
}

export interface QuickPickHandlers<TValue = unknown> {
  onDidTriggerItemButton?: (event: QuickPickItemButtonEvent<TValue>) => void
  onDidTriggerSeparatorButton?: (event: QuickPickSeparatorButtonEvent) => void
}

export interface QuickPickAcceptItemEvent<TValue = unknown> {
  item: QuickPickItem<TValue>
  preventDefault: () => void
}

export interface InputBoxRequest {
  id: string
  type: "inputBox"
  options: InputBoxOptions
  resolve: (value: string | undefined) => void
  triggerButton?: (button: QuickInputButton) => void
  willHide?: (event: QuickInputHideEvent) => void
  didHide?: (event: QuickInputHideEvent) => void
  dispose?: () => void
  cancellation?: IDisposable
  changeValue?: (value: string) => void
  validation?: LiveValidationState
}

interface LiveValidationState {
  generation: number
  timeout: ReturnType<typeof setTimeout> | undefined
  disposed: boolean
}

export const quickInputState = reactive<{
  queue: QuickPickRequest<unknown>[]
  inputQueue: InputBoxRequest[]
}>({
  queue: [],
  inputQueue: [],
})

export const quickInputContext = reactive<{
  inQuickInput: boolean
  quickInputType?: QuickInputType
  currentQuickInput?: { id: string; type: QuickInputType }
}>({
  inQuickInput: false,
})

export const inQuickInputContextKey = new RawContextKey<boolean>("inQuickInput", false)
export const quickInputVisibleContextKey = new RawContextKey<boolean>("quickInputVisible", false)
export const quickInputHasFocusContextKey = new RawContextKey<boolean>("quickInputHasFocus", false)
export const quickInputInputFocusContextKey = new RawContextKey<boolean>("quickInputInputFocus", false)
export const quickInputListFocusContextKey = new RawContextKey<boolean>("quickInputListFocus", false)
export const quickInputTypeContextKey = new RawContextKey<QuickInputType | undefined>("quickInputType", undefined)
export const currentQuickInputContextKey = new RawContextKey<string | undefined>("currentQuickInput", undefined)

interface QuickInputContextKeyBindings {
  inQuickInput: IContextKey<boolean>
  quickInputVisible: IContextKey<boolean>
  quickInputHasFocus: IContextKey<boolean>
  quickInputInputFocus: IContextKey<boolean>
  quickInputListFocus: IContextKey<boolean>
  quickInputType: IContextKey<QuickInputType | undefined>
  currentQuickInput: IContextKey<string | undefined>
}

const quickInputContextKeys = bindQuickInputContextKeys(globalContextKeyService)

interface QuickInputOwner {
  setCurrent(request: QuickPickRequest<unknown> | InputBoxRequest): void
  clearCurrent(request: QuickPickRequest<unknown> | InputBoxRequest): void
  setFocusTarget?(request: QuickPickRequest<unknown> | InputBoxRequest, target: QuickInputFocusTarget): void
}

export type QuickInputFocusTarget = "input" | "list" | "none"

export function pick<TValue = string>(
  items: QuickPickEntry<TValue>[],
  options: QuickPickOptions = {},
  handlers: QuickPickHandlers<TValue> = {},
  token?: CancellationToken,
): Promise<QuickPickItem<TValue> | QuickPickItem<TValue>[] | undefined> {
  return quickInputService.pick(items, options, handlers, token)
}

export function input(options: InputBoxOptions = {}, token?: CancellationToken): Promise<string | undefined> {
  return quickInputService.input(options, token)
}

export function acceptQuickPick<TValue = unknown>(id: string, item: QuickPickItem<TValue>): void {
  const existing = findQuickPick(id)
  if (existing?.acceptItem?.(item as QuickPickItem)) return
  existing?.setSelectedItems?.([item as QuickPickItem])
  const request = consumeQuickPick(id, "accept")
  request?.resolve(item as QuickPickItem)
}

export function acceptQuickPickMany<TValue = unknown>(id: string, items: QuickPickItem<TValue>[]): void {
  const request = consumeQuickPick(id, "accept")
  request?.resolve(items as QuickPickItem[])
}

export function triggerQuickPickItemButton<TValue = unknown>(
  id: string,
  item: QuickPickItem<TValue>,
  button: QuickInputButton,
): void {
  const request = quickInputState.queue.find((candidate) => candidate.id === id)
  const existing = request?.items.find((entry) => entry.type !== "separator" && itemKey(entry) === itemKey(item as QuickPickItem))
  if (!request || !existing || existing.type === "separator") return
  if (!existing.buttons?.some((candidate) => candidate.id === button.id && !candidate.disabled)) return
  request.triggerItemButton?.({ item: existing, button })
}

export function triggerQuickPickSeparatorButton(
  id: string,
  separator: QuickPickSeparator,
  button: QuickInputButton,
): void {
  const request = quickInputState.queue.find((candidate) => candidate.id === id)
  const existing = request?.items.find((entry) => entry.type === "separator" && sameSeparator(entry, separator))
  if (!request || !existing || existing.type !== "separator") return
  if (!existing.buttons?.some((candidate) => candidate.id === button.id && !candidate.disabled)) return
  request.triggerSeparatorButton?.({ separator: existing, button })
}

export function triggerQuickInputButton(id: string, button: QuickInputButton): void {
  const request = findQuickPick(id) || findInputBox(id)
  if (!request?.options.buttons?.some((candidate) => candidate.id === button.id)) return
  request?.triggerButton?.(button)
}

export function setQuickPickScrollState(id: string, scrollTop: number, viewportHeight?: number): void {
  const request = findQuickPick(id)
  if (!request?.widget) return
  request.widget.setViewportHeight(viewportHeight)
  request.widget.setScrollTop(scrollTop)
  request.renderWindow = request.widget.renderWindow
}

export function setQuickInputFocusTarget(id: string, target: QuickInputFocusTarget): void {
  const request = findQuickPick(id) || findInputBox(id)
  const owner = (request as (QuickPickRequest<unknown> | InputBoxRequest | undefined) & { owner?: QuickInputOwner })?.owner
  if (request && owner?.setFocusTarget) owner.setFocusTarget(request, target)
}

export function cancelQuickPick(id: string): void {
  const request = consumeQuickPick(id, "cancel")
  request?.resolve(undefined)
}

export function acceptInputBox(id: string, value: string): void | Promise<void> {
  const existing = findInputBox(id)
  if (!existing?.options.validateInput) {
    const request = consumeInputBox(id, "accept")
    request?.resolve(value)
    return
  }
  return validateInputBox(existing, value).then((valid) => {
    const current = findInputBox(id)
    if (current !== existing) return
    if (!valid) return
    const request = consumeInputBox(id, "accept")
    request?.resolve(value)
  })
}

export function cancelInputBox(id: string): void {
  const request = consumeInputBox(id, "cancel")
  request?.resolve(undefined)
}

export function hideQuickPick(id: string, reason: QuickInputHideReason = "cancel"): void {
  const request = consumeQuickPick(id, reason)
  request?.resolve(undefined)
}

export function hideInputBox(id: string, reason: QuickInputHideReason = "cancel"): void {
  const request = consumeInputBox(id, reason)
  request?.resolve(undefined)
}

export function clearQuickPicks(): void {
  while (quickInputState.queue.length) {
    const request = quickInputState.queue[0]
    consumeQuickPick(request.id, "dispose")
    request?.resolve(undefined)
  }
  while (quickInputState.inputQueue.length) {
    const request = quickInputState.inputQueue[0]
    consumeInputBox(request.id, "dispose")
    request?.resolve(undefined)
  }
  resetGlobalQuickInputContext()
}

export interface QuickPickController<TValue = unknown> {
  readonly id: string
  readonly activeItems: QuickPickItem<TValue>[]
  readonly selectedItems: QuickPickItem<TValue>[]
  readonly onWillHide: Event<QuickInputHideEvent>
  readonly onDidHide: Event<QuickInputHideEvent>
  readonly onDispose: Event<void>
  readonly onDidChangeValue: Event<string>
  readonly onDidChangeActive: Event<QuickPickItem<TValue>[]>
  readonly onDidChangeSelection: Event<QuickPickItem<TValue>[]>
  readonly onDidAcceptItem: Event<QuickPickAcceptItemEvent<TValue>>
  readonly onDidTriggerButton: Event<QuickInputButton>
  readonly quickNavigateActive: boolean
  show(): Promise<QuickPickItem<TValue> | QuickPickItem<TValue>[] | undefined>
  setItems(items: QuickPickEntry<TValue>[]): void
  setValue(value: string): void
  setBusy(busy: boolean): void
  setEnabled(enabled: boolean): void
  setValidationMessage(message: string | undefined, severity?: QuickInputSeverity): void
  setButtons(buttons: QuickInputButton[]): void
  setActiveItems(items: QuickPickItem<TValue>[]): void
  setSelectedItems(items: QuickPickItem<TValue>[]): void
  navigate(next: boolean, quickNavigate?: boolean | QuickNavigateConfiguration): void
  acceptQuickNavigate(): void
  hide(reason?: QuickInputHideReason): void
  dispose(): void
}

export interface InputBoxController {
  readonly id: string
  readonly onWillHide: Event<QuickInputHideEvent>
  readonly onDidHide: Event<QuickInputHideEvent>
  readonly onDispose: Event<void>
  readonly onDidTriggerButton: Event<QuickInputButton>
  show(): Promise<string | undefined>
  setValue(value: string): void
  setButtons(buttons: QuickInputButton[]): void
  hide(reason?: QuickInputHideReason): void
  dispose(): void
}

export interface QuickInputService {
  readonly _serviceBrand: undefined
  readonly currentQuickInput: { id: string; type: QuickInputType } | undefined
  createScoped(contextKeyService: IContextKeyService): QuickInputService
  pick<TValue = string>(
    items: QuickPickEntry<TValue>[],
    options?: QuickPickOptions,
    handlers?: QuickPickHandlers<TValue>,
    token?: QuickInputCancellation,
  ): Promise<QuickPickItem<TValue> | QuickPickItem<TValue>[] | undefined>
  showQuickPick<TValue = string>(
    items: QuickPickEntry<TValue>[],
    options?: QuickPickOptions,
    handlers?: QuickPickHandlers<TValue>,
    token?: QuickInputCancellation,
  ): Promise<QuickPickItem<TValue> | QuickPickItem<TValue>[] | undefined>
  input(options?: InputBoxOptions, token?: QuickInputCancellation): Promise<string | undefined>
  showInputBox(options?: InputBoxOptions, token?: QuickInputCancellation): Promise<string | undefined>
  createQuickPick<TValue = string>(
    items?: QuickPickEntry<TValue>[],
    options?: QuickPickOptions,
    handlers?: QuickPickHandlers<TValue>,
    token?: QuickInputCancellation,
  ): QuickPickController<TValue>
  createInputBox(options?: InputBoxOptions, token?: QuickInputCancellation): InputBoxController
}

export interface QuickInputOwnerEvidenceSnapshot {
  stateSource: "quickInputService.queue+QuickWidget"
  readonlyEvidence: true
  quickInputOwner: {
    owner: "IQuickInputService/WorkbenchQuickInputService"
    stateSource: "quickInputService.queue"
    connected: true
    noSecondStateSource: true
    readonlyEvidence: true
    writesUserSettingsFile: false
    currentQuickInput?: { id: string; type: QuickInputType }
    activeRequestIds: string[]
    inputRequestIds: string[]
  }
  quickWidgetOwner: {
    owner: "QuickWidget"
    stateSource: "QuickWidget.tree+options"
    connected: boolean
    readonlyEvidence: true
    activeItemLabels: string[]
    selectedItemLabels: string[]
    titlebarButtonIds: string[]
    itemButtonIds: string[]
    renderWindows: Array<{ id: string; start: number; end: number }>
  }
  remainingUiOwnerGap: {
    owner: "Workbench CommandPalette/F1 shell"
    state: "blocked"
    connected: false
    blockedBy: "App.vue/generic workbench shell owns the physical CommandPalette ref and F1 dialog placement"
    nextOwnerFiles: readonly ["App.vue", "components/CommandPalette.vue", "generic workbench shell"]
  }
}

class WorkbenchQuickInputService implements QuickInputService {
  declare readonly _serviceBrand: undefined

  private readonly contextKeys: QuickInputContextKeyBindings
  private currentInput: { id: string; type: QuickInputType } | undefined
  private readonly mirrorsGlobalContext: boolean

  constructor(private readonly contextKeyService: IContextKeyService = globalContextKeyService) {
    this.contextKeys = contextKeyService === globalContextKeyService
      ? quickInputContextKeys
      : bindQuickInputContextKeys(contextKeyService)
    this.mirrorsGlobalContext = contextKeyService === globalContextKeyService
  }

  get currentQuickInput(): { id: string; type: QuickInputType } | undefined {
    return this.currentInput
  }

  createScoped(contextKeyService: IContextKeyService): QuickInputService {
    return new WorkbenchQuickInputService(contextKeyService)
  }

  pick<TValue = string>(
    items: QuickPickEntry<TValue>[],
    options: QuickPickOptions = {},
    handlers: QuickPickHandlers<TValue> = {},
    token?: QuickInputCancellation,
  ): Promise<QuickPickItem<TValue> | QuickPickItem<TValue>[] | undefined> {
    return this.createQuickPick(items, options, handlers, token).show()
  }

  showQuickPick<TValue = string>(
    items: QuickPickEntry<TValue>[],
    options: QuickPickOptions = {},
    handlers: QuickPickHandlers<TValue> = {},
    token?: QuickInputCancellation,
  ): Promise<QuickPickItem<TValue> | QuickPickItem<TValue>[] | undefined> {
    return this.pick(items, options, handlers, token)
  }

  input(options: InputBoxOptions = {}, token?: QuickInputCancellation): Promise<string | undefined> {
    return this.createInputBox(options, token).show()
  }

  showInputBox(options: InputBoxOptions = {}, token?: QuickInputCancellation): Promise<string | undefined> {
    return this.input(options, token)
  }

  createQuickPick<TValue = string>(
    items: QuickPickEntry<TValue>[] = [],
    options: QuickPickOptions = {},
    handlers: QuickPickHandlers<TValue> = {},
    token?: QuickInputCancellation,
  ): QuickPickController<TValue> {
    return createQuickPickController(items, options, handlers, token, this)
  }

  createInputBox(options: InputBoxOptions = {}, token?: QuickInputCancellation): InputBoxController {
    return createInputBoxController(options, token, this)
  }

  setCurrent(request: QuickPickRequest<unknown> | InputBoxRequest): void {
    this.currentInput = { id: request.id, type: request.type }
    if (this.mirrorsGlobalContext) {
      quickInputContext.inQuickInput = true
      quickInputContext.quickInputType = request.type
      quickInputContext.currentQuickInput = { id: request.id, type: request.type }
    }
    this.contextKeys.inQuickInput.set(true)
    this.contextKeys.quickInputVisible.set(true)
    this.contextKeys.quickInputHasFocus.set(true)
    this.contextKeys.quickInputInputFocus.set(true)
    this.contextKeys.quickInputListFocus.set(false)
    this.contextKeys.quickInputType.set(request.type)
    this.contextKeys.currentQuickInput.set(request.id)
  }

  clearCurrent(request: QuickPickRequest<unknown> | InputBoxRequest): void {
    if (this.currentInput?.id !== request.id && findNextRequestForService(this)) return
    const next = findNextRequestForService(this)
    if (next) {
      this.setCurrent(next)
      return
    }
    this.currentInput = undefined
    if (this.mirrorsGlobalContext) {
      quickInputContext.inQuickInput = false
      quickInputContext.quickInputType = undefined
      quickInputContext.currentQuickInput = undefined
    }
    this.contextKeys.inQuickInput.reset()
    this.contextKeys.quickInputVisible.reset()
    this.contextKeys.quickInputHasFocus.reset()
    this.contextKeys.quickInputInputFocus.reset()
    this.contextKeys.quickInputListFocus.reset()
    this.contextKeys.quickInputType.reset()
    this.contextKeys.currentQuickInput.reset()
  }

  setFocusTarget(request: QuickPickRequest<unknown> | InputBoxRequest, target: QuickInputFocusTarget): void {
    if (this.currentInput?.id !== request.id) return
    const hasFocus = target !== "none"
    if (this.mirrorsGlobalContext) {
      quickInputContext.inQuickInput = hasFocus
    }
    this.contextKeys.inQuickInput.set(hasFocus)
    this.contextKeys.quickInputHasFocus.set(hasFocus)
    this.contextKeys.quickInputInputFocus.set(target === "input")
    this.contextKeys.quickInputListFocus.set(target === "list")
  }
}

export const IQuickInputService = createDecorator<QuickInputService>("quickInputService")
export const quickInputService: QuickInputService = new WorkbenchQuickInputService()
registerSingleton(IQuickInputService, quickInputService, InstantiationType.Delayed)

export function getQuickInputOwnerEvidenceSnapshot(): QuickInputOwnerEvidenceSnapshot {
  const quickPickRequests = [...quickInputState.queue]
  const inputRequests = [...quickInputState.inputQueue]
  const activeItemLabels = quickPickRequests.flatMap((request) => (request.activeItems || []).map((item) => item.label))
  const selectedItemLabels = quickPickRequests.flatMap((request) => (request.selectedItems || []).map((item) => item.label))
  const titlebarButtonIds = uniqueSorted(quickPickRequests
    .flatMap((request) => request.options.buttons || [])
    .map((button) => button.id)
    .filter((id): id is string => !!id))
  const itemButtonIds = uniqueSorted(quickPickRequests
    .flatMap((request) => request.items)
    .flatMap((entry) => entry.buttons || [])
    .map((button) => button.id)
    .filter((id): id is string => !!id))

  return {
    stateSource: "quickInputService.queue+QuickWidget",
    readonlyEvidence: true,
    quickInputOwner: {
      owner: "IQuickInputService/WorkbenchQuickInputService",
      stateSource: "quickInputService.queue",
      connected: true,
      noSecondStateSource: true,
      readonlyEvidence: true,
      writesUserSettingsFile: false,
      currentQuickInput: quickInputService.currentQuickInput,
      activeRequestIds: quickPickRequests.map((request) => request.id),
      inputRequestIds: inputRequests.map((request) => request.id),
    },
    quickWidgetOwner: {
      owner: "QuickWidget",
      stateSource: "QuickWidget.tree+options",
      connected: quickPickRequests.some((request) => !!request.widget),
      readonlyEvidence: true,
      activeItemLabels,
      selectedItemLabels,
      titlebarButtonIds,
      itemButtonIds,
      renderWindows: quickPickRequests
        .filter((request) => !!request.renderWindow)
        .map((request) => ({
          id: request.id,
          start: request.renderWindow?.start ?? 0,
          end: request.renderWindow?.end ?? 0,
        })),
    },
    remainingUiOwnerGap: {
      owner: "Workbench CommandPalette/F1 shell",
      state: "blocked",
      connected: false,
      blockedBy: "App.vue/generic workbench shell owns the physical CommandPalette ref and F1 dialog placement",
      nextOwnerFiles: ["App.vue", "components/CommandPalette.vue", "generic workbench shell"],
    },
  }
}

export function createQuickPickController<TValue = string>(
  items: QuickPickEntry<TValue>[],
  options: QuickPickOptions = {},
  handlers: QuickPickHandlers<TValue> = {},
  token?: QuickInputCancellation,
  owner: QuickInputOwner = quickInputService as unknown as QuickInputOwner,
): QuickPickController<TValue> {
  const id = `quick_pick_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const widget = new QuickWidget<QuickPickItem<TValue>, QuickPickEntry<TValue>, QuickInputButton>(items, options)
  const onWillHide = new Emitter<QuickInputHideEvent>()
  const onDidHide = new Emitter<QuickInputHideEvent>()
  const onDispose = new Emitter<void>()
  const onDidChangeValue = new Emitter<string>()
  const onDidChangeActive = new Emitter<QuickPickItem<TValue>[]>()
  const onDidChangeSelection = new Emitter<QuickPickItem<TValue>[]>()
  const onDidAcceptItem = new Emitter<QuickPickAcceptItemEvent<TValue>>()
  const onDidTriggerButton = new Emitter<QuickInputButton>()
  let quickNavigateActive = false
  const activeListener = widget.tree.onDidChangeActive((nextItems) => {
    const request = findQuickPick(id)
    if (request) {
      request.activeItems = nextItems as QuickPickItem<unknown>[]
      request.renderWindow = widget.renderWindow
    }
    onDidChangeActive.fire(nextItems)
  })
  const selectionListener = widget.tree.onDidChangeSelection((nextItems) => {
    const request = findQuickPick(id)
    if (request) request.selectedItems = nextItems as QuickPickItem<unknown>[]
    onDidChangeSelection.fire(nextItems)
  })
  let promise: Promise<QuickPickItem<TValue> | QuickPickItem<TValue>[] | undefined> | null = null
  let disposed = false
  return {
    id,
    get activeItems() {
      return widget.activeItems
    },
    get selectedItems() {
      return widget.selectedItems
    },
    get quickNavigateActive() {
      return quickNavigateActive
    },
    onWillHide: onWillHide.event,
    onDidHide: onDidHide.event,
    onDispose: onDispose.event,
    onDidChangeValue: onDidChangeValue.event,
    onDidChangeActive: onDidChangeActive.event,
    onDidChangeSelection: onDidChangeSelection.event,
    onDidAcceptItem: onDidAcceptItem.event,
    onDidTriggerButton: onDidTriggerButton.event,
    show() {
      if (promise) return promise
      promise = new Promise((resolve) => {
        const request: QuickPickRequest<unknown> = {
          id,
          type: "quickPick",
          items: widget.items as QuickPickEntry<unknown>[],
          options: widget.options as QuickPickOptions,
          value: widget.options.value || "",
          activeItems: widget.activeItems as QuickPickItem<unknown>[],
          selectedItems: widget.selectedItems as QuickPickItem<unknown>[],
          renderWindow: widget.renderWindow,
          quickNavigateActive,
          resolve: resolve as QuickPickRequest<unknown>["resolve"],
          changeValue: (value) => {
            request.value = value
            onDidChangeValue.fire(value)
          },
          acceptItem: (item) => {
            let intercepted = false
            onDidAcceptItem.fire({
              item: item as QuickPickItem<TValue>,
              preventDefault: () => {
                intercepted = true
              },
            })
            return intercepted
          },
          triggerButton: onDidTriggerButton.fire.bind(onDidTriggerButton),
          triggerItemButton: handlers.onDidTriggerItemButton as QuickPickRequest<unknown>["triggerItemButton"],
          triggerSeparatorButton: handlers.onDidTriggerSeparatorButton,
          willHide: onWillHide.fire.bind(onWillHide),
          didHide: onDidHide.fire.bind(onDidHide),
          widget: widget as QuickPickWidgetLike<unknown>,
          setActiveItems: (nextItems) => widget.setActiveItems(nextItems as QuickPickItem<TValue>[]),
          setSelectedItems: (nextItems) => widget.setSelectedItems(nextItems as QuickPickItem<TValue>[]),
          dispose: () => disposeEmitters(),
        }
        const cancellation = toQuickInputCancellationToken(token)
        if (cancellation.token?.isCancellationRequested) {
          resolve(undefined)
          cancellation.dispose()
          return
        }
        request.cancellation = cancellation.token?.onCancellationRequested(() => hideQuickPick(id, "cancel"))
        if (cancellation.dispose) {
          const requestCancellation = request.cancellation
          request.cancellation = {
            dispose: () => {
              requestCancellation?.dispose()
              cancellation.dispose?.()
            },
          }
        }
        ;(request as QuickPickRequest<unknown> & { owner?: QuickInputOwner }).owner = owner
        quickInputState.queue.push(request)
        owner.setCurrent(request)
      })
      return promise
    },
    setItems(nextItems: QuickPickEntry<TValue>[]) {
      widget.setItems(Array.isArray(nextItems) ? nextItems : [])
      const request = findQuickPick(id)
      if (request) request.items = widget.items as QuickPickEntry<unknown>[]
      else items = nextItems
    },
    setValue(value: string) {
      const nextValue = String(value ?? "")
      widget.setValue(nextValue)
      const request = findQuickPick(id)
      if (request) {
        request.value = nextValue
        request.changeValue?.(nextValue)
      } else {
        options.value = nextValue
        onDidChangeValue.fire(nextValue)
      }
    },
    setBusy(busy: boolean) {
      widget.setBusy(busy)
      const request = findQuickPick(id)
      if (request) request.options = { ...request.options, busy }
      else options.busy = busy
    },
    setEnabled(enabled: boolean) {
      widget.setEnabled(enabled)
      const request = findQuickPick(id)
      if (request) request.options = { ...request.options, enabled }
      else options.enabled = enabled
    },
    setValidationMessage(message: string | undefined, severity: QuickInputSeverity = "ignore") {
      widget.setValidationMessage(message, severity)
      const request = findQuickPick(id)
      if (request) {
        request.options = { ...request.options, validationMessage: message, severity }
      } else {
        options.validationMessage = message
        options.severity = severity
      }
    },
    setButtons(buttons: QuickInputButton[]) {
      const nextButtons = Array.isArray(buttons) ? buttons : []
      widget.setButtons(nextButtons)
      const request = findQuickPick(id)
      if (request) request.options = { ...request.options, buttons: nextButtons }
      else options.buttons = nextButtons
    },
    setActiveItems(nextItems: QuickPickItem<TValue>[]) {
      widget.setActiveItems(Array.isArray(nextItems) ? nextItems : [])
      const request = findQuickPick(id)
      if (request) {
        request.activeItems = widget.activeItems as QuickPickItem<unknown>[]
        request.renderWindow = widget.renderWindow
      }
    },
    setSelectedItems(nextItems: QuickPickItem<TValue>[]) {
      widget.setSelectedItems(Array.isArray(nextItems) ? nextItems : [])
    },
    navigate(next: boolean, quickNavigate?: boolean | QuickNavigateConfiguration) {
      const selectable = widget.items.filter((entry): entry is QuickPickItem<TValue> => entry.type !== "separator" && !entry.disabled)
      if (!selectable.length) return
      const current = widget.activeItems[0]
      const currentIndex = Math.max(0, current ? selectable.indexOf(current) : 0)
      const nextIndex = next
        ? Math.min(currentIndex + 1, selectable.length - 1)
        : Math.max(currentIndex - 1, 0)
      quickNavigateActive = Boolean(quickNavigate)
      const request = findQuickPick(id)
      if (request) request.quickNavigateActive = quickNavigateActive
      widget.setActiveItems([selectable[nextIndex]])
      if (request) {
        request.quickNavigateActive = quickNavigateActive
        request.activeItems = widget.activeItems as QuickPickItem<unknown>[]
        request.renderWindow = widget.renderWindow
      }
    },
    acceptQuickNavigate() {
      if (!quickNavigateActive) return
      const activeItem = widget.activeItems[0]
      quickNavigateActive = false
      const request = findQuickPick(id)
      if (request) request.quickNavigateActive = false
      if (activeItem) acceptQuickPick(id, activeItem)
    },
    hide(reason: QuickInputHideReason = "cancel") {
      quickNavigateActive = false
      const request = findQuickPick(id)
      if (request) request.quickNavigateActive = false
      hideQuickPick(id, reason)
    },
    dispose() {
      if (disposed) return
      disposed = true
      hideQuickPick(id, "dispose")
      onDispose.fire(undefined)
      disposeEmitters()
    },
  }

  function disposeEmitters(): void {
    activeListener.dispose()
    selectionListener.dispose()
    widget.dispose()
    onWillHide.dispose()
    onDidHide.dispose()
    onDispose.dispose()
    onDidChangeValue.dispose()
    onDidChangeActive.dispose()
    onDidChangeSelection.dispose()
    onDidAcceptItem.dispose()
    onDidTriggerButton.dispose()
  }
}

export function createInputBoxController(
  options: InputBoxOptions = {},
  token?: QuickInputCancellation,
  owner: QuickInputOwner = quickInputService as unknown as QuickInputOwner,
): InputBoxController {
  const id = `input_box_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const onWillHide = new Emitter<QuickInputHideEvent>()
  const onDidHide = new Emitter<QuickInputHideEvent>()
  const onDispose = new Emitter<void>()
  const onDidTriggerButton = new Emitter<QuickInputButton>()
  let promise: Promise<string | undefined> | null = null
  let disposed = false
  return {
    id,
    onWillHide: onWillHide.event,
    onDidHide: onDidHide.event,
    onDispose: onDispose.event,
    onDidTriggerButton: onDidTriggerButton.event,
    show() {
      if (promise) return promise
      promise = new Promise((resolve) => {
        const request: InputBoxRequest = {
          id,
          type: "inputBox",
          options,
          resolve,
          triggerButton: onDidTriggerButton.fire.bind(onDidTriggerButton),
          willHide: onWillHide.fire.bind(onWillHide),
          didHide: onDidHide.fire.bind(onDidHide),
          dispose: () => disposeEmitters(),
        }
        request.changeValue = (value) => {
          request.options.value = value
          scheduleInputValidation(request, value)
        }
        const cancellation = toQuickInputCancellationToken(token)
        if (cancellation.token?.isCancellationRequested) {
          resolve(undefined)
          cancellation.dispose()
          return
        }
        request.cancellation = cancellation.token?.onCancellationRequested(() => hideInputBox(id, "cancel"))
        if (cancellation.dispose) {
          const requestCancellation = request.cancellation
          request.cancellation = {
            dispose: () => {
              requestCancellation?.dispose()
              cancellation.dispose?.()
            },
          }
        }
        ;(request as InputBoxRequest & { owner?: QuickInputOwner }).owner = owner
        quickInputState.inputQueue.push(request)
        owner.setCurrent(request)
      })
      return promise
    },
    setValue(value: string) {
      const nextValue = String(value ?? "")
      const request = findInputBox(id)
      if (request) request.changeValue?.(nextValue)
      else options.value = nextValue
    },
    setButtons(buttons: QuickInputButton[]) {
      const nextButtons = Array.isArray(buttons) ? buttons : []
      const request = findInputBox(id)
      if (request) request.options.buttons = nextButtons
      else options.buttons = nextButtons
    },
    hide(reason: QuickInputHideReason = "cancel") {
      hideInputBox(id, reason)
    },
    dispose() {
      if (disposed) return
      disposed = true
      hideInputBox(id, "dispose")
      onDispose.fire(undefined)
      disposeEmitters()
    },
  }

  function disposeEmitters(): void {
    onWillHide.dispose()
    onDidHide.dispose()
    onDispose.dispose()
    onDidTriggerButton.dispose()
  }
}

function consumeQuickPick(id: string, reason: QuickInputHideReason): QuickPickRequest<unknown> | undefined {
  const index = quickInputState.queue.findIndex((request) => request.id === id)
  if (index < 0) return undefined
  const [request] = quickInputState.queue.splice(index, 1)
  fireHide(request, reason)
  return request
}

function findQuickPick(id: string): QuickPickRequest<unknown> | undefined {
  return quickInputState.queue.find((request) => request.id === id)
}

function findInputBox(id: string): InputBoxRequest | undefined {
  return quickInputState.inputQueue.find((request) => request.id === id)
}

async function validateInputBox(request: InputBoxRequest, value: string, generation?: number): Promise<boolean> {
  const validate = request.options.validateInput
  if (!validate) return true
  if (typeof generation === "number" && request.validation?.generation !== generation) return false
  const result = await validate(value)
  if (!isCurrentInputBoxRequest(request)) return false
  if (typeof generation === "number" && request.validation?.generation !== generation) return false
  const normalized = normalizeValidationResult(result)
  request.options.validationMessage = normalized.message
  request.options.severity = normalized.severity
  return normalized.severity !== "error"
}

function scheduleInputValidation(request: InputBoxRequest, value: string): void {
  if (!request.options.validateInput) return
  const validation = request.validation ??= {
    generation: 0,
    timeout: undefined,
    disposed: false,
  }
  validation.generation += 1
  const generation = validation.generation
  if (validation.timeout) clearTimeout(validation.timeout)
  validation.timeout = setTimeout(() => {
    validation.timeout = undefined
    if (validation.disposed || validation.generation !== generation || !isCurrentInputBoxRequest(request)) return
    void validateInputBox(request, value, generation)
  }, 300)
}

function cancelInputValidation(request: InputBoxRequest): void {
  const validation = request.validation
  if (!validation) return
  validation.disposed = true
  validation.generation += 1
  if (validation.timeout) {
    clearTimeout(validation.timeout)
    validation.timeout = undefined
  }
}

function isCurrentInputBoxRequest(request: InputBoxRequest): boolean {
  return findInputBox(request.id)?.id === request.id
}

function normalizeValidationResult(result: QuickInputValidationResult): { message?: string; severity: QuickInputSeverity } {
  if (!result) return { severity: "ignore" }
  if (typeof result === "string") return { message: result, severity: "error" }
  return {
    message: result.content,
    severity: normalizeSeverity(result.severity),
  }
}

function normalizeSeverity(severity: QuickInputSeverity | 0 | 1 | 2 | 3): QuickInputSeverity {
  if (severity === 3 || severity === "error") return "error"
  if (severity === 2 || severity === "warning") return "warning"
  if (severity === 1 || severity === "info") return "info"
  return "ignore"
}

function consumeInputBox(id: string, reason: QuickInputHideReason): InputBoxRequest | undefined {
  const index = quickInputState.inputQueue.findIndex((request) => request.id === id)
  if (index < 0) return undefined
  const [request] = quickInputState.inputQueue.splice(index, 1)
  fireHide(request, reason)
  return request
}

function fireHide(request: QuickPickRequest<unknown> | InputBoxRequest, reason: QuickInputHideReason): void {
  request.cancellation?.dispose()
  if (request.type === "inputBox") cancelInputValidation(request)
  const event = { reason }
  request.willHide?.(event)
  const owner = (request as (QuickPickRequest<unknown> | InputBoxRequest) & { owner?: QuickInputOwner }).owner
  owner?.clearCurrent(request)
  if (request.type === "quickPick") {
    request.quickNavigateActive = false
    request.options = { ...request.options, busy: false, validationMessage: undefined, severity: "ignore" }
  } else {
    request.options.validationMessage = undefined
    request.options.severity = "ignore"
  }
  request.didHide?.(event)
}

function bindQuickInputContextKeys(contextKeyService: IContextKeyService): QuickInputContextKeyBindings {
  return {
    inQuickInput: inQuickInputContextKey.bindTo(contextKeyService),
    quickInputVisible: quickInputVisibleContextKey.bindTo(contextKeyService),
    quickInputHasFocus: quickInputHasFocusContextKey.bindTo(contextKeyService),
    quickInputInputFocus: quickInputInputFocusContextKey.bindTo(contextKeyService),
    quickInputListFocus: quickInputListFocusContextKey.bindTo(contextKeyService),
    quickInputType: quickInputTypeContextKey.bindTo(contextKeyService),
    currentQuickInput: currentQuickInputContextKey.bindTo(contextKeyService),
  }
}

function toQuickInputCancellationToken(token: QuickInputCancellation | undefined): {
  token?: CancellationToken
  dispose?: () => void
} {
  if (!token) return {}
  if (isCancellationToken(token)) return { token }
  if (token.aborted) return { token: CancellationToken.Cancelled }
  const source = {
    isCancellationRequested: token.aborted,
    onCancellationRequested(listener: () => unknown) {
      const abortListener = () => listener()
      token.addEventListener("abort", abortListener, { once: true })
      return { dispose: () => token.removeEventListener("abort", abortListener) }
    },
  } satisfies CancellationToken
  return { token: source }
}

function isCancellationToken(token: QuickInputCancellation): token is CancellationToken {
  return typeof (token as CancellationToken).onCancellationRequested === "function"
}

function resetGlobalQuickInputContext(): void {
  ;(quickInputService as unknown as { currentInput?: { id: string; type: QuickInputType } }).currentInput = undefined
  quickInputContext.inQuickInput = false
  quickInputContext.quickInputType = undefined
  quickInputContext.currentQuickInput = undefined
  quickInputContextKeys.inQuickInput.reset()
  quickInputContextKeys.quickInputVisible.reset()
  quickInputContextKeys.quickInputHasFocus.reset()
  quickInputContextKeys.quickInputInputFocus.reset()
  quickInputContextKeys.quickInputListFocus.reset()
  quickInputContextKeys.quickInputType.reset()
  quickInputContextKeys.currentQuickInput.reset()
}

function findNextRequestForService(owner: QuickInputOwner): QuickPickRequest<unknown> | InputBoxRequest | undefined {
  return [...quickInputState.queue, ...quickInputState.inputQueue]
    .find((request) => ((request as QuickPickRequest<unknown> & { owner?: QuickInputOwner }).owner) === owner)
}

function sameSeparator(left: QuickPickSeparator, right: QuickPickSeparator): boolean {
  if (left === right) return true
  return Boolean(left.id && left.id === right.id)
    || (left.label === right.label && left.description === right.description)
}

function itemKey(entry: QuickPickItem): string {
  return `${entry.type || "item"}:${entry.id || entry.label}:${entry.description || ""}`
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}
