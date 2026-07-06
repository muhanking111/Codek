<template>
  <div class="agent-diff-viewer" data-codek-smoke="agent-diff-viewer">
    <div class="diff-head">
      <div>
        <div class="diff-title">Patch / Diff</div>
        <div class="diff-subtitle">{{ subtitle }}</div>
      </div>
      <button :disabled="busy || !runId" data-codek-smoke="load-orchestrator-diff" @click="$emit('load')">
        {{ busy ? "加载中" : diff ? "刷新" : "查看" }}
      </button>
    </div>

    <div v-if="diff?.filesChanged.length" class="diff-files">
      <span v-for="file in diff.filesChanged" :key="file">{{ file }}</span>
    </div>

    <div v-if="diff?.summaryDetails" class="diff-totals" data-codek-smoke="agent-diff-totals">
      <div>
        <span>文件</span>
        <strong>{{ diff.summaryDetails.totalFiles }}</strong>
      </div>
      <div>
        <span>新增</span>
        <strong>+{{ diff.summaryDetails.totalAdditions }}</strong>
      </div>
      <div>
        <span>删除</span>
        <strong>-{{ diff.summaryDetails.totalDeletions }}</strong>
      </div>
      <div :class="{ danger: diff.summaryDetails.permissionViolationCount > 0 }">
        <span>越界</span>
        <strong>{{ diff.summaryDetails.permissionViolationCount }}</strong>
      </div>
    </div>

    <div v-if="diff?.summaryDetails?.files?.length" class="diff-summary" data-codek-smoke="agent-diff-summary">
      <div
        v-for="item in diff.summaryDetails.files"
        :key="item.file"
        class="diff-summary-row"
        :class="{ danger: item.permission === 'permission_violation' }"
      >
        <span>{{ item.file }}</span>
        <strong>+{{ item.additions }} / -{{ item.deletions }}</strong>
        <em>{{ formatPermission(item.permission) }}</em>
      </div>
    </div>

    <div v-if="diff?.patches?.length" class="patch-list">
      <div v-for="patch in diff.patches" :key="patch.artifactId || patch.assignmentId || patch.content" class="patch-row">
        <div class="patch-meta">
          <span>{{ patch.filesChanged.join(", ") || "未标记文件" }}</span>
          <span>{{ patch.assignmentId || patch.artifactId || "patch" }}</span>
        </div>
        <pre>{{ patch.content }}</pre>
      </div>
    </div>

    <div v-else-if="diff" class="diff-empty">暂无可展示 patch 内容</div>
    <div v-else class="diff-empty">尚未加载 diff</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import type { ProposedPatch } from "../agent/orchestratorClient"

const props = defineProps<{
  runId?: string
  diff?: ProposedPatch | null
  busy?: boolean
}>()

defineEmits<{
  load: []
}>()

const subtitle = computed(() => {
  if (!props.diff) return "按需读取当前 run 的 proposed patch"
  return `${props.diff.summary || "待应用变更"} · ${props.diff.filesChanged.length} 个文件`
})
function formatPermission(value: string): string {
  if (value === "approved") return "已授权"
  if (value === "permission_violation") return "越界"
  return "未要求"
}
</script>

<style scoped>
.agent-diff-viewer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
}

.diff-head,
.patch-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
}

.diff-title {
  color: var(--text-bright);
  font-size: 13px;
  font-weight: 700;
}

.diff-subtitle,
.diff-empty,
.patch-meta {
  color: var(--text-muted);
  font-size: 12px;
}

button {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
}

button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text-bright);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.diff-files {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.diff-files span {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-secondary);
  background: var(--bg-dark);
  font-size: 11px;
}

.diff-totals {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.diff-totals div {
  min-width: 0;
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
}

.diff-totals span {
  display: block;
  color: var(--text-muted);
  font-size: 10px;
}

.diff-totals strong {
  display: block;
  margin-top: 2px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.diff-totals .danger {
  border-color: rgba(248, 113, 113, 0.5);
}

.diff-totals .danger strong {
  color: var(--red);
}

.diff-summary {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.diff-summary-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-muted);
  font-size: 11px;
}

.diff-summary-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-summary-row strong {
  color: var(--text-secondary);
  font-weight: 600;
}

.diff-summary-row em {
  color: var(--text-muted);
  font-style: normal;
}

.diff-summary-row.danger {
  border-color: rgba(248, 113, 113, 0.5);
}

.diff-summary-row.danger em {
  color: var(--red);
}

.patch-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.patch-row {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-deepest);
}

.patch-meta {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}

pre {
  margin: 0;
  padding: 8px;
  max-height: 260px;
  overflow: auto;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre;
}
</style>
