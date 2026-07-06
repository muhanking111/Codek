<template>
  <div class="chat-attachment">
    <input
      ref="fileInputRef"
      class="attachment-input"
      type="file"
      multiple
      accept="image/*,.txt,.md,.json,.ts,.tsx,.js,.jsx,.vue,.css,.html,.py"
      @change="handleChange"
    />
    <button class="attachment-btn" type="button" title="添加文件或图片" :disabled="busy" @click="fileInputRef?.click()">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83l8.49-8.48" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { readChatAttachment, type ChatAttachment } from "./chatAttachments"

const emit = defineEmits<{
  attach: [files: ChatAttachment[]]
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const busy = ref(false)

async function handleChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const selected = Array.from(input.files || [])
  if (selected.length === 0) return

  busy.value = true
  try {
    const files = await Promise.all(selected.map((file) => readChatAttachment(file)))
    if (files.length > 0) emit("attach", files)
  } finally {
    input.value = ""
    busy.value = false
  }
}
</script>

<style scoped>
.chat-attachment {
  flex: 0 0 auto;
}

.attachment-input {
  display: none;
}

.attachment-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.attachment-btn:hover {
  background: var(--bg-hover);
  color: var(--text-bright);
}

.attachment-btn:disabled {
  cursor: wait;
  opacity: 0.55;
}
</style>
