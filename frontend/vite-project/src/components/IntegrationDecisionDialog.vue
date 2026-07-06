<template>
  <CodekDialog
    :visible="!!decision"
    title="变更审批"
    width="min(720px, 94vw)"
    @close="dismiss"
  >
    <template #default>
      <span v-if="decision" data-codek-smoke="integration-decision" hidden></span>

      <div class="decision-hero" :class="decisionStateClass" data-codek-smoke="decision-product-panel">
        <div>
          <div class="decision-kicker">{{ decisionStateLabel }}</div>
          <div class="decision-title">{{ primaryTitle }}</div>
          <p>{{ primaryDescription }}</p>
        </div>
        <span class="decision-badge">{{ writeProtectionLabel }}</span>
      </div>

      <div class="decision-grid">
        <div>
          <span>变更文件</span>
          <strong>{{ changedFileCount }}</strong>
        </div>
        <div>
          <span>冲突</span>
          <strong :class="{ danger: conflictCount > 0 }">{{ conflictCount }}</strong>
        </div>
        <div>
          <span>质量门</span>
          <strong :class="qualityGateClass">{{ qualityGateLabel }}</strong>
        </div>
        <div>
          <span>回滚</span>
          <strong>{{ canRollback ? "可用" : "待应用后可用" }}</strong>
        </div>
      </div>

      <div v-if="decision?.reason" class="decision-section">
        <span class="section-label">原因</span>
        <p>{{ decision.reason }}</p>
      </div>

      <div v-if="decision?.proposedPatch" class="decision-section">
        <span class="section-label">Diff 摘要</span>
        <p>{{ decision.proposedPatch.summary || "已生成 proposed patch，等待审批。" }}</p>
        <div v-if="changedFiles.length" class="file-chips">
          <span v-for="file in changedFiles" :key="file" :title="file">{{ file }}</span>
        </div>
      </div>

      <div v-if="decision?.conflicts?.length" class="decision-section danger">
        <span class="section-label">冲突文件</span>
        <div class="file-chips">
          <span v-for="c in decision.conflicts" :key="c.file" :title="c.file">{{ c.file }}</span>
        </div>
      </div>

      <div v-if="decision?.qualityGate" class="quality-panel" :class="qualityGateClass">
        <span class="section-label">质量门结果</span>
        <p>{{ decision.qualityGate.summary || qualityGateLabel }}</p>
      </div>

      <div class="decision-next">
        <span class="section-label">下一步</span>
        <ul>
          <li>接受：把 proposed patch 写入主工作区，并记录应用快照。</li>
          <li>返工：不写入主工作区，回到等待用户补充或重新规划。</li>
          <li>拒绝：放弃本次 proposal，主工作区保持不变。</li>
          <li>回滚：仅在已经接受后可用，用快照恢复已应用文件。</li>
        </ul>
      </div>
    </template>

    <template #footer>
      <button class="cdk-btn cdk-btn-danger" :disabled="busy" data-codek-smoke="decision-reject" @click="decide('rejected')">拒绝</button>
      <button class="cdk-btn cdk-btn-secondary" :disabled="busy || !canRollback" data-codek-smoke="decision-rollback" @click="decide('rollback')">回滚</button>
      <button class="cdk-btn cdk-btn-secondary" :disabled="busy" data-codek-smoke="decision-rework" @click="decide('rework_requested')">要求返工</button>
      <button class="cdk-btn cdk-btn-primary" :disabled="busy || acceptDisabled" data-codek-smoke="decision-accept" @click="decide('accepted')">
        {{ busy ? "处理中..." : "接受并应用" }}
      </button>
    </template>
  </CodekDialog>
</template>

<script setup lang="ts">
import { computed } from "vue"
import type { IntegrationDecision } from "../agent/orchestratorClient"
import CodekDialog from "./CodekDialog.vue"

const props = defineProps<{ decision?: IntegrationDecision | null; busy?: boolean }>()

const emit = defineEmits<{
  decide: [decision: "accepted" | "rejected" | "rework_requested" | "rollback"]
  close: []
}>()

const changedFiles = computed(() => props.decision?.proposedPatch?.filesChanged || [])
const changedFileCount = computed(() => changedFiles.value.length)
const conflictCount = computed(() => props.decision?.conflicts?.length || 0)
const canRollback = computed(() => Boolean(props.decision?.applyResult) && props.decision?.status !== "rolled_back")
const qualityGateStatus = computed(() => String(props.decision?.qualityGate?.status || "pending"))
const acceptDisabled = computed(() => conflictCount.value > 0 || qualityGateStatus.value === "failed")

const decisionStateLabel = computed(() => {
  const status = props.decision?.status
  if (status === "accepted") return "已接受"
  if (status === "rejected") return "已拒绝"
  if (status === "rework_requested") return "等待返工"
  if (status === "rolled_back") return "已回滚"
  if (status === "conflict") return "存在冲突"
  return "等待审批"
})

const decisionStateClass = computed(() => {
  const status = props.decision?.status
  if (status === "accepted") return "done"
  if (status === "rejected" || status === "rolled_back") return "muted"
  if (status === "rework_requested" || qualityGateStatus.value === "failed" || conflictCount.value > 0) return "warning"
  return "active"
})

const primaryTitle = computed(() => {
  if (conflictCount.value > 0) return "先处理冲突，再决定是否应用"
  if (qualityGateStatus.value === "failed") return "质量门失败，建议返工"
  if (props.decision?.applyResult) return "变更已应用，可继续观察或回滚"
  return "确认前不会写入主工作区"
})

const primaryDescription = computed(() => {
  if (conflictCount.value > 0) return "检测到文件冲突，接受按钮会被禁用，优先选择返工或拒绝。"
  if (qualityGateStatus.value === "failed") return "质量门未通过，直接应用风险较高。请选择返工，或修复后重新生成 proposal。"
  if (props.decision?.applyResult) return "系统已记录应用快照；如结果不符合预期，可以使用回滚恢复。"
  return "当前只是 proposed patch。只有点击“接受并应用”后，才会写入真实工作区。"
})

const writeProtectionLabel = computed(() => {
  if (props.decision?.applyResult) return "已写入"
  if (props.decision?.rollbackResult) return "已恢复"
  return "Proposal-only"
})

const qualityGateLabel = computed(() => {
  const status = qualityGateStatus.value
  if (status === "passed") return "通过"
  if (status === "failed") return "失败"
  if (status === "running") return "运行中"
  return "未运行"
})

const qualityGateClass = computed(() => {
  const status = qualityGateStatus.value
  if (status === "passed") return "passed"
  if (status === "failed") return "failed"
  return "pending"
})

function decide(action: "accepted" | "rejected" | "rework_requested" | "rollback") {
  emit("decide", action)
}

function dismiss() {
  emit("close")
}
</script>

<style scoped>
.decision-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-dark);
}

.decision-hero.active {
  border-color: rgba(59, 130, 246, 0.45);
}

.decision-hero.warning {
  border-color: rgba(245, 158, 11, 0.5);
}

.decision-hero.done {
  border-color: rgba(34, 197, 94, 0.45);
}

.decision-hero.muted {
  opacity: 0.86;
}

.decision-kicker,
.section-label,
.decision-grid span {
  color: var(--text-muted);
  font-size: 11px;
}

.decision-title {
  margin-top: 3px;
  color: var(--text-bright);
  font-size: 15px;
  font-weight: 700;
}

.decision-hero p,
.decision-section p,
.quality-panel p {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.55;
}

.decision-badge {
  flex: 0 0 auto;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  font-size: 11px;
}

.decision-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.decision-grid div,
.decision-section,
.quality-panel,
.decision-next {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-dark);
}

.decision-grid strong {
  display: block;
  margin-top: 4px;
  color: var(--text-bright);
  font-size: 13px;
}

.decision-section,
.quality-panel,
.decision-next {
  margin-top: 10px;
}

.decision-section.danger {
  border-color: rgba(244, 135, 113, 0.45);
}

.file-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.file-chips span {
  max-width: 100%;
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quality-panel.passed {
  border-color: rgba(34, 197, 94, 0.45);
}

.quality-panel.failed {
  border-color: rgba(244, 135, 113, 0.45);
}

.passed {
  color: var(--green) !important;
}

.failed,
.danger {
  color: var(--red) !important;
}

.pending {
  color: var(--text-muted) !important;
}

.decision-next ul {
  margin: 8px 0 0;
  padding-left: 18px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

@media (max-width: 640px) {
  .decision-hero {
    flex-direction: column;
  }

  .decision-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
