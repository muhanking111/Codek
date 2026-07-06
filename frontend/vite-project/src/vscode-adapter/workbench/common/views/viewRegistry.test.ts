import { describe, expect, it } from "vitest"
import { getVisibleViewContainers, getVisibleViews } from "./viewRegistry"

describe("VS Code view registry adapter", () => {
  it("filters views by container and when clauses", () => {
    const views = [
      { id: "explorer", name: "Explorer", containerId: "workbench.view.explorer", order: 20 },
      { id: "testing", name: "Testing", containerId: "workbench.view.testing", order: 10, when: "testingEnabled" },
    ]

    expect(getVisibleViews(views, undefined, { testingEnabled: false }).map((view) => view.id)).toEqual(["explorer"])
    expect(getVisibleViews(views, "workbench.view.testing", { testingEnabled: true }).map((view) => view.id)).toEqual(["testing"])
  })

  it("hides empty containers and orders visible containers", () => {
    const containers = [
      { id: "empty", name: "Empty", location: "activityBar", order: 1 },
      { id: "search", name: "Search", location: "activityBar", order: 20 },
      { id: "explorer", name: "Explorer", location: "activityBar", order: 10 },
    ]
    const views = [
      { id: "search.default", name: "Search", containerId: "search" },
      { id: "explorer.default", name: "Explorer", containerId: "explorer" },
    ]

    expect(getVisibleViewContainers(containers, views, "activityBar").map((container) => container.id)).toEqual(["explorer", "search"])
  })
})
