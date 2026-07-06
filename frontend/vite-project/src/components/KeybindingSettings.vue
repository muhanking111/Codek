<template>
  <div class="keybinding-settings">
    <div class="kb-header">
      <div class="kb-search-wrap">
        <input
          v-model="searchQuery"
          class="kb-search"
          type="text"
          placeholder="搜索快捷键..."
        />
      </div>
      <button class="kb-reset-all" @click="handleReloadFile">重新读取文件</button>
      <button class="kb-reset-all" @click="handleExportJson">写入 keybindings.json</button>
      <button class="kb-reset-all" @click="handleResetAll">全部重置</button>
    </div>

    <section class="kb-json-panel">
      <div class="kb-json-toolbar">
        <div>
          <h3>keybindings.json</h3>
          <p>兼容 VS Code / Cursor 数组格式，支持 key、command、when 字段。</p>
          <p v-if="filePath" class="kb-json-path">当前文件：{{ filePath }}</p>
        </div>
        <button class="kb-action-btn" data-testid="keybindings-json-import" @click="handleImportJson">导入并写入文件</button>
      </div>
      <textarea
        v-model="jsonText"
        class="kb-json-textarea"
        spellcheck="false"
        placeholder='[
  { "key": "ctrl+s", "command": "workbench.action.files.save" }
]'
      />
      <div v-if="jsonStatus || jsonError || importReport" class="kb-json-status">
        <span v-if="jsonStatus" class="kb-json-ok">{{ jsonStatus }}</span>
        <span v-if="jsonError" class="kb-json-error">{{ jsonError }}</span>
        <template v-if="importReport">
          <span>已应用 {{ importReport.applied.length }} 项</span>
          <span>未接入 {{ importReport.unknown.length }} 项</span>
          <span>无效 {{ importReport.invalid.length }} 项</span>
        </template>
      </div>
      <div v-if="unknownBindings.length > 0" class="kb-unknown-list">
        <div class="kb-unknown-title">未接入命令</div>
        <div v-for="binding in unknownBindings" :key="binding.command" class="kb-unknown-row">
          <code>{{ binding.command }}</code>
          <span>{{ binding.key }}</span>
          <small v-if="binding.when">when: {{ binding.when }}</small>
        </div>
      </div>
    </section>

    <div class="kb-table-wrap">
      <table class="kb-table">
        <thead>
          <tr>
            <th>命令</th>
            <th>快捷键</th>
            <th>默认</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in filteredBindings"
            :key="entry.id"
            :class="{ 'kb-conflict': entry.conflict }"
          >
            <td class="kb-cmd-cell">
              <span class="kb-cmd-name">{{ entry.description }}</span>
              <span class="kb-cmd-id">{{ entry.id }}</span>
              <span v-if="entry.when" class="kb-cmd-when">when: {{ entry.when }}</span>
            </td>
            <td class="kb-key-cell">
              <button
                class="kb-key-btn"
                :class="{ recording: recordingId === entry.id }"
                @click="startRecording(entry.id)"
              >
                <template v-if="recordingId === entry.id">
                  <span class="kb-recording-dot" />
                  {{ recordingPreview || "按下快捷键..." }}
                </template>
                <template v-else>{{ formatKeybinding(entry.current) }}</template>
              </button>
              <span v-if="entry.conflict" class="kb-conflict-badge">
                冲突: {{ entry.conflictWith }}
              </span>
            </td>
            <td class="kb-default-cell">
              <span :class="{ 'kb-differs': entry.isOverridden }">
                {{ formatKeybinding(entry.default) }}
              </span>
            </td>
            <td class="kb-action-cell">
              <button
                v-if="entry.isOverridden"
                class="kb-action-btn"
                @click="handleReset(entry.id)"
              >重置</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue"
import {
  getRegisteredKeybindings,
  getDefaultKeybinding,
  overrideKeybinding,
  resetKeybinding,
  resetAllKeybindings,
  findConflictingKeybindings,
  formatKeybinding as formatKb,
  loadOverriddenKeybindings,
  type KeybindingOverride,
} from "../keybindings"
import {
  exportKeybindingsJsonText,
  exportKeybindingsJson,
  getStoredUnknownKeybindings,
  getStoredWhenClauses,
  importKeybindingsJson,
  replaceKeybindingsJson,
  type KeybindingsJsonImportResult,
  type VsCodeKeybindingEntry,
} from "../settings/keybindingsJson"
import {
  readUserKeybindingsFile,
  writeUserKeybindingsFile,
} from "../settings/keybindingsFileClient"

interface KeybindingEntry {
  id: string
  description: string
  current: KeybindingOverride
  default: KeybindingOverride
  when?: string
  isOverridden: boolean
  conflict: boolean
  conflictWith: string
}

const searchQuery = ref("")
const recordingId = ref<string | null>(null)
const recordingPreview = ref("")
const entries = ref<KeybindingEntry[]>([])
const jsonText = ref("")
const jsonStatus = ref("")
const jsonError = ref("")
const importReport = ref<KeybindingsJsonImportResult | null>(null)
const unknownBindings = ref<VsCodeKeybindingEntry[]>([])
const filePath = ref("")

function refreshEntries(): void {
  const bindings = getRegisteredKeybindings()
  const whenClauses = getStoredWhenClauses()
  const result: KeybindingEntry[] = []
  for (const kb of bindings) {
    const defaultKb = getDefaultKeybinding(kb.id)
    const current: KeybindingOverride = { key: kb.key, ctrl: kb.ctrl, shift: kb.shift, alt: kb.alt }
    const def: KeybindingOverride = defaultKb ?? { key: kb.key, ctrl: kb.ctrl, shift: kb.shift, alt: kb.alt }
    const isOverridden = current.key !== def.key || current.ctrl !== def.ctrl || current.shift !== def.shift || current.alt !== def.alt
    const conflicts = findConflictingKeybindings(kb.id, current)
    result.push({
      id: kb.id,
      description: kb.description,
      current,
      default: def,
      when: whenClauses[kb.id],
      isOverridden,
      conflict: conflicts.length > 0,
      conflictWith: conflicts.length > 0 ? conflicts[0].description : "",
    })
  }
  entries.value = result
  unknownBindings.value = getStoredUnknownKeybindings()
}

const filteredBindings = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return entries.value
  return entries.value.filter(
    (e) =>
      e.description.toLowerCase().includes(q) ||
      e.id.toLowerCase().includes(q) ||
      formatKb(e.current).toLowerCase().includes(q),
  )
})

function formatKeybinding(kb: KeybindingOverride): string {
  return formatKb(kb)
}

function startRecording(commandId: string): void {
  if (recordingId.value === commandId) {
    recordingId.value = null
    recordingPreview.value = ""
    return
  }
  recordingId.value = commandId
  recordingPreview.value = ""
}

function handleKeyCapture(event: KeyboardEvent): void {
  if (recordingId.value === null) return

  const ignoredKeys = new Set(["Control", "Shift", "Alt", "Meta"])
  if (ignoredKeys.has(event.key)) {
    const parts: string[] = []
    if (event.ctrlKey || event.metaKey) parts.push("Ctrl")
    if (event.shiftKey) parts.push("Shift")
    if (event.altKey) parts.push("Alt")
    recordingPreview.value = parts.join("+") + "+..."
    event.preventDefault()
    return
  }

  event.preventDefault()
  event.stopPropagation()

  const newKey: KeybindingOverride = {
    key: event.key.toLowerCase(),
    ctrl: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  }

  overrideKeybinding(recordingId.value, newKey)
  recordingId.value = null
  recordingPreview.value = ""
  refreshEntries()
  syncKeybindingsFile("已更新快捷键，并写入 keybindings.json。")
}

function handleReset(commandId: string): void {
  resetKeybinding(commandId)
  refreshEntries()
  syncKeybindingsFile("已重置快捷键，并写入 keybindings.json。")
}

function handleResetAll(): void {
  resetAllKeybindings()
  refreshEntries()
  syncKeybindingsFile("已全部重置，并写入 keybindings.json。")
}

async function handleExportJson(): Promise<void> {
  jsonText.value = exportKeybindingsJsonText()
  jsonError.value = ""
  importReport.value = null
  await syncKeybindingsFile("已写入当前快捷键到 keybindings.json。")
}

async function handleImportJson(): Promise<void> {
  jsonStatus.value = ""
  jsonError.value = ""
  importReport.value = null
  try {
    const result = importKeybindingsJson(jsonText.value)
    importReport.value = result
    refreshEntries()
    await syncKeybindingsFile("导入完成，并已写入 keybindings.json。")
  } catch (error) {
    jsonError.value = error instanceof Error ? error.message : "导入失败，请检查 JSON 格式。"
  }
}

async function handleReloadFile(): Promise<void> {
  await loadKeybindingsFile()
}

async function loadKeybindingsFile(): Promise<void> {
  jsonStatus.value = ""
  jsonError.value = ""
  importReport.value = null
  try {
    const file = await readUserKeybindingsFile()
    filePath.value = file.path
    jsonText.value = JSON.stringify(file.keybindings, null, 2)
    if (file.keybindings.length > 0) {
      importReport.value = replaceKeybindingsJson(file.keybindings)
      refreshEntries()
    } else {
      replaceKeybindingsJson([])
      refreshEntries()
    }
    jsonStatus.value = `已加载 ${file.path}`
  } catch (error) {
    jsonText.value = exportKeybindingsJsonText()
    jsonError.value = error instanceof Error ? error.message : "读取 keybindings.json 失败。"
  }
}

async function syncKeybindingsFile(successMessage: string): Promise<void> {
  jsonError.value = ""
  try {
    const file = await writeUserKeybindingsFile(exportKeybindingsJson())
    filePath.value = file.path
    jsonText.value = JSON.stringify(file.keybindings, null, 2)
    jsonStatus.value = successMessage
  } catch (error) {
    jsonError.value = error instanceof Error ? error.message : "写入 keybindings.json 失败。"
  }
}

onMounted(() => {
  loadOverriddenKeybindings()
  refreshEntries()
  void loadKeybindingsFile()
  window.addEventListener("keydown", handleKeyCapture, true)
})

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyCapture, true)
})
</script>

<style scoped>
.keybinding-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.kb-header {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.kb-search-wrap {
  flex: 1;
  min-width: 220px;
}

.kb-search {
  width: 100%;
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-primary);
  padding: 8px 10px;
  font-size: 12px;
  outline: none;
}

.kb-search:focus {
  border-color: var(--accent);
}

.kb-reset-all {
  border: 1px solid var(--border);
  background: var(--bg-dark);
  color: var(--text-secondary);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.kb-reset-all:hover {
  border-color: var(--border-bright);
  color: var(--text-primary);
}

.kb-table-wrap {
  flex: 0 1 auto;
  min-height: 0;
  overflow-x: auto;
}

.kb-json-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  padding: 10px;
}

.kb-json-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.kb-json-toolbar h3 {
  margin: 0 0 3px;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
}

.kb-json-toolbar p {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.kb-json-path {
  margin-top: 3px;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
}

.kb-json-textarea {
  width: 100%;
  min-height: 84px;
  resize: vertical;
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  padding: 8px 10px;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 11px;
  line-height: 1.5;
  outline: none;
}

.kb-json-textarea:focus {
  border-color: var(--accent);
}

.kb-json-status {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--text-muted);
  font-size: 11px;
}

.kb-json-ok {
  color: var(--green);
}

.kb-json-error {
  color: var(--red);
}

.kb-unknown-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  border-top: 1px solid var(--border-subtle);
  padding-top: 8px;
}

.kb-unknown-title {
  color: var(--orange);
  font-size: 11px;
  font-weight: 600;
}

.kb-unknown-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  color: var(--text-muted);
  font-size: 11px;
}

.kb-unknown-row code,
.kb-cmd-when {
  color: var(--text-muted);
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 10px;
}

.kb-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.kb-table th {
  text-align: left;
  padding: 8px 10px;
  color: var(--text-muted);
  font-weight: 500;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border-subtle);
  position: sticky;
  top: 0;
  background: var(--bg-panel);
  z-index: 1;
}

.kb-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-subtle);
  vertical-align: middle;
}

.kb-table tr.kb-conflict {
  background: rgba(248, 113, 113, 0.06);
}

.kb-cmd-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.kb-cmd-name {
  color: var(--text-primary);
  font-weight: 500;
}

.kb-cmd-id {
  color: var(--text-muted);
  font-size: 10px;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
}

.kb-key-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.kb-key-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 11px;
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 4px 8px;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.15s;
  min-width: 80px;
}

.kb-key-btn:hover {
  border-color: var(--border-bright);
}

.kb-key-btn.recording {
  border-color: var(--accent);
  background: var(--accent-dim);
  animation: pulse-border 1.2s ease infinite;
}

@keyframes pulse-border {
  0%, 100% { box-shadow: 0 0 0 0 var(--accent-dim); }
  50% { box-shadow: 0 0 0 3px var(--accent-dim); }
}

.kb-recording-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: blink 0.8s ease infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.kb-conflict-badge {
  font-size: 10px;
  color: var(--red);
  background: rgba(248, 113, 113, 0.1);
  padding: 1px 6px;
  border-radius: 4px;
}

.kb-default-cell {
  font-family: var(--font-mono, "JetBrains Mono", monospace);
  font-size: 11px;
  color: var(--text-muted);
}

.kb-differs {
  color: var(--orange);
}

.kb-action-cell {
  width: 60px;
}

.kb-action-btn {
  border: 1px solid var(--border);
  background: var(--bg-dark);
  color: var(--text-secondary);
  border-radius: 5px;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.kb-action-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
