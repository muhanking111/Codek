<template>
  <div
    v-if="visible"
    class="problems-panel"
    data-codek-smoke="problems-panel"
    :data-problems-state-source="ownerEvidence.stateSource"
    :data-problems-view-owner="ownerEvidence.problemsViewOwner.owner"
    :data-problems-view-owner-status="ownerEvidence.problemsViewOwner.status"
    :data-problems-action-open-status="openActionStatus"
    :data-problems-action-quick-fix-status="quickFixActionStatus"
    :data-problems-remaining-ui-gap="ownerEvidence.remainingUiOwnerGap.length > 0 ? 'true' : 'false'"
  >
    <div class="problems-toolbar">
      <div v-if="hasAnyDiagnostics" class="toolbar-severity-filters">
        <button
          v-for="filter in visibleFilterDefs"
          :key="filter.severity"
          class="filter-btn"
          :class="{ active: activeFilters.has(filter.severity) }"
          @click="toggleFilter(filter.severity)"
        >
          <span class="filter-icon" :class="filter.severity">{{ filter.icon }}</span>
          <span class="filter-label">{{ filter.label }}</span>
          <span class="filter-count">{{ filter.count }}</span>
        </button>
      </div>

      <div v-if="hasAnyDiagnostics" class="toolbar-divider" />

      <div v-if="hasAnyDiagnostics" class="toolbar-source-filters">
        <button
          v-for="src in visibleSourceFilterDefs"
          :key="src.source"
          class="source-filter-btn"
          :class="{ active: activeSourceFilters.has(src.source) }"
          :style="{ '--src-color': src.color }"
          @click="toggleSourceFilter(src.source)"
          :title="src.label"
        >
          <span class="source-icon" v-html="src.icon" />
          <span class="source-count">{{ src.count }}</span>
        </button>
      </div>

      <div class="toolbar-spacer" />

      <button
        class="ai-scan-btn"
        :class="{ scanning: isScanning }"
        :disabled="isScanning"
        @click="handleAiScan"
        title="智能问题扫描"
      >
        <svg
          v-if="!isScanning"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="sparkle-icon"
        >
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
          <path d="M5 3v4" />
          <path d="M3 5h4" />
          <path d="M19 17v4" />
          <path d="M17 19h4" />
        </svg>
        <span v-else class="scanning-dot" />
        <span class="ai-scan-label">{{ isScanning ? '扫描中...' : '智能扫描' }}</span>
      </button>
    </div>

    <div class="problems-list">
      <div v-if="sourceFilteredDiagnostics.length === 0" class="problems-empty">
        {{ t('problems.noProblems') }}
      </div>

      <template v-for="group in sourceFilteredDiagnostics" :key="group.source">
        <div class="source-group">
          <button
            class="source-group-header"
            :style="{ borderLeftColor: group.color }"
            @click="toggleSourceCollapse(group.source)"
          >
            <span class="chevron" :class="{ collapsed: sourceCollapsed.has(group.source) }">
              &#x25B6;
            </span>
            <span class="source-icon-lg" v-html="group.icon" />
            <span class="source-label">{{ group.label }}</span>
            <span class="source-badge" :style="{ background: group.color + '22', color: group.color }">{{ group.items.length }}</span>
          </button>

          <div v-if="!sourceCollapsed.has(group.source)">
            <div
              v-for="fileGroup in group.fileGroups"
              :key="fileGroup.file"
              class="problems-group"
            >
              <button
                class="problems-file-header"
                @click="toggleCollapse(fileGroup.file)"
              >
                <span class="chevron" :class="{ collapsed: collapsed.has(fileGroup.file) }">
                  &#x25B6;
                </span>
                <span class="file-name">{{ fileGroup.file }}</span>
                <span class="file-counts">
                  <span v-if="fileGroup.errorCount > 0" class="count-badge error">{{ fileGroup.errorCount }}</span>
                  <span v-if="fileGroup.warningCount > 0" class="count-badge warning">{{ fileGroup.warningCount }}</span>
                  <span v-if="fileGroup.infoCount > 0" class="count-badge info">{{ fileGroup.infoCount }}</span>
                  <span v-if="fileGroup.aiCount > 0" class="count-badge ai">{{ fileGroup.aiCount }}</span>
                </span>
              </button>

              <div v-if="!collapsed.has(fileGroup.file)">
                <button
                  v-for="(diag, index) in fileGroup.items"
                  :key="`${diag.line}-${diag.column}-${diag.message.slice(0, 32)}-${index}`"
                  class="problems-item"
                  :class="{ 'row-alt': index % 2 === 1, 'ai-item': diag.severity === 'ai' }"
                  @click="handleOpenFile(diag)"
                >
                  <span class="severity-icon" :class="diag.severity">
                    <template v-if="diag.severity === 'ai'">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                      </svg>
                    </template>
                    <template v-else>{{ severityIcons[diag.severity] }}</template>
                  </span>
                  <span class="item-message">{{ diag.message }}</span>
                  <span class="item-source-tag" :style="{ background: getSourceColor(diag) + '22', color: getSourceColor(diag) }">
                    {{ getSourceLabel(diag) }}
                  </span>
                  <span class="item-location">{{ diag.line }}:{{ diag.column }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div class="problems-footer">
      <span class="footer-summary">{{ footerText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { useI18n } from '../i18n/index'
import { workspace } from '../workspace/manager'
import { globalProblemsDiagnosticsService } from "../workbench/problemsDiagnosticsService"
import {
  PROBLEM_SOURCE_ORDER,
  createProblemSeverityFilterDefs,
  createProblemSourceFilterDefs,
  getProblemDiagnosticSourceKey,
  problemSourceMetadata,
  type ProblemDiagnosticSourceKey,
} from "../vscode-adapter/workbench/contrib/markers/browser/markersViewModel"

import type { Diagnostic } from "./problemState"
import { problemState } from "./problemState"

const { t } = useI18n()

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  openFile: [payload: { file: string; line: number; column: number }]
  close: []
}>()

const isScanning = ref(false)

const footerText = computed<string>(() => {
  const parts: string[] = []
  const summary = markersProjection.value.summary
  if (summary.errorCount > 0) parts.push(`${summary.errorCount} ${t('problems.errors')}`)
  if (summary.warningCount > 0) parts.push(`${summary.warningCount} ${t('problems.warnings')}`)
  if (summary.infoCount > 0) parts.push(`${summary.infoCount} ${t('problems.info')}`)
  if (summary.aiCount > 0) parts.push(`${summary.aiCount} 个智能提示`)
  return parts.join(', ') || t('problems.noProblems')
})

const severityIcons: Record<string, string> = {
  error: '\u2715',
  warning: '\u26A0',
  info: '\u24D8',
  ai: '\u2728',
}

const activeFilters = ref<Set<Diagnostic['severity']>>(
  new Set(['error', 'warning', 'info', 'ai']),
)

const activeSourceFilters = ref<Set<ProblemDiagnosticSourceKey>>(
  new Set(PROBLEM_SOURCE_ORDER),
)

const collapsed = ref<Set<string>>(new Set())
const sourceCollapsed = ref<Set<string>>(new Set())

const markersProjection = computed(() => globalProblemsDiagnosticsService.createVisibleProjection({
  severities: activeFilters.value,
  sources: activeSourceFilters.value,
}, problemState.diagnostics))
const markersViewModel = computed(() => markersProjection.value.viewModel)
const ownerEvidence = computed(() => globalProblemsDiagnosticsService.createOwnerEvidenceSnapshot({
  severities: activeFilters.value,
  sources: activeSourceFilters.value,
}, problemState.diagnostics))
const openActionStatus = computed(() => ownerEvidence.value.actions.find((action) => action.id === "problems.open")?.status || "blocked")
const quickFixActionStatus = computed(() => ownerEvidence.value.actions.find((action) => action.id === "problems.quickFix")?.status || "blocked")

const filterDefs = computed(() => createProblemSeverityFilterDefs(markersViewModel.value.severityCounts))
const sourceFilterDefs = computed(() => createProblemSourceFilterDefs(markersViewModel.value.sourceCounts))
const visibleFilterDefs = computed(() => filterDefs.value.filter((filter) => filter.count > 0))
const visibleSourceFilterDefs = computed(() => sourceFilterDefs.value.filter((source) => source.count > 0))
const sourceFilteredDiagnostics = computed(() => markersViewModel.value.sourceGroups)
const hasAnyDiagnostics = computed(() => markersViewModel.value.total > 0)

function toggleFilter(severity: Diagnostic['severity']): void {
  const next = new Set(activeFilters.value)
  if (next.has(severity)) {
    next.delete(severity)
  } else {
    next.add(severity)
  }
  activeFilters.value = next
}

function toggleSourceFilter(source: ProblemDiagnosticSourceKey): void {
  const next = new Set(activeSourceFilters.value)
  if (next.has(source)) {
    next.delete(source)
  } else {
    next.add(source)
  }
  activeSourceFilters.value = next
}

function toggleCollapse(file: string): void {
  const next = new Set(collapsed.value)
  if (next.has(file)) {
    next.delete(file)
  } else {
    next.add(file)
  }
  collapsed.value = next
}

function toggleSourceCollapse(source: string): void {
  const next = new Set(sourceCollapsed.value)
  if (next.has(source)) {
    next.delete(source)
  } else {
    next.add(source)
  }
  sourceCollapsed.value = next
}

function getSourceLabel(diag: Diagnostic): string {
  return problemSourceMetadata[getProblemDiagnosticSourceKey(diag)].label
}

function getSourceColor(diag: Diagnostic): string {
  return problemSourceMetadata[getProblemDiagnosticSourceKey(diag)].color
}

function handleOpenFile(diag: Diagnostic): void {
  emit('openFile', {
    file: diag.file,
    line: diag.line,
    column: diag.column,
  })
}

function handleAiScan(): void {
  const activeFile = workspace.activeFile
  if (!activeFile) return

  const content = workspace.files?.[activeFile]
  if (typeof content !== 'string') return

  isScanning.value = true

  problemState.clearAiForFile(activeFile)

  setTimeout(() => {
    try {
      const results = problemState.runAiScan(activeFile, content)
      problemState.addDiagnostics(results)
    } catch {
      // 智能扫描失败时保持问题面板可用。
    } finally {
      isScanning.value = false
    }
  }, 200)
}
</script>

<style scoped>
.problems-panel {
  position: fixed;
  left: 48px;
  right: 0;
  bottom: 24px;
  height: 260px;
  max-height: 50vh;
  z-index: 40;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-top: 1px solid var(--border-subtle);
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.35);
  font-family: var(--font-sans);
}

.problems-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.toolbar-severity-filters {
  display: flex;
  gap: 2px;
}

.filter-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.filter-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.filter-btn.active {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--border-subtle);
}

.filter-icon {
  font-size: 12px;
  font-weight: 700;
}

.filter-icon.error {
  color: var(--red);
}

.filter-icon.warning {
  color: var(--orange);
}

.filter-icon.info {
  color: var(--blue, #60a5fa);
}

.filter-icon.ai {
  color: #a78bfa;
}

.filter-label {
  font-weight: 500;
}

.filter-count {
  min-width: 18px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--bg-active);
  color: var(--text-secondary);
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.filter-btn.active .filter-count {
  background: var(--border-bright);
  color: var(--text-primary);
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: var(--border-subtle);
  flex-shrink: 0;
  margin: 0 2px;
}

.toolbar-source-filters {
  display: flex;
  gap: 2px;
}

.source-filter-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.source-filter-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.source-filter-btn.active {
  background: color-mix(in srgb, var(--src-color) 10%, transparent);
  color: var(--src-color);
  border-color: color-mix(in srgb, var(--src-color) 25%, transparent);
}

.source-icon {
  display: flex;
  align-items: center;
}

.source-icon :deep(svg) {
  color: inherit;
}

.source-count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--bg-active);
  color: var(--text-secondary);
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.source-filter-btn.active .source-count {
  background: color-mix(in srgb, var(--src-color) 20%, transparent);
  color: var(--src-color);
}

.toolbar-spacer {
  flex: 1;
}

.ai-scan-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: rgba(167, 139, 250, 0.1);
  color: #a78bfa;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  white-space: nowrap;
  font-family: var(--font-sans);
}

.ai-scan-btn:hover:not(:disabled) {
  background: rgba(167, 139, 250, 0.18);
  border-color: rgba(167, 139, 250, 0.3);
}

.ai-scan-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ai-scan-btn.scanning {
  background: rgba(167, 139, 250, 0.15);
}

.ai-scan-label {
  font-weight: 500;
}

.sparkle-icon {
  flex-shrink: 0;
}

.scanning-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #a78bfa;
  animation: ai-pulse 1s ease-in-out infinite;
  flex-shrink: 0;
}

.problems-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.problems-empty {
  padding: 20px 16px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.source-group + .source-group {
  border-top: 1px solid var(--border-subtle);
}

.source-group-header {
  width: 100%;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: none;
  border-left: 3px solid;
  background: var(--bg-darker);
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: background 0.1s;
  flex-shrink: 0;
}

.source-group-header:hover {
  background: var(--bg-hover);
}

.source-icon-lg {
  display: flex;
  align-items: center;
}

.source-icon-lg :deep(svg) {
  color: inherit;
}

.source-label {
  flex: 1;
  font-weight: 600;
  text-align: left;
}

.source-badge {
  min-width: 20px;
  height: 16px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.problems-group + .problems-group {
  border-top: 1px solid var(--border-subtle);
}

.problems-file-header {
  width: 100%;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 0 24px;
  border: none;
  background: var(--bg-dark);
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: background 0.1s;
  flex-shrink: 0;
}

.problems-file-header:hover {
  background: var(--bg-hover);
}

.chevron {
  font-size: 8px;
  color: var(--text-muted);
  transition: transform 0.15s;
  flex-shrink: 0;
  width: 12px;
  text-align: center;
}

.chevron:not(.collapsed) {
  transform: rotate(90deg);
}

.chevron.collapsed {
  transform: rotate(0deg);
}

.file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.file-counts {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.count-badge {
  min-width: 18px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.count-badge.error {
  background: rgba(248, 113, 113, 0.18);
  color: var(--red);
}

.count-badge.warning {
  background: rgba(251, 146, 60, 0.18);
  color: var(--orange);
}

.count-badge.info {
  background: rgba(96, 165, 250, 0.18);
  color: var(--blue, #60a5fa);
}

.count-badge.ai {
  background: rgba(167, 139, 250, 0.18);
  color: #a78bfa;
}

.problems-item {
  width: 100%;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 36px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: background 0.1s;
  text-align: left;
}

.problems-item:hover {
  background: var(--bg-hover);
}

.problems-item.row-alt {
  background: rgba(255, 255, 255, 0.015);
}

.problems-item.row-alt:hover {
  background: var(--bg-hover);
}

.severity-icon {
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
  width: 14px;
  text-align: center;
  line-height: 1;
}

.severity-icon.error {
  color: var(--red);
}

.severity-icon.warning {
  color: var(--orange);
}

.severity-icon.info {
  color: var(--blue, #60a5fa);
}

.severity-icon.ai {
  color: #a78bfa;
}

.ai-item {
  background: rgba(167, 139, 250, 0.04);
}

.ai-item:hover {
  background: rgba(167, 139, 250, 0.08);
}

.item-message {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.item-source-tag {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
  white-space: nowrap;
}

.item-location {
  color: var(--text-muted);
  font-size: 11px;
  flex-shrink: 0;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  white-space: nowrap;
}

.problems-footer {
  height: 24px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
  background: var(--bg-dark);
}

.footer-summary {
  font-size: 11px;
  color: var(--text-secondary);
}

@keyframes ai-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
</style>
