<template>
  <div class="settings-json-panel">
    <div class="settings-row settings-row-stack">
      <div class="settings-row-info">
        <div class="settings-row-title">设置 JSON</div>
        <div class="settings-row-desc">
          使用 VS Code 风格 key 查看、导入和导出 Codek 设置。未接入的 Cursor / VS Code key 会被保留，不会静默丢失。
        </div>
      </div>

      <CodekTextarea
        v-model="settingsJsonText"
        class="settings-json-textarea"
        variant="code"
        :spellcheck="false"
        aria-label="设置 JSON"
      />

      <div class="settings-json-actions">
        <button class="settings-btn" type="button" data-testid="settings-json-refresh" @click="refreshJson">刷新</button>
        <button class="settings-btn" type="button" data-testid="settings-json-import" @click="importJson">导入当前 JSON</button>
        <button class="settings-btn" type="button" data-testid="settings-json-export" @click="exportJson">导出当前设置</button>
        <button class="settings-btn danger" type="button" data-testid="settings-json-reset" @click="resetUserSettings">重置用户设置</button>
      </div>

      <div v-if="statusMessage" class="settings-json-status" :class="statusKind">
        {{ statusMessage }}
      </div>
    </div>

    <div class="settings-row">
      <div class="settings-row-info">
        <div class="settings-row-title">导入 VS Code / Cursor 设置</div>
        <div class="settings-row-desc">
          将 `settings.json` 内容粘贴到上方编辑区后导入；已支持的 key 会立即写入统一设置源，未知 key 会进入保留区。
        </div>
      </div>
      <span class="settings-pill">已接入</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue"
import CodekTextarea from "./settings-controls/CodekTextarea.vue"
import { importSettingsJson, stringifySettingsJson } from "../settings/settingsJson"
import { settingsStore } from "../settings/settingsStore"
import { readUserSettingsFile, writeUserSettingsFile } from "../settings/settingsFileClient"

type StatusKind = "ok" | "err" | "info"

const settingsJsonText = ref(stringifySettingsJson(settingsStore.exportSettings()))
const statusMessage = ref("")
const statusKind = ref<StatusKind>("info")
const settingsFilePath = ref("")

function setStatus(kind: StatusKind, message: string): void {
  statusKind.value = kind
  statusMessage.value = message
}

function refreshJson(): void {
  settingsJsonText.value = stringifySettingsJson(settingsStore.exportSettings())
  setStatus("info", "已刷新当前设置 JSON。")
}

async function loadSettingsFile(): Promise<void> {
  try {
    const file = await readUserSettingsFile()
    settingsFilePath.value = file.path
    settingsStore.replaceUserSettingsFromExternal(file.settings)
    settingsJsonText.value = stringifySettingsJson(settingsStore.exportSettings())
    setStatus("info", `已加载 ${file.path}`)
  } catch {
    settingsJsonText.value = stringifySettingsJson(settingsStore.exportSettings())
    setStatus("info", "桌面 settings 文件暂不可用，已使用本地设置。")
  }
}

async function exportJson(): Promise<void> {
  settingsJsonText.value = stringifySettingsJson(settingsStore.exportSettings())
  try {
    const file = await writeUserSettingsFile(settingsStore.exportUserSettings())
    settingsFilePath.value = file.path
    setStatus("ok", `已导出当前设置到 ${file.path}`)
  } catch {
    setStatus("ok", "已导出当前设置到编辑区。")
  }
}

async function importJson(): Promise<void> {
  const result = importSettingsJson(settingsJsonText.value, "user", settingsStore)
  if (!result.ok) {
    setStatus("err", result.error || "导入失败，请检查 JSON 格式。")
    return
  }

  const appliedCount = Object.keys(result.applied).length
  const unknownCount = Object.keys(result.unknown).length
  settingsJsonText.value = stringifySettingsJson(settingsStore.exportSettings())
  try {
    const file = await writeUserSettingsFile(settingsStore.exportUserSettings())
    settingsFilePath.value = file.path
    setStatus("ok", `已应用 ${appliedCount} 项，保留 ${unknownCount} 项未接入设置，并写入 ${file.path}`)
  } catch {
    setStatus("ok", `已应用 ${appliedCount} 项，保留 ${unknownCount} 项未接入设置。`)
  }
}

async function resetUserSettings(): Promise<void> {
  settingsStore.reset("user")
  settingsJsonText.value = stringifySettingsJson(settingsStore.exportSettings())
  try {
    const file = await writeUserSettingsFile(settingsStore.exportUserSettings())
    settingsFilePath.value = file.path
    setStatus("ok", `已重置用户级设置，并写入 ${file.path}`)
  } catch {
    setStatus("ok", "已重置用户级设置，工作区设置不会被清除。")
  }
}

onMounted(() => {
  void loadSettingsFile()
})
</script>

<style scoped>
.settings-json-panel {
  display: grid;
  gap: 12px;
}

.settings-json-textarea {
  min-height: 240px;
}

.settings-json-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.settings-btn.danger {
  border-color: rgba(248, 113, 113, 0.45);
  color: #fecaca;
}

.settings-json-status {
  font-size: 12px;
  line-height: 1.5;
}

.settings-json-status.ok {
  color: #86efac;
}

.settings-json-status.err {
  color: #fca5a5;
}

.settings-json-status.info {
  color: var(--text-muted, #94a3b8);
}
</style>
