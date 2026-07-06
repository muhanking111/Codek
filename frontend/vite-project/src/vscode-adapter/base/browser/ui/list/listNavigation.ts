/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ListNavigationInput {
  key: string
  currentIndex: number
  itemCount: number
  viewportItemCount?: number
}

export function resolveListNavigationIndex(input: ListNavigationInput): number | null {
  const itemCount = Math.max(0, Math.trunc(Number(input.itemCount || 0)))
  if (itemCount <= 0) return null
  const currentIndex = clampIndex(input.currentIndex, itemCount)
  const pageSize = Math.max(1, Math.trunc(Number(input.viewportItemCount || 1)))

  switch (input.key) {
    case "ArrowUp":
      return Math.max(0, currentIndex - 1)
    case "ArrowDown":
      return Math.min(itemCount - 1, currentIndex + 1)
    case "Home":
      return 0
    case "End":
      return itemCount - 1
    case "PageUp":
      return Math.max(0, currentIndex - pageSize)
    case "PageDown":
      return Math.min(itemCount - 1, currentIndex + pageSize)
    default:
      return null
  }
}

function clampIndex(index: number, itemCount: number): number {
  const normalized = Math.trunc(Number.isFinite(index) ? index : 0)
  if (normalized < 0) return 0
  if (normalized >= itemCount) return itemCount - 1
  return normalized
}
