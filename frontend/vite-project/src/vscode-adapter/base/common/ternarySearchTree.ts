/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/base/common/ternarySearchTree.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { URI } from "./uri"

export interface IKeyIterator<K> {
  reset(key: K): this
  next(): this
  hasNext(): boolean
  cmp(segment: string): number
  value(): string
}

const CharCode = {
  Backslash: 92,
  Slash: 47,
  Period: 46,
} as const

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareIgnoreCase(left: string, right: string): number {
  return compare(left.toLowerCase(), right.toLowerCase())
}

function compareSubstring(left: string, right: string, leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): number {
  return compare(left.slice(leftStart, leftEnd), right.slice(rightStart, rightEnd))
}

function compareSubstringIgnoreCase(left: string, right: string, leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): number {
  return compare(left.slice(leftStart, leftEnd).toLowerCase(), right.slice(rightStart, rightEnd).toLowerCase())
}

export class StringIterator implements IKeyIterator<string> {
  private currentValue = ""
  private position = 0

  reset(key: string): this {
    this.currentValue = key
    this.position = 0
    return this
  }

  next(): this {
    this.position += 1
    return this
  }

  hasNext(): boolean {
    return this.position < this.currentValue.length - 1
  }

  cmp(segment: string): number {
    return segment.charCodeAt(0) - this.currentValue.charCodeAt(this.position)
  }

  value(): string {
    return this.currentValue[this.position]
  }
}

export class ConfigKeysIterator implements IKeyIterator<string> {
  private currentValue = ""
  private from = 0
  private to = 0

  constructor(private readonly caseSensitive = true) {}

  reset(key: string): this {
    this.currentValue = key
    this.from = 0
    this.to = 0
    return this.next()
  }

  hasNext(): boolean {
    return this.to < this.currentValue.length
  }

  next(): this {
    this.from = this.to
    let justSeps = true
    for (; this.to < this.currentValue.length; this.to += 1) {
      const ch = this.currentValue.charCodeAt(this.to)
      if (ch === CharCode.Period) {
        if (justSeps) this.from += 1
        else break
      } else {
        justSeps = false
      }
    }
    return this
  }

  cmp(segment: string): number {
    return this.caseSensitive
      ? compareSubstring(segment, this.currentValue, 0, segment.length, this.from, this.to)
      : compareSubstringIgnoreCase(segment, this.currentValue, 0, segment.length, this.from, this.to)
  }

  value(): string {
    return this.currentValue.substring(this.from, this.to)
  }
}

export class PathIterator implements IKeyIterator<string> {
  private currentValue = ""
  private valueLength = 0
  private from = 0
  private to = 0

  constructor(
    private readonly splitOnBackslash = true,
    private readonly caseSensitive = true,
  ) {}

  reset(key: string): this {
    this.from = 0
    this.to = 0
    this.currentValue = key
    this.valueLength = key.length
    for (let position = key.length - 1; position >= 0; position -= 1, this.valueLength -= 1) {
      const ch = this.currentValue.charCodeAt(position)
      if (!(ch === CharCode.Slash || (this.splitOnBackslash && ch === CharCode.Backslash))) break
    }
    return this.next()
  }

  hasNext(): boolean {
    return this.to < this.valueLength
  }

  next(): this {
    this.from = this.to
    let justSeps = true
    for (; this.to < this.valueLength; this.to += 1) {
      const ch = this.currentValue.charCodeAt(this.to)
      if (ch === CharCode.Slash || (this.splitOnBackslash && ch === CharCode.Backslash)) {
        if (justSeps) this.from += 1
        else break
      } else {
        justSeps = false
      }
    }
    return this
  }

  cmp(segment: string): number {
    return this.caseSensitive
      ? compareSubstring(segment, this.currentValue, 0, segment.length, this.from, this.to)
      : compareSubstringIgnoreCase(segment, this.currentValue, 0, segment.length, this.from, this.to)
  }

  value(): string {
    return this.currentValue.substring(this.from, this.to)
  }
}

const enum UriIteratorState {
  Scheme = 1,
  Authority = 2,
  Path = 3,
  Query = 4,
  Fragment = 5,
}

export class UriIterator implements IKeyIterator<URI> {
  private pathIterator!: PathIterator
  private currentValue!: URI
  private states: UriIteratorState[] = []
  private stateIndex = 0

  constructor(
    private readonly ignorePathCasing: (uri: URI) => boolean,
    private readonly ignoreQueryAndFragment: (uri: URI) => boolean,
  ) {}

  reset(key: URI): this {
    this.currentValue = key
    this.states = []
    if (key.scheme) this.states.push(UriIteratorState.Scheme)
    if (key.authority) this.states.push(UriIteratorState.Authority)
    if (key.path) {
      this.pathIterator = new PathIterator(false, !this.ignorePathCasing(key))
      this.pathIterator.reset(key.path)
      if (this.pathIterator.value()) this.states.push(UriIteratorState.Path)
    }
    if (!this.ignoreQueryAndFragment(key)) {
      if (key.query) this.states.push(UriIteratorState.Query)
      if (key.fragment) this.states.push(UriIteratorState.Fragment)
    }
    this.stateIndex = 0
    return this
  }

  next(): this {
    if (this.states[this.stateIndex] === UriIteratorState.Path && this.pathIterator.hasNext()) this.pathIterator.next()
    else this.stateIndex += 1
    return this
  }

  hasNext(): boolean {
    return (
      (this.states[this.stateIndex] === UriIteratorState.Path && this.pathIterator.hasNext()) ||
      this.stateIndex < this.states.length - 1
    )
  }

  cmp(segment: string): number {
    if (this.states[this.stateIndex] === UriIteratorState.Scheme) return compareIgnoreCase(segment, this.currentValue.scheme)
    if (this.states[this.stateIndex] === UriIteratorState.Authority) return compareIgnoreCase(segment, this.currentValue.authority)
    if (this.states[this.stateIndex] === UriIteratorState.Path) return this.pathIterator.cmp(segment)
    if (this.states[this.stateIndex] === UriIteratorState.Query) return compare(segment, this.currentValue.query)
    if (this.states[this.stateIndex] === UriIteratorState.Fragment) return compare(segment, this.currentValue.fragment)
    throw new Error("Invalid URI iterator state")
  }

  value(): string {
    if (this.states[this.stateIndex] === UriIteratorState.Scheme) return this.currentValue.scheme
    if (this.states[this.stateIndex] === UriIteratorState.Authority) return this.currentValue.authority
    if (this.states[this.stateIndex] === UriIteratorState.Path) return this.pathIterator.value()
    if (this.states[this.stateIndex] === UriIteratorState.Query) return this.currentValue.query
    if (this.states[this.stateIndex] === UriIteratorState.Fragment) return this.currentValue.fragment
    throw new Error("Invalid URI iterator state")
  }
}

abstract class Undef {
  static readonly Val: unique symbol = Symbol("undefined_placeholder")

  static wrap<V>(value: V | undefined): V | typeof Undef.Val {
    return value === undefined ? Undef.Val : value
  }

  static unwrap<V>(value: V | typeof Undef.Val): V | undefined {
    return value === Undef.Val ? undefined : value
  }
}

class TernarySearchTreeNode<K, V> {
  height = 1
  segment!: string
  value: V | typeof Undef.Val | undefined = undefined
  key: K | undefined = undefined
  left: TernarySearchTreeNode<K, V> | undefined = undefined
  mid: TernarySearchTreeNode<K, V> | undefined = undefined
  right: TernarySearchTreeNode<K, V> | undefined = undefined

  rotateLeft(): TernarySearchTreeNode<K, V> {
    const tmp = this.right as TernarySearchTreeNode<K, V>
    this.right = tmp.left
    tmp.left = this
    this.updateHeight()
    tmp.updateHeight()
    return tmp
  }

  rotateRight(): TernarySearchTreeNode<K, V> {
    const tmp = this.left as TernarySearchTreeNode<K, V>
    this.left = tmp.right
    tmp.right = this
    this.updateHeight()
    tmp.updateHeight()
    return tmp
  }

  updateHeight(): void {
    this.height = 1 + Math.max(this.heightLeft, this.heightRight)
  }

  balanceFactor(): number {
    return this.heightRight - this.heightLeft
  }

  get heightLeft(): number {
    return this.left?.height ?? 0
  }

  get heightRight(): number {
    return this.right?.height ?? 0
  }
}

const enum Dir {
  Left = -1,
  Mid = 0,
  Right = 1,
}

export class TernarySearchTree<K, V> {
  static forUris<E>(
    ignorePathCasing: (key: URI) => boolean = () => false,
    ignoreQueryAndFragment: (key: URI) => boolean = () => false,
  ): TernarySearchTree<URI, E> {
    return new TernarySearchTree<URI, E>(new UriIterator(ignorePathCasing, ignoreQueryAndFragment))
  }

  static forPaths<E>(ignorePathCasing = false): TernarySearchTree<string, E> {
    return new TernarySearchTree<string, E>(new PathIterator(undefined, !ignorePathCasing))
  }

  static forStrings<E>(): TernarySearchTree<string, E> {
    return new TernarySearchTree<string, E>(new StringIterator())
  }

  static forConfigKeys<E>(): TernarySearchTree<string, E> {
    return new TernarySearchTree<string, E>(new ConfigKeysIterator())
  }

  private root: TernarySearchTreeNode<K, V> | undefined

  constructor(private readonly iterator: IKeyIterator<K>) {}

  clear(): void {
    this.root = undefined
  }

  fill(element: V, keys: readonly K[]): void
  fill(values: readonly [K, V][]): void
  fill(values: readonly [K, V][] | V, keys?: readonly K[]): void {
    if (keys) {
      for (const key of keys) this.set(key, values as V)
      return
    }
    for (const [key, value] of values as readonly [K, V][]) this.set(key, value)
  }

  set(key: K, element: V): V | undefined {
    const iter = this.iterator.reset(key)
    let node: TernarySearchTreeNode<K, V>
    if (!this.root) {
      this.root = new TernarySearchTreeNode<K, V>()
      this.root.segment = iter.value()
    }
    const stack: [Dir, TernarySearchTreeNode<K, V>][] = []

    node = this.root
    while (true) {
      const val = iter.cmp(node.segment)
      if (val > 0) {
        if (!node.left) {
          node.left = new TernarySearchTreeNode<K, V>()
          node.left.segment = iter.value()
        }
        stack.push([Dir.Left, node])
        node = node.left
      } else if (val < 0) {
        if (!node.right) {
          node.right = new TernarySearchTreeNode<K, V>()
          node.right.segment = iter.value()
        }
        stack.push([Dir.Right, node])
        node = node.right
      } else if (iter.hasNext()) {
        iter.next()
        if (!node.mid) {
          node.mid = new TernarySearchTreeNode<K, V>()
          node.mid.segment = iter.value()
        }
        stack.push([Dir.Mid, node])
        node = node.mid
      } else {
        break
      }
    }

    const oldElement = Undef.unwrap(node.value)
    node.value = Undef.wrap(element)
    node.key = key

    this.rebalance(stack)
    return oldElement
  }

  get(key: K): V | undefined {
    return Undef.unwrap(this.getNode(key)?.value)
  }

  has(key: K): boolean {
    const node = this.getNode(key)
    return !(node?.value === undefined && node?.mid === undefined)
  }

  findSubstr(key: K): V | undefined {
    const iter = this.iterator.reset(key)
    let node = this.root
    let candidate: V | undefined = undefined
    while (node) {
      const val = iter.cmp(node.segment)
      if (val > 0) {
        node = node.left
      } else if (val < 0) {
        node = node.right
      } else if (iter.hasNext()) {
        iter.next()
        candidate = Undef.unwrap(node.value) || candidate
        node = node.mid
      } else {
        break
      }
    }
    return (node && Undef.unwrap(node.value)) || candidate
  }

  findSuperstr(key: K): IterableIterator<[K, V]> | undefined {
    return this.findSuperstrOrElement(key, false) as IterableIterator<[K, V]> | undefined
  }

  hasElementOrSubtree(key: K): boolean {
    return this.findSuperstrOrElement(key, true) !== undefined
  }

  forEach(callback: (value: V, index: K) => unknown): void {
    for (const [key, value] of this) callback(value, key)
  }

  *[Symbol.iterator](): IterableIterator<[K, V]> {
    yield* this.entries(this.root)
  }

  private getNode(key: K): TernarySearchTreeNode<K, V> | undefined {
    const iter = this.iterator.reset(key)
    let node = this.root
    while (node) {
      const val = iter.cmp(node.segment)
      if (val > 0) node = node.left
      else if (val < 0) node = node.right
      else if (iter.hasNext()) {
        iter.next()
        node = node.mid
      } else {
        break
      }
    }
    return node
  }

  private findSuperstrOrElement(key: K, allowValue: boolean): IterableIterator<[K, V]> | V | undefined {
    const iter = this.iterator.reset(key)
    let node = this.root
    while (node) {
      const val = iter.cmp(node.segment)
      if (val > 0) {
        node = node.left
      } else if (val < 0) {
        node = node.right
      } else if (iter.hasNext()) {
        iter.next()
        node = node.mid
      } else if (!node.mid) {
        return allowValue ? Undef.unwrap(node.value) : undefined
      } else {
        return this.entries(node.mid)
      }
    }
    return undefined
  }

  private entries(node: TernarySearchTreeNode<K, V> | undefined): IterableIterator<[K, V]> {
    const result: [K, V][] = []
    this.dfsEntries(node, result)
    return result[Symbol.iterator]()
  }

  private dfsEntries(node: TernarySearchTreeNode<K, V> | undefined, bucket: [K, V][]): void {
    if (!node) return
    if (node.left) this.dfsEntries(node.left, bucket)
    if (node.value !== undefined) bucket.push([node.key as K, Undef.unwrap(node.value) as V])
    if (node.mid) this.dfsEntries(node.mid, bucket)
    if (node.right) this.dfsEntries(node.right, bucket)
  }

  private rebalance(stack: [Dir, TernarySearchTreeNode<K, V>][]): void {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const node = stack[index][1]
      node.updateHeight()
      const balanceFactor = node.balanceFactor()
      if (balanceFactor < -1 || balanceFactor > 1) {
        const currentDirection = stack[index][0]
        const nextDirection = stack[index + 1]?.[0]
        if (currentDirection === Dir.Right && nextDirection === Dir.Right) {
          stack[index][1] = node.rotateLeft()
        } else if (currentDirection === Dir.Left && nextDirection === Dir.Left) {
          stack[index][1] = node.rotateRight()
        } else if (currentDirection === Dir.Right && nextDirection === Dir.Left) {
          node.right = (stack[index + 1][1] = stack[index + 1][1].rotateRight())
          stack[index][1] = node.rotateLeft()
        } else if (currentDirection === Dir.Left && nextDirection === Dir.Right) {
          node.left = (stack[index + 1][1] = stack[index + 1][1].rotateLeft())
          stack[index][1] = node.rotateRight()
        } else {
          throw new Error("Invalid ternary search tree balance state")
        }

        if (index > 0) {
          this.patchParent(stack[index - 1], stack[index][1])
        } else {
          this.root = stack[0][1]
        }
      }
    }
  }

  private patchParent(parent: [Dir, TernarySearchTreeNode<K, V>], child: TernarySearchTreeNode<K, V>): void {
    if (parent[0] === Dir.Left) parent[1].left = child
    else if (parent[0] === Dir.Right) parent[1].right = child
    else parent[1].mid = child
  }
}
