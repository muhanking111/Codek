/**
 * MainThreadTreeViews — VS Code-compatible TreeDataProvider bridge.
 *
 * The Extension Host owns providers and tree item handles. Main thread keeps a
 * lightweight view registry and forwards renderable deltas to the renderer.
 */

const MAIN_THREAD_TREE_VIEWS_NID = 23

const treeViews = new Map()

function clonePlain(value, seen = new WeakSet()) {
  if (value == null) return value
  if (Buffer.isBuffer(value)) return { type: "Buffer", data: Array.from(value) }
  if (value instanceof Uint8Array) return Array.from(value)
  if (Array.isArray(value)) return value.map((item) => clonePlain(item, seen))
  if (typeof value !== "object") return value
  if (seen.has(value)) return undefined
  seen.add(value)

  const clone = {}
  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested !== "function") clone[key] = clonePlain(nested, seen)
  }
  return clone
}

function normalizeTreeItem(item) {
  if (!item || typeof item !== "object") return item
  return clonePlain(item)
}

function normalizeRefreshItems(itemsToRefresh) {
  if (!itemsToRefresh || typeof itemsToRefresh !== "object") return undefined
  const entries = Object.entries(itemsToRefresh)
    .map(([handle, item]) => [handle, normalizeTreeItem(item)])
    .filter(([handle]) => typeof handle === "string" && handle)
  return Object.fromEntries(entries)
}

function listTreeViews() {
  return Array.from(treeViews.values()).map((view) => ({
    id: view.id,
    options: clonePlain(view.options),
    message: view.message,
    title: view.title,
    description: view.description,
    badge: clonePlain(view.badge),
    disposed: view.disposed === true,
  }))
}

function getTreeViewsOwnerEvidence() {
  return {
    schemaVersion: 1,
    source: "mainThreadTreeViews",
    vscodeSourceEntrypoints: {
      mainThreadTreeViews: "src/vs/workbench/api/browser/mainThreadTreeViews.ts",
      viewsRegistry: "src/vs/workbench/common/views.ts",
      viewsService: "src/vs/workbench/services/views/common/viewsService.ts",
    },
    treeViewBridgeOwner: {
      owner: "MainThreadTreeViews",
      connected: true,
      stateSource: "desktopExtensionHost/mainThreadTreeViews.treeViews",
      registeredTreeViewIds: Array.from(treeViews.keys()),
      rendererChannels: [
        "ext-host:tree-view-register",
        "ext-host:tree-view-refresh",
        "ext-host:tree-view-reveal",
        "ext-host:tree-view-message",
        "ext-host:tree-view-title",
        "ext-host:tree-view-badge",
        "ext-host:tree-view-dispose",
      ],
      noSecondTreeState: true,
    },
    treeDataSourceOwner: {
      owner: "ExtHostTreeViews.registerTreeDataProvider",
      connected: true,
      stateSource: "extensionHostRpc/MainThreadTreeViews.$registerTreeViewDataProvider",
      providerSideEffectsStarted: false,
      reason: "Main thread stores provider metadata and forwards clone-safe deltas; tests use RPC fixtures instead of real extension tree providers.",
    },
    viewsServiceOwner: {
      owner: "frontend ViewsService",
      connected: false,
      stateSource: "renderer workbenchLayoutService",
      reason: "Desktop bridge does not mutate renderer view layout state directly.",
      noSecondViewState: true,
    },
    viewContainerOwner: {
      owner: "frontend workbench/viewRegistry",
      connected: false,
      stateSource: "renderer workbench/viewRegistry",
      reason: "View container descriptors remain owned by renderer registry.",
      noSecondViewState: true,
    },
    activationOwner: {
      owner: "ViewsService.openView",
      connected: false,
      stateSource: "renderer workbenchLayoutService",
      reason: "ActivityBar/Views UI activation is outside this desktop bridge evidence lane.",
      noSecondViewState: true,
    },
    remainingViewsUiOwnerGap: [
      "ActivityBar/Views UI owner remains in App.vue/generic shell and is intentionally not wired by this backend evidence thread.",
    ],
    constraints: {
      noSecondViewState: true,
      noSecondTreeState: true,
      runtimeSourceMirrorDependency: false,
      extensionTreeProviderSideEffectsStarted: false,
    },
  }
}

function clearTreeViews() {
  treeViews.clear()
}

function register(server, opts = {}) {
  const sendToRenderer = typeof opts.sendToRenderer === "function" ? opts.sendToRenderer : undefined

  server.onRpc(MAIN_THREAD_TREE_VIEWS_NID, "$registerTreeViewDataProvider", (args) => {
    const [treeViewId, options] = args || []
    if (typeof treeViewId !== "string" || !treeViewId) return undefined
    const view = {
      id: treeViewId,
      options: clonePlain(options || {}),
      message: "",
      title: "",
      description: undefined,
      badge: undefined,
      disposed: false,
    }
    treeViews.set(treeViewId, view)
    sendToRenderer?.("ext-host:tree-view-register", clonePlain(view))
    return undefined
  })

  server.onRpc(MAIN_THREAD_TREE_VIEWS_NID, "$refresh", (args) => {
    const [treeViewId, itemsToRefresh] = args || []
    if (typeof treeViewId !== "string" || !treeViews.has(treeViewId)) return undefined
    const items = normalizeRefreshItems(itemsToRefresh)
    sendToRenderer?.("ext-host:tree-view-refresh", { treeViewId, items })
    return undefined
  })

  server.onRpc(MAIN_THREAD_TREE_VIEWS_NID, "$reveal", (args) => {
    const [treeViewId, itemInfo, options] = args || []
    if (typeof treeViewId !== "string" || !treeViews.has(treeViewId)) return undefined
    sendToRenderer?.("ext-host:tree-view-reveal", {
      treeViewId,
      itemInfo: clonePlain(itemInfo),
      options: clonePlain(options || {}),
    })
    return undefined
  })

  server.onRpc(MAIN_THREAD_TREE_VIEWS_NID, "$setMessage", (args) => {
    const [treeViewId, message] = args || []
    const view = treeViews.get(treeViewId)
    if (!view) return undefined
    view.message = typeof message === "string" ? message : clonePlain(message)
    sendToRenderer?.("ext-host:tree-view-message", { treeViewId, message: view.message })
    return undefined
  })

  server.onRpc(MAIN_THREAD_TREE_VIEWS_NID, "$setTitle", (args) => {
    const [treeViewId, title, description] = args || []
    const view = treeViews.get(treeViewId)
    if (!view) return undefined
    view.title = typeof title === "string" ? title : ""
    view.description = typeof description === "string" ? description : undefined
    sendToRenderer?.("ext-host:tree-view-title", {
      treeViewId,
      title: view.title,
      description: view.description,
    })
    return undefined
  })

  server.onRpc(MAIN_THREAD_TREE_VIEWS_NID, "$setBadge", (args) => {
    const [treeViewId, badge] = args || []
    const view = treeViews.get(treeViewId)
    if (!view) return undefined
    view.badge = clonePlain(badge)
    sendToRenderer?.("ext-host:tree-view-badge", { treeViewId, badge: view.badge })
    return undefined
  })

  server.onRpc(MAIN_THREAD_TREE_VIEWS_NID, "$resolveDropFileData", () => {
    return Buffer.alloc(0)
  })

  server.onRpc(MAIN_THREAD_TREE_VIEWS_NID, "$disposeTree", (args) => {
    const [treeViewId] = args || []
    const view = treeViews.get(treeViewId)
    if (!view) return undefined
    view.disposed = true
    treeViews.delete(treeViewId)
    sendToRenderer?.("ext-host:tree-view-dispose", { treeViewId })
    return undefined
  })

  server.onRpc(MAIN_THREAD_TREE_VIEWS_NID, "$logResolveTreeNodeFailure", (args) => {
    const [extensionId] = args || []
    if (extensionId) console.warn(`[main-thread:tree-views] resolve failed: ${extensionId}`)
    return undefined
  })

  if (typeof server.on === "function") {
    const clear = () => clearTreeViews()
    server.on("stopped", clear)
    server.on("exit", clear)
  }
}

module.exports = {
  MAIN_THREAD_TREE_VIEWS_NID,
  clearTreeViews,
  clonePlain,
  getTreeViewsOwnerEvidence,
  listTreeViews,
  normalizeRefreshItems,
  register,
}
