<template>
  <div ref="rootRef" class="codek-combo" :class="{ focused, disabled, invalid, open }">
    <div class="codek-combo-shell">
      <span v-if="$slots.icon" class="codek-combo-icon">
        <slot name="icon" />
      </span>
      <input
        ref="inputRef"
        class="codek-combo-input"
        :value="inputValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-label="ariaLabel || placeholder"
        role="combobox"
        :aria-expanded="open"
        aria-autocomplete="list"
        autocomplete="off"
        spellcheck="false"
        @focus="handleFocus"
        @input="handleInput"
        @keydown="handleKeydown"
      />
      <button
        type="button"
        class="codek-combo-action"
        :disabled="disabled"
        :title="open ? '收起' : '展开'"
        @click="toggleOpen"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </div>

    <div v-if="open && !disabled" class="codek-combo-menu" role="listbox">
      <div v-if="loading" class="codek-combo-empty">正在加载...</div>
      <button
        v-for="(option, index) in filteredOptions"
        v-else
        :key="String(option.value)"
        type="button"
        class="codek-combo-option"
        :class="{ active: index === activeIndex, selected: String(option.value) === String(modelValue) }"
        role="option"
        :aria-selected="String(option.value) === String(modelValue)"
        @mousedown.prevent="selectOption(option)"
      >
        <span class="codek-combo-option-label">{{ option.label }}</span>
        <span v-if="option.description" class="codek-combo-option-desc">{{ option.description }}</span>
      </button>
      <button
        v-if="!loading && allowCustom && inputValue.trim() && !hasExactInput"
        type="button"
        class="codek-combo-option custom"
        :class="{ active: activeIndex === filteredOptions.length }"
        @mousedown.prevent="commitCustom"
      >
        <span class="codek-combo-option-label">使用 "{{ inputValue.trim() }}"</span>
        <span class="codek-combo-option-desc">手动模型 ID</span>
      </button>
      <div v-if="!loading && filteredOptions.length === 0 && (!allowCustom || !inputValue.trim())" class="codek-combo-empty">
        没有匹配项
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"

export interface CodekComboBoxOption {
  value: string
  label: string
  description?: string
}

const props = withDefaults(defineProps<{
  modelValue: string
  options?: CodekComboBoxOption[]
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  loading?: boolean
  allowCustom?: boolean
  ariaLabel?: string
}>(), {
  options: () => [],
  placeholder: "",
  disabled: false,
  invalid: false,
  loading: false,
  allowCustom: true,
  ariaLabel: "",
})

const emit = defineEmits<{
  "update:modelValue": [value: string]
  change: [value: string]
}>()

const rootRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const inputValue = ref(props.modelValue)
const open = ref(false)
const focused = ref(false)
const activeIndex = ref(0)

const normalizedOptions = computed<CodekComboBoxOption[]>(() => {
  const seen = new Set<string>()
  return props.options.filter((option) => {
    const key = option.value.trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
})

const filteredOptions = computed(() => {
  const query = inputValue.value.trim().toLowerCase()
  if (!query) return normalizedOptions.value
  return normalizedOptions.value
    .filter((option) => {
      const value = option.value.toLowerCase()
      const label = option.label.toLowerCase()
      return value.includes(query) || label.includes(query)
    })
    .sort((a, b) => scoreOption(a, query) - scoreOption(b, query))
})

const hasExactInput = computed(() => {
  const query = inputValue.value.trim().toLowerCase()
  return normalizedOptions.value.some((option) => option.value.toLowerCase() === query || option.label.toLowerCase() === query)
})

watch(() => props.modelValue, (value) => {
  if (value !== inputValue.value) inputValue.value = value
})

function scoreOption(option: CodekComboBoxOption, query: string): number {
  const value = option.value.toLowerCase()
  const label = option.label.toLowerCase()
  if (value === query || label === query) return 0
  if (value.startsWith(query) || label.startsWith(query)) return 1
  return 2
}

function emitValue(value: string): void {
  emit("update:modelValue", value)
  emit("change", value)
}

function handleFocus(): void {
  focused.value = true
  open.value = true
  activeIndex.value = 0
}

function handleInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  inputValue.value = value
  open.value = true
  activeIndex.value = 0
  if (props.allowCustom) emit("update:modelValue", value)
}

function selectOption(option: CodekComboBoxOption): void {
  inputValue.value = option.value
  open.value = false
  emitValue(option.value)
}

function commitCustom(): void {
  const value = inputValue.value.trim()
  if (!value && !props.allowCustom) return
  inputValue.value = value
  open.value = false
  emitValue(value)
}

function toggleOpen(): void {
  if (props.disabled) return
  open.value = !open.value
  focused.value = open.value
  if (open.value) {
    activeIndex.value = 0
    inputRef.value?.focus()
  }
}

function handleKeydown(event: KeyboardEvent): void {
  const customCount = props.allowCustom && inputValue.value.trim() && !hasExactInput.value ? 1 : 0
  const itemCount = filteredOptions.value.length + customCount
  if (event.key === "ArrowDown") {
    event.preventDefault()
    open.value = true
    activeIndex.value = itemCount > 0 ? Math.min(activeIndex.value + 1, itemCount - 1) : 0
  } else if (event.key === "ArrowUp") {
    event.preventDefault()
    open.value = true
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  } else if (event.key === "Enter") {
    if (!open.value) return
    event.preventDefault()
    const option = filteredOptions.value[activeIndex.value]
    if (option) selectOption(option)
    else commitCustom()
  } else if (event.key === "Escape") {
    open.value = false
    inputValue.value = props.modelValue
  } else if (event.key === "Tab") {
    if (props.allowCustom && inputValue.value !== props.modelValue) commitCustom()
    open.value = false
  }
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (!rootRef.value?.contains(event.target as Node)) {
    open.value = false
    focused.value = false
    if (props.allowCustom && inputValue.value !== props.modelValue) commitCustom()
  }
}

document.addEventListener("pointerdown", handleDocumentPointerDown)
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown)
})
</script>

<style scoped>
.codek-combo {
  position: relative;
  width: 100%;
  min-width: 0;
}

.codek-combo-shell {
  --control-height: var(--setting-control-height, 36px);
  --control-radius: var(--setting-control-radius, 11px);
  width: 100%;
  min-width: 0;
  height: var(--control-height);
  display: flex;
  align-items: center;
  box-sizing: border-box;
  border: 1px solid var(--setting-control-border, var(--border-subtle, rgba(255,255,255,0.08)));
  border-radius: var(--control-radius);
  background: var(--setting-control-bg, var(--bg-elevated, rgba(255,255,255,0.06)));
  color: var(--text-primary);
  transition: border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
}

.codek-combo-shell:hover,
.codek-combo.open .codek-combo-shell {
  background: var(--setting-control-bg-hover, var(--bg-hover));
  border-color: var(--border-bright, var(--border));
}

.codek-combo.focused .codek-combo-shell {
  border-color: var(--setting-control-focus, var(--accent));
  box-shadow: 0 0 0 2px var(--accent-dim, rgba(106,169,255,0.16));
}

.codek-combo.disabled {
  opacity: 0.55;
}

.codek-combo.invalid .codek-combo-shell {
  border-color: var(--red, #f48771);
}

.codek-combo-icon {
  flex: 0 0 auto;
  display: inline-flex;
  margin-left: 10px;
  color: var(--text-muted);
}

.codek-combo-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  font-family: var(--font-mono, "JetBrains Mono", Consolas, monospace);
  padding: 0 8px 0 10px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.codek-combo-input::placeholder {
  color: var(--text-muted);
}

.codek-combo-action {
  flex: 0 0 auto;
  width: 30px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin-right: 4px;
}

.codek-combo-action:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.codek-combo-menu {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  right: 0;
  z-index: 2600;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--setting-control-radius, 11px);
  background: var(--bg-panel, #1f2329);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.45);
  padding: 5px;
}

.codek-combo-option {
  width: 100%;
  min-width: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: stretch;
  text-align: left;
  padding: 7px 9px;
  cursor: pointer;
  font: inherit;
}

.codek-combo-option:hover,
.codek-combo-option.active {
  background: var(--bg-hover);
}

.codek-combo-option.selected {
  color: var(--accent);
}

.codek-combo-option.custom {
  border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  margin-top: 4px;
  padding-top: 8px;
}

.codek-combo-option-label,
.codek-combo-option-desc {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codek-combo-option-label {
  font-family: var(--font-mono, "JetBrains Mono", Consolas, monospace);
  font-size: 12px;
}

.codek-combo-option-desc {
  color: var(--text-muted);
  font-size: 11px;
}

.codek-combo-empty {
  padding: 10px;
  color: var(--text-muted);
  font-size: 12px;
}
</style>
