<template>
  <div v-if="visible" class="remote-panel">
    <div class="remote-header">
      <div class="header-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        <span>远程连接</span>
      </div>
      <button class="header-btn" title="关闭" @click="$emit('close')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div v-if="manager.isRemote()" class="active-connection">
      <div class="connection-status">
        <span class="status-dot connected"></span>
        <span class="status-label">{{ manager.activeConnection?.label }}</span>
      </div>
      <button class="disconnect-btn" @click="handleDisconnect">断开连接</button>
    </div>

    <template v-else>
      <div class="connection-type-tabs">
        <button
          class="type-tab"
          :class="{ active: connectionType === 'ssh' }"
          @click="connectionType = 'ssh'"
        >
          SSH
        </button>
        <button
          class="type-tab"
          :class="{ active: connectionType === 'wsl' }"
          @click="connectionType = 'wsl'"
        >
          WSL
        </button>
      </div>

      <div v-if="connectionType === 'ssh'" class="ssh-form">
        <label class="form-field">
          <span class="field-label">主机</span>
          <input
            v-model="sshConfig.host"
            class="field-input"
            type="text"
            placeholder="192.168.1.100"
          />
        </label>
        <div class="form-row">
          <label class="form-field flex-1">
            <span class="field-label">端口</span>
            <input
              v-model.number="sshConfig.port"
              class="field-input"
              type="number"
              :min="1"
              :max="65535"
            />
          </label>
          <label class="form-field flex-2">
            <span class="field-label">用户名</span>
            <input
              v-model="sshConfig.username"
              class="field-input"
              type="text"
              placeholder="root"
            />
          </label>
        </div>
        <label class="form-field">
          <span class="field-label">认证方式</span>
          <select v-model="sshConfig.authType" class="field-input">
            <option value="password">密码</option>
            <option value="key">密钥文件</option>
          </select>
        </label>
        <label v-if="sshConfig.authType === 'password'" class="form-field">
          <span class="field-label">密码</span>
          <input
            v-model="sshConfig.password"
            class="field-input"
            type="password"
            placeholder="输入密码"
          />
        </label>
        <label v-else class="form-field">
          <span class="field-label">密钥路径</span>
          <input
            v-model="sshConfig.keyPath"
            class="field-input"
            type="text"
            placeholder="~/.ssh/id_rsa"
          />
        </label>
        <div class="form-actions">
          <button
            class="action-btn primary"
            :disabled="!isSshFormValid || manager.isConnecting"
            @click="handleSshConnect"
          >
            {{ manager.isConnecting ? '连接中...' : '连接' }}
          </button>
          <button
            class="action-btn ghost"
            :disabled="!isSshFormValid"
            @click="handleSaveSsh"
          >
            保存
          </button>
        </div>
      </div>

      <div v-else class="wsl-section">
        <div v-if="wslLoading" class="wsl-loading">
          <span class="spinner"></span>
          <span>正在检测 WSL 发行版...</span>
        </div>
        <div v-else-if="wslDistributions.length === 0" class="wsl-empty">
          <span>未检测到 WSL 发行版</span>
          <span class="hint">请先安装 WSL 和 Linux 发行版</span>
        </div>
        <div v-else class="wsl-list">
          <button
            v-for="dist in wslDistributions"
            :key="dist.name"
            class="wsl-item"
            @click="handleWslConnect(dist.name)"
          >
            <span class="dist-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </span>
            <span class="dist-info">
              <span class="dist-name">{{ dist.name }}</span>
              <span class="dist-meta">WSL {{ dist.version }}</span>
            </span>
            <span class="dist-state" :class="{ running: dist.state === 'Running' }">
              {{ dist.state === 'Running' ? '运行中' : '已停止' }}
            </span>
          </button>
        </div>
      </div>

      <div v-if="manager.savedConnections.length > 0" class="saved-section">
        <button class="section-header" @click="savedExpanded = !savedExpanded">
          <span class="chevron" :class="{ open: savedExpanded }">&#x25B6;</span>
          <span class="section-label">已保存的连接</span>
          <span class="section-count">{{ manager.savedConnections.length }}</span>
        </button>
        <div v-if="savedExpanded" class="saved-list">
          <div
            v-for="conn in manager.savedConnections"
            :key="conn.id"
            class="saved-item"
          >
            <button class="saved-info" @click="handleConnectSaved(conn)">
              <span class="saved-type-badge" :class="conn.type">{{ conn.type.toUpperCase() }}</span>
              <span class="saved-label">{{ conn.label }}</span>
            </button>
            <button class="saved-remove" @click="handleRemoveSaved(conn.id)">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </template>

    <div v-if="errorMessage" class="error-banner">
      <span class="error-text">{{ errorMessage }}</span>
      <button class="error-dismiss" @click="errorMessage = ''">&#x2715;</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue"
import { getRemoteManager } from "../remote/remoteManager"
import type { SavedConnection } from "../remote/remoteManager"
import type { SshConfig } from "../remote/sshClient"
import type { WslDistribution } from "../remote/wslClient"

defineProps<{
  visible: boolean
}>()

defineEmits<{
  close: []
}>()

const manager = getRemoteManager()

const connectionType = ref<"ssh" | "wsl">("ssh")
const savedExpanded = ref(true)
const errorMessage = ref("")
const wslDistributions = ref<WslDistribution[]>([])
const wslLoading = ref(false)

const sshConfig = reactive<SshConfig>({
  host: "",
  port: 22,
  username: "",
  authType: "password",
  keyPath: "",
  password: "",
})

const isSshFormValid = computed((): boolean => {
  if (!sshConfig.host.trim() || !sshConfig.username.trim()) return false
  if (sshConfig.authType === "password" && !sshConfig.password) return false
  if (sshConfig.authType === "key" && !sshConfig.keyPath) return false
  return true
})

async function handleSshConnect(): Promise<void> {
  errorMessage.value = ""
  try {
    await manager.connect("ssh", { ...sshConfig })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "SSH 连接失败"
  }
}

function handleSaveSsh(): void {
  const label = `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`
  manager.saveConnection({
    type: "ssh",
    label,
    sshConfig: { ...sshConfig, password: undefined },
  })
}

async function handleWslConnect(distribution: string): Promise<void> {
  errorMessage.value = ""
  try {
    await manager.connect("wsl", distribution)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "WSL 连接失败"
  }
}

async function handleDisconnect(): Promise<void> {
  try {
    await manager.disconnect()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "断开连接失败"
  }
}

async function handleConnectSaved(conn: SavedConnection): Promise<void> {
  errorMessage.value = ""
  try {
    if (conn.type === "ssh" && conn.sshConfig) {
      await manager.connect("ssh", conn.sshConfig)
    } else if (conn.type === "wsl" && conn.wslDistribution) {
      await manager.connect("wsl", conn.wslDistribution)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "连接失败"
  }
}

function handleRemoveSaved(id: string): void {
  manager.removeConnection(id)
}

async function loadWslDistributions(): Promise<void> {
  wslLoading.value = true
  try {
    wslDistributions.value = await manager.listWslDistributions()
  } catch {
    wslDistributions.value = []
  } finally {
    wslLoading.value = false
  }
}

onMounted(() => {
  void loadWslDistributions()
})
</script>

<style scoped>
.remote-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-deepest);
  font-family: var(--font-sans);
  overflow-y: auto;
}

.remote-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
  flex-shrink: 0;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-bright);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

.header-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.header-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.active-connection {
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.connected {
  background: var(--green);
  box-shadow: 0 0 6px rgba(52, 211, 153, 0.4);
}

.status-label {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
}

.disconnect-btn {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--red);
  font-size: 12px;
  cursor: pointer;
  font-family: var(--font-sans);
}

.disconnect-btn:hover {
  background: rgba(248, 113, 113, 0.1);
  border-color: var(--red);
}

.connection-type-tabs {
  display: flex;
  padding: 8px 12px 0;
  gap: 2px;
}

.type-tab {
  flex: 1;
  padding: 7px 0;
  border: none;
  background: var(--bg-dark);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  border-radius: 6px 6px 0 0;
  font-family: var(--font-sans);
}

.type-tab.active {
  background: var(--bg-panel);
  color: var(--accent);
}

.ssh-form {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.form-row {
  display: flex;
  gap: 8px;
}

.flex-1 { flex: 1; }
.flex-2 { flex: 2; }

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.field-input {
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-primary);
  padding: 7px 10px;
  font-size: 12px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  outline: none;
  width: 100%;
}

.field-input:focus {
  border-color: var(--accent);
}

.field-input::placeholder {
  color: var(--text-muted);
}

.form-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.action-btn {
  flex: 1;
  padding: 8px 0;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: var(--font-sans);
}

.action-btn.primary {
  background: var(--accent);
  color: #0d0e10;
}

.action-btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}

.action-btn.primary:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.action-btn.ghost {
  background: var(--bg-hover);
  color: var(--text-primary);
  border: 1px solid var(--border);
}

.action-btn.ghost:hover:not(:disabled) {
  background: var(--bg-active);
}

.action-btn.ghost:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.wsl-section {
  padding: 12px;
}

.wsl-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 0;
  color: var(--text-muted);
  font-size: 12px;
  justify-content: center;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.wsl-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 24px 0;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.hint {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.7;
}

.wsl-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wsl-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-dark);
  color: var(--text-primary);
  cursor: pointer;
  width: 100%;
  text-align: left;
  font-family: var(--font-sans);
  transition: border-color 0.15s, background 0.15s;
}

.wsl-item:hover {
  border-color: var(--accent);
  background: var(--bg-panel);
}

.dist-icon {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.dist-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.dist-name {
  font-size: 12px;
  font-weight: 500;
}

.dist-meta {
  font-size: 10px;
  color: var(--text-muted);
}

.dist-state {
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 600;
  background: rgba(90, 94, 106, 0.15);
  color: var(--text-muted);
}

.dist-state.running {
  background: rgba(52, 211, 153, 0.12);
  color: var(--green);
}

.saved-section {
  border-top: 1px solid var(--border-subtle);
  margin-top: 8px;
}

.section-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  font-family: var(--font-sans);
  text-transform: uppercase;
}

.section-header:hover {
  background: var(--bg-hover);
}

.chevron {
  font-size: 7px;
  color: var(--text-muted);
  transition: transform 0.15s;
}

.chevron.open {
  transform: rotate(90deg);
}

.section-label {
  flex: 1;
  text-align: left;
}

.section-count {
  color: var(--text-muted);
  font-size: 9px;
}

.saved-list {
  padding: 2px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.saved-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 4px;
}

.saved-item:hover {
  background: var(--bg-hover);
}

.saved-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  border: none;
  background: none;
  color: var(--text-primary);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  padding: 0;
  font-family: var(--font-sans);
}

.saved-type-badge {
  font-size: 8px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  letter-spacing: 0.5px;
}

.saved-type-badge.ssh {
  background: rgba(45, 212, 191, 0.12);
  color: var(--accent);
}

.saved-type-badge.wsl {
  background: rgba(96, 165, 250, 0.12);
  color: #60a5fa;
}

.saved-label {
  color: var(--text-secondary);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.saved-remove {
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px;
  opacity: 0;
  display: flex;
  align-items: center;
}

.saved-item:hover .saved-remove {
  opacity: 1;
}

.saved-remove:hover {
  color: var(--red);
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(248, 113, 113, 0.08);
  border-top: 1px solid rgba(248, 113, 113, 0.2);
  margin-top: auto;
}

.error-text {
  flex: 1;
  color: var(--red);
  font-size: 11px;
}

.error-dismiss {
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 10px;
}

.error-dismiss:hover {
  color: var(--red);
}
</style>
