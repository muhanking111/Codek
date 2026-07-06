<template>
  <div ref="rootRef" class="chat-mode-dropdown" @keydown.escape="open = false">
    <button
      class="mode-trigger"
      data-codek-smoke="chat-mode-trigger"
      type="button"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :title="current.description"
      @click="toggleOpen"
    >
      <span class="mode-dot" :class="`mode-dot-${modelValue}`" />
      <span>{{ current.label }}</span>
      <span v-if="modelValue === 'auto' && autoPermissionLevel" class="mode-badge">
        {{ autoPermissionLevel === "all" ? "完整" : "安全" }}
      </span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <div v-if="open" class="mode-menu" role="listbox">
      <button
        v-for="option in options"
        :key="option.value"
        class="mode-option"
        :data-codek-smoke="`chat-mode-${option.value}`"
        :class="{ active: option.value === modelValue }"
        type="button"
        role="option"
        :aria-selected="option.value === modelValue"
        @click="select(option.value)"
      >
        <span class="mode-option-label">{{ option.label }}</span>
        <span class="mode-option-desc">{{ option.description }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue"

type ChatModeValue = "ask" | "plan" | "agent" | "auto"

const props = defineProps<{
  modelValue: ChatModeValue
  autoPermissionLevel?: "all" | "safe" | null
}>()

const emit = defineEmits<{
  "update:modelValue": [mode: ChatModeValue]
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const options: Array<{ value: ChatModeValue; label: string; description: string }> = [
  { value: "agent", label: "执行", description: "执行任务，系统自动选择单智能体或多智能体" },
  { value: "plan", label: "规划", description: "拆解计划和风险，不直接修改文件" },
  { value: "ask", label: "问答", description: "问答和解释，只读上下文" },
  { value: "auto", label: "自主", description: "更高自主度执行，仍受沙箱和审批约束" },
]

const current = computed(() => options.find((option) => option.value === props.modelValue) || options[1])

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener("pointerdown", closeOnOutsidePointer, true)
    document.addEventListener("focusin", closeOnOutsideFocus, true)
  } else {
    removeOutsideListeners()
  }
})

onBeforeUnmount(() => {
  removeOutsideListeners()
})

function toggleOpen(): void {
  open.value = !open.value
}

function select(mode: ChatModeValue): void {
  open.value = false
  emit("update:modelValue", mode)
}

function closeOnOutsidePointer(event: PointerEvent): void {
  if (rootRef.value?.contains(event.target as Node)) return
  open.value = false
}

function closeOnOutsideFocus(event: FocusEvent): void {
  if (rootRef.value?.contains(event.target as Node)) return
  open.value = false
}

function removeOutsideListeners(): void {
  document.removeEventListener("pointerdown", closeOnOutsidePointer, true)
  document.removeEventListener("focusin", closeOnOutsideFocus, true)
}
</script>

<style scoped>
.chat-mode-dropdown {
  position: relative;
  flex: 0 0 auto;
}

.mode-trigger {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.mode-trigger:hover {
  background: rgba(148, 163, 184, 0.08);
  color: var(--text-bright);
}

.mode-trigger[aria-expanded="true"] {
  border-color: rgba(45, 212, 191, 0.38);
  background: rgba(45, 212, 191, 0.08);
}

.mode-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
}

.mode-dot-agent { background: var(--accent); }
.mode-dot-auto { background: var(--orange); }
.mode-dot-plan { background: #8fb3ff; }
.mode-dot-ask { background: #9ca3af; }

.mode-badge {
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(45, 212, 191, 0.18);
  color: var(--accent);
  font-size: 9px;
  font-weight: 700;
}

.mode-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  width: 230px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  z-index: 2600;
}

.mode-option {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
}

.mode-option:hover,
.mode-option.active {
  background: var(--bg-hover);
}

.mode-option-label {
  color: var(--text-bright);
  font-size: 12px;
  font-weight: 600;
}

.mode-option-desc {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.35;
}
</style>
