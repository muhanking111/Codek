/**
 * VS Code-style extension description registry for Codek's extension host.
 *
 * Source parity:
 * - D:\SourceMirror\vscode\src\vs\workbench\services\extensions\common\extensionDescriptionRegistry.ts
 *
 * Codek still scans extensions in the main process before sending EH InitData,
 * so this adapter keeps VS Code's registry/query/dependency-loop behavior while
 * preserving the existing scanExtensions return shape used by local tooling.
 */

const path = require("path")
const {
  ImplicitActivationEvents,
  extensionIdentifierToKey,
} = require("./implicitActivationEvents")

class DeltaExtensionsResult {
  constructor(versionId, removedDueToLooping) {
    this.versionId = versionId
    this.removedDueToLooping = removedDueToLooping
  }
}

function extensionIdentifierValue(identifier) {
  if (!identifier) return ""
  if (typeof identifier === "string") return identifier
  if (identifier.value) return String(identifier.value)
  if (identifier._lower) return String(identifier._lower)
  return ""
}

function extensionLocationLastSegment(extensionDescription) {
  const rawPath = extensionDescription?.extensionLocation?.path
    || extensionDescription?.extensionLocation
    || extensionDescription?.installPath
    || extensionIdentifierValue(extensionDescription?.identifier)
  return path.posix.basename(String(rawPath || "").replace(/\\/g, "/"))
}

function extensionCmp(a, b) {
  const aSortBucket = a?.isBuiltin ? 0 : a?.isUnderDevelopment ? 2 : 1
  const bSortBucket = b?.isBuiltin ? 0 : b?.isUnderDevelopment ? 2 : 1
  if (aSortBucket !== bSortBucket) return aSortBucket - bSortBucket

  const aLastSegment = extensionLocationLastSegment(a)
  const bLastSegment = extensionLocationLastSegment(b)
  if (aLastSegment < bLastSegment) return -1
  if (aLastSegment > bLastSegment) return 1
  return 0
}

function removeExtensions(extensionDescriptions, toRemove) {
  const toRemoveSet = new Set((toRemove || []).map(extensionIdentifierToKey).filter(Boolean))
  return (extensionDescriptions || []).filter((extensionDescription) => {
    return !toRemoveSet.has(extensionIdentifierToKey(extensionDescription?.identifier))
  })
}

function buildExtensionByIdMap(extensionDescriptions) {
  const byId = new Map()
  for (const extensionDescription of extensionDescriptions || []) {
    const value = extensionIdentifierValue(extensionDescription?.identifier)
    const key = extensionIdentifierToKey(extensionDescription?.identifier)
    if (value) byId.set(value, extensionDescription)
    if (key) byId.set(key, extensionDescription)
  }
  return byId
}

function objectFromMap(map) {
  const result = Object.create(null)
  for (const [key, value] of map) {
    result[key] = value.slice(0)
  }
  return result
}

class ExtensionDescriptionRegistry {
  static isHostExtension(extensionId, myRegistry, globalRegistry) {
    if (myRegistry.getExtensionDescription(extensionId)) {
      return false
    }
    const extensionDescription = globalRegistry.getExtensionDescription(extensionId)
    if (!extensionDescription) {
      return false
    }
    return Boolean((extensionDescription.main || extensionDescription.browser) && extensionDescription.api === "none")
  }

  static findLoopingExtensions(extensionDescriptions) {
    const graph = new DependencyGraph()
    const descriptions = new Map()

    for (const extensionDescription of extensionDescriptions || []) {
      const id = extensionIdentifierToKey(extensionDescription?.identifier)
      if (!id) continue
      descriptions.set(id, extensionDescription)
      if (Array.isArray(extensionDescription.extensionDependencies)) {
        for (const dependencyId of extensionDescription.extensionDependencies) {
          graph.addArc(id, extensionIdentifierToKey(dependencyId))
        }
      }
    }

    const good = new Set()
    for (const id of graph.getNodes()) {
      if (graph.getArcs(id).length === 0) {
        good.add(id)
      }
    }

    const nodes = graph.getNodes().filter((id) => !good.has(id))
    let madeProgress
    do {
      madeProgress = false
      for (let index = 0; index < nodes.length; index += 1) {
        const id = nodes[index]
        if (graph.hasOnlyGoodArcs(id, good)) {
          nodes.splice(index, 1)
          index -= 1
          good.add(id)
          madeProgress = true
        }
      }
    } while (madeProgress)

    return nodes
      .map((id) => descriptions.get(id))
      .filter(Boolean)
  }

  constructor(activationEventsReader = ImplicitActivationEvents, extensionDescriptions = []) {
    this._activationEventsReader = activationEventsReader
    this._versionId = 0
    this._extensionDescriptions = Array.isArray(extensionDescriptions) ? extensionDescriptions.slice(0) : []
    this._initialize()
  }

  _initialize() {
    this._extensionDescriptions.sort(extensionCmp)
    this._extensionsMap = new Map()
    this._extensionsArr = []
    this._activationMap = new Map()
    this._activationEventsByExtensionId = new Map()

    for (const extensionDescription of this._extensionDescriptions) {
      const extensionKey = extensionIdentifierToKey(extensionDescription?.identifier)
      if (!extensionKey) continue
      if (this._extensionsMap.has(extensionKey)) {
        console.error(`Extension \`${extensionIdentifierValue(extensionDescription.identifier)}\` is already registered`)
        continue
      }

      this._extensionsMap.set(extensionKey, extensionDescription)
      this._extensionsArr.push(extensionDescription)

      const activationEvents = this._readActivationEvents(extensionDescription)
      this._activationEventsByExtensionId.set(extensionKey, activationEvents)
      for (const activationEvent of activationEvents) {
        if (!this._activationMap.has(activationEvent)) {
          this._activationMap.set(activationEvent, [])
        }
        this._activationMap.get(activationEvent).push(extensionDescription)
      }
    }
  }

  _readActivationEvents(extensionDescription) {
    if (!this._activationEventsReader || typeof this._activationEventsReader.readActivationEvents !== "function") {
      return Array.isArray(extensionDescription?.activationEvents) ? extensionDescription.activationEvents.slice(0) : []
    }
    const activationEvents = this._activationEventsReader.readActivationEvents(extensionDescription)
    return Array.isArray(activationEvents) ? activationEvents.slice(0) : []
  }

  set(extensionDescriptions) {
    this._extensionDescriptions = Array.isArray(extensionDescriptions) ? extensionDescriptions.slice(0) : []
    this._initialize()
    this._versionId += 1
    return { versionId: this._versionId }
  }

  deltaExtensions(toAdd, toRemove) {
    this._extensionDescriptions = removeExtensions(this._extensionDescriptions, toRemove)
    this._extensionDescriptions = this._extensionDescriptions.concat(Array.isArray(toAdd) ? toAdd : [])

    const looping = ExtensionDescriptionRegistry.findLoopingExtensions(this._extensionDescriptions)
    this._extensionDescriptions = removeExtensions(
      this._extensionDescriptions,
      looping.map((extensionDescription) => extensionDescription.identifier),
    )

    this._initialize()
    this._versionId += 1
    return new DeltaExtensionsResult(this._versionId, looping)
  }

  containsActivationEvent(activationEvent) {
    return this._activationMap.has(activationEvent)
  }

  containsExtension(extensionId) {
    return this._extensionsMap.has(extensionIdentifierToKey(extensionId))
  }

  getExtensionDescriptionsForActivationEvent(activationEvent) {
    const extensions = this._activationMap.get(activationEvent)
    return extensions ? extensions.slice(0) : []
  }

  getAllExtensionDescriptions() {
    return this._extensionsArr.slice(0)
  }

  getSnapshot() {
    return {
      versionId: this._versionId,
      extensions: this.getAllExtensionDescriptions(),
    }
  }

  getExtensionDescription(extensionId) {
    return this._extensionsMap.get(extensionIdentifierToKey(extensionId))
  }

  getExtensionDescriptionByUUID(uuid) {
    return this._extensionsArr.find((extensionDescription) => extensionDescription.uuid === uuid)
  }

  getExtensionDescriptionByIdOrUUID(extensionId, uuid) {
    return this.getExtensionDescription(extensionId)
      || (uuid ? this.getExtensionDescriptionByUUID(uuid) : undefined)
  }

  getActivationEvents(extensionId) {
    const activationEvents = this._activationEventsByExtensionId.get(extensionIdentifierToKey(extensionId))
    return activationEvents ? activationEvents.slice(0) : []
  }

  createActivationEventsMap(options = {}) {
    const includeOriginalKeys = options.includeOriginalKeys === true
    const result = Object.create(null)

    for (const extensionDescription of this._extensionsArr) {
      const key = extensionIdentifierToKey(extensionDescription.identifier)
      const value = extensionIdentifierValue(extensionDescription.identifier)
      const activationEvents = this.getActivationEvents(key)
      if (activationEvents.length === 0) continue
      result[key] = activationEvents
      if (includeOriginalKeys && value && value !== key) {
        result[value] = activationEvents.slice(0)
      }
    }

    return result
  }

  createActivationEventsByEventMap(options = {}) {
    if (options.values === "descriptions") {
      return objectFromMap(this._activationMap)
    }

    const result = Object.create(null)
    for (const [activationEvent, extensionDescriptions] of this._activationMap) {
      result[activationEvent] = extensionDescriptions.map((extensionDescription) => {
        return extensionIdentifierValue(extensionDescription.identifier)
      })
    }
    return result
  }
}

class DependencyGraph {
  constructor() {
    this._arcs = new Map()
    this._nodesSet = new Set()
    this._nodesArr = []
  }

  addNode(id) {
    if (!id || this._nodesSet.has(id)) return
    this._nodesSet.add(id)
    this._nodesArr.push(id)
  }

  addArc(from, to) {
    if (!from || !to) return
    this.addNode(from)
    this.addNode(to)
    if (this._arcs.has(from)) {
      this._arcs.get(from).push(to)
    } else {
      this._arcs.set(from, [to])
    }
  }

  getArcs(id) {
    return this._arcs.get(id) || []
  }

  hasOnlyGoodArcs(id, good) {
    return this.getArcs(id).every((dependencyId) => good.has(dependencyId))
  }

  getNodes() {
    return this._nodesArr.slice(0)
  }
}

function createExtensionScanResult(extensionDescriptions, options = {}) {
  const activationEventsReader = options.activationEventsReader || ImplicitActivationEvents
  const registry = new ExtensionDescriptionRegistry(activationEventsReader, [])
  const delta = registry.deltaExtensions(Array.isArray(extensionDescriptions) ? extensionDescriptions : [], [])
  const allExtensions = registry.getAllExtensionDescriptions()

  for (const extensionDescription of allExtensions) {
    extensionDescription.activationEvents = registry.getActivationEvents(extensionDescription.identifier)
  }

  return {
    allExtensions,
    activationEvents: registry.createActivationEventsMap({ includeOriginalKeys: true }),
    activationEventsByEvent: registry.createActivationEventsByEventMap(),
    byId: buildExtensionByIdMap(allExtensions),
    registry,
    versionId: delta.versionId,
    removedDueToLooping: delta.removedDueToLooping,
  }
}

module.exports = {
  DeltaExtensionsResult,
  ExtensionDescriptionRegistry,
  buildExtensionByIdMap,
  createExtensionScanResult,
  extensionCmp,
  extensionIdentifierValue,
  removeExtensions,
}
