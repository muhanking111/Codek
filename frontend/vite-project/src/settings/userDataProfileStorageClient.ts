import { api } from "../lib/api"

export interface WorkbenchProfilesStorageSnapshot {
  path?: string
  exists?: boolean
  version?: number
  profiles?: unknown[]
  activeProfileId?: string
  workspaceProfileId?: string
  workspace?: string
  profileAssociations?: WorkbenchProfileAssociations
  invalid?: boolean
  error?: string
}

export interface WorkbenchProfileAssociations {
  workspaces?: Record<string, string>
  emptyWindows?: Record<string, string>
}

export interface WorkbenchProfilesStorageWriteResult extends WorkbenchProfilesStorageSnapshot {
  bytesWritten?: number
}

export interface WorkbenchProfilesStorageReadOptions {
  workspace?: string | null
}

export interface WorkbenchProfileWorkspaceAssociation {
  workspace: string
  profileId: string
}

export interface ProfileStorageValue {
  value?: string
  target: number
  scope?: number
}

export interface ProfileStorageDataSnapshot {
  path?: string
  exists?: boolean
  version?: number
  profileId: string
  entries: Record<string, ProfileStorageValue>
  invalid?: boolean
  error?: string
}

export interface ProfileStorageDataUpdate {
  data: Record<string, string | null | undefined | ProfileStorageValue>
  target?: number
  scope?: number
}

export interface WorkbenchProfilesStorageClient {
  read(options?: WorkbenchProfilesStorageReadOptions): Promise<WorkbenchProfilesStorageSnapshot>
  write(snapshot: WorkbenchProfilesStorageSnapshot): Promise<WorkbenchProfilesStorageWriteResult>
  getProfileForWorkspace?(workspace: string): Promise<WorkbenchProfileWorkspaceAssociation>
  setProfileForWorkspace?(workspace: string, profileId: string): Promise<WorkbenchProfilesStorageWriteResult>
  unsetProfileForWorkspace?(workspace: string): Promise<WorkbenchProfilesStorageWriteResult>
  readStorageData?(profileId: string): Promise<ProfileStorageDataSnapshot>
  updateStorageData?(profileId: string, update: ProfileStorageDataUpdate): Promise<ProfileStorageDataSnapshot>
}

export interface UserDataProfileStorageOwnerEvidence {
  readonly profileStorageOwner: "userDataProfileStorageClient"
  readonly persistenceSource: "desktop.userDataProfileStorageApi"
  readonly mainThreadBridgeOwner: "desktop/services/extensions-host/mainThread/mainThreadStorage.js"
  readonly scopeOwner: {
    readonly profile: "userDataProfileStorageClient.profileStorageRoute"
    readonly workspace: "userDataProfileStorageClient.workspaceAssociationRoute"
  }
  readonly secondStateSourceCreated: false
  readonly remainingProfileUiOwnerGap: {
    readonly connected: false
    readonly owner: "workbench.profile.ui"
    readonly reason: string
  }
}

function withWorkspaceQuery(path: string, workspace?: string | null): string {
  const value = typeof workspace === "string" ? workspace.trim() : ""
  if (!value) return path
  return `${path}?workspace=${encodeURIComponent(value)}`
}

function profileStoragePath(profileId: string): string {
  return `/profiles/workbench/${encodeURIComponent(profileId)}/storage`
}

export const userDataProfileStorageClient: WorkbenchProfilesStorageClient = {
  read(options) {
    return api.get<WorkbenchProfilesStorageSnapshot>(withWorkspaceQuery("/profiles/workbench", options?.workspace))
  },

  write(snapshot) {
    const body: WorkbenchProfilesStorageSnapshot = {
      profiles: Array.isArray(snapshot.profiles) ? snapshot.profiles : [],
      activeProfileId: typeof snapshot.activeProfileId === "string" ? snapshot.activeProfileId : "",
    }
    if (snapshot.profileAssociations) body.profileAssociations = snapshot.profileAssociations
    if (typeof snapshot.workspace === "string") body.workspace = snapshot.workspace
    return api.request<WorkbenchProfilesStorageWriteResult>("PUT", "/profiles/workbench", body)
  },

  getProfileForWorkspace(workspace) {
    return api.get<WorkbenchProfileWorkspaceAssociation>(withWorkspaceQuery("/profiles/workbench/workspace", workspace))
  },

  setProfileForWorkspace(workspace, profileId) {
    return api.request<WorkbenchProfilesStorageWriteResult>("PUT", "/profiles/workbench/workspace", {
      workspace,
      profileId,
    })
  },

  unsetProfileForWorkspace(workspace) {
    return api.request<WorkbenchProfilesStorageWriteResult>("DELETE", "/profiles/workbench/workspace", {
      workspace,
    })
  },

  readStorageData(profileId) {
    return api.get<ProfileStorageDataSnapshot>(profileStoragePath(profileId))
  },

  updateStorageData(profileId, update) {
    return api.request<ProfileStorageDataSnapshot>("PUT", profileStoragePath(profileId), update)
  },
}

export function getUserDataProfileStorageOwnerEvidence(): UserDataProfileStorageOwnerEvidence {
  return {
    profileStorageOwner: "userDataProfileStorageClient",
    persistenceSource: "desktop.userDataProfileStorageApi",
    mainThreadBridgeOwner: "desktop/services/extensions-host/mainThread/mainThreadStorage.js",
    scopeOwner: {
      profile: "userDataProfileStorageClient.profileStorageRoute",
      workspace: "userDataProfileStorageClient.workspaceAssociationRoute",
    },
    secondStateSourceCreated: false,
    remainingProfileUiOwnerGap: {
      connected: false,
      owner: "workbench.profile.ui",
      reason: "Profile data routes are connected, but full workbench profile UI owner is outside this service boundary.",
    },
  }
}
