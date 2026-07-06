import { SETTINGS_SCHEMA, type SettingDefinition, type SettingScope } from "./settingsSchema"

export const enum ConfigurationScope {
  APPLICATION = 1,
  MACHINE = 2,
  APPLICATION_MACHINE = 3,
  WINDOW = 4,
  RESOURCE = 5,
  LANGUAGE_OVERRIDABLE = 6,
  MACHINE_OVERRIDABLE = 7,
}

export interface ConfigurationPropertySchema {
  type?: string | string[]
  default?: unknown
  description?: string
  markdownDescription?: string
  scope?: ConfigurationScope
  enum?: unknown[]
  enumItemLabels?: string[]
  tags?: string[]
  restricted?: boolean
  policy?: {
    name: string
  }
  included?: boolean
  section?: {
    id?: string
    title?: string
  }
}

export interface ConfigurationNode {
  id?: string
  title?: string
  properties?: Record<string, ConfigurationPropertySchema>
  allOf?: ConfigurationNode[]
  scope?: ConfigurationScope
  restrictedProperties?: string[]
}

export interface ConfigurationRegistryUpdateEvent {
  properties: ReadonlySet<string>
  defaultsOverrides?: boolean
}

export type ConfigurationRegistryListener = (event: ConfigurationRegistryUpdateEvent) => void

const SCOPE_PRIORITY: SettingScope[] = ["language", "folder", "workspace", "application", "user"]

export class ConfigurationRegistry {
  private readonly configurationProperties = new Map<string, ConfigurationPropertySchema>()
  private readonly excludedConfigurationProperties = new Map<string, ConfigurationPropertySchema>()
  private readonly policyConfigurations = new Map<string, string>()
  private readonly configurationNodes: ConfigurationNode[] = []
  private readonly defaultOverrides = new Map<string, unknown>()
  private readonly listeners = new Set<ConfigurationRegistryListener>()

  constructor(settingsSchema: SettingDefinition[] = SETTINGS_SCHEMA) {
    this.registerConfiguration(schemaToConfigurationNode(settingsSchema), false)
  }

  onDidUpdateConfiguration(listener: ConfigurationRegistryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  registerConfiguration(configuration: ConfigurationNode, emit = true): ConfigurationNode {
    const properties = new Set<string>()
    this.doRegisterConfiguration(configuration, true, properties, ConfigurationScope.WINDOW, [], true)
    if (emit) this.emit([...properties])
    return configuration
  }

  registerConfigurations(configurations: ConfigurationNode[], validate = true): void {
    const properties = new Set<string>()
    for (const configuration of configurations) {
      this.doRegisterConfiguration(configuration, validate, properties, ConfigurationScope.WINDOW, [], true)
    }
    this.emit([...properties])
  }

  deregisterConfigurations(configurations: ConfigurationNode[]): void {
    const properties = new Set<string>()
    for (const configuration of configurations) {
      this.doDeregisterConfiguration(configuration, properties)
      const index = this.configurationNodes.indexOf(configuration)
      if (index >= 0) this.configurationNodes.splice(index, 1)
    }
    this.emit([...properties])
  }

  registerDefaultConfigurations(defaultConfigurations: Array<{ overrides: Record<string, unknown> }>): void {
    const properties: string[] = []
    for (const defaultConfiguration of defaultConfigurations) {
      for (const [key, value] of Object.entries(defaultConfiguration.overrides)) {
        this.defaultOverrides.set(key, value)
        properties.push(key)
      }
    }
    this.emit(properties, true)
  }

  getConfigurations(): ConfigurationNode[] {
    return this.configurationNodes.map((node) => ({
      ...node,
      properties: node.properties ? { ...node.properties } : undefined,
    }))
  }

  getConfigurationProperties(): Record<string, ConfigurationPropertySchema> {
    return Object.fromEntries(
      [...this.configurationProperties.entries()].map(([key, property]) => [
        key,
        this.withDefaultOverride(key, property),
      ]),
    )
  }

  getExcludedConfigurationProperties(): Record<string, ConfigurationPropertySchema> {
    return Object.fromEntries([...this.excludedConfigurationProperties.entries()].map(([key, property]) => [key, { ...property }]))
  }

  getPolicyConfigurations(): Map<string, string> {
    return new Map(this.policyConfigurations)
  }

  getConfigurationDefaultsOverrides(): Map<string, { value: unknown }> {
    return new Map([...this.defaultOverrides.entries()].map(([key, value]) => [key, { value }]))
  }

  getPropertyScope(key: string): ConfigurationScope | undefined {
    return this.configurationProperties.get(key)?.scope
  }

  validateProperty(property: string, schema: ConfigurationPropertySchema): string | null {
    if (!property.trim()) return "Cannot register an empty property"
    if (/^\[.*\]$/.test(property)) {
      return `Cannot register '${property}'. This matches the language-specific override property pattern.`
    }
    if (this.configurationProperties.has(property) || this.excludedConfigurationProperties.has(property)) {
      return `Cannot register '${property}'. This property is already registered.`
    }
    const policyName = schema.policy?.name
    if (policyName && this.policyConfigurations.has(policyName)) {
      return `Cannot register '${property}'. The associated policy ${policyName} is already registered with ${this.policyConfigurations.get(policyName)}.`
    }
    return null
  }

  private doRegisterConfiguration(
    configuration: ConfigurationNode,
    validate: boolean,
    properties: Set<string>,
    inheritedScope = ConfigurationScope.WINDOW,
    inheritedRestrictedProperties: string[] = [],
    trackNode = false,
  ): void {
    if (trackNode) this.configurationNodes.push(configuration)
    const nodeScope = configuration.scope ?? inheritedScope
    const restrictedProperties = configuration.restrictedProperties ?? inheritedRestrictedProperties
    for (const [key, schema] of Object.entries(configuration.properties ?? {})) {
      if (validate && this.validateProperty(key, schema)) continue
      const property = this.normalizeProperty(key, schema, configuration, nodeScope, restrictedProperties)
      properties.add(key)
      const policyName = property.policy?.name
      if (property.included === false) {
        this.excludedConfigurationProperties.set(key, property)
        if (policyName) this.policyConfigurations.set(policyName, key)
        continue
      }
      this.configurationProperties.set(key, property)
      if (policyName) this.policyConfigurations.set(policyName, key)
    }
    for (const child of configuration.allOf ?? []) {
      this.doRegisterConfiguration(child, validate, properties, nodeScope, restrictedProperties)
    }
  }

  private doDeregisterConfiguration(configuration: ConfigurationNode, properties: Set<string>): void {
    for (const key of Object.keys(configuration.properties ?? {})) {
      properties.add(key)
      const property = this.configurationProperties.get(key) ?? this.excludedConfigurationProperties.get(key)
      const policyName = property?.policy?.name
      if (policyName) this.policyConfigurations.delete(policyName)
      this.configurationProperties.delete(key)
      this.excludedConfigurationProperties.delete(key)
    }
    for (const child of configuration.allOf ?? []) {
      this.doDeregisterConfiguration(child, properties)
    }
  }

  private normalizeProperty(
    key: string,
    property: ConfigurationPropertySchema,
    configuration: ConfigurationNode,
    scope: ConfigurationScope,
    restrictedProperties: string[],
  ): ConfigurationPropertySchema {
    return {
      ...property,
      scope: property.scope ?? scope,
      restricted: property.restricted ?? restrictedProperties.includes(key),
      section: property.section ?? {
        id: configuration.id,
        title: configuration.title,
      },
    }
  }

  private withDefaultOverride(key: string, property: ConfigurationPropertySchema): ConfigurationPropertySchema {
    return this.defaultOverrides.has(key)
      ? { ...property, default: this.defaultOverrides.get(key) }
      : { ...property }
  }

  private emit(properties: string[], defaultsOverrides = false): void {
    const event = { properties: new Set(properties), defaultsOverrides }
    for (const listener of this.listeners) listener(event)
  }
}

export const configurationRegistry = new ConfigurationRegistry()

export function getDefaultSettingsFromConfigurationRegistry(
  registry: ConfigurationRegistry = configurationRegistry,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const [key, property] of Object.entries(registry.getConfigurationProperties())) {
    defaults[key] = property.default
  }
  return defaults
}

function schemaToConfigurationNode(schema: SettingDefinition[]): ConfigurationNode {
  return {
    id: "codek",
    title: "Codek",
    properties: Object.fromEntries(schema.map((setting) => [setting.key, settingToProperty(setting)])),
  }
}

function settingToProperty(setting: SettingDefinition): ConfigurationPropertySchema {
  return {
    type: controlToJsonType(setting.control),
    default: setting.defaultValue,
    description: setting.description,
    markdownDescription: setting.description,
    enum: setting.options?.map((option) => option.value),
    enumItemLabels: setting.options?.map((option) => option.label),
    scope: settingScopesToConfigurationScope(setting.scope),
    section: {
      id: setting.group,
      title: setting.title,
    },
  }
}

function settingScopesToConfigurationScope(scopes: SettingScope[]): ConfigurationScope {
  const strongest = SCOPE_PRIORITY.find((scope) => scopes.includes(scope))
  if (strongest === "language") return ConfigurationScope.LANGUAGE_OVERRIDABLE
  if (strongest === "folder") return ConfigurationScope.RESOURCE
  if (strongest === "workspace") return ConfigurationScope.WINDOW
  if (strongest === "application") return ConfigurationScope.APPLICATION
  return ConfigurationScope.WINDOW
}

function controlToJsonType(control: SettingDefinition["control"]): string {
  if (control === "boolean") return "boolean"
  if (control === "number") return "number"
  if (control === "json") return "object"
  return "string"
}
