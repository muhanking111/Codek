<template>
  <svg
    class="activity-product-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    focusable="false"
  >
    <path
      v-for="path in paths"
      :key="path"
      :d="path"
    />
  </svg>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { getProductIconPaths } from "../workbench/productIcons"

const props = defineProps<{
  icon: string
}>()

const paths = computed(() => getProductIconPaths(props.icon))
</script>
