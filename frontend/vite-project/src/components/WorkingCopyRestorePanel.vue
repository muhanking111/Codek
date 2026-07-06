<template>
  <section
    class="working-copy-restore-panel"
    :class="{ empty: actions.length === 0, busy: Boolean(busyActionKey), error: Boolean(errorMessage) }"
    data-codek-smoke="working-copy-restore-panel"
    aria-live="polite"
  >
    <div class="restore-panel-header">
      <div>
        <div class="restore-panel-title">未保存内容恢复</div>
        <div class="restore-panel-subtitle">{{ statusLabel }}</div>
      </div>
      <span class="restore-panel-count">{{ actions.length }}</span>
    </div>

    <div v-if="errorMessage" class="restore-panel-error" data-codek-smoke="working-copy-restore-error">
      {{ errorMessage }}
    </div>

    <div v-if="actions.length === 0" class="restore-panel-empty" data-codek-smoke="working-copy-restore-empty">
      没有待恢复的未保存内容
    </div>

    <div v-else class="restore-panel-list" data-codek-smoke="working-copy-restore-list">
      <article
        v-for="entry in actions"
        :key="entry.path"
        class="restore-panel-entry"
        :data-path="entry.path"
        :data-state="entry.state"
      >
        <div class="restore-entry-main">
          <div class="restore-entry-path">{{ entry.path }}</div>
          <div class="restore-entry-message">{{ entry.message }}</div>
        </div>
        <div class="restore-entry-actions">
          <button
            v-for="action in entry.actions"
            :key="action.id"
            class="restore-action-btn"
            :class="{ primary: entry.primaryAction?.id === action.id }"
            :disabled="!action.enabled || busyActionKey === `${entry.path}:${action.id}`"
            :title="action.description"
            :data-action="action.id"
            @click="$emit('apply', entry.path, action.id)"
          >
            <span v-if="busyActionKey === `${entry.path}:${action.id}`">处理中</span>
            <span v-else>{{ action.label }}</span>
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue"
import type { WorkingCopyHotExitStatus, WorkingCopyRestoreActionState } from "../workspace/manager"

const props = defineProps<{
  actions: WorkingCopyRestoreActionState[]
  status?: WorkingCopyHotExitStatus | null
  busyActionKey?: string
  errorMessage?: string
}>()

defineEmits<{
  apply: [path: string, action: WorkingCopyRestoreActionState["actions"][number]["id"]]
}>()

const statusLabel = computed(() => {
  if (props.busyActionKey) return "正在应用恢复操作"
  if (props.errorMessage) return "恢复操作失败"
  if (props.actions.length > 0) return "检测到 hot-exit 备份"
  if (props.status?.phase === "restoreChoicesUnavailable") return props.status.reason || "备份扫描未完成"
  if (props.status?.phase === "backupCleanup") return "备份清理已完成"
  return "备份扫描已完成"
})
</script>
