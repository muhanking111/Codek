const { EventEmitter } = require("events")

function cloneLazy(lazy) {
  return lazy && typeof lazy === "object" ? { ...lazy } : undefined
}

function normalizeCollection(collection, defaults = {}) {
  const id = String(collection?.id || "").trim()
  const label = String(collection?.label || id).trim()
  if (!id || !label) return null
  return {
    ...defaults,
    ...collection,
    id,
    label,
    source: typeof collection.source === "string" && collection.source.trim()
      ? collection.source.trim()
      : defaults.source,
    scope: typeof collection.scope === "string" && collection.scope.trim()
      ? collection.scope.trim()
      : defaults.scope,
    order: Number.isFinite(Number(collection.order ?? defaults.order))
      ? Number(collection.order ?? defaults.order)
      : 0,
    lazy: cloneLazy(collection.lazy || defaults.lazy),
  }
}

function collectionSnapshot(collection, serverNames = []) {
  return {
    id: collection.id,
    label: collection.label,
    source: collection.source,
    scope: collection.scope,
    order: collection.order,
    lazy: cloneLazy(collection.lazy),
    serverNames: [...serverNames],
  }
}

class McpRegistryServiceAdapter {
  constructor({ accessProvider = () => "all" } = {}) {
    this.accessProvider = accessProvider
    this.collections = new Map()
    this.collectionServers = new Map()
    this.delegates = []
    this.events = new EventEmitter()
  }

  onDidChangeCollections(listener) {
    this.events.on("collections", listener)
    return { dispose: () => this.events.off("collections", listener) }
  }

  onDidChangeDelegates(listener) {
    this.events.on("delegates", listener)
    return { dispose: () => this.events.off("delegates", listener) }
  }

  emitCollections(reason, detail = {}) {
    this.events.emit("collections", {
      reason,
      ...detail,
      collections: this.listCollections(),
    })
  }

  emitDelegates(reason) {
    this.events.emit("delegates", {
      reason,
      delegates: this.listDelegates(),
    })
  }

  registerCollection(collection, options = {}) {
    const normalized = normalizeCollection(collection)
    if (!normalized) throw new Error("invalid MCP collection")
    const previous = this.collections.get(normalized.id)
    if (previous && !previous.lazy && !options.replace) {
      return { dispose() {} }
    }
    this.collections.set(normalized.id, normalized)
    if (!this.collectionServers.has(normalized.id)) {
      this.collectionServers.set(normalized.id, new Set())
    }
    this.emitCollections(previous ? "replace-collection" : "add-collection", { collectionId: normalized.id })
    return {
      dispose: () => {
        void this.clearCollection(normalized.id)
      },
    }
  }

  async clearCollection(collectionId, clearServers = async () => undefined) {
    const id = String(collectionId || "").trim()
    if (!id) return
    const names = this.collectionServers.get(id)
    this.collectionServers.delete(id)
    const removed = this.collections.delete(id)
    if (names) await clearServers(names)
    if (removed || names) this.emitCollections("remove-collection", { collectionId: id })
  }

  addServerToCollection(collectionId, serverName) {
    const id = String(collectionId || "").trim()
    const name = String(serverName || "").trim()
    if (!id || !name) return
    if (!this.collectionServers.has(id)) this.collectionServers.set(id, new Set())
    const names = this.collectionServers.get(id)
    const previousSize = names.size
    names.add(name)
    if (previousSize !== names.size) {
      this.emitCollections("add-server", { collectionId: id, serverName: name })
    }
  }

  removeServer(serverName) {
    const name = String(serverName || "").trim()
    if (!name) return
    let changed = false
    for (const names of this.collectionServers.values()) {
      if (names.delete(name)) changed = true
    }
    if (changed) this.emitCollections("remove-server", { serverName: name })
  }

  listCollections() {
    if (this.accessProvider() === "none") return []
    return [...this.collections.values()]
      .sort((left, right) => Number(left.order || 0) - Number(right.order || 0))
      .map((collection) => collectionSnapshot(collection, this.collectionServers.get(collection.id) || []))
  }

  getCollectionForServer(serverName) {
    const name = String(serverName || "").trim()
    if (!name) return null
    for (const [collectionId, names] of this.collectionServers) {
      if (names.has(name)) return this.collections.get(collectionId) || null
    }
    return null
  }

  registerDelegate(delegate) {
    if (!delegate || typeof delegate !== "object" || typeof delegate.start !== "function") {
      throw new Error("invalid MCP delegate start")
    }
    const normalized = {
      priority: Number.isFinite(Number(delegate.priority)) ? Number(delegate.priority) : 0,
      waitForInitialProviderPromises: typeof delegate.waitForInitialProviderPromises === "function"
        ? delegate.waitForInitialProviderPromises
        : async () => undefined,
      canStart: typeof delegate.canStart === "function" ? delegate.canStart : () => false,
      substituteVariables: typeof delegate.substituteVariables === "function"
        ? delegate.substituteVariables
        : async (_definition, launch) => launch,
      start: delegate.start,
    }
    this.delegates.push(normalized)
    this.delegates.sort((left, right) => right.priority - left.priority)
    this.emitDelegates("add-delegate")
    return {
      dispose: () => {
        const index = this.delegates.indexOf(normalized)
        if (index >= 0) {
          this.delegates.splice(index, 1)
          this.emitDelegates("remove-delegate")
        }
      },
    }
  }

  listDelegates() {
    return this.delegates.map((delegate) => ({ priority: delegate.priority }))
  }

  getDelegates() {
    return [...this.delegates]
  }
}

module.exports = {
  McpRegistryServiceAdapter,
  normalizeCollection,
}
