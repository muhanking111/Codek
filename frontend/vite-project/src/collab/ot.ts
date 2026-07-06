export type OpComponent =
  | { type: "retain"; n: number }
  | { type: "insert"; s: string }
  | { type: "delete"; n: number }

export class TextOperation {
  readonly ops: OpComponent[] = []
  private baseLength = 0
  private targetLength = 0

  get baseLen(): number {
    return this.baseLength
  }

  get targetLen(): number {
    return this.targetLength
  }

  retain(n: number): TextOperation {
    if (n <= 0) return this
    this.baseLength += n
    this.targetLength += n
    const last = this.ops[this.ops.length - 1]
    if (last && last.type === "retain") {
      last.n += n
    } else {
      this.ops.push({ type: "retain", n })
    }
    return this
  }

  insert(s: string): TextOperation {
    if (s.length === 0) return this
    this.targetLength += s.length
    const last = this.ops[this.ops.length - 1]
    if (last && last.type === "insert") {
      last.s += s
    } else if (last && last.type === "delete") {
      const prev = this.ops[this.ops.length - 2]
      if (prev && prev.type === "insert") {
        prev.s += s
      } else {
        this.ops.splice(this.ops.length - 1, 0, { type: "insert", s })
      }
    } else {
      this.ops.push({ type: "insert", s })
    }
    return this
  }

  delete(n: number): TextOperation {
    if (n <= 0) return this
    this.baseLength += n
    const last = this.ops[this.ops.length - 1]
    if (last && last.type === "delete") {
      last.n += n
    } else {
      this.ops.push({ type: "delete", n })
    }
    return this
  }

  isNoop(): boolean {
    return this.ops.length === 0 || (this.ops.length === 1 && this.ops[0].type === "retain")
  }

  static fromJSON(data: OpComponent[]): TextOperation {
    const op = new TextOperation()
    for (const comp of data) {
      if (comp.type === "retain") {
        op.retain(comp.n)
      } else if (comp.type === "insert") {
        op.insert(comp.s)
      } else if (comp.type === "delete") {
        op.delete(comp.n)
      }
    }
    return op
  }

  toJSON(): OpComponent[] {
    return this.ops.map((c) => ({ ...c }))
  }
}

export function apply(doc: string, operation: TextOperation): string {
  if (doc.length !== operation.baseLen) {
    throw new Error(
      `Document length ${doc.length} does not match operation base length ${operation.baseLen}`,
    )
  }

  const parts: string[] = []
  let offset = 0

  for (const op of operation.ops) {
    switch (op.type) {
      case "retain":
        parts.push(doc.substring(offset, offset + op.n))
        offset += op.n
        break
      case "insert":
        parts.push(op.s)
        break
      case "delete":
        offset += op.n
        break
    }
  }

  return parts.join("")
}

export function compose(a: TextOperation, b: TextOperation): TextOperation {
  if (a.targetLen !== b.baseLen) {
    throw new Error(
      `Compose: a.targetLen ${a.targetLen} !== b.baseLen ${b.baseLen}`,
    )
  }

  const result = new TextOperation()
  let ai = 0
  let bi = 0
  let aOp: OpComponent | undefined = a.ops[ai]
  let bOp: OpComponent | undefined = b.ops[bi]

  function nextA(): void {
    ai++
    aOp = a.ops[ai]
  }

  function nextB(): void {
    bi++
    bOp = b.ops[bi]
  }

  while (ai < a.ops.length || bi < b.ops.length) {
    if (bOp && bOp.type === "insert") {
      result.insert(bOp.s)
      nextB()
      continue
    }

    if (aOp && aOp.type === "delete") {
      result.delete(aOp.n)
      nextA()
      continue
    }

    if (ai >= a.ops.length || bi >= b.ops.length) {
      throw new Error("Compose: operations do not align")
    }

    if (!aOp || !bOp) {
      throw new Error("Compose: unexpected null operation")
    }

    if (aOp.type === "retain" && bOp.type === "retain") {
      const minN = Math.min(aOp.n, bOp.n)
      result.retain(minN)
      aOp.n -= minN
      bOp.n -= minN
      if (aOp.n === 0) nextA()
      if (bOp.n === 0) nextB()
    } else if (aOp.type === "retain" && bOp.type === "delete") {
      const minN = Math.min(aOp.n, bOp.n)
      result.delete(minN)
      aOp.n -= minN
      bOp.n -= minN
      if (aOp.n === 0) nextA()
      if (bOp.n === 0) nextB()
    } else if (aOp.type === "insert" && bOp.type === "retain") {
      const minLen = Math.min(aOp.s.length, bOp.n)
      result.insert(aOp.s.substring(0, minLen))
      if (aOp.s.length > minLen) {
        aOp = { type: "insert", s: aOp.s.substring(minLen) }
      } else {
        nextA()
      }
      bOp.n -= minLen
      if (bOp.n === 0) nextB()
    } else if (aOp.type === "insert" && bOp.type === "delete") {
      const minLen = Math.min(aOp.s.length, bOp.n)
      if (aOp.s.length > minLen) {
        aOp = { type: "insert", s: aOp.s.substring(minLen) }
      } else {
        nextA()
      }
      bOp.n -= minLen
      if (bOp.n === 0) nextB()
    } else {
      throw new Error(`Compose: unexpected op pair ${aOp.type} / ${bOp.type}`)
    }
  }

  return result
}

export function transform(
  clientOp: TextOperation,
  serverOp: TextOperation,
): { left: TextOperation; right: TextOperation } {
  if (clientOp.baseLen !== serverOp.baseLen) {
    throw new Error(
      `Transform: base lengths differ (${clientOp.baseLen} vs ${serverOp.baseLen})`,
    )
  }

  const left = new TextOperation()
  const right = new TextOperation()
  let ci = 0
  let si = 0
  let cOp: OpComponent | undefined = clientOp.ops[ci]
  let sOp: OpComponent | undefined = serverOp.ops[si]

  function nextC(): void {
    ci++
    cOp = clientOp.ops[ci]
  }

  function nextS(): void {
    si++
    sOp = serverOp.ops[si]
  }

  while (ci < clientOp.ops.length || si < serverOp.ops.length) {
    if (cOp && cOp.type === "insert") {
      left.insert(cOp.s)
      right.retain(cOp.s.length)
      nextC()
      continue
    }

    if (sOp && sOp.type === "insert") {
      left.retain(sOp.s.length)
      right.insert(sOp.s)
      nextS()
      continue
    }

    if (ci >= clientOp.ops.length || si >= serverOp.ops.length) {
      throw new Error("Transform: operations do not align")
    }

    if (!cOp || !sOp) {
      throw new Error("Transform: unexpected null operation")
    }

    if (cOp.type === "retain" && sOp.type === "retain") {
      const minN = Math.min(cOp.n, sOp.n)
      left.retain(minN)
      right.retain(minN)
      cOp.n -= minN
      sOp.n -= minN
      if (cOp.n === 0) nextC()
      if (sOp.n === 0) nextS()
    } else if (cOp.type === "delete" && sOp.type === "delete") {
      const minN = Math.min(cOp.n, sOp.n)
      cOp.n -= minN
      sOp.n -= minN
      if (cOp.n === 0) nextC()
      if (sOp.n === 0) nextS()
    } else if (cOp.type === "delete" && sOp.type === "retain") {
      const minN = Math.min(cOp.n, sOp.n)
      left.delete(minN)
      cOp.n -= minN
      sOp.n -= minN
      if (cOp.n === 0) nextC()
      if (sOp.n === 0) nextS()
    } else if (cOp.type === "retain" && sOp.type === "delete") {
      const minN = Math.min(cOp.n, sOp.n)
      right.delete(minN)
      cOp.n -= minN
      sOp.n -= minN
      if (cOp.n === 0) nextC()
      if (sOp.n === 0) nextS()
    } else {
      throw new Error(`Transform: unexpected op pair ${cOp.type} / ${sOp.type}`)
    }
  }

  return { left, right }
}

export interface ServerMessage {
  type: "ack" | "operation" | "reject"
  revision: number
  operation?: OpComponent[]
}

export interface ClientMessage {
  type: "operation"
  revision: number
  operation: OpComponent[]
}

export class OTServer {
  private operations: TextOperation[] = []

  get revision(): number {
    return this.operations.length
  }

  receiveOperation(
    clientRevision: number,
    clientOperation: TextOperation,
  ): { transformed: TextOperation; broadcastRevision: number } {
    if (clientRevision < 0 || clientRevision > this.operations.length) {
      throw new Error(`Invalid revision: ${clientRevision}`)
    }

    let transformed = clientOperation
    for (let i = clientRevision; i < this.operations.length; i++) {
      const pair = transform(transformed, this.operations[i])
      transformed = pair.left
    }

    this.operations.push(transformed)
    return {
      transformed,
      broadcastRevision: this.operations.length - 1,
    }
  }

  getOperationsSince(revision: number): TextOperation[] {
    return this.operations.slice(revision)
  }
}

export type OperationSender = (msg: ClientMessage) => void

export class CollabClient {
  private revision = 0
  private pendingOp: TextOperation | null = null
  private bufferedOp: TextOperation | null = null
  private sendFn: OperationSender

  constructor(sendFn: OperationSender) {
    this.sendFn = sendFn
  }

  get currentRevision(): number {
    return this.revision
  }

  applyLocal(op: TextOperation): TextOperation {
    if (this.pendingOp === null && this.bufferedOp === null) {
      this.pendingOp = op
      this.sendFn({
        type: "operation",
        revision: this.revision,
        operation: op.toJSON(),
      })
      return op
    }

    if (this.bufferedOp !== null) {
      this.bufferedOp = compose(this.bufferedOp, op)
    } else {
      this.bufferedOp = op
    }

    return op
  }

  applyServer(serverRevision: number, serverOp: TextOperation): TextOperation | null {
    if (this.pendingOp === null && this.bufferedOp === null) {
      this.revision = serverRevision + 1
      return serverOp
    }

    if (this.pendingOp !== null && this.bufferedOp === null) {
      const { left, right } = transform(this.pendingOp, serverOp)
      this.pendingOp = left
      this.revision = serverRevision + 1
      this.sendFn({
        type: "operation",
        revision: this.revision,
        operation: left.toJSON(),
      })
      return right
    }

    if (this.pendingOp !== null && this.bufferedOp !== null) {
      const pair1 = transform(this.pendingOp, serverOp)
      const pair2 = transform(this.bufferedOp, pair1.right)
      this.pendingOp = pair1.left
      this.bufferedOp = pair2.left
      this.revision = serverRevision + 1
      this.sendFn({
        type: "operation",
        revision: this.revision,
        operation: pair1.left.toJSON(),
      })
      return pair2.right
    }

    return null
  }

  handleAck(serverRevision: number): TextOperation | null {
    if (this.pendingOp === null) {
      throw new Error("Received ack without pending operation")
    }

    this.revision = serverRevision + 1
    this.pendingOp = null

    if (this.bufferedOp !== null) {
      this.pendingOp = this.bufferedOp
      this.bufferedOp = null
      this.sendFn({
        type: "operation",
        revision: this.revision,
        operation: this.pendingOp.toJSON(),
      })
      return this.pendingOp
    }

    return null
  }

  handleReject(): void {
    this.pendingOp = null
    this.bufferedOp = null
  }
}
