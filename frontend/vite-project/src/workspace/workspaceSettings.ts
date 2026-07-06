import {
  settingsRecordToWorkspaceSettings,
  workspaceSettingsToSettingsRecord,
} from "../settings/settingsCompat"
import { settingsStore } from "../settings/settingsStore"

export interface WorkspaceSettings {
  editor: {
    tabSize: number
    fontSize: number
    fontFamily: string
    wordWrap: "off" | "on" | "wordWrapColumn"
    formatOnSave: boolean
    lintOnSave: boolean
    minimap: boolean
    bracketPairColorization: boolean
  }
  files: {
    encoding: string
    eol: "auto" | "lf" | "crlf"
    autoSave: "off" | "afterDelay" | "onFocusChange"
    autoSaveDelay: number
    excludeGlob: string[]
  }
  search: {
    includeGlob: string[]
    excludeGlob: string[]
  }
  git: {
    autoStage: boolean
    commitTemplate: string
  }
  ai: {
    provider: string
    model: string
    temperature: number
    qualityGateCommands: string[]
  }
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  editor: {
    tabSize: 2,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    wordWrap: "off",
    formatOnSave: false,
    lintOnSave: true,
    minimap: true,
    bracketPairColorization: true,
  },
  files: {
    encoding: "utf-8",
    eol: "auto",
    autoSave: "off",
    autoSaveDelay: 1000,
    excludeGlob: ["node_modules", ".git", "dist", "build", "__pycache__"],
  },
  search: {
    includeGlob: ["*"],
    excludeGlob: ["node_modules", ".git", "dist", "build"],
  },
  git: {
    autoStage: false,
    commitTemplate: "",
  },
  ai: {
    provider: "ollama",
    model: "",
    temperature: 0.7,
    qualityGateCommands: [],
  },
}

type SettingsSection = keyof WorkspaceSettings

export class WorkspaceSettingsManager {
  private settings: WorkspaceSettings
  private projectRoot: string | null

  constructor() {
    this.settings = structuredClone(DEFAULT_WORKSPACE_SETTINGS)
    this.projectRoot = null
  }

  load(projectRoot: string): WorkspaceSettings {
    this.projectRoot = projectRoot
    const unifiedSettings = settingsStore.loadWorkspace(projectRoot)
    this.settings = settingsRecordToWorkspaceSettings(
      unifiedSettings,
      structuredClone(DEFAULT_WORKSPACE_SETTINGS),
    )
    settingsStore.loadWorkspaceFromFile(projectRoot).then((fileSettings) => {
      if (this.projectRoot !== projectRoot) return
      this.settings = settingsRecordToWorkspaceSettings(
        fileSettings,
        structuredClone(DEFAULT_WORKSPACE_SETTINGS),
      )
    }).catch(() => {
      // Local storage remains the fallback when the workspace settings file is unavailable.
    })
    return this.getAll()
  }

  async loadFromFile(projectRoot: string): Promise<WorkspaceSettings> {
    this.projectRoot = projectRoot
    const unifiedSettings = await settingsStore.loadWorkspaceFromFile(projectRoot)
    this.settings = settingsRecordToWorkspaceSettings(
      unifiedSettings,
      structuredClone(DEFAULT_WORKSPACE_SETTINGS),
    )
    return this.getAll()
  }

  async save(projectRoot: string): Promise<void> {
    this.projectRoot = projectRoot
    settingsStore.loadWorkspace(projectRoot)
    settingsStore.update(workspaceSettingsToSettingsRecord(this.settings), "workspace")
  }

  get<K extends SettingsSection>(section: K): WorkspaceSettings[K] {
    return { ...this.settings[section] }
  }

  set<K extends SettingsSection>(section: K, value: WorkspaceSettings[K]): void {
    this.settings[section] = { ...value }
    if (this.projectRoot) {
      settingsStore.update(workspaceSettingsToSettingsRecord(this.settings), "workspace")
    }
  }

  reset(): void {
    this.settings = structuredClone(DEFAULT_WORKSPACE_SETTINGS)
    if (this.projectRoot) {
      settingsStore.reset("workspace")
      settingsStore.update(workspaceSettingsToSettingsRecord(this.settings), "workspace")
    }
  }

  merge(userSettings: Partial<WorkspaceSettings>): void {
    if (userSettings.editor) {
      this.settings.editor = { ...this.settings.editor, ...userSettings.editor }
    }
    if (userSettings.files) {
      this.settings.files = { ...this.settings.files, ...userSettings.files }
    }
    if (userSettings.search) {
      this.settings.search = { ...this.settings.search, ...userSettings.search }
    }
    if (userSettings.git) {
      this.settings.git = { ...this.settings.git, ...userSettings.git }
    }
    if (userSettings.ai) {
      this.settings.ai = { ...this.settings.ai, ...userSettings.ai }
    }
  }

  getAll(): WorkspaceSettings {
    return structuredClone(this.settings)
  }
}

export const workspaceSettings = new WorkspaceSettingsManager()
