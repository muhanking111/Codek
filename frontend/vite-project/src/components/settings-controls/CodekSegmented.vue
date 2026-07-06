<template>
  <div class="codek-segmented" role="radiogroup" :aria-label="ariaLabel">
    <button
      v-for="(option, index) in options"
      :key="String(option.value)"
      type="button"
      class="codek-segmented-btn"
      :class="{ active: option.value === modelValue }"
      role="radio"
      :aria-checked="option.value === modelValue"
      :disabled="disabled || option.disabled"
      @click="selectOption(option)"
      @keydown="handleKeydown($event, index)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
export interface CodekSegmentedOption {
  value: string
  label: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue: string
  options: CodekSegmentedOption[]
  disabled?: boolean
  ariaLabel?: string
}>(), {
  disabled: false,
  ariaLabel: "",
})

const emit = defineEmits<{
  "update:modelValue": [value: string]
  change: [value: string]
}>()

function selectOption(option: CodekSegmentedOption): void {
  if (props.disabled || option.disabled) return
  emit("update:modelValue", option.value)
  emit("change", option.value)
}

function handleKeydown(event: KeyboardEvent, index: number): void {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return
  event.preventDefault()
  const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1
  const options = props.options.filter((option) => !option.disabled)
  if (options.length === 0) return
  const current = props.options[index]
  const enabledIndex = Math.max(0, options.findIndex((option) => option.value === current.value))
  const next = options[(enabledIndex + direction + options.length) % options.length]
  selectOption(next)
}
</script>

<style scoped>
.codek-segmented {
  display: inline-flex;
  width: max-content;
  max-width: 100%;
  min-height: var(--setting-control-height, 36px);
  padding: 3px;
  gap: 2px;
  border: 1px solid var(--setting-control-border, var(--border-subtle, rgba(255,255,255,0.08)));
  border-radius: var(--setting-control-radius, 11px);
  background: var(--setting-control-bg, var(--bg-elevated, rgba(255,255,255,0.06)));
  box-sizing: border-box;
}

.codek-segmented-btn {
  min-width: 0;
  border: 0;
  border-radius: calc(var(--setting-control-radius, 11px) - 3px);
  background: transparent;
  color: var(--text-secondary);
  padding: 0 12px;
  font: inherit;
  font-size: 12px;
  line-height: 28px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.codek-segmented-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.codek-segmented-btn.active {
  color: var(--text-bright);
  background: var(--bg-active);
  box-shadow: inset 0 0 0 1px var(--border-subtle, rgba(255,255,255,0.08));
}

.codek-segmented-btn:focus-visible {
  outline: 2px solid var(--accent-dim, rgba(106,169,255,0.3));
  outline-offset: 1px;
}

.codek-segmented-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
