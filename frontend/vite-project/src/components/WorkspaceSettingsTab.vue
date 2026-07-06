<template>
  <div class="ws-settings">
    <section class="ws-section">
      <div class="ws-title">编辑器</div>

      <label class="ws-field">
        <span class="ws-label">Tab 大小</span>
        <CodekSelect
          :model-value="editor.tabSize"
          :options="[
            { value: 2, label: '2' },
            { value: 4, label: '4' },
            { value: 8, label: '8' },
          ]"
          @change="handleEditorChange('tabSize', Number($event))"
        />
      </label>

      <label class="ws-field">
        <span class="ws-label">字体大小：{{ editor.fontSize }}</span>
        <input
          class="ws-range"
          type="range"
          min="10"
          max="24"
          step="1"
          :value="editor.fontSize"
          @input="handleEditorChange('fontSize', toNumber($event))"
        />
      </label>

      <label class="ws-field">
        <span class="ws-label">字体族</span>
        <CodekInput
          :model-value="editor.fontFamily"
          monospace
          @change="handleEditorChange('fontFamily', $event)"
        />
      </label>

      <label class="ws-field">
        <span class="ws-label">自动换行</span>
        <CodekSelect
          :model-value="editor.wordWrap"
          :options="[
            { value: 'off', label: '关闭' },
            { value: 'on', label: '开启' },
            { value: 'wordWrapColumn', label: '按列换行' },
          ]"
          @change="handleEditorChange('wordWrap', $event)"
        />
      </label>

      <label class="ws-toggle-row">
        <span class="ws-toggle-label">保存时格式化</span>
        <button
          class="ws-toggle"
          :class="{ active: editor.formatOnSave }"
          @click="handleEditorChange('formatOnSave', !editor.formatOnSave)"
        >
          <span class="ws-toggle-knob" />
        </button>
      </label>

      <label class="ws-toggle-row">
        <span class="ws-toggle-label">保存时 Lint</span>
        <button
          class="ws-toggle"
          :class="{ active: editor.lintOnSave }"
          @click="handleEditorChange('lintOnSave', !editor.lintOnSave)"
        >
          <span class="ws-toggle-knob" />
        </button>
      </label>

      <label class="ws-toggle-row">
        <span class="ws-toggle-label">显示缩略图</span>
        <button
          class="ws-toggle"
          :class="{ active: editor.minimap }"
          @click="handleEditorChange('minimap', !editor.minimap)"
        >
          <span class="ws-toggle-knob" />
        </button>
      </label>

      <label class="ws-toggle-row">
        <span class="ws-toggle-label">括号对着色</span>
        <button
          class="ws-toggle"
          :class="{ active: editor.bracketPairColorization }"
          @click="handleEditorChange('bracketPairColorization', !editor.bracketPairColorization)"
        >
          <span class="ws-toggle-knob" />
        </button>
      </label>
    </section>

    <section class="ws-section">
      <div class="ws-title">文件</div>

      <label class="ws-field">
        <span class="ws-label">编码</span>
        <CodekSelect
          :model-value="files.encoding"
          :options="[
            { value: 'utf-8', label: 'UTF-8' },
            { value: 'gbk', label: 'GBK' },
            { value: 'shift_jis', label: 'Shift_JIS' },
            { value: 'iso-8859-1', label: 'ISO-8859-1' },
          ]"
          @change="handleFilesChange('encoding', $event)"
        />
      </label>

      <label class="ws-field">
        <span class="ws-label">行尾序列</span>
        <CodekSelect
          :model-value="files.eol"
          :options="[
            { value: 'auto', label: '自动' },
            { value: 'lf', label: 'LF' },
            { value: 'crlf', label: 'CRLF' },
          ]"
          @change="handleFilesChange('eol', $event)"
        />
      </label>

      <label class="ws-field">
        <span class="ws-label">自动保存</span>
        <CodekSelect
          :model-value="files.autoSave"
          :options="[
            { value: 'off', label: '关闭' },
            { value: 'afterDelay', label: '延迟后' },
            { value: 'onFocusChange', label: '失去焦点时' },
          ]"
          @change="handleFilesChange('autoSave', $event)"
        />
      </label>

      <label v-if="files.autoSave === 'afterDelay'" class="ws-field">
        <span class="ws-label">自动保存延迟：{{ files.autoSaveDelay }}ms</span>
        <input
          class="ws-range"
          type="range"
          min="200"
          max="5000"
          step="100"
          :value="files.autoSaveDelay"
          @input="handleFilesChange('autoSaveDelay', toNumber($event))"
        />
      </label>

      <label class="ws-field">
        <span class="ws-label">排除模式（逗号分隔）</span>
        <CodekInput
          :model-value="files.excludeGlob.join(', ')"
          monospace
          @change="handleFilesChange('excludeGlob', toStringList($event))"
        />
      </label>
    </section>

    <section class="ws-section">
      <div class="ws-title">搜索</div>

      <label class="ws-field">
        <span class="ws-label">包含模式（逗号分隔）</span>
        <CodekInput
          :model-value="search.includeGlob.join(', ')"
          monospace
          @change="handleSearchChange('includeGlob', toStringList($event))"
        />
      </label>

      <label class="ws-field">
        <span class="ws-label">排除模式（逗号分隔）</span>
        <CodekInput
          :model-value="search.excludeGlob.join(', ')"
          monospace
          @change="handleSearchChange('excludeGlob', toStringList($event))"
        />
      </label>
    </section>

    <section class="ws-section">
      <div class="ws-title">Git</div>

      <label class="ws-toggle-row">
        <span class="ws-toggle-label">自动暂存</span>
        <button
          class="ws-toggle"
          :class="{ active: git.autoStage }"
          @click="handleGitChange('autoStage', !git.autoStage)"
        >
          <span class="ws-toggle-knob" />
        </button>
      </label>

      <label class="ws-field">
        <span class="ws-label">提交模板</span>
        <CodekTextarea
          :model-value="git.commitTemplate"
          :rows="3"
          @change="handleGitChange('commitTemplate', $event)"
        />
      </label>
    </section>

    <section class="ws-section">
      <div class="ws-title">智能模型</div>

      <label class="ws-field">
        <span class="ws-label">供应商</span>
        <CodekSelect
          :model-value="ai.provider"
          :options="[
            { value: 'ollama', label: 'Ollama' },
            { value: 'openai', label: 'OpenAI' },
          ]"
          @change="handleAiChange('provider', $event)"
        />
      </label>

      <label class="ws-field">
        <span class="ws-label">模型</span>
        <CodekInput
          :model-value="ai.model"
          placeholder="留空使用默认"
          monospace
          @change="handleAiChange('model', $event)"
        />
      </label>

      <label class="ws-field">
        <span class="ws-label">随机性 Temperature：{{ ai.temperature }}</span>
        <input
          class="ws-range"
          type="range"
          min="0"
          max="2"
          step="0.1"
          :value="ai.temperature"
          @input="handleAiChange('temperature', toNumber($event))"
        />
      </label>

      <label class="ws-field">
        <span class="ws-label">质量门命令（每行一个）</span>
        <CodekTextarea
          :model-value="ai.qualityGateCommands.join('\n')"
          variant="code"
          :rows="4"
          placeholder="npm run typecheck&#10;npm test"
          @change="handleAiChange('qualityGateCommands', toLines($event))"
        />
      </label>
    </section>

    <div class="ws-actions">
      <button class="ws-reset-btn" @click="handleReset">重置为默认值</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, onMounted } from "vue"
import CodekInput from "./settings-controls/CodekInput.vue"
import CodekSelect from "./settings-controls/CodekSelect.vue"
import CodekTextarea from "./settings-controls/CodekTextarea.vue"
import {
  workspaceSettings,
  DEFAULT_WORKSPACE_SETTINGS,
  type WorkspaceSettings,
} from "../workspace/workspaceSettings"

type EditorKey = keyof WorkspaceSettings["editor"]
type FilesKey = keyof WorkspaceSettings["files"]
type SearchKey = keyof WorkspaceSettings["search"]
type GitKey = keyof WorkspaceSettings["git"]
type AiKey = keyof WorkspaceSettings["ai"]

const editor = reactive({ ...DEFAULT_WORKSPACE_SETTINGS.editor })
const files = reactive({ ...DEFAULT_WORKSPACE_SETTINGS.files })
const search = reactive({ ...DEFAULT_WORKSPACE_SETTINGS.search })
const git = reactive({ ...DEFAULT_WORKSPACE_SETTINGS.git })
const ai = reactive({ ...DEFAULT_WORKSPACE_SETTINGS.ai })

function loadFromManager(): void {
  const settings = workspaceSettings.getAll()
  Object.assign(editor, settings.editor)
  Object.assign(files, settings.files)
  Object.assign(search, settings.search)
  Object.assign(git, settings.git)
  Object.assign(ai, settings.ai)
}

function toNumber(event: Event): number {
  return parseFloat((event.target as HTMLInputElement)?.value || "0")
}

function toStringList(raw: string): string[] {
  return raw.split(",").map((s) => s.trim()).filter(Boolean)
}

function toLines(raw: string): string[] {
  return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
}

function handleEditorChange(key: EditorKey, value: WorkspaceSettings["editor"][EditorKey]): void {
  editor[key] = value as never
  workspaceSettings.set("editor", { ...editor })
}

function handleFilesChange(key: FilesKey, value: WorkspaceSettings["files"][FilesKey]): void {
  files[key] = value as never
  workspaceSettings.set("files", { ...files })
}

function handleSearchChange(key: SearchKey, value: WorkspaceSettings["search"][SearchKey]): void {
  search[key] = value as never
  workspaceSettings.set("search", { ...search })
}

function handleGitChange(key: GitKey, value: WorkspaceSettings["git"][GitKey]): void {
  git[key] = value as never
  workspaceSettings.set("git", { ...git })
}

function handleAiChange(key: AiKey, value: WorkspaceSettings["ai"][AiKey]): void {
  ai[key] = value as never
  workspaceSettings.set("ai", { ...ai })
}

function handleReset(): void {
  workspaceSettings.reset()
  loadFromManager()
}

onMounted(() => {
  loadFromManager()
})
</script>

<style scoped>
.ws-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.ws-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ws-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-subtle);
}

.ws-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ws-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.ws-range {
  width: 100%;
  accent-color: var(--accent);
  cursor: pointer;
}

.ws-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.ws-toggle-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.ws-toggle {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-dark);
  cursor: pointer;
  position: relative;
  transition: background 0.2s, border-color 0.2s;
  padding: 0;
}

.ws-toggle.active {
  background: var(--accent);
  border-color: var(--accent);
}

.ws-toggle-knob {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--text-primary);
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform 0.2s;
}

.ws-toggle.active .ws-toggle-knob {
  transform: translateX(16px);
  background: #0d0e10;
}

.ws-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}

.ws-reset-btn {
  border: 1px solid var(--border);
  background: var(--bg-dark);
  color: var(--text-secondary);
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.ws-reset-btn:hover {
  border-color: var(--red);
  color: var(--red);
}
</style>
