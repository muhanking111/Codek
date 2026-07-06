<template>
  <div ref="rootRef" class="sandbox-mode-bar" :title="hint" @keydown.escape="open = false">
    <button
      class="smb-summary"
      type="button"
      data-codek-smoke="sandbox-policy-trigger"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="open = !open"
    >
      <span class="smb-status-dot" :class="`trust-${trustStatus}`" aria-hidden="true"></span>
      <span class="smb-summary-text">{{ summaryText }}</span>
      <svg class="smb-chevron" :class="{ open }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <div v-if="open" class="smb-popover" role="dialog" aria-label="智能体执行策略">
      <div class="smb-popover-head">
        <span>智能体执行策略</span>
        <button class="smb-close" type="button" title="关闭" @click="open = false">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <label class="smb-field">
        <span class="smb-label">信任</span>
        <select class="smb-select" v-model="trustStatus" @change="onChange">
          <option value="trusted">可信任</option>
          <option value="restricted">受限</option>
          <option value="unknown">未确认</option>
        </select>
      </label>

      <label class="smb-field">
        <span class="smb-label">沙箱</span>
        <select class="smb-select" v-model="sandboxMode" @change="onChange">
          <option value="read-only">只读</option>
          <option value="workspace-write">工作区写入</option>
          <option value="danger-full-access">完全访问</option>
        </select>
      </label>

      <label class="smb-field">
        <span class="smb-label">审批</span>
        <select class="smb-select" v-model="approvalMode" @change="onChange">
          <option value="never">不询问</option>
          <option value="on-failure">失败后询问</option>
          <option value="on-request">请求时询问</option>
          <option value="untrusted">不可信模式</option>
        </select>
      </label>

      <label class="smb-field smb-toggle" :class="{ disabled: sandboxMode === 'danger-full-access' }">
        <span class="smb-label">网络</span>
        <input
          type="checkbox"
          v-model="networkAllowed"
          :disabled="sandboxMode === 'danger-full-access'"
          @change="onChange"
        />
        <span class="smb-switch" aria-hidden="true"></span>
        <span class="smb-toggle-label">{{ effectiveNetworkAllowed ? "网络开启" : "网络关闭" }}</span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { workspace } from "../workspace/manager.js"

type SandboxMode = "read-only" | "workspace-write" | "danger-full-access"
type ApprovalMode = "never" | "on-failure" | "on-request" | "untrusted"
type TrustStatus = "trusted" | "restricted" | "unknown"

interface PolicyShape {
  sandboxMode: SandboxMode
  approvalMode: ApprovalMode
  networkAllowed: boolean
}

interface TrustShape {
  status: TrustStatus
}

const sandboxMode = ref<SandboxMode>("workspace-write")
const approvalMode = ref<ApprovalMode>("on-request")
const networkAllowed = ref(false)
const trustStatus = ref<TrustStatus>("unknown")
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const trustLabels: Record<TrustStatus, string> = {
  trusted: "可信任",
  restricted: "受限",
  unknown: "未确认",
}

const sandboxLabels: Record<SandboxMode, string> = {
  "read-only": "只读",
  "workspace-write": "工作区写入",
  "danger-full-access": "完全访问",
}

const approvalLabels: Record<ApprovalMode, string> = {
  never: "不询问",
  "on-failure": "失败后询问",
  "on-request": "请求时询问",
  untrusted: "不可信模式",
}

const effectiveNetworkAllowed = computed(() => sandboxMode.value === "danger-full-access" || networkAllowed.value)

const summaryText = computed(
  () =>
    `${trustLabels[trustStatus.value]} · ${sandboxLabels[sandboxMode.value]} · ${approvalLabels[approvalMode.value]} · ${
      effectiveNetworkAllowed.value ? "网络开启" : "网络关闭"
    }`,
)

const hint = computed(
  () =>
    `Trust=${trustStatus.value} · Sandbox=${sandboxMode.value} · Approval=${approvalMode.value} · Network=${
      effectiveNetworkAllowed.value ? "allowed" : "blocked"
    }`,
)

const projectRoot = computed(() => workspace.projectRoot || "")

function api(method: string, path: string, body?: unknown) {
  const codek = (window as unknown as { codek?: { api?: (m: string, p: string, b?: unknown) => Promise<unknown> } }).codek
  if (!codek?.api) return Promise.resolve(null)
  return codek.api(method, path, body)
}

function unwrap<T>(result: unknown): T | null {
  if (result && typeof result === "object" && "ok" in result && "data" in result) {
    return (result as { data?: T }).data || null
  }
  return (result as T) || null
}

async function load() {
  try {
    const suffix = projectRoot.value ? `?projectRoot=${encodeURIComponent(projectRoot.value)}` : ""
    const result = unwrap<{ policy?: PolicyShape; trust?: TrustShape }>(await api("GET", `/agent/policy${suffix}`))
    const policy = result?.policy || (result as PolicyShape | null)
    if (policy) {
      if (policy.sandboxMode) sandboxMode.value = policy.sandboxMode
      if (policy.approvalMode) approvalMode.value = policy.approvalMode
      if (typeof policy.networkAllowed === "boolean") networkAllowed.value = policy.networkAllowed
    }
    if (result?.trust?.status) {
      trustStatus.value = result.trust.status
    }
  } catch (err) {
    console.warn("[sandbox-mode-bar] load failed:", err)
  }
}

async function onChange() {
  try {
    await api("POST", "/agent/policy", {
      sandboxMode: sandboxMode.value,
      approvalMode: approvalMode.value,
      networkAllowed: networkAllowed.value,
    })
    if (projectRoot.value) {
      await api("POST", "/workspace/trust", {
        root: projectRoot.value,
        status: trustStatus.value,
      })
    }
  } catch (err) {
    console.warn("[sandbox-mode-bar] save failed:", err)
  }
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (!rootRef.value?.contains(event.target as Node)) {
    open.value = false
  }
}

onMounted(() => {
  load()
  document.addEventListener("pointerdown", handleDocumentPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown)
})
</script>

<style scoped>
.sandbox-mode-bar {
  position: relative;
  min-width: 0;
  padding: 5px 10px 6px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.018), rgba(255, 255, 255, 0));
  flex-shrink: 0;
}

.smb-summary {
  width: 100%;
  height: 30px;
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 0 9px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.18);
  color: var(--text-secondary, #a0a0a0);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  text-align: left;
}

.smb-summary:hover,
.smb-summary[aria-expanded="true"] {
  border-color: rgba(45, 212, 191, 0.32);
  background: rgba(45, 212, 191, 0.06);
  color: var(--text-primary, #e6e6e6);
}

.smb-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #94a3b8;
  box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.08);
}

.smb-status-dot.trust-trusted {
  background: #5eead4;
  box-shadow: 0 0 0 3px rgba(45, 212, 191, 0.12);
}

.smb-status-dot.trust-restricted {
  background: #fbbf24;
  box-shadow: 0 0 0 3px rgba(251, 191, 36, 0.12);
}

.smb-status-dot.trust-unknown {
  background: #94a3b8;
}

.smb-summary-text {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.smb-chevron {
  color: var(--text-muted, #7a7a7a);
  transition: transform 0.14s ease;
}

.smb-chevron.open {
  transform: rotate(180deg);
}

.smb-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 10px;
  right: 10px;
  z-index: 2600;
  display: grid;
  gap: 8px;
  width: min(360px, calc(100vw - 32px));
  max-width: calc(100% - 20px);
  padding: 10px;
  border: 1px solid var(--border, rgba(148, 163, 184, 0.22));
  border-radius: 10px;
  background: var(--bg-panel, #1f2329);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.45);
}

.smb-popover-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-bright, #f8fafc);
  font-size: 12px;
  font-weight: 600;
}

.smb-close {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.smb-close:hover {
  background: rgba(148, 163, 184, 0.08);
  color: var(--text-primary);
}

.smb-field {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.smb-label,
.smb-toggle-label {
  color: var(--text-secondary, #a0a0a0);
  letter-spacing: 0;
  font-size: 12px;
  white-space: nowrap;
}

.smb-select {
  width: 100%;
  min-width: 0;
  height: 30px;
  background: rgba(15, 23, 42, 0.28);
  color: var(--text-primary, #e6e6e6);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 7px;
  padding: 0 8px;
  font-size: 12px;
  font-family: inherit;
  outline: none;
  cursor: pointer;
}

.smb-select:focus {
  border-color: rgba(45, 212, 191, 0.42);
}

.smb-toggle {
  grid-template-columns: 64px auto 1fr;
}

.smb-toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.smb-toggle.disabled {
  opacity: 0.5;
}

.smb-switch {
  position: relative;
  width: 30px;
  height: 18px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.22);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.16);
  transition: background 0.15s ease, box-shadow 0.15s ease;
  flex: 0 0 auto;
}

.smb-switch::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #cbd5e1;
  transition: transform 0.15s ease, background 0.15s ease;
}

.smb-toggle input:checked + .smb-switch {
  background: rgba(45, 212, 191, 0.28);
  box-shadow: inset 0 0 0 1px rgba(45, 212, 191, 0.42);
}

.smb-toggle input:checked + .smb-switch::after {
  transform: translateX(12px);
  background: #5eead4;
}
</style>
