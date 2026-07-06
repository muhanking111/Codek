import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  exportVsCodeProfileFile,
  importVsCodeProfileFile,
  importVsCodeUserData,
  listExtensionProfileContentHandlers,
  listVsCodeImportSources,
  previewVsCodeImport,
  readExtensionProfileContent,
  saveExtensionProfileContent,
} from "./vscodeImportClient"
import { api } from "../lib/api"

vi.mock("../lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

describe("vscodeImportClient", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lists, previews, and imports VS Code user data with profile and all migration sections", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      sources: [{ app: "cursor", label: "Cursor", userDir: "C:/Users/me/AppData/Roaming/Cursor/User", exists: true }],
    })
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        userDir: "source",
        profileTemplate: { name: "Default", settings: JSON.stringify({ settings: "{}" }) },
        settingsCount: 1,
        keybindingsCount: 0,
        snippetsCount: 0,
        extensionsCount: 0,
        profilesCount: 0,
        extensions: [],
      })
      .mockResolvedValueOnce({
        source: "source",
        mode: "merge",
        profileTemplate: { name: "Work", settings: JSON.stringify({ settings: "{}" }) },
        profileSnapshot: {
          id: "imported-cursor-work",
          name: "Work（Cursor）",
          source: "cursor",
          settings: { "editor.fontSize": 16 },
          keybindings: [],
          activate: true,
        },
        settings: { imported: 1 },
        keybindings: { imported: 0 },
        snippets: { imported: 0 },
        extensions: { imported: 0 },
      })

    await expect(listVsCodeImportSources()).resolves.toHaveLength(1)
    await expect(previewVsCodeImport("source")).resolves.toMatchObject({
      settingsCount: 1,
      profileTemplate: { name: "Default" },
    })
    await expect(importVsCodeUserData("source", "merge", "work")).resolves.toMatchObject({
      profileSnapshot: { id: "imported-cursor-work" },
    })

    expect(api.post).toHaveBeenLastCalledWith("/migration/vscode/import", {
      userDir: "source",
      mode: "merge",
      profileId: "work",
      sections: {
        settings: true,
        keybindings: true,
        snippets: true,
        extensions: true,
      },
    })
  })

  it("reads and writes local .code-profile files through the VS Code profile file API", async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        filePath: "D:/profiles/work.code-profile",
        profileTemplate: { name: "Work", settings: JSON.stringify({ settings: "{}" }) },
      })
      .mockResolvedValueOnce({
        filePath: "D:/profiles/work.code-profile",
        saved: true,
        bytesWritten: 128,
      })

    await expect(importVsCodeProfileFile("D:/profiles/work.code-profile")).resolves.toMatchObject({
      profileTemplate: { name: "Work" },
    })
    await expect(exportVsCodeProfileFile({
      filePath: "D:/profiles/work.code-profile",
      template: { name: "Work", settings: JSON.stringify({ settings: "{}" }) },
    })).resolves.toMatchObject({
      saved: true,
      bytesWritten: 128,
    })

    expect(api.post).toHaveBeenNthCalledWith(1, "/migration/vscode/profile-file/import", {
      filePath: "D:/profiles/work.code-profile",
    })
    expect(api.post).toHaveBeenNthCalledWith(2, "/migration/vscode/profile-file/export", {
      filePath: "D:/profiles/work.code-profile",
      template: { name: "Work", settings: JSON.stringify({ settings: "{}" }) },
    })
  })

  it("reads and writes extension-host profile content handlers through the VS Code handler API", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      handlers: [{ id: "cloud", name: "Cloud Profiles", extensionId: "publisher.cloud" }],
    })
    vi.mocked(api.post)
      .mockResolvedValueOnce({
        success: true,
        content: JSON.stringify({ name: "Cloud Work", settings: "{}" }),
      })
      .mockResolvedValueOnce({
        success: true,
        result: { id: "cloud:work", filePath: "cloud:work", bytesWritten: 64 },
      })

    await expect(listExtensionProfileContentHandlers()).resolves.toEqual([
      { id: "cloud", name: "Cloud Profiles", extensionId: "publisher.cloud" },
    ])
    await expect(readExtensionProfileContent("cloud", "cloud:work")).resolves.toContain("Cloud Work")
    await expect(saveExtensionProfileContent("cloud", "Cloud Work", "{}")).resolves.toMatchObject({
      id: "cloud:work",
      bytesWritten: 64,
    })

    expect(api.get).toHaveBeenCalledWith("/extensions-host/profile-content-handlers")
    expect(api.post).toHaveBeenNthCalledWith(1, "/extensions-host/profile-content-handlers/read", {
      handlerId: "cloud",
      idOrUri: "cloud:work",
    })
    expect(api.post).toHaveBeenNthCalledWith(2, "/extensions-host/profile-content-handlers/save", {
      handlerId: "cloud",
      name: "Cloud Work",
      content: "{}",
    })
  })
})
