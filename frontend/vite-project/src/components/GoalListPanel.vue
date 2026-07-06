<template>
  <aside class="goal-panel" aria-label="任务中心" data-codek-smoke="task-center-panel">
    <header class="goal-panel-header">
      <div>
        <h2>任务中心</h2>
        <p>{{ schedulerLabel }}</p>
      </div>
      <button class="icon-btn" type="button" title="刷新任务" @click="load">↻</button>
    </header>

    <div class="task-summary" data-codek-smoke="task-center-summary">
      <span>全部 {{ summary.total }}</span>
      <span>运行 {{ summary.running }}</span>
      <span>阻塞 {{ summary.blocked }}</span>
      <span>完成 {{ summary.completed }}</span>
    </div>

    <div v-if="loading" class="goal-empty">正在加载任务...</div>
    <div v-else-if="error" class="goal-empty danger">{{ error }}</div>
    <div v-else-if="tasks.length === 0" class="goal-empty">暂无后台任务</div>

    <ul v-else class="goal-list">
      <li
        v-for="task in tasks"
        :key="`${task.kind}:${task.id}`"
        class="goal-item"
        data-codek-smoke="task-center-row"
      >
        <button class="goal-main" type="button" @click="openTask(task)">
          <span class="status-dot" :data-status="task.runtimeStatus || task.status"></span>
          <span class="goal-text">
            <span class="goal-title">{{ task.title || task.id }}</span>
            <span class="goal-meta">
              {{ kindLabel(task.kind) }} · {{ statusLabel(task) }}
              <template v-if="task.executionStrategy"> · {{ strategyLabel(task.executionStrategy) }}</template>
              <template v-if="task.projectRoot"> · {{ shortPath(task.projectRoot) }}</template>
            </span>
            <span v-if="task.runtimeReason || task.blockingReason" class="blocking-reason">{{ task.runtimeReason || task.blockingReason }}</span>
            <span v-if="task.nextAction" class="next-action">下一步: {{ task.nextAction }}</span>
            <span v-if="detailMessage(task)" class="detail-message" :class="{ danger: detailError(task) }">
              {{ detailMessage(task) }}
            </span>
          </span>
        </button>
        <div class="goal-actions">
          <button type="button" title="查看详情" @click="openTask(task)">查看</button>
          <button
            v-if="task.kind === 'goal' && (task.status === 'failed' || task.status === 'pending')"
            type="button"
            title="继续执行"
            @click="resumeGoal(task.id)"
          >
            继续
          </button>
          <button
            v-if="task.kind === 'goal' && (task.status === 'queued' || task.status === 'running')"
            type="button"
            title="取消任务"
            @click="cancelGoal(task.id)"
          >
            取消
          </button>
        </div>
      </li>
    </ul>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { listTaskCenter, type TaskCenterItem, type TaskCenterSummary } from "../agent/orchestratorClient"

interface SchedulerState {
  running?: boolean
  runningGoals?: number
  paused?: boolean
}

const emit = defineEmits<{
  (event: "openGoal", goalId: string): void
  (event: "openRun", runId: string): void
}>()

const tasks = ref<TaskCenterItem[]>([])
const summary = ref<TaskCenterSummary>({ total: 0, running: 0, blocked: 0, completed: 0 })
const scheduler = ref<SchedulerState | null>(null)
const loading = ref(false)
const error = ref("")
const openedTaskKey = ref("")
const detailErrors = ref<Record<string, string>>({})

const schedulerLabel = computed(() => {
  if (!scheduler.value?.running) return "调度器未连接"
  if (scheduler.value.paused) return "调度器已暂停"
  return `运行中 ${scheduler.value.runningGoals || 0} 个任务`
})

function api(method: string, path: string, body?: unknown) {
  const codek = (window as unknown as { codek?: { api?: (m: string, p: string, b?: unknown) => Promise<unknown> } }).codek
  if (!codek?.api) return Promise.resolve(null)
  return codek.api(method, path, body)
}

function statusLabel(task: TaskCenterItem): string {
  if (task.runtimeStatusLabel) return task.runtimeStatusLabel
  const status = task.runtimeStatus || task.status
  const labels: Record<string, string> = {
    planning: "规划中",
    pending: "待处理",
    queued: "排队中",
    running: "运行中",
    waiting_user: "等待确认",
    waiting_permission: "等待权限确认",
    waiting_decision: "等待变更审批",
    blocked: "已阻断",
    recovering: "恢复中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  }
  return labels[status] || status || "未知"
}

function kindLabel(kind: string): string {
  return kind === "orchestrator" ? "智能体" : "目标"
}

function strategyLabel(strategy: string): string {
  if (strategy === "multi-agent") return "多智能体"
  if (strategy === "single-agent") return "单智能体"
  if (strategy === "scheduler") return "调度器"
  return strategy
}

function shortPath(root: string): string {
  const parts = String(root || "").split(/[\\/]/).filter(Boolean)
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : root
}

async function load() {
  loading.value = true
  error.value = ""
  try {
    const [taskResult, schedulerResult] = await Promise.all([
      listTaskCenter(),
      api("GET", "/api/scheduler/state"),
    ])
    tasks.value = taskResult.tasks
    summary.value = taskResult.summary
    scheduler.value = (schedulerResult as SchedulerState | null) || null
    detailErrors.value = {}
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function openTask(task: TaskCenterItem) {
  const key = taskKey(task)
  detailErrors.value = { ...detailErrors.value, [key]: "" }
  if (task.kind === "orchestrator" && task.runId) {
    openedTaskKey.value = key
    emit("openRun", task.runId)
    return
  }
  const goalId = task.goalId || task.id
  if (goalId) {
    openedTaskKey.value = key
    emit("openGoal", goalId)
    return
  }
  detailErrors.value = {
    ...detailErrors.value,
    [key]: "详情不可用：缺少 runId / goalId。",
  }
}

function taskKey(task: TaskCenterItem): string {
  return `${task.kind}:${task.id}`
}

function detailError(task: TaskCenterItem): string {
  return detailErrors.value[taskKey(task)] || ""
}

function detailMessage(task: TaskCenterItem): string {
  const errorMessage = detailError(task)
  if (errorMessage) return errorMessage
  return openedTaskKey.value === taskKey(task) ? "详情已打开" : ""
}

async function resumeGoal(goalId: string) {
  await api("POST", `/api/goals/${goalId}/start`)
  await load()
}

async function cancelGoal(goalId: string) {
  await api("POST", `/api/goals/${goalId}/cancel`)
  await load()
}

onMounted(load)
</script>

<style scoped>
.goal-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel, #1e1e22);
  color: var(--text-primary, #e6e6e6);
}

.goal-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid var(--border-subtle, #2c2c30);
}

.goal-panel-header h2 {
  margin: 0;
  font-size: 14px;
}

.goal-panel-header p {
  margin: 4px 0 0;
  color: var(--text-muted, #888);
  font-size: 12px;
}

.task-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle, #2c2c30);
  color: var(--text-muted, #888);
  font-size: 11px;
}

.task-summary span {
  min-width: 0;
  text-align: center;
  white-space: nowrap;
}

.icon-btn,
.goal-actions button {
  border: 1px solid var(--border, #3a3a40);
  background: transparent;
  color: inherit;
  border-radius: 5px;
  cursor: pointer;
}

.icon-btn {
  width: 28px;
  height: 28px;
}

.goal-empty {
  padding: 16px;
  color: var(--text-muted, #888);
  font-size: 12px;
}

.goal-empty.danger {
  color: var(--red, #f87171);
}

.goal-list {
  list-style: none;
  margin: 0;
  padding: 8px;
  overflow: auto;
}

.goal-item {
  border: 1px solid var(--border-subtle, #2c2c30);
  border-radius: 6px;
  margin-bottom: 8px;
  padding: 8px;
  background: var(--bg-dark, #18181c);
}

.goal-main {
  width: 100%;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  text-align: left;
  cursor: pointer;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 5px;
  background: var(--text-muted, #888);
  flex-shrink: 0;
}

.status-dot[data-status="running"] { background: var(--accent, #0ea37f); }
.status-dot[data-status="queued"],
.status-dot[data-status="planning"] { background: var(--orange, #d97706); }
.status-dot[data-status="waiting_user"],
.status-dot[data-status="waiting_permission"],
.status-dot[data-status="waiting_decision"],
.status-dot[data-status="blocked"],
.status-dot[data-status="recovering"] { background: #facc15; }
.status-dot[data-status="completed"] { background: var(--green, #10b981); }
.status-dot[data-status="failed"] { background: var(--red, #dc2626); }
.status-dot[data-status="cancelled"] { background: var(--text-muted, #888); }

.goal-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.goal-title {
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.35;
}

.goal-meta,
.blocking-reason,
.next-action {
  color: var(--text-muted, #888);
  font-size: 11px;
}

.blocking-reason {
  color: #facc15;
}

.detail-message {
  color: var(--accent, #0ea37f);
  font-size: 11px;
}

.detail-message.danger {
  color: var(--red, #dc2626);
}

.goal-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.goal-actions button {
  padding: 4px 8px;
  font-size: 12px;
}
</style>
