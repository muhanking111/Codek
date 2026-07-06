import { describe, expect, it } from "vitest"
import {
  compareExplorerItems,
  createExplorerItemComparator,
  LexicographicOptions,
  SortOrder,
} from "./explorerFileSorter"
import type { ExplorerSortableItem } from "./explorerFileSorter"

function names(items: ExplorerSortableItem[]): string[] {
  return items.map((item) => item.name)
}

function sortedNames(items: ExplorerSortableItem[], comparator = createExplorerItemComparator()): string[] {
  return names([...items].sort(comparator))
}

describe("VS Code Explorer file sorter adapter", () => {
  it("keeps roots in workspace order and before non-root items", () => {
    const items: ExplorerSortableItem[] = [
      { name: "src", isDirectory: true },
      { name: "z-workspace", isDirectory: true, isRoot: true, workspaceIndex: 1 },
      { name: "a-workspace", isDirectory: true, isRoot: true, workspaceIndex: 0 },
    ]

    expect(sortedNames(items)).toEqual([
      "a-workspace",
      "z-workspace",
      "src",
    ])
  })

  it("uses VS Code default folders-first sorting", () => {
    const items: ExplorerSortableItem[] = [
      { name: "file-10.ts" },
      { name: "src-10", isDirectory: true },
      { name: "file-2.ts" },
      { name: "src-2", isDirectory: true },
    ]

    expect(sortedNames(items)).toEqual([
      "src-2",
      "src-10",
      "file-2.ts",
      "file-10.ts",
    ])
  })

  it("supports mixed and filesFirst sort orders", () => {
    const items: ExplorerSortableItem[] = [
      { name: "z-folder", isDirectory: true },
      { name: "a-file.ts" },
      { name: "a-folder", isDirectory: true },
      { name: "z-file.ts" },
    ]

    expect(sortedNames(items, createExplorerItemComparator({ sortOrder: SortOrder.Mixed }))).toEqual([
      "a-file.ts",
      "a-folder",
      "z-file.ts",
      "z-folder",
    ])
    expect(sortedNames(items, createExplorerItemComparator({ sortOrder: SortOrder.FilesFirst }))).toEqual([
      "a-file.ts",
      "z-file.ts",
      "a-folder",
      "z-folder",
    ])
  })

  it("supports VS Code type and modified sort orders", () => {
    const byType: ExplorerSortableItem[] = [
      { name: "b.md" },
      { name: "a.ts" },
      { name: "c.test.ts" },
      { name: "src", isDirectory: true },
    ]

    expect(sortedNames(byType, createExplorerItemComparator({ sortOrder: SortOrder.Type }))).toEqual([
      "src",
      "b.md",
      "a.ts",
      "c.test.ts",
    ])

    const byModified: ExplorerSortableItem[] = [
      { name: "old.ts", mtime: 100 },
      { name: "new.ts", mtime: 300 },
      { name: "same-b.ts", mtime: 200 },
      { name: "same-a.ts", mtime: 200 },
    ]

    expect(sortedNames(byModified, createExplorerItemComparator({ sortOrder: SortOrder.Modified }))).toEqual([
      "new.ts",
      "same-a.ts",
      "same-b.ts",
      "old.ts",
    ])
  })

  it("supports lexicographic options and reverse sorting", () => {
    expect(compareExplorerItems(
      { name: "Alpha.ts" },
      { name: "alpha.ts" },
      { lexicographicOptions: LexicographicOptions.Upper },
    )).toBeLessThan(0)

    expect(compareExplorerItems(
      { name: "Alpha.ts" },
      { name: "alpha.ts" },
      { lexicographicOptions: LexicographicOptions.Lower },
    )).toBeGreaterThan(0)

    const items: ExplorerSortableItem[] = [
      { name: "a.ts" },
      { name: "b.ts" },
      { name: "src", isDirectory: true },
    ]

    expect(sortedNames(items, createExplorerItemComparator({ reverse: true }))).toEqual([
      "b.ts",
      "a.ts",
      "src",
    ])
  })
})
