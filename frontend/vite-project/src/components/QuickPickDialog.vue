<template>
  <CodekDialog
    :visible="Boolean(current || currentInput)"
    :title="current?.options.title || currentInput?.options.title || ''"
    width="min(620px, 94vw)"
    no-footer
    @close="cancel"
  >
    <template #default>
      <div
        v-if="current"
        class="quick-pick"
        data-codek-smoke="quick-input-workbench"
        data-quick-input-kind="quickPick"
        :data-busy="String(Boolean(current.options.busy))"
        :data-enabled="String(current.options.enabled !== false)"
        :aria-busy="Boolean(current.options.busy)"
      >
        <div v-if="currentStepLabel || current.options.buttons?.length" class="quick-pick-titlebar">
          <span v-if="currentStepLabel" class="quick-pick-step">{{ currentStepLabel }}</span>
          <div v-if="current.options.buttons?.length" class="quick-pick-title-buttons" aria-label="Quick input actions">
            <button
              v-for="button in current.options.buttons"
              :key="button.id || button.tooltip || button.iconClass || 'title-button'"
              class="quick-pick-title-button"
              type="button"
              :title="button.tooltip || ''"
              :disabled="current.options.enabled === false"
              @click="triggerTitleButton(current.id, button)"
            >
              {{ buttonLabel(button) }}
            </button>
          </div>
        </div>
        <div
          class="quick-input-progress"
          role="progressbar"
          :aria-hidden="current.options.busy ? 'false' : 'true'"
        />
        <input
          ref="inputRef"
          v-model="query"
          class="quick-pick-input"
          :placeholder="plainRichText(current.options.placeHolder || '')"
          :aria-controls="listId"
          :aria-activedescendant="activeDescendant"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          autocomplete="off"
          spellcheck="false"
          :disabled="current.options.enabled === false"
          @input="onQueryInput"
          @keydown="onKeydown"
        />
        <p v-if="current.options.description" class="quick-input-description">
          <template v-for="part in richTokens(current.options.description)" :key="part.key">
            <span v-if="part.type === 'icon'" class="codicon" :class="part.className" aria-hidden="true" />
            <span v-else>{{ part.value }}</span>
          </template>
        </p>
        <p
          v-if="current.options.validationMessage"
          class="quick-input-validation"
          :class="severityClass(current.options.severity)"
        >
          <template v-for="part in richTokens(current.options.validationMessage)" :key="part.key">
            <span v-if="part.type === 'icon'" class="codicon" :class="part.className" aria-hidden="true" />
            <span v-else>{{ part.value }}</span>
          </template>
        </p>

        <div
          :id="listId"
          class="quick-pick-list"
          role="listbox"
          aria-live="polite"
          aria-relevant="additions text"
          :data-focus-target="listFocusTarget"
          :data-render-window="renderWindowLabel"
          :style="virtualListStyle"
          ref="listRef"
          @scroll.passive="onListScroll"
        >
          <div v-if="topSpacerHeight" class="quick-pick-virtual-spacer" :style="{ height: `${topSpacerHeight}px` }" />
          <template v-for="entry in visibleEntries" :key="entryKey(entry)">
            <div v-if="entry.type === 'separator'" class="quick-pick-separator" role="presentation">
              <span class="quick-pick-separator-label">
                <template v-for="part in richTokens(entry.label)" :key="part.key">
                  <span v-if="part.type === 'icon'" class="codicon" :class="part.className" aria-hidden="true" />
                  <span v-else>{{ part.value }}</span>
                </template>
              </span>
              <span v-if="entry.buttons?.length" class="quick-pick-separator-buttons">
                <button
                  v-for="button in entry.buttons"
                  :key="button.id || button.tooltip || button.iconClass || 'separator-button'"
                  class="quick-pick-separator-button"
                  type="button"
                  :title="button.tooltip || ''"
                  :disabled="button.disabled || current.options.enabled === false"
                  @click.stop="triggerSeparatorButton(entry, button)"
                >
                  {{ buttonLabel(button) }}
                </button>
              </span>
            </div>
            <button
              v-else
              :id="optionId(entry)"
              type="button"
              class="quick-pick-item"
              :class="{ active: selectableEntries[activeIndex] === entry }"
              role="option"
              :aria-label="itemAriaLabel(entry)"
              :aria-selected="selectableEntries[activeIndex] === entry"
              :aria-checked="current.options.canPickMany ? isPicked(entry) : undefined"
              :disabled="entry.disabled || current.options.enabled === false"
              @focus="focusEntry(entry)"
              @mouseenter="focusEntry(entry, { reveal: false })"
              @click="accept(entry)"
            >
              <span class="quick-pick-row">
                <input
                  v-if="current.options.canPickMany"
                  class="quick-pick-checkbox"
                  type="checkbox"
                  tabindex="-1"
                  :checked="isPicked(entry)"
                  :disabled="entry.disabled"
                  @click.stop="togglePicked(entry)"
                />
                <span class="quick-pick-label">
                  <template v-for="part in richTokens(entry.label)" :key="part.key">
                    <span v-if="part.type === 'icon'" class="codicon" :class="part.className" aria-hidden="true" />
                    <span v-else>{{ part.value }}</span>
                  </template>
                </span>
                <span v-if="entry.description" class="quick-pick-description">
                  <template v-for="part in richTokens(entry.description)" :key="part.key">
                    <span v-if="part.type === 'icon'" class="codicon" :class="part.className" aria-hidden="true" />
                    <span v-else>{{ part.value }}</span>
                  </template>
                </span>
              </span>
              <span v-if="entry.detail" class="quick-pick-detail">
                <template v-for="part in richTokens(entry.detail)" :key="part.key">
                  <span v-if="part.type === 'icon'" class="codicon" :class="part.className" aria-hidden="true" />
                  <span v-else>{{ part.value }}</span>
                </template>
              </span>
              <span v-if="entry.buttons?.length" class="quick-pick-buttons">
                <button
                  v-for="button in entry.buttons"
                  :key="button.id || button.tooltip || button.iconClass || 'button'"
                  class="quick-pick-button"
                  type="button"
                  :title="button.tooltip || ''"
                  :disabled="current.options.enabled === false"
                  @click.stop="triggerItemButton(entry, button)"
                >
                  {{ buttonLabel(button) }}
                </button>
              </span>
            </button>
          </template>
          <div v-if="selectableEntries.length === 0" class="quick-pick-empty">
            没有匹配项
          </div>
          <div v-if="bottomSpacerHeight" class="quick-pick-virtual-spacer" :style="{ height: `${bottomSpacerHeight}px` }" />
        </div>
        <div v-if="current.options.canPickMany" class="quick-pick-actions">
          <button class="quick-pick-ok" type="button" :disabled="current.options.enabled === false" @click="acceptMany">确定</button>
        </div>
      </div>
      <div
        v-else-if="currentInput"
        class="quick-pick"
        data-codek-smoke="quick-input-workbench"
        data-quick-input-kind="inputBox"
        :data-enabled="String(currentInput.options.enabled !== false)"
        aria-busy="false"
      >
        <div v-if="currentInputStepLabel || currentInput.options.buttons?.length" class="quick-pick-titlebar">
          <span v-if="currentInputStepLabel" class="quick-pick-step">{{ currentInputStepLabel }}</span>
          <div v-if="currentInput.options.buttons?.length" class="quick-pick-title-buttons" aria-label="Quick input actions">
            <button
              v-for="button in currentInput.options.buttons"
              :key="button.id || button.tooltip || button.iconClass || 'title-button'"
              class="quick-pick-title-button"
              type="button"
              :title="button.tooltip || ''"
              :disabled="currentInput.options.enabled === false"
              @click="triggerTitleButton(currentInput.id, button)"
            >
              {{ buttonLabel(button) }}
            </button>
          </div>
        </div>
        <p v-if="currentInput.options.prompt" class="quick-input-prompt">{{ currentInput.options.prompt }}</p>
        <input
          ref="inputBoxRef"
          v-model="inputValue"
          class="quick-pick-input"
          :type="currentInput.options.password ? 'password' : 'text'"
          :placeholder="plainRichText(currentInput.options.placeHolder || '')"
          autocomplete="off"
          spellcheck="false"
          :disabled="currentInput.options.enabled === false"
          @input="onInputBoxInput"
          @keydown.enter.prevent="acceptInput"
          @keydown.esc.prevent="cancel"
        />
        <p v-if="currentInput.options.description" class="quick-input-description">
          <template v-for="part in richTokens(currentInput.options.description)" :key="part.key">
            <span v-if="part.type === 'icon'" class="codicon" :class="part.className" aria-hidden="true" />
            <span v-else>{{ part.value }}</span>
          </template>
        </p>
        <p
          v-if="currentInput.options.validationMessage"
          class="quick-input-validation"
          :class="severityClass(currentInput.options.severity)"
        >
          <template v-for="part in richTokens(currentInput.options.validationMessage)" :key="part.key">
            <span v-if="part.type === 'icon'" class="codicon" :class="part.className" aria-hidden="true" />
            <span v-else>{{ part.value }}</span>
          </template>
        </p>
        <div class="quick-pick-actions">
          <button class="quick-pick-ok" type="button" :disabled="currentInput.options.enabled === false" @click="acceptInput">确定</button>
        </div>
      </div>
    </template>
  </CodekDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { acceptInputBox, acceptQuickPick, acceptQuickPickMany, cancelInputBox, cancelQuickPick, quickInputState, setQuickInputFocusTarget, setQuickPickScrollState, triggerQuickInputButton, triggerQuickPickItemButton, triggerQuickPickSeparatorButton, type QuickInputButton, type QuickPickEntry, type QuickPickItem, type QuickPickSeparator } from "../workbench/quickInput"
import CodekDialog from "./CodekDialog.vue"

const query = ref("")
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const inputBoxRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const inputValue = ref("")
const pickedIds = ref<Set<string>>(new Set())
const listFocusTarget = ref<"input" | "list">("input")
const scrollTop = ref(0)
const viewportHeight = ref(0)
const listId = "quick-pick-list"

const current = computed(() => quickInputState.queue[0] ?? null)
const currentInput = computed(() => current.value ? null : quickInputState.inputQueue[0] ?? null)
const filteredEntries = computed(() => filterEntries(current.value?.items || [], query.value))
const selectableEntries = computed(() => filteredEntries.value.filter((entry): entry is QuickPickItem => entry.type !== "separator" && !entry.disabled))
const renderWindow = computed(() => {
  const request = current.value
  const total = filteredEntries.value.length
  const rowHeight = rowHeightValue.value
  const dynamicLimit = rowHeight && viewportHeight.value
    ? Math.ceil(viewportHeight.value / rowHeight) + ((normalizePositiveInteger(request?.options.renderOverscan) || 0) * 2)
    : undefined
  const limit = dynamicLimit || normalizePositiveInteger(request?.options.renderLimit)
  if (!request || query.value.trim() || !limit || total <= limit) return { start: 0, end: total }

  const activeItem = selectableEntries.value[activeIndex.value]
  const activeEntryIndex = activeItem ? filteredEntries.value.indexOf(activeItem) : -1
  const overscan = normalizePositiveInteger(request.options.renderOverscan) || 0
  const scrollIndex = rowHeight ? Math.floor(scrollTop.value / rowHeight) : 0
  if (rowHeight && viewportHeight.value > 0) {
    const start = Math.min(Math.max(0, scrollIndex - overscan), Math.max(0, total - limit))
    return { start, end: Math.min(total, start + limit) }
  }
  let start = Math.max(0, rowHeight ? scrollIndex - overscan : (activeEntryIndex >= 0 ? activeEntryIndex - overscan : 0))
  if (activeEntryIndex >= 0 && activeEntryIndex < start) start = Math.max(0, activeEntryIndex - overscan)
  if (activeEntryIndex >= 0 && activeEntryIndex >= start + limit) start = activeEntryIndex - limit + 1
  start = Math.min(start, Math.max(0, total - limit))
  return { start, end: Math.min(total, start + limit) }
})
const visibleEntries = computed(() => {
  const window = renderWindow.value
  return filteredEntries.value.slice(window.start, window.end)
})
const renderWindowLabel = computed(() => {
  const window = renderWindow.value
  return `${window.start}:${window.end}`
})
const rowHeightValue = computed(() => normalizePositiveInteger(current.value?.options.rowHeight) || 38)
const topSpacerHeight = computed(() => renderWindow.value.start * rowHeightValue.value)
const bottomSpacerHeight = computed(() => Math.max(0, (filteredEntries.value.length - renderWindow.value.end) * rowHeightValue.value))
const virtualListStyle = computed(() => {
  const request = current.value
  const rowHeight = normalizePositiveInteger(request?.options.rowHeight)
  const height = normalizePositiveInteger(request?.options.viewportHeight)
  return height && rowHeight ? { maxHeight: `${height}px` } : undefined
})
const currentStepLabel = computed(() => formatStepLabel(current.value?.options.step, current.value?.options.totalSteps))
const currentInputStepLabel = computed(() => formatStepLabel(currentInput.value?.options.step, currentInput.value?.options.totalSteps))
const activeDescendant = computed(() => {
  const item = selectableEntries.value[activeIndex.value]
  return item ? optionId(item) : undefined
})

watch(current, async (request) => {
  query.value = request?.value || request?.options.value || ""
  activeIndex.value = 0
  scrollTop.value = 0
  viewportHeight.value = 0
  listFocusTarget.value = "input"
  const selectedItems = request?.selectedItems?.length
    ? request.selectedItems
    : (request?.items || []).filter((entry): entry is QuickPickItem => entry.type !== "separator" && entry.picked === true)
  pickedIds.value = new Set(selectedItems.map(itemKey))
  if (request) {
    await nextTick()
    syncActiveItem()
    syncSelectedItems()
    inputRef.value?.focus()
  }
}, { immediate: true })

watch(currentInput, async (request) => {
  inputValue.value = request?.options.value || ""
  if (request) {
    await nextTick()
    inputBoxRef.value?.focus()
  }
}, { immediate: true })

watch(selectableEntries, (entries) => {
  activeIndex.value = entries.length ? Math.min(activeIndex.value, entries.length - 1) : 0
  syncActiveItem()
  syncSelectedItems()
})

function filterEntries(entries: QuickPickEntry<unknown>[], rawQuery: string): QuickPickEntry<unknown>[] {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return entries
  const result: QuickPickEntry<unknown>[] = []
  let pendingSeparator: QuickPickEntry<unknown> | null = null
  for (const entry of entries) {
    if (entry.type === "separator") {
      pendingSeparator = entry
      continue
    }
    const haystack = [entry.label, entry.description, entry.detail].filter(Boolean).join(" ").toLowerCase()
    if (!haystack.includes(q)) continue
    if (pendingSeparator) {
      result.push(pendingSeparator)
      pendingSeparator = null
    }
    result.push(entry)
  }
  return result
}

function onKeydown(event: KeyboardEvent): void {
  if (current.value?.options.enabled === false) {
    if (event.key === "Escape") {
      event.preventDefault()
      cancel()
    }
    return
  }
  if (event.key === "ArrowDown") {
    event.preventDefault()
    activeIndex.value = selectableEntries.value.length
      ? Math.min(activeIndex.value + 1, selectableEntries.value.length - 1)
      : 0
    setListFocusTarget("list")
    syncActiveItem()
  } else if (event.key === "ArrowUp") {
    event.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
    setListFocusTarget("list")
    syncActiveItem()
  } else if (event.key === "Enter") {
    event.preventDefault()
    const item = selectableEntries.value[activeIndex.value]
    if (item) accept(item)
  } else if (event.key === "Escape") {
    event.preventDefault()
    cancel()
  }
}

function onQueryInput(event: Event): void {
  const value = (event.target as HTMLInputElement | null)?.value || ""
  query.value = value
  const request = current.value
  if (request) request.changeValue?.(value)
}

function onInputBoxInput(event: Event): void {
  const value = (event.target as HTMLInputElement | null)?.value || ""
  inputValue.value = value
  currentInput.value?.changeValue?.(value)
}

function onListScroll(event: Event): void {
  const target = event.currentTarget as HTMLElement | null
  if (!target) return
  scrollTop.value = target.scrollTop
  viewportHeight.value = target.clientHeight
  const request = current.value
  if (request) setQuickPickScrollState(request.id, scrollTop.value, viewportHeight.value)
}

function accept(item: QuickPickItem): void {
  const request = current.value
  if (!request || item.disabled) return
  if (request.options.enabled === false) return
  if (request.options.canPickMany) {
    togglePicked(item)
    return
  }
  acceptQuickPick(request.id, item)
}

function acceptMany(): void {
  const request = current.value
  if (!request) return
  if (request.options.enabled === false) return
  const picked = selectableEntries.value.filter((entry) => pickedIds.value.has(itemKey(entry)))
  acceptQuickPickMany(request.id, picked)
}

function togglePicked(item: QuickPickItem): void {
  if (current.value?.options.enabled === false) return
  if (item.disabled) return
  const next = new Set(pickedIds.value)
  const key = itemKey(item)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  pickedIds.value = next
  syncSelectedItems()
}

function isPicked(item: QuickPickItem): boolean {
  return pickedIds.value.has(itemKey(item))
}

function cancel(): void {
  const request = current.value
  if (request) {
    cancelQuickPick(request.id)
    return
  }
  const inputRequest = currentInput.value
  if (inputRequest) cancelInputBox(inputRequest.id)
}

function acceptInput(): void {
  const request = currentInput.value
  if (!request) return
  if (request.options.enabled === false) return
  void acceptInputBox(request.id, inputValue.value)
}

function triggerItemButton(item: QuickPickItem, button: QuickInputButton): void {
  const request = current.value
  if (!request) return
  if (request.options.enabled === false) return
  triggerQuickPickItemButton(request.id, item, button)
}

function triggerSeparatorButton(separator: QuickPickSeparator, button: QuickInputButton): void {
  const request = current.value
  if (!request) return
  if (request.options.enabled === false || button.disabled) return
  triggerQuickPickSeparatorButton(request.id, separator, button)
}

function triggerTitleButton(id: string, button: QuickInputButton): void {
  const request = current.value || currentInput.value
  if (request?.options.enabled === false) return
  triggerQuickInputButton(id, button)
}

function focusEntry(item: QuickPickItem, options: { reveal?: boolean } = {}): void {
  const index = selectableEntries.value.indexOf(item)
  if (index < 0 || activeIndex.value === index) return
  activeIndex.value = index
  setListFocusTarget("list")
  syncActiveItem(options)
}

function buttonLabel(button: QuickInputButton): string {
  if (button.id === "back" || button.iconClass?.includes("back")) return "<"
  if (button.iconClass?.includes("attach")) return "+"
  return button.tooltip?.slice(0, 1) || "+"
}

function formatStepLabel(step?: number, totalSteps?: number): string {
  if (!Number.isFinite(step) || !Number.isFinite(totalSteps)) return ""
  const currentStep = Math.trunc(Number(step))
  const total = Math.trunc(Number(totalSteps))
  if (currentStep < 1 || total < 1) return ""
  return `${Math.min(currentStep, total)}/${total}`
}

function severityClass(severity?: string): string {
  if (severity === "error" || severity === "warning" || severity === "info") return `severity-${severity}`
  return "severity-ignore"
}

function entryKey(entry: QuickPickEntry<unknown>): string {
  if (entry.type === "separator") return `separator:${entry.id || entry.label || ""}`
  return itemKey(entry)
}

function optionId(entry: QuickPickItem): string {
  return `quick-pick-option-${selectableEntries.value.indexOf(entry)}`
}

function itemAriaLabel(entry: QuickPickItem): string {
  const parts = [entry.label, entry.description, entry.detail, groupLabelFor(entry)].map(plainRichText)
    .filter((part): part is string => Boolean(part))
  return parts.join(", ")
}

function groupLabelFor(item: QuickPickItem): string | undefined {
  const request = current.value
  if (!request) return undefined
  let group: string | undefined
  for (const entry of request.items) {
    if (entry.type === "separator") {
      group = entry.label
      continue
    }
    if (entry === item || itemKey(entry) === itemKey(item)) return group
  }
  return undefined
}

function itemKey(entry: QuickPickItem): string {
  return `${entry.type || "item"}:${entry.id || entry.label}:${entry.description || ""}`
}

interface RichToken {
  key: string
  type: "text" | "icon"
  value: string
  className?: string
}

function richTokens(value: string | undefined): RichToken[] {
  const source = String(value || "")
  const tokens: RichToken[] = []
  const pattern = /(\\)?\$\(([a-zA-Z0-9-]+)\)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ key: `text:${lastIndex}`, type: "text", value: source.slice(lastIndex, match.index) })
    }
    if (match[1]) {
      tokens.push({ key: `escaped:${match.index}`, type: "text", value: `$(${match[2]})` })
    } else {
      tokens.push({
        key: `icon:${match.index}:${match[2]}`,
        type: "icon",
        value: match[2],
        className: `codicon-${match[2]}`,
      })
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < source.length) {
    tokens.push({ key: `text:${lastIndex}`, type: "text", value: source.slice(lastIndex) })
  }
  return tokens.length ? tokens : [{ key: "text:0", type: "text", value: source }]
}

function plainRichText(value: string | undefined): string {
  return richTokens(value).map((part) => part.value).join("")
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const normalized = Math.trunc(Number(value))
  return Number.isFinite(normalized) && normalized > 0 ? normalized : undefined
}

function syncActiveItem(options: { reveal?: boolean } = {}): void {
  const request = current.value
  if (!request) return
  const item = selectableEntries.value[activeIndex.value]
  request.setActiveItems?.(item ? [item] : [])
  if (options.reveal === false) return
  const rowHeight = rowHeightValue.value
  const itemIndex = item ? filteredEntries.value.indexOf(item) : -1
  if (itemIndex >= 0 && viewportHeight.value > 0) {
    const itemTop = itemIndex * rowHeight
    const itemBottom = itemTop + rowHeight
    const nextScrollTop = itemTop < scrollTop.value
      ? itemTop
      : itemBottom > scrollTop.value + viewportHeight.value
        ? Math.max(0, itemBottom - viewportHeight.value)
        : scrollTop.value
    if (nextScrollTop !== scrollTop.value) {
      scrollTop.value = nextScrollTop
      if (listRef.value) listRef.value.scrollTop = nextScrollTop
    }
    setQuickPickScrollState(request.id, scrollTop.value, viewportHeight.value)
  }
}

function setListFocusTarget(target: "input" | "list"): void {
  listFocusTarget.value = target
  const request = current.value
  if (request) setQuickInputFocusTarget(request.id, target)
}

function syncSelectedItems(): void {
  const request = current.value
  if (!request) return
  request.setSelectedItems?.(selectableEntries.value.filter((entry) => pickedIds.value.has(itemKey(entry))))
}
</script>

<style scoped>
.quick-pick {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quick-pick-input {
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-primary);
  padding: 0 10px;
  outline: none;
  font: inherit;
}

.quick-input-progress {
  height: 2px;
  border-radius: 999px;
  background: transparent;
  overflow: hidden;
}

.quick-input-progress[aria-hidden="false"] {
  background:
    linear-gradient(90deg, transparent 0%, var(--accent) 45%, transparent 90%),
    color-mix(in srgb, var(--accent) 20%, transparent);
}

.quick-pick-input:focus {
  border-color: var(--accent);
}

.quick-pick-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.quick-input-description,
.quick-input-validation {
  margin: -2px 0 0;
  font-size: 12px;
  line-height: 1.4;
}

.quick-input-description {
  color: var(--text-secondary);
}

.quick-input-validation {
  color: var(--text-muted);
}

.quick-input-validation.severity-info {
  color: var(--blue, #60a5fa);
}

.quick-input-validation.severity-warning {
  color: var(--orange, #f59e0b);
}

.quick-input-validation.severity-error {
  color: var(--red, #ef4444);
}

.quick-pick-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
}

.quick-pick-step {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 24px;
  white-space: nowrap;
}

.quick-pick-title-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  min-height: 24px;
  margin-left: auto;
}

.quick-pick-title-button {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font: inherit;
  line-height: 1;
  cursor: pointer;
}

.quick-pick-title-button:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.quick-pick-title-button:disabled,
.quick-pick-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.quick-pick-list {
  max-height: min(420px, 56vh);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.quick-pick-separator {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 7px 4px;
  color: var(--text-muted);
  font-size: 11px;
  text-transform: uppercase;
}

.quick-pick-separator-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-pick-separator-buttons {
  display: flex;
  gap: 4px;
  flex: 0 0 auto;
}

.quick-pick-item {
  min-height: 38px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  padding: 6px 8px;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.quick-pick-item:hover,
.quick-pick-item.active {
  background: var(--bg-hover);
}

.quick-pick-item:disabled {
  opacity: 0.55;
  cursor: default;
}

.quick-pick-buttons {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}

.quick-pick-button,
.quick-pick-separator-button {
  width: 22px;
  height: 22px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
}

.quick-pick-separator-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.codicon {
  display: inline-block;
  width: 1em;
  margin-right: 4px;
  vertical-align: -0.1em;
}

.quick-pick-row {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.quick-pick-checkbox {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
}

.quick-pick-label,
.quick-pick-description,
.quick-pick-detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quick-pick-label {
  color: var(--text-bright);
  font-size: 12px;
  font-weight: 600;
}

.quick-pick-description {
  color: var(--text-muted);
  font-size: 12px;
}

.quick-pick-detail {
  display: block;
  margin-top: 2px;
  color: var(--text-muted);
  font-size: 11px;
}

.quick-pick-empty {
  padding: 14px 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.quick-input-prompt {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.quick-pick-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}

.quick-pick-ok {
  min-width: 72px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--accent);
  color: var(--accent-contrast, #fff);
  font: inherit;
  cursor: pointer;
}
</style>
