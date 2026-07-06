/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/editor/common/model/prefixSumComputer.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export class PrefixSumIndexOfResult {
  constructor(
    public readonly index: number,
    public readonly remainder: number,
  ) {}
}

export class PrefixSumComputer {
  private values: Uint32Array
  private prefixSum: Uint32Array
  private readonly prefixSumValidIndex = new Int32Array(1)

  constructor(values: Uint32Array) {
    this.values = values
    this.prefixSum = new Uint32Array(values.length)
    this.prefixSumValidIndex[0] = -1
  }

  getCount(): number {
    return this.values.length
  }

  insertValues(insertIndex: number, insertValues: Uint32Array): boolean {
    insertIndex = toUint32(insertIndex)
    if (insertValues.length === 0) return false

    const oldValues = this.values
    const oldPrefixSum = this.prefixSum
    this.values = new Uint32Array(oldValues.length + insertValues.length)
    this.values.set(oldValues.subarray(0, insertIndex), 0)
    this.values.set(insertValues, insertIndex)
    this.values.set(oldValues.subarray(insertIndex), insertIndex + insertValues.length)

    if (insertIndex - 1 < this.prefixSumValidIndex[0]) this.prefixSumValidIndex[0] = insertIndex - 1
    this.prefixSum = new Uint32Array(this.values.length)
    if (this.prefixSumValidIndex[0] >= 0) this.prefixSum.set(oldPrefixSum.subarray(0, this.prefixSumValidIndex[0] + 1))
    return true
  }

  setValue(index: number, value: number): boolean {
    index = toUint32(index)
    value = toUint32(value)
    if (this.values[index] === value) return false
    this.values[index] = value
    if (index - 1 < this.prefixSumValidIndex[0]) this.prefixSumValidIndex[0] = index - 1
    return true
  }

  removeValues(startIndex: number, count: number): boolean {
    startIndex = toUint32(startIndex)
    count = toUint32(count)
    const oldValues = this.values
    const oldPrefixSum = this.prefixSum
    if (startIndex >= oldValues.length) return false

    count = Math.min(count, oldValues.length - startIndex)
    if (count === 0) return false

    this.values = new Uint32Array(oldValues.length - count)
    this.values.set(oldValues.subarray(0, startIndex), 0)
    this.values.set(oldValues.subarray(startIndex + count), startIndex)
    this.prefixSum = new Uint32Array(this.values.length)
    if (startIndex - 1 < this.prefixSumValidIndex[0]) this.prefixSumValidIndex[0] = startIndex - 1
    if (this.prefixSumValidIndex[0] >= 0) this.prefixSum.set(oldPrefixSum.subarray(0, this.prefixSumValidIndex[0] + 1))
    return true
  }

  getTotalSum(): number {
    if (this.values.length === 0) return 0
    return this.getPrefixSum(this.values.length - 1)
  }

  getPrefixSum(index: number): number {
    if (index < 0) return 0
    index = Math.min(toUint32(index), Math.max(0, this.values.length - 1))
    if (index <= this.prefixSumValidIndex[0]) return this.prefixSum[index]

    let startIndex = this.prefixSumValidIndex[0] + 1
    if (startIndex === 0) {
      this.prefixSum[0] = this.values[0]
      startIndex += 1
    }
    for (let i = startIndex; i <= index; i += 1) {
      this.prefixSum[i] = this.prefixSum[i - 1] + this.values[i]
    }
    this.prefixSumValidIndex[0] = Math.max(this.prefixSumValidIndex[0], index)
    return this.prefixSum[index]
  }

  getIndexOf(sum: number): PrefixSumIndexOfResult {
    sum = Math.floor(sum)
    this.getTotalSum()

    let low = 0
    let high = this.values.length - 1
    let mid = 0
    let midStart = 0
    while (low <= high) {
      mid = low + ((high - low) / 2) | 0
      const midStop = this.prefixSum[mid]
      midStart = midStop - this.values[mid]
      if (sum < midStart) high = mid - 1
      else if (sum >= midStop) low = mid + 1
      else break
    }
    return new PrefixSumIndexOfResult(mid, sum - midStart)
  }
}

function toUint32(value: number): number {
  return value >>> 0
}

