<template>
  <div class="change-panel">
    <div class="change-toolbar">
      <span class="change-count">
        {{ t('changes.pendingApplied', { pending: pendingBatches.length, applied: historyEntries.length }) }}
      </span>
      <button
        v-if="pendingBatches.length > 0 || historyEntries.length > 0"
        class="change-btn"
        @click="$emit('clearHistory')"
      >
        {{ t('changes.clearApplied') }}
      </button>
    </div>

    <div class="change-list">
      <section class="change-section">
        <div class="section-title">{{ t('changes.pendingPatches') }}</div>
        <div v-if="pendingBatches.length === 0" class="change-empty">{{ t('changes.noPending') }}</div>

        <div
          v-for="batch in pendingBatchModels"
          :key="batch.id"
          class="change-card pending"
          :class="{ blocked: batch.blocked }"
          :data-apply-status="batch.status"
        >
          <div class="change-card-head">
            <div class="change-meta">
              <span class="change-path">{{ batch.title }}</span>
              <span class="change-badge">{{ batch.source }}</span>
              <span class="change-badge alt">{{ batch.action }}</span>
              <span v-if="batch.blocked" class="change-badge blocked">{{ t('changes.blocked') }}</span>
            </div>
            <div class="change-actions">
              <button class="change-btn ok" :disabled="batch.blocked" @click="$emit('applyPending', batch.id)">{{ t('changes.apply') }}</button>
              <button class="change-btn warn" @click="$emit('rejectPending', batch.id)">{{ t('changes.reject') }}</button>
            </div>
          </div>

          <div v-if="batch.message" class="change-alert" role="alert">
            <div class="change-alert-title">{{ batch.message.title }}</div>
            <div class="change-alert-body">{{ batch.message.body }}</div>
            <button v-if="batch.message.path" class="change-link-btn" @click="$emit('open', batch.message.path)">
              {{ t('changes.openBlockedFile') }}: {{ batch.message.path }}
            </button>
          </div>

          <div
            v-for="change in batch.files"
            :key="`${batch.id}-${change.path}`"
            class="change-file"
            :class="{ 'is-blocked': batch.blockedPath === change.path }"
          >
            <div class="change-file-head">
              <button class="change-file-path link" @click="$emit('open', change.path)">{{ change.path }}</button>
              <span class="change-badge alt">{{ t('changes.hunks', { count: change.hunkCount }) }}</span>
            </div>
            <div class="change-actions file-actions">
              <button class="change-btn ok" :disabled="!change.canApply" @click="$emit('applyPendingFile', batch.id, change.path)">{{ t('changes.applyFile') }}</button>
              <button class="change-btn warn" @click="$emit('rejectPendingFile', batch.id, change.path)">{{ t('changes.rejectFile') }}</button>
            </div>
            <div class="change-hunks">
              <div
                v-for="hunk in change.hunks"
                :key="`${batch.id}-${change.path}-${hunk.id}`"
                class="change-hunk"
              >
                <div class="change-hunk-head">
                  <span>{{ formatHunkLabel(hunk) }}</span>
                  <div class="change-actions hunk-actions">
                    <button class="change-btn ok" :disabled="!change.canApply" @click="$emit('applyPendingHunk', batch.id, change.path, hunk.id)">{{ t('changes.applyHunk') }}</button>
                    <button class="change-btn warn" @click="$emit('rejectPendingHunk', batch.id, change.path, hunk.id)">{{ t('changes.rejectHunk') }}</button>
                  </div>
                </div>
                <pre class="change-diff">{{ buildHunkDiff(hunk) }}</pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="change-section">
        <div class="section-title">{{ t('changes.appliedChanges') }}</div>
        <div v-if="operationLogModels.length === 0" class="change-empty">{{ t('changes.appliedEmpty') }}</div>

        <div
          v-for="operation in operationLogModels"
          :key="operation.id"
          class="change-card"
          :class="{ 'agent-operation': operation.sourceKind === 'agent', 'rollback-blocked': operation.rollbackBlocked }"
          data-codek-smoke="operation-log-card"
          :data-operation-source="operation.sourceLabel"
          :data-operation-status="operation.statusLabel"
        >
          <div class="change-card-head">
            <div class="change-meta">
              <span class="change-path">{{ operation.title }}</span>
              <span class="change-badge">{{ operation.badge }}</span>
              <span class="change-badge alt">{{ operation.operationLabel }}</span>
              <span class="change-badge alt">{{ operation.sourceLabel }}</span>
              <span class="change-badge alt">{{ operation.riskLabel }}</span>
              <span class="change-badge" :class="{ blocked: operation.rollbackBlocked }">{{ operation.statusLabel }}</span>
            </div>
            <div class="change-actions">
              <button class="change-btn" @click="$emit('open', operation.primaryPath)">{{ t('changes.open') }}</button>
              <button class="change-btn warn" :disabled="!operation.canRevert" @click="$emit('revert', operation.id)">{{ t('changes.revert') }}</button>
              <button class="change-btn" @click="$emit('dismiss', operation.id)">{{ t('changes.dismiss') }}</button>
            </div>
          </div>

          <div class="operation-log-body">
            <div class="operation-log-row">
              <span class="operation-log-label">路径</span>
              <button class="change-file-path link" @click="$emit('open', operation.primaryPath)">{{ operation.primaryPath }}</button>
            </div>
            <div v-if="operation.pathBefore && operation.pathBefore !== operation.pathAfter" class="operation-log-row">
              <span class="operation-log-label">原路径</span>
              <span class="operation-log-value">{{ operation.pathBefore }}</span>
            </div>
            <div v-if="operation.pathAfter && operation.pathBefore !== operation.pathAfter" class="operation-log-row">
              <span class="operation-log-label">新路径</span>
              <span class="operation-log-value">{{ operation.pathAfter }}</span>
            </div>
            <div v-if="operation.agentId || operation.runId" class="operation-log-row">
              <span class="operation-log-label">智能体</span>
              <span class="operation-log-value">
                <template v-if="operation.agentId">{{ operation.agentId }}</template>
                <template v-if="operation.runId"> · {{ operation.runId }}</template>
              </span>
            </div>
            <div v-if="operation.rollbackBlocked" class="change-alert operation-alert" role="alert">
              <div class="change-alert-title">回滚被阻止</div>
              <div class="change-alert-body">{{ operation.blockedReasonLabel }}</div>
            </div>
          </div>

          <pre class="change-diff">{{ buildDiff(operation.beforeContent, operation.afterContent) }}</pre>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue"
import { useI18n } from "../i18n/index"
import { createChangeReviewBatchModels, createOperationLogModels } from "../workbench/changeReviewDisplay"

const { t } = useI18n()

const props = defineProps({
  pendingBatches: { type: Array, default: () => [] },
  historyEntries: { type: Array, default: () => [] },
})

const pendingBatchModels = computed(() => createChangeReviewBatchModels(props.pendingBatches))
const operationLogModels = computed(() => createOperationLogModels(props.historyEntries))

defineEmits([
  "open",
  "revert",
  "dismiss",
  "clearHistory",
  "applyPending",
  "rejectPending",
  "applyPendingFile",
  "rejectPendingFile",
  "applyPendingHunk",
  "rejectPendingHunk",
])

function buildDiff(beforeContent, afterContent) {
  const beforeLines = String(beforeContent ?? "").split("\n")
  const afterLines = String(afterContent ?? "").split("\n")
  const maxLength = Math.max(beforeLines.length, afterLines.length)
  const diff = []

  for (let index = 0; index < maxLength; index += 1) {
    const beforeLine = beforeLines[index]
    const afterLine = afterLines[index]
    if (beforeLine === afterLine) continue

    const lineNumber = String(index + 1).padStart(3, " ")
    if (beforeLine !== undefined) diff.push(`${lineNumber} - ${beforeLine}`)
    if (afterLine !== undefined) diff.push(`${lineNumber} + ${afterLine}`)
    if (diff.length >= 80) {
      diff.push(t('changes.truncated'))
      break
    }
  }

  return diff.length ? diff.join("\n") : t('changes.noVisibleDiff')
}

function buildHunkDiff(hunk) {
  const diff = []
  const beforeLine = hunk.beforeStart
  const afterLine = hunk.afterStart
  for (const line of hunk.beforeLines) {
    diff.push(`${String(beforeLine).padStart(3, " ")} - ${line}`)
  }
  for (const line of hunk.afterLines) {
    diff.push(`${String(afterLine).padStart(3, " ")} + ${line}`)
  }
  return diff.length ? diff.join("\n") : t('changes.noVisibleDiff')
}

function formatHunkLabel(hunk) {
  const removed = hunk.beforeLines.length
  const added = hunk.afterLines.length
  const parts = []
  if (added > 0) parts.push(`+${added}`)
  if (removed > 0) parts.push(`-${removed}`)
  return `${t('changes.hunk')} ${hunk.id.replace("hunk-", "#")} ${parts.join(" ")}`
}
</script>

<style scoped>
.change-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.change-toolbar {
  height: 40px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.change-count {
  font-size: 12px;
  color: var(--text-secondary);
}

.change-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.change-section + .change-section {
  margin-top: 12px;
}

.section-title {
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.change-empty {
  padding: 8px 2px 12px;
  color: var(--text-muted);
  font-size: 12px;
}

.change-card {
  border: 1px solid var(--border);
  background: var(--bg-dark);
  border-radius: 8px;
  margin-bottom: 10px;
  overflow: hidden;
}

.change-card.pending {
  border-color: rgba(45, 212, 191, 0.28);
}

.change-card.agent-operation {
  border-color: rgba(96, 165, 250, 0.32);
}

.change-card.blocked {
  border-color: rgba(245, 158, 11, 0.45);
}

.change-card.rollback-blocked {
  border-color: rgba(245, 158, 11, 0.45);
}

.change-card-head {
  padding: 10px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.change-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.change-path,
.change-file-path {
  color: var(--text-primary);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.change-badge {
  font-size: 10px;
  color: var(--accent);
  background: rgba(45, 212, 191, 0.12);
  border-radius: 999px;
  padding: 2px 7px;
}

.change-badge.alt {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.change-badge.blocked {
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.14);
}

.change-alert {
  margin: 10px;
  padding: 10px;
  border: 1px solid rgba(245, 158, 11, 0.28);
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.08);
}

.change-alert-title {
  color: #fcd34d;
  font-size: 12px;
  font-weight: 600;
}

.change-alert-body {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.change-actions {
  display: flex;
  gap: 6px;
}

.change-btn {
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text-secondary);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 11px;
  cursor: pointer;
}

.change-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.change-link-btn,
.change-file-path.link {
  border: none;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  font: inherit;
  padding: 0;
  text-align: left;
}

.change-link-btn {
  margin-top: 8px;
  color: var(--accent);
  font-size: 12px;
}

.change-btn.warn {
  color: var(--red);
}

.change-btn.ok {
  color: var(--green);
}

.change-file + .change-file {
  border-top: 1px solid var(--border-subtle);
}

.operation-log-body {
  padding: 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.operation-log-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.6;
}

.operation-log-row + .operation-log-row {
  margin-top: 4px;
}

.operation-log-label {
  width: 44px;
  flex-shrink: 0;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.operation-log-value {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}

.operation-alert {
  margin: 8px 0 0;
}

.change-file.is-blocked {
  background: rgba(245, 158, 11, 0.04);
}

.change-file-head {
  padding: 10px 10px 0;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.change-file-head .change-file-path {
  flex: 1;
}

.file-actions,
.hunk-actions {
  padding: 8px 10px 0;
}

.change-hunks {
  padding: 8px 10px 10px;
}

.change-hunk {
  border: 1px solid var(--border-subtle);
  border-radius: 7px;
  overflow: hidden;
}

.change-hunk + .change-hunk {
  margin-top: 8px;
}

.change-hunk-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 8px;
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.02);
  font-size: 11px;
}

.change-hunk .change-diff {
  padding: 8px;
}

.change-diff {
  margin: 0;
  padding: 10px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-muted);
  font-size: 11px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  line-height: 1.5;
}
</style>
