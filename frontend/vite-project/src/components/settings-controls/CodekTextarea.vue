<template>
  <textarea
    class="codek-textarea"
    :class="[`variant-${variant}`, { compact, invalid }]"
    :value="modelValue"
    :rows="rows"
    :placeholder="placeholder"
    :disabled="disabled"
    :spellcheck="spellcheck"
    :aria-label="ariaLabel || placeholder"
    @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    @change="$emit('change', ($event.target as HTMLTextAreaElement).value)"
  />
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  modelValue: string
  variant?: "default" | "code"
  rows?: number
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  compact?: boolean
  spellcheck?: boolean
  ariaLabel?: string
}>(), {
  variant: "default",
  rows: 3,
  placeholder: "",
  disabled: false,
  invalid: false,
  compact: false,
  spellcheck: false,
  ariaLabel: "",
})

defineEmits<{
  "update:modelValue": [value: string]
  change: [value: string]
}>()
</script>

<style scoped>
.codek-textarea {
  width: 100%;
  min-height: 88px;
  box-sizing: border-box;
  border: 1px solid var(--setting-control-border, var(--border-subtle, rgba(255,255,255,0.08)));
  border-radius: var(--setting-control-radius, 11px);
  background: var(--setting-control-bg, var(--bg-elevated, rgba(255,255,255,0.06)));
  color: var(--text-primary);
  padding: 10px 12px;
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  resize: vertical;
  outline: none;
  transition: border-color 0.12s ease, background 0.12s ease, box-shadow 0.12s ease;
}

.codek-textarea:hover {
  background: var(--setting-control-bg-hover, var(--bg-hover));
  border-color: var(--border-bright, var(--border));
}

.codek-textarea:focus {
  border-color: var(--setting-control-focus, var(--accent));
  box-shadow: 0 0 0 2px var(--accent-dim, rgba(106,169,255,0.16));
}

.codek-textarea.compact {
  min-height: 72px;
}

.codek-textarea.variant-code {
  background: var(--bg-dark);
  font-family: var(--font-mono, "JetBrains Mono", Consolas, monospace);
  font-size: 12px;
}

.codek-textarea.invalid {
  border-color: var(--red, #f48771);
}
</style>
