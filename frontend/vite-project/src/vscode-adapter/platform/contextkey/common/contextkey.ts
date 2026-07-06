// VS Code source adapter.
// Source reference: D:\SourceMirror\vscode\src\vs\platform\contextkey\common\scanner.ts
// Source reference: D:\SourceMirror\vscode\src\vs\platform\contextkey\common\contextkey.ts
//
// Codek does not import the full VS Code context key service here because that
// implementation is coupled to VS Code DI, platform and nls services. This file
// ports the expression grammar, evaluator and the small createKey/bindTo service
// surface needed by commands, menus, views, QuickInput and keybindings without
// keeping the old simplified parser in parallel.

import { Emitter, type Event } from "../../../base/common/event"
import type { IDisposable } from "../../../base/common/lifecycle"
import { createDecorator } from "../../instantiation/common/instantiation"
import { InstantiationType, registerSingleton } from "../../instantiation/common/extensions"

export type ContextKeyValue = boolean | string | number | null | undefined | string[] | number[] | Record<string, unknown>
export type ContextKeyState = Record<string, ContextKeyValue>

export interface ContextKeyServiceOwnerEvidence {
  owner: "IContextKeyService/ContextKeyService"
  stateSource: "ContextKeyService.context"
  activeContextSource: "IContextKeyService.getContext()"
  connected: true
  noSecondStateSource: true
  readonlyEvidence: true
  contextKeyCount: number
  contextKeys: string[]
}

export interface IReadableSet<T> {
  has(value: T): boolean
}

export interface ContextKeyChangeEvent {
  affectsSome(keys: IReadableSet<string>): boolean
  allKeysContainedIn(keys: IReadableSet<string>): boolean
}

export interface IContextKey<T extends ContextKeyValue> {
  set(value: T): void
  reset(): void
  get(): T | undefined
}

export interface IContextKeyService {
  readonly _serviceBrand: undefined
  readonly onDidChangeContext: Event<ContextKeyChangeEvent>
  bufferChangeEvents(callback: () => void): void
  createKey<T extends ContextKeyValue>(key: string, defaultValue: T | undefined): IContextKey<T>
  getContextKeyValue<T extends ContextKeyValue>(key: string): T | undefined
  contextMatchesRules(when: string | undefined): boolean
  updateContext(values: ContextKeyState): void
  getContext(): ContextKeyState
  createScoped(): IScopedContextKeyService
  createOverlay(overlay: Iterable<[string, ContextKeyValue]>): IContextKeyService
}

export const IContextKeyService = createDecorator<IContextKeyService>("contextKeyService")

export type IScopedContextKeyService = IContextKeyService & IDisposable

export class RawContextKey<T extends ContextKeyValue> {
  constructor(readonly key: string, private readonly defaultValue: T | undefined) {}

  bindTo(target: IContextKeyService): IContextKey<T> {
    return target.createKey(this.key, this.defaultValue)
  }

  getValue(target: IContextKeyService): T | undefined {
    return target.getContextKeyValue<T>(this.key)
  }
}

class SimpleContextKey<T extends ContextKeyValue> implements IContextKey<T> {
  constructor(
    private readonly service: ContextKeyService,
    private readonly key: string,
    private readonly defaultValue: T | undefined,
  ) {
    this.reset()
  }

  set(value: T): void {
    this.service.setKey(this.key, value)
  }

  reset(): void {
    this.service.setKey(this.key, this.defaultValue)
  }

  get(): T | undefined {
    return this.service.getContextKeyValue<T>(this.key)
  }
}

export class ContextKeyService implements IContextKeyService, IDisposable {
  declare readonly _serviceBrand: undefined
  protected readonly onDidChangeContextEmitter = new Emitter<ContextKeyChangeEvent>()
  readonly onDidChangeContext = this.onDidChangeContextEmitter.event
  private readonly context: ContextKeyState
  private bufferedChanges: Set<string> | undefined

  constructor(initialContext: ContextKeyState = {}) {
    this.context = { ...initialContext }
  }

  createKey<T extends ContextKeyValue>(key: string, defaultValue: T | undefined): IContextKey<T> {
    return new SimpleContextKey(this, key, defaultValue)
  }

  createScoped(): IScopedContextKeyService {
    return new ScopedContextKeyService(this)
  }

  createOverlay(overlay: Iterable<[string, ContextKeyValue]>): IContextKeyService {
    const scoped = new ScopedContextKeyService(this)
    scoped.updateContext(Object.fromEntries(overlay))
    return scoped
  }

  bufferChangeEvents(callback: () => void): void {
    const outerBuffer = this.bufferedChanges
    if (outerBuffer) {
      callback()
      return
    }

    this.bufferedChanges = new Set()
    try {
      callback()
    } finally {
      const changed = this.bufferedChanges
      this.bufferedChanges = undefined
      this.fireChanged(changed)
    }
  }

  getContextKeyValue<T extends ContextKeyValue>(key: string): T | undefined {
    return this.context[key] as T | undefined
  }

  contextMatchesRules(when: string | undefined): boolean {
    return evaluateWhenClause(when, this.context)
  }

  updateContext(values: ContextKeyState): void {
    const changed = new Set<string>()
    for (const [key, value] of Object.entries(values)) {
      if (this.context[key] === value) continue
      this.context[key] = value
      changed.add(key)
    }
    this.fireChanged(changed)
  }

  getContext(): ContextKeyState {
    return { ...this.context }
  }

  dispose(): void {
    this.onDidChangeContextEmitter.dispose()
  }

  hasKey(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.context, key)
  }

  setKey(key: string, value: ContextKeyValue): void {
    if (value === undefined) {
      if (!this.hasKey(key)) return
      delete this.context[key]
      this.fireChanged(new Set([key]))
      return
    }
    if (this.context[key] === value) return
    this.context[key] = value
    this.fireChanged(new Set([key]))
  }

  private fireChanged(changed: Set<string>): void {
    if (!changed.size) return
    if (this.bufferedChanges) {
      for (const key of changed) {
        this.bufferedChanges.add(key)
      }
      return
    }
    this.onDidChangeContextEmitter.fire({
      affectsSome(keys) {
        for (const key of changed) {
          if (keys.has(key)) return true
        }
        return false
      },
      allKeysContainedIn(keys) {
        for (const key of changed) {
          if (!keys.has(key)) return false
        }
        return true
      },
    })
  }
}

class ScopedContextKeyService extends ContextKeyService implements IScopedContextKeyService {
  private readonly parentChangeListener: IDisposable
  private isDisposed = false

  constructor(private readonly parent: IContextKeyService) {
    super()
    this.parentChangeListener = parent.onDidChangeContext((event) => {
      this.fireParentChanged(event)
    })
  }

  override getContextKeyValue<T extends ContextKeyValue>(key: string): T | undefined {
    if (this.isDisposed) return undefined
    if (this.hasKey(key)) return super.getContextKeyValue<T>(key)
    return this.parent.getContextKeyValue<T>(key)
  }

  override contextMatchesRules(when: string | undefined): boolean {
    if (this.isDisposed) return evaluateWhenClause(when, {})
    return evaluateWhenClause(when, this.getContext())
  }

  override getContext(): ContextKeyState {
    if (this.isDisposed) return {}
    return { ...this.parent.getContext(), ...super.getContext() }
  }

  override createScoped(): IScopedContextKeyService {
    return new ScopedContextKeyService(this)
  }

  override createOverlay(overlay: Iterable<[string, ContextKeyValue]>): IContextKeyService {
    const scoped = new ScopedContextKeyService(this)
    scoped.updateContext(Object.fromEntries(overlay))
    return scoped
  }

  override dispose(): void {
    if (this.isDisposed) return
    this.isDisposed = true
    this.parentChangeListener.dispose()
    super.dispose()
  }

  private fireParentChanged(event: ContextKeyChangeEvent): void {
    this.onDidChangeContextEmitter.fire(event)
  }
}

export const globalContextKeyService = new ContextKeyService()
registerSingleton(IContextKeyService, globalContextKeyService, InstantiationType.Delayed)

export function getContextKeyServiceOwnerEvidence(
  service: IContextKeyService = globalContextKeyService,
): ContextKeyServiceOwnerEvidence {
  const contextKeys = Object.keys(service.getContext()).sort()
  return {
    owner: "IContextKeyService/ContextKeyService",
    stateSource: "ContextKeyService.context",
    activeContextSource: "IContextKeyService.getContext()",
    connected: true,
    noSecondStateSource: true,
    readonlyEvidence: true,
    contextKeyCount: contextKeys.length,
    contextKeys,
  }
}

export function getContextKeyNames(when: string | undefined): string[] {
  if (!when || !when.trim()) return []

  try {
    const expression = new ContextKeyParser(new Scanner(when).scan()).parse()
    return Array.from(collectExpressionKeys(expression))
  } catch {
    return []
  }
}

const enum TokenType {
  LParen,
  RParen,
  Neg,
  Eq,
  NotEq,
  Lt,
  LtEq,
  Gt,
  GtEq,
  RegexOp,
  NotRegexOp,
  RegexStr,
  True,
  False,
  In,
  Not,
  And,
  Or,
  Str,
  QuotedStr,
  Null,
  EOF,
}

type Token =
  | { type: Exclude<TokenType, TokenType.Str | TokenType.QuotedStr | TokenType.RegexStr>; offset: number }
  | { type: TokenType.Str | TokenType.QuotedStr | TokenType.RegexStr; offset: number; lexeme: string }

type Expression =
  | { type: "literal"; value: ContextKeyValue }
  | { type: "defined"; key: string }
  | { type: "not"; key: string }
  | { type: "negate"; expr: Expression }
  | { type: "and"; expressions: Expression[] }
  | { type: "or"; expressions: Expression[] }
  | { type: "compare"; op: "==" | "!=" | "<" | "<=" | ">" | ">=" | "=~" | "!~" | "in" | "not in"; key: string; value: Expression }

const TRUE: Expression = { type: "literal", value: true }

export function evaluateWhenClause(when: string | undefined, context: ContextKeyState = {}): boolean {
  if (!when || !when.trim()) return true

  try {
    const expression = new ContextKeyParser(new Scanner(when).scan()).parse()
    return evaluateExpression(expression, context)
  } catch {
    return false
  }
}

class Scanner {
  private readonly tokens: Token[] = []
  private index = 0

  constructor(private readonly input: string) {}

  scan(): Token[] {
    while (this.index < this.input.length) {
      const offset = this.index
      const char = this.input[this.index]
      if (/\s/.test(char)) {
        this.index += 1
        continue
      }

      if (this.consume("&&")) this.tokens.push({ type: TokenType.And, offset })
      else if (this.consume("||")) this.tokens.push({ type: TokenType.Or, offset })
      else if (this.consume("===") || this.consume("==")) this.tokens.push({ type: TokenType.Eq, offset })
      else if (this.consume("!==") || this.consume("!=")) this.tokens.push({ type: TokenType.NotEq, offset })
      else if (this.consume("<=")) this.tokens.push({ type: TokenType.LtEq, offset })
      else if (this.consume(">=")) this.tokens.push({ type: TokenType.GtEq, offset })
      else if (this.consume("=~")) this.tokens.push({ type: TokenType.RegexOp, offset })
      else if (this.consume("!~")) this.tokens.push({ type: TokenType.NotRegexOp, offset })
      else if (this.consume("<")) this.tokens.push({ type: TokenType.Lt, offset })
      else if (this.consume(">")) this.tokens.push({ type: TokenType.Gt, offset })
      else if (this.consume("!")) this.tokens.push({ type: TokenType.Neg, offset })
      else if (this.consume("(")) this.tokens.push({ type: TokenType.LParen, offset })
      else if (this.consume(")")) this.tokens.push({ type: TokenType.RParen, offset })
      else if (char === "'" || char === '"') this.tokens.push(this.readQuotedString(char, offset))
      else if (char === "/") this.tokens.push(this.readRegex(offset))
      else this.tokens.push(this.readWord(offset))
    }

    this.tokens.push({ type: TokenType.EOF, offset: this.input.length })
    return this.tokens
  }

  private consume(value: string): boolean {
    if (!this.input.startsWith(value, this.index)) return false
    this.index += value.length
    return true
  }

  private readQuotedString(quote: string, offset: number): Token {
    let lexeme = ""
    this.index += 1
    while (this.index < this.input.length && this.input[this.index] !== quote) {
      if (this.input[this.index] === "\\" && this.index + 1 < this.input.length) {
        lexeme += this.input[this.index + 1]
        this.index += 2
      } else {
        lexeme += this.input[this.index]
        this.index += 1
      }
    }
    if (this.input[this.index] === quote) this.index += 1
    return { type: TokenType.QuotedStr, offset, lexeme }
  }

  private readRegex(offset: number): Token {
    let lexeme = "/"
    this.index += 1
    while (this.index < this.input.length && this.input[this.index] !== "/") {
      if (this.input[this.index] === "\\" && this.index + 1 < this.input.length) {
        lexeme += `${this.input[this.index]}${this.input[this.index + 1]}`
        this.index += 2
      } else {
        lexeme += this.input[this.index]
        this.index += 1
      }
    }
    if (this.input[this.index] === "/") {
      lexeme += "/"
      this.index += 1
    }

    while (/[gimsuy]/.test(this.input[this.index] || "")) {
      lexeme += this.input[this.index]
      this.index += 1
    }
    return { type: TokenType.RegexStr, offset, lexeme }
  }

  private readWord(offset: number): Token {
    const match = this.input.slice(this.index).match(/^-?\d+(?:\.\d+)?|^[^\s()=!<>]+/)
    if (!match) throw new Error(`Unexpected token at ${offset}`)

    const lexeme = match[0]
    this.index += lexeme.length

    if (lexeme === "true") return { type: TokenType.True, offset }
    if (lexeme === "false") return { type: TokenType.False, offset }
    if (lexeme === "null") return { type: TokenType.Null, offset }
    if (lexeme === "in") return { type: TokenType.In, offset }
    if (lexeme === "not") return { type: TokenType.Not, offset }
    return { type: TokenType.Str, offset, lexeme }
  }
}

class ContextKeyParser {
  private index = 0

  constructor(private readonly tokens: Token[]) {}

  parse(): Expression {
    const expression = this.parseOr()
    this.expect(TokenType.EOF)
    return expression
  }

  private parseOr(): Expression {
    const expressions = [this.parseAnd()]
    while (this.match(TokenType.Or)) expressions.push(this.parseAnd())
    return expressions.length === 1 ? expressions[0] : { type: "or", expressions }
  }

  private parseAnd(): Expression {
    const expressions = [this.parseTerm()]
    while (this.match(TokenType.And)) expressions.push(this.parseTerm())
    return expressions.length === 1 ? expressions[0] : { type: "and", expressions }
  }

  private parseTerm(): Expression {
    if (this.match(TokenType.Neg)) {
      const next = this.peek()
      if (next.type === TokenType.Str) {
        this.advance()
        return { type: "not", key: next.lexeme }
      }
      return { type: "negate", expr: this.parseTerm() }
    }

    if (this.match(TokenType.LParen)) {
      const expression = this.parseOr()
      this.expect(TokenType.RParen)
      return expression
    }

    const token = this.advance()
    if (token.type !== TokenType.Str) return literalFromToken(token)

    const key = token.lexeme
    if (this.match(TokenType.Eq)) return { type: "compare", op: "==", key, value: this.parseValue() }
    if (this.match(TokenType.NotEq)) return { type: "compare", op: "!=", key, value: this.parseValue() }
    if (this.match(TokenType.Lt)) return { type: "compare", op: "<", key, value: this.parseValue() }
    if (this.match(TokenType.LtEq)) return { type: "compare", op: "<=", key, value: this.parseValue() }
    if (this.match(TokenType.Gt)) return { type: "compare", op: ">", key, value: this.parseValue() }
    if (this.match(TokenType.GtEq)) return { type: "compare", op: ">=", key, value: this.parseValue() }
    if (this.match(TokenType.RegexOp)) return { type: "compare", op: "=~", key, value: this.parseValue() }
    if (this.match(TokenType.NotRegexOp)) return { type: "compare", op: "!~", key, value: this.parseValue() }
    if (this.match(TokenType.Not)) {
      this.expect(TokenType.In)
      return { type: "compare", op: "not in", key, value: this.parseContextValue() }
    }
    if (this.match(TokenType.In)) return { type: "compare", op: "in", key, value: this.parseContextValue() }
    return { type: "defined", key }
  }

  private parseValue(): Expression {
    const token = this.advance()
    if (token.type === TokenType.Str) return { type: "literal", value: parseWordValue(token.lexeme) }
    return literalFromToken(token)
  }

  private parseContextValue(): Expression {
    const token = this.advance()
    if (token.type === TokenType.Str) return { type: "defined", key: token.lexeme }
    return literalFromToken(token)
  }

  private match(type: TokenType): boolean {
    if (this.peek().type !== type) return false
    this.index += 1
    return true
  }

  private expect(type: TokenType): void {
    const token = this.advance()
    if (token.type !== type) throw new Error(`Expected ${type}, got ${token.type}`)
  }

  private advance(): Token {
    return this.tokens[this.index++] || { type: TokenType.EOF, offset: -1 }
  }

  private peek(): Token {
    return this.tokens[this.index] || { type: TokenType.EOF, offset: -1 }
  }
}

function literalFromToken(token: Token): Expression {
  if (token.type === TokenType.QuotedStr) return { type: "literal", value: token.lexeme }
  if (token.type === TokenType.RegexStr) return { type: "literal", value: token.lexeme }
  if (token.type === TokenType.True) return { type: "literal", value: true }
  if (token.type === TokenType.False) return { type: "literal", value: false }
  if (token.type === TokenType.Null) return { type: "literal", value: null }
  throw new Error(`Expected literal, got ${token.type}`)
}

function parseWordValue(value: string): ContextKeyValue {
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value)
  return value
}

function evaluateExpression(expression: Expression, context: ContextKeyState): boolean {
  switch (expression.type) {
    case "literal":
      return truthy(expression.value)
    case "defined":
      return truthy(context[expression.key])
    case "not":
      return !truthy(context[expression.key])
    case "negate":
      return !evaluateExpression(expression.expr, context)
    case "and":
      return expression.expressions.every((expr) => evaluateExpression(expr, context))
    case "or":
      return expression.expressions.some((expr) => evaluateExpression(expr, context))
    case "compare":
      return evaluateComparison(expression, context)
  }
}

function collectExpressionKeys(expression: Expression, keys: Set<string> = new Set()): Set<string> {
  switch (expression.type) {
    case "defined":
    case "not":
      keys.add(expression.key)
      break
    case "negate":
      collectExpressionKeys(expression.expr, keys)
      break
    case "and":
    case "or":
      for (const child of expression.expressions) {
        collectExpressionKeys(child, keys)
      }
      break
    case "compare":
      keys.add(expression.key)
      collectExpressionKeys(expression.value, keys)
      break
    case "literal":
      break
  }

  return keys
}

function evaluateValue(expression: Expression, context: ContextKeyState): ContextKeyValue {
  if (expression.type === "literal") return expression.value
  if (expression.type === "defined") return context[expression.key]
  return evaluateExpression(expression, context)
}

function evaluateComparison(expression: Extract<Expression, { type: "compare" }>, context: ContextKeyState): boolean {
  const left = context[expression.key]
  const right = evaluateValue(expression.value, context)

  switch (expression.op) {
    case "==":
      return `${left}` === `${right}`
    case "!=":
      return `${left}` !== `${right}`
    case "<":
      return Number(left) < Number(right)
    case "<=":
      return Number(left) <= Number(right)
    case ">":
      return Number(left) > Number(right)
    case ">=":
      return Number(left) >= Number(right)
    case "=~":
      return safeRegExp(`${right}`).test(`${left ?? ""}`)
    case "!~":
      return !safeRegExp(`${right}`).test(`${left ?? ""}`)
    case "in":
      return includesContextValue(left, right)
    case "not in":
      return !includesContextValue(left, right)
  }
}

function truthy(value: ContextKeyValue): boolean {
  return value === true || (typeof value === "string" && value.length > 0) || (typeof value === "number" && value !== 0)
}

function safeRegExp(pattern: string): RegExp {
  const match = pattern.match(/^\/(.*)\/([gimsuy]*)$/)
  const body = match ? match[1] : pattern
  const flags = match ? match[2].replace(/[gy]/g, "") : undefined
  try {
    return new RegExp(body, flags)
  } catch {
    return /$a/
  }
}

function includesContextValue(left: ContextKeyValue, right: ContextKeyValue): boolean {
  if (Array.isArray(right)) return right.some((value) => `${value}` === `${left}`)
  if (right && typeof right === "object") return Object.prototype.hasOwnProperty.call(right, `${left}`)
  if (typeof right === "string") return right.split(",").map((part) => part.trim()).includes(`${left}`)
  return false
}
