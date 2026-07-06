import { api } from "../lib/api"
import type {
  ImportedWorkbenchProfileSnapshot,
  UserDataProfileTemplate,
} from "./profileStore"

export interface VsCodeImportSource {
  app: string
  label: string
  userDir: string
  exists: boolean
}

export interface VsCodeImportPreview {
  userDir: string
  id?: string
  name?: string
  profileTemplate?: UserDataProfileTemplate
  settingsCount: number
  keybindingsCount: number
  snippetsCount: number
  extensionsCount: number
  profilesCount: number
  extensions: string[]
  snippets?: Array<{ name: string; path: string }>
  profiles?: Array<{
    id: string
    name?: string
    userDir: string
    settingsCount: number
    keybindingsCount: number
    snippetsCount: number
    extensionsCount: number
  }>
}

export interface VsCodeImportResult {
  source: string
  profileId?: string
  profileName?: string
  mode: "merge" | "replace"
  profileTemplate?: UserDataProfileTemplate
  profileSnapshot?: ImportedWorkbenchProfileSnapshot
  settings: { imported: number }
  keybindings: { imported: number }
  snippets: { imported: number; skipped?: string; written?: Array<{ name: string; path: string }> }
  extensions: { imported: number; skipped?: string; manifestPath?: string }
}

export interface VsCodeProfileFileImportResult {
  filePath: string
  profileTemplate: UserDataProfileTemplate
}

export interface VsCodeProfileFileExportRequest {
  filePath: string
  template: UserDataProfileTemplate
}

export interface VsCodeProfileFileExportResult {
  filePath: string
  saved: boolean
  bytesWritten: number
}

export interface ExtensionProfileContentHandlerInfo {
  id: string
  name: string
  description?: string
  extensionId?: string
}

export interface ExtensionProfileContentHandlersResult {
  handlers?: ExtensionProfileContentHandlerInfo[]
}

export interface ExtensionProfileContentReadResult {
  success: boolean
  content?: string | null
  error?: string
}

export interface ExtensionProfileContentSaveResult {
  success: boolean
  result?: {
    id: string
    filePath?: string
    bytesWritten?: number
  } | null
  error?: string
}

export async function listVsCodeImportSources(): Promise<VsCodeImportSource[]> {
  const result = await api.get<{ sources?: VsCodeImportSource[] }>("/migration/vscode/sources")
  return result.sources || []
}

export async function previewVsCodeImport(userDir: string): Promise<VsCodeImportPreview> {
  return api.post<VsCodeImportPreview>("/migration/vscode/preview", { userDir })
}

export async function importVsCodeUserData(
  userDir: string,
  mode: "merge" | "replace" = "merge",
  profileId = "default",
): Promise<VsCodeImportResult> {
  return api.post<VsCodeImportResult>("/migration/vscode/import", {
    userDir,
    mode,
    profileId,
    sections: {
      settings: true,
      keybindings: true,
      snippets: true,
      extensions: true,
    },
  })
}

export async function importVsCodeProfileFile(filePath: string): Promise<VsCodeProfileFileImportResult> {
  return api.post<VsCodeProfileFileImportResult>("/migration/vscode/profile-file/import", { filePath })
}

export async function exportVsCodeProfileFile(input: VsCodeProfileFileExportRequest): Promise<VsCodeProfileFileExportResult> {
  return api.post<VsCodeProfileFileExportResult>("/migration/vscode/profile-file/export", input)
}

export async function listExtensionProfileContentHandlers(): Promise<ExtensionProfileContentHandlerInfo[]> {
  const result = await api.get<ExtensionProfileContentHandlersResult>("/extensions-host/profile-content-handlers")
  return result.handlers || []
}

export async function readExtensionProfileContent(handlerId: string, idOrUri: string): Promise<string | null> {
  const result = await api.post<ExtensionProfileContentReadResult>("/extensions-host/profile-content-handlers/read", {
    handlerId,
    idOrUri,
  })
  if (!result.success) throw new Error(result.error || `Profile content handler read failed: ${handlerId}`)
  return result.content ?? null
}

export async function saveExtensionProfileContent(handlerId: string, name: string, content: string): Promise<ExtensionProfileContentSaveResult["result"]> {
  const result = await api.post<ExtensionProfileContentSaveResult>("/extensions-host/profile-content-handlers/save", {
    handlerId,
    name,
    content,
  })
  if (!result.success) throw new Error(result.error || `Profile content handler save failed: ${handlerId}`)
  return result.result ?? null
}
