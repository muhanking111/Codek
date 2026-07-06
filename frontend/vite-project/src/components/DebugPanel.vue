<template>
  <div v-if="visible" class="debug-panel">
    <div class="debug-toolbar">
      <div class="toolbar-left">
        <button
          class="toolbar-btn"
          :class="{ accent: debugState.isRunning.value }"
          :disabled="!activeConfig || (!debugState.isRunning.value && activeConfig === undefined)"
          :title="debugState.isRunning.value ? '重新启动' : '开始调试'"
          @click="handleDebugAction"
        >
          <span v-if="debugState.isRunning.value" class="btn-icon">&#x25A0;</span>
          <span v-else class="btn-icon">&#x25B6;</span>
        </button>
        <button
          class="toolbar-btn"
          :disabled="!debugState.isRunning.value"
          title="停止调试"
          @click="handleStop"
        >
          <span class="btn-icon stop-icon">&#x25A0;</span>
        </button>
        <button
          class="toolbar-btn"
          :disabled="!debugState.paused.value"
          title="继续运行"
          @click="handleContinue"
        >
          <span class="btn-icon">&#x23F5;</span>
        </button>
        <button
          class="toolbar-btn"
          :disabled="!debugState.paused.value"
          title="单步跳过"
          @click="handleStepOver"
        >
          <span class="btn-icon">&#x21B7;</span>
        </button>
        <button
          class="toolbar-btn"
          :disabled="!debugState.paused.value"
          title="单步进入"
          @click="handleStepIn"
        >
          <span class="btn-icon">&#x2193;</span>
        </button>
        <button
          class="toolbar-btn"
          :disabled="!debugState.paused.value"
          title="单步跳出"
          @click="handleStepOut"
        >
          <span class="btn-icon">&#x2191;</span>
        </button>
        <select
          class="config-select"
          :value="debugState.activeConfigId.value"
          @change="handleConfigChange"
        >
          <option value="" disabled>选择调试配置</option>
          <option
            v-for="cfg in debugState.runConfigs"
            :key="cfg.id"
            :value="cfg.id"
          >
            {{ cfg.name }}
          </option>
          <option value="__add__">+ 添加调试配置...</option>
        </select>
      </div>
      <div class="toolbar-right">
        <button class="toolbar-btn panel-btn" title="关闭面板" @click="$emit('close')">
          <span class="btn-icon">&#x2715;</span>
        </button>
      </div>
    </div>

    <div class="debug-sections">
      <div class="section" :class="{ collapsed: collapsedSections.has('variables') }">
        <button class="section-header" @click="toggleSection('variables')">
          <span class="section-chevron" :class="{ open: !collapsedSections.has('variables') }">&#x276F;</span>
          <span class="section-title">变量</span>
        </button>
        <div v-if="!collapsedSections.has('variables')" class="section-body">
          <div v-if="debugState.variables.value.length === 0" class="section-empty">暂无变量</div>
          <VariableNode
            v-for="variable in debugState.variables.value"
            :key="variable.name"
            :node="variable"
            :depth="0"
          />
        </div>
      </div>

      <div class="section" :class="{ collapsed: collapsedSections.has('watch') }">
        <button class="section-header" @click="toggleSection('watch')">
          <span class="section-chevron" :class="{ open: !collapsedSections.has('watch') }">&#x276F;</span>
          <span class="section-title">监视</span>
        </button>
        <div v-if="!collapsedSections.has('watch')" class="section-body">
          <div class="watch-input-wrap">
            <input
              v-model="watchInput"
              class="watch-input"
              type="text"
              placeholder="输入要监视的表达式"
              @keydown.enter.prevent="handleAddWatch"
            />
            <button
              class="watch-add-btn"
              :disabled="!watchInput.trim()"
              @click="handleAddWatch"
            >
              +
            </button>
          </div>
          <div
            v-for="entry in debugState.watchEntries.value"
            :key="entry.id"
            class="watch-entry"
          >
            <span class="watch-name">{{ entry.expression }}</span>
            <span class="watch-value">{{ entry.value }}</span>
            <button class="watch-remove" @click="handleRemoveWatch(entry.id)">&#x2715;</button>
          </div>
        </div>
      </div>

      <div class="section" :class="{ collapsed: collapsedSections.has('callstack') }">
        <button class="section-header" @click="toggleSection('callstack')">
          <span class="section-chevron" :class="{ open: !collapsedSections.has('callstack') }">&#x276F;</span>
          <span class="section-title">调用堆栈</span>
          <span
            v-if="debugState.paused.value"
            class="section-badge paused"
          >已暂停</span>
          <span
            v-else-if="debugState.isRunning.value"
            class="section-badge running"
          >运行中</span>
        </button>
        <div v-if="!collapsedSections.has('callstack')" class="section-body">
          <div v-if="debugState.stackFrames.value.length === 0" class="section-empty">暂无调用帧</div>
          <button
            v-for="frame in debugState.stackFrames.value"
            :key="frame.id"
            class="stack-frame"
            :class="{ active: debugState.currentFrameId.value === frame.id }"
            @click="handleFrameClick(frame)"
          >
            <span class="frame-name">{{ frame.name }}</span>
            <span class="frame-location">{{ frame.file }}:{{ frame.line }}</span>
          </button>
        </div>
      </div>

      <div class="section" :class="{ collapsed: collapsedSections.has('breakpoints') }">
        <button class="section-header" @click="toggleSection('breakpoints')">
          <span class="section-chevron" :class="{ open: !collapsedSections.has('breakpoints') }">&#x276F;</span>
          <span class="section-title">断点</span>
          <span v-if="debugState.breakpoints.value.length > 0" class="section-count">{{ debugState.breakpoints.value.length }}</span>
        </button>
        <div v-if="!collapsedSections.has('breakpoints')" class="section-body">
          <div v-if="debugState.breakpoints.value.length === 0" class="section-empty">暂无断点</div>
          <div
            v-for="bp in debugState.breakpoints.value"
            :key="bp.id"
            class="breakpoint-entry"
          >
            <input
              type="checkbox"
              class="bp-checkbox"
              :checked="bp.enabled"
              @change="handleBpToggle(bp.id, ($event.target as HTMLInputElement).checked)"
            />
            <button class="bp-location" @click="handleBpNavigate(bp)">
              <span class="bp-file">{{ bp.file }}</span>
              <span class="bp-line">{{ bp.line }}</span>
              <span v-if="bp.condition" class="bp-condition" title="条件断点">?</span>
            </button>
            <button class="bp-remove" @click="handleBpRemove(bp.id)">&#x2715;</button>
          </div>
        </div>
      </div>
    </div>

    <div class="debug-console">
      <div class="console-output" ref="consoleOutputRef">
        <div
          v-for="entry in debugState.consoleOutput.value"
          :key="entry.id"
          class="console-line"
          :class="`console-${entry.type}`"
        >
          <span class="console-prefix">{{ consolePrefix(entry.type) }}</span>
          <span class="console-text">{{ entry.text }}</span>
        </div>
        <div v-if="debugState.consoleOutput.value.length === 0" class="console-empty">调试控制台输出会显示在这里</div>
      </div>
      <div class="console-input-row">
        <span class="console-chevron">&#x276F;</span>
        <input
          ref="consoleInputRef"
          v-model="consoleInput"
          class="console-input"
          type="text"
          placeholder="调试控制台输入（REPL）..."
          :disabled="!debugState.isRunning.value"
          @keydown.enter.prevent="handleConsoleSubmit"
        />
      </div>
    </div>

    <div v-if="configModalVisible" class="modal-backdrop" @click.self="configModalVisible = false">
      <div class="modal-dialog">
        <div class="modal-header">
          <span class="modal-title">{{ editingConfigId ? '编辑调试配置' : '添加调试配置' }}</span>
          <button class="modal-close" @click="configModalVisible = false">&#x2715;</button>
        </div>
        <div class="modal-body">
          <label class="modal-field">
            <span class="field-label">名称</span>
            <input
              v-model="configForm.name"
              class="field-input"
              type="text"
              placeholder="调试配置名称"
            />
          </label>
          <label class="modal-field">
            <span class="field-label">类型</span>
            <select v-model="configForm.type" class="field-input">
              <option value="node">Node.js</option>
              <option value="java">Java</option>
              <option value="python">Python</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <label class="modal-field">
            <span class="field-label">命令 / 程序</span>
            <input
              v-model="configForm.command"
              class="field-input"
              type="text"
              placeholder="例如 node script.js"
            />
          </label>
          <label class="modal-field">
            <span class="field-label">工作目录</span>
            <input
              v-model="configForm.workingDir"
              class="field-input"
              type="text"
              placeholder="${workspaceFolder}"
            />
          </label>
        </div>
        <div class="modal-footer">
          <button
            v-if="editingConfigId"
            class="modal-btn danger"
            @click="handleDeleteConfig"
          >
            删除
          </button>
          <div class="modal-actions-right">
            <button class="modal-btn ghost" @click="configModalVisible = false">取消</button>
            <button class="modal-btn primary" :disabled="!configForm.name.trim()" @click="handleSaveConfig">
              {{ editingConfigId ? '保存' : '添加' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue"
import type {
  Breakpoint,
  RunConfig,
  StackFrame,
} from "./debugState"
import {
  addWatch,
  applyProfileRunConfigsFromResource,
  debugState,
  discoverWorkspaceRunConfigs,
  removeBreakpoint,
  removeWatch,
  setActiveConfig,
  setBreakpointEnabled,
  selectFrame,
  addConfig,
  updateConfig,
  removeConfig,
} from "./debugState"
import {
  continueDebug,
  restartDebug,
  sendInput,
  startDebug,
  stepInDebug,
  stepOutDebug,
  stepOverDebug,
  stopDebug,
} from "./debugActions"
import { workspace } from "../workspace/manager.js"
import { workbenchProfileStore } from "../settings/profileStore"

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
  openFile: [payload: { file: string; line: number; column: number }]
}>()

const collapsedSections = ref<Set<string>>(new Set())

const watchInput = ref<string>("")

const consoleInput = ref<string>("")
const consoleOutputRef = ref<HTMLElement | null>(null)
const consoleInputRef = ref<HTMLInputElement | null>(null)

const configModalVisible = ref<boolean>(false)
const editingConfigId = ref<string>("")
const configForm = reactive<Omit<RunConfig, "id">>({
  name: "",
  type: "node",
  command: "",
  workingDir: "${workspaceFolder}",
})

const activeConfig = debugState.activeConfig
let discoveryInFlight = false
const currentProfileSubscription = workbenchProfileStore.onDidChangeCurrentProfile(() => {
  refreshProfileRunConfigs()
})
const profileStorageChangeUnsubscribe = window.codek?.onUserDataProfileChanged?.(() => {
  void hydrateProfileRunConfigs({ force: true })
})

function toggleSection(name: string): void {
  const next = new Set(collapsedSections.value)
  if (next.has(name)) {
    next.delete(name)
  } else {
    next.add(name)
  }
  collapsedSections.value = next
}

function handleDebugAction(): void {
  if (debugState.isRunning.value) {
    restartDebug()
  } else {
    startDebug()
  }
}

function handleStop(): void {
  stopDebug()
}

function handleContinue(): void {
  void continueDebug()
}

function handleStepOver(): void {
  void stepOverDebug()
}

function handleStepIn(): void {
  void stepInDebug()
}

function handleStepOut(): void {
  void stepOutDebug()
}

function handleConfigChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value === "__add__") {
    openConfigModal()
    return
  }
  setActiveConfig(value)
}

function handleAddWatch(): void {
  addWatch(watchInput.value)
  watchInput.value = ""
}

function handleRemoveWatch(id: string): void {
  removeWatch(id)
}

function handleBpToggle(id: string, enabled: boolean): void {
  setBreakpointEnabled(id, enabled)
}

function handleBpNavigate(bp: Breakpoint): void {
  emit("openFile", { file: bp.file, line: bp.line, column: 1 })
}

function handleBpRemove(id: string): void {
  removeBreakpoint(id)
}

function handleFrameClick(frame: StackFrame): void {
  selectFrame(frame.id)
  emit("openFile", { file: frame.file, line: frame.line, column: frame.column })
}

function handleConsoleSubmit(): void {
  sendInput(consoleInput.value)
  consoleInput.value = ""
}

function consolePrefix(type: string): string {
  switch (type) {
    case "input":
      return ">"
    case "error":
      return "!"
    case "system":
      return "#"
    default:
      return ""
  }
}

function scrollConsoleToBottom(): void {
  nextTick(() => {
    if (consoleOutputRef.value) {
      consoleOutputRef.value.scrollTop = consoleOutputRef.value.scrollHeight
    }
  })
}

watch(
  () => debugState.consoleOutput.value.length,
  () => scrollConsoleToBottom(),
)

onMounted(() => {
  void consoleInputRef.value
  void hydrateProfileRunConfigs()
  void refreshDiscoveredRunConfigs()
})

onUnmounted(() => {
  currentProfileSubscription.dispose()
  profileStorageChangeUnsubscribe?.()
})

watch(
  () => [workspace.projectRoot, workspace.workspaceRoots.join("|")],
  () => {
    void refreshDiscoveredRunConfigs()
  },
)

function openConfigModal(editId?: string): void {
  const id = editId || ""
  editingConfigId.value = id
  if (id) {
    const cfg = debugState.runConfigs.find((c) => c.id === id)
    if (cfg) {
      configForm.name = cfg.name
      configForm.type = cfg.type
      configForm.command = cfg.command
      configForm.workingDir = cfg.workingDir
    }
  } else {
    configForm.name = ""
    configForm.type = "node"
    configForm.command = ""
    configForm.workingDir = "${workspaceFolder}"
  }
  configModalVisible.value = true
}

function handleSaveConfig(): void {
  if (!configForm.name.trim()) return
  if (editingConfigId.value) {
    updateConfig(editingConfigId.value, { ...configForm })
  } else {
    addConfig({ ...configForm })
  }
  configModalVisible.value = false
}

function handleDeleteConfig(): void {
  if (editingConfigId.value) {
    removeConfig(editingConfigId.value)
  }
  configModalVisible.value = false
}

async function refreshDiscoveredRunConfigs(): Promise<void> {
  const roots = workspace.workspaceRoots.length
    ? workspace.workspaceRoots
    : workspace.projectRoot
      ? [workspace.projectRoot]
      : []
  const root = roots[0]
  const fsApi = typeof window !== "undefined" ? window.codek : null
  if (!root || !fsApi?.readFile || discoveryInFlight) return

  discoveryInFlight = true
  try {
    await discoverWorkspaceRunConfigs(async (relativePath: string) => {
      const fullPath = joinPath(root, relativePath)
      return await fsApi.readFile!(fullPath)
    })
  } finally {
    discoveryInFlight = false
  }
}

function refreshProfileRunConfigs(): void {
  const activeProfileId = workbenchProfileStore.getActiveProfileId()
  const activeProfile = activeProfileId ? workbenchProfileStore.getProfile(activeProfileId) : null
  applyProfileRunConfigsFromResource(activeProfile?.resources.tasks)
}

async function hydrateProfileRunConfigs(options: { force?: boolean } = {}): Promise<void> {
  try {
    if (options.force) {
      await workbenchProfileStore.refreshFromProfileStorage()
    } else {
      await workbenchProfileStore.hydrateFromProfileStorage()
    }
  } catch {
    // Keep workspace tasks usable even when desktop profile storage is unavailable.
  }
  refreshProfileRunConfigs()
}

function joinPath(root: string, relativePath: string): string {
  const normalizedRoot = String(root).replace(/\\/g, "/").replace(/\/+$/, "")
  const normalizedRelative = String(relativePath).replace(/\\/g, "/").replace(/^\/+/, "")
  return `${normalizedRoot}/${normalizedRelative}`
}

</script>

<script lang="ts">
import { defineComponent, h, ref as treeRef, type PropType, type DefineComponent, type VNode } from "vue"
import type { VariableNode as VariableNodeType } from "./debugState"

let VariableNodeComponent: DefineComponent<{ node: VariableNodeType; depth: number }>

VariableNodeComponent = defineComponent({
  name: "VariableNode",
  props: {
    node: { type: Object as PropType<VariableNodeType>, required: true },
    depth: { type: Number, required: true },
  },
  setup(props): () => VNode {
    const expanded = treeRef<Set<string>>(new Set())

    function toggleExpand(name: string): void {
      const next = new Set(expanded.value)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      expanded.value = next
    }

    function icon(type: VariableNodeType["type"]): string {
      switch (type) {
        case "object":
          return "{ }"
        case "array":
          return "[ ]"
        case "string":
          return '"T"'
        case "number":
          return "#"
        case "boolean":
          return "TF"
        case "function":
          return "fn"
        case "null":
          return "nl"
        case "undefined":
          return "ud"
        default:
          return "?"
      }
    }

    function iconClass(type: VariableNodeType["type"]): string {
      switch (type) {
        case "string":
          return "var-string"
        case "number":
          return "var-number"
        case "boolean":
          return "var-boolean"
        case "object":
          return "var-object"
        case "array":
          return "var-array"
        case "function":
          return "var-function"
        default:
          return "var-other"
      }
    }

    return () => {
      const { node, depth } = props
      const hasChildren = node.children && node.children.length > 0
      const isOpen = expanded.value.has(node.name)
      const padLeft = `${8 + depth * 16}px`

      return h("div", { class: "variable-tree" }, [
        h(
          "button",
          {
            class: "variable-row",
            style: { paddingLeft: padLeft },
            onClick: () => hasChildren && toggleExpand(node.name),
          },
          [
            h("span", {
              class: hasChildren
                ? "variable-chevron"
                : "variable-chevron spacer",
              innerHTML: isOpen ? "&#x276F;" : "",
              style: isOpen ? { transform: "rotate(90deg)" } : {},
            }),
            h("span", { class: `variable-icon ${iconClass(node.type)}` }, icon(node.type)),
            h("span", { class: "variable-name" }, node.name),
            h("span", { class: "variable-value" }, `: ${node.value}`),
          ],
        ),
        hasChildren && isOpen
          ? node.children!.map((child) =>
              h(VariableNodeComponent, {
                key: child.name,
                node: child,
                depth: depth + 1,
              }),
            )
          : null,
      ])
    }
  },
})

export default { components: { VariableNode: VariableNodeComponent } }
</script>

<style scoped>
.debug-panel {
  position: fixed;
  left: 48px;
  right: 0;
  bottom: 24px;
  height: 260px;
  max-height: 50vh;
  z-index: 40;
  display: flex;
  flex-direction: column;
  background: var(--bg-deepest);
  border-top: 1px solid var(--border-subtle);
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.35);
  font-family: var(--font-sans);
}

.debug-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  background: var(--bg-panel);
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 13px;
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.toolbar-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.toolbar-btn.accent {
  color: var(--accent);
}

.stop-icon {
  color: var(--red);
  font-size: 10px;
}

.config-select {
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  padding: 3px 8px;
  font-size: 11px;
  outline: none;
  font-family: var(--font-sans);
  cursor: pointer;
  min-width: 140px;
  max-width: 200px;
}

.config-select:focus {
  border-color: var(--accent);
}

.panel-btn {
  font-size: 12px;
}

.debug-sections {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.section {
  border-bottom: 1px solid var(--border-subtle);
}

.section.collapsed .section-header {
  opacity: 0.7;
}

.section-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border: none;
  background: var(--bg-darker);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.8px;
  cursor: pointer;
  font-family: var(--font-sans);
  text-transform: uppercase;
  position: sticky;
  top: 0;
  z-index: 1;
}

.section-header:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.section-chevron {
  display: inline-block;
  font-size: 8px;
  color: var(--text-muted);
  transition: transform 0.15s;
  width: 10px;
  text-align: center;
}

.section-chevron.open {
  transform: rotate(90deg);
}

.section-title {
  flex: 1;
  text-align: left;
}

.section-badge {
  font-size: 8px;
  padding: 1px 5px;
  border-radius: 3px;
  font-weight: 600;
}

.section-badge.paused {
  background: var(--accent-dim);
  color: var(--accent);
}

.section-badge.running {
  background: rgba(52, 211, 153, 0.15);
  color: var(--green);
}

.section-count {
  color: var(--text-muted);
  font-size: 9px;
}

.section-body {
  padding: 2px 0;
}

.section-empty {
  padding: 10px 12px;
  color: var(--text-muted);
  font-size: 11px;
}

.variable-tree {
  user-select: none;
}

.variable-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  cursor: pointer;
  text-align: left;
  height: 22px;
}

.variable-row:hover {
  background: var(--bg-hover);
}

.variable-chevron {
  font-size: 8px;
  color: var(--text-muted);
  width: 12px;
  text-align: center;
  flex-shrink: 0;
  transition: transform 0.12s;
}

.variable-chevron.spacer {
  visibility: hidden;
}

.variable-icon {
  flex-shrink: 0;
  width: 20px;
  font-size: 10px;
  text-align: center;
}

.variable-icon.var-string { color: var(--orange); }
.variable-icon.var-number { color: var(--green); }
.variable-icon.var-boolean { color: var(--accent); }
.variable-icon.var-object { color: #60a5fa; }
.variable-icon.var-array { color: #c084fc; }
.variable-icon.var-function { color: #fbbf24; }
.variable-icon.var-other { color: var(--text-muted); }

.variable-name {
  color: var(--text-primary);
}

.variable-value {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.watch-input-wrap {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
}

.watch-input {
  flex: 1;
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  padding: 4px 8px;
  font-size: 11px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  outline: none;
}

.watch-input:focus {
  border-color: var(--accent);
}

.watch-add-btn {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  background: var(--bg-dark);
  color: var(--text-secondary);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.watch-add-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--accent);
  border-color: var(--accent);
}

.watch-add-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.watch-entry {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  font-size: 11px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
}

.watch-name {
  color: var(--text-primary);
}

.watch-value {
  color: var(--text-muted);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.watch-remove {
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 9px;
  padding: 2px;
  opacity: 0;
}

.watch-entry:hover .watch-remove {
  opacity: 1;
}

.watch-remove:hover {
  color: var(--red);
}

.stack-frame {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 11px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  cursor: pointer;
  text-align: left;
}

.stack-frame:hover {
  background: var(--bg-hover);
}

.stack-frame.active {
  background: var(--bg-active);
}

.frame-name {
  color: var(--text-primary);
}

.frame-location {
  color: var(--text-muted);
  font-size: 10px;
}

.breakpoint-entry {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
}

.breakpoint-entry:hover {
  background: var(--bg-hover);
}

.bp-checkbox {
  accent-color: var(--red);
  cursor: pointer;
}

.bp-location {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  border: none;
  background: none;
  color: var(--text-primary);
  font-size: 11px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  cursor: pointer;
  text-align: left;
  padding: 0;
}

.bp-location:hover {
  color: var(--text-bright);
}

.bp-file {
  color: var(--text-primary);
}

.bp-line {
  color: var(--text-muted);
}

.bp-condition {
  color: var(--orange);
  font-weight: 700;
}

.bp-remove {
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 9px;
  padding: 2px;
  opacity: 0;
}

.breakpoint-entry:hover .bp-remove {
  opacity: 1;
}

.bp-remove:hover {
  color: var(--red);
}

.debug-console {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
  height: 140px;
  min-height: 80px;
}

.console-output {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 11px;
  background: var(--bg-dark);
}

.console-empty {
  color: var(--text-muted);
  font-size: 11px;
  padding: 4px 0;
}

.console-line {
  display: flex;
  gap: 6px;
  padding: 1px 0;
  line-height: 1.6;
}

.console-prefix {
  flex-shrink: 0;
  width: 14px;
  text-align: center;
  color: var(--text-muted);
}

.console-output .console-output .console-prefix { color: var(--text-primary); }
.console-error .console-prefix { color: var(--red); }
.console-input .console-prefix { color: var(--accent); }
.console-system .console-prefix { color: var(--text-muted); }

.console-text {
  word-break: break-all;
  white-space: pre-wrap;
}

.console-output .console-text { color: var(--text-primary); }
.console-error .console-text { color: var(--red); }
.console-input .console-text { color: var(--accent); }
.console-system .console-text { color: var(--text-muted); font-style: italic; }

.console-input-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-panel);
}

.console-chevron {
  color: var(--accent);
  font-size: 10px;
  flex-shrink: 0;
}

.console-input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 11px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  outline: none;
  padding: 3px 0;
}

.console-input:disabled {
  opacity: 0.3;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal-dialog {
  width: min(92vw, 460px);
  background: var(--bg-panel);
  border: 1px solid var(--border-bright);
  border-radius: 10px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.modal-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright);
}

.modal-close {
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px;
}

.modal-close:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.modal-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
}

.field-input {
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  padding: 8px 10px;
  font-size: 13px;
  font-family: var(--font-sans);
  outline: none;
}

.field-input:focus {
  border-color: var(--accent);
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--border-subtle);
}

.modal-actions-right {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.modal-btn {
  border: none;
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 12px;
  cursor: pointer;
  font-family: var(--font-sans);
}

.modal-btn.ghost {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.modal-btn.ghost:hover {
  background: var(--bg-active);
}

.modal-btn.primary {
  background: var(--accent);
  color: #0d0e10;
  font-weight: 600;
}

.modal-btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}

.modal-btn.primary:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.modal-btn.danger {
  background: transparent;
  color: var(--red);
}

.modal-btn.danger:hover {
  background: rgba(248, 113, 113, 0.1);
}
</style>

<style>
.debug-breakpoint-enabled {
  background: #e53e3e;
  border-radius: 50%;
  width: 14px !important;
  height: 14px !important;
  margin-left: 4px;
  margin-top: 2px;
  cursor: pointer;
}

.debug-breakpoint-disabled {
  background: transparent;
  border: 2px solid #e53e3e;
  border-radius: 50%;
  width: 14px !important;
  height: 14px !important;
  margin-left: 4px;
  margin-top: 2px;
  cursor: pointer;
}
</style>
