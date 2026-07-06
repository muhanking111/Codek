import { beforeEach, describe, expect, it } from "vitest"
import { registerTestingWorkbenchViews, TESTING_VIEW_IDS } from "../testing/testingService"
import { clearViews, getViewContainers, getViews, registerDefaultWorkbenchViews, registerView, registerViewContainer } from "./viewRegistry"

describe("VS Code style workbench view registry", () => {
  beforeEach(() => clearViews())

  it("registers default VS Code and Codek view containers", () => {
    registerDefaultWorkbenchViews()

    expect(getViewContainers("activityBar").map((container) => container.id)).toEqual([
      "workbench.view.explorer",
      "workbench.view.search",
      "workbench.view.scm",
      "workbench.view.extensions",
      "codek.view.symbols",
      "codek.view.agent",
      "workbench.view.settings",
    ])
    expect(getViewContainers("activityBar").map((container) => container.productIcon?.codicon)).toEqual([
      "codicon-files",
      "codicon-search",
      "codicon-source-control",
      "codicon-extensions",
      "codicon-symbol-class",
      "codicon-sparkle",
      "codicon-settings-gear",
    ])
  })

  it("filters views using shared context keys", () => {
    registerViewContainer({ id: "workbench.view.testing", name: "测试", location: "activityBar", source: "vscode" })
    registerView({
      id: "workbench.view.testing.testExplorer",
      name: "测试资源管理器",
      containerId: "workbench.view.testing",
      when: "workspaceFolderCount != 0 && testingEnabled",
    })

    expect(getViews("workbench.view.testing", { workspaceFolderCount: 0, testingEnabled: true })).toHaveLength(0)
    expect(getViews("workbench.view.testing", { workspaceFolderCount: 1, testingEnabled: true })).toHaveLength(1)
  })

  it("normalizes extension contribution labels and icon paths before they reach the UI model", () => {
    registerViewContainer({
      id: "publisher.extension.internalView",
      name: "publisher.extension.internalView",
      location: "activityBar",
      source: "extension",
      icon: "resources/activity.svg",
    })
    registerView({
      id: "publisher.extension.internalView.default",
      name: "publisher.extension.internalView.default",
      containerId: "publisher.extension.internalView",
      icon: "resources/activity.svg",
      source: "extension",
    })

    const [container] = getViewContainers("activityBar")
    const [view] = getViews(container.id)

    expect(container.name).toBe("Publisher Extension Internal View")
    expect(container.userTitle).toBe("Publisher Extension Internal View")
    expect(container.productIcon?.fallback).toBe("unknown")
    expect(view.name).toBe("Publisher Extension Internal View")
    expect(view.productIcon?.fallback).toBe("unknown")
  })

  it("keeps registration disposal scoped to the owning entry and restores shadowed descriptors", () => {
    const baseContainer = registerViewContainer({
      id: "codek.view.lifecycle",
      name: "Lifecycle",
      location: "activityBar",
      source: "codek",
      order: 30,
    })
    const firstView = registerView({
      id: "codek.view.lifecycle.surface",
      name: "First Surface",
      containerId: "codek.view.lifecycle",
      order: 20,
    })
    const overrideView = registerView({
      id: "codek.view.lifecycle.surface",
      name: "Override Surface",
      containerId: "codek.view.lifecycle",
      order: 5,
    })

    expect(getViews("codek.view.lifecycle").map((view) => view.name)).toEqual(["Override Surface"])

    firstView.dispose()
    expect(getViews("codek.view.lifecycle").map((view) => view.name)).toEqual(["Override Surface"])

    overrideView.dispose()
    expect(getViews("codek.view.lifecycle")).toHaveLength(0)

    const restoredView = registerView({
      id: "codek.view.lifecycle.surface",
      name: "Restored Surface",
      containerId: "codek.view.lifecycle",
      order: 20,
    })
    const restoredOverride = registerView({
      id: "codek.view.lifecycle.surface",
      name: "Restored Override",
      containerId: "codek.view.lifecycle",
      order: 5,
    })

    restoredOverride.dispose()
    expect(getViews("codek.view.lifecycle").map((view) => view.name)).toEqual(["Restored Surface"])

    restoredView.dispose()
    baseContainer.dispose()
    expect(getViewContainers("activityBar").map((container) => container.id)).not.toContain("codek.view.lifecycle")
    expect(getViews("codek.view.lifecycle")).toHaveLength(0)
  })

  it("keeps default workbench view registration idempotent and does not shadow later overrides", () => {
    registerDefaultWorkbenchViews()
    registerViewContainer({
      id: "workbench.view.search",
      name: "Search Override",
      location: "activityBar",
      source: "vscode",
      order: 1,
    })
    registerView({
      id: "workbench.view.search.default",
      name: "Search Override Surface",
      containerId: "workbench.view.search",
      location: "activityBar",
      source: "vscode",
      order: -1,
    })

    registerDefaultWorkbenchViews()

    expect(getViewContainers("activityBar").find((container) => container.id === "workbench.view.search")).toEqual(
      expect.objectContaining({ name: "Search Override" }),
    )
    expect(getViews("workbench.view.search")).toEqual([
      expect.objectContaining({ id: "workbench.view.search.default", name: "Search Override Surface" }),
    ])
  })

  it("does not expose incomplete activity shells by default", () => {
    registerDefaultWorkbenchViews()

    const defaultContainerIds = getViewContainers("activityBar").map((container) => container.id)

    expect(defaultContainerIds).not.toContain("workbench.view.debug")
    expect(defaultContainerIds).not.toContain("codek.view.automation")
    expect(defaultContainerIds).not.toContain("codek.view.remote")
    expect(defaultContainerIds).not.toContain("workbench.view.testing")
  })

  it("exposes the Testing Explorer projection-backed view shell without claiming the VS Code DOM owner", () => {
    registerDefaultWorkbenchViews()
    const registration = registerTestingWorkbenchViews()

    expect(getViews(TESTING_VIEW_IDS.Container, {
      testingEnabled: true,
      testingProviderCount: 1,
      testingCoverageOpen: false,
    })).toEqual([
      expect.objectContaining({
        id: TESTING_VIEW_IDS.Explorer,
        source: "vscode",
        order: -999,
        userDescription: expect.stringContaining("显示测试控制器"),
      }),
    ])

    expect(getViews(TESTING_VIEW_IDS.Container, {
      testingEnabled: false,
      testingProviderCount: 1,
      testingDefaultPlaceholderVisible: true,
      testingWorkbenchAdapterDisabled: true,
    }).map((view) => view.id)).toEqual([TESTING_VIEW_IDS.Default])

    registration.dispose()
  })
})
