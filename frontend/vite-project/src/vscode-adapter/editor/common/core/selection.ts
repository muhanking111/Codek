/*---------------------------------------------------------------------------------------------
 * Adapted from VS Code: src/vs/editor/common/core/selection.ts
 * Copyright (c) Microsoft Corporation. Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { type IPosition, Position } from "./position"
import { Range } from "./range"

export interface ISelection {
  readonly selectionStartLineNumber: number
  readonly selectionStartColumn: number
  readonly positionLineNumber: number
  readonly positionColumn: number
}

export const enum SelectionDirection {
  LTR,
  RTL,
}

export class Selection extends Range implements ISelection {
  readonly selectionStartLineNumber: number
  readonly selectionStartColumn: number
  readonly positionLineNumber: number
  readonly positionColumn: number

  constructor(selectionStartLineNumber: number, selectionStartColumn: number, positionLineNumber: number, positionColumn: number) {
    super(selectionStartLineNumber, selectionStartColumn, positionLineNumber, positionColumn)
    this.selectionStartLineNumber = selectionStartLineNumber
    this.selectionStartColumn = selectionStartColumn
    this.positionLineNumber = positionLineNumber
    this.positionColumn = positionColumn
  }

  override toString(): string {
    return `[${this.selectionStartLineNumber},${this.selectionStartColumn} -> ${this.positionLineNumber},${this.positionColumn}]`
  }

  equalsSelection(other: ISelection): boolean {
    return Selection.selectionsEqual(this, other)
  }

  static selectionsEqual(a: ISelection, b: ISelection): boolean {
    return (
      a.selectionStartLineNumber === b.selectionStartLineNumber &&
      a.selectionStartColumn === b.selectionStartColumn &&
      a.positionLineNumber === b.positionLineNumber &&
      a.positionColumn === b.positionColumn
    )
  }

  getDirection(): SelectionDirection {
    if (this.selectionStartLineNumber === this.startLineNumber && this.selectionStartColumn === this.startColumn) return SelectionDirection.LTR
    return SelectionDirection.RTL
  }

  override setEndPosition(endLineNumber: number, endColumn: number): Selection {
    if (this.getDirection() === SelectionDirection.LTR) {
      return new Selection(this.startLineNumber, this.startColumn, endLineNumber, endColumn)
    }
    return new Selection(endLineNumber, endColumn, this.startLineNumber, this.startColumn)
  }

  getPosition(): Position {
    return new Position(this.positionLineNumber, this.positionColumn)
  }

  getSelectionStart(): Position {
    return new Position(this.selectionStartLineNumber, this.selectionStartColumn)
  }

  override setStartPosition(startLineNumber: number, startColumn: number): Selection {
    if (this.getDirection() === SelectionDirection.LTR) {
      return new Selection(startLineNumber, startColumn, this.endLineNumber, this.endColumn)
    }
    return new Selection(this.endLineNumber, this.endColumn, startLineNumber, startColumn)
  }

  static override fromPositions(start: IPosition, end: IPosition = start): Selection {
    return new Selection(start.lineNumber, start.column, end.lineNumber, end.column)
  }

  static fromRange(range: Range, direction: SelectionDirection): Selection {
    if (direction === SelectionDirection.LTR) {
      return new Selection(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn)
    }
    return new Selection(range.endLineNumber, range.endColumn, range.startLineNumber, range.startColumn)
  }

  static liftSelection(selection: ISelection): Selection {
    return new Selection(selection.selectionStartLineNumber, selection.selectionStartColumn, selection.positionLineNumber, selection.positionColumn)
  }

  static selectionsArrEqual(a: ISelection[], b: ISelection[]): boolean {
    if ((a && !b) || (!a && b)) return false
    if (!a && !b) return true
    if (a.length !== b.length) return false
    for (let index = 0; index < a.length; index += 1) {
      if (!Selection.selectionsEqual(a[index], b[index])) return false
    }
    return true
  }

  static isISelection(value: unknown): value is ISelection {
    const candidate = value as ISelection | null
    return Boolean(
      candidate &&
      typeof candidate.selectionStartLineNumber === "number" &&
      typeof candidate.selectionStartColumn === "number" &&
      typeof candidate.positionLineNumber === "number" &&
      typeof candidate.positionColumn === "number",
    )
  }

  static createWithDirection(
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number,
    direction: SelectionDirection,
  ): Selection {
    if (direction === SelectionDirection.LTR) return new Selection(startLineNumber, startColumn, endLineNumber, endColumn)
    return new Selection(endLineNumber, endColumn, startLineNumber, startColumn)
  }
}
