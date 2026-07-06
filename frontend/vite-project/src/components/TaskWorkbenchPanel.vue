<template>
  <section
    v-if="visible"
    class="task-workbench-panel"
    data-codek-smoke="task-workbench-panel"
    :data-task-workbench-view-id="snapshot.tasks.viewId"
    :data-task-workbench-state-source="snapshot.tasks.stateSource"
    :data-task-workbench-run-config-count="snapshot.tasks.runConfigCount"
    :data-task-workbench-latest-status="latestEvidence?.status || ''"
    :data-task-workbench-output-preview="latestOutputPreview"
  >
    <header class="task-workbench-header">
      <div>
        <h2>任务</h2>
        <p>已配置 {{ snapshot.tasks.runConfigCount }} 个</p>
      </div>
      <button class="task-workbench-close" type="button" aria-label="关闭任务面板" title="关闭任务面板" @click="emit('close')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </header>

    <div class="task-workbench-body">
      <div class="task-workbench-list" data-codek-smoke="task-workbench-list">
        <article
          v-for="config in runConfigs"
          :key="config.id"
          class="task-workbench-row"
          :class="{ active: config.id === activeTaskId }"
          :data-task-id="config.id"
          :data-task-source="config.source || ''"
        >
          <div class="task-row-main">
            <span class="task-row-name">{{ config.name }}</span>
            <span class="task-row-command">{{ config.command }}</span>
          </div>
          <span class="task-row-kind">{{ config.type }}</span>
        </article>
        <p v-if="runConfigs.length === 0" class="task-workbench-empty">尚未配置任务</p>
      </div>

      <aside class="task-workbench-evidence" data-codek-smoke="task-workbench-evidence">
        <span class="task-evidence-label">最近运行</span>
        <strong>{{ taskEvidenceStatusLabel(latestEvidence?.status) }}</strong>
        <p>{{ latestEvidence?.summary || "尚未记录任务运行证据" }}</p>
        <p v-if="latestOutputPreview" class="task-evidence-output" data-codek-smoke="task-workbench-output-preview">
          {{ latestOutputPreview }}
        </p>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { globalTaskService, globalTerminalDebugTaskWorkbenchService } from "../workbench/terminalDebugTaskWorkbench"
import { userTasksService } from "../workbench/userTasks"

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const snapshot = computed(() => globalTerminalDebugTaskWorkbenchService.getSurfaceSnapshot())
const runConfigs = computed(() => {
  userTasksService.getRevision()
  return globalTaskService.getTasks()
})
const activeTaskId = computed(() => snapshot.value.tasks.activeTaskId)
const latestEvidence = computed(() => snapshot.value.tasks.latestEvidence)
const latestOutputPreview = computed(() => latestEvidence.value?.steps.find((step) => step.outputPreview)?.outputPreview || "")

function taskEvidenceStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    passed: "通过",
    failed: "失败",
    running: "运行中",
    queued: "排队中",
    blocked: "已阻断",
    cancelled: "已取消",
    none: "暂无",
  }
  return labels[String(status || "none")] || String(status || "暂无")
}
</script>

<style scoped>
.task-workbench-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  color: var(--text-primary);
}

.task-workbench-header {
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.task-workbench-header h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.task-workbench-header p {
  margin: 1px 0 0;
  color: var(--text-muted);
  font-size: 10px;
}

.task-workbench-close {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
}

.task-workbench-close:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.task-workbench-body {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
}

.task-workbench-list {
  min-height: 0;
  overflow: auto;
  padding: 6px;
}

.task-workbench-row {
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 8px;
  border-radius: 4px;
}

.task-workbench-row:hover,
.task-workbench-row.active {
  background: var(--bg-hover);
}

.task-row-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.task-row-name {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-row-command {
  color: var(--text-muted);
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-row-kind {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 10px;
  text-transform: uppercase;
}

.task-workbench-evidence {
  min-width: 0;
  border-left: 1px solid var(--border-subtle);
  padding: 10px;
  overflow: auto;
}

.task-evidence-label {
  color: var(--text-muted);
  font-size: 10px;
  text-transform: uppercase;
}

.task-workbench-evidence strong {
  display: block;
  margin-top: 4px;
  font-size: 13px;
}

.task-workbench-evidence p,
.task-workbench-empty {
  color: var(--text-muted);
  font-size: 12px;
}

.task-evidence-output {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
