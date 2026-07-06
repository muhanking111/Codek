export interface DiffHunk {
  id: string
  beforeStart: number
  beforeEnd: number
  afterStart: number
  afterEnd: number
  beforeLines: string[]
  afterLines: string[]
}

type DiffOp = { kind: "equal" | "insert" | "delete"; count: number }

export function computeHunks(before: string, after: string): DiffHunk[] {
  const beforeLines = before === "" ? [] : before.split("\n")
  const afterLines = after === "" ? [] : after.split("\n")
  const diffs = lcsDiff(beforeLines, afterLines)

  const hunks: DiffHunk[] = []
  let beforeIdx = 0
  let afterIdx = 0
  let current: DiffHunk | null = null
  let hunkCounter = 0

  const flush = (): void => {
    if (current) {
      hunks.push(current)
      current = null
    }
  }

  for (const op of diffs) {
    if (op.kind === "equal") {
      flush()
      beforeIdx += op.count
      afterIdx += op.count
    } else {
      if (!current) {
        hunkCounter += 1
        current = {
          id: `hunk-${hunkCounter}`,
          beforeStart: beforeIdx + 1,
          beforeEnd: beforeIdx,
          afterStart: afterIdx + 1,
          afterEnd: afterIdx,
          beforeLines: [],
          afterLines: [],
        }
      }
      if (op.kind === "delete") {
        current.beforeLines.push(...beforeLines.slice(beforeIdx, beforeIdx + op.count))
        beforeIdx += op.count
        current.beforeEnd = beforeIdx
      } else if (op.kind === "insert") {
        current.afterLines.push(...afterLines.slice(afterIdx, afterIdx + op.count))
        afterIdx += op.count
        current.afterEnd = afterIdx
      }
    }
  }
  flush()
  return hunks
}

function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const m = a.length
  const n = b.length
  if (m === 0 && n === 0) return []
  if (m === 0) return [{ kind: "insert", count: n }]
  if (n === 0) return [{ kind: "delete", count: m }]

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  const ops: DiffOp[] = []
  const push = (kind: DiffOp["kind"]): void => {
    const last = ops[ops.length - 1]
    if (last && last.kind === kind) last.count += 1
    else ops.push({ kind, count: 1 })
  }

  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      push("equal")
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("delete")
      i += 1
    } else {
      push("insert")
      j += 1
    }
  }
  while (i < m) {
    push("delete")
    i += 1
  }
  while (j < n) {
    push("insert")
    j += 1
  }
  return ops
}
