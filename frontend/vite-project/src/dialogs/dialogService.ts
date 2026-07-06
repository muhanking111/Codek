import { InstantiationType, registerSingleton } from "../vscode-adapter/platform/instantiation/common/extensions"
import { createDecorator } from "../vscode-adapter/platform/instantiation/common/instantiation"

export type CodekDialogKind = "confirm" | "prompt" | "input"
export type CodekDialogType = "none" | "info" | "error" | "question" | "warning"
export type CodekDialogOutcome = "confirmed" | "cancelled"

export interface CodekDialogDisposable {
  dispose(): void
}

export interface CodekDialogCheckbox {
  readonly label: string
  readonly checked?: boolean
}

export interface CodekDialogEvidenceContext {
  readonly operationId?: string
  readonly workspaceFolder?: string
  readonly resource?: string
  readonly commandId?: string
}

export interface CodekDialogBaseOptions {
  readonly type?: CodekDialogType
  readonly title?: string
  readonly message: string
  readonly detail?: string
  readonly checkbox?: CodekDialogCheckbox
  readonly source?: string
  readonly evidenceContext?: CodekDialogEvidenceContext
}

export interface CodekConfirmOptions extends CodekDialogBaseOptions {
  readonly primaryButton?: string
  readonly cancelButton?: string
}

export interface CodekConfirmResult {
  readonly confirmed: boolean
  readonly checkboxChecked?: boolean
}

export interface CodekInputElement {
  readonly type?: "text" | "password"
  readonly value?: string
  readonly placeholder?: string
}

export interface CodekInputOptions extends CodekConfirmOptions {
  readonly inputs: readonly CodekInputElement[]
}

export interface CodekInputResult extends CodekConfirmResult {
  readonly values?: string[]
}

export interface CodekPromptButton<T> {
  readonly label: string
  run(checkbox: CodekDialogCheckboxResult): T | Promise<T>
}

export interface CodekPromptCancelButton<T> {
  readonly label?: string
  run(checkbox: CodekDialogCheckboxResult): T | Promise<T>
}

export interface CodekPromptOptions<T> extends CodekDialogBaseOptions {
  readonly buttons?: readonly CodekPromptButton<T>[]
  readonly cancelButton?: CodekPromptCancelButton<T> | true | string
}

export interface CodekDialogCheckboxResult {
  readonly checkboxChecked?: boolean
}

export interface CodekPromptResult<T> extends CodekDialogCheckboxResult {
  readonly result?: T
}

export interface CodekDialogButtonProjection {
  readonly index: number
  readonly label: string
  readonly isCancel: boolean
}

export interface CodekDialogRequest {
  readonly id: string
  readonly kind: CodekDialogKind
  readonly modal: true
  readonly type: CodekDialogType
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly source: string
  readonly checkbox?: CodekDialogCheckbox
  readonly inputs?: readonly CodekInputElement[]
  readonly buttons: readonly CodekDialogButtonProjection[]
  readonly evidenceContext?: CodekDialogEvidenceContext
}

export interface CodekDialogResolveChoice {
  readonly buttonIndex: number
  readonly checkboxChecked?: boolean
  readonly values?: readonly string[]
}

export interface CodekDialogDecisionProjection {
  readonly id: string
  readonly kind: CodekDialogKind
  readonly outcome: CodekDialogOutcome
  readonly buttonIndex: number
  readonly buttonLabel: string
  readonly checkboxChecked?: boolean
  readonly inputCount?: number
  readonly valuesRedacted?: boolean
  readonly source: string
  readonly timestamp: number
  readonly evidenceContext?: {
    readonly operationId?: string
    readonly workspaceFolder?: string
    readonly resourceKind?: "file" | "folder" | "unknown"
    readonly commandId?: string
  }
}

export interface ICodekDialogService {
  readonly _serviceBrand: undefined
  confirm(options: CodekConfirmOptions): Promise<CodekConfirmResult>
  prompt<T>(options: CodekPromptOptions<T>): Promise<CodekPromptResult<T>>
  input(options: CodekInputOptions): Promise<CodekInputResult>
  getActiveDialog(): CodekDialogRequest | undefined
  getDialogQueue(): CodekDialogRequest[]
  getDecisionProjections(): CodekDialogDecisionProjection[]
  resolveActiveDialog(choice: CodekDialogResolveChoice): boolean
  onWillShowDialog(listener: (request: CodekDialogRequest) => void): CodekDialogDisposable
  onDidShowDialog(listener: (decision: CodekDialogDecisionProjection) => void): CodekDialogDisposable
}

interface RuntimeHooks {
  now?: () => number
  createId?: (prefix: string) => string
}

interface PendingDialog<T> {
  readonly request: CodekDialogRequest
  readonly options: CodekConfirmOptions | CodekInputOptions | CodekPromptOptions<T>
  resolve(value: T): void
}

export const ICodekDialogService = createDecorator<ICodekDialogService>("dialogService")
export const IDialogService = ICodekDialogService

export class CodekDialogService implements ICodekDialogService {
  declare readonly _serviceBrand: undefined

  private readonly willShowListeners = new Set<(request: CodekDialogRequest) => void>()
  private readonly didShowListeners = new Set<(decision: CodekDialogDecisionProjection) => void>()
  private readonly queue: PendingDialog<unknown>[] = []
  private readonly decisions: CodekDialogDecisionProjection[] = []
  private active: PendingDialog<unknown> | undefined

  constructor(private readonly hooks: RuntimeHooks = {}) {}

  confirm(options: CodekConfirmOptions): Promise<CodekConfirmResult> {
    return this.enqueue<CodekConfirmResult>("confirm", options)
  }

  prompt<T>(options: CodekPromptOptions<T>): Promise<CodekPromptResult<T>> {
    return this.enqueue<CodekPromptResult<T>>("prompt", options)
  }

  input(options: CodekInputOptions): Promise<CodekInputResult> {
    return this.enqueue<CodekInputResult>("input", options)
  }

  getActiveDialog(): CodekDialogRequest | undefined {
    return this.active ? cloneDialogRequest(this.active.request) : undefined
  }

  getDialogQueue(): CodekDialogRequest[] {
    const pending = this.active ? [this.active, ...this.queue] : [...this.queue]
    return pending.map((entry) => cloneDialogRequest(entry.request))
  }

  getDecisionProjections(): CodekDialogDecisionProjection[] {
    return this.decisions.map((decision) => ({ ...decision, evidenceContext: decision.evidenceContext ? { ...decision.evidenceContext } : undefined }))
  }

  resolveActiveDialog(choice: CodekDialogResolveChoice): boolean {
    const pending = this.active
    if (!pending) return false

    const button = pending.request.buttons[choice.buttonIndex] || pending.request.buttons[pending.request.buttons.length - 1]
    const outcome: CodekDialogOutcome = button?.isCancel ? "cancelled" : "confirmed"
    const checkboxChecked = choice.checkboxChecked ?? pending.request.checkbox?.checked
    const decision = this.toDecisionProjection(pending.request, choice, button, outcome, checkboxChecked)
    this.decisions.push(decision)
    this.active = undefined

    pending.resolve(this.toResult(pending, choice, outcome, checkboxChecked) as unknown)
    this.didShowListeners.forEach((listener) => listener({ ...decision, evidenceContext: decision.evidenceContext ? { ...decision.evidenceContext } : undefined }))
    this.showNext()
    return true
  }

  onWillShowDialog(listener: (request: CodekDialogRequest) => void): CodekDialogDisposable {
    this.willShowListeners.add(listener)
    return { dispose: () => this.willShowListeners.delete(listener) }
  }

  onDidShowDialog(listener: (decision: CodekDialogDecisionProjection) => void): CodekDialogDisposable {
    this.didShowListeners.add(listener)
    return { dispose: () => this.didShowListeners.delete(listener) }
  }

  private enqueue<T>(kind: CodekDialogKind, options: CodekConfirmOptions | CodekInputOptions | CodekPromptOptions<unknown>): Promise<T> {
    const request = this.toRequest(kind, options)
    return new Promise<T>((resolve) => {
      this.queue.push({ request, options, resolve: resolve as (value: unknown) => void })
      this.showNext()
    })
  }

  private showNext(): void {
    if (this.active || this.queue.length === 0) return
    this.active = this.queue.shift()
    if (!this.active) return
    const request = cloneDialogRequest(this.active.request)
    this.willShowListeners.forEach((listener) => listener(request))
  }

  private toRequest(kind: CodekDialogKind, options: CodekConfirmOptions | CodekInputOptions | CodekPromptOptions<unknown>): CodekDialogRequest {
    return {
      id: this.createId("dialog"),
      kind,
      modal: true,
      type: options.type || "none",
      title: options.title || "",
      message: options.message,
      detail: options.detail || "",
      source: options.source || "",
      checkbox: options.checkbox ? { ...options.checkbox } : undefined,
      inputs: kind === "input" ? [...((options as CodekInputOptions).inputs || [])].map((input) => ({ ...input })) : undefined,
      buttons: this.toButtons(kind, options),
      evidenceContext: options.evidenceContext ? { ...options.evidenceContext } : undefined,
    }
  }

  private toButtons(kind: CodekDialogKind, options: CodekConfirmOptions | CodekInputOptions | CodekPromptOptions<unknown>): CodekDialogButtonProjection[] {
    if (kind === "prompt") {
      const prompt = options as CodekPromptOptions<unknown>
      const buttons = (prompt.buttons || []).map((button, index) => ({ index, label: button.label, isCancel: false }))
      if (prompt.cancelButton) {
        const label = prompt.cancelButton === true ? "Cancel" : typeof prompt.cancelButton === "string" ? prompt.cancelButton : prompt.cancelButton.label || "Cancel"
        buttons.push({ index: buttons.length, label, isCancel: true })
      }
      return buttons.length > 0 ? buttons : [{ index: 0, label: "OK", isCancel: false }]
    }

    const confirmation = options as CodekConfirmOptions
    return [
      { index: 0, label: confirmation.primaryButton || "Yes", isCancel: false },
      { index: 1, label: confirmation.cancelButton || "Cancel", isCancel: true },
    ]
  }

  private toResult(
    pending: PendingDialog<unknown>,
    choice: CodekDialogResolveChoice,
    outcome: CodekDialogOutcome,
    checkboxChecked: boolean | undefined,
  ): CodekConfirmResult | CodekInputResult | CodekPromptResult<unknown> {
    if (pending.request.kind === "input") {
      return {
        confirmed: outcome === "confirmed",
        checkboxChecked,
        values: outcome === "confirmed" ? [...(choice.values || [])] : undefined,
      }
    }

    if (pending.request.kind === "prompt") {
      const prompt = pending.options as CodekPromptOptions<unknown>
      const button = prompt.buttons?.[choice.buttonIndex]
      const cancel = prompt.cancelButton && typeof prompt.cancelButton === "object" ? prompt.cancelButton : undefined
      const result = outcome === "confirmed"
        ? button?.run({ checkboxChecked })
        : cancel?.run({ checkboxChecked })
      return { result, checkboxChecked }
    }

    return { confirmed: outcome === "confirmed", checkboxChecked }
  }

  private toDecisionProjection(
    request: CodekDialogRequest,
    choice: CodekDialogResolveChoice,
    button: CodekDialogButtonProjection | undefined,
    outcome: CodekDialogOutcome,
    checkboxChecked: boolean | undefined,
  ): CodekDialogDecisionProjection {
    const inputCount = request.kind === "input" ? request.inputs?.length || 0 : undefined
    return {
      id: request.id,
      kind: request.kind,
      outcome,
      buttonIndex: choice.buttonIndex,
      buttonLabel: button?.label || "",
      checkboxChecked,
      inputCount,
      valuesRedacted: inputCount ? true : undefined,
      source: request.source,
      timestamp: this.now(),
      evidenceContext: sanitizeEvidenceContext(request.evidenceContext),
    }
  }

  private now(): number {
    return this.hooks.now?.() ?? Date.now()
  }

  private createId(prefix: string): string {
    return this.hooks.createId?.(prefix) ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  }
}

function cloneDialogRequest(request: CodekDialogRequest): CodekDialogRequest {
  return {
    ...request,
    checkbox: request.checkbox ? { ...request.checkbox } : undefined,
    inputs: request.inputs?.map((input) => ({ ...input })),
    buttons: request.buttons.map((button) => ({ ...button })),
    evidenceContext: request.evidenceContext ? { ...request.evidenceContext } : undefined,
  }
}

function sanitizeEvidenceContext(context: CodekDialogEvidenceContext | undefined): CodekDialogDecisionProjection["evidenceContext"] {
  if (!context) return undefined
  return {
    operationId: context.operationId,
    workspaceFolder: context.workspaceFolder,
    resourceKind: context.resource ? resourceKindFromPath(context.resource) : undefined,
    commandId: context.commandId,
  }
}

function resourceKindFromPath(resource: string): "file" | "folder" | "unknown" {
  const normalized = resource.replace(/\\/g, "/")
  const name = normalized.split("/").filter(Boolean).pop() || ""
  if (!name) return "unknown"
  return name.includes(".") ? "file" : "folder"
}

export const globalCodekDialogService = new CodekDialogService()

registerSingleton(ICodekDialogService, globalCodekDialogService, InstantiationType.Delayed)
