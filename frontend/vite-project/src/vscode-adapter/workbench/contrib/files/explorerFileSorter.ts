/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code:
 * - src/vs/workbench/contrib/files/common/files.ts
 * - src/vs/workbench/contrib/files/browser/views/explorerViewer.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import {
  compareFileExtensionsDefault,
  compareFileExtensionsLower,
  compareFileExtensionsUnicode,
  compareFileExtensionsUpper,
  compareFileNamesDefault,
  compareFileNamesLower,
  compareFileNamesUnicode,
  compareFileNamesUpper,
} from "../../../base/common/comparers"

export enum SortOrder {
  Default = "default",
  Mixed = "mixed",
  FilesFirst = "filesFirst",
  Type = "type",
  Modified = "modified",
  FoldersNestsFiles = "foldersNestsFiles",
}

export enum LexicographicOptions {
  Default = "default",
  Upper = "upper",
  Lower = "lower",
  Unicode = "unicode",
}

export interface ISortOrderConfiguration {
  sortOrder: SortOrder
  lexicographicOptions: LexicographicOptions
  reverse: boolean
}

export const DEFAULT_SORT_ORDER_CONFIGURATION: ISortOrderConfiguration = {
  sortOrder: SortOrder.Default,
  lexicographicOptions: LexicographicOptions.Default,
  reverse: false,
}

export interface ExplorerSortableItem {
  name: string
  isDirectory?: boolean
  isRoot?: boolean
  mtime?: number
  hasNests?: boolean
  workspaceIndex?: number
}

type FileNameComparer = (one: string | null, other: string | null) => number
type FileExtensionComparer = (one: string | null, other: string | null) => number

export function compareExplorerItems(
  first: ExplorerSortableItem,
  second: ExplorerSortableItem,
  configuration: Partial<ISortOrderConfiguration> = DEFAULT_SORT_ORDER_CONFIGURATION,
): number {
  let statA = first
  let statB = second

  if (statA.isRoot) {
    if (statB.isRoot) return Number(statA.workspaceIndex ?? 0) - Number(statB.workspaceIndex ?? 0)
    return -1
  }
  if (statB.isRoot) return 1

  const sortOrder = configuration.sortOrder || DEFAULT_SORT_ORDER_CONFIGURATION.sortOrder
  const lexicographicOptions = configuration.lexicographicOptions || DEFAULT_SORT_ORDER_CONFIGURATION.lexicographicOptions
  const reverse = Boolean(configuration.reverse)
  if (reverse) [statA, statB] = [statB, statA]

  const { compareFileNames, compareFileExtensions } = getLexicographicComparers(lexicographicOptions)

  switch (sortOrder) {
    case SortOrder.Type:
      if (statA.isDirectory && !statB.isDirectory) return -1
      if (statB.isDirectory && !statA.isDirectory) return 1
      if (statA.isDirectory && statB.isDirectory) return compareFileNames(statA.name, statB.name)
      break

    case SortOrder.FilesFirst:
      if (statA.isDirectory && !statB.isDirectory) return 1
      if (statB.isDirectory && !statA.isDirectory) return -1
      break

    case SortOrder.FoldersNestsFiles:
      if (statA.isDirectory && !statB.isDirectory) return -1
      if (statB.isDirectory && !statA.isDirectory) return 1
      if (statA.hasNests && !statB.hasNests) return -1
      if (statB.hasNests && !statA.hasNests) return 1
      break

    case SortOrder.Mixed:
      break

    default:
      if (statA.isDirectory && !statB.isDirectory) return -1
      if (statB.isDirectory && !statA.isDirectory) return 1
      break
  }

  switch (sortOrder) {
    case SortOrder.Type:
      return compareFileExtensions(statA.name, statB.name)

    case SortOrder.Modified:
      if (statA.mtime !== statB.mtime) {
        return statA.mtime && statB.mtime && statA.mtime < statB.mtime ? 1 : -1
      }
      return compareFileNames(statA.name, statB.name)

    default:
      return compareFileNames(statA.name, statB.name)
  }
}

export function createExplorerItemComparator(
  configuration: Partial<ISortOrderConfiguration> = DEFAULT_SORT_ORDER_CONFIGURATION,
): (first: ExplorerSortableItem, second: ExplorerSortableItem) => number {
  return (first, second) => compareExplorerItems(first, second, configuration)
}

function getLexicographicComparers(lexicographicOptions: LexicographicOptions): {
  compareFileNames: FileNameComparer
  compareFileExtensions: FileExtensionComparer
} {
  switch (lexicographicOptions) {
    case LexicographicOptions.Upper:
      return {
        compareFileNames: compareFileNamesUpper,
        compareFileExtensions: compareFileExtensionsUpper,
      }
    case LexicographicOptions.Lower:
      return {
        compareFileNames: compareFileNamesLower,
        compareFileExtensions: compareFileExtensionsLower,
      }
    case LexicographicOptions.Unicode:
      return {
        compareFileNames: compareFileNamesUnicode,
        compareFileExtensions: compareFileExtensionsUnicode,
      }
    default:
      return {
        compareFileNames: compareFileNamesDefault,
        compareFileExtensions: compareFileExtensionsDefault,
      }
  }
}
