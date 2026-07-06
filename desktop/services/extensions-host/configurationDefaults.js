const { extractConfigurationDefaults } = require("./mainThread/mainThreadConfiguration")
const { getExtensionId } = require("./extensionScanner")

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function buildExtensionConfigurationDefaults(extensions = []) {
  const defaults = {}
  const sources = []

  for (const extension of Array.isArray(extensions) ? extensions : []) {
    if (!isObject(extension) || extension.enabled === false || !isObject(extension.contributes)) continue

    const extracted = extractConfigurationDefaults(extension.contributes)
    const keys = Object.keys(extracted)
    if (keys.length === 0) continue

    Object.assign(defaults, extracted)
    sources.push({
      extensionId: getExtensionId(extension),
      displayName: extension.displayName || extension.name || getExtensionId(extension),
      keys,
    })
  }

  return {
    defaults,
    sources,
    summary: {
      extensions: sources.length,
      keys: Object.keys(defaults).length,
    },
  }
}

module.exports = {
  buildExtensionConfigurationDefaults,
}
