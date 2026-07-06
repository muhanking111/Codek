import { computed, onBeforeUnmount, onMounted, reactive } from "vue"
import {
  aiProviderState,
  fetchModelsForType,
  getActiveModel,
  getActiveProviderInfo,
  getActiveType,
  loadAiProviders,
  type AiProviderType,
} from "../ai/aiProviders"
import { workspace } from "../workspace/manager.js"

export type LoginStatusTone = "ready" | "warning" | "offline" | "checking"

export interface LoginStatusItem {
  id: string
  label: string
  detail: string
  tone: LoginStatusTone
}

export interface LoginCapabilityCard {
  title: string
  value: string
  detail: string
  tone: LoginStatusTone
}

interface WorkspaceBridgeState {
  projectRoot?: string | null
  workspaceFile?: string | null
  workspaceRoots?: string[]
}

const providerLabels: Record<AiProviderType, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  claude: "Anthropic",
}

function normalizePath(value?: string | null): string {
  return String(value || "").replace(/\\/g, "/")
}

function basename(value?: string | null): string {
  const normalized = normalizePath(value).replace(/\/+$/, "")
  return normalized.split("/").filter(Boolean).pop() || "未打开项目"
}

export function useLoginProjectStatus() {
  const state = reactive({
    checking: true,
    apiAvailable: false,
    schedulerOnline: false,
    devServerRunning: false,
    devServerType: "",
    workspaceFromBridge: null as WorkspaceBridgeState | null,
    lastUpdatedAt: 0,
  })

  let refreshTimer: number | undefined

  const workspaceRoots = computed(() => {
    const bridgeRoots = state.workspaceFromBridge?.workspaceRoots || []
    if (bridgeRoots.length) return bridgeRoots
    if (workspace.workspaceRoots.length) return workspace.workspaceRoots
    return workspace.projectRoot ? [workspace.projectRoot] : []
  })

  const projectRoot = computed(() => (
    state.workspaceFromBridge?.projectRoot
    || workspace.projectRoot
    || workspaceRoots.value[0]
    || ""
  ))

  const workspaceFile = computed(() => (
    state.workspaceFromBridge?.workspaceFile || workspace.workspaceFile || ""
  ))

  const projectName = computed(() => basename(projectRoot.value))
  const modelType = computed(() => getActiveType())
  const modelName = computed(() => getActiveModel())
  const providerInfo = computed(() => getActiveProviderInfo())
  const modelCount = computed(() => aiProviderState.modelsByType[modelType.value]?.length || 0)
  const modelFetching = computed(() => aiProviderState.fetchingType === modelType.value)

  const serviceItems = computed<LoginStatusItem[]>(() => [
    {
      id: "api",
      label: "桌面 API",
      detail: state.apiAvailable ? "主进程桥接已连接" : "等待桌面桥接",
      tone: state.checking ? "checking" : state.apiAvailable ? "ready" : "offline",
    },
    {
      id: "workspace",
      label: "工作区",
      detail: projectRoot.value
        ? `${projectName.value}${workspaceRoots.value.length > 1 ? ` 等 ${workspaceRoots.value.length} 个根目录` : ""}`
        : "登录后可打开项目",
      tone: projectRoot.value ? "ready" : "warning",
    },
    {
      id: "model",
      label: providerLabels[modelType.value] || "智能模型",
      detail: modelName.value || (modelFetching.value ? "正在读取模型列表" : "未选择模型"),
      tone: modelFetching.value
        ? "checking"
        : modelName.value || modelCount.value > 0
          ? "ready"
          : "warning",
    },
    {
      id: "runtime",
      label: "任务运行时",
      detail: state.schedulerOnline
        ? state.devServerRunning
          ? `${state.devServerType || "dev server"} 正在运行`
          : "调度器可用"
        : "调度器状态待确认",
      tone: state.checking ? "checking" : state.schedulerOnline ? "ready" : "warning",
    },
  ])

  const readyCount = computed(
    () => serviceItems.value.filter((item) => item.tone === "ready").length,
  )
  const warningCount = computed(
    () => serviceItems.value.filter((item) => item.tone === "warning").length,
  )

  const heroSubtitle = computed(() => {
    if (projectRoot.value) {
      return `即将恢复 ${projectName.value} 的工作区上下文、模型配置和工具状态。`
    }
    return "登录后会恢复最近项目、模型配置、插件偏好和工程协作能力。"
  })

  const workspaceSummary = computed(() => {
    if (!projectRoot.value) return "暂无打开的项目"
    if (workspaceFile.value) return `${projectName.value} · 工作区文件已加载`
    return `${projectName.value} · 单项目工作区`
  })

  const capabilityCards = computed<LoginCapabilityCard[]>(() => [
    {
      title: "项目上下文",
      value: projectRoot.value ? projectName.value : "待选择",
      detail: projectRoot.value
        ? normalizePath(projectRoot.value)
        : "登录后从最近项目或打开目录开始",
      tone: projectRoot.value ? "ready" : "warning",
    },
    {
      title: "模型供应商",
      value: providerInfo.value?.name || providerLabels[modelType.value] || "未配置",
      detail: modelName.value || `${modelCount.value} 个可用模型`,
      tone: modelName.value || modelCount.value > 0 ? "ready" : "warning",
    },
    {
      title: "服务状态",
      value: `${readyCount.value}/${serviceItems.value.length} 在线`,
      detail: warningCount.value ? `${warningCount.value} 项需要进入应用后确认` : "核心能力可用",
      tone: warningCount.value ? "warning" : "ready",
    },
  ])

  async function refresh() {
    state.checking = true
    const codek = typeof window !== "undefined" ? window.codek : undefined
    state.apiAvailable = Boolean(codek?.api)

    try {
      if (codek?.getWorkspaceState) {
        state.workspaceFromBridge = await codek.getWorkspaceState()
      }
    } catch {
      state.workspaceFromBridge = null
    }

    try {
      if (codek?.api) {
        const scheduler = await codek.api("GET", "/api/scheduler/state", null, undefined, { startupTimeoutMs: 250 })
        state.schedulerOnline = Boolean(scheduler)
      }
    } catch {
      state.schedulerOnline = false
    }

    try {
      if (codek?.api) {
        const devServer = (await codek.api("GET", "/api/dev-server/status", null, undefined, { startupTimeoutMs: 250 })) as {
          running?: boolean
          type?: string
        } | null
        state.devServerRunning = Boolean(devServer?.running)
        state.devServerType = devServer?.type || ""
      }
    } catch {
      state.devServerRunning = false
      state.devServerType = ""
    }

    try {
      loadAiProviders()
      void fetchModelsForType(getActiveType())
    } catch {
      // Model configuration is optional on the login page.
    }

    state.lastUpdatedAt = Date.now()
    state.checking = false
  }

  onMounted(() => {
    void refresh()
    refreshTimer = window.setInterval(() => {
      void refresh()
    }, 12_000)
  })

  onBeforeUnmount(() => {
    if (refreshTimer) window.clearInterval(refreshTimer)
  })

  return {
    state,
    serviceItems,
    capabilityCards,
    projectRoot,
    projectName,
    workspaceFile,
    workspaceRoots,
    workspaceSummary,
    heroSubtitle,
    modelName,
    modelType,
    readyCount,
    refresh,
  }
}
