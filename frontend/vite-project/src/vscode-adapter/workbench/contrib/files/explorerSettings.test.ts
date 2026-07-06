import { describe, expect, it } from "vitest"
import { compareExplorerItems, LexicographicOptions, SortOrder } from "./explorerFileSorter"
import { getExplorerSortOrderConfiguration } from "./explorerSettings"

describe("VS Code explorer settings adapter", () => {
  it("maps VS Code explorer sort settings to the FileSorter configuration", () => {
    const configuration = getExplorerSortOrderConfiguration({
      "explorer.sortOrder": "filesFirst",
      "explorer.sortOrderLexicographicOptions": "unicode",
      "explorer.sortOrderReverse": true,
    })

    expect(configuration).toEqual({
      sortOrder: SortOrder.FilesFirst,
      lexicographicOptions: LexicographicOptions.Unicode,
      reverse: true,
    })
  })

  it("falls back to VS Code default sorting for unknown values", () => {
    expect(getExplorerSortOrderConfiguration({
      "explorer.sortOrder": "unknown",
      "explorer.sortOrderLexicographicOptions": "bad",
      "explorer.sortOrderReverse": "yes",
    })).toEqual({
      sortOrder: SortOrder.Default,
      lexicographicOptions: LexicographicOptions.Default,
      reverse: false,
    })
  })

  it("drives the migrated explorer sorter behavior", () => {
    const configuration = getExplorerSortOrderConfiguration({ "explorer.sortOrder": "filesFirst" })
    const items = [
      { name: "src", isDirectory: true },
      { name: "a.ts", isDirectory: false },
    ].sort((left, right) => compareExplorerItems(left, right, configuration))

    expect(items.map((item) => item.name)).toEqual(["a.ts", "src"])
  })
})