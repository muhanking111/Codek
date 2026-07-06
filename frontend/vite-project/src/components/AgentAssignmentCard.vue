<template>
  <div class="assignment-card" :class="assignment.status">
    <div class="assignment-head">
      <span class="assignment-role">{{ roleLabel }}</span>
      <span class="assignment-status">{{ statusLabel }}</span>
    </div>
    <div class="assignment-phase">{{ phaseLabel }}</div>
    <div class="assignment-meta">
      <span>{{ sandboxLabel }}</span>
      <span v-if="assignment.workspaceId">{{ assignment.workspaceId }}</span>
    </div>
    <div v-if="assignment.writePaths?.length" class="assignment-paths">
      <span v-for="path in assignment.writePaths" :key="path">{{ path }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import type { AgentAssignment } from "../agent/orchestratorClient"

const props = defineProps<{
  assignment: AgentAssignment
}>()

const roleNames: Record<string, string> = {
  planner: "规划",
  researcher: "调研",
  implementer: "实现",
  coder: "编码",
  reviewer: "审查",
  tester: "测试",
  verifier: "验证",
  integrator: "集成",
}

const roleLabel = computed(() => roleNames[props.assignment.role] || props.assignment.role)
const statusLabel = computed(() => {
  const value = String(props.assignment.status || "").toLowerCase()
  const map: Record<string, string> = {
    queued: "排队中",
    pending: "等待中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    blocked: "已阻断",
  }
  return map[value] || props.assignment.status || "未记录"
})
const phaseLabel = computed(() => String(props.assignment.phaseId || "阶段").replace(/^phase[-_:]?/i, "阶段 ").replace(/[-_]+/g, " "))
const sandboxLabel = computed(() => {
  const value = String(props.assignment.sandboxMode || "").toLowerCase()
  if (value === "workspace-write") return "工作区写入"
  if (value === "read-only") return "只读"
  if (value === "danger-full-access") return "完全访问"
  return props.assignment.sandboxMode || "默认沙箱"
})
</script>

<style scoped>
.assignment-card {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.assignment-card.running {
  border-color: var(--accent);
}

.assignment-card.failed {
  border-color: var(--red);
}

.assignment-head,
.assignment-meta,
.assignment-paths {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
}

.assignment-head {
  justify-content: space-between;
}

.assignment-role {
  color: var(--text-bright);
  font-size: 12px;
  font-weight: 700;
}

.assignment-status,
.assignment-meta,
.assignment-phase,
.assignment-paths {
  color: var(--text-muted);
  font-size: 11px;
}

.assignment-paths {
  flex-wrap: wrap;
}

.assignment-paths span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--bg-hover);
}
</style>
