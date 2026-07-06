import { describe, expect, it } from "vitest"
import { URI } from "../../../base/common/uri"
import { InstantiationService } from "../../instantiation/common/instantiationService"
import { getSingletonServiceDescriptors } from "../../instantiation/common/extensions"
import { ServiceCollection } from "../../instantiation/common/serviceCollection"
import {
  CodekWorkspaceContextService,
  IWorkspaceContextService,
  WorkbenchState,
  globalWorkspaceContextService,
} from "./workspace"

describe("VS Code workspace context adapter", () => {
  it("stores workspace folder write/read state in a VS Code-style Workspace model", () => {
    const service = new CodekWorkspaceContextService()
    const events: Array<{ added: string[]; removed: string[]; changed: string[] }> = []
    service.onDidChangeWorkspaceFolders((event) => {
      events.push({
        added: event.added.map((folder) => folder.name),
        removed: event.removed.map((folder) => folder.name),
        changed: event.changed.map((folder) => folder.name),
      })
    })

    service.updateWorkspaceState({
      projectRoot: "D:/apps/client",
      workspaceFile: "D:/workspaces/demo.code-workspace",
      workspaceRoots: ["D:/apps/client", "D:/libs/client"],
    })

    expect(service.getWorkbenchState()).toBe(WorkbenchState.WORKSPACE)
    expect(service.getWorkspace().folders.map((folder) => [folder.name, folder.uri.fsPath, folder.index])).toEqual([
      ["client (apps)", "d:/apps/client", 0],
      ["client (libs)", "d:/libs/client", 1],
    ])
    expect(service.getWorkspaceFolder(URI.file("D:/libs/client/src/app.ts"))?.name).toBe("client (libs)")
    expect(service.normalizeRelativePath("D:/libs/client/src/app.ts")).toBe("/client (libs)/src/app.ts")
    expect(service.resolveFsPath("/client (apps)/src/app.ts")).toBe("D:/apps/client/src/app.ts")
    expect(events).toEqual([{ added: ["client (apps)", "client (libs)"], removed: [], changed: [] }])
  })

  it("exposes the global workspace service through VS Code service collection", () => {
    const singleton = getSingletonServiceDescriptors().find(([id]) => id === IWorkspaceContextService)
    expect(singleton?.[1]).toBe(globalWorkspaceContextService)

    const services = new ServiceCollection(...getSingletonServiceDescriptors())
    const instantiationService = new InstantiationService(services)

    expect(instantiationService.invokeFunction((accessor) => accessor.get(IWorkspaceContextService))).toBe(globalWorkspaceContextService)
    expect(globalWorkspaceContextService._serviceBrand).toBeUndefined()
  })
})
