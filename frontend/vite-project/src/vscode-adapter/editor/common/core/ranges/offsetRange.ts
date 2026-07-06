/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/editor/common/core/ranges/offsetRange.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export interface IOffsetRange {
  readonly start: number
  readonly endExclusive: number
}

export class OffsetRange implements IOffsetRange {
  static fromTo(start: number, endExclusive: number): OffsetRange {
    return new OffsetRange(start, endExclusive)
  }

  static equals(first: IOffsetRange, second: IOffsetRange): boolean {
    return first.start === second.start && first.endExclusive === second.endExclusive
  }

  static addRange(range: OffsetRange, sortedRanges: OffsetRange[]): void {
    let startIndex = 0
    while (startIndex < sortedRanges.length && sortedRanges[startIndex].endExclusive < range.start) startIndex += 1
    let endIndex = startIndex
    while (endIndex < sortedRanges.length && sortedRanges[endIndex].start <= range.endExclusive) endIndex += 1
    if (startIndex === endIndex) {
      sortedRanges.splice(startIndex, 0, range)
      return
    }
    const start = Math.min(range.start, sortedRanges[startIndex].start)
    const end = Math.max(range.endExclusive, sortedRanges[endIndex - 1].endExclusive)
    sortedRanges.splice(startIndex, endIndex - startIndex, new OffsetRange(start, end))
  }

  static tryCreate(start: number, endExclusive: number): OffsetRange | undefined {
    return start > endExclusive ? undefined : new OffsetRange(start, endExclusive)
  }

  static ofLength(length: number): OffsetRange {
    return new OffsetRange(0, length)
  }

  static ofStartAndLength(start: number, length: number): OffsetRange {
    return new OffsetRange(start, start + length)
  }

  static emptyAt(offset: number): OffsetRange {
    return new OffsetRange(offset, offset)
  }

  constructor(readonly start: number, readonly endExclusive: number) {
    if (start > endExclusive) throw new Error(`Invalid offset range: [${start}, ${endExclusive})`)
  }

  get isEmpty(): boolean {
    return this.start === this.endExclusive
  }

  delta(offset: number): OffsetRange {
    return new OffsetRange(this.start + offset, this.endExclusive + offset)
  }

  deltaStart(offset: number): OffsetRange {
    return new OffsetRange(this.start + offset, this.endExclusive)
  }

  deltaEnd(offset: number): OffsetRange {
    return new OffsetRange(this.start, this.endExclusive + offset)
  }

  get length(): number {
    return this.endExclusive - this.start
  }

  toString(): string {
    return `[${this.start}, ${this.endExclusive})`
  }

  equals(other: OffsetRange): boolean {
    return OffsetRange.equals(this, other)
  }

  containsRange(other: OffsetRange): boolean {
    return this.start <= other.start && other.endExclusive <= this.endExclusive
  }

  contains(offset: number): boolean {
    return this.start <= offset && offset < this.endExclusive
  }

  join(other: OffsetRange): OffsetRange {
    return new OffsetRange(Math.min(this.start, other.start), Math.max(this.endExclusive, other.endExclusive))
  }

  intersect(other: OffsetRange): OffsetRange | undefined {
    const start = Math.max(this.start, other.start)
    const end = Math.min(this.endExclusive, other.endExclusive)
    return start <= end ? new OffsetRange(start, end) : undefined
  }

  intersectionLength(other: OffsetRange): number {
    return Math.max(0, Math.min(this.endExclusive, other.endExclusive) - Math.max(this.start, other.start))
  }

  intersects(other: OffsetRange): boolean {
    return Math.max(this.start, other.start) < Math.min(this.endExclusive, other.endExclusive)
  }

  intersectsOrTouches(other: OffsetRange): boolean {
    return Math.max(this.start, other.start) <= Math.min(this.endExclusive, other.endExclusive)
  }

  isBefore(other: OffsetRange): boolean {
    return this.endExclusive <= other.start
  }

  isAfter(other: OffsetRange): boolean {
    return this.start >= other.endExclusive
  }

  slice<T>(array: readonly T[]): T[] {
    return array.slice(this.start, this.endExclusive)
  }

  substring(value: string): string {
    return value.substring(this.start, this.endExclusive)
  }

  clip(value: number): number {
    if (this.isEmpty) throw new Error(`Invalid clipping range: ${this.toString()}`)
    return Math.max(this.start, Math.min(this.endExclusive - 1, value))
  }

  clipCyclic(value: number): number {
    if (this.isEmpty) throw new Error(`Invalid clipping range: ${this.toString()}`)
    if (value < this.start) return this.endExclusive - ((this.start - value) % this.length)
    if (value >= this.endExclusive) return this.start + ((value - this.start) % this.length)
    return value
  }

  map<T>(fn: (offset: number) => T): T[] {
    const result: T[] = []
    for (let offset = this.start; offset < this.endExclusive; offset += 1) result.push(fn(offset))
    return result
  }

  forEach(fn: (offset: number) => void): void {
    for (let offset = this.start; offset < this.endExclusive; offset += 1) fn(offset)
  }

  joinRightTouching(range: OffsetRange): OffsetRange {
    if (this.endExclusive !== range.start) throw new Error(`Invalid join: ${this.toString()} and ${range.toString()}`)
    return new OffsetRange(this.start, range.endExclusive)
  }

  withMargin(margin: number): OffsetRange
  withMargin(marginStart: number, marginEnd: number): OffsetRange
  withMargin(marginStart: number, marginEnd = marginStart): OffsetRange {
    return new OffsetRange(this.start - marginStart, this.endExclusive + marginEnd)
  }
}

export class OffsetRangeSet {
  private readonly sortedRanges: OffsetRange[] = []

  get ranges(): OffsetRange[] {
    return [...this.sortedRanges]
  }

  addRange(range: OffsetRange): void {
    OffsetRange.addRange(range, this.sortedRanges)
  }

  toString(): string {
    return this.sortedRanges.map((range) => range.toString()).join(", ")
  }

  intersectsStrict(other: OffsetRange): boolean {
    let index = 0
    while (index < this.sortedRanges.length && this.sortedRanges[index].endExclusive <= other.start) index += 1
    return index < this.sortedRanges.length && this.sortedRanges[index].start < other.endExclusive
  }

  intersectWithRange(other: OffsetRange): OffsetRangeSet {
    const result = new OffsetRangeSet()
    for (const range of this.sortedRanges) {
      const intersection = range.intersect(other)
      if (intersection) result.addRange(intersection)
    }
    return result
  }

  intersectWithRangeLength(other: OffsetRange): number {
    return this.intersectWithRange(other).length
  }

  get length(): number {
    return this.sortedRanges.reduce((sum, range) => sum + range.length, 0)
  }
}
