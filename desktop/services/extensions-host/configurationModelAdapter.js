// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\platform\configuration\common\configuration.ts
// - D:\SourceMirror\vscode\src\vs\platform\configuration\common\configurationModels.ts
// - D:\SourceMirror\vscode\src\vs\platform\configuration\common\configurationRegistry.ts

const OVERRIDE_IDENTIFIER_PATTERN = "\\[([^\\]]+)\\]"
const OVERRIDE_IDENTIFIER_REGEX = new RegExp(OVERRIDE_IDENTIFIER_PATTERN, "g")
const OVERRIDE_PROPERTY_REGEX = new RegExp(`^(${OVERRIDE_IDENTIFIER_PATTERN})+$`)

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function deepClone(value) {
  if (!isObject(value) && !Array.isArray(value)) return value
  return JSON.parse(JSON.stringify(value))
}

function deepMerge(base, override) {
  const out = deepClone(base || {})
  for (const [key, value] of Object.entries(override || {})) {
    if (isObject(value) && isObject(out[key])) {
      out[key] = deepMerge(out[key], value)
    } else {
      out[key] = deepClone(value)
    }
  }
  return out
}

function setByPath(source, keyPath, value) {
  const parts = String(keyPath || "").split(".").filter(Boolean)
  if (parts.length === 0) return source
  let cursor = source
  for (const part of parts.slice(0, -1)) {
    if (!isObject(cursor[part])) cursor[part] = {}
    cursor = cursor[part]
  }
  cursor[parts[parts.length - 1]] = deepClone(value)
  return source
}

function deleteByPath(source, keyPath) {
  const parts = String(keyPath || "").split(".").filter(Boolean)
  if (parts.length === 0) return source
  let cursor = source
  for (const part of parts.slice(0, -1)) {
    if (!isObject(cursor[part])) return source
    cursor = cursor[part]
  }
  delete cursor[parts[parts.length - 1]]
  return source
}

function isOverrideKey(key) {
  return typeof key === "string" && OVERRIDE_PROPERTY_REGEX.test(key)
}

function overrideIdentifiersFromKey(key) {
  const identifiers = []
  if (!isOverrideKey(key)) return identifiers
  OVERRIDE_IDENTIFIER_REGEX.lastIndex = 0
  let match = OVERRIDE_IDENTIFIER_REGEX.exec(key)
  while (match && match.length) {
    const identifier = String(match[1] || "").trim()
    if (identifier) identifiers.push(identifier)
    match = OVERRIDE_IDENTIFIER_REGEX.exec(key)
  }
  return identifiers
}

function keyFromOverrideIdentifiers(identifiers) {
  return (Array.isArray(identifiers) ? identifiers : []).reduce(
    (result, identifier) => `${result}[${identifier}]`,
    "",
  )
}

function flatToNested(flatConfig) {
  const nested = {}
  for (const [key, value] of Object.entries(flatConfig || {})) {
    if (isOverrideKey(key)) {
      nested[key] = isObject(value) ? deepMerge(nested[key] || {}, value) : deepClone(value)
    } else if (key.includes(".")) {
      setByPath(nested, key, value)
    } else if (isObject(value)) {
      nested[key] = deepMerge(nested[key] || {}, value)
    } else {
      nested[key] = deepClone(value)
    }
  }
  return nested
}

function collectKeys(value, prefix, keys) {
  if (!isObject(value)) {
    if (prefix) keys.push(prefix)
    return
  }
  for (const [key, child] of Object.entries(value)) {
    collectKeys(child, prefix ? `${prefix}.${key}` : key, keys)
  }
}

function buildConfigModel(config) {
  const contents = {}
  const keys = []
  const overrides = []
  for (const [section, values] of Object.entries(config || {})) {
    if (isOverrideKey(section) && isObject(values)) {
      const overrideContents = flatToNested(values)
      const overrideKeys = []
      collectKeys(overrideContents, "", overrideKeys)
      overrides.push({
        identifiers: overrideIdentifiersFromKey(section),
        contents: overrideContents,
        keys: overrideKeys,
      })
      continue
    }
    if (section.includes(".")) {
      setByPath(contents, section, values)
      keys.push(section)
    } else if (isObject(values)) {
      contents[section] = deepClone(values)
      collectKeys(values, section, keys)
    } else {
      contents[section] = deepClone(values)
      keys.push(section)
    }
  }
  return {
    contents,
    keys: [...new Set(keys)],
    overrides,
  }
}

function buildConfigurationChange(changedKeys) {
  const keys = []
  const overrides = []
  for (const key of changedKeys || []) {
    if (typeof key !== "string" || !key) continue
    if (isOverrideKey(key)) {
      overrides.push(...overrideIdentifiersFromKey(key))
    } else {
      keys.push(key)
    }
  }
  return {
    keys: [...new Set(keys)],
    overrides: [...new Set(overrides)],
  }
}

function toConfigurationNodes(configurationContribution) {
  const roots = Array.isArray(configurationContribution)
    ? configurationContribution
    : [configurationContribution]
  const nodes = []
  const visit = (node) => {
    if (!isObject(node)) return
    nodes.push(node)
    if (Array.isArray(node.allOf)) {
      for (const child of node.allOf) visit(child)
    }
  }
  for (const root of roots) visit(root)
  return nodes
}

function extractConfigurationDefaults(contributions) {
  const defaults = {}
  const list = Array.isArray(contributions) ? contributions : [contributions]
  for (const contribution of list) {
    if (!isObject(contribution)) continue
    if (isObject(contribution.configurationDefaults)) {
      Object.assign(defaults, deepClone(contribution.configurationDefaults))
    }
    for (const config of toConfigurationNodes(contribution.configuration)) {
      if (!isObject(config.properties)) continue
      for (const [key, property] of Object.entries(config.properties)) {
        if (isObject(property) && Object.prototype.hasOwnProperty.call(property, "default")) {
          defaults[key] = deepClone(property.default)
        }
      }
    }
  }
  return defaults
}

module.exports = {
  buildConfigModel,
  buildConfigurationChange,
  deepClone,
  deepMerge,
  deleteByPath,
  extractConfigurationDefaults,
  flatToNested,
  isObject,
  isOverrideKey,
  keyFromOverrideIdentifiers,
  overrideIdentifiersFromKey,
  setByPath,
}
