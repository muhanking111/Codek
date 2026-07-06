// VS Code source adapter.
// Source reference:
// - D:\SourceMirror\vscode\src\vs\workbench\services\userDataProfile\browser\userDataProfileImportExportService.ts
//
// This keeps SettingsPanel as UI glue only. The import/export orchestration,
// profile file handler, template application, and cancellation result shape live
// in one VS Code-style workbench service boundary.

import type { WorkbenchProfile, WorkbenchProfileStore } from "../../../../../settings/profileStore"
import { workbenchProfileStore } from "../../../../../settings/profileStore"
import {
  exportVsCodeProfileFile,
  importVsCodeProfileFile,
  listExtensionProfileContentHandlers,
  readExtensionProfileContent,
  saveExtensionProfileContent,
  type ExtensionProfileContentHandlerInfo,
  type VsCodeProfileFileExportRequest,
  type VsCodeProfileFileExportResult,
  type VsCodeProfileFileImportResult,
} from "../../../../../settings/vscodeImportClient"

export interface UserDataProfileFileDialog {
  openProfileFile(): Promise<string | null>
  saveProfileFile(defaultPath: string): Promise<string | null>
}

export interface UserDataProfileContentHandlerSaveResult {
  id: string
  filePath?: string
  bytesWritten?: number
}

export interface UserDataProfileContentHandler {
  readonly name: string
  readonly description?: string
  readonly extensionId?: string
  readProfile(idOrUri: string): Promise<string | null>
  saveProfile(name: string, content: string): Promise<UserDataProfileContentHandlerSaveResult | null>
}

export interface UserDataProfileImportExportServiceOptions {
  profileStore?: WorkbenchProfileStore
  dialog?: UserDataProfileFileDialog
  importProfileFile?: (filePath: string) => Promise<VsCodeProfileFileImportResult>
  exportProfileFile?: (input: VsCodeProfileFileExportRequest) => Promise<VsCodeProfileFileExportResult>
  listExtensionProfileContentHandlers?: () => Promise<ExtensionProfileContentHandlerInfo[]>
  readExtensionProfileContent?: (handlerId: string, idOrUri: string) => Promise<string | null>
  saveExtensionProfileContent?: (handlerId: string, name: string, content: string) => Promise<UserDataProfileContentHandlerSaveResult | null>
  now?: () => number
}

export type UserDataProfileImportResult =
  | { status: "cancelled" }
  | { status: "imported"; filePath: string; profile: WorkbenchProfile }

export type UserDataProfileExportResult =
  | { status: "cancelled" }
  | { status: "exported"; filePath: string; bytesWritten: number }

export interface ImportProfileOptions {
  handlerId?: string
  id?: string
  activate?: boolean
}

export interface ExportProfileOptions {
  handlerId?: string
}

export class UserDataProfileImportExportService {
  private readonly profileContentHandlers = new Map<string, UserDataProfileContentHandler>()
  readonly profileStore: WorkbenchProfileStore
  private readonly dialog: UserDataProfileFileDialog
  private readonly importProfileFile: (filePath: string) => Promise<VsCodeProfileFileImportResult>
  private readonly exportProfileFile: (input: VsCodeProfileFileExportRequest) => Promise<VsCodeProfileFileExportResult>
  private readonly listExtensionProfileContentHandlers: () => Promise<ExtensionProfileContentHandlerInfo[]>
  private readonly readExtensionProfileContent: (handlerId: string, idOrUri: string) => Promise<string | null>
  private readonly saveExtensionProfileContent: (handlerId: string, name: string, content: string) => Promise<UserDataProfileContentHandlerSaveResult | null>
  private readonly now: () => number

  constructor(options: UserDataProfileImportExportServiceOptions = {}) {
    this.profileStore = options.profileStore ?? workbenchProfileStore
    this.dialog = options.dialog ?? new ElectronUserDataProfileFileDialog()
    this.importProfileFile = options.importProfileFile ?? importVsCodeProfileFile
    this.exportProfileFile = options.exportProfileFile ?? exportVsCodeProfileFile
    this.listExtensionProfileContentHandlers = options.listExtensionProfileContentHandlers ?? listExtensionProfileContentHandlers
    this.readExtensionProfileContent = options.readExtensionProfileContent ?? readExtensionProfileContent
    this.saveExtensionProfileContent = options.saveExtensionProfileContent ?? saveExtensionProfileContent
    this.now = options.now ?? (() => Date.now())
    this.registerProfileContentHandler("file", new FileUserDataProfileContentHandler(this.importProfileFile, this.exportProfileFile))
  }

  registerProfileContentHandler(id: string, profileContentHandler: UserDataProfileContentHandler): () => void {
    if (this.profileContentHandlers.has(id)) {
      throw new Error(`Profile content handler with id '${id}' already registered.`)
    }
    this.profileContentHandlers.set(id, profileContentHandler)
    return () => this.unregisterProfileContentHandler(id)
  }

  unregisterProfileContentHandler(id: string): void {
    this.profileContentHandlers.delete(id)
  }

  async syncExtensionProfileContentHandlers(): Promise<number> {
    const handlers = await this.listExtensionProfileContentHandlers()
    let registered = 0
    for (const handler of handlers) {
      if (!handler?.id || this.profileContentHandlers.has(handler.id)) continue
      this.registerProfileContentHandler(handler.id, new ExtensionHostUserDataProfileContentHandler(
        handler,
        this.readExtensionProfileContent,
        this.saveExtensionProfileContent,
      ))
      registered += 1
    }
    return registered
  }

  async importProfileFromFile(): Promise<UserDataProfileImportResult> {
    const filePath = await this.dialog.openProfileFile()
    if (!filePath) return { status: "cancelled" }
    return this.importProfile(filePath, { handlerId: "file" })
  }

  async importProfile(idOrUri: string, options: ImportProfileOptions = {}): Promise<UserDataProfileImportResult> {
    const handler = this.getProfileContentHandler(options.handlerId ?? "file")
    const content = await handler.readProfile(idOrUri)
    if (!content) return { status: "cancelled" }
    const profileTemplate = parseProfileTemplateContent(content)
    const profile = this.profileStore.importFromVsCodeTemplate({
      template: profileTemplate,
      id: options.id ?? `imported-code-profile-${this.now()}`,
      source: "vscode",
      activate: options.activate ?? true,
    })
    return {
      status: "imported",
      filePath: idOrUri,
      profile,
    }
  }

  async exportProfileToFile(profileId: string): Promise<UserDataProfileExportResult> {
    const profile = this.profileStore.getProfile(profileId)
    if (!profile) throw new Error(`Profile 不存在：${profileId}`)
    const filePath = await this.dialog.saveProfileFile(createProfileExportFileName(profile.name))
    if (!filePath) return { status: "cancelled" }
    return this.exportProfile(profileId, { handlerId: "file", filePath } as ExportProfileOptions & { filePath: string })
  }

  async exportProfile(profileId: string, options: ExportProfileOptions = {}): Promise<UserDataProfileExportResult> {
    const profile = this.profileStore.getProfile(profileId)
    if (!profile) throw new Error(`Profile 不存在：${profileId}`)
    const handler = this.getProfileContentHandler(options.handlerId ?? "file")
    const content = JSON.stringify(await this.profileStore.exportToVsCodeTemplateAsync(profileId), null, 2)
    const handlerId = options.handlerId ?? "file"
    const name = (options as { filePath?: string }).filePath ?? createProfileExportName(profile.name, handlerId)
    const result = await handler.saveProfile(name, content)
    if (!result) return { status: "cancelled" }
    return {
      status: "exported",
      filePath: result.filePath ?? result.id,
      bytesWritten: result.bytesWritten ?? content.length,
    }
  }

  private getProfileContentHandler(id: string): UserDataProfileContentHandler {
    const handler = this.profileContentHandlers.get(id)
    if (!handler) throw new Error(`Profile content handler not found: ${id}`)
    return handler
  }
}

export function createProfileExportFileName(name: string): string {
  const basename = name.trim().replace(/[\\/:*?"<>|]/g, "-") || "profile"
  return basename.toLowerCase().endsWith(".code-profile") ? basename : `${basename}.code-profile`
}

function createProfileExportName(name: string, handlerId: string): string {
  if (handlerId === "file") return createProfileExportFileName(name)
  return name.trim().replace(/[\\/:*?"<>|]/g, "-") || "profile"
}

class ElectronUserDataProfileFileDialog implements UserDataProfileFileDialog {
  async openProfileFile(): Promise<string | null> {
    const codek = window.codek
    if (!codek || typeof codek.openFileDialog !== "function") {
      throw new Error("当前运行环境不支持文件选择")
    }
    const selected = await codek.openFileDialog({
      title: "选择 VS Code Profile",
      filters: [{ name: "Profile", extensions: ["code-profile"] }],
      readContent: false,
    })
    return selected?.filePath || selected?.path || null
  }

  async saveProfileFile(defaultPath: string): Promise<string | null> {
    const codek = window.codek
    if (!codek || typeof codek.saveFileDialog !== "function") {
      throw new Error("当前运行环境不支持保存文件")
    }
    const selected = await codek.saveFileDialog({
      title: "导出 VS Code Profile",
      defaultPath,
      filters: [{ name: "Profile", extensions: ["code-profile"] }],
    })
    return selected?.filePath || selected?.path || null
  }
}

class FileUserDataProfileContentHandler implements UserDataProfileContentHandler {
  readonly name = "Profile File"

  constructor(
    private readonly importProfileFile: (filePath: string) => Promise<VsCodeProfileFileImportResult>,
    private readonly exportProfileFile: (input: VsCodeProfileFileExportRequest) => Promise<VsCodeProfileFileExportResult>,
  ) {}

  async readProfile(filePath: string): Promise<string | null> {
    const result = await this.importProfileFile(filePath)
    return JSON.stringify(result.profileTemplate)
  }

  async saveProfile(filePath: string, content: string): Promise<UserDataProfileContentHandlerSaveResult | null> {
    const result = await this.exportProfileFile({
      filePath,
      template: parseProfileTemplateContent(content),
    })
    return {
      id: result.filePath,
      filePath: result.filePath,
      bytesWritten: result.bytesWritten,
    }
  }
}

class ExtensionHostUserDataProfileContentHandler implements UserDataProfileContentHandler {
  readonly name: string
  readonly description?: string
  readonly extensionId?: string

  constructor(
    private readonly handler: ExtensionProfileContentHandlerInfo,
    private readonly readProfileContent: (handlerId: string, idOrUri: string) => Promise<string | null>,
    private readonly saveProfileContent: (handlerId: string, name: string, content: string) => Promise<UserDataProfileContentHandlerSaveResult | null>,
  ) {
    this.name = handler.name || handler.id
    this.description = handler.description
    this.extensionId = handler.extensionId
  }

  async readProfile(idOrUri: string): Promise<string | null> {
    return this.readProfileContent(this.handler.id, idOrUri)
  }

  async saveProfile(name: string, content: string): Promise<UserDataProfileContentHandlerSaveResult | null> {
    return this.saveProfileContent(this.handler.id, name, content)
  }
}

function parseProfileTemplateContent(content: string) {
  const parsed = JSON.parse(content) as unknown
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { name?: unknown }).name !== "string") {
    throw new Error("Profile 文件格式无效")
  }
  return parsed as VsCodeProfileFileImportResult["profileTemplate"]
}

export const userDataProfileImportExportService = new UserDataProfileImportExportService()
