import { beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsStore, type SettingsStorage } from "../settings/settingsStore"
import {
  createWorkspaceRecommendationsService,
  type WorkspaceRecommendationInput,
} from "./workspaceRecommendationsService"

class MemoryStorage implements SettingsStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function createSettingsStore(): SettingsStore {
  return new SettingsStore({
    storage: new MemoryStorage(),
    userKey: "recommendations-user",
    workspaceKeyPrefix: "recommendations-workspace:",
    unknownKey: "recommendations-unknown",
  })
}

function createInput(): WorkspaceRecommendationInput {
  return {
    workspaceRoot: "D:/Workspace",
    workspaceFolders: [
      {
        uri: "file:///D:/Workspace",
        name: "Codek",
        extensionsConfig: {
          recommendations: [
            "Vue.volar",
            "ms-vscode.vscode-typescript-next",
            "bad id",
            "Vue.volar",
          ],
          unwantedRecommendations: ["ms-vscode.vscode-typescript-next", "bad unwanted"],
        },
        installedExtensions: ["workspace.local-tool"],
      },
    ],
    files: [
      { path: "src/App.vue", languageId: "vue", content: "<template />" },
      { path: "package.json", languageId: "json", content: "{\"scripts\":{\"dev\":\"vite\"},\"dependencies\":{\"vitest\":\"latest\"}}" },
      { path: "requirements.txt", languageId: "pip-requirements", content: "pytest\n" },
      { path: ".env", content: "SECRET_KEY=abc" },
    ],
    executables: ["git", "node", "python"],
    contentSignals: [
      { id: "uses-vitest", extensionId: "vitest.explorer", reasonText: "检测到 Vitest 测试脚本", source: "package.json" },
      { id: "uses-vue", extensionId: "vue.volar", reasonText: "检测到 Vue 工作区", source: "src/App.vue" },
    ],
    installedExtensionIds: ["publisher.installed"],
  }
}

describe("workspaceRecommendationsService", () => {
  let settingsStore: SettingsStore

  beforeEach(() => {
    vi.setSystemTime(10_000)
    settingsStore = createSettingsStore()
  })

  it("projects VS Code style workspace recommendations with invalid and unwanted filtering", async () => {
    const service = createWorkspaceRecommendationsService({ settingsStore, now: () => 10_000 })

    const snapshot = await service.refresh(createInput())

    expect(snapshot.source).toBe("workspaceRecommendationsService")
    expect(snapshot.privacy.mode).toBe("standard")
    expect(snapshot.recommendations.map((item) => item.extensionId)).toEqual([
      "vue.volar",
      "workspace.local-tool",
      "github.vscode-github-actions",
      "ms-python.python",
      "dbaeumer.vscode-eslint",
      "vitest.explorer",
    ])
    expect(snapshot.ignoredRecommendations).toEqual(["ms-vscode.vscode-typescript-next"])
    expect(snapshot.invalidRecommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "bad id", source: "extensions.json" }),
      expect.objectContaining({ value: "bad unwanted", source: "unwantedRecommendations" }),
    ]))
    expect(snapshot.reasonByExtensionId["vue.volar"]).toEqual(expect.objectContaining({
      reasonId: "workspace",
      reasonText: "当前工作区推荐此扩展。",
    }))
    expect(snapshot.actionDescriptors).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "install", extensionId: "vue.volar", requiresApproval: true }),
      expect.objectContaining({ action: "ignore", extensionId: "vue.volar" }),
    ]))
  })

  it("honors recommendation opt out and privacy mode without leaking sensitive content into evidence", async () => {
    settingsStore.set("codek.privacy.enabled", true)
    settingsStore.set("codek.recommendations.ignored", ["vitest.explorer"])
    const service = createWorkspaceRecommendationsService({ settingsStore, now: () => 11_000 })

    const snapshot = await service.refresh(createInput())

    expect(snapshot.privacy).toEqual({
      mode: "privacy",
      contentSignalsEnabled: false,
      reason: "隐私模式开启，仅使用工作区配置、文件名和本地可执行信息。",
    })
    expect(snapshot.recommendations.map((item) => item.extensionId)).not.toContain("vitest.explorer")
    expect(snapshot.ignoredRecommendations).toEqual(expect.arrayContaining([
      "ms-vscode.vscode-typescript-next",
      "vitest.explorer",
    ]))
    expect(JSON.stringify(snapshot.localEvidence)).not.toContain("SECRET_KEY")
    expect(snapshot.localEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "privacy",
        detail: "隐私模式开启，内容推荐信号已跳过。",
      }),
      expect.objectContaining({
        kind: "file",
        source: ".env",
        detail: "敏感文件路径已跳过。",
      }),
    ]))
  })

  it("can disable the model as a single state source without retaining stale recommendations", async () => {
    const service = createWorkspaceRecommendationsService({ settingsStore, now: () => 12_000 })
    await service.refresh(createInput())

    settingsStore.set("codek.recommendations.enabled", false)
    const snapshot = await service.refresh(createInput())

    expect(snapshot.enabled).toBe(false)
    expect(snapshot.recommendations).toEqual([])
    expect(snapshot.reasonByExtensionId).toEqual({})
    expect(snapshot.localEvidence).toEqual([
      expect.objectContaining({
        kind: "policy",
        detail: "工作区扩展推荐已由本地设置关闭。",
      }),
    ])
  })
})
