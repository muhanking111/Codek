<template>
  <div class="chat-model-picker" :style="pickerStyle">
    <select class="provider-select" :value="activeType" @change="handleTypeChange">
      <option v-for="option in typeOptions" :key="option.type" :value="option.type">
        {{ option.label }}
      </option>
    </select>

    <div class="model-select-wrap">
      <select
        class="model-select"
        :value="activeModelName"
        :disabled="!providerEnabled"
        :title="modelTitle"
        @change="handleModelChange"
      >
        <option v-if="!providerEnabled" value="" disabled>未启用</option>
        <option v-else-if="fetchingModels" value="" disabled>加载中...</option>
        <option v-else-if="currentModels.length === 0" value="" disabled>暂无模型</option>
        <option v-for="model in currentModels" :key="model" :value="model">{{ model }}</option>
      </select>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import type { AiProviderType } from "../ai/aiProviders"

const props = defineProps<{
  typeOptions: Array<{ type: AiProviderType; label: string }>
  activeType: AiProviderType
  activeModelName: string
  currentModels: string[]
  fetchingModels: boolean
  providerEnabled: boolean
}>()

const emit = defineEmits<{
  typeChange: [type: AiProviderType]
  modelChange: [model: string]
}>()

const pickerStyle = computed(() => {
  const modelName = props.activeModelName || (props.providerEnabled ? "选择模型" : "未启用")
  const chars = Math.max(12, Math.min(18, modelName.length + 2))
  return { "--chat-model-select-ch": `${chars}ch` }
})

const modelTitle = computed(() => {
  if (!props.providerEnabled) return "请先在设置中启用对应类型的供应商"
  if (props.currentModels.length === 0) return "暂无可用模型"
  return props.activeModelName || "选择模型"
})

function handleTypeChange(event: Event): void {
  emit("typeChange", (event.target as HTMLSelectElement).value as AiProviderType)
}

function handleModelChange(event: Event): void {
  emit("modelChange", (event.target as HTMLSelectElement).value)
}
</script>

<style scoped>
.chat-model-picker {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  width: 100%;
  flex: 1 1 auto;
  overflow: visible;
}

.provider-select,
.model-select {
  height: 30px;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  outline: none;
}

.provider-select {
  flex: 0 0 68px;
  padding: 0 5px;
}

.model-select-wrap {
  flex: 1 1 var(--chat-model-select-ch, 22ch);
  width: var(--chat-model-select-ch, 22ch);
  min-width: 0;
  max-width: min(34ch, 100%);
}

.model-select {
  width: 100%;
  padding: 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.provider-select:hover,
.model-select:hover {
  background: rgba(148, 163, 184, 0.08);
  color: var(--text-bright);
}

.provider-select:focus,
.model-select:focus {
  border-color: rgba(45, 212, 191, 0.42);
}

.model-select:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
