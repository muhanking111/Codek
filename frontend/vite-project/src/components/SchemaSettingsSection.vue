<template>
  <div class="schema-settings-section">
    <div
      v-for="setting in settings"
      :key="setting.key"
      class="settings-row"
      :class="{ 'settings-row-stack': setting.control === 'json' || setting.control === 'textarea' }"
    >
      <div class="settings-row-info">
        <div class="settings-row-title">
          {{ setting.title }}
        </div>
        <div class="settings-row-desc">{{ setting.description }}</div>
      </div>

      <div v-if="setting.status === 'planned'" class="settings-row-control">
        <span class="settings-pill alt">计划中</span>
      </div>
      <div v-else-if="setting.status === 'requires-vscode-service'" class="settings-row-control">
        <span class="settings-pill alt">需要 VS Code 服务</span>
      </div>
      <div v-else class="settings-row-control">
        <button
          v-if="setting.control === 'boolean'"
          class="schema-settings-toggle"
          :class="{ active: Boolean(getValue(setting.key)) }"
          type="button"
          role="switch"
          :aria-checked="Boolean(getValue(setting.key))"
          :aria-label="setting.title"
          :title="Boolean(getValue(setting.key)) ? '已开启' : '已关闭'"
          @click="setValue(setting, !Boolean(getValue(setting.key)))"
        >
          <span class="schema-settings-toggle-track" aria-hidden="true">
            <span class="schema-settings-toggle-knob" />
          </span>
          <span class="schema-settings-toggle-label">
            {{ Boolean(getValue(setting.key)) ? "开启" : "关闭" }}
          </span>
        </button>

        <CodekInput
          v-else-if="setting.control === 'number'"
          class="schema-settings-input"
          variant="number"
          :model-value="String(getValue(setting.key) ?? '')"
          @change="setValue(setting, Number($event))"
        />

        <CodekInput
          v-else-if="setting.control === 'text' || setting.control === 'password'"
          class="schema-settings-input"
          :variant="setting.control === 'password' ? 'secret' : 'default'"
          :model-value="String(getValue(setting.key) ?? '')"
          @change="setValue(setting, $event)"
        />

        <CodekSelect
          v-else-if="setting.control === 'select'"
          :model-value="String(getValue(setting.key) ?? '')"
          :options="(setting.options || []).map((option) => ({ value: String(option.value), label: option.label }))"
          @change="setValue(setting, $event)"
        />

        <CodekTextarea
          v-else-if="setting.control === 'json' || setting.control === 'textarea'"
          :variant="setting.control === 'json' ? 'code' : 'default'"
          :model-value="formatSettingValue(getValue(setting.key))"
          :spellcheck="false"
          @change="setJsonValue(setting.key, $event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue"
import CodekInput from "./settings-controls/CodekInput.vue"
import CodekSelect from "./settings-controls/CodekSelect.vue"
import CodekTextarea from "./settings-controls/CodekTextarea.vue"
import { getSettingsByGroup, type SettingDefinition } from "../settings/settingsSchema"
import { settingsStore } from "../settings/settingsStore"

const props = defineProps<{
  group: string
}>()

const settings = computed<SettingDefinition[]>(() => getSettingsByGroup(props.group))
const snapshot = ref(settingsStore.getAll())
const unsubscribe = settingsStore.subscribe((settings) => {
  snapshot.value = settings
})

onUnmounted(unsubscribe)

function getValue(key: string): unknown {
  return snapshot.value[key]
}

function resolveWriteScope(setting: SettingDefinition): "user" | "workspace" {
  const workspaceSettings = settingsStore.getWorkspaceSettings()
  if (Object.prototype.hasOwnProperty.call(workspaceSettings, setting.key)) return "workspace"
  if (setting.scope.includes("workspace") && !setting.scope.includes("user")) return "workspace"
  return "user"
}

function setValue(setting: SettingDefinition, value: unknown): void {
  settingsStore.set(setting.key, value, resolveWriteScope(setting))
  snapshot.value = settingsStore.getAll()
}

function setJsonValue(key: string, value: string): void {
  const setting = settings.value.find((item) => item.key === key)
  if (!setting) return
  try {
    setValue(setting, JSON.parse(value))
  } catch {
    setValue(setting, value)
  }
}

function formatSettingValue(value: unknown): string {
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2)
}
</script>

<style scoped>
.schema-settings-section {
  display: grid;
  gap: 10px;
}

.schema-settings-input {
  min-width: 220px;
}

.schema-settings-toggle {
  min-width: 86px;
  height: 32px;
  padding: 0 10px 0 6px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 999px;
  background: var(--setting-control-bg, var(--bg-elevated));
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  line-height: 1;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.schema-settings-toggle:hover {
  border-color: rgba(148, 163, 184, 0.34);
  background: var(--setting-control-bg-hover, var(--bg-hover));
  color: var(--text-primary);
}

.schema-settings-toggle:focus-visible {
  outline: none;
  border-color: rgba(45, 212, 191, 0.55);
  box-shadow: 0 0 0 2px rgba(45, 212, 191, 0.16);
}

.schema-settings-toggle.active {
  border-color: rgba(45, 212, 191, 0.44);
  background: rgba(45, 212, 191, 0.12);
  color: var(--text-primary);
}

.schema-settings-toggle-track {
  position: relative;
  width: 30px;
  height: 18px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.24);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.2);
  flex: 0 0 auto;
  transition:
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.schema-settings-toggle-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #cbd5e1;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.28);
  transition:
    transform 0.15s ease,
    background 0.15s ease;
}

.schema-settings-toggle.active .schema-settings-toggle-track {
  background: rgba(45, 212, 191, 0.34);
  box-shadow: inset 0 0 0 1px rgba(45, 212, 191, 0.48);
}

.schema-settings-toggle.active .schema-settings-toggle-knob {
  transform: translateX(12px);
  background: #5eead4;
}

.schema-settings-toggle-label {
  min-width: 24px;
  text-align: right;
  white-space: nowrap;
}
</style>
