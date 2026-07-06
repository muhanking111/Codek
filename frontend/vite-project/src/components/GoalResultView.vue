<script setup lang="ts">
import { computed } from "vue"

interface PhaseTimeline {
  id: string
  name: string
  status: string
  durationMs?: number
  reflections?: number
  summary?: string
}

interface FileChange {
  path: string
  added: number
  removed: number
  diff?: string
}

interface GoalResult {
  id: string
  description: string
  status: "completed" | "failed" | "running" | "queued" | "cancelled" | string
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  filesChanged?: FileChange[]
  linesAdded?: number
  linesRemoved?: number
  tokensUsed?: number
  tokenLimit?: number
  costUsed?: number
  costLimit?: number
  phases?: PhaseTimeline[]
  error?: string
  reflectionHistory?: { phaseId: string; reason: string; action: string }[]
}

const props = defineProps<{ goal: GoalResult | null }>()
const emit = defineEmits<{
  (e: "accept", goalId: string): void
  (e: "rollback", goalId: string): void
  (e: "createPr", goalId: string): void
  (e: "retry", goalId: string): void
  (e: "continue", goalId: string): void
}>()

const durationLabel = computed(() => {
  if (!props.goal?.durationMs) return ""
  const ms = props.goal.durationMs
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}m ${s}s`
})

const tokenPct = computed(() => {
  const used = props.goal?.tokensUsed || 0
  const limit = props.goal?.tokenLimit || 0
  if (!limit) return 0
  return Math.round((used / limit) * 100)
})

const statusIcon = computed(() => {
  switch (props.goal?.status) {
    case "completed": return "OK"
    case "failed": return "!"
    case "running": return "..."
    case "cancelled": return "-"
    default: return "+"
  }
})

function phaseDuration(ms?: number): string {
  if (!ms) return ""
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}m ${String(s).padStart(2, "0")}s`
}
</script>

<template>
  <div v-if="goal" class="goal-result">
    <header class="result-header">
      <span class="status-icon">{{ statusIcon }}</span>
      <span class="title">{{ goal.description }}</span>
      <span v-if="durationLabel" class="duration">耗时 {{ durationLabel }}</span>
    </header>

    <section class="overview">
      <h4>概览</h4>
      <div class="stats">
        <span>修改文件: {{ goal.filesChanged?.length || 0 }} 个</span>
        <span>新增: {{ goal.linesAdded || 0 }} 行</span>
        <span>删除: {{ goal.linesRemoved || 0 }} 行</span>
        <span>Token: {{ goal.tokensUsed || 0 }} / {{ goal.tokenLimit || 0 }} ({{ tokenPct }}%)</span>
        <span>成本: ${{ (goal.costUsed || 0).toFixed(3) }}</span>
      </div>
    </section>

    <section v-if="goal.phases?.length" class="timeline">
      <h4>执行时间线</h4>
      <ul>
        <li v-for="phase in goal.phases" :key="phase.id">
          <span class="phase-icon">{{ phase.status === "done" ? "OK" : phase.status === "failed" ? "!" : "+" }}</span>
          <span class="phase-name">{{ phase.name }}</span>
          <span class="phase-time">{{ phaseDuration(phase.durationMs) }}</span>
          <span v-if="phase.reflections" class="reflections">反思 {{ phase.reflections }} 次</span>
        </li>
      </ul>
    </section>

    <section v-if="goal.filesChanged?.length" class="files">
      <h4>文件变更</h4>
      <ul>
        <li v-for="file in goal.filesChanged" :key="file.path" class="file-row">
          <span class="file-path">{{ file.path }}</span>
          <span class="file-diff">+{{ file.added }} -{{ file.removed }}</span>
        </li>
      </ul>
    </section>

    <section v-if="goal.error" class="error">
      <h4>错误</h4>
      <pre>{{ goal.error }}</pre>
    </section>

    <section class="actions">
      <template v-if="goal.status === 'completed'">
        <button @click="emit('accept', goal.id)">接受变更</button>
        <button @click="emit('rollback', goal.id)">回滚</button>
        <button @click="emit('createPr', goal.id)">创建 PR</button>
        <button @click="emit('continue', goal.id)">继续优化</button>
      </template>
      <template v-else-if="goal.status === 'failed'">
        <button @click="emit('retry', goal.id)">重试</button>
        <button @click="emit('rollback', goal.id)">回滚</button>
      </template>
    </section>
  </div>
</template>

<style scoped>
.goal-result {
  padding: 16px;
  font-size: 13px;
  border: 1px solid var(--codek-border, #333);
  border-radius: 8px;
}

.result-header {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
  font-size: 15px;
  font-weight: 600;
}

.status-icon {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  min-width: 24px;
  text-align: center;
}

.title {
  min-width: 0;
  overflow-wrap: anywhere;
}

.duration {
  color: var(--codek-muted, #888);
  font-weight: normal;
  margin-left: auto;
  font-size: 12px;
  white-space: nowrap;
}

section {
  margin: 12px 0;
}

section h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--codek-muted, #888);
}

.stats {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.timeline ul,
.files ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.timeline li {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 2px 0;
}

.phase-icon {
  width: 24px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.phase-name {
  min-width: 0;
  overflow-wrap: anywhere;
}

.phase-time {
  color: var(--codek-muted, #888);
  font-size: 11px;
  margin-left: auto;
}

.reflections {
  font-size: 11px;
  color: var(--codek-accent, #2196f3);
  margin-left: 8px;
  white-space: nowrap;
}

.file-row {
  display: flex;
  gap: 12px;
  padding: 2px 0;
}

.file-path {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.file-diff {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: var(--codek-muted, #888);
  white-space: nowrap;
}

.error pre {
  background: rgba(244, 67, 54, 0.08);
  padding: 8px;
  border-radius: 4px;
  white-space: pre-wrap;
  font-size: 11px;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.actions button {
  padding: 6px 12px;
  font-size: 12px;
}
</style>
