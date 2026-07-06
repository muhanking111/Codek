import { describe, expect, it } from "vitest"
import { URI } from "../../../base/common/uri"
import { InstantiationService } from "../../instantiation/common/instantiationService"
import { getSingletonServiceDescriptors } from "../../instantiation/common/extensions"
import { ServiceCollection } from "../../instantiation/common/serviceCollection"
import { CodekWorkspaceContextService } from "../../workspace/common/workspace"
import { CodekLabelService, ILabelService, Verbosity, globalLabelService } from "./label"

describe("VS Code label service adapter", () => {
  it("formats resource labels relative to workspace folders and preserves multi-root prefixes", () => {
    const workspaceContextService = new CodekWorkspaceContextService()
    workspaceContextService.updateWorkspaceState({
      projectRoot: "D:/apps/client",
      workspaceRoots: ["D:/apps/client", "D:/libs/client"],
    })
    const service = new CodekLabelService(workspaceContextService)

    expect(service.getUriLabel(URI.file("D:/libs/client/src/app.ts"), { relative: true, separator: "/" })).toBe("client (libs) • src/app.ts")
    expect(service.getUriLabel(URI.file("D:/libs/client/src/app.ts"), { relative: true, noPrefix: true, separator: "/" })).toBe("src/app.ts")
    expect(service.getUriBasenameLabel(URI.file("D:/libs/client/src/app.ts"))).toBe("app.ts")
    expect(service.getWorkspaceLabel(workspaceContextService.getWorkspace(), { verbose: Verbosity.SHORT })).toBe("2 folders")
  })

  it("applies registered resource label formatters and emits formatter changes", () => {
    const service = new CodekLabelService(new CodekWorkspaceContextService())
    const formatterChanges: string[] = []
    service.onDidChangeFormatters((event) => formatterChanges.push(event.scheme))

    const disposable = service.registerFormatter({
      scheme: "codek-workspace",
      formatting: {
        label: "workspace:${path}",
        separator: "/",
        stripPathStartingSeparator: true,
      },
    })

    expect(service.getUriLabel(URI.from({ scheme: "codek-workspace", path: "/src/main.ts" }))).toBe("workspace:src/main.ts")
    disposable.dispose()
    expect(formatterChanges).toEqual(["codek-workspace", "codek-workspace"])
  })

  it("exposes the global label service through VS Code service collection", () => {
    const singleton = getSingletonServiceDescriptors().find(([id]) => id === ILabelService)
    expect(singleton?.[1]).toBe(globalLabelService)

    const services = new ServiceCollection(...getSingletonServiceDescriptors())
    const instantiationService = new InstantiationService(services)

    expect(instantiationService.invokeFunction((accessor) => accessor.get(ILabelService))).toBe(globalLabelService)
    expect(globalLabelService._serviceBrand).toBeUndefined()
  })
})
