<template>
  <div v-if="visible" class="agent-panel">
    <div class="agent-header">
      <div class="agent-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <span>自主智能体</span>
        <span v-if="agentState.mode === 'autonomous'" class="mode-badge autonomous">自主模式</span>
        <span v-else class="mode-badge supervised">监督模式</span>
      </div>
      <div class="agent-actions">
        <button v-if="agentState.tasks.length > 0" class="agent-btn" @click="openTaskGraph">
          📊 查看任务图
        </button>
        <button v-if="!isRunning" class="agent-btn" @click="toggleMode">
          {{ agentState.mode === 'autonomous' ? '🔓 切换到监督模式' : '🔒 切换到自主模式' }}
        </button>
        <button v-if="isRunning" class="agent-btn stop" @click="stopAgent">⏹ 停止</button>
        <button class="agent-btn-icon" @click="$emit('close')" title="关闭">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <div class="agent-body">
      <!-- 目标输入 -->
      <div v-if="!isRunning && !agentState.goal" class="goal-input-section">
        <textarea
          v-model="goalInput"
          class="goal-input"
          placeholder="描述你希望智能体完成的任务...\n\n示例：\n- 为用户管理创建带 CRUD 操作的 REST API\n- 修复项目中的所有 TypeScript 错误\n- 为认证模块补充单元测试"
          rows="6"
        />
        <button class="start-btn" :disabled="!goalInput.trim()" @click="startAgent">
          启动智能体
        </button>
      </div>

      <!-- 目标展示 -->
      <div v-if="agentState.goal" class="goal-display">
        <div class="goal-label">目标：</div>
        <div class="goal-text">{{ agentState.goal }}</div>
      </div>

      <!-- 任务列表 -->
      <div v-if="agentState.tasks.length > 0" class="tasks-section">
        <div class="section-title">📋 任务（{{ completedTasks }}/{{ agentState.tasks.length }}）</div>
        <div class="tasks-list">
          <div
            v-for="(task, idx) in agentState.tasks"
            :key="task.id"
            class="task-item"
            :class="{
              current: idx === agentState.currentTaskIndex,
              completed: task.status === 'completed',
              failed: task.status === 'failed',
              running: task.status === 'running',
            }"
          >
            <div class="task-status">
              <span v-if="task.status === 'completed'">✓</span>
              <span v-else-if="task.status === 'failed'">✗</span>
              <span v-else-if="task.status === 'running'">⏳</span>
              <span v-else>○</span>
            </div>
            <div class="task-content">
              <div class="task-description">{{ task.description }}</div>
              <div v-if="task.error" class="task-error">{{ task.error }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 待审批操作 -->
      <div v-if="agentState.pendingApprovals.length > 0" class="approvals-section">
        <div class="section-title">⚠️ 待审批操作</div>
        <div class="approvals-list">
          <div v-for="op in agentState.pendingApprovals" :key="op.id" class="approval-item">
            <div class="approval-header">
              <span class="risk-badge" :class="op.risk">{{ op.risk.toUpperCase() }}</span>
              <span class="approval-type">{{ op.type }}</span>
            </div>
            <div class="approval-description">{{ op.description }}</div>
            <div class="approval-target">目标：{{ op.target }}</div>
            <div class="approval-actions">
              <button class="approve-btn" @click="approveOperation(op.id, true)">✓ 允许</button>
              <button class="reject-btn" @click="approveOperation(op.id, false)">✗ 拒绝</button>
            </div>
          </div>
        </div>
      </div>

      <!-- 进度日志 -->
      <div v-if="progressLog.length > 0" class="progress-section">
        <div class="section-title">📝 进度日志</div>
        <div class="progress-log">
          <div v-for="(msg, idx) in progressLog" :key="idx" class="progress-msg">
            {{ msg }}
          </div>
        </div>
      </div>

      <!-- 操作历史 -->
      <div v-if="agentState.operations.length > 0" class="operations-section">
        <div class="section-title">🔧 操作（{{ agentState.operations.length }}）</div>
        <div class="operations-list">
          <div v-for="op in agentState.operations.slice(-10)" :key="op.id" class="operation-item">
            <span class="op-icon" :class="op.approved === false ? 'rejected' : 'approved'">{{ op.approved === false ? '✗' : '✓' }}</span>
            <span class="op-type">{{ op.type }}</span>
            <span class="op-desc">{{ op.description }}</span>
          </div>
        </div>
      </div>
    </div>

    <TaskGraphModal
      :visible="showTaskGraph"
      :tasks="agentState.tasks"
      @close="showTaskGraph = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { AutonomousAgent } from '../agent/agentCore'
import type { AgentState, AgentOperation, AgentMode } from '../agent/agentCore'
import { buildMemoryContextAsync, rememberError, rememberSuccess, rememberPreference } from '../agent/agentMemory'
import { executeWithRetry, verifyTaskCompletion, buildRetryPrompt } from '../agent/agentVerify'
import TaskGraphModal from './TaskGraphModal.vue'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const goalInput = ref('')
const isRunning = ref(false)
const progressLog = ref<string[]>([])
const showTaskGraph = ref(false)
const agentState = ref<AgentState>({
  mode: 'supervised',
  goal: '',
  tasks: [],
  currentTaskIndex: 0,
  operations: [],
  pendingApprovals: [],
  context: new Map(),
  sandboxActive: false,
})

const pendingApprovalResolvers = new Map<string, (approved: boolean) => void>()

let agent: AutonomousAgent | null = null

const completedTasks = computed(() => {
  return agentState.value.tasks.filter((t) => t.status === 'completed').length
})

function toggleMode() {
  const newMode = agentState.value.mode === 'autonomous' ? 'supervised' : 'autonomous'
  agentState.value.mode = newMode
  rememberPreference(`用户偏好 ${newMode === 'autonomous' ? '自主模式' : '监督模式'}`)
}

async function startAgent() {
  if (!goalInput.value.trim()) return

  isRunning.value = true
  progressLog.value = []

  // 加载记忆上下文
  const memoryContext = await buildMemoryContextAsync(goalInput.value)
  if (memoryContext) {
    progressLog.value.push('💡 已加载过去会话中的相关记忆')
  }

  agent = new AutonomousAgent({
    mode: agentState.value.mode,
    onStateChange: (state) => {
      agentState.value = state
    },
    onApprovalRequest: (op) => {
      return new Promise<boolean>((resolve) => {
        pendingApprovalResolvers.set(op.id, resolve)
      })
    },
    onProgress: (message) => {
      progressLog.value.push(message)
      setTimeout(() => {
        const logEl = document.querySelector('.progress-log')
        if (logEl) logEl.scrollTop = logEl.scrollHeight
      }, 50)
    },
  })

  try {
    await executeWithRetry(
      async () => {
        if (!agent) throw new Error('智能体尚未初始化')
        await agent.start(goalInput.value)
      },
      {
        maxAttempts: 3,
        backoffMs: 2000,
        shouldRetry: (error, attempt) => {
          return !error.message.includes('用户拒绝') && !error.message.includes('rejected by user') && attempt < 3
        },
      },
      (attempt, error) => {
        progressLog.value.push(`⚠️ 第 ${attempt} 次尝试失败：${error.message}`)
        progressLog.value.push('🔄 正在调整方案后重试...')
        rememberError(error.message, { goal: goalInput.value, attempt })
      },
    )

    progressLog.value.push('✅ 目标已成功完成')
    rememberSuccess(`已完成：${goalInput.value}`)
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    progressLog.value.push(`智能体执行失败：${errorMsg}`)
    rememberError(errorMsg, { goal: goalInput.value })
  } finally {
    isRunning.value = false
  }
}

function stopAgent() {
  if (agent) {
    agent.stop()
    isRunning.value = false
  }
}

function approveOperation(opId: string, approved: boolean) {
  const resolver = pendingApprovalResolvers.get(opId)
  if (resolver) {
    resolver(approved)
    pendingApprovalResolvers.delete(opId)

    if (!approved) {
      rememberPreference('用户拒绝操作：' + opId)
    }
  }
}

function openTaskGraph() {
  showTaskGraph.value = true
}
</script>

<style scoped>
.agent-panel {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 500px;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  z-index: 1000;
}

.agent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-primary);
}

.agent-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
}

.mode-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.mode-badge.autonomous {
  background: #ff6b6b22;
  color: #ff6b6b;
}

.mode-badge.supervised {
  background: #51cf6622;
  color: #51cf66;
}

.agent-actions {
  display: flex;
  gap: 8px;
}

.agent-btn {
  padding: 6px 12px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
}

.agent-btn:hover {
  background: var(--bg-tertiary);
}

.agent-btn.stop {
  background: #ff6b6b22;
  border-color: #ff6b6b;
  color: #ff6b6b;
}

.agent-btn-icon {
  padding: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-secondary);
}

.agent-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.goal-input-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.goal-input {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
}

.start-btn {
  padding: 12px;
  border-radius: 6px;
  border: none;
  background: var(--accent);
  color: white;
  font-weight: 600;
  cursor: pointer;
  font-size: 14px;
}

.start-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.goal-display {
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 6px;
  border-left: 3px solid var(--accent);
}

.goal-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.goal-text {
  font-size: 13px;
  color: var(--text-primary);
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.tasks-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-item {
  display: flex;
  gap: 10px;
  padding: 10px;
  border-radius: 6px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
}

.task-item.current {
  border-color: var(--accent);
  background: var(--bg-tertiary);
}

.task-item.completed {
  opacity: 0.7;
}

.task-item.failed {
  border-color: #ff6b6b;
}

.task-status {
  font-size: 16px;
}

.task-content {
  flex: 1;
}

.task-description {
  font-size: 13px;
  color: var(--text-primary);
}

.task-error {
  margin-top: 4px;
  font-size: 12px;
  color: #ff6b6b;
}

.approvals-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.approval-item {
  padding: 12px;
  border-radius: 6px;
  background: #ff6b6b11;
  border: 1px solid #ff6b6b;
}

.approval-header {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.risk-badge {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
}

.risk-badge.high {
  background: #ff6b6b;
  color: white;
}

.risk-badge.medium {
  background: #ffa94d;
  color: white;
}

.approval-type {
  font-size: 11px;
  color: var(--text-secondary);
}

.approval-description {
  font-size: 13px;
  margin-bottom: 4px;
}

.approval-target {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  font-family: monospace;
}

.approval-actions {
  display: flex;
  gap: 8px;
}

.approve-btn,
.reject-btn {
  padding: 6px 12px;
  border-radius: 4px;
  border: none;
  font-size: 12px;
  cursor: pointer;
  font-weight: 500;
}

.approve-btn {
  background: #51cf66;
  color: white;
}

.reject-btn {
  background: #ff6b6b;
  color: white;
}

.progress-log {
  max-height: 300px;
  overflow-y: auto;
  padding: 12px;
  background: var(--bg-primary);
  border-radius: 6px;
  border: 1px solid var(--border);
  font-family: monospace;
  font-size: 12px;
}

.progress-msg {
  margin-bottom: 4px;
  color: var(--text-secondary);
}

.operations-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.operation-item {
  display: flex;
  gap: 8px;
  padding: 6px;
  font-size: 12px;
  background: var(--bg-primary);
  border-radius: 4px;
}

.op-icon {
  font-size: 14px;
}

.op-icon.rejected {
  color: #ff6b6b;
}

.op-icon.approved {
  color: #51cf66;
}

.op-type {
  font-weight: 600;
  color: var(--accent);
}

.op-desc {
  color: var(--text-secondary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
