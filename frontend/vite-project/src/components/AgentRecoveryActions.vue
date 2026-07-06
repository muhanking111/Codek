<template>
  <div class="recovery-actions" data-codek-smoke="agent-recovery-actions">
    <div class="recovery-head">
      <div>
        <span>失败恢复</span>
        <small>{{ summary }}</small>
      </div>
      <strong>{{ actions.length }}</strong>
    </div>

    <div v-if="actions.length === 0" class="recovery-empty">暂无恢复动作。任务失败、冲突、超时或需求不清时，这里会出现可执行建议。</div>

    <div
      v-for="action in actions"
      :key="action.id"
      class="recovery-row"
      :class="action.status"
      data-codek-smoke="agent-recovery-action-row"
    >
      <div class="recovery-info">
        <div class="recovery-title-row">
          <span class="recovery-title">{{ labelOf(action.action) }}</span>
          <span class="recovery-type">{{ failureTypeLabel(action) }}</span>
        </div>
        <div class="recovery-reason">{{ action.reason || fallbackReason(action.action) }}</div>
        <div class="recovery-next">{{ nextActionLabel(action) }}</div>
      </div>
      <button
        :disabled="busy || isTerminal(action.status)"
        @click="$emit('execute', action.id)"
      >
        {{ action.status === "completed" ? "已执行" : action.status === "running" ? "执行中" : "执行" }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import type { RecoveryAction } from "../agent/orchestratorClient"

const props = defineProps<{
  actions: RecoveryAction[]
  busy?: boolean
}>()

defineEmits<{
  execute: [actionId: string]
}>()

const summary = computed(() => {
  if (!props.actions.length) return "当前 run 没有阻断恢复项"
  const pending = props.actions.filter((action) => !isTerminal(action.status)).length
  return pending > 0 ? `${pending} 个动作等待处理` : "恢复动作已处理"
})

function labelOf(action: RecoveryAction["action"]): string {
  const labels: Record<RecoveryAction["action"], string> = {
    retry: "重试当前阶段",
    rewind: "回退到上一步",
    split: "拆分任务",
    ask_user: "向用户澄清",
    abort: "终止任务",
  }
  return labels[action] || action
}

function failureTypeLabel(action: RecoveryAction): string {
  const text = `${action.reason || ""} ${action.action || ""}`.toLowerCase()
  if (/permission|权限/.test(text)) return "权限等待"
  if (/quality|质量门|typecheck|test/.test(text)) return "质量门失败"
  if (/conflict|冲突|lock/.test(text)) return "冲突"
  if (/clarify|ask|需求|澄清/.test(text)) return "需求不清"
  if (/timeout|超时/.test(text)) return "超时"
  if (/abort|cancel|终止|取消/.test(text)) return "中断恢复"
  return "执行失败"
}

function fallbackReason(action: RecoveryAction["action"]): string {
  if (action === "retry") return "重新执行当前失败阶段。"
  if (action === "rewind") return "回退到最近 checkpoint 后重新处理。"
  if (action === "split") return "把大任务拆成更小的子任务。"
  if (action === "ask_user") return "需要用户补充目标、范围或约束。"
  if (action === "abort") return "停止当前 run，保留已有证据。"
  return "等待处理。"
}

function nextActionLabel(action: RecoveryAction): string {
  if (action.status === "completed") return "该恢复动作已执行，结果已进入任务记录。"
  if (action.status === "running") return "正在执行恢复动作，请等待状态刷新。"
  if (action.action === "ask_user") return "执行后任务会进入等待用户补充状态。"
  if (action.action === "split") return "执行后会生成拆分建议，便于重新规划。"
  if (action.action === "abort") return "执行后任务会取消，不会继续写入。"
  return "执行后会刷新 run 状态、决策记录和产物。"
}

function isTerminal(status?: string): boolean {
  return status === "completed" || status === "cancelled"
}
</script>

<style scoped>
.recovery-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
}

.recovery-head,
.recovery-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.recovery-head span {
  display: block;
  color: var(--text-bright);
  font-size: 13px;
  font-weight: 700;
}

.recovery-head small,
.recovery-empty,
.recovery-reason,
.recovery-next {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.recovery-head strong {
  color: var(--text-secondary);
  font-size: 13px;
}

.recovery-row {
  padding: 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-dark);
}

.recovery-row.completed {
  opacity: 0.78;
}

.recovery-row.running {
  border-color: rgba(59, 130, 246, 0.45);
}

.recovery-info {
  min-width: 0;
}

.recovery-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.recovery-title {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.recovery-type {
  padding: 1px 6px;
  border-radius: 999px;
  color: var(--text-muted);
  background: var(--bg-elevated);
  font-size: 11px;
}

.recovery-reason {
  margin-top: 5px;
}

.recovery-next {
  margin-top: 4px;
  color: var(--text-secondary);
}

button {
  flex: 0 0 auto;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-deepest);
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
</style>
