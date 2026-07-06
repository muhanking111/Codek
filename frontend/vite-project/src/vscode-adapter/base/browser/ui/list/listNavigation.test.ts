import { describe, expect, it } from "vitest"
import { resolveListNavigationIndex } from "./listNavigation"

describe("VS Code list navigation adapter", () => {
  it("moves focus by one item for arrow keys", () => {
    expect(resolveListNavigationIndex({ key: "ArrowDown", currentIndex: 1, itemCount: 4 })).toBe(2)
    expect(resolveListNavigationIndex({ key: "ArrowUp", currentIndex: 1, itemCount: 4 })).toBe(0)
  })

  it("clamps first and last item navigation", () => {
    expect(resolveListNavigationIndex({ key: "ArrowUp", currentIndex: 0, itemCount: 4 })).toBe(0)
    expect(resolveListNavigationIndex({ key: "ArrowDown", currentIndex: 3, itemCount: 4 })).toBe(3)
    expect(resolveListNavigationIndex({ key: "Home", currentIndex: 3, itemCount: 4 })).toBe(0)
    expect(resolveListNavigationIndex({ key: "End", currentIndex: 0, itemCount: 4 })).toBe(3)
  })

  it("moves by visible page size for page keys", () => {
    expect(resolveListNavigationIndex({ key: "PageDown", currentIndex: 2, itemCount: 20, viewportItemCount: 6 })).toBe(8)
    expect(resolveListNavigationIndex({ key: "PageUp", currentIndex: 8, itemCount: 20, viewportItemCount: 6 })).toBe(2)
  })
})
