<template>
  <span
    v-if="state?.dirty && !pinned"
    class="tab-dirty"
    :class="state.badge ? `tab-dirty-${state.badge}` : ''"
    :title="state.labelSuffix || fallbackTitle"
    :data-working-copy-badge="state.badge || 'dirty'"
  ></span>
</template>

<script setup lang="ts">
import type { EditorTabState } from "../workspace/manager"

defineProps<{
  state: EditorTabState | null
  pinned?: boolean
  fallbackTitle?: string
}>()
</script>
