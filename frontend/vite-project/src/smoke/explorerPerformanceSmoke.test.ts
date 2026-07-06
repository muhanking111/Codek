import { describe, expect, it } from "vitest"

import { __explorerPerformanceSmokeTest } from "./explorerPerformanceSmoke"

const snapshot = (uris: string[], labels: string[]) => ({
  count: uris.length,
  blankCount: labels.filter((label) => !label).length,
  signature: uris.join("|"),
  labels,
})

describe("explorer performance smoke row readability", () => {
  it("accepts virtualized rows changing after fast scroll when labels remain readable", () => {
    const before = snapshot(["/repo/a.ts", "/repo/b.ts"], ["a.ts", "b.ts"])
    const after = snapshot(["/repo/y.ts", "/repo/z.ts"], ["y.ts", "z.ts"])
    const samples = [
      before,
      snapshot(["/repo/m.ts"], ["m.ts"]),
      after,
    ]

    expect(__explorerPerformanceSmokeTest.rowsRemainReadableAfterFastScroll(before, after, samples)).toBe(true)
  })

  it("rejects blank visible rows during fast scroll", () => {
    const before = snapshot(["/repo/a.ts"], ["a.ts"])
    const after = snapshot(["/repo/z.ts"], ["z.ts"])
    const samples = [
      before,
      snapshot(["/repo/blank.ts"], [""]),
      after,
    ]

    expect(__explorerPerformanceSmokeTest.rowsRemainReadableAfterFastScroll(before, after, samples)).toBe(false)
  })

  it("counts only rendered loading explorer rows", () => {
    document.body.innerHTML = [
      '<div id="host">',
      '<div class="codek-explorer-row loading"></div>',
      '<div class="codek-explorer-row"></div>',
      '<div class="other loading"></div>',
      '</div>',
    ].join("")

    expect(__explorerPerformanceSmokeTest.getLoadingRowCount(document.getElementById("host") as HTMLElement)).toBe(1)
  })

  it("derives virtualized row count from the rendered VS Code-style row height", () => {
    document.body.innerHTML = [
      '<div id="host">',
      '<div class="codek-list-view-content" style="height: 220000px">',
      '<div data-codek-explorer-row="true" style="height: 22px"></div>',
      "</div>",
      "</div>",
    ].join("")

    expect(__explorerPerformanceSmokeTest.getListTotalRows(document.getElementById("host") as HTMLElement)).toBe(10000)
  })

  it("falls back to VS Code explorer row height when no rendered row is available", () => {
    document.body.innerHTML = [
      '<div id="host">',
      '<div class="codek-list-view-content" style="height: 220px"></div>',
      "</div>",
    ].join("")

    expect(__explorerPerformanceSmokeTest.getListRowHeight(document.getElementById("host") as HTMLElement)).toBe(22)
    expect(__explorerPerformanceSmokeTest.getListTotalRows(document.getElementById("host") as HTMLElement)).toBe(10)
  })
})
