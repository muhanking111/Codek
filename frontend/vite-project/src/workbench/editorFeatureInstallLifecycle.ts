export interface EditorFeatureInstallFeatures {
  registerAllLanguageProviders?: (monaco: unknown) => void
  setupNavigationProvider?: (editor: unknown, monaco: unknown) => void
  setupDebugBreakpoints?: (editor: unknown, monaco: unknown) => void
  setupTabCompletion?: (editor: unknown, monaco: unknown) => void
}

export function installEditorCoreFeatureProviders(
  editor: unknown,
  monaco: unknown,
  features: EditorFeatureInstallFeatures,
): void {
  features.registerAllLanguageProviders?.(monaco)
  features.setupNavigationProvider?.(editor, monaco)
  features.setupDebugBreakpoints?.(editor, monaco)
}

export function installEditorCompletionFeatures(
  editor: unknown,
  monaco: unknown,
  features: EditorFeatureInstallFeatures,
): void {
  features.setupTabCompletion?.(editor, monaco)
}
