<template>
  <div v-if="visible" class="process-panel" data-codek-smoke="process-explorer-panel">
    <div class="process-toolbar">
      <div class="process-title">
        <span>进程资源管理器</span>
        <small v-if="snapshot">PID {{ snapshot.app?.pid ?? "-" }}</small>
        <small v-if="actionStatus" class="process-status">{{ actionStatus }}</small>
        <small v-else-if="actionError" class="process-status error">{{ actionError }}</small>
      </div>
      <div class="process-actions">
        <button class="toolbar-btn" title="复制诊断" data-codek-smoke="process-copy-diagnostics" :disabled="!snapshot" @click="copyDiagnostics">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
        <button class="toolbar-btn" title="导出诊断包" data-codek-smoke="process-export-diagnostics" :disabled="exporting" @click="exportDiagnostics">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
        <button class="toolbar-btn" title="刷新" @click="refresh">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 0 1-15.5 6.3" />
            <path d="M3 12A9 9 0 0 1 18.5 5.7" />
            <path d="M18 2v5h-5" />
            <path d="M6 22v-5h5" />
          </svg>
        </button>
        <button class="toolbar-btn" title="关闭" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <div class="process-content">
      <div v-if="loading" class="process-empty">正在读取进程信息...</div>
      <div v-else-if="error" class="process-empty error">{{ error }}</div>
      <template v-else-if="snapshot">
        <section class="process-summary">
          <div class="summary-cell">
            <span class="summary-label">主进程</span>
            <strong>{{ snapshot.app?.name || "Codek" }}</strong>
            <small>{{ snapshot.app?.platform || "-" }} {{ snapshot.app?.arch || "" }}</small>
          </div>
          <div class="summary-cell">
            <span class="summary-label">内存</span>
            <strong>{{ formatBytes(snapshot.app?.memory?.rss) }}</strong>
            <small>Heap {{ formatBytes(snapshot.app?.memory?.heapUsed) }} · 负载 {{ performanceModel?.samplingModel.cpu.totalLoad ?? 0 }}%</small>
          </div>
          <div class="summary-cell">
            <span class="summary-label">终端</span>
            <strong>{{ snapshot.pty?.sessions?.length || 0 }}</strong>
            <small>{{ snapshot.pty?.ptyAvailable ? "PTY 可用" : "兼容模式" }}</small>
          </div>
          <div class="summary-cell">
            <span class="summary-label">服务</span>
            <strong>{{ processTree?.summary.totalProcesses ?? serviceCount }}</strong>
            <small>投影 / LSP / DAP / MCP</small>
          </div>
        </section>

        <section class="process-section" data-codek-smoke="process-performance-evidence">
          <h3>性能证据</h3>
          <div class="process-row evidence">
            <span class="row-kind">Perf</span>
            <span class="row-main">{{ performanceModel?.evidence.summary || "暂无采样" }}</span>
            <span class="row-meta">{{ performanceModel?.evidence.issues.length || 0 }} 个问题</span>
            <span class="row-state">{{ performanceModel?.evidence.privacy.redacted ? "已脱敏" : "未脱敏" }}</span>
          </div>
        </section>

        <section class="process-section">
          <h3>窗口</h3>
          <div v-if="!snapshot.windows?.length" class="section-empty">暂无窗口</div>
          <div v-for="win in snapshot.windows" :key="win.id" class="process-row">
            <span class="row-kind">Window</span>
            <span class="row-main">#{{ win.id }} {{ win.title || "未命名窗口" }}</span>
            <span class="row-meta">PID {{ win.rendererPid ?? "-" }}</span>
            <span class="row-state">{{ win.focused ? "聚焦" : win.visible ? "可见" : "隐藏" }}</span>
          </div>
        </section>

        <section class="process-section">
          <h3>终端会话</h3>
          <div v-if="!snapshot.pty?.sessions?.length" class="section-empty">暂无终端会话</div>
          <div v-for="term in snapshot.pty?.sessions || []" :key="term.id" class="process-row">
            <span class="row-kind">PTY</span>
            <span class="row-main">{{ term.shellType || "shell" }} / {{ term.mode || "pty" }}</span>
            <span class="row-meta">PID {{ term.pid ?? "-" }} · {{ formatDuration(term.uptimeMs) }}</span>
            <span class="row-path" :title="term.cwd">{{ term.cwd || "-" }}</span>
          </div>
        </section>

        <section class="process-section two-col">
          <div>
            <h3>语言服务</h3>
            <div v-if="!snapshot.lsp?.length" class="section-empty">暂无 LSP 进程</div>
            <div v-for="item in snapshot.lsp" :key="item.id" class="process-row compact">
              <span class="row-kind">LSP</span>
              <span class="row-main">{{ item.id || "-" }}</span>
              <span class="row-meta">PID {{ item.pid ?? "-" }}</span>
            </div>
          </div>
          <div>
            <h3>调试适配器</h3>
            <div v-if="!snapshot.dap?.length" class="section-empty">暂无 DAP 进程</div>
            <div v-for="item in snapshot.dap" :key="item.id" class="process-row compact">
              <span class="row-kind">DAP</span>
              <span class="row-main">{{ item.adapterType || item.id || "-" }}</span>
              <span class="row-meta">PID {{ item.pid ?? "-" }}</span>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import {
  buildProcessDiagnosticsText,
  buildProcessPerformanceModel,
  buildProcessTreeSnapshot,
  createProcessActionDescriptor,
  type ProcessPerformanceModel,
  type ProcessSnapshot,
  type ProcessTreeSnapshot,
} from "../workbench/processDiagnostics"

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const snapshot = ref<ProcessSnapshot | null>(null)
const processTree = ref<ProcessTreeSnapshot | null>(null)
const performanceModel = ref<ProcessPerformanceModel | null>(null)
const loading = ref(false)
const error = ref("")
const actionStatus = ref("")
const actionError = ref("")
const exporting = ref(false)

const serviceCount = computed(() => (snapshot.value?.lsp?.length || 0) + (snapshot.value?.dap?.length || 0))
const copyAction = computed(() => createProcessActionDescriptor("copy"))
const exportAction = computed(() => createProcessActionDescriptor("export"))

watch(() => props.visible, (visible) => {
  if (visible) void refresh()
})

onMounted(() => {
  if (props.visible) void refresh()
})

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ""
  actionError.value = ""
  try {
    const result = await window.codek?.listProcesses?.()
    if (!result) {
      error.value = "进程资源管理器仅在 Electron 环境可用"
      snapshot.value = null
      processTree.value = null
      performanceModel.value = null
      return
    }
    snapshot.value = result as ProcessSnapshot
    processTree.value = buildProcessTreeSnapshot(snapshot.value)
    performanceModel.value = buildProcessPerformanceModel(snapshot.value, { generatedAt: processTree.value.generatedAt })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

async function copyDiagnostics(): Promise<void> {
  if (!snapshot.value) return
  actionStatus.value = ""
  actionError.value = ""
  try {
    await navigator.clipboard.writeText(buildProcessDiagnosticsText(snapshot.value))
    actionStatus.value = `${copyAction.value.title}: 诊断已复制`
  } catch (err) {
    actionError.value = `复制失败: ${formatError(err)}`
  }
}

async function exportDiagnostics(): Promise<void> {
  actionStatus.value = ""
  actionError.value = ""
  exporting.value = true
  try {
    const result = await window.codek?.exportDiagnostics?.()
    if (!result?.path) {
      actionError.value = "当前环境不支持导出诊断包"
      return
    }
    actionStatus.value = `${exportAction.value.title}: ${result.path}`
  } catch (err) {
    actionError.value = `导出失败: ${formatError(err)}`
  } finally {
    exporting.value = false
  }
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function formatBytes(value: unknown): string {
  const bytes = typeof value === "number" ? value : 0
  if (!Number.isFinite(bytes) || bytes <= 0) return "-"
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

function formatDuration(value: unknown): string {
  const ms = typeof value === "number" ? value : 0
  if (!Number.isFinite(ms) || ms <= 0) return "0s"
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
</script>

<style scoped>
.process-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  color: var(--text-primary);
  border-left: 1px solid var(--border-subtle);
}

.process-toolbar {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.process-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
}

.process-title small,
.summary-cell small,
.summary-label,
.row-meta,
.row-path,
.section-empty {
  color: var(--text-muted);
}

.process-status {
  max-width: min(440px, 42vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-status.error {
  color: var(--red);
}

.process-actions {
  display: flex;
  gap: 2px;
}

.toolbar-btn {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.toolbar-btn:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.toolbar-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.toolbar-btn:disabled:hover {
  color: var(--text-muted);
  background: transparent;
}

.process-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px 14px;
}

.process-empty {
  padding: 18px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

.process-empty.error {
  color: var(--red);
}

.process-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.summary-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-secondary);
  min-width: 0;
}

.summary-label {
  font-size: 11px;
}

.summary-cell strong {
  font-size: 16px;
  font-weight: 650;
}

.process-section {
  margin-top: 12px;
}

.process-section h3 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 650;
}

.two-col {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.process-row {
  display: grid;
  grid-template-columns: 64px minmax(150px, 1.2fr) minmax(110px, 0.8fr) minmax(120px, 1fr);
  gap: 8px;
  align-items: center;
  min-height: 30px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 12px;
}

.process-row.compact {
  grid-template-columns: 48px minmax(120px, 1fr) minmax(80px, auto);
}

.process-row.evidence {
  grid-template-columns: 64px minmax(180px, 1.4fr) minmax(100px, auto) minmax(80px, auto);
}

.row-kind {
  color: var(--accent);
  font-size: 11px;
  font-weight: 650;
}

.row-main,
.row-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-state {
  color: var(--text-secondary);
  text-align: right;
}

@media (max-width: 900px) {
  .process-summary,
  .two-col {
    grid-template-columns: 1fr;
  }

  .process-row {
    grid-template-columns: 52px minmax(0, 1fr);
  }

  .row-meta,
  .row-path,
  .row-state {
    grid-column: 2;
    text-align: left;
  }
}
</style>
