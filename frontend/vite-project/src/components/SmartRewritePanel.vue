<template>
  <div v-if="visible" class="rewrite-panel">
    <div class="rewrite-header">
      <div class="rewrite-title-row">
        <svg class="rewrite-sparkle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2l1.5 5.5L19 9l-5.5 1.5L12 16l-1.5-5.5L5 9l5.5-1.5z" />
          <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
        </svg>
        <span class="rewrite-title">{{ t('rewrite.title') }}</span>
        <span class="rewrite-badge">{{ suggestions.length }}</span>
      </div>
      <div class="rewrite-header-actions">
        <button
          v-if="suggestions.length > 0"
          class="rewrite-action-btn primary"
          @click="handleApplyAll"
        >
          {{ t('rewrite.applyAll') }}
        </button>
        <button class="rewrite-close-btn" @click="$emit('close')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <div v-if="rewriteState.isScanning" class="rewrite-scanning">
      <span class="scan-spinner"></span>
      <span>{{ t('rewrite.scanning') }} {{ rewriteState.queueSize > 0 ? ` ${rewriteState.queueSize} ${t('rewrite.filesRemaining')}` : '' }}</span>
    </div>

    <div class="rewrite-list">
      <div v-if="suggestions.length === 0 && !rewriteState.isScanning" class="rewrite-empty">
        {{ t('rewrite.empty') }}
      </div>

      <div
        v-for="suggestion in suggestions"
        :key="suggestion.id"
        class="rewrite-card"
        :class="`severity-${suggestion.severity}`"
      >
        <div class="rewrite-card-head">
          <div class="rewrite-card-meta">
            <span class="rewrite-category-badge" :class="`cat-${suggestion.category}`">
              {{ categoryLabel(suggestion.category) }}
            </span>
            <span class="rewrite-severity-badge" :class="`sev-${suggestion.severity}`">
              {{ severityLabel(suggestion.severity) }}
            </span>
            <span class="rewrite-file" @click="handleOpenFile(suggestion.file)">
              {{ basename(suggestion.file) }}:{{ suggestion.startLine }}-{{ suggestion.endLine }}
            </span>
          </div>
          <p class="rewrite-description">{{ suggestion.description }}</p>
        </div>

        <div class="rewrite-diff-section">
          <div class="rewrite-diff-label remove">- {{ t('rewrite.original') }}</div>
          <pre class="rewrite-diff-block remove"><code>{{ suggestion.originalCode }}</code></pre>
          <div class="rewrite-diff-label add">+ {{ t('rewrite.suggested') }}</div>
          <pre class="rewrite-diff-block add"><code>{{ suggestion.suggestedCode }}</code></pre>
        </div>

        <div class="rewrite-card-actions">
          <button class="rewrite-action-btn" @click="handlePreview(suggestion)">
            {{ t('rewrite.preview') }}
          </button>
          <button class="rewrite-action-btn primary" @click="handleApply(suggestion)">
            {{ t('rewrite.apply') }}
          </button>
          <button class="rewrite-action-btn dim" @click="handleDismiss(suggestion.id)">
            {{ t('rewrite.dismiss') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import {
  applyRewrite,
  dismissRewrite,
} from "../ai/smartRewrite"
import {
  rewriteState,
  type RewriteCategory,
  type RewriteSeverity,
  type RewriteSuggestion,
} from "../ai/smartRewriteState"
import { useI18n } from "../i18n/index"

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
  currentFileContent: string
}>()

const emit = defineEmits<{
  close: []
  openFile: [payload: { path: string }]
  applyRewrite: [payload: { suggestion: RewriteSuggestion; newContent: string }]
  preview: [payload: RewriteSuggestion]
}>()

const suggestions = computed(() =>
  rewriteState.suggestions.filter((s) => s.originalCode !== s.suggestedCode),
)

const categoryLabelMap: Record<RewriteCategory, string> = {
  performance: t("rewrite.catPerformance"),
  readability: t("rewrite.catReadability"),
  safety: t("rewrite.catSafety"),
  modern: t("rewrite.catModern"),
  bug: t("rewrite.catBug"),
}

const severityLabelMap: Record<RewriteSeverity, string> = {
  info: t("rewrite.sevInfo"),
  warning: t("rewrite.sevWarning"),
  critical: t("rewrite.sevCritical"),
}

function categoryLabel(cat: RewriteCategory): string {
  return categoryLabelMap[cat] || cat
}

function severityLabel(sev: RewriteSeverity): string {
  return severityLabelMap[sev] || sev
}

function basename(path: string): string {
  return String(path || "").replace(/^.*[\\/]/, "")
}

function handleApply(suggestion: RewriteSuggestion): void {
  const newContent = applyRewrite(suggestion, props.currentFileContent)
  emit("applyRewrite", { suggestion, newContent })
  dismissRewrite(suggestion.id)
}

function handleApplyAll(): void {
  let content = props.currentFileContent
  for (const suggestion of [...suggestions.value]) {
    content = applyRewrite(suggestion, content)
    dismissRewrite(suggestion.id)
  }
}

function handleDismiss(id: string): void {
  dismissRewrite(id)
}

function handlePreview(suggestion: RewriteSuggestion): void {
  emit("preview", suggestion)
}

function handleOpenFile(filePath: string): void {
  emit("openFile", { path: filePath })
}
</script>

<style scoped>
.rewrite-panel {
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

.rewrite-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.rewrite-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rewrite-sparkle {
  color: var(--accent);
}

.rewrite-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.rewrite-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-dim);
  color: var(--accent);
}

.rewrite-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rewrite-close-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rewrite-close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.rewrite-scanning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(251, 146, 60, 0.08);
  border-bottom: 1px solid rgba(251, 146, 60, 0.12);
  font-size: 11px;
  color: var(--orange);
  flex-shrink: 0;
}

.scan-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(251, 146, 60, 0.3);
  border-top-color: var(--orange);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.rewrite-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.rewrite-empty {
  padding: 24px 8px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}

.rewrite-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-dark);
  margin-bottom: 10px;
  overflow: hidden;
}

.rewrite-card.severity-critical {
  border-color: rgba(248, 113, 113, 0.35);
}

.rewrite-card.severity-warning {
  border-color: rgba(251, 146, 60, 0.28);
}

.rewrite-card-head {
  padding: 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.rewrite-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.rewrite-category-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  font-weight: 600;
}

.rewrite-category-badge.cat-performance {
  background: rgba(52, 211, 153, 0.12);
  color: var(--green);
}

.rewrite-category-badge.cat-readability {
  background: rgba(96, 165, 250, 0.12);
  color: #60a5fa;
}

.rewrite-category-badge.cat-safety {
  background: rgba(248, 113, 113, 0.12);
  color: var(--red);
}

.rewrite-category-badge.cat-modern {
  background: rgba(167, 139, 250, 0.12);
  color: #a78bfa;
}

.rewrite-category-badge.cat-bug {
  background: rgba(251, 146, 60, 0.12);
  color: var(--orange);
}

.rewrite-severity-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.rewrite-severity-badge.sev-critical {
  background: rgba(248, 113, 113, 0.18);
  color: var(--red);
  font-weight: 700;
}

.rewrite-severity-badge.sev-warning {
  background: rgba(251, 146, 60, 0.14);
  color: var(--orange);
}

.rewrite-severity-badge.sev-info {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.rewrite-file {
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  margin-left: auto;
}

.rewrite-file:hover {
  color: var(--accent);
  text-decoration: underline;
}

.rewrite-description {
  font-size: 12px;
  color: var(--text-primary);
  line-height: 1.5;
  margin: 0;
}

.rewrite-diff-section {
  padding: 8px 0;
}

.rewrite-diff-label {
  font-size: 10px;
  font-weight: 600;
  padding: 0 10px 2px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
}

.rewrite-diff-label.remove {
  color: var(--red);
}

.rewrite-diff-label.add {
  color: var(--green);
}

.rewrite-diff-block {
  margin: 0;
  padding: 6px 10px;
  font-family: "JetBrains Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 11px;
  line-height: 1.6;
  white-space: pre;
  overflow-x: auto;
  tab-size: 4;
}

.rewrite-diff-block.remove {
  background: rgba(248, 113, 113, 0.08);
  color: var(--red);
}

.rewrite-diff-block.add {
  background: rgba(52, 211, 153, 0.08);
  color: var(--green);
  margin-bottom: 6px;
}

.rewrite-card-actions {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid var(--border-subtle);
}

.rewrite-action-btn {
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-dark);
  color: var(--text-secondary);
  font-size: 11px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.rewrite-action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.rewrite-action-btn.primary {
  background: var(--accent);
  color: #0d0e10;
  border-color: var(--accent);
  font-weight: 600;
}

.rewrite-action-btn.primary:hover {
  opacity: 0.88;
}

.rewrite-action-btn.dim {
  color: var(--text-muted);
  border-color: transparent;
  background: transparent;
}

.rewrite-action-btn.dim:hover {
  color: var(--red);
  background: rgba(248, 113, 113, 0.06);
}
</style>
