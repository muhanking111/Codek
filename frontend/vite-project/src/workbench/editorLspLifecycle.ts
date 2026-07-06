export interface EditorLspFeatures {
  initLsp?: (projectRoot: string) => Promise<boolean>
  registerMonacoLsp?: (monaco: unknown, editor: unknown) => (() => void) | { dispose?: () => void } | null | undefined
  openFile?: (path: string, content?: string) => Promise<void>
}

export interface NotifyLspFileOpenedOptions {
  timeoutMs?: number
}

export const LSP_FILE_OPEN_NOTIFY_TIMEOUT_MS = 1500

export interface StartEditorLspContext {
  projectRoot?: string | null
  monaco: unknown
  editor: unknown
  features: EditorLspFeatures
  setDetachLsp: (detach: (() => void) | { dispose?: () => void } | null) => void
}

export async function startEditorLsp(context: StartEditorLspContext): Promise<boolean> {
  const projectRoot = context.projectRoot
  if (!projectRoot || !context.features.initLsp || !context.features.registerMonacoLsp) {
    context.setDetachLsp(null)
    return false
  }

  const ok = await context.features.initLsp(projectRoot)
  if (!ok) {
    context.setDetachLsp(null)
    return false
  }

  const detach = context.features.registerMonacoLsp(context.monaco, context.editor) || null
  context.setDetachLsp(detach)
  return Boolean(detach)
}

export async function notifyLspFileOpened(
  enabled: boolean,
  features: EditorLspFeatures,
  path: string,
  content?: string,
  options: NotifyLspFileOpenedOptions = {},
): Promise<void> {
  if (!enabled || !features.openFile) return
  const notify = Promise.resolve()
    .then(() => features.openFile?.(path, content))
    .catch(() => undefined)
  await Promise.race([
    notify,
    delay(options.timeoutMs ?? LSP_FILE_OPEN_NOTIFY_TIMEOUT_MS),
  ])
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}
