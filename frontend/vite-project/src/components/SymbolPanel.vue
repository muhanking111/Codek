<template>
  <div class="symbol-panel" data-codek-smoke="symbols-panel">
    <div class="symbol-toolbar">
      <input
        :value="query"
        class="symbol-input"
        type="text"
        :placeholder="t('symbols.searchPlaceholder')"
        @input="$emit('update:query', $event.target.value)"
      />
    </div>

    <div class="symbol-sections">
      <section class="symbol-section">
        <div class="symbol-section-title">{{ t('symbols.outline') }}</div>
        <div v-if="outline.length === 0" class="symbol-empty">{{ t('symbols.noSymbols') }}</div>
        <button
          v-for="symbol in outline"
          :key="`${symbol.name}-${symbol.line}-${symbol.column}`"
          class="symbol-item"
          @click="$emit('openSymbol', symbol)"
        >
          <span class="symbol-kind">{{ symbol.kind }}</span>
          <span class="symbol-name">{{ symbol.name }}</span>
          <span class="symbol-loc">{{ symbol.line }}:{{ symbol.column }}</span>
        </button>
      </section>

      <section class="symbol-section">
        <div class="symbol-section-title">{{ t('symbols.searchResults') }}</div>
        <div v-if="results.length === 0" class="symbol-empty">{{ t('symbols.noMatches') }}</div>
        <button
          v-for="symbol in results"
          :key="`${symbol.path}-${symbol.name}-${symbol.line}`"
          class="symbol-item"
          @click="$emit('openSymbol', symbol)"
        >
          <span class="symbol-kind">{{ symbol.kind }}</span>
          <span class="symbol-name">{{ symbol.name }}</span>
          <span class="symbol-path">{{ symbol.path }}</span>
        </button>
      </section>

      <section class="symbol-section">
        <div class="symbol-section-title">{{ t('symbols.references') }}</div>
        <div v-if="!selectedSymbol" class="symbol-empty">{{ t('symbols.selectSymbol') }}</div>
        <div v-else>
          <div class="symbol-ref-header">
            <span class="symbol-name">{{ selectedSymbol }}</span>
            <span class="symbol-ref-count">{{ t('symbols.refs', { count: references.total }) }}</span>
          </div>
          <button
            v-for="entry in references.files"
            :key="`${entry.path}-${entry.count}`"
            class="symbol-item"
            @click="$emit('openFile', entry.path)"
          >
            <span class="symbol-path">{{ entry.path }}</span>
            <span class="symbol-loc">{{ entry.count }}</span>
          </button>
        </div>
      </section>

      <section class="symbol-section">
        <div class="symbol-section-title">{{ t('symbols.diagnostics') }}</div>
        <div v-if="diagnostics.length === 0" class="symbol-empty">{{ t('symbols.noDiagnostics') }}</div>
        <button
          v-for="diag in diagnostics"
          :key="`${diag.line}-${diag.column}-${diag.message}`"
          class="symbol-item diagnostic"
          @click="$emit('openDiagnostic', diag)"
        >
          <span class="symbol-kind" :class="diag.severity">{{ diag.severity }}</span>
          <span class="symbol-name">{{ diag.message }}</span>
          <span class="symbol-loc">{{ diag.line }}:{{ diag.column }}</span>
        </button>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue"
import { useI18n } from "../i18n/index"

const { t } = useI18n()

const props = defineProps({
  query: { type: String, default: "" },
  outline: { type: Array, default: () => [] },
  diagnostics: { type: Array, default: () => [] },
  searchResults: { type: Array, default: () => [] },
  selectedSymbol: { type: String, default: "" },
  referenceData: { type: Object, default: () => ({ total: 0, files: [] }) },
})

defineEmits(["update:query", "openFile", "openSymbol", "openDiagnostic"])

const results = computed(() => props.searchResults)
const references = computed(() => props.referenceData || { total: 0, files: [] })
</script>

<style scoped>
.symbol-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.symbol-toolbar {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.symbol-input {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--bg-dark);
  border-radius: 8px;
  color: var(--text-primary);
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
}

.symbol-sections {
  flex: 1;
  overflow-y: auto;
}

.symbol-section {
  padding: 10px 0 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.symbol-section-title {
  padding: 0 12px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.symbol-empty {
  padding: 0 12px 10px;
  color: var(--text-muted);
  font-size: 12px;
}

.symbol-item {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: center;
  border: none;
  background: transparent;
  color: inherit;
  padding: 6px 12px;
  text-align: left;
  cursor: pointer;
}

.symbol-item:hover {
  background: var(--bg-hover);
}

.symbol-item.diagnostic {
  grid-template-columns: auto 1fr auto;
}

.symbol-kind {
  font-size: 10px;
  color: var(--accent);
  background: rgba(45, 212, 191, 0.12);
  border-radius: 999px;
  padding: 2px 7px;
  text-transform: uppercase;
}

.symbol-kind.error {
  color: var(--red);
  background: rgba(248, 113, 113, 0.12);
}

.symbol-name {
  color: var(--text-primary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.symbol-path {
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.symbol-loc {
  color: var(--text-muted);
  font-size: 11px;
  flex-shrink: 0;
}

.symbol-ref-header {
  padding: 0 12px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.symbol-ref-count {
  font-size: 11px;
  color: var(--text-muted);
}
</style>
