import {
  buildMonacoEditorCreateOptions,
  resolveInitialEditorModel,
} from "./editorModelLifecycle"

interface WorkspaceLike {
  activeFile?: string | null
  files: Record<string, unknown>
}

interface EditorFeaturesLike {
  createEditorContextMenu?: (editor: any, buildItems: (context: any) => any[]) => any
}

export interface SplitEditorLifecycleContext {
  getSplitEditor: () => any
  setSplitEditor: (editor: any) => void
  getSplitEditorContainer: () => HTMLElement | null | undefined
  ensureMonaco: () => Promise<any>
  getTheme: () => string
  getEditorOptions: () => any
  setMinimapEnabled: (enabled: boolean) => void
  setEditorFontSize: (size: number) => void
  getWorkspace: () => WorkspaceLike
  setSplitFile: (path: string | null) => void
  getSplitFile: () => string | null
  updateFile: (path: string, content: string, options?: Record<string, unknown>) => void
  detectLanguage: (path: string) => string
  isReadOnlyFile?: (path: string) => boolean
  attachFormatOnPaste: (editor: any) => void
  loadEditorFeatureModules: () => Promise<EditorFeaturesLike>
  installEditorContextMenu: (editor: any, features: EditorFeaturesLike) => any
  setSplitContextMenuDisposable: (disposable: any) => void
}

export async function initSplitEditor(context: SplitEditorLifecycleContext): Promise<void> {
  if (context.getSplitEditor() || !context.getSplitEditorContainer()) return

  const monacoLib = await context.ensureMonaco()
  const container = context.getSplitEditorContainer()
  if (!container) return

  const editorSettingOptions = context.getEditorOptions()
  context.setMinimapEnabled(Boolean(editorSettingOptions.minimap?.enabled))
  context.setEditorFontSize(editorSettingOptions.fontSize)

  const workspace = context.getWorkspace()
  const initialModel = resolveInitialEditorModel({
    activeFile: workspace.activeFile,
    files: workspace.files,
    defaultValue: "",
    detectLanguage: context.detectLanguage,
  })

  const splitEditor = monacoLib.editor.create(container, buildMonacoEditorCreateOptions({
    value: initialModel.value,
    language: initialModel.language,
    theme: context.getTheme(),
    settingsOptions: {
      ...editorSettingOptions,
      readOnly: workspace.activeFile ? context.isReadOnlyFile?.(workspace.activeFile) === true : false,
    },
  }))
  context.setSplitEditor(splitEditor)
  context.attachFormatOnPaste(splitEditor)

  if (workspace.activeFile && typeof workspace.files[workspace.activeFile] === "string") {
    context.setSplitFile(workspace.activeFile)
  }

  splitEditor.onDidChangeModelContent(() => {
    const splitFile = context.getSplitFile()
    if (!splitFile) return
    if (context.isReadOnlyFile?.(splitFile)) return
    context.updateFile(splitFile, splitEditor.getValue(), { dirty: true, external: false })
  })

  const editorFeatures = await context.loadEditorFeatureModules()
  const disposable = context.installEditorContextMenu(splitEditor, editorFeatures)
  context.setSplitContextMenuDisposable(disposable || null)
}
