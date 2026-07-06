import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { gitState } from "./gitState"
import { getScmProviders, resetScmRegistry } from "../scm/scmRegistry"

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}))

vi.mock("../lib/api", () => ({
  api: { post: mocks.post },
}))

vi.mock("../settings/settingsStore", () => ({
  settingsStore: {
    getAll: () => ({ "git.enabled": true, "git.autofetch": true }),
  },
}))

describe("gitState multi-root SCM integration", () => {
  beforeEach(() => {
    mocks.post.mockReset()
    resetScmRegistry()
    gitState.setWorkspaceRoots([])
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it("fetches all workspace roots and registers one SCM provider per git repo", async () => {
    mocks.post.mockImplementation(async (path: string, body: { projectRoot?: string }) => {
      if (path === "/api/git/isRepo") return { isRepo: body.projectRoot !== "D:/plain" }
      if (path === "/api/git/status") {
        return {
          repoName: body.projectRoot?.split("/").pop() || "",
          branch: body.projectRoot === "D:/repo-a" ? "main" : "dev",
          ahead: 0,
          behind: 0,
          staged: [],
          changes: [{ path: "README.md", status: "M", staged: false }],
        }
      }
      return {}
    })

    gitState.setWorkspaceRoots(["D:/repo-a", "D:/plain", "D:/repo-b"])
    await gitState.fetchStatus()

    expect(gitState.hasRepo.value).toBe(true)
    expect(gitState.repositories.value.map((repo) => repo.repoName)).toEqual(["repo-a", "repo-b"])
    expect(gitState.repositories.value.map((repo) => repo.rootUri)).toEqual(["D:/repo-a", "D:/repo-b"])
    expect(getScmProviders().map((provider) => provider.id)).toEqual(["git:D:/repo-a", "git:D:/repo-b"])
  })

  it("runs Git operations against the selected repository root", async () => {
    vi.useFakeTimers()
    mocks.post.mockResolvedValue({})
    gitState.setWorkspaceRoots(["D:/repo-a", "D:/repo-b"])

    await gitState.stageFile("src/a.ts", "D:/repo-b")
    await gitState.getDiff("src/a.ts", "D:/repo-b")
    await gitState.commit("test commit", "D:/repo-b")

    expect(mocks.post).toHaveBeenCalledWith("/api/git/stage", expect.objectContaining({
      projectRoot: "D:/repo-b",
      file: "src/a.ts",
    }))
    expect(mocks.post).toHaveBeenCalledWith("/api/git/diff", expect.objectContaining({
      projectRoot: "D:/repo-b",
      file: "src/a.ts",
    }))
    expect(mocks.post).toHaveBeenCalledWith("/api/git/commit", expect.objectContaining({
      projectRoot: "D:/repo-b",
      message: "test commit",
    }))
  })
})
