<script setup lang="ts">
import { computed, ref, watch } from "vue"
import type { VsixMetadata } from "../extensions/ehClient"
import {
  IExtensionsWorkbenchService,
  extensionWorkbenchService,
  type ExtensionWorkbenchEditorViewModel,
} from "../extensions/extensionsWorkbenchService"
import {
  getLocalizedExtensionIconText,
  localizeExtensionDescription,
  localizeExtensionDisplayName,
  localizeExtensionReadmePreview,
} from "../extensions/extensionDisplayName"

const props = defineProps<{
  extensionId: string
  installed?: boolean
  iconDataUrl?: string
}>()

const emit = defineEmits<{
  close: []
  refresh: []
  install: [extension: VsixMetadata]
}>()

const editorModel = ref<ExtensionWorkbenchEditorViewModel | null>(null)
const loading = ref(false)
const error = ref("")
const rollbackBusy = ref(false)

const payload = computed(() => editorModel.value?.payload || null)
const extension = computed(() => payload.value?.extension || null)
const installPlan = computed(() => payload.value?.installPlan || null)
const compatibility = computed(() => payload.value?.compatibility || null)
const installed = computed(() => payload.value?.installed || null)
const detailSummary = computed(() => editorModel.value?.detailSummary || null)
const shouldUseExternalIcon = computed(() => Boolean(props.installed || installed.value || extension.value?.builtin || extension.value?.installed))
const resolvedIconDataUrl = computed(() => {
  if (!shouldUseExternalIcon.value) return ""
  return props.iconDataUrl || extension.value?.iconDataUrl || installed.value?.iconDataUrl || ""
})
const displayName = computed(() => localizeExtensionDisplayName(extension.value))
const description = computed(() => localizeExtensionDescription(extension.value))
const iconText = computed(() => getLocalizedExtensionIconText(extension.value))
const availability = computed(() => detailSummary.value?.availability || installed.value?.availability || null)
const usabilityRows = computed(() => detailSummary.value?.usabilityRows || [])
const readmePreview = computed(() => {
  const text = payload.value?.readme?.text || ""
  return localizeExtensionReadmePreview(extension.value, text).slice(0, 900)
})
const hasRollback = computed(() => Boolean(detailSummary.value?.rollbackRisk.available))

watch(
  () => props.extensionId,
  (id) => {
    if (id) void loadDetails(id)
    else editorModel.value = null
  },
  { immediate: true },
)

function toMarketplaceMeta(): VsixMetadata | null {
  const ext = extension.value
  if (!ext) return null
  return {
    id: ext.id,
    displayName: displayName.value,
    description: description.value,
    version: payload.value?.latestVersion || ext.version,
    publisher: ext.publisher,
    downloads: ext.downloads || 0,
    rating: ext.rating,
    iconUrl: ext.iconUrl,
    iconCacheUrl: ext.iconCacheUrl,
    categories: ext.categories || [],
    installed: Boolean(installed.value),
    enabled: installed.value?.enabled,
    builtin: installed.value?.builtin,
    status: detailSummary.value?.installState,
    statusLabel: detailSummary.value?.availability.label,
    statusDetail: detailSummary.value?.availability.detail,
    availability: detailSummary.value?.availability,
  }
}

async function loadDetails(id = props.extensionId, options: { forceRefresh?: boolean } = {}) {
  loading.value = true
  error.value = ""
  try {
    const cached = options.forceRefresh ? undefined : extensionWorkbenchService.getEditorViewModel(id)
    if (cached) {
      editorModel.value = cached
      return
    }
    editorModel.value = await extensionWorkbenchService.open(id)
  } catch (e) {
    error.value = (e as Error)?.message || "读取扩展详情失败"
  } finally {
    loading.value = false
  }
}

async function handleRollback() {
  if (!props.extensionId || rollbackBusy.value) return
  rollbackBusy.value = true
  error.value = ""
  try {
    const result = await extensionWorkbenchService.rollback(props.extensionId)
    if (!result.success) {
      error.value = result.error || "回滚失败"
      return
    }
    emit("refresh")
    await loadDetails()
  } catch (e) {
    error.value = (e as Error)?.message || "回滚失败"
  } finally {
    rollbackBusy.value = false
  }
}

function handleInstall() {
  const meta = toMarketplaceMeta()
  if (meta) emit("install", meta)
}

function statusLabel(status = "") {
  const map: Record<string, string> = {
    native: "原生",
    compatible: "兼容",
    degraded: "降级",
    blocked: "阻断",
    unknown: "未知",
    installed: "已安装",
    installing: "安装中",
    failed: "失败",
    activated: "已激活",
    enabled: "已启用",
    disabled: "已禁用",
    error: "错误",
    unsupported: "不支持",
  }
  return map[status] || status || "未知"
}

function handleIconError(event: Event) {
  if (!shouldUseExternalIcon.value) return
  const fallback = extension.value?.iconDataUrl || installed.value?.iconDataUrl || ""
  const img = event.target as HTMLImageElement | null
  if (!img || !fallback || img.src === fallback) return
  img.src = fallback
}

function formatDate(value?: number | string) {
  if (!value) return ""
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString()
}
</script>

<template>
  <aside
    class="extension-details"
    aria-label="扩展详情"
    :data-extension-gallery-detail-service-id="String(IExtensionsWorkbenchService)"
    data-extension-gallery-detail-state-source="service"
    :data-extension-gallery-detail-install-plan-ready="detailSummary?.installPlanReady"
    :data-extension-gallery-detail-requires-confirmation="detailSummary?.requiresConfirmation"
    :data-extension-gallery-detail-trust-gate-required="detailSummary?.trustGate.required"
    :data-extension-gallery-editor-id="editorModel?.id || props.extensionId"
    :data-extension-gallery-install-state="editorModel?.installState || ''"
    :data-extension-gallery-action-ids="(detailSummary?.actionIds || []).join(',')"
    :data-extension-gallery-action-command-ids="(detailSummary?.actionCommands || []).map((action) => action.commandId).join(',')"
    :data-extension-gallery-action-owner="detailSummary?.manageActionOwner.owner || ''"
    :data-extension-gallery-manage-command-id="detailSummary?.manageActionOwner.commandId || ''"
    :data-extension-gallery-manage-secondary-actions="(detailSummary?.manageSecondaryActions || []).map((action) => `${action.actionId}:${action.commandId}`).join(',')"
    :data-extension-gallery-rollback-available="detailSummary?.rollbackRisk.available"
    :data-extension-gallery-usability-statuses="usabilityRows.map((row) => `${row.id}:${row.statusLabel}`).join(',')"
  >
    <div class="details-toolbar">
      <button class="details-icon-btn" title="返回列表" @click="emit('close')">←</button>
      <div class="details-toolbar-title">扩展详情</div>
      <button class="details-icon-btn" title="刷新详情" :disabled="loading" @click="loadDetails(props.extensionId, { forceRefresh: true })">⟳</button>
    </div>

    <div v-if="loading" class="details-empty">正在读取扩展详情...</div>
    <div v-else-if="error" class="details-error">{{ error }}</div>
    <div v-else-if="extension" class="details-content">
      <header class="details-header">
        <img v-if="resolvedIconDataUrl" class="details-icon" :src="resolvedIconDataUrl" alt="" @error="handleIconError" />
        <div v-else class="details-icon fallback">{{ iconText }}</div>
        <div class="details-title-block">
          <div class="details-title">{{ displayName }}</div>
          <div class="details-subtitle">{{ extension.id }} · v{{ extension.version || payload?.latestVersion }}</div>
          <p class="details-description">{{ description }}</p>
          <div class="details-tags">
            <span v-if="installed">已安装 {{ installed.version }}</span>
            <span v-if="availability" :class="availability.status">{{ availability.label }}</span>
            <span v-if="extension.verified">已验证</span>
            <span v-if="extension.deprecated">已弃用</span>
          </div>
        </div>
      </header>

      <div class="details-actions">
        <button v-if="!installed" class="primary-action" @click="handleInstall">安装</button>
        <button v-if="hasRollback" class="secondary-action" :disabled="rollbackBusy" @click="handleRollback">
          {{ rollbackBusy ? "回滚中" : "回滚到上一版" }}
        </button>
      </div>

      <section class="details-section">
        <h3>兼容性</h3>
        <div class="status-line">
          <span class="status-pill" :class="compatibility?.status">{{ statusLabel(compatibility?.status) }}</span>
          <span>{{ compatibility?.available ? "来自当前兼容矩阵" : "暂无矩阵样本" }}</span>
        </div>
        <ul v-if="compatibility?.blockers.length" class="details-list">
          <li v-for="item in compatibility.blockers" :key="item.id || item.message">{{ item.message }}</li>
        </ul>
        <ul v-else-if="compatibility?.warnings.length" class="details-list">
          <li v-for="item in compatibility.warnings" :key="item.id || item.message">{{ item.message }}</li>
        </ul>
      </section>

      <section class="details-section">
        <h3>安装计划</h3>
        <div v-if="installPlan" class="details-grid">
          <span>依赖</span><strong>{{ installPlan.dependencies.length }}</strong>
          <span>扩展包</span><strong>{{ installPlan.extensionPack.length }}</strong>
          <span>待执行</span><strong>{{ installPlan.operations.filter((item) => item.status === "pending").length }}</strong>
          <span>需要确认</span><strong>{{ installPlan.requiresConfirmation ? "是" : "否" }}</strong>
        </div>
        <div v-else class="details-muted">暂无安装计划。</div>
        <div v-if="detailSummary" class="details-grid details-grid-summary">
          <span>信任</span><strong>{{ detailSummary.trustGate.required ? "需要确认" : "无需确认" }}</strong>
          <span>信任详情</span><strong>{{ detailSummary.trustGate.detail }}</strong>
          <span>状态</span><strong>{{ detailSummary.label }}</strong>
          <span>可回滚</span><strong>{{ detailSummary.rollbackRisk.available ? "是" : "否" }}</strong>
        </div>
        <ul v-if="installPlan?.warnings.length" class="details-list">
          <li v-for="item in installPlan.warnings" :key="item.id">{{ item.message }}</li>
        </ul>
      </section>

      <section class="details-section">
        <h3>安装后可用性</h3>
        <div v-if="usabilityRows.length" class="usability-list">
          <div
            v-for="row in usabilityRows"
            :key="row.id"
            class="usability-row"
            :class="row.status"
          >
            <div class="usability-row-head">
              <strong>{{ row.label }}</strong>
              <span>{{ row.statusLabel }}</span>
            </div>
            <p>{{ row.detail }}</p>
          </div>
        </div>
        <div v-else class="details-muted">暂无贡献点可用性数据，安装完成后会重新计算。</div>
      </section>

      <section class="details-section">
        <h3>README</h3>
        <p v-if="readmePreview" class="readme-preview">{{ readmePreview }}</p>
        <div v-else class="details-muted">该扩展没有可用 README，详情页会保持可安装和可回滚能力。</div>
      </section>

      <section class="details-section">
        <h3>安装状态</h3>
        <div v-if="payload?.installState" class="details-grid">
          <span>状态</span><strong>{{ availability?.label || statusLabel(payload.installState.status) }}</strong>
          <span>可用性</span><strong>{{ availability?.detail || installed?.statusDetail || "-" }}</strong>
          <span>来源</span><strong>{{ payload.installState.installSource || "-" }}</strong>
          <span>更新时间</span><strong>{{ formatDate(payload.installState.updatedAt) || "-" }}</strong>
          <span>备份</span><strong>{{ payload.installState.lastBackup ? "可回滚" : "无" }}</strong>
        </div>
        <div v-else class="details-muted">尚无本地安装状态。</div>
      </section>

      <section class="details-section">
        <h3>审计</h3>
        <div v-if="payload?.audit.length" class="audit-list">
          <div v-for="entry in payload.audit.slice(0, 6)" :key="`${entry.action}-${entry.createdAt || entry.timestamp}`" class="audit-row">
            <span>{{ entry.action }}</span>
            <strong>{{ statusLabel(entry.status) }}</strong>
            <em>{{ formatDate(entry.createdAt || entry.timestamp) }}</em>
          </div>
        </div>
        <div v-else class="details-muted">暂无审计记录。</div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.extension-details {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--bg-panel);
  color: var(--text-primary);
  border-left: 1px solid var(--border);
}

.details-toolbar {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 28px;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
}

.details-toolbar-title {
  min-width: 0;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.details-icon-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-dark);
  color: var(--text-secondary);
  cursor: pointer;
}

.details-content {
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.details-header {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}

.details-icon {
  width: 64px;
  height: 64px;
  border-radius: 6px;
  object-fit: contain;
  background: var(--bg-elevated);
}

.details-icon.fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-weight: 800;
}

.details-title-block {
  min-width: 0;
}

.details-title {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.details-subtitle {
  overflow: hidden;
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.details-description {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.details-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 7px;
}

.details-tags span,
.status-pill {
  border-radius: 3px;
  background: rgba(142, 203, 255, 0.16);
  color: #9bdcf2;
  padding: 2px 5px;
  font-size: 10px;
  font-weight: 700;
}

.details-actions {
  display: flex;
  gap: 6px;
  margin-top: 12px;
}

.primary-action,
.secondary-action {
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.primary-action {
  background: #91acd2;
  border-color: #91acd2;
  color: #06111d;
  font-weight: 800;
  padding: 0 12px;
}

.secondary-action {
  background: var(--bg-elevated);
  color: var(--text-primary);
  padding: 0 10px;
}

.details-section {
  border-top: 1px solid var(--border);
  margin-top: 13px;
  padding-top: 10px;
}

.details-section h3 {
  margin: 0 0 8px;
  color: var(--text-secondary);
  font-size: 12px;
}

.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 11px;
}

.status-pill.blocked {
  background: rgba(248, 113, 113, 0.16);
  color: #fca5a5;
}

.status-pill.degraded {
  background: rgba(251, 191, 36, 0.16);
  color: #facc15;
}

.details-grid {
  display: grid;
  grid-template-columns: minmax(64px, auto) minmax(0, 1fr);
  gap: 6px 10px;
  color: var(--text-muted);
  font-size: 11px;
}

.details-grid strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.details-list {
  margin: 8px 0 0;
  padding-left: 16px;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.45;
}

.usability-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.usability-row {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  padding: 8px;
}

.usability-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.usability-row-head strong {
  min-width: 0;
  color: var(--text-primary);
  font-size: 11px;
}

.usability-row-head span {
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 700;
}

.usability-row.ready .usability-row-head span {
  border-color: rgba(34, 197, 94, 0.35);
  background: rgba(34, 197, 94, 0.12);
  color: #15803d;
}

.usability-row.pending .usability-row-head span {
  border-color: rgba(217, 119, 6, 0.35);
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
}

.usability-row.unsupported .usability-row-head span {
  border-color: rgba(220, 38, 38, 0.35);
  background: rgba(248, 113, 113, 0.12);
  color: #b91c1c;
}

.usability-row p {
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.readme-preview {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  -webkit-line-clamp: 10;
  -webkit-box-orient: vertical;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.5;
}

.audit-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.audit-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  padding-bottom: 4px;
  font-size: 11px;
}

.audit-row span {
  color: var(--text-primary);
}

.audit-row strong {
  color: var(--text-secondary);
}

.audit-row em {
  grid-column: 1 / -1;
  color: var(--text-muted);
  font-style: normal;
}

.details-empty,
.details-error,
.details-muted {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
  padding: 12px;
}

.details-error {
  color: #fca5a5;
}
</style>
