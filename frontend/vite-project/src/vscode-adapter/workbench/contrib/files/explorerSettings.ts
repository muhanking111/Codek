/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code:
 * - src/vs/workbench/contrib/files/common/files.ts
 * - src/vs/workbench/contrib/files/browser/views/explorerViewer.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import {
  DEFAULT_SORT_ORDER_CONFIGURATION,
  LexicographicOptions,
  SortOrder,
  type ISortOrderConfiguration,
} from "./explorerFileSorter"

export interface ExplorerSettingsSource {
  [key: string]: unknown
}

export function getExplorerSortOrderConfiguration(settings: ExplorerSettingsSource = {}): ISortOrderConfiguration {
  return {
    sortOrder: normalizeSortOrder(settings["explorer.sortOrder"]),
    lexicographicOptions: normalizeLexicographicOptions(settings["explorer.sortOrderLexicographicOptions"]),
    reverse: settings["explorer.sortOrderReverse"] === true,
  }
}

function normalizeSortOrder(value: unknown): SortOrder {
  switch (value) {
    case SortOrder.Mixed:
    case SortOrder.FilesFirst:
    case SortOrder.Type:
    case SortOrder.Modified:
    case SortOrder.FoldersNestsFiles:
      return value
    case SortOrder.Default:
    default:
      return DEFAULT_SORT_ORDER_CONFIGURATION.sortOrder
  }
}

function normalizeLexicographicOptions(value: unknown): LexicographicOptions {
  switch (value) {
    case LexicographicOptions.Upper:
    case LexicographicOptions.Lower:
    case LexicographicOptions.Unicode:
      return value
    case LexicographicOptions.Default:
    default:
      return DEFAULT_SORT_ORDER_CONFIGURATION.lexicographicOptions
  }
}