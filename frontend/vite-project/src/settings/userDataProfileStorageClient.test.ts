import { beforeEach, describe, expect, it, vi } from "vitest"
import { api } from "../lib/api"
import { getUserDataProfileStorageOwnerEvidence, userDataProfileStorageClient } from "./userDataProfileStorageClient"

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
    request: vi.fn(),
  },
}))

describe("userDataProfileStorageClient", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reads workbench profiles with the current workspace query", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ exists: true })

    await expect(userDataProfileStorageClient.read({ workspace: "D:/work dir" })).resolves.toEqual({ exists: true })

    expect(api.get).toHaveBeenCalledWith("/profiles/workbench?workspace=D%3A%2Fwork%20dir")
  })

  it("writes profile associations only when the snapshot carries them", async () => {
    vi.mocked(api.request).mockResolvedValue({ exists: true })

    await userDataProfileStorageClient.write({
      profiles: [{ id: "active" }],
      activeProfileId: "active",
    })
    await userDataProfileStorageClient.write({
      profiles: [{ id: "active" }],
      activeProfileId: "active",
      workspace: "D:/work",
      profileAssociations: {
        workspaces: { "file:///D:/work": "active" },
        emptyWindows: {},
      },
    })

    expect(api.request).toHaveBeenNthCalledWith(1, "PUT", "/profiles/workbench", {
      profiles: [{ id: "active" }],
      activeProfileId: "active",
    })
    expect(api.request).toHaveBeenNthCalledWith(2, "PUT", "/profiles/workbench", {
      profiles: [{ id: "active" }],
      activeProfileId: "active",
      workspace: "D:/work",
      profileAssociations: {
        workspaces: { "file:///D:/work": "active" },
        emptyWindows: {},
      },
    })
  })

  it("uses VS Code style workspace association routes", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ workspace: "file:///D:/work", profileId: "active" })
    vi.mocked(api.request).mockResolvedValue({ exists: true })

    await expect(userDataProfileStorageClient.getProfileForWorkspace?.("D:/work")).resolves.toEqual({
      workspace: "file:///D:/work",
      profileId: "active",
    })
    await userDataProfileStorageClient.setProfileForWorkspace?.("D:/work", "active")
    await userDataProfileStorageClient.unsetProfileForWorkspace?.("D:/work")

    expect(api.get).toHaveBeenCalledWith("/profiles/workbench/workspace?workspace=D%3A%2Fwork")
    expect(api.request).toHaveBeenNthCalledWith(1, "PUT", "/profiles/workbench/workspace", {
      workspace: "D:/work",
      profileId: "active",
    })
    expect(api.request).toHaveBeenNthCalledWith(2, "DELETE", "/profiles/workbench/workspace", {
      workspace: "D:/work",
    })
  })

  it("uses VS Code style profile scoped storage data routes", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      profileId: "profile-a",
      entries: {
        "workbench.panel.defaultLocation": { value: "bottom", target: 0, scope: 0 },
      },
    })
    vi.mocked(api.request).mockResolvedValue({
      profileId: "profile-a",
      entries: {},
    })

    await expect(userDataProfileStorageClient.readStorageData?.("profile-a")).resolves.toEqual({
      profileId: "profile-a",
      entries: {
        "workbench.panel.defaultLocation": { value: "bottom", target: 0, scope: 0 },
      },
    })
    await userDataProfileStorageClient.updateStorageData?.("profile-a", {
      data: {
        "workbench.panel.defaultLocation": "bottom",
        "delete.me": null,
      },
      target: 0,
      scope: 0,
    })

    expect(api.get).toHaveBeenCalledWith("/profiles/workbench/profile-a/storage")
    expect(api.request).toHaveBeenCalledWith("PUT", "/profiles/workbench/profile-a/storage", {
      data: {
        "workbench.panel.defaultLocation": "bottom",
        "delete.me": null,
      },
      target: 0,
      scope: 0,
    })
  })

  it("exposes profile storage owner evidence without claiming full profile UI ownership", () => {
    expect(getUserDataProfileStorageOwnerEvidence()).toEqual({
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
    })
  })
})
