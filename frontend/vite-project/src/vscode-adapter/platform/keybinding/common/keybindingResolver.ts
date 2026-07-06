import { evaluateWhenClause, type ContextKeyState } from "../../../../workbench/contextKeys"

// VS Code source adapter.
// Source reference: D:\SourceMirror\vscode\src\vs\platform\keybinding\common\keybindingResolver.ts
//
// VS Code's full KeybindingResolver depends on ResolvedKeybindingItem,
// ContextKeyExpression and platform scan-code services. Codek keeps its
// registration and localized command APIs, but uses this adapter for the core
// resolver semantics: first-chord lookup, later rules winning, `when` filtering,
// and returning MoreChordsNeeded only after the best matching rule is known.

export const enum CodekKeybindingResultKind {
  NoMatchingKb,
  MoreChordsNeeded,
  KbFound,
}

export type CodekKeybindingResolution<TCommand> =
  | { kind: CodekKeybindingResultKind.NoMatchingKb }
  | { kind: CodekKeybindingResultKind.MoreChordsNeeded }
  | { kind: CodekKeybindingResultKind.KbFound; command: TCommand }

export interface CodekKeybindingStroke {
  key: string
  ctrl: boolean
  shift: boolean
  alt: boolean
}

export interface CodekKeybindingRule<TCommand> {
  command: TCommand
  sequence: CodekKeybindingStroke[]
  when?: string
  weight?: number
  weight2?: number
  isUser?: boolean
}

export const CodekNoMatchingKeybinding: CodekKeybindingResolution<never> = {
  kind: CodekKeybindingResultKind.NoMatchingKb,
}

export const CodekMoreChordsNeeded: CodekKeybindingResolution<never> = {
  kind: CodekKeybindingResultKind.MoreChordsNeeded,
}

export class CodekKeybindingResolver<TCommand> {
  private readonly map = new Map<string, CodekKeybindingRule<TCommand>[]>()
  private readonly rules: CodekKeybindingRule<TCommand>[]

  constructor(rules: CodekKeybindingRule<TCommand>[]) {
    this.rules = normalizeRuleOrder(rules)
    for (const rule of this.rules) {
      if (rule.sequence.length === 0) continue
      const firstChord = toKeypress(rule.sequence[0])
      const existing = this.map.get(firstChord)
      if (existing) existing.push(rule)
      else this.map.set(firstChord, [rule])
    }
  }

  resolve(
    context: ContextKeyState,
    currentChords: CodekKeybindingStroke[],
    keypress: CodekKeybindingStroke,
  ): CodekKeybindingResolution<TCommand> {
    const pressedChords = [...currentChords, keypress]
    const candidates = this.map.get(toKeypress(pressedChords[0]))
    if (!candidates) return CodekNoMatchingKeybinding

    const lookup = pressedChords.length < 2
      ? candidates
      : candidates.filter((candidate) => isCandidatePrefixMatch(candidate.sequence, pressedChords))

    const match = findLastMatchingWhen(lookup, context)
    if (!match) return CodekNoMatchingKeybinding
    if (pressedChords.length < match.sequence.length) return CodekMoreChordsNeeded
    return { kind: CodekKeybindingResultKind.KbFound, command: match.command }
  }

  lookupBySequence(sequence: CodekKeybindingStroke[]): CodekKeybindingRule<TCommand>[] {
    const normalized = sequence.map(toKeypress)
    const result: CodekKeybindingRule<TCommand>[] = []
    for (const rule of this.rules) {
      if (rule.sequence.length !== normalized.length) continue
      if (rule.sequence.every((stroke, index) => toKeypress(stroke) === normalized[index])) result.push(rule)
    }
    return result.reverse()
  }
}

export function toKeypress(stroke: CodekKeybindingStroke): string {
  const parts: string[] = []
  if (stroke.ctrl) parts.push("ctrl")
  if (stroke.shift) parts.push("shift")
  if (stroke.alt) parts.push("alt")
  parts.push(normalizeKey(stroke.key))
  return parts.join("+")
}

function isCandidatePrefixMatch(sequence: CodekKeybindingStroke[], pressedChords: CodekKeybindingStroke[]): boolean {
  if (pressedChords.length > sequence.length) return false
  for (let index = 1; index < pressedChords.length; index += 1) {
    if (toKeypress(sequence[index]) !== toKeypress(pressedChords[index])) return false
  }
  return true
}

function findLastMatchingWhen<TCommand>(
  candidates: CodekKeybindingRule<TCommand>[],
  context: ContextKeyState,
): CodekKeybindingRule<TCommand> | null {
  const ordered = normalizeRuleOrder(candidates)
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const candidate = ordered[index]
    if (evaluateWhenClause(candidate.when, context)) return candidate
  }
  return null
}

function normalizeRuleOrder<TCommand>(rules: CodekKeybindingRule<TCommand>[]): CodekKeybindingRule<TCommand>[] {
  return rules
    .map((rule, index) => ({ rule, index }))
    .sort((left, right) => {
      const weight = (left.rule.weight ?? 0) - (right.rule.weight ?? 0)
      if (weight !== 0) return weight
      const weight2 = (left.rule.weight2 ?? 0) - (right.rule.weight2 ?? 0)
      if (weight2 !== 0) return weight2
      const user = Number(left.rule.isUser ?? false) - Number(right.rule.isUser ?? false)
      if (user !== 0) return user
      return left.index - right.index
    })
    .map(({ rule }) => rule)
}

function normalizeKey(key: string): string {
  return key.toLowerCase()
}
