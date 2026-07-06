interface SettingsStoreLike {
  get: <T = unknown>(key: string, fallback?: T) => T
  set: (key: string, value: unknown) => void
}

interface FormatManagerLike {
  formatOnSave?: boolean
}

export interface EditorPreferenceActionContext {
  getAutoSaveMode: () => string
  setAutoSaveMode: (mode: string) => void
  localStorage: Storage
  settingsStore: SettingsStoreLike
  getFormatOnSave: () => boolean
  setFormatOnSave: (enabled: boolean) => void
  getFormatManager: () => FormatManagerLike | null | undefined
  applyEditorOptions: () => void
  getEditor: () => any
  getMonacoApi: () => any
  setLanguagePickerVisible: (visible: boolean) => void
  setLanguagePickerQuery: (query: string) => void
  getFilteredLanguages: () => string[]
}

export function changeAutoSaveMode(mode: string, context: EditorPreferenceActionContext): void {
  context.setAutoSaveMode(mode)
  try {
    context.localStorage.setItem("codek.autoSave", mode)
  } catch {
    // Ignore storage failures; the in-memory setting already changed.
  }
}

export function toggleAutoSaveMode(context: EditorPreferenceActionContext): void {
  const nextMode = context.getAutoSaveMode() === "off" ? "afterDelay" : "off"
  changeAutoSaveMode(nextMode, context)
  context.settingsStore.set("files.autoSave", nextMode)
}

export function toggleFormatOnSave(context: EditorPreferenceActionContext): void {
  const enabled = !context.getFormatOnSave()
  context.setFormatOnSave(enabled)
  const formatManager = context.getFormatManager()
  if (formatManager) {
    formatManager.formatOnSave = enabled
  }
}

export function toggleWordWrapSetting(context: EditorPreferenceActionContext): void {
  const current = context.settingsStore.get<string>("editor.wordWrap", "off")
  context.settingsStore.set("editor.wordWrap", current === "off" ? "on" : "off")
  context.applyEditorOptions()
}

export function setEditorLanguage(langId: string, context: EditorPreferenceActionContext): void {
  const editor = context.getEditor()
  if (!editor) return
  const model = editor.getModel()
  if (model) {
    context.getMonacoApi()?.editor?.setModelLanguage?.(model, langId)
  }
  context.setLanguagePickerVisible(false)
  context.setLanguagePickerQuery("")
}

export function confirmLanguagePick(context: EditorPreferenceActionContext): void {
  const languages = context.getFilteredLanguages()
  if (languages.length > 0) {
    setEditorLanguage(languages[0], context)
  }
}
