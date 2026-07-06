/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/base/common/map.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { URI } from "./uri"

export function getOrSet<K, V>(map: Map<K, V>, key: K, value: V): V {
  let result = map.get(key)
  if (result === undefined) {
    result = value
    map.set(key, result)
  }
  return result
}

export function mapToString<K, V>(map: Map<K, V>): string {
  const entries: string[] = []
  map.forEach((value, key) => entries.push(`${key} => ${value}`))
  return `Map(${map.size}) {${entries.join(", ")}}`
}

export function setToString<K>(set: Set<K>): string {
  const entries: K[] = []
  set.forEach((value) => entries.push(value))
  return `Set(${set.size}) {${entries.join(", ")}}`
}

export type ResourceMapKeyFn = (resource: URI) => string

class ResourceMapEntry<T> {
  constructor(readonly uri: URI, readonly value: T) {}
}

function isEntries<T>(arg: ResourceMap<T> | ResourceMapKeyFn | readonly (readonly [URI, T])[] | undefined): arg is readonly (readonly [URI, T])[] {
  return Array.isArray(arg)
}

export class ResourceMap<T> implements Map<URI, T> {
  private static readonly defaultToKey = (resource: URI) => resource.toString()

  readonly [Symbol.toStringTag] = "ResourceMap"

  private readonly map: Map<string, ResourceMapEntry<T>>
  private readonly toKey: ResourceMapKeyFn

  constructor(toKey?: ResourceMapKeyFn)
  constructor(other?: ResourceMap<T>, toKey?: ResourceMapKeyFn)
  constructor(entries?: readonly (readonly [URI, T])[], toKey?: ResourceMapKeyFn)
  constructor(arg?: ResourceMap<T> | ResourceMapKeyFn | readonly (readonly [URI, T])[], toKey?: ResourceMapKeyFn) {
    this.map = new Map()
    if (arg instanceof ResourceMap) {
      this.toKey = toKey ?? ResourceMap.defaultToKey
      for (const [resource, value] of arg) this.set(resource, value)
    } else if (isEntries(arg)) {
      this.toKey = toKey ?? ResourceMap.defaultToKey
      for (const [resource, value] of arg) this.set(resource, value)
    } else {
      this.toKey = arg ?? ResourceMap.defaultToKey
    }
  }

  set(resource: URI, value: T): this {
    this.map.set(this.toKey(resource), new ResourceMapEntry(resource, value))
    return this
  }

  get(resource: URI): T | undefined {
    return this.map.get(this.toKey(resource))?.value
  }

  has(resource: URI): boolean {
    return this.map.has(this.toKey(resource))
  }

  get size(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }

  delete(resource: URI): boolean {
    return this.map.delete(this.toKey(resource))
  }

  forEach(callback: (value: T, key: URI, map: Map<URI, T>) => void, thisArg?: unknown): void {
    for (const entry of this.map.values()) {
      callback.call(thisArg, entry.value, entry.uri, this)
    }
  }

  values(): MapIterator<T> {
    return (function* (entries: IterableIterator<ResourceMapEntry<T>>) {
      for (const entry of entries) yield entry.value
    })(this.map.values()) as MapIterator<T>
  }

  keys(): MapIterator<URI> {
    return (function* (entries: IterableIterator<ResourceMapEntry<T>>) {
      for (const entry of entries) yield entry.uri
    })(this.map.values()) as MapIterator<URI>
  }

  entries(): MapIterator<[URI, T]> {
    return (function* (entries: IterableIterator<ResourceMapEntry<T>>) {
      for (const entry of entries) yield [entry.uri, entry.value] as [URI, T]
    })(this.map.values()) as MapIterator<[URI, T]>
  }

  [Symbol.iterator](): MapIterator<[URI, T]> {
    return this.entries()
  }
}

export class ResourceSet implements Set<URI> {
  readonly [Symbol.toStringTag] = "ResourceSet"

  private readonly map: ResourceMap<URI>

  constructor(toKey?: ResourceMapKeyFn)
  constructor(entries?: readonly URI[], toKey?: ResourceMapKeyFn)
  constructor(entriesOrKey?: readonly URI[] | ResourceMapKeyFn, toKey?: ResourceMapKeyFn) {
    if (typeof entriesOrKey === "function") {
      this.map = new ResourceMap(entriesOrKey)
    } else if (!entriesOrKey) {
      this.map = new ResourceMap<URI>()
    } else {
      this.map = new ResourceMap(toKey)
      entriesOrKey.forEach((entry) => this.add(entry))
    }
  }

  get size(): number {
    return this.map.size
  }

  add(value: URI): this {
    this.map.set(value, value)
    return this
  }

  clear(): void {
    this.map.clear()
  }

  delete(value: URI): boolean {
    return this.map.delete(value)
  }

  forEach(callback: (value: URI, value2: URI, set: Set<URI>) => void, thisArg?: unknown): void {
    this.map.forEach((_value, key) => callback.call(thisArg, key, key, this))
  }

  has(value: URI): boolean {
    return this.map.has(value)
  }

  entries(): SetIterator<[URI, URI]> {
    return this.map.entries()
  }

  keys(): SetIterator<URI> {
    return this.map.keys()
  }

  values(): SetIterator<URI> {
    return this.map.keys()
  }

  [Symbol.iterator](): SetIterator<URI> {
    return this.keys()
  }
}
