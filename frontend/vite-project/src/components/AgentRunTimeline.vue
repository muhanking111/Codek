<template>
  <div class="agent-run-timeline">
    <div v-for="(event, index) in events" :key="index" class="timeline-row">
      <span class="timeline-dot" />
      <span class="timeline-type">{{ formatType(event.type) }}</span>
      <span class="timeline-meta">{{ formatMeta(event) }}</span>
    </div>
    <div v-if="events.length === 0" class="timeline-empty">暂无事件</div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  events: Array<Record<string, unknown>>
}>()

function formatType(type: unknown): string {
  const normalized = String(type || "event").replace(/[:_\s]+/g, "-").toLowerCase()
  const map: Record<string, string> = {
    "orchestrator-recovered": "编排器已恢复",
    "orchestrator-recovered-interrupted": "编排器恢复中断",
    "orchestrator-strategy-selected": "已选择执行策略",
    "command-executed": "命令已执行",
    "workspace-file-operation": "文件操作",
    "file-changed": "文件变更",
    "diff-available": "变更可查看",
    "checkpoint-saved": "检查点已保存",
    "checkpoint-resumed": "已从检查点恢复",
  }
  return map[normalized] || "任务事件"
}

function formatMeta(event: Record<string, unknown>): string {
  if (event.status) return formatStatus(event.status)
  if (event.phaseId) return formatPhase(event.phaseId)
  if (event.error) return String(event.error)
  return ""
}

function formatStatus(status: unknown): string {
  const value = String(status || "").toLowerCase()
  const map: Record<string, string> = {
    completed: "已完成",
    failed: "失败",
    blocked: "已阻断",
    unknown: "未记录",
    ready: "就绪",
    running: "运行中",
    pending: "等待中",
    queued: "排队中",
  }
  return map[value] || String(status || "未记录")
}

function formatPhase(phase: unknown): string {
  return String(phase || "阶段").replace(/^phase[-_:]?/i, "阶段 ").replace(/[-_]+/g, " ")
}
</script>

<style scoped>
.agent-run-timeline {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.timeline-row {
  display: grid;
  grid-template-columns: 10px minmax(120px, auto) 1fr;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}

.timeline-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}

.timeline-type {
  color: var(--text-bright);
  font-weight: 600;
}

.timeline-meta,
.timeline-empty {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
