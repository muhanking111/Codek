import { reactive, ref, type Ref } from "vue"
import { getWorkbenchSettings } from "../settings/workbenchSettings"

interface WorkbenchLayoutOptions {
  bottomPanelHeight: Ref<number>
}

function applyPanelWidthVariable(panelLocation: string, bottomPanelHeight: Ref<number>): void {
  if (panelLocation === "left" || panelLocation === "right") {
    document.documentElement.style.setProperty("--codek-side-panel-width", `${bottomPanelHeight.value}px`)
  }
}

export function useWorkbenchLayout(options: WorkbenchLayoutOptions) {
  const workbench = reactive(getWorkbenchSettings())
  const activeView = ref("files")
  const sidebarVisible = ref(false)
  const chatOpen = ref(false)

  function applyWorkbenchSettings(): void {
    Object.assign(workbench, getWorkbenchSettings())
    applyPanelWidthVariable(workbench.panelDefaultLocation, options.bottomPanelHeight)
  }

  function openSidebarView(view = "files"): void {
    activeView.value = view || "files"
    sidebarVisible.value = true
  }

  function toggleSidebarView(view = "files"): void {
    const targetView = view || "files"
    if (sidebarVisible.value && activeView.value === targetView) {
      sidebarVisible.value = false
      return
    }
    openSidebarView(targetView)
  }

  function toggleSidebarVisibility(): void {
    if (sidebarVisible.value) {
      sidebarVisible.value = false
      return
    }
    openSidebarView(activeView.value || "files")
  }

  function openSettingsView(): void {
    activeView.value = "settings"
    sidebarVisible.value = false
  }

  function toggleChatPanel(): void {
    chatOpen.value = !chatOpen.value
  }

  function closeAllPanels(): void {
    sidebarVisible.value = false
    chatOpen.value = false
  }

  return {
    workbench,
    activeView,
    sidebarVisible,
    chatOpen,
    applyWorkbenchSettings,
    openSidebarView,
    toggleSidebarView,
    toggleSidebarVisibility,
    openSettingsView,
    toggleChatPanel,
    closeAllPanels,
  }
}
