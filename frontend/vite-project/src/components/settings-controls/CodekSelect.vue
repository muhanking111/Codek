<template>
  <div class="codek-select-shell" :class="{ focused, disabled, invalid }">
    <span v-if="$slots.icon" class="codek-select-icon">
      <slot name="icon" />
    </span>
    <select
      class="codek-select"
      :value="modelValue"
      :disabled="disabled"
      :aria-label="ariaLabel || placeholder"
      @focus="focused = true"
      @blur="focused = false"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value); $emit('change', ($event.target as HTMLSelectElement).value)"
    >
      <option v-if="placeholder" disabled value="">{{ placeholder }}</option>
      <option v-for="option in options" :key="String(option.value)" :value="option.value">
        {{ option.label }}
      </option>
      <slot />
    </select>
    <svg class="codek-select-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"

export interface CodekSelectOption {
  value: string | number | boolean
  label: string
}

withDefaults(defineProps<{
  modelValue: string | number | boolean
  options?: CodekSelectOption[]
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  ariaLabel?: string
}>(), {
  options: () => [],
  placeholder: "",
  disabled: false,
  invalid: false,
  ariaLabel: "",
})

defineEmits<{
  "update:modelValue": [value: string]
  change: [value: string]
}>()

const focused = ref(false)
</script>

<style scoped>
.codek-select-shell {
  --control-height: var(--setting-control-height, 36px);
  --control-radius: var(--setting-control-radius, 11px);
  position: relative;
  width: 100%;
  min-width: 0;
  height: var(--control-height);
  display: flex;
  align-items: center;
  border: 1px solid var(--setting-control-border, var(--border-subtle, rgba(255,255,255,0.08)));
  border-radius: var(--control-radius);
  background: var(--setting-control-bg, var(--bg-elevated, rgba(255,255,255,0.06)));
  color: var(--text-primary);
  transition: border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
}

.codek-select-shell:hover {
  background: var(--setting-control-bg-hover, var(--bg-hover));
  border-color: var(--border-bright, var(--border));
}

.codek-select-shell.focused {
  border-color: var(--setting-control-focus, var(--accent));
  box-shadow: 0 0 0 2px var(--accent-dim, rgba(106,169,255,0.16));
}

.codek-select-shell.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.codek-select-shell.invalid {
  border-color: var(--red, #f48771);
}

.codek-select-icon {
  flex: 0 0 auto;
  display: inline-flex;
  margin-left: 10px;
  color: var(--text-muted);
}

.codek-select {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  padding: 0 32px 0 10px;
  appearance: none;
  cursor: pointer;
}

.codek-select option {
  background: var(--bg-dark);
  color: var(--text-primary);
}

.codek-select-chevron {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}
</style>
