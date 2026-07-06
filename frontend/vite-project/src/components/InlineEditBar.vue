<template>
  <div v-if="visible" class="inline-edit-overlay" :style="positionStyle" @keydown="handleKeydown" @click.stop>
    <div class="inline-edit-bar">
      <span class="ie-label">Edit</span>
      <input
        ref="inputRef"
        v-model="instruction"
        type="text"
        class="ie-input"
        :placeholder="t('inlineEdit.placeholder')"
        :disabled="busy"
        @keydown.enter.prevent="submit"
      />
      <span v-if="activeModel" class="ie-model">{{ activeModel }}</span>
      <button class="ie-btn ie-btn-apply" :disabled="busy || !instruction.trim()" @click="submit">
        {{ busy ? "..." : t('inlineEdit.go') }}
      </button>
      <button v-if="busy" class="ie-btn ie-btn-stop" @click="$emit('cancel')">{{ t('inlineEdit.stop') }}</button>
    </div>

    <div v-if="review" class="ie-review"><pre>{{ review }}</pre></div>

    <div v-if="status" class="ie-status" :class="status">
      <span v-if="status === 'model'">{{ statusText }}</span>
      <span v-else-if="status === 'generating'">{{ t('inlineEdit.generating') }}</span>
      <span v-else-if="status === 'done'" class="ie-done">
        <button class="ie-action-btn ie-accept" @click="$emit('accept')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          Accept
        </button>
        <button class="ie-action-btn ie-reject" @click="$emit('reject')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Reject
        </button>
        <span class="ie-hint">Ctrl+Y accept · Esc reject</span>
      </span>
      <span v-else-if="status === 'error'">{{ t('inlineEdit.failed') }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue"
import { useI18n } from "../i18n/index"

const { t } = useI18n()

const props = defineProps({
  visible: Boolean,
  busy: Boolean,
  status: String,
  statusText: { type: String, default: "" },
  activeModel: { type: String, default: "" },
  review: { type: String, default: "" },
  cursorTop: { type: Number, default: 0 },
  cursorLeft: { type: Number, default: 0 },
})

const emit = defineEmits(["submit", "cancel", "accept", "reject"])

const inputRef = ref(null)
const instruction = ref("")

const positionStyle = computed(() => {
  if (!props.cursorTop && !props.cursorLeft) return {}
  return {
    position: 'absolute',
    top: `${props.cursorTop}px`,
    left: `${Math.max(props.cursorLeft - 40, 0)}px`,
    right: 'auto',
    width: 'min(520px, calc(100% - 40px))',
  }
})

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    instruction.value = ""
    nextTick(() => inputRef.value?.focus())
  },
)

function submit() {
  if (!instruction.value.trim() || props.busy) return
  emit("submit", instruction.value.trim())
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    if (props.status === "done") emit("reject")
    else emit("cancel")
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y" && props.status === "done") {
    event.preventDefault()
    emit("accept")
  }
}
</script>

<style scoped>
.inline-edit-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  background: var(--bg-elevated);
  border: 1px solid var(--border-bright);
  border-radius: 8px;
  padding: 8px 12px 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px);
}

.inline-edit-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ie-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-dim);
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.ie-input {
  flex: 1;
  background: var(--bg-dark);
  border: 1px solid var(--border-bright);
  border-radius: 6px;
  padding: 6px 10px;
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  font-family: inherit;
}

.ie-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-dim);
}

.ie-input:disabled {
  opacity: 0.4;
}

.ie-model {
  font-size: 10px;
  color: var(--orange);
  background: rgba(251, 146, 60, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}

.ie-btn {
  min-width: 30px;
  height: 28px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  padding: 0 10px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ie-btn-apply {
  background: var(--accent);
  color: #0d0e10;
}

.ie-btn-apply:hover:not(:disabled) {
  background: #5eead4;
}

.ie-btn-apply:disabled {
  background: var(--bg-hover);
  color: var(--text-muted);
  cursor: not-allowed;
}

.ie-btn-stop {
  background: rgba(248, 113, 113, 0.2);
  color: var(--red);
}

.ie-review {
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  max-height: 80px;
  overflow-y: auto;
}

.ie-review pre {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}

.ie-status {
  font-size: 11px;
  color: var(--text-secondary);
  padding: 2px 4px;
}

.ie-status.model,
.ie-status.generating {
  color: var(--orange);
}

.ie-status.done {
  color: var(--green);
}

.ie-status.error {
  color: var(--red);
}

.ie-done {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ie-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: background 0.12s;
}

.ie-accept {
  background: rgba(45, 212, 191, 0.15);
  color: var(--accent);
}
.ie-accept:hover {
  background: rgba(45, 212, 191, 0.25);
}

.ie-reject {
  background: rgba(248, 113, 113, 0.12);
  color: var(--red);
}
.ie-reject:hover {
  background: rgba(248, 113, 113, 0.22);
}

.ie-hint {
  color: var(--text-muted);
  font-size: 10px;
  margin-left: 4px;
}
</style>
