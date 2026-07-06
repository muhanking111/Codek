<template>
  <div class="automation-panel">
    <div class="ap-header">
      <span class="ap-title">{{ t('automation.title') }}</span>
      <button class="ap-add-btn" @click="showAddForm = !showAddForm">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        {{ t('automation.add') }}
      </button>
    </div>

    <!-- Add form -->
    <div v-if="showAddForm" class="ap-form">
      <input v-model="form.name" class="ap-input" :placeholder="t('automation.namePlaceholder')" />
      <select v-model="form.triggerType" class="ap-select">
        <option value="interval">{{ t('automation.interval') }}</option>
        <option value="onFileSave">{{ t('automation.onFileSave') }}</option>
        <option value="onGitCommit">{{ t('automation.onGitCommit') }}</option>
      </select>
      <input v-if="form.triggerType === 'interval'" v-model.number="form.intervalMinutes" type="number" class="ap-input" min="1" :placeholder="t('automation.minutesPlaceholder')" />
      <input v-if="form.triggerType === 'onFileSave'" v-model="form.filePattern" class="ap-input" :placeholder="t('automation.patternPlaceholder')" />
      <select v-model="form.actionType" class="ap-select">
        <option value="runCommand">{{ t('automation.runCommand') }}</option>
        <option value="runAgent">{{ t('automation.runAgent') }}</option>
      </select>
      <textarea v-model="form.actionValue" class="ap-textarea" rows="2" :placeholder="t('automation.actionPlaceholder')"></textarea>
      <div class="ap-form-actions">
        <button class="ap-cancel-btn" @click="showAddForm = false">{{ t('automation.cancel') }}</button>
        <button class="ap-save-btn" @click="saveAutomation">{{ t('automation.save') }}</button>
      </div>
    </div>

    <!-- List -->
    <div v-if="items.length === 0" class="ap-empty">
      <p>{{ t('automation.empty') }}</p>
    </div>
    <div v-for="item in items" :key="item.id" class="ap-item" :class="{ disabled: !item.enabled }">
      <div class="ap-item-header">
        <span class="ap-item-name">{{ item.name }}</span>
        <span class="ap-item-trigger">{{ triggerLabel(item) }}</span>
      </div>
      <div class="ap-item-actions">
        <button class="ap-toggle-btn" :class="{ active: item.enabled }" @click="handleToggle(item.id)">
          {{ item.enabled ? t('automation.enabled') : t('automation.disabled') }}
        </button>
        <button class="ap-delete-btn" @click="handleDelete(item.id)">{{ t('automation.delete') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue"
import { useI18n } from "../i18n/index"
import {
  getAutomations,
  addAutomation,
  deleteAutomation,
  toggleAutomation,
  startAll,
  stopAll,
  triggerOnFileSave,
  triggerOnGitCommit,
  setAutomationRunner,
  type Automation,
} from "../automation/automationManager"

const { t } = useI18n()

const items = ref<Automation[]>([])
const showAddForm = ref(false)
const form = ref({
  name: "",
  triggerType: "interval" as string,
  intervalMinutes: 30,
  filePattern: "",
  actionType: "runCommand" as string,
  actionValue: "",
})

function triggerLabel(item: Automation): string {
  switch (item.trigger.type) {
    case "interval": return `每 ${item.trigger.minutes} 分钟`
    case "onFileSave": return `文件保存时${item.trigger.pattern ? ` (${item.trigger.pattern})` : ""}`
    case "onGitCommit": return "Git 提交时"
    default: return ""
  }
}

function refresh() {
  items.value = getAutomations()
}

function saveAutomation() {
  if (!form.value.name.trim() || !form.value.actionValue.trim()) return
  addAutomation({
    name: form.value.name.trim(),
    description: "",
    enabled: true,
    trigger: form.value.triggerType === "interval"
      ? { type: "interval", minutes: form.value.intervalMinutes || 30 }
      : form.value.triggerType === "onFileSave"
        ? { type: "onFileSave", pattern: form.value.filePattern || undefined }
        : { type: "onGitCommit" },
    action: form.value.actionType === "runCommand"
      ? { type: "runCommand", command: form.value.actionValue }
      : { type: "runAgent", prompt: form.value.actionValue },
  })
  form.value = { name: "", triggerType: "interval", intervalMinutes: 30, filePattern: "", actionType: "runCommand", actionValue: "" }
  showAddForm.value = false
  refresh()
}

function handleToggle(id: string) {
  toggleAutomation(id)
  refresh()
}

function handleDelete(id: string) {
  deleteAutomation(id)
  refresh()
}

// Set up the default runner
setAutomationRunner(async (auto) => {
  if (auto.action.type === "runCommand") {
    const api = (window as unknown as { codek?: { runCommand?: (cmd: string) => Promise<unknown> } }).codek
    if (api?.runCommand) {
      await api.runCommand(auto.action.command)
    }
  }
  // runAgent type would need agent access — call via event
  window.dispatchEvent(new CustomEvent("codek:automation", { detail: auto }))
})

onMounted(() => {
  startAll()
  refresh()
})

onBeforeUnmount(() => {
  stopAll()
})
</script>

<style scoped>
.automation-panel {
  padding: 12px;
  font-size: 13px;
}
.ap-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.ap-title { font-weight: 600; color: var(--text-primary); }
.ap-add-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
}
.ap-add-btn:hover { background: rgba(99, 102, 241, 0.1); }
.ap-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--bg-elevated);
  border-radius: 8px;
  margin-bottom: 12px;
}
.ap-input, .ap-select, .ap-textarea {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text-primary);
  font-size: 12px;
}
.ap-textarea { resize: vertical; }
.ap-form-actions { display: flex; gap: 8px; justify-content: flex-end; }
.ap-cancel-btn, .ap-save-btn {
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  cursor: pointer;
  font-size: 12px;
}
.ap-cancel-btn { background: transparent; color: var(--text-secondary); }
.ap-save-btn { background: var(--accent); color: #fff; border-color: var(--accent); }
.ap-empty { text-align: center; color: var(--text-muted); padding: 24px; }
.ap-item {
  padding: 10px;
  background: var(--bg-elevated);
  border-radius: 8px;
  margin-bottom: 8px;
}
.ap-item.disabled { opacity: 0.5; }
.ap-item-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
.ap-item-name { font-weight: 500; color: var(--text-primary); }
.ap-item-trigger { font-size: 11px; color: var(--text-muted); }
.ap-item-actions { display: flex; gap: 6px; }
.ap-toggle-btn, .ap-delete-btn {
  padding: 3px 10px;
  border-radius: 5px;
  border: 1px solid var(--border);
  cursor: pointer;
  font-size: 11px;
}
.ap-toggle-btn.active { background: #10b981; color: #fff; border-color: #10b981; }
.ap-toggle-btn { background: transparent; color: var(--text-secondary); }
.ap-delete-btn { background: transparent; color: #ef4444; border-color: #ef4444; }
</style>
