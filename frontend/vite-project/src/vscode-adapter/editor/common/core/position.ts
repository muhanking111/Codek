/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/editor/common/core/position.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

export interface IPosition {
  readonly lineNumber: number
  readonly column: number
}

export class Position {
  readonly lineNumber: number
  readonly column: number

  constructor(lineNumber: number, column: number) {
    this.lineNumber = lineNumber
    this.column = column
  }

  with(newLineNumber = this.lineNumber, newColumn = this.column): Position {
    if (newLineNumber === this.lineNumber && newColumn === this.column) return this
    return new Position(newLineNumber, newColumn)
  }

  delta(deltaLineNumber = 0, deltaColumn = 0): Position {
    return this.with(Math.max(1, this.lineNumber + deltaLineNumber), Math.max(1, this.column + deltaColumn))
  }

  equals(other: IPosition): boolean {
    return Position.equals(this, other)
  }

  static equals(a: IPosition | null, b: IPosition | null): boolean {
    if (!a && !b) return true
    return Boolean(a && b && a.lineNumber === b.lineNumber && a.column === b.column)
  }

  isBefore(other: IPosition): boolean {
    return Position.isBefore(this, other)
  }

  static isBefore(a: IPosition, b: IPosition): boolean {
    if (a.lineNumber < b.lineNumber) return true
    if (b.lineNumber < a.lineNumber) return false
    return a.column < b.column
  }

  isBeforeOrEqual(other: IPosition): boolean {
    return Position.isBeforeOrEqual(this, other)
  }

  static isBeforeOrEqual(a: IPosition, b: IPosition): boolean {
    if (a.lineNumber < b.lineNumber) return true
    if (b.lineNumber < a.lineNumber) return false
    return a.column <= b.column
  }

  static compare(a: IPosition, b: IPosition): number {
    const lineDelta = (a.lineNumber | 0) - (b.lineNumber | 0)
    return lineDelta === 0 ? (a.column | 0) - (b.column | 0) : lineDelta
  }

  clone(): Position {
    return new Position(this.lineNumber, this.column)
  }

  toString(): string {
    return `(${this.lineNumber},${this.column})`
  }

  static lift(position: IPosition): Position {
    return new Position(position.lineNumber, position.column)
  }

  static isIPosition(value: unknown): value is IPosition {
    const candidate = value as IPosition | null
    return Boolean(candidate && typeof candidate.lineNumber === "number" && typeof candidate.column === "number")
  }

  toJSON(): IPosition {
    return { lineNumber: this.lineNumber, column: this.column }
  }
}
