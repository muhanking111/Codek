import { describe, expect, it } from "vitest"
import { PrefixSumComputer } from "./prefixSumComputer"

describe("VS Code PrefixSumComputer adapter", () => {
  it("maps offsets to indexes and remainders", () => {
    const sums = new PrefixSumComputer(new Uint32Array([3, 5, 2]))

    expect(sums.getTotalSum()).toBe(10)
    expect(sums.getPrefixSum(0)).toBe(3)
    expect(sums.getPrefixSum(1)).toBe(8)
    expect(sums.getIndexOf(4)).toEqual({ index: 1, remainder: 1 })
    expect(sums.getIndexOf(9)).toEqual({ index: 2, remainder: 1 })
  })

  it("updates prefix sums after insert, set and remove", () => {
    const sums = new PrefixSumComputer(new Uint32Array([2, 2, 2]))

    expect(sums.insertValues(1, new Uint32Array([3, 4]))).toBe(true)
    expect(sums.getTotalSum()).toBe(13)
    expect(sums.setValue(2, 6)).toBe(true)
    expect(sums.getTotalSum()).toBe(15)
    expect(sums.removeValues(1, 2)).toBe(true)
    expect(sums.getTotalSum()).toBe(6)
    expect(sums.getIndexOf(3)).toEqual({ index: 1, remainder: 1 })
  })
})

