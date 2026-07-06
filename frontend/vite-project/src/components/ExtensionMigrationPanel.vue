<script setup lang="ts">
import { computed } from "vue"
import type {
  InstallProgressEvent,
  MigratedExtensionQueue,
  MigratedExtensionQueueItem,
  VsixMetadata,
} from "../extensions/ehClient"
import { localizeExtensionDisplayName } from "../extensions/extensionDisplayName"

const props = defineProps<{
  queue: MigratedExtensionQueue | null
  loading: boolean
  installingId: string | null
  progress: Record<string, InstallProgressEvent>
  getIconText: (extension: VsixMetadata) => string
  toMarketplaceMeta: (entry: MigratedExtensionQueueItem) => VsixMetadata
}>()

const emit = defineEmits<{
  search: [entry: MigratedExtensionQueueItem]
  install: [entry: MigratedExtensionQueueItem]
  refresh: []
}>()

const pending = computed(() => {
  if (!props.queue?.exists) return []
  return props.queue.extensions.filter((entry) => entry.status !== "installed")
})

function getInstallProgress(id: string): string {
  const ev = props.progress[id]
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

function getDisplayName(entry: MigratedExtensionQueueItem): string {
  return localizeExtensionDisplayName(props.toMarketplaceMeta(entry))
}
</script>

<template>
  <section v-if="loading || pending.length > 0" class="migration-panel">
    <div class="migration-header">
      <span>从 VS Code / Cursor 导入</span>
      <div class="migration-counters">
        <span>{{ queue?.pending || pending.length }} 待处理</span>
        <span v-if="queue?.failed">{{ queue.failed }} 失败</span>
        <span v-if="queue?.installed">{{ queue.installed }} 已导入</span>
      </div>
      <button class="migration-refresh" title="刷新迁移队列" :disabled="loading" @click="emit('refresh')">⟳</button>
    </div>

    <div class="migration-note">
      {{ queue?.reason || "迁移队列只导入清单，不会自动联网安装。每个扩展安装前都需要逐个确认，避免冲突扩展破坏当前工作区。" }}
    </div>

    <div v-if="loading" class="migration-empty">正在读取迁移扩展清单...</div>
    <div v-for="entry in pending" v-else :key="entry.id" class="migration-row">
      <div class="migration-icon">{{ getIconText(toMarketplaceMeta(entry)) }}</div>
      <div class="migration-body">
        <div class="migration-title-row">
          <div class="migration-title" :title="entry.id">{{ getDisplayName(entry) }}</div>
          <span v-if="entry.status === 'failed'" class="migration-badge failed">失败</span>
          <span v-else class="migration-badge">待确认</span>
        </div>
        <div class="migration-desc">
          {{ entry.status === "failed" ? (entry.error || "上次安装失败") : "已从 VS Code / Cursor 配置导入，等待确认安装。" }}
        </div>
        <div v-if="getInstallProgress(entry.id)" class="migration-progress">{{ getInstallProgress(entry.id) }}</div>
      </div>
      <div class="migration-actions">
        <button class="migration-action-btn" :disabled="!!installingId" @click="emit('search', entry)">查看</button>
        <button class="migration-install-btn" :disabled="!!installingId" @click="emit('install', entry)">
          {{ installingId === entry.id ? "安装中" : "安装" }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.migration-panel {
  display: flex;
  flex-direction: column;
  gap: 5px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
}

.migration-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 28px;
  align-items: center;
  gap: 8px;
  padding: 5px 2px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.migration-counters {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}

.migration-counters span {
  border-radius: 3px;
  background: rgba(142, 203, 255, 0.14);
  color: #9bdcf2;
  padding: 2px 5px;
  font-size: 10px;
}

.migration-refresh {
  width: 28px;
  height: 26px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-dark);
  color: var(--text-secondary);
  cursor: pointer;
}

.migration-note,
.migration-empty {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
  padding: 0 2px 4px;
}

.migration-row {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-height: 48px;
  padding: 6px 4px;
  border-radius: 4px;
}

.migration-row:hover {
  background: var(--bg-hover);
}

.migration-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
}

.migration-body {
  min-width: 0;
}

.migration-title-row,
.migration-actions {
  display: flex;
  align-items: center;
  gap: 5px;
}

.migration-title {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.migration-desc,
.migration-progress {
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.migration-progress {
  color: var(--accent);
}

.migration-badge {
  flex-shrink: 0;
  border-radius: 3px;
  background: rgba(142, 203, 255, 0.16);
  color: #9bdcf2;
  padding: 1px 5px;
  font-size: 10px;
}

.migration-badge.failed {
  background: rgba(248, 113, 113, 0.16);
  color: #fca5a5;
}

.migration-action-btn,
.migration-install-btn {
  height: 26px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.migration-action-btn {
  background: var(--bg-elevated);
  color: var(--text-primary);
  padding: 0 8px;
}

.migration-install-btn {
  min-width: 48px;
  background: #91acd2;
  border-color: #91acd2;
  color: #06111d;
  font-weight: 700;
  padding: 0 10px;
}

@media (max-width: 560px) {
  .migration-header {
    grid-template-columns: minmax(0, 1fr) 28px;
  }

  .migration-counters {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }

  .migration-row {
    grid-template-columns: 34px minmax(0, 1fr);
  }

  .migration-actions {
    grid-column: 2;
  }
}
</style>
