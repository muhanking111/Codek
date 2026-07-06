// VS Code source adapter.
// Source references:
// - D:\SourceMirror\vscode\src\vs\platform\userDataProfile\common\userDataProfile.ts
// - D:\SourceMirror\vscode\src\vs\workbench\services\userDataProfile\common\userDataProfile.ts
//
// Codek keeps lightweight profile snapshots in local storage. This adapter ports
// the VS Code profile identity/resource contract so settings, keybindings and
// future profile-scoped files do not grow a second self-made path model.

import { URI, type UriComponents } from "../../../base/common"

export interface UseDefaultProfileFlags {
  settings?: boolean
  keybindings?: boolean
  tasks?: boolean
  snippets?: boolean
  extensions?: boolean
  globalState?: boolean
  mcp?: boolean
}

export interface UserDataProfileOptions {
  icon?: string
  useDefaultFlags?: UseDefaultProfileFlags
  transient?: boolean
  workspaces?: readonly URI[]
}

export interface UserDataProfile {
  id: string
  isDefault: boolean
  name: string
  icon?: string
  location: URI
  globalStorageHome: URI
  settingsResource: URI
  keybindingsResource: URI
  tasksResource: URI
  snippetsHome: URI
  extensionsResource: URI
  mcpResource: URI
  cacheHome: URI
  isTransient?: boolean
  useDefaultFlags?: UseDefaultProfileFlags
  workspaces?: readonly URI[]
}

export interface SerializedUserDataProfile {
  id: string
  isDefault?: boolean
  name: string
  icon?: string
  location: UriComponents
  globalStorageHome: UriComponents
  settingsResource: UriComponents
  keybindingsResource: UriComponents
  tasksResource: UriComponents
  snippetsHome: UriComponents
  extensionsResource: UriComponents
  mcpResource?: UriComponents
  cacheHome?: UriComponents
  isTransient?: boolean
  useDefaultFlags?: UseDefaultProfileFlags
  workspaces?: UriComponents[]
}

export const DEFAULT_PROFILE_ID = "__default__profile__"
export const PROFILE_EXTENSION = "code-profile"
export const CURRENT_PROFILE_CONTEXT = "currentProfile"
export const HAS_PROFILES_CONTEXT = "hasProfiles"

export function toUserDataProfile(
  id: string,
  name: string,
  location: URI,
  profilesCacheHome: URI,
  options: UserDataProfileOptions = {},
  defaultProfile?: UserDataProfile,
): UserDataProfile {
  return {
    id,
    name,
    isDefault: false,
    icon: options.icon,
    location,
    globalStorageHome: defaultProfile && options.useDefaultFlags?.globalState
      ? defaultProfile.globalStorageHome
      : URI.joinPath(location, "globalStorage"),
    settingsResource: defaultProfile && options.useDefaultFlags?.settings
      ? defaultProfile.settingsResource
      : URI.joinPath(location, "settings.json"),
    keybindingsResource: defaultProfile && options.useDefaultFlags?.keybindings
      ? defaultProfile.keybindingsResource
      : URI.joinPath(location, "keybindings.json"),
    tasksResource: defaultProfile && options.useDefaultFlags?.tasks
      ? defaultProfile.tasksResource
      : URI.joinPath(location, "tasks.json"),
    snippetsHome: defaultProfile && options.useDefaultFlags?.snippets
      ? defaultProfile.snippetsHome
      : URI.joinPath(location, "snippets"),
    extensionsResource: defaultProfile && options.useDefaultFlags?.extensions
      ? defaultProfile.extensionsResource
      : URI.joinPath(location, "extensions.json"),
    mcpResource: defaultProfile && options.useDefaultFlags?.mcp
      ? defaultProfile.mcpResource
      : URI.joinPath(location, "mcp.json"),
    cacheHome: URI.joinPath(profilesCacheHome, id),
    isTransient: options.transient,
    useDefaultFlags: options.useDefaultFlags,
    workspaces: options.workspaces ? [...options.workspaces] : undefined,
  }
}

export function createDefaultUserDataProfile(userDataHome: URI): UserDataProfile {
  return {
    ...toUserDataProfile(DEFAULT_PROFILE_ID, "Default", URI.joinPath(userDataHome, "default"), URI.joinPath(userDataHome, "profiles")),
    isDefault: true,
  }
}

export function createUserDataProfileId(name: string, existingIds: Set<string>, now: Date): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "profile"
  const stamp = now.getTime().toString(36)
  let candidate = `${base}-${stamp}`
  let index = 2
  while (existingIds.has(candidate)) {
    candidate = `${base}-${stamp}-${index}`
    index += 1
  }
  return candidate
}

export function serializeUserDataProfile(profile: UserDataProfile): SerializedUserDataProfile {
  return {
    id: profile.id,
    isDefault: profile.isDefault,
    name: profile.name,
    icon: profile.icon,
    location: profile.location.toJSON(),
    globalStorageHome: profile.globalStorageHome.toJSON(),
    settingsResource: profile.settingsResource.toJSON(),
    keybindingsResource: profile.keybindingsResource.toJSON(),
    tasksResource: profile.tasksResource.toJSON(),
    snippetsHome: profile.snippetsHome.toJSON(),
    extensionsResource: profile.extensionsResource.toJSON(),
    mcpResource: profile.mcpResource.toJSON(),
    cacheHome: profile.cacheHome.toJSON(),
    isTransient: profile.isTransient,
    useDefaultFlags: profile.useDefaultFlags,
    workspaces: profile.workspaces?.map((workspace) => workspace.toJSON()),
  }
}

export function deserializeUserDataProfile(profile: SerializedUserDataProfile): UserDataProfile {
  const location = URI.revive(profile.location)
  const profilesCacheHome = URI.from({
    scheme: location.scheme,
    authority: location.authority,
    path: joinPathString(dirnamePath(dirnamePath(location.path)), "profile-cache"),
  })
  return {
    id: profile.id,
    isDefault: Boolean(profile.isDefault),
    name: profile.name,
    icon: profile.icon,
    location,
    globalStorageHome: URI.revive(profile.globalStorageHome),
    settingsResource: URI.revive(profile.settingsResource),
    keybindingsResource: URI.revive(profile.keybindingsResource),
    tasksResource: URI.revive(profile.tasksResource),
    snippetsHome: URI.revive(profile.snippetsHome),
    extensionsResource: URI.revive(profile.extensionsResource),
    mcpResource: profile.mcpResource ? URI.revive(profile.mcpResource) : URI.joinPath(location, "mcp.json"),
    cacheHome: profile.cacheHome ? URI.revive(profile.cacheHome) : URI.joinPath(profilesCacheHome, profile.id),
    isTransient: profile.isTransient,
    useDefaultFlags: profile.useDefaultFlags,
    workspaces: profile.workspaces?.map((workspace) => URI.revive(workspace)),
  }
}

export function isSerializedUserDataProfile(value: unknown): value is SerializedUserDataProfile {
  const candidate = value as SerializedUserDataProfile | null
  return Boolean(
    candidate &&
      typeof candidate.id === "string" &&
      typeof candidate.name === "string" &&
      isUriLike(candidate.location) &&
      isUriLike(candidate.globalStorageHome) &&
      isUriLike(candidate.settingsResource) &&
      isUriLike(candidate.keybindingsResource) &&
      isUriLike(candidate.tasksResource) &&
      isUriLike(candidate.snippetsHome) &&
      isUriLike(candidate.extensionsResource) &&
      (candidate.mcpResource === undefined || isUriLike(candidate.mcpResource)) &&
      (candidate.cacheHome === undefined || isUriLike(candidate.cacheHome)) &&
      (candidate.workspaces === undefined || (Array.isArray(candidate.workspaces) && candidate.workspaces.every(isUriLike))),
  )
}

function isUriLike(value: unknown): value is UriComponents {
  const candidate = value as UriComponents | null
  return Boolean(candidate && typeof candidate.scheme === "string" && typeof candidate.path === "string")
}

function dirnamePath(value: string): string {
  const path = value.replace(/\/+$/g, "")
  const index = path.lastIndexOf("/")
  return index <= 0 ? "/" : path.slice(0, index)
}

function joinPathString(base: string, segment: string): string {
  return `${base.replace(/\/+$/g, "") || "/"}/${segment.replace(/^\/+/g, "")}`.replace(/^\/\//, "/")
}
