<script setup lang="ts">
import { computed } from "vue"

interface Task {
  id: string
  description: string
  status: string
  tool?: string | null
}

interface Phase {
  id: string
  name: string
  agent: string
  status: string
  dependsOn: string[]
  parallelWith?: string[]
  tasks: Task[]
  result?: { summary?: string; filesChanged?: string[]; error?: string } | null
}

interface Plan {
  id: string
  goal: string
  status: string
  phases: Phase[]
}

const props = defineProps<{
  plan: Plan | null
  expandedPhases?: Record<string, boolean>
}>()

const emit = defineEmits<{
  (e: "retry", phaseId: string): void
  (e: "skip", phaseId: string): void
  (e: "edit", phaseId: string): void
  (e: "toggleExpand", phaseId: string): void
}>()

const phases = computed(() => props.plan?.phases || [])

function statusIcon(status: string): string {
  switch (status) {
    case "done": return "OK"
    case "running": return "..."
    case "failed": return "!"
    case "skipped": return "-"
    case "blocked": return "LOCK"
    default: return "+"
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "done": return "var(--codek-success, #4caf50)"
    case "running": return "var(--codek-accent, #2196f3)"
    case "failed":
    case "blocked":
      return "var(--codek-error, #f44336)"
    default: return "var(--codek-muted, #888)"
  }
}

function isExpanded(phaseId: string): boolean {
  return !!props.expandedPhases?.[phaseId]
}
</script>

<template>
  <div v-if="plan" class="plan-tree">
    <div class="plan-header">
      <span class="plan-label">计划:</span>
      <span class="plan-goal">{{ plan.goal }}</span>
    </div>
    <ul class="phases">
      <li v-for="phase in phases" :key="phase.id" class="phase">
        <div class="phase-header" @click="emit('toggleExpand', phase.id)">
          <span class="phase-icon" :style="{ color: statusColor(phase.status) }">
            {{ statusIcon(phase.status) }}
          </span>
          <span class="phase-name">{{ phase.name }}</span>
          <span class="phase-agent">[{{ phase.agent }}]</span>
          <span v-if="phase.parallelWith && phase.parallelWith.length" class="phase-parallel">并行</span>
        </div>
        <div v-if="isExpanded(phase.id)" class="phase-body">
          <ul class="tasks">
            <li v-for="task in phase.tasks" :key="task.id" class="task">
              <span class="task-icon" :style="{ color: statusColor(task.status) }">
                {{ statusIcon(task.status) }}
              </span>
              <span class="task-desc">{{ task.description }}</span>
            </li>
          </ul>
          <div v-if="phase.result?.summary" class="phase-summary">
            {{ phase.result.summary }}
          </div>
          <div v-if="phase.result?.error" class="phase-error">
            {{ phase.result.error }}
          </div>
          <div v-if="phase.status === 'failed'" class="phase-actions">
            <button @click.stop="emit('retry', phase.id)">重试</button>
            <button @click.stop="emit('skip', phase.id)">跳过</button>
            <button @click.stop="emit('edit', phase.id)">修改计划</button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.plan-tree {
  border: 1px solid var(--codek-border, #333);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  background: var(--codek-bg-soft, rgba(255, 255, 255, 0.02));
}

.plan-header {
  margin-bottom: 6px;
  font-weight: 600;
}

.plan-label {
  color: var(--codek-muted, #888);
  margin-right: 4px;
}

.phases {
  list-style: none;
  padding: 0;
  margin: 0;
}

.phase {
  margin: 4px 0;
}

.phase-header {
  cursor: pointer;
  display: flex;
  gap: 6px;
  align-items: center;
  min-height: 24px;
}

.phase-header:hover {
  background: rgba(255, 255, 255, 0.04);
}

.phase-icon,
.task-icon {
  width: 28px;
  flex: 0 0 28px;
  text-align: center;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10px;
}

.phase-name,
.task-desc,
.plan-goal {
  min-width: 0;
  overflow-wrap: anywhere;
}

.phase-agent {
  color: var(--codek-muted, #888);
  font-size: 11px;
  white-space: nowrap;
}

.phase-parallel {
  color: var(--codek-accent, #2196f3);
  white-space: nowrap;
}

.phase-body {
  margin-left: 20px;
  margin-top: 4px;
}

.tasks {
  list-style: none;
  padding: 0;
  margin: 0;
}

.task {
  display: flex;
  gap: 6px;
  margin: 2px 0;
}

.phase-summary {
  margin-top: 6px;
  padding: 4px 8px;
  background: rgba(76, 175, 80, 0.08);
  border-left: 2px solid var(--codek-success, #4caf50);
  white-space: pre-wrap;
}

.phase-error {
  margin-top: 6px;
  padding: 4px 8px;
  background: rgba(244, 67, 54, 0.08);
  border-left: 2px solid var(--codek-error, #f44336);
  white-space: pre-wrap;
}

.phase-actions {
  margin-top: 6px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.phase-actions button {
  font-size: 11px;
  padding: 2px 8px;
}
</style>
