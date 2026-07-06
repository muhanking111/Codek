// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\platform\configuration\common\configuration.ts
// - D:\SourceMirror\vscode\src\vs\platform\configuration\common\configurationModels.ts
// - D:\SourceMirror\vscode\src\vs\platform\configuration\common\configurationRegistry.ts
//
// Codek stores settings as flat VS Code keys. This adapter ports the relevant
// ConfigurationModel value tree, merge, inspect and override-identifier semantics
// without importing VS Code's full registry, policy and DI stack.

export type ConfigurationRecord = Record<string, unknown>

export interface ConfigurationOverrides {
  overrideIdentifier?: string | null
  resource?: string | { toString(): string } | null
}

export interface ConfigurationOverride {
  keys: string[]
  contents: ConfigurationRecord
  identifiers: string[]
}

export interface ConfigurationInspectValue<T = unknown> {
  value?: T
  override?: T
  merged?: T
  overrides?: Array<{ identifiers: string[]; value: T }>
}

const OVERRIDE_IDENTIFIER_PATTERN = "\\[([^\\]]+)\\]"
const OVERRIDE_IDENTIFIER_REGEX = new RegExp(OVERRIDE_IDENTIFIER_PATTERN, "g")
const OVERRIDE_PROPERTY_REGEX = new RegExp(`^(${OVERRIDE_IDENTIFIER_PATTERN})+$`)

export class ConfigurationModel {
  private readonly overrideConfigurationModels = new Map<string, ConfigurationModel>()

  constructor(
    readonly contents: ConfigurationRecord = {},
    readonly keys: string[] = [],
    readonly overrides: ConfigurationOverride[] = [],
  ) {}

  isEmpty(): boolean {
    return this.keys.length === 0 && Object.keys(this.contents).length === 0 && this.overrides.length === 0
  }

  getValue<T = unknown>(section?: string): T | undefined {
    return section ? getConfigurationValue<T>(this.contents, section) : (this.contents as T)
  }

  inspect<T = unknown>(section?: string, overrideIdentifier?: string | null): ConfigurationInspectValue<T> {
    const overrides: Array<{ identifiers: string[]; value: T }> = []
    for (const override of this.overrides) {
      const value = new ConfigurationModel(override.contents, override.keys).getValue<T>(section)
      if (value !== undefined) overrides.push({ identifiers: [...override.identifiers], value: deepClone(value) })
    }
    return {
      value: deepClone(this.getValue<T>(section)),
      override: overrideIdentifier ? deepClone(this.getOverrideValue<T>(section, overrideIdentifier)) : undefined,
      merged: deepClone(overrideIdentifier ? this.override(overrideIdentifier).getValue<T>(section) : this.getValue<T>(section)),
      overrides: overrides.length ? overrides : undefined,
    }
  }

  getOverrideValue<T = unknown>(section: string | undefined, overrideIdentifier: string): T | undefined {
    const overrideContents = this.getContentsForOverrideIdentifier(overrideIdentifier)
    if (!overrideContents) return undefined
    return section ? getConfigurationValue<T>(overrideContents, section) : (overrideContents as T)
  }

  getKeysForOverrideIdentifier(identifier: string): string[] {
    const keys: string[] = []
    for (const override of this.overrides) {
      if (override.identifiers.includes(identifier)) keys.push(...override.keys)
    }
    return distinct(keys)
  }

  getAllOverrideIdentifiers(): string[] {
    const identifiers: string[] = []
    for (const override of this.overrides) identifiers.push(...override.identifiers)
    return distinct(identifiers)
  }

  override(identifier: string): ConfigurationModel {
    const existing = this.overrideConfigurationModels.get(identifier)
    if (existing) return existing
    const created = this.createOverrideConfigurationModel(identifier)
    this.overrideConfigurationModels.set(identifier, created)
    return created
  }

  merge(...others: ConfigurationModel[]): ConfigurationModel {
    const contents = deepClone(this.contents)
    const keys = [...this.keys]
    const overrides = deepClone(this.overrides)

    for (const other of others) {
      if (other.isEmpty()) continue
      mergeContents(contents, other.contents)
      for (const otherOverride of other.overrides) {
        const existing = overrides.find((override) => arraysEqual(override.identifiers, otherOverride.identifiers))
        if (existing) {
          mergeContents(existing.contents, otherOverride.contents)
          existing.keys = distinct([...existing.keys, ...otherOverride.keys])
        } else {
          overrides.push(deepClone(otherOverride))
        }
      }
      for (const key of other.keys) {
        if (!keys.includes(key)) keys.push(key)
      }
    }

    return new ConfigurationModel(contents, keys, overrides)
  }

  toRecord(): ConfigurationRecord {
    const result: ConfigurationRecord = {}
    for (const key of this.keys) {
      const value = this.getValue(key)
      if (value !== undefined) result[key] = deepClone(value)
    }
    return result
  }

  private createOverrideConfigurationModel(identifier: string): ConfigurationModel {
    const overrideContents = this.getContentsForOverrideIdentifier(identifier)
    if (!overrideContents || Object.keys(overrideContents).length === 0) return this

    const contents: ConfigurationRecord = {}
    for (const key of distinct([...Object.keys(this.contents), ...Object.keys(overrideContents)])) {
      const baseValue = this.contents[key]
      const overrideValue = overrideContents[key]
      if (overrideValue !== undefined) {
        if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
          const merged = deepClone(baseValue)
          mergeContents(merged, overrideValue)
          contents[key] = merged
        } else {
          contents[key] = deepClone(overrideValue)
        }
      } else {
        contents[key] = deepClone(baseValue)
      }
    }

    return new ConfigurationModel(contents, [...this.keys], deepClone(this.overrides))
  }

  private getContentsForOverrideIdentifier(identifier: string): ConfigurationRecord | null {
    let identifierOnly: ConfigurationRecord | null = null
    let contents: ConfigurationRecord | null = null
    const mergeOverrideContents = (value: ConfigurationRecord | null) => {
      if (!value) return
      if (!contents) contents = deepClone(value)
      else mergeContents(contents, value)
    }

    for (const override of this.overrides) {
      if (override.identifiers.length === 1 && override.identifiers[0] === identifier) {
        identifierOnly = override.contents
      } else if (override.identifiers.includes(identifier)) {
        mergeOverrideContents(override.contents)
      }
    }
    mergeOverrideContents(identifierOnly)
    return contents
  }
}

export function createConfigurationModel(record: ConfigurationRecord | undefined | null): ConfigurationModel {
  if (!record) return new ConfigurationModel()
  const contents: ConfigurationRecord = {}
  const keys: string[] = []
  const overrides: ConfigurationOverride[] = []

  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue
    addToValueTree(contents, key, deepClone(value))
    if (!keys.includes(key)) keys.push(key)
    if (isOverrideSection(key) && isPlainObject(value)) {
      const identifiers = overrideIdentifiersFromKey(key)
      const overrideContents = toValuesTree(value)
      const overrideKeys = Object.keys(value)
      const existing = overrides.find((override) => arraysEqual(override.identifiers, identifiers))
      if (existing) {
        mergeContents(existing.contents, overrideContents)
        existing.keys = distinct([...existing.keys, ...overrideKeys])
      } else {
        overrides.push({ identifiers, keys: overrideKeys, contents: overrideContents })
      }
    }
  }

  return new ConfigurationModel(contents, keys, overrides)
}

export function mergeConfigurationRecords(...records: Array<ConfigurationRecord | undefined | null>): ConfigurationRecord {
  return records
    .map((record) => createConfigurationModel(record))
    .reduce((previous, current) => previous.merge(current), new ConfigurationModel())
    .toRecord()
}

export function inspectConfigurationRecords<T = unknown>(
  section: string,
  overrideIdentifier: string | null | undefined,
  ...records: Array<ConfigurationRecord | undefined | null>
): ConfigurationInspectValue<T> {
  return records
    .map((record) => createConfigurationModel(record))
    .reduce((previous, current) => previous.merge(current), new ConfigurationModel())
    .inspect<T>(section, overrideIdentifier)
}

export function isOverrideSection(key: string): boolean {
  return OVERRIDE_PROPERTY_REGEX.test(key)
}

export function overrideIdentifiersFromKey(key: string): string[] {
  const identifiers: string[] = []
  if (!isOverrideSection(key)) return identifiers
  OVERRIDE_IDENTIFIER_REGEX.lastIndex = 0
  let match = OVERRIDE_IDENTIFIER_REGEX.exec(key)
  while (match?.length) {
    const identifier = match[1].trim()
    if (identifier) identifiers.push(identifier)
    match = OVERRIDE_IDENTIFIER_REGEX.exec(key)
  }
  return identifiers
}

export function keyFromOverrideIdentifiers(overrideIdentifiers: string[]): string {
  return overrideIdentifiers.reduce((result, overrideIdentifier) => `${result}[${overrideIdentifier}]`, "")
}

export function toValuesTree(properties: ConfigurationRecord): ConfigurationRecord {
  const root: ConfigurationRecord = Object.create(null)
  for (const [key, value] of Object.entries(properties)) {
    addToValueTree(root, key, deepClone(value))
  }
  return root
}

export function addToValueTree(settingsTreeRoot: ConfigurationRecord, key: string, value: unknown): void {
  const segments = key.split(".")
  const last = segments.pop()
  if (!last) return

  let current = settingsTreeRoot
  for (const segment of segments) {
    const existing = current[segment]
    if (existing === undefined) {
      current[segment] = Object.create(null)
    } else if (!isPlainObject(existing)) {
      return
    }
    current = current[segment] as ConfigurationRecord
  }
  current[last] = value
}

export function removeFromValueTree(valueTree: ConfigurationRecord, key: string): void {
  doRemoveFromValueTree(valueTree, key.split("."))
}

export function getConfigurationValue<T = unknown>(
  config: ConfigurationRecord,
  settingPath: string,
  defaultValue?: T,
): T | undefined {
  let current: unknown = config
  for (const component of settingPath.split(".")) {
    if (!isPlainObject(current)) return defaultValue
    current = current[component]
  }
  return current === undefined ? defaultValue : (current as T)
}

function doRemoveFromValueTree(valueTree: unknown, segments: string[]): void {
  if (!isPlainObject(valueTree)) return
  const [first, ...rest] = segments
  if (!first) return
  if (rest.length === 0) {
    delete valueTree[first]
    return
  }
  const value = valueTree[first]
  if (isPlainObject(value)) {
    doRemoveFromValueTree(value, rest)
    if (Object.keys(value).length === 0) delete valueTree[first]
  }
}

function mergeContents(source: ConfigurationRecord, target: ConfigurationRecord): void {
  for (const [key, value] of Object.entries(target)) {
    if (isPlainObject(source[key]) && isPlainObject(value)) {
      mergeContents(source[key] as ConfigurationRecord, value)
    } else {
      source[key] = deepClone(value)
    }
  }
}

function isPlainObject(value: unknown): value is ConfigurationRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function deepClone<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((item) => deepClone(item)) as T
  const clone: ConfigurationRecord = Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype)
  for (const [key, entry] of Object.entries(value as ConfigurationRecord)) {
    clone[key] = deepClone(entry)
  }
  return clone as T
}

function distinct<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function arraysEqual<T>(left: T[], right: T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
