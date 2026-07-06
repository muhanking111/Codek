<template>
  <label class="codek-field" :class="{ inline }">
    <span class="codek-field-text">
      <span class="codek-field-label">{{ label }}</span>
      <span v-if="description" class="codek-field-desc">{{ description }}</span>
    </span>
    <span class="codek-field-control">
      <slot />
    </span>
  </label>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  description?: string
  inline?: boolean
}>(), {
  description: "",
  inline: false,
})
</script>

<style scoped>
.codek-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.codek-field.inline {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 280px);
  align-items: center;
  gap: 12px;
}

.codek-field-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.codek-field-label {
  color: var(--text-secondary);
  font-size: 12px;
}

.codek-field-desc {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.4;
}

.codek-field-control {
  min-width: 0;
}
</style>
