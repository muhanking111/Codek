<script setup lang="ts">
import { computed } from "vue"
import type { TaskStep } from "../agent/taskPlanner"

interface Props {
  steps: TaskStep[]
  currentStepId?: string | null
  visible?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  currentStepId: null,
  visible: true,
})

const total = computed(() => props.steps.length)
const completed = computed(() => props.steps.filter((s) => s.status === "completed").length)
const failed = computed(() => props.steps.filter((s) => s.status === "failed").length)
const running = computed(() => props.steps.filter((s) => s.status === "running").length)
const percent = computed(() => {
  if (total.value === 0) return 0
  return Math.round(((completed.value + failed.value) / total.value) * 100)
})

const statusClass = (status: TaskStep["status"]): string => {
  switch (status) {
    case "completed": return "chip chip-done"
    case "running": return "chip chip-running"
    case "failed": return "chip chip-failed"
    case "skipped": return "chip chip-skipped"
    default: return "chip chip-pending"
  }
}

const currentStep = computed(() => {
  if (!props.currentStepId) return null
  return props.steps.find((s) => s.id === props.currentStepId) || null
})
</script>

<template>
  <div v-if="visible && total > 0" class="task-progress">
    <div class="header">
      <span class="label">任务进度</span>
      <span class="count">{{ completed }}/{{ total }} 完成{{ failed > 0 ? `（${failed} 失败）` : "" }}</span>
    </div>

    <div class="bar">
      <div class="bar-fill" :style="{ width: percent + '%' }" />
    </div>

    <div class="chips">
      <span
        v-for="step in steps"
        :key="step.id"
        :class="statusClass(step.status)"
        :title="`${step.id}: ${step.description}`"
      />
    </div>

    <div v-if="currentStep" class="current">
      <span class="pulse" />
      <span class="current-text">{{ currentStep.description }}</span>
    </div>
  </div>
</template>

<style scoped>
.task-progress {
  border: 1px solid var(--vscode-panel-border, #3c3c3c);
  background: var(--vscode-editor-background, #1e1e1e);
  border-radius: 6px;
  padding: 10px 12px;
  margin: 8px 0;
  font-size: 12px;
  color: var(--vscode-foreground, #ccc);
}

.header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  font-weight: 500;
}

.count {
  color: var(--vscode-descriptionForeground, #9d9d9d);
}

.bar {
  height: 4px;
  background: var(--vscode-progressBar-background, #3c3c3c);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 8px;
}

.bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #0e7afe, #4ec9b0);
  transition: width 0.3s ease;
}

.chips {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.chip {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.chip-pending { background: #555; }
.chip-running {
  background: #0e7afe;
  animation: pulse 1.2s ease-in-out infinite;
}
.chip-done { background: #4ec9b0; }
.chip-failed { background: #f48771; }
.chip-skipped { background: #888; opacity: 0.5; }

.current {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground, #9d9d9d);
}

.pulse {
  width: 6px;
  height: 6px;
  background: #0e7afe;
  border-radius: 50%;
  animation: pulse 1s ease-in-out infinite;
}

.current-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
