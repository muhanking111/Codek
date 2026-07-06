<template>
  <div v-if="visible" class="notepads-panel">
    <div class="notepads-toolbar">
      <span class="notepads-title">便笺</span>
      <div class="notepads-actions">
        <button class="np-btn" @click="handleCreate" title="新建便笺">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button class="np-btn" @click="$emit('close')" title="关闭">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <div class="notepads-list">
      <button
        v-for="np in notepadState.notepads"
        :key="np.id"
        class="notepad-item"
        :class="{ active: selectedId === np.id }"
        @click="selectNotepad(np.id)"
      >
        <div class="notepad-item-info">
          <span class="notepad-item-title">{{ np.title || '未命名' }}</span>
          <span class="notepad-item-date">{{ formatDate(np.updatedAt) }}</span>
        </div>
        <button
          class="notepad-item-delete"
          @click.stop="handleDelete(np.id)"
          title="删除"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </button>

      <div v-if="notepadState.notepads.length === 0" class="notepads-empty">
        <span>还没有便笺</span>
        <button class="np-create-hint" @click="handleCreate">新建第一条便笺</button>
      </div>
    </div>

    <div v-if="selectedNotepad" class="notepad-editor">
      <div class="notepad-editor-header">
        <input
          v-model="editingTitle"
          class="notepad-title-input"
          placeholder="便笺标题..."
          @input="handleTitleChange"
        />
        <span class="notepad-editor-meta">
          {{ formatFullDate(selectedNotepad.createdAt) }}
        </span>
      </div>
      <textarea
        ref="contentRef"
        v-model="editingContent"
        class="notepad-content-input"
        placeholder="写下 Markdown 内容..."
        @input="handleContentChange"
      />
    </div>

    <div v-else class="notepads-select-hint">
      <span>选择一条便笺查看或编辑</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { Notepad } from './notepadState'
import { notepadState, loadNotepads, createNotepad, deleteNotepad } from './notepadState'

defineProps<{
  visible: boolean
}>()

defineEmits<{
  close: []
}>()

const selectedId = ref<string | null>(null)
const editingTitle = ref('')
const editingContent = ref('')
let saveTimer: ReturnType<typeof setTimeout> | null = null

const selectedNotepad = computed<Notepad | null>(() => {
  if (!selectedId.value) return null
  return notepadState.notepads.find((n) => n.id === selectedId.value) || null
})

function selectNotepad(id: string): void {
  selectedId.value = id
  const np = notepadState.notepads.find((n) => n.id === id)
  if (np) {
    editingTitle.value = np.title
    editingContent.value = np.content
  }
}

function handleCreate(): void {
  const np = createNotepad('新建便笺')
  selectedId.value = np.id
  editingTitle.value = np.title
  editingContent.value = np.content
}

function handleDelete(id: string): void {
  deleteNotepad(id)
  if (selectedId.value === id) {
    selectedId.value = null
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (selectedId.value && selectedNotepad.value) {
      const changed =
        editingTitle.value !== selectedNotepad.value.title ||
        editingContent.value !== selectedNotepad.value.content
      if (changed) {
        notepadState.notepads = notepadState.notepads.map((n) =>
          n.id === selectedId.value
            ? {
                ...n,
                title: editingTitle.value,
                content: editingContent.value,
                updatedAt: Date.now(),
              }
            : n,
        )
        const STORAGE_KEY = 'codek.notepads.v1'
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(notepadState.notepads))
        } catch {
          // ignore
        }
      }
    }
  }, 400)
}

function handleTitleChange(): void {
  scheduleSave()
}

function handleContentChange(): void {
  scheduleSave()
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()

  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatFullDate(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

watch(
  () => selectedNotepad.value?.updatedAt,
  () => {
    if (selectedNotepad.value) {
      editingTitle.value = selectedNotepad.value.title
      editingContent.value = selectedNotepad.value.content
    }
  },
)

onMounted(() => {
  loadNotepads()
})
</script>

<style scoped>
.notepads-panel {
  position: fixed;
  left: 48px;
  right: 0;
  bottom: 24px;
  height: 260px;
  max-height: 50vh;
  z-index: 40;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-top: 1px solid var(--border-subtle);
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.35);
  font-family: var(--font-sans);
}

.notepads-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 14px;
  height: 36px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.notepads-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.notepads-actions {
  display: flex;
  gap: 2px;
}

.np-btn {
  width: 26px;
  height: 26px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.np-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.notepads-list {
  flex-shrink: 0;
  max-height: 200px;
  overflow-y: auto;
  border-bottom: 1px solid var(--border-subtle);
}

.notepad-item {
  width: 100%;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: background 0.1s;
  text-align: left;
}

.notepad-item:hover {
  background: var(--bg-hover);
}

.notepad-item.active {
  background: var(--bg-active);
}

.notepad-item-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.notepad-item-title {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.notepad-item-date {
  font-size: 10px;
  color: var(--text-muted);
}

.notepad-item-delete {
  width: 20px;
  height: 20px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.notepad-item:hover .notepad-item-delete {
  opacity: 1;
}

.notepad-item-delete:hover {
  color: var(--red);
  background: rgba(248, 113, 113, 0.12);
}

.notepads-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 16px;
  color: var(--text-muted);
  font-size: 12px;
}

.np-create-hint {
  background: none;
  border: 1px dashed var(--border);
  border-radius: 6px;
  color: var(--accent);
  font-size: 11px;
  padding: 4px 12px;
  cursor: pointer;
}

.np-create-hint:hover {
  border-color: var(--accent);
  background: rgba(45, 212, 191, 0.06);
}

.notepad-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.notepad-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 6px;
  gap: 8px;
  flex-shrink: 0;
}

.notepad-title-input {
  flex: 1;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  font-family: var(--font-sans);
  padding: 2px 0;
  outline: none;
}

.notepad-title-input:focus {
  border-bottom-color: var(--accent);
}

.notepad-title-input::placeholder {
  color: var(--text-muted);
  font-weight: 400;
}

.notepad-editor-meta {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.notepad-content-input {
  flex: 1;
  min-height: 300px;
  background: transparent;
  border: none;
  padding: 8px 14px;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.6;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  resize: none;
  outline: none;
}

.notepad-content-input::placeholder {
  color: var(--text-muted);
  font-family: var(--font-sans);
}

.notepads-select-hint {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
}
</style>
