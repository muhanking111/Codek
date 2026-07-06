/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue"

  const component: DefineComponent<object, object, object>
  export default component
}

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface CodekSpawnResult {
  pid: number
  [key: string]: unknown
}

interface LspServerStartConfig {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

interface CodekLspAPI {
  start(serverId: string, config: LspServerStartConfig): Promise<void>
  stop(serverId: string): Promise<void>
  send(serverId: string, message: string): void
  onMessage(callback: (payload: string | { serverId?: string; message?: string }) => void): () => void
}

interface CodekDapAPI {
  start(adapterType: string, config: Record<string, unknown>): Promise<string | { sessionId?: string; pid?: number; adapterType?: string }>
  stop(sessionId: string): Promise<void>
  send(sessionId: string, message: string): Promise<void>
  onEvent(callback: (payload: string | { sessionId?: string; message?: string }) => void): () => void
}

type CodekOAuthProvider = "github"

type CodekReadFileLargeResult = {
  content: string
  size?: number
  bytesRead?: number
  limit?: number
  previewBytes?: number
  offset?: number
  truncated?: boolean
  path?: string
} | {
  error: "FILE_TOO_LARGE"
  size?: number
  limit?: number
  previewBytes?: number
  path?: string
}

type CodekReadFileOptions = {
  allowMissing?: boolean
  maxBytes?: number
  previewBytes?: number
  offset?: number
  length?: number
  preview?: boolean
}

type CodekLargeFileSegmentPatchPlan = {
  path: string
  offset: number
  deleteBytes: number
  insertText: string
  expectedSize: number
  expectedHash: string
  nextSize: number
  safety: "safe-segment-replace"
}

type CodekSearchProgress = {
  type?: "message"
  message?: string
  stage?: string
  detail?: Record<string, unknown>
  elapsedMs?: number
}

type CodekUserDataProfileChangeEvent = {
  version?: number
  reason?: string
  path?: string
  activeProfileId?: string
  profileIds?: string[]
  profileCount?: number
  workspace?: string
  workspaceProfileId?: string
  profileAssociations?: {
    workspaces?: Record<string, string>
    emptyWindows?: Record<string, string>
  }
}

type CodekUserSettingsChangeEvent = {
  version?: number
  reason?: string
  path?: string
  changedKeys?: string[]
  settings?: Record<string, unknown>
}

type CodekSearchFilesHandle = {
  requestId?: string
  promise: Promise<unknown>
  cancel: () => void
} | (Promise<unknown> & {
  requestId?: string
  promise?: Promise<unknown>
  cancel?: () => void
})

type CodekMcpResourceUpdateEvent = {
  serverName?: string
  uri?: string
}

type CodekMcpResourceSubscription = {
  ready?: boolean
  reason?: string
  retryMode?: "active" | "manual" | "closed" | string
  retryAfter?: string
  lastEventId?: string
  channelStatus?: "idle" | "connecting" | "open" | "closed" | "error" | string
  reconnectRequested?: boolean
  userActionRequired?: boolean
  noAutoRetry?: boolean
  dispose?: () => void | Promise<void>
}

type CodekExtHostMessagePayload = {
  requestId?: string
  severity?: string
  message?: string
  options?: Record<string, unknown>
  commands?: Array<{ title: string; handle: number; isCloseAffordance?: boolean }>
  actions?: string[]
}

type CodekExtHostQuickPickPayload = {
  instance: number | string
  options?: Record<string, unknown>
  params?: Record<string, unknown>
  items?: Array<Record<string, unknown>>
}

type CodekExtHostQuickPickItemsPayload = {
  instance: number | string
  items?: Array<Record<string, unknown>>
}

type CodekExtHostInputPayload = {
  instanceId: string
  options?: Record<string, unknown>
  validateInput?: boolean
}

type CodekExtHostOutputRegisterPayload = {
  channelId?: string
  label?: string
  languageId?: string
  file?: {
    scheme?: string
    path?: string
  }
}

type CodekExtHostOutputUpdatePayload = {
  channelId?: string
  mode?: number | string
  till?: number
}

type CodekExtHostOutputContentPayload = {
  channelId?: string
  content?: string
  mode?: number | string
  till?: number
}

type CodekExtHostOutputChannelPayload = {
  channelId?: string
  preserveFocus?: boolean
}

type CodekExtHostProgressStartPayload = {
  handle?: number | string
  location?: number | string
  title?: string
  cancellable?: boolean
  extensionId?: string
}

type CodekExtHostProgressReportPayload = {
  handle?: number | string
  message?: string | {
    message?: string
    increment?: number
    total?: number
    worked?: number
  }
}

type CodekExtHostProgressEndPayload = {
  handle?: number | string
}

type CodekExtHostTaskProviderEvidencePayload = {
  handle?: number | string
  type?: string
  source?: string
  stateSource?: string
  taskCount?: number
}

type CodekExtHostTaskProviderProvidePayload = CodekExtHostTaskProviderEvidencePayload & {
  tasks?: Array<Record<string, unknown>>
}

type CodekFileDialogFilter = {
  name: string
  extensions: string[]
}

type CodekOpenFileDialogOptions = {
  title?: string
  filters?: CodekFileDialogFilter[]
  readContent?: boolean
}

type CodekSaveFileDialogOptions = {
  title?: string
  defaultPath?: string
  filters?: CodekFileDialogFilter[]
}

type CodekFileDialogResult = {
  path?: string
  filePath?: string
  content?: string
} | null

type CodekWindowCloseRequest = {
  requestId?: string
  source?: string
  force?: boolean
  decision?: "allow" | "cancel" | "confirm" | "force"
  isQuitting?: boolean
}

type CodekWindowCloseDecision = {
  requestId?: string
  source?: string
  decision?: "allow" | "cancel" | "confirm" | "force" | string
  allowed?: boolean
  cancelled?: boolean
  forced?: boolean
  dirtyCount?: number
  risk?: string
  evidence?: unknown
  backupArtifactPaths?: string[]
  [key: string]: unknown
}

interface CodekReadFile {
  (path: string): Promise<string | null | undefined>
  (path: string, options: CodekReadFileOptions): Promise<string | CodekReadFileLargeResult | null | undefined>
}

interface CodekAPI {
  [key: string]: unknown
  api(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
    options?: { startupTimeoutMs?: number; signal?: AbortSignal },
  ): Promise<unknown>
  onLlmChunk?(callback: (payload: { requestId: string; content?: string; done?: boolean; error?: string }) => void): () => void
  subscribeMcpResource?(
    serverName: string,
    uri: string,
    callback: (event: CodekMcpResourceUpdateEvent) => void,
  ): Promise<CodekMcpResourceSubscription>
  onOpenGoal?(callback: (goalId: string) => void): () => void
  onSmokeOpenProjectPath?(callback: (payload: { root?: string; file?: string; diagnosticFile?: string }) => void): () => void
  getProjectRoot?: () => Promise<string>
  getWorkspaceState?: () => Promise<{ projectRoot?: string | null; workspaceFile?: string | null; workspaceRoots?: string[]; workspaceScaleProfile?: unknown }>
  getWorkspaceScaleProfile?: () => Promise<unknown>
  startSearchFiles?: (
    request: Record<string, unknown>,
    options?: {
      timeoutMs?: number
      onProgress?: (progress: CodekSearchProgress) => void
    },
  ) => CodekSearchFilesHandle
  openProjectPath?: (path: string) => Promise<{ projectRoot?: string | null; workspaceFile?: string | null; workspaceRoots?: string[]; workspaceScaleProfile?: unknown } | null>
  openWorkspaceFile?: () => Promise<{ projectRoot?: string | null; workspaceFile?: string | null; workspaceRoots?: string[] } | null>
  openFileDialog?: (options?: CodekOpenFileDialogOptions) => Promise<CodekFileDialogResult>
  saveFileDialog?: (options?: CodekSaveFileDialogOptions) => Promise<CodekFileDialogResult>
  addFolderToWorkspace?: () => Promise<{ projectRoot?: string | null; workspaceFile?: string | null; workspaceRoots?: string[] } | null>
  saveWorkspaceAs?: (roots: string[], settings?: Record<string, unknown>) => Promise<{ projectRoot?: string | null; workspaceFile?: string | null; workspaceRoots?: string[] } | null>
  exportDiagnostics?: () => Promise<{ path: string; payload?: unknown }>
  listProcesses?: () => Promise<unknown>
  newWindow?: (mode?: string) => Promise<unknown>
  closeWindow?: (options?: { source?: string; force?: boolean }) => Promise<unknown>
  simulateWindowCloseLifecycle?: (options?: { source?: string; force?: boolean; timeoutMs?: number }) => Promise<unknown>
  onWindowWillClose?(callback: (request: CodekWindowCloseRequest) => void): () => void
  resolveWindowClose?(requestId: string | undefined, decision: CodekWindowCloseDecision): void
  onExtHostMessage?(callback: (payload: CodekExtHostMessagePayload) => void | Promise<void>): () => void
  sendExtHostMessageResult?(payload: { requestId?: string; handle?: number }): void
  onExtHostQuickPickShow?(callback: (payload: CodekExtHostQuickPickPayload) => void | Promise<void>): () => void
  onExtHostQuickPickItems?(callback: (payload: CodekExtHostQuickPickItemsPayload) => void): () => void
  onExtHostQuickPickUpdate?(callback: (payload: CodekExtHostQuickPickPayload) => void): () => void
  onExtHostQuickPickError?(callback: (payload: { instance: number | string; error?: string }) => void): () => void
  onExtHostQuickPickDispose?(callback: (payload: { instance: number | string }) => void): () => void
  sendExtHostQuickPickResult?(payload: { instance: number | string; result?: number | number[] }): void
  onExtHostInputShow?(callback: (payload: CodekExtHostInputPayload) => void | Promise<void>): () => void
  sendExtHostInputResult?(payload: { instanceId: string; value?: string }): void
  onExtHostOutputRegister?(callback: (payload: CodekExtHostOutputRegisterPayload) => void): () => void
  onExtHostOutputContent?(callback: (payload: CodekExtHostOutputContentPayload) => void): () => void
  onExtHostOutputUpdate?(callback: (payload: CodekExtHostOutputUpdatePayload) => void): () => void
  onExtHostOutputReveal?(callback: (payload: CodekExtHostOutputChannelPayload) => void): () => void
  onExtHostOutputClose?(callback: (payload: CodekExtHostOutputChannelPayload) => void): () => void
  onExtHostOutputDispose?(callback: (payload: CodekExtHostOutputChannelPayload) => void): () => void
  onExtHostProgressStart?(callback: (payload: CodekExtHostProgressStartPayload) => void): () => void
  onExtHostProgressReport?(callback: (payload: CodekExtHostProgressReportPayload) => void): () => void
  onExtHostProgressEnd?(callback: (payload: CodekExtHostProgressEndPayload) => void): () => void
  onExtHostTaskProviderRegister?(callback: (payload: CodekExtHostTaskProviderEvidencePayload) => void): () => void
  onExtHostTaskProviderUnregister?(callback: (payload: CodekExtHostTaskProviderEvidencePayload) => void): () => void
  onExtHostTaskProviderProvide?(callback: (payload: CodekExtHostTaskProviderProvidePayload) => void): () => void
  onExtHostTaskProviderResolve?(callback: (payload: CodekExtHostTaskProviderEvidencePayload) => void): () => void
  onExtHostTaskProviderExecute?(callback: (payload: CodekExtHostTaskProviderEvidencePayload) => void | Promise<void>): () => void
  onExtHostTaskProviderExecuteBlocked?(callback: (payload: CodekExtHostTaskProviderEvidencePayload) => void): () => void
  onExtHostTaskProviderTerminateBlocked?(callback: (payload: CodekExtHostTaskProviderEvidencePayload) => void): () => void
  quit?: () => Promise<unknown>
  toggleDeveloperTools?: () => Promise<unknown>
  openLogs?: () => Promise<unknown>
  createDir?(path: string): Promise<boolean | void>
  writeFile?(path: string, content: string): Promise<boolean | void>
  patchFileSegment?(path: string, plan: CodekLargeFileSegmentPatchPlan): Promise<boolean | void>
  runCommand?: (command: string, options?: { cwd?: string; env?: Record<string, string> }) => Promise<{
    stdout?: string
    stderr?: string
    error?: string
    exitCode?: number
    timedOut?: boolean
    terminalInstanceId?: number | null
    terminalId?: number | null
    processId?: number | null
  }>
  onFileChanged?(callback: (payload: { path: string; type?: string }) => void): () => void
  onUserDataProfileChanged?(callback: (payload: CodekUserDataProfileChangeEvent) => void): () => void
  onUserSettingsChanged?(callback: (payload: CodekUserSettingsChangeEvent) => void): () => void
  onFileChange?(handler: (payload: unknown) => void): void
  offFileChange?(handler: (payload: unknown) => void): void
  readDir?(path: string, options?: { maxEntries?: number }): Promise<Array<{
    name: string
    path?: string
    isDir?: boolean
    isDirectory?: boolean
    isFile?: boolean
    size?: number
    mtime?: number
  }>>
  readFile?: CodekReadFile
  statFile?(path: string): Promise<{ exists: boolean }>
  listDir?(path: string): Promise<{ name: string; isDirectory: boolean }[]>
  extractZip?(data: ArrayBuffer, destDir: string): Promise<boolean>
  openExternal?(url: string): Promise<void | boolean>
  oauthLogin?(provider: CodekOAuthProvider): Promise<{
    success?: boolean
    error?: string
    deviceCode?: string
    userCode?: string
    verificationUri?: string
    expiresIn?: number
    interval?: number
  }>
  openEvalReport?(path: string): Promise<void | boolean>
  spawnProcess?(
    command: string,
    args: string[],
    opts: Record<string, unknown>,
  ): Promise<CodekSpawnResult>
  writeStdin?(pid: number, data: Uint8Array | string): void
  killProcess?(pid: number): void
  lsp?: CodekLspAPI
  dap?: CodekDapAPI
  dapStart?(adapterType: string, config: Record<string, unknown>): Promise<string>
  dapStop?(sessionId: string): Promise<void>
  dapSend?(sessionId: string, message: string): Promise<void>
  dapOnEvent?(callback: (message: string) => void): () => void

  "ssh:connect"?: (config: SshConfigViaIPC) => Promise<RemoteConnectionViaIPC>
  "ssh:disconnect"?: (connId: string) => Promise<boolean>
  "ssh:execute"?: (connId: string, command: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  "ssh:readFile"?: (connId: string, filePath: string) => Promise<string>
  "ssh:writeFile"?: (connId: string, filePath: string, content: string) => Promise<boolean>
  "ssh:listDir"?: (connId: string, dirPath: string) => Promise<RemoteDirEntryViaIPC[]>
  "ssh:stat"?: (connId: string, filePath: string) => Promise<RemoteFileStatViaIPC>
  "ssh:onFileWatchEvent"?: (callback: (event: RemoteWatchEventViaIPC) => void) => () => void

  "wsl:list"?: () => Promise<WslDistributionViaIPC[]>
  "wsl:connect"?: (distribution: string) => Promise<{ distribution: string; connected: boolean }>
  "wsl:execute"?: (distribution: string, command: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  "wsl:readFile"?: (distribution: string, filePath: string) => Promise<string>
  "wsl:writeFile"?: (distribution: string, filePath: string, content: string) => Promise<boolean>
  "wsl:listDir"?: (distribution: string, dirPath: string) => Promise<RemoteDirEntryViaIPC[]>

  "docker:listContainers"?: (all: boolean) => Promise<DockerContainerViaIPC[]>
  "docker:listImages"?: () => Promise<DockerImageViaIPC[]>
  "docker:startContainer"?: (id: string) => Promise<boolean>
  "docker:stopContainer"?: (id: string) => Promise<boolean>
  "docker:restartContainer"?: (id: string) => Promise<boolean>
  "docker:removeContainer"?: (id: string) => Promise<boolean>
  "docker:containerLogs"?: (id: string, tail: number) => Promise<string>
  "docker:execInContainer"?: (id: string, command: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  "docker:composeUp"?: (composePath: string) => Promise<boolean>
  "docker:composeDown"?: (composePath: string) => Promise<boolean>
  "docker:composePs"?: (composePath: string) => Promise<DockerComposeServiceViaIPC[]>
  "docker:parseDockerfile"?: (filePath: string) => Promise<DockerfileInstructionViaIPC[]>
}

interface SshConfigViaIPC {
  host: string
  port: number
  username: string
  authType: "password" | "key"
  keyPath?: string
  password?: string
}

interface RemoteConnectionViaIPC {
  id: string
  type: "ssh" | "wsl"
  label: string
  state: "disconnected" | "connecting" | "connected" | "error"
  config: SshConfigViaIPC
  error?: string
}

interface RemoteFileStatViaIPC {
  exists: boolean
  isDirectory: boolean
  isFile: boolean
  size: number
  mtimeMs: number
}

interface RemoteDirEntryViaIPC {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  size: number
}

interface RemoteWatchEventViaIPC {
  path: string
  type: "add" | "change" | "unlink"
}

interface WslDistributionViaIPC {
  name: string
  state: "Running" | "Stopped"
  version: number
  isDefault: boolean
}

interface DockerContainerViaIPC {
  id: string
  name: string
  image: string
  status: string
  ports: string
  created: string
}

interface DockerImageViaIPC {
  id: string
  repository: string
  tag: string
  size: number
  created: string
}

interface DockerComposeServiceViaIPC {
  name: string
  image: string
  state: string
  ports: string
}

interface DockerfileInstructionViaIPC {
  instruction: string
  arguments: string
  line: number
}

interface Window {
  codek?: CodekAPI
  __codekSmokeAnalysisSnapshot?: () => Promise<unknown>
  __codekSmokeOpenAnalysisWorkspace?: (payload: { root?: string; file?: string; diagnosticFile?: string }) => Promise<boolean>
  __codekSmokeOpenExplorerWorkspace?: (payload: { root?: string; largeFile?: string; expandPaths?: string[] }) => Promise<boolean>
  __codekSmokeExplorerPerformance?: (payload: { root?: string; largeFile?: string; expandPaths?: string[] }) => Promise<unknown>
  __codekSmokeRealExplorer?: (payload: { root?: string; expandPaths?: string[] }) => Promise<unknown>
  __codekSmokeExplorerStress?: (payload: { root?: string; expandPaths?: string[] }) => Promise<unknown>
  __codekSmokeExplorerPerformanceResult?: unknown
  __codekSmokeExplorerStressResult?: unknown
  __codekSmokeExplorerPerformanceStage?: unknown
  __codekSmokeExplorerStressStage?: unknown
  __codekSmokeFileOperationBridgeReady?: boolean
  __codekSmokeFileOperationVisibilityResult?: unknown
  __codekSmokeSearchReplaceResult?: unknown
  __codekSmokeMultiRootCreateTargetResult?: unknown
  __codekSmokeNotificationActionClickResult?: unknown
  __codekSmokeWorkingCopyHotExitLifecycle?: unknown
  __codekSmokeWorkingCopyHotExitResult?: unknown
  __codekSmokeExtensionHostRuntimeBridgeReady?: boolean
  __codekSeedExtensionGalleryWorkbenchDetailForSmoke?: () => Promise<string>
  __codekSmokeWorkbenchControls?: {
    openChat?: () => Promise<unknown>
    openOutputPanel?: () => Promise<unknown>
    isChatOpen?: () => boolean
    runFileOperationVisibilitySmoke?: (payload: { root?: string }) => Promise<unknown>
    runSearchReplaceSmoke?: (payload: { root?: string }) => Promise<unknown>
    runMultiRootCreateTargetSmoke?: (payload: { appsRoot?: string; libsRoot?: string }) => Promise<unknown>
    runInlineCreateFocusSmoke?: (payload: { root?: string }) => Promise<unknown>
    [key: string]: unknown
  }
  MonacoEnvironment?: unknown
  SpeechRecognition?: new () => SpeechRecognition
  webkitSpeechRecognition?: new () => SpeechRecognition
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  abort(): void
  start(): void
  stop(): void
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
}
