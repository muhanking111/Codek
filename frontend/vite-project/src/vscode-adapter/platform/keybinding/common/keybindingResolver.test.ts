import { describe, expect, it } from "vitest"
import {
  CodekKeybindingResolver,
  CodekKeybindingResultKind,
  type CodekKeybindingRule,
} from "./keybindingResolver"

type Command = { id: string }

function rule(id: string, sequence: CodekKeybindingRule<Command>["sequence"], when?: string): CodekKeybindingRule<Command> {
  return { command: { id }, sequence, when }
}

function weightedRule(
  id: string,
  sequence: CodekKeybindingRule<Command>["sequence"],
  weight: number,
  when?: string,
  isUser = false,
): CodekKeybindingRule<Command> {
  return { command: { id }, sequence, when, weight, isUser }
}

function stroke(key: string, ctrl = false, shift = false, alt = false) {
  return { key, ctrl, shift, alt }
}

describe("CodekKeybindingResolver", () => {
  it("returns MoreChordsNeeded only when the best VS Code-style match is a chord", () => {
    const resolver = new CodekKeybindingResolver([
      rule("openSettings", [stroke("k", true), stroke("s", true)]),
      rule("singleKeyWins", [stroke("k", true)]),
    ])

    const result = resolver.resolve({}, [], stroke("k", true))

    expect(result.kind).toBe(CodekKeybindingResultKind.KbFound)
    if (result.kind === CodekKeybindingResultKind.KbFound) expect(result.command.id).toBe("singleKeyWins")
  })

  it("uses later matching rules and active when clauses", () => {
    const resolver = new CodekKeybindingResolver([
      rule("fallback", [stroke("s", true)]),
      rule("editor", [stroke("s", true)], "editorTextFocus && !inputFocus"),
    ])

    const fallback = resolver.resolve({ editorTextFocus: false, inputFocus: false }, [], stroke("s", true))
    expect(fallback.kind).toBe(CodekKeybindingResultKind.KbFound)
    if (fallback.kind === CodekKeybindingResultKind.KbFound) expect(fallback.command.id).toBe("fallback")

    const editor = resolver.resolve({ editorTextFocus: true, inputFocus: false }, [], stroke("s", true))
    expect(editor.kind).toBe(CodekKeybindingResultKind.KbFound)
    if (editor.kind === CodekKeybindingResultKind.KbFound) expect(editor.command.id).toBe("editor")
  })

  it("resolves chord continuations from the current chord sequence", () => {
    const resolver = new CodekKeybindingResolver([
      rule("openSettings", [stroke("k", true), stroke("s", true)]),
    ])

    expect(resolver.resolve({}, [], stroke("k", true)).kind).toBe(CodekKeybindingResultKind.MoreChordsNeeded)
    const result = resolver.resolve({}, [stroke("k", true)], stroke("s", true))
    expect(result.kind).toBe(CodekKeybindingResultKind.KbFound)
    if (result.kind === CodekKeybindingResultKind.KbFound) expect(result.command.id).toBe("openSettings")
  })

  it("looks up commands by normalized keybinding sequence with later rules first", () => {
    const resolver = new CodekKeybindingResolver([
      rule("first", [stroke("S", true)]),
      rule("second", [stroke("s", true)]),
    ])

    expect(resolver.lookupBySequence([stroke("s", true)]).map((match) => match.command.id)).toEqual(["second", "first"])
  })

  it("orders matches by VS Code-style weight and user overrides", () => {
    const resolver = new CodekKeybindingResolver([
      weightedRule("workbench", [stroke("e", true, true)], 200),
      weightedRule("editor", [stroke("e", true, true)], 100),
      weightedRule("user", [stroke("e", true, true)], 200, undefined, true),
    ])

    const result = resolver.resolve({}, [], stroke("e", true, true))

    expect(result.kind).toBe(CodekKeybindingResultKind.KbFound)
    if (result.kind === CodekKeybindingResultKind.KbFound) expect(result.command.id).toBe("user")
    expect(resolver.lookupBySequence([stroke("e", true, true)]).map((match) => match.command.id)).toEqual([
      "user",
      "workbench",
      "editor",
    ])
  })
})
