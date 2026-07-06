import { describe, expect, it } from "vitest"
import { URI } from "../../../base/common"
import {
  createDefaultUserDataProfile,
  createUserDataProfileId,
  deserializeUserDataProfile,
  serializeUserDataProfile,
  toUserDataProfile,
} from "./userDataProfile"
import { UserDataProfileService, UserDataProfilesService } from "./userDataProfileService"

describe("VS Code user data profile adapter", () => {
  it("creates VS Code-style profile resource locations", () => {
    const profilesHome = URI.from({ scheme: "codek-user-data", path: "/profiles" })
    const profile = toUserDataProfile(
      "profile-1",
      "Cursor 工作区",
      URI.joinPath(profilesHome, "profile-1"),
      URI.joinPath(profilesHome, "cache"),
    )

    expect(profile.id).toBe("profile-1")
    expect(profile.isDefault).toBe(false)
    expect(profile.location.toString()).toBe("codek-user-data:/profiles/profile-1")
    expect(profile.globalStorageHome.toString()).toBe("codek-user-data:/profiles/profile-1/globalStorage")
    expect(profile.settingsResource.toString()).toBe("codek-user-data:/profiles/profile-1/settings.json")
    expect(profile.keybindingsResource.toString()).toBe("codek-user-data:/profiles/profile-1/keybindings.json")
    expect(profile.tasksResource.toString()).toBe("codek-user-data:/profiles/profile-1/tasks.json")
    expect(profile.snippetsHome.toString()).toBe("codek-user-data:/profiles/profile-1/snippets")
    expect(profile.extensionsResource.toString()).toBe("codek-user-data:/profiles/profile-1/extensions.json")
    expect(profile.mcpResource.toString()).toBe("codek-user-data:/profiles/profile-1/mcp.json")
    expect(profile.cacheHome.toString()).toBe("codek-user-data:/profiles/cache/profile-1")
  })

  it("inherits default profile resources when useDefaultFlags request them", () => {
    const profilesHome = URI.from({ scheme: "codek-user-data", path: "/profiles" })
    const defaultProfile = {
      ...toUserDataProfile("__default__profile__", "Default", URI.joinPath(profilesHome, "default"), profilesHome),
      isDefault: true,
    }
    const profile = toUserDataProfile(
      "profile-2",
      "Shared",
      URI.joinPath(profilesHome, "profile-2"),
      profilesHome,
      {
        useDefaultFlags: {
          settings: true,
          keybindings: true,
          mcp: true,
        },
      },
      defaultProfile,
    )

    expect(profile.settingsResource).toBe(defaultProfile.settingsResource)
    expect(profile.keybindingsResource).toBe(defaultProfile.keybindingsResource)
    expect(profile.mcpResource).toBe(defaultProfile.mcpResource)
    expect(profile.tasksResource.toString()).toBe("codek-user-data:/profiles/profile-2/tasks.json")
  })

  it("serializes and revives URI-backed profiles", () => {
    const profilesHome = URI.from({ scheme: "codek-user-data", path: "/profiles" })
    const profile = toUserDataProfile(
      "profile-3",
      "Manual",
      URI.joinPath(profilesHome, "profile-3"),
      profilesHome,
      { workspaces: [URI.file("D:/workspace-a")] },
    )

    const revived = deserializeUserDataProfile(serializeUserDataProfile(profile))

    expect(revived.id).toBe(profile.id)
    expect(revived.settingsResource.toString()).toBe(profile.settingsResource.toString())
    expect(revived.keybindingsResource.toString()).toBe(profile.keybindingsResource.toString())
    expect(revived.mcpResource.toString()).toBe(profile.mcpResource.toString())
    expect(revived.cacheHome.toString()).toBe(profile.cacheHome.toString())
    expect(revived.workspaces?.map((workspace) => workspace.toString())).toEqual(["file:///d:/workspace-a"])
  })

  it("revives older serialized profiles without mcpResource and cacheHome", () => {
    const profilesHome = URI.from({ scheme: "codek-user-data", path: "/profiles" })
    const profile = toUserDataProfile("profile-legacy", "Legacy", URI.joinPath(profilesHome, "profile-legacy"), profilesHome)
    const legacy = serializeUserDataProfile(profile)
    delete legacy.mcpResource
    delete legacy.cacheHome

    const revived = deserializeUserDataProfile(legacy)

    expect(revived.mcpResource.toString()).toBe("codek-user-data:/profiles/profile-legacy/mcp.json")
    expect(revived.cacheHome.toString()).toBe("codek-user-data:/profile-cache/profile-legacy")
  })

  it("generates deterministic ids without colliding with existing profiles", () => {
    const existing = new Set(["cursor-workspace-mpufzeo0"])

    expect(createUserDataProfileId("Cursor Workspace", existing, new Date("2026-06-01T00:00:00Z"))).toBe(
      "cursor-workspace-mpufzeo0-2",
    )
  })

  it("updates the current profile with VS Code-style previous/profile/join event semantics", async () => {
    const userDataHome = URI.from({ scheme: "codek-user-data", path: "/" })
    const profilesHome = URI.joinPath(userDataHome, "profiles")
    const service = new UserDataProfileService(createDefaultUserDataProfile(userDataHome))
    const next = toUserDataProfile("profile-4", "Evented", URI.joinPath(profilesHome, "profile-4"), profilesHome)
    const order: string[] = []

    service.onDidChangeCurrentProfile((event) => {
      order.push(`${event.previous.name}->${event.profile.name}`)
      event.join(Promise.resolve().then(() => {
        order.push("joiner")
      }))
    })

    await service.updateCurrentProfile(next)
    await service.updateCurrentProfile({ ...next })

    expect(service.currentProfile.name).toBe("Evented")
    expect(order).toEqual(["Default->Evented", "joiner"])
  })

  it("emits VS Code-style profile list changes with added, removed, updated and all profiles", () => {
    const userDataHome = URI.from({ scheme: "codek-user-data", path: "/" })
    const profilesHome = URI.joinPath(userDataHome, "profiles")
    const defaultProfile = createDefaultUserDataProfile(userDataHome)
    const first = toUserDataProfile("profile-a", "A", URI.joinPath(profilesHome, "profile-a"), profilesHome)
    const updated = { ...first, name: "A+" }
    const second = toUserDataProfile("profile-b", "B", URI.joinPath(profilesHome, "profile-b"), profilesHome)
    const service = new UserDataProfilesService(defaultProfile, [first])
    const events: Array<{ added: string[]; removed: string[]; updated: string[]; all: string[] }> = []

    service.onDidChangeProfiles((event) => {
      events.push({
        added: event.added.map((profile) => profile.name),
        removed: event.removed.map((profile) => profile.name),
        updated: event.updated.map((profile) => profile.name),
        all: event.all.map((profile) => profile.name),
      })
    })

    service.updateProfiles({ added: [second], updated: [updated] })
    service.updateProfiles({ removed: [second] })

    expect(service.profiles.map((profile) => profile.name)).toEqual(["A+"])
    expect(events).toEqual([
      { added: ["B"], removed: [], updated: ["A+"], all: ["A+", "B"] },
      { added: [], removed: ["B"], updated: [], all: ["A+"] },
    ])
  })
})
