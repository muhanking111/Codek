<template>
  <div
    class="codek-input-shell"
    :class="[
      `variant-${variant}`,
      { focused, disabled, invalid, monospace, secret: isSecret },
    ]"
  >
    <span v-if="$slots.icon" class="codek-input-icon">
      <slot name="icon" />
    </span>
    <input
      class="codek-input"
      :type="inputType"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-label="ariaLabel || placeholder"
      :spellcheck="spellcheck"
      @focus="focused = true"
      @blur="focused = false"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @change="$emit('change', ($event.target as HTMLInputElement).value)"
    />
    <button
      v-if="isSecret"
      type="button"
      class="codek-input-action"
      :title="secretVisible ? '隐藏' : '显示'"
      :disabled="disabled"
      @click="secretVisible = !secretVisible"
    >
      {{ secretVisible ? "隐藏" : "显示" }}
    </button>
    <button
      v-else-if="clearable && modelValue"
      type="button"
      class="codek-input-action icon-only"
      title="清空"
      :disabled="disabled"
      @click="$emit('update:modelValue', '')"
    >
      ×
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"

const props = withDefaults(defineProps<{
  modelValue: string | number
  type?: string
  variant?: "default" | "url" | "path" | "secret" | "number"
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  monospace?: boolean
  clearable?: boolean
  ariaLabel?: string
  spellcheck?: boolean
}>(), {
  type: "text",
  variant: "default",
  placeholder: "",
  disabled: false,
  invalid: false,
  monospace: false,
  clearable: false,
  ariaLabel: "",
  spellcheck: false,
})

defineEmits<{
  "update:modelValue": [value: string]
  change: [value: string]
}>()

const focused = ref(false)
const secretVisible = ref(false)
const isSecret = computed(() => props.variant === "secret" || props.type === "password")
const inputType = computed(() => {
  if (isSecret.value) return secretVisible.value ? "text" : "password"
  if (props.variant === "number") return "number"
  return props.type
})
</script>

<style scoped>
.codek-input-shell {
  --control-height: var(--setting-control-height, 36px);
  --control-radius: var(--setting-control-radius, 11px);
  width: 100%;
  min-width: 0;
  min-height: var(--control-height);
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  border: 1px solid var(--setting-control-border, var(--border-subtle, rgba(255,255,255,0.08)));
  border-radius: var(--control-radius);
  background: var(--setting-control-bg, var(--bg-elevated, rgba(255,255,255,0.06)));
  color: var(--text-primary);
  padding: 0 10px;
  transition: border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
}

.codek-input-shell:hover {
  background: var(--setting-control-bg-hover, var(--bg-hover));
  border-color: var(--border-bright, var(--border));
}

.codek-input-shell.focused {
  border-color: var(--setting-control-focus, var(--accent));
  box-shadow: 0 0 0 2px var(--accent-dim, rgba(106,169,255,0.16));
}

.codek-input-shell.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.codek-input-shell.invalid {
  border-color: var(--red, #f48771);
}

.codek-input-icon {
  flex: 0 0 auto;
  display: inline-flex;
  color: var(--text-muted);
}

.codek-input {
  flex: 1;
  min-width: 0;
  height: calc(var(--control-height) - 2px);
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
}

.codek-input::placeholder {
  color: var(--text-muted);
}

.monospace .codek-input,
.variant-url .codek-input,
.variant-path .codek-input {
  font-family: var(--font-mono, "JetBrains Mono", Consolas, monospace);
  font-size: 12px;
}

.codek-input-action {
  flex: 0 0 auto;
  height: 24px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  padding: 0 6px;
}

.codek-input-action:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.codek-input-action.icon-only {
  width: 22px;
  padding: 0;
  font-size: 16px;
  line-height: 1;
}
</style>
