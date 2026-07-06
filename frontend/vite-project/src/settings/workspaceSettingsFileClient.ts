import { parseSettingsJson, stringifySettingsJson } from "./settingsJson"
import type { SettingsRecord } from "./settingsCompat"

export interface WorkspaceSettingsFileResult {
  path: string
  settings: SettingsRecord
  found: boolean
}

interface WorkspaceFileApi {
  readFile?: (path: string) => Promise<string | null | undefined>
  writeFile?: (path: string, content: string) => Promise<boolean | void>
  createDir?: (path: string) => Promise<boolean | void>
}

const SETTINGS_DIR = ".codek"
const SETTINGS_FILE = "settings.json"

export async function readWorkspaceSettingsFile(projectRoot: string): Promise<WorkspaceSettingsFileResult> {
  const filePath = getWorkspaceSettingsPath(projectRoot)
  const fsApi = getWorkspaceFileApi()
  if (!fsApi?.readFile) return { path: filePath, settings: {}, found: false }

  try {
    const content = await fsApi.readFile(filePath)
    if (content == null || content === "") return { path: filePath, settings: {}, found: false }
    const parsed = parseSettingsJson(content)
    if (!parsed.ok) throw new Error(parsed.error)
    return { path: filePath, settings: parsed.settings, found: true }
  } catch (error) {
    if (isMissingFileError(error)) return { path: filePath, settings: {}, found: false }
    throw error
  }
}

export async function writeWorkspaceSettingsFile(projectRoot: string, settings: SettingsRecord): Promise<string> {
  const fsApi = getWorkspaceFileApi()
  if (!fsApi?.writeFile) throw new Error("当前环境不支持写入工作区 settings.json")

  const dirPath = joinPath(projectRoot, SETTINGS_DIR)
  const filePath = joinPath(dirPath, SETTINGS_FILE)

  if (fsApi.createDir) {
    const created = await fsApi.createDir(dirPath)
    if (created === false) throw new Error("创建 .codek 目录失败")
  }

  const written = await fsApi.writeFile(filePath, stringifySettingsJson(settings))
  if (written === false) throw new Error("写入工作区 settings.json 失败")
  return filePath
}

export function getWorkspaceSettingsPath(projectRoot: string): string {
  return joinPath(projectRoot, SETTINGS_DIR, SETTINGS_FILE)
}

function getWorkspaceFileApi(): WorkspaceFileApi | null {
  if (typeof window === "undefined") return null
  return (window.codek as WorkspaceFileApi | undefined) ?? null
}

function joinPath(...parts: string[]): string {
  const [first = "", ...rest] = parts
  const normalizedFirst = String(first).replace(/\\/g, "/").replace(/\/+$/, "")
  const normalizedRest = rest
    .map((part) => String(part).replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
  return [normalizedFirst, ...normalizedRest].filter(Boolean).join("/")
}

function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /ENOENT|not found|missing|不存在|找不到/i.test(message)
}
