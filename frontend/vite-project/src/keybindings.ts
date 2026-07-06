import type { ContextKeyState } from "./workbench/contextKeys"
import {
  CodekKeybindingResolver,
  CodekKeybindingResultKind,
  type CodekKeybindingRule,
} from "./vscode-adapter/platform/keybinding/common/keybindingResolver"
import { createDecorator } from "./vscode-adapter/platform/instantiation/common/instantiation"
import { InstantiationType, registerSingleton } from "./vscode-adapter/platform/instantiation/common/extensions"

const STORAGE_KEY = "codek-keybindings"

export interface Keybinding {
  id: string
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  action: () => void
  description: string
  sequence?: KeybindingStroke[]
  when?: string
  weight?: number
  weight2?: number
  isUser?: boolean
  commandId?: string
  commandArgs?: unknown[]
}

export interface KeybindingStroke {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
}

export interface KeybindingOverride extends KeybindingStroke {
  sequence?: KeybindingStroke[]
  when?: string
}

export interface KeybindingOverrideInput extends Partial<KeybindingStroke> {
  sequence?: KeybindingStroke[]
  when?: string
}

export interface KeybindingContribution {
  key?: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  sequence?: KeybindingStroke[]
  when?: string
  weight?: number
  weight2?: number
  commandArgs?: unknown[]
}

export interface IKeybindingService {
  readonly _serviceBrand: undefined
  registerKeybinding(binding: Keybinding): { dispose(): void }
  registerCommandKeybinding(commandId: string, contribution: KeybindingContribution): { dispose(): void }
  dispatch(event: KeyboardEvent): boolean
  getKeybindings(): Keybinding[]
  setContext(context: ContextKeyState): void
}

export const IKeybindingService = createDecorator<IKeybindingService>("keybindingService")

export interface KeybindingServiceOwnerEvidence {
  owner: "IKeybindingService/globalKeybindingService"
  stateSource: "keybindings.registry"
  connected: true
  noSecondStateSource: true
  readonlyEvidence: true
  writesUserKeybindingsFile: false
  registeredKeybindingIds: string[]
  commandKeybindingCommandIds: string[]
}

export interface KeybindingResolverOwnerEvidence {
  owner: "CodekKeybindingResolver"
  stateSource: "keybindings.registry -> CodekKeybindingResolver"
  connected: true
  supportsWhenClauses: true
  supportsWeights: true
  supportsUserOverrides: true
  readonlyEvidence: true
  ruleCount: number
  commandIds: string[]
}

export interface KeybindingCommandRoutingOwnerEvidence {
  owner: "ICommandService/globalCommandService"
  stateSource: "commandRegistry"
  connected: true
  sharedCommandRegistry: true
  readonlyEvidence: true
  routedCommandIds: string[]
}

export interface KeybindingRemainingUiOwnerGap {
  owner: "CommandPalette/F1 UI owner"
  state: "partial"
  connected: false
  blockedBy: "App.vue/generic workbench shell owns the physical palette ref"
  nextOwnerFiles: readonly ["App.vue", "components/CommandPalette.vue", "generic workbench shell"]
}

export interface KeybindingOwnerEvidenceSnapshot {
  stateSource: "keybindings.registry+commandRegistry"
  readonlyEvidence: true
  keybindingServiceOwner: KeybindingServiceOwnerEvidence
  resolverOwner: KeybindingResolverOwnerEvidence
  commandRoutingOwner: KeybindingCommandRoutingOwnerEvidence
  remainingUiOwnerGap: KeybindingRemainingUiOwnerGap
}

interface PersistedOverrides {
  [commandId: string]: KeybindingOverride
}

let registry: Keybinding[] = []
const defaultKeyMap = new Map<string, KeybindingOverride>()
const overrides = new Map<string, KeybindingOverride>()
let pendingChord: { stroke: KeybindingStroke; startedAt: number } | null = null
let keybindingContext: ContextKeyState = {}

const CHORD_TIMEOUT_MS = 3000

export function registerKeybinding(binding: Keybinding): void {
  unregisterKeybinding(binding.id)
  const defaultOverride = normalizeOverride({
    key: binding.key,
    ctrl: binding.ctrl,
    shift: binding.shift,
    alt: binding.alt,
    sequence: binding.sequence,
    when: binding.when,
  })
  defaultKeyMap.set(binding.id, defaultOverride)
  if (binding.commandId && binding.commandId !== binding.id) {
    defaultKeyMap.set(binding.commandId, defaultOverride)
  }
  const overridden = getOverrideForBinding(binding)
  if (overridden) {
    registry.push(applyOverride(binding, overridden))
  } else {
    registry.push(applyOverride(binding, defaultOverride))
  }
}

export function registerCommandKeybinding(commandId: string, contribution: KeybindingContribution): { dispose(): void } {
  const sequence = contribution.sequence?.length
    ? contribution.sequence
    : [{
      key: contribution.key ?? "",
      ctrl: !!contribution.ctrl,
      shift: !!contribution.shift,
      alt: !!contribution.alt,
    }]
  const primary = sequence[sequence.length - 1]
  const binding: Keybinding = {
    id: `command:${commandId}:${formatKeybinding({ ...primary, sequence })}`,
    commandId,
    key: primary.key,
    ctrl: primary.ctrl,
    shift: primary.shift,
    alt: primary.alt,
    sequence,
    when: contribution.when,
    weight: contribution.weight ?? 200,
    weight2: contribution.weight2 ?? 0,
    commandArgs: contribution.commandArgs,
    description: commandId,
    action: () => {
      void import("./workbench/commandRegistry")
        .then(({ executeCommand }) => executeCommand(commandId, contribution.commandArgs ?? [], keybindingContext))
    },
  }
  registerKeybinding(binding)
  return { dispose: () => unregisterKeybinding(binding.id) }
}

export function unregisterKeybinding(id: string): void {
  registry = registry.filter((kb) => kb.id !== id)
}

export function clearKeybindings(): void {
  registry = []
  defaultKeyMap.clear()
  pendingChord = null
  keybindingContext = {}
}

export function handleKeyEvent(event: KeyboardEvent): boolean {
  const stroke = eventToStroke(event)

  if (pendingChord && Date.now() - pendingChord.startedAt > CHORD_TIMEOUT_MS) {
    pendingChord = null
  }

  if (pendingChord) {
    const resolution = resolveKeybinding([pendingChord.stroke], stroke)
    pendingChord = null
    if (resolution.kind === CodekKeybindingResultKind.KbFound) {
      event.preventDefault()
      resolution.command.action()
      return true
    }
    return false
  }

  const resolution = resolveKeybinding([], stroke)
  if (resolution.kind === CodekKeybindingResultKind.MoreChordsNeeded) {
    event.preventDefault()
    pendingChord = { stroke, startedAt: Date.now() }
    return true
  }

  if (resolution.kind === CodekKeybindingResultKind.KbFound) {
    event.preventDefault()
    resolution.command.action()
    return true
  }

  return false
}

function resolveKeybinding(currentChords: KeybindingStroke[], stroke: KeybindingStroke) {
  return new CodekKeybindingResolver<Keybinding>(toKeybindingRules(registry)).resolve(keybindingContext, currentChords, stroke)
}

function toKeybindingRules(keybindings: Keybinding[]): CodekKeybindingRule<Keybinding>[] {
  return keybindings.map((binding) => ({
    command: binding,
    sequence: getSequence(binding),
    when: binding.when,
    weight: binding.weight,
    weight2: binding.weight2,
    isUser: binding.isUser,
  }))
}

export function getRegisteredKeybindings(): Keybinding[] {
  return [...registry]
}

export function getKeybindingOwnerEvidenceSnapshot(): KeybindingOwnerEvidenceSnapshot {
  const registeredKeybindingIds = registry.map((binding) => binding.id)
  const commandKeybindingCommandIds = uniqueSorted(registry
    .map((binding) => binding.commandId)
    .filter((commandId): commandId is string => !!commandId))
  const commandIds = uniqueSorted(registry.map((binding) => binding.commandId || binding.id))
  return {
    stateSource: "keybindings.registry+commandRegistry",
    readonlyEvidence: true,
    keybindingServiceOwner: {
      owner: "IKeybindingService/globalKeybindingService",
      stateSource: "keybindings.registry",
      connected: true,
      noSecondStateSource: true,
      readonlyEvidence: true,
      writesUserKeybindingsFile: false,
      registeredKeybindingIds,
      commandKeybindingCommandIds,
    },
    resolverOwner: {
      owner: "CodekKeybindingResolver",
      stateSource: "keybindings.registry -> CodekKeybindingResolver",
      connected: true,
      supportsWhenClauses: true,
      supportsWeights: true,
      supportsUserOverrides: true,
      readonlyEvidence: true,
      ruleCount: registry.length,
      commandIds,
    },
    commandRoutingOwner: {
      owner: "ICommandService/globalCommandService",
      stateSource: "commandRegistry",
      connected: true,
      sharedCommandRegistry: true,
      readonlyEvidence: true,
      routedCommandIds: commandKeybindingCommandIds,
    },
    remainingUiOwnerGap: {
      owner: "CommandPalette/F1 UI owner",
      state: "partial",
      connected: false,
      blockedBy: "App.vue/generic workbench shell owns the physical palette ref",
      nextOwnerFiles: ["App.vue", "components/CommandPalette.vue", "generic workbench shell"],
    },
  }
}

export function getDefaultKeybinding(commandId: string): KeybindingOverride | null {
  const binding = registry.find((kb) => isBindingForCommand(kb, commandId))
  return defaultKeyMap.get(commandId) ?? (binding ? defaultKeyMap.get(binding.id) : undefined) ?? null
}

export function getKeybindingForCommand(commandId: string): KeybindingOverride | null {
  const binding = registry.find((kb) => isBindingForCommand(kb, commandId))
  if (!binding) return null
  return normalizeOverride({
    key: binding.key,
    ctrl: binding.ctrl,
    shift: binding.shift,
    alt: binding.alt,
    sequence: binding.sequence,
    when: binding.when,
  })
}

export function overrideKeybinding(commandId: string, newKey: KeybindingOverrideInput): void {
  const normalized = normalizeOverride(newKey)
  overrides.set(commandId, normalized)
  const existing = registry.find((kb) => isBindingForCommand(kb, commandId))
  if (existing) {
    unregisterKeybinding(existing.id)
    registry.push(applyOverride(existing, normalized))
  }
  persistOverrides()
}

export function resetKeybinding(commandId: string): void {
  overrides.delete(commandId)
  const existing = registry.find((kb) => isBindingForCommand(kb, commandId))
  const defaultKey = defaultKeyMap.get(commandId)
  if (existing && defaultKey) {
    unregisterKeybinding(existing.id)
    registry.push(applyOverride(existing, defaultKey))
  }
  persistOverrides()
}

export function resetAllKeybindings(): void {
  overrides.clear()
  const bindingsToReset = [...registry]
  for (const binding of bindingsToReset) {
    const defaultKey = defaultKeyMap.get(binding.id)
    if (defaultKey) {
      unregisterKeybinding(binding.id)
      registry.push(applyOverride(binding, defaultKey))
    }
  }
  persistOverrides()
}

export function loadOverriddenKeybindings(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed: PersistedOverrides = JSON.parse(raw)
    for (const [commandId, override] of Object.entries(parsed)) {
      const normalized = normalizeOverride(override)
      overrides.set(commandId, normalized)
      const existing = registry.find((kb) => isBindingForCommand(kb, commandId))
      if (existing) {
        unregisterKeybinding(existing.id)
        registry.push(applyOverride(existing, normalized))
      }
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }
}

export function findConflictingKeybindings(
  commandId: string,
  newKey: KeybindingOverride,
): Keybinding[] {
  const nextSequence = getOverrideSequence(normalizeOverride(newKey))
  return new CodekKeybindingResolver<Keybinding>(toKeybindingRules(registry))
    .lookupBySequence(nextSequence)
    .map((rule) => rule.command)
    .filter((binding) => !isBindingForCommand(binding, commandId))
}

export function formatKeybinding(kb: KeybindingOverride): string {
  if (kb.sequence && kb.sequence.length > 0) {
    return kb.sequence.map(formatKeybinding).join(" ")
  }
  const parts: string[] = []
  if (kb.ctrl) parts.push("Ctrl")
  if (kb.shift) parts.push("Shift")
  if (kb.alt) parts.push("Alt")
  const keyDisplay = kb.key.length === 1 ? kb.key.toUpperCase() : kb.key
  parts.push(keyDisplay)
  return parts.join("+")
}

export function setKeybindingContext(nextContext: ContextKeyState): void {
  keybindingContext = { ...keybindingContext, ...nextContext }
}

export function getKeybindingContext(): ContextKeyState {
  return { ...keybindingContext }
}

function eventToStroke(event: KeyboardEvent): KeybindingStroke {
  return {
    key: event.key.toLowerCase(),
    ctrl: event.metaKey || event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  }
}

function getSequence(binding: Keybinding): KeybindingStroke[] {
  if (binding.sequence && binding.sequence.length > 0) return binding.sequence
  return [{ key: binding.key, ctrl: binding.ctrl, shift: binding.shift, alt: binding.alt }]
}

function getOverrideSequence(override: KeybindingOverride): KeybindingStroke[] {
  if (override.sequence && override.sequence.length > 0) return override.sequence
  return [{ key: override.key, ctrl: override.ctrl, shift: override.shift, alt: override.alt }]
}

function normalizeOverride(override: KeybindingOverrideInput): KeybindingOverride {
  const sequence = override.sequence?.map(normalizeStroke)
  const primary = sequence && sequence.length > 0 ? sequence[sequence.length - 1] : normalizeStroke({
    key: override.key ?? "",
    ctrl: !!override.ctrl,
    shift: !!override.shift,
    alt: !!override.alt,
  })
  return {
    key: primary.key,
    ctrl: primary.ctrl,
    shift: primary.shift,
    alt: primary.alt,
    ...(sequence && sequence.length > 0 ? { sequence } : {}),
    ...(override.when ? { when: override.when } : {}),
  }
}

function normalizeStroke(stroke: KeybindingStroke): KeybindingStroke {
  return {
    key: stroke.key.length === 1 ? stroke.key.toLowerCase() : stroke.key,
    ctrl: !!stroke.ctrl,
    shift: !!stroke.shift,
    alt: !!stroke.alt,
  }
}

function applyOverride(binding: Keybinding, override: KeybindingOverride): Keybinding {
  const normalized = normalizeOverride(override)
  return {
    ...binding,
    key: normalized.key,
    ctrl: normalized.ctrl,
    shift: normalized.shift,
    alt: normalized.alt,
    sequence: normalized.sequence,
    when: normalized.when,
    isUser: override !== defaultKeyMap.get(binding.id) && override !== (binding.commandId ? defaultKeyMap.get(binding.commandId) : undefined),
  }
}

function getOverrideForBinding(binding: Keybinding): KeybindingOverride | undefined {
  return overrides.get(binding.id) ?? (binding.commandId ? overrides.get(binding.commandId) : undefined)
}

function isBindingForCommand(binding: Keybinding, commandId: string): boolean {
  return binding.id === commandId || binding.commandId === commandId
}

function persistOverrides(): void {
  const obj: PersistedOverrides = {}
  for (const [commandId, override] of overrides.entries()) {
    obj[commandId] = override
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}

export class KeybindingService implements IKeybindingService {
  declare readonly _serviceBrand: undefined

  registerKeybinding(binding: Keybinding): { dispose(): void } {
    registerKeybinding(binding)
    return { dispose: () => unregisterKeybinding(binding.id) }
  }

  registerCommandKeybinding(commandId: string, contribution: KeybindingContribution): { dispose(): void } {
    return registerCommandKeybinding(commandId, contribution)
  }

  dispatch(event: KeyboardEvent): boolean {
    return handleKeyEvent(event)
  }

  getKeybindings(): Keybinding[] {
    return getRegisteredKeybindings()
  }

  setContext(context: ContextKeyState): void {
    setKeybindingContext(context)
  }
}

export const globalKeybindingService = new KeybindingService()
registerSingleton(IKeybindingService, globalKeybindingService, InstantiationType.Delayed)
