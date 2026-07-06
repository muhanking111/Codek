<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import ExtensionDetails from "./ExtensionDetails.vue"
import ExtensionMigrationPanel from "./ExtensionMigrationPanel.vue"
import {
  getExtensionIconDataUrl,
  getInstalledExtensionIconDataUrl,
  getMigratedExtensionQueue,
  updateMigratedExtensionStatus,
  type InstallProgressEvent,
  type MigratedExtensionQueue,
  type MigratedExtensionQueueItem,
  type VsixMetadata,
} from "../extensions/ehClient"
import {
  extensionWorkbenchService,
  getExtensionWorkbenchSurfaceSnapshot,
} from "../extensions/extensionsWorkbenchService"
import {
  getLocalizedExtensionIconText,
  localizeExtensionDescription,
  localizeExtensionDisplayName,
} from "../extensions/extensionDisplayName"

const query = ref("")
const results = ref<VsixMetadata[]>([])
const installed = ref<VsixMetadata[]>([])
const loading = ref(false)
const installedLoading = ref(false)
const error = ref("")
const installingId = ref<string | null>(null)
const progress = ref<Record<string, InstallProgressEvent>>({})
const iconDataUrls = ref<Record<string, string>>({})
const migrationQueue = ref<MigratedExtensionQueue | null>(null)
const migrationLoading = ref(false)
const selectedExtensionId = ref("")
const serviceRevision = ref(0)
let debounce: ReturnType<typeof setTimeout> | null = null

const DEFAULT_MARKETPLACE_QUERY = "ai"
const MARKETPLACE_CACHE_TTL_MS = 60_000
const ICON_BATCH_SIZE = 12
const ICON_CONCURRENCY = 3

const marketplaceStateCache: {
  installed: VsixMetadata[]
  results: VsixMetadata[]
  migrationQueue: MigratedExtensionQueue | null
  iconDataUrls: Record<string, string>
  installedAt: number
  searchAt: number
  migrationAt: number
  lastQuery: string
} = {
  installed: [],
  results: [],
  migrationQueue: null,
  iconDataUrls: {},
  installedAt: 0,
  searchAt: 0,
  migrationAt: 0,
  lastQuery: DEFAULT_MARKETPLACE_QUERY,
}

let disposed = false
let activeIconLoads = 0
const pendingIconLoads: Array<() => Promise<void>> = []
const queuedIconKeys = new Set<string>()

const installedIds = computed(() => new Set(installed.value.map((ext) => normalizeId(ext.id))))
const resultById = computed(() => {
  const map = new Map<string, VsixMetadata>()
  for (const ext of results.value) map.set(normalizeId(ext.id), ext)
  return map
})
const userInstalled = computed(() => installed.value.filter((ext) => !ext.builtin))
const builtinInstalled = computed(() => installed.value.filter((ext) => ext.builtin))
const migratedPending = computed(() => {
  const queue = migrationQueue.value
  if (!queue?.exists) return []
  return queue.extensions.filter((entry) => entry.status !== "installed")
})
const recommendations = computed(() => {
  const ids = installedIds.value
  return results.value.filter((ext) => !ids.has(normalizeId(ext.id))).slice(0, 12)
})
const hasQuery = computed(() => query.value.trim().length > 0)
const selectedExtension = computed(() => {
  const selected = normalizeId(selectedExtensionId.value)
  if (!selected) return null
  return installed.value.find((ext) => normalizeId(ext.id) === selected)
    || results.value.find((ext) => normalizeId(ext.id) === selected)
    || null
})
const selectedIconDataUrl = computed(() => selectedExtension.value ? resolveIconDataUrl(selectedExtension.value) : "")
const gallerySurface = computed(() => {
  void serviceRevision.value
  return getExtensionWorkbenchSurfaceSnapshot(extensionWorkbenchService)
})
const galleryContributionSummary = computed(() => gallerySurface.value.contributionSummary)

onMounted(() => {
  disposed = false
  hydrateFromCache()
  const now = Date.now()
  void refreshInstalled({ background: true, force: now - marketplaceStateCache.installedAt > MARKETPLACE_CACHE_TTL_MS })
  void refreshMigrationQueue({ background: true, force: now - marketplaceStateCache.migrationAt > MARKETPLACE_CACHE_TTL_MS })
  if (results.value.length === 0 || now - marketplaceStateCache.searchAt > MARKETPLACE_CACHE_TTL_MS) {
    void runSearch(DEFAULT_MARKETPLACE_QUERY, { background: true })
  } else {
    warmMarketplaceIcons(results.value)
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (typeof window !== "undefined") {
    const globalWindow = window as unknown as {
      __codekSeedExtensionGalleryWorkbenchDetailForSmoke?: () => Promise<string>
    }
    if (globalWindow.__codekSeedExtensionGalleryWorkbenchDetailForSmoke === seedExtensionGalleryWorkbenchDetailForSmoke) {
      delete globalWindow.__codekSeedExtensionGalleryWorkbenchDetailForSmoke
    }
  }
})

function normalizeId(id: string): string {
  return String(id || "").toLowerCase()
}

function formatDownloads(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M"
  if (n >= 1000) return (n / 1000).toFixed(1) + "K"
  return String(n || 0)
}

function hydrateFromCache() {
  if (marketplaceStateCache.installed.length) installed.value = marketplaceStateCache.installed
  if (marketplaceStateCache.results.length) results.value = marketplaceStateCache.results
  if (marketplaceStateCache.migrationQueue) migrationQueue.value = marketplaceStateCache.migrationQueue
  if (Object.keys(marketplaceStateCache.iconDataUrls).length) {
    iconDataUrls.value = marketplaceStateCache.iconDataUrls
  }
  warmInstalledIcons(installed.value)
}

function updateIconCache(key: string, dataUrl: string) {
  marketplaceStateCache.iconDataUrls = { ...marketplaceStateCache.iconDataUrls, [key]: dataUrl }
  if (!disposed) iconDataUrls.value = marketplaceStateCache.iconDataUrls
}

function invalidateInstalledCache() {
  marketplaceStateCache.installedAt = 0
}

function markServiceChanged() {
  serviceRevision.value += 1
}

function getDetailSmokeFallbackId(): string {
  const selected = normalizeId(selectedExtensionId.value)
  if (selected) return selectedExtensionId.value
  const fallback = results.value[0]
    || installed.value[0]
    || migrationQueue.value?.extensions[0]
  return fallback?.id || ""
}

async function seedExtensionGalleryWorkbenchDetailForSmoke(): Promise<string> {
  const id = getDetailSmokeFallbackId()
  if (id) {
    await extensionWorkbenchService.open(id)
    selectedExtensionId.value = id
    markServiceChanged()
    return id
  }
  const seededId = "codek.smoke-extension-gallery"
  const version = "1.0.0"
  extensionWorkbenchService.setEditorViewModelForEvidence({
    reportKind: "extension-details",
    createdAt: Date.now(),
    ready: true,
    id: seededId,
    extension: {
      id: seededId,
      displayName: "Codek 扩展工作台 Smoke",
      description: "用于在离线或搜索结果为空时验证扩展详情、动作和可用性证据。",
      version,
      publisher: "codek",
      downloads: 0,
      iconDataUrl: "",
      iconSource: "default",
      defaultIcon: true,
      categories: ["Other"],
      source: "smoke",
      sourceUrl: "codek-smoke://extension-gallery",
      license: "MIT",
      engines: { vscode: "^1.90.0" },
      extensionDependencies: [],
      extensionPack: [],
      contributes: {
        commands: [{ command: "codek.smokeExtensionGallery.open", title: "打开扩展工作台 Smoke" }],
        configuration: { properties: { "codek.smokeExtensionGallery.enabled": { type: "boolean" } } },
        views: { explorer: [{ id: "codek.smokeExtensionGallery.view", name: "扩展工作台 Smoke" }] },
      },
    },
    installed: null,
    readme: {
      id: seededId,
      available: true,
      length: 78,
      text: "# Codek Extension Gallery Smoke\n\n离线详情用于验证扩展安装动作、服务边界和可用性投影。",
    },
    versions: [{ version, targetPlatforms: ["win32-x64"] }],
    latestVersion: version,
    installPlan: {
      reportKind: "extension-install-plan",
      id: seededId,
      readyToInstall: true,
      requiresConfirmation: true,
      dependencies: [],
      extensionPack: [],
      missingDependencies: [],
      missingExtensionPack: [],
      operations: [{ kind: "target", id: seededId, status: "pending", version }],
      warnings: [{ id: "smoke-offline-detail", severity: "info", message: "当前为离线 smoke 详情，不会自动写入扩展目录。" }],
    },
    compatibility: {
      available: true,
      status: "compatible",
      blockers: [],
      warnings: [],
      unsupportedContributionPoints: [],
      partialContributionPoints: [],
    },
    installState: null,
    audit: [{
      extensionId: seededId,
      action: "open-detail",
      status: "ready",
      source: "extension-gallery-smoke",
      message: "搜索结果为空时使用服务级详情模型完成 editor action evidence。",
      createdAt: Date.now(),
    }],
  })
  selectedExtensionId.value = seededId
  markServiceChanged()
  return seededId
}

if (typeof window !== "undefined") {
  ;(window as unknown as {
    __codekSeedExtensionGalleryWorkbenchDetailForSmoke?: () => Promise<string>
  }).__codekSeedExtensionGalleryWorkbenchDetailForSmoke = seedExtensionGalleryWorkbenchDetailForSmoke
}

function getIconText(ext: VsixMetadata): string {
  return getLocalizedExtensionIconText(ext)
}

function getDisplayName(ext: VsixMetadata): string {
  return localizeExtensionDisplayName(ext)
}

function getDescription(ext: VsixMetadata): string {
  return localizeExtensionDescription(ext)
}

function shouldUseExternalIcon(ext: VsixMetadata): boolean {
  return Boolean(ext.builtin || ext.installed || installedIds.value.has(normalizeId(ext.id)))
}

function resolveIconDataUrl(ext: VsixMetadata): string {
  if (!shouldUseExternalIcon(ext)) return ""
  return iconDataUrls.value[normalizeId(ext.id)] || ext.iconDataUrl || ""
}

function handleIconError(ext: VsixMetadata, event: Event) {
  const fallback = ext.iconDataUrl || ""
  const img = event.target as HTMLImageElement | null
  if (!img || !fallback || img.src === fallback) return
  img.src = fallback
}

function getAvailabilityLabel(ext: VsixMetadata): string {
  return ext.availability?.label || ext.statusLabel || (ext.enabled === false ? "已禁用" : "已启用")
}

function getAvailabilityDetail(ext: VsixMetadata): string {
  return ext.availability?.detail || ext.statusDetail || ""
}

function getInstallProgress(id: string): string {
  const ev = progress.value[id]
  if (!ev) return ""
  const phaseMap: Record<string, string> = {
    download: "下载中",
    extract: "安装中",
    activate: "重载中",
    done: "已完成",
    error: "失败",
  }
  const phase = phaseMap[ev.phase] || ev.phase
  return ev.percent != null ? `${phase} ${ev.percent}%` : phase
}

async function refreshInstalled(options: { background?: boolean; force?: boolean } = {}) {
  const hasFreshCache = marketplaceStateCache.installed.length > 0
    && Date.now() - marketplaceStateCache.installedAt <= MARKETPLACE_CACHE_TTL_MS
  if (!options.force && hasFreshCache) {
    installed.value = marketplaceStateCache.installed
    warmInstalledIcons(installed.value)
    return
  }
  if (!options.background || installed.value.length === 0) installedLoading.value = true
  try {
    const nextInstalled = await extensionWorkbenchService.showInstalled()
    marketplaceStateCache.installed = nextInstalled
    marketplaceStateCache.installedAt = Date.now()
    if (!disposed) installed.value = nextInstalled
    markServiceChanged()
    warmInstalledIcons(installed.value)
  } catch (e) {
    error.value = (e as Error)?.message || "读取已安装扩展失败"
    if (!marketplaceStateCache.installed.length) installed.value = []
  } finally {
    installedLoading.value = false
  }
}

async function refreshMigrationQueue(options: { background?: boolean; force?: boolean } = {}) {
  const hasFreshCache = marketplaceStateCache.migrationQueue
    && Date.now() - marketplaceStateCache.migrationAt <= MARKETPLACE_CACHE_TTL_MS
  if (!options.force && hasFreshCache) {
    migrationQueue.value = marketplaceStateCache.migrationQueue
    return
  }
  if (!options.background || !migrationQueue.value) migrationLoading.value = true
  try {
    const nextQueue = await getMigratedExtensionQueue()
    marketplaceStateCache.migrationQueue = nextQueue
    marketplaceStateCache.migrationAt = Date.now()
    if (!disposed) migrationQueue.value = nextQueue
  } catch {
    if (!marketplaceStateCache.migrationQueue) migrationQueue.value = null
  } finally {
    migrationLoading.value = false
  }
}

async function runSearch(fallbackQuery?: string, options: { background?: boolean } = {}) {
  const text = query.value.trim() || fallbackQuery || ""
  if (!options.background || results.value.length === 0) loading.value = true
  error.value = ""
  try {
    const nextResults = await extensionWorkbenchService.search(text, { pageSize: 30 })
    marketplaceStateCache.results = nextResults
    marketplaceStateCache.searchAt = Date.now()
    marketplaceStateCache.lastQuery = text
    if (!disposed) results.value = nextResults
    markServiceChanged()
    warmMarketplaceIcons(nextResults)
  } catch (e) {
    error.value = (e as Error)?.message || "搜索扩展失败"
    if (!marketplaceStateCache.results.length) results.value = []
  } finally {
    loading.value = false
  }
}

function onQueryInput() {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    runSearch()
  }, 250)
}

function warmMarketplaceIcons(list: VsixMetadata[]) {
  for (const ext of list.slice(0, ICON_BATCH_SIZE)) {
    const key = normalizeId(ext.id)
    if (ext.iconDataUrl && !marketplaceStateCache.iconDataUrls[key]) {
      updateIconCache(key, ext.iconDataUrl)
    }
    if (!ext.iconCacheUrl && !ext.iconUrl) continue
    if (queuedIconKeys.has(key)) continue
    enqueueIconLoad(key, async () => {
      const dataUrl = await getExtensionIconDataUrl(ext)
      if (dataUrl) updateIconCache(key, dataUrl)
    })
  }
}

function warmInstalledIcons(list: VsixMetadata[]) {
  for (const ext of list.slice(0, ICON_BATCH_SIZE)) {
    const key = normalizeId(ext.id)
    if (ext.iconDataUrl && !marketplaceStateCache.iconDataUrls[key]) {
      updateIconCache(key, ext.iconDataUrl)
    }
    if (queuedIconKeys.has(key)) continue
    enqueueIconLoad(key, async () => {
      const dataUrl = await getInstalledExtensionIconDataUrl(ext.id)
      if (dataUrl) updateIconCache(key, dataUrl)
    })
  }
}

function enqueueIconLoad(key: string, task: () => Promise<void>) {
  if (queuedIconKeys.has(key)) return
  queuedIconKeys.add(key)
  pendingIconLoads.push(async () => {
    try {
      await task()
    } finally {
      queuedIconKeys.delete(key)
    }
  })
  scheduleIconDrain()
}

function scheduleIconDrain() {
  const run = () => drainIconQueue()
  if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 800 })
  else window.setTimeout(run, 40)
}

function drainIconQueue() {
  if (disposed) return
  while (activeIconLoads < ICON_CONCURRENCY && pendingIconLoads.length > 0) {
    const task = pendingIconLoads.shift()
    if (!task) return
    activeIconLoads += 1
    task()
      .catch(() => {})
      .finally(() => {
        activeIconLoads -= 1
        if (pendingIconLoads.length > 0) scheduleIconDrain()
      })
  }
}

async function handleInstall(ext: VsixMetadata) {
  if (installingId.value) return
  installingId.value = ext.id
  error.value = ""
  progress.value = { ...progress.value, [ext.id]: { phase: "download", percent: 0 } }
  try {
    await extensionWorkbenchService.open(ext.id, ext.version)
    selectedExtensionId.value = ext.id
    markServiceChanged()
    const res = await extensionWorkbenchService.install(ext.id, ext.version, {
      onProgress: (ev) => {
        progress.value = { ...progress.value, [ext.id]: ev }
        markServiceChanged()
      },
    })
    markServiceChanged()
    if (!res.success) {
      error.value = res.error || "安装失败"
      await markMigratedStatus(ext.id, "failed", error.value)
      return
    }
    await markMigratedStatus(ext.id, "installed")
    invalidateInstalledCache()
    await refreshInstalled({ force: true })
    await runSearch()
  } catch (e) {
    error.value = (e as Error)?.message || "安装失败"
    await markMigratedStatus(ext.id, "failed", error.value)
  } finally {
    installingId.value = null
    setTimeout(() => {
      const next = { ...progress.value }
      delete next[ext.id]
      progress.value = next
    }, 1200)
  }
}

async function markMigratedStatus(
  extensionId: string,
  status: MigratedExtensionQueueItem["status"],
  statusError = "",
) {
  if (!migrationQueue.value?.exists) return
  const matched = migrationQueue.value.extensions.some((entry) => normalizeId(entry.id) === normalizeId(extensionId))
  if (!matched) return
  try {
    migrationQueue.value = await updateMigratedExtensionStatus(extensionId, status, statusError)
  } catch {
    await refreshMigrationQueue()
  }
}

function toMarketplaceMeta(entry: MigratedExtensionQueueItem): VsixMetadata {
  const found = resultById.value.get(normalizeId(entry.id))
  if (found) return found
  const [publisher = "", ...nameParts] = entry.id.split(".")
  const name = nameParts.join(".") || entry.id
  return {
    id: entry.id,
    displayName: name,
    description: entry.status === "failed"
      ? `上次安装失败：${entry.error || "未知错误"}`
      : "从 VS Code / Cursor 配置迁移导入，点击安装前会通过扩展市场确认。",
    version: "",
    publisher,
    downloads: 0,
    categories: [],
  }
}

async function handleInstallMigrated(entry: MigratedExtensionQueueItem) {
  if (entry.status === "failed") {
    await markMigratedStatus(entry.id, "pending")
  }
  await handleInstall(toMarketplaceMeta(entry))
}

function searchMigratedExtension(entry: MigratedExtensionQueueItem) {
  query.value = entry.id
  selectExtension(entry.id)
  runSearch()
}

function selectExtension(id: string) {
  selectedExtensionId.value = id
}

function closeDetails() {
  selectedExtensionId.value = ""
}

async function refreshAfterDetailsAction() {
  invalidateInstalledCache()
  await refreshInstalled({ force: true })
  await runSearch(undefined, { background: true })
}

async function handleUninstall(ext: VsixMetadata) {
  if (installingId.value || ext.builtin) return
  installingId.value = ext.id
  error.value = ""
  try {
    const res = await extensionWorkbenchService.uninstall(ext.id)
    markServiceChanged()
    if (!res.success) {
      error.value = res.error || "卸载失败"
      return
    }
    invalidateInstalledCache()
    await refreshInstalled({ force: true })
    await runSearch()
    if (normalizeId(selectedExtensionId.value) === normalizeId(ext.id)) selectedExtensionId.value = ""
  } catch (e) {
    error.value = (e as Error)?.message || "卸载失败"
  } finally {
    installingId.value = null
  }
}

async function toggleExtension(ext: VsixMetadata) {
  if (installingId.value || ext.builtin) return
  installingId.value = ext.id
  error.value = ""
  try {
    if (ext.enabled === false) await extensionWorkbenchService.enable(ext.id)
    else await extensionWorkbenchService.disable(ext.id)
    markServiceChanged()
    invalidateInstalledCache()
    await refreshInstalled({ force: true })
  } catch (e) {
    error.value = (e as Error)?.message || "切换扩展状态失败"
  } finally {
    installingId.value = null
  }
}
</script>

<template>
  <div
    class="extensions-view"
    data-codek-smoke="extension-gallery-workbench-surface"
    data-extension-gallery-state-source="service"
    :data-extension-gallery-service-id="gallerySurface.serviceId"
    :data-extension-gallery-container-id="gallerySurface.containerId"
    :data-extension-gallery-view-ids="gallerySurface.viewIds.join(',')"
    :data-extension-gallery-command-ids="gallerySurface.commandIds.join(',')"
    :data-extension-gallery-quick-access-prefix="gallerySurface.quickAccessPrefix"
    :data-extension-gallery-contribution-label="galleryContributionSummary.label"
    :data-extension-gallery-contribution-container-id="galleryContributionSummary.containerId"
    :data-extension-gallery-contribution-view-ids="galleryContributionSummary.viewIds.join(',')"
    :data-extension-gallery-contribution-command-ids="galleryContributionSummary.commandIds.join(',')"
    :data-extension-gallery-view-action-menu-driven="galleryContributionSummary.viewActionMenuDriven"
    :data-extension-gallery-manage-command-id="galleryContributionSummary.commandIds.includes('workbench.extensions.manage') ? 'workbench.extensions.manage' : ''"
    :data-extension-gallery-last-query="gallerySurface.lastSearchQuery"
    :data-extension-gallery-result-count="gallerySurface.lastSearchResultCount"
    :data-extension-gallery-installed-count="gallerySurface.installedCount"
    :data-extension-gallery-editor-count="gallerySurface.editorCount"
    :data-extension-gallery-opened-extension-ids="gallerySurface.openedExtensionIds.join(',')"
    :data-extension-gallery-latest-editor-id="gallerySurface.latestEditorId"
    :data-extension-gallery-action-state-count="gallerySurface.actionStateCount"
    :data-extension-gallery-error-action-count="gallerySurface.errorActionCount"
    :data-extension-gallery-progress-count="gallerySurface.progressCount"
    :data-extension-gallery-latest-progress-phase="gallerySurface.latestProgress?.phase || ''"
    :data-extension-gallery-local-first="gallerySurface.constraints.localFirst"
    :data-extension-gallery-no-second-state="gallerySurface.constraints.noSecondInstallState"
  >
    <div class="extensions-search" data-extension-gallery-surface="search">
      <input
        v-model="query"
        class="extensions-search-input"
        data-codek-smoke="extensions-search-input"
        placeholder="在应用商店中搜索扩展"
        @input="onQueryInput"
        @keydown.enter="runSearch()"
      />
      <button class="extensions-icon-btn" title="刷新已安装扩展" @click="refreshInstalled({ force: true })">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 0 1-15.5 6.2" />
          <path d="M3 12A9 9 0 0 1 18.5 5.8" />
          <path d="M18 2v4h4" />
          <path d="M6 22v-4H2" />
        </svg>
      </button>
      <button class="extensions-icon-btn" title="筛选">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 5h18" />
          <path d="M7 12h10" />
          <path d="M10 19h4" />
        </svg>
      </button>
    </div>

    <button class="extensions-import-link" @click="runSearch('ms-python python java docker markdownlint')">
      搜索常用 VS Code 扩展
    </button>

    <div v-if="error" class="extensions-error">{{ error }}</div>

    <ExtensionMigrationPanel
      :queue="migrationQueue"
      :loading="migrationLoading"
      :installing-id="installingId"
      :progress="progress"
      :get-icon-text="getIconText"
      :to-marketplace-meta="toMarketplaceMeta"
      @search="searchMigratedExtension"
      @install="handleInstallMigrated"
      @refresh="refreshMigrationQueue({ force: true })"
    />

    <section v-if="false && (migrationLoading || migratedPending.length > 0)" class="extensions-group migration-queue">
      <div class="extensions-group-header">
        <span>从 VS Code / Cursor 导入</span>
        <span class="extensions-count">{{ migrationQueue?.pending || migratedPending.length }}</span>
      </div>
      <div class="migration-queue-note">
        {{ migrationQueue?.reason || '安装需要逐个确认，避免自动联网安装或冲突扩展破坏当前工作台。' }}
      </div>
      <div v-if="migrationLoading" class="extensions-empty">正在读取迁移扩展清单...</div>
      <div v-for="entry in migratedPending" :key="entry.id" class="extension-row migrated compact">
        <div class="extension-icon-wrap">
          <div class="extension-icon-fallback">{{ getIconText(toMarketplaceMeta(entry)) }}</div>
        </div>
        <div class="extension-body">
          <div class="extension-title-row">
            <div class="extension-title" :title="entry.id">{{ entry.id }}</div>
            <span v-if="entry.status === 'failed'" class="extension-badge failed">失败</span>
          </div>
          <div class="extension-desc">
            {{ entry.status === 'failed' ? (entry.error || '上次安装失败') : '已从 VS Code / Cursor 导入，等待确认安装。' }}
          </div>
          <div v-if="getInstallProgress(entry.id)" class="extension-progress">{{ getInstallProgress(entry.id) }}</div>
        </div>
        <div class="extension-actions">
          <button class="extension-action-btn" :disabled="!!installingId" @click="searchMigratedExtension(entry)">查看</button>
          <button class="extension-install-btn" :disabled="!!installingId" @click="handleInstallMigrated(entry)">
            {{ installingId === entry.id ? '安装中' : '安装' }}
          </button>
        </div>
      </div>
    </section>

    <section class="extensions-group" data-codek-smoke="extension-gallery-installed" data-extension-gallery-surface="installed">
      <div class="extensions-group-header">
        <span>已安装</span>
        <span class="extensions-count">{{ userInstalled.length }}</span>
      </div>

      <div v-if="installedLoading" class="extensions-empty">正在读取已安装扩展...</div>
      <div v-else-if="userInstalled.length === 0" class="extensions-empty">暂无已安装扩展。</div>

      <div v-for="ext in userInstalled" :key="ext.id" class="extension-row" :data-extension-id="ext.id">
        <div class="extension-icon-wrap">
          <img v-if="resolveIconDataUrl(ext)" :src="resolveIconDataUrl(ext)" class="extension-icon-img" alt="" @error="handleIconError(ext, $event)" />
          <div v-else class="extension-icon-fallback">{{ getIconText(ext) }}</div>
        </div>
        <div class="extension-body">
          <div class="extension-title-row">
            <div class="extension-title" :title="getDisplayName(ext)">{{ getDisplayName(ext) }}</div>
            <span class="extension-badge" :class="ext.availability?.status || ext.status">{{ getAvailabilityLabel(ext) }}</span>
          </div>
          <div class="extension-desc">{{ getDescription(ext) }}</div>
          <div class="extension-meta">
            <span class="extension-verified">◆</span>
            <span>{{ ext.publisher }}</span>
            <span>v{{ ext.version }}</span>
            <span v-if="getAvailabilityDetail(ext)" :title="getAvailabilityDetail(ext)">{{ getAvailabilityDetail(ext) }}</span>
          </div>
        </div>
        <div class="extension-actions">
          <button class="extension-action-btn" :disabled="!!installingId" @click="selectExtension(ext.id)">详情</button>
          <button class="extension-action-btn" :disabled="!!installingId" @click="toggleExtension(ext)">
            {{ ext.enabled === false ? '启用' : '禁用' }}
          </button>
          <button class="extension-gear" title="卸载" :disabled="!!installingId" @click="handleUninstall(ext)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
        </div>
      </div>
    </section>

    <section class="extensions-group" data-codek-smoke="extension-gallery-search-results" data-extension-gallery-surface="results">
      <div class="extensions-group-header">
        <span>{{ hasQuery ? '搜索结果' : '推荐' }}</span>
        <span class="extensions-count">{{ hasQuery ? results.length : recommendations.length }}</span>
      </div>

      <div v-if="loading" class="extensions-empty">正在搜索扩展...</div>
      <div v-else-if="(hasQuery ? results : recommendations).length === 0" class="extensions-empty">没有找到扩展。</div>

      <div v-for="ext in (hasQuery ? results : recommendations)" :key="ext.id" class="extension-row" :data-extension-id="ext.id">
        <div class="extension-icon-wrap">
          <img v-if="resolveIconDataUrl(ext)" :src="resolveIconDataUrl(ext)" class="extension-icon-img" alt="" @error="handleIconError(ext, $event)" />
          <div v-else class="extension-icon-fallback">{{ getIconText(ext) }}</div>
        </div>
        <div class="extension-body">
          <div class="extension-title-row">
            <div class="extension-title" :title="getDisplayName(ext)">{{ getDisplayName(ext) }}</div>
            <span v-if="installedIds.has(normalizeId(ext.id))" class="extension-badge">已安装</span>
          </div>
          <div class="extension-desc">{{ getDescription(ext) }}</div>
          <div class="extension-meta">
            <span v-if="ext.downloads">⇩ {{ formatDownloads(ext.downloads) }}</span>
            <span v-if="ext.rating">★ {{ ext.rating.toFixed(1) }}</span>
            <span>{{ ext.publisher }}</span>
          </div>
          <div v-if="getInstallProgress(ext.id)" class="extension-progress">{{ getInstallProgress(ext.id) }}</div>
        </div>
        <div class="extension-actions">
          <button class="extension-action-btn" :disabled="!!installingId" @click="selectExtension(ext.id)">详情</button>
          <button
            v-if="!installedIds.has(normalizeId(ext.id))"
            class="extension-install-btn"
            :disabled="!!installingId"
            @click="handleInstall(ext)"
          >
            {{ installingId === ext.id ? '安装中' : '安装' }}
          </button>
          <button v-else class="extension-action-btn" :disabled="!!installingId" @click="handleUninstall(ext)">卸载</button>
        </div>
      </div>
    </section>

    <section v-if="builtinInstalled.length > 0" class="extensions-group builtin">
      <div class="extensions-group-header">
        <span>内置</span>
        <span class="extensions-count">{{ builtinInstalled.length }}</span>
      </div>
      <div v-for="ext in builtinInstalled.slice(0, 12)" :key="ext.id" class="extension-row compact">
        <div class="extension-icon-wrap">
          <img v-if="resolveIconDataUrl(ext)" :src="resolveIconDataUrl(ext)" class="extension-icon-img" alt="" @error="handleIconError(ext, $event)" />
          <div v-else class="extension-icon-fallback">{{ getIconText(ext) }}</div>
        </div>
        <div class="extension-body">
          <div class="extension-title" :title="getDisplayName(ext)">{{ getDisplayName(ext) }}</div>
          <div class="extension-meta">{{ ext.publisher }} · v{{ ext.version }}</div>
        </div>
      </div>
    </section>

    <ExtensionDetails
      v-if="selectedExtensionId"
      class="extensions-detail-panel"
      data-codek-smoke="extension-gallery-detail"
      :extension-id="selectedExtensionId"
      :icon-data-url="selectedIconDataUrl"
      :installed="installedIds.has(normalizeId(selectedExtensionId))"
      @close="closeDetails"
      @refresh="refreshAfterDetailsAction"
      @install="handleInstall"
    />
  </div>
</template>

<style scoped>
.extensions-view {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  overflow-y: auto;
  padding: 8px 8px 12px;
  background: var(--bg-panel);
  color: var(--text-primary);
  min-width: 0;
}

.extensions-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px 28px;
  gap: 4px;
  align-items: center;
}

.extensions-search-input {
  width: 100%;
  min-width: 0;
  height: 30px;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-dark);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 12px;
  outline: none;
  padding: 0 9px;
}

.extensions-search-input:focus {
  border-color: var(--accent);
}

.extensions-icon-btn {
  width: 28px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-dark);
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.extensions-icon-btn:hover {
  color: var(--text-primary);
  border-color: var(--border-bright);
}

.extensions-import-link {
  border: 0;
  background: transparent;
  color: #8ecbff;
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
  text-align: left;
  padding: 0 2px;
  cursor: pointer;
}

.extensions-import-link:hover {
  text-decoration: underline;
}

.extensions-error {
  padding: 7px 9px;
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 4px;
  background: rgba(248, 113, 113, 0.08);
  color: #fca5a5;
  font-size: 11px;
  line-height: 1.4;
}

.extensions-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.extensions-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 2px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.extensions-count {
  min-width: 24px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #9bdcf2;
  color: #062332;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

.extensions-empty {
  padding: 12px 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.migration-queue {
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
}

.migration-queue-note {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
  padding: 0 2px 4px;
}

.extension-row {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 74px;
  padding: 8px 6px;
  border-radius: 4px;
}

.extension-row:hover {
  background: var(--bg-hover);
}

.extension-row.compact {
  grid-template-columns: 42px minmax(0, 1fr);
  min-height: 42px;
  opacity: 0.82;
}

.extension-row.migrated {
  grid-template-columns: 42px minmax(0, 1fr) auto;
  opacity: 1;
}

.extension-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}

.extension-icon-img,
.extension-icon-fallback {
  width: 56px;
  height: 56px;
  border-radius: 6px;
  background: var(--bg-elevated);
}

.extension-row.compact .extension-icon-img,
.extension-row.compact .extension-icon-fallback {
  width: 32px;
  height: 32px;
}

.extension-icon-img {
  object-fit: contain;
  display: block;
}

.extension-icon-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0;
}

.extension-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.extension-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.extension-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
}

.extension-desc {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.35;
}

.extension-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.extension-verified {
  color: #8ecbff;
  font-size: 10px;
}

.extension-badge {
  flex-shrink: 0;
  border-radius: 3px;
  background: rgba(142, 203, 255, 0.18);
  color: #9bdcf2;
  padding: 1px 5px;
  font-size: 10px;
  font-weight: 600;
}

.extension-badge.failed {
  background: rgba(248, 113, 113, 0.16);
  color: #fca5a5;
}

.extension-badge.error,
.extension-badge.unsupported {
  background: rgba(248, 113, 113, 0.16);
  color: #fca5a5;
}

.extension-badge.activated {
  background: rgba(34, 197, 94, 0.16);
  color: #86efac;
}

.extension-badge.disabled {
  background: rgba(148, 163, 184, 0.16);
  color: #cbd5e1;
}

.extension-progress {
  color: var(--accent);
  font-size: 11px;
}

.extension-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.extension-install-btn,
.extension-action-btn,
.extension-gear {
  height: 26px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.extension-install-btn {
  min-width: 48px;
  padding: 0 10px;
  background: #91acd2;
  border-color: #91acd2;
  color: #06111d;
  font-weight: 700;
}

.extension-action-btn {
  min-width: 42px;
  padding: 0 8px;
}

.extension-gear {
  width: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.extension-install-btn:hover:not(:disabled),
.extension-action-btn:hover:not(:disabled),
.extension-gear:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.extension-install-btn:hover:not(:disabled) {
  color: #06111d;
  filter: brightness(1.08);
}

.extension-install-btn:disabled,
.extension-action-btn:disabled,
.extension-gear:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.builtin {
  border-top: 1px solid var(--border);
  padding-top: 4px;
}

@media (max-width: 560px) {
  .extension-row {
    grid-template-columns: 48px minmax(0, 1fr);
  }

  .extension-icon-img,
  .extension-icon-fallback {
    width: 40px;
    height: 40px;
  }

  .extension-actions {
    grid-column: 2;
    justify-content: flex-start;
  }

  .extension-row.migrated {
    grid-template-columns: 48px minmax(0, 1fr);
  }
}
</style>
