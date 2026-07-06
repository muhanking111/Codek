import type * as Monaco from "monaco-editor"
import {
  CollabClient,
  TextOperation,
  apply,
  type ClientMessage,
  type OpComponent,
} from "./ot"
import { RGA, serializeOperation, deserializeOperation, type RGAOperation } from "./crdt"

export type SyncAlgorithm = "ot" | "crdt"

export interface CollabUser {
  id: string
  name: string
  color: string
  cursorLine: number
  cursorCol: number
}

export interface CursorPosition {
  line: number
  column: number
}

const USER_COLORS = [
  "#f87171",
  "#fb923c",
  "#fbbf24",
  "#34d399",
  "#22d3ee",
  "#818cf8",
  "#c084fc",
  "#f472b6",
]

interface WSMessage {
  type: "operation" | "cursor" | "join" | "leave" | "init"
  userId?: string
  userName?: string
  revision?: number
  operation?: OpComponent[] | string
  cursor?: CursorPosition
  document?: string
  algorithm?: SyncAlgorithm
}

export class CollabSession {
  private algorithm: SyncAlgorithm
  private otClient: CollabClient | null = null
  private rga: RGA | null = null
  private editor: Monaco.editor.IStandaloneCodeEditor | null = null
  private monacoInstance: typeof Monaco | null = null
  private ws: WebSocket | null = null
  private document: string = ""
  private userId: string
  private userName: string
  private userColor: string
  private users: Map<string, CollabUser> = new Map()
  private isApplyingRemote = false
  private decorations: Map<string, string[]> = new Map()
  private disposables: Monaco.IDisposable[] = []
  private siteId: number

  constructor(
    userId: string,
    userName: string,
    algorithm: SyncAlgorithm = "ot",
  ) {
    this.userId = userId
    this.userName = userName
    this.algorithm = algorithm
    this.siteId = Math.floor(Math.random() * 1000000)
    this.userColor = USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]
  }

  connect(url: string): void {
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.send({
        type: "join",
        userId: this.userId,
        userName: this.userName,
      })
    }

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as WSMessage
      this.handleMessage(msg)
    }

    this.ws.onclose = () => {
      this.cleanup()
    }

    this.ws.onerror = () => {
      this.cleanup()
    }

    if (this.algorithm === "ot") {
      this.otClient = new CollabClient((msg: ClientMessage) => {
        this.send({
          type: "operation",
          userId: this.userId,
          revision: msg.revision,
          operation: msg.operation,
        })
      })
    } else {
      this.rga = new RGA(this.siteId)
    }
  }

  attachEditor(
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof Monaco,
  ): void {
    this.editor = editor
    this.monacoInstance = monaco
    this.document = editor.getValue()

    const model = editor.getModel()
    if (!model) return

    this.disposables.push(
      model.onDidChangeContent((e) => {
        if (this.isApplyingRemote) return
        this.handleLocalChange(e)
      }),
    )

    this.disposables.push(
      editor.onDidChangeCursorPosition((e) => {
        this.sendCursor(e.position)
      }),
    )
  }

  private handleLocalChange(e: Monaco.editor.IModelContentChangedEvent): void {
    const model = this.editor?.getModel()
    if (!model) return

    for (const change of e.changes) {
      const op = this.changeToOperation(change, model)
      if (!op) continue

      if (this.algorithm === "ot" && this.otClient) {
        this.otClient.applyLocal(op)
        this.document = apply(this.document, op)
      } else if (this.algorithm === "crdt" && this.rga) {
        const rgaOp = this.textOpToRGAOp(op)
        if (rgaOp) {
          this.rga.applyOperation(rgaOp)
          this.send({
            type: "operation",
            userId: this.userId,
            operation: serializeOperation(rgaOp),
          })
        }
      }
    }
  }

  private changeToOperation(
    change: Monaco.editor.IModelContentChange,
    model: Monaco.editor.ITextModel,
  ): TextOperation | null {
    const offset = model.getOffsetAt({
      lineNumber: change.range.startLineNumber,
      column: change.range.startColumn,
    })

    const op = new TextOperation()

    if (offset > 0) {
      op.retain(offset)
    }

    if (change.rangeLength > 0) {
      op.delete(change.rangeLength)
    }

    if (change.text.length > 0) {
      op.insert(change.text)
    }

    const totalLen = model.getValue().length
    const afterInsert = offset + change.text.length
    const remaining = totalLen - afterInsert
    if (remaining > 0) {
      op.retain(remaining)
    }

    if (op.baseLen !== this.document.length) {
      return null
    }

    return op
  }

  private textOpToRGAOp(op: TextOperation): RGAOperation | null {
    let pos = 0
    for (const comp of op.ops) {
      if (comp.type === "retain") {
        pos += comp.n
      } else if (comp.type === "insert" && this.rga) {
        for (const ch of comp.s) {
          this.rga.localInsert(pos, ch)
          pos++
        }
        return null
      } else if (comp.type === "delete" && this.rga) {
        this.rga.localDelete(pos)
        return null
      }
    }
    return null
  }

  private handleMessage(msg: WSMessage): void {
    if (msg.type === "init") {
      if (msg.document !== undefined) {
        this.document = msg.document
        if (this.editor) {
          this.isApplyingRemote = true
          this.editor.setValue(msg.document)
          this.isApplyingRemote = false
        }
      }
      if (msg.algorithm) {
        this.algorithm = msg.algorithm
      }
      return
    }

    if (msg.type === "join" && msg.userId && msg.userName) {
      this.users.set(msg.userId, {
        id: msg.userId,
        name: msg.userName,
        color: USER_COLORS[this.users.size % USER_COLORS.length],
        cursorLine: 1,
        cursorCol: 1,
      })
      return
    }

    if (msg.type === "leave" && msg.userId) {
      this.users.delete(msg.userId)
      this.removeUserDecoration(msg.userId)
      return
    }

    if (msg.type === "cursor" && msg.userId && msg.cursor) {
      const user = this.users.get(msg.userId)
      if (user) {
        user.cursorLine = msg.cursor.line
        user.cursorCol = msg.cursor.column
        this.updateUserDecoration(msg.userId, user)
      }
      return
    }

    if (msg.type === "operation" && msg.userId !== this.userId && msg.operation) {
      this.applyRemoteOperation(msg)
    }
  }

  private applyRemoteOperation(msg: WSMessage): void {
    if (this.algorithm === "ot" && this.otClient && msg.revision !== undefined) {
      const serverOp = TextOperation.fromJSON(msg.operation as OpComponent[])
      const transformedOp = this.otClient.applyServer(msg.revision, serverOp)

      if (transformedOp && this.editor) {
        this.applyOperationToEditor(transformedOp)
        this.document = apply(this.document, transformedOp)
      }
    } else if (this.algorithm === "crdt" && this.rga && msg.operation) {
      const rgaOp = deserializeOperation(msg.operation as string)
      this.rga.applyOperation(rgaOp)
      const newText = this.rga.getText()
      if (this.editor) {
        this.isApplyingRemote = true
        this.editor.setValue(newText)
        this.isApplyingRemote = false
        this.document = newText
      }
    }
  }

  private applyOperationToEditor(op: TextOperation): void {
    if (!this.editor || !this.monacoInstance) return

    const model = this.editor.getModel()
    if (!model) return

    this.isApplyingRemote = true

    const currentText = model.getValue()
    const newText = apply(currentText, op)

    const fullRange = model.getFullModelRange()
    this.editor.executeEdits("collab-remote", [
      {
        range: new this.monacoInstance.Range(
          fullRange.startLineNumber,
          fullRange.startColumn,
          fullRange.endLineNumber,
          fullRange.endColumn,
        ),
        text: newText,
      },
    ])

    this.isApplyingRemote = false
  }

  private sendCursor(position: Monaco.Position): void {
    this.send({
      type: "cursor",
      userId: this.userId,
      cursor: { line: position.lineNumber, column: position.column },
    })
  }

  private updateUserDecoration(userId: string, user: CollabUser): void {
    if (!this.editor || !this.monacoInstance) return

    const existing = this.decorations.get(userId) ?? []
    const newDecorations = this.editor.deltaDecorations(existing, [
      {
        range: new this.monacoInstance.Range(
          user.cursorLine,
          user.cursorCol,
          user.cursorLine,
          user.cursorCol,
        ),
        options: {
          className: `collab-cursor-${userId}`,
          beforeContentClassName: `collab-cursor-line-${userId}`,
          hoverMessage: { value: user.name },
          stickiness: 1,
        },
      },
    ])
    this.decorations.set(userId, newDecorations)
  }

  private removeUserDecoration(userId: string): void {
    if (!this.editor) return

    const existing = this.decorations.get(userId)
    if (existing) {
      this.editor.deltaDecorations(existing, [])
      this.decorations.delete(userId)
    }
  }

  private send(msg: WSMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private cleanup(): void {
    this.ws = null
    this.otClient = null
    this.rga = null
  }

  disconnect(): void {
    this.send({
      type: "leave",
      userId: this.userId,
    })

    for (const disposable of this.disposables) {
      disposable.dispose()
    }
    this.disposables = []

    for (const userId of this.decorations.keys()) {
      this.removeUserDecoration(userId)
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    this.cleanup()
  }

  getConnectedUsers(): CollabUser[] {
    return Array.from(this.users.values())
  }

  getDocument(): string {
    return this.document
  }

  getAlgorithm(): SyncAlgorithm {
    return this.algorithm
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }
}
