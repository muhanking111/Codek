export interface CharId {
  siteId: number
  clock: number
}

export interface Char {
  id: CharId
  value: string
  leftId: CharId | null
  rightId: CharId | null
}

export interface RGAOperation {
  type: "insert" | "delete"
  char?: Char
  targetId?: CharId
}

const START_CHAR: Char = {
  id: { siteId: -1, clock: 0 },
  value: "",
  leftId: null,
  rightId: null,
}

const END_CHAR: Char = {
  id: { siteId: -1, clock: 1 },
  value: "",
  leftId: null,
  rightId: null,
}

export function idEquals(a: CharId | null, b: CharId | null): boolean {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return a.siteId === b.siteId && a.clock === b.clock
}

function compareId(a: CharId, b: CharId): number {
  if (a.clock !== b.clock) return a.clock - b.clock
  return a.siteId - b.siteId
}

export class RGA {
  private chars: Map<string, Char> = new Map()
  private siteId: number
  private clock = 0

  constructor(siteId: number) {
    this.siteId = siteId
    this.addCharInternal(START_CHAR)
    this.addCharInternal(END_CHAR)
  }

  private static idKey(id: CharId): string {
    return `${id.siteId}:${id.clock}`
  }

  private addCharInternal(ch: Char): void {
    this.chars.set(RGA.idKey(ch.id), ch)
  }

  private getChar(id: CharId): Char | undefined {
    return this.chars.get(RGA.idKey(id))
  }

  private getVisibleChars(): Char[] {
    const result: Char[] = []
    let current = START_CHAR

    while (current !== END_CHAR) {
      const rightId = current.rightId
      if (!rightId) break
      const rightChar = this.getChar(rightId)
      if (!rightChar) break

      if (rightChar.value.length > 0) {
        result.push(rightChar)
      }
      current = rightChar
    }

    return result
  }

  getText(): string {
    return this.getVisibleChars().map((c) => c.value).join("")
  }

  localInsert(position: number, value: string): RGAOperation {
    this.clock++
    const id: CharId = { siteId: this.siteId, clock: this.clock }

    const visible = this.getVisibleChars()
    const clampedPos = Math.min(position, visible.length)

    const leftChar = clampedPos === 0 ? START_CHAR : visible[clampedPos - 1]
    const rightChar = clampedPos >= visible.length ? END_CHAR : visible[clampedPos]

    const ch: Char = {
      id,
      value,
      leftId: leftChar.id,
      rightId: rightChar.id,
    }

    this.insertChar(ch)
    return { type: "insert", char: ch }
  }

  localDelete(position: number): RGAOperation | null {
    const visible = this.getVisibleChars()
    if (position < 0 || position >= visible.length) return null

    const targetChar = visible[position]
    this.deleteChar(targetChar.id)
    return { type: "delete", targetId: targetChar.id }
  }

  remoteInsert(op: RGAOperation): void {
    if (op.type !== "insert" || !op.char) return
    const ch = op.char

    if (this.getChar(ch.id)) return

    if (ch.leftId && !this.getChar(ch.leftId)) return
    if (ch.rightId && !this.getChar(ch.rightId)) return

    this.insertChar(ch)
  }

  remoteDelete(op: RGAOperation): void {
    if (op.type !== "delete" || !op.targetId) return
    this.deleteChar(op.targetId)
  }

  private insertChar(ch: Char): void {
    this.addCharInternal(ch)

    const leftChar = ch.leftId ? this.getChar(ch.leftId) : null
    const rightChar = ch.rightId ? this.getChar(ch.rightId) : null

    if (!leftChar && !rightChar) return

    const candidates = this.findInsertionCandidates(ch)

    if (candidates.left && candidates.right) {
      candidates.left.rightId = ch.id
      ch.leftId = candidates.left.id
      ch.rightId = candidates.right.id
      candidates.right.leftId = ch.id
    } else if (candidates.left) {
      const oldRight = candidates.left.rightId
      candidates.left.rightId = ch.id
      ch.leftId = candidates.left.id
      ch.rightId = oldRight
      if (oldRight) {
        const rightNode = this.getChar(oldRight)
        if (rightNode) {
          rightNode.leftId = ch.id
        }
      }
    } else if (candidates.right) {
      const oldLeft = candidates.right.leftId
      candidates.right.leftId = ch.id
      ch.rightId = candidates.right.id
      ch.leftId = oldLeft
      if (oldLeft) {
        const leftNode = this.getChar(oldLeft)
        if (leftNode) {
          leftNode.rightId = ch.id
        }
      }
    }
  }

  private findInsertionCandidates(ch: Char): { left: Char | null; right: Char | null } {
    let left: Char | null = null
    let right: Char | null = null

    if (ch.leftId) {
      left = this.getChar(ch.leftId) ?? null
    }
    if (ch.rightId) {
      right = this.getChar(ch.rightId) ?? null
    }

    if (left && right) {
      let scan = left.rightId ? this.getChar(left.rightId) : null
      while (scan && scan.id !== right.id) {
        if (compareId(scan.id, ch.id) < 0) {
          left = scan
        }
        scan = scan.rightId ? this.getChar(scan.rightId) : null
      }
    }

    return { left, right }
  }

  private deleteChar(id: CharId): void {
    const ch = this.getChar(id)
    if (!ch) return

    ch.value = ""

    if (ch.leftId) {
      const leftChar = this.getChar(ch.leftId)
      if (leftChar) {
        leftChar.rightId = ch.rightId
      }
    }
    if (ch.rightId) {
      const rightChar = this.getChar(ch.rightId)
      if (rightChar) {
        rightChar.leftId = ch.leftId
      }
    }
  }

  applyOperation(op: RGAOperation): void {
    if (op.type === "insert") {
      this.remoteInsert(op)
    } else if (op.type === "delete") {
      this.remoteDelete(op)
    }
  }

  serialize(): string {
    const entries: Char[] = []
    this.chars.forEach((ch) => entries.push(ch))
    return JSON.stringify(entries)
  }

  static deserialize(data: string, siteId: number): RGA {
    const rga = new RGA(siteId)
    const entries = JSON.parse(data) as Char[]
    for (const ch of entries) {
      rga.addCharInternal(ch)
    }
    return rga
  }
}

export function serializeOperation(op: RGAOperation): string {
  return JSON.stringify(op)
}

export function deserializeOperation(data: string): RGAOperation {
  return JSON.parse(data) as RGAOperation
}
