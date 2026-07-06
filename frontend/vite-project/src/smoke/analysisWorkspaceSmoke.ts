type SmokePayload = {
  root?: string
  file?: string
  diagnosticFile?: string
}

type SmokeSymbol = {
  name?: string
  kind?: string
}

type SmokeInstallOptions = {
  setReady: (ready: boolean) => void
  onSmokeOpenProjectPath?: (callback: (payload: SmokePayload) => void) => () => void
  handleOpenRecentProject: (path: string) => Promise<unknown>
  handleOpenFile: (path: string) => Promise<unknown>
  refreshActiveAnalysis: (path?: string) => Promise<unknown>
  refreshWorkspaceAnalysisRuntime: () => Promise<unknown>
  applyEditorDiagnostics: () => void
  openSidebarView: (view: string) => void
  openProblemsPanel: () => void
  nextTick: () => Promise<void>
  getEditor: () => { setPosition?: (position: { lineNumber: number; column: number }) => void } | null
  updateBreadcrumb: () => void
  loadAgentRuntime: () => Promise<{ buildContext: (options: Record<string, unknown>) => Promise<string> }>
  getSelectedText: () => string
  getState: () => {
    projectRoot: string
    activeFile: string
    openFiles: string[]
    currentOutline: SmokeSymbol[]
    currentDiagnostics: unknown[]
    selectedSymbol: string
    breadcrumbSymbols: SmokeSymbol[]
    breadcrumbVisible: boolean
    workspaceAnalysisLoading: boolean
    workspaceAnalysisLoadError: string
  }
}

export function installAnalysisWorkspaceSmokeBridge(options: SmokeInstallOptions): () => void {
  async function waitForAnalysisState(predicate: () => boolean, label: string, timeout = 12_000): Promise<void> {
    const started = Date.now()
    while (Date.now() - started <= timeout) {
      await options.nextTick()
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    throw new Error(`analysis smoke state timeout: ${label}`)
  }

  async function buildSmokeAnalysisContext(query = "greet") {
    const runtime = await options.loadAgentRuntime()
    const state = options.getState()
    return runtime.buildContext({
      query,
      activeFile: state.activeFile,
      selection: options.getSelectedText(),
      openFiles: state.openFiles,
      activeOutline: state.currentOutline,
      activeDiagnostics: state.currentDiagnostics,
      selectedSymbol: state.selectedSymbol,
    })
  }

  async function openSmokeAnalysisWorkspace(payload: SmokePayload = {}) {
    const root = String(payload.root || "")
    if (!root) return false
    options.setReady(false)
    await options.handleOpenRecentProject(root)

    const file = String(payload.file || "")
    if (file) {
      await options.handleOpenFile(file)
    }

    if (file) {
      await options.refreshActiveAnalysis(file)
    }

    const diagnosticFile = String(payload.diagnosticFile || "")
    if (diagnosticFile) {
      await options.refreshActiveAnalysis(diagnosticFile)
    }

    const editor = options.getEditor()
    editor?.setPosition?.({ lineNumber: 5, column: 17 })
    options.updateBreadcrumb()
    await options.refreshWorkspaceAnalysisRuntime()
    options.applyEditorDiagnostics()

    options.openSidebarView("symbols")
    options.openProblemsPanel()
    await waitForAnalysisState(() => {
      const nextState = options.getState()
      return nextState.activeFile === file
        && nextState.currentOutline.some((symbol) => symbol.name === "greet")
        && !nextState.workspaceAnalysisLoading
        && !nextState.workspaceAnalysisLoadError
    }, "outline after open")
    options.setReady(true)
    return true
  }

  async function getSmokeAnalysisSnapshot() {
    const context = await buildSmokeAnalysisContext("greet")
    const state = options.getState()
    const workspaceDiagnostics = ["src/main.ts", "src/broken.ts"]
      .flatMap((file) => (getFileAnalysis(file)?.diagnostics || []).map((diag) => ({ ...(diag as object), file })))

    return {
      projectRoot: state.projectRoot,
      activeFile: state.activeFile,
      outlineNames: state.currentOutline.map((symbol) => symbol.name),
      diagnostics: workspaceDiagnostics,
      projectSymbolNames: getProjectSymbols("greet").map((symbol) => symbol.name),
      breadcrumbSymbols: state.breadcrumbSymbols.map((symbol) => ({ name: symbol.name, kind: symbol.kind })),
      breadcrumbVisible: state.breadcrumbVisible,
      context,
      savedRefreshOk: !state.workspaceAnalysisLoading && !state.workspaceAnalysisLoadError,
    }
  }

  window.__codekSmokeAnalysisSnapshot = getSmokeAnalysisSnapshot
  window.__codekSmokeOpenAnalysisWorkspace = openSmokeAnalysisWorkspace
  const removeListener = options.onSmokeOpenProjectPath?.((payload) => {
    void openSmokeAnalysisWorkspace(payload)
  })

  return () => {
    removeListener?.()
    if (window.__codekSmokeAnalysisSnapshot === getSmokeAnalysisSnapshot) {
      delete window.__codekSmokeAnalysisSnapshot
    }
    if (window.__codekSmokeOpenAnalysisWorkspace === openSmokeAnalysisWorkspace) {
      delete window.__codekSmokeOpenAnalysisWorkspace
    }
  }
}
import { getFileAnalysis, getProjectSymbols } from "../workspace/analysisState"
