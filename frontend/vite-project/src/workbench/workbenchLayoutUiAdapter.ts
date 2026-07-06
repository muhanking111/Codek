import { resolveProductIcon } from "./productIcons"
import type {
  CodekSidebarViewId,
  WorkbenchActivityContainerModel,
  WorkbenchLayoutSnapshot,
} from "./workbenchLayoutModel"

export interface WorkbenchActivityButtonUiModel extends WorkbenchActivityContainerModel {
  iconFallback: string
  smokeId: string
  ariaLabel: string
  tooltip: string
}

export interface WorkbenchSidebarViewUiModel {
  id: string
  name: string
  description: string
  source: WorkbenchLayoutSnapshot["parts"]["sideBar"]["views"][number]["source"]
}

export interface WorkbenchSidebarUiModel extends Omit<WorkbenchLayoutSnapshot["parts"]["sideBar"], "views"> {
  views: WorkbenchSidebarViewUiModel[]
  emptyStateTitle: string
  emptyStateDescription: string
}

export interface WorkbenchEditorPartUiModel {
  activeGroupId: string
  activeEditor: string | null
  groups: WorkbenchLayoutSnapshot["parts"]["editorPart"]["groups"]
  split: WorkbenchLayoutSnapshot["parts"]["editorPart"]["split"]
  splitOpen: boolean
  totalEditors: number
  dirtyCount: number
  pinnedCount: number
  previewCount: number
  overflowCount: number
  overflow: boolean
}

export interface WorkbenchLayoutUiModel {
  activityButtons: WorkbenchActivityButtonUiModel[]
  sidebar: WorkbenchSidebarUiModel
  panel: WorkbenchLayoutSnapshot["parts"]["panel"]
  editorPart: WorkbenchEditorPartUiModel
  titleBar: WorkbenchLayoutSnapshot["parts"]["titleBar"]
  statusBar: WorkbenchLayoutSnapshot["parts"]["statusBar"]
  commandSurface: WorkbenchLayoutSnapshot["parts"]["commandSurface"]
}

const SMOKE_IDS_BY_CONTAINER_ID: Record<string, string> = {
  "claude-sidebar-secondary": "open-claude-code",
  "workbench.view.explorer": "open-explorer",
  "workbench.view.search": "open-search",
  "workbench.view.scm": "open-source-control",
  "workbench.view.debug": "open-debug",
  "workbench.view.extensions": "open-extensions",
  "workbench.view.mcp": "open-mcp",
  "workbench.view.testing": "open-testing",
  "workbench.view.settings": "open-settings",
  "codek.view.agentEvidence": "open-agent-evidence",
  "codek.view.extensionTrustRemoteAuth": "open-extension-trust-remote-auth",
  "codek.view.symbols": "open-symbols",
  "codek.view.agent": "open-agent",
  "codek.view.automation": "open-automation",
  "codek.view.remote": "open-remote",
}

const SMOKE_IDS_BY_VIEW_ID: Record<string, string> = {
  claudeVSCodeSidebarSecondary: "open-claude-code",
  files: "open-explorer",
  search: "open-search",
  symbols: "open-symbols",
  changes: "open-source-control",
  marketplace: "open-extensions",
  mcp: "open-mcp",
  goals: "open-agent",
  remote: "open-remote",
  settings: "open-settings",
  debug: "open-debug",
  automation: "open-automation",
  testing: "open-testing",
  agentEvidence: "open-agent-evidence",
}

const DEFAULT_ACTIVITY_BAR_CONTAINER_IDS = new Set([
  "workbench.view.explorer",
  "workbench.view.search",
  "workbench.view.scm",
  "workbench.view.extensions",
  "codek.view.symbols",
  "workbench.view.mcp",
  "codek.view.agent",
  "workbench.view.settings",
])

const ACTIVITY_ICON_BY_CONTAINER_ID: Record<string, string> = {
  "claude-sidebar": "assistant-panel",
  "claude-sidebar-secondary": "assistant-panel",
  "claude-sessions-sidebar": "assistant-panel",
  "workbench.view.mcp": "plug",
  "codek.view.agentEvidence": "agent-evidence",
  "codek.view.extensionTrustRemoteAuth": "shield",
}

const CONTAINER_TITLE_BY_ID: Record<string, string> = {
  "workbench.view.explorer": "资源管理器",
  "workbench.view.search": "搜索",
  "workbench.view.scm": "源代码管理",
  "workbench.view.debug": "运行和调试",
  "workbench.view.extensions": "扩展",
  "workbench.view.mcp": "MCP",
  "workbench.view.testing": "测试",
  "workbench.view.settings": "设置",
  "codek.view.symbols": "符号",
  "codek.view.agent": "智能体",
  "codek.view.automation": "自动化",
  "codek.view.remote": "远程",
  "codek.view.agentEvidence": "智能体证据",
  "codek.view.extensionTrustRemoteAuth": "扩展、信任、远程与认证",
  "claude-sidebar": "Claude Code",
  "claude-sidebar-secondary": "Claude Code",
  "claude-sessions-sidebar": "Claude Sessions",
}

const SIDEBAR_EMPTY_STATE_BY_CONTAINER_ID: Record<string, { title: string; description: string }> = {
  "workbench.view.explorer": { title: "没有打开的工作区", description: "打开项目后这里会显示文件和文件夹。" },
  "workbench.view.search": { title: "搜索工作区", description: "输入关键词后会显示文件匹配结果。" },
  "workbench.view.scm": { title: "没有检测到待处理变更", description: "源代码管理会在这里显示 Git 变更和审查项。" },
  "workbench.view.debug": { title: "运行和调试", description: "选择运行配置后会显示变量、调用栈和断点。" },
  "workbench.view.extensions": { title: "扩展", description: "搜索、安装和管理本地扩展。" },
  "workbench.view.mcp": { title: "MCP", description: "浏览 MCP 服务器、资源和插件库。" },
  "workbench.view.testing": { title: "测试", description: "发现测试后会在这里显示测试树和运行结果。" },
  "workbench.view.settings": { title: "设置", description: "调整编辑器、智能体、模型和工作区配置。" },
  "codek.view.symbols": { title: "符号", description: "打开文件后会显示大纲、项目符号和引用。" },
  "codek.view.agent": { title: "智能体", description: "查看目标、运行记录和智能体执行状态。" },
  "codek.view.automation": { title: "自动化", description: "管理本地任务、提醒和自动化运行。" },
  "codek.view.remote": { title: "远程", description: "连接 SSH 或远程工作区，并查看信任与认证状态。" },
  "codek.view.agentEvidence": { title: "智能体证据", description: "运行后会显示计划、测试、进度和证据链。" },
  "codek.view.extensionTrustRemoteAuth": { title: "扩展、信任、远程与认证", description: "查看扩展宿主、工作区信任、远程解析和认证状态。" },
}

export function buildWorkbenchLayoutUiModel(snapshot: WorkbenchLayoutSnapshot): WorkbenchLayoutUiModel {
  return {
    activityButtons: snapshot.parts.activityBar.containers
      .filter((container) => container.visible && DEFAULT_ACTIVITY_BAR_CONTAINER_IDS.has(container.containerId))
      .map(buildActivityButton),
    sidebar: buildSidebar(snapshot.parts.sideBar),
    panel: snapshot.parts.panel,
    editorPart: buildEditorPart(snapshot),
    titleBar: snapshot.parts.titleBar,
    statusBar: snapshot.parts.statusBar,
    commandSurface: snapshot.parts.commandSurface,
  }
}

export function getWorkbenchActivitySmokeId(containerId: string, activeViewId?: CodekSidebarViewId): string {
  return SMOKE_IDS_BY_CONTAINER_ID[containerId]
    || SMOKE_IDS_BY_VIEW_ID[String(activeViewId || "")]
    || `open-${String(containerId || "view").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`
}

function buildActivityButton(container: WorkbenchActivityContainerModel): WorkbenchActivityButtonUiModel {
  const icon = resolveProductIcon(resolveActivityIconId(container))
  const title = resolveContainerTitle(container.containerId, container.title)
  return {
    ...container,
    title,
    tooltip: container.tooltip || title,
    ariaLabel: title,
    codicon: container.codicon || icon.codicon,
    iconFallback: icon.fallback,
    smokeId: getWorkbenchActivitySmokeId(container.containerId, container.activeViewId),
  }
}

function resolveActivityIconId(container: WorkbenchActivityContainerModel): string | undefined {
  return ACTIVITY_ICON_BY_CONTAINER_ID[container.containerId]
    || container.icon
    || container.activeViewId
}

function buildSidebar(sidebar: WorkbenchLayoutSnapshot["parts"]["sideBar"]): WorkbenchSidebarUiModel {
  const containerId = sidebar.activeContainerId || ""
  const emptyState = SIDEBAR_EMPTY_STATE_BY_CONTAINER_ID[containerId]
  const title = resolveContainerTitle(containerId, sidebar.title)
  return {
    ...sidebar,
    title,
    emptyStateTitle: emptyState?.title || sanitizeVisibleText(sidebar.emptyStateTitle || title, "视图"),
    emptyStateDescription: emptyState?.description || sanitizeVisibleText(sidebar.emptyStateDescription, "当前视图还没有可显示的内容。"),
    views: sidebar.views.map((view) => ({
      ...view,
      name: sanitizeVisibleText(view.name, title),
      description: sanitizeVisibleText(view.description || "", ""),
    })),
  }
}

function resolveContainerTitle(containerId: string, fallback: string): string {
  if (CONTAINER_TITLE_BY_ID[containerId]) return CONTAINER_TITLE_BY_ID[containerId]
  return sanitizeVisibleText(fallback, "视图")
}

function sanitizeVisibleText(value: string | undefined, fallback: string): string {
  const text = String(value || "").trim()
  if (!text) return fallback
  if (/^[a-z]+(\.[a-z0-9-]+){2,}$/i.test(text) || /[\\/]/.test(text) || /\.(svg|png|jpg|jpeg|webp|ico)$/i.test(text)) {
    return fallback
  }
  return text
}

function buildEditorPart(snapshot: WorkbenchLayoutSnapshot): WorkbenchEditorPartUiModel {
  const editorPart = snapshot.parts.editorPart
  return {
    ...editorPart,
    splitOpen: editorPart.split.open,
    totalEditors: editorPart.totalEditors,
    dirtyCount: editorPart.dirtyCount,
    pinnedCount: editorPart.pinnedCount,
    previewCount: editorPart.previewCount,
    overflowCount: editorPart.overflow.overflowCount,
    overflow: editorPart.overflow.overflow,
  }
}
