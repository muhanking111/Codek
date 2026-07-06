<template>
  <div v-if="visible" class="docker-panel">
    <div class="docker-header">
      <div class="header-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 12s-3-3-7-3-7 3-7 3 3 3 7 3 7-3 7-3z" />
          <path d="M2 12h3" />
          <path d="M8 8v2" />
          <path d="M12 8v2" />
          <path d="M16 8v2" />
          <path d="M8 12v2" />
          <path d="M12 12v2" />
          <path d="M16 12v2" />
          <path d="M5 16h14" />
        </svg>
        <span>Docker</span>
      </div>
      <div class="header-actions">
        <button class="header-btn" title="刷新" @click="handleRefresh">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" :class="{ spinning: isLoading }">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <button class="header-btn" title="关闭" @click="$emit('close')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <div class="docker-tabs">
      <button
        class="docker-tab"
        :class="{ active: activeTab === 'containers' }"
        @click="activeTab = 'containers'"
      >
        容器
        <span v-if="runningContainers.length > 0" class="tab-badge">{{ runningContainers.length }}</span>
      </button>
      <button
        class="docker-tab"
        :class="{ active: activeTab === 'images' }"
        @click="activeTab = 'images'"
      >
        镜像
      </button>
      <button
        class="docker-tab"
        :class="{ active: activeTab === 'compose' }"
        @click="activeTab = 'compose'"
      >
        Compose
      </button>
    </div>

    <div class="docker-summary">
      <div class="summary-card">
        <span>运行中</span>
        <strong>{{ runningContainers.length }}</strong>
      </div>
      <div class="summary-card">
        <span>全部容器</span>
        <strong>{{ containers.length }}</strong>
      </div>
      <div class="summary-card">
        <span>镜像</span>
        <strong>{{ images.length }}</strong>
      </div>
    </div>

    <div v-if="isLoading" class="docker-loading">
      <span class="spinner"></span>
      <span>正在加载...</span>
    </div>

    <div v-else-if="errorMessage" class="docker-error">
      <span class="error-icon">&#x26A0;</span>
      <span class="error-title">Docker 暂不可用</span>
      <span class="error-text">{{ errorMessage }}</span>
      <button class="retry-btn" @click="handleRefresh">重试</button>
    </div>

    <template v-else>
      <div v-if="activeTab === 'containers'" class="tab-content">
        <div class="filter-bar">
          <button
            class="filter-btn"
            :class="{ active: containerFilter === 'running' }"
            @click="containerFilter = 'running'"
          >
            运行中
          </button>
          <button
            class="filter-btn"
            :class="{ active: containerFilter === 'all' }"
            @click="containerFilter = 'all'"
          >
            全部
          </button>
        </div>
        <div v-if="filteredContainers.length === 0" class="empty-state">
          <span>{{ containerFilter === 'running' ? '没有运行中的容器' : '暂无容器' }}</span>
        </div>
        <div v-else class="container-list">
          <div
            v-for="container in filteredContainers"
            :key="container.id"
            class="container-item"
          >
            <div class="container-main">
              <span class="container-status-dot" :class="statusClass(container.status)"></span>
              <div class="container-info">
                <span class="container-name">{{ container.name }}</span>
                <span class="container-image">{{ container.image }}</span>
              </div>
            </div>
            <div class="container-meta">
              <span v-if="container.ports" class="container-ports">{{ container.ports }}</span>
              <span class="container-status-text" :class="statusClass(container.status)">
                {{ statusLabel(container.status) }}
              </span>
            </div>
            <div class="container-actions">
              <button
                v-if="container.status === 'running'"
                class="action-icon"
                title="停止"
                @click="handleStopContainer(container.id)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </button>
              <button
                v-if="container.status !== 'running'"
                class="action-icon play"
                title="启动"
                @click="handleStartContainer(container.id)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6,4 20,12 6,20" />
                </svg>
              </button>
              <button
                v-if="container.status === 'running'"
                class="action-icon"
                title="重启"
                @click="handleRestartContainer(container.id)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>
              <button
                class="action-icon"
                title="日志"
                @click="handleShowLogs(container.id, container.name)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </button>
              <button
                class="action-icon danger"
                title="删除"
                @click="handleRemoveContainer(container.id)"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'images'" class="tab-content">
        <div v-if="images.length === 0" class="empty-state">
          <span>暂无镜像</span>
        </div>
        <div v-else class="image-list">
          <div
            v-for="image in images"
            :key="image.id"
            class="image-item"
          >
            <div class="image-info">
              <span class="image-repo">{{ image.repository }}</span>
              <span class="image-tag">:{{ image.tag }}</span>
            </div>
            <span class="image-size">{{ formatSize(image.size) }}</span>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'compose'" class="tab-content">
        <div class="compose-path-input">
          <input
            v-model="composePath"
            class="field-input"
            type="text"
            placeholder="docker-compose.yml 路径"
          />
          <button class="compose-browse-btn" @click="$emit('browseCompose')">浏览</button>
        </div>
        <div class="compose-actions">
          <button
            class="compose-btn up"
            :disabled="!composePath.trim()"
            @click="handleComposeUp"
          >
            Up
          </button>
          <button
            class="compose-btn down"
            :disabled="!composePath.trim()"
            @click="handleComposeDown"
          >
            Down
          </button>
          <button
            class="compose-btn"
            :disabled="!composePath.trim()"
            @click="handleComposePs"
          >
            PS
          </button>
        </div>
        <div v-if="composeServices.length > 0" class="compose-services">
          <div
            v-for="svc in composeServices"
            :key="svc.name"
            class="compose-service"
          >
            <span class="svc-name">{{ svc.name }}</span>
            <span class="svc-image">{{ svc.image }}</span>
            <span class="svc-state" :class="{ running: svc.state === 'running' }">{{ svc.state }}</span>
          </div>
        </div>
        <div v-else class="empty-state">
          <span>选择 docker-compose.yml 后查看服务状态</span>
        </div>
      </div>
    </template>

    <div v-if="logsVisible" class="logs-overlay">
      <div class="logs-header">
        <span class="logs-title">{{ logsContainerName }} - 日志</span>
        <button class="logs-close" @click="logsVisible = false">&#x2715;</button>
      </div>
      <pre class="logs-content">{{ logsContent }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { getDockerClient } from "../docker/dockerClient"
import type { DockerContainer, DockerImage, DockerComposeService, ContainerStatus } from "../docker/dockerClient"

defineProps<{
  visible: boolean
}>()

defineEmits<{
  close: []
  browseCompose: []
}>()

const docker = getDockerClient()

const activeTab = ref<"containers" | "images" | "compose">("containers")
const containerFilter = ref<"running" | "all">("running")
const isLoading = ref(false)
const errorMessage = ref("")

const containers = ref<DockerContainer[]>([])
const images = ref<DockerImage[]>([])
const composePath = ref("")
const composeServices = ref<DockerComposeService[]>([])

const logsVisible = ref(false)
const logsContent = ref("")
const logsContainerName = ref("")

const runningContainers = computed((): DockerContainer[] =>
  containers.value.filter((c) => c.status === "running"),
)

const filteredContainers = computed((): DockerContainer[] => {
  if (containerFilter.value === "running") return runningContainers.value
  return containers.value
})

function statusClass(status: ContainerStatus): string {
  if (status === "running") return "running"
  if (status === "exited" || status === "dead") return "stopped"
  return "transitioning"
}

function statusLabel(status: ContainerStatus): string {
  const labels: Record<ContainerStatus, string> = {
    created: "已创建",
    running: "运行中",
    paused: "已暂停",
    restarting: "重启中",
    removing: "删除中",
    exited: "已停止",
    dead: "已终止",
  }
  return labels[status] ?? status
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

async function handleRefresh(): Promise<void> {
  isLoading.value = true
  errorMessage.value = ""
  try {
    const [containerList, imageList] = await Promise.all([
      docker.listContainers(true),
      docker.listImages(),
    ])
    containers.value = containerList
    images.value = imageList
  } catch (error) {
    errorMessage.value = normalizeDockerError(error)
  } finally {
    isLoading.value = false
  }
}

function normalizeDockerError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "")
  if (/window\.codek|IPC method|not available|unavailable/i.test(message)) {
    return "当前窗口没有可用的 Docker IPC，请用桌面应用启动 Codek。"
  }
  if (/connect|ENOENT|ECONNREFUSED|daemon|docker/i.test(message)) {
    return "未连接到 Docker Engine，请确认 Docker Desktop 已启动。"
  }
  return message || "加载 Docker 数据失败"
}

async function handleStartContainer(id: string): Promise<void> {
  try {
    await docker.startContainer(id)
    await handleRefresh()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "启动容器失败"
  }
}

async function handleStopContainer(id: string): Promise<void> {
  try {
    await docker.stopContainer(id)
    await handleRefresh()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "停止容器失败"
  }
}

async function handleRestartContainer(id: string): Promise<void> {
  try {
    await docker.restartContainer(id)
    await handleRefresh()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "重启容器失败"
  }
}

async function handleRemoveContainer(id: string): Promise<void> {
  try {
    await docker.removeContainer(id)
    await handleRefresh()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "删除容器失败"
  }
}

async function handleShowLogs(id: string, name: string): Promise<void> {
  try {
    logsContainerName.value = name
    logsContent.value = await docker.containerLogs(id, 200)
    logsVisible.value = true
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "获取日志失败"
  }
}

async function handleComposeUp(): Promise<void> {
  try {
    await docker.composeUp(composePath.value)
    await handleComposePs()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "docker compose up 失败"
  }
}

async function handleComposeDown(): Promise<void> {
  try {
    await docker.composeDown(composePath.value)
    composeServices.value = []
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "docker compose down 失败"
  }
}

async function handleComposePs(): Promise<void> {
  try {
    composeServices.value = await docker.composePs(composePath.value)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "获取 Compose 状态失败"
  }
}

onMounted(() => {
  void handleRefresh()
})
</script>

<style scoped>
.docker-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-deepest);
  font-family: var(--font-sans);
  overflow-y: auto;
}

.docker-header {
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

.header-actions {
  display: flex;
  gap: 4px;
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

.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.docker-tabs {
  display: flex;
  padding: 0 8px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-darker);
}

.docker-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 10px;
  border-bottom: 1px solid var(--border-subtle);
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-dark);
}

.summary-card span {
  color: var(--text-muted);
  font-size: 10px;
}

.summary-card strong {
  color: var(--text-bright);
  font-size: 16px;
  font-weight: 700;
}

.docker-tab {
  flex: 1;
  padding: 8px 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  font-family: var(--font-sans);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.docker-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.tab-badge {
  font-size: 9px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--accent-dim);
  color: var(--accent);
  font-weight: 600;
}

.docker-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 32px 0;
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

.docker-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 16px;
  text-align: center;
}

.error-title {
  color: var(--text-bright);
  font-size: 13px;
  font-weight: 600;
}

.error-icon {
  font-size: 20px;
  color: var(--orange);
}

.error-text {
  color: var(--text-secondary);
  font-size: 12px;
}

.retry-btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-dark);
  color: var(--text-primary);
  font-size: 11px;
  cursor: pointer;
  font-family: var(--font-sans);
}

.retry-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.tab-content {
  flex: 1;
  overflow-y: auto;
}

.filter-bar {
  display: flex;
  gap: 2px;
  padding: 8px 10px;
}

.filter-btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
  font-family: var(--font-sans);
}

.filter-btn.active {
  background: var(--accent-dim);
  color: var(--accent);
  border-color: var(--accent);
}

.empty-state {
  padding: 32px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}

.container-list {
  display: flex;
  flex-direction: column;
}

.container-item {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.container-item:hover {
  background: var(--bg-hover);
}

.container-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.container-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.container-status-dot.running {
  background: var(--green);
  box-shadow: 0 0 5px rgba(52, 211, 153, 0.35);
}

.container-status-dot.stopped {
  background: var(--text-muted);
}

.container-status-dot.transitioning {
  background: var(--orange);
}

.container-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}

.container-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.container-image {
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: "JetBrains Mono", "Fira Code", monospace;
}

.container-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 15px;
}

.container-ports {
  font-size: 10px;
  color: var(--text-secondary);
  font-family: "JetBrains Mono", "Fira Code", monospace;
}

.container-status-text {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
}

.container-status-text.running {
  background: rgba(52, 211, 153, 0.12);
  color: var(--green);
}

.container-status-text.stopped {
  background: rgba(90, 94, 106, 0.12);
  color: var(--text-muted);
}

.container-status-text.transitioning {
  background: rgba(251, 146, 60, 0.12);
  color: var(--orange);
}

.container-actions {
  display: flex;
  gap: 2px;
  padding-left: 15px;
}

.action-icon {
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

.action-icon:hover {
  background: var(--bg-active);
  color: var(--text-primary);
}

.action-icon.play {
  color: var(--green);
}

.action-icon.danger:hover {
  color: var(--red);
  background: rgba(248, 113, 113, 0.1);
}

.image-list {
  display: flex;
  flex-direction: column;
}

.image-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.image-item:hover {
  background: var(--bg-hover);
}

.image-info {
  display: flex;
  align-items: baseline;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.image-repo {
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-tag {
  font-size: 11px;
  color: var(--accent);
  flex-shrink: 0;
}

.image-size {
  font-size: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
  margin-left: 8px;
}

.compose-path-input {
  display: flex;
  gap: 6px;
  padding: 10px;
}

.field-input {
  flex: 1;
  background: var(--bg-dark);
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-primary);
  padding: 7px 10px;
  font-size: 12px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  outline: none;
}

.field-input:focus {
  border-color: var(--accent);
}

.field-input::placeholder {
  color: var(--text-muted);
}

.compose-browse-btn {
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-dark);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  font-family: var(--font-sans);
}

.compose-browse-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.compose-actions {
  display: flex;
  gap: 6px;
  padding: 0 10px 10px;
}

.compose-btn {
  flex: 1;
  padding: 7px 0;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-dark);
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  font-family: var(--font-sans);
}

.compose-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.compose-btn.up:hover:not(:disabled) {
  border-color: var(--green);
  color: var(--green);
}

.compose-btn.down:hover:not(:disabled) {
  border-color: var(--red);
  color: var(--red);
}

.compose-services {
  padding: 0 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.compose-service {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--bg-dark);
}

.svc-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  flex: 1;
}

.svc-image {
  font-size: 10px;
  color: var(--text-muted);
  font-family: "JetBrains Mono", "Fira Code", monospace;
}

.svc-state {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
  background: rgba(90, 94, 106, 0.12);
  color: var(--text-muted);
}

.svc-state.running {
  background: rgba(52, 211, 153, 0.12);
  color: var(--green);
}

.logs-overlay {
  position: absolute;
  inset: 0;
  background: var(--bg-deepest);
  display: flex;
  flex-direction: column;
  z-index: 10;
}

.logs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-panel);
}

.logs-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}

.logs-close {
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
}

.logs-close:hover {
  color: var(--text-primary);
}

.logs-content {
  flex: 1;
  overflow: auto;
  padding: 10px;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  background: var(--bg-dark);
}
</style>
