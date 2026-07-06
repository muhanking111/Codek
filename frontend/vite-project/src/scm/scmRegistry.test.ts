import { describe, expect, it, beforeEach } from "vitest"
import { ServiceCollection } from "../vscode-adapter/platform/instantiation/common/serviceCollection"
import { InstantiationService } from "../vscode-adapter/platform/instantiation/common/instantiationService"
import { getSingletonServiceDescriptors } from "../vscode-adapter/platform/instantiation/common/extensions"
import {
  globalScmRegistryService,
  createGitProviderSnapshot,
  getQuickDiffResource,
  getScmProviderSnapshot,
  getScmProviderTree,
  getScmProviders,
  getScmRepositories,
  getScmResource,
  getScmResourceActions,
  getScmResourceGroup,
  IScmRegistryService,
  IScmService,
  registerOrUpdateGitProvider,
  registerOrUpdateScmProvider,
  resetScmRegistry,
  ScmRegistryService,
} from "./scmRegistry"

describe("scmRegistry", () => {
  beforeEach(() => resetScmRegistry())

  it("maps git status into VS Code style SCM resource groups", () => {
    const snapshot = createGitProviderSnapshot("D:/Workspace", {
      repoName: "Codek",
      branch: "main",
      ahead: 1,
      behind: 2,
      staged: [{ path: "src/a.ts", status: "A", staged: true }],
      changes: [
        { path: "src/b.ts", status: "M", staged: false },
        { path: "src/c.ts", status: "U", staged: false },
      ],
      conflicts: [{ path: "src/c.ts", status: "U", staged: false }],
    })

    expect(snapshot).toMatchObject({
      id: "git:D:/Workspace",
      providerId: "git",
      label: "Codek",
      branch: "main",
      count: 3,
      input: {
        enabled: true,
        visible: true,
      },
    })
    expect(snapshot.groups.map((group) => [group.id, group.resources.map((item) => item.path)])).toEqual([
      ["staged", ["src/a.ts"]],
      ["changes", ["src/b.ts"]],
      ["conflicts", ["src/c.ts"]],
    ])
  })

  it("registers git as the first SCM provider", () => {
    registerOrUpdateGitProvider("D:/Workspace", {
      repoName: "Codek",
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      changes: [],
    })

    expect(getScmProviders()).toHaveLength(1)
    expect(getScmProviders()[0].providerId).toBe("git")
  })

  it("builds an independent provider tree with resource provider metadata and default actions", () => {
    registerOrUpdateGitProvider("D:/Workspace", {
      repoName: "Codek",
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      changes: [{ path: "src/z.ts", status: "M", staged: false }, { path: "src/a.ts", status: "M", staged: false }],
    })
    registerOrUpdateScmProvider({
      id: "custom:D:/Workspace",
      providerId: "custom",
      label: "Custom",
      rootUri: "D:/Workspace",
      branch: "",
      ahead: 0,
      behind: 0,
      groups: [{ id: "changes", label: "Changes", resources: [{ path: "custom.txt", status: "M", staged: false }] }],
      count: 1,
    })

    const tree = getScmProviderTree()
    const gitChangesGroup = tree[0].groups.find((group) => group.id === "changes")

    expect(tree.map((provider) => provider.providerId)).toEqual(["git", "custom"])
    expect(gitChangesGroup?.resources.map((resource) => resource.path)).toEqual(["src/a.ts", "src/z.ts"])
    expect(gitChangesGroup?.resources[0]).toMatchObject({
      providerId: "git",
      rootUri: "D:/Workspace",
      resourceUri: "D:/Workspace/src/a.ts",
      actions: {
        stage: expect.objectContaining({
          commandId: "scm.stageResource",
          enabled: true,
          gitIndexMutation: true,
        }),
      },
    })
  })

  it("resolves provider snapshots and resource groups for UI consumers", () => {
    registerOrUpdateGitProvider("D:/Workspace", {
      repoName: "Codek",
      branch: "main",
      ahead: 1,
      behind: 0,
      staged: [{ path: "src/staged.ts", status: "A", staged: true }],
      changes: [{ path: "src/changed.ts", status: "M", staged: false }],
      conflicts: [{ path: "src/conflict.ts", status: "U", staged: false }],
    })

    expect(getScmProviderSnapshot("git", "D:/Workspace")).toMatchObject({
      label: "Codek",
      branch: "main",
      count: 3,
    })
    expect(getScmResourceGroup("git", "D:/Workspace", "staged").resources.map((resource) => resource.path)).toEqual(["src/staged.ts"])
    expect(getScmResourceGroup("git", "D:/Workspace", "changes").resources.map((resource) => resource.path)).toEqual(["src/changed.ts"])
    expect(getScmResourceGroup("git", "D:/Workspace", "missing").resources).toEqual([])
  })

  it("resolves resources and quick diff resources using relative or absolute paths", () => {
    registerOrUpdateGitProvider("D:/Workspace", {
      repoName: "Codek",
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [{ path: "src/staged.ts", status: "M", staged: true }],
      changes: [{ path: "src/app.ts", status: "M", staged: false }],
      conflicts: [{ path: "src/conflict.ts", status: "U", staged: false }],
    })

    expect(getScmResource("src/app.ts")).toMatchObject({
      path: "src/app.ts",
      providerId: "git",
      rootUri: "D:/Workspace",
      resourceUri: "D:/Workspace/src/app.ts",
    })
    expect(getScmResource("D:/Workspace/src/app.ts")).toMatchObject({
      path: "src/app.ts",
    })
    expect(getQuickDiffResource("src/app.ts")).toMatchObject({
      path: "src/app.ts",
    })
    expect(getQuickDiffResource("src/staged.ts")).toBeNull()
    expect(getQuickDiffResource("src/conflict.ts")).toBeNull()
  })

  it("keeps read-only evidence actions separate from Git index mutation", () => {
    registerOrUpdateScmProvider({
      id: "evidence:D:/Workspace",
      providerId: "agentEvidence",
      label: "Agent Evidence",
      rootUri: "D:/Workspace",
      branch: "",
      ahead: 0,
      behind: 0,
      groups: [{
        id: "changes",
        label: "Evidence",
        resources: [{
          path: "src/evidence.ts",
          status: "M",
          staged: false,
          readonlyEvidence: true,
        }],
      }],
      count: 1,
    })

    const actions = getScmResourceActions("src/evidence.ts")
    expect(actions).toEqual(expect.objectContaining({
      stage: expect.objectContaining({
        readonlyEvidence: true,
        enabled: false,
        gitIndexMutation: false,
        title: "只读 evidence，不写 Git index",
        ownerEvidence: expect.objectContaining({
          kind: "command",
          commandId: "scm.stageResource",
          connected: false,
          gitIndexMutation: false,
        }),
      }),
      discard: expect.objectContaining({
        commandId: "scm.discardResource",
        readonlyEvidence: true,
        enabled: false,
        gitIndexMutation: false,
        title: "只读 evidence，不丢弃工作区内容",
      }),
      attach: expect.objectContaining({
        readonlyEvidence: true,
        gitIndexMutation: false,
      }),
    }))
  })

  it("resolves partial resource action overrides into a full public actions contract", () => {
    registerOrUpdateScmProvider({
      id: "partial:D:/Workspace",
      providerId: "custom",
      label: "Partial",
      rootUri: "D:/Workspace",
      branch: "",
      ahead: 0,
      behind: 0,
      groups: [{
        id: "changes",
        label: "Changes",
        resources: [{
          path: "src/partial.ts",
          status: "M",
          staged: false,
          actions: {
            open: {
              commandId: "custom.open",
              title: "Open",
              arguments: ["src/partial.ts"],
              enabled: true,
              readonlyEvidence: false,
              gitIndexMutation: false,
            },
          },
        }],
      }],
      count: 1,
    })

    expect(getScmResource("src/partial.ts")?.actions).toEqual(expect.objectContaining({
      open: expect.objectContaining({ commandId: "custom.open" }),
    }))
    expect(getScmResourceActions("src/partial.ts")).toEqual(expect.objectContaining({
      open: expect.objectContaining({
        commandId: "custom.open",
        title: "Open",
      }),
      diff: expect.objectContaining({
        commandId: "scm.diffResource",
      }),
      stage: expect.objectContaining({
        commandId: "scm.stageResource",
        gitIndexMutation: false,
      }),
      unstage: expect.objectContaining({
        commandId: "scm.unstageResource",
      }),
      discard: expect.objectContaining({
        commandId: "scm.discardResource",
        enabled: false,
        gitIndexMutation: false,
      }),
      attach: expect.objectContaining({
        commandId: "scm.attachResourceEvidence",
        readonlyEvidence: true,
      }),
    }))
  })

  it("exposes provider, group, resource and command owner evidence without adding a second SCM state source", () => {
    const service = new ScmRegistryService()
    service.registerOrUpdateProvider({
      id: "evidence:D:/Workspace",
      providerId: "agentEvidence",
      label: "Agent Evidence",
      rootUri: "D:/Workspace",
      branch: "",
      ahead: 0,
      behind: 0,
      groups: [{
        id: "changes",
        label: "Evidence",
        resources: [{ path: "src/evidence.ts", status: "M", staged: false, readonlyEvidence: true }],
      }],
      count: 1,
    })

    const repository = service.getRepositories()[0]
    const group = repository.resourceGroups[0]
    const resource = group.resources[0]
    const actions = service.getResourceActions("src/evidence.ts", "D:/Workspace")

    expect(String(IScmRegistryService)).toBe("scmRegistryService")
    expect(String(IScmService)).toBe("scmRegistryService")
    expect(repository.provider.ownerEvidence).toEqual(expect.objectContaining({
      kind: "provider",
      codekStateSource: "scmRegistryService",
      readonlyEvidence: true,
      gitIndexMutation: false,
    }))
    expect(group.ownerEvidence).toEqual(expect.objectContaining({
      kind: "resourceGroup",
      owner: "agentEvidence:changes",
    }))
    expect(resource.ownerEvidence).toEqual(expect.objectContaining({
      kind: "resource",
      owner: "agentEvidence:changes:src/evidence.ts",
      remainingUiOwnerGap: expect.arrayContaining(["App.vue/generic SCM shell owner 未在本后台线程接入"]),
    }))
    expect(actions?.stage.ownerEvidence).toEqual(expect.objectContaining({
      kind: "command",
      commandId: "scm.stageResource",
      connected: false,
      gitIndexMutation: false,
    }))
    expect(actions?.discard.ownerEvidence).toEqual(expect.objectContaining({
      kind: "command",
      commandId: "scm.discardResource",
      connected: false,
      gitIndexMutation: false,
    }))
  })

  it("exposes a VS Code-style SCM service while old registry functions proxy the same model", () => {
    const service = new ScmRegistryService()
    const collection = new ServiceCollection([IScmRegistryService, service], [IScmService, service])
    const instantiationService = new InstantiationService(collection)
    const resolvedRegistry = instantiationService.invokeFunction((accessor) => accessor.get(IScmRegistryService))
    const resolvedScm = instantiationService.invokeFunction((accessor) => accessor.get(IScmService))

    expect(String(IScmRegistryService)).toBe("scmRegistryService")
    expect(String(IScmService)).toBe("scmRegistryService")
    expect(resolvedRegistry).toBe(resolvedScm)
    expect(resolvedRegistry._serviceBrand).toBeUndefined()

    const registration = resolvedRegistry.registerSCMProvider({
      id: "git:D:/Workspace",
      providerId: "git",
      label: "Codek",
      rootUri: "D:/Workspace",
      branch: "main",
      ahead: 0,
      behind: 0,
      groups: [{ id: "changes", label: "更改", resources: [{ path: "src/app.ts", status: "M", staged: false }] }],
      count: 1,
    })

    expect(resolvedRegistry.repositoryCount).toBe(1)
    expect(registration.repository).toEqual(expect.objectContaining({
      id: "git:D:/Workspace",
      input: expect.objectContaining({ enabled: true, visible: true }),
      actionButton: null,
    }))
    expect(resolvedRegistry.getRepositories()[0].resourceGroups[0].resources[0]).toEqual(expect.objectContaining({
      path: "src/app.ts",
      providerId: "git",
      rootUri: "D:/Workspace",
      actions: expect.objectContaining({
        diff: expect.objectContaining({ commandId: "scm.diffResource" }),
      }),
    }))
    registration.dispose()
    expect(resolvedRegistry.repositoryCount).toBe(0)
  })

  it("registers the global SCM singleton and keeps legacy helpers bound to it", () => {
    registerOrUpdateScmProvider({
      id: "custom:D:/Workspace",
      providerId: "custom",
      label: "Custom",
      rootUri: "D:/Workspace",
      branch: "",
      ahead: 0,
      behind: 0,
      groups: [{ id: "changes", label: "Changes", resources: [{ path: "custom.txt", status: "M", staged: false }] }],
      count: 1,
    })

    expect(globalScmRegistryService.getRepositories()).toHaveLength(1)
    expect(globalScmRegistryService.getQuickDiffResource("custom.txt")).toEqual(expect.objectContaining({
      path: "custom.txt",
      providerId: "custom",
    }))
    expect(getScmProviderTree()).toEqual(globalScmRegistryService.getProviderTree())
    expect(getScmRepositories()[0]).toEqual(expect.objectContaining({
      provider: expect.objectContaining({ providerId: "custom" }),
    }))
    expect(getSingletonServiceDescriptors().some(([id, instance]) => id === IScmRegistryService && instance === globalScmRegistryService)).toBe(true)
  })
})
