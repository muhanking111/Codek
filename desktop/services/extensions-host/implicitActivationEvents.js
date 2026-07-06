/**
 * VS Code-style implicit activation events for extension contributions.
 *
 * Source parity:
 * - D:\SourceMirror\vscode\src\vs\platform\extensionManagement\common\implicitActivationEvents.ts
 * - D:\SourceMirror\vscode\src\vs\workbench\services\extensions\common\extensionsRegistry.ts
 *
 * Codek does not have the full renderer ExtensionsRegistry DI yet, so this
 * adapter keeps the same readActivationEvents/createActivationEventsMap
 * boundary and registers the contribution generators that Codek currently
 * exposes to the extension host.
 */

function extensionIdentifierToKey(identifier) {
  if (!identifier) return ""
  if (typeof identifier === "string") return identifier.toLowerCase()
  if (identifier._lower) return String(identifier._lower).toLowerCase()
  if (identifier.value) return String(identifier.value).toLowerCase()
  return ""
}

function asContributionArray(value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function* generateByProperty(contributions, property, prefix) {
  for (const contribution of contributions) {
    const value = contribution?.[property]
    if (typeof value === "string" && value.trim()) {
      yield `${prefix}:${value}`
    }
  }
}

function* generateCommands(contributions) {
  yield* generateByProperty(contributions, "command", "onCommand")
}

function* generateLanguages(contributions) {
  for (const contribution of contributions) {
    if (typeof contribution?.id === "string" && contribution.id.trim() && contribution.configuration) {
      yield `onLanguage:${contribution.id}`
    }
  }
}

function* generateViews(contributions) {
  for (const viewLocations of contributions) {
    if (!viewLocations || typeof viewLocations !== "object") continue
    for (const descriptors of Object.values(viewLocations)) {
      for (const descriptor of asContributionArray(descriptors)) {
        if (typeof descriptor?.id === "string" && descriptor.id.trim()) {
          yield `onView:${descriptor.id}`
        }
      }
    }
  }
}

function* generateTerminal(contributions) {
  for (const contribution of contributions) {
    for (const profile of asContributionArray(contribution?.profiles)) {
      if (typeof profile?.id === "string" && profile.id.trim()) {
        yield `onTerminalProfile:${profile.id}`
      }
    }
  }
}

function* generateMcp(contributions) {
  yield* generateByProperty(contributions, "id", "onMcpCollection")
}

function uniqueActivationEvents(activationEvents) {
  const result = []
  const seen = new Set()
  for (const activationEvent of activationEvents || []) {
    if (seen.has(activationEvent)) continue
    seen.add(activationEvent)
    result.push(activationEvent)
  }
  return result
}

class ImplicitActivationEventsAdapter {
  constructor() {
    this._generators = new Map()
    this._cache = new WeakMap()
  }

  register(extensionPointName, generator) {
    if (!extensionPointName || typeof generator !== "function") return
    this._generators.set(extensionPointName, generator)
  }

  readActivationEvents(extensionDescription) {
    if (!extensionDescription || typeof extensionDescription !== "object") return []
    if (!this._cache.has(extensionDescription)) {
      this._cache.set(extensionDescription, this._readActivationEvents(extensionDescription))
    }
    return this._cache.get(extensionDescription)
  }

  createActivationEventsMap(extensionDescriptions) {
    const result = Object.create(null)
    for (const extensionDescription of extensionDescriptions || []) {
      const activationEvents = this.readActivationEvents(extensionDescription)
      if (activationEvents.length > 0) {
        result[extensionIdentifierToKey(extensionDescription.identifier)] = activationEvents
      }
    }
    return result
  }

  _readActivationEvents(desc) {
    if (typeof desc.main === "undefined" && typeof desc.browser === "undefined") {
      return []
    }

    const activationEvents = Array.isArray(desc.activationEvents) ? desc.activationEvents.slice(0) : []
    for (let index = 0; index < activationEvents.length; index += 1) {
      if (activationEvents[index] === "onUri") {
        activationEvents[index] = `onUri:${extensionIdentifierToKey(desc.identifier)}`
      }
    }

    if (!desc.contributes || typeof desc.contributes !== "object") {
      return uniqueActivationEvents(activationEvents)
    }

    for (const [extensionPointName, contribution] of Object.entries(desc.contributes)) {
      const generator = this._generators.get(extensionPointName)
      if (!generator) continue
      try {
        activationEvents.push(...generator(asContributionArray(contribution)))
      } catch (err) {
        console.error(`[implicit-activation] ${extensionPointName}: ${err.message}`)
      }
    }

    return uniqueActivationEvents(activationEvents)
  }
}

const ImplicitActivationEvents = new ImplicitActivationEventsAdapter()

ImplicitActivationEvents.register("commands", generateCommands)
ImplicitActivationEvents.register("languages", generateLanguages)
ImplicitActivationEvents.register("views", generateViews)
ImplicitActivationEvents.register("authentication", function* (contributions) {
  yield* generateByProperty(contributions, "id", "onAuthenticationRequest")
})
ImplicitActivationEvents.register("taskDefinitions", function* (contributions) {
  yield* generateByProperty(contributions, "type", "onTaskType")
})
ImplicitActivationEvents.register("terminal", generateTerminal)
ImplicitActivationEvents.register("terminalQuickFixes", function* (contributions) {
  yield* generateByProperty(contributions, "id", "onTerminalQuickFixRequest")
})
ImplicitActivationEvents.register("customEditors", function* (contributions) {
  yield* generateByProperty(contributions, "viewType", "onCustomEditor")
})
ImplicitActivationEvents.register("notebooks", function* (contributions) {
  yield* generateByProperty(contributions, "type", "onNotebookSerializer")
})
ImplicitActivationEvents.register("notebookRenderer", function* (contributions) {
  yield* generateByProperty(contributions, "id", "onRenderer")
})
ImplicitActivationEvents.register("debugVisualizers", function* (contributions) {
  yield* generateByProperty(contributions, "id", "onDebugVisualizer")
})
ImplicitActivationEvents.register("chatOutputRenderers", function* (contributions) {
  yield* generateByProperty(contributions, "viewType", "onChatOutputRenderer")
})
ImplicitActivationEvents.register("chatParticipants", function* (contributions) {
  yield* generateByProperty(contributions, "id", "onChatParticipant")
})
ImplicitActivationEvents.register("chatSessions", function* (contributions) {
  yield* generateByProperty(contributions, "type", "onChatSession")
})
ImplicitActivationEvents.register("chatContext", function* (contributions) {
  yield* generateByProperty(contributions, "id", "onChatContextProvider")
})
ImplicitActivationEvents.register("languageModelTools", function* (contributions) {
  yield* generateByProperty(contributions, "name", "onLanguageModelTool")
})
ImplicitActivationEvents.register("languageModels", function* (contributions) {
  yield* generateByProperty(contributions, "vendor", "onLanguageModelChatProvider")
})
ImplicitActivationEvents.register("walkthroughs", function* (contributions) {
  yield* generateByProperty(contributions, "id", "onWalkthrough")
})
ImplicitActivationEvents.register("mcpServerDefinitionProviders", generateMcp)

module.exports = {
  ImplicitActivationEvents,
  ImplicitActivationEventsAdapter,
  asContributionArray,
  extensionIdentifierToKey,
}
